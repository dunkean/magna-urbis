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

/// Platform kinds of the harbour planner; every other kind is furniture.
const PLATFORM_KINDS: [&str; 4] = ["quay", "landing", "pier", "mole"];
const MAX_BOATS: usize = 48;
const MAX_POSTS: usize = 40;
const MAX_CARGO: usize = 36;
const MAX_FRONTS: usize = 64;
const MAX_KERBS: usize = 90;

pub(super) fn data() -> &'static Value {
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

/// Most boats moored in the canals of one town.
const MAX_CANAL_BOATS: usize = 80;
/// Clearance of a moored boat from a bridge deck or a lock gate (m).
const CANAL_CLEAR: f64 = 6.0;

fn mean(ring: &[Point]) -> Point {
    let k = ring.len().max(1) as f64;
    Point { x: ring.iter().map(|p| p.x).sum::<f64>() / k, y: ring.iter().map(|p| p.y).sum::<f64>() / k }
}

/// Boats moored in town canals and rii, by the river rules of `Builder::berths`: alongside the bank and
/// parallel to the channel, the culture family's small craft only, at most three per reach, no beam above a
/// quarter of the channel (three quarters stay free); none within `CANAL_CLEAR` of a bridge deck or a lock
/// gate. Each boat floats on the canal water of the 3D view (the piece's bank height + 0.04, deck 1 m above
/// it, as `Builder::boat`). Idempotent: the boats of an earlier call are removed first.
fn canal_boats(seed: &str, layout: &mut Layout) {
    let families = &data()["families"];
    let culture = layout.culture.clone();
    let family: &'static Value = families
        .as_object()
        .and_then(|m| m.values().find(|f| f["cultures"].as_array().is_some_and(|c| c.iter().any(|x| x.as_str() == Some(culture.as_str())))))
        .unwrap_or(&families["default"]);
    let Some(structure) = layout.structure.as_mut() else { return };
    let channel = |kind: &str| matches!(kind, "canal" | "rio");
    let rings: Vec<Vec<Point>> = structure.waterways.iter().filter(|w| channel(w.kind.as_str())).map(|w| w.shape.outer.clone()).collect();
    let keep_out: Vec<Point> =
        structure.waterways.iter().flat_map(|w| w.crossings.iter().chain(w.locks.iter())).map(|s| mean(&s.outer)).collect();
    let reaches: Vec<(Point, Point, f64, f64)> = structure
        .waterways
        .iter()
        .filter(|w| channel(w.kind.as_str()) && w.path.len() == 2)
        .map(|w| (w.path[0], w.path[1], w.width_m, w.bank_m))
        .collect();
    structure.quays.retain(|q| {
        !(matches!(q.kind.as_str(), "boat" | "cabin" | "mast" | "yard") && rings.iter().any(|r| inside(r, mean(&q.shape.outer))))
    });
    let Some(class) = family["boats"]["small"].as_str() else { return };
    let spec = &data()["boats"][class];
    let (length, beam) = (num(spec, "length", 0.0), num(spec, "beam", 0.0));
    if length <= 0.0 || beam <= 0.0 {
        return;
    }
    let mut rng = Rng::new(&format!("{seed}\u{1}canal-boats-v1"));
    let mut boats = 0;
    for (a, b, width, bank) in reaches {
        let len = dist(a, b);
        if beam > width * 0.25 || len < length + 4.0 {
            continue;
        }
        let t = Point { x: (b.x - a.x) / len, y: (b.y - a.y) / len };
        let n = left(t);
        let (mut s, mut moored) = (2.0 + length * 0.5, 0);
        while s + length * 0.5 + 2.0 <= len && moored < 3 && boats < MAX_CANAL_BOATS {
            let side = if rng.chance(0.5) { 1.0 } else { -1.0 };
            let c = add(add(a, t, s), n, side * (width * 0.5 - beam * 0.5 - 0.3));
            if rng.chance(0.55) && keep_out.iter().all(|&k| dist(k, c) > CANAL_CLEAR + length * 0.5) {
                let bow = if rng.chance(0.5) { t } else { neg(t) };
                let deck = bank + 0.04 + 1.0;
                structure.quays.push(Quay { kind: "boat".into(), shape: hull(c, bow, length, beam, text(spec, "hull", "round")), deck_z_m: deck, material: class.into() });
                if spec["cabin"].as_bool() == Some(true) {
                    let cabin = Obb { c: add(c, bow, -0.05 * length), u: bow, hl: 0.2 * length, hw: beam * 0.33 };
                    structure.quays.push(Quay { kind: "cabin".into(), shape: cabin.shape(), deck_z_m: deck, material: class.into() });
                }
                moored += 1;
                boats += 1;
            }
            s += length + 2.0 + 0.12 * length;
        }
    }
}

/// The harbour family of a culture (`default` when no family names it).
pub(super) fn family_of(culture: &str) -> &'static Value {
    let families = &data()["families"];
    families
        .as_object()
        .and_then(|m| m.values().find(|f| f["cultures"].as_array().is_some_and(|c| c.iter().any(|x| x.as_str() == Some(culture)))))
        .unwrap_or(&families["default"])
}
/// The small craft of a culture's family: (class, length, beam).
fn small_craft(culture: &str) -> Option<(&'static str, f64, f64)> {
    let family = family_of(culture);
    let class = family["boats"]["small"].as_str()?;
    let spec = &data()["boats"][class];
    let (length, beam) = (num(spec, "length", 0.0), num(spec, "beam", 0.0));
    (length > 0.0).then_some((class, length, beam))
}

/// Settlements under this population (and every port of a `simple` family)
/// get one plain landing instead of quays and harbour works.
pub(super) const TOWN_PORT: u32 = 2500;
/// Width of a plain landing strip: 2 m on the bank, 0.5 m over the water.
const STRIP: (f64, f64) = (2.0, 0.5);
/// Height of a plain landing's deck above its water (m).
const LANDING_DECK: f64 = 0.3;

/// A plain landing on the bank at `bank` (the first water), its water side
/// `n`: one strip `length` m long along the bank, flush with it (a timber
/// deck, or stone for a stone family) 0.3 m above the water, a post
/// at each end and one in the middle, and up to `boats` small boats moored
/// alongside, parallel to the bank. Nothing else: no coping stroke, jetty or
/// shed. Without `strip` (a steep bank with no shelf), the boats alone, moored
/// at its foot. Nothing is moored on `keep_out`.
#[allow(clippy::too_many_arguments)]
fn lay_landing(seed: &str, culture: &str, surface: Surface<'_>, bank: Point, n: Point, length: f64, boats: usize, strip_laid: bool, keep_out: Option<Obb>) -> Vec<Quay> {
    let Some((class, boat_length, beam)) = small_craft(culture) else { return vec![] };
    let material = if text(family_of(culture), "material", "auto") == "stone" { "stone" } else { "timber" };
    let mut b = Builder {
        surface,
        platforms: vec![],
        solid: vec![],
        occupied: keep_out.into_iter().collect(),
        items: vec![],
        rng: Rng::new(&format!("{seed}\u{1}harbour-landing-v1")),
        stone: material == "stone",
        has_mole: false,
        boats: 0,
        boat_cap: boats.min(3),
        posts: 0,
        cargo: 0,
        level_at: None,
    };
    let t = left(n);
    let half = length * 0.5;
    let strip = Obb { c: add(bank, n, (STRIP.1 - STRIP.0) * 0.5), u: t, hl: half, hw: (STRIP.0 + STRIP.1) * 0.5 };
    // The water level, read once from the bank: the lowest water under the
    // strip, never more than 2.5 m below its bank (cave water can carry the
    // height of a chasm floor), and every item of the landing stands on it.
    let samples = strip.samples();
    let heights = |wet: bool| samples.iter().filter(|&&p| surface.wet(p) == wet).map(|&p| surface.height_at(p)).fold(f64::INFINITY, f64::min);
    let (water, bank_height) = (heights(true), heights(false));
    let water = match (water.is_finite(), bank_height.is_finite()) {
        (true, true) => water.max(bank_height - 2.5),
        (true, false) => water,
        (false, true) => bank_height - 0.5,
        (false, false) => return vec![],
    };
    b.level_at = Some(water);
    if strip_laid {
        // 0.3 m above the water: a thin deck with a small face, never a block.
        b.push("landing", material, strip.shape(), water + LANDING_DECK);
    }
    b.occupied.push(strip);
    // Mooring posts a metre above the deck: a post stands 2.1 m above the
    // water its deck height names (`harbourStyle.ts`), so it names a water
    // 0.8 m lower.
    for k in if strip_laid { [-1.0, 0.0, 1.0].as_slice() } else { [].as_slice() } {
        let post = Obb { c: add(add(bank, t, *k * (half - 0.6)), n, STRIP.1 + 0.3), u: t, hl: 0.25, hw: 0.25 };
        b.push("post", "timber", post.shape(), water + 1.0 - 0.8);
    }
    for k in 0..b.boat_cap {
        let along = -half + boat_length * 0.5 + 0.5 + k as f64 * (boat_length + 1.5);
        if along + boat_length * 0.5 > half + 2.0 {
            break;
        }
        let c = add(add(bank, t, along), n, STRIP.1 + 0.9 + beam * 0.5);
        let bow = if b.rng.chance(0.5) { t } else { neg(t) };
        b.float(class, c, bow);
    }
    b.items
}

