//! Ground installations of activity sites and network nodes (catalogue P5): weirs,
//! leats, quarry faces, spoil heaps, racks, piers, corrals… as flat shapes beside the
//! buildings, each with the `activities.json` ground kind of its archetype. Placed by
//! simple rules: water works on the nearest water, excavations uphill, heaps downhill,
//! landings at the shore, the rest on free ground around the yard.
use super::Point;
use super::activities::ActivityBuilding;
use super::grid::Fields;
use crate::rng::Rng;
use crate::urban::activities as act;
use serde::{Deserialize, Serialize};
use std::f64::consts::TAU;


/// The terrain an installation reads: grid size, water class and river width per cell, height.
/// Implemented by the settlement `Fields` and, for one site in City Bench, by an urban `Surface`.
pub trait Ground {
    fn width(&self) -> f64;
    fn n(&self) -> usize;
    fn water_at(&self, i: usize) -> u8;
    fn river_width_at(&self, i: usize) -> f32;
    fn height_at(&self, p: Point) -> f64;
    fn cell(&self) -> f64 {
        self.width() / self.n() as f64
    }
    fn pos(&self, i: usize) -> Point {
        let (n, c) = (self.n(), self.cell());
        Point { x: (i % n) as f64 * c + 0.5 * c, y: (i / n) as f64 * c + 0.5 * c }
    }
    fn index(&self, p: Point) -> usize {
        let (n, c) = (self.n(), self.cell());
        (p.y / c).floor().clamp(0.0, (n - 1) as f64) as usize * n + (p.x / c).floor().clamp(0.0, (n - 1) as f64) as usize
    }
}
impl Ground for Fields {
    fn width(&self) -> f64 { self.r.width }
    fn n(&self) -> usize { self.r.n }
    fn water_at(&self, i: usize) -> u8 { self.r.water[i] }
    fn river_width_at(&self, i: usize) -> f32 { self.r.river_width[i] }
    fn height_at(&self, p: Point) -> f64 { Fields::height_at(self, p) }
}

#[derive(Clone, Debug, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct Installation {
    pub archetype: String,
    /// `activities.json` ground kind: enclosure | water_structure | excavation | mound | landing…
    pub kind: String,
    /// Closed ring (area) or open polyline (weir, leat, fence line, stairs).
    pub closed: bool,
    pub points: Vec<Point>,
}

