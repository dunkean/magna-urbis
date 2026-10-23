//! Settlement kinds, from a lone building or a ruin to a metropolis of wards.
//!
//! The kind is resolved once per site from the population, the culture, the
//! site archetype found by settlement placement (`harbor`, `bridge`, `hilltop`,
//! `spur`, `pass`, `island`…), the programme context (isolated roles, the
//! settlement's condition) and an explicit `settlementForm`. It sets the macro
//! grammar: centres, quarters, walls, epochs and street skeleton. Quarters,
//! parcels, programme and buildings then run unchanged.
//!
//! The quarter pipeline is a town grammar: given eight people it still draws
//! four quarters, a ring road and outbound connectors. The small kinds (single
//! building, ruin, farmstead, camp, hamlet, street village) are therefore laid
//! out here directly, as plots fronting a road, a track or a lane, with the
//! same `Layout` contract (quarters, blocks, streets, phases, structure).
use super::{
    Block, GrowthPhase, Layout, LayoutConfig, Morph, Point, Quarter, Shape, Site, Street, Surface,
    UrbanCenter, UrbanDistrict, UrbanEvent, UrbanMetrics, UrbanStructure, composition,
    geometry as g, macroplan, profiles, roles, routing,
};
use crate::rng::Rng;

#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub enum Kind {
    /// One building alone: mill, inn, tower, shrine, wayside temple.
    Single,
    /// One ruined building (a lone farm or isolated structure in ruins).
    Ruin,
    /// House, barn and yard on one plot, a track to the road.
    Farmstead,
    /// Tents or huts in a ring around an open centre (nomadic cultures).
    Camp,
    /// A few farms along a track or a road, no walls.
    Hamlet,
    /// One ribbon of long plots along the road, cross-lanes to the fields.
    StreetVillage,
    /// Grouped around a green or a church.
    NucleatedVillage,
    /// Market town, open or palisaded.
    MarketTown,
    /// Walled town with gates and faubourgs.
    WalledTown,
    /// City: several growth rings, an old circuit, faubourgs.
    City,
    /// Metropolis: several centres (wards), older wall rings turned boulevards,
    /// faubourgs and absorbed villages along the radials.
    Metropolis,
}
const ALL: [Kind; 11] = [
    Kind::Single,
    Kind::Ruin,
    Kind::Farmstead,
    Kind::Camp,
    Kind::Hamlet,
    Kind::StreetVillage,
    Kind::NucleatedVillage,
    Kind::MarketTown,
    Kind::WalledTown,
    Kind::City,
    Kind::Metropolis,
];
impl Kind {
    pub fn id(self) -> &'static str {
        match self {
            Kind::Single => "single",
            Kind::Ruin => "ruin",
            Kind::Farmstead => "farmstead",
            Kind::Camp => "camp",
            Kind::Hamlet => "hamlet",
            Kind::StreetVillage => "street-village",
            Kind::NucleatedVillage => "nucleated-village",
            Kind::MarketTown => "market-town",
            Kind::WalledTown => "walled-town",
            Kind::City => "city",
            Kind::Metropolis => "metropolis",
        }
    }
    /// French label for the UI.
    pub fn label(self) -> &'static str {
        match self {
            Kind::Single => "Bâtiment isolé",
            Kind::Ruin => "Ruine",
            Kind::Farmstead => "Ferme isolée",
            Kind::Camp => "Campement",
            Kind::Hamlet => "Hameau",
            Kind::StreetVillage => "Village-rue",
            Kind::NucleatedVillage => "Village groupé",
            Kind::MarketTown => "Bourg",
            Kind::WalledTown => "Ville close",
            Kind::City => "Cité",
            Kind::Metropolis => "Métropole",
        }
    }
    pub fn from_id(id: &str) -> Option<Self> {
        ALL.into_iter().find(|k| k.id() == id)
    }
    /// Laid out by `lay_out`, without the quarter grammar.
    pub fn small(self) -> bool {
        matches!(
            self,
            Kind::Single
                | Kind::Ruin
                | Kind::Farmstead
                | Kind::Camp
                | Kind::Hamlet
                | Kind::StreetVillage
        )
    }
}
/// French label of a layout archetype (a kind id); empty when unknown.
pub fn label(id: &str) -> &'static str {
    Kind::from_id(id).map_or("", Kind::label)
}

/// Cultures whose settlements are camps below town size.
const NOMADS: [&str; 2] = ["nomad-camp", "native-plains"];
/// Site archetypes where a small town is worth a wall, or a village clusters.
const DEFENSIVE: [&str; 4] = ["hilltop", "spur", "pass", "island"];

fn culture<'a>(site: &'a Site, cfg: &'a LayoutConfig) -> &'a str {
    if cfg.culture == "site" {
        &site.culture
    } else {
        &cfg.culture
    }
}