/// A town on a navigable river whose planner laid no quay (a village under
/// its quay budget, a bank too steep for a quay street) still lands its
/// boats: on the town bank beside its first bridge over the river, a coping
/// strip of 12 m along the bank, three mooring posts and one to three small
/// boats moored alongside, parallel to the flow. False when there is no
/// such bridge.
fn landing(seed: &str, layout: &mut Layout, population: u32, surface: Surface<'_>) -> bool {
    let Some((_, _, beam)) = small_craft(&layout.culture) else { return false };
    // The first bridge over water, walked from its end nearer the centre to the first water.
    let centre = layout.center;
    let crossing = layout.streets.iter().filter(|s| s.role == "bridge" && s.path.len() >= 2).find_map(|s| {
        let mut path = s.path.clone();
        if dist(path[0], centre) > dist(*path.last()?, centre) {
            path.reverse();
        }
        let total: f64 = path.windows(2).map(|w| dist(w[0], w[1])).sum();
        let at = |d: f64| {
            let mut d = d;
            for w in path.windows(2) {
                let l = dist(w[0], w[1]);
                if d <= l && l > 1e-9 {
                    let t = Point { x: (w[1].x - w[0].x) / l, y: (w[1].y - w[0].y) / l };
                    return (add(w[0], t, d), t);
                }
                d -= l;
            }
            let (a, b) = (path[path.len() - 2], path[path.len() - 1]);
            let l = dist(a, b).max(1e-9);
            (b, Point { x: (b.x - a.x) / l, y: (b.y - a.y) / l })
        };
        let first = (0..(total * 2.0) as usize).map(|k| k as f64 * 0.5).find(|&d| surface.wet(at(d).0))?;
        let (bank, d) = at(first);
        let mut width = 0.0;
        while width < 400.0 && surface.wet(add(bank, d, width + 0.5)) {
            width += 0.5;
        }
        (harbour::water_code(surface, add(bank, d, 1.0)) == 3 && width >= 10.0).then_some((bank, d, width))
    });
    let Some((bridge, d, width)) = crossing else { return false };
    if beam > 0.25 * width {
        return false;
    }
    let along = left(d);
    // 18 m up or down the bank from the bridge: the first side whose bank is found.
    let Some(bank) = [1.0, -1.0].into_iter().find_map(|side| {
        let p = add(add(bridge, along, side * 18.0), d, -12.0);
        (0..60).map(|k| k as f64 * 0.5).find(|&e| surface.wet(add(p, d, e))).map(|e| add(p, d, e))
    }) else {
        return false;
    };
    // Nothing moored under or against the bridge.
    let bridge_water = Obb { c: add(bridge, d, width * 0.5), u: d, hl: width * 0.5 + 2.0, hw: 8.0 };
    let items = lay_landing(seed, &layout.culture, surface, bank, d, 12.0, if population < 150 { 1 } else { 2 }, true, Some(bridge_water));
    let Some(structure) = layout.structure.as_mut() else { return false };
    let landed = !items.is_empty();
    structure.quays.extend(items);
    landed
}

/// The land around a point on a coarse grid of the drawn water (cells of
/// `cell` metres, `side` a side, at most 256).
struct Land {
    member: Vec<bool>,
    /// Area of the land (m²).
    area: f64,
}
/// Coarse grid side and cell size for `Land`.
fn coarse(surface: Surface<'_>) -> (usize, f64) {
    let side = surface.n.clamp(16, 256);
    (side, surface.width / side as f64)
}
fn coarse_dry(surface: Surface<'_>, i: usize, known: &mut [u8]) -> bool {
    let (side, cell) = coarse(surface);
    if known[i] == 0 {
        let p = Point { x: ((i % side) as f64 + 0.5) * cell, y: ((i / side) as f64 + 0.5) * cell };
        known[i] = if surface.wet(p) { 2 } else { 1 };
    }
    known[i] == 1
}
/// The island under `c`: its land, flooded on the coarse grid from the
/// nearest dry cell, when water closes it within the map and it covers less
/// than a quarter of the map. `None` for land reaching the map edge (part of
/// a larger landmass) or larger than that; the flood stops there.
fn island(surface: Surface<'_>, c: Point) -> Option<Land> {
    let (side, cell) = coarse(surface);
    let mut known = vec![0u8; side * side];
    let (cx, cy) = ((c.x / cell).floor().clamp(0.0, (side - 1) as f64) as isize, (c.y / cell).floor().clamp(0.0, (side - 1) as f64) as isize);
    let start = (0..=3isize)
        .flat_map(|r| (-r..=r).flat_map(move |dy| (-r..=r).map(move |dx| (cx + dx, cy + dy))))
        .filter(|&(x, y)| x >= 0 && y >= 0 && x < side as isize && y < side as isize)
        .map(|(x, y)| y as usize * side + x as usize)
        .find(|&i| coarse_dry(surface, i, &mut known))?;
    let limit = side * side / 4;
    let mut member = vec![false; side * side];
    member[start] = true;
    let (mut stack, mut count) = (vec![start], 1usize);
    while let Some(i) = stack.pop() {
        let (x, y) = (i % side, i / side);
        if x == 0 || y == 0 || x + 1 == side || y + 1 == side {
            return None;
        }
        for j in [i + 1, i - 1, i + side, i - side] {
            if !member[j] && coarse_dry(surface, j, &mut known) {
                member[j] = true;
                count += 1;
                if count > limit {
                    return None;
                }
                stack.push(j);
            }
        }
    }
    Some(Land { member, area: count as f64 * cell * cell })
}

/// A village or town that lives from the water: a fishing activity, or the
/// port function of its programme.
fn fishing(cfg: &LayoutConfig) -> bool {
    cfg.programme.template.contains("fishing") || cfg.programme.functions.is_some_and(|f| f.port > 0.0)
}

/// The foot of a shore below a town. `Shelf`: dry land at most `SHELF_RISE`
/// above the water within 8 m of the bank (a beach, a cove floor, a ledge):
/// room for a landing. `Steep`: no shelf, but a bank a footpath can come down
/// (boats moor at its foot). `Sheer`: a cliff rising faster than `SHEER` over
/// its first 10 m: nothing lands there.
#[derive(Clone, Copy, PartialEq, Eq, Debug)]
enum Foot {
    Shelf,
    Steep,
    Sheer,
}
/// Highest shelf above the water (m).
const SHELF_RISE: f64 = 2.5;
/// A sheer cliff rises faster than this over its first 10 m (rise over run, about 65°).
const SHEER: f64 = 2.1;
/// Steepest leg of a footpath down to a landing (switchbacks keep each leg under it).
const FOOTPATH_GRADE: f64 = 0.35;
/// The foot of the shore at `bank` (first water), `n` towards the water.
fn foot(surface: Surface<'_>, bank: Point, n: Point) -> Foot {
    let water = surface.height_at(add(bank, n, 0.5));
    let rise = |d: f64| surface.height_at(add(bank, n, -d)) - water;
    if rise(8.0) <= SHELF_RISE {
        Foot::Shelf
    } else if rise(10.0) / 10.0 > SHEER {
        Foot::Sheer
    } else {
        Foot::Steep
    }
}

