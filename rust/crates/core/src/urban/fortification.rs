//! Fortification typology and integrated structures (stream W).
//!
//! `resolve` picks a style inside the kind `profiles::fortification` chose
//! (wall, palisade, hedge): presets and cultural tables live in
//! `fortifications.json`, a culture may override them in `catalogue.json`
//! (`cultures[c].fortification`). `build` turns one curtain into its towers,
//! gatehouses, bastions, outworks, ditch and lean-tos. Every structure goes
//! through the same clip rules, never a local exception:
//! 1. nothing inside the inner face of the curtain (`inner_core`);
//! 2. nothing on a street ribbon (+1 m): gates keep a passage, ditches a causeway;
//! 3. nothing wet (towers, gatehouses and bastions: no wet vertex or centre;
//!    works at least 90 % dry), and a tower or bastion keeping less than 60 %
//!    of its nominal area is dropped.
//!
//! The union of the curtain body and every structure outside the inner face is
//! the enclosure's `reserve`; quarters give it up (`yield_reserve`), so no
//! block or lot is ever cut in a tower, a ditch or a glacis.
use super::{
    Attached, Enclosure, Gatehouse, Point, Quarter, Shape, Street, Surface, Tower, Work,
    geometry as g,
};
use crate::rng::Rng;
use serde_json::Value;
use std::sync::OnceLock;

pub(super) const STYLES: [&str; 9] = [
    "palisade",
    "gord",
    "hedge",
    "curtain",
    "flanked",
    "concentric",
    "rammed-earth",
    "wengcheng",
    "bastioned",
];

/// Half width of the curtain ribbon `quarters.rs` cuts (inner face at −h).
pub(super) fn ribbon_half(kind: &str) -> f64 {
    if kind == "wall" { 1.5 } else { 0.75 }
}

fn data() -> &'static Value {
    static DATA: OnceLock<Value> = OnceLock::new();
    DATA.get_or_init(|| {
        serde_json::from_str(include_str!("fortifications.json")).expect("fortification table")
    })
}

#[derive(Clone, Debug)]
pub(super) struct Style {
    pub id: String,
    pub kind: String,
    pub material: String,
    pub curtain_width: f64,
    pub height: f64,
    pub tower_height: f64,
    /// Corner, gate and water towers.
    pub tower_shape: String,
    pub flank_shape: String,
    /// Flank, then corner/gate half size.
    pub tower_radius: [f64; 2],
    pub flank_depth: f64,
    /// `None`: no intermediate flanking towers.
    pub tower_spacing: Option<[f64; 2]>,
    /// Corner towers where the curtain turns more than this (degrees).
    pub corner_turn: Option<f64>,
    pub salients_only: bool,
    pub gate_towers: bool,
    pub gate_major: String,
    pub gate_minor: String,
    pub gate_min_pop: u32,
    pub gate_height: f64,
    pub ditch: String,
    pub ditch_p: f64,
    pub ditch_width: [f64; 2],
    pub berm: f64,
    pub outworks: Vec<String>,
    pub outer_gap: [f64; 2],
    pub outer_width: f64,
    pub outer_height: f64,
    pub court_radius: [f64; 2],
    pub attached: f64,
    /// Hill town: the curtain follows the growth outline (contour trace).
    pub hill: bool,
    pub forced: bool,
}

fn num(v: &Value, key: &str, default: f64) -> f64 {
    v[key].as_f64().unwrap_or(default)
}
fn pair(v: &Value, default: [f64; 2]) -> [f64; 2] {
    match v {
        Value::Array(a) if a.len() == 2 => [
            a[0].as_f64().unwrap_or(default[0]),
            a[1].as_f64().unwrap_or(default[1]),
        ],
        Value::Number(n) => {
            let x = n.as_f64().unwrap_or(default[0]);
            [x, x]
        }
        _ => default,
    }
}
fn text(v: &Value, key: &str, default: &str) -> String {
    v[key].as_str().unwrap_or(default).to_string()
}

impl Style {
    fn preset(id: &str) -> Option<Style> {
        let v = &data()["styles"][id];
        if !v.is_object() {
            return None;
        }
        let shape = text(v, "towerShape", "round");
        let height = num(v, "heightM", 7.0);
        Some(Style {
            id: id.into(),
            kind: v["kind"].as_str()?.into(),
            material: text(v, "material", "stone"),
            curtain_width: num(v, "curtainWidthM", 3.0),
            height,
            tower_height: num(v, "towerHeightM", height + 3.0),
            flank_shape: text(v, "flankShape", &shape),
            tower_shape: shape,
            tower_radius: pair(&v["towerRadius"], [3.0, 3.0]),
            flank_depth: num(v, "flankDepthM", 0.0),
            tower_spacing: (!v["towerSpacing"].is_null())
                .then(|| pair(&v["towerSpacing"], [55.0, 55.0])),
            corner_turn: v["cornerTurn"].as_f64(),
            salients_only: v["salientsOnly"].as_bool().unwrap_or(false),
            gate_towers: v["gateTowers"].as_bool().unwrap_or(false),
            gate_major: text(v, "gate", "opening"),
            gate_minor: text(v, "minorGate", "opening"),
            gate_min_pop: v["gateMinPop"].as_u64().unwrap_or(0) as u32,
            gate_height: num(v, "gateHeightM", 0.0),
            ditch: text(v, "ditch", "none"),
            ditch_p: num(v, "ditchP", 1.0),
            ditch_width: pair(&v["ditchWidthM"], [0.0, 0.0]),
            berm: num(v, "bermM", 2.0),
            outworks: v["outworks"]
                .as_array()
                .map(|a| {
                    a.iter()
                        .filter_map(|x| x.as_str().map(String::from))
                        .collect()
                })
                .unwrap_or_default(),
            outer_gap: pair(&v["outerGapM"], [10.0, 14.0]),
            outer_width: num(v, "outerWidthM", 2.0),
            outer_height: num(v, "outerHeightM", 6.0),
            court_radius: pair(&v["courtRadiusM"], [18.0, 30.0]),
            attached: num(v, "attached", 0.0),
            hill: false,
            forced: false,
        })
    }
    /// Culture overrides (`fortifications.json` then `catalogue.json`).
    fn apply(&mut self, o: &Value) {
        if !o.is_object() {
            return;
        }
        let fixed = data()["styles"][&self.id]["fixedTowers"]
            .as_bool()
            .unwrap_or(false);
        let own_flank = data()["styles"][&self.id]["flankShape"].is_string();
        if let Some(m) = o["material"].as_str()
            && self.kind == "wall"
        {
            self.material = m.into();
        }
        if let Some(t) = o["towers"].as_str()
            && !fixed
        {
            self.tower_shape = t.into();
            if !own_flank {
                self.flank_shape = t.into();
            }
        }
        if o.get("towerSpacing").is_some() && !fixed {
            self.tower_spacing =
                (!o["towerSpacing"].is_null()).then(|| pair(&o["towerSpacing"], [55.0, 55.0]));
        }
        if o.get("cornerTurn").is_some() && !fixed {
            self.corner_turn = o["cornerTurn"].as_f64();
        }
        if o["towerRadius"].is_array() || o["towerRadius"].is_number() {
            self.tower_radius = pair(&o["towerRadius"], self.tower_radius);
        }
        if let Some(gate) = o["gate"].as_str()
            && self.kind == "wall"
            && self.id != "bastioned"
        {
            self.gate_major = gate.into();
        }
        if let Some(d) = o["ditch"].as_str()
            && d != "auto"
        {
            self.ditch = d.into();
        }
        if let Some(h) = o["heightM"].as_f64().or_else(|| o["heightM"][1].as_f64()) {
            self.tower_height += h - self.height;
            self.height = h;
        }
        if let Some(w) = o["curtainWidthM"].as_f64()
            && self.id != "bastioned"
        {
            self.curtain_width = w;
        }
        if let Some(a) = o["attached"].as_f64() {
            self.attached = a;
        }
    }
    /// The style the older inner circuit keeps: one step down, no ditch, no outworks.
    pub(super) fn inner(&self, culture: &str, pop: u32) -> Style {
        let id = match self.id.as_str() {
            "bastioned" | "concentric" => "flanked",
            "flanked" if pop < 10_000 => "curtain",
            other => other,
        };
        let mut s = styled(id, culture, pop);
        s.hill = self.hill;
        s.ditch = "none".into();
        s.outworks.clear();
        s
    }
}

fn family(style: &str) -> &'static str {
    match style {
        "palisade" | "gord" => "palisade",
        "hedge" => "hedge",
        _ => "wall",
    }
}
fn label(kind: &str) -> &'static str {
    match kind {
        "palisade" => "palissade",
        "hedge" => "haie",
        _ => "muraille",
    }
}
fn culture_override(culture: &str) -> [&'static Value; 2] {
    [
        &data()["cultures"][culture],
        &super::catalogue()["cultures"][culture]["fortification"],
    ]
}
fn group(culture: &str) -> &'static Value {
    let groups = &data()["groups"];
    groups
        .as_object()
        .and_then(|m| {
            m.values().find(|gr| {
                gr["cultures"]
                    .as_array()
                    .is_some_and(|a| a.iter().any(|c| c.as_str() == Some(culture)))
            })
        })
        .unwrap_or(&groups["default"])
}

/// A preset with the culture's tower shape and overrides, sized for `pop`.
fn styled(id: &str, culture: &str, pop: u32) -> Style {
    let mut s = Style::preset(id).unwrap_or_else(|| Style::preset("curtain").expect("preset"));
    let c = &super::catalogue()["cultures"][culture];
    if !data()["styles"][id]["fixedTowers"]
        .as_bool()
        .unwrap_or(false)
        && let Some(t) = c["core"]["enclosure"]["towers"]
            .as_str()
            .or_else(|| c["render"]["towerShape"].as_str())
    {
        s.tower_shape = t.into();
        if !data()["styles"][id]["flankShape"].is_string() {
            s.flank_shape = t.into();
        }
    }
    // Group defaults (an earthwork rampart, ...), then the culture's own.
    s.apply(group(culture));
    for o in culture_override(culture) {
        s.apply(o);
    }
    if id == "wengcheng" {
        if pop < 10_000 {
            s.material = "rammed-earth".into();
        }
        let t = ((pop as f64 / 20_000.0).max(1.0).log10()).clamp(0.0, 1.0);
        s.curtain_width = 6.0 + 6.0 * t;
    }
    let min = data()["styles"][id]["outworkMinPop"].as_u64().unwrap_or(0);
    if (pop as u64) < min {
        s.outworks.retain(|w| w != "antemural" && w != "citadel");
    }
    s
}

pub(super) struct Inputs<'a> {
    pub culture: &'a str,
    pub pop: u32,
    pub period: &'a str,
    pub state: &'a str,
    pub archetype: &'a str,
    pub forced: &'a str,
    /// Length-weighted relief of the curtain (`terrain`).
    pub relief: f64,
}

/// Prosperity in [0, 1] from population and settlement condition.
pub(super) fn prosperity(pop: u32, state: &str) -> f64 {
    let base = ((f64::from(pop.max(1)).log10() - 3.3) / 1.7).clamp(0.0, 1.0);
    base * match state {
        "declining" => 0.75,
        "abandoned" | "ruined" => 0.5,
        _ => 1.0,
    }
}

fn period_allows(style: &str, period: &str, culture: &str) -> bool {
    match period {
        "A" => {
            style != "bastioned"
                && (style != "concentric" || matches!(culture, "byzantine-greek" | "roman-core"))
        }
        "M" => style != "bastioned",
        _ => true,
    }
}

/// The style of a fortification of `kind`, deterministic per site (`rng` is
/// the site's `fortification` stream; only forks of it are drawn).
pub(super) fn resolve(kind: &str, i: &Inputs, rng: &Rng, warnings: &mut Vec<String>) -> Style {
    let material = culture_override(i.culture)
        .iter()
        .rev()
        .find_map(|o| o["material"].as_str())
        .unwrap_or("");
    let mut id = match kind {
        "hedge" => "hedge".to_string(),
        "palisade" if material == "timber-earth" => "gord".into(),
        "palisade" => "palisade".into(),
        _ => String::new(),
    };
    let mut forced = false;
    if i.forced != "auto" && STYLES.contains(&i.forced) {
        if family(i.forced) == family_of_kind(kind) {
            id = i.forced.into();
            forced = true;
        } else {
            warnings.push(format!(
                "Style de fortification « {} » incompatible avec {} : style culturel conservé.",
                i.forced,
                label(kind)
            ));
        }
    }
    if id.is_empty() {
        let p = prosperity(i.pop, i.state);
        let defensive = matches!(i.archetype, "hilltop" | "spur" | "pass" | "island");
        let [own, cat] = culture_override(i.culture);
        let table = if cat["styles"].is_array() {
            &cat["styles"]
        } else if own["styles"].is_array() {
            &own["styles"]
        } else {
            &group(i.culture)["styles"]
        };
        let candidates: Vec<(&str, u32)> = table
            .as_array()
            .into_iter()
            .flatten()
            .filter(|c| {
                let s = c["style"].as_str().unwrap_or("");
                family(s) == "wall"
                    && Style::preset(s).is_some()
                    && c["minPop"].as_u64().is_none_or(|m| i.pop as u64 >= m)
                    && c["maxPop"].as_u64().is_none_or(|m| i.pop as u64 <= m)
                    && c["periods"]
                        .as_array()
                        .is_none_or(|a| a.iter().any(|x| x.as_str() == Some(i.period)))
                    && period_allows(s, i.period, i.culture)
                    && (c["needs"].as_str() != Some("strong") || p > 0.6 || defensive)
            })
            .map(|c| {
                (
                    c["style"].as_str().unwrap_or("flanked"),
                    c["weight"].as_u64().unwrap_or(1).max(1) as u32,
                )
            })
            .collect();
        id = if candidates.is_empty() {
            if i.pop >= 3000 { "flanked" } else { "curtain" }.into()
        } else {
            let weights: Vec<u32> = candidates.iter().map(|c| c.1).collect();
            let k = rng
                .fork("style")
                .weighted_index(&weights)
                .unwrap_or_default();
            candidates[k].0.into()
        };
    }
    // Terrain modifiers apply after the draw, so the draw itself stays stable.
    let hill = i.relief > 0.07 && family(&id) == "wall";
    if hill && !forced && matches!(id.as_str(), "bastioned" | "concentric") {
        warnings.push(format!(
            "Fortification : tracé {} ramené à une enceinte flanquée (relief).",
            if id == "bastioned" {
                "bastionné"
            } else {
                "à double enceinte"
            }
        ));
        id = "flanked".into();
    }
    let mut s = styled(&id, i.culture, i.pop);
    s.hill = hill;
    s.forced = forced;
    s
}
fn family_of_kind(kind: &str) -> &'static str {
    match kind {
        "palisade" => "palisade",
        "hedge" => "hedge",
        _ => "wall",
    }
}

// ---------------------------------------------------------------- vectors

type V = (f64, f64);
fn pt(x: f64, y: f64) -> Point {
    Point { x, y }
}
fn add(p: Point, d: V, k: f64) -> Point {
    pt(p.x + d.0 * k, p.y + d.1 * k)
}
fn dir(a: Point, b: Point) -> V {
    let l = (b.x - a.x).hypot(b.y - a.y).max(1e-12);
    ((b.x - a.x) / l, (b.y - a.y) / l)
}
fn dist(a: Point, b: Point) -> f64 {
    (a.x - b.x).hypot(a.y - b.y)
}
fn dot(a: V, b: V) -> f64 {
    a.0 * b.0 + a.1 * b.1
}
fn cross(a: V, b: V) -> f64 {
    a.0 * b.1 - a.1 * b.0
}
fn unit(v: V) -> V {
    let l = v.0.hypot(v.1).max(1e-12);
    (v.0 / l, v.1 / l)
}
/// Rectangle `o + along·[a0, a1] + across·[b0, b1]`, counter-clockwise.
fn quad(o: Point, along: V, across: V, a: [f64; 2], b: [f64; 2]) -> Shape {
    let at = |s: f64, t: f64| {
        pt(
            o.x + along.0 * s + across.0 * t,
            o.y + along.1 * s + across.1 * t,
        )
    };
    g::normalized(Shape {
        outer: vec![
            at(a[0], b[0]),
            at(a[1], b[0]),
            at(a[1], b[1]),
            at(a[0], b[1]),
        ],
        holes: vec![],
    })
}
fn disc(c: Point, r: f64, k: usize, phase: f64) -> Shape {
    Shape {
        outer: (0..k)
            .map(|i| {
                let a = phase + i as f64 * std::f64::consts::TAU / k as f64;
                pt(c.x + r * a.cos(), c.y + r * a.sin())
            })
            .collect(),
        holes: vec![],
    }
}