pub(super) fn resolve(site: &Site, cfg: &LayoutConfig, roads: &[Street]) -> Kind {
    if let Some(kind) = Kind::from_id(&cfg.settlement_form) {
        return kind;
    }
    let culture = culture(site, cfg);
    let pop = site.population;
    let state = cfg.programme.state.as_str();
    let role = cfg.programme.role.as_str();
    if roles::is_isolated(role) {
        return if state == "ruined" {
            Kind::Ruin
        } else if role == "isolated-farm" {
            Kind::Farmstead
        } else {
            Kind::Single
        };
    }
    if NOMADS.contains(&culture) && pop < 5000 {
        return Kind::Camp;
    }
    if pop <= 12 {
        return if state == "ruined" {
            Kind::Ruin
        } else {
            Kind::Farmstead
        };
    }
    if pop < 150 {
        return Kind::Hamlet;
    }
    if pop < 1200 {
        return match cfg.settlement_form.as_str() {
            "ribbon" => Kind::StreetVillage,
            "nucleated" => Kind::NucleatedVillage,
            _ => village_form(site, cfg, culture, roads),
        };
    }
    let fortifies = profiles::fortification(
        profiles::settlement_profile(culture, pop, 3),
        &cfg.fortification,
        pop,
    ) != "none";
    let defensive = DEFENSIVE.contains(&cfg.site_archetype.as_str());
    if pop < 5000 {
        if fortifies && (pop >= 2500 || defensive) {
            Kind::WalledTown
        } else {
            Kind::MarketTown
        }
    } else if pop < 30_000 {
        if fortifies {
            Kind::WalledTown
        } else {
            Kind::City
        }
    } else if pop < 200_000 {
        Kind::City
    } else {
        Kind::Metropolis
    }
}
/// Street village where a through road carries the place (bridge, pass,
/// valley floor) and the culture has no clustered village form; clustered on
/// heights, islands and shores; otherwise a deterministic draw per site.
fn village_form(site: &Site, cfg: &LayoutConfig, culture: &str, roads: &[Street]) -> Kind {
    let form = composition::culture_data(culture, site.population)["village"]["form"]
        .as_str()
        .unwrap_or("auto");
    if form != "auto" || nearest(site.center, roads, site.radius.max(80.0)).is_none() {
        return Kind::NucleatedVillage;
    }
    match cfg.site_archetype.as_str() {
        "hilltop" | "spur" | "island" | "harbor" | "lakeshore" => Kind::NucleatedVillage,
        "bridge" | "pass" | "valley" => Kind::StreetVillage,
        _ => {
            if Rng::new(&format!("settlement-kind:{}", site.key)).chance(0.5) {
                Kind::StreetVillage
            } else {
                Kind::NucleatedVillage
            }
        }
    }
}

/// The configuration the kind applies: only fields left on their automatic
/// value change (`suburbs: auto`, `peripheralRoad: auto`, `fortification:
/// culture`, the default three epochs, `programme.role: auto`). The kind id is
/// written to `settlement_form`, so resolving the effective config again gives
/// the same kind.
pub(super) fn effective(site: &Site, cfg: &LayoutConfig, roads: &[Street]) -> (LayoutConfig, Kind) {
    let kind = resolve(site, cfg, roads);
    let mut c = cfg.clone();
    // Saved pre-refactor scenes keep their former geometry.
    if cfg.footprint.mechanism == "legacy" {
        return (c, kind);
    }
    c.settlement_form = kind.id().into();
    let default_epochs = cfg.footprint.epochs == super::FootprintConfig::default().epochs;
    let set = |field: &mut String, when: &str, value: &str| {
        if field == when {
            *field = value.into();
        }
    };
    match kind {
        Kind::Single | Kind::Ruin | Kind::Farmstead | Kind::Camp | Kind::Hamlet => {
            set(&mut c.suburbs, "auto", "none");
            set(&mut c.peripheral_road, "auto", "none");
            set(&mut c.fortification, "culture", "none");
            if default_epochs {
                c.footprint.epochs = 1;
            }
            if matches!(kind, Kind::Farmstead | Kind::Ruin) && c.programme.role == "auto" {
                c.programme.role = "isolated-farm".into();
            }
        }
        Kind::StreetVillage | Kind::NucleatedVillage => {
            set(&mut c.suburbs, "auto", "none");
            set(&mut c.peripheral_road, "auto", "none");
            if default_epochs {
                c.footprint.epochs = 1;
            }
        }
        Kind::MarketTown => {
            set(&mut c.fortification, "culture", "none");
            set(&mut c.suburbs, "auto", "few");
            // A small bourg grew in two periods (founding, market growth); a
            // larger one keeps the default three, its faubourg included.
            if default_epochs && site.population < 2500 {
                c.footprint.epochs = 2;
            }
        }
        Kind::WalledTown | Kind::City => {}
        Kind::Metropolis => {
            set(&mut c.suburbs, "auto", "many");
            if default_epochs {
                c.footprint.epochs = 4;
            }
        }
    }
    (c, kind)
}

/// After the programme: restore the user's configuration,
/// and fade the streets of an abandoned or ruined place to tracks (the plan
/// stays; widths and frontage contacts are unchanged).
/// Record the kind as the layout archetype, before the programme reads it.
pub(super) fn stamp(layout: &mut Layout, kind: Kind, original: &LayoutConfig) {
    if original.footprint.mechanism != "legacy" {
        layout.archetype = kind.id().into();
    }
}
pub(super) fn finish(layout: &mut Layout, kind: Kind, original: &LayoutConfig) {
    if original.footprint.mechanism == "legacy" {
        return;
    }
    layout.config = Some(original.clone());
    let state = layout
        .programme
        .as_ref()
        .map_or(original.programme.state.as_str(), |p| {
            p.context.state.as_str()
        });
    if matches!(state, "abandoned" | "ruined") {
        for s in &mut layout.streets {
            if matches!(
                s.role.as_str(),
                "street"
                    | "lane"
                    | "market"
                    | "gate-street"
                    | "ring"
                    | "peripheral"
                    | "outbound"
                    | "processional"
                    | "quay"
                    | "wall-lane"
            ) {
                s.role = "track".into();
            }
        }
        let condition = match (kind, state) {
            (Kind::Ruin, _) => "",
            (_, "ruined") => " en ruine",
            _ => " à l’abandon",
        };
        layout.warnings.push(format!(
            "{}{condition} : rues retournées à l’état de chemins.",
            kind.label()
        ));
    }
}

// ---------------------------------------------------------------------------
// Small kinds, laid out directly.

