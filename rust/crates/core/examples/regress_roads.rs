//! City Bench road network for a decor and one site, as the bench requests it before
//! the quarters: `regress_roads <raster.bin> <request.json> <out.json>` (roads_replay's
//! raster format; request = {seed, sites, roads}). Writes the road output JSON.
use magna_urbis_core::settlements::roads::{RoadConfig, RoadSite};
use magna_urbis_core::settlements::{Raster, Terrain};
use serde_json::Value;

fn main() {
    let args: Vec<String> = std::env::args().collect();
    let body = std::fs::read(&args[1]).expect("raster.bin");
    let request: Value = serde_json::from_slice(&std::fs::read(&args[2]).expect("request.json")).unwrap();
    let header_len = u32::from_le_bytes(body[..4].try_into().unwrap()) as usize;
    let header: Value = serde_json::from_slice(&body[4..4 + header_len]).unwrap();
    let (width, n) = (header["width"].as_f64().unwrap(), header["n"].as_u64().unwrap() as usize);
    let count = n * n;
    let data = &body[4 + header_len..];
    let floats = |k: usize| -> Vec<f32> { data[k * count * 4..(k + 1) * count * 4].as_chunks::<4>().0.iter().map(|b| f32::from_le_bytes(*b)).collect() };
    let (height, level, widths) = (floats(0), floats(1), floats(2));
    let ids: Vec<i32> = data[3 * count * 4..4 * count * 4].as_chunks::<4>().0.iter().map(|b| i32::from_le_bytes(*b)).collect();
    let water = &data[4 * count * 4..];
    let terrain = Terrain::new(Raster { width, n, height: &height, water, water_level: &level, river_width: &widths, river_ids: &ids }).unwrap();
    let sites: Vec<RoadSite> = serde_json::from_value(request["sites"].clone()).unwrap();
    let cfg: RoadConfig = serde_json::from_value(request["roads"].clone()).unwrap();
    let roads = terrain.roads(request["seed"].as_str().unwrap(), &sites, &cfg).unwrap();
    std::fs::write(&args[3], serde_json::to_vec(&roads).unwrap()).unwrap();
    println!("{} segments", roads.segments.len());
}
