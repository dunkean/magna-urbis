//! Harbour furniture: what makes a waterfront read as a harbour.
//!
//! The harbour planner (`macroplan::harbour`) builds the quays, piers and
//! moles of a port as streets and platforms. This stage runs last and adds,
//! on the finished waterfront, what a viewer recognises: jetties and pontoon
//! combs, slipways and boat sheds, a breakwater with its light and the calm
//! basin behind it, the coping of the quay wall, landing steps, cranes on
//! their stages, cargo, mooring posts, and above all boats (moored alongside,
//! stern to the quay, drawn up on the shore or at anchor), in the shapes of
//! the town's culture.
//!
//! What is added follows a harbour type (merchant quays, fishing harbour,
//! small-craft basin, shipyard, river staithe, canal port, mole harbour,
//! naval arsenal, timber port, ferry landing, beach landing, stepped landing)
//! drawn with the town seed from the types its culture family builds on that
//! water (`harbours.json`); a larger port combines two types on two parts of
//! its quays. `LayoutConfig::port_type` forces a type, or `bare` keeps the
//! quays and piers alone.
//!
//! The draw (`choose`) uses the town seed alone, so the planner reads it too:
//! `harbour::typed_works` keeps its pair of moles (the rectangular basin) only
//! for the types that build one (`types.<id>.moles`, a probability), and a
//! mole harbour without the pair gets a single breakwater here.
//!
//! Every item is one `Quay` polygon appended to `structure.quays` (`kind`,
//! `material`): the 2D plan and the 3D city read the same list
//! (`web/src/render/harbourStyle.ts`). Rules, all checked against the water
//! mask: an item over water stands wholly on clear water, never under a
//! bridge nor across a pier. A river reach (the town's river, or the river
//! crossing a sea port) is a river staithe whatever the type: boats moored
//! alongside the bank, parallel to the flow, no breakwater or anchorage,
//! stages and slips only on wide water and short of a quarter of the channel;
//! under 25 m it is a landing (posts, steps, two or three small boats).
//! Counts are bounded by the port's size.
use super::macroplan::harbour::{self, Quay};
use super::{Layout, LayoutConfig, Point, Shape, Street, Surface};
use serde_json::Value;
use std::sync::OnceLock;

mod canals;
use canals::{canal_boats, mean};
mod landings;
use landings::{TOWN_PORT, family_of, landing, shore_landing, simple_landing, small_craft};
#[cfg(test)]
use landings::FOOTPATH_GRADE;
mod shore;
use shore::furnish_shore;
#[cfg(test)]
mod tests;

/// Platform kinds of the harbour planner; every other kind is furniture.
const PLATFORM_KINDS: [&str; 4] = ["quay", "landing", "pier", "mole"];
const MAX_BOATS: usize = 48;
const MAX_POSTS: usize = 40;
const MAX_CARGO: usize = 36;
const MAX_FRONTS: usize = 64;
const MAX_KERBS: usize = 90;

fn data() -> &'static Value {
    static DATA: OnceLock<Value> = OnceLock::new();
    DATA.get_or_init(|| serde_json::from_str(include_str!("harbours.json")).expect("harbours.json"))
}
fn num(v: &Value, key: &str, default: f64) -> f64 {
    v[key].as_f64().unwrap_or(default)
}
fn text<'a>(v: &'a Value, key: &str, default: &'a str) -> &'a str {
    v[key].as_str().unwrap_or(default)
}

fn dist(a: Point, b: Point) -> f64 {
    (a.x - b.x).hypot(a.y - b.y)
}
fn add(p: Point, d: Point, s: f64) -> Point {
    Point { x: p.x + d.x * s, y: p.y + d.y * s }
}
fn left(t: Point) -> Point {
    Point { x: -t.y, y: t.x }
}
fn neg(t: Point) -> Point {
    Point { x: -t.x, y: -t.y }
}
fn rotate(t: Point, angle: f64) -> Point {
    let (s, c) = angle.sin_cos();
    Point { x: t.x * c - t.y * s, y: t.x * s + t.y * c }
}
fn bbox(ring: &[Point]) -> (f64, f64, f64, f64) {
    ring.iter().fold((f64::INFINITY, f64::INFINITY, f64::NEG_INFINITY, f64::NEG_INFINITY), |b, p| {
        (b.0.min(p.x), b.1.min(p.y), b.2.max(p.x), b.3.max(p.y))
    })
}
fn inside(ring: &[Point], p: Point) -> bool {
    let mut odd = false;
    let mut j = ring.len().wrapping_sub(1);
    for i in 0..ring.len() {
        let (a, b) = (ring[i], ring[j]);
        if (a.y > p.y) != (b.y > p.y) && p.x < (b.x - a.x) * (p.y - a.y) / (b.y - a.y) + a.x {
            odd = !odd;
        }
        j = i;
    }
    odd
}

fn octagon(c: Point, radius: f64) -> Shape {
    let outer = (0..8).map(|k| add(c, rotate(Point { x: 1.0, y: 0.0 }, k as f64 * std::f64::consts::FRAC_PI_4), radius)).collect();
    Shape { outer, holes: vec![] }
}

/// Seeded generator (FNV-1a of the key, then xorshift64*): the harbour of a
/// town depends on its seed and key only.
struct Rng(u64);
impl Rng {
    fn new(key: &str) -> Self {
        let hash = key.bytes().fold(0xcbf29ce484222325u64, |h, b| (h ^ b as u64).wrapping_mul(0x100000001b3));
        let mut rng = Rng(hash | 1);
        for _ in 0..4 {
            rng.unit();
        }
        rng
    }
    /// Uniform in [0, 1).
    fn unit(&mut self) -> f64 {
        let mut x = self.0;
        x ^= x >> 12;
        x ^= x << 25;
        x ^= x >> 27;
        self.0 = x;
        (x.wrapping_mul(0x2545F4914F6CDD1D) >> 11) as f64 / (1u64 << 53) as f64
    }
    fn range(&mut self, a: f64, b: f64) -> f64 {
        a + (b - a) * self.unit()
    }
    fn chance(&mut self, p: f64) -> bool {
        self.unit() < p
    }
}
fn pick<'a>(rng: &mut Rng, options: &[(&'a str, f64)]) -> Option<&'a str> {
    let total: f64 = options.iter().map(|o| o.1.max(0.0)).sum();
    if total <= 0.0 {
        return None;
    }
    let mut x = rng.unit() * total;
    for &(name, weight) in options {
        let weight = weight.max(0.0);
        if x < weight {
            return Some(name);
        }
        x -= weight;
    }
    options.last().map(|o| o.0)
}