fn dist(a: Point, b: Point) -> f64 {
    (a.x - b.x).hypot(a.y - b.y)
}
fn at(p: Point, d: Point, t: f64) -> Point {
    Point {
        x: p.x + d.x * t,
        y: p.y + d.y * t,
    }
}
fn unit(a: Point, b: Point) -> Point {
    let l = dist(a, b).max(1e-9);
    Point {
        x: (b.x - a.x) / l,
        y: (b.y - a.y) / l,
    }
}
fn perp(d: Point) -> Point {
    Point { x: -d.y, y: d.x }
}
fn arc(path: &[Point]) -> Vec<f64> {
    let mut out = vec![0.0];
    for w in path.windows(2) {
        out.push(out.last().unwrap() + dist(w[0], w[1]));
    }
    out
}
/// Sub-polyline between arc lengths `a` and `b`.
fn slice(path: &[Point], a: f64, b: f64) -> Vec<Point> {
    let s = arc(path);
    let total = *s.last().unwrap_or(&0.0);
    let (a, b) = (a.clamp(0.0, total), b.clamp(0.0, total));
    let point = |t: f64| {
        let i = s.partition_point(|&v| v < t).clamp(1, path.len() - 1);
        let run = (s[i] - s[i - 1]).max(1e-9);
        let f = ((t - s[i - 1]) / run).clamp(0.0, 1.0);
        Point {
            x: path[i - 1].x + (path[i].x - path[i - 1].x) * f,
            y: path[i - 1].y + (path[i].y - path[i - 1].y) * f,
        }
    };
    let mut out = vec![point(a)];
    for (i, &v) in s.iter().enumerate() {
        if v > a && v < b {
            out.push(path[i]);
        }
    }
    out.push(point(b));
    out.dedup_by(|p, q| dist(*p, *q) < 1e-6);
    out
}
fn point_at(path: &[Point], t: f64) -> (Point, Point) {
    let s = arc(path);
    let i = s.partition_point(|&v| v < t).clamp(1, path.len() - 1);
    let d = unit(path[i - 1], path[i]);
    let p = slice(path, t, t)[0];
    (p, d)
}
struct Near {
    road: usize,
    distance: f64,
    point: Point,
    /// Arc length of `point` along the road.
    station: f64,
    tangent: Point,
}
/// Closest ordinary road (crossing spans excluded) within `reach`.
fn nearest(p: Point, roads: &[Street], reach: f64) -> Option<Near> {
    let mut best: Option<Near> = None;
    for (r, road) in roads.iter().enumerate() {
        if matches!(road.role.as_str(), "bridge" | "ford" | "causeway") || road.path.len() < 2 {
            continue;
        }
        let mut s = 0.0;
        for w in road.path.windows(2) {
            let (d, t, q) = g::distance(p, w[0], w[1]);
            let run = dist(w[0], w[1]);
            if d < reach && best.as_ref().is_none_or(|b| d < b.distance) && run > 1e-6 {
                best = Some(Near {
                    road: r,
                    distance: d,
                    point: q,
                    station: s + t * run,
                    tangent: unit(w[0], w[1]),
                });
            }
            s += run;
        }
    }
    best
}
/// Land on one side of a path: between `half` (the street's half width, so the
/// front edge carries an exact frontage contact) and `half + depth`.
///
/// Built one-sided: a quad per segment and a wedge at each interior vertex,
/// all on the requested side, minus the street band. A two-sided band split
/// afterwards would let the round joins (radius `half + depth`) of a vertex
/// near the end of a short slice wrap around the end cap and join both sides.
fn side(path: &[Point], half: f64, depth: f64, left: bool) -> Option<Shape> {
    if path.len() < 2 || arc(path).last().copied().unwrap_or(0.0) < 1.0 {
        return None;
    }
    let sign = if left { 1.0 } else { -1.0 };
    let reach = half + depth;
    let normals: Vec<Option<Point>> = path
        .windows(2)
        .map(|w| {
            (dist(w[0], w[1]) > 1e-6).then(|| {
                let n = perp(unit(w[0], w[1]));
                Point {
                    x: n.x * sign,
                    y: n.y * sign,
                }
            })
        })
        .collect();
    // Shapes that only touch along an edge may stay apart in a boolean union:
    // neighbouring quads overlap by 2 cm along the path, and each bend wedge
    // reaches slightly into the two quads beside it.
    let last = path.len() - 2;
    let mut parts = vec![];
    for (i, (w, n)) in path.windows(2).zip(&normals).enumerate() {
        let Some(n) = *n else { continue };
        let d = unit(w[0], w[1]);
        let a = if i == 0 { w[0] } else { at(w[0], d, -0.02) };
        let b = if i == last { w[1] } else { at(w[1], d, 0.02) };
        parts.push(g::normalized(Shape {
            outer: vec![
                at(a, n, half),
                at(b, n, half),
                at(b, n, reach),
                at(a, n, reach),
            ],
            holes: vec![],
        }));
    }
    for (i, n) in normals.iter().enumerate().skip(1) {
        let (Some(n), Some(prev)) = (*n, normals[..i].iter().rev().flatten().next().copied())
        else {
            continue;
        };
        if (prev.x * n.y - prev.y * n.x).abs() < 1e-9 {
            continue;
        }
        let p = path[i];
        let lean = |v: Point, along: Point| unit(Point { x: 0.0, y: 0.0 }, at(v, along, 0.01));
        let back = unit(path[i], path[i - 1]);
        let ahead = unit(path[i], path[i + 1]);
        let mid = unit(
            Point { x: 0.0, y: 0.0 },
            Point {
                x: prev.x + n.x,
                y: prev.y + n.y,
            },
        );
        parts.push(g::normalized(Shape {
            outer: vec![
                p,
                at(p, lean(prev, back), reach),
                at(p, mid, reach),
                at(p, lean(n, ahead), reach),
            ],
            holes: vec![],
        }));
    }
    // The street band runs 1 m past the plot ends.
    let mut long = path.to_vec();
    let m = long.len();
    let (a, b) = (unit(long[1], long[0]), unit(long[m - 2], long[m - 1]));
    long[0] = at(long[0], a, 1.0);
    long[m - 1] = at(long[m - 1], b, 1.0);
    let inner = g::ribbon(&long, &[half * 2.0]);
    let mut pieces = g::union(&parts);
    for i in &inner {
        pieces = pieces.iter().flat_map(|s| g::difference(s, i)).collect();
    }
    pieces.sort_by(|a, b| g::area(b).total_cmp(&g::area(a)));
    pieces.into_iter().next()
}
/// Keep the dry part of a plot clear of other streets; refuse it when less
/// than `keep` of it survives.
fn settle(shape: &Shape, obstacles: &[Shape], surface: &Surface<'_>, keep: f64) -> Option<Shape> {
    let planned = g::area(shape);
    let mut pieces = g::dry_clip(surface, shape);
    let (x0, y0, x1, y1) = g::bbox(shape);
    for o in obstacles {
        let (a0, b0, a1, b1) = g::bbox(o);
        if a0 > x1 || a1 < x0 || b0 > y1 || b1 < y0 {
            continue;
        }
        pieces = pieces.iter().flat_map(|s| g::difference(s, o)).collect();
    }
    pieces
        .into_iter()
        .filter(|s| g::area(s) >= planned * keep && g::area(s) > 20.0)
        .max_by(|a, b| g::area(a).total_cmp(&g::area(b)))
}
fn street(path: Vec<Point>, width: f64, rank: usize, role: &str) -> Street {
    Street {
        widths: vec![width; path.len()],
        path,
        rank,
        role: role.into(),
    }
}
/// Route a track from `from` to `to` at lane grade; a straight line when no
/// route is found (short connections on flat ground).
fn track(surface: Surface<'_>, from: Point, to: Point, grade: f64) -> Vec<Point> {
    let margin = 120.0;
    let mut planner = routing::RoutePlanner::new(
        surface,
        (
            from.x.min(to.x) - margin,
            from.y.min(to.y) - margin,
            from.x.max(to.x) + margin,
            from.y.max(to.y) + margin,
        ),
    );
    planner
        .route(from, to, grade)
        .filter(|p| p.len() >= 2)
        .unwrap_or_else(|| vec![from, to])
}

