//! Native hydrology timing: procedural relief, then per-stage generation times.
//! cargo run --release -p magna-urbis-core --example hydrology_bench -- [n] [relief] [coast] [heights.f32] [width] [sea 0/1]
//! SEED overrides the seed; CHECK_CACHE=1 compares reused and fresh engines.
use magna_urbis_core::{HydrologyConfig, HydrologyEngine, TerrainGenerator};
use std::time::Instant;

fn main() {
    let args: Vec<String> = std::env::args().collect();
    let n: usize = args.get(1).and_then(|s| s.parse().ok()).unwrap_or(512);
    let relief = args.get(2).map_or("hills", String::as_str);
    let coast: u32 = args.get(3).and_then(|s| s.parse().ok()).unwrap_or(4);
    let width: f64 = args.get(5).and_then(|s| s.parse().ok()).unwrap_or(40_000.0);
    let seed = std::env::var("SEED").unwrap_or_else(|_| "bench".into());
    let seed = seed.as_str();
    let height: Vec<f32> = if let Some(path) = args.get(4) {
        let bytes = std::fs::read(path).unwrap();
        bytes
            .as_chunks::<4>()
            .0
            .iter()
            .map(|&b| f32::from_le_bytes(b))
            .collect()
    } else {
        let mut terrain = TerrainGenerator::new(seed, width, relief, 1.0, 8000.0).unwrap();
        if coast != 0 {
            terrain.set_coast(coast, "island").unwrap();
        }
        terrain.sample_region(0.0, 0.0, width, n).unwrap().height
    };
    let n = (height.len() as f64).sqrt() as usize;
    let sea = args
        .get(6)
        .map_or_else(|| height.iter().any(|&h| h <= 0.0), |s| s == "1");
    let start = Instant::now();
    let engine = HydrologyEngine::new(seed, width, n, &height, sea).unwrap();
    println!("n={n} sea={sea} drain(new): {:.1} ms", ms(start));
    if std::env::var("CHECK_CACHE").is_ok() {
        check_cache(seed, width, n, &height, sea);
        return;
    }
    for (lakes, temperature, precipitation) in [
        ("auto", 18.0, 1000.0),
        ("auto", 23.0, 150.0),
        ("auto", 11.0, 1300.0),
        ("some", 18.0, 1000.0),
    ] {
        let cfg = HydrologyConfig {
            lakes: lakes.into(),
            temperature,
            precipitation,
            ..HydrologyConfig::default()
        };
        let lakes = format!("{lakes} {temperature} °C {precipitation} mm");
        let mut previous = Instant::now();
        let total = Instant::now();
        let mut stages = Vec::new();
        let output = match engine.generate_profiled(&cfg, &mut |label| {
            stages.push((label, ms(previous)));
            previous = Instant::now();
        }) {
            Ok(output) => output,
            Err(error) => {
                println!("lakes={lakes}: error after {:.1} ms: {error}", ms(total));
                continue;
            }
        };
        let mut hash = 0xcbf29ce484222325_u64;
        for v in output
            .river_points
            .iter()
            .chain(&output.lake_points)
            .chain(&output.adjusted_height)
        {
            for byte in v.to_bits().to_le_bytes() {
                hash = (hash ^ u64::from(byte)).wrapping_mul(0x100000001b3);
            }
        }
        println!(
            "lakes={lakes}: total {:.1} ms · rivers {} · lakes {} ({} closed) · hash {hash:016x}",
            ms(total),
            output.river_offsets.len() - 1,
            output.lake_meta.len() / 6,
            output.lake_closed.iter().filter(|&&c| c == 1).count()
        );
        for (label, t) in stages {
            if t >= 1.0 {
                println!("  {label:<22} {t:8.1} ms");
            }
        }
    }
}

/// Reused-engine generations must equal fresh-engine ones (stage cache).
fn check_cache(seed: &str, width: f64, n: usize, height: &[f32], sea: bool) {
    let configs = [
        HydrologyConfig::default(),
        HydrologyConfig {
            meander_intensity: 0.5,
            density: 1.5,
            ..HydrologyConfig::default()
        },
        HydrologyConfig {
            incision: 1.5,
            ..HydrologyConfig::default()
        },
        HydrologyConfig {
            lakes: "some".into(),
            ..HydrologyConfig::default()
        },
        HydrologyConfig {
            max_breach_depth: 4.0,
            ..HydrologyConfig::default()
        },
        HydrologyConfig::default(),
    ];
    let reused = HydrologyEngine::new(seed, width, n, height, sea).unwrap();
    for (k, cfg) in configs.iter().enumerate() {
        let start = Instant::now();
        let a = reused.generate(cfg).map(|o| fingerprint(&o));
        let warm = ms(start);
        let fresh = HydrologyEngine::new(seed, width, n, height, sea).unwrap();
        let start = Instant::now();
        let b = fresh.generate(cfg).map(|o| fingerprint(&o));
        let cold = ms(start);
        println!(
            "cache {k}: {} · reused {warm:.0} ms · fresh {cold:.0} ms",
            if a == b { "same" } else { "DIFFERENT" }
        );
    }
}

fn fingerprint(output: &magna_urbis_core::HydrologyOutput) -> u64 {
    let mut hash = 0xcbf29ce484222325_u64;
    let floats = [
        &output.river_points,
        &output.lake_points,
        &output.adjusted_height,
        &output.filled,
        &output.lake_depth,
        &output.accumulation,
        &output.surface_height,
        &output.node_points,
        &output.lake_meta,
    ];
    let ints = [
        &output.receivers,
        &output.basins,
        &output.flat_labels,
        &output.flat_rank,
        &output.lake_labels,
        &output.river_meta,
        &output.river_offsets,
        &output.node_meta,
    ];
    for v in floats
        .into_iter()
        .flatten()
        .map(|v| v.to_bits())
        .chain(ints.into_iter().flatten().copied())
    {
        hash = (hash ^ u64::from(v)).wrapping_mul(0x100000001b3);
    }
    hash ^ u64::from(output.breach_count)
}

fn ms(t: Instant) -> f64 {
    t.elapsed().as_secs_f64() * 1000.0
}