/// Every island settlement has a harbour, and a fishing village at least a
/// landing, even when the planner laid no quay. The landing stands on the
/// settlement's own waterfront when its streets come within 30 m of the
/// water; otherwise it is detached at the best shore within reach (an
/// island's reach grows with its size, 200 m to 1.5 km): a cove first (the
/// share of directions closed by land seen from its water), else the nearest
/// shore, with boat sheds or fishermen's huts beside it and a track to the
/// nearest street. A lone farm (under 40 people) gets a slipway and its boat.
fn shore_landing(seed: &str, layout: &mut Layout, population: u32, cfg: &LayoutConfig, surface: Surface<'_>) {
    let centre = layout.center;
    let land = island(surface, centre);
    // Islands, fishing villages and ports (on a cliffed coast their planner laid no quay).
    if land.is_none() && !fishing(cfg) && !harbour::port_town(cfg) {
        return;
    }
    let (side, cell) = coarse(surface);
    let reach = land.as_ref().map_or(400.0, |l| (l.area.sqrt() * 0.5).clamp(200.0, 1500.0));
    // The town: the vertices of its own streets (not its water works).
    let mut town: Vec<Point> = layout
        .streets
        .iter()
        .filter(|s| !matches!(s.role.as_str(), "bridge" | "pier" | "landing" | "mole" | "boardwalk" | "causeway" | "ford" | "track"))
        .flat_map(|s| s.path.iter().copied())
        .collect();
    if town.is_empty() {
        town.push(centre);
    }
    let near_town = |p: Point| town.iter().map(|&q| dist(p, q)).fold(f64::INFINITY, f64::min);
    // Shore cells within reach: dry (on the island: its own land), water beside them.
    let mut known = vec![0u8; side * side];
    let at = |i: usize| Point { x: ((i % side) as f64 + 0.5) * cell, y: ((i / side) as f64 + 0.5) * cell };
    let span = |v: f64| (((v - reach) / cell).floor().max(1.0) as usize, (((v + reach) / cell).ceil().max(1.0) as usize).min(side - 2));
    let ((x0, x1), (y0, y1)) = (span(centre.x), span(centre.y));
    let mut shores: Vec<(Point, Point)> = vec![];
    for y in y0..=y1 {
        for x in x0..=x1 {
            let i = y * side + x;
            if dist(at(i), centre) > reach || !land.as_ref().map_or_else(|| coarse_dry(surface, i, &mut known), |l| l.member[i]) {
                continue;
            }
            let mut n = Point { x: 0.0, y: 0.0 };
            for (j, dx, dy) in [(i + 1, 1.0, 0.0), (i - 1, -1.0, 0.0), (i + side, 0.0, 1.0), (i - side, 0.0, -1.0)] {
                if !coarse_dry(surface, j, &mut known) {
                    n = Point { x: n.x + dx, y: n.y + dy };
                }
            }
            let l = n.x.hypot(n.y);
            if l > 1e-9 {
                let n = Point { x: n.x / l, y: n.y / l };
                // Sheer cliffs land nothing.
                if foot(surface, add(at(i), n, cell * 0.5), n) != Foot::Sheer {
                    shores.push((at(i), n));
                }
            }
        }
    }
    // A long coast is sampled: at most 400 shore cells are weighed.
    let stride = shores.len().div_ceil(400).max(1);
    let shores: Vec<(Point, Point)> = shores.into_iter().step_by(stride).collect();
    let own = shores.iter().copied().filter(|&(p, _)| near_town(p) <= 30.0 + cell).min_by(|a, b| near_town(a.0).total_cmp(&near_town(b.0)));
    let shelter = |(p, n): (Point, Point)| {
        let o = add(p, n, cell + 4.0);
        (0..16)
            .filter(|&k| {
                let d = rotate(Point { x: 1.0, y: 0.0 }, k as f64 * std::f64::consts::PI / 8.0);
                (1..=30).any(|s| !surface.wet(add(o, d, s as f64 * 4.0)))
            })
            .count() as f64
            / 16.0
    };
    let Some((p, n)) = own.or_else(|| {
        // A shelf at the foot of the slope first.
        let shelf = |s: (Point, Point)| if foot(surface, add(s.0, s.1, cell * 0.5), s.1) == Foot::Shelf { 0.5 } else { 0.0 };
        let score = |s: (Point, Point)| shelter(s) + shelf(s) - 0.6 * dist(s.0, centre) / reach;
        shores.iter().copied().max_by(|a, b| score(*a).total_cmp(&score(*b)))
    }) else {
        return;
    };
    // The bank: the first drawn water along the shore's water side.
    let from = add(p, n, -8.0);
    let Some(e) = (0..80).map(|k| k as f64 * 0.5).find(|&e| surface.wet(add(from, n, e))) else { return };
    let bank = add(from, n, e);
    // The foot decides: a shelf takes the landing, a steep bank only boats, a cliff nothing.
    let shore_foot = foot(surface, bank, n);
    if shore_foot == Foot::Sheer {
        return;
    }
    // One plain landing, scaled to the settlement: 8 m and one boat for a
    // hamlet or a farm (under 150), 14 m and two boats above, 24 m for a town.
    let (length, boats) = match population {
        0..150 => (8.0, 1),
        150..TOWN_PORT => (14.0, 2),
        _ => (24.0, 3),
    };
    let items = lay_landing(seed, &layout.culture, surface, bank, n, length, boats, shore_foot == Foot::Shelf, None);
    if items.is_empty() {
        return;
    }
    // A path from the landing up to the nearest street: switchbacks at a
    // footpath grade (stairs where the culture builds them); a straight path
    // only where it is that gentle, dry and clear of the blocks.
    let grade = if super::profiles::stairs_allowed(cfg, &layout.culture) { cfg.max_stair_grade } else { cfg.max_lane_grade.max(FOOTPATH_GRADE) };
    let start = add(bank, n, -3.0);
    let (target, gap) = town.iter().map(|&q| (q, dist(start, q))).fold((centre, f64::INFINITY), |b, c| if c.1 < b.1 { c } else { b });
    let inside_block = |p: Point| layout.blocks.iter().any(|b| inside(&b.shape.outer, p));
    let track = (gap > 4.0)
        .then(|| {
            let margin = 60.0;
            let bounds = (start.x.min(target.x) - margin, start.y.min(target.y) - margin, start.x.max(target.x) + margin, start.y.max(target.y) + margin);
            super::routing::RoutePlanner::new(surface, bounds).route(start, target, grade).or_else(|| {
                let k = (gap / 2.0).ceil() as usize;
                let u = Point { x: (target.x - start.x) / gap, y: (target.y - start.y) / gap };
                let at = |i: usize| add(start, u, gap * i as f64 / k as f64);
                let straight = (0..=k).all(|i| !surface.wet(at(i)) && (i + 1 == k || !inside_block(at(i))))
                    && (1..=k).all(|i| (surface.height_at(at(i)) - surface.height_at(at(i - 1))).abs() <= grade * gap / k as f64 + 1e-9);
                straight.then(|| vec![start, target])
            })
        })
        .flatten();
    // A landing away from the town that no path reaches is no landing.
    if track.is_none() && gap > 30.0 + cell {
        return;
    }
    if let Some(path) = track {
        layout.streets.push(Street { key: None, widths: vec![2.0; path.len()], path, rank: 4, role: "track".into() });
    }
    if let Some(structure) = layout.structure.as_mut() {
        structure.quays.extend(items);
    }
}

/// A village's or an Underdark port: one plain landing on its waterfront in
/// place of the planner's quay platforms, piers and landing stages. On the
/// quay reach nearest the centre (among the longer ones), at the drawn
/// waterline: a strip of 14 m for a village, up to 40 m for a larger town
/// of a `simple` family, its posts and two or three boats alongside. The
/// quay street stays a street on the bank. Idempotent.
fn simple_landing(seed: &str, layout: &mut Layout, population: u32, surface: Surface<'_>) {
    let Some(structure) = layout.structure.as_ref() else { return };
    let platforms: Vec<Quay> = structure.quays.iter().filter(|q| PLATFORM_KINDS.contains(&q.kind.as_str()) && q.material != "water").cloned().collect();
    let fronts = {
        let b = Builder {
            surface,
            platforms: platforms.iter().map(|q| (bbox(&q.shape.outer), &q.shape)).collect(),
            solid: vec![],
            occupied: vec![],
            items: vec![],
            rng: Rng::new(seed),
            stone: false,
            has_mole: false,
            boats: 0,
            boat_cap: 0,
            posts: 0,
            cargo: 0,
            level_at: None,
        };
        b.fronts(&layout.streets)
    };
    let centre = layout.center;
    let mid = |f: &Front| add(f.a, f.t, f.len * 0.5);
    let chosen = fronts.iter().max_by(|a, b| {
        let score = |f: &Front| f.len.min(40.0) - 0.1 * dist(mid(f), centre);
        score(a).total_cmp(&score(b))
    });
    // The bank: the first drawn water from the middle of the reach.
    let landing = chosen.and_then(|f| {
        let p = mid(f);
        (0..120).map(|k| k as f64 * 0.5).find(|&e| surface.wet(add(p, f.n, e))).map(|e| (add(p, f.n, e), *f))
    });
    // Out: the planner's platforms and its piers and stages into the water;
    // the quay street becomes an ordinary street on the bank (no quay paving
    // in 2D or 3D).
    layout.streets.retain(|s| !matches!(s.role.as_str(), "pier" | "landing" | "mole"));
    for s in layout.streets.iter_mut().filter(|s| s.role == "quay") {
        s.role = "street".into();
    }
    let Some(structure) = layout.structure.as_mut() else { return };
    structure.quays.clear();
    let Some((bank, f)) = landing else { return };
    let (length, boats) = if population < TOWN_PORT { (if population < 150 { 8.0 } else { 14.0 }, if population < 150 { 1 } else { 2 }) } else { ((14.0 + population as f64 / 250.0).min(40.0), 3) };
    let items = lay_landing(seed, &layout.culture, surface, bank, f.n, length.min(f.len.max(8.0)), boats, true, None);
    structure.quays.extend(items);
}

