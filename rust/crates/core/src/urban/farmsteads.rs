//! Farmsteads: every rural dwelling is a house plus outbuildings around a yard.
//! The farm type, its yard layout, the outbuildings it always builds and the
//! pool it draws from are culture data (`catalogue.json` `farmstead`), shared
//! with the land-use farms (web/src/gen/landuse/farms.ts). The house is the
//! occupation's; outbuildings are placed in the house frame (u along its long
//! side, v away from the street) by layout, each inside the lot and clear of
//! every other body, so the cost is linear in the farms.
use super::{Point, Shape, geometry as g};
use crate::rng::Rng;
use serde_json::{Value, json};
use std::sync::OnceLock;

fn data() -> &'static Value {
    static DATA: OnceLock<Value> = OnceLock::new();
    // Only the `farmstead` block of the catalogue is parsed (the file is large).
    DATA.get_or_init(|| {
        let s = include_str!("catalogue.json");
        let start = s.find("\"farmstead\"").and_then(|k| s[k..].find('{').map(|i| k + i)).expect("farmstead table");
        let mut depth = 0;
        let end = s[start..].char_indices().find_map(|(i, c)| { match c { '{' => depth += 1, '}' => { depth -= 1; if depth == 0 { return Some(start + i + 1); } } _ => {} } None }).expect("farmstead end");
        serde_json::from_str(&s[start..end]).expect("farmstead table")
    })
}
fn pair(v: &Value) -> (f64, f64) { (v[0].as_f64().unwrap_or(0.0), v[1].as_f64().unwrap_or(0.0)) }

/// Whether a preview label is a farm outbuilding (a key of the `buildings` table).
pub(super) fn is_outbuilding(label: &str) -> bool { data()["buildings"].get(label).is_some() }

/// The farm type of a lot: a weighted draw among its culture's types (same seed, same type).
pub(super) fn farm_type(culture: &str, seed: &str) -> &'static str {
    let d = data();
    let c = d["cultures"].get(culture).unwrap_or(&d["cultures"][d["default"].as_str().unwrap_or("european-organic")]);
    let types: Vec<(&'static str, f64)> = c["types"].as_array().map_or(vec![], |a| a.iter()
        .filter_map(|t| Some((t[0].as_str()?, t[1].as_f64().unwrap_or(1.0)))).collect());
    let total: f64 = types.iter().map(|t| t.1).sum();
    let mut x = Rng::new(seed).fork("farmstead-type").float() * total;
    for (t, w) in &types {
        if x < *w { return t; }
        x -= w;
    }
    types.last().map_or("haufenhof", |t| t.0)
}

/// How much open land a culture farms (catalogue `farmstead.cultures[c].density`, 1 by default).
pub(super) fn density(culture: &str) -> f64 { data()["cultures"][culture]["density"].as_f64().unwrap_or(1.0) }

/// Farmhouse body (width along its front, depth) of a farm type, metres before the culture's body scale.
pub(super) fn house_size(culture: &str, seed: &str) -> (f64, f64) {
    let t = &data()["types"][farm_type(culture, seed)]["houseSize"];
    let v = |k: usize, d: f64| t[k].as_f64().unwrap_or(d);
    let mut rng = Rng::new(seed).fork("farmhouse");
    (rng.range(v(0, 8.0), v(1, 13.0)), rng.range(v(2, 6.0), v(3, 9.0)))
}

