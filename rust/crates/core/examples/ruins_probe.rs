//! Ruins probe: City Bench fixture -> plan SVG and oblique 3D SVG of the preview
//! pieces raised by their massing (ruin stubs, corners, rubble), with counts.
//! `cargo run --release --example ruins_probe -- fixture.json out-prefix [culture] [state] [population]`
use magna_urbis_core::urban::{Geography, LayoutConfig, ParcelConfig, Shape, Site, Street, Surface, VectorGeography, building_sites, generate_parcels, generate_quarters};
use serde::Deserialize;
use std::{collections::BTreeMap, fmt::Write};
#[derive(Deserialize)]
#[serde(rename_all = "camelCase")]
struct Fixture { seed: String, n: usize, width: f64, height: Vec<f32>, water: Vec<u8>, #[serde(default)] water_level: Vec<f32>, geometry: Option<VectorGeography>, sites: Vec<Site>, roads: Vec<Street>, layout_config: LayoutConfig, #[serde(default)] parcel_config: ParcelConfig }
fn main() -> Result<(), Box<dyn std::error::Error>> {
    let args: Vec<_> = std::env::args().collect();
    let mut f: Fixture = serde_json::from_slice(&std::fs::read(&args[1])?)?;
    if let Some(c) = args.get(3) { for s in &mut f.sites { s.culture = c.clone(); } }
    if let Some(st) = args.get(4) { f.layout_config.programme.state = st.clone(); }
    if let Some(p) = args.get(5) { for s in &mut f.sites { s.population = p.parse()?; } }
    let geo = f.geometry.map(|g| Geography::new(g, f.width)).transpose()?;
    let surface = Surface { geometry: geo.as_ref(), width: f.width, n: f.n, height: &f.height, water: &f.water };
    let t = std::time::Instant::now();
    let layouts = generate_quarters(&f.seed, &f.sites, &f.layout_config, surface, &f.roads)?;
    let parts = generate_parcels(&f.seed, &layouts, &f.parcel_config)?;
    let level = if f.water_level.is_empty() { vec![0.; f.height.len()] } else { f.water_level };
    let requests = building_sites::requests(&f.seed, &layouts, &parts, surface, &level, None)?;
    println!("generated in {:.2}s", t.elapsed().as_secs_f64());
    for (l, p) in layouts.iter().zip(&parts) {
        let alloc = p.programme.as_ref().map_or(0, |pr| pr.allocations.len());
        let hh: f64 = p.programme.as_ref().map_or(0., |pr| pr.allocations.iter().map(|a| a.households).sum());
        println!("layout {}: quarters {} blocks {} streets {} parcels {} allocations {alloc} households {hh:.0}", l.archetype, l.quarters.len(), l.blocks.len(), l.streets.len(), p.parcels.len());
    }
    let (mut labels, mut ruined, mut whole) = (BTreeMap::<String, usize>::new(), 0, 0);
    let mut bounds = [f64::INFINITY, f64::INFINITY, f64::NEG_INFINITY, f64::NEG_INFINITY];
    let mut items = vec![];
    for r in &requests {
        let shapes: Vec<Shape> = serde_json::from_value(r["preview"].clone()).unwrap_or_default();
        let mass = r["programme"]["massing"].as_array().cloned().unwrap_or_default();
        let ls = r["preview_parts"].as_array().cloned().unwrap_or_default();
        let mut any = false;
        for (i, s) in shapes.into_iter().enumerate() {
            let l = ls.get(i).and_then(|v| v.as_str()).unwrap_or("building").to_string();
            any |= matches!(l.as_str(), "ruin" | "ruin-corner" | "rubble");
            *labels.entry(l.clone()).or_default() += 1;
            for p in &s.outer { bounds = [bounds[0].min(p.x), bounds[1].min(p.y), bounds[2].max(p.x), bounds[3].max(p.y)]; }
            let m = mass.get(i).cloned().unwrap_or_default();
            items.push((s, l, m["eave_m"].as_f64().unwrap_or(3.), m["rise_m"].as_f64().unwrap_or(0.), m["roof"].as_str().unwrap_or("flat").to_string()));
        }
        if any { ruined += 1 } else if !r["preview"].as_array().is_none_or(Vec::is_empty) { whole += 1 }
    }
    println!("buildings: {ruined} ruined, {whole} standing; pieces {labels:?}");
    let colour = |l: &str| match l { "ruin" => "#cfc6b0", "ruin-corner" => "#b9ae94", "rubble" => "#a59a84", "tomb" => "#c9c7b8", _ => "#9a6b52" };
    let (w, h) = (bounds[2] - bounds[0] + 40., bounds[3] - bounds[1] + 40.);
    let path = |pts: &mut dyn Iterator<Item = (f64, f64)>| { let mut d = String::new(); for (i, (x, y)) in pts.enumerate() { write!(d, "{}{:.2},{:.2}", if i == 0 { "M" } else { "L" }, x, y).unwrap(); } d.push('Z'); d };
    // Plan.
    let mut plan = format!("<svg xmlns='http://www.w3.org/2000/svg' width='1400' height='{}' viewBox='{} {} {w} {h}'><rect x='{}' y='{}' width='{w}' height='{h}' fill='#ece2c6'/>", (1400. * h / w) as i32, bounds[0] - 20., bounds[1] - 20., bounds[0] - 20., bounds[1] - 20.);
    for l in &layouts { for s in &l.streets { let pts = s.path.iter().map(|p| format!("{:.1},{:.1}", p.x, p.y)).collect::<Vec<_>>().join(" "); write!(plan, "<polyline points='{pts}' fill='none' stroke='#d6c7a0' stroke-width='{}'/>", s.widths.first().copied().unwrap_or(3.))?; } }
    for (s, l, ..) in &items { write!(plan, "<path d='{}' fill='{}' stroke='#5a5040' stroke-width='.15'/>", path(&mut s.outer.iter().map(|p| (p.x, p.y))), colour(l))?; }
    plan.push_str("</svg>");
    std::fs::write(format!("{}-plan.svg", args[2]), plan)?;
    // Oblique 3D: x' = x + 0.5 y-depth, y' = 0.55 y - z; painter's order by depth.
    // A 90 m window around the settlement centre, true heights.
    let c = layouts[0].center;
    items.retain(|(s, ..)| s.outer.iter().all(|p| (p.x - c.x).abs() < 45. && (p.y - c.y).abs() < 45.));
    let bounds = [c.x - 45., c.y - 45., c.x + 45., c.y + 45.];
    let (w, h) = (90., 90.);
    let k = 1.0;
    let pr = |x: f64, y: f64, z: f64| (x - bounds[0] + 0.35 * (y - bounds[1]), 0.6 * (y - bounds[1]) - k * z);
    let mut faces: Vec<(f64, String, &str)> = vec![];
    println!("3d window: {} pieces", items.len());
    for (s, l, eave, rise, roof) in &items {
        let r = &s.outer; let n = r.len();
        let top = |i: usize| (r[i].x, r[i].y, *eave);
        for i in 0..n { let (a, b) = (r[i], r[(i + 1) % n]);
            let d = path(&mut [pr(a.x, a.y, 0.), pr(b.x, b.y, 0.), pr(b.x, b.y, *eave), pr(a.x, a.y, *eave)].into_iter());
            faces.push(((a.y + b.y) / 2., d, "#7d7462")); }
        if roof == "pyramid" { let (cx, cy) = (r.iter().map(|p| p.x).sum::<f64>() / n as f64, r.iter().map(|p| p.y).sum::<f64>() / n as f64);
            for i in 0..n { let (a, b) = (top(i), top((i + 1) % n)); faces.push(((a.1 + b.1) / 2. + 0.01, path(&mut [pr(a.0, a.1, a.2), pr(b.0, b.1, b.2), pr(cx, cy, eave + rise)].into_iter()), colour(l))); } }
        else { faces.push((r.iter().map(|p| p.y).fold(f64::MIN, f64::max) + 0.01, path(&mut (0..n).map(|i| { let t = top(i); pr(t.0, t.1, t.2) })), colour(l))); }
    }
    faces.sort_by(|a, b| a.0.total_cmp(&b.0));
    let (ow, oh) = (w + 0.35 * h + 10., 0.6 * h + 30.);
    let mut o = format!("<svg xmlns='http://www.w3.org/2000/svg' width='1600' height='{}' viewBox='-5 -25 {ow} {oh}'><rect x='-5' y='-25' width='{ow}' height='{oh}' fill='#e8e4d8'/>", (1600. * oh / ow) as i32);
    for (_, d, c) in faces { write!(o, "<path d='{d}' fill='{c}' stroke='#3e382c' stroke-width='.08'/>")?; }
    o.push_str("</svg>");
    std::fs::write(format!("{}-3d.svg", args[2]), o)?;
    std::fs::write(format!("{}-requests.json", args[2]), serde_json::to_vec(&requests)?)?;
    Ok(())
}
