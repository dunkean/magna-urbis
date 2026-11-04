//! Farmstead probe: fixture.json cultures(comma) out_dir [population] -> per culture, the rural dwellings,
//! farmsteads and outbuildings by label (farmsteads.rs), the time, and <out_dir>/<culture>.svg: up to 12
//! farm lots side by side (lot outline, house, outbuildings by label, yard hint).
use magna_urbis_core::urban::{Geography, LayoutConfig, ParcelConfig, Point, Site, Street, Surface, VectorGeography, building_sites, generate_parcels, generate_quarters};
use serde::Deserialize;
use serde_json::Value;
use std::collections::BTreeMap;
use std::fmt::Write;

#[derive(Deserialize)]
#[serde(rename_all = "camelCase")]
struct Fixture { seed: String, n: usize, width: f64, height: Vec<f32>, water: Vec<u8>, water_level: Vec<f32>, geometry: Option<VectorGeography>, sites: Vec<Site>, roads: Vec<Street>, layout_config: LayoutConfig, #[serde(default)] parcel_config: ParcelConfig }
fn pts(v: &Value) -> Vec<Point> { v.as_array().map(|a| a.iter().map(|p| Point { x: p["x"].as_f64().unwrap_or(0.), y: p["y"].as_f64().unwrap_or(0.) }).collect()).unwrap_or_default() }
fn inside(r: &[Point], p: Point) -> bool { let mut c = false; let mut j = r.len().wrapping_sub(1); for i in 0..r.len() { if (r[i].y > p.y) != (r[j].y > p.y) && p.x < (r[j].x - r[i].x) * (p.y - r[i].y) / (r[j].y - r[i].y) + r[i].x { c = !c; } j = i; } c }
fn area(r: &[Point]) -> f64 { (0..r.len()).map(|i| { let (a, b) = (r[i], r[(i + 1) % r.len()]); a.x * b.y - b.x * a.y }).sum::<f64>().abs() / 2.0 }
fn colour(l: &str) -> &'static str {
    match l { "building" => "#b5543c", "barn" => "#7a5a3a", "byre" => "#8d6e4c", "stable" => "#9c7a52", "granary" | "raised-granary" => "#d6a84a",
        "shed" | "cart-shed" => "#a08c70", "bakehouse" => "#c9733f", "well" => "#3d6fa8", "hayrick" => "#e3cf6a", "hut" => "#a8743e",
        "storeroom" => "#b89a72", "farm-tower" => "#666", "dovecote" => "#ddd", "pit-house" => "#5c4a36", "smithy" => "#444", _ => "#999" }
}

