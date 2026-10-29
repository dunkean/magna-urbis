//! Reproducible regional source and hydrology probe; no renderer or neural model.
//! cargo run --release -p magna-urbis-core --example terrain_literature_probe -- OUT [N] [WIDTH] [RELIEF] [SEED]
//! Optional final argument: existing square little-endian FP32 heightfield.
use magna_urbis_core::{HydrologyConfig, HydrologyEngine, TerrainGenerator};
use serde_json::json;
use std::{fs, path::PathBuf, time::Instant};

fn main() -> Result<(), Box<dyn std::error::Error>> {
    let args: Vec<String> = std::env::args().collect();
    let out = PathBuf::from(args.get(1).ok_or("missing output directory")?);
    let n: usize = args.get(2).map_or(Ok(512), |s| s.parse())?;
    let width: f64 = args.get(3).map_or(Ok(50_000.), |s| s.parse())?;
    let relief = args.get(4).map_or("mountains", String::as_str);
    let seed = args.get(5).map_or("literature-2026-10-29", String::as_str);
    fs::create_dir_all(&out)?;
    let start = Instant::now();
    let height = if let Some(input) = args.get(6) {
        let bytes = fs::read(input)?;
        if bytes.len() != n * n * 4 { return Err("input dimensions do not match".into()); }
        bytes.chunks_exact(4).map(|b| f32::from_le_bytes(b.try_into().unwrap())).collect::<Vec<_>>()
    } else {
        let terrain = TerrainGenerator::new(seed, width, relief, 1., 8000.)?;
        terrain.sample_region(0., 0., width, n)?.height
    };
    let source_ms = start.elapsed().as_secs_f64() * 1000.;
    if height.len() != n*n || height.iter().any(|v| !v.is_finite()) { return Err("invalid source".into()); }
    let bytes: Vec<u8> = height.iter().flat_map(|v| v.to_le_bytes()).collect();
    fs::write(out.join("height.f32"), bytes)?;
    let start = Instant::now();
    let engine = HydrologyEngine::new(seed, width, n, &height, height.iter().any(|&v| v <= 0.))?;
    let preparation_ms = start.elapsed().as_secs_f64()*1000.;
    let mut cases = Vec::new();
    for (climate, temperature, precipitation) in [("temperate", 12., 1000.), ("arid", 25., 150.), ("humid", 24., 2200.)] {
        let cfg = HydrologyConfig { temperature, precipitation, ..HydrologyConfig::default() };
        let start = Instant::now();
        match engine.generate(&cfg) {
            Err(error) => cases.push(json!({"climate":climate,"error":error,"ms":start.elapsed().as_secs_f64()*1000.})),
            Ok(result) => {
                let ms = start.elapsed().as_secs_f64()*1000.;
                let delta: Vec<f64> = result.adjusted_height.iter().zip(&height).map(|(a,b)| f64::from(a-b)).collect();
                let rms = (delta.iter().map(|v| v*v).sum::<f64>() / delta.len().max(1) as f64).sqrt();
                let changed = delta.iter().filter(|v| v.abs() > 0.01).count();
                cases.push(json!({"climate":climate,"temperatureC":temperature,"precipitationMmYear":precipitation,
                    "ms":ms,"rivers":result.river_offsets.len().saturating_sub(1),"lakes":result.lake_meta.len()/6,
                    "adjustedSamples":delta.len(),"adjustmentRmsM":rms,"adjustedOver1cmFraction":changed as f64/(n*n) as f64,
                    "maxAdjustmentM":delta.iter().map(|v|v.abs()).fold(0.,f64::max),
                    "finite":result.adjusted_height.iter().chain(&result.river_points).all(|v|v.is_finite())}));
            }
        }
    }
    let report = json!({"format":"magna-terrain-literature-probe-v1","seed":seed,"relief":relief,"n":n,"widthM":width,
        "source":if args.get(6).is_some(){"imported-f32"}else{"Magna TerrainGenerator, erosion=1, motif=8000m"},
        "sourceMs":source_ms,"hydrologyPreparationMs":preparation_ms,"cases":cases});
    fs::write(out.join("report.json"),serde_json::to_string_pretty(&report)?)?;
    println!("{}",serde_json::to_string_pretty(&report)?);
    Ok(())
}
