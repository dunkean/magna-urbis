//! Lot occupancy witness on a captured City Bench case: `lot_probe <case.json>`.
//! Counts built-up lots (plots and compounds) with and without a building preview.
//! OFF=a,b… turns switches off: width, main, polish, houses (all: every one).
use magna_urbis_core::urban::{Geography, LayoutConfig, ParcelConfig, Site, Street, Surface, VectorGeography, building_sites, generate_parcels, generate_quarters};
use serde::Deserialize;
use std::collections::HashSet;

#[derive(Deserialize)]
#[serde(rename_all = "camelCase")]
struct Fixture { seed: String, n: usize, width: f64, height: Vec<f32>, water: Vec<u8>, #[serde(default)] water_level: Vec<f32>, geometry: Option<VectorGeography>, sites: Vec<Site>, roads: Vec<Street>, layout_config: LayoutConfig, #[serde(default)] parcel_config: ParcelConfig }

fn main() -> Result<(), Box<dyn std::error::Error>> {
    let args: Vec<_> = std::env::args().collect();
    let mut f: Fixture = serde_json::from_slice(&std::fs::read(&args[1])?)?;
    let off = std::env::var("OFF").unwrap_or_default();
    let has = |k: &str| off.split(',').any(|x| x == k || x == "all");
    let c = &mut f.layout_config;
    if has("width") { c.road_width_by_size = false; }
    if has("main") { c.town_main_road = false; }
    if has("polish") { c.polish_road_ends = false; }
    if has("houses") { c.low_rural_houses = false; }
    // NEW=1: the switches still under test (off by default).
    if std::env::var("NEW").is_ok() { c.road_mouths = true; c.road_remnants = true; c.road_end_joins = true; c.small_place_capacity = true; }
    if let Ok(v) = std::env::var("CAMPGROWTH") { c.camp_growth = v; }
    if let Some(v) = std::env::var("PM").ok().and_then(|v| v.parse().ok()) { c.parallel_merge = v; }
    if let Some(v) = std::env::var("ROADSV7").ok().and_then(|v|v.parse::<f64>().ok()) {
        let c = &mut f.layout_config;
        c.street_frontage = v > 0.0; c.align_enclosed_grid = v > 0.0; c.hide_unused_quarters = v > 0.0;
        c.organic_branch_variation = v; c.ribbon_width_variation = v;
    }
    // V7=sf,align,hide,vbb: one review switch at a time (vbb: villageBridgeBudget).
    if let Ok(v) = std::env::var("V7") { let c = &mut f.layout_config; for k in v.split(',') { match k { "sf" => c.street_frontage = true, "align" => c.align_enclosed_grid = true, "hide" => c.hide_unused_quarters = true, "vbb" => c.village_bridge_budget = true, _ => {} } } }
    let geography = f.geometry.map(|g| Geography::new(g, f.width)).transpose()?;
    let surface = Surface { geometry: geography.as_ref(), width: f.width, n: f.n, height: &f.height, water: &f.water };
    // TIMING=1: seconds per stage on stderr.
    let clock = std::time::Instant::now();
    let lap = |what: &str| if std::env::var("TIMING").is_ok() { eprintln!("TIMING {what} {:.1} s", clock.elapsed().as_secs_f64()); };
    let layouts = generate_quarters(&f.seed, &f.sites, &f.layout_config, surface, &f.roads)?;
    if std::env::var("WARN").is_ok() { for w in &layouts[0].warnings { eprintln!("warning: {w}"); } }
    if std::env::var("DUMP").is_ok() { if let serde_json::Value::Object(m) = serde_json::to_value(&layouts[0])? { for (k, v) in &m { let n = match v { serde_json::Value::Array(a) => format!("[{}]", a.len()), serde_json::Value::Object(o) => format!("{{{}}}", o.keys().cloned().collect::<Vec<_>>().join(",")), x => x.to_string().chars().take(80).collect() }; eprintln!("layout.{k} = {n}"); } let st = &m["structure"]; eprintln!("metrics {}", st["metrics"]); eprintln!("allocated {} mech {} family {}", st["allocated"].as_array().map_or(0, |a| a.len()), st["mechanism"], st["family"]); eprintln!("quarters {}", m["quarters"].as_array().map(|q| q.iter().map(|x| format!("{}:{}", x["kind"], x["area"])).collect::<Vec<_>>().join(" ")).unwrap_or_default()); } }
    lap("quarters");
    let partitions = generate_parcels(&f.seed, &layouts, &f.parcel_config)?;
    lap("parcels");
    // OUT=<file>: the layouts and partitions as JSON (exact before/after comparisons).
    if let Ok(out) = std::env::var("OUT") { std::fs::write(out, serde_json::to_vec(&(&layouts, &partitions))?)?; }
    let level = if f.water_level.is_empty() { vec![0.0; f.height.len()] } else { f.water_level.clone() };
    let requests = building_sites::requests(&f.seed, &layouts, &partitions, surface, &level, None)?;
    lap("buildings");
    if let Ok(out) = std::env::var("OUT_REQUESTS") { std::fs::write(out, serde_json::to_vec(&requests)?)?; }
    let built: HashSet<&str> = requests.iter().filter(|r| r["preview"].as_array().is_some_and(|p| !p.is_empty())).filter_map(|r| r["parcel_id"].as_str()).collect();
    if std::env::var("WARN").is_ok() { let mut k = std::collections::BTreeMap::new(); for p in &partitions[0].parcels { *k.entry(p.use_kind.as_str()).or_insert(0) += 1; } eprintln!("uses {k:?} · requests {} · with preview {} · blocks kinds {:?}", requests.len(), requests.iter().filter(|r| r["preview"].as_array().is_some_and(|p| !p.is_empty())).count(), layouts[0].blocks.iter().map(|b| b.kind.as_str()).collect::<Vec<_>>()); for w in &partitions[0].warnings { eprintln!("pwarn: {w}"); } }
    let lots: Vec<_> = partitions[0].parcels.iter().filter(|p| matches!(p.use_kind.as_str(), "plot" | "compound")).collect();
    let empty: Vec<_> = lots.iter().filter(|p| !built.contains(p.id.as_str())).collect();
    println!("lots {} · built {} · empty {} · blocks {} · streets {}", lots.len(), lots.len() - empty.len(), empty.len(), layouts[0].blocks.len(), layouts[0].streets.len());
    Ok(())
}