/// A town's quay ground: one band along the drawn water outline, 4.5 m on
/// the bank and 1 m over the water (m).
const BAND: (f64, f64) = (4.5, 1.0);
/// Width of a pontoon out of the quay band (m).
const PONTOON_WIDTH: f64 = 2.5;
/// Ground shapes the quay band replaces: the planner's platforms and the
/// works of `plan` (the basin stays in a closed port).
const GROUND: [&str; 10] = ["quay", "landing", "pier", "mole", "breakwater", "kerb", "jetty", "slip", "steps", "basin"];
/// Parts drawn with the item before them (a boat's cabin, masts and yards, a crane's jib).
const ATTACHED: [&str; 4] = ["cabin", "mast", "yard", "crane-jib"];
/// Farthest a boat floats from the quay band or a pontoon (m).
const BOAT_REACH: f64 = 15.0;

fn ccw(mut outer: Vec<Point>) -> Shape {
    let k = outer.len();
    let area: f64 = (0..k).map(|i| outer[i].x * outer[(i + 1) % k].y - outer[(i + 1) % k].x * outer[i].y).sum();
    if area < 0.0 {
        outer.reverse();
    }
    Shape { outer, holes: vec![] }
}

fn segment_distance(p: Point, a: Point, b: Point) -> f64 {
    let (dx, dy) = (b.x - a.x, b.y - a.y);
    let l2 = dx * dx + dy * dy;
    let t = if l2 > 1e-12 { (((p.x - a.x) * dx + (p.y - a.y) * dy) / l2).clamp(0.0, 1.0) } else { 0.0 };
    dist(p, Point { x: a.x + t * dx, y: a.y + t * dy })
}

/// The bank under each quay street: every 2 m along the street, the first
/// drawn water on its water side (the side where more samples find water),
/// with the street's normal towards the water. A run breaks where no water
/// lies within reach, where the bank jumps (more than 6 m) and where an
/// earlier run already lines that bank (within 3 m).
fn bank_runs(streets: &[Street], surface: Surface<'_>) -> Vec<Vec<(Point, Point)>> {
    let mut runs: Vec<Vec<(Point, Point)>> = vec![];
    let mut laid: Vec<Point> = vec![];
    for s in streets.iter().filter(|s| s.role == "quay" && s.path.len() >= 2) {
        let before = runs.len();
        // The planner may set its street back from the drawn water (a coarse raster bank).
        let reach = s.widths.first().copied().unwrap_or(6.0) * 0.5 + 60.0;
        let first_wet = |p: Point, n: Point| (0..=(reach * 2.0) as usize).map(|k| k as f64 * 0.5).find(|&d| surface.wet(add(p, n, d)));
        let mut samples: Vec<(Point, Point)> = vec![];
        for w in s.path.windows(2) {
            let len = dist(w[0], w[1]);
            if len < 1e-6 {
                continue;
            }
            let t = Point { x: (w[1].x - w[0].x) / len, y: (w[1].y - w[0].y) / len };
            let steps = (len / 2.0).ceil() as usize;
            samples.extend((0..steps).map(|k| (add(w[0], t, len * k as f64 / steps as f64), t)));
        }
        if let (Some(&last), Some(&(_, t))) = (s.path.last(), samples.last()) {
            samples.push((last, t));
        }
        let side = |sign: f64, t: Point| Point { x: left(t).x * sign, y: left(t).y * sign };
        let hits = |sign: f64| samples.iter().filter(|(p, t)| first_wet(*p, side(sign, *t)).is_some()).count();
        let sign = if hits(1.0) >= hits(-1.0) { 1.0 } else { -1.0 };
        let mut run: Vec<(Point, Point)> = vec![];
        let mut previous: Option<f64> = None;
        for (p, t) in samples {
            let n = side(sign, t);
            let found = first_wet(p, n).filter(|&d| laid.iter().all(|&m| dist(m, add(p, n, d)) > 3.0));
            match found {
                Some(d) if previous.is_none_or(|e| (d - e).abs() <= 6.0) => run.push((add(p, n, d), n)),
                _ => {
                    if run.len() >= 3 {
                        runs.push(std::mem::take(&mut run));
                    } else {
                        run.clear();
                    }
                    if let Some(d) = found {
                        run.push((add(p, n, d), n));
                    }
                }
            }
            previous = found;
        }
        if run.len() >= 3 {
            runs.push(run);
        }
        for r in &runs[before..] {
            laid.extend(r.iter().map(|(b, _)| *b));
        }
    }
    runs
}

/// A town's harbour ground (the user's model, nothing more): one quay band
/// along the drawn water outline of each quay street (`BAND`), a few straight
/// timber pontoons out of it (one per 4000 people, 1 to 6, shorter than a
/// third of a river), and for the north-european family a closed port: its
/// moles become bands of the same width around the basin. The objects of
/// `items` (boats, cranes, cargo, sheds, posts...) stay, except those that
/// stood over the water on a removed shape, and boats on the band or adrift
/// more than `BOAT_REACH` from it; small craft moor along the pontoons.
#[allow(clippy::too_many_arguments)]
fn quay_band(seed: &str, streets: &[Street], culture: &str, population: u32, family: &str, items: Vec<Quay>, planner: &[Shape], surface: Surface<'_>) -> Vec<Quay> {
    let closed = family == "north-european";
    let material = if text(family_of(culture), "material", "auto") == "timber" { "timber" } else { "stone" };
    let level = |points: &[Point]| -> f64 {
        let mut h: Vec<f64> = points.iter().filter(|&&p| surface.wet(p)).map(|&p| surface.height_at(p)).collect();
        if h.is_empty() {
            return f64::NAN;
        }
        h.sort_by(f64::total_cmp);
        h[h.len() / 2]
    };
    let runs = bank_runs(streets, surface);
    let mut ground: Vec<Quay> = vec![];
    // One deck per piece: a run is cut where its water level moves by more
    // than 0.4 m (a descending river), the pieces sharing their ends.
    for run in &runs {
        let water: Vec<f64> = run.iter().map(|(b, n)| level(&[add(*b, *n, 1.5)])).collect();
        let mut from = 0;
        while from + 1 < run.len() {
            let start = water[from..].iter().copied().find(|h| h.is_finite());
            let mut to = from + 1;
            while to + 1 < run.len() && start.is_none_or(|h0| !water[to].is_finite() || (water[to] - h0).abs() <= 0.4) {
                to += 1;
            }
            let piece = &run[from..=to];
            let deck = level(&piece.iter().map(|(b, n)| add(*b, *n, 1.5)).collect::<Vec<_>>()) + 1.0;
            let mut outer: Vec<Point> = piece.iter().map(|(b, n)| add(*b, *n, BAND.1)).collect();
            outer.extend(piece.iter().rev().map(|(b, n)| add(*b, *n, -BAND.0)));
            if deck.is_finite() {
                ground.push(Quay { kind: "quay".into(), shape: ccw(outer), deck_z_m: deck, material: material.into() });
            }
            from = to;
        }
    }
    // A closed port: each mole a band on its own line (mitred corners).
    if closed {
        let half = (BAND.0 + BAND.1) * 0.5;
        for s in streets.iter().filter(|s| s.role == "mole" && s.path.len() >= 2) {
            let k = s.path.len();
            let normal = |i: usize, j: usize| {
                let l = dist(s.path[i], s.path[j]).max(1e-6);
                left(Point { x: (s.path[j].x - s.path[i].x) / l, y: (s.path[j].y - s.path[i].y) / l })
            };
            let miter = |i: usize| {
                let (a, b) = (normal(i.saturating_sub(1).min(k - 2), i.saturating_sub(1).min(k - 2) + 1), normal(i.min(k - 2), i.min(k - 2) + 1));
                let m = Point { x: a.x + b.x, y: a.y + b.y };
                let m2 = (m.x * m.x + m.y * m.y).max(0.5);
                Point { x: m.x * 2.0 / m2, y: m.y * 2.0 / m2 }
            };
            let mut outer: Vec<Point> = (0..k).map(|i| add(s.path[i], miter(i), half)).collect();
            outer.extend((0..k).rev().map(|i| add(s.path[i], miter(i), -half)));
            let deck = level(&s.path) + 1.0;
            if deck.is_finite() {
                ground.push(Quay { kind: "quay".into(), shape: ccw(outer), deck_z_m: deck, material: material.into() });
            }
        }
    }
    // Pontoons, evenly spaced along the quay banks.
    let banks: Vec<(Point, Point)> = runs.iter().flat_map(|r| r[1..r.len() - 1].iter().copied()).collect();
    let count = ((population as f64 / 4000.0).round() as usize).clamp(1, 6).min(banks.len() / 10);
    let reach = (10.0 + population as f64 / 2500.0).min(30.0);
    let mut pontoons: Vec<Obb> = vec![];
    for k in 0..count {
        let (b, n) = banks[banks.len() * (2 * k + 1) / (2 * count)];
        let mut open = 0.0;
        while open < 300.0 && surface.wet(add(b, n, open + 1.0)) {
            open += 1.0;
        }
        let river = harbour::water_code(surface, add(b, n, 2.0)) == 3;
        let length = reach.min(open * if river { 0.3 } else { 0.6 });
        if length < 5.0 {
            continue;
        }
        let o = Obb { c: add(b, n, length * 0.5), u: n, hl: length * 0.5, hw: PONTOON_WIDTH * 0.5 };
        let deck = level(&[add(b, n, 2.0), add(b, n, length)]) + 1.0;
        if deck.is_finite() {
            ground.push(Quay { kind: "pier".into(), shape: o.shape(), deck_z_m: deck, material: "timber".into() });
            pontoons.push(o);
        }
    }
    // The objects: those over the water on a removed shape go, boats on the
    // new ground or adrift go; a part follows its boat or crane.
    let removed: Vec<Shape> = planner.iter().cloned().chain(items.iter().filter(|q| GROUND.contains(&q.kind.as_str()) && !(closed && q.kind == "basin")).map(|q| q.shape.clone())).collect();
    let on_ground = |p: Point| ground.iter().any(|q| inside(&q.shape.outer, p));
    let basins: Vec<Shape> = if closed { items.iter().filter(|q| q.kind == "basin").map(|q| q.shape.clone()).collect() } else { vec![] };
    let near = |p: Point| {
        banks.iter().any(|(b, _)| dist(*b, p) <= BOAT_REACH)
            || pontoons.iter().any(|o| segment_distance(p, add(o.c, o.u, -o.hl), add(o.c, o.u, o.hl)) <= BOAT_REACH)
            || basins.iter().any(|s| inside(&s.outer, p))
    };
    let mut kept: Vec<Quay> = vec![];
    let mut kept_basins: Vec<Quay> = vec![];
    let mut parent = true;
    for q in items {
        let kind = q.kind.as_str();
        if ATTACHED.contains(&kind) {
            if parent {
                kept.push(q);
            }
            continue;
        }
        if kind == "basin" && closed {
            kept_basins.push(q);
            continue;
        }
        if GROUND.contains(&kind) {
            parent = false;
            continue;
        }
        let c = mean(&q.shape.outer);
        parent = if kind == "boat" {
            !q.shape.outer.iter().any(|&p| on_ground(p)) && near(c)
        } else {
            !(surface.wet(c) && removed.iter().any(|s| inside(&s.outer, c)) && !on_ground(c))
        };
        if parent {
            kept.push(q);
        }
    }
    // Small craft along the pontoons, one on each side when free.
    if let Some((class, length, beam)) = small_craft(culture) {
        let occupied: Vec<Obb> = kept
            .iter()
            .filter(|q| q.kind == "boat")
            .map(|q| {
                let (x0, y0, x1, y1) = bbox(&q.shape.outer);
                Obb { c: Point { x: (x0 + x1) * 0.5, y: (y0 + y1) * 0.5 }, u: Point { x: 1.0, y: 0.0 }, hl: (x1 - x0) * 0.5, hw: (y1 - y0) * 0.5 }
            })
            .collect();
        let mut b = Builder {
            surface,
            platforms: ground.iter().map(|q| (bbox(&q.shape.outer), &q.shape)).collect(),
            solid: vec![],
            occupied,
            items: vec![],
            rng: Rng::new(&format!("{seed}\u{1}harbour-band-v1")),
            stone: material == "stone",
            has_mole: false,
            boats: 0,
            boat_cap: 2 * pontoons.len(),
            posts: 0,
            cargo: 0,
            level_at: None,
        };
        for o in &pontoons {
            if length > o.hl * 2.0 + 2.0 {
                continue;
            }
            for sign in [1.0, -1.0] {
                let c = add(add(o.c, o.u, (o.hl - length * 0.5 - 0.5).max(0.0)), left(o.u), sign * (o.hw + 0.6 + beam * 0.5));
                b.float(class, c, o.u);
            }
        }
        let moored = b.items;
        kept.extend(moored);
    }
    kept_basins.extend(ground);
    kept_basins.extend(kept);
    kept_basins
}

