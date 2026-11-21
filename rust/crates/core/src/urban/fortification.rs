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
use crate::urban::warnings;
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
    /// Ditch depth (m), for the 3D moat; 0: from its width (`build`).
    pub ditch_depth: f64,
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
    pub medieval: bool,
    pub dry_ditches: bool,
    pub timber_culture: bool,
    pub ditch_wetness: Option<f64>,
    /// Underdark town: the circuit closes the passages into its chamber (`cave_circuits`); its rock runs
    /// are open passages of the curtain and it digs no wet moat.
    pub cave: bool,
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
            tower_spacing: (!v.get("legacyTowerSpacing").unwrap_or(&v["towerSpacing"]).is_null())
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
            ditch_depth: num(v, "ditchDepthM", 0.0),
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
            medieval: false,
            dry_ditches: false,
            timber_culture: false,
            ditch_wetness: None,
            cave: false,
        })
    }
    pub(super) fn options(&mut self, cfg: &super::LayoutConfig) {
        self.medieval = cfg.medieval_walls && cfg.wall_tower_spacing.is_none() && self.kind == "wall";
        self.dry_ditches = cfg.dry_ditches;
        // A culture's timber rampart yields to an explicit style or « Muraille ».
        // A hedge (kraal thorn boma, halfling hedgerow) stays a hedge.
        self.timber_culture &= !self.forced && cfg.fortification != "wall" && self.kind != "hedge";
        if self.timber_culture || self.kind == "palisade" || self.material.starts_with("timber") {
            if self.timber_culture {
                self.id = "gord".into(); self.kind = "palisade".into();
                self.tower_shape = "square".into(); self.flank_shape = "square".into();
                self.gate_major = "timber".into(); self.gate_minor = "opening".into();
                self.outworks.clear(); self.attached = 0.0;
            }
            self.material = if self.id == "gord" { "timber-earth" } else { "timber" }.into();
            self.curtain_width = self.curtain_width.min(if self.id == "gord" { 3.0 } else { 1.5 });
            self.height = self.height.min(3.5);
            self.tower_height = self.tower_height.min(5.0);
        }
        self.ditch_wetness = cfg.ditch_wetness;
        // « Moat »: by culture and site (empty), none, or one kind for the
        // whole circuit; a style without a ditch of its own digs a 6–10 m one.
        if matches!(cfg.moat.as_str(), "none" | "dry" | "wet") {
            self.ditch = cfg.moat.clone();
            self.ditch_p = 1.0;
            self.ditch_wetness = None;
            self.dry_ditches = false;
            if self.ditch_width[1] <= 0.0 {
                self.ditch_width = [6.0, 10.0];
            }
        }
        if self.medieval {
            self.tower_spacing = Some(pair(&data()["styles"][&self.id]["towerSpacing"], [25.0, 35.0])
                .map(|v| v.clamp(20.0, 40.0)));
        }
        if let Some(spacing) = cfg.wall_tower_spacing.filter(|v| *v > 0.0) {
            self.tower_spacing = Some([spacing; 2]);
            self.medieval = true;
        }
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
        if let Some(d) = o["ditchDepthM"].as_f64() {
            self.ditch_depth = d;
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

/// Enclosure type a style belongs to (`wall`, `palisade`, `hedge`).
pub(super) fn family(style: &str) -> &'static str {
    match style {
        "palisade" | "gord" => "palisade",
        "hedge" => "hedge",
        _ => "wall",
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
    s.timber_culture = group(culture)["timberRampart"].as_bool().unwrap_or(false);
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
            warnings.push(warnings::incompatible_wall_style(i.forced, kind));
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
        warnings.push(warnings::wall_style_for_relief(&id));
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

#[path = "fortification_options.rs"]
mod options;
pub(super) use options::{keeps_citadel, prepare_options, finish_options, service_cost};

#[path = "fortification_heights.rs"]
mod heights;
pub(super) use heights::{heights_castle, wrap_castle};

#[path = "fortification_params.rs"]
mod parameters;
pub(super) use parameters::{valid_parameters, parameter_trace, port_walls, wall_extension};

#[path = "fortification_extension.rs"]
mod extension;
#[path = "fortification_cave.rs"]
mod cave;
pub(super) use cave::cave_circuits;
#[path = "fortification_gates.rs"]
mod gate_budget;
pub(super) use gate_budget::{decide as decide_gates, divert, drop_dead_gates, Circuit};
pub(super) use extension::{attach, lopsided, trim_shared, dedupe_shared, inner_gates, shared_length};

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
fn curtain_body(path: &[Point], width: f64, half: f64) -> Vec<Shape> {
    let n = path.len().saturating_sub(1);
    if n<3 { return vec![]; }
    let ns = normals(path);
    let offset = |i:usize,d:f64| {
        let (a,b) = (ns[(i+n-1)%n],ns[i]);
        let m = (a.0+b.0,a.1+b.1); let len=m.0.hypot(m.1);
        let m = if len<1e-6 {b} else {(m.0/len,m.1/len)};
        add(path[i],m,d/dot(m,b).max(0.4))
    };
    let inner:Vec<_> = (0..n).map(|i|offset(i,-half-0.15)).collect();
    let outer:Vec<_> = (0..n).map(|i|offset(i,width-half+0.15)).collect();
    (0..n).map(|i|g::normalized(Shape {outer:vec![inner[i],inner[(i+1)%n],outer[(i+1)%n],outer[i]],holes:vec![]})).collect()
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

#[derive(Clone, Copy)]
struct PocketLimits {
    depth_span: f64,
    min_depth: f64,
    fold_gap: f64,
}
impl PocketLimits {
    fn read() -> Self {
        let v = &data()["invaginations"];
        Self { depth_span: num(v, "maxDepthSpanRatio", 0.4),
            min_depth: num(v, "minDepthM", 12.0), fold_gap: num(v, "foldGapM", 10.0) }
    }
}
struct Pocket {
    start: usize,
    end: usize,
    a: Point,
    b: Point,
    length: f64,
}
impl Pocket {
    fn chain(&self, r: &[Point]) -> Vec<Point> {
        let mut chain = vec![self.a];
        chain.extend((1..=(self.end + r.len() - self.start) % r.len())
            .map(|k| r[(self.start + k) % r.len()]));
        chain.push(self.b);
        chain.dedup_by(|a, b| dist(*a, *b) < 1e-7);
        chain
    }
    fn bridge(&self, shape: &Shape) -> Shape {
        let r = &shape.outer;
        let count = (self.end + r.len() - self.start) % r.len();
        let mut outer = vec![];
        for i in 0..r.len() {
            let k = (i + r.len() - self.start) % r.len();
            if k > 0 && k <= count { continue; }
            outer.push(r[i]);
            if i == self.start {
                if dist(r[i], self.a) > 1e-7 { outer.push(self.a); }
                outer.push(self.b);
            }
        }
        outer.dedup_by(|a, b| dist(*a, *b) < 1e-7);
        if outer.len() > 1 && dist(outer[0], *outer.last().unwrap()) < 1e-7 { outer.pop(); }
        Shape { outer, holes: shape.holes.clone() }
    }
}
/// Sides of a simple ring, by exact coordinates: a bridged ring is simple when
/// its new sides are (`g::simple_around`), which is linear instead of quadratic.
type Sides = std::collections::HashSet<[u64; 4]>;
fn side_key(p: Point, q: Point) -> [u64; 4] { [p.x.to_bits(), p.y.to_bits(), q.x.to_bits(), q.y.to_bits()] }
fn sides(r: &[Point]) -> Sides { (0..r.len()).map(|i| side_key(r[i], r[(i + 1) % r.len()])).collect() }
fn bridged_simple(next: &Shape, base: Option<&Sides>) -> bool {
    let Some(base) = base else { return g::simple(next) };
    let r = &next.outer;
    let fresh: Vec<usize> = (0..r.len()).filter(|&i| !base.contains(&side_key(r[i], r[(i + 1) % r.len()]))).collect();
    g::simple_around(r, &fresh)
}
/// The shape test of a pocket: a re-entrant chain, no occupied salient cut
/// off, deep enough (or a narrow fold). Cheap: no bridge is built.
fn pocket_candidate(shape: &Shape, start: usize, end: usize, a: Point, b: Point, limits: PocketLimits, fold: bool) -> Option<Pocket> {
    let mut p = Pocket { start, end, a, b, length: 0.0 };
    let chain = p.chain(&shape.outer);
    let span = dist(a, b);
    if span < 1e-6 || chain.len() < 3 || g::signed(&chain) >= -1e-6 { return None; }
    let u = dir(a, b);
    // A cut may fill a pocket, never cut off an occupied salient.
    if chain.iter().any(|&q| cross(u, (q.x - a.x, q.y - a.y)) < -1e-6) { return None; }
    let depth = chain.iter().map(|&q| g::distance(q, a, b).0).fold(0.0, f64::max);
    p.length = chain.windows(2).map(|w| dist(w[0], w[1])).sum();
    if depth <= limits.min_depth || if fold {
        span >= limits.fold_gap || p.length <= span * 4.0
    } else { depth <= span * limits.depth_span } { return None; }
    Some(p)
}
/// The bridged shape when it is a valid repair: simple and larger.
fn bridged(shape: &Shape, p: &Pocket, base: Option<&Sides>) -> Option<Shape> {
    let next = p.bridge(shape);
    (next.outer.len() >= 3 && bridged_simple(&next, base) && g::area(&next) > g::area(shape)).then_some(next)
}
#[cfg(test)]
fn pockets(shape: &Shape, limits: PocketLimits) -> Vec<Pocket> {
    let base = g::simple(shape).then(|| sides(&shape.outer));
    candidates(shape, limits).into_iter().filter(|p| bridged(shape, p, base.as_ref()).is_some()).collect()
}
/// Every pocket candidate in discovery order (corner pairs, then folds).
fn candidates(shape: &Shape, limits: PocketLimits) -> Vec<Pocket> {
    let r = &shape.outer;
    if r.len() < 4 { return vec![]; }
    let n = r.len();
    // Twice-around prefix of the shoelace terms: the signed area of the chain
    // r[i..=j] closed by its chord in O(1). A chain clearly positive (> 1 m²)
    // is no pocket (it must be below -1e-6): skipped before building it.
    let mut prefix = vec![0.0; 2 * n + 1];
    for k in 0..2 * n {
        let (p, q) = (r[k % n], r[(k + 1) % n]);
        prefix[k + 1] = prefix[k] + (p.x * q.y - q.x * p.y);
    }
    let corners: Vec<_> = (0..n).filter(|&i|
        cross(dir(r[(i + n - 1) % n], r[i]), dir(r[i], r[(i + 1) % n])) >= -1e-8).collect();
    let corners_found = super::par::map(&corners, |_, &i| {
        let mut found = Vec::new();
        for &j in &corners {
            let span = (j + n - i) % n;
            if span < 2 { continue; }
            let end = (j + n - 1) % n;
            if 0.5 * (prefix[i + span] - prefix[i] + (r[j].x * r[i].y - r[i].x * r[j].y)) > 1.0 {
                continue;
            }
            // A vertex clearly right of the chord (an occupied salient) rejects
            // the pair before its chain is built; `pocket_candidate` decides the rest.
            let u = dir(r[i], r[j]);
            if (1..span).any(|k| { let q = r[(i + k) % n]; cross(u, (q.x - r[i].x, q.y - r[i].y)) < -1e-3 }) {
                continue;
            }
            if let Some(p) = pocket_candidate(shape, i, end, r[i], r[j], limits, false) { found.push(p); }
        }
        found
    });
    // Opposing stretches can fold inside a broad, otherwise shallow bay.
    // Use their closest endpoint/projection, rather than moving either stretch.
    // Sides whose boxes lie more than the fold gap apart have no point pair
    // closer than it: skipped.
    let boxes: Vec<[f64; 4]> = (0..n).map(|i| { let (a, b) = (r[i], r[(i + 1) % n]);
        [a.x.min(b.x), a.y.min(b.y), a.x.max(b.x), a.y.max(b.y)] }).collect();
    let folds = super::par::map(&boxes, |i, _| {
        let mut found = Vec::new();
        for j in 0..r.len() {
            if i == j || (i + 1) % r.len() == j || (j + 1) % r.len() == i { continue; }
            let (p, q) = (boxes[i], boxes[j]);
            if (p[0] - q[2]).max(q[0] - p[2]).max(p[1] - q[3]).max(q[1] - p[3]) > limits.fold_gap { continue; }
            let (a, b) = (r[i], r[(i + 1) % r.len()]);
            let (c, d) = (r[j], r[(j + 1) % r.len()]);
            let candidates = [(a, g::distance(a, c, d).2), (b, g::distance(b, c, d).2),
                (g::distance(c, a, b).2, c), (g::distance(d, a, b).2, d)];
            for (a, b) in candidates {
                if dist(a, b) >= limits.fold_gap { continue; }
                if let Some(p) = pocket_candidate(shape, i, j, a, b, limits, true) { found.push(p); }
            }
        }
        found
    });
    corners_found.into_iter().chain(folds).flatten().collect()
}
/// HEAD's trace is unchanged except for a deep re-entrant bay or a narrow fold.
/// No resampling, global simplification, setback or minimum front length.
/// Each round repairs the shortest valid pocket: candidates are sorted by
/// length (stable, discovery order on ties) and only validated in that order,
/// up to the first that passes.
fn without_invaginations(shape: &Shape, surface: Surface<'_>) -> Shape {
    fill_pockets(shape, surface, PocketLimits::read(), f64::INFINITY)
}
/// Re-entrant bends (deeper than a sixth of their chord, chord under 400 m)
/// of a joined circuit are cut by straight runs: two circuits made one go
/// straight across where each used to turn in, never across water.
pub(super) fn straight_across(shape: &Shape, surface: Surface<'_>) -> Shape {
    let limits = PocketLimits { depth_span: 1.0 / 6.0, ..PocketLimits::read() };
    fill_pockets(shape, surface, limits, 400.0)
}
fn fill_pockets(shape: &Shape, surface: Surface<'_>, limits: PocketLimits, max_span: f64) -> Shape {
    if !g::simple(shape) { return shape.clone(); }
    let mut trace = shape.clone();
    // The dry test of a pocket, by its exact chord and chain: the cut piece is
    // the region between them (the bridge changes nothing else), so pockets a
    // repair leaves untouched are not cut and clipped again next round.
    let mut dry: std::collections::HashMap<Vec<u64>, bool> = Default::default();
    // A bridge refused because its new sides touch a side of the trace stays
    // refused while that side is on the trace: the same pocket between the
    // same neighbours makes the same new sides (keyed by chain and
    // neighbours), and a side that survives a repair is no neighbour of them.
    let mut crossed: std::collections::HashMap<Vec<u64>, [u64; 4]> = Default::default();
    loop {
        let mut repairs = candidates(&trace, limits);
        repairs.retain(|p| dist(p.a, p.b) <= max_span);
        repairs.sort_by(|a, b| a.length.total_cmp(&b.length));
        // The trace is simple (checked above, then kept by every repair).
        let base = sides(&trace.outer);
        let r = &trace.outer;
        let bits = |q: &Point| [q.x.to_bits(), q.y.to_bits()];
        let Some(next) = repairs.iter().filter_map(|p| {
            let chain = p.chain(r);
            let mut context: Vec<u64> = chain.iter().flat_map(bits).collect();
            context.extend(bits(&r[p.start]));
            context.extend(bits(&r[(p.end + 1) % r.len()]));
            if crossed.get(&context).is_some_and(|side| base.contains(side)) {
                return None;
            }
            let next = p.bridge(&trace);
            let o = &next.outer;
            let fresh: Vec<usize> = (0..o.len()).filter(|&i| !base.contains(&side_key(o[i], o[(i + 1) % o.len()]))).collect();
            match g::touching_side(o, &fresh) {
                Err(Some(j)) => {
                    crossed.insert(context, side_key(o[j], o[(j + 1) % o.len()]));
                    return None;
                }
                Err(None) => return None,
                Ok(()) => {}
            }
            (g::area(&next) > g::area(&trace)).then_some((chain, next))
        }).find_map(|(chain, next)| {
            let key: Vec<u64> = chain.iter().flat_map(bits).collect();
            // A pocket cut never creates an empty corner across a river.
            let ok = *dry.entry(key).or_insert_with(|| g::difference(&next, &trace).iter().all(|s|
                g::area(s) - area(&g::dry_clip(&surface, s)) < 1.0));
            ok.then_some(next)
        }) else { return trace; };
        trace = next;
    }
}

/// A dry bank component must contain founding quarters. If a smoothed circuit
/// reaches an empty far bank, return to the occupied bank; genuine occupied
/// crossings retain the original circuit and its water gates.
fn occupied_banks(shape: &Shape, occupied: &[Shape], surface: Surface<'_>) -> Vec<Shape> {
    use geo::{BooleanOps, MultiPolygon};
    let dry = g::dry_clip(&surface, shape);
    let supported = |s: &Shape| occupied.iter().any(|q| area(&g::intersection(s, q)) > 1.0);
    if !dry.iter().any(|s| g::area(s) > 1.0 && !supported(s)) { return vec![shape.clone()]; }
    let kept: Vec<_> = dry.iter().filter(|s| supported(s)).cloned().collect();
    if kept.len() < 2 { return kept; }
    // Keep genuine crossings between occupied banks even when a third bank
    // or island is empty. The closing only supplies water, never dry wedges.
    let land = MultiPolygon(kept.iter().map(g::polygon).collect());
    let closed = super::composition::closing(&land, 60.0);
    let mut water = vec![shape.clone()];
    for bank in &dry { water = water.iter().flat_map(|s| g::difference(s, bank)).collect(); }
    let links: Vec<_> = g::shapes(closed.difference(&land)).iter()
        .flat_map(|gap| water.iter().flat_map(move |wet| g::intersection(gap, wet))).collect();
    g::union(&kept.into_iter().chain(links).collect::<Vec<_>>())
}
pub(super) fn trace_enclosures(shapes: Vec<Shape>, occupied: &[Shape], surface: Surface<'_>) -> Vec<Shape> {
    let traced: Vec<_> = shapes.iter().flat_map(|s| occupied_banks(s, occupied, surface))
        .map(|s| without_invaginations(&s, surface)).collect();
    #[cfg(test)]
    TRACE_PAIRS.with(|pairs| {
        if let Some(pairs) = &mut *pairs.borrow_mut() { pairs.push((shapes, traced.clone())); }
    });
    traced
}
#[cfg(test)]
thread_local! {
    static TRACE_PAIRS: std::cell::RefCell<Option<Vec<(Vec<Shape>, Vec<Shape>)>>> = const { std::cell::RefCell::new(None) };
    static CONTOUR_PAIRS: std::cell::RefCell<Option<Vec<(Shape, Shape, usize)>>> = const { std::cell::RefCell::new(None) };
}

/// Urban simplification error is metric, independent of area and raster size.
/// The founding outline supplies the curves; no hull or minimum front length.
fn contour_trace(shape: &Shape, passes: usize, tolerance: f64, refine: bool) -> Shape {
    let mut ring = shape.outer.clone();
    for _ in 0..passes {
        let n = ring.len();
        ring = (0..n).flat_map(|i| {
            let (a, b) = (ring[i], ring[(i + 1) % n]);
            [pt(a.x * 0.75 + b.x * 0.25, a.y * 0.75 + b.y * 0.25),
                pt(a.x * 0.25 + b.x * 0.75, a.y * 0.25 + b.y * 0.75)]
        }).collect();
    }
    ring.push(ring[0]);
    let mut outer = g::simplify(&ring, tolerance, |_| false);
    outer.pop();
    if outer.len() < 3 {
        return shape.clone();
    }
    let mut trace = g::normalized(Shape {
        outer,
        holes: shape.holes.clone(),
    });
    let simple = |r: &[Point]| g::simple(&Shape { outer: r.to_vec(), holes: vec![] });
    let fallback = refine && !simple(&trace.outer) && simple(&shape.outer);
    if fallback {
        // Corner cutting can cross a thin neck. Keep its founding contour
        // and reduce simplification until that valid topology survives.
        let mut ring = shape.outer.clone();
        ring.push(ring[0]);
        let mut epsilon = tolerance;
        loop {
            let mut outer = g::simplify(&ring, epsilon, |_| false);
            outer.pop();
            trace = g::normalized(Shape { outer, holes: shape.holes.clone() });
            if trace.outer.len() >= 3 && simple(&trace.outer) { break; }
            epsilon *= 0.5;
            if epsilon < 0.01 { trace = shape.clone(); break; }
        }
    }
    #[cfg(test)]
    CONTOUR_PAIRS.with(|pairs| {
        if refine && let Some(pairs) = &mut *pairs.borrow_mut() { pairs.push((shape.clone(), trace.clone(), if fallback { 0 } else { passes })); }
    });
    trace
}
/// HEAD's two corner-cutting passes, with bounded simplification afterwards.
pub(super) fn curtain_trace(shape: &Shape) -> Shape {
    contour_trace(shape, 2, num(&data()["trace"], "maxDeviationM", 3.0).clamp(0.1, 5.0), true)
}
/// Hill towns keep their single, closer contour pass.
pub(super) fn hill_trace(shape: &Shape, _cell: f64) -> Shape {
    contour_trace(shape, 1, num(&data()["trace"], "maxDeviationM", 3.0).clamp(0.1, 5.0), true)
}
/// A small settlement fits its quarters to its founding circuit. Keep that
/// accepted nucleus grammar; the metric refinement is for urban circuits.
pub(super) fn village_trace(shape: &Shape, cell: f64, hill: bool) -> Shape {
    let tolerance = if hill { (g::area(shape).sqrt() * 0.01).clamp(1.5, 5.0).max(cell * 0.5) }
        else { (g::area(shape).sqrt() * 0.02).clamp(2.0, 10.0).max(cell * 0.75) };
    contour_trace(shape, if hill { 1 } else { 2 }, tolerance, false)
}
fn turn_at(ring: &[Point], i: usize) -> f64 {
    let n = ring.len();
    let (a, p, b) = (ring[(i + n - 1) % n], ring[i], ring[(i + 1) % n]);
    let (u, v) = (dir(a, p), dir(p, b));
    cross(u, v).atan2(dot(u, v)).abs()
}
/// Stations on each front between hard corners. Fine contour vertices must
/// not restart the spacing; relief/water stretch the local metre by `factor`.
fn flank_stations(path: &[Point], corners: &[bool], factors: &[f64], spacing: f64) -> Vec<(usize, f64)> {
    let n = path.len() - 1;
    let first = (0..n).find(|&i| corners[i]).unwrap_or(0);
    let lengths: Vec<_> = (0..n).map(|i| dist(path[i], path[i + 1]) / factors[i]).collect();
    let mut stations = vec![];
    let mut run = vec![];
    for k in 0..n {
        let i = (first + k) % n;
        run.push(i);
        if !corners[(i + 1) % n] && k + 1 < n { continue; }
        let total: f64 = run.iter().map(|&i| lengths[i]).sum();
        let count = (total / spacing).floor() as usize;
        let (mut segment, mut before) = (0, 0.0);
        for j in 1..=count {
            let at = j as f64 * total / (count + 1) as f64;
            while segment + 1 < run.len() && before + lengths[run[segment]] < at {
                before += lengths[run[segment]];
                segment += 1;
            }
            let i = run[segment];
            stations.push((i, ((at - before) / lengths[i].max(1e-12)).clamp(0.0, 1.0)));
        }
        run.clear();
    }
    stations
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
/// Box of `shape` in the frame turned by `angle`: its four corners and area.
fn framed_box(shape: &Shape, angle: f64) -> (Vec<Point>, f64) {
    let (u, v) = ((angle.cos(), angle.sin()), (-angle.sin(), angle.cos()));
    let (mut a0, mut a1, mut b0, mut b1) = (f64::INFINITY, f64::NEG_INFINITY, f64::INFINITY, f64::NEG_INFINITY);
    for p in &shape.outer {
        let (a, b) = (p.x * u.0 + p.y * u.1, p.x * v.0 + p.y * v.1);
        (a0, a1, b0, b1) = (a0.min(a), a1.max(a), b0.min(b), b1.max(b));
    }
    let at = |a: f64, b: f64| pt(a * u.0 + b * v.0, a * u.1 + b * v.1);
    (vec![at(a0, b0), at(a1, b0), at(a1, b1), at(a0, b1)], (a1 - a0).max(0.0) * (b1 - b0).max(0.0))
}
/// Square trace of a planned (Chinese) city: the rectangle around the founding
/// outline in the axes of its street grid (`grid`, the macro plan's frame), else
/// on the compass (`cardinal`) or the outline's tightest box; kept when it
/// encloses at most 1.5 times the founding land and stays out of the water
/// (`off_water`).
pub(super) fn square_trace(shape: &Shape, surface: Surface<'_>, cardinal: bool, force: bool, grid: Option<f64>) -> Option<Shape> {
    use geo::MinimumRotatedRect;
    let plain = Shape {
        outer: shape.outer.clone(),
        holes: vec![],
    };
    // The wall runs on the axes of the grid it encloses: a wall turned against
    // its street plan leaves empty wedges along every front. The grid's box is
    // taken while it stays nearly as tight as the outline's tightest box; else a
    // cardinal culture keeps the compass while its box stays nearly as tight, and
    // any other plan its tightest box.
    let turned = g::polygon(&plain).minimum_rotated_rect()?;
    let tight = g::area(&g::shapes(geo::MultiPolygon(vec![turned.clone()]))[0]);
    let gridded = grid.map(|a| framed_box(&plain, a)).filter(|b| b.1 <= 1.15 * tight);
    let (x0, y0, x1, y1) = g::bbox(&plain);
    let c: Vec<Point> = if let Some((c, _)) = gridded {
        c
    } else if cardinal && (x1 - x0) * (y1 - y0) <= 1.15 * tight {
        vec![pt(x0, y0), pt(x1, y0), pt(x1, y1), pt(x0, y1)]
    } else {
        turned.exterior().0.iter().take(4).map(|p| pt(p.x, p.y)).collect()
    };
    if c.len() < 4 { return None; }
    // 2 m of clearance along the rectangle's own axes, corners kept square.
    let (u, v) = (unit(dir(c[0], c[1])), unit(dir(c[0], c[3])));
    let grow = |p: Point, su: f64, sv: f64| add(add(p, u, 2.0 * su), v, 2.0 * sv);
    let rect = g::normalized(Shape {
        outer: vec![grow(c[0], -1.0, -1.0), grow(c[1], 1.0, -1.0), grow(c[2], 1.0, 1.0), grow(c[3], -1.0, 1.0)],
        holes: vec![],
    });
    // `force` (plannedWall: rect) keeps the plan's rectangle even where it walls
    // empty land; water corners are still given back below.
    if !force && g::area(&rect) > 1.5 * g::area(&plain) {
        return None;
    }
    // Only the water the corners reach is given back: the front then follows the
    // bank there. Against the bare outline the 2 m clearance joins every corner
    // into one ring, and returning that wet ring returned the whole rectangle.
    let corners = buffer(&plain, 3.0).first().map_or(vec![], |near| g::difference(&rect, near));
    let wet: Vec<Shape> = corners.iter().flat_map(|b| {
        let dry = g::dry_clip(&surface, b);
        dry.iter().fold(vec![b.clone()], |left, d| left.iter().flat_map(|l| g::difference(l, d)).collect())
    }).filter(|w| g::area(w) > 200.0).collect();
    let trace = if wet.is_empty() { rect } else {
        let kept = Cut::new(wet).from(vec![rect]);
        let best = kept.into_iter().max_by(|x, y| g::area(x).total_cmp(&g::area(y)))?;
        let mut ring = g::simplify(&closed(&best.outer), 2.0, |_| false);
        ring.pop();
        g::normalized(Shape { outer: ring, holes: vec![] })
    };
    // `off_water`'s final checks: a simple ring crossing hardly more water than
    // the town (a straight front crosses a river at a slant: water gates).
    let (wt, wb) = (wet_length(&trace.outer, surface), wet_length(&plain.outer, surface));
    // A forced plan rectangle keeps its river crossings (water gates).
    (trace.outer.len() >= 3 && g::simple(&trace) && (force || wt <= wb * 1.25 + 20.0)).then_some(trace)
}
fn closed(ring: &[Point]) -> Vec<Point> {
    ring.iter().copied().chain(ring.first().copied()).collect()
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
        let mut seen = Vec::new();
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
        seen.sort_unstable();
        seen.dedup();
        seen
    }
    /// Distance from segment ab to the curtain (0 when it crosses it), or
    /// infinity beyond `cell`.
    pub(super) fn distance(&self, a: Point, b: Point) -> f64 {
        let mut best = f64::INFINITY;
        let k = (dist(a, b) / self.cell).ceil().max(1.0) as usize;
        let mut seen: Vec<usize> = Vec::new();
        for j in 0..=k {
            let t = j as f64 / k as f64;
            let (cx, cy) = (
                ((a.x + (b.x - a.x) * t) / self.cell).floor() as i64,
                ((a.y + (b.y - a.y) * t) / self.cell).floor() as i64,
            );
            for dx in -1..=1 {
                for dy in -1..=1 {
                    for &s in self.cells.get(&(cx + dx, cy + dy)).into_iter().flatten() {
                        if seen.contains(&s) {
                            continue;
                        }
                        seen.push(s);
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
/// Street centre segments within `reach` of the curtain (wall-lanes aside).
fn street_segments(path: &[Point], streets: &[Street], reach: f64) -> Vec<(Point, Point)> {
    let near = Near::new(path, reach);
    streets
        .iter()
        .filter(|s| s.role != "wall-lane")
        .flat_map(|s| s.path.windows(2).map(|w| (w[0], w[1])))
        .filter(|&(a, b)| near.distance(a, b).is_finite())
        .collect()
}
/// A berm, ditch or glacis piece that a street separates from the curtain:
/// the way from inside it to the nearest curtain point crosses a street centre
/// line. The fortification stops at that street (a street running along the
/// ditch has filled it); the land beyond belongs to the town, so no sliver of
/// ditch is left on the town side of the street to bite into its lots.
fn severed(piece: &Shape, path: &[Point], streets: &[(Point, Point)]) -> bool {
    let p = g::interior_point(piece);
    let Some((_, _, c)) = path
        .windows(2)
        .map(|w| g::distance(p, w[0], w[1]))
        .min_by(|a, b| a.0.total_cmp(&b.0))
    else {
        return false;
    };
    streets
        .iter()
        .any(|&(a, b)| g::segment_hit(p, c, a, b).is_some())
}
/// Depths (m) beyond a moat's outer edge at which the town is looked for.
const EMBED_DEPTHS: [f64; 4] = [10.0, 30.0, 60.0, 100.0];
/// A moat with built blocks beyond it at every depth on three quarters of its
/// outer edge lies inside the town (an older circuit, a curtain in a river
/// loop the faubourg has grown round), not outside the curtain it guards.
fn embedded(piece: &Shape, path: &[Point], built: &[(Box2, &Shape)]) -> bool {
    let ring = &piece.outer;
    let n = ring.len();
    let mut samples = vec![];
    for i in 0..n {
        let (a, b) = (ring[i], ring[(i + 1) % n]);
        let k = (dist(a, b) / 4.0).ceil().max(1.0) as usize;
        samples.extend((0..k).map(|j| add(a, dir(a, b), dist(a, b) * j as f64 / k as f64)));
    }
    let near: Vec<(Point, f64, Point)> = samples.iter().filter_map(|&p| {
        let (d, _, c) = path.windows(2).map(|w| g::distance(p, w[0], w[1])).min_by(|x, y| x.0.total_cmp(&y.0))?;
        Some((p, d, c))
    }).collect();
    let (lo, hi) = near.iter().fold((f64::MAX, 0.0_f64), |(l, h), x| (l.min(x.1), h.max(x.1)));
    // The outer half of the piece: its edge away from the curtain.
    let outer: Vec<_> = near.into_iter().filter(|x| x.1 >= 0.5 * (lo + hi) && x.1 > 1e-6).collect();
    if outer.len() < 4 { return false; }
    let inside = |q: Point| built.iter().any(|(b, s)| q.x >= b.0 && q.x <= b.2 && q.y >= b.1 && q.y <= b.3 && g::contains(s, q));
    let hits: usize = outer.iter().map(|&(p, d, c)| {
        let u = ((p.x - c.x) / d, (p.y - c.y) / d);
        EMBED_DEPTHS.iter().filter(|&&k| inside(add(p, u, k))).count()
    }).sum();
    hits as f64 >= 0.75 * (outer.len() * EMBED_DEPTHS.len()) as f64
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
    if style.timber_culture && style.material == "timber-earth" { e.kind = style.kind.clone(); }
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
    // Moat and berm scale with the settlement: a village digs a few metres,
    // a 10 000-inhabitant town the full width of its style.
    let size = (f64::from(pop) / 10_000.0).sqrt().clamp(0.3, 1.0);
    let dw = dr.range(
        style.ditch_width[0],
        style.ditch_width[1].max(style.ditch_width[0]),
    );
    let dw = if dw > 0.0 { (dw * size).max(3.0_f64.min(dw)) } else { dw };
    let reach =
        face + style.berm + dw + 25.0 + style.court_radius[1].max(style.outer_gap[1] + 16.0) + 45.0;
    let clear = Cut::new(street_clear(&path, streets, reach, predicted));
    let street_lines = street_segments(&path, streets, reach);
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
    // Arc length along the curtain, for passages and the runs between them.
    let cum: Vec<f64> = std::iter::once(0.0).chain((0..n_seg).scan(0.0, |acc, i| { *acc += dist(path[i], path[i + 1]); Some(*acc) })).collect();
    let total = cum[n_seg].max(1e-9);
    let arc = |p: Point| { let k = seg_of(p); cum[k] + dist(path[k], p).min(dist(path[k], path[k + 1])) };
    let along = |s: f64| {
        let s = s.rem_euclid(total);
        let k = (0..n_seg).find(|&k| cum[k + 1] >= s).unwrap_or(n_seg - 1);
        (add(path[k], dir(path[k], path[k + 1]), s - cum[k]), k)
    };
    // Water runs that the curtain leaves only briefly (a spit, under 40 m) or
    // along a dry run that just hugs the shore with nothing built behind it
    // open as one passage: no stub of wall, tower or moat between them.
    let hugs = |q: Point, k: usize| [3.0, 6.0, 10.0].iter().any(|&d| surface.wet(add(q, ns[k], d)));
    // A cave circuit keeps every rock contact: its short barriers between the rock are the curtain.
    let merged: Vec<(Point, bool)> = if style.cave { banks.to_vec() } else {
        let mut b: Vec<(Point, bool)> = banks.to_vec();
        // At a bank, the passage starts where the curtain stops
        // hugging the shore, when that run is short or has nothing behind it.
        let m = b.len();
        if m >= 2 {
            let arcs: Vec<f64> = b.iter().map(|x| arc(x.0)).collect();
            // Dry run length on each bank's land side, and how far it hugs.
            let side = |k: usize| if b[k].1 { (arcs[k] - arcs[(k + m - 1) % m]).rem_euclid(total) } else { (arcs[(k + 1) % m] - arcs[k]).rem_euclid(total) };
            let walk: Vec<f64> = (0..m).map(|k| {
                let sign = if b[k].1 { -1.0 } else { 1.0 };
                let (mut h, mut open) = (0.0, true);
                while h + 4.0 < side(k).min(200.0) {
                    let (q, j) = along(arcs[k] + sign * (h + 4.0));
                    if !hugs(q, j) || surface.wet(q) { break; }
                    open &= !street_lines.iter().any(|&(u, v)| g::distance(q, u, v).0 < 25.0);
                    h += 4.0;
                }
                if h >= 4.0 && (h < 40.0 || open) { h } else { 0.0 }
            }).collect();
            // A jog: past its last corner the curtain turns (over ~60°) and
            // runs on along the water, ending under 40 m from that corner. It
            // guards nothing; the curtain ends at the corner.
            let shore_near = |q: Point| (0..8).any(|a| {
                let t = f64::from(a) * std::f64::consts::FRAC_PI_4;
                [3.0, 6.0, 10.0].iter().any(|&d| surface.wet(add(q, (t.cos(), t.sin()), d)))
            });
            let walk: Vec<f64> = (0..m).map(|k| {
                let back = |s: f64| if b[k].1 { arcs[k] - s } else { arcs[k] + s };
                // The farthest such corner on the land side, the whole run by the water.
                let corner = (0..n_seg).filter_map(|v| {
                    let d = if b[k].1 { (arcs[k] - cum[v]).rem_euclid(total) } else { (cum[v] - arcs[k]).rem_euclid(total) };
                    if !(4.0..80.0).contains(&d) || dist(path[v], b[k].0) >= 40.0 || d >= side(k) - 4.0
                        || turn_at(&ring, v) <= 1.05 { return None; }
                    let steps = (d / 4.0).ceil() as usize;
                    (0..=steps).all(|i| shore_near(along(back(d * i as f64 / steps as f64)).0)).then_some(d)
                }).fold(0.0, f64::max);
                walk[k].max(corner)
            }).collect();
            // A run hugged from both ends is one passage: its two banks go.
            let mut gone = vec![false; m];
            for k in (0..m).filter(|&k| !b[k].1) {
                let j = (k + 1) % m;
                if b[j].1 && walk[k] + walk[j] >= side(k) - 4.0 { gone[k] = true; gone[j] = true; }
            }
            let moved: Vec<(Point, bool)> = (0..m).filter(|&k| !gone[k]).map(|k| {
                (if walk[k] > 0.0 { along(arcs[k] + if b[k].1 { -walk[k] } else { walk[k] }).0 } else { b[k].0 }, b[k].1)
            }).collect();
            if moved.iter().any(|x| x.1) && moved.iter().any(|x| !x.1) { b = moved; }
        }
        loop {
            let m = b.len();
            if m < 4 { break; }
            let cut = (0..m).find(|&k| {
                let (x, y) = (b[k], b[(k + 1) % m]);
                if x.1 || !y.1 { return false; }
                let (s0, len) = (arc(x.0), (arc(y.0) - arc(x.0)).rem_euclid(total));
                if len < 40.0 { return true; }
                let n = (len / 4.0).ceil() as usize;
                (0..=n).all(|i| {
                    let (q, k) = along(s0 + len * i as f64 / n as f64);
                    hugs(q, k)
                        && !street_lines.iter().any(|&(u, v)| g::distance(q, u, v).0 < 25.0)
                })
            });
            let Some(k) = cut else { break; };
            let j = (k + 1) % m;
            b = b.into_iter().enumerate().filter(|&(i, _)| i != k && i != j).map(|(_, v)| v).collect();
        }
        b
    };
    // A moved or merged passage end is a gate point of the curtain.
    for &(p, _) in &merged { if e.gates.iter().all(|&q| dist(q, p) >= 8.0) { e.gates.push(p); } }
    let banks: &[(Point, bool)] = &merged;
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
            // Below the gatehouse population a main road still passes a built
            // gate (the minor one), never a bare gap in the curtain.
            if gate_params(&style.gate_minor, c).is_some() { style.gate_minor.as_str() } else { "opening" }
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
    if !banks.is_empty() {
        for (a, b) in water_passages(banks) {
            let shore = {
                let (first, last) = (seg_of(a), seg_of(b));
                let (mut wet, mut river, mut transverse, mut samples) = (false, true, 0, 0);
                for offset in 0..n_seg {
                    let i = (first+offset)%n_seg;
                    let p = if offset == 0 { a } else { path[i] };
                    let q = if i == last { b } else { path[i+1] };
                    let steps = (dist(p,q)/4.0).ceil().max(1.0) as usize;
                    for k in 0..=steps {
                        let at = pt(p.x+(q.x-p.x)*k as f64/steps as f64,p.y+(q.y-p.y)*k as f64/steps as f64);
                        if surface.wet(at) {
                            wet = true; river &= super::macroplan::harbour::water_code(surface,at) == 3;
                            let t = dir(p,q); let normal = (t.1,-t.0);
                            let probe = (surface.width / surface.n.max(1) as f64 * 1.5).max(8.0);
                            samples += 1;
                            if surface.wet(add(at,normal,probe)) && surface.wet(add(at,normal,-probe)) { transverse += 1; }
                        }
                    }
                    if i == last { break; }
                }
                // A stream narrower than the 4 m sampling stays a water gate.
                wet && !(river && transverse * 2 >= samples)
            };
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
                // Abutment and tower stay on this curtain segment, never
                // past its end on the tangent (a lone tower on a spit).
                let avail = if sign > 0.0 { dist(bank, path[sk + 1]) } else { dist(bank, path[sk]) };
                // The first dry offset back from the bank: a curtain meeting
                // the water obliquely needs a few metres more.
                let Some(back) = [1.0, 3.0, 6.0, 10.0, 15.0, 22.0, 30.0, 40.0]
                    .into_iter()
                    .find(|&b| {
                        b + 5.0 <= avail && dry_points(&quad(
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
                    if let Some(tw) = [1.5, 4.0, 8.0].into_iter().filter(|&b| back + 2.0 * r + b <= avail).find_map(|b| {
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
                kind: if shore { "shore" } else { "water" }.into(),
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
        let corners: Vec<_> = (0..n_seg).map(|i|
            turn_at(&path[..n_seg], i).to_degrees() > style.corner_turn.unwrap_or(35.0)).collect();
        let factors: Vec<_> = (0..n_seg).map(|i| if !style.medieval && (steep[i] || wet[i]) { 1.5 } else { 1.0 }).collect();
        for (i, fraction) in flank_stations(&path, &corners, &factors, spacing) {
            let (a, b) = (path[i], path[i + 1]);
            let s = spacing * factors[i];
            let (t, n) = (dir(a, b), ns[i]);
            let p = add(a, t, fraction * dist(a, b));
            if near_gate(p, r) || near_tower(p, &towers, s * 0.5) {
                continue;
            }
            if let Some(tw) = tower_at(p, t, n, &style.flank_shape, r,
                style.flank_depth, "flank", tower_height) && free(&occupied, &tw.footprint)
            {
                occupied.add(tw.footprint.clone());
                towers.push(tw);
            }
        }
    }
    // --- outworks
    let has = |w: &str| style.outworks.iter().any(|x| x == w);
    let major_land: Vec<usize> = (0..land).filter(|&i| infos[i].major).collect();
    // Outer face of everything the ditch surrounds.
    // The ditch runs around every projecting work: towers, gatehouses,
    // bastions (and below the outer wall, courts and barbicans).
    // Nothing of the curtain stands inside a shore passage: no tower there.
    let shore_gaps: Vec<(f64, f64)> = gatehouses.iter().filter(|gh| gh.kind == "shore")
        .map(|gh| (arc(gh.passage[0]), (arc(gh.passage[1]) - arc(gh.passage[0])).rem_euclid(total))).collect();
    let in_gap = |p: Point| { let s = arc(p); shore_gaps.iter().any(|&(a, l)| { let d = (s - a).rem_euclid(total); d > 1.0 && d < l - 1.0 }) };
    towers.retain(|t| !in_gap(t.anchor));
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
            let strip = {
                let near = Near::new(&closed(&o.outer), 16.0);
                let mut cuts = vec![];
                for s in streets {
                    let half = s.widths.iter().copied().fold(3.0, f64::max) * 0.5 + 0.5;
                    for w in s.path.windows(2) {
                        // A street running inside the band: the wall never stands on it.
                        if near.distance(w[0], w[1]) <= style.outer_width + half && dist(w[0], w[1]) > 0.1 {
                            let u = dir(w[0], w[1]);
                            cuts.push(quad(w[0],u,(u.1,-u.0),[-half,dist(w[0],w[1])+half],[-half,half]));
                        }
                        for i in near.crossed(w[0], w[1]) {
                            let a = o.outer[i % o.outer.len()]; let b = o.outer[(i+1) % o.outer.len()];
                            if let Some((_, p)) = g::segment_hit(w[0], w[1], a, b) {
                                let t = dir(a,b); let u = dir(w[0],w[1]);
                                let sin = (t.0*u.1-t.1*u.0).abs();
                                if sin > 0.3 { cuts.push(quad(p,t,(t.1,-t.0),[-half/sin,half/sin],[-style.outer_width-1.0,style.outer_width+1.0])); }
                                else {
                                    // A grazing street: open the wall along the street's own ribbon.
                                    let reach = (style.outer_width+1.0)/sin.max(0.05)+half;
                                    cuts.push(quad(p,u,(u.1,-u.0),[-reach.min(dist(w[0],p)),reach.min(dist(p,w[1]))],[-half,half]));
                                }
                            }
                        }
                    }
                }
                g::union(&Cut::new(cuts).from(tiles(strip,TILE)))
            };
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
    // --- ditch: decided once per circuit; a wet ditch where water is near
    // and the ground is level, otherwise dry with the style's probability.
    // Decided before the faubourg fronts: a moated circuit keeps its moat
    // whole and has no lean-to outside (rule: the moat wins over the houses).
    let berm = style.berm * size;
    let ditch_kind = match style.ditch.as_str() {
        "none" => None,
        _ if style.ditch_wetness.is_some() => Some("dry"),
        "wet" => Some("wet"),
        "dry" => dr.chance(style.ditch_p).then_some("dry"),
        _ if style.dry_ditches => Some("dry"),
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
    // Underdark: no water moat in a cave (a culture's dry ditch stays, across the passages).
    let ditch_kind = if style.cave && ditch_kind == Some("wet") { None } else { ditch_kind };
    // Depth of the ditch (3D moat): the style's, else from its width.
    let depth = if style.ditch_depth > 0.0 { style.ditch_depth } else { (dw * 0.35).clamp(1.5, 4.0) };
    // --- faubourg gate fronts: lean-tos against the outer face beside the
    // major gates, each row with the lane that serves it (a dead end off the
    // gate street, round the gate structures), only on a circuit without a
    // moat, so a lean-to is never in a ditch, a glacis or a gate passage. No front
    // on steep or water-side runs, nor where a glacis or ravelins hold the
    // approaches (no-build zone).
    let mut attached: Vec<Attached> = vec![];
    let mut lanes: Vec<Street> = vec![];
    let mut fronts: Vec<Shape> = vec![];
    if style.attached > 0.0 && ditch_kind.is_none() && !has("glacis") && !has("ravelin") {
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
    // --- ditch pieces (kind decided above).
    let mut ditch: Vec<Work> = vec![];
    let mut glacis: Vec<Shape> = vec![];
    let moat_core = g::union(&moat_core);
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
    // A run's no-ditch zone stops square at its ends: the ditch of the next,
    // dry and level run goes on round the corner up to the water or the
    // slope instead of stopping tens of metres short of it.
    let no_ditch = Cut::new(
        (0..n_seg)
            .filter(|&i| steep[i])
            .map(|i| {
                let (a, b) = (path[i], path[i + 1]);
                let t = dir(a, b);
                let wd = face + berm + dw + 30.0;
                quad(a, t, ns[i], [0.0, dist(a, b)], [-wd, wd])
            })
            .chain(fronts)
            // A shore passage keeps no moat along its open run either.
            .chain(shore_gaps.iter().flat_map(|&(a, l)| {
                let n = (l / 8.0).ceil().max(1.0) as usize;
                (0..n).map(move |i| (a + l * i as f64 / n as f64, a + l * (i + 1) as f64 / n as f64)).collect::<Vec<_>>()
            }).map(|(s0, s1)| {
                let (p0, k) = along(s0); let (p1, _) = along(s1); let t = dir(p0, p1);
                let wd = face + berm + dw + 30.0;
                quad(p0, t, ns[k], [0.0, dist(p0, p1)], [-wd, wd])
            }))
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
        extra_reserve.extend(
            clear
                .from(no_ditch.from(tiles(berm_land, TILE)))
                .into_iter()
                .filter(|s| !severed(s, &path, &street_lines)),
        );
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
        // Test separation locally: one access road cannot discard a whole
        // connected moat because its representative point lies beyond it.
        let band = clear.from(no_ditch.from(inner_core.from(band)));
        let band = tiles(band, 24.0).into_iter()
            .filter(|d| !severed(d, &path, &street_lines)).collect::<Vec<_>>();
        let band = g::union(&band);
        let band = if style.ditch_wetness.is_some() || (style.dry_ditches && style.ditch == "auto") { tiles(band, 24.0) } else { band };
        // A moat hook left round the tip of a stretch inside a shore passage
        // guards no curtain: it goes with the stretch.
        let off_gap = |d: &Shape| { let s = arc(g::interior_point(d));
            !shore_gaps.iter().any(|&(a, l)| { let t = (s - a).rem_euclid(total); t > 8.0 && t < l - 8.0 }) };
        // A circuit crossing a river to wall a small salient of the far bank
        // (under a quarter of its largest dry land) digs no moat there: the
        // river is its ditch, and a stub of ditch among the houses is a relic.
        let lands = g::dry_clip(&surface, &poly);
        let big = lands.iter().map(|l| g::area(l)).fold(0.0_f64, f64::max);
        let salients: Vec<&Shape> = if lands.len() > 1 { lands.iter().filter(|l| g::area(l) < 0.25 * big).collect() } else { vec![] };
        let near_ring = |c: Point, s: &Shape| {
            let n = s.outer.len();
            (0..n).any(|i| g::distance(c, s.outer[i], s.outer[(i + 1) % n]).0 < 3.0)
        };
        let far_bank = |d: &Shape| {
            if salients.is_empty() { return false; }
            let p = g::interior_point(d);
            let Some((_, _, c)) = path.windows(2).map(|w| g::distance(p, w[0], w[1]))
                .min_by(|x, y| x.0.total_cmp(&y.0)) else { return false };
            salients.iter().any(|s| near_ring(c, s)) && !lands.iter().filter(|l| g::area(l) >= 0.25 * big).any(|l| near_ring(c, l))
        };
        ditch.extend(super::par::map(&band, |_, p| {
            g::dry_clip(&surface, p).into_iter()
                .filter(|d| g::area(d) > 20.0 && off_gap(d) && !far_bank(d))
                .map(|shape| Work {
                    kind: if let Some(wetness) = style.ditch_wetness {
                        parameters::ditch_kind(&shape, surface, rng, wetness).into()
                    } else if style.dry_ditches && style.ditch == "auto" {
                        options::ditch_kind(&shape, surface, rng).into()
                    } else { kind.into() },
                    shape,
                    height_m: depth,
                    passage: None,
                })
                .collect::<Vec<_>>()
        }).into_iter().flatten());
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
                        .filter(|d| g::area(d) > 20.0 && !severed(d, &path, &street_lines)),
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
                                height_m: depth,
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
    // Rule: the moat is a ring or nothing (no stubs between cuts).
    let ditch = continuous_moat(ditch, &path, surface);
    // Same bounded mitres as the drawn curtain, with a quantisation margin.
    // Rounded buffers leave buildable wedges under its corners.
    let body = curtain_body(&path,c,h);
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

/// Invariant (a street stops at the wall face): a street end that no other
/// street meets (a dead end) on the curtain body or in the reserve (berm,
/// ditch, glacis, a tower's foot) is cut back to where the street leaves
/// them. Only a street through a gate crosses the curtain, so no dead end
/// carves a slot into the wall or the ditch; a lane ending beside an outer
/// lean-to serves it and keeps its end, and a street that crosses the curtain
/// before ending in the outer reserve is a gate street (its causeway): it is
/// never cut back through the wall, which would close its gate. The corridor
/// freed on the curtain body returns to the reserve.
fn stop_at_curtains(streets: &mut Vec<Street>, enclosures: &mut [Enclosure]) {
    struct Zone {
        near: Near,
        half: f64,
        reserve: Vec<(Shape, Box2)>,
        lean: Vec<Shape>,
        body: Vec<Shape>,
        ring: Shape,
    }
    let zones: Vec<Option<Zone>> = enclosures
        .iter()
        .map(|e| {
            (!e.style.is_empty() && e.path.len() >= 4).then(|| {
                let half = ribbon_half(&e.kind);
                Zone {
                    near: Near::new(&e.path, 8.0),
                    half,
                    reserve: e.reserve.iter().map(|s| (s.clone(), g::bbox(s))).collect(),
                    lean: e
                        .attached
                        .iter()
                        .filter(|a| a.side == "out")
                        .map(|a| a.shape.clone())
                        .collect(),
                    body: g::ribbon(&e.path, &[2.0 * half]),
                    ring: g::normalized(Shape {
                        outer: e.path[..e.path.len() - 1].to_vec(),
                        holes: vec![],
                    }),
                }
            })
        })
        .collect();
    let inside = |z: &Zone, p: Point| {
        z.near.distance(p, p) < z.half - 1e-6
            || z.reserve.iter().any(|(s, b)| {
                p.x >= b.0 && p.x <= b.2 && p.y >= b.1 && p.y <= b.3 && g::contains(s, p)
            })
    };
    let key = |p: Point| ((p.x * 100.0).round() as i64, (p.y * 100.0).round() as i64);
    let mut degree: std::collections::HashMap<(i64, i64), usize> = Default::default();
    for s in streets.iter() {
        for &p in &s.path {
            *degree.entry(key(p)).or_default() += 1;
        }
    }
    let mut freed: Vec<(usize, Vec<Point>, Vec<f64>)> = vec![];
    let mut gone = vec![false; streets.len()];
    for (i, s) in streets.iter_mut().enumerate() {
        if matches!(
            s.role.as_str(),
            "wall-lane" | "bridge" | "ford" | "causeway" | "quay" | "pier" | "boardwalk" | "landing" | "mole"
        ) || s.path.len() < 2
        {
            continue;
        }
        if s.widths.len() != s.path.len() {
            let last = s.widths.last().copied().unwrap_or(4.0);
            s.widths.resize(s.path.len(), last);
        }
        for end in [true, false] {
            if gone[i] {
                break;
            }
            let p = if end {
                *s.path.last().unwrap()
            } else {
                s.path[0]
            };
            let hw = s.widths[if end { s.path.len() - 1 } else { 0 }] * 0.5;
            let Some(z) = zones
                .iter()
                .position(|z| z.as_ref().is_some_and(|z| inside(z, p)))
            else {
                continue;
            };
            let zone = zones[z].as_ref().unwrap();
            if degree.get(&key(p)).copied().unwrap_or(0) != 1
                || zone.lean.iter().any(|l| {
                    g::contains(l, p)
                        || (0..l.outer.len()).any(|k| {
                            let (a, b) = (l.outer[k], l.outer[(k + 1) % l.outer.len()]);
                            g::distance(p, a, b).0 < hw + 2.0
                        })
                })
            {
                continue;
            }
            if !end {
                s.path.reverse();
                s.widths.reverse();
            }
            // Walk back from the end, every 0.25 m, to the first point out.
            let n = s.path.len();
            let mut cut = None;
            'walk: for k in (0..n - 1).rev() {
                let (a, b) = (s.path[k], s.path[k + 1]);
                let steps = (dist(a, b) / 0.25).ceil().max(1.0) as usize;
                for j in 1..=steps {
                    let t = 1.0 - j as f64 / steps as f64;
                    let q = pt(a.x + (b.x - a.x) * t, a.y + (b.y - a.y) * t);
                    if !inside(zone, q) {
                        let w = s.widths[k] + (s.widths[k + 1] - s.widths[k]) * t;
                        cut = Some((k, q, w));
                        break 'walk;
                    }
                }
            }
            // A street through the curtain ending in the outer reserve
            // passes a gate (the causeway over the ditch): it keeps its gate.
            if let Some((_, q, _)) = cut
                && zone.near.distance(p, p) >= zone.half
                && g::contains(&zone.ring, q) != g::contains(&zone.ring, p)
            {
                if !end {
                    s.path.reverse();
                    s.widths.reverse();
                }
                continue;
            }
            match cut {
                Some((k, q, w)) => {
                    let mut out = vec![q];
                    out.extend_from_slice(&s.path[k + 1..]);
                    let mut ws = vec![w];
                    ws.extend_from_slice(&s.widths[k + 1..]);
                    freed.push((z, out, ws));
                    s.path.truncate(k + 1);
                    s.widths.truncate(k + 1);
                    if dist(*s.path.last().unwrap(), q) > 1e-3 {
                        s.path.push(q);
                        s.widths.push(w);
                    }
                    if s.path.len() < 2 {
                        gone[i] = true;
                    }
                }
                None => {
                    freed.push((z, s.path.clone(), s.widths.clone()));
                    gone[i] = true;
                }
            }
            if !end {
                s.path.reverse();
                s.widths.reverse();
            }
        }
    }
    let mut k = 0;
    streets.retain(|_| {
        k += 1;
        !gone[k - 1]
    });
    for (z, path, widths) in freed {
        let body = &zones[z].as_ref().unwrap().body;
        let ws: Vec<f64> = widths.iter().map(|w| w + 1.0).collect();
        let back: Vec<Shape> = g::ribbon(&path, &ws)
            .iter()
            .flat_map(|r| body.iter().flat_map(|b| g::intersection(r, b)))
            .filter(|s| g::area(s) > 0.5)
            .collect();
        enclosures[z].reserve.extend(back);
    }
}

/// Shortest moat run kept (m along the curtain, half the piece's perimeter):
/// a shorter piece left between two causeways, a street or a slope is a relic
/// stub, not a moat.
const MIN_MOAT_RUN: f64 = 30.0;
/// A circuit whose moat runs cover less than this share of its dry curtain
/// digs none: a moat is a ring, or nothing, never a few scattered pieces.
const MIN_MOAT_SHARE: f64 = 0.35;
/// Invariant (a moat is continuous or absent): pieces shorter than
/// `MIN_MOAT_RUN` go, and the whole moat goes when what is left covers less
/// than `MIN_MOAT_SHARE` of the dry length of the curtain.
fn continuous_moat(ditch: Vec<Work>, path: &[Point], surface: Surface<'_>) -> Vec<Work> {
    if ditch.is_empty() {
        return ditch;
    }
    let run = |s: &Shape| {
        let n = s.outer.len();
        (0..n).map(|i| dist(s.outer[i], s.outer[(i + 1) % n])).sum::<f64>() * 0.5
    };
    // Runs are measured on the joined moat (tiles of one run count together).
    let parts = g::union(&ditch.iter().map(|d| d.shape.clone()).collect::<Vec<_>>());
    let runs: Vec<f64> = parts.iter().map(|s| run(s)).collect();
    let kept: Vec<Work> = ditch
        .into_iter()
        .filter(|d| {
            let p = g::interior_point(&d.shape);
            parts.iter().zip(&runs).any(|(s, &r)| r >= MIN_MOAT_RUN && g::contains(s, p))
        })
        .collect();
    let dry: f64 = path
        .windows(2)
        .map(|w| {
            let l = dist(w[0], w[1]);
            let k = (l / 8.0).ceil().max(1.0) as usize;
            let wet = (0..k)
                .filter(|&j| surface.wet(add(w[0], dir(w[0], w[1]), l * (j as f64 + 0.5) / k as f64)))
                .count();
            l * (1.0 - wet as f64 / k as f64)
        })
        .sum();
    let covered: f64 = runs.iter().filter(|&&r| r >= MIN_MOAT_RUN).sum();
    if covered < MIN_MOAT_SHARE * dry { vec![] } else { kept }
}

/// A crossing within this distance (m) of a gate or of a water passage is that gate's street.
const GATE_REACH: f64 = 8.0;
/// Invariant (every crossing of a curtain is a gate): a street that crosses a
/// curtain away from its gates and its water passages opens no bare gap in the
/// wall: it is split there, each side ending clear of the curtain body
/// (`stop_at_curtains` then pulls the ends out of the berm and the moat). The
/// quarter on each side keeps its own streets; the town is entered through the
/// gates. Decks and waterside ways pass (`gate_budget::water_way`). With
/// `main_too` every other street is held to it; without, only the lesser ones
/// (`gate_budget::priority` under 2) and every bridge ramp: a main road laid
/// after the gates were decided keeps its crossing, and `reconcile_gates` opens
/// its gate.
///
/// A cut ramp keeps its approach role only on the piece that meets its bridge.
fn close_crossings(streets: &mut Vec<Street>, enclosures: &[Enclosure], main_too: bool, surface: Surface<'_>) {
    let passages: Vec<_> = enclosures.iter().flat_map(|e| &e.gatehouses)
        .filter(|gh| matches!(gh.kind.as_str(), "water" | "shore"))
        .map(|gh| (gh.passage[0], gh.passage[1]))
        .collect();
    close_crossings_at(streets, enclosures, main_too, surface, &passages);
}

/// Each entry immediately followed by an exit, including across the seam of a closed curtain.
fn water_passages(banks: &[(Point, bool)]) -> impl Iterator<Item = (Point, Point)> + '_ {
    banks.iter().zip(banks.iter().cycle().skip(1))
        .filter_map(|(a, b)| (a.1 && !b.1).then_some((a.0, b.0)))
}

fn close_crossings_at(streets: &mut Vec<Street>, enclosures: &[Enclosure], main_too: bool, surface: Surface<'_>, passages: &[(Point, Point)]) {
    let walls: Vec<(Near, f64, &Enclosure)> = enclosures
        .iter()
        .filter(|e| !e.style.is_empty() && e.path.len() >= 4)
        .map(|e| (Near::new(&e.path, 16.0), ribbon_half(&e.kind).max(e.curtain_width_m * 0.5), e))
        .collect();
    if walls.is_empty() {
        return;
    }
    let mut landings = std::collections::HashSet::new();
    if main_too {
        for deck in streets.iter().filter(|s| s.role == "bridge") {
            landings.extend(deck.path.first().into_iter().chain(deck.path.last()).map(|&p| super::network::key(p)));
        }
    }
    let mut out: Vec<Street> = Vec::with_capacity(streets.len());
    for mut s in std::mem::take(streets) {
        let lesser = gate_budget::priority(&s) < 2;
        let held = !gate_budget::water_way(&s, false) && (main_too || s.role == "approach" || lesser && s.role != "outbound");
        if !held || s.path.len() < 2 {
            out.push(s);
            continue;
        }
        if s.widths.len() != s.path.len() {
            let last = s.widths.last().copied().unwrap_or(4.0);
            s.widths.resize(s.path.len(), last);
        }
        let n = s.path.len();
        let cum: Vec<f64> = std::iter::once(0.0)
            .chain(s.path.windows(2).scan(0.0, |acc, w| {
                *acc += dist(w[0], w[1]);
                Some(*acc)
            }))
            .collect();
        // Spans (arc along the street) to remove around each stray crossing.
        let mut spans: Vec<(f64, f64)> = vec![];
        for (i, w) in s.path.windows(2).enumerate() {
            let l = dist(w[0], w[1]);
            for (near, half, e) in &walls {
                for k in near.crossed(w[0], w[1]) {
                    let (a, b) = (e.path[k], e.path[k + 1]);
                    let Some((t, x)) = g::segment_hit(w[0], w[1], a, b) else { continue };
                    // A street end resting on the curtain is no crossing.
                    if (i == 0 && t * l < 0.6) || (i + 2 == n && (1.0 - t) * l < 0.6) {
                        continue;
                    }
                    if e.gates.iter().any(|&q| dist(q, x) < GATE_REACH)
                        || passages.iter().any(|&(p, q)| g::distance(x, p, q).0 < GATE_REACH)
                        || gate_budget::water_way(&s, surface.wet(x))
                    {
                        continue;
                    }
                    let sin = cross(dir(w[0], w[1]), dir(a, b)).abs().max(0.3);
                    let clear = (half + s.widths[i].max(s.widths[i + 1]) * 0.5) / sin + 0.5;
                    let at = cum[i] + t * l;
                    spans.push((at - clear, at + clear));
                }
            }
        }
        if spans.is_empty() {
            out.push(s);
            continue;
        }
        spans.sort_by(|a, b| a.0.total_cmp(&b.0));
        let total = cum[n - 1];
        // Kept intervals between the removed spans.
        let mut keep: Vec<(f64, f64)> = vec![];
        let mut from = 0.0_f64;
        for (a, b) in spans {
            if a > from {
                keep.push((from, a));
            }
            from = from.max(b);
        }
        if from < total {
            keep.push((from, total));
        }
        let at = |d: f64| -> (Point, f64) {
            let i = (0..n - 1).find(|&i| cum[i + 1] >= d).unwrap_or(n - 2);
            let l = (cum[i + 1] - cum[i]).max(1e-9);
            let t = ((d - cum[i]) / l).clamp(0.0, 1.0);
            let (p, q) = (s.path[i], s.path[i + 1]);
            (pt(p.x + (q.x - p.x) * t, p.y + (q.y - p.y) * t), s.widths[i] + (s.widths[i + 1] - s.widths[i]) * t)
        };
        for (a, b) in keep.into_iter().filter(|(a, b)| b - a >= 1.0) {
            let (p0, w0) = at(a);
            let (p1, w1) = at(b);
            let mut path = vec![p0];
            let mut widths = vec![w0];
            for i in 1..n - 1 {
                if cum[i] > a + 1e-6 && cum[i] < b - 1e-6 {
                    path.push(s.path[i]);
                    widths.push(s.widths[i]);
                }
            }
            path.push(p1);
            widths.push(w1);
            let role = if main_too && lesser && s.role == "approach"
                && !landings.contains(&super::network::key(p0)) && !landings.contains(&super::network::key(p1)) {
                if s.rank <= 2 { "street" } else { "lane" }
            } else {
                s.role.as_str()
            };
            out.push(Street { path, widths, rank: s.rank, role: role.into() });
        }
    }
    *streets = out;
}

/// Invariant (a main road enters through a gatehouse): a land gate whose
/// street is a main street (rank 0–1) or a regional road, and which no
/// gatehouse guards yet (a crossing opened after `build`), gets the culture's
/// gate block, square to its street, off the street ribbons (`clear`) and off
/// the other structures. Where no such block fits (water, a tower) the
/// opening stays as it is.
fn guard_main_gates(e: &mut Enclosure, streets: &[&Street], clear: &Cut, culture: &str, pop: u32, surface: Surface<'_>) {
    if e.style.is_empty() || e.path.len() < 4 {
        return;
    }
    let style = styled(&e.style, culture, pop);
    let kind = if pop >= style.gate_min_pop { style.gate_major.clone() } else { style.gate_minor.clone() };
    let c = if e.curtain_width_m > 0.0 { e.curtain_width_m } else { style.curtain_width };
    let Some((depth, mass)) = gate_params(&kind, c) else { return };
    let h = ribbon_half(&e.kind);
    let ns = normals(&e.path);
    // A gate outranks a flanking or corner tower: those give way to its gatehouse (removed below).
    let mut held = Cut::new(
        e.towers_detail
            .iter()
            .filter(|t| !matches!(t.kind.as_str(), "flank" | "corner"))
            .map(|t| t.footprint.clone())
            .chain(e.gatehouses.iter().flat_map(|gh| gh.masses.iter().cloned()))
            .chain(e.bastions.iter().map(|w| w.shape.clone()))
            .collect(),
    );
    let moat = Cut::new(e.ditch.iter().map(|d| d.shape.clone()).collect());
    let guarded: Vec<usize> = e.gatehouses.iter().map(|gh| gh.gate).collect();
    for gi in 0..e.gates.len() {
        if guarded.contains(&gi) {
            continue;
        }
        let q = e.gates[gi];
        let k = e
            .path
            .windows(2)
            .enumerate()
            .min_by(|a, b| g::distance(q, a.1[0], a.1[1]).0.total_cmp(&g::distance(q, b.1[0], b.1[1]).0))
            .map_or(0, |(k, _)| k);
        let tangent = dir(e.path[k], e.path[k + 1]);
        // The main street through this gate: (along the curtain, rank, width, direction). A street that
        // crosses the curtain (over 30°) wins over one that only meets the gate point along the wall.
        let mut best: Option<(usize, usize, f64, V)> = None;
        for st in streets {
            let main = (matches!(st.role.as_str(), "regional" | "approach") || st.rank <= 1)
                && !matches!(st.role.as_str(), "bridge" | "ford" | "causeway" | "quay" | "pier" | "boardwalk" | "landing" | "mole" | "wall-lane");
            if !main {
                continue;
            }
            let rank = if matches!(st.role.as_str(), "regional" | "approach") { 0 } else { st.rank };
            for (i, w) in st.path.windows(2).enumerate() {
                // Through the gate point, or ending on it (a regional road entering from the network).
                if g::distance(q, w[0], w[1]).0 >= st.widths.get(i).copied().unwrap_or(6.0) * 0.5 + 2.0 || dist(w[0], w[1]) <= 0.1 {
                    continue;
                }
                let along = usize::from(cross(dir(w[0], w[1]), tangent).abs() < 0.5);
                if best.is_none_or(|b| (along, rank) < (b.0, b.1)) {
                    best = Some((along, rank, st.widths.get(i).copied().unwrap_or(6.0), dir(w[0], w[1])));
                }
            }
        }
        let Some((_, _, width, mut s)) = best else { continue };
        let n = ns[k];
        if dot(s, n) < 0.0 {
            s = (-s.0, -s.1);
        }
        if dot(s, n) < 0.25 {
            s = n;
        }
        let pw = width + 1.0;
        let across = (-s.1, s.0);
        let back = h / dot(s, n).max(0.3) + 0.5;
        let half = pw * 0.5 + mass;
        // On a bank (a bridge approach) the block keeps to the dry land: a shallower one, else none.
        let Some(depth) = [depth, depth * 0.5, c - h + 1.0]
            .into_iter()
            .find(|&d| !quad(q, s, across, [-back, d], [-half, half]).outer.iter().any(|&p| surface.wet(p)))
        else {
            continue;
        };
        let block = quad(q, s, across, [-back, depth], [-half, half]);
        // Off the street ribbons and out of the moat (its causeway stays open).
        let masses: Vec<Shape> = moat.from(clear.from(vec![block.clone()])).into_iter().filter(|m| g::area(m) >= 4.0).collect();
        if masses.is_empty() || masses.iter().any(|m| held.hits(m) > 0.5) {
            continue;
        }
        let block_cut = Cut::new(masses.clone());
        e.towers_detail.retain(|t| !matches!(t.kind.as_str(), "flank" | "corner") || block_cut.hits(&t.footprint) <= 0.5);
        e.towers = e.towers_detail.iter().map(|t| t.anchor).collect();
        for m in &masses {
            held.add(m.clone());
            e.reserve.push(m.clone());
        }
        e.gatehouses.push(Gatehouse {
            gate: gi,
            kind: kind.clone(),
            shape: block,
            masses,
            passage: [add(q, s, -back), add(q, s, depth)],
            passage_width_m: pw,
            height_m: e.height_m.max(style.height) + 2.0,
        });
    }
}

/// Invariant (a curtain is crossed by a street only at a gate): the gates
/// are the real crossings of `streets` with the curtain, plus the water
/// gates (their passage ends) and the ends of regional accesses; a point where
/// the curtain only touches a bank is no gate (it would cut the river wall). A gate no street crosses any more closes, a
/// crossing without a gate opens a plain one. Returns the old gate index ->
/// new index map (for the gatehouses).
fn reconcile_gates(e: &mut Enclosure, streets: &[Street], _surface: Surface<'_>) -> Vec<Option<usize>> {
    let crossings = super::composition::gates(&e.path, streets);
    let water_ends: Vec<Point> = e
        .gatehouses
        .iter()
        .filter(|gh| matches!(gh.kind.as_str(), "water" | "shore"))
        .flat_map(|gh| gh.passage)
        .collect();
    let bank = |p: Point| water_ends.iter().any(|&q| dist(p, q) < 1.0);
    let mut remap: Vec<Option<usize>> = vec![None; e.gates.len()];
    let mut gates: Vec<Point> = vec![];
    let referenced: Vec<usize> = e
        .gatehouses
        .iter()
        .filter(|gh| matches!(gh.kind.as_str(), "water" | "shore"))
        .map(|gh| gh.gate)
        .collect();
    for (i, &q) in e.gates.iter().enumerate() {
        let access = streets.iter().filter(|s| matches!(s.role.as_str(), "regional" | "approach"))
            .any(|s| s.path.first().into_iter().chain(s.path.last()).any(|&p|
                dist(p,q)<s.widths.iter().copied().fold(0.0,f64::max)*0.5+2.0));
        if crossings.iter().any(|&c| dist(c, q) < 2.0) || referenced.contains(&i) || bank(q) || access {
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
    remap
}

/// Last word on the gates, once every later stage has moved streets
/// (bridges, walkways, trims): `settle`'s rule against the final network.
/// A gatehouse whose gate closed goes with it.
pub(super) fn sync_gates(layout: &mut super::Layout, surface: Surface<'_>) {
    let mut laps = super::profile::Lap::new("sync_gates");
    let old_masses = gate_masses(layout);
    // Late streets (bridgeheads, bank links) obey the same crossing rule.
    close_crossings(&mut layout.streets, &layout.enclosures, false, surface);
    stop_at_curtains(&mut layout.streets, &mut layout.enclosures);
    laps.lap("close_minor_crossings");
    let streets = std::mem::take(&mut layout.streets);
    for e in layout.enclosures.iter_mut().filter(|e| !e.style.is_empty() && e.path.len() >= 4) {
        let remap = reconcile_gates(e, &streets, surface);
        e.gatehouses = std::mem::take(&mut e.gatehouses)
            .into_iter()
            .filter_map(|mut gh| {
                gh.gate = remap.get(gh.gate).copied().flatten()?;
                Some(gh)
            })
            .collect();
    }
    layout.streets = streets;
    laps.lap("reconcile");
    release_gate_reserve(layout, old_masses);
    laps.lap("release");
}

fn gate_masses(layout: &super::Layout) -> Vec<Shape> {
    layout.enclosures.iter().flat_map(|e| &e.gatehouses)
        .flat_map(|gh| gh.masses.iter().cloned()).collect()
}

/// Later streets can close a gate or clip its towers. Return only its vacated
/// ground: another work (including a neighbouring curtain) still owns its land.
fn release_gate_reserve(layout: &mut super::Layout, old_masses: Vec<Shape>) -> Vec<Shape> {
    if old_masses.is_empty() { return vec![]; }
    let held = Cut::new(layout.enclosures.iter().flat_map(|e| {
        curtain_body(&e.path, e.curtain_width_m, ribbon_half(&e.kind)).into_iter()
            .chain(e.towers_detail.iter().map(|t| t.footprint.clone()))
            .chain(e.gatehouses.iter().flat_map(|gh| gh.masses.iter().cloned()))
            .chain(e.bastions.iter().map(|w| w.shape.clone()))
            .chain(e.outworks.iter().map(|w| w.shape.clone()))
            .chain(e.ditch.iter().map(|w| w.shape.clone()))
            .chain(e.attached.iter().map(|w| w.shape.clone()))
    }).collect());
    let freed = held.from(old_masses);
    if freed.is_empty() { return freed; }
    let cut = Cut::new(freed.clone());
    for e in &mut layout.enclosures {
        e.reserve = cut.from(std::mem::take(&mut e.reserve));
    }
    for q in &mut layout.quarters {
        let domain = Shape { outer: q.shape.outer.clone(), holes: vec![] };
        let qb = g::bbox(&domain);
        let mut shapes = vec![q.shape.clone()];
        shapes.extend(freed.iter().filter(|s| overlaps(qb, g::bbox(s), 0.0))
            .flat_map(|s| g::intersection(&domain, s)));
        if shapes.len() > 1 {
            // Refill holes within this quarter's existing boundary; neither its
            // index nor its neighbours' land changes after block allocation.
            if let Some(shape) = g::union(&shapes).into_iter()
                .max_by(|a, b| g::area(a).total_cmp(&g::area(b))) {
                q.shape = shape;
            }
        }
    }
    freed
}

/// Invariant (a curtain is crossed only at its gates) on the plan the quarters
/// drew: the gates were decided on the armature (`gate_budget::decide`); a
/// street drawn since that crosses a curtain elsewhere ends at the wall on both
/// sides. Called before the first trim, so the allocation reads the streets the
/// walls leave.
pub(super) fn enforce(layout: &mut super::Layout, surface: Surface<'_>) {
    if layout.enclosures.iter().all(|e| e.style.is_empty() || e.path.len() < 4) {
        return;
    }
    close_crossings(&mut layout.streets, &layout.enclosures, true, surface);
    stop_at_curtains(&mut layout.streets, &mut layout.enclosures);
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
    let old_masses = gate_masses(layout);
    // Ribbons of the diversions laid here, which the blocks give up like the reserve.
    let mut extra_mural: Vec<Shape> = vec![];
    // Forced footprint circuits enter from the macroplan without detailed
    // works. They obey the same water, reserve and gate rules as historical ones.
    if layout.enclosures.iter().any(|e| e.style.is_empty() && e.path.len()>=4) {
        let cfg = layout.config.clone().unwrap_or_default();
        let pop = layout.structure.as_ref().map_or_else(|| layout.phases.iter().map(|p|p.population).sum(),
            |s|s.metrics.planned_population).max(500.0).round() as u32;
        let predicted = Predicted {widths:[9.0,8.0,5.0,3.5,3.0],arterial:1,dwelling:[5.0;2]};
        for (i,e) in layout.enclosures.iter_mut().enumerate().filter(|(_,e)|e.style.is_empty() && e.path.len()>=4) {
            let circuit = g::normalized(Shape {outer:e.path[..e.path.len()-1].to_vec(),holes:vec![]});
            let (relief,_) = terrain(&[circuit],surface);
            let rng = Rng::new(&layout.key).fork(&format!("final-circuit:{i}"));
            let mut style = resolve(&e.kind,&Inputs {culture:&layout.culture,pop,period:&cfg.programme.period,
                state:"",archetype:&layout.archetype,forced:&cfg.fortification_style,relief},&rng,&mut layout.warnings);
            style.options(&cfg);
            // Its land gates are decided like those of a traced circuit, on the streets as they
            // stand: a curtain the fit drew back turns square to the streets it now crosses. A gate
            // point it came with that is no street crossing (a regional road ending on it) stays.
            let crossed = super::composition::gates(&e.path,&layout.streets);
            let squared = !matches!(style.id.as_str(),"bastioned"|"wengcheng") && e.path.len()>6;
            let (wall,kept,dropped) = gate_budget::decide(&Shape {outer:e.path[..e.path.len()-1].to_vec(),holes:vec![]},&mut layout.streets,
                &Circuit {pop,purpose:&e.purpose,kind:&e.kind,curtain_width:style.curtain_width,moat:style.ditch_width[1],
                    grade:cfg.max_street_grade,squared,key:&layout.key,improvisation:cfg.street_improvisation},surface);
            e.path = closed(&wall.outer);
            e.gates.retain(|&q|crossed.iter().all(|&c|dist(c,q)>=8.0));
            for p in super::composition::gates(&e.path,&layout.streets) {
                if e.gates.iter().all(|&g|dist(g,p)>=8.0) {e.gates.push(p);}
            }
            let land = e.gates.len();
            let banks = super::composition::water_gates(&e.path,surface);
            for &(p,_) in &banks { if e.gates.iter().all(|&g|dist(g,p)>=8.0) {e.gates.push(p);} }
            // Access lanes added this late would change the road network.
            style.attached = 0.0;
            build(e,land,&banks,&layout.streets,surface,&style,pop,&predicted,&rng);
            let laid = layout.streets.len();
            gate_budget::divert(e,&kept,&dropped,&mut layout.streets,surface,cfg.max_street_grade);
            // The blocks give up each diversion and the strip between it and the moat (4 m + margin):
            // no unbuildable sliver is left against the reserve; the land beyond fronts the new road.
            extra_mural.extend(layout.streets[laid..].iter().flat_map(|s|g::ribbon(&s.path,&vec![s.widths[0]+10.0;s.path.len()])));
        }
    }
    if layout.enclosures.iter().all(|e| e.style.is_empty()) {
        return;
    }
    // The gates are decided: a street that crosses a curtain elsewhere ends at the wall.
    close_crossings(&mut layout.streets, &layout.enclosures, true, surface);
    stop_at_curtains(&mut layout.streets, &mut layout.enclosures);
    #[cfg(not(target_arch = "wasm32"))]
    let tick = std::time::Instant::now();
    #[cfg(not(target_arch = "wasm32"))]
    let blocks_before = layout.blocks.len();
    let streets: Vec<&Street> = layout
        .streets
        .iter()
        .filter(|s| s.role != "wall-lane")
        .collect();
    let mut reserve_all: Vec<(Shape, Box2)> = vec![];
    let culture = layout.culture.clone();
    let pop = layout.structure.as_ref().map_or_else(|| layout.phases.iter().map(|p| p.population).sum(),
        |s| s.metrics.planned_population).max(500.0).round() as u32;
    // Built land of the final plan, for moats the town has grown round.
    let built: Vec<(Box2, &Shape)> = layout.blocks.iter()
        .filter(|b| matches!(b.kind.as_str(), "block" | "place"))
        .map(|b| (g::bbox(&b.shape), &b.shape)).collect();
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
        let remap = reconcile_gates(e, &layout.streets, surface);
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
                if matches!(gh.kind.as_str(), "water" | "shore") {
                    return Some(gh);
                }
                let mid = pt(
                    (gh.passage[0].x + gh.passage[1].x) * 0.5,
                    (gh.passage[0].y + gh.passage[1].y) * 0.5,
                );
                (!gh.masses.is_empty() && on_street(mid, 0.5)).then_some(gh)
            })
            .collect();
        guard_main_gates(e, &streets, &ribbons, &culture, pop, surface);
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
        let (continuous, works): (Vec<_>, Vec<_>) = std::mem::take(&mut e.outworks).into_iter()
            .partition(|w| matches!(w.kind.as_str(), "outer-wall" | "antemural"));
        e.outworks = cut(works, 10.0);
        e.outworks.extend(continuous);
        e.ditch = continuous_moat(cut(std::mem::take(&mut e.ditch), 20.0), &e.path, surface);
        // A moat the town has grown round holds no water. Its wet pieces dry
        // together, when most of their area lies inside the built town.
        let wet_area: f64 = e.ditch.iter().filter(|d| d.kind == "wet").map(|d| g::area(&d.shape)).sum();
        let inside: f64 = e.ditch.iter().filter(|d| d.kind == "wet" && embedded(&d.shape, &e.path, &built)).map(|d| g::area(&d.shape)).sum();
        if wet_area > 0.0 && inside * 2.0 >= wet_area {
            for d in e.ditch.iter_mut().filter(|d| d.kind == "wet") {
                d.kind = "dry".into();
            }
        }
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
    let freed = release_gate_reserve(layout, old_masses);
    let reserve_all: Vec<_> = Cut::new(freed).from(reserve_all.into_iter().map(|(s, _)| s).collect()).into_iter()
        .map(|s| { let bb = g::bbox(&s); (s, bb) }).collect();
    // Blocks give up the diversions too (their houses would stand on them).
    let mut reserve_all = reserve_all;
    reserve_all.extend(extra_mural.into_iter().map(|s| { let bb = g::bbox(&s); (s, bb) }));
    if reserve_all.is_empty() {
        return;
    }
    // --- blocks give up the reserve
    let walls: Vec<_> = layout.enclosures.iter().filter(|e| !e.style.is_empty() && e.path.len() >= 4)
        .map(|e| (Near::new(&e.path, 30.0), e.curtain_width_m * 0.5 + 1.0)).collect();
    let reserve = Cut {
        shapes: reserve_all,
    };
    let blocks = std::mem::take(&mut layout.blocks);
    let frontage = OnceLock::new();
    let out = super::par::map(&blocks, |i, b| {
        // Quarter partitioning can leave a tiny piece just clear of the
        // curtain. It follows the same rule as a piece cut by the reserve.
        if b.kind == "block" && g::area(&b.shape) < MIN_BLOCK_PIECE && walls.iter().any(|(near, reach)|
            b.shape.outer.iter().any(|&p| near.distance(p, p) <= *reach)) { return vec![]; }
        if reserve.hits(&b.shape) <= 0.5 {
            return vec![b.clone()];
        }
        let pieces = reserve.from(vec![b.shape.clone()]);
        let split = pieces.len() > 1 && b.kind == "block";
        pieces.into_iter().filter(|s| g::area(s) >= MIN_BLOCK_PIECE)
            .map(|shape| {
                let mut piece = super::Block { shape, ..b.clone() };
                // A curtain can cut the street off one piece of a serviced block.
                // Its landlocked backland stays open, as on the parcel cut.
                if split && !layout.programme.iter().flat_map(|p| &p.reservations).any(|r| r.block == i)
                    && super::parcels::access_fronts(&piece.shape, layout,
                        frontage.get_or_init(|| super::parcels::FrontageIndex::new(layout))).is_empty() {
                    piece.kind = "reserve".into();
                }
                piece
            })
            .collect()
    });
    layout.blocks = out.into_iter().flatten().collect();
    #[cfg(not(target_arch = "wasm32"))]
    if std::env::var("URBAN_PROFILE").is_ok() {
        eprintln!(
            "  fortification settle: blocks {blocks_before} -> {}, {:.0} ms",
            layout.blocks.len(),
            tick.elapsed().as_secs_f64() * 1000.0
        );
    }
}

#[cfg(test)]
#[path = "fortification/style_tests.rs"]
mod style_tests;

#[cfg(test)]
#[path = "fortification/trace_tests.rs"]
mod trace_tests;

#[cfg(test)]
#[path = "fortification/reserve_tests.rs"]
mod reserve_tests;

#[cfg(test)]
#[path = "fortification/works_tests.rs"]
mod works_tests;

#[cfg(test)]
#[path = "fortification/settle_tests.rs"]
mod settle_tests;

#[cfg(test)]
#[path = "fortification/test_fixtures.rs"]
mod test_fixtures;