/// Oriented rectangle: centre, unit long axis, half length and half width.
#[derive(Clone, Copy, Debug)]
struct Obb {
    c: Point,
    u: Point,
    hl: f64,
    hw: f64,
}
impl Obb {
    fn corners(&self) -> [Point; 4] {
        let n = left(self.u);
        [
            add(add(self.c, self.u, -self.hl), n, -self.hw),
            add(add(self.c, self.u, self.hl), n, -self.hw),
            add(add(self.c, self.u, self.hl), n, self.hw),
            add(add(self.c, self.u, -self.hl), n, self.hw),
        ]
    }
    fn shape(&self) -> Shape {
        Shape { outer: self.corners().to_vec(), holes: vec![] }
    }
    fn samples(&self) -> [Point; 9] {
        let n = left(self.u);
        let k = self.corners();
        [
            self.c,
            k[0],
            k[1],
            k[2],
            k[3],
            add(self.c, self.u, self.hl),
            add(self.c, self.u, -self.hl),
            add(self.c, n, self.hw),
            add(self.c, n, -self.hw),
        ]
    }
    fn contains(&self, p: Point) -> bool {
        let (dx, dy) = (p.x - self.c.x, p.y - self.c.y);
        (dx * self.u.x + dy * self.u.y).abs() <= self.hl && (dy * self.u.x - dx * self.u.y).abs() <= self.hw
    }
    fn overlaps(&self, other: &Obb) -> bool {
        if dist(self.c, other.c) > self.hl.hypot(self.hw) + other.hl.hypot(other.hw) {
            return false;
        }
        let (a, b) = (self.corners(), other.corners());
        for axis in [self.u, left(self.u), other.u, left(other.u)] {
            let span = |k: &[Point; 4]| {
                k.iter()
                    .map(|p| p.x * axis.x + p.y * axis.y)
                    .fold((f64::INFINITY, f64::NEG_INFINITY), |(lo, hi), v| (lo.min(v), hi.max(v)))
            };
            let (a0, a1) = span(&a);
            let (b0, b1) = span(&b);
            if a1 < b0 || b1 < a0 {
                return false;
            }
        }
        true
    }
}

/// Plan of a hull, first vertex at the bow: half-beam factors at seven
/// stations from bow to stern, by hull form.
fn hull(c: Point, bow: Point, length: f64, beam: f64, form: &str) -> Shape {
    const STATIONS: [f64; 7] = [1.0, 0.92, 0.8, 0.6, 0.35, 0.12, 0.0];
    let profile: [f64; 7] = match form {
        "barge" => [0.62, 0.92, 1.0, 1.0, 1.0, 0.95, 0.7],
        "transom" => [0.0, 0.5, 0.82, 1.0, 0.98, 0.9, 0.7],
        "double" => [0.0, 0.42, 0.76, 1.0, 0.8, 0.45, 0.0],
        "galley" => [0.0, 0.35, 0.7, 1.0, 0.9, 0.6, 0.3],
        _ => [0.0, 0.55, 0.86, 1.0, 0.95, 0.75, 0.35],
    };
    let side = left(bow);
    let at = |i: usize, s: f64| add(add(c, bow, (STATIONS[i] - 0.5) * length), side, s * profile[i] * beam * 0.5);
    let mut outer = Vec::with_capacity(14);
    for i in 0..7 {
        outer.push(at(i, 1.0));
    }
    for i in (0..7).rev() {
        if profile[i] > 1e-9 {
            outer.push(at(i, -1.0));
        }
    }
    Shape { outer, holes: vec![] }
}

/// One straight reach of a quay with its water side.
#[derive(Clone, Copy, Debug)]
struct Front {
    a: Point,
    /// Unit direction along the quay, and unit normal towards the water.
    t: Point,
    n: Point,
    /// Half width of the quay street.
    half: f64,
    len: f64,
    /// Open water in front of the quay (m, capped at 160).
    open: f64,
    /// Water kind of `harbour::water_code`: 1 sea, 2 lake, 3 river.
    code: u8,
}
/// The part `[s0, s1]` of a front given to one harbour type.
#[derive(Clone, Copy, Debug)]
struct Reach {
    f: Front,
    s0: f64,
    s1: f64,
}
/// Width under which a river reach is a simple landing: posts, steps and a
/// few small boats alongside; no stage, crane, slip or raft (m).
const NARROW_RIVER: f64 = 25.0;
/// Water narrower than this between the quay and the drawn opposite bank is
/// a channel, whatever its raster code (m).
const CHANNEL_WIDTH: f64 = 100.0;
/// Width under which a river takes no slipway: a hull drawn square to the
/// flow would block it (m).
const SLIP_RIVER: f64 = 120.0;
/// Shortest reach of a quay: shorter path segments (a quay following a
/// curved bank) are merged along their chord (m).
const REACH_MIN: f64 = 12.0;
impl Front {
    /// A river or canal reach: the town stands on one, or this reach fronts
    /// one (a sea port also lines the river that crosses it). Boats lie
    /// alongside, parallel to the flow, and nothing reaches far into the
    /// channel.
    /// The drawn opposite bank within `CHANNEL_WIDTH` counts too: near its
    /// mouth a river can be coded as sea in the raster.
    fn channel(&self, site_channel: bool) -> bool {
        site_channel || self.code == 3 || self.open < CHANNEL_WIDTH
    }
    fn narrow(&self, site_channel: bool) -> bool {
        self.channel(site_channel) && self.open < NARROW_RIVER
    }
}
/// Consecutive reaches passing `keep` (each starting within 2 m of where the
/// previous one ends) merged into one straight reach along their chord, its
/// water side that of its reaches, its open water the least of theirs. A
/// breakwater is laid along a whole front, not along one piece of it.
fn runs(reaches: &[Reach], keep: impl Fn(&Reach) -> bool) -> Vec<Reach> {
    let start = |r: &Reach| add(r.f.a, r.f.t, r.s0);
    let end = |r: &Reach| add(r.f.a, r.f.t, r.s1);
    let merged = |group: &[Reach]| -> Option<Reach> {
        let (first, last) = (group.first()?, group.last()?);
        let (a, b) = (start(first), end(last));
        let len = dist(a, b);
        if len < 1.0 {
            return None;
        }
        let t = Point { x: (b.x - a.x) / len, y: (b.y - a.y) / len };
        let side = group.iter().fold(Point { x: 0.0, y: 0.0 }, |s, r| Point { x: s.x + r.f.n.x, y: s.y + r.f.n.y });
        let n = if left(t).x * side.x + left(t).y * side.y >= 0.0 { left(t) } else { neg(left(t)) };
        let open = group.iter().map(|r| r.f.open).fold(f64::INFINITY, f64::min);
        Some(Reach { f: Front { a, t, n, half: first.f.half, len, open, code: first.f.code }, s0: 0.0, s1: len })
    };
    let (mut out, mut group): (Vec<Reach>, Vec<Reach>) = (vec![], vec![]);
    for r in reaches {
        let joined = group.last().is_some_and(|last| dist(end(last), start(r)) <= 2.0);
        if !keep(r) || !joined {
            out.extend(merged(&group));
            group.clear();
        }
        if keep(r) {
            group.push(*r);
        }
    }
    out.extend(merged(&group));
    out
}
/// The reach at distance `d` along the reaches laid end to end, and the
/// position on its front.
fn locate_reach(reaches: &[Reach], mut d: f64) -> Option<(Reach, f64)> {
    for r in reaches {
        let len = r.s1 - r.s0;
        if d <= len {
            return Some((*r, r.s0 + d.max(0.0)));
        }
        d -= len;
    }
    None
}
fn locate(reaches: &[Reach], mut d: f64) -> Option<(Front, f64)> {
    for r in reaches {
        let len = r.s1 - r.s0;
        if d <= len {
            return Some((r.f, r.s0 + d.max(0.0)));
        }
        d -= len;
    }
    None
}