// --------------------------------------------------------------- polygons

type Box2 = (f64, f64, f64, f64);
fn overlaps(a: Box2, b: Box2, m: f64) -> bool {
    a.0 <= b.2 + m && b.0 <= a.2 + m && a.1 <= b.3 + m && b.1 <= a.3 + m
}
fn buffer(s: &Shape, d: f64) -> Vec<Shape> {
    use geo::Buffer;
    let p = g::polygon(s);
    std::panic::catch_unwind(std::panic::AssertUnwindSafe(|| g::shapes(p.buffer(d))))
        .unwrap_or_default()
}
fn buffer_all(shapes: &[Shape], d: f64) -> Vec<Shape> {
    use geo::Buffer;
    let mp = geo::MultiPolygon(shapes.iter().map(g::polygon).collect());
    std::panic::catch_unwind(std::panic::AssertUnwindSafe(|| g::shapes(mp.buffer(d))))
        .unwrap_or_default()
}
fn area(v: &[Shape]) -> f64 {
    v.iter().map(g::area).sum()
}
/// Shapes split by halving until each fits in a `size` box: a ring around a
/// whole town (curtain body, outer wall, reserve) becomes pieces that box
/// tests can skip, so clipping it costs its own size, not the town's.
fn tiles(shapes: Vec<Shape>, size: f64) -> Vec<Shape> {
    let mut out = vec![];
    let mut stack = shapes;
    while let Some(s) = stack.pop() {
        let (x0, y0, x1, y1) = g::bbox(&s);
        if (x1 - x0).max(y1 - y0) <= size || s.outer.len() <= 16 {
            out.push(s);
            continue;
        }
        let halves = if x1 - x0 >= y1 - y0 {
            let m = (x0 + x1) * 0.5;
            [
                g::rectangle(x0 - 1.0, y0 - 1.0, m, y1 + 1.0),
                g::rectangle(m, y0 - 1.0, x1 + 1.0, y1 + 1.0),
            ]
        } else {
            let m = (y0 + y1) * 0.5;
            [
                g::rectangle(x0 - 1.0, y0 - 1.0, x1 + 1.0, m),
                g::rectangle(x0 - 1.0, m, x1 + 1.0, y1 + 1.0),
            ]
        };
        for h in &halves {
            stack.extend(
                g::intersection(&s, h)
                    .into_iter()
                    .filter(|p| g::area(p) > 0.01),
            );
        }
    }
    // Deterministic order whatever the split order.
    out.sort_by(|a, b| {
        let (pa, pb) = (g::bbox(a), g::bbox(b));
        pa.0.total_cmp(&pb.0).then(pa.1.total_cmp(&pb.1))
    });
    out
}
const TILE: f64 = 200.0;
/// Gap between a lean-to front and the ribbon of the lane serving it (m).
const LEAN_GAP: f64 = 0.6;
/// A faubourg house against the wall holds one narrow dwelling or shop
/// (a gabled row house at most): never deeper or wider.
const LEAN_MAX_DEPTH: f64 = 12.0;
const LEAN_MAX_FRONT: f64 = 12.0;
/// Shapes with their boxes, for cheap repeated subtraction.
struct Cut {
    shapes: Vec<(Shape, Box2)>,
}
impl Cut {
    fn new(shapes: Vec<Shape>) -> Self {
        Cut {
            shapes: shapes
                .into_iter()
                .map(|s| {
                    let b = g::bbox(&s);
                    (s, b)
                })
                .collect(),
        }
    }
    fn add(&mut self, s: Shape) {
        let b = g::bbox(&s);
        self.shapes.push((s, b));
    }
    fn from(&self, pieces: Vec<Shape>) -> Vec<Shape> {
        let mut out = pieces;
        for (c, cb) in &self.shapes {
            if out.is_empty() {
                break;
            }
            out = out
                .into_iter()
                .flat_map(|p| {
                    if overlaps(g::bbox(&p), *cb, 0.0) {
                        g::difference(&p, c)
                    } else {
                        vec![p]
                    }
                })
                .filter(|p| g::area(p) > 0.01)
                .collect();
        }
        out
    }
    fn hits(&self, s: &Shape) -> f64 {
        let b = g::bbox(s);
        self.shapes
            .iter()
            .filter(|(_, cb)| overlaps(b, *cb, 0.0))
            .map(|(c, _)| area(&g::intersection(s, c)))
            .sum()
    }
}

// ---------------------------------------------------------------- terrain

/// Outward unit normal of each segment of a closed path.
fn normals(path: &[Point]) -> Vec<V> {
    let ring = Shape {
        outer: path[..path.len() - 1].to_vec(),
        holes: vec![],
    };
    let mut ns: Vec<V> = path
        .windows(2)
        .map(|w| {
            let (dx, dy) = dir(w[0], w[1]);
            (dy, -dx)
        })
        .collect();
    // The right-hand side is outward for a counter-clockwise ring; check it on
    // the longest side as `contains(m + 2n) == false`.
    if let Some(k) = (0..ns.len())
        .max_by(|&a, &b| dist(path[a], path[a + 1]).total_cmp(&dist(path[b], path[b + 1])))
    {
        let m = pt(
            (path[k].x + path[k + 1].x) * 0.5,
            (path[k].y + path[k + 1].y) * 0.5,
        );
        if g::contains(&ring, add(m, ns[k], 2.0)) {
            for n in &mut ns {
                *n = (-n.0, -n.1);
            }
        }
    }
    ns
}
fn segment_relief(a: Point, b: Point, n: V, surface: Surface<'_>) -> f64 {
    let k = (dist(a, b) / 40.0).ceil().max(1.0) as usize;
    (0..k)
        .map(|i| {
            let t = (i as f64 + 0.5) / k as f64;
            let m = pt(a.x + (b.x - a.x) * t, a.y + (b.y - a.y) * t);
            (surface.height_at(add(m, n, 12.0)) - surface.height_at(add(m, n, -12.0))).abs() / 24.0
        })
        .sum::<f64>()
        / k as f64
}
fn wet_outward(a: Point, b: Point, n: V, surface: Surface<'_>, off: f64) -> f64 {
    let k = (dist(a, b) / 10.0).ceil().max(1.0) as usize;
    (0..k)
        .filter(|&i| {
            let t = (i as f64 + 0.5) / k as f64;
            surface.wet(add(
                pt(a.x + (b.x - a.x) * t, a.y + (b.y - a.y) * t),
                n,
                off,
            ))
        })
        .count() as f64
        / k as f64
}
/// Length-weighted relief of the curtains (`R`) and the wet share of their
/// outward side 10 m out.
pub(super) fn terrain(walls: &[Shape], surface: Surface<'_>) -> (f64, f64) {
    let (mut r, mut w, mut total) = (0.0, 0.0, 0.0);
    for wall in walls {
        let mut path = wall.outer.clone();
        path.push(path[0]);
        let ns = normals(&path);
        for (e, n) in path.windows(2).zip(&ns) {
            let l = dist(e[0], e[1]);
            r += l * segment_relief(e[0], e[1], *n, surface);
            w += l * wet_outward(e[0], e[1], *n, surface, 10.0);
            total += l;
        }
    }
    if total <= 0.0 {
        (0.0, 0.0)
    } else {
        (r / total, w / total)
    }
}

// ------------------------------------------------------------------ trace

/// Contour trace of a hill town: one corner-cutting pass and a fine
/// simplification, so the curtain follows the growth outline.
pub(super) fn hill_trace(shape: &Shape, cell: f64) -> Shape {
    let tolerance = (g::area(shape).sqrt() * 0.01)
        .clamp(1.5, 5.0)
        .max(cell * 0.5);
    let n = shape.outer.len();
    let mut ring: Vec<Point> = (0..n)
        .flat_map(|i| {
            let (a, b) = (shape.outer[i], shape.outer[(i + 1) % n]);
            [
                pt(a.x * 0.75 + b.x * 0.25, a.y * 0.75 + b.y * 0.25),
                pt(a.x * 0.25 + b.x * 0.75, a.y * 0.25 + b.y * 0.75),
            ]
        })
        .collect();
    ring.push(ring[0]);
    let mut outer = g::simplify(&ring, tolerance, |_| false);
    outer.pop();
    if outer.len() < 3 {
        return shape.clone();
    }
    g::normalized(Shape {
        outer,
        holes: shape.holes.clone(),
    })
}
fn turn_at(ring: &[Point], i: usize) -> f64 {
    let n = ring.len();
    let (a, p, b) = (ring[(i + n - 1) % n], ring[i], ring[(i + 1) % n]);
    let (u, v) = (dir(a, p), dir(p, b));
    cross(u, v).atan2(dot(u, v)).abs()
}
/// Length (m) of a closed ring that lies in water, sampled every 2 m.
fn wet_length(ring: &[Point], surface: Surface<'_>) -> f64 {
    let n = ring.len();
    (0..n)
        .map(|i| {
            let (a, b) = (ring[i], ring[(i + 1) % n]);
            let l = dist(a, b);
            let k = (l / 2.0).ceil().max(1.0) as usize;
            (0..k)
                .filter(|&j| {
                    let t = (j as f64 + 0.5) / k as f64;
                    surface.wet(pt(a.x + (b.x - a.x) * t, a.y + (b.y - a.y) * t))
                })
                .count() as f64
                * l
                / k as f64
        })
        .sum()
}
/// A regular trace (bastioned, square) drawn over its founding outline `base`
/// never takes the curtain into water where the outline does not: wherever
/// the two differ over water the outline wins. Every bulge of the trace
/// outside the outline that reaches water is given back, and every notch of
/// the outline the trace cuts off over water is kept, so there the curtain
/// follows the outline (its banks and its river crossings). `None` when the
/// result still runs in water longer than the outline does.
fn off_water(trace: Shape, base: &Shape, surface: Surface<'_>) -> Option<Shape> {
    let wet = |b: &Shape| {
        let a = g::area(b);
        a > 1.0 && a - area(&g::dry_clip(&surface, b)) > 1.0
    };
    let wet_bulges: Vec<Shape> = g::difference(&trace, base)
        .into_iter()
        .filter(|b| wet(b))
        .collect();
    let wet_notches: Vec<Shape> = g::difference(base, &trace)
        .into_iter()
        .filter(|b| wet(b))
        .collect();
    let wet_bulges_n = wet_bulges.len() + wet_notches.len();
    let trace = if wet_bulges_n == 0 {
        trace
    } else {
        let kept = Cut::new(wet_bulges).from(vec![trace]);
        let kept = g::union(&kept.into_iter().chain(wet_notches).collect::<Vec<_>>());
        let largest = |v: Vec<Shape>| {
            v.into_iter()
                .max_by(|x, y| g::area(x).total_cmp(&g::area(y)))
        };
        // An opening by 1 m drops the zero-width spikes the overlay leaves
        // where a bulge met the outline at a point.
        let best = largest(kept)?;
        let best = largest(buffer(&best, -1.0)).and_then(|s| largest(buffer(&s, 1.0)))?;
        let mut ring = best.outer.clone();
        ring.push(ring[0]);
        let mut ring = g::simplify(&ring, 0.5, |_| false);
        ring.pop();
        g::normalized(Shape {
            outer: ring,
            holes: vec![],
        })
    };
    let base_ring = &base.outer;
    let (wt, wb) = (
        wet_length(&trace.outer, surface),
        wet_length(base_ring, surface),
    );
    if std::env::var("URBAN_PROFILE").is_ok() {
        eprintln!(
            "  off_water: {} bulges and notches given back, wet {wt:.0} m (outline {wb:.0} m), simple {}",
            wet_bulges_n,
            g::simple(&trace),
        );
    }
    (trace.outer.len() >= 3 && g::simple(&trace) && wt <= wb + 20.0).then_some(trace)
}
/// Square trace of a planned (Chinese) city: the rectangle aligned on the map
/// axes around the founding outline, kept when it encloses at most 1.5 times
/// the founding land and stays out of the water (`off_water`).
pub(super) fn square_trace(shape: &Shape, surface: Surface<'_>) -> Option<Shape> {
    let (x0, y0, x1, y1) = g::bbox(shape);
    let rect = g::normalized(g::rectangle(x0 - 2.0, y0 - 2.0, x1 + 2.0, y1 + 2.0));
    let plain = Shape {
        outer: shape.outer.clone(),
        holes: vec![],
    };
    if g::area(&rect) > 1.5 * g::area(&plain) {
        return None;
    }
    off_water(rect, &plain, surface)
}
/// Bastioned trace: long straight fronts between salients, at least 98 % of
/// the founding land inside, never in water (`off_water`). `None` when the
/// outline does not allow it.
pub(super) fn bastioned_trace(shape: &Shape, surface: Surface<'_>) -> Option<Shape> {
    let a = g::area(shape);
    let t = (0.04 * a.sqrt()).clamp(12.0, 40.0);
    let plain = Shape {
        outer: shape.outer.clone(),
        holes: vec![],
    };
    let grown = buffer(&plain, t * 0.5)
        .into_iter()
        .max_by(|x, y| g::area(x).total_cmp(&g::area(y)))?;
    let mut ring = grown.outer.clone();
    ring.push(ring[0]);
    let mut ring = g::simplify(&ring, t, |_| false);
    ring.pop();
    while ring.len() > 5 {
        let n = ring.len();
        let short = |i: usize| {
            dist(ring[(i + n - 1) % n], ring[i]) < 80.0 || dist(ring[i], ring[(i + 1) % n]) < 80.0
        };
        let Some(k) = (0..n)
            .filter(|&i| short(i))
            .min_by(|&x, &y| turn_at(&ring, x).total_cmp(&turn_at(&ring, y)))
        else {
            break;
        };
        ring.remove(k);
    }
    let trace = off_water(
        g::normalized(Shape {
            outer: ring,
            holes: vec![],
        }),
        &plain,
        surface,
    )?;
    let covered = area(&g::intersection(&trace, &plain));
    if std::env::var("URBAN_PROFILE").is_ok() {
        eprintln!(
            "  bastioned trace: {} vertices, covers {:.3} of the outline",
            trace.outer.len(),
            covered / g::area(&plain)
        );
    }
    (trace.outer.len() >= 3 && g::simple(&trace) && covered >= 0.98 * g::area(&plain))
        .then_some(trace)
}

// ------------------------------------------------------------------ build