fn furnish_shore(seed: &str, layout: &mut Layout, population: u32, cfg: &LayoutConfig, surface: Surface<'_>) {
    let Some(structure) = layout.structure.as_ref() else { return };
    // A dead place: an abandoned or ruined town keeps its bare works (like
    // `port_type: bare`), without boats, cargo or cranes.
    if matches!(cfg.programme.state.as_str(), "abandoned" | "ruined") {
        return;
    }
    // No quay: a river town still lands its boats beside its bridge, an
    // island settlement or a fishing village on its shore.
    if !layout.streets.iter().any(|s| s.role == "quay") {
        if cfg.port_type != "bare" && !structure.quays.iter().any(|q| matches!(q.kind.as_str(), "kerb" | "post" | "slip" | "quay")) && !landing(seed, layout, population, surface) {
            shore_landing(seed, layout, population, cfg, surface);
        }
        return;
    }
    // A village, or any port of a `simple` family (the Underdark): one plain
    // landing, not quays and works. Towns keep their quays.
    if cfg.port_type != "bare" && (population < TOWN_PORT || family_of(&layout.culture)["simple"].as_bool() == Some(true)) {
        simple_landing(seed, layout, population, surface);
        return;
    }
    let found = plan(seed, &layout.culture, population, &cfg.port_type, &layout.streets, &structure.quays, surface);
    if cfg.port_type == "bare" {
        let Some(structure) = layout.structure.as_mut() else { return };
        structure.quays.retain(|q| PLATFORM_KINDS.contains(&q.kind.as_str()));
        return;
    }
    // The quay band in place of the planner's platforms and the works; the
    // quay streets stay (their quarters' port roles read them) and draw as
    // ordinary streets; piers, stages and moles go.
    let planner: Vec<Shape> = structure.quays.iter().filter(|q| PLATFORM_KINDS.contains(&q.kind.as_str())).map(|q| q.shape.clone()).collect();
    let items = quay_band(seed, &layout.streets, &layout.culture, population, found.family, found.items, &planner, surface);
    layout.streets.retain(|s| !matches!(s.role.as_str(), "pier" | "landing" | "mole"));
    let Some(structure) = layout.structure.as_mut() else { return };
    structure.quays = items;
}

#[cfg(test)]
mod tests {
    use super::*;

    const N: usize = 64;
    const WIDTH: f64 = 256.0;

    /// Flat ground with water of kind `code` for `x` in `[from, to)` (4 m cells).
    fn raster(code: u8, from: f64, to: f64) -> (Vec<f32>, Vec<u8>) {
        let water = (0..N * N)
            .map(|i| {
                let x = ((i % N) as f64 + 0.5) * WIDTH / N as f64;
                if x >= from && x < to { code } else { 0 }
            })
            .collect();
        (vec![1.0; N * N], water)
    }
    fn ground<'a>(height: &'a [f32], water: &'a [u8]) -> Surface<'a> {
        Surface { geometry: None, width: WIDTH, n: N, height, water, interpolation: Default::default() }
    }
    fn rectangle(x0: f64, y0: f64, x1: f64, y1: f64) -> Shape {
        Shape { outer: vec![Point { x: x0, y: y0 }, Point { x: x1, y: y0 }, Point { x: x1, y: y1 }, Point { x: x0, y: y1 }], holes: vec![] }
    }
    /// A quay street along `x`, from y = 40 to y = 216, with its platform.
    fn quay(x: f64) -> (Vec<Street>, Vec<Quay>) {
        let street = Street { key: None, path: vec![Point { x, y: 40.0 }, Point { x, y: 216.0 }], widths: vec![6.0; 2], rank: 2, role: "quay".into() };
        let platform = Quay { kind: "quay".into(), shape: rectangle(x - 3.0, 40.0, x + 3.0, 216.0), deck_z_m: 2.0, material: "stone".into() };
        (vec![street], vec![platform])
    }
    fn count(found: &Plan, kind: &str) -> usize {
        found.items.iter().filter(|q| q.kind == kind).count()
    }

