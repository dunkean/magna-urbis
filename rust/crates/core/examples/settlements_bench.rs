//! Generates settlements + roads on a deterministic synthetic terrain, printing ms per phase and
//! an FNV-1a hash of the serialised outputs (must not change when the code is optimised).
//!
//! `cargo run --release -p magna-urbis-core --example settlements_bench -- [n]`
use magna_urbis_core::settlements::roads::{RoadConfig, RoadSite};
use magna_urbis_core::settlements::{Config, Raster, Terrain};
use std::time::Instant;

const WIDTH: f64 = 16000.0;

fn fnv(h: &mut u64, bytes: &[u8]) {
    for &b in bytes {
        *h ^= b as u64;
        *h = h.wrapping_mul(0x100000001b3);
    }
}

fn main() {
    let n: usize = std::env::args()
        .nth(1)
        .and_then(|s| s.parse().ok())
        .unwrap_or(384);
    let cell = WIDTH / n as f64;
    let mut height = vec![0f32; n * n];
    let mut water = vec![0u8; n * n];
    let mut level = vec![0f32; n * n];
    let mut widths = vec![0f32; n * n];
    let mut ids = vec![-1i32; n * n];
    for y in 0..n {
        for x in 0..n {
            let (px, py) = ((x as f64 + 0.5) * cell, (y as f64 + 0.5) * cell);
            let h = 60.0
                + 25.0 * (px / 1700.0).sin() * (py / 2300.0).cos()
                + 12.0 * (px / 610.0 + py / 830.0).sin();
            height[y * n + x] = h as f32;
            level[y * n + x] = h as f32;
        }
    }
    for y in 0..n {
        let py = (y as f64 + 0.5) * cell;
        let cx = 0.55 * WIDTH + 900.0 * (py / 2100.0).sin();
        for x in 0..n {
            let px = (x as f64 + 0.5) * cell;
            let i = y * n + x;
            if (px - cx).abs() < 22.0 {
                water[i] = 3;
                widths[i] = 12.0;
                ids[i] = 0;
                level[i] = height[i] - 1.0;
            }
            let d = ((px - 0.2 * WIDTH).powi(2) + (py - 0.3 * WIDTH).powi(2)).sqrt();
            if d < 700.0 {
                water[i] = 2;
                level[i] = height[i] + 2.0;
            }
        }
    }
    let raster = || Raster {
        width: WIDTH,
        n,
        height: &height,
        water: &water,
        water_level: &level,
        river_width: &widths,
        river_ids: &ids,
    };
    drop(Terrain::new(raster()).unwrap()); // warm the thread pool
    let t0 = Instant::now();
    let terrain = Terrain::new(raster()).unwrap();
    println!("fields   {:>8.1} ms", t0.elapsed().as_secs_f64() * 1e3);
    let mut cfg = Config {
        distribution: "zipf".into(),
        density: 2.0,
        relief: "hills".into(),
        ..Default::default()
    };
    cfg.main.population = 12000;
    let mut hash = 0xcbf29ce484222325_u64;
    let t = Instant::now();
    let placed = terrain.place("bench", &cfg).unwrap();
    println!(
        "place    {:>8.1} ms ({} settlements)",
        t.elapsed().as_secs_f64() * 1e3,
        placed.settlements.len()
    );
    fnv(&mut hash, serde_json::to_string(&placed).unwrap().as_bytes());
    let sites: Vec<RoadSite> =
        serde_json::from_str(&serde_json::to_string(&placed.settlements).unwrap()).unwrap();
    for (level, density) in [("rural", 0.5), ("imperial", 1.0)] {
        let rc = RoadConfig {
            level: level.into(),
            density,
            ..Default::default()
        };
        let t = Instant::now();
        let roads = terrain.roads("bench", &sites, &rc).unwrap();
        println!(
            "roads {level:<8} {:>8.1} ms ({} segments)",
            t.elapsed().as_secs_f64() * 1e3,
            roads.segments.len()
        );
        fnv(&mut hash, serde_json::to_string(&roads).unwrap().as_bytes());
    }
    println!("hash {hash:016x}");
}