/// Uniform grid of curtain segments, for "is this street segment near the wall".
pub(super) struct Near {
    cell: f64,
    cells: std::collections::HashMap<(i64, i64), Vec<usize>>,
    segs: Vec<(Point, Point)>,
}
impl Near {
    pub(super) fn new(path: &[Point], cell: f64) -> Self {
        let mut cells: std::collections::HashMap<(i64, i64), Vec<usize>> = Default::default();
        let segs: Vec<(Point, Point)> = path.windows(2).map(|w| (w[0], w[1])).collect();
        for (i, &(a, b)) in segs.iter().enumerate() {
            let k = (dist(a, b) / cell).ceil().max(1.0) as usize;
            for j in 0..=k {
                let t = j as f64 / k as f64;
                let key = (
                    ((a.x + (b.x - a.x) * t) / cell).floor() as i64,
                    ((a.y + (b.y - a.y) * t) / cell).floor() as i64,
                );
                let v = cells.entry(key).or_default();
                if v.last() != Some(&i) {
                    v.push(i);
                }
            }
        }
        Near { cell, cells, segs }
    }
    /// Curtain segments in the cells segment ab passes (candidates for a
    /// crossing), in index order.
    pub(super) fn crossed(&self, a: Point, b: Point) -> Vec<usize> {
        let k = (dist(a, b) / self.cell).ceil().max(1.0) as usize;
        let mut seen = std::collections::BTreeSet::new();
        for j in 0..=k {
            let t = j as f64 / k as f64;
            let (cx, cy) = (
                ((a.x + (b.x - a.x) * t) / self.cell).floor() as i64,
                ((a.y + (b.y - a.y) * t) / self.cell).floor() as i64,
            );
            for dx in -1..=1 {
                for dy in -1..=1 {
                    seen.extend(self.cells.get(&(cx + dx, cy + dy)).into_iter().flatten());
                }
            }
        }
        seen.into_iter().collect()
    }
    /// Distance from segment ab to the curtain (0 when it crosses it), or
    /// infinity beyond `cell`.
    pub(super) fn distance(&self, a: Point, b: Point) -> f64 {
        let mut best = f64::INFINITY;
        let k = (dist(a, b) / self.cell).ceil().max(1.0) as usize;
        let mut seen = std::collections::BTreeSet::new();
        for j in 0..=k {
            let t = j as f64 / k as f64;
            let (cx, cy) = (
                ((a.x + (b.x - a.x) * t) / self.cell).floor() as i64,
                ((a.y + (b.y - a.y) * t) / self.cell).floor() as i64,
            );
            for dx in -1..=1 {
                for dy in -1..=1 {
                    for &s in self.cells.get(&(cx + dx, cy + dy)).into_iter().flatten() {
                        if !seen.insert(s) {
                            continue;
                        }
                        let (c, d) = self.segs[s];
                        let d = if g::segment_hit(a, b, c, d).is_some() {
                            0.0
                        } else {
                            g::distance(a, c, d)
                                .0
                                .min(g::distance(b, c, d).0)
                                .min(g::distance(c, a, b).0)
                                .min(g::distance(d, a, b).0)
                        };
                        if d < self.cell {
                            best = best.min(d);
                        }
                    }
                }
            }
        }
        best
    }
}

/// Width a street will have once the network hierarchy has re-ranked it
/// (`network::hierarchy` widens through routes after this stage): a street
/// crossing the curtain becomes an arterial gate street.
fn final_width(s: &Street, i: usize, crossing: bool, predicted: &Predicted) -> f64 {
    let w = s.widths.get(i).or(s.widths.first()).copied().unwrap_or(4.0);
    if !matches!(
        s.role.as_str(),
        "street" | "lane" | "radial" | "ring" | "market" | "gate-street" | "processional"
    ) {
        return w;
    }
    let rank = if crossing {
        s.rank.min(predicted.arterial)
    } else {
        s.rank
    };
    w.max(predicted.widths[rank.min(4)])
}
/// Rank widths the later hierarchy applies (`network::rank_widths` × the
/// gate-street factor) and the arterial rank for this population.
#[derive(Clone, Copy)]
pub(super) struct Predicted {
    pub widths: [f64; 5],
    pub arterial: usize,
    /// Smallest dwelling lot the culture admits (frontage, depth, m): a
    /// faubourg lean-to is laid at least this size, so it can be built.
    pub dwelling: [f64; 2],
}
/// Street ribbons (+1 m) within `reach` of the curtain.
fn street_clear(
    path: &[Point],
    streets: &[Street],
    reach: f64,
    predicted: &Predicted,
) -> Vec<Shape> {
    let near = Near::new(path, reach);
    let runs: Vec<(Vec<Point>, Vec<f64>)> = streets
        .iter()
        .filter(|s| s.role != "wall-lane")
        .flat_map(|s| {
            let mut runs = vec![];
            let (mut pts, mut ws): (Vec<Point>, Vec<f64>) = (vec![], vec![]);
            let crossing = s.path.windows(2).any(|w| near.distance(w[0], w[1]) == 0.0);
            let w = |i: usize| final_width(s, i, crossing, predicted) + 1.0;
            for i in 0..s.path.len().saturating_sub(1) {
                if near.distance(s.path[i], s.path[i + 1]).is_finite() {
                    if pts.is_empty() {
                        pts.push(s.path[i]);
                        ws.push(w(i));
                    }
                    pts.push(s.path[i + 1]);
                    ws.push(w(i + 1));
                } else if !pts.is_empty() {
                    runs.push((std::mem::take(&mut pts), std::mem::take(&mut ws)));
                }
            }
            if pts.len() >= 2 {
                runs.push((pts, ws));
            }
            runs
        })
        .collect();
    super::par::map(&runs, |_, (p, w)| g::ribbon(p, w))
        .into_iter()
        .flatten()
        .collect()
}

struct GateInfo {
    /// A regional road (or its approach) crosses here: it enters the town
    /// through a gatehouse, before any city street claims the place.
    regional: bool,
    major: bool,
    width: f64,
    /// Street direction, pointing outward.
    s: V,
    /// Curtain tangent and outward normal at the gate.
    t: V,
    n: V,
}

fn gate_params(kind: &str, c: f64) -> Option<(f64, f64)> {
    // (outward depth, side mass)
    match kind {
        "timber" => Some((5.0, 2.0)),
        "tower" => Some((10.0, 4.0)),
        "twin-tower" => Some((12.0, 4.0)),
        "bab" => Some((16.0, 6.0)),
        "postern" => Some((c.max(3.0) + 1.0, 2.0)),
        "ravelin" => Some((c + 2.0, 4.0)),
        _ => None,
    }
}