/// The harbour chosen for a town and its furniture.
#[derive(Clone, Debug, Default)]
#[cfg_attr(not(test), allow(dead_code))]
pub(super) struct Plan {
    /// `sea`, `lake`, `river` or `lagoon`; empty without a water front.
    pub site: &'static str,
    pub family: &'static str,
    /// One or two harbour types of `harbours.json`.
    pub types: Vec<&'static str>,
    pub items: Vec<Quay>,
}

struct Builder<'a> {
    surface: Surface<'a>,
    /// Existing platforms: boxes and outlines.
    platforms: Vec<((f64, f64, f64, f64), &'a Shape)>,
    /// New platforms: the water they cover is no longer clear.
    solid: Vec<Obb>,
    /// Whatever a new item may not overlap (water works, boats, new platforms).
    occupied: Vec<Obb>,
    items: Vec<Quay>,
    rng: Rng,
    stone: bool,
    has_mole: bool,
    boats: usize,
    boat_cap: usize,
    posts: usize,
    cargo: usize,
    /// Water level of every item of a plain landing, read once from its bank
    /// (`None`: each item reads its own).
    level_at: Option<f64>,
}

impl<'a> Builder<'a> {
    fn in_platform(&self, p: Point) -> bool {
        self.platforms.iter().any(|(b, s)| p.x >= b.0 && p.x <= b.2 && p.y >= b.1 && p.y <= b.3 && inside(&s.outer, p))
            || self.solid.iter().any(|o| o.contains(p))
    }
    /// Water inside the map, free of platforms.
    fn clear(&self, p: Point) -> bool {
        let w = self.surface.width;
        p.x > 2.0 && p.y > 2.0 && p.x < w - 2.0 && p.y < w - 2.0 && self.surface.wet(p) && !self.in_platform(p)
    }
    /// Wholly on clear water and across nothing.
    fn free(&self, o: &Obb) -> bool {
        o.samples().iter().all(|&p| self.clear(p)) && !self.occupied.iter().any(|b| b.overlaps(o))
    }
    /// Bank-height fallback of the planner (`harbour::platforms`); retained
    /// terrain replaces it with the physical water level.
    fn level(&self, points: &[Point]) -> f64 {
        if let Some(level) = self.level_at {
            return level;
        }
        let wet = points
            .iter()
            .filter(|&&p| self.surface.wet(p))
            .map(|&p| self.surface.height_at(p))
            .fold(f64::INFINITY, f64::min);
        if wet.is_finite() {
            wet
        } else {
            points.iter().map(|&p| self.surface.height_at(p)).fold(f64::INFINITY, f64::min)
        }
    }
    fn push(&mut self, kind: &str, material: &str, shape: Shape, deck: f64) {
        if deck.is_finite() {
            self.items.push(Quay { kind: kind.into(), shape, deck_z_m: deck, material: material.into() });
        }
    }
    fn emit(&mut self, kind: &str, material: &str, shape: Shape) {
        let deck = self.level(&shape.outer) + 1.0;
        self.push(kind, material, shape, deck);
    }
    /// Distance from `p` along `n` to the first clear water, searched from
    /// the quay edge (`from`) over the apron and two raster cells.
    fn edge(&self, p: Point, n: Point, from: f64) -> Option<f64> {
        let reach = from + 26.0 + 2.0 * self.surface.width / self.surface.n.max(1) as f64;
        let mut d = (from - 2.0).max(0.5);
        while d <= reach {
            if self.clear(add(p, n, d)) {
                return Some(d);
            }
            d += 0.5;
        }
        None
    }
    fn fronts(&self, streets: &[Street]) -> Vec<Front> {
        let mut out = vec![];
        for s in streets.iter().filter(|s| s.role == "quay" && s.path.len() >= 2) {
            let half = s.widths.first().copied().unwrap_or(6.0) * 0.5;
            // Reaches of at least `REACH_MIN` along their chord: a quay that
            // follows a curved bank is made of short segments, each of which
            // alone would hold no berth (the last short piece joins the
            // reach before it).
            let mut chords: Vec<(Point, Point)> = vec![];
            let mut from = s.path[0];
            for (k, &p) in s.path.iter().enumerate().skip(1) {
                let last = k + 1 == s.path.len();
                if dist(from, p) >= REACH_MIN || last {
                    match chords.last_mut() {
                        Some(previous) if last && dist(from, p) < REACH_MIN => previous.1 = p,
                        _ => chords.push((from, p)),
                    }
                    from = p;
                }
            }
            for (a, b) in chords {
                let len = dist(a, b);
                if len < 6.0 {
                    continue;
                }
                let w = [a, b];
                let t = Point { x: (w[1].x - w[0].x) / len, y: (w[1].y - w[0].y) / len };
                let mid = add(w[0], t, len * 0.5);
                let side = [left(t), neg(left(t))]
                    .into_iter()
                    .filter_map(|n| self.edge(mid, n, half).map(|d| (d, n)))
                    .min_by(|a, b| a.0.total_cmp(&b.0));
                let Some((d, n)) = side else { continue };
                let mut open = 0.0;
                while open < 160.0 && self.surface.wet(add(mid, n, d + open + 2.0)) {
                    open += 2.0;
                }
                let code = harbour::water_code(self.surface, add(mid, n, d + 1.0));
                out.push(Front { a: w[0], t, n, half, len, open, code });
            }
        }
        if out.len() > MAX_FRONTS {
            // A lagoon town lines every canal: keep its longest reaches.
            let mut lengths: Vec<f64> = out.iter().map(|f| f.len).collect();
            lengths.sort_by(|a, b| b.total_cmp(a));
            let least = lengths[MAX_FRONTS - 1];
            out.retain(|f| f.len >= least);
            out.truncate(MAX_FRONTS);
        }
        out
    }

    /// The quay wall along the water: a coping strip on the water edge of each
    /// reach, where the edge runs evenly.
    fn kerbs(&mut self, fronts: &[Front]) {
        let material = if self.stone { "stone" } else { "timber" };
        let mut built = 0;
        // One coping per stretch of waterline: two fronts on the same shore
        // (two quay streets, a sea and a river front at a mouth) never draw
        // two parallel strokes.
        let mut laid: Vec<Point> = vec![];
        for f in fronts {
            let steps = (f.len / 8.0).ceil().max(1.0) as usize;
            // Counter-clockwise rings whichever side the water lies.
            let ccw = f.t.x * f.n.y - f.t.y * f.n.x > 0.0;
            let mut previous: Option<(Point, f64)> = None;
            for k in 0..=steps {
                let root = add(f.a, f.t, f.len * k as f64 / steps as f64);
                let found = self.edge(root, f.n, f.half);
                if let (Some((from, e0)), Some(e)) = (previous, found) {
                    let (p, q) = (add(from, f.n, e0), add(root, f.n, e));
                    let mid = Point { x: (p.x + q.x) * 0.5, y: (p.y + q.y) * 0.5 };
                    // On the outer edge of the merged platform only: paving within 3 m on the land side.
                    let edge = [1.0, 2.0, 3.0].iter().any(|&d| self.in_platform(add(mid, f.n, -d)));
                    let fresh = laid.iter().all(|&m| dist(m, mid) > 2.5);
                    if (e - e0).abs() <= 2.5 && built < MAX_KERBS && edge && fresh {
                        laid.push(mid);
                        let mut outer = vec![add(p, f.n, -0.9), add(q, f.n, -0.9), add(q, f.n, 0.1), add(p, f.n, 0.1)];
                        if !ccw {
                            outer.reverse();
                        }
                        self.emit("kerb", material, Shape { outer, holes: vec![] });
                        built += 1;
                    }
                }
                previous = found.map(|e| (root, e));
            }
        }
    }