    /// Sea for x < 128: a merchant quay gets its quay wall, its cranes and its
    /// boats, every hull on the water and clear of the existing pier; the
    /// same seed gives the same harbour.
    #[test]
    fn a_sea_quay_is_furnished_on_clear_water() {
        let (height, water) = raster(1, 0.0, 128.0);
        let surface = ground(&height, &water);
        let (mut streets, mut platforms) = quay(132.0);
        streets.push(Street { key: None, path: vec![Point { x: 132.0, y: 100.0 }, Point { x: 100.0, y: 100.0 }], widths: vec![5.0; 2], rank: 3, role: "pier".into() });
        platforms.push(Quay { kind: "pier".into(), shape: rectangle(100.0, 97.5, 132.0, 102.5), deck_z_m: 2.0, material: "timber".into() });
        let harbour = plan("seed", "hanseatic", 10_000, "merchant-quay", &streets, &platforms, surface);
        assert_eq!(harbour.site, "sea");
        assert_eq!(harbour.family, "north-european");
        assert_eq!(harbour.types, vec!["merchant-quay"]);
        assert!(count(&harbour, "kerb") >= 10, "quay wall: {} kerbs", count(&harbour, "kerb"));
        assert!(count(&harbour, "crane") >= 1 && count(&harbour, "crane") == count(&harbour, "crane-jib"), "cranes {}", count(&harbour, "crane"));
        assert!(count(&harbour, "boat") <= MAX_BOATS);
        for item in harbour.items.iter().filter(|q| q.kind == "boat") {
            for p in &item.shape.outer {
                assert!(surface.wet(*p), "hull vertex on land: {p:?}");
                assert!(!(p.x > 100.0 && p.y > 97.5 && p.y < 102.5), "hull across the pier: {p:?}");
            }
            assert!(item.deck_z_m.is_finite());
        }
        let again = plan("seed", "hanseatic", 10_000, "merchant-quay", &streets, &platforms, surface);
        assert_eq!(harbour.items.len(), again.items.len());
        assert!(harbour.items.iter().zip(&again.items).all(|(a, b)| a.kind == b.kind && a.material == b.material && a.shape == b.shape));
    }

    /// The type is drawn with the town seed: stable for one town, varied
    /// between towns of the same culture, always one the family builds on
    /// that water; the planner reads the same draw for its moles.
    #[test]
    fn the_harbour_type_is_seeded_and_varies_between_towns() {
        let (height, water) = raster(1, 0.0, 128.0);
        let surface = ground(&height, &water);
        let (streets, platforms) = quay(132.0);
        assert_eq!(site_of("hanseatic", &streets, surface), Some("sea"));
        let family = &data()["families"]["north-european"]["types"];
        let mut seen = std::collections::BTreeSet::new();
        for town in 0..40 {
            let seed = format!("seed\u{1}settlement:town-{town}");
            let harbour = plan(&seed, "hanseatic", 10_000, "auto", &streets, &platforms, surface);
            assert!(!harbour.types.is_empty() && harbour.types.len() <= 2);
            for name in &harbour.types {
                assert!(family[*name].is_number(), "{name} is not a type of the family");
            }
            let choice = choose(&seed, "hanseatic", 10_000, "auto", "sea");
            assert_eq!(harbour.types, choice.types);
            assert_eq!(keeps_moles(&seed, "hanseatic", 10_000, "auto", &streets, surface), choice.moles);
            if choice.moles {
                assert!(num(&data()["types"][choice.types[0]], "moles", 0.0) > 0.0, "{} never keeps the moles", choice.types[0]);
            }
            seen.insert(harbour.types[0]);
        }
        assert!(seen.len() >= 3, "types drawn over 40 towns: {seen:?}");
        // A river-only type is never drawn on the sea, nor a village-only one in a town.
        assert!(!seen.contains("staithe") && !seen.contains("ferry-landing"));
        // `bare` and a quay away from the water keep the planner's works.
        assert!(keeps_moles("seed", "hanseatic", 10_000, "bare", &streets, surface));
        assert!(keeps_moles("seed", "hanseatic", 10_000, "auto", &quay(210.0).0, surface));
    }

    /// A 24 m river is a landing: two or three small boats alongside the bank
    /// (parallel to the flow), no stage, crane, slip or raft, nothing past
    /// the near half of the channel. Whatever the type asks for (a fishing
    /// harbour moors stern-to on the sea).
    #[test]
    fn a_river_staithe_keeps_the_channel_free() {
        let (height, water) = raster(3, 116.0, 140.0);
        let surface = ground(&height, &water);
        let (streets, platforms) = quay(144.0);
        for wanted in ["staithe", "fishing-harbour"] {
            let harbour = plan("seed", "hanseatic", 4000, wanted, &streets, &platforms, surface);
            assert_eq!(harbour.site, "river");
            assert_eq!(harbour.types, vec![wanted]);
            assert!(count(&harbour, "basin") == 0 && count(&harbour, "breakwater") == 0);
            for kind in ["jetty", "crane", "slip", "raft", "boat-ashore"] {
                assert_eq!(count(&harbour, kind), 0, "{kind} on a 24 m river ({wanted})");
            }
            let boats: Vec<&Quay> = harbour.items.iter().filter(|q| q.kind == "boat").collect();
            assert!(!boats.is_empty() && boats.len() <= 3, "{} boats on a 24 m river ({wanted})", boats.len());
            for boat in boats {
                let (x0, y0, x1, y1) = bbox(&boat.shape.outer);
                assert!(y1 - y0 > x1 - x0, "boat square to the bank ({wanted})");
                assert!(boat.shape.outer.iter().all(|p| p.x > 127.0), "boat across the channel ({wanted})");
            }
        }
    }

    /// On an open sea front each forced type builds what its name says: a
    /// mole harbour its breakwater, a fishing harbour its jetties, a shipyard
    /// its slips, a small-craft basin its pontoon comb.
    #[test]
    fn each_harbour_type_builds_its_own_works_on_a_sea_front() {
        let (height, water) = raster(1, 0.0, 128.0);
        let surface = ground(&height, &water);
        let (streets, platforms) = quay(132.0);
        let built = |wanted: &str| plan("seed", "hanseatic", 10_000, wanted, &streets, &platforms, surface);
        assert!(count(&built("mole-harbour"), "breakwater") >= 2, "a mole harbour without its mole");
        assert!(count(&built("fishing-harbour"), "jetty") >= 3, "a fishing harbour without its jetties");
        assert!(count(&built("shipyard"), "slip") >= 3, "a shipyard without its slips");
        assert!(count(&built("small-craft-basin"), "jetty") >= 6, "a small-craft basin without its comb");
        assert_eq!(count(&built("merchant-quay"), "breakwater"), 0);
    }

    /// A town on a 56 m river with a bridge and no quay lands its boats: a
    /// plain landing strip, three posts and small boats alongside the town bank,
    /// parallel to the flow and clear of the bridge.
    #[test]
    fn a_river_town_without_quay_lands_its_boats_beside_its_bridge() {
        let (height, water) = raster(3, 84.0, 140.0);
        let surface = ground(&height, &water);
        let mut layout: Layout = serde_json::from_value(serde_json::json!({
            "key": "village", "culture": "hanseatic", "center": {"x": 200.0, "y": 128.0},
            "quarters": [], "blocks": [], "warnings": [], "structure": {},
            "streets": [{"path": [{"x": 160.0, "y": 128.0}, {"x": 60.0, "y": 128.0}], "widths": [5.0, 5.0], "rank": 2, "role": "bridge"}]
        }))
        .unwrap();
        furnish("seed", &mut layout, 2500, &LayoutConfig::default(), surface);
        let items = &layout.structure.as_ref().unwrap().quays;
        let of = |kind: &str| items.iter().filter(|q| q.kind == kind).collect::<Vec<_>>();
        assert_eq!(of("landing").len(), 1, "one plain landing strip");
        assert!(of("kerb").is_empty() && of("jetty").is_empty() && of("shiphouse").is_empty());
        assert_eq!(of("post").len(), 3);
        let boats = of("boat");
        assert!(!boats.is_empty() && boats.len() <= 3, "{} boats at the landing", boats.len());
        for boat in boats {
            let (x0, y0, x1, y1) = bbox(&boat.shape.outer);
            assert!(y1 - y0 > x1 - x0, "boat square to the river");
            assert!(x0 > 127.0 && x1 < 140.0, "boat off the town bank: {x0}..{x1}");
            assert!(y1 < 120.0 || y0 > 136.0, "boat under the bridge");
        }
        // Idempotent.
        furnish("seed", &mut layout, 2500, &LayoutConfig::default(), surface);
        assert_eq!(layout.structure.as_ref().unwrap().quays.iter().filter(|q| q.kind == "post").count(), 3);
    }