/// Every structure of one circuit. `land` gates come first in `e.gates` (street
/// crossings), the rest are water gates; `banks` are the curtain's land/water
/// transitions in path order (`true`: entering water).
#[allow(clippy::too_many_arguments)]
pub(super) fn build(
    e: &mut Enclosure,
    land: usize,
    banks: &[(Point, bool)],
    streets: &[Street],
    surface: Surface<'_>,
    style: &Style,
    pop: u32,
    predicted: &Predicted,
    rng: &Rng,
) -> Vec<Street> {
    let path = e.path.clone();
    let n_seg = path.len().saturating_sub(1);
    e.style = style.id.clone();
    e.material = style.material.clone();
    e.curtain_width_m = style.curtain_width;
    e.height_m = style.height;
    if n_seg < 3 {
        return vec![];
    }
    let ring: Vec<Point> = path[..n_seg].to_vec();
    let poly = g::normalized(Shape {
        outer: ring.clone(),
        holes: vec![],
    });
    let h = ribbon_half(&e.kind);
    let c = style.curtain_width;
    let face = c - h;
    let ns = normals(&path);
    let inner_core = Cut::new(tiles(buffer(&poly, -h), TILE));
    let mut hgt = rng.fork("height");
    let jitter = hgt.range(0.92, 1.08);
    let (height, tower_height) = (style.height * jitter, style.tower_height * jitter);
    let mut dr = rng.fork("ditch");
    let dw = dr.range(
        style.ditch_width[0],
        style.ditch_width[1].max(style.ditch_width[0]),
    );
    let reach =
        face + style.berm + dw + 25.0 + style.court_radius[1].max(style.outer_gap[1] + 16.0) + 45.0;
    let clear = Cut::new(street_clear(&path, streets, reach, predicted));
    let clip = |s: Shape| clear.from(inner_core.from(vec![s]));
    let dry_points =
        |s: &Shape| !s.outer.iter().any(|&p| surface.wet(p)) && !surface.wet(g::centroid(s));
    let dry_share = |s: &[Shape]| {
        let a = area(s);
        if a <= 0.0 {
            return 0.0;
        }
        s.iter()
            .map(|p| area(&g::dry_clip(&surface, p)))
            .sum::<f64>()
            / a
    };
    // Per-segment terrain: steep runs and runs with water outside keep no
    // ditch (water is the moat), get no bastion and a wider tower spacing.
    let steep: Vec<bool> = (0..n_seg)
        .map(|i| segment_relief(path[i], path[i + 1], ns[i], surface) > 0.15)
        .collect();
    let wet: Vec<bool> = (0..n_seg)
        .map(|i| wet_outward(path[i], path[i + 1], ns[i], surface, 10.0) > 0.3)
        .collect();
    let seg_of = |p: Point| {
        (0..n_seg)
            .min_by(|&a, &b| {
                g::distance(p, path[a], path[a + 1])
                    .0
                    .total_cmp(&g::distance(p, path[b], path[b + 1]).0)
            })
            .unwrap_or(0)
    };
    // Gates: street, rank and direction at each land crossing.
    let infos: Vec<GateInfo> = e.gates[..land]
        .iter()
        .map(|&q| {
            let k = seg_of(q);
            let (t, n) = (dir(path[k], path[k + 1]), ns[k]);
            let mut best: Option<(usize, f64, V)> = None;
            let mut regional = false;
            for st in streets.iter().filter(|s| s.role != "wall-lane") {
                for (i, w) in st.path.windows(2).enumerate() {
                    let on = g::distance(q, w[0], w[1]).0 < 0.1;
                    regional |= on && matches!(st.role.as_str(), "regional" | "approach");
                    if on && best.is_none_or(|b| st.rank < b.0) {
                        let wd = final_width(st, i, true, predicted);
                        best = Some((st.rank, wd, dir(w[0], w[1])));
                    }
                }
            }
            let (rank, width, mut s) = best.unwrap_or((2, 4.0, n));
            if dot(s, n) < 0.0 {
                s = (-s.0, -s.1);
            }
            if dot(s, n) < 0.25 {
                // A street grazing the curtain: build the gate square to it.
                s = n;
            }
            GateInfo {
                regional,
                major: rank <= 1,
                width,
                s,
                t,
                n,
            }
        })
        .collect();
    let mut towers: Vec<Tower> = vec![];
    let mut gatehouses: Vec<Gatehouse> = vec![];
    let mut bastions: Vec<Work> = vec![];
    let mut outworks: Vec<Work> = vec![];
    let mut extra_reserve: Vec<Shape> = vec![];
    // Exclusion radius around each gate for other towers and bastions.
    let mut gate_clear: Vec<f64> = vec![8.0; e.gates.len()];

    let tower_at = |anchor: Point,
                    t: V,
                    n: V,
                    shape: &str,
                    r: f64,
                    depth: f64,
                    kind: &str,
                    height: f64|
     -> Option<Tower> {
        if surface.wet(anchor) {
            return None;
        }
        let (center, nominal) = match shape {
            "square" => {
                let c0 = add(anchor, n, r - h);
                (c0, quad(c0, t, n, [-r, r], [-r, r]))
            }
            "rect" => {
                let c0 = add(anchor, n, depth * 0.5 - h);
                (c0, quad(anchor, t, n, [-r, r], [-h, depth - h]))
            }
            "d" => {
                let c0 = add(anchor, n, r - h);
                let mut outer = vec![add(add(c0, t, -r), n, -r), add(add(c0, t, r), n, -r)];
                for k in 0..=8 {
                    let a = k as f64 * std::f64::consts::PI / 8.0;
                    outer.push(pt(
                        c0.x + r * (a.cos() * t.0 + a.sin() * n.0),
                        c0.y + r * (a.cos() * t.1 + a.sin() * n.1),
                    ));
                }
                (
                    c0,
                    g::normalized(Shape {
                        outer,
                        holes: vec![],
                    }),
                )
            }
            _ => {
                let c0 = add(anchor, n, r - h);
                (c0, disc(c0, r, 16, t.1.atan2(t.0)))
            }
        };
        if !dry_points(&nominal) {
            return None;
        }
        let full = g::area(&nominal);
        let piece = clip(nominal)
            .into_iter()
            .max_by(|a, b| g::area(a).total_cmp(&g::area(b)))?;
        (g::area(&piece) >= 0.6 * full).then(|| Tower {
            anchor,
            center,
            shape: shape.into(),
            radius_m: r,
            depth_m: if shape == "rect" { depth } else { 0.0 },
            angle: t.1.atan2(t.0),
            height_m: height,
            kind: kind.into(),
            footprint: piece,
        })
    };

    // Footprints of the structures placed so far: no two structures overlap
    // (rule 4), whatever placed them first.
    let mut occupied = Cut::new(vec![]);
    let free = |occupied: &Cut, s: &Shape| occupied.hits(s) <= 0.5;
    // --- gatehouses (land gates), the most important crossings first: a
    // crossing too close to a built gatehouse stays a plain opening.
    let mut order: Vec<usize> = (0..land).collect();
    order.sort_by(|&a, &b| {
        infos[b]
            .regional
            .cmp(&infos[a].regional)
            .then(infos[b].major.cmp(&infos[a].major))
            .then(infos[b].width.total_cmp(&infos[a].width))
            .then(a.cmp(&b))
    });
    for gi in order {
        let info = &infos[gi];
        let q = e.gates[gi];
        gate_clear[gi] = info.width * 0.5 + 4.0;
        let kind = if info.major && pop >= style.gate_min_pop {
            style.gate_major.as_str()
        } else if info.major {
            "opening"
        } else {
            style.gate_minor.as_str()
        };
        let Some((depth, mass)) = gate_params(kind, c) else {
            continue;
        };
        let pw = info.width + 1.0;
        let across = (-info.s.1, info.s.0);
        let back = h / dot(info.s, info.n).max(0.3) + 0.5;
        let half = pw * 0.5 + mass;
        let block = quad(q, info.s, across, [-back, depth], [-half, half]);
        if !dry_points(&block) {
            gate_clear[gi] = half + 4.0;
            continue;
        }
        let shape = inner_core
            .from(vec![block.clone()])
            .into_iter()
            .max_by(|a, b| g::area(a).total_cmp(&g::area(b)));
        let Some(shape) = shape else { continue };
        // Rule 2 then rule 4: the side masses keep off every street and every
        // structure already placed; a gatehouse with no mass left is not built.
        let masses: Vec<Shape> = clear
            .from(vec![shape.clone()])
            .into_iter()
            .filter(|m| g::area(m) >= 4.0)
            .collect();
        if masses.is_empty() || masses.iter().any(|m| !free(&occupied, m)) {
            continue;
        }
        let gh = match kind {
            "timber" => tower_height,
            "tower" if style.gate_height > 0.0 && info.major => style.gate_height,
            "tower" => tower_height + 2.0,
            "twin-tower" => height + 2.0,
            "bab" => height + 3.0,
            _ => height,
        };
        let sin = cross(info.t, info.s).abs().max(0.5);
        gate_clear[gi] = half / sin + 3.0;
        for m in &masses {
            occupied.add(m.clone());
        }
        gatehouses.push(Gatehouse {
            gate: gi,
            kind: kind.into(),
            shape,
            masses,
            passage: [add(q, info.s, -back), add(q, info.s, depth)],
            passage_width_m: pw,
            height_m: gh,
        });
        if kind == "twin-tower" || (style.gate_towers && info.major) {
            let r = style.tower_radius[1];
            for side in [-1.0, 1.0] {
                let anchor = add(q, info.t, side * (half / sin + r));
                if let Some(tw) = tower_at(
                    anchor,
                    info.t,
                    info.n,
                    &style.tower_shape,
                    r,
                    0.0,
                    "gate",
                    tower_height,
                ) && free(&occupied, &tw.footprint)
                {
                    gate_clear[gi] = gate_clear[gi].max(dist(anchor, q) + r + 2.0);
                    occupied.add(tw.footprint.clone());
                    towers.push(tw);
                }
            }
        }
    }
    // --- water gates: pair each entry into the water with the next exit.
    let has_towers = style.corner_turn.is_some() || style.tower_spacing.is_some();
    if banks.len() >= 2 && banks.iter().any(|b| b.1) && banks.iter().any(|b| !b.1) {
        let m = banks.len();
        for k in 0..m {
            if !banks[k].1 {
                continue;
            }
            let Some(j) = (1..m).map(|o| (k + o) % m).find(|&j| !banks[j].1) else {
                continue;
            };
            if (1..m)
                .map(|o| (k + o) % m)
                .take_while(|&x| x != j)
                .any(|x| banks[x].1)
            {
                continue; // two entries in a row: not a crossing pair
            }
            let (a, b) = (banks[k].0, banks[j].0);
            let Some(gi) = (0..e.gates.len())
                .min_by(|&x, &y| dist(e.gates[x], a).total_cmp(&dist(e.gates[y], a)))
            else {
                continue;
            };
            if dist(e.gates[gi], a) > 8.0 {
                continue;
            }
            // The curtain always opens over the water between the two banks
            // (the span is the gate); each bank gets an abutment where dry
            // land allows one.
            let mut abut = vec![];
            for (bank, sign) in [(a, -1.0), (b, 1.0)] {
                // Abutment on dry land, back from the bank along the curtain.
                let sk = seg_of(bank);
                let t = dir(path[sk], path[sk + 1]);
                let along = (t.0 * sign, t.1 * sign); // pointing onto land
                // The first dry offset back from the bank: a curtain meeting
                // the water obliquely needs a few metres more.
                let Some(back) = [1.0, 3.0, 6.0, 10.0, 15.0, 22.0, 30.0, 40.0]
                    .into_iter()
                    .find(|&b| {
                        dry_points(&quad(
                            add(bank, along, b),
                            along,
                            ns[sk],
                            [0.0, 5.0],
                            [-h, face + 1.0],
                        ))
                    })
                else {
                    continue;
                };
                abut.push(quad(
                    add(bank, along, back),
                    along,
                    ns[sk],
                    [0.0, 5.0],
                    [-h, face + 1.0],
                ));
                if has_towers {
                    let r = style.tower_radius[1];
                    if let Some(tw) = [1.5, 4.0, 8.0].into_iter().find_map(|b| {
                        tower_at(
                            add(bank, along, back + r + b),
                            t,
                            ns[sk],
                            &style.tower_shape,
                            r,
                            0.0,
                            "water",
                            tower_height,
                        )
                        .filter(|tw| free(&occupied, &tw.footprint))
                    }) {
                        occupied.add(tw.footprint.clone());
                        towers.push(tw);
                    }
                }
            }
            let masses: Vec<Shape> = abut
                .into_iter()
                .flat_map(&clip)
                .filter(|m| g::area(m) >= 2.0 && free(&occupied, m))
                .collect();
            for m in &masses {
                occupied.add(m.clone());
            }
            // Without an abutment the span itself stands for the gate.
            let shape = masses
                .iter()
                .max_by(|x, y| g::area(x).total_cmp(&g::area(y)))
                .cloned()
                .unwrap_or_else(|| {
                    let t = dir(a, b);
                    quad(a, t, (t.1, -t.0), [0.0, dist(a, b)], [-face - h, face + h])
                });
            gatehouses.push(Gatehouse {
                gate: gi,
                kind: "water".into(),
                shape,
                masses,
                passage: [a, b],
                passage_width_m: dist(a, b),
                height_m: height,
            });
        }
    }
    let near_gate = |p: Point, extra: f64| {
        e.gates
            .iter()
            .zip(&gate_clear)
            .any(|(&q, &r)| dist(p, q) < r + extra)
    };
    let near_tower =
        |p: Point, towers: &[Tower], d: f64| towers.iter().any(|t| dist(p, t.anchor) < d);

    // --- bastions at the salients (bastioned trace)
    let bastioned = style.id == "bastioned";
    let mut bastion_at = vec![false; n_seg];
    let mut bastion_union: Vec<Shape> = vec![];
    // Flanks about 0.4 of a face, as on a Vauban front.
    let bastion = |v: Point, u: V, w: V, n1: V, n2: V, d: f64, flat: bool| -> Option<Shape> {
        let f = 0.6 * d + 8.0;
        let cap = (2.2 * d).clamp(25.0, 60.0);
        let b = unit((n1.0 + n2.0, n1.1 + n2.1));
        let f1 = add(v, u, -d);
        let f2 = add(v, w, d);
        let tip = add(v, b, cap);
        let mut outer = vec![f1, add(f1, n1, f), tip, add(f2, n2, f), f2];
        if !flat {
            outer.push(v);
        }
        let s = g::normalized(Shape {
            outer,
            holes: vec![],
        });
        (g::simple(&s) && dry_points(&s) && !surface.wet(add(v, b, cap * 0.5))).then_some(s)
    };
    if bastioned {
        // A bastion keeps 60 % of its nominal area in one piece (a street may
        // graze it, not cut it in two), off every structure already placed;
        // its rampart stands level with the curtain.
        let accept = |s: Shape,
                      bastions: &mut Vec<Work>,
                      union: &mut Vec<Shape>,
                      occupied: &mut Cut|
         -> bool {
            let full = g::area(&s);
            let pieces: Vec<Shape> = clip(s).into_iter().filter(|p| g::area(p) >= 4.0).collect();
            if pieces.iter().map(g::area).fold(0.0, f64::max) < 0.6 * full
                || pieces.iter().any(|p| !free(occupied, p))
            {
                return false;
            }
            for p in pieces {
                union.push(p.clone());
                occupied.add(p.clone());
                bastions.push(Work {
                    kind: "bastion".into(),
                    shape: p,
                    height_m: height,
                    passage: None,
                });
            }
            true
        };
        for i in 0..n_seg {
            let prev = (i + n_seg - 1) % n_seg;
            let (a, v, b) = (ring[prev], ring[i], ring[(i + 1) % n_seg]);
            let (u, w) = (dir(a, v), dir(v, b));
            let turn = cross(u, w).atan2(dot(u, w));
            // Convex: turning towards the inside (away from the outward normal).
            let convex = dot(ns[prev], w) < 0.0;
            let deg = turn.abs().to_degrees();
            if !convex || !(15.0..=110.0).contains(&deg) || wet[prev] && wet[i] {
                continue;
            }
            let d = (0.15 * dist(a, v).min(dist(v, b))).clamp(12.0, 30.0);
            if d > 0.45 * dist(a, v).min(dist(v, b)) {
                continue;
            }
            // Near a gate the bastion only has to keep off its gatehouse and
            // its street (`accept`); a smaller one is tried before a tower.
            for k in [1.0, 0.7, 0.5] {
                if let Some(s) = bastion(v, u, w, ns[prev], ns[i], (d * k).max(10.0), false)
                    && accept(s, &mut bastions, &mut bastion_union, &mut occupied)
                {
                    bastion_at[i] = true;
                    break;
                }
            }
        }
        // Long fronts get flat bastions, one per ~260 m of curtain, away
        // from the gates and from the corner bastions.
        for i in 0..n_seg {
            let (a, b) = (path[i], path[i + 1]);
            let l = dist(a, b);
            let count = (l / 260.0).floor() as usize;
            if count == 0 || wet[i] {
                continue;
            }
            let u = dir(a, b);
            let d = (0.15 * l / count as f64 * 0.5).clamp(12.0, 30.0);
            for k in 0..count {
                let m = add(a, u, (k as f64 + 0.5) * l / count as f64);
                if near_gate(m, d + 10.0) {
                    continue;
                }
                if let Some(s) = bastion(m, u, u, ns[i], ns[i], d, true) {
                    accept(s, &mut bastions, &mut bastion_union, &mut occupied);
                }
            }
        }
    }
    // --- corner towers (and a tower where a bastion could not stand)
    if let Some(min_turn) = style.corner_turn.or(bastioned.then_some(15.0)) {
        let r = style.tower_radius[1];
        for i in 0..n_seg {
            if bastion_at[i] {
                continue;
            }
            let prev = (i + n_seg - 1) % n_seg;
            let (a, v, b) = (ring[prev], ring[i], ring[(i + 1) % n_seg]);
            let (u, w) = (dir(a, v), dir(v, b));
            let deg = cross(u, w).atan2(dot(u, w)).abs().to_degrees();
            let convex = dot(ns[prev], w) < 0.0;
            if deg <= min_turn || (style.salients_only || bastioned) && !convex {
                continue;
            }
            if near_gate(v, r) || near_tower(v, &towers, 2.0 * r + 1.0) {
                continue;
            }
            let bis = unit((ns[prev].0 + ns[i].0, ns[prev].1 + ns[i].1));
            let tan = (-bis.1, bis.0);
            if let Some(tw) = tower_at(
                v,
                tan,
                bis,
                &style.tower_shape,
                r,
                0.0,
                "corner",
                tower_height,
            ) && free(&occupied, &tw.footprint)
            {
                occupied.add(tw.footprint.clone());
                towers.push(tw);
            }
        }
    }
    // --- flanking towers at a regular spacing
    if let Some(sp) = style.tower_spacing {
        let mut tr = rng.fork("towers");
        let spacing = tr.range(sp[0], sp[1].max(sp[0]));
        let r = style.tower_radius[0];
        for i in 0..n_seg {
            let (a, b) = (path[i], path[i + 1]);
            let l = dist(a, b);
            let s = spacing * if steep[i] || wet[i] { 1.5 } else { 1.0 };
            let count = (l / s).floor() as usize;
            let (t, n) = (dir(a, b), ns[i]);
            for k in 1..=count {
                let p = add(a, t, k as f64 * l / (count + 1) as f64);
                if near_gate(p, r) || near_tower(p, &towers, s * 0.5) {
                    continue;
                }
                if let Some(tw) = tower_at(
                    p,
                    t,
                    n,
                    &style.flank_shape,
                    r,
                    style.flank_depth,
                    "flank",
                    tower_height,
                ) && free(&occupied, &tw.footprint)
                {
                    occupied.add(tw.footprint.clone());
                    towers.push(tw);
                }
            }
        }
    }
    // --- outworks
    let has = |w: &str| style.outworks.iter().any(|x| x == w);
    let major_land: Vec<usize> = (0..land).filter(|&i| infos[i].major).collect();
    // Outer face of everything the ditch surrounds.
    // The ditch runs around every projecting work: towers, gatehouses,
    // bastions (and below the outer wall, courts and barbicans).
    let mut moat_core: Vec<Shape> = buffer(&poly, face.max(0.1));
    moat_core.extend(bastion_union.iter().cloned());
    moat_core.extend(towers.iter().map(|t| t.footprint.clone()));
    moat_core.extend(gatehouses.iter().flat_map(|gh| gh.masses.clone()));
    if has("outer-wall") || has("antemural") {
        let kind = if has("outer-wall") {
            "outer-wall"
        } else {
            "antemural"
        };
        let mut gr = rng.fork("outer");
        let gap = face
            + gr.range(
                style.outer_gap[0],
                style.outer_gap[1].max(style.outer_gap[0]),
            );
        if let Some(o) = buffer(&poly, gap)
            .into_iter()
            .max_by(|x, y| g::area(x).total_cmp(&g::area(y)))
        {
            let mut r = o.outer.clone();
            r.push(r[0]);
            let mut r = g::simplify(&r, 2.0, |_| false);
            r.pop();
            let o = g::normalized(Shape {
                outer: r,
                holes: vec![],
            });
            let band = buffer(&o, style.outer_width);
            let strip: Vec<Shape> = band.iter().flat_map(|b| g::difference(b, &o)).collect();
            let strip = g::union(&clear.from(tiles(strip, TILE)));
            // Between the walls (outside the main curtain by construction).
            let lists = clear.from(tiles(g::difference(&o, &poly), TILE));
            // Rule 3 for a wall: the outer wall stops at the water.
            for p in strip {
                for d in g::dry_clip(&surface, &p) {
                    if g::area(&d) > 4.0 {
                        outworks.push(Work {
                            kind: kind.into(),
                            shape: d,
                            height_m: style.outer_height,
                            passage: None,
                        });
                    }
                }
            }
            extra_reserve.extend(lists);
            moat_core.extend(band.iter().cloned());
            if has("barbican") {
                let mut oring = o.outer.clone();
                oring.push(oring[0]);
                let ons = normals(&oring);
                let near_outer = Near::new(&oring, 30.0);
                for st in streets
                    .iter()
                    .filter(|s| s.role != "wall-lane" && s.rank <= 1)
                {
                    for (si, w) in st.path.windows(2).enumerate() {
                        for k in near_outer.crossed(w[0], w[1]) {
                            let edge = [oring[k], oring[k + 1]];
                            let Some((_, x)) = g::segment_hit(w[0], w[1], edge[0], edge[1]) else {
                                continue;
                            };
                            let mut s = dir(w[0], w[1]);
                            if dot(s, ons[k]) < 0.0 {
                                s = (-s.0, -s.1);
                            }
                            let wd = final_width(st, si, true, predicted);
                            let across = (-s.1, s.0);
                            let block = quad(
                                x,
                                s,
                                across,
                                [-1.0, 10.0],
                                [-(wd + 8.0) * 0.5, (wd + 8.0) * 0.5],
                            );
                            if !dry_points(&block) {
                                continue;
                            }
                            let pieces: Vec<Shape> = clear
                                .from(vec![block])
                                .into_iter()
                                .filter(|p| g::area(p) >= 10.0)
                                .collect();
                            if pieces.iter().any(|p| !free(&occupied, p)) {
                                continue;
                            }
                            for p in &pieces {
                                moat_core.push(p.clone());
                                occupied.add(p.clone());
                            }
                            for p in pieces {
                                outworks.push(Work {
                                    kind: "barbican".into(),
                                    shape: p,
                                    height_m: style.outer_height + 2.0,
                                    passage: Some([add(x, s, -1.0), add(x, s, 10.0)]),
                                });
                            }
                        }
                    }
                }
            }
        }
    }
    if has("wengcheng") {
        let mut cr = rng.fork("wengcheng");
        let round = style.tower_shape == "round";
        for &gi in &major_land {
            let info = &infos[gi];
            let q = e.gates[gi];
            let radius = cr.range(style.court_radius[0], style.court_radius[1]);
            let k = 0.8 * c;
            let base = add(q, info.n, face);
            let (outer, inner) = if round {
                let semi = |r: f64| {
                    let a0 = info.t.1.atan2(info.t.0);
                    let mut o: Vec<Point> = (0..=12)
                        .map(|j| {
                            let a = a0 + j as f64 * std::f64::consts::PI / 12.0;
                            pt(base.x + r * a.cos(), base.y + r * a.sin())
                        })
                        .collect();
                    // the half that lies outward
                    if dot(dir(base, o[6]), info.n) < 0.0 {
                        o = o
                            .iter()
                            .map(|p| pt(2.0 * base.x - p.x, 2.0 * base.y - p.y))
                            .collect();
                    }
                    o.push(add(base, info.n, -0.5));
                    g::normalized(Shape {
                        outer: o,
                        holes: vec![],
                    })
                };
                (semi(radius), semi(radius - k))
            } else {
                (
                    quad(base, info.t, info.n, [-radius, radius], [-0.5, radius]),
                    quad(
                        base,
                        info.t,
                        info.n,
                        [-(radius - k), radius - k],
                        [-0.5, radius - k],
                    ),
                )
            };
            if dry_share(std::slice::from_ref(&outer)) < 0.9 || !dry_points(&outer) {
                continue;
            }
            let walls = clear.from(inner_core.from(g::difference(&outer, &inner)));
            if walls.is_empty() {
                continue;
            }
            // The court's outer gate, where a street really leaves the court:
            // its crossing of the court wall line (radius - k/2) nearest to
            // the straight run from the gate.
            let mid_line = if round {
                let a0 = info.t.1.atan2(info.t.0);
                let mut o: Vec<Point> = (0..=24)
                    .map(|j| {
                        let a = a0 + j as f64 * std::f64::consts::PI / 24.0;
                        let r = radius - k * 0.5;
                        pt(base.x + r * a.cos(), base.y + r * a.sin())
                    })
                    .collect();
                if dot(dir(base, o[12]), info.n) < 0.0 {
                    o = o
                        .iter()
                        .map(|p| pt(2.0 * base.x - p.x, 2.0 * base.y - p.y))
                        .collect();
                }
                o
            } else {
                let r = radius - k * 0.5;
                vec![
                    add(base, info.t, -r),
                    add(add(base, info.t, -r), info.n, r),
                    add(add(base, info.t, r), info.n, r),
                    add(base, info.t, r),
                ]
            };
            let guess = add(
                q,
                info.s,
                (face + radius - k * 0.5) / dot(info.s, info.n).max(0.3),
            );
            let (cx0, cy0, cx1, cy1) = g::bbox(&outer);
            let mut exit: Option<(f64, Point, V, f64)> = None;
            for st in streets.iter().filter(|s| s.role != "wall-lane") {
                for (si, w) in st.path.windows(2).enumerate() {
                    if w[0].x.max(w[1].x) < cx0
                        || w[0].x.min(w[1].x) > cx1
                        || w[0].y.max(w[1].y) < cy0
                        || w[0].y.min(w[1].y) > cy1
                    {
                        continue;
                    }
                    for e2 in mid_line.windows(2) {
                        if let Some((_, x)) = g::segment_hit(w[0], w[1], e2[0], e2[1]) {
                            let d = dist(x, guess);
                            if exit.is_none_or(|b| d < b.0) {
                                exit = Some((
                                    d,
                                    x,
                                    dir(w[0], w[1]),
                                    final_width(st, si, true, predicted),
                                ));
                            }
                        }
                    }
                }
            }
            // A court no street leaves would close its gate: not built.
            let Some((_, x, mut sx, wx)) = exit else {
                continue;
            };
            moat_core.push(outer.clone());
            extra_reserve.extend(clear.from(inner_core.from(vec![inner])));
            for p in walls.into_iter().filter(|p| g::area(p) >= 10.0) {
                outworks.push(Work {
                    kind: "wengcheng".into(),
                    shape: p,
                    height_m: height,
                    passage: None,
                });
            }
            if dot(sx, dir(base, x)) < 0.0 {
                sx = (-sx.0, -sx.1);
            }
            let pw = wx + 1.0;
            let across = (-sx.1, sx.0);
            let block = quad(
                x,
                sx,
                across,
                [-k * 0.5 - 2.0, k * 0.5 + 2.0],
                [-pw * 0.5 - 3.0, pw * 0.5 + 3.0],
            );
            if dry_points(&block) {
                let masses: Vec<Shape> = clear
                    .from(inner_core.from(vec![block.clone()]))
                    .into_iter()
                    .filter(|m| g::area(m) >= 4.0)
                    .collect();
                if !masses.is_empty() && masses.iter().all(|m| free(&occupied, m)) {
                    for m in &masses {
                        occupied.add(m.clone());
                    }
                    gatehouses.push(Gatehouse {
                        gate: gi,
                        kind: "tower".into(),
                        shape: block,
                        masses,
                        passage: [add(x, sx, -k * 0.5 - 2.0), add(x, sx, k * 0.5 + 2.0)],
                        passage_width_m: pw,
                        height_m: tower_height,
                    });
                }
            }
        }
    }
    // --- faubourg gate fronts: lean-tos against the outer face beside the
    // major gates, each row with the lane that serves it (a dead end off the
    // gate street, round the gate structures). Drawn before the ditch, which
    // then stops at the front (filled where the faubourg leans on the wall),
    // so a lean-to is never in a ditch, a glacis or a gate passage. No front
    // on steep or water-side runs, nor where a glacis or ravelins hold the
    // approaches (no-build zone).
    let mut attached: Vec<Attached> = vec![];
    let mut lanes: Vec<Street> = vec![];
    let mut fronts: Vec<Shape> = vec![];
    if style.attached > 0.0 && !has("glacis") && !has("ravelin") {
        let held: Vec<Shape> = towers
            .iter()
            .map(|t| t.footprint.clone())
            .chain(gatehouses.iter().flat_map(|gh| gh.masses.clone()))
            .chain(bastions.iter().map(|b| b.shape.clone()))
            .chain(outworks.iter().map(|w| w.shape.clone()))
            .collect();
        let occupied = Cut::new(held.clone());
        let curtain = Near::new(&path, 30.0);
        let lw = predicted.widths[3].clamp(2.5, 5.0);
        let margin = 1.0;
        for &gi in &major_land {
            let info = &infos[gi];
            let q = e.gates[gi];
            let mut ar = rng.fork(&format!("attached:{gi}"));
            if !ar.chance(style.attached) {
                continue;
            }
            let k = seg_of(q);
            if steep[k] || wet[k] {
                continue;
            }
            let sn = dot(info.s, info.n).max(0.25);
            let base = add(q, info.n, face);
            // Gate street at offset `o` from the outer face, and its signed
            // position along the curtain there.
            let road = |o: f64| add(q, info.s, (face + o) / sn);
            let road_along = |o: f64| (face + o) / sn * dot(info.s, info.t);
            let half_road = info.width * 0.5 / cross(info.t, info.s).abs().max(0.5);
            // Structures near the gate in the (along, out) frame.
            let frame: Vec<(f64, f64, f64)> = held
                .iter()
                .filter(|s| s.outer.iter().any(|&p| dist(p, q) < 90.0))
                .map(|s| {
                    s.outer.iter().fold(
                        (f64::INFINITY, f64::NEG_INFINITY, f64::NEG_INFINITY),
                        |(a0, a1, o1), &p| {
                            let v = (p.x - base.x, p.y - base.y);
                            let (a, o) = (dot(v, info.t), dot(v, info.n));
                            (a0.min(a), a1.max(a), o1.max(o))
                        },
                    )
                })
                .collect();
            for side in [-1.0, 1.0] {
                // Deeper than a lean-to is a house of its own: such a
                // culture keeps the drawn lean-to as decor only.
                let [min_front, min_depth] = predicted.dwelling;
                let depth = ar.range(5.0, 7.0).max(if min_depth <= LEAN_MAX_DEPTH { min_depth } else { 0.0 });
                let o1 = depth + LEAN_GAP + lw * 0.5;
                let end = (if side > 0.0 {
                    dist(q, path[k + 1])
                } else {
                    dist(q, path[k])
                } - 2.0)
                    .min(60.0);
                // Structures on this side, along measured away from the gate.
                let mine: Vec<(f64, f64, f64)> = frame
                    .iter()
                    .map(|&(a0, a1, o)| {
                        if side > 0.0 {
                            (a0, a1, o)
                        } else {
                            (-a1, -a0, o)
                        }
                    })
                    .filter(|&(_, a1, _)| a1 > 0.0)
                    .collect();
                // Lane corner: the first gap past the gate cluster wide
                // enough for the lane ribbon and its margin.
                let road_at = (side * road_along(o1)).max(0.0);
                let clearance = lw * 0.5 + margin;
                let mut ac = road_at + half_road + clearance;
                loop {
                    let next = mine
                        .iter()
                        .filter(|&&(a0, a1, _)| a0 < ac + clearance && a1 + clearance > ac)
                        .map(|&(_, a1, _)| a1 + clearance)
                        .fold(ac, f64::max);
                    if next <= ac + 1e-9 {
                        break;
                    }
                    ac = next;
                }
                // Lane top: in front of every structure between the gate
                // and the corner.
                let o2 = mine
                    .iter()
                    .filter(|&&(a0, _, _)| a0 < ac)
                    .map(|&(_, _, o)| o + clearance)
                    .fold(o1, f64::max);
                if o2 > o1 + 20.0 || ac + lw * 0.5 + LEAN_GAP + 5.0 > end {
                    continue;
                }
                let along = (info.t.0 * side, info.t.1 * side);
                let at = |a: f64, o: f64| add(add(base, along, a), info.n, o);
                let first = attached.len();
                let mut a = ac + lw * 0.5 + LEAN_GAP;
                while a < end {
                    let f = ar.range(5.0, 9.0).max(min_front.min(LEAN_MAX_FRONT));
                    if a + f > end {
                        break;
                    }
                    let unit_shape = quad(base, along, info.n, [a, a + f], [0.0, depth]);
                    let probe = quad(
                        base,
                        along,
                        info.n,
                        [a - 2.0, a + f + 2.0],
                        [0.0, depth + 2.0],
                    );
                    if occupied.hits(&probe) > 0.01 || !dry_points(&unit_shape) {
                        break;
                    }
                    let full = g::area(&unit_shape);
                    let pieces = clip(unit_shape);
                    if area(&pieces) < 0.6 * full {
                        break;
                    }
                    let hm = ar.range(4.0, 6.0);
                    for p in pieces {
                        attached.push(Attached {
                            kind: "lean-to".into(),
                            side: "out".into(),
                            shape: p,
                            height_m: hm,
                        });
                    }
                    a += f;
                }
                if attached.len() == first {
                    continue;
                }
                // The lane: along the row front, round the gate structures,
                // onto the gate street (0.5 m past its axis, so the junction
                // is a real crossing).
                let top = at(ac, o2);
                let meet = road(o2);
                let mut lane = vec![at(a + 0.5, o1), at(ac, o1)];
                if o2 > o1 + 0.25 {
                    lane.push(top);
                }
                lane.push(add(meet, dir(top, meet), 0.5));
                let ribbon = g::ribbon(&lane, &vec![lw + 2.0 * LEAN_GAP; lane.len()]);
                let lane_clear = ribbon.iter().all(|r| occupied.hits(r) <= 0.01)
                    && lane
                        .windows(2)
                        .all(|w| curtain.distance(w[0], w[1]) >= face + lw * 0.5 + LEAN_GAP)
                    && lane.iter().all(|&p| !surface.wet(p));
                if !lane_clear {
                    attached.truncate(first);
                    continue;
                }
                let far = o2 + lw * 0.5 + style.berm + dw + 2.0;
                fronts.push(quad(
                    base,
                    along,
                    info.n,
                    [-half_road - lw, a + 2.0],
                    [-face - h - 0.5, far],
                ));
                lanes.push(Street {
                    widths: vec![lw; lane.len()],
                    path: lane,
                    rank: 3,
                    role: "lane".into(),
                });
            }
        }
    }
    // --- ditch: decided once per circuit; a wet ditch where water is near
    // and the ground is level, otherwise dry with the style's probability.
    let mut ditch: Vec<Work> = vec![];
    let mut glacis: Vec<Shape> = vec![];
    let moat_core = g::union(&moat_core);
    let berm = style.berm;
    let ditch_kind = match style.ditch.as_str() {
        "none" => None,
        "wet" => Some("wet"),
        "dry" => dr.chance(style.ditch_p).then_some("dry"),
        _ => {
            let near_water = wet.iter().any(|&w| w)
                || (0..n_seg).any(|i| {
                    wet_outward(path[i], path[i + 1], ns[i], surface, face + berm + dw) > 0.0
                });
            let level = (0..n_seg)
                .map(|i| {
                    dist(path[i], path[i + 1])
                        * segment_relief(path[i], path[i + 1], ns[i], surface)
                })
                .sum::<f64>()
                / (0..n_seg)
                    .map(|i| dist(path[i], path[i + 1]))
                    .sum::<f64>()
                    .max(1.0)
                < 0.05;
            if near_water && level {
                Some("wet")
            } else {
                dr.chance(style.ditch_p).then_some("dry")
            }
        }
    };
    let ravelins_wanted = has("ravelin") && ditch_kind.is_some();
    let mut ravelin_cut: Vec<Shape> = vec![];
    let mut ravelin_ditch: Vec<Shape> = vec![];
    if ravelins_wanted {
        for &gi in &major_land {
            let info = &infos[gi];
            let q = e.gates[gi];
            let base = add(q, info.n, face + berm + dw * 0.5);
            let tri = g::normalized(Shape {
                outer: vec![
                    add(base, info.t, -30.0),
                    add(base, info.n, 35.0),
                    add(base, info.t, 30.0),
                ],
                holes: vec![],
            });
            // Rule 4: one ravelin per front; a gate close to a built one
            // shares it.
            if dry_share(std::slice::from_ref(&tri)) < 0.9
                || !dry_points(&tri)
                || ravelin_cut
                    .iter()
                    .any(|r| area(&g::intersection(r, &tri)) > 1.0)
            {
                continue;
            }
            let pieces = clear.from(inner_core.from(
                bastion_union.iter().fold(vec![tri.clone()], |acc, b| {
                    acc.iter().flat_map(|p| g::difference(p, b)).collect()
                }),
            ));
            let pieces: Vec<Shape> = Cut::new(
                towers
                    .iter()
                    .map(|t| t.footprint.clone())
                    .chain(gatehouses.iter().flat_map(|gh| gh.masses.clone()))
                    .collect(),
            )
            .from(pieces);
            if area(&pieces) < 0.6 * g::area(&tri) {
                continue;
            }
            ravelin_cut.push(tri.clone());
            ravelin_ditch.extend(
                buffer(&tri, 8.0)
                    .iter()
                    .flat_map(|b| g::difference(b, &tri)),
            );
            for p in pieces.into_iter().filter(|p| g::area(p) >= 30.0) {
                outworks.push(Work {
                    kind: "ravelin".into(),
                    shape: p,
                    height_m: height * 0.8,
                    passage: Some([add(base, info.s, -dw * 0.5), add(base, info.s, 40.0)]),
                });
            }
        }
    }
    // No ditch along steep or water-side runs, nor at a faubourg gate front.
    let no_ditch = Cut::new(
        (0..n_seg)
            .filter(|&i| steep[i] || wet[i])
            .map(|i| {
                let (a, b) = (path[i], path[i + 1]);
                let t = dir(a, b);
                let wd = face + berm + dw + 30.0;
                quad(a, t, ns[i], [-wd, dist(a, b) + wd], [-wd, wd])
            })
            .chain(fronts)
            .collect(),
    );
    if let Some(kind) = ditch_kind {
        let inner_ring = buffer_all(&moat_core, berm);
        let outer_ring = buffer_all(&moat_core, berm + dw);
        // The berm between the curtain (or its outworks) and the ditch is
        // part of the fortification: no quarter keeps a sliver there.
        let berm_land: Vec<Shape> = inner_ring
            .iter()
            .flat_map(|o| g::difference(o, &poly))
            .collect();
        extra_reserve.extend(clear.from(no_ditch.from(tiles(berm_land, TILE))));
        let mut band: Vec<Shape> = outer_ring
            .iter()
            .flat_map(|o| {
                inner_ring.iter().fold(vec![o.clone()], |acc, i| {
                    acc.iter().flat_map(|p| g::difference(p, i)).collect()
                })
            })
            .collect();
        band.extend(ravelin_ditch.iter().cloned());
        let band = tiles(g::union(&band), TILE);
        let band = Cut::new(ravelin_cut.clone()).from(band);
        let band = g::union(&clear.from(no_ditch.from(inner_core.from(band))));
        for p in band {
            for d in g::dry_clip(&surface, &p) {
                if g::area(&d) > 20.0 {
                    ditch.push(Work {
                        kind: kind.into(),
                        shape: d,
                        height_m: 0.0,
                        passage: None,
                    });
                }
            }
        }
        if has("glacis") {
            let far = buffer_all(&moat_core, berm + dw + 20.0);
            let band: Vec<Shape> = far
                .iter()
                .flat_map(|o| {
                    outer_ring.iter().fold(vec![o.clone()], |acc, i| {
                        acc.iter().flat_map(|p| g::difference(p, i)).collect()
                    })
                })
                .collect();
            let band = Cut::new(ravelin_cut.iter().chain(&ravelin_ditch).cloned().collect())
                .from(tiles(band, TILE));
            for p in g::union(&clear.from(no_ditch.from(band))) {
                glacis.extend(
                    g::dry_clip(&surface, &p)
                        .into_iter()
                        .filter(|d| g::area(d) > 20.0),
                );
            }
        }
    }
    for p in glacis {
        outworks.push(Work {
            kind: "glacis".into(),
            shape: p,
            height_m: 0.0,
            passage: None,
        });
    }
    // --- citadel: a bastioned pentagon outside the highest salient.
    if has("citadel") && rng.fork("citadel").chance(0.5) {
        let mut cr = rng.fork("citadel-size");
        let rc = cr.range(90.0, 120.0);
        let mut salients: Vec<usize> = (0..n_seg)
            .filter(|&i| {
                let prev = (i + n_seg - 1) % n_seg;
                dot(ns[prev], dir(ring[i], ring[(i + 1) % n_seg])) < 0.0 && !wet[prev] && !wet[i]
            })
            .collect();
        salients.sort_by(|&a, &b| {
            surface
                .height_at(ring[b])
                .total_cmp(&surface.height_at(ring[a]))
                .then(a.cmp(&b))
        });
        let barrier = Cut::new(buffer(&poly, face + berm + dw + 5.0));
        for &i in salients.iter().take(6) {
            let prev = (i + n_seg - 1) % n_seg;
            let b = unit((ns[prev].0 + ns[i].0, ns[prev].1 + ns[i].1));
            let centre = add(ring[i], b, rc + face + dw + berm + 10.0);
            let phase = (-b.1).atan2(-b.0);
            let penta = g::normalized(disc(centre, rc, 5, phase));
            if barrier.hits(&penta) > 1.0
                || dry_share(std::slice::from_ref(&penta)) < 0.9
                || !dry_points(&penta)
                || streets.iter().any(|s| {
                    s.path.windows(2).any(|w| {
                        g::contains(&penta, w[0])
                            || penta
                                .outer
                                .iter()
                                .zip(penta.outer.iter().cycle().skip(1))
                                .any(|(&x, &y)| g::segment_hit(w[0], w[1], x, y).is_some())
                    })
                })
            {
                continue;
            }
            let pr = penta.outer.clone();
            let mut pp = pr.clone();
            pp.push(pr[0]);
            let pns = normals(&pp);
            let mut parts = vec![penta.clone()];
            for k in 0..5 {
                let (a, v, bb) = (pr[(k + 4) % 5], pr[k], pr[(k + 1) % 5]);
                let d = (0.15 * dist(a, v)).clamp(12.0, 30.0);
                if let Some(s) =
                    bastion(v, dir(a, v), dir(v, bb), pns[(k + 4) % 5], pns[k], d, false)
                {
                    parts.push(s);
                }
            }
            let citadel = g::union(&parts);
            if citadel.len() != 1 || dry_share(&citadel) < 0.9 {
                continue;
            }
            let citadel = citadel.into_iter().next().unwrap();
            if let Some(kind) = ditch_kind {
                let ring_d: Vec<Shape> = buffer(&citadel, berm + dw)
                    .iter()
                    .flat_map(|o| g::difference(o, &citadel))
                    .collect();
                for p in clear.from(ring_d) {
                    for d in g::dry_clip(&surface, &p) {
                        if g::area(&d) > 20.0 {
                            ditch.push(Work {
                                kind: kind.into(),
                                shape: d,
                                height_m: 0.0,
                                passage: None,
                            });
                        }
                    }
                }
            }
            outworks.push(Work {
                kind: "citadel".into(),
                shape: citadel,
                height_m: height * 0.8,
                passage: None,
            });
            break;
        }
    }
    // --- reserve: curtain body outside the inner face and every structure.
    let body: Vec<Shape> = buffer(&poly, face.max(0.1))
        .iter()
        .flat_map(|b| g::difference(b, &poly))
        .collect();
    let mut reserve: Vec<Shape> = clear.from(tiles(body, TILE));
    reserve.extend(extra_reserve);
    reserve.extend(towers.iter().map(|t| t.footprint.clone()));
    reserve.extend(gatehouses.iter().flat_map(|gh| gh.masses.clone()));
    reserve.extend(bastions.iter().map(|b| b.shape.clone()));
    reserve.extend(outworks.iter().map(|w| w.shape.clone()));
    reserve.extend(ditch.iter().map(|d| d.shape.clone()));
    reserve.extend(attached.iter().map(|a| a.shape.clone()));
    let reserve: Vec<Shape> = tiles(g::union(&reserve), TILE)
        .into_iter()
        .filter(|s| g::area(s) > 0.5)
        .collect();
    e.towers = towers.iter().map(|t| t.anchor).collect();
    e.towers_detail = towers;
    e.gatehouses = gatehouses;
    e.bastions = bastions;
    e.outworks = outworks;
    e.ditch = ditch;
    e.attached = attached;
    e.reserve = reserve;
    lanes
}