fn add(a: Point, b: Point, k: f64) -> Point {
    Point { x: a.x + b.x * k, y: a.y + b.y * k }
}
fn unit(a: Point, b: Point) -> Option<Point> {
    let d = a.distance(b);
    (d > 1e-6).then(|| Point { x: (b.x - a.x) / d, y: (b.y - a.y) / d })
}
fn perp(u: Point) -> Point {
    Point { x: -u.y, y: u.x }
}
/// Rectangle centred on `c`, `w` along `u`, `d` across.
fn rect(c: Point, u: Point, w: f64, d: f64) -> Vec<Point> {
    let v = perp(u);
    [(-1.0, -1.0), (1.0, -1.0), (1.0, 1.0), (-1.0, 1.0)].iter().map(|(a, e)| add(add(c, u, a * w / 2.0), v, e * d / 2.0)).collect()
}
/// Irregular disc (mound, pit, fenced pasture).
fn blob(c: Point, r: f64, n: usize, rng: &mut Rng) -> Vec<Point> {
    let a0 = rng.float() * TAU;
    (0..n)
        .map(|k| {
            let a = a0 + k as f64 / n as f64 * TAU;
            let rr = r * (0.8 + 0.35 * rng.float());
            Point { x: c.x + rr * a.cos(), y: c.y + rr * a.sin() }
        })
        .collect()
}
fn inside(ring: &[Point], p: Point) -> bool {
    let mut odd = false;
    for i in 0..ring.len() {
        let (a, b) = (ring[i], ring[(i + 1) % ring.len()]);
        if (a.y > p.y) != (b.y > p.y) && p.x < a.x + (p.y - a.y) / (b.y - a.y) * (b.x - a.x) {
            odd = !odd;
        }
    }
    odd
}
fn in_map(f: &dyn Ground, p: Point) -> bool {
    p.x >= 0.0 && p.y >= 0.0 && p.x < f.width() && p.y < f.width()
}
fn dry(f: &dyn Ground, p: Point) -> bool {
    in_map(f, p) && f.water_at(f.index(p)) == 0
}
/// Unit vector uphill at `c` (east on flat ground).
fn uphill(f: &dyn Ground, c: Point) -> Point {
    let s = f.cell().max(5.0);
    let h = |dx: f64, dy: f64| f.height_at(Point { x: c.x + dx, y: c.y + dy });
    let (gx, gy) = (h(s, 0.0) - h(-s, 0.0), h(0.0, s) - h(0.0, -s));
    unit(Point { x: 0.0, y: 0.0 }, Point { x: gx, y: gy }).unwrap_or(Point { x: 1.0, y: 0.0 })
}
/// Nearest water cell centre (classes in `classes`) within `radius`.
fn nearest_water(f: &dyn Ground, c: Point, radius: f64, classes: &[u8]) -> Option<(Point, usize)> {
    let n = f.n() as isize;
    let k = (radius / f.cell()).ceil() as isize;
    let (ci, cj) = ((c.x / f.cell()).floor() as isize, (c.y / f.cell()).floor() as isize);
    let mut best: Option<(f64, Point, usize)> = None;
    for j in (cj - k).max(0)..=(cj + k).min(n - 1) {
        for i in (ci - k).max(0)..=(ci + k).min(n - 1) {
            let idx = (j * n + i) as usize;
            if !classes.contains(&f.water_at(idx)) {
                continue;
            }
            let p = f.pos(idx);
            let d = p.distance(c);
            if d <= radius && best.as_ref().is_none_or(|b| d < b.0) {
                best = Some((d, p, idx));
            }
        }
    }
    best.map(|b| (b.1, b.2))
}
/// Last dry point marching from `c` toward the water point `w` (the bank).
fn bank(f: &dyn Ground, c: Point, w: Point) -> Point {
    let Some(u) = unit(c, w) else { return w };
    let d = c.distance(w);
    let mut last = c;
    let mut t = 0.0;
    while t < d {
        let p = add(c, u, t);
        if !dry(f, p) {
            return last;
        }
        last = p;
        t += 2.0;
    }
    last
}

struct Yard<'a> {
    f: &'a dyn Ground,
    centre: Point,
    /// Reach of the buildings from the centre.
    reach: f64,
    rings: Vec<&'a [Point]>,
    used: Vec<(Point, f64)>,
    avoid: &'a dyn Fn(Point) -> bool,
    base: f64,
    k: usize,
}
impl Yard<'_> {
    fn free(&self, c: Point, r: f64) -> bool {
        let probe = [c, add(c, Point { x: 1.0, y: 0.0 }, r), add(c, Point { x: -1.0, y: 0.0 }, r), add(c, Point { x: 0.0, y: 1.0 }, r), add(c, Point { x: 0.0, y: -1.0 }, r)];
        probe.iter().all(|&p| dry(self.f, p) && !(self.avoid)(p) && !self.rings.iter().any(|g| inside(g, p)))
            && self.used.iter().all(|(q, s)| q.distance(c) > r + s + 2.0)
    }
    /// Free spot of radius `r` around the yard, toward `prefer` first when given.
    fn spot(&mut self, r: f64, prefer: Option<Point>) -> Option<Point> {
        for ring in 0..4 {
            let dist = self.reach + r + 6.0 + 10.0 * ring as f64;
            for k in 0..12 {
                let a = match prefer {
                    Some(u) => u.y.atan2(u.x) + [0.0, 0.5, -0.5, 1.0, -1.0, 1.6, -1.6, 2.2, -2.2, 2.8, -2.8, 3.14][k],
                    None => self.base + (self.k + k) as f64 * 2.4,
                };
                let c = Point { x: self.centre.x + dist * a.cos(), y: self.centre.y + dist * a.sin() };
                if self.free(c, r) {
                    self.k += 1;
                    self.used.push((c, r));
                    return Some(c);
                }
            }
        }
        None
    }
    fn claim(&mut self, c: Point, r: f64) {
        self.used.push((c, r));
    }
}