fn main() -> Result<(), Box<dyn std::error::Error>> {
    let args: Vec<_> = std::env::args().collect();
    let base: Value = serde_json::from_slice(&std::fs::read(&args[1])?)?;
    let out = std::path::PathBuf::from(&args[3]);
    std::fs::create_dir_all(&out)?;
    for culture in args[2].split(',') {
        let mut v = base.clone();
        v["sites"][0]["culture"] = Value::from(culture);
        if let Some(p) = args.get(4) { v["sites"][0]["population"] = Value::from(p.parse::<u64>()?); }
        if let Some(o) = v["layoutConfig"].as_object_mut() { o.remove("composition"); if let Some(p) = o.get_mut("programme").and_then(Value::as_object_mut) { p.remove("role"); } }
        let f: Fixture = serde_json::from_value(v)?;
        let geography = f.geometry.map(|g| Geography::new(g, f.width)).transpose()?;
        let surface = Surface { geometry: geography.as_ref(), width: f.width, n: f.n, height: &f.height, water: &f.water };
        let t0 = std::time::Instant::now();
        let layouts = generate_quarters(&f.seed, &f.sites, &f.layout_config, surface, &f.roads)?;
        let partitions = generate_parcels(&f.seed, &layouts, &f.parcel_config)?;
        let requests = building_sites::requests(&f.seed, &layouts, &partitions, surface, &f.water_level, None)?;
        let secs = t0.elapsed().as_secs_f64();
        let (mut farms, mut small, mut labels, mut types) = (0, 0, BTreeMap::<String, usize>::new(), BTreeMap::<String, usize>::new());
        let mut svg = String::new();
        let (tile, mut k) = (70.0, 0);
        let mut miss = BTreeMap::<String, usize>::new();
        for r in &requests {
            let fs = &r["programme"]["farmstead"];
            if fs.is_null() {
                let p = &r["programme"];
                *miss.entry(format!("{}|{}|{}|{}", (area(&pts(&r["cadastral"][0]["outer"])) / 100.0).round() * 100.0, p["role"].as_str().unwrap_or(""), { let lot = pts(&r["cadastral"][0]["outer"]); let c = Point { x: lot.iter().map(|p| p.x).sum::<f64>() / lot.len().max(1) as f64, y: lot.iter().map(|p| p.y).sum::<f64>() / lot.len().max(1) as f64 };
                    layouts[0].blocks.iter().find(|b| inside(&b.shape.outer, c)).map_or("none", |b| b.zone.as_str()) }, r["preview"].as_array().map_or(0, |a| a.len()))).or_default() += 1;
                continue;
            }
            if fs["farm"].as_bool() == Some(true) { farms += 1 } else { small += 1 }
            *types.entry(fs["type"].as_str().unwrap_or("").into()).or_default() += 1;
            let parts = r["preview_parts"].as_array().cloned().unwrap_or_default();
            for p in &parts { *labels.entry(p.as_str().unwrap_or("").into()).or_default() += 1; }
            if k >= 12 || (fs["farm"].as_bool() != Some(true) && k >= 8) { continue; }
            let lot = pts(&r["cadastral"][0]["outer"]);
            let c = Point { x: lot.iter().map(|p| p.x).sum::<f64>() / lot.len() as f64, y: lot.iter().map(|p| p.y).sum::<f64>() / lot.len() as f64 };
            let (ox, oy) = (tile * (k % 4) as f64 + tile / 2.0, tile * (k / 4) as f64 + tile / 2.0);
            let path = |ring: &[Point]| ring.iter().enumerate().map(|(i, p)| format!("{}{:.1},{:.1}", if i == 0 { "M" } else { "L" }, p.x - c.x + ox, p.y - c.y + oy)).collect::<String>() + "Z";
            writeln!(svg, "<path d='{}' fill='#e9e4c8' stroke='#888' stroke-width='0.3'/>", path(&lot))?;
            writeln!(svg, "<path d='{}' fill='none' stroke='#3a7a3a' stroke-width='0.4' stroke-dasharray='1,1'/>", path(&pts(&fs["yard"])))?;
            for (s, l) in r["preview"].as_array().into_iter().flatten().zip(parts.iter()) {
                writeln!(svg, "<path d='{}' fill='{}' stroke='#222' stroke-width='0.2'/>", path(&pts(&s["outer"])), colour(l.as_str().unwrap_or("")))?;
            }
            writeln!(svg, "<text x='{:.0}' y='{:.0}' font-size='3'>{} {}</text>", ox - tile / 2.0 + 1.0, oy - tile / 2.0 + 3.5, fs["type"].as_str().unwrap_or(""), if fs["farm"].as_bool() == Some(true) { "farm" } else { "small" })?;
            k += 1;
        }
        let file = out.join(format!("{culture}.svg"));
        std::fs::write(&file, format!("<svg xmlns='http://www.w3.org/2000/svg' viewBox='0 0 {w} {h}' width='{pw}' height='{ph}'><rect width='100%' height='100%' fill='#fff'/>{svg}</svg>",
            w = 4.0 * tile, h = 3.0 * tile, pw = 4.0 * tile * 4.0, ph = 3.0 * tile * 4.0))?;
        println!("{culture:>20} requests={} farms={farms} smallholdings={small} t={secs:.1}s types={types:?} labels={labels:?}
   missed={miss:?}", requests.len());
    }
    Ok(())
}