/// Quarters give up the fortification reserve. A quarter the reserve cuts
/// keeps its pieces of at least `MIN_PIECE` m²: smaller fragments (pockets
/// between a gatehouse, the curtain and the ditch) are returned to open land.
const MIN_PIECE: f64 = 1500.0;
pub(super) fn yield_reserve(quarters: &mut Vec<Quarter>, enclosures: &[Enclosure]) {
    let pieces: Vec<(Shape, Box2)> = enclosures
        .iter()
        .flat_map(|e| e.reserve.iter())
        .map(|s| (s.clone(), g::bbox(s)))
        .collect();
    if pieces.is_empty() {
        return;
    }
    let out = super::par::map(quarters, |_, q| {
        let qb = g::bbox(&q.shape);
        let mut shapes = vec![q.shape.clone()];
        for (r, rb) in &pieces {
            if !overlaps(qb, *rb, 0.0) {
                continue;
            }
            shapes = shapes
                .into_iter()
                .flat_map(|s| {
                    if overlaps(g::bbox(&s), *rb, 0.0) {
                        g::difference(&s, r)
                    } else {
                        vec![s]
                    }
                })
                .collect();
        }
        let cut = (area(&shapes) - g::area(&q.shape)).abs() > 1.0;
        shapes
            .into_iter()
            .filter(|s| g::area(s) >= if cut { MIN_PIECE } else { 1.0 })
            .map(|shape| Quarter {
                shape,
                phase: q.phase,
                zone: q.zone.clone(),
            })
            .collect::<Vec<_>>()
    });
    *quarters = out.into_iter().flatten().collect();
}