/// Ground installations of a site from its archetype ids. `road`: access point on the
/// road and the road direction there (network nodes), which yards keep clear of.
pub(crate) fn lay(
    ids: &[String],
    seed: &str,
    centre: Point,
    buildings: &[ActivityBuilding],
    f: &dyn Ground,
    access: Option<Point>,
    avoid: &dyn Fn(Point) -> bool,
) -> Vec<Installation> {
    let mut rng = Rng::new(&format!("{seed}/installations"));
    let reach = buildings.iter().flat_map(|b| &b.ring).map(|p| p.distance(centre)).fold(8.0, f64::max);
    let mut y = Yard { f, centre, reach, rings: buildings.iter().map(|b| b.ring.as_slice()).collect(), used: vec![], avoid, base: rng.float() * TAU, k: 0 };
    let away = access.and_then(|a| unit(a, centre));
    let up = uphill(f, centre);
    let mut out: Vec<Installation> = vec![];
    let mut quarry: Option<Point> = None;
    let mut landings = 0;
    for id in ids {
        let Some(kind) = act::archetype(id).and_then(|a| a.ground.clone()) else { continue };
        let mut put = |closed: bool, points: Vec<Point>| {
            if points.len() >= 2 {
                out.push(Installation { archetype: id.clone(), kind: kind.clone(), closed, points });
            }
        };
        let river = |r: f64| nearest_water(f, centre, r, &[3]);
        let shore = |r: f64| nearest_water(f, centre, r, &[1, 2, 3]);
        match id.as_str() {
            "mill_weir" | "fish_weir" | "andean_rope_bridge" | "forest_trail_bridge" => {
                let Some((w, i)) = river(400.0) else { continue };
                let dir = unit(centre, w).unwrap_or(perp(up));
                let half = f.river_width_at(i).max(6.0) as f64 / 2.0 + if kind == "crossing" { 6.0 } else { 3.0 };
                if id == "fish_weir" {
                    let t = perp(dir);
                    put(false, vec![add(w, dir, -half), add(w, t, 6.0), add(w, dir, half)]);
                } else {
                    put(false, vec![add(w, dir, -half), add(w, dir, half)]);
                }
            }
            "mill_leat" | "tannery_waste_channel" | "irrigation_ditch" => {
                let to = buildings.first().map_or(centre, |b| b.ring.iter().fold(Point { x: 0.0, y: 0.0 }, |s, p| add(s, *p, 0.25)));
                match river(350.0).or_else(|| if id == "irrigation_ditch" { shore(250.0) } else { None }) {
                    Some((w, _)) => {
                        let dir = unit(centre, w).unwrap_or(up);
                        let t = perp(dir);
                        let b = bank(f, centre, w);
                        let side = if id == "tannery_waste_channel" { -1.0 } else { 1.0 };
                        put(false, vec![add(w, t, side * 45.0), add(add(b, t, side * 25.0), dir, -4.0), to]);
                    }
                    None if id == "irrigation_ditch" => {
                        let t = perp(up);
                        let c = add(centre, up, -(reach + 10.0));
                        put(false, vec![add(c, t, -40.0), add(c, t, 40.0)]);
                    }
                    None => {}
                }
            }
            "boat_ramp" | "wooden_pier" | "canoe_landing" | "log_rafting_point" | "harbour_breakwater" | "salt_pans" => {
                let Some((w, _)) = shore(if id == "salt_pans" { 700.0 } else { 450.0 }) else { continue };
                let dir = unit(centre, w).unwrap_or(up);
                let t = perp(dir);
                let b = add(bank(f, centre, w), t, 14.0 * landings as f64 - 7.0);
                landings += 1;
                match id.as_str() {
                    "wooden_pier" => put(true, rect(add(b, dir, 9.0), dir, 22.0, 3.0)),
                    "boat_ramp" => put(true, rect(b, dir, 12.0, 5.0)),
                    "harbour_breakwater" => put(false, vec![add(b, t, -30.0), add(add(b, dir, 40.0), t, -10.0), add(add(b, dir, 45.0), t, 20.0)]),
                    "salt_pans" => {
                        for row in 0..2 {
                            for col in -1..=1 {
                                let c = add(add(b, dir, -(7.0 + 9.0 * row as f64)), t, 11.0 * col as f64);
                                let pan = rect(c, t, 10.0, 8.0);
                                if pan.iter().all(|&p| dry(f, p) && !avoid(p)) {
                                    put(true, pan);
                                }
                            }
                        }
                    }
                    _ => put(true, rect(b, dir, 9.0, 4.0)),
                }
            }
            "fish_drying_racks" => {
                let prefer = shore(400.0).and_then(|(w, _)| unit(centre, w));
                let Some(c) = y.spot(8.0, prefer) else { continue };
                let u = prefer.map_or(up, perp);
                for k in -1..=1 {
                    let m = add(c, perp(u), 2.5 * k as f64);
                    put(false, vec![add(m, u, -6.0), add(m, u, 6.0)]);
                }
            }
            "fish_trap" | "stock_watering_place" | "ore_washing_pit" | "water_lift_wheel" => {
                let near = if id == "fish_trap" { shore(300.0) } else { shore(150.0) };
                let c = match near {
                    Some((w, _)) if id == "fish_trap" => w,
                    Some((w, _)) => bank(f, centre, w),
                    None if id == "fish_trap" => continue,
                    None => match y.spot(5.0, None) {
                        Some(c) => c,
                        None => continue,
                    },
                };
                put(true, if id == "stock_watering_place" || id == "water_lift_wheel" { blob(c, 3.5, 8, &mut rng) } else { rect(c, up, 6.0, 4.0) });
            }
            "open_quarry_face" | "mine_adit" | "open_mine_shaft" => {
                let (w, d) = match id.as_str() {
                    "open_quarry_face" => (34.0, 18.0),
                    "mine_adit" => (6.0, 4.0),
                    _ => (7.0, 7.0),
                };
                let mut c = add(centre, up, reach + d / 2.0 + 6.0);
                if !y.free(c, d / 2.0) {
                    match y.spot(d / 2.0, Some(up)) {
                        Some(s) => c = s,
                        None => continue,
                    }
                } else {
                    y.claim(c, d / 2.0);
                }
                if id == "open_quarry_face" {
                    quarry = Some(c);
                    // Crescent cut into the slope: the back wall bulges uphill.
                    let t = perp(up);
                    let mut ring: Vec<Point> = (0..=8).map(|k| {
                        let a = std::f64::consts::PI * k as f64 / 8.0;
                        add(add(c, t, -a.cos() * w / 2.0), up, a.sin() * d / 2.0)
                    }).collect();
                    ring.push(add(add(c, t, w / 2.0), up, -d / 2.0));
                    ring.push(add(add(c, t, -w / 2.0), up, -d / 2.0));
                    put(true, ring);
                } else {
                    put(true, rect(c, perp(up), w, d));
                }
            }
            "ore_spoil_heap" | "slag_heap" => {
                let down = Point { x: -up.x, y: -up.y };
                let r = 9.0 + 5.0 * rng.float();
                let Some(c) = y.spot(r, Some(down)) else { continue };
                put(true, blob(c, r, 9, &mut rng));
            }
            "quarry_ramp" => {
                let Some(q) = quarry else { continue };
                put(false, vec![q, add(centre, unit(centre, q).unwrap_or(up), reach * 0.6)]);
            }
            "stone_road_stairs" | "sacbe_causeway" => {
                let to = access.unwrap_or_else(|| add(centre, up, -40.0));
                put(false, vec![add(centre, unit(centre, to).unwrap_or(up), reach), to]);
            }
            "pasture_fence" => {
                let r = reach + 55.0 + 25.0 * rng.float();
                let ring = blob(centre, r, 11, &mut rng);
                if ring.iter().all(|&p| dry(f, p) && !avoid(p)) {
                    put(true, ring);
                }
            }
            "irrigated_terrace" | "paddy_bund" => {
                let t = perp(up);
                for k in 0..3 {
                    let c = add(centre, up, -(reach + 12.0 + 11.0 * k as f64));
                    if !dry(f, c) || avoid(c) {
                        break;
                    }
                    if id == "paddy_bund" {
                        put(false, vec![add(c, t, -30.0), add(c, t, 30.0)]);
                    } else {
                        put(true, rect(c, t, 50.0, 8.0));
                    }
                }
            }
            "caravan_yard" => {
                let Some(c) = y.spot(15.0, away) else { continue };
                put(true, rect(c, away.map_or(up, perp), 28.0, 26.0));
            }
            "haystack" | "charcoal_clamp" => {
                let r = if id == "haystack" { 2.5 } else { 4.5 };
                let Some(c) = y.spot(r * 3.0, None) else { continue };
                for k in 0..2 {
                    put(true, blob(add(c, perp(up), (k as f64 - 0.5) * r * 2.6), r, 8, &mut rng));
                }
            }
            _ => {
                // Generic: the ground kind's size on a free spot.
                let size = act::data().ground.get(&kind).map_or([10.0, 10.0], |g| g.size);
                let (w, d) = match id.as_str() {
                    "threshing_floor" => (14.0, 14.0),
                    "animal_corral" => (24.0, 24.0),
                    "pottery_kiln" | "lime_kiln" | "kumara_storage_pit" | "inuit_meat_cache" => (6.0, 6.0),
                    "logging_stack" => (10.0, 4.0),
                    "sawpit" => (5.0, 2.5),
                    "apiary" => (6.0, 3.0),
                    "clay_pit" => (18.0, 14.0),
                    _ => (size[0].min(40.0), size[1].min(40.0)),
                };
                let Some(c) = y.spot(w.max(d) / 2.0, None) else { continue };
                let round = matches!(id.as_str(), "threshing_floor" | "animal_corral" | "pottery_kiln" | "lime_kiln" | "clay_pit" | "kumara_storage_pit" | "inuit_meat_cache");
                put(true, if round { blob(c, w / 2.0, 10, &mut rng) } else { rect(c, perp(up), w, d) });
            }
        }
    }
    out
}

