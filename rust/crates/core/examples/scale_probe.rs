//! Building proportions probe: fixture.json cultures(comma) [population] -> per culture, as built by massing.rs:
//! storeys histogram, storey height, eave / total height, roof rise over span, footprint, tall and slender
//! counts, landmarks, and mean storeys by distance band (gradient). OPTS=key,… sets layoutConfig booleans.
use magna_urbis_core::urban::{Geography, LayoutConfig, ParcelConfig, Point, Site, Street, Surface, VectorGeography, building_sites, generate_parcels, generate_quarters};
use serde::Deserialize;
use serde_json::Value;
use std::collections::BTreeMap;

#[derive(Deserialize)]
#[serde(rename_all = "camelCase")]
struct Fixture { seed: String, n: usize, width: f64, height: Vec<f32>, water: Vec<u8>, water_level: Vec<f32>, geometry: Option<VectorGeography>, sites: Vec<Site>, roads: Vec<Street>, layout_config: LayoutConfig, #[serde(default)] parcel_config: ParcelConfig }
fn pts(v: &Value) -> Vec<Point> { v.as_array().map(|a| a.iter().map(|p| if p.is_array() { Point { x: p[0].as_f64().unwrap_or(0.), y: p[1].as_f64().unwrap_or(0.) } } else { Point { x: p["x"].as_f64().unwrap_or(0.), y: p["y"].as_f64().unwrap_or(0.) } }).collect()).unwrap_or_default() }
fn area(r: &[Point]) -> f64 { (0..r.len()).map(|i| { let (a, b) = (r[i], r[(i + 1) % r.len()]); a.x * b.y - b.x * a.y }).sum::<f64>().abs() / 2.0 }
/// Narrowest width over the edge directions (convex rings).
fn width(r: &[Point]) -> f64 {
    (0..r.len()).map(|i| { let (a, b) = (r[i], r[(i + 1) % r.len()]); let l = (b.x - a.x).hypot(b.y - a.y).max(1e-9); let (nx, ny) = (-(b.y - a.y) / l, (b.x - a.x) / l);
        let d: Vec<f64> = r.iter().map(|p| (p.x - a.x) * nx + (p.y - a.y) * ny).collect(); d.iter().cloned().fold(f64::MIN, f64::max) - d.iter().cloned().fold(f64::MAX, f64::min) })
        .filter(|w| *w > 0.05).fold(f64::MAX, f64::min)
}
fn q(v: &mut Vec<f64>, p: f64) -> f64 { if v.is_empty() { return 0. } v.sort_by(f64::total_cmp); v[((v.len() - 1) as f64 * p).round() as usize] }

fn main() -> Result<(), Box<dyn std::error::Error>> {
    let args: Vec<_> = std::env::args().collect();
    let base: Value = serde_json::from_slice(&std::fs::read(&args[1])?)?;
    let opts = std::env::var("OPTS").unwrap_or_default();
    for culture in args[2].split(',') {
        let mut v = base.clone();
        v["sites"][0]["culture"] = Value::from(culture);
        if let Some(p) = args.get(3) { v["sites"][0]["population"] = Value::from(p.parse::<u64>()?); }
        if let Some(o) = v["layoutConfig"].as_object_mut() { o.remove("composition"); if let Some(p) = o.get_mut("programme").and_then(Value::as_object_mut) { p.remove("role"); } }
        for k in opts.split(',').filter(|k| !k.is_empty()) { v["layoutConfig"][k] = Value::Bool(true); }
        let f: Fixture = serde_json::from_value(v)?;
        let geography = f.geometry.map(|g| Geography::new(g, f.width)).transpose()?;
        let surface = Surface { geometry: geography.as_ref(), width: f.width, n: f.n, height: &f.height, water: &f.water, interpolation: Default::default(),};
        let layouts = generate_quarters(&f.seed, &f.sites, &f.layout_config, surface, &f.roads)?;
        let partitions = generate_parcels(&f.seed, &layouts, &f.parcel_config)?;
        let requests = building_sites::requests(&f.seed, &layouts, &partitions, surface, &f.water_level, None)?;
        let l = &layouts[0];
        let radius = (l.quarters.iter().map(|q| (area(&q.shape.outer) - q.shape.holes.iter().map(|h| area(h)).sum::<f64>())).sum::<f64>() / std::f64::consts::PI).sqrt().max(1.);
        let (mut fl, mut storey, mut eave, mut top, mut rs, mut fp) = (BTreeMap::<u64, usize>::new(), vec![], vec![], vec![], vec![], vec![]);
        let (mut tall, mut slender, mut n, mut lm, mut lm_top, mut lm_fp, mut big) = (0, 0, 0, 0, 0f64, 0f64, 0);
        let mut bands = [(0.0, 0usize); 4];
        let mut detail: Vec<(f64, f64, String)> = vec![];
        for r in &requests {
            let prog = &r["programme"]; let Some(mass) = prog["massing"].as_array() else { continue };
            let landmark = prog["landmark"].as_bool().unwrap_or(false);
            let vols: Vec<&Value> = mass.iter().flat_map(|m| m["volumes"].as_array().map(|a| a.iter().collect::<Vec<_>>()).unwrap_or_else(|| vec![m])).collect();
            let Some(t) = vols.iter().max_by(|a, b| (a["eave_m"].as_f64().unwrap_or(0.) + a["rise_m"].as_f64().unwrap_or(0.)).total_cmp(&(b["eave_m"].as_f64().unwrap_or(0.) + b["rise_m"].as_f64().unwrap_or(0.)))) else { continue };
            let footprint: f64 = r["preview"].as_array().map(|a| a.iter().map(|s| area(&pts(&s["outer"]))).sum()).unwrap_or(0.);
            let (e, ri) = (t["eave_m"].as_f64().unwrap_or(0.), t["rise_m"].as_f64().unwrap_or(0.)); let fls = t["floors"].as_u64().unwrap_or(1);
            let ring = pts(&t["ring"]); let w = if ring.len() >= 3 { width(&ring) } else { 0. };
            detail.push((e + ri, footprint, format!("{}{} fl={fls} eave={e:.1} rise={ri:.1} w={w:.1} fp={footprint:.0} labels={:?}", prog["role"].as_str().unwrap_or(""), if landmark { "*" } else { "" }, r["preview_parts"].as_array().map(|a| a.iter().filter_map(|x| x.as_str()).collect::<Vec<_>>().join("+")).unwrap_or_default())));
            if landmark { lm += 1; lm_top = lm_top.max(e + ri); lm_fp = lm_fp.max(footprint); continue; }
            n += 1; *fl.entry(fls).or_default() += 1; storey.push(e / fls.max(1) as f64); eave.push(e); top.push(e + ri); fp.push(footprint);
            if w > 0.5 && ri > 0.05 { rs.push(ri / w); }
            if e >= 9.0 { tall += 1; } if w > 0.5 && (e + ri) / w > 2.5 { slender += 1; } if footprint > 200. { big += 1; }
            let c = ring.iter().fold(Point { x: 0., y: 0. }, |s, p| Point { x: s.x + p.x / ring.len() as f64, y: s.y + p.y / ring.len() as f64 });
            let b = (((c.x - l.center.x).hypot(c.y - l.center.y) / radius) / 0.3).min(3.) as usize; bands[b].0 += fls as f64; bands[b].1 += 1;
        }
        println!("{culture:>20} pop={} n={n} storeys={fl:?} storey_m p50={:.2} eave p50/p90={:.1}/{:.1} top p90/max={:.1}/{:.1} rise/span p50/p90={:.2}/{:.2} fp p50/p90={:.0}/{:.0} >200m2={big} eave>=9m={tall} slender={slender} | landmarks={lm} top={lm_top:.1} fp={lm_fp:.0} | storeys by band {}",
            f.sites[0].population, q(&mut storey, 0.5), q(&mut eave, 0.5), q(&mut eave, 0.9), q(&mut top, 0.9), q(&mut top, 1.0), q(&mut rs, 0.5), q(&mut rs, 0.9), q(&mut fp, 0.5), q(&mut fp, 0.9),
            bands.iter().map(|(s, c)| if *c > 0 { format!("{:.1}({c})", s / *c as f64) } else { "-".into() }).collect::<Vec<_>>().join(" "));
        if std::env::var("DETAIL").is_ok() {
            detail.sort_by(|a, b| b.0.total_cmp(&a.0)); for d in detail.iter().take(4) { println!("   tall: {}", d.2); }
            detail.sort_by(|a, b| b.1.total_cmp(&a.1)); for d in detail.iter().take(3) { println!("   big:  {}", d.2); }
        }
    }
    Ok(())
}