/// Plot size of one building: front × depth (m).
fn plot_size(kind: Kind, role: &str, rng: &mut Rng) -> (f64, f64) {
    let base = match (kind, role) {
        (_, "isolated-mill") => (30.0, 40.0),
        (_, "isolated-inn") => (34.0, 46.0),
        (_, "isolated-tower") => (26.0, 28.0),
        (_, "isolated-shrine") => (16.0, 20.0),
        (_, "roadside-temple") => (24.0, 30.0),
        (Kind::Single, _) => (28.0, 34.0),
        _ => (46.0, 56.0),
    };
    let j = rng.range(0.9, 1.12);
    (base.0 * j, base.1 * rng.range(0.92, 1.1))
}

struct Plan {
    blocks: Vec<(Shape, &'static str)>,
    streets: Vec<Street>,
    center: Point,
    axis: Point,
}

/// The road through the place: the nearest road continued at either end by
/// the most collinear road meeting it there, while it is shorter than `need`
/// on that side. Returns the path and the site's station on it.
fn through(roads: &[Street], road: usize, station: f64, need: f64) -> (Vec<Point>, f64) {
    let ordinary = |r: &Street| !matches!(r.role.as_str(), "bridge" | "ford" | "causeway");
    let mut path = roads[road].path.clone();
    let mut station = station;
    let mut used = vec![road];
    for _ in 0..3 {
        let total = *arc(&path).last().unwrap_or(&0.0);
        let mut grown = false;
        for at_start in [true, false] {
            let room = if at_start { station } else { total - station };
            if room >= need * 0.5 || path.len() < 2 {
                continue;
            }
            let (end, inward) = if at_start {
                (path[0], unit(path[1], path[0]))
            } else {
                (
                    path[path.len() - 1],
                    unit(path[path.len() - 2], path[path.len() - 1]),
                )
            };
            // Best continuation: starts or ends at this end, heading on.
            let best = roads
                .iter()
                .enumerate()
                .filter(|(i, r)| !used.contains(i) && ordinary(r) && r.path.len() >= 2)
                .filter_map(|(i, r)| {
                    let (first, last) = (r.path[0], r.path[r.path.len() - 1]);
                    let forward = dist(first, end) < 1.0;
                    if !forward && dist(last, end) >= 1.0 {
                        return None;
                    }
                    let next = if forward {
                        r.path[1]
                    } else {
                        r.path[r.path.len() - 2]
                    };
                    let d = unit(end, next);
                    let straight = d.x * inward.x + d.y * inward.y;
                    (straight > 0.3).then_some((i, forward, straight))
                })
                .max_by(|a, b| a.2.total_cmp(&b.2));
            let Some((i, forward, _)) = best else {
                continue;
            };
            let mut extra = roads[i].path.clone();
            if forward == at_start {
                extra.reverse();
            }
            used.push(i);
            grown = true;
            if at_start {
                // `extra` now ends at `end`.
                let added = *arc(&extra).last().unwrap_or(&0.0);
                extra.pop();
                extra.extend(path);
                path = extra;
                station += added;
            } else {
                path.extend(extra.into_iter().skip(1));
            }
        }
        if !grown {
            break;
        }
    }
    (path, station)
}
/// Start of the `length` window along `path` that keeps the most dry land on
/// both sides at mid-plot depth, nearest the site's `station` when tied (a
/// quarter of the window's length counts like all its land).
fn window(path: &[Point], station: f64, length: f64, depth: f64, surface: &Surface<'_>) -> f64 {
    let total = *arc(path).last().unwrap_or(&0.0);
    let last = (total - length).max(0.0);
    let step = 20.0;
    let count = (total / step).ceil() as usize + 1;
    // One walk along the path, a sample every `step` metres.
    let s = arc(path);
    let mut i = 1;
    let dry: Vec<f64> = (0..count)
        .map(|k| {
            let t = (k as f64 * step).min(total);
            while i + 1 < path.len() && s[i] < t {
                i += 1;
            }
            let d = unit(path[i - 1], path[i]);
            let p = at(path[i - 1], d, t - s[i - 1]);
            let n = perp(d);
            [-1.0, 1.0]
                .iter()
                .filter(|&&side| !surface.wet(at(p, n, side * depth * 0.5)))
                .count() as f64
        })
        .collect();
    // Prefix sums: each window is O(1).
    let mut sum = vec![0.0];
    for v in &dry {
        sum.push(sum.last().unwrap() + v);
    }
    let span = ((length / step).round() as usize).max(1);
    let mut best = ((station - length * 0.5).clamp(0.0, last), f64::MIN);
    let mut k = 0;
    while k as f64 * step <= last + 1e-9 {
        let end = (k + span).min(count);
        let land = (sum[end] - sum[k]) / (2.0 * span as f64);
        let mid = k as f64 * step + length * 0.5;
        let score = land - 0.25 * (mid - station).abs() / length.max(1.0);
        if score > best.1 {
            best = (k as f64 * step, score);
        }
        k += 1;
    }
    best.0
}

/// Small kinds, laid out without the quarter grammar. `None` when the site
/// offers no dry land for them: the caller falls back to the quarter pipeline.
#[allow(clippy::too_many_arguments)]
pub(super) fn lay_out(
    seed: &str,
    site: &Site,
    cfg: &LayoutConfig,
    kind: Kind,
    morph: &Morph,
    surface: Surface<'_>,
    roads: &[Street],
) -> Option<Layout> {
    let culture = culture(site, cfg).to_owned();
    let mut rng = Rng::new(seed).fork(&format!("settlement-kind:{}", kind.id()));
    let reach = 600.0;
    let near = nearest(site.center, roads, reach);
    // Road ribbons the plots must not cover (all roads near the site).
    let obstacles: Vec<Shape> = roads
        .iter()
        .filter(|r| {
            r.path
                .windows(2)
                .any(|w| g::distance(site.center, w[0], w[1]).0 < 2500.0)
        })
        .flat_map(|r| g::ribbon(&r.path, &r.widths))
        .collect();
    let road_half = |n: &Near| {
        roads[n.road]
            .widths
            .iter()
            .copied()
            .fold(0.0_f64, f64::max)
            .max(3.0)
            * 0.5
            + 0.05
    };
    let plan = match kind {
        Kind::Single | Kind::Ruin | Kind::Farmstead => homestead(
            site, cfg, kind, &near, &obstacles, &road_half, roads, surface, &mut rng,
        )?,
        Kind::Camp => camp(site, cfg, &near, &obstacles, surface, &mut rng)?,
        Kind::Hamlet | Kind::StreetVillage => linear(
            site, cfg, kind, morph, &near, &obstacles, &road_half, roads, surface, &mut rng,
        )?,
        _ => return None,
    };
    if plan.blocks.is_empty() {
        return None;
    }
    // Regional roads crossing the place are part of its street network.
    let shapes: Vec<Shape> = plan.blocks.iter().map(|b| b.0.clone()).collect();
    let (mut x0, mut y0, mut x1, mut y1) = (f64::MAX, f64::MAX, f64::MIN, f64::MIN);
    for s in &shapes {
        let b = g::bbox(s);
        (x0, y0, x1, y1) = (x0.min(b.0), y0.min(b.1), x1.max(b.2), y1.max(b.3));
    }
    let window = g::rectangle(x0 - 40.0, y0 - 40.0, x1 + 40.0, y1 + 40.0);
    let mut streets: Vec<Street> = roads
        .iter()
        .flat_map(|r| macroplan::clip(r, &window))
        .collect();
    streets.extend(plan.streets);
    let area: f64 = shapes.iter().map(g::area).sum();
    let zone = "village".to_string();
    let recipe = if cfg.recipe != "auto" {
        cfg.recipe.clone()
    } else {
        composition::recipe(
            &culture,
            site.population,
            if kind == Kind::StreetVillage {
                "village"
            } else {
                "hamlet"
            },
        )
    };
    let quarters: Vec<Quarter> = shapes
        .iter()
        .map(|s| Quarter {
            shape: s.clone(),
            phase: 0,
            zone: zone.clone(),
        })
        .collect();
    let blocks: Vec<Block> = plan
        .blocks
        .iter()
        .enumerate()
        .map(|(i, (s, k))| Block {
            shape: s.clone(),
            quarter: i,
            kind: (*k).into(),
            axis: plan.axis,
            zone: zone.clone(),
            phase: Some(0),
        })
        .collect();
    let structure = UrbanStructure {
        version: 1,
        mechanism: "kind".into(),
        family: kind.id().into(),
        reserve: vec![],
        allocated: g::union(&shapes),
        centers: vec![UrbanCenter {
            id: 0,
            point: plan.center,
            weight: 1.0,
        }],
        districts: vec![UrbanDistrict {
            id: 0,
            center: 0,
            phase: 0,
            tissue: kind.id().into(),
            quarters: (0..quarters.len()).collect(),
            role: String::new(),
            wealth: 0.0,
            label: String::new(),
        }],
        history: vec![UrbanEvent {
            epoch: 0,
            kind: kind.id().into(),
            center: 0,
            area,
        }],
        metrics: UrbanMetrics {
            target_area: area,
            allocated_area: area,
            gross_density: f64::from(site.population) * 10_000.0 / area.max(1.0),
            planned_population: f64::from(site.population),
            components: shapes.len(),
            ..UrbanMetrics::default()
        },
    };
    Some(Layout {
        config: Some(cfg.clone()),
        programme: None,
        key: site.key.clone(),
        culture: culture.clone(),
        center: site.center,
        quarters,
        streets,
        blocks,
        warnings: vec![],
        enclosures: vec![],
        phases: vec![GrowthPhase {
            culture,
            kind: kind.id().into(),
            zone,
            recipe,
            population: f64::from(site.population),
            target_area: area,
            shapes,
        }],
        archetype: kind.id().into(),
        structure: Some(structure),
    })
}

/// One plot: on the road when the site is beside it, otherwise at the site
/// with a track along its front to the road.
#[allow(clippy::too_many_arguments)]
fn homestead(
    site: &Site,
    cfg: &LayoutConfig,
    kind: Kind,
    near: &Option<Near>,
    obstacles: &[Shape],
    road_half: &dyn Fn(&Near) -> f64,
    roads: &[Street],
    surface: Surface<'_>,
    rng: &mut Rng,
) -> Option<Plan> {
    let (w, d) = plot_size(kind, &cfg.programme.role, rng);
    let c = site.center;
    if let Some(n) = near {
        let half = road_half(n);
        if n.distance <= d * 0.5 + half + 40.0 {
            let path = slice(
                &roads[n.road].path,
                n.station - w * 0.5,
                n.station + w * 0.5,
            );
            let toward = (c.x - n.point.x) * -n.tangent.y + (c.y - n.point.y) * n.tangent.x > 0.0;
            for left in [toward, !toward] {
                if let Some(plot) =
                    side(&path, half, d, left).and_then(|p| settle(&p, obstacles, &surface, 0.6))
                {
                    return Some(Plan {
                        center: g::interior_point(&plot),
                        blocks: vec![(plot, "block")],
                        streets: vec![],
                        axis: n.tangent,
                    });
                }
            }
        }
    }
    // The front faces the road; a farm track runs along it.
    let toward = near
        .as_ref()
        .map_or(Point { x: 0.0, y: 1.0 }, |n| unit(c, n.point));
    let along = perp(toward);
    let half = 1.5;
    let front = at(c, toward, d * 0.5 + half);
    let a = at(front, along, -(w * 0.5 + 4.0));
    let b = at(front, along, w * 0.5 + 4.0);
    let lane = [a, b];
    let plot = side(&lane, half, d, true)
        .filter(|p| g::contains(p, c) || dist(g::interior_point(p), c) < d)
        .or_else(|| side(&lane, half, d, false))
        .filter(|p| dist(g::interior_point(p), c) < d)?;
    let mut path = match near {
        Some(n) => {
            let start = if dist(n.point, a) < dist(n.point, b) {
                a
            } else {
                b
            };
            let mut p = track(surface, n.point, start, cfg.max_lane_grade);
            p.push(if start == a { b } else { a });
            p
        }
        None => lane.to_vec(),
    };
    path.dedup_by(|p, q| dist(*p, *q) < 1e-6);
    let mut blocked = obstacles.to_vec();
    if path.len() > 2 {
        blocked.extend(g::ribbon(&path[..path.len() - 1], &[half * 2.0]));
    }
    let plot = settle(&plot, &blocked, &surface, 0.6)?;
    Some(Plan {
        center: g::interior_point(&plot),
        blocks: vec![(plot, "block")],
        streets: vec![street(path, half * 2.0, 3, "track")],
        axis: along,
    })
}

/// Farms or long plots along an axis: the passing road when it is near, else
/// a lane through the site joined to the road by a track. A hamlet places
/// separate farm plots with gaps; a street village continuous strips cut by
/// cross-lanes to the fields, with a green near the middle.
#[allow(clippy::too_many_arguments)]
fn linear(
    site: &Site,
    cfg: &LayoutConfig,
    kind: Kind,
    morph: &Morph,
    near: &Option<Near>,
    obstacles: &[Shape],
    road_half: &dyn Fn(&Near) -> f64,
    roads: &[Street],
    surface: Surface<'_>,
    rng: &mut Rng,
) -> Option<Plan> {
    let pop = f64::from(site.population);
    let depth = morph.range("plotDepth", "village");
    let village = kind == Kind::StreetVillage;
    let (depth, length) = if village {
        // One farm per household along both sides of the street: the ribbon
        // is as long as their frontages, plus the cross-lanes and the green.
        let households = (pop / 4.5).ceil();
        let front = morph.range("frontage", "village");
        let front = if front[1] > 0.0 {
            ((front[0] + front[1]) * 0.5).clamp(12.0, 48.0)
        } else {
            30.0
        };
        let d = depth[1].clamp(40.0, 90.0);
        (
            d,
            (households / 2.0 * front * 1.2 + 80.0).clamp(120.0, 2400.0),
        )
    } else {
        let farms = (pop / 5.0).ceil().clamp(2.0, 30.0);
        let d = ((depth[0] + depth[1]) * 0.5).clamp(36.0, 64.0);
        // Room to skip wet or blocked stretches.
        (d, (farms / 2.0).ceil() * 50.0 * 1.6 + 20.0)
    };
    let c = site.center;
    // Axis: the road itself when it passes close, else a local lane.
    let (axis, half, mut streets, along) = match near {
        Some(n) if n.distance < depth + 60.0 => {
            let (road, station) = through(roads, n.road, n.station, length);
            let start = window(&road, station, length, depth, &surface);
            (
                slice(&road, start, start + length),
                road_half(n),
                vec![],
                n.tangent,
            )
        }
        _ => {
            let along = near
                .as_ref()
                .map_or(Point { x: 1.0, y: 0.0 }, |n| n.tangent);
            let a = at(c, along, -length * 0.5);
            let b = at(c, along, length * 0.5);
            let width: f64 = if village { 5.0 } else { 3.5 };
            let mut path = match near {
                Some(n) => {
                    let start = if dist(n.point, a) < dist(n.point, b) {
                        a
                    } else {
                        b
                    };
                    let mut p = track(surface, n.point, start, cfg.max_lane_grade);
                    p.push(if start == a { b } else { a });
                    p
                }
                None => vec![a, b],
            };
            path.dedup_by(|p, q| dist(*p, *q) < 1e-6);
            let rank = if village { 2 } else { 3 };
            let role = if village { "street" } else { "lane" };
            let axis = vec![a, b];
            (
                axis,
                width * 0.5,
                vec![street(path, width, rank, role)],
                along,
            )
        }
    };
    let total = *arc(&axis).last().unwrap_or(&0.0);
    if total < 20.0 {
        return None;
    }
    let mut blocked = obstacles.to_vec();
    for s in &streets {
        if s.path.len() > 2 {
            blocked.extend(g::ribbon(&s.path[..s.path.len() - 1], &[s.widths[0]]));
        }
    }
    let mut blocks: Vec<(Shape, &'static str)> = vec![];
    if village {
        // Cross-lanes every 110-200 m lead from the street to the fields.
        let mut cuts = vec![];
        let mut s = rng.range(90.0, 160.0);
        while s < total - 60.0 {
            let (p, d) = point_at(&axis, s);
            let n = perp(d);
            for sign in [-1.0, 1.0] {
                let end = at(p, n, sign * (half + depth + 10.0));
                cuts.push(street(vec![p, end], 3.5, 3, "lane"));
            }
            s += rng.range(110.0, 200.0);
        }
        let cut_shapes: Vec<Shape> = cuts
            .iter()
            .flat_map(|l| g::ribbon(&l.path, &l.widths))
            .collect();
        // A green (Anger) at the middle of one side, with the church nearby.
        let mid = total * 0.5;
        let green = side(
            &slice(&axis, mid - 32.0, mid + 32.0),
            half,
            depth.min(48.0),
            true,
        );
        for left in [true, false] {
            let Some(strip) = side(&axis, half, depth, left) else {
                continue;
            };
            let mut pieces = vec![strip];
            for cut in cut_shapes.iter().chain(green.iter().filter(|_| left)) {
                pieces = pieces.iter().flat_map(|p| g::difference(p, cut)).collect();
            }
            for p in pieces {
                if let Some(p) = settle(&p, &blocked, &surface, 0.5).filter(|p| g::area(p) > 600.0)
                {
                    blocks.push((p, "block"));
                }
            }
        }
        if let Some(green) = green.and_then(|g| settle(&g, &blocked, &surface, 0.5)) {
            blocks.push((green, "place"));
        }
        streets.extend(cuts);
    } else {
        // Separate farms, alternating sides, with fields between them.
        let farms = (pop / 5.0).ceil().clamp(2.0, 30.0) as usize;
        let mut station = [rng.range(0.0, 15.0), rng.range(10.0, 30.0)];
        // Start the farms around the middle of the axis.
        let spare = (total - (farms as f64 / 2.0).ceil() * 50.0).max(0.0) * 0.5;
        station = station.map(|s| s + spare * 0.6);
        let mut turn = 0usize;
        while blocks.len() < farms && station.iter().any(|&s| s + 28.0 < total) {
            turn += 1;
            let mut left = turn % 2 == 0;
            if station[usize::from(!left)] + 28.0 >= total {
                left = !left;
            }
            let k = usize::from(!left);
            let w = rng.range(28.0, 44.0);
            let d = depth * rng.range(0.85, 1.15);
            if station[k] + w > total {
                station[k] = total;
                continue;
            }
            let sub = slice(&axis, station[k], station[k] + w);
            station[k] += w + if rng.chance(0.3) {
                0.0
            } else {
                rng.range(6.0, 26.0)
            };
            if let Some(p) =
                side(&sub, half, d, left).and_then(|p| settle(&p, &blocked, &surface, 0.6))
            {
                // Plots on a curve must not overlap their neighbours.
                if blocks
                    .iter()
                    .all(|(b, _)| g::intersection(b, &p).iter().map(g::area).sum::<f64>() < 1.0)
                {
                    blocks.push((p, "block"));
                }
            }
        }
    }
    let center = point_at(&axis, total * 0.5).0;
    Some(Plan {
        blocks,
        streets,
        center,
        axis: along,
    })
}

/// Tents or huts on both sides of a ring way around an open centre, cut into
/// sectors; a track joins the ring to the road.
fn camp(
    site: &Site,
    cfg: &LayoutConfig,
    near: &Option<Near>,
    obstacles: &[Shape],
    surface: Surface<'_>,
    rng: &mut Rng,
) -> Option<Plan> {
    let tents = (f64::from(site.population) / 6.0).ceil().max(2.0);
    let depth = 14.0;
    let half = 1.5;
    // Ring length ≈ tents along both sides at ~7 m each.
    let radius = (tents * 7.0 / 2.0 / std::f64::consts::TAU).clamp(14.0, 220.0);
    let c = site.center;
    let n = 24;
    let mut ring: Vec<Point> = (0..=n)
        .map(|i| {
            let a = i as f64 * std::f64::consts::TAU / n as f64;
            at(
                c,
                Point {
                    x: a.cos(),
                    y: a.sin(),
                },
                radius,
            )
        })
        .collect();
    ring[n] = ring[0];
    let sectors = ((tents / 4.0).ceil() as usize).clamp(4, 16);
    let gaps: Vec<Shape> = (0..sectors)
        .flat_map(|k| {
            let a = (k as f64 + rng.range(-0.1, 0.1)) * std::f64::consts::TAU / sectors as f64;
            let d = Point {
                x: a.cos(),
                y: a.sin(),
            };
            g::ribbon(
                &[
                    at(c, d, radius - depth - 6.0),
                    at(c, d, radius + depth + 6.0),
                ],
                &[2.5],
            )
        })
        .collect();
    let inner = g::ribbon(&ring, &[half * 2.0]);
    let band = g::ribbon(&ring, &[(half + depth) * 2.0]);
    let mut pieces: Vec<Shape> = band
        .iter()
        .flat_map(|o| {
            inner.iter().fold(vec![o.clone()], |acc, i| {
                acc.iter().flat_map(|s| g::difference(s, i)).collect()
            })
        })
        .collect();
    for gap in &gaps {
        pieces = pieces.iter().flat_map(|p| g::difference(p, gap)).collect();
    }
    let mut blocks: Vec<(Shape, &'static str)> = pieces
        .iter()
        .filter_map(|p| settle(p, obstacles, &surface, 0.5))
        .filter(|p| g::area(p) > 40.0)
        .map(|p| (p, "block"))
        .collect();
    // The open centre: a common for herds, fires and gatherings.
    let centre_radius = radius - half - depth - 2.0;
    if centre_radius > 6.0 {
        let disc = Shape {
            outer: (0..n)
                .map(|i| {
                    let a = i as f64 * std::f64::consts::TAU / n as f64;
                    at(
                        c,
                        Point {
                            x: a.cos(),
                            y: a.sin(),
                        },
                        centre_radius,
                    )
                })
                .collect(),
            holes: vec![],
        };
        if let Some(d) = settle(&g::normalized(disc), obstacles, &surface, 0.5) {
            blocks.push((d, "place"));
        }
    }
    let mut streets = vec![street(ring.clone(), half * 2.0, 3, "track")];
    if let Some(n) = near.as_ref().filter(|n| n.distance > radius) {
        let entry = at(c, unit(c, n.point), radius);
        streets.push(street(
            track(surface, n.point, entry, cfg.max_lane_grade),
            half * 2.0,
            3,
            "track",
        ));
    }
    Some(Plan {
        blocks,
        streets,
        center: c,
        axis: Point { x: 1.0, y: 0.0 },
    })
}

#[cfg(test)]
mod tests {
    use super::super::{
        LayoutConfig, ParcelConfig, Site, Street, Surface, generate_parcels, generate_quarters,
    };
    use super::*;

    fn run(population: u32, cfg: &LayoutConfig) -> (Layout, super::super::Partition) {
        let n = 128;
        let height = vec![0.0; n * n];
        let water = vec![0u8; n * n];
        let surface = Surface {
            geometry: None,
            width: 8000.0,
            n,
            height: &height,
            water: &water,
        };
        let road = Street {
            path: vec![
                Point {
                    x: 500.0,
                    y: 4020.0,
                },
                Point {
                    x: 7500.0,
                    y: 3980.0,
                },
            ],
            widths: vec![6.0, 6.0],
            rank: 0,
            role: "regional".into(),
        };
        let site = Site {
            key: "kind".into(),
            name: String::new(),
            population,
            culture: "european-organic".into(),
            center: Point {
                x: 4000.0,
                y: 4060.0,
            },
            radius: crate::settlements::extent_radius(population),
        };
        let layouts = generate_quarters("kinds", &[site], cfg, surface, &[road]).unwrap();
        let partitions = generate_parcels("kinds", &layouts, &ParcelConfig::default()).unwrap();
        (layouts[0].clone(), partitions[0].clone())
    }

    /// A plot strip along a bending road is one piece on the requested side,
    /// even when a bend lies close to the end of a short slice.
    #[test]
    fn a_strip_along_a_bending_road_is_one_piece() {
        let road: Vec<Point> = (0..40)
            .map(|i| {
                let x = f64::from(i) * 20.0;
                Point {
                    x,
                    y: 30.0 * (x / 160.0).sin(),
                }
            })
            .collect();
        for (a, b) in [(0.0, 760.0), (95.0, 135.0), (210.0, 250.0)] {
            let path = slice(&road, a, b);
            let length = *arc(&path).last().unwrap();
            for left in [true, false] {
                let strip = side(&path, 3.0, 60.0, left).unwrap();
                let ratio = g::area(&strip) / (length * 60.0);
                assert!((0.85..1.15).contains(&ratio), "{a}-{b} {left}: {ratio}");
                // The strip lies on the requested side of the road.
                let c = g::interior_point(&strip);
                let (_, _, q) = path
                    .windows(2)
                    .map(|w| g::distance(c, w[0], w[1]))
                    .min_by(|x, y| x.0.total_cmp(&y.0))
                    .unwrap();
                let n = perp(point_at(&path, length * 0.5).1);
                assert_eq!((c.x - q.x) * n.x + (c.y - q.y) * n.y > 0.0, left);
            }
        }
    }

    /// One focused test per end of the range: an 8-inhabitant farmstead is one
    /// plot with one farm (house + barn + yard) on a track, no quarter grid; a
    /// 300 000-inhabitant metropolis has several centres (wards), an absorbed
    /// village and an old circuit turned boulevard.
    #[test]
    fn a_farmstead_is_one_farm_and_a_metropolis_has_wards() {
        let (l, p) = run(8, &LayoutConfig::default());
        assert_eq!(l.archetype, "farmstead");
        assert_eq!(l.quarters.len(), 1, "no quarter grid");
        assert!(l.enclosures.is_empty());
        assert!(
            l.streets
                .iter()
                .all(|s| matches!(s.role.as_str(), "regional" | "track")),
            "{:?}",
            l.streets.iter().map(|s| &s.role).collect::<Vec<_>>()
        );
        let built: Vec<_> = p
            .programme
            .as_ref()
            .unwrap()
            .allocations
            .iter()
            .filter(|a| !a.role.starts_with("open."))
            .collect();
        assert!((1..=3).contains(&built.len()), "{built:?}");
        assert!(built.iter().any(|a| a.role.starts_with("dwelling.farm")));
        // The user's configuration is kept on the layout.
        assert_eq!(l.config.as_ref().unwrap().programme.role, "auto");

        let (m, _) = run(300_000, &LayoutConfig::default());
        assert_eq!(m.archetype, "metropolis");
        let s = m.structure.as_ref().unwrap();
        assert!(s.centers.len() >= 3, "{} centres", s.centers.len());
        let wards: std::collections::BTreeSet<_> = s.districts.iter().map(|d| d.center).collect();
        assert!(
            wards.len() >= 3,
            "districts lean on {} centres",
            wards.len()
        );
        assert!(m.phases.iter().any(|p| p.kind == "absorbed-village"));
        assert!(
            m.streets.iter().any(|s| s.role == "ring"),
            "old wall line as boulevard"
        );
    }
}
