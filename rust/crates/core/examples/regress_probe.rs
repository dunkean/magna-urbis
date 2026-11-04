//! Before/after witness on a captured City Bench case: `regress_probe <case.json> <out-stem>`.
//! Writes <stem>.json (layouts, partitions) and <stem>-requests.json; prints lot/built counts.
//! CULTURE, POPULATION, CAMPGROWTH override the fixture (same code compiles at HEAD).
use magna_urbis_core::urban::{Geography, LayoutConfig, ParcelConfig, Site, Street, Surface, VectorGeography, building_sites, generate_parcels, generate_quarters};
use serde::Deserialize;
use std::collections::HashSet;

#[derive(Deserialize)]
#[serde(rename_all = "camelCase")]
struct Fixture { seed: String, n: usize, width: f64, height: Vec<f32>, water: Vec<u8>, #[serde(default)] water_level: Vec<f32>, geometry: Option<VectorGeography>, sites: Vec<Site>, roads: Vec<Street>, layout_config: LayoutConfig, #[serde(default)] parcel_config: ParcelConfig }

fn main() -> Result<(), Box<dyn std::error::Error>> {
    let args: Vec<_> = std::env::args().collect();
    let mut f: Fixture = serde_json::from_slice(&std::fs::read(&args[1])?)?;
    if let Ok(culture) = std::env::var("CULTURE") { for site in &mut f.sites { site.culture = culture.clone(); } }
    if let Ok(population) = std::env::var("POPULATION") { for site in &mut f.sites { site.population = population.parse()?; } }
    if let Ok(v) = std::env::var("CAMPGROWTH") { f.layout_config.camp_growth = v; }
    let geography = f.geometry.map(|g| Geography::new(g, f.width)).transpose()?;
    let surface = Surface { geometry: geography.as_ref(), width: f.width, n: f.n, height: &f.height, water: &f.water };
    let clock = std::time::Instant::now();
    let layouts = generate_quarters(&f.seed, &f.sites, &f.layout_config, surface, &f.roads)?;
    let partitions = generate_parcels(&f.seed, &layouts, &f.parcel_config)?;
    let level = if f.water_level.is_empty() { vec![0.0; f.height.len()] } else { f.water_level.clone() };
    let requests = building_sites::requests(&f.seed, &layouts, &partitions, surface, &level, None)?;
    let secs = clock.elapsed().as_secs_f64();
    if let Some(stem) = args.get(2) {
        std::fs::write(format!("{stem}.json"), serde_json::to_vec(&(&layouts, &partitions))?)?;
        std::fs::write(format!("{stem}-requests.json"), serde_json::to_vec(&requests)?)?;
    }
    let built: HashSet<&str> = requests.iter().filter(|r| r["preview"].as_array().is_some_and(|p| !p.is_empty())).filter_map(|r| r["parcel_id"].as_str()).collect();
    let mut uses = std::collections::BTreeMap::new();
    for p in &partitions[0].parcels { *uses.entry(p.use_kind.as_str()).or_insert(0) += 1; }
    let lots: Vec<_> = partitions[0].parcels.iter().filter(|p| matches!(p.use_kind.as_str(), "plot" | "compound")).collect();
    let empty = lots.iter().filter(|p| !built.contains(p.id.as_str())).count();
    println!("lots {} · built {} · empty {} · requests {} · blocks {} · streets {} · {:.1} s · uses {uses:?}", lots.len(), lots.len() - empty, empty, requests.len(), layouts[0].blocks.len(), layouts[0].streets.len(), secs);
    for w in partitions[0].warnings.iter().chain(&layouts[0].warnings) { eprintln!("warn: {w}"); }
    Ok(())
}