/// Ribbons (`width(street, vertex)`) of the street runs within `reach` of the
/// closed `path`, leaving out the segments inside `inner` whose ribbon cannot
/// reach the curtain.
fn near_ribbons(
    path: &[Point],
    streets: &[&Street],
    reach: f64,
    inner: &Shape,
    width: impl Fn(&Street, usize, bool) -> f64 + Sync,
) -> Vec<Shape> {
    let near = Near::new(path, reach);
    let wanted = |s: &Street, i: usize| {
        let d = near.distance(s.path[i], s.path[i + 1]);
        d.is_finite()
            && (d <= width(s, i, false).max(width(s, i + 1, false)) * 0.5 + 1.0
                || !g::contains(inner, s.path[i])
                || !g::contains(inner, s.path[i + 1]))
    };
    let runs: Vec<(Vec<Point>, Vec<f64>)> = streets
        .iter()
        .flat_map(|s| {
            let mut runs = vec![];
            let (mut pts, mut ws): (Vec<Point>, Vec<f64>) = (vec![], vec![]);
            let crossing = s.path.windows(2).any(|w| near.distance(w[0], w[1]) == 0.0);
            for i in 0..s.path.len().saturating_sub(1) {
                if wanted(s, i) {
                    if pts.is_empty() {
                        pts.push(s.path[i]);
                        ws.push(width(s, i, crossing));
                    }
                    pts.push(s.path[i + 1]);
                    ws.push(width(s, i + 1, crossing));
                } else if !pts.is_empty() {
                    runs.push((std::mem::take(&mut pts), std::mem::take(&mut ws)));
                }
            }
            if pts.len() >= 2 {
                runs.push((pts, ws));
            }
            runs
        })
        .collect();
    super::par::map(&runs, |_, (p, w)| g::ribbon(p, w))
        .into_iter()
        .flatten()
        .collect()
}

/// Smallest block piece kept where the reserve cuts a block.
const MIN_BLOCK_PIECE: f64 = 100.0;

/// A lean-to has a street edge: an edge of at least 3 m whose middle lies
/// within 2 m of a street ribbon (`segs`: segment ends and half width), the
/// same test `parcels::lean_to_lots` uses to front it on that street.
fn fronted(shape: &Shape, segs: &[(Point, Point, f64)]) -> bool {
    let ring = &shape.outer;
    (0..ring.len()).any(|i| {
        let (p, q) = (ring[i], ring[(i + 1) % ring.len()]);
        let m = pt((p.x + q.x) * 0.5, (p.y + q.y) * 0.5);
        dist(p, q) >= 3.0
            && segs
                .iter()
                .any(|&(a, b, hw)| g::distance(m, a, b).0 - hw <= 2.0)
    })
}

/// Final pass, once streets, blocks and access lanes are final
/// (`generate_quarters`): `build`'s rules against the final town, so they
/// hold on the layout that is drawn, whatever later stages added or pruned.
/// - Gates are the real crossings of the final network: a pruned street
///   closes its gate (and its gatehouse), a later street crossing the curtain
///   opens a plain gate; water gates stay.
/// - Rule 2: every structure keeps off the final street ribbons (+1 m);
///   towers, gatehouse masses, bastions and lean-tos keep 60 % of their area
///   in one piece or are dropped, ditch, glacis and outworks are cut
///   (causeways), and a land gatehouse keeps its passage on a street.
/// - The reserve is what the fortification still holds; blocks give it up
///   (pieces under `MIN_BLOCK_PIECE` m² return to open land).
pub(super) fn settle(layout: &mut super::Layout, surface: Surface<'_>) {
    if layout.enclosures.iter().all(|e| e.style.is_empty()) {
        return;
    }
    let tick = std::time::Instant::now();
    let blocks_before = layout.blocks.len();
    let streets: Vec<&Street> = layout
        .streets
        .iter()
        .filter(|s| s.role != "wall-lane")
        .collect();
    let mut reserve_all: Vec<(Shape, Box2)> = vec![];
    for e in layout
        .enclosures
        .iter_mut()
        .filter(|e| !e.style.is_empty() && e.path.len() >= 4)
    {
        let poly = g::normalized(Shape {
            outer: e.path[..e.path.len() - 1].to_vec(),
            holes: vec![],
        });
        // Reach of the structures from the curtain (the citadel, the glacis).
        let reach = e
            .towers_detail
            .iter()
            .map(|t| &t.footprint)
            .chain(e.gatehouses.iter().flat_map(|gh| gh.masses.iter()))
            .chain(e.bastions.iter().map(|w| &w.shape))
            .chain(e.outworks.iter().map(|w| &w.shape))
            .chain(e.ditch.iter().map(|w| &w.shape))
            .chain(e.attached.iter().map(|w| &w.shape))
            .chain(e.reserve.iter())
            .flat_map(|s| s.outer.iter())
            .map(|&p| {
                e.path
                    .windows(2)
                    .map(|w| g::distance(p, w[0], w[1]).0)
                    .fold(f64::INFINITY, f64::min)
            })
            .fold(0.0, f64::max)
            + 5.0;
        let ribbons = Cut::new(near_ribbons(&e.path, &streets, reach, &poly, |s, i, _| {
            s.widths.get(i).or(s.widths.first()).copied().unwrap_or(4.0) + 1.0
        }));
        // Final street segments near the curtain, with their half width.
        let near = Near::new(&e.path, reach);
        let segs: Vec<(Point, Point, f64)> = streets
            .iter()
            .flat_map(|s| {
                s.path.windows(2).enumerate().filter_map(|(i, w)| {
                    near.distance(w[0], w[1]).is_finite().then(|| {
                        let wd = s.widths.get(i).or(s.widths.first()).copied().unwrap_or(4.0);
                        (w[0], w[1], wd * 0.5)
                    })
                })
            })
            .collect();
        let on_street = |p: Point, slack: f64| {
            segs.iter()
                .any(|&(a, b, hw)| g::distance(p, a, b).0 < hw + slack)
        };
        // --- gates
        let crossings = super::composition::gates(&e.path, &layout.streets);
        let water_ends: Vec<Point> = e
            .gatehouses
            .iter()
            .filter(|gh| gh.kind == "water")
            .flat_map(|gh| gh.passage)
            .collect();
        let bank = |p: Point| {
            water_ends.iter().any(|&q| dist(p, q) < 1.0)
                || (0..8).any(|k| {
                    let a = k as f64 * std::f64::consts::FRAC_PI_4;
                    surface.wet(pt(p.x + 4.0 * a.cos(), p.y + 4.0 * a.sin()))
                })
        };
        let mut remap: Vec<Option<usize>> = vec![None; e.gates.len()];
        let mut gates: Vec<Point> = vec![];
        let referenced: Vec<usize> = e
            .gatehouses
            .iter()
            .filter(|gh| gh.kind == "water")
            .map(|gh| gh.gate)
            .collect();
        for (i, &q) in e.gates.iter().enumerate() {
            if crossings.iter().any(|&c| dist(c, q) < 2.0) || referenced.contains(&i) || bank(q) {
                remap[i] = Some(gates.len());
                gates.push(q);
            }
        }
        for c in crossings {
            if !gates.iter().any(|&q| dist(c, q) < 8.0) {
                gates.push(c);
            }
        }
        e.gates = gates;
        // --- structures
        let keep_most = |s: &Shape| -> Option<Shape> {
            let full = g::area(s);
            let best = ribbons
                .from(vec![s.clone()])
                .into_iter()
                .max_by(|a, b| g::area(a).total_cmp(&g::area(b)))?;
            (g::area(&best) >= 0.6 * full).then_some(best)
        };
        let cut = |list: Vec<Work>, min: f64| -> Vec<Work> {
            list.into_iter()
                .flat_map(|w| {
                    ribbons
                        .from(vec![w.shape.clone()])
                        .into_iter()
                        .filter(|p| g::area(p) >= min)
                        .map(|shape| Work { shape, ..w.clone() })
                        .collect::<Vec<_>>()
                })
                .collect()
        };
        e.towers_detail = std::mem::take(&mut e.towers_detail)
            .into_iter()
            .filter_map(|mut t| {
                t.footprint = keep_most(&t.footprint)?;
                Some(t)
            })
            .collect();
        e.towers = e.towers_detail.iter().map(|t| t.anchor).collect();
        e.gatehouses = std::mem::take(&mut e.gatehouses)
            .into_iter()
            .filter_map(|mut gh| {
                gh.gate = remap.get(gh.gate).copied().flatten()?;
                gh.masses = gh
                    .masses
                    .iter()
                    .flat_map(|m| ribbons.from(vec![m.clone()]))
                    .filter(|m| g::area(m) >= 4.0)
                    .collect();
                if gh.kind == "water" {
                    return Some(gh);
                }
                let mid = pt(
                    (gh.passage[0].x + gh.passage[1].x) * 0.5,
                    (gh.passage[0].y + gh.passage[1].y) * 0.5,
                );
                (!gh.masses.is_empty() && on_street(mid, 0.5)).then_some(gh)
            })
            .collect();
        e.bastions = std::mem::take(&mut e.bastions)
            .into_iter()
            .filter_map(|mut b| {
                b.shape = keep_most(&b.shape)?;
                Some(b)
            })
            .collect();
        e.attached = std::mem::take(&mut e.attached)
            .into_iter()
            .filter_map(|mut a| {
                a.shape = keep_most(&a.shape)?;
                Some(a)
            })
            .collect();
        e.outworks = cut(std::mem::take(&mut e.outworks), 10.0);
        e.ditch = cut(std::mem::take(&mut e.ditch), 20.0);
        e.reserve = ribbons
            .from(std::mem::take(&mut e.reserve))
            .into_iter()
            .filter(|s| g::area(s) > 0.5)
            .collect();
        reserve_all.extend(e.reserve.iter().map(|s| (s.clone(), g::bbox(s))));
        // Reserve exception (faubourg against the wall): an outer lean-to
        // with a street edge (an edge of at least 3 m whose middle lies
        // within 2 m of a final street ribbon) leaves the reserve and becomes
        // a lot (`parcels::lean_to_lots`). Blocks still give its land up.
        let served: Vec<Shape> = e
            .attached
            .iter()
            .filter(|a| a.side == "out" && fronted(&a.shape, &segs))
            .map(|a| a.shape.clone())
            .collect();
        if !served.is_empty() {
            let freed = Cut::new(served);
            e.reserve = freed
                .from(std::mem::take(&mut e.reserve))
                .into_iter()
                .filter(|s| g::area(s) > 0.5)
                .collect();
        }
    }
    if reserve_all.is_empty() {
        return;
    }
    // --- blocks give up the reserve
    let reserve = Cut {
        shapes: reserve_all,
    };
    let blocks = std::mem::take(&mut layout.blocks);
    let out = super::par::map(&blocks, |_, b| {
        if reserve.hits(&b.shape) <= 0.5 {
            return vec![b.clone()];
        }
        reserve
            .from(vec![b.shape.clone()])
            .into_iter()
            .filter(|s| g::area(s) >= MIN_BLOCK_PIECE)
            .map(|shape| super::Block { shape, ..b.clone() })
            .collect::<Vec<_>>()
    });
    layout.blocks = out.into_iter().flatten().collect();
    if std::env::var("URBAN_PROFILE").is_ok() {
        eprintln!(
            "  fortification settle: blocks {blocks_before} -> {}, {:.0} ms",
            layout.blocks.len(),
            tick.elapsed().as_secs_f64() * 1000.0
        );
    }
}

