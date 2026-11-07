//! Replays one captured V2 regional request (native `/raster` body + `/settlements` JSON body),
//! printing ms per phase and an FNV-1a hash of the serialised outputs (must not change when the
//! code is optimised). Capture: web/out/perf-2026-11-07/settlements/capture.mjs.
//!
//! `cargo run --release -p magna-urbis-core --example settlements_replay -- <raster.bin> <settlements.json|-> [repeats]`
//! With `-` instead of the settlements body, only the `/raster` parse is replayed (phase breakdown,
//! including the optional vector geography of the city-lane rasters).
use magna_urbis_core::settlements::{self, roads::RoadConfig, Config, Raster, Terrain};
use serde::Deserialize;
use std::time::Instant;

#[derive(Deserialize)]
#[serde(rename_all = "camelCase")]
struct Header {
    width: f64,
    n: usize,
    physical_n: Option<usize>,
    physical_interpolation: Option<String>,
    physical_floor: Option<f32>,
    region: Option<magna_urbis_core::resources::RegionInput>,
}
#[derive(Deserialize)]
struct GeometryHeader {
    geometry: Option<magna_urbis_core::urban::VectorGeography>,
}

fn fnv(h: &mut u64, bytes: &[u8]) {
    for &b in bytes {
        *h ^= b as u64;
        *h = h.wrapping_mul(0x100000001b3);
    }
}

fn main() {
    let args: Vec<String> = std::env::args().collect();
    let body = std::fs::read(&args[1]).unwrap();
    let repeats: usize = args.get(3).and_then(|s| s.parse().ok()).unwrap_or(1);
    let header_len = u32::from_le_bytes(body[..4].try_into().unwrap()) as usize;
    let header: Header = serde_json::from_slice(&body[4..4 + header_len]).unwrap();
    if args[2] == "-" {
        raster_only(&body, header_len, &header, repeats);
        return;
    }
    let input: serde_json::Value = serde_json::from_slice(&std::fs::read(&args[2]).unwrap()).unwrap();
    let data = &body[4 + header_len..];
    let count = header.n * header.n;
    let f32s = |bytes: &[u8]| -> Vec<f32> { bytes.chunks_exact(4).map(|b| f32::from_le_bytes(b.try_into().unwrap())).collect() };
    let height = f32s(&data[..count * 4]);
    let water_level = f32s(&data[count * 4..2 * count * 4]);
    let river_width = f32s(&data[2 * count * 4..3 * count * 4]);
    let river_ids: Vec<i32> = data[3 * count * 4..4 * count * 4]
        .chunks_exact(4)
        .map(|b| i32::from_le_bytes(b.try_into().unwrap()))
        .collect();
    let water = &data[4 * count * 4..17 * count];
    let seed = input["seed"].as_str().unwrap();
    let place: Config = serde_json::from_value(input["place"].clone()).unwrap();
    let road_cfg: RoadConfig = serde_json::from_value(input["roads"].clone()).unwrap();
    for rep in 0..repeats {
        let t = Instant::now();
        let mut terrain = Terrain::new(Raster {
            width: header.width,
            n: header.n,
            height: &height,
            water,
            water_level: &water_level,
            river_width: &river_width,
            river_ids: &river_ids,
        })
        .unwrap();
        if let Some(n) = header.physical_n {
            let physical = f32s(&data[17 * count..]);
            match header.physical_interpolation.as_deref() {
                Some("bspline") => terrain.set_physical_spline(n, physical, header.physical_floor.unwrap_or(0.0)).unwrap(),
                _ => terrain.set_physical_height(n, physical).unwrap(),
            }
        }
        if let Some(region) = header.region.clone() {
            terrain.set_region(region);
        }
        let fields_ms = t.elapsed().as_secs_f64() * 1e3;
        let t = Instant::now();
        let placed: settlements::Output = terrain.place(seed, &place).unwrap();
        let place_ms = t.elapsed().as_secs_f64() * 1e3;
        let sites = placed.road_sites();
        let t = Instant::now();
        let roads = terrain.roads(seed, &sites, &road_cfg).unwrap();
        let roads_ms = t.elapsed().as_secs_f64() * 1e3;
        let mut hash = 0xcbf29ce484222325_u64;
        fnv(&mut hash, serde_json::to_string(&placed).unwrap().as_bytes());
        let place_hash = hash;
        fnv(&mut hash, serde_json::to_string(&roads).unwrap().as_bytes());
        println!(
            "rep {rep} fields {fields_ms:>7.1} ms  place {place_ms:>7.1} ms ({} settlements, {} activities)  roads {roads_ms:>7.1} ms ({} segments)  place-hash {place_hash:016x} hash {hash:016x}",
            placed.settlements.len(),
            placed.activities.len(),
            roads.segments.len()
        );
        if rep + 1 == repeats {
            if let Ok(out) = std::env::var("REPLAY_OUT") {
                std::fs::write(out, serde_json::to_string(&serde_json::json!({"settlements": placed, "roads": roads})).unwrap()).unwrap();
            }
        }
    }
}

/// Phases of the native `/raster` handler: header JSON (with geometry), planes, fields,
/// physical surface, vector geography.
fn raster_only(body: &[u8], header_len: usize, header: &Header, repeats: usize) {
    let ms = |t: Instant| t.elapsed().as_secs_f64() * 1e3;
    for rep in 0..repeats {
        let t = Instant::now();
        let geometry: GeometryHeader = serde_json::from_slice(&body[4..4 + header_len]).unwrap();
        let json_ms = ms(t);
        let t = Instant::now();
        let data = &body[4 + header_len..];
        let count = header.n * header.n;
        let f32s = |bytes: &[u8]| -> Vec<f32> { bytes.chunks_exact(4).map(|b| f32::from_le_bytes(b.try_into().unwrap())).collect() };
        let height = f32s(&data[..count * 4]);
        let water_level = f32s(&data[count * 4..2 * count * 4]);
        let river_width = f32s(&data[2 * count * 4..3 * count * 4]);
        let river_ids: Vec<i32> = data[3 * count * 4..4 * count * 4]
            .chunks_exact(4)
            .map(|b| i32::from_le_bytes(b.try_into().unwrap()))
            .collect();
        let water = &data[4 * count * 4..17 * count];
        let physical = header.physical_n.map(|_| f32s(&data[17 * count..]));
        let planes_ms = ms(t);
        let t = Instant::now();
        let mut terrain = Terrain::new(Raster {
            width: header.width,
            n: header.n,
            height: &height,
            water,
            water_level: &water_level,
            river_width: &river_width,
            river_ids: &river_ids,
        })
        .unwrap();
        let fields_ms = ms(t);
        let t = Instant::now();
        if let (Some(n), Some(physical)) = (header.physical_n, physical) {
            match header.physical_interpolation.as_deref() {
                Some("bspline") => terrain.set_physical_spline(n, physical, header.physical_floor.unwrap_or(0.0)).unwrap(),
                _ => terrain.set_physical_height(n, physical).unwrap(),
            }
        }
        let physical_ms = ms(t);
        let shapes = geometry.geometry.as_ref().map(|g| (g.land.len(), g.water.len()));
        let t = Instant::now();
        if let Some(g) = geometry.geometry {
            terrain.set_urban_geometry(g).unwrap();
        }
        let geometry_ms = ms(t);
        println!(
            "rep {rep} raster: header-json {json_ms:>6.1} ms  planes {planes_ms:>6.1} ms  fields {fields_ms:>6.1} ms  physical {physical_ms:>6.1} ms  geometry {geometry_ms:>6.1} ms (rings {shapes:?})"
        );
    }
}