    /// A 512 m map of 4 m cells, sea all round an island of radius 90 m
    /// centred on (256, 256), with a cove 28 m wide cut 46 m into its east
    /// shore; `streets` are the settlement's own.
    fn island_village(streets: serde_json::Value) -> ((Vec<f32>, Vec<u8>), Layout) {
        let n = 128;
        let water = (0..n * n)
            .map(|i| {
                let (x, y) = (((i % n) as f64 + 0.5) * 4.0, ((i / n) as f64 + 0.5) * 4.0);
                let land = (x - 256.0).hypot(y - 256.0) < 90.0 && !(x > 300.0 && (y - 256.0).abs() < 14.0);
                u8::from(!land)
            })
            .collect();
        let layout = serde_json::from_value(serde_json::json!({
            "key": "isle", "culture": "hanseatic", "center": {"x": 256.0, "y": 256.0},
            "quarters": [], "blocks": [], "warnings": [], "structure": {}, "streets": streets
        }))
        .unwrap();
        ((vec![1.0; n * n], water), layout)
    }
    fn isle<'a>(height: &'a [f32], water: &'a [u8]) -> Surface<'a> {
        Surface { geometry: None, width: 512.0, n: 128, height, water, interpolation: Default::default() }
    }
    fn of<'a>(layout: &'a Layout, kind: &str) -> Vec<&'a Quay> {
        layout.structure.as_ref().unwrap().quays.iter().filter(|q| q.kind == kind).collect()
    }

    /// A village in the middle of a small island, its streets 40 m from any
    /// shore, gets a detached landing in the island's cove: one plain strip,
    /// its posts, boats on the water, and a track to the village.
    #[test]
    fn an_island_village_away_from_its_shore_gets_a_detached_landing_in_a_cove() {
        let ((height, water), mut layout) = island_village(serde_json::json!([
            {"path": [{"x": 236.0, "y": 256.0}, {"x": 256.0, "y": 256.0}], "widths": [4.0, 4.0], "rank": 3, "role": "street"}
        ]));
        let surface = isle(&height, &water);
        furnish("seed", &mut layout, 300, &LayoutConfig::default(), surface);
        let kerbs = of(&layout, "landing");
        assert_eq!(kerbs.len(), 1, "one landing");
        assert!(of(&layout, "kerb").is_empty() && of(&layout, "jetty").is_empty() && of(&layout, "shiphouse").is_empty());
        let c = mean(&kerbs[0].shape.outer);
        assert!(c.x > 288.0 && c.x < 350.0 && (c.y - 256.0).abs() < 20.0, "the landing is not in the cove: {c:?}");
        let boats = of(&layout, "boat");
        assert!(!boats.is_empty() && boats.len() <= 3, "{} boats", boats.len());
        assert!(boats.iter().all(|b| b.shape.outer.iter().all(|&p| surface.wet(p))), "a boat on land");
        assert!(of(&layout, "breakwater").is_empty() && of(&layout, "crane").is_empty());
        let track = layout.streets.iter().find(|s| s.role == "track").expect("no track to the landing");
        let ends = [track.path[0], *track.path.last().unwrap()];
        assert!(ends.iter().any(|&p| dist(p, Point { x: 256.0, y: 256.0 }) < 1.0), "the track misses the village: {ends:?}");
        assert!(ends.iter().any(|&p| dist(p, c) < 8.0), "the track misses the landing: {ends:?}");
        // Idempotent: a second pass adds nothing.
        furnish("seed", &mut layout, 300, &LayoutConfig::default(), surface);
        assert_eq!(of(&layout, "landing").len(), 1);
        assert_eq!(layout.streets.iter().filter(|s| s.role == "track").count(), 1);
    }

    /// An island village whose streets reach the water lands its boats on its
    /// own waterfront (the west shore).
    #[test]
    fn an_island_village_on_its_shore_lands_on_its_own_waterfront() {
        let ((height, water), mut layout) = island_village(serde_json::json!([
            {"path": [{"x": 256.0, "y": 256.0}, {"x": 176.0, "y": 256.0}], "widths": [4.0, 4.0], "rank": 3, "role": "street"}
        ]));
        let surface = isle(&height, &water);
        furnish("seed", &mut layout, 300, &LayoutConfig::default(), surface);
        let kerbs = of(&layout, "landing");
        assert_eq!(kerbs.len(), 1);
        assert!(mean(&kerbs[0].shape.outer).x < 200.0, "the landing left its waterfront");
        assert!(of(&layout, "shiphouse").is_empty());
    }

    /// Fifteen islanders: one small structure (a landing strip) and at most
    /// three boats; no jetty, shed, crane or breakwater.
    #[test]
    fn a_tiny_island_settlement_gets_one_small_landing() {
        let ((height, water), mut layout) = island_village(serde_json::json!([
            {"path": [{"x": 246.0, "y": 256.0}, {"x": 256.0, "y": 256.0}], "widths": [3.0, 3.0], "rank": 4, "role": "lane"}
        ]));
        let surface = isle(&height, &water);
        furnish("seed", &mut layout, 15, &LayoutConfig::default(), surface);
        let structures: usize = ["landing", "kerb", "jetty", "slip", "shiphouse", "quay", "breakwater", "crane"].iter().map(|k| of(&layout, k).len()).sum();
        assert_eq!(structures, 1, "{:?}", layout.structure.as_ref().unwrap().quays.iter().map(|q| &q.kind).collect::<Vec<_>>());
        assert!(of(&layout, "boat").len() + of(&layout, "boat-ashore").len() <= 3);
    }

    /// A village's quay and an Underdark town's quay become one plain landing
    /// on the waterline: the planner's platforms and stages go, no kerb,
    /// jetty, crane, breakwater or shed; a strip, its posts, two or three
    /// boats on the water. A town of the surface keeps its quays.
    #[test]
    fn villages_and_underdark_ports_land_on_one_plain_strip() {
        let (height, water) = raster(1, 0.0, 128.0);
        let surface = ground(&height, &water);
        let built = |culture: &str, population: u32| {
            let (streets, platforms) = quay(132.0);
            let mut layout: Layout = serde_json::from_value(serde_json::json!({
                "key": "port", "culture": culture, "center": {"x": 180.0, "y": 128.0},
                "quarters": [], "blocks": [], "warnings": [], "structure": {"quays": platforms}, "streets": streets
            }))
            .unwrap();
            layout.streets.push(Street { key: None, path: vec![Point { x: 132.0, y: 100.0 }, Point { x: 110.0, y: 100.0 }], widths: vec![3.0; 2], rank: 3, role: "landing".into() });
            furnish("seed", &mut layout, population, &LayoutConfig::default(), surface);
            layout
        };
        for (culture, population) in [("hanseatic", 600), ("drow-enclave", 10_000)] {
            let layout = built(culture, population);
            let kinds: Vec<&str> = layout.structure.as_ref().unwrap().quays.iter().map(|q| q.kind.as_str()).collect();
            assert_eq!(kinds.iter().filter(|&&k| k == "landing").count(), 1, "{culture}: {kinds:?}");
            for kind in ["quay", "kerb", "jetty", "crane", "breakwater", "shiphouse", "slip", "pier", "basin"] {
                assert!(!kinds.contains(&kind), "{culture}: {kind} in a plain landing");
            }
            let boats: Vec<&Quay> = layout.structure.as_ref().unwrap().quays.iter().filter(|q| q.kind == "boat").collect();
            assert!(!boats.is_empty() && boats.len() <= 3, "{culture}: {} boats", boats.len());
            assert!(boats.iter().all(|b| b.shape.outer.iter().all(|&p| surface.wet(p))));
            assert!(!layout.streets.iter().any(|s| s.role == "landing"), "{culture}: the stage street stays");
            assert!(!layout.streets.iter().any(|s| s.role == "quay"), "{culture}: quay paving on the bank");
            let deck = layout.structure.as_ref().unwrap().quays.iter().find(|q| q.kind == "landing").unwrap().deck_z_m;
            assert!(layout.structure.as_ref().unwrap().quays.iter().filter(|q| q.kind == "post").all(|q| (q.deck_z_m - (deck - 0.1)).abs() < 1e-9), "{culture}: posts a metre above the deck");
            // The strip lies on the waterline.
            let strip = layout.structure.as_ref().unwrap().quays.iter().find(|q| q.kind == "landing").unwrap();
            let (x0, _, x1, _) = bbox(&strip.shape.outer);
            assert!(x0 < 128.0 && x1 > 126.0 && x1 - x0 < 3.0, "{culture}: strip at x {x0}..{x1}");
            // Idempotent.
            let mut again = layout.clone();
            furnish("seed", &mut again, population, &LayoutConfig::default(), surface);
            assert_eq!(again.structure.as_ref().unwrap().quays.len(), layout.structure.as_ref().unwrap().quays.len());
        }
        // A town: one quay band on the waterline (4.5 m on the bank, 1 m over
        // the water), no kerb; its quay street stays.
        let town = built("hanseatic", 10_000);
        let quays = &town.structure.as_ref().unwrap().quays;
        let bands: Vec<&Quay> = quays.iter().filter(|q| q.kind == "quay").collect();
        assert_eq!(bands.len(), 1, "{:?}", quays.iter().map(|q| q.kind.as_str()).collect::<Vec<_>>());
        let (x0, _, x1, _) = bbox(&bands[0].shape.outer);
        assert!(x0 > 125.5 && x0 < 128.0 && (x1 - x0 - 5.5).abs() < 0.6, "band at x {x0}..{x1}");
        assert!(!quays.iter().any(|q| matches!(q.kind.as_str(), "kerb" | "breakwater" | "mole")));
        assert!(town.streets.iter().any(|s| s.role == "quay"));
    }

    /// A port town on a plateau 40 m above the sea (x < 100), its streets 110 m
    /// from the shore, with the coast profile `rise(x)` (m above the water).
    fn cliff_port(rise: impl Fn(f64) -> f64) -> ((Vec<f32>, Vec<u8>), Layout) {
        let water = (0..N * N).map(|i| u8::from(((i % N) as f64 + 0.5) * 4.0 < 100.0)).collect();
        let height = (0..N * N).map(|i| { let x = ((i % N) as f64 + 0.5) * 4.0; if x < 100.0 { 0.0 } else { rise(x).min(40.0) as f32 } }).collect();
        let layout = serde_json::from_value(serde_json::json!({
            "key": "cliff", "culture": "hanseatic", "center": {"x": 225.0, "y": 128.0},
            "quarters": [], "blocks": [], "warnings": [], "structure": {},
            "streets": [{"path": [{"x": 210.0, "y": 128.0}, {"x": 240.0, "y": 128.0}], "widths": [5.0, 5.0], "rank": 2, "role": "street"}]
        }))
        .unwrap();
        ((height, water), layout)
    }
    fn port_cfg() -> LayoutConfig {
        LayoutConfig { site_archetype: "harbor".into(), ..LayoutConfig::default() }
    }

    /// A shelf at the water (12 m at 1 m) under a 30° slope: a landing at the
    /// foot and a path up to the town whose every leg keeps a footpath grade.
    #[test]
    fn a_plateau_port_lands_at_the_foot_of_its_slope_with_a_climbing_path() {
        let ((height, water), mut layout) = cliff_port(|x| if x < 112.0 { 1.0 } else { 1.0 + (x - 112.0) * 0.557 });
        let surface = ground(&height, &water);
        furnish("seed", &mut layout, 1200, &port_cfg(), surface);
        let items = &layout.structure.as_ref().unwrap().quays;
        let strip = items.iter().find(|q| q.kind == "landing").expect("no landing at the foot");
        assert!(bbox(&strip.shape.outer).0 < 101.0, "the landing is not at the water");
        assert!(items.iter().filter(|q| q.kind == "boat").all(|b| b.shape.outer.iter().all(|&p| surface.wet(p))));
        let track = layout.streets.iter().find(|s| s.role == "track").expect("no path up to the town");
        for w in track.path.windows(2) {
            let (run, climb) = (dist(w[0], w[1]), (surface.height_at(w[1]) - surface.height_at(w[0])).abs());
            assert!(climb <= FOOTPATH_GRADE * run + 0.5, "a leg climbs {climb:.1} m over {run:.1} m");
        }
        let (start, end) = (track.path[0], *track.path.last().unwrap());
        assert!(surface.height_at(start).min(surface.height_at(end)) < 3.0 && surface.height_at(start).max(surface.height_at(end)) > 35.0, "the path does not join the foot to the plateau");
    }

    /// A sheer cliff (35 m within 10 m of the water) lands nothing.
    #[test]
    fn a_sheer_cliff_lands_nothing() {
        let ((height, water), mut layout) = cliff_port(|x| (x - 100.0) * 3.5);
        let surface = ground(&height, &water);
        furnish("seed", &mut layout, 1200, &port_cfg(), surface);
        assert!(layout.structure.as_ref().unwrap().quays.is_empty());
        assert!(!layout.streets.iter().any(|s| s.role == "track"));
    }

    /// A steep bank (35°) with no shelf: no landing, a few boats moored at its
    /// foot, a path down.
    #[test]
    fn a_steep_bank_without_shelf_gets_boats_only() {
        let ((height, water), mut layout) = cliff_port(|x| (x - 100.0) * 0.7);
        let surface = ground(&height, &water);
        furnish("seed", &mut layout, 1200, &port_cfg(), surface);
        let items = &layout.structure.as_ref().unwrap().quays;
        assert!(!items.iter().any(|q| q.kind == "landing" || q.kind == "post"), "a landing on a steep bank");
        let boats: Vec<&Quay> = items.iter().filter(|q| q.kind == "boat").collect();
        assert!(!boats.is_empty() && boats.iter().all(|b| b.shape.outer.iter().all(|&p| surface.wet(p))));
        assert!(layout.streets.iter().any(|s| s.role == "track"), "no path down to the boats");
    }

    /// A mainland village inland (the land reaches the map edge, no fishing
    /// economy) gets no landing.
    #[test]
    fn a_mainland_inland_village_gets_no_landing() {
        let n = 128;
        let water: Vec<u8> = (0..n * n).map(|i| u8::from(((i % n) as f64 + 0.5) * 4.0 < 40.0)).collect();
        let height = vec![1.0; n * n];
        let surface = isle(&height, &water);
        let mut layout: Layout = serde_json::from_value(serde_json::json!({
            "key": "inland", "culture": "hanseatic", "center": {"x": 300.0, "y": 256.0},
            "quarters": [], "blocks": [], "warnings": [], "structure": {},
            "streets": [{"path": [{"x": 290.0, "y": 256.0}, {"x": 310.0, "y": 256.0}], "widths": [4.0, 4.0], "rank": 3, "role": "street"}]
        }))
        .unwrap();
        furnish("seed", &mut layout, 300, &LayoutConfig::default(), surface);
        assert!(layout.structure.as_ref().unwrap().quays.is_empty());
        assert!(!layout.streets.iter().any(|s| s.role == "track"));
    }

    /// A wide river (60 m) keeps its staithe stages and boats, all short of a
    /// quarter of the channel, every boat alongside the bank.
    #[test]
    fn a_wide_river_staithe_stays_along_its_bank() {
        let (height, water) = raster(3, 84.0, 140.0);
        let surface = ground(&height, &water);
        let (streets, platforms) = quay(144.0);
        let harbour = plan("seed", "hanseatic", 6000, "staithe", &streets, &platforms, surface);
        assert_eq!(harbour.site, "river");
        assert!(count(&harbour, "boat") >= 3, "{} boats on a 60 m river", count(&harbour, "boat"));
        for item in harbour.items.iter().filter(|q| matches!(q.kind.as_str(), "boat" | "jetty" | "raft" | "slip")) {
            assert!(item.shape.outer.iter().all(|p| p.x > 140.0 - 0.25 * 56.0 - 0.5), "{} reaches past a quarter of the river", item.kind);
            if item.kind == "boat" {
                let (x0, y0, x1, y1) = bbox(&item.shape.outer);
                assert!(y1 - y0 > x1 - x0, "boat square to the bank");
            }
        }
    }

    /// `bare` keeps the planner's quays alone; a quay away from any water gets nothing.
    #[test]
    fn a_bare_port_and_a_dry_quay_get_no_furniture() {
        let (height, water) = raster(1, 0.0, 128.0);
        let surface = ground(&height, &water);
        let (streets, platforms) = quay(132.0);
        assert!(plan("seed", "hanseatic", 10_000, "bare", &streets, &platforms, surface).items.is_empty());
        let (dry, dry_platforms) = quay(210.0);
        assert_eq!(site_of("hanseatic", &dry, surface), None);
        let inland = plan("seed", "hanseatic", 10_000, "auto", &dry, &dry_platforms, surface);
        assert!(inland.items.is_empty() && inland.types.is_empty());
    }

    /// The catalogue is closed: families name known types, boat classes and
    /// cultures; every culture of the urban catalogue belongs to one family.
    #[test]
    fn the_harbour_catalogue_is_consistent() {
        let (types, boats) = (&data()["types"], &data()["boats"]);
        let cultures = &super::super::catalogue()["cultures"];
        let mut listed = std::collections::BTreeSet::new();
        for (name, family) in data()["families"].as_object().unwrap() {
            for (kind, weight) in family["types"].as_object().unwrap() {
                assert!(types[kind].is_object() && weight.as_f64().is_some_and(|w| w > 0.0), "{name}: type {kind}");
            }
            for role in ["merchant", "lighter", "fishing", "small", "war", "ferry"] {
                let class = family["boats"][role].as_str().unwrap_or("");
                assert!(boats[class]["length"].as_f64().is_some_and(|l| l > 0.0), "{name}: boat {role} = {class}");
            }
            for culture in family["cultures"].as_array().unwrap() {
                let culture = culture.as_str().unwrap();
                assert!(cultures[culture].is_object(), "{name}: unknown culture {culture}");
                assert!(listed.insert(culture.to_string()), "{culture} is in two families");
            }
        }
        for (kind, recipe) in types.as_object().unwrap() {
            assert_eq!(recipe["label"].as_array().map(Vec::len), Some(2), "{kind}: label");
            assert!((0.0..=1.0).contains(&num(recipe, "moles", 0.0)), "{kind}: moles is a probability");
            for role in recipe["boats"].as_object().unwrap().keys() {
                assert!(["merchant", "lighter", "fishing", "small", "war", "ferry"].contains(&role.as_str()), "{kind}: role {role}");
            }
        }
        for culture in cultures.as_object().unwrap().keys() {
            assert!(listed.contains(culture), "{culture} has no harbour family");
        }
    }
}
