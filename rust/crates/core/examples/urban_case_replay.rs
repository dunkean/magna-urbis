//! Replay a captured urban request with its real raster, without starting a server.
//! Args: fixture.json output-directory. The fixture contains the request fields,
//! n/width/height/water/waterLevel, optional vector geography and parcelConfig.
use magna_urbis_core::urban::{
    Geography, LayoutConfig, ParcelConfig, Site, Street, Surface, VectorGeography,
    building_sites::BuildingSiteIndex, generate_parcels, generate_quarters,
};
use serde::Deserialize;
use std::{path::PathBuf, time::Instant};

#[derive(Deserialize)]
#[serde(rename_all = "camelCase")]
struct Fixture {
    seed: String,
    n: usize,
    width: f64,
    height: Vec<f32>,
    water: Vec<u8>,
    water_level: Vec<f32>,
    geometry: Option<VectorGeography>,
    sites: Vec<Site>,
    roads: Vec<Street>,
    layout_config: LayoutConfig,
    #[serde(default)]
    parcel_config: ParcelConfig,
}

fn main() -> Result<(), Box<dyn std::error::Error>> {
    let args: Vec<_> = std::env::args().collect();
    if args.len() != 3 {
        return Err("Expected fixture.json output-directory".into());
    }
    let f: Fixture = serde_json::from_slice(&std::fs::read(&args[1])?)?;
    let size = f.n.checked_mul(f.n).ok_or("Invalid raster dimensions")?;
    if f.n == 0 || !f.width.is_finite() || f.width <= 0.
        || f.height.len() != size || f.water.len() != size || f.water_level.len() != size {
        return Err("Invalid raster dimensions or sample counts".into());
    }
    let geography = f.geometry.map(|g| Geography::new(g, f.width)).transpose()?;
    let surface = Surface { geometry: geography.as_ref(), width: f.width, n: f.n, height: &f.height, water: &f.water };
    let start = Instant::now();
    let layouts = generate_quarters(&f.seed, &f.sites, &f.layout_config, surface, &f.roads)?;
    let quarters_ms = start.elapsed().as_secs_f64() * 1000.;
    let start = Instant::now();
    let partitions = generate_parcels(&f.seed, &layouts, &f.parcel_config)?;
    let parcels_ms = start.elapsed().as_secs_f64() * 1000.;
    let selected: Vec<_> = (0..layouts.len()).collect();
    let sites_start = Instant::now();
    let mut index = BuildingSiteIndex::prepare(&layouts, &partitions, &selected)?;
    let mut requests = Vec::new();
    loop {
        let page = index.page(&f.seed, &layouts, &partitions, surface, &f.water_level, None,
            requests.len(), 64, 24 * 1024 * 1024)?;
        let total = page.total;
        if page.requests.is_empty() && requests.len() < total { return Err("Empty incomplete page".into()); }
        requests.extend(page.requests);
        if requests.len() == total { break; }
    }
    let sites_ms = sites_start.elapsed().as_secs_f64() * 1000.;
    let out = PathBuf::from(&args[2]);
    std::fs::create_dir_all(&out)?;
    for (name, value) in [
        ("layouts.json", serde_json::to_value(&layouts)?),
        ("partitions.json", serde_json::to_value(&partitions)?),
        ("requests.json", serde_json::to_value(&requests)?),
    ] { std::fs::write(out.join(name), serde_json::to_vec(&value)?)?; }
    let metrics = serde_json::json!({"quartersMs":quarters_ms,"parcelsMs":parcels_ms,"sitesMs":sites_ms,
        "sites":requests.len(),"blocks":layouts.iter().map(|l|l.blocks.len()).sum::<usize>(),
        "quays":layouts.iter().flat_map(|l|&l.streets).filter(|s|s.role=="quay").count()});
    std::fs::write(out.join("metrics.json"), serde_json::to_vec_pretty(&metrics)?)?;
    println!("{metrics}");
    Ok(())
}