#[cfg(test)]
mod tests {
    use super::super::{
        LayoutConfig, ParcelConfig, Site, composition, generate_parcels, generate_quarters,
    };
    use super::*;

    const W: f64 = 2048.0;
    const N: usize = 256;

    fn surface<'a>(height: &'a [f32], water: &'a [u8]) -> Surface<'a> {
        Surface {
            geometry: None,
            width: W,
            n: N,
            height,
            water,
        }
    }
    /// Water cells for a river running north-south over x in [x0, x1).
    fn river(x0: f64, x1: f64) -> Vec<u8> {
        let mut w = vec![0u8; N * N];
        let cell = W / N as f64;
        for y in 0..N {
            for x in 0..N {
                let cx = (x as f64 + 0.5) * cell;
                if cx >= x0 && cx < x1 {
                    w[y * N + x] = 1;
                }
            }
        }
        w
    }
    fn street(points: &[(f64, f64)], rank: usize, width: f64) -> Street {
        Street {
            path: points.iter().map(|&(x, y)| pt(x, y)).collect(),
            widths: vec![width; points.len()],
            rank,
            role: "street".into(),
        }
    }
    /// An irregular octagon around (1000, 1000), closed, counter-clockwise.
    fn octagon() -> Vec<Point> {
        let r = [320.0, 300.0, 340.0, 290.0, 330.0, 310.0, 300.0, 335.0];
        let mut p: Vec<Point> = (0..8)
            .map(|k| {
                let a = k as f64 * std::f64::consts::TAU / 8.0 + 0.2;
                pt(1000.0 + r[k] * a.cos(), 1000.0 + r[k] * a.sin())
            })
            .collect();
        p.push(p[0]);
        p
    }
    fn streets() -> Vec<Street> {
        vec![
            street(&[(500.0, 1010.0), (1500.0, 990.0)], 1, 8.0),
            street(&[(1005.0, 500.0), (995.0, 1500.0)], 1, 8.0),
            street(&[(700.0, 640.0), (1000.0, 1000.0)], 2, 4.0),
        ]
    }
    fn predicted() -> Predicted {
        Predicted {
            widths: [9.0, 8.0, 5.0, 3.5, 3.0],
            arterial: 1,
            dwelling: [5.0, 5.0],
        }
    }
    /// One enclosure built as `fortify` does.
    fn built(style: &str, kind: &str, water: &[u8], pop: u32) -> (Enclosure, Vec<Street>) {
        built_with(style, kind, water, pop, streets())
    }
    fn built_with(
        style: &str,
        kind: &str,
        water: &[u8],
        pop: u32,
        streets: Vec<Street>,
    ) -> (Enclosure, Vec<Street>) {
        let height = vec![10.0f32; N * N];
        let s = surface(&height, water);
        let path = octagon();
        let mut gates = composition::gates(&path, &streets);
        let land = gates.len();
        let banks = composition::water_gates(&path, s);
        for &(p, _) in &banks {
            if !gates.iter().any(|q| dist(*q, p) < 8.0) {
                gates.push(p);
            }
        }
        let mut e = Enclosure {
            path,
            kind: kind.into(),
            gates,
            ..Default::default()
        };
        let mut st = styled(style, "european-organic", pop);
        st.forced = true;
        build(
            &mut e,
            land,
            &banks,
            &streets,
            s,
            &st,
            pop,
            &predicted(),
            &Rng::new("fortification-test").fork("enc:0"),
        );
        (e, streets)
    }
    fn structures(e: &Enclosure) -> Vec<Shape> {
        e.towers_detail
            .iter()
            .map(|t| t.footprint.clone())
            .chain(e.gatehouses.iter().flat_map(|g| g.masses.clone()))
            .chain(e.bastions.iter().map(|b| b.shape.clone()))
            .chain(e.outworks.iter().map(|w| w.shape.clone()))
            .chain(e.ditch.iter().map(|w| w.shape.clone()))
            .chain(e.attached.iter().map(|a| a.shape.clone()))
            .collect()
    }
    /// Pairwise overlap (m²) of towers, gatehouse masses and bastions; the
    /// masses of one gatehouse are one structure.
    fn stacked(e: &Enclosure) -> f64 {
        let items: Vec<(usize, &Shape)> = e
            .towers_detail
            .iter()
            .enumerate()
            .map(|(i, t)| (i, &t.footprint))
            .chain(
                e.gatehouses
                    .iter()
                    .enumerate()
                    .flat_map(|(i, gh)| gh.masses.iter().map(move |m| (1000 + i, m))),
            )
            .chain(
                e.bastions
                    .iter()
                    .enumerate()
                    .map(|(i, b)| (2000 + i, &b.shape)),
            )
            .collect();
        let mut total = 0.0;
        for (i, (a, sa)) in items.iter().enumerate() {
            for (b, sb) in &items[i + 1..] {
                if a != b && overlaps(g::bbox(sa), g::bbox(sb), 0.0) {
                    total += area(&g::intersection(sa, sb));
                }
            }
        }
        total
    }
    fn ring(e: &Enclosure) -> Shape {
        g::normalized(Shape {
            outer: e.path[..e.path.len() - 1].to_vec(),
            holes: vec![],
        })
    }
    fn inputs<'a>(culture: &'a str, pop: u32, period: &'a str, relief: f64) -> Inputs<'a> {
        Inputs {
            culture,
            pop,
            period,
            state: "thriving",
            archetype: "",
            forced: "auto",
            relief,
        }
    }

    #[test]
    fn resolver_follows_culture_population_period_and_relief() {
        let rng = Rng::new("resolver").fork("fortification");
        let pick = |culture: &str, pop: u32, kind: &str| {
            resolve(kind, &inputs(culture, pop, "", 0.0), &rng, &mut vec![]).id
        };
        assert_eq!(pick("european-organic", 2000, "wall"), "curtain");
        assert_eq!(pick("european-organic", 10_000, "wall"), "flanked");
        assert_eq!(pick("medina", 8000, "wall"), "rammed-earth");
        assert_eq!(pick("chinese", 8000, "wall"), "wengcheng");
        assert_eq!(pick("slavic-gord", 3000, "palisade"), "gord");
        assert_eq!(pick("goblin-warren", 3000, "palisade"), "palisade");
        assert_eq!(pick("elven", 3000, "hedge"), "hedge");
        let mut drawn = std::collections::BTreeSet::new();
        for k in 0..40 {
            let r = Rng::new(&format!("draw-{k}")).fork("fortification");
            let medieval = resolve(
                "wall",
                &inputs("european-organic", 120_000, "M", 0.0),
                &r,
                &mut vec![],
            );
            assert_ne!(medieval.id, "bastioned");
            drawn.insert(
                resolve(
                    "wall",
                    &inputs("european-organic", 120_000, "", 0.0),
                    &r,
                    &mut vec![],
                )
                .id,
            );
            // A hill town never keeps a drawn bastioned or concentric trace.
            let hill = resolve(
                "wall",
                &inputs("european-organic", 120_000, "", 0.1),
                &r,
                &mut vec![],
            );
            assert!(hill.hill && hill.id == "flanked", "{}", hill.id);
        }
        assert!(
            drawn.contains("bastioned") && drawn.contains("concentric"),
            "{drawn:?}"
        );
        // A wall style forced on a palisade is refused with a warning.
        let mut w = vec![];
        let forced = Inputs {
            forced: "bastioned",
            ..inputs("slavic-gord", 3000, "", 0.0)
        };
        assert_eq!(resolve("palisade", &forced, &rng, &mut w).id, "gord");
        assert!(w[0].contains("incompatible avec palissade"));
    }

    /// I1 and I2: the old fields keep their meaning (gates on the path and on
    /// a street, tower anchors on the path) and nothing enters the inner side.
    #[test]
    fn structures_stay_outside_the_inner_face_and_anchor_on_the_curtain() {
        for style in [
            "curtain",
            "flanked",
            "concentric",
            "rammed-earth",
            "wengcheng",
            "bastioned",
        ] {
            let (e, streets) = built(style, "wall", &vec![0; N * N], 60_000);
            assert!(!e.gatehouses.is_empty(), "{style}");
            assert_eq!(e.towers.len(), e.towers_detail.len());
            for (t, d) in e.towers.iter().zip(&e.towers_detail) {
                assert!(dist(*t, d.anchor) < 1e-9);
                let on = e
                    .path
                    .windows(2)
                    .map(|w| g::distance(*t, w[0], w[1]).0)
                    .fold(f64::INFINITY, f64::min);
                assert!(on < 0.1, "{style}: tower {on} m off the curtain");
            }
            for q in &e.gates {
                assert!(
                    e.path
                        .windows(2)
                        .any(|w| g::distance(*q, w[0], w[1]).0 < 0.1)
                );
                assert!(streets.iter().any(|s| {
                    s.path
                        .windows(2)
                        .any(|w| g::distance(*q, w[0], w[1]).0 < 0.1)
                }));
            }
            let inner = buffer(&ring(&e), -ribbon_half("wall"));
            let overlap: f64 = structures(&e)
                .iter()
                .flat_map(|s| inner.iter().flat_map(move |i| g::intersection(s, i)))
                .map(|s| g::area(&s))
                .sum();
            assert!(
                overlap < 0.01,
                "{style}: {overlap} m² inside the inner face"
            );
        }
    }

    /// I4 at this stage: every land gatehouse straddles a real street crossing,
    /// and no structure covers a street ribbon (passages and causeways stay open).
    #[test]
    fn gatehouses_straddle_street_crossings_and_streets_stay_open() {
        for style in [
            "flanked",
            "rammed-earth",
            "wengcheng",
            "bastioned",
            "palisade",
        ] {
            let kind = if style == "palisade" {
                "palisade"
            } else {
                "wall"
            };
            let (e, streets) = built(style, kind, &vec![0; N * N], 60_000);
            let ribbons: Vec<Shape> = streets
                .iter()
                .flat_map(|s| g::ribbon(&s.path, &s.widths))
                .collect();
            for gh in e.gatehouses.iter().filter(|g| g.kind != "water") {
                let q = e.gates[gh.gate];
                let [a, b] = gh.passage;
                let on_street = streets.iter().any(|s| {
                    s.path.windows(2).any(|w| {
                        g::distance(a, w[0], w[1]).0 < 0.5 && g::distance(b, w[0], w[1]).0 < 0.5
                    })
                });
                assert!(on_street, "{style}: passage off its street");
                if gh.passage.iter().any(|p| dist(*p, q) < 40.0) {
                    assert!(
                        g::distance(q, a, b).0 < 0.5 || gh.kind == "tower",
                        "{style}: passage misses its gate"
                    );
                }
                assert!(
                    gh.masses.len() >= 2,
                    "{style}: a gatehouse keeps a mass each side"
                );
            }
            let covered: f64 = structures(&e)
                .iter()
                .flat_map(|s| ribbons.iter().flat_map(move |r| g::intersection(s, r)))
                .map(|s| g::area(&s))
                .sum();
            assert!(
                covered < 1.0,
                "{style}: {covered} m² of street under structures"
            );
        }
    }

    /// I5: across a river, no tower, gatehouse or bastion has a wet vertex or
    /// centre; the curtain opens on paired water gates.
    #[test]
    fn nothing_stands_in_the_water_and_water_gates_pair_banks() {
        let water = river(1180.0, 1260.0);
        let height = vec![10.0f32; N * N];
        let s = surface(&height, &water);
        for style in ["flanked", "bastioned"] {
            let (e, _) = built(style, "wall", &water, 60_000);
            let dry = |sh: &Shape| !sh.outer.iter().any(|&p| s.wet(p)) && !s.wet(g::centroid(sh));
            assert!(
                e.towers_detail
                    .iter()
                    .all(|t| dry(&t.footprint) && !s.wet(t.center))
            );
            assert!(e.gatehouses.iter().all(|gh| gh.masses.iter().all(dry)));
            assert!(e.bastions.iter().all(|b| dry(&b.shape)), "{style}");
            let water_gates: Vec<_> = e.gatehouses.iter().filter(|g| g.kind == "water").collect();
            assert_eq!(
                water_gates.len(),
                2,
                "{style}: the river crosses the circuit twice"
            );
            for gh in water_gates {
                let m = pt(
                    (gh.passage[0].x + gh.passage[1].x) * 0.5,
                    (gh.passage[0].y + gh.passage[1].y) * 0.5,
                );
                assert!(s.wet(m) && !s.wet(gh.passage[0]) && !s.wet(gh.passage[1]));
            }
            assert!(e.ditch.iter().all(|d| {
                g::dry_clip(&s, &d.shape).iter().map(g::area).sum::<f64>()
                    > 0.99 * g::area(&d.shape)
            }));
        }
    }

    /// Palisades are timber: no stone towers, timber gates, a thin curtain;
    /// a hedge has no structure at all.
    #[test]
    fn palisade_is_timber_and_hedge_is_plain() {
        let (p, _) = built("palisade", "palisade", &vec![0; N * N], 3000);
        assert_eq!((p.material.as_str(), p.curtain_width_m), ("timber", 1.5));
        assert!(p.towers.is_empty());
        assert!(!p.gatehouses.is_empty() && p.gatehouses.iter().all(|g| g.kind == "timber"));
        let (gord, _) = built("gord", "palisade", &vec![0; N * N], 3000);
        assert!(
            gord.towers_detail
                .iter()
                .all(|t| t.shape == "square" && t.radius_m <= 2.5)
        );
        let (h, _) = built("hedge", "hedge", &vec![0; N * N], 3000);
        assert!(h.towers.is_empty() && h.gatehouses.is_empty() && h.ditch.is_empty());
    }

    /// A bastioned trace has a bastion (or, failing it, a corner tower) at
    /// every salient corner away from the gates, and ravelins at major gates.
    #[test]
    fn bastioned_trace_fortifies_every_salient() {
        let (e, _) = built("bastioned", "wall", &vec![0; N * N], 60_000);
        assert!(e.towers_detail.iter().all(|t| t.kind != "flank"));
        let n = e.path.len() - 1;
        let ns = normals(&e.path);
        for i in 0..n {
            let prev = (i + n - 1) % n;
            let (a, v, b) = (e.path[(i + n - 1) % n], e.path[i], e.path[i + 1]);
            let (u, w) = (dir(a, v), dir(v, b));
            let deg = cross(u, w).atan2(dot(u, w)).abs().to_degrees();
            if dot(ns[prev], w) >= 0.0
                || !(15.0..=110.0).contains(&deg)
                || e.gates.iter().any(|q| dist(*q, v) < 50.0)
            {
                continue;
            }
            let b = unit((ns[prev].0 + ns[i].0, ns[prev].1 + ns[i].1));
            let held = e
                .bastions
                .iter()
                .any(|bw| g::contains(&bw.shape, add(v, b, 5.0)))
                || e.towers_detail.iter().any(|t| dist(t.anchor, v) < 1.0);
            assert!(held, "salient {i} unfortified");
        }
        assert!(e.bastions.len() >= 4, "{} bastions", e.bastions.len());
        assert!(e.outworks.iter().filter(|w| w.kind == "ravelin").count() >= 2);
        assert!(!e.ditch.is_empty() && e.outworks.iter().any(|w| w.kind == "glacis"));
    }

