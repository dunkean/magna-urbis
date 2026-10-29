//! Replays a captured settlements + roads request (web/out/capture_roads.mjs) natively, printing ms per
//! phase and an FNV-1a hash of the outputs.
//!
//! `cargo run --release -p magna-urbis-core --example roads_replay -- <raster.bin> <request.json> [repeats]`
//! raster.bin is the native `/raster` upload body; request.json the `/settlements` body (seed, sites|place, roads).
use magna_urbis_core::settlements::roads::{RoadConfig, RoadSite};
use magna_urbis_core::settlements::{Config, Raster, Terrain};
use serde_json::Value;
use std::time::Instant;

fn fnv(h: &mut u64, bytes: &[u8]) {
    for &b in bytes {
        *h ^= b as u64;
        *h = h.wrapping_mul(0x100000001b3);
    }
}

fn main() {
    let args: Vec<String> = std::env::args().collect();
    let body = std::fs::read(&args[1]).expect("raster.bin");
    let request: Value =
        serde_json::from_slice(&std::fs::read(&args[2]).expect("request.json")).unwrap();
    let repeats: usize = args.get(3).and_then(|s| s.parse().ok()).unwrap_or(1);
    let header_len = u32::from_le_bytes(body[..4].try_into().unwrap()) as usize;
    let header: Value = serde_json::from_slice(&body[4..4 + header_len]).unwrap();
    let (width, n) = (
        header["width"].as_f64().unwrap(),
        header["n"].as_u64().unwrap() as usize,
    );
    let count = n * n;
    let data = &body[4 + header_len..];
    assert_eq!(data.len(), count * 17, "raster size");
    let floats = |k: usize| -> Vec<f32> {
        data[k * count * 4..(k + 1) * count * 4]
            .as_chunks::<4>()
            .0
            .iter()
            .map(|b| f32::from_le_bytes(*b))
            .collect()
    };
    let (height, level, widths) = (floats(0), floats(1), floats(2));
    let ids: Vec<i32> = data[3 * count * 4..4 * count * 4]
        .as_chunks::<4>()
        .0
        .iter()
        .map(|b| i32::from_le_bytes(*b))
        .collect();
    let water = &data[4 * count * 4..];
    let raster = || Raster {
        width,
        n,
        height: &height,
        water,
        water_level: &level,
        river_width: &widths,
        river_ids: &ids,
    };
    let t = Instant::now();
    let terrain = Terrain::new(raster()).unwrap();
    println!(
        "raster {n}² fields {:>8.1} ms",
        t.elapsed().as_secs_f64() * 1e3
    );
    let seed = request["seed"].as_str().unwrap();
    let mut hash = 0xcbf29ce484222325_u64;
    let mut sites: Vec<RoadSite> = request
        .get("sites")
        .filter(|v| !v.is_null())
        .map(|v| serde_json::from_value(v.clone()).unwrap())
        .unwrap_or_default();
    if let Some(place) = request.get("place").filter(|v| !v.is_null()) {
        let cfg: Config = serde_json::from_value(place.clone()).unwrap();
        let t = Instant::now();
        let placed = terrain.place(seed, &cfg).unwrap();
        println!(
            "place  {:>8.1} ms ({} settlements)",
            t.elapsed().as_secs_f64() * 1e3,
            placed.settlements.len()
        );
        fnv(
            &mut hash,
            serde_json::to_string(&placed).unwrap().as_bytes(),
        );
        sites = placed
            .settlements
            .iter()
            .map(|s| RoadSite {
                key: s.spec.key.clone(),
                population: s.spec.population,
                culture: s.spec.culture.clone(),
                center: s.center,
                radius: s.radius,
            })
            .collect();
    }
    let cfg: RoadConfig = serde_json::from_value(request["roads"].clone()).unwrap();
    for _ in 0..repeats {
        let t = Instant::now();
        let roads = terrain.roads(seed, &sites, &cfg).unwrap();
        println!(
            "roads  {:>8.1} ms ({} sites, {} segments)",
            t.elapsed().as_secs_f64() * 1e3,
            sites.len(),
            roads.segments.len()
        );
        fnv(&mut hash, serde_json::to_string(&roads).unwrap().as_bytes());
    }
    println!("hash {hash:016x}");
}