/// Plot of a lone farm (front along its road, depth; metres), from the farm type the
/// seed draws for its culture. The land holds the type's house, its core buildings, a
/// drawn number of ancillary ones and its yard, at the share of built ground its
/// layout keeps; the layout gives the proportion: a linear farm or a longhouse is
/// long and shallow, a closed court and a round compound are square, a scattered
/// farm is loose and wide. Same seed, same plot; two seeds of one culture differ.
pub(super) fn plot(culture: &str, seed: &str) -> (f64, f64) {
    let d = data();
    let ty = &d["types"][farm_type(culture, seed)];
    let mut rng = Rng::new(seed).fork("farm-plot");
    let scale = super::culture::house_parameters(culture).0;
    let foot = |l: &str| { let b = &d["buildings"][l]; let ((w0, w1), (d0, d1)) = (pair(&b["width"]), pair(&b["depth"])); (0.5 * (w0 + w1), 0.5 * (d0 + d1)) };
    let area = |list: &[&'static str]| list.iter().map(|l| { let (w, dp) = foot(*l); w * dp }).sum::<f64>();
    let names = |key: &str| -> Vec<&'static str> { ty[key].as_array().map_or(vec![], |a| a.iter().filter_map(Value::as_str).filter(|l| is_outbuilding(l)).collect()) };
    let (core, pool) = (names("core"), names("ancillary"));
    let h = |k: usize, v: f64| ty["houseSize"][k].as_f64().unwrap_or(v);
    let (lo, hi) = pair(&ty["outbuildings"]);
    let count = rng.range(lo, hi.max(lo)).max(core.len() as f64);
    let extra = if pool.is_empty() { 0.0 } else { area(&pool) / pool.len() as f64 };
    let built = 0.25 * (h(0, 8.0) + h(1, 13.0)) * (h(2, 6.0) + h(3, 9.0)) + area(&core) + (count - core.len() as f64) * extra;
    let (y0, y1) = pair(&ty["yard"]);
    let yard = rng.range(y0, y1.max(y0));
    let layout = ty["layout"].as_str().unwrap_or("scattered");
    // Share of the plot under roofs, and front : depth, by layout.
    let (cover, shape) = match layout {
        "closed" => (0.2, rng.range(0.92, 1.1)),
        "u" => (0.17, rng.range(0.85, 1.2)),
        "l" => (0.15, rng.range(0.8, 1.3)),
        "linear" => (0.15, rng.range(1.7, 2.5)),
        "terraced" => (0.18, rng.range(1.25, 1.7)),
        "round" => (0.13, rng.range(0.94, 1.08)),
        _ => (0.1, rng.range(1.15, 1.65)),
    };
    // A larger people's plot grows with its bodies' side, not their area.
    let land = ((built / cover + (yard + 6.0).powi(2)) * rng.range(0.85, 1.2)).clamp(1000.0, 3200.0) * scale;
    // Room for the largest house of the type, its yard and (off a linear farm, whose
    // buildings stand in line with the house) the deepest outbuilding behind it.
    let behind = if layout == "linear" { 0.0 } else { core.iter().chain(&pool).map(|l| foot(*l).1).fold(0.0_f64, f64::max) };
    let front = (land * shape).sqrt().max((1.15 * h(1, 13.0) + 8.0) * scale);
    let depth = (land / shape).sqrt().max((1.15 * h(3, 9.0) + yard + behind + 6.0) * scale);
    (front.max(22.0), depth.max(24.0))
}

/// Display of an outbuilding (massing.rs): eave (m, before the body scale),
/// roof kind, cover/wall overrides and stilts.
pub(super) struct Look { pub eave: f64, pub roof: &'static str, pub cover: Option<&'static str>, pub wall: Option<&'static str>, pub stilts: f64 }

fn roof_kind(r: &str) -> &'static str {
    match r {
        "flat" => "flat",
        "hip" | "tiled-hip" => "hip",
        "conical" | "thatch-round" | "cone" => "cone",
        "pyramidal" | "pyramid" => "pyramid",
        "dome" => "dome",
        "barrel" => "barrel",
        "shed" => "shed",
        _ => "gable",
    }
}

pub(super) fn look(culture: &str, seed: &str, label: &str, rng: &mut Rng) -> Look {
    let d = data();
    let b = &d["buildings"][label];
    let t = &d["types"][farm_type(culture, seed)];
    let (lo, hi) = pair(&b["eave"]);
    let base = roof_kind(t["roof"].as_str().unwrap_or("gable"));
    let roof = if let Some(r) = t["roofs"][label].as_str() { roof_kind(r) }
        else if let Some(r) = b["roof"].as_str() { roof_kind(r) }
        else if b["lean"].as_bool() == Some(true) && matches!(base, "gable" | "hip") { "shed" }
        else if b["round"].as_bool() == Some(true) && !matches!(base, "cone" | "dome" | "pyramid") { "cone" }
        else { base };
    Look { eave: rng.range(lo, hi.max(lo)), roof, cover: b["cover"].as_str(), wall: b["wall"].as_str(), stilts: b["stilts"].as_f64().unwrap_or(0.0) }
}

// ---------------------------------------------------------------- placement

fn hull(pts: &[Point]) -> Vec<Point> {
    let mut p: Vec<Point> = pts.to_vec();
    p.sort_by(|a, b| a.x.total_cmp(&b.x).then(a.y.total_cmp(&b.y)));
    if p.len() < 3 { return p; }
    let cr = |o: Point, a: Point, b: Point| (a.x - o.x) * (b.y - o.y) - (a.y - o.y) * (b.x - o.x);
    let mut h: Vec<Point> = Vec::with_capacity(2 * p.len());
    for pass in 0..2 {
        let start = h.len();
        for &q in if pass == 0 { p.iter().collect::<Vec<_>>() } else { p.iter().rev().collect() }.iter() {
            while h.len() >= start + 2 && cr(h[h.len() - 2], h[h.len() - 1], *q) <= 0.0 { h.pop(); }
            h.push(*q);
        }
        h.pop();
    }
    h
}
/// Separating-axis test between convex rings: true when they stay `gap` apart (a negative gap lets them touch).
fn apart(a: &[Point], b: &[Point], gap: f64) -> bool {
    for r in [a, b] {
        for i in 0..r.len() {
            let (p, q) = (r[i], r[(i + 1) % r.len()]);
            let (nx, ny) = (q.y - p.y, p.x - q.x);
            let l = nx.hypot(ny);
            if l < 1e-9 { continue; }
            let span = |s: &[Point]| s.iter().map(|v| (v.x * nx + v.y * ny) / l).fold((f64::MAX, f64::MIN), |m, x| (m.0.min(x), m.1.max(x)));
            let (a0, a1) = span(a);
            let (b0, b1) = span(b);
            if a1 + gap <= b0 || b1 + gap <= a0 { return true; }
        }
    }
    false
}

struct Frame { c: Point, u: Point, v: Point }
impl Frame {
    fn at(&self, s: f64, t: f64) -> Point { Point { x: self.c.x + self.u.x * s + self.v.x * t, y: self.c.y + self.u.y * s + self.v.y * t } }
    fn local(&self, p: Point) -> (f64, f64) { let (dx, dy) = (p.x - self.c.x, p.y - self.c.y); (dx * self.u.x + dy * self.u.y, dx * self.v.x + dy * self.v.y) }
    /// Rectangle w (along the angle) × d centred at (s, t), turned by `ang` from u; a round body is a 12-gon of diameter w.
    fn body(&self, s: f64, t: f64, ang: f64, w: f64, d: f64, round: bool) -> Vec<Point> {
        let (ca, sa) = (ang.cos(), ang.sin());
        let loc = |x: f64, y: f64| self.at(s + x * ca - y * sa, t + x * sa + y * ca);
        if round { (0..12).map(|k| { let a = k as f64 * std::f64::consts::TAU / 12.0; loc(0.5 * w * a.cos(), 0.5 * w * a.sin()) }).collect() }
        else { vec![loc(-w / 2.0, -d / 2.0), loc(w / 2.0, -d / 2.0), loc(w / 2.0, d / 2.0), loc(-w / 2.0, d / 2.0)] }
    }
}

/// Inflated ring (each vertex pushed `m` away from the centre) for the lot clearance.
fn inflated(r: &[Point], m: f64) -> Vec<Point> {
    let c = Point { x: r.iter().map(|p| p.x).sum::<f64>() / r.len() as f64, y: r.iter().map(|p| p.y).sum::<f64>() / r.len() as f64 };
    r.iter().map(|p| { let (dx, dy) = (p.x - c.x, p.y - c.y); let l = dx.hypot(dy).max(1e-9); Point { x: p.x + dx / l * m, y: p.y + dy / l * m } }).collect()
}
fn within(lot: &Shape, r: &[Point]) -> bool {
    let r = inflated(r, 0.7);
    (0..r.len()).all(|i| g::segment_within(lot, r[i], r[(i + 1) % r.len()]))
}

/// Whether a dwelling lot is rural and builds a farmstead: `Some(true)` a working
/// farm (its full type), `Some(false)` a smallholding (one or two small outbuildings).
/// A settlement under 1 000 inhabitants (hamlet, village) is rural whatever its zones.
pub(super) fn rural(zone: &str, role: &str, landmark: bool, camp: bool, area: f64, population: u32) -> Option<bool> {
    let rural_zone = matches!(zone, "village" | "hamlet" | "rural") || zone == "faubourg" && area >= 1200.0 || population > 0 && population < 1000;
    let home = role.starts_with("dwelling") && !["tenement", "mansion", "townhouse", "shop"].iter().any(|k| role.contains(k));
    if !rural_zone || !home || landmark || camp || area < 220.0 { return None; }
    Some(role.starts_with("dwelling.farm") || matches!(zone, "hamlet" | "rural") || area >= 900.0)
}

/// Index of the farmhouse body among the lot's pieces: the `building` its other home
/// parts (wings, porches, outshots…) stand against, else the first `building` (the
/// occupation lays the house before its stock barn), else the largest home part,
/// else the largest piece.
fn house_body(parts: &[(Shape, &'static str)], hulls: &[Vec<Point>]) -> Option<usize> {
    let home = |l: &str| super::forms::plan::is_house_part(l);
    let annexes = |i: usize| (0..parts.len()).filter(|&j| j != i && home(parts[j].1) && parts[j].1 != "building" && !apart(&hulls[i], &hulls[j], 0.3)).count();
    let largest = |keep: &dyn Fn(usize) -> bool| (0..parts.len()).filter(|&i| keep(i)).max_by(|&a, &b| g::area(&parts[a].0).total_cmp(&g::area(&parts[b].0)));
    (0..parts.len()).filter(|&i| parts[i].1 == "building")
        // The most annexes, then the first laid.
        .max_by_key(|&i| (annexes(i), std::cmp::Reverse(i)))
        .or_else(|| largest(&|i: usize| home(parts[i].1)))
        .or_else(|| largest(&|_: usize| true))
}

static NANOS: std::sync::atomic::AtomicU64 = std::sync::atomic::AtomicU64::new(0);
/// CPU time spent placing farmsteads since the start (URBAN_PROFILE).
static CALLS: std::sync::atomic::AtomicU64 = std::sync::atomic::AtomicU64::new(0);
pub(super) fn cpu_ms() -> (f64, u64) { (NANOS.load(std::sync::atomic::Ordering::Relaxed) as f64 / 1e6, CALLS.load(std::sync::atomic::Ordering::Relaxed)) }

/// Adds the farmstead's outbuildings to the lot's pieces. The house is the
/// occupation's home: its body (`house_body`) and every home part standing against
/// it; with `replace` (a farm role) every other piece, the occupation's stock barn
/// first, gives way to the type's buildings. `ancillary` false lays only the
/// type's core buildings (nothing on a smallholding, which has none).
/// Returns the cluster for the yard builder: type, layout, enclosure kind, yard hint.
#[allow(clippy::too_many_arguments)]
pub(super) fn build(parts: &mut Vec<(Shape, &'static str)>, lot: &Shape, culture: &str, farm: bool, replace: bool, wealth: f64, seed: &str, ancillary: bool) -> Option<Value> {
    #[cfg(not(target_arch = "wasm32"))]
    let tick = std::time::Instant::now();
    let out = place(parts, lot, culture, farm, replace, wealth, seed, ancillary);
    #[cfg(not(target_arch = "wasm32"))]
    NANOS.fetch_add(tick.elapsed().as_nanos() as u64, std::sync::atomic::Ordering::Relaxed);
    #[cfg(not(target_arch = "wasm32"))]
    CALLS.fetch_add(1, std::sync::atomic::Ordering::Relaxed);
    out
}
#[allow(clippy::too_many_arguments)]
fn place(parts: &mut Vec<(Shape, &'static str)>, lot: &Shape, culture: &str, farm: bool, replace: bool, wealth: f64, seed: &str, ancillary: bool) -> Option<Value> {
    if !farm && !ancillary { return None; }
    // The home: the body and the pieces standing against it (its wings, porches,
    // outshots, a second body range). A farm role keeps only those.
    let all: Vec<Vec<Point>> = parts.iter().map(|(s, _)| hull(&s.outer)).collect();
    let body = house_body(parts, &all)?;
    let home: Vec<bool> = (0..parts.len()).map(|i| i == body || super::forms::plan::is_house_part(parts[i].1) && !apart(&all[body], &all[i], 0.3)).collect();
    let mut mi = body;
    if replace && parts.len() > 1 {
        mi = home[..body].iter().filter(|&&h| h).count();
        let mut keep = home.iter();
        parts.retain(|_| *keep.next().unwrap_or(&false));
    }
    let home: Vec<bool> = if replace { vec![true; parts.len()] } else { home };
    let d = data();
    let kind = farm_type(culture, seed);
    let ty = &d["types"][kind];
    let layout = ty["layout"].as_str().unwrap_or("scattered");
    let mut rng = Rng::new(seed).fork("farmstead");
    // House frame: u along the body's longest hull edge, v towards the lot's interior.
    let house = hull(&parts[mi].0.outer);
    if house.len() < 3 { return None; }
    let k = (0..house.len()).max_by(|&i, &j| {
        let l = |i: usize| { let (p, q) = (house[i], house[(i + 1) % house.len()]); (q.x - p.x).hypot(q.y - p.y) };
        l(i).total_cmp(&l(j))
    })?;
    let (p, q) = (house[k], house[(k + 1) % house.len()]);
    let l = (q.x - p.x).hypot(q.y - p.y).max(1e-9);
    let u = Point { x: (q.x - p.x) / l, y: (q.y - p.y) / l };
    let hc = g::centroid(&Shape { outer: house.clone(), holes: vec![] });
    let lc = g::interior_point(lot);
    let mut v = Point { x: -u.y, y: u.x };
    if (lc.x - hc.x) * v.x + (lc.y - hc.y) * v.y < 0.0 { v = Point { x: -v.x, y: -v.y }; }
    let mut f = Frame { c: hc, u, v };
    // Half extents in the frame: of the body (a, b), of the whole home (ha, hb).
    let (mut a, mut b) = (0.0f64, 0.0f64);
    for &h in &house { let (s, t) = f.local(h); a = a.max(s.abs()); b = b.max(t.abs()); }
    let mut hulls: Vec<Vec<Point>> = parts.iter().map(|(s, _)| hull(&s.outer)).collect();
    let (mut ha, mut hb) = (a, b);
    for (i, h) in hulls.iter().enumerate() {
        if home[i] { for &p in h { let (s, t) = f.local(p); ha = ha.max(s.abs()); hb = hb.max(t.abs()); } }
    }
    let side = if rng.chance(0.5) { 1.0 } else { -1.0 };
    f.u = Point { x: u.x * side, y: u.y * side };
    // Programme: the type's core buildings, then draws from its pool.
    let (lo, hi) = pair(&ty["outbuildings"]);
    let names = |key: &str| -> Vec<&'static str> { ty[key].as_array().map_or(vec![], |a| a.iter().filter_map(Value::as_str).filter(|l| is_outbuilding(l)).collect()) };
    let small = |l: &&str| { let b = &d["buildings"][*l]; pair(&b["width"]).1 * pair(&b["depth"]).1 <= 25.0 && pair(&b["eave"]).1 <= 3.0 };
    let mut list: Vec<&'static str> = vec![];
    if farm {
        list = names("core");
        if ancillary {
            let n = (rng.int(lo as u32, hi.max(lo) as u32) as usize + usize::from(wealth > 0.7)).saturating_sub(usize::from(wealth < 0.3)).max(list.len());
            let pool = names("ancillary");
            while list.len() < n && !pool.is_empty() { list.push(pool[rng.int(0, pool.len() as u32 - 1) as usize]); }
        }
    } else {
        let (s0, s1) = pair(&d["smallholding"]);
        let pool: Vec<_> = names("ancillary").into_iter().chain(names("core")).filter(small).collect();
        let pool = if pool.is_empty() { vec!["shed"] } else { pool };
        for _ in 0..rng.int(s0 as u32, s1.max(s0) as u32) { list.push(pool[rng.int(0, pool.len() as u32 - 1) as usize]); }
    }
    let (y0, y1) = pair(&ty["yard"]);
    let yard = rng.range(y0, y1.max(y0)) * if farm { 1.0 } else { 0.6 };
    let jitter = ty["jitter"].as_f64().unwrap_or(0.05);
    let scale = super::culture::house_parameters(culture).0 * (0.85 + 0.3 * wealth.clamp(0.0, 1.0));
    let q = std::f64::consts::FRAC_PI_2;
    // Yard centre: off the house towards the lot's room (its interior point), else behind it.
    let (ls, lt) = f.local(lc);
    let room = ls.hypot(lt);
    let (ds, dt) = if room > 1.0 { (ls / room, lt.max(-0.3 * room) / room) } else { (0.0, 1.0) };
    let reach = ha * ds.abs() + hb * dt.abs() + 0.5 * yard + 1.0;
    let (ys, yt) = (ds * reach, dt * reach);
    // Candidate spots: a grid over the lot (about 16 × 16), in the house frame.
    let (mut s0, mut s1, mut t0, mut t1) = (f64::MAX, f64::MIN, f64::MAX, f64::MIN);
    for &p in &lot.outer { let (s, t) = f.local(p); s0 = s0.min(s); s1 = s1.max(s); t0 = t0.min(t); t1 = t1.max(t); }
    let step = (((s1 - s0) * (t1 - t0)).sqrt() / 16.0).max(2.0);
    let mut grid = vec![];
    let mut s = s0 + step / 2.0;
    while s < s1 { let mut t = t0 + step / 2.0; while t < t1 { if g::contains(lot, f.at(s, t)) { grid.push((s, t)); } t += step; } s += step; }
    let (mut slot, mut placed) = (0usize, vec![]);
    for label in list {
        let bd = &d["buildings"][label];
        let (w0, w1) = pair(&bd["width"]);
        let (d0, d1) = pair(&bd["depth"]);
        let (w, dp) = (rng.range(w0, w1) * scale, rng.range(d0, d1) * scale);
        let big = w * dp > 25.0;
        // A round compound's small bodies (granaries, huts) are round too.
        let round = bd["round"].as_bool() == Some(true) || layout == "round" && !big;
        // Spots, best first: a linear farm's byre or barn under the house's
        // ridge line (at either gable end of the body, the free one when a home
        // part holds the other), a terraced one against its sides; then the
        // yard's rim (closed, U, L, round: tight; scattered and small bodies:
        // loose), long sides facing the yard, never in front of the house.
        let mut spots: Vec<(f64, f64, f64, f64, bool)> = vec![]; // score, s, t, angle, attached
        let sg = if slot % 2 == 0 { 1.0 } else { -1.0 };
        match layout {
            "linear" if big && slot < 2 => {
                spots.push((-1.0, sg * (a + w / 2.0), b - dp.min(2.0 * b) / 2.0, 0.0, true));
                spots.push((-0.9, -sg * (a + w / 2.0), b - dp.min(2.0 * b) / 2.0, 0.0, true));
            }
            "terraced" if slot < 4 => {
                spots.push((-1.0, sg * (a + w / 2.0), b - dp / 2.0 + 1.5 * (slot / 2) as f64, 0.0, true));
                spots.push((-0.5, sg * rng.range(0.0, (a - w / 2.0).max(0.0)), b + dp / 2.0, 0.0, true));
            }
            _ => {}
        }
        let rim = 0.5 * yard + 0.5 * if round { w } else { dp } + 0.8;
        let loose = layout == "scattered" || !big;
        for &(s, t) in &grid {
            let (dx, dy) = (s - ys, t - yt);
            let mut score = (dx.hypot(dy) - rim).abs();
            if loose { score = 0.5 * score + 6.0 * rng.float(); }
            if t < -b { score += 15.0; }
            let ang = if layout == "round" || loose && layout == "scattered" { (if dx.abs() > dy.abs() { q } else { 0.0 }) + rng.range(-1.0, 1.0) * jitter * std::f64::consts::PI }
                else if dx.abs() > dy.abs() { q } else { 0.0 };
            spots.push((score, s, t, ang, false));
        }
        let top = spots.len().min(28);
        if top > 0 && top < spots.len() { spots.select_nth_unstable_by(top - 1, |x, y| x.0.total_cmp(&y.0)); }
        spots[..top].sort_by(|x, y| x.0.total_cmp(&y.0));
        let mut done = false;
        'spot: for &(_, s, t, ang, attached) in &spots[..top] {
            for k in [1.0, 0.8, 0.65] {
                let ring = f.body(s, t, ang, w * k, dp * k, round);
                if !within(lot, &ring) { continue; }
                // Clear of every body; an attached one may touch the home, never enter it.
                if !hulls.iter().enumerate().all(|(i, h)| apart(h, &ring, if attached && home.get(i) == Some(&true) { -0.02 } else { 1.2 })) { continue; }
                hulls.push(ring.clone());
                parts.push((Shape { outer: g::normalized(Shape { outer: ring, holes: vec![] }).outer, holes: vec![] }, label));
                placed.push(label);
                done = true;
                break 'spot;
            }
        }
        if done && big { slot += 1; }
    }
    // Yard hint: the cluster's box in the house frame, 2.5 m around.
    (s0, s1, t0, t1) = (f64::MAX, f64::MIN, f64::MAX, f64::MIN);
    for h in &hulls { for &p in h { let (s, t) = f.local(p); s0 = s0.min(s); s1 = s1.max(s); t0 = t0.min(t); t1 = t1.max(t); } }
    let m = 2.5;
    let yard: Vec<Value> = [(s0 - m, t0 - m), (s1 + m, t0 - m), (s1 + m, t1 + m), (s0 - m, t1 + m)].iter()
        .map(|&(s, t)| { let p = f.at(s, t); json!({"x": (p.x * 100.0).round() / 100.0, "y": (p.y * 100.0).round() / 100.0}) }).collect();
    let enclosure = d["cultures"][culture]["enclosure"].as_str().or(ty["enclosure"].as_str()).unwrap_or("fence");
    Some(json!({"type": kind, "layout": layout, "farm": farm, "enclosure": enclosure, "yard": yard, "outbuildings": placed}))
}

#[cfg(test)]
mod tests {
    use super::*;
    fn rect(w: f64, h: f64) -> Shape { Shape { outer: vec![Point { x: 0.0, y: 0.0 }, Point { x: w, y: 0.0 }, Point { x: w, y: h }, Point { x: 0.0, y: h }], holes: vec![] } }
    fn house(x: f64, y: f64, w: f64, d: f64) -> Shape { Shape { outer: vec![Point { x, y }, Point { x: x + w, y }, Point { x: x + w, y: y + d }, Point { x, y: y + d }], holes: vec![] } }

    /// Every culture's farm on a large lot gets outbuildings, all inside the
    /// lot, none overlapping, all lower-footprint than the barn range; and two
    /// farms of one culture differ.
    #[test]
    fn every_culture_farm_has_outbuildings_inside_its_lot() {
        let lot = rect(45.0, 60.0);
        let cultures: Vec<String> = data()["cultures"].as_object().unwrap().keys().cloned().collect();
        let mut sigs = std::collections::HashSet::new();
        for c in &cultures {
            let mut total = 0;
            for k in 0..4 {
                let mut parts = vec![(house(15.0, 2.0, 11.0, 7.0), "building")];
                let seed = format!("{c}/{k}");
                let v = build(&mut parts, &lot, c, true, true, 0.5, &seed, true).unwrap();
                total += parts.len() - 1;
                for (i, (s, _)) in parts.iter().enumerate() {
                    for p in &s.outer { assert!(g::contains(&lot, *p), "{c}: outside"); }
                    for (t, _) in &parts[i + 1..] { assert!(g::intersection(s, t).iter().map(g::area).sum::<f64>() < 0.1, "{c}: overlap"); }
                }
                assert_eq!(v["outbuildings"].as_array().unwrap().len(), parts.len() - 1);
                sigs.insert(format!("{c}{:?}", parts.iter().map(|p| (p.1, (g::centroid(&p.0).x * 2.0).round() as i64)).collect::<Vec<_>>()));
            }
            assert!(total >= 4, "{c}: only {total} outbuildings on 4 farms");
        }
        assert!(sigs.len() >= cultures.len() * 3, "farms too alike: {} distinct of {}", sigs.len(), cultures.len() * 4);
    }

    #[test]
    fn a_village_cottage_gets_a_small_outbuilding_and_town_homes_none() {
        assert_eq!(rural("village", "dwelling.house", false, false, 400.0, 0), Some(false));
        assert_eq!(rural("middle", "dwelling.house", false, false, 400.0, 10_000), None);
        assert_eq!(rural("village", "dwelling.tenement", false, false, 900.0, 0), None);
        let mut parts = vec![(house(8.0, 1.0, 8.0, 6.0), "building")];
        build(&mut parts, &rect(24.0, 30.0), "european-organic", false, false, 0.5, "cottage", true).unwrap();
        assert!(parts.len() >= 2 && parts[1..].iter().all(|(s, _)| g::area(s) <= 25.0 * 1.2), "{:?}", parts.iter().map(|p| p.1).collect::<Vec<_>>());
    }

    /// The farmhouse keeps its body and the parts standing against it; the occupation's
    /// larger stock barn gives way to the type's buildings, laid clear of the whole home.
    /// Without the ancillary draw only the type's core buildings stand.
    #[test]
    fn the_farmhouse_keeps_its_parts_and_core_buildings_stand_alone() {
        let lot = rect(50.0, 60.0);
        for k in 0..6 {
            let seed = format!("home/{k}");
            let mut parts = vec![
                (house(15.0, 2.0, 11.0, 7.0), "building"),
                (house(26.0, 2.0, 5.0, 12.0), "wing"),
                (house(18.0, 9.0, 3.0, 2.0), "porch"),
                (house(12.0, 30.0, 16.0, 9.0), "building"),
            ];
            build(&mut parts, &lot, "european-organic", true, true, 0.5, &seed, false).unwrap();
            assert_eq!(parts[..3].iter().map(|p| p.1).collect::<Vec<_>>(), ["building", "wing", "porch"]);
            assert!((g::area(&parts[0].0) - 77.0).abs() < 1e-6, "the body is the house, not the barn");
            let core: Vec<&str> = data()["types"][farm_type("european-organic", &seed)]["core"].as_array().unwrap().iter().filter_map(Value::as_str).collect();
            assert!(parts[3..].iter().all(|p| core.contains(&p.1)) && parts.len() - 3 <= core.len(), "{:?}", parts.iter().map(|p| p.1).collect::<Vec<_>>());
            for (i, (s, _)) in parts.iter().enumerate().skip(3) {
                for (t, _) in &parts[..i] { assert!(g::intersection(s, t).iter().map(g::area).sum::<f64>() < 0.1, "overlap"); }
            }
        }
    }

    /// A lone farm's plot follows its culture's farm type and its seed.
    #[test]
    fn farm_plots_follow_the_culture_and_the_seed() {
        let plots = |c: &str| (0..8).map(|k| plot(c, &format!("{c}/{k}"))).collect::<Vec<_>>();
        // A longhouse farm is long and shallow, a compound about square.
        assert!(plots("native-iroquoian").iter().all(|&(w, d)| w > 1.4 * d));
        assert!(plots("kraal").iter().all(|&(w, d)| (w / d - 1.0).abs() < 0.35));
        let european = plots("european-organic");
        assert!(european.iter().all(|&(w, d)| (22.0..=80.0).contains(&w) && (24.0..=80.0).contains(&d)));
        let (lo, hi) = european.iter().map(|&(w, d)| w * d).fold((f64::MAX, 0.0_f64), |m, a| (m.0.min(a), m.1.max(a)));
        assert!(hi > 1.3 * lo, "plots of one culture too alike: {lo:.0}..{hi:.0}");
    }
}