/// The installations of a site laid round its yard (`lay`), then the bodies they raise
/// (`raise`) added to the yard's buildings: every caller of a territorial site gets the
/// same heaps, kilns, racks and stacks.
#[allow(clippy::too_many_arguments)]
pub(crate) fn lay_site(
    ids: &[String],
    seed: &str,
    culture: &str,
    centre: Point,
    buildings: &mut Vec<ActivityBuilding>,
    f: &dyn Ground,
    access: Option<Point>,
    avoid: &dyn Fn(Point) -> bool,
) -> Vec<Installation> {
    let mut list = lay(ids, seed, centre, buildings, f, access, avoid);
    let objects = raise(&mut list, culture, seed, buildings, f, avoid);
    buildings.extend(objects);
    list
}

fn centroid(points: &[Point]) -> Point {
    let n = points.len().max(1) as f64;
    Point { x: points.iter().map(|p| p.x).sum::<f64>() / n, y: points.iter().map(|p| p.y).sum::<f64>() / n }
}
fn ring_area(ring: &[Point]) -> f64 {
    (0..ring.len()).map(|i| { let (a, b) = (ring[i], ring[(i + 1) % ring.len()]); a.x * b.y - b.x * a.y }).sum::<f64>().abs() / 2.0
}

/// Bodies the installations raise (activities.json `objects`), each with the massing of
/// its part label (urban/activities.rs `object_massing`) standing on its own ground, so the
/// 2D roof painter and the 3D volumes show the same heap, kiln or crane. `on`: the
/// installation's own shape (a square of the same area where the shape is irregular, made
/// round by a round rule; a strip along each leg of an open line); `in`: scattered inside
/// it; `around`: round its edge on free dry ground; `back`: along its uphill side; `edge`:
/// rails or a wall along its sides (pieces of at most `size[0]` m); `vertex`: a post at
/// each corner. An
/// installation whose archetype `replace_ground`s loses its flat shape once a body stands.
/// Bodies stay off water, off `avoid`, off the yard's buildings and off each other.
pub(crate) fn raise(list: &mut Vec<Installation>, culture: &str, seed: &str, yard: &[ActivityBuilding], f: &dyn Ground, avoid: &dyn Fn(Point) -> bool) -> Vec<ActivityBuilding> {
    let mut out: Vec<ActivityBuilding> = vec![];
    let mut keep = vec![true; list.len()];
    for (i, inst) in list.iter().enumerate() {
        let Some(a) = act::archetype(&inst.archetype).filter(|a| !a.objects.is_empty()) else { continue };
        let mut rng = Rng::new(&format!("{seed}/objects/{i}/{}", inst.archetype));
        let c = centroid(&inst.points);
        let up = uphill(f, c);
        let (u, v) = (perp(up), up);
        let reach = inst.points.iter().map(|p| p.distance(c)).fold(0.0, f64::max);
        let mut raised = 0;
        for (k, o) in a.objects.iter().enumerate() {
            let (w, d) = (o.size[0].max(0.5), o.size[1].max(0.5));
            let n = rng.int(o.count[0].min(o.count[1]), o.count[1].max(o.count[0])) as usize;
            let mut rings: Vec<Vec<Point>> = vec![];
            match o.at.as_str() {
                "on" if inst.closed && inst.points.len() == 4 => rings.push(inst.points.clone()),
                "on" if inst.closed => rings.push(rect(c, u, (ring_area(&inst.points) * 4.0 / std::f64::consts::PI).sqrt(), (ring_area(&inst.points) * 4.0 / std::f64::consts::PI).sqrt())),
                "on" => {
                    for leg in inst.points.windows(2) {
                        if let Some(t) = unit(leg[0], leg[1]) {
                            rings.push(rect(add(leg[0], t, leg[0].distance(leg[1]) / 2.0), t, leg[0].distance(leg[1]), d));
                        }
                    }
                }
                "in" if inst.closed => {
                    // A grid of spots across the shape, in its frame; `n` of them spread evenly.
                    let step = w.max(d) + 1.2;
                    let (s0, s1) = inst.points.iter().map(|p| (p.x - c.x) * u.x + (p.y - c.y) * u.y).fold((f64::MAX, f64::MIN), |(a, b), s| (a.min(s), b.max(s)));
                    let (t0, t1) = inst.points.iter().map(|p| (p.x - c.x) * v.x + (p.y - c.y) * v.y).fold((f64::MAX, f64::MIN), |(a, b), t| (a.min(t), b.max(t)));
                    let mut spots = vec![];
                    let mut t = t0 + step / 2.0;
                    while t <= t1 - step / 2.0 + 1e-6 {
                        let mut s = s0 + step / 2.0;
                        while s <= s1 - step / 2.0 + 1e-6 {
                            let ring = rect(add(add(c, u, s), v, t), u, w, d);
                            if ring.iter().all(|&p| inside(&inst.points, p)) {
                                spots.push(ring);
                            }
                            s += step;
                        }
                        t += step;
                    }
                    // A shape too small for the grid takes one body at its centre.
                    if spots.is_empty() {
                        spots.push(rect(c, u, w, d));
                    }
                    let take = n.clamp(1, spots.len());
                    rings.extend((0..take).map(|j| spots[j * spots.len() / take].clone()));
                }
                "edge" => {
                    // Rails or a low wall along every side (an open line's legs), cut into pieces of
                    // at most `w` m so each stands on its own ground.
                    let pts = &inst.points;
                    let legs: Vec<(Point, Point)> = if inst.closed { (0..pts.len()).map(|i| (pts[i], pts[(i + 1) % pts.len()])).collect() } else { pts.windows(2).map(|l| (l[0], l[1])).collect() };
                    for (p, q) in legs {
                        let Some(t) = unit(p, q) else { continue };
                        let len = p.distance(q);
                        let pieces = (len / w).ceil().max(1.0) as usize;
                        for j in 0..pieces {
                            rings.push(rect(add(p, t, len * (j as f64 + 0.5) / pieces as f64), t, len / pieces as f64, d));
                        }
                    }
                }
                "vertex" => rings.extend(inst.points.iter().map(|&p| rect(p, u, w, d))),
                "back" => {
                    let top = inst.points.iter().map(|p| (p.x - c.x) * v.x + (p.y - c.y) * v.y).fold(0.0, f64::max);
                    let span = inst.points.iter().map(|p| ((p.x - c.x) * u.x + (p.y - c.y) * u.y).abs()).fold(0.0, f64::max) * 2.0;
                    rings.push(rect(add(c, v, top + d / 2.0 - 1.0), u, w.min(0.9 * span.max(w * 0.5)), d));
                }
                "around" => {
                    let a0 = rng.float() * TAU;
                    let radius = reach + w.max(d) / 2.0 + 2.5;
                    for j in 0..12 {
                        if rings.len() >= n {
                            break;
                        }
                        // Spread first, then fill the gaps.
                        let a = a0 + TAU * (j as f64 * 0.618_033_988_75).fract();
                        let at = Point { x: c.x + radius * a.cos(), y: c.y + radius * a.sin() };
                        // Long bodies (racks, stacks) lie along the edge.
                        let along = Point { x: -a.sin(), y: a.cos() };
                        rings.push(rect(at, along, w, d));
                        let ring = rings.last().unwrap();
                        let clear = ring.iter().chain(std::iter::once(&at)).all(|&p| dry(f, p) && !avoid(p))
                            && !yard.iter().chain(&out).any(|b| b.ring.iter().any(|&q| inside(ring, q)) || ring.iter().any(|&q| inside(&b.ring, q)))
                            && !list.iter().any(|g| g.closed && g.kind != "enclosure" && ring.iter().any(|&q| inside(&g.points, q)))
                            && !rings[..rings.len() - 1].iter().any(|r| r.iter().any(|&q| inside(ring, q)) || ring.iter().any(|&q| inside(r, q)));
                        if !clear {
                            rings.pop();
                        }
                    }
                }
                _ => {}
            }
            // Rails, posts and dams follow the installation's own line, which `lay` already put
            // where it belongs (a weir across its river, a trap in the water).
            let wet = matches!(o.at.as_str(), "edge" | "vertex");
            for (j, ring) in rings.into_iter().enumerate() {
                if !(wet || ring.iter().all(|&p| dry(f, p))) || yard.iter().any(|b| b.ring.iter().any(|&q| inside(&ring, q)) || ring.iter().any(|&q| inside(&b.ring, q))) {
                    continue;
                }
                let ground = f.height_at(centroid(&ring));
                let massing = act::object_massing(&o.part, culture, &ring, ground, &format!("{seed}/objects/{i}/{k}/{j}"));
                if massing.as_array().is_none_or(|m| m.is_empty()) {
                    continue;
                }
                out.push(ActivityBuilding { archetype: inst.archetype.clone(), look: o.part.clone(), ring, massing });
                raised += 1;
            }
        }
        if a.replace_ground && raised > 0 {
            keep[i] = false;
        }
    }
    let mut k = 0;
    list.retain(|_| { k += 1; keep[k - 1] });
    out
}