    /// A boat class of the family for a weighted role of the recipe, or the
    /// family's small boat when the berth is too short: (class, length, beam).
    fn class(
        &mut self,
        roles: &[(&'static str, f64)],
        family: &'static Value,
        max_length: f64,
        max_beam: f64,
    ) -> Option<(&'static str, f64, f64)> {
        let role = pick(&mut self.rng, roles)?;
        for role in [role, "small"] {
            let Some(id) = family["boats"][role].as_str() else { continue };
            let spec = &data()["boats"][id];
            let (length, beam) = (num(spec, "length", 0.0), num(spec, "beam", 0.0));
            if length > 0.0 && length <= max_length && beam <= max_beam {
                return Some((id, length, beam));
            }
        }
        None
    }
    /// Hull, then cabin, yards and masts of a boat (a boat on the shore keeps
    /// its hull only: its mast is lowered).
    fn boat(&mut self, kind: &str, class: &str, obb: Obb) {
        let spec = &data()["boats"][class];
        let (c, bow, length, beam) = (obb.c, obb.u, obb.hl * 2.0, obb.hw * 2.0);
        let shape = hull(c, bow, length, beam, text(spec, "hull", "round"));
        let deck = self.level(&shape.outer) + 1.0;
        if !deck.is_finite() {
            return;
        }
        self.push(kind, class, shape, deck);
        self.boats += 1;
        self.occupied.push(Obb { hl: obb.hl + 0.4, hw: obb.hw + 0.4, ..obb });
        if kind != "boat" {
            return;
        }
        let at = |t: f64| add(c, bow, (t - 0.5) * length);
        if spec["cabin"].as_bool() == Some(true) {
            let (t, hl) = if length < 10.0 { (0.45, 0.2 * length) } else { (0.17, 0.11 * length) };
            self.push("cabin", class, Obb { c: at(t), u: bow, hl, hw: beam * 0.33 }.shape(), deck);
        }
        let masts = spec["masts"].as_u64().unwrap_or(0).min(3) as usize;
        let stations: &[f64] = match masts {
            1 => &[0.56],
            2 => &[0.36, 0.7],
            3 => &[0.24, 0.5, 0.76],
            _ => &[],
        };
        let radius = (beam * 0.045).clamp(0.18, 0.4);
        for &t in stations {
            let m = at(t);
            // A furled sail on its yard, by rig.
            let yard = match text(spec, "rig", "none") {
                "square" => Some(Obb { c: m, u: left(bow), hl: beam * 0.72, hw: 0.32 }),
                "lateen" => Some(Obb { c: m, u: rotate(bow, 0.3), hl: (length * 0.3 / masts as f64).clamp(2.5, 9.0), hw: 0.3 }),
                "junk" => Some(Obb { c: m, u: rotate(bow, 0.15), hl: (length * 0.14).clamp(1.5, 4.5), hw: 0.5 }),
                _ => None,
            };
            if let Some(yard) = yard {
                self.push("yard", class, yard.shape(), deck);
            }
            self.push("mast", class, Obb { c: m, u: bow, hl: radius, hw: radius }.shape(), deck);
        }
    }
    /// A boat afloat, centred on `c`, when its berth is free.
    fn float(&mut self, class: &str, c: Point, bow: Point) -> bool {
        if self.boats >= self.boat_cap {
            return false;
        }
        let spec = &data()["boats"][class];
        let obb = Obb { c, u: bow, hl: num(spec, "length", 6.0) * 0.5, hw: num(spec, "beam", 1.6) * 0.5 };
        if !self.free(&obb) {
            return false;
        }
        self.boat("boat", class, obb);
        true
    }
    /// A boat drawn up on the shore: bow on the bank, stern afloat. `room` is
    /// the bare shore between the quay street and the water.
    fn beach(&mut self, class: &str, shore: Point, n: Point, room: f64) -> bool {
        if self.boats >= self.boat_cap {
            return false;
        }
        let spec = &data()["boats"][class];
        let (length, beam) = (num(spec, "length", 6.0), num(spec, "beam", 1.6));
        if length > 26.0 || 0.2 * length > room + 1.0 {
            return false;
        }
        let c = add(shore, n, 0.3 * length);
        let obb = Obb { c, u: neg(n), hl: length * 0.5, hw: beam * 0.5 };
        let bow = add(c, n, -0.5 * length);
        if !self.clear(add(c, n, 0.5 * length))
            || !self.clear(add(c, n, 0.2 * length))
            || self.in_platform(bow)
            || self.occupied.iter().any(|o| o.overlaps(&obb))
        {
            return false;
        }
        self.boat("boat-ashore", class, obb);
        true
    }

    /// An L-shaped breakwater from one end of the longest open reach, the calm
    /// basin behind it and a light on its head.
    fn breakwater(&mut self, reaches: &[Reach], beacon: bool) {
        // Along the longest open sea or lake front (its reaches merged), never
        // across a river or a channel (a sea port's river reach included).
        let Some(r) = runs(reaches, |r| !r.f.channel(false) && r.f.open >= 70.0)
            .into_iter()
            .filter(|r| r.s1 - r.s0 >= 30.0)
            .max_by(|a, b| (a.s1 - a.s0).total_cmp(&(b.s1 - b.s0)))
        else {
            return;
        };
        let (f, len) = (r.f, r.s1 - r.s0);
        let out = (0.5 * len + 20.0).clamp(35.0, 110.0).min(0.55 * f.open);
        let arm = (0.6 * len).min(90.0);
        let ends = if self.rng.chance(0.5) { [(r.s1, -1.0), (r.s0, 1.0)] } else { [(r.s0, 1.0), (r.s1, -1.0)] };
        for (s, direction) in ends {
            let root = add(f.a, f.t, s);
            let Some(e) = self.edge(root, f.n, f.half) else { continue };
            let along = Point { x: f.t.x * direction, y: f.t.y * direction };
            let elbow = add(root, f.n, e + out);
            let first = Obb { c: add(root, f.n, e - 1.0 + (out + 1.0) * 0.5), u: f.n, hl: (out + 1.0) * 0.5, hw: 2.5 };
            let second = Obb { c: add(elbow, along, arm * 0.5), u: along, hl: arm * 0.5 + 2.5, hw: 2.5 };
            let wet = |b: &Self, from: Point, dir: Point, l: f64| (0..=(l / 3.0) as usize).all(|k| b.clear(add(from, dir, (k as f64 * 3.0).min(l))));
            if !wet(self, add(root, f.n, e + 1.0), f.n, out - 1.0)
                || !wet(self, elbow, along, arm)
                || self.occupied.iter().any(|o| o.overlaps(&first) || o.overlaps(&second))
            {
                continue;
            }
            let quay = add(root, f.n, e);
            let basin = Shape { outer: vec![quay, add(quay, along, len), add(add(quay, along, len), f.n, out), add(quay, f.n, out)], holes: vec![] };
            self.emit("basin", "water", basin);
            self.emit("breakwater", "stone", first.shape());
            self.emit("breakwater", "stone", second.shape());
            if beacon {
                self.emit("beacon", "stone", octagon(add(elbow, along, arm), 1.7));
            }
            for o in [first, second] {
                self.solid.push(o);
                self.occupied.push(o);
            }
            self.has_mole = true;
            return;
        }
    }

    /// Jetties square to the quay, with the boats lying along them.
    fn jetties(&mut self, spec: &Value, recipe: &Value, roles: &[(&'static str, f64)], family: &'static Value, reaches: &[Reach], channel: bool) {
        let spacing = num(spec, "spacing", 40.0);
        let (lo, hi) = (spec["length"][0].as_f64().unwrap_or(8.0), spec["length"][1].as_f64().unwrap_or(16.0));
        let width = num(spec, "width", 2.4).clamp(1.5, 8.0);
        let comb = spec["comb"].as_bool() == Some(true);
        let cap = num(spec, "max", 14.0).max(1.0) as usize;
        let fill = num(recipe, "fill", 0.5);
        let cargo = text(recipe, "cargo", "");
        let material = if self.stone && width >= 4.0 { "stone" } else { "timber" };
        let mut built = 0;
        // Stations along the whole front (all its reaches end to end), so the
        // spacing holds on a quay made of many short reaches.
        let total: f64 = reaches.iter().map(|r| r.s1 - r.s0).sum();
        let count = if spacing <= 0.0 { 1 } else { ((total / spacing).floor() as usize).max(1) };
        {
            for k in 0..count {
                if built >= cap {
                    return;
                }
                let jitter = self.rng.range(-0.12, 0.12) * spacing.max(8.0).min(total);
                let Some((r, s)) = locate_reach(reaches, total * (k as f64 + 0.5) / count as f64 + jitter) else { continue };
                let len = r.s1 - r.s0;
                // A river takes short stages only, and only where it is wide.
                let channel = r.f.channel(channel);
                if len < 2.0 * width + 1.0 || channel && r.f.open < 40.0 {
                    continue;
                }
                let s = s.clamp(r.s0 + width, r.s1 - width);
                let root = add(r.f.a, r.f.t, s);
                let Some(e) = self.edge(root, r.f.n, r.f.half) else { continue };
                let wanted = self.rng.range(lo.min(hi), hi.max(lo));
                // On a river or a canal a stage reaches at most 15 % of the channel.
                let limit = r.f.open * if channel { 0.15 } else { 0.6 };
                let n = r.f.n;
                let fits = [1.0, 0.75, 0.5].into_iter().map(|k| wanted * k).find(|&l| {
                    l >= 4.0 && l <= limit && self.free(&Obb { c: add(root, n, e + 0.6 + l * 0.5), u: n, hl: l * 0.5, hw: width * 0.5 + 0.8 })
                });
                let Some(l) = fits else { continue };
                let deck = Obb { c: add(root, n, e - 0.8 + (l + 0.8) * 0.5), u: n, hl: (l + 0.8) * 0.5, hw: width * 0.5 };
                self.emit("jetty", material, deck.shape());
                self.solid.push(deck);
                self.occupied.push(deck);
                built += 1;
                if !cargo.is_empty() && width >= 2.4 && self.cargo < MAX_CARGO && self.rng.chance(0.6) {
                    self.cargo += 1;
                    self.emit("cargo", cargo, Obb { c: add(root, n, e + 1.6), u: n, hl: 0.9, hw: (width * 0.5 - 0.5).max(0.4) }.shape());
                }
                // Boats lie along the jetty: on both sides of a comb, near the head otherwise.
                // A river stage serves the boats moored alongside the bank: none lies square to the flow.
                let sides: &[f64] = if channel { &[] } else { &[1.0, -1.0] };
                for &side in sides {
                    let mut at = if comb { 1.0 } else { (l * 0.4).max(1.0) };
                    while at < l - 2.0 && self.boats < self.boat_cap {
                        let Some((class, length, beam)) = self.class(roles, family, l - at, 6.0) else { break };
                        if self.rng.chance(if comb { 0.8 } else { fill }) {
                            let c = add(add(root, n, e + at + length * 0.5), r.f.t, side * (width * 0.5 + 0.5 + beam * 0.5));
                            let bow = if self.rng.chance(0.5) { n } else { neg(n) };
                            self.float(class, c, bow);
                        }
                        at += length + 1.0;
                    }
                }
            }
        }
    }

    /// Slipways from the bank into the water, with a hull on the slip or a
    /// boat shed over it.
    fn slips(&mut self, recipe: &Value, roles: &[(&'static str, f64)], family: &'static Value, reaches: &[Reach], length: f64, channel: bool) {
        let count = ((length / 100.0 * num(recipe, "slips", 0.0)).round() as usize).clamp(1, 6);
        let (hull_chance, shed_chance) = (num(recipe, "slipHull", 0.0), num(recipe, "shiphouse", 0.0));
        let material = if self.stone { "stone" } else { "timber" };
        for k in 0..count {
            let station = length * (k as f64 + 0.5) / count as f64 + self.rng.range(-0.2, 0.2) * length / count as f64;
            let Some((f, s)) = locate(reaches, station) else { continue };
            // A slipway into a river only where it is wide, and short: a hull
            // drawn square to the flow of a narrower river would block it.
            let channel = f.channel(channel);
            if channel && f.open < SLIP_RIVER {
                continue;
            }
            let root = add(f.a, f.t, s);
            let Some(e) = self.edge(root, f.n, f.half) else { continue };
            let Some((class, boat_length, beam)) = self.class(roles, family, 30.0, 9.0) else { continue };
            let slip_length = (1.1 * boat_length).clamp(9.0, 32.0);
            let width = (beam + 2.5).clamp(4.0, 11.0);
            // The ramp climbs the bank as far as the quay street, never past it.
            let landward = (0.4 * slip_length).min(e + f.half * 0.5);
            let afloat = slip_length - landward;
            if afloat > f.open * if channel { 0.15 } else { 0.6 } {
                continue;
            }
            let water = Obb { c: add(root, f.n, e + 0.6 + afloat * 0.5), u: f.n, hl: afloat * 0.5, hw: width * 0.5 + 0.6 };
            if !self.free(&water) {
                continue;
            }
            let slip = Obb { c: add(root, f.n, e - landward + slip_length * 0.5), u: f.n, hl: slip_length * 0.5, hw: width * 0.5 };
            self.emit("slip", material, slip.shape());
            self.solid.push(water);
            self.occupied.push(slip);
            if self.rng.chance(shed_chance) {
                let covered = landward + 0.3 * afloat;
                let shed = Obb { c: add(root, f.n, e - landward + covered * 0.5), u: f.n, hl: covered * 0.5, hw: width * 0.5 + 0.4 };
                self.emit("shiphouse", material, shed.shape());
            } else if self.boats < self.boat_cap && self.rng.chance(hull_chance) {
                self.boat("boat-ashore", class, Obb { c: add(root, f.n, e + 0.05 * boat_length), u: neg(f.n), hl: boat_length * 0.5, hw: beam * 0.5 });
            }
        }
    }

    /// Boats along one reach: alongside the quay, stern to it, or on the shore.
    fn berths(&mut self, r: &Reach, berth: &str, fill: f64, ashore: f64, roles: &[(&'static str, f64)], family: &'static Value, channel: bool) {
        let f = r.f;
        // On a river boats lie alongside the bank, parallel to the flow, never
        // stern-to across it; a narrow river holds two or three small boats.
        let (narrow, channel) = (f.narrow(channel), f.channel(channel));
        let (berth, ashore) = if channel { ("alongside", 0.0) } else { (berth, ashore) };
        let small = [("small", 1.0)];
        let roles = if narrow { &small[..] } else { roles };
        let mut moored = 0;
        let limit = f.open * if channel { 0.25 } else { 0.6 };
        let alongside = berth == "alongside";
        // A beach landing spreads along the shore past both ends of its quay.
        let wing = if berth == "beach" { 45.0 } else { 0.0 };
        let end = r.s1 + if r.s1 >= f.len - 1e-6 { wing } else { 0.0 };
        let mut s = r.s0 + 1.0 - if r.s0 <= 1e-6 { wing } else { 0.0 };
        let mut guard = 0;
        while s < end - 2.0 && self.boats < self.boat_cap && guard < 240 && !(narrow && moored >= 3) {
            guard += 1;
            let room = end - s - 0.5;
            let found = if alongside { self.class(roles, family, room.min(60.0), limit - 1.0) } else { self.class(roles, family, limit - 1.5, room) };
            let Some((class, length, beam)) = found else {
                s += 4.0;
                continue;
            };
            let slot = if alongside { length } else { beam };
            let step = slot + if alongside { 2.0 + 0.12 * length } else { 1.0 + 0.5 * beam };
            if self.rng.chance(fill) {
                let root = add(f.a, f.t, s + slot * 0.5);
                if let Some(e) = self.edge(root, f.n, f.half) {
                    let hauled = berth == "beach" || length < 9.0 && self.rng.chance(ashore);
                    let placed = if hauled && self.beach(class, add(root, f.n, e), f.n, e - f.half) {
                        true
                    } else if alongside {
                        let bow = if self.rng.chance(0.5) { f.t } else { neg(f.t) };
                        self.float(class, add(root, f.n, e + 0.9 + beam * 0.5), bow)
                    } else {
                        self.float(class, add(root, f.n, e + 1.0 + length * 0.5), f.n)
                    };
                    moored += usize::from(placed);
                }
            }
            s += step;
        }
    }

    /// One harbour type on its reaches (`harbours.json` `types.<id>`).
    fn furnish(&mut self, recipe: &'static Value, family: &'static Value, reaches: &[Reach], population: u32, site: &str) {
        let length: f64 = reaches.iter().map(|r| r.s1 - r.s0).sum();
        if length < 4.0 {
            return;
        }
        let channel = matches!(site, "river" | "lagoon");
        let mut roles: Vec<(&'static str, f64)> = recipe["boats"]
            .as_object()
            .map(|m| m.iter().map(|(k, w)| (k.as_str(), w.as_f64().unwrap_or(0.0))).collect())
            .unwrap_or_default();
        roles.sort_by(|a, b| a.0.cmp(b.0));
        let cargo = text(recipe, "cargo", "");

        let breakwater = num(recipe, "breakwater", 0.0);
        // A breakwater is a town's work: none below 2 500 people.
        if breakwater > 0.0 && !channel && population >= 2500 && !self.has_mole && self.rng.chance(breakwater) {
            self.breakwater(reaches, recipe["beacon"].as_bool() == Some(true));
        }
        if recipe["jetties"].is_object() {
            self.jetties(&recipe["jetties"], recipe, &roles, family, reaches, channel);
        }
        if num(recipe, "slips", 0.0) > 0.0 {
            self.slips(recipe, &roles, family, reaches, length, channel);
        }
        // Landing steps down to the water along part of each reach.
        let steps = num(recipe, "steps", 0.0);
        if steps > 0.0 {
            for r in reaches {
                let (len, f) = (r.s1 - r.s0, r.f);
                let l = len * steps;
                if l < 6.0 {
                    continue;
                }
                let root = add(f.a, f.t, r.s0 + l * 0.5 + self.rng.range(0.0, len - l));
                let Some(e) = self.edge(root, f.n, f.half) else { continue };
                if self.free(&Obb { c: add(root, f.n, e + 2.6), u: f.t, hl: l * 0.5, hw: 1.2 }) {
                    let flight = Obb { c: add(root, f.n, e + 1.4), u: f.t, hl: l * 0.5, hw: 2.0 };
                    self.emit("steps", "stone", flight.shape());
                    self.solid.push(flight);
                    self.occupied.push(flight);
                }
            }
        }
        // Cranes on stages projecting from the quay, their jib over the berth.
        let crane = text(family, "crane", "none");
        let cranes = (num(recipe, "cranes", 0.0) as usize).min(1 + (length / 160.0) as usize);
        if crane != "none" && population >= 1500 {
            let material = if self.stone { "stone" } else { "timber" };
            for k in 0..cranes {
                // The station, or the nearest free place beside it.
                let found = [0.0, 9.0, -9.0, 18.0, -18.0].into_iter().find_map(|shift| {
                    let (f, s) = locate(reaches, length * (k as f64 + 0.5) / cranes as f64 + shift)?;
                    // A narrow river is a landing: no crane stage.
                    if f.narrow(channel) {
                        return None;
                    }
                    let root = add(f.a, f.t, s);
                    let e = self.edge(root, f.n, f.half)?;
                    self.free(&Obb { c: add(root, f.n, e + 2.6), u: f.n, hl: 1.6, hw: 2.6 }).then_some((f, root, e))
                });
                let Some((f, root, e)) = found else { continue };
                let stage = Obb { c: add(root, f.n, e + 1.5), u: f.n, hl: 2.3, hw: 2.6 };
                self.emit("jetty", material, stage.shape());
                self.solid.push(stage);
                self.occupied.push(stage);
                if !cargo.is_empty() {
                    for side in [1.0, -1.0] {
                        if self.cargo < MAX_CARGO {
                            self.cargo += 1;
                            self.emit("cargo", cargo, Obb { c: add(add(root, f.n, e + 0.8), f.t, side * 1.95), u: f.t, hl: 0.5, hw: 0.9 }.shape());
                        }
                    }
                }
                self.emit("crane", crane, Obb { c: add(root, f.n, e + 1.9), u: f.n, hl: 1.4, hw: 1.4 }.shape());
                self.emit("crane-jib", crane, Obb { c: add(root, f.n, e + 6.3), u: f.n, hl: 3.0, hw: 0.3 }.shape());
            }
        }
        let berth = text(recipe, "berth", "none");
        let (fill, ashore) = (num(recipe, "fill", 0.5), num(recipe, "ashore", 0.0));
        if berth != "none" && !roles.is_empty() {
            for r in reaches {
                self.berths(r, berth, fill, ashore, &roles, family, channel);
            }
        }
        // Timber rafts moored along the bank.
        let rafts = num(recipe, "rafts", 0.0) as usize;
        let mut moored = 0;
        for _ in 0..rafts * 3 {
            if moored >= rafts {
                break;
            }
            let Some((f, s)) = locate(reaches, self.rng.range(0.0, length)) else { continue };
            let root = add(f.a, f.t, s);
            let Some(e) = self.edge(root, f.n, f.half) else { continue };
            let raft = Obb { c: add(root, f.n, e + 3.4), u: f.t, hl: 6.0, hw: 2.5 };
            // On a river the raft keeps within a quarter of the channel (5.9 m out).
            if f.open >= 20.0 && (!f.channel(channel) || 5.9 <= 0.25 * f.open) && self.free(&raft) {
                self.emit("raft", "timber", raft.shape());
                self.occupied.push(raft);
                moored += 1;
            }
        }
        // Boats at anchor off the widest reach, all lying to the same wind.
        let anchored = (num(recipe, "anchored", 0.0) as usize + population as usize / 5000).min(8);
        if anchored > 0 && !channel && !roles.is_empty() {
            let wind = rotate(Point { x: 1.0, y: 0.0 }, self.rng.range(0.0, std::f64::consts::TAU));
            let widest = reaches.iter().filter(|r| !r.f.channel(false) && r.f.open >= 60.0).max_by(|a, b| a.f.open.total_cmp(&b.f.open)).copied();
            if let Some(r) = widest {
                let mut placed = 0;
                for _ in 0..anchored * 3 {
                    if placed >= anchored {
                        break;
                    }
                    let root = add(r.f.a, r.f.t, self.rng.range(r.s0, r.s1));
                    let Some(e) = self.edge(root, r.f.n, r.f.half) else { continue };
                    let off = self.rng.range(28.0, (r.f.open * 0.7).clamp(30.0, 110.0));
                    // Open water all round (35 m): never in a river mouth nor a narrow inlet.
                    let c = add(root, r.f.n, e + off);
                    let open = (0..8).all(|k| self.surface.wet(add(c, rotate(Point { x: 1.0, y: 0.0 }, k as f64 * std::f64::consts::FRAC_PI_4), 35.0)));
                    if !open {
                        continue;
                    }
                    let Some((class, _, _)) = self.class(&roles, family, 40.0, 12.0) else { continue };
                    if self.float(class, c, wind) {
                        placed += 1;
                    }
                }
            }
        }
        // Mooring posts along the quay edge.
        let spacing = num(recipe, "posts", 0.0);
        if spacing >= 3.0 {
            for r in reaches {
                let mut s = r.s0 + spacing * 0.5;
                while s < r.s1 && self.posts < MAX_POSTS {
                    let root = add(r.f.a, r.f.t, s);
                    if let Some(e) = self.edge(root, r.f.n, r.f.half) {
                        let p = add(root, r.f.n, e + 0.35);
                        if !self.occupied.iter().any(|o| o.contains(p)) {
                            self.posts += 1;
                            self.emit("post", "timber", Obb { c: p, u: r.f.t, hl: 0.3, hw: 0.3 }.shape());
                        }
                    }
                    s += spacing;
                }
            }
        }
    }
}

/// Water served by the quays of a town: `lagoon` for a culture of fondamenta,
/// else the kind (sea, lake, river) fronting most of the quay length. `None`
/// without a quay on water.
pub(super) fn site_of(culture: &str, streets: &[Street], surface: Surface<'_>) -> Option<&'static str> {
    let mut weight = [0.0f64; 3];
    for s in streets.iter().filter(|s| s.role == "quay" && s.path.len() >= 2) {
        if let Some((kind, _)) = harbour::front_water(surface, &s.path) {
            let length: f64 = s.path.windows(2).map(|w| dist(w[0], w[1])).sum();
            let slot = match kind {
                "sea" => 0,
                "lake" => 1,
                _ => 2,
            };
            weight[slot] += length;
        }
    }
    if weight.iter().sum::<f64>() <= 0.0 {
        return None;
    }
    Some(if harbour::params(culture).fondamenta {
        "lagoon"
    } else if weight[2] > weight[0] + weight[1] {
        "river"
    } else if weight[1] > weight[0] {
        "lake"
    } else {
        "sea"
    })
}

/// The harbour of a town before any geometry: its culture family, its type or
/// two types, and whether it keeps the planner's pair of moles.
#[derive(Clone, Debug)]
pub(super) struct Choice {
    pub family: &'static str,
    /// One type, or two for a town of 2 500 people or more (three times in four).
    pub types: Vec<&'static str>,
    /// Drawn with `types.<first>.moles`, the chance that this type keeps the pair of moles.
    pub moles: bool,
}

/// Draws the harbour of a town with its seed alone, so that the planner
/// (`harbour::typed_works`) and the furniture read the same harbour. `wanted`
/// is `LayoutConfig::port_type`: a type id forces that type, anything else
/// draws from the types the culture family builds on this water at this size.
pub(super) fn choose(seed: &str, culture: &str, population: u32, wanted: &str, site: &str) -> Choice {
    let families = &data()["families"];
    let family: &'static str = families
        .as_object()
        .and_then(|m| {
            m.iter()
                .find(|(_, f)| f["cultures"].as_array().is_some_and(|c| c.iter().any(|x| x.as_str() == Some(culture))))
                .map(|(k, _)| k.as_str())
        })
        .unwrap_or("default");
    let types = &data()["types"];
    let eligible = |name: &str| {
        let t = &types[name];
        t.is_object()
            && t["sites"].as_array().map_or(true, |s| s.iter().any(|x| x.as_str() == Some(site)))
            && f64::from(population) >= num(t, "minPopulation", 0.0)
            && f64::from(population) <= num(t, "maxPopulation", f64::INFINITY)
    };
    let weighted = |family: &'static Value| {
        let mut options: Vec<(&'static str, f64)> = family["types"]
            .as_object()
            .map(|m| m.iter().map(|(k, w)| (k.as_str(), w.as_f64().unwrap_or(0.0))).filter(|o| eligible(o.0)).collect())
            .unwrap_or_default();
        options.sort_by(|a, b| a.0.cmp(b.0));
        options
    };
    let mut rng = Rng::new(&format!("{seed}\u{1}harbour-type-v1"));
    let mut chosen: Vec<&'static str> = vec![];
    let forced = types.as_object().and_then(|m| m.keys().find(|k| k.as_str() == wanted)).map(|k| k.as_str());
    if let Some(forced) = forced {
        chosen.push(forced);
    } else {
        let mut options = weighted(&families[family]);
        if options.is_empty() {
            options = weighted(&families["default"]);
        }
        if let Some(first) = pick(&mut rng, &options) {
            chosen.push(first);
            // A larger port combines two types (merchant quays and a fishing landing).
            if population >= 2500 && rng.chance(0.75) {
                let rest: Vec<(&'static str, f64)> = options.iter().copied().filter(|o| o.0 != first).collect();
                if let Some(second) = pick(&mut rng, &rest) {
                    chosen.push(second);
                }
            }
        }
    }
    if chosen.is_empty() {
        chosen.push("fishing-harbour");
    }
    let moles = rng.chance(num(&types[chosen[0]], "moles", 0.0));
    Choice { family, types: chosen, moles }
}

/// Whether the harbour drawn for a town keeps the planner's pair of moles (the
/// rectangular basin): always for `bare` and without a quay on water, else
/// by the town's first harbour type.
pub(super) fn keeps_moles(seed: &str, culture: &str, population: u32, wanted: &str, streets: &[Street], surface: Surface<'_>) -> bool {
    if wanted == "bare" {
        return true;
    }
    match site_of(culture, streets, surface) {
        Some(site) => choose(seed, culture, population, wanted, site).moles,
        None => true,
    }
}

/// The harbour of a town: its water, its type or two types, its furniture.
/// `seed` is the town's own seed, `wanted` is `LayoutConfig::port_type`
/// (`auto`, `bare` or a type id), `platforms` are the planner's platforms.
pub(super) fn plan(seed: &str, culture: &str, population: u32, wanted: &str, streets: &[Street], platforms: &[Quay], surface: Surface<'_>) -> Plan {
    let mut out = Plan::default();
    if wanted == "bare" {
        return out;
    }
    let built: Vec<&Quay> = platforms.iter().filter(|q| PLATFORM_KINDS.contains(&q.kind.as_str())).collect();
    // A timber waterfront keeps timber works; otherwise the family's material (stone by default).
    let timber = !built.is_empty() && built.iter().all(|q| q.material == "timber");
    let mut b = Builder {
        surface,
        platforms: built.iter().map(|&q| (bbox(&q.shape.outer), &q.shape)).collect(),
        solid: vec![],
        occupied: vec![],
        items: vec![],
        rng: Rng::new(&format!("{seed}\u{1}harbour-furniture-v1")),
        stone: !timber,
        has_mole: streets.iter().any(|s| s.role == "mole"),
        boats: 0,
        boat_cap: (4 + population as usize / 250).min(MAX_BOATS),
        posts: 0,
        cargo: 0,
        level_at: None,
    };
    let fronts = b.fronts(streets);
    if fronts.is_empty() {
        return out;
    }
    let total: f64 = fronts.iter().map(|f| f.len).sum();
    // Water works and crossings near the harbour: nothing is moored across them.
    for s in streets.iter().filter(|s| s.path.len() >= 2) {
        if !matches!(s.role.as_str(), "pier" | "landing" | "mole" | "boardwalk" | "bridge" | "causeway" | "ford") {
            continue;
        }
        let width = s.widths.first().copied().unwrap_or(4.0);
        for w in s.path.windows(2) {
            let len = dist(w[0], w[1]);
            if len < 0.5 {
                continue;
            }
            let mid = Point { x: (w[0].x + w[1].x) * 0.5, y: (w[0].y + w[1].y) * 0.5 };
            if fronts.iter().any(|f| dist(f.a, mid) < 400.0 + f.len + len) {
                let u = Point { x: (w[1].x - w[0].x) / len, y: (w[1].y - w[0].y) / len };
                b.occupied.push(Obb { c: mid, u, hl: len * 0.5 + 1.0, hw: width * 0.5 + 1.5 });
            }
        }
    }
    // The same water and the same draw as the planner; a quay whose middle
    // stands back from the water falls back on the kinds its reaches front.
    let weight = |code: u8| fronts.iter().filter(|f| f.code == code).map(|f| f.len).sum::<f64>();
    let fallback = if weight(3) > weight(1) + weight(2) {
        "river"
    } else if weight(2) > weight(1) {
        "lake"
    } else {
        "sea"
    };
    let site: &'static str = site_of(culture, streets, surface).unwrap_or(fallback);
    let choice = choose(seed, culture, population, wanted, site);
    let family: &'static Value = &data()["families"][choice.family];
    let types = &data()["types"];
    b.stone = !timber && text(family, "material", "auto") != "timber";
    let mut chosen = choice.types;
    // Two types need room: a short waterfront keeps the first.
    if total < 90.0 {
        chosen.truncate(1);
    }
    b.kerbs(&fronts);
    // The planner's own moles (two arms from the quay): the water they enclose
    // is the basin, with a light on one head.
    let arms: Vec<&Street> = streets.iter().filter(|s| s.role == "mole" && s.path.len() >= 3).collect();
    if let [first, second] = arms.as_slice() {
        let mut ring = first.path.clone();
        ring.extend(second.path.iter().rev().copied());
        b.emit("basin", "water", Shape { outer: ring, holes: vec![] });
        if let Some(&head) = first.path.last() {
            b.emit("beacon", "stone", octagon(head, 1.7));
        }
    }
    // The second type takes 38 % of the quays, at one end or the other.
    let flip = chosen.len() > 1 && b.rng.chance(0.5);
    let cut = if chosen.len() > 1 { total * if flip { 0.38 } else { 0.62 } } else { total + 1.0 };
    let first = usize::from(flip);
    let mut reaches: [Vec<Reach>; 2] = [vec![], vec![]];
    let mut acc = 0.0;
    for f in &fronts {
        let (from, to) = (acc, acc + f.len);
        acc = to;
        if to <= cut {
            reaches[first].push(Reach { f: *f, s0: 0.0, s1: f.len });
        } else if from >= cut {
            reaches[1 - first].push(Reach { f: *f, s0: 0.0, s1: f.len });
        } else {
            reaches[first].push(Reach { f: *f, s0: 0.0, s1: cut - from });
            reaches[1 - first].push(Reach { f: *f, s0: cut - from, s1: f.len });
        }
    }
    for (i, name) in chosen.iter().enumerate() {
        b.furnish(&types[*name], family, &reaches[i], population, site);
    }
    out.site = site;
    out.family = choice.family;
    out.types = chosen;
    out.items = b.items;
    out
}

/// Furnishes the harbour of a finished layout (`seed` is the town's own seed,
/// the one its quarters were laid with): the items join
/// `structure.quays` (the basin first, under the platforms). Idempotent.
/// `port_type` other than `bare` or a type id of `harbours.json` means `auto`.
/// Town canals (`structure.waterways`, urban/lagoon.rs) then get their boats.
pub(super) fn furnish(seed: &str, layout: &mut Layout, population: u32, cfg: &LayoutConfig, surface: Surface<'_>) {
    furnish_shore(seed, layout, population, cfg, surface);
    if !matches!(cfg.programme.state.as_str(), "abandoned" | "ruined") {
        canal_boats(seed, layout);
    }
}
