//! Village massing probe: fixture.json -> floors histogram and footprint area (median/p90) by block zone.
use magna_urbis_core::urban::{Geography, LayoutConfig, ParcelConfig, Point, Site, Street, Surface, VectorGeography, building_sites, generate_parcels, generate_quarters};
use serde::Deserialize;
use serde_json::Value;
use std::collections::BTreeMap;

#[derive(Deserialize)]
#[serde(rename_all = "camelCase")]
struct Fixture { seed: String, n: usize, width: f64, height: Vec<f32>, water: Vec<u8>, water_level: Vec<f32>, geometry: Option<VectorGeography>, sites: Vec<Site>, roads: Vec<Street>, layout_config: LayoutConfig, #[serde(default)] parcel_config: ParcelConfig }
fn ring_area(r: &[Point]) -> f64 { (0..r.len()).map(|i| { let (a, b) = (r[i], r[(i + 1) % r.len()]); a.x * b.y - b.x * a.y }).sum::<f64>().abs() / 2.0 }
fn pts(v: &Value) -> Vec<Point> { v.as_array().map(|a| a.iter().map(|p| Point { x: p["x"].as_f64().unwrap_or(0.), y: p["y"].as_f64().unwrap_or(0.) }).collect()).unwrap_or_default() }
fn inside(r: &[Point], p: Point) -> bool { let mut c = false; let mut j = r.len().wrapping_sub(1); for i in 0..r.len() { if (r[i].y > p.y) != (r[j].y > p.y) && p.x < (r[j].x - r[i].x) * (p.y - r[i].y) / (r[j].y - r[i].y) + r[i].x { c = !c; } j = i; } c }

fn main() -> Result<(), Box<dyn std::error::Error>> {
    let args: Vec<_> = std::env::args().collect();
    let f: Fixture = serde_json::from_slice(&std::fs::read(&args[1])?)?;
    let geography = f.geometry.map(|g| Geography::new(g, f.width)).transpose()?;
    let surface = Surface { geometry: geography.as_ref(), width: f.width, n: f.n, height: &f.height, water: &f.water };
    let layouts = generate_quarters(&f.seed, &f.sites, &f.layout_config, surface, &f.roads)?;
    let partitions = generate_parcels(&f.seed, &layouts, &f.parcel_config)?;
    let requests = building_sites::requests(&f.seed, &layouts, &partitions, surface, &f.water_level, None)?;
    let l = &layouts[0];
    let mut by: BTreeMap<String, (Vec<f64>, BTreeMap<u64, usize>)> = BTreeMap::new();
    for r in &requests {
        let prog = &r["programme"];
        if !prog["role"].as_str().unwrap_or("").starts_with("dwelling") || prog["landmark"].as_bool().unwrap_or(false) { continue; }
        let prev = r["preview"].as_array().cloned().unwrap_or_default(); let parts = r["preview_parts"].as_array().cloned().unwrap_or_default();
        let mass = prog["massing"].as_array().cloned().unwrap_or_default();
        let (mut mi, mut ma) = (None, 0.);
        for (i, s) in prev.iter().enumerate() { let a = ring_area(&pts(&s["outer"])); if parts.get(i).and_then(|p| p.as_str()).unwrap_or("building") == "building" && a > ma { ma = a; mi = Some(i); } }
        let Some(mi) = mi else { continue };
        let o = pts(&prev[mi]["outer"]); let c = Point { x: o.iter().map(|p| p.x).sum::<f64>() / o.len() as f64, y: o.iter().map(|p| p.y).sum::<f64>() / o.len() as f64 };
        let zone = l.blocks.iter().find(|b| inside(&b.shape.outer, c)).map_or("none".to_string(), |b| b.zone.clone());
        let fl = mass.get(mi).and_then(|m| m["floors"].as_u64()).or_else(|| prog["floors"][0].as_u64()).unwrap_or(1);
        let e = by.entry(zone).or_default(); e.0.push(ma); *e.1.entry(fl).or_default() += 1;
    }
    println!("{} pop={}", l.culture, f.sites[0].population);
    for (z, (mut a, h)) in by { a.sort_by(f64::total_cmp); let n = a.len(); println!("{z:>10} n={n:>4} median={:>5.0} p90={:>5.0} floors={h:?}", a[n / 2], a[(n as f64 * 0.9) as usize]); }
    Ok(())
}
