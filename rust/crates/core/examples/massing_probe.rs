//! Massing probe on a captured City Bench request: fixture.json out-prefix -> out-prefix.svg + out-prefix.json.
//! Native pipeline as the engine runs it (quarters, parcels + programme, building requests with preview and
//! programme.massing). SVG: blocks grey, outer wall thick dark, other enclosures coloured, streets thin,
//! pieces filled by floors (1 pale yellow, 2 orange, 3 red, 4+ dark red), landmarks outlined blue.
//! Stats per 0.1-radius band from the centre (radius = sqrt(quarter area / pi)), and inside/outside the outer wall.
use magna_urbis_core::urban::{Geography, Layout, LayoutConfig, ParcelConfig, Point, Site, Street, Surface, VectorGeography, building_sites, generate_parcels, generate_quarters};
use serde::Deserialize;
use serde_json::{Value, json};
use std::{collections::BTreeMap, fmt::Write, time::Instant};

#[derive(Deserialize)]
#[serde(rename_all = "camelCase")]
struct Fixture { seed: String, n: usize, width: f64, height: Vec<f32>, water: Vec<u8>, water_level: Vec<f32>, geometry: Option<VectorGeography>, sites: Vec<Site>, roads: Vec<Street>, layout_config: LayoutConfig, #[serde(default)] parcel_config: ParcelConfig }

fn ring_area(r: &[Point]) -> f64 { (0..r.len()).map(|i| { let (a, b) = (r[i], r[(i + 1) % r.len()]); a.x * b.y - b.x * a.y }).sum::<f64>().abs() / 2.0 }
fn shape_area(o: &[Point], holes: &[Vec<Point>]) -> f64 { ring_area(o) - holes.iter().map(|h| ring_area(h)).sum::<f64>() }
fn centroid(r: &[Point]) -> Point { let n = r.len().max(1) as f64; Point { x: r.iter().map(|p| p.x).sum::<f64>() / n, y: r.iter().map(|p| p.y).sum::<f64>() / n } }
fn inside(r: &[Point], p: Point) -> bool { let mut c = false; let mut j = r.len().wrapping_sub(1); for i in 0..r.len() { if (r[i].y > p.y) != (r[j].y > p.y) && p.x < (r[j].x - r[i].x) * (p.y - r[i].y) / (r[j].y - r[i].y) + r[i].x { c = !c; } j = i; } c }
fn pts(v: &Value) -> Vec<Point> { v.as_array().map(|a| a.iter().map(|p| Point { x: p["x"].as_f64().unwrap_or(0.), y: p["y"].as_f64().unwrap_or(0.) }).collect()).unwrap_or_default() }
fn holes(v: &Value) -> Vec<Vec<Point>> { v.as_array().map(|a| a.iter().map(pts).collect()).unwrap_or_default() }

#[derive(Default)]
struct Band { fp: Vec<f64>, floors: Vec<u64>, bld_area: f64, blk_area: f64, roles: BTreeMap<String, usize>, big: usize }
impl Band {
    fn add(&mut self, fp: f64, fl: u64, role: &str) { self.fp.push(fp); self.floors.push(fl); *self.roles.entry(role.into()).or_default() += 1; if fp > 150. { self.big += 1; } }
    fn json(&self) -> Value {
        let n = self.fp.len();
        let mut s = self.fp.clone(); s.sort_by(f64::total_cmp);
        let mean = |v: f64| if n > 0 { v / n as f64 } else { 0. };
        json!({"dwellings":n,"fpMean":mean(self.fp.iter().sum()),"fpP90":s.get(((n as f64) * 0.9) as usize).or(s.last()).copied().unwrap_or(0.),
            "floorsMean":mean(self.floors.iter().sum::<u64>() as f64),"shareOver150":mean(self.big as f64),
            "coverage":if self.blk_area > 0. { self.bld_area / self.blk_area } else { 0. },"roles":self.roles})
    }
}

fn main() -> Result<(), Box<dyn std::error::Error>> {
    let args: Vec<_> = std::env::args().collect();
    if args.len() != 3 { return Err("Expected fixture.json out-prefix".into()); }
    let f: Fixture = serde_json::from_slice(&std::fs::read(&args[1])?)?;
    let geography = f.geometry.map(|g| Geography::new(g, f.width)).transpose()?;
    let surface = Surface { geometry: geography.as_ref(), width: f.width, n: f.n, height: &f.height, water: &f.water };
    let t = Instant::now();
    let layouts = generate_quarters(&f.seed, &f.sites, &f.layout_config, surface, &f.roads)?;
    let partitions = generate_parcels(&f.seed, &layouts, &f.parcel_config)?;
    let requests = building_sites::requests(&f.seed, &layouts, &partitions, surface, &f.water_level, None)?;
    let l: &Layout = &layouts[0];
    let radius = (l.quarters.iter().map(|q| shape_area(&q.shape.outer, &q.shape.holes)).sum::<f64>() / std::f64::consts::PI).sqrt().max(1.);
    let band_of = |p: Point| (((p.x - l.center.x).hypot(p.y - l.center.y) / (radius * 0.1)) as usize).min(10);
    // Outer wall: the largest enclosure without a purpose (else the largest).
    let areas: Vec<f64> = l.enclosures.iter().map(|e| ring_area(&e.path)).collect();
    let outer = (0..l.enclosures.len()).filter(|&i| l.enclosures[i].purpose.is_empty()).max_by(|&a, &b| areas[a].total_cmp(&areas[b])).or_else(|| (0..l.enclosures.len()).max_by(|&a, &b| areas[a].total_cmp(&areas[b])));
    let in_wall = |p: Point| outer.is_some_and(|i| inside(&l.enclosures[i].path, p));
    let mut bands: Vec<Band> = (0..=10).map(|_| Band::default()).collect();
    let (mut within, mut without) = (Band::default(), Band::default());
    // Block area per band (built blocks only), by block centroid.
    for b in &l.blocks {
        if matches!(b.kind.as_str(), "place" | "reserve" | "garden" | "common") { continue; }
        let c = centroid(&b.shape.outer); let a = shape_area(&b.shape.outer, &b.shape.holes);
        bands[band_of(c)].blk_area += a; if in_wall(c) { within.blk_area += a } else { without.blk_area += a }
    }
    let (mut x0, mut y0, mut x1, mut y1) = (f64::MAX, f64::MAX, f64::MIN, f64::MIN);
    for p in l.blocks.iter().flat_map(|b| &b.shape.outer).chain(l.enclosures.iter().flat_map(|e| &e.path)) { x0 = x0.min(p.x); y0 = y0.min(p.y); x1 = x1.max(p.x); y1 = y1.max(p.y); }
    let m = (x1 - x0).max(y1 - y0) * 0.04;
    let (x0, y0, side) = (x0 - m, y0 - m, (x1 - x0).max(y1 - y0) + 2.0 * m);
    let mut svg = format!("<svg xmlns='http://www.w3.org/2000/svg' width='1600' height='1600' viewBox='{x0} {y0} {side} {side}'><rect x='{x0}' y='{y0}' width='{side}' height='{side}' fill='#cbd3ad'/>");
    let cell = f.width / f.n as f64;
    for y in 0..f.n { for x in 0..f.n {
        let (px, py) = (x as f64 * cell, y as f64 * cell);
        if !(px + cell > x0 && px < x0 + side && py + cell > y0 && py < y0 + side) { continue; }
        if f.water[y * f.n + x] != 0 { write!(svg, "<rect x='{px}' y='{py}' width='{}' height='{}' fill='#628d9b'/>", cell + 0.5, cell + 0.5)?; }
        else if x + 1 < f.n && y + 1 < f.n {
            let h = |i: usize, j: usize| f.height[j * f.n + i] as f64;
            let shade = ((h(x, y) - h(x + 1, y + 1)) / cell * 2.0).clamp(-1.0, 1.0);
            if shade.abs() > 0.05 { write!(svg, "<rect x='{px}' y='{py}' width='{}' height='{}' fill='{}' fill-opacity='{:.2}'/>", cell + 0.5, cell + 0.5, if shade > 0.0 { "#ffffff" } else { "#3d3a2a" }, shade.abs() * 0.55)?; }
        }
    }}
    let path = |svg: &mut String, o: &[Point], hs: &[Vec<Point>]| { for r in std::iter::once(o).chain(hs.iter().map(|h| h.as_slice())) { for (i, p) in r.iter().enumerate() { let _ = write!(svg, "{}{:.1},{:.1} ", if i == 0 { "M" } else { "L" }, p.x, p.y); } svg.push('Z'); } };
    for b in &l.blocks { write!(svg, "<path fill-rule='evenodd' fill='#c9c9c9' fill-opacity='0.8' stroke='#999' stroke-width='{}' d='", side / 2000.)?; path(&mut svg, &b.shape.outer, &b.shape.holes); svg.push_str("'/>"); }
    for s in &l.streets { write!(svg, "<polyline fill='none' stroke='#fffbe8' stroke-opacity='0.9' stroke-width='{}' points='", (s.widths.first().copied().unwrap_or(3.0) * 0.5).max(side / 1500.))?; for p in &s.path { write!(svg, "{:.1},{:.1} ", p.x, p.y)?; } svg.push_str("'/>"); }
    let mut roles: BTreeMap<String, usize> = BTreeMap::new();
    let mut by_kind: BTreeMap<String, usize> = BTreeMap::new();
    let (mut landmarks, mut pieces_n) = (0usize, 0usize);
    let floor_col = |n: u64| match n { 0 | 1 => "#f7ecaa", 2 => "#f2a33a", 3 => "#d8362a", _ => "#7a1020" };
    for r in &requests {
        let prog = &r["programme"]; let role = prog["role"].as_str().unwrap_or("");
        let lm = prog["landmark"].as_bool().unwrap_or(false); landmarks += lm as usize;
        let prev = r["preview"].as_array().cloned().unwrap_or_default(); let parts = r["preview_parts"].as_array().cloned().unwrap_or_default();
        let mass = prog["massing"].as_array().cloned().unwrap_or_default();
        let (mut main, mut main_a, mut total) = (None, 0., 0.);
        let floors_of = |i: usize| mass.get(i).and_then(|m| m["floors"].as_u64()).or_else(|| prog["floors"][0].as_u64()).unwrap_or(1);
        let mut centre = Point { x: 0., y: 0. };
        for (i, s) in prev.iter().enumerate() {
            let (o, hs) = (pts(&s["outer"]), holes(&s["holes"])); if o.len() < 3 { continue; }
            pieces_n += 1; let a = shape_area(&o, &hs); total += a;
            if parts.get(i).and_then(|p| p.as_str()).unwrap_or("building") == "building" && a > main_a { main_a = a; main = Some(i); centre = centroid(&o); }
            write!(svg, "<path fill-rule='evenodd' fill='{}' stroke='{}' stroke-width='{}' d='", floor_col(floors_of(i)), if lm { "#1f4fd8" } else { "#5a4a2a" }, if lm { side / 700. } else { side / 4000. })?; path(&mut svg, &o, &hs); svg.push_str("'/>");
        }
        let Some(mi) = main else { continue };
        let bi = band_of(centre); bands[bi].bld_area += total; if in_wall(centre) { within.bld_area += total } else { without.bld_area += total }
        if role.starts_with("dwelling") && !lm {
            let fl = floors_of(mi); bands[bi].add(main_a, fl, role);
            if in_wall(centre) { within.add(main_a, fl, role) } else { without.add(main_a, fl, role) }
            *roles.entry(role.into()).or_default() += 1;
            if let Some(k) = r["config"]["occupation_kind"].as_str().or(r["occupation"]["kind"].as_str()) { *by_kind.entry(k.into()).or_default() += 1; }
        }
    }
    let mut enc = Vec::new();
    for (i, e) in l.enclosures.iter().enumerate() {
        let col = if Some(i) == outer { "#2b1a14" } else { match e.purpose.as_str() { "" => "#c0302a", "port" => "#1a7a8a", _ => "#7a3fa0" } };
        write!(svg, "<polygon fill='none' stroke='{col}' stroke-width='{}' stroke-linejoin='round' points='", if Some(i) == outer { side / 260. } else { side / 420. })?;
        for p in &e.path { write!(svg, "{:.1},{:.1} ", p.x, p.y)?; } svg.push_str("'/>");
        enc.push(json!({"i":i,"kind":e.kind,"purpose":e.purpose,"style":e.style,"areaHa":areas[i] / 1e4,"outer":Some(i) == outer}));
    }
    svg.push_str("</svg>");
    std::fs::write(format!("{}.svg", args[2]), svg)?;
    let stats = json!({"culture":l.culture,"population":f.sites[0].population,"radiusM":radius,"quarters":l.quarters.len(),"blocks":l.blocks.len(),"requests":requests.len(),"pieces":pieces_n,"landmarks":landmarks,
        "bands":bands.iter().map(Band::json).collect::<Vec<_>>(),"insideWall":within.json(),"outsideWall":without.json(),"roles":roles,"occupationKinds":by_kind,"enclosures":enc,"seconds":t.elapsed().as_secs_f64()});
    std::fs::write(format!("{}.json", args[2]), serde_json::to_vec_pretty(&stats)?)?;
    println!("{} pop={} R={radius:.0}m blocks={} requests={} enclosures={} ({:.1}s)", l.culture, f.sites[0].population, l.blocks.len(), requests.len(), l.enclosures.len(), t.elapsed().as_secs_f64());
    println!("{:>6} {:>5} {:>6} {:>6} {:>5} {:>6} {:>5}", "band", "n", "fpMean", "fpP90", "flr", ">150", "cov");
    let row = |name: String, b: &Band| { let j = b.json(); println!("{:>6} {:>5} {:>6.0} {:>6.0} {:>5.2} {:>5.0}% {:>4.0}%", name, b.fp.len(), j["fpMean"].as_f64().unwrap(), j["fpP90"].as_f64().unwrap(), j["floorsMean"].as_f64().unwrap(), j["shareOver150"].as_f64().unwrap() * 100., j["coverage"].as_f64().unwrap() * 100.) };
    for (i, b) in bands.iter().enumerate() { row(if i == 10 { ">1.0".into() } else { format!("{:.1}", i as f64 / 10.) }, b); }
    row("inWall".into(), &within); row("outWal".into(), &without);
    println!("roles {roles:?}\nenclosures {}", serde_json::to_string(&stats["enclosures"])?);
    Ok(())
}