    fn town(style: &str) -> Vec<super::super::Layout> {
        let height = vec![10.0f32; N * N];
        let water = vec![0u8; N * N];
        let roads: Vec<Street> = [
            [(100.0, 1030.0), (1950.0, 1010.0)],
            [(1020.0, 100.0), (1030.0, 1950.0)],
        ]
        .iter()
        .map(|p| Street {
            role: "regional".into(),
            ..street(p, 1, 6.0)
        })
        .collect();
        let cfg = LayoutConfig {
            fortification: "wall".into(),
            fortification_style: style.into(),
            phases: 3,
            suburbs: "many".into(),
            // Peripheral frontage strips (open-edge exits) are cut after this
            // stage without the reserve: queued for the quarters stage.
            exit_treatment: "legacy".into(),
            ..LayoutConfig::default()
        };
        let site = Site {
            key: "walls-town".into(),
            name: String::new(),
            population: 12_000,
            culture: "european-organic".into(),
            center: pt(1024.0, 1024.0),
            radius: 420.0,
        };
        generate_quarters("walls", &[site], &cfg, surface(&height, &water), &roads).unwrap()
    }

    /// I3 and I6: blocks and lots never enter the reserve or the curtain
    /// ribbon, and two runs give the same layout.
    #[test]
    fn no_block_or_lot_in_the_reserve_and_deterministic() {
        for style in ["flanked", "bastioned"] {
            let a = town(style);
            let b = town(style);
            assert_eq!(
                serde_json::to_string(&a).unwrap(),
                serde_json::to_string(&b).unwrap()
            );
            let layout = &a[0];
            let e = layout.enclosures.first().expect("a walled town");
            assert_eq!(e.style, style);
            let reserve = &e.reserve;
            let blocks: f64 = layout
                .blocks
                .iter()
                .flat_map(|bl| {
                    reserve
                        .iter()
                        .flat_map(move |r| g::intersection(&bl.shape, r))
                })
                .map(|s| g::area(&s))
                .sum();
            assert!(
                blocks < 0.5,
                "{style}: {blocks} m² of blocks in the reserve"
            );
            let parts = generate_parcels(
                "walls",
                std::slice::from_ref(layout),
                &ParcelConfig::default(),
            )
            .unwrap();
            let ribbon = g::ribbon(&e.path, &[2.0 * ribbon_half(&e.kind)]);
            let lots: f64 = parts[0]
                .parcels
                .iter()
                .flat_map(|p| {
                    reserve
                        .iter()
                        .chain(&ribbon)
                        .flat_map(move |r| g::intersection(&p.shape, r))
                })
                .map(|s| g::area(&s))
                .sum();
            assert!(lots < 0.5, "{style}: {lots} m² of lots in the reserve");
        }
    }

    /// Faubourg gate fronts: every outer lean-to fronts the lane drawn with it
    /// (an edge within 2 m of the lane ribbon), none stands in the ditch or a
    /// gate street, and the lane keeps off the curtain and every structure.
    #[test]
    fn faubourg_lean_tos_front_their_lane_clear_of_ditch_and_gates() {
        let height = vec![10.0f32; N * N];
        let water = vec![0u8; N * N];
        let s = surface(&height, &water);
        let path = octagon();
        let streets = streets();
        let gates = composition::gates(&path, &streets);
        let land = gates.len();
        let mut e = Enclosure {
            path: path.clone(),
            kind: "wall".into(),
            gates,
            ..Default::default()
        };
        let mut st = styled("flanked", "european-organic", 12_000);
        st.forced = true;
        st.attached = 1.0;
        st.ditch = "dry".into();
        st.ditch_p = 1.0;
        let lanes = build(
            &mut e,
            land,
            &[],
            &streets,
            s,
            &st,
            12_000,
            &predicted(),
            &Rng::new("fortification-test").fork("enc:0"),
        );
        assert!(!e.attached.is_empty() && !lanes.is_empty());
        assert!(!e.ditch.is_empty(), "the ditch runs elsewhere");
        let segs: Vec<(Point, Point, f64)> = lanes
            .iter()
            .flat_map(|l| l.path.windows(2).map(|w| (w[0], w[1], l.widths[0] * 0.5)))
            .collect();
        let gate_streets: Vec<Shape> = streets
            .iter()
            .flat_map(|st| g::ribbon(&st.path, &vec![st.widths[0]; st.path.len()]))
            .collect();
        let ditch = Cut::new(e.ditch.iter().map(|d| d.shape.clone()).collect());
        let roads = Cut::new(gate_streets);
        for a in &e.attached {
            assert!(fronted(&a.shape, &segs), "a lean-to without its lane");
            assert!(ditch.hits(&a.shape) < 0.01, "a lean-to in the ditch");
            assert!(roads.hits(&a.shape) < 0.01, "a lean-to on a gate street");
        }
        let held = Cut::new(
            e.towers_detail
                .iter()
                .map(|t| t.footprint.clone())
                .chain(e.gatehouses.iter().flat_map(|gh| gh.masses.clone()))
                .chain(e.ditch.iter().map(|d| d.shape.clone()))
                .chain(e.attached.iter().map(|a| a.shape.clone()))
                .collect(),
        );
        let near = Near::new(&path, 30.0);
        for l in &lanes {
            for r in g::ribbon(&l.path, &l.widths) {
                assert!(held.hits(&r) < 0.01, "a lane through a structure");
            }
            assert!(l.path.windows(2).all(|w| near.distance(w[0], w[1]) > 2.0));
        }
    }

    /// Reserve exception (faubourg against the wall): once the town is final,
    /// a lean-to with a street edge leaves the reserve and is a lot of family
    /// `faubourg`; no block takes its land, and the other lots keep out of
    /// the reserve (I3 still holds).
    #[test]
    fn served_lean_tos_leave_the_reserve_as_faubourg_lots() {
        let layouts = town("flanked");
        let layout = &layouts[0];
        let e = &layout.enclosures[0];
        assert!(!e.attached.is_empty(), "the test town has a faubourg front");
        let segs: Vec<(Point, Point, f64)> = layout
            .streets
            .iter()
            .filter(|s| s.role != "wall-lane")
            .flat_map(|s| {
                s.path
                    .windows(2)
                    .enumerate()
                    .map(move |(i, w)| (w[0], w[1], s.widths.get(i).copied().unwrap_or(4.0) * 0.5))
            })
            .collect();
        let reserve = Cut::new(e.reserve.clone());
        let blocks = Cut::new(layout.blocks.iter().map(|b| b.shape.clone()).collect());
        let served: Vec<&Attached> = e
            .attached
            .iter()
            .filter(|a| fronted(&a.shape, &segs))
            .collect();
        assert_eq!(
            served.len(),
            e.attached.len(),
            "every lean-to fronts its lane"
        );
        for a in &served {
            assert!(
                reserve.hits(&a.shape) < 0.5,
                "a served lean-to kept in the reserve"
            );
            assert!(blocks.hits(&a.shape) < 0.5, "a block on a lean-to");
        }
        let parts = generate_parcels(
            "walls",
            std::slice::from_ref(layout),
            &ParcelConfig::default(),
        )
        .unwrap();
        let lots: Vec<_> = parts[0]
            .parcels
            .iter()
            .filter(|p| p.provenance.iter().any(|t| t.starts_with("lean-to:0:")))
            .collect();
        assert_eq!(lots.len(), served.len());
        assert!(
            lots.iter()
                .all(|p| p.family == "faubourg" && p.use_kind == "plot")
        );
    }

    /// Defect 1 of the review: a bastioned trace never takes the curtain into
    /// the river along a bank (its bulges there are given back).
    #[test]
    fn bastioned_trace_never_runs_in_the_river() {
        let water = river(1310.0, 1420.0);
        let height = vec![10.0f32; N * N];
        let s = surface(&height, &water);
        let octa = g::normalized(Shape {
            outer: octagon()[..8].to_vec(),
            holes: vec![],
        });
        let land = g::intersection(&octa, &g::rectangle(0.0, 0.0, 1305.0, W))
            .into_iter()
            .next()
            .unwrap();
        let trace = bastioned_trace(&land, s).expect("a bastioned trace");
        let wet = wet_length(&trace.outer, s);
        assert!(wet < 1.0, "{wet:.0} m of curtain in the river");
        let covered = area(&g::intersection(&trace, &land));
        assert!(covered >= 0.98 * g::area(&land));
    }

    /// Defect 2: crossings a few metres apart never stack gatehouses and
    /// towers; the lesser crossing stays a plain opening.
    #[test]
    fn close_crossings_never_stack_structures() {
        let mut streets = streets();
        // Two streets 14 m apart through the eastern front, and a third 9 m
        // from the first.
        streets.push(street(&[(1000.0, 1180.0), (1500.0, 1180.0)], 1, 8.0));
        streets.push(street(&[(1000.0, 1194.0), (1500.0, 1194.0)], 2, 5.0));
        streets.push(street(&[(1000.0, 1203.0), (1500.0, 1203.0)], 2, 4.0));
        for style in ["flanked", "rammed-earth", "bastioned", "wengcheng"] {
            let (e, _) = built_with(style, "wall", &vec![0; N * N], 60_000, streets.clone());
            let s = stacked(&e);
            assert!(s < 1.0, "{style}: {s:.1} m² of stacked structures");
            assert!(
                e.gatehouses.iter().all(|gh| !gh.masses.is_empty()),
                "{style}: a gatehouse without masses"
            );
        }
    }

    /// Defects 4 and 6: once the town is final, gates are its real crossings,
    /// gatehouses stand on its streets, no structure covers a final street and
    /// no block keeps land in the reserve.
    #[test]
    fn settle_follows_the_final_streets_and_blocks() {
        let water = vec![0u8; N * N];
        let height = vec![10.0f32; N * N];
        let s = surface(&height, &water);
        let (e, mut streets) = built("flanked", "wall", &water, 60_000);
        // The diagonal street is pruned, a later street crosses the north-east front.
        streets.remove(2);
        streets.push(street(&[(1000.0, 1000.0), (1400.0, 1400.0)], 2, 5.0));
        let tower = e.towers_detail[e.towers_detail.len() / 2].center;
        let block = super::super::Block {
            shape: g::rectangle(
                tower.x - 25.0,
                tower.y - 25.0,
                tower.x + 25.0,
                tower.y + 25.0,
            ),
            quarter: 0,
            kind: "block".into(),
            axis: pt(1.0, 0.0),
            zone: "core".into(),
            phase: None,
        };
        let mut layout = super::super::Layout {
            config: None,
            programme: None,
            key: "settle".into(),
            culture: "european-organic".into(),
            center: pt(1000.0, 1000.0),
            quarters: vec![],
            streets: streets.clone(),
            blocks: vec![block],
            warnings: vec![],
            enclosures: vec![e],
            phases: vec![],
            archetype: String::new(),
            structure: None,
        };
        settle(&mut layout, s);
        let e = &layout.enclosures[0];
        let crossings = composition::gates(&e.path, &streets);
        assert_eq!(e.gates.len(), crossings.len());
        assert!(
            crossings
                .iter()
                .all(|c| e.gates.iter().any(|q| dist(*q, *c) < 8.0))
        );
        let ribbons: Vec<Shape> = streets
            .iter()
            .flat_map(|st| g::ribbon(&st.path, &st.widths))
            .collect();
        for gh in e.gatehouses.iter().filter(|gh| gh.kind != "water") {
            let m = pt(
                (gh.passage[0].x + gh.passage[1].x) * 0.5,
                (gh.passage[0].y + gh.passage[1].y) * 0.5,
            );
            assert!(
                ribbons.iter().any(|r| g::contains(r, m)),
                "gatehouse off street"
            );
        }
        let covered: f64 = structures(e)
            .iter()
            .flat_map(|sh| ribbons.iter().flat_map(move |r| g::intersection(sh, r)))
            .map(|sh| g::area(&sh))
            .sum();
        assert!(covered < 1.0, "{covered:.1} m² of street under structures");
        let in_reserve: f64 = layout
            .blocks
            .iter()
            .flat_map(|b| e.reserve.iter().flat_map(|r| g::intersection(&b.shape, r)))
            .map(|sh| g::area(&sh))
            .sum();
        assert!(
            in_reserve < 1.0,
            "{in_reserve:.1} m² of block in the reserve"
        );
        assert_eq!(e.towers.len(), e.towers_detail.len());
    }

    /// Gates are through crossings: a lane run up to the curtain opens none,
    /// a street through it or two street ends meeting on it from both sides do.
    #[test]
    fn a_street_ending_on_the_curtain_opens_no_gate() {
        let path = octagon();
        let near = Near::new(&path, 40.0);
        // The east side at y = 1000, where the plain streets cross.
        let on = |y: f64| {
            let a = pt(900.0, y);
            let b = pt(1600.0, y);
            let k = near.crossed(a, b)[0..]
                .iter()
                .copied()
                .find(|&k| g::segment_hit(a, b, path[k], path[k + 1]).is_some())
                .unwrap();
            g::segment_hit(a, b, path[k], path[k + 1]).unwrap().1
        };
        let (p, q) = (on(950.0), on(1050.0));
        let lane = street(&[(900.0, 950.0), (p.x, p.y)], 3, 3.0);
        assert!(composition::gates(&path, std::slice::from_ref(&lane)).is_empty());
        let inner = street(&[(900.0, 1050.0), (q.x, q.y)], 2, 4.0);
        let outer = street(&[(q.x, q.y), (1600.0, 1050.0)], 2, 4.0);
        let through = street(&[(900.0, 1000.0), (1600.0, 1000.0)], 2, 4.0);
        let gates = composition::gates(&path, &[lane, inner, outer, through]);
        assert_eq!(gates.len(), 2, "{gates:?}");
        assert!(
            gates
                .iter()
                .all(|g| (g.y - 1000.0).abs() < 1.0 || dist(*g, q) < 1.0)
        );
    }

    /// A regional road enters through a gatehouse: where a wider city street
    /// crosses the curtain next to it, the regional crossing is served first.
    #[test]
    fn a_regional_road_enters_through_a_gatehouse() {
        let mut regional = street(&[(1000.0, 1000.0), (1600.0, 1000.0)], 1, 5.0);
        regional.role = "regional".into();
        let streets = vec![
            street(&[(1000.0, 1015.0), (1600.0, 1015.0)], 0, 12.0),
            regional,
            street(&[(1005.0, 500.0), (995.0, 1500.0)], 1, 8.0),
        ];
        let (e, streets) = built_with("flanked", "wall", &vec![0; N * N], 60_000, streets);
        let on = |s: &Street, p: Point| {
            s.path
                .windows(2)
                .any(|w| g::distance(p, w[0], w[1]).0 < 1.0)
        };
        let served: Vec<&str> = e
            .gatehouses
            .iter()
            .filter(|gh| gh.kind != "water")
            .filter_map(|gh| {
                streets
                    .iter()
                    .filter(|s| on(s, e.gates[gh.gate]))
                    .min_by_key(|s| s.rank)
                    .map(|s| s.role.as_str())
            })
            .collect();
        assert!(served.contains(&"regional"), "{served:?}");
        assert!(e.gates.iter().filter(|&&q| on(&streets[1], q)).all(|&q| {
            e.gatehouses
                .iter()
                .any(|gh| dist(e.gates[gh.gate], q) < 1.0)
        }));
    }
}
