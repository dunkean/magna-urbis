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
use crate::settlements::demographics;

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

/// Site archetypes where a small town is worth a wall, or a village clusters.
const DEFENSIVE: [&str; 4] = ["hilltop", "spur", "pass", "island"];
/// Cultures whose villages are enclosed by definition: the draw that leaves most villages open skips them.
const FORTIFIED_VILLAGES: [&str; 10] = [
    "kraal", "maori-pa", "guarani-village", "mississippian", "native-iroquoian",
    "nubian-fortified", "ksar-oasis", "levantine-tell", "celtic-oppidum", "norse-ringfort",
];

fn culture<'a>(site: &'a Site, cfg: &'a LayoutConfig) -> &'a str {
    if cfg.culture == "site" {
        &site.culture
    } else {
        &cfg.culture
    }
}

/// The actual chosen native preset declares its camp layout. Automatic
/// cultural recipes follow their existing grown-profile transition. The older
/// nomad catalogue can still declare a ring through `camp.layout`; no culture
/// name list is maintained here. Explicit presets never borrow that fallback.
fn camp_preset_params(culture: &str, population: u32, cfg: &LayoutConfig) -> &'static serde_json::Value {
    let recipe = if cfg.recipe == "auto" {
        composition::recipe(culture, population, "core")
    } else {
        cfg.recipe.clone()
    };
    let preset = if cfg.preset == "culture" { format!("{culture}/{recipe}") } else { cfg.preset.clone() };
    &super::catalogue()["presets"][preset]["params"]
}

pub(in crate::urban) fn native_camp(culture: &str, population: u32, cfg: &LayoutConfig) -> bool {
    let params = camp_preset_params(culture, population, cfg);
    params["campLayout"].as_str().is_some_and(|layout| !layout.is_empty())
        || organic_camp(culture, population, params)
}

/// A camp laid out as a ring round its centre (kraal, tipis, yurts, guarani
/// plaza): no quay or landing row belongs to it.
pub(in crate::urban) fn ring_camp(culture: &str, population: u32, cfg: &LayoutConfig) -> bool {
    camp_preset_params(culture, population, cfg)["campLayout"] == "ring"
}

// A clustered footpath camp keeps its organic cut, including below the
// hamlet threshold. The selected recipe must still declare that grammar.
fn organic_camp(culture: &str, population: u32, params: &serde_json::Value) -> bool {
    params["parcellation"] == "organic" && params["footpathWidth"].as_f64().is_some_and(|w| w > 0.0)
        && composition::culture_data(culture, population)["village"]["form"] == "ring"
}

fn cultural_camp(culture: &str, population: u32, cfg: &LayoutConfig) -> bool {
    let params = camp_preset_params(culture, population, cfg);
    if !params.is_object() { return false; }
    if organic_camp(culture, population, params) { return true; }
    if let Some(layout) = params.get("campLayout") {
        return layout.as_str().is_some_and(|s| !s.is_empty());
    }
    cfg.preset == "culture" && cfg.recipe == "auto"
        && composition::culture_data(culture, population)["camp"]["layout"].as_str() == Some("ring")
}

/// Ring geometry of a figure camp (catalogue `camp*` fields) as the parcels'
/// camp forms read it; a court camp grown into rings (`campGrowth`) pitches
/// its tents closer, around a court open to its bearing.
pub(in crate::urban) struct RingGeometry {
    pub spacing: f64,
    pub depth: f64,
    pub path: f64,
    pub gap: f64,
    pub centre: f64,
}
pub(in crate::urban) fn ring_geometry(morph: &Morph) -> RingGeometry {
    let [lo, hi] = morph.pair("campArc");
    let mut g = RingGeometry {
        spacing: 0.5 * (lo.max(4.0) + hi.max(lo.max(4.0))),
        depth: morph.number_or("campRow", 10.0).max(4.0),
        path: morph.number_or("campPath", 3.0).clamp(1.2, 8.0),
        gap: morph.number_or("campGap", 0.0).clamp(0.0, 150.0).to_radians(),
        centre: morph.number_or("campCentre", 0.3),
    };
    if morph.text("campForm") == "court" {
        g.spacing = (0.6 * g.spacing).max(g.depth);
        g.gap = g.gap.max(30f64.to_radians());
        g.centre = g.centre.max(0.3);
    }
    g
}
/// Dwellings of the first ring of a concentric camp (`campRingMax`, else
/// by figure): the rest stands on full rows around it.
pub(in crate::urban) fn camp_ring_max(morph: &Morph) -> usize {
    let d = match morph.text("campForm") {
        "horseshoe" => 40.0,
        "court" => 50.0,
        _ => 60.0,
    };
    morph.number_or("campRingMax", d).max(8.0) as usize
}
/// Dwellings of one figure before a clustered camp founds a daughter camp
/// (`campUnitMax`, else by figure).
pub(in crate::urban) fn camp_unit_max(morph: &Morph) -> usize {
    let u = morph.number_or("campUnitMax", 0.0);
    if u >= 3.0 {
        u as usize
    } else if morph.text("campForm") == "court" {
        80
    } else {
        60
    }
}
/// Outer radius (circle estimate) of a ring figure of `k` dwellings whose
/// first row holds at most `cap`, the next rows full.
pub(in crate::urban) fn ring_extent(k: usize, cap: usize, g: &RingGeometry) -> f64 {
    let span = std::f64::consts::TAU - g.gap;
    let r = (k.min(cap) as f64 * g.spacing / span).max(g.depth * (1.0 + 2.0 * g.centre)).max(12.0);
    let (mut left, mut rows) = (k, 0usize);
    while left > 0 && rows < 16 {
        let c = (((r + rows as f64 * (g.depth + g.path)) * span / g.spacing).floor() as usize).max(1);
        left = left.saturating_sub(c);
        rows += 1;
    }
    r + rows.max(1) as f64 * (g.depth + g.path)
}
/// Outer radius of a Mongol ordu of `k` tents at `spacing`: its court, then
/// family groups (ails) on about 2.6 spacing² of ground per tent.
pub(in crate::urban) fn court_extent(k: usize, spacing: f64) -> f64 {
    let rc = (2.5 * spacing).max(30.0).max((2.0 * spacing).max(26.0)) + spacing;
    (rc * rc + k as f64 * 2.6 * spacing * spacing / std::f64::consts::PI).sqrt() * 1.15
}
/// Land (m²) a figure camp grown past one figure (`campGrowth` concentric or
/// clusters) needs: its rows or its daughter camps, deformed and spaced.
/// `None` for the default single figure, whose land is left as sized.
pub(in crate::urban) fn camp_growth_land(site: &Site, cfg: &LayoutConfig, morph: &Morph) -> Option<f64> {
    let form = morph.text("campForm");
    if cfg.camp_growth == "ring" || morph.text("campLayout").is_empty() || !matches!(form, "circle" | "horseshoe" | "court") {
        return None;
    }
    let culture = culture(site, cfg);
    if !native_camp(culture, site.population, cfg) {
        return None;
    }
    let n = (super::footprint::capacity::households(culture, site.population) * 1.2).ceil().max(3.0) as usize;
    let g = ring_geometry(morph);
    let pi = std::f64::consts::PI;
    if cfg.camp_growth == "clusters" {
        let units = n.div_ceil(camp_unit_max(morph)).max(1);
        let k = n.div_ceil(units);
        let cap = camp_ring_max(morph).min(k.div_ceil(2)).max(12);
        let r = if form == "court" { court_extent(k, g.spacing) } else { 1.2 * ring_extent(k, cap, &g) };
        // Radius of the circle enclosing `units` equal discs, with slack
        // for an irregular land.
        let enclose = match units { 1 => 1.0, 2 => 2.0, 3 => 2.155, 4 => 2.414, 5 => 2.701, 6 | 7 => 3.0, u => (u as f64 / 0.7).sqrt() };
        return Some(pi * (1.35 * enclose * (r + g.depth + g.path)).powi(2));
    }
    let r = 1.2 * ring_extent(n, camp_ring_max(morph), &g);
    Some(pi * (r + 2.0 * g.depth).powi(2))
}

pub(super) fn resolve(site: &Site, cfg: &LayoutConfig, roads: &[Street]) -> Kind {
    if let Some(kind) = Kind::from_id(&cfg.settlement_form) {
        return kind;
    }
    let culture = culture(site, cfg);
    let pop = site.population;
    let state = cfg.programme.state.as_str();
    let role = cfg.programme.intent.as_str();
    if roles::is_isolated(role) {
        return if state == "ruined" {
            Kind::Ruin
        } else if role == "isolated-farm" {
            Kind::Farmstead
        } else {
            Kind::Single
        };
    }
    // The automatic grammar follows the shared demographic class
    // (settlements/demographic_classes.json): one classification, no second set
    // of population bands. Only the town class keeps grammar sub-steps (walls,
    // district city) that depend on culture and site, not on a new class.
    let class = demographics::class_of(pop);
    if class == "farmstead" {
        return if state == "ruined" {
            Kind::Ruin
        } else {
            Kind::Farmstead
        };
    }
    if cfg.settlement_form == "auto" && pop < 5000 && cultural_camp(culture, pop, cfg) {
        return Kind::Camp;
    }
    match class {
        "hamlet" => return Kind::Hamlet,
        "village" => {
            return match cfg.settlement_form.as_str() {
                "ribbon" => Kind::StreetVillage,
                "nucleated" => Kind::NucleatedVillage,
                _ => village_form(site, cfg, culture, roads),
            };
        }
        "city" => return Kind::City,
        "metropolis" | "megacity" => return Kind::Metropolis,
        _ => {}
    }
    let fortifies = profiles::fortification(
        profiles::settlement_profile(culture, pop, 3),
        requested_enclosure(cfg),
        pop,
    ) != "none";
    let defensive = DEFENSIVE.contains(&cfg.site_archetype.as_str());
    if pop < 5000 {
        if fortifies && (pop >= 2500 || defensive) {
            Kind::WalledTown
        } else {
            Kind::MarketTown
        }
    } else if fortifies {
        Kind::WalledTown
    } else {
        Kind::City
    }
}
/// Enclosure type precedence: explicit type (`wall`, `palisade`, `none`) >
/// explicit style (its family: a bastioned style asks for a wall) > named
/// profile (`culture`, resolved by `profiles::fortification`) > grammar default
/// (`effective`: no enclosure for small kinds and market towns). Style
/// precedence is in `fortification::resolve`: explicit style of the same family
/// > the culture's style table (population, period, prosperity).
pub(in crate::urban) fn requested_enclosure(cfg: &LayoutConfig) -> &str {
    if cfg.fortification == "culture" && cfg.fortification_style != "auto" {
        super::fortification::family(&cfg.fortification_style)
    } else {
        &cfg.fortification
    }
}

/// Street village where a through road carries the place (bridge, pass,
/// valley floor) and the culture has no clustered village form; clustered on
/// heights, islands and shores; otherwise a deterministic draw per site.
fn village_form(site: &Site, cfg: &LayoutConfig, culture: &str, roads: &[Street]) -> Kind {
    let form = composition::culture_data(culture, site.population)["village"]["form"]
        .as_str()
        .unwrap_or("auto");
    // A culture whose village has an enclosure grammar of its own (oval, square,
    // organic, terraced) is a clustered village; the street ribbon is for the
    // cultures that have no village plan.
    let shaped = !composition::culture_data(culture, site.population)["village"]["enclosure"]["shape"]
        .is_null();
    if form != "auto" || shaped || nearest(site.center, roads, site.radius.max(80.0)).is_none() {
        return Kind::NucleatedVillage;
    }
    match cfg.site_archetype.as_str() {
        "hilltop" | "spur" | "island" | "harbor" | "lakeshore" => Kind::NucleatedVillage,
        "bridge" | "pass" => Kind::StreetVillage,
        // A ribbon of a few hundred inhabitants is already a kilometre of road: past 350
        // people the village gathers round its centre instead.
        _ if site.population >= 350 => Kind::NucleatedVillage,
        "valley" => Kind::StreetVillage,
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
/// culture`, the default three epochs, `programme.intent: settlement`). The kind id is
/// written to `settlement_form`, so resolving the effective config again gives
/// the same kind.
pub(super) fn effective(site: &Site, cfg: &LayoutConfig, roads: &[Street]) -> (LayoutConfig, Kind) {
    let kind = resolve(site, cfg, roads);
    let mut c = cfg.clone();
    // Saved pre-refactor scenes keep their former geometry.
    if cfg.footprint.mechanism == "legacy" {
        return (c, kind);
    }
    // An explicit style is an override: it fixes the enclosure type before the
    // grammar's « no wall below a market town » default (which only replaces `culture`).
    c.fortification = requested_enclosure(cfg).into();
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
            // Native camp grammars own their enclosure (e.g. the kraal hedge).
            // A legacy camp still keeps the former generic, unfortified plan.
            let native_camp = kind == Kind::Camp
                && native_camp(culture(site, cfg), site.population, cfg);
            if !native_camp {
                set(&mut c.fortification, "culture", "none");
            }
            if default_epochs {
                c.footprint.epochs = 1;
            }
            if matches!(kind, Kind::Farmstead | Kind::Ruin) && c.programme.intent == "settlement" {
                c.programme.intent = "isolated-farm".into();
            }
        }
        Kind::StreetVillage | Kind::NucleatedVillage => {
            set(&mut c.suburbs, "auto", "none");
            set(&mut c.peripheral_road, "auto", "none");
            // A culture's wall belongs to its towns: only a few villages are enclosed, by a deterministic
            // draw per site (likelier on defensive sites and for larger villages), except where the
            // enclosure is the settlement's identity (ringforts, pā, kraals, ksour, palisaded villages).
            if c.fortification == "culture" && !FORTIFIED_VILLAGES.contains(&culture(site, cfg)) {
                let grown = ((site.population as f64 - 200.0) / 1000.0).clamp(0.0, 1.0);
                let base = if DEFENSIVE.contains(&cfg.site_archetype.as_str()) { 0.3 } else { 0.08 };
                if !Rng::new(&format!("village-wall:{}", site.key)).chance(base + 0.15 * grown) {
                    c.fortification = "none".into();
                }
            }
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

/// Share of its planned area a roadside isolated plot keeps to count whole.
const WHOLE_PLOT: f64 = 0.85;
/// How far an isolated mill seeks water from its site (m).
const MILL_REACH: f64 = 1000.0;

/// The bank nearest to `p` within `reach`: the first dry point stepping
/// from the nearest water toward `p`, and that direction (inland). None when
/// no water lies within reach.
fn bank(surface: &Surface<'_>, p: Point, reach: f64) -> Option<(Point, Point)> {
    let cell = surface.width / surface.n as f64;
    let r = (reach / cell).ceil() as i64;
    let (ci, cj) = ((p.x / cell) as i64, (p.y / cell) as i64);
    let last = surface.n as i64 - 1;
    let mut best: Option<(f64, Point)> = None;
    for j in (cj - r).max(0)..=(cj + r).min(last) {
        for i in (ci - r).max(0)..=(ci + r).min(last) {
            let q = Point {
                x: (i as f64 + 0.5) * cell,
                y: (j as f64 + 0.5) * cell,
            };
            let d = dist(p, q);
            if d <= reach && best.is_none_or(|b| d < b.0) && surface.wet(q) {
                best = Some((d, q));
            }
        }
    }
    let (d, water) = best?;
    let inland = unit(water, p);
    let mut t = 0.0;
    while t <= d {
        let q = at(water, inland, t);
        if !surface.wet(q) {
            return Some((q, inland));
        }
        t += 0.5;
    }
    None
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
    // These camps already have the shared quarter + parcels/camp grammar.
    // Returning None delegates to the caller's existing quarter pipeline;
    // do not first replace its land with the legacy annular band below.
    if kind == Kind::Camp && (!morph.text("campLayout").is_empty()
        || organic_camp(culture(site, cfg), site.population, &morph.value))
        && native_camp(culture(site, cfg), site.population, cfg)
    {
        return None;
    }
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
    // A road through a village or hamlet is its street: never narrower than
    // the place's through rank (`network::town_roads` widens it the same way).
    let table = super::network::town_table(morph, site.population, cfg.road_width_by_size);
    let through = if !cfg.town_main_road { 0.0 } else if kind == Kind::StreetVillage { table[1] } else { table[2] };
    let road_half = |n: &Near| {
        roads[n.road]
            .widths
            .iter()
            .copied()
            .fold(0.0_f64, f64::max)
            .max(3.0)
            .max(if matches!(kind, Kind::Hamlet | Kind::StreetVillage) { through } else { 0.0 })
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
    if cfg.town_main_road && matches!(kind, Kind::Hamlet | Kind::StreetVillage) {
        super::network::town_roads(&mut streets, &shapes, through);
    }
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
        shanty: None,
        spring_sites: vec![],
        gate_village_centers: vec![],
        gate_village_lanes: vec![],
        quays: vec![],
        waterways: vec![],
        port_districts: vec![],
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

/// City Bench `activity` intent: one `activities.json` site as the whole place. Its
/// buildings (laid again by `building_sites` from the centre and axis kept in the
/// structure) stand in one plot hugging the yard, its installations around it as
/// ground blocks, a track to the nearest road. A water-working template stands on a bank.
fn activity_plot(site: &Site, cfg: &LayoutConfig, near: &Option<Near>, obstacles: &[Shape], surface: Surface<'_>) -> Option<Plan> {
    // The site itself first, then rings of other centres round it: a road junction or a slope may refuse it.
    let ring = (0..=32).map(|k| if k == 0 { (0.0, 0.0) } else { let (r, i) = ([70.0, 120.0, 180.0, 260.0][(k - 1) / 8], ((k - 1) % 8) as f64); (r, i * std::f64::consts::FRAC_PI_4) });
    for (r, angle) in ring {
        let origin = Point { x: site.center.x + r * angle.cos(), y: site.center.y + r * angle.sin() };
        if let Some(plan) = activity_try(site, cfg, near, obstacles, surface, origin) {
            return Some(plan);
        }
    }
    eprintln!("activity_plot {}: no centre found round ({:.0},{:.0})", cfg.programme.template, site.center.x, site.center.y);
    None
}

#[allow(clippy::too_many_arguments)]
fn activity_try(site: &Site, cfg: &LayoutConfig, near: &Option<Near>, obstacles: &[Shape], surface: Surface<'_>, origin: Point) -> Option<Plan> {
    use super::activities as act;
    let template = cfg.programme.template.as_str();
    let culture = culture(site, cfg);
    let bank = act::site_wants_water(template).then(|| bank(&surface, origin, MILL_REACH)).flatten();
    let mut c = bank.map_or(origin, |(q, inland)| at(q, inland, 36.0));
    // Clear of the road (a site on the road itself steps aside, across it).
    if bank.is_none()
        && let Some(n) = near
        && dist(c, n.point) < 55.0
    {
        let away = if dist(c, n.point) > 0.5 { unit(n.point, c) } else { perp(n.tangent) };
        c = at(c, away, 55.0 - dist(c, n.point));
    }
    let toward = bank.map_or_else(|| near.as_ref().map_or(Point { x: 0.0, y: 1.0 }, |n| unit(c, n.point)), |(_, inland)| inland);
    let u = perp(toward);
    let v = perp(u);
    let yard = act::site_yard(template, culture, &site.key, c, u.y.atan2(u.x), &surface);
    if yard.is_empty() {
        return None;
    }
    // Oriented rectangle over the yard, a margin round it.
    let (mut s0, mut s1, mut t0, mut t1) = (f64::MAX, f64::MIN, f64::MAX, f64::MIN);
    for p in yard.iter().flat_map(|b| &b.ring) {
        let (s, t) = ((p.x - c.x) * u.x + (p.y - c.y) * u.y, (p.x - c.x) * v.x + (p.y - c.y) * v.y);
        (s0, s1, t0, t1) = (s0.min(s), s1.max(s), t0.min(t), t1.max(t));
    }
    // The plot holds at least the envelope the programme admits for an isolated lot of
    // this culture (frontage along u, depth along v): a small yard (a shrine, a yard
    // that lost a body on the shore) otherwise leaves no admissible block to reserve.
    if let Some(m) = super::culture::isolated_mapping(culture, &cfg.programme.period, &cfg.programme.intent) {
        let grow = |lo: &mut f64, hi: &mut f64, need: f64| {
            let extra = (need - (*hi - *lo + 10.0)).max(0.0) * 0.5;
            *lo -= extra;
            *hi += extra;
        };
        grow(&mut s0, &mut s1, m.admissibility.min_frontage + 2.0 * m.admissibility.min_access_width + 1.0);
        grow(&mut t0, &mut t1, m.admissibility.min_depth + 1.0);
    }
    let corner = |s: f64, t: f64| Point { x: c.x + u.x * s + v.x * t, y: c.y + u.y * s + v.y * t };
    let plot = Shape { outer: vec![corner(s0 - 5.0, t0 - 5.0), corner(s1 + 5.0, t0 - 5.0), corner(s1 + 5.0, t1 + 5.0), corner(s0 - 5.0, t1 + 5.0)], holes: vec![] };
    // The front edge faces the road (or inland): a track runs along it, joined to the road, so
    // the plot has the street frontage the programme asks of an isolated lot.
    let want = near.as_ref().filter(|n| dist(c, n.point) > 1.0).map_or(toward, |n| unit(c, n.point));
    let mid = plot.outer.iter().fold(Point { x: 0.0, y: 0.0 }, |m, p| Point { x: m.x + p.x * 0.25, y: m.y + p.y * 0.25 });
    let (a, b, out) = (0..4)
        .map(|i| {
            let (a, b) = (plot.outer[i], plot.outer[(i + 1) % 4]);
            let n = unit(mid, Point { x: (a.x + b.x) * 0.5, y: (a.y + b.y) * 0.5 });
            (a, b, n)
        })
        .max_by(|p, q| (p.2.x * want.x + p.2.y * want.y).total_cmp(&(q.2.x * want.x + q.2.y * want.y)))?;
    let (a, b) = (at(a, out, 1.55), at(b, out, 1.55));
    let mut blocked = obstacles.to_vec();
    let mut path = match near {
        Some(n) if dist(c, n.point) > 20.0 => {
            let (start, end) = if dist(n.point, a) < dist(n.point, b) { (a, b) } else { (b, a) };
            let mut p = track(surface, n.point, start, cfg.max_lane_grade);
            p.push(end);
            p
        }
        _ => vec![a, b],
    };
    path.dedup_by(|p, q| dist(*p, *q) < 1e-6);
    if path.len() > 2 {
        blocked.extend(g::ribbon(&path[..path.len() - 1], &[3.0]));
    }
    let streets = vec![street(path, 3.0, 3, "track")];
    let Some(plot) = settle(&plot, &blocked, &surface, 0.5) else {
        return None;
    };
    // Every body of the yard stands on its plot: a road or a bank cutting the plot through
    // a building refuses this centre (the next one round the site is tried).
    if !yard.iter().all(|b| b.ring.iter().all(|&p| g::contains(&plot, p))) {
        return None;
    }
    let mut blocks = vec![(plot.clone(), "block")];
    blocked.push(plot.clone());
    let outside = |p: Point| g::contains(&plot, p);
    for inst in act::site_installations(template, culture, &site.key, c, &yard, &surface, &outside) {
        let kind = match inst.kind.as_str() {
            "enclosure" | "water_structure" => "common",
            "terrace" => "garden",
            _ => "place",
        };
        let shapes = if inst.closed {
            vec![g::normalized(Shape { outer: inst.points.clone(), holes: vec![] })]
        } else {
            g::ribbon(&inst.points, &vec![2.5; inst.points.len()])
        };
        for shape in shapes {
            // The dry pieces of the installation clear of the plot and the roads (a weir or a
            // pier crossing water keeps its shore ends).
            let mut pieces = g::dry_clip(&surface, &shape);
            for o in &blocked {
                pieces = pieces.iter().flat_map(|s| g::difference(s, o)).collect();
            }
            blocks.extend(pieces.into_iter().filter(|s| g::area(s) > 6.0).map(|s| (s, kind)));
        }
    }
    Some(Plan { center: c, blocks, streets, axis: u })
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
    if cfg.programme.intent == "activity" {
        return activity_plot(site, cfg, near, obstacles, surface);
    }
    let (w, d) = plot_size(kind, &cfg.programme.intent, rng);
    // A mill stands on its race: on the nearest bank within reach, its plot
    // backing onto the water (dry-clipped to the bank by `settle`).
    let bank = (cfg.programme.intent == "isolated-mill")
        .then(|| bank(&surface, site.center, MILL_REACH))
        .flatten();
    let c = bank.map_or(site.center, |(q, inland)| at(q, inland, d * 0.5 - 3.0));
    if bank.is_none()
        && let Some(n) = near
    {
        let half = road_half(n);
        if n.distance <= d * 0.5 + half + 40.0 {
            let toward = (c.x - n.point.x) * -n.tangent.y + (c.y - n.point.y) * n.tangent.x > 0.0;
            let plan = |plot: Shape| Plan {
                center: g::interior_point(&plot),
                blocks: vec![(plot, "block")],
                streets: vec![],
                axis: n.tangent,
            };
            // The whole planned plot first (« un bâtiment isolé a son
            // terrain »): stations stepped along the road away from the
            // junction that would cut it, then the best partial plot.
            let mut partial = None;
            for k in [0.0, 1.0, -1.0, 2.0, -2.0] {
                let station = n.station + k * w;
                let path = slice(&roads[n.road].path, station - w * 0.5, station + w * 0.5);
                for left in [toward, !toward] {
                    let Some(plot) = side(&path, half, d, left)
                        .and_then(|p| settle(&p, obstacles, &surface, 0.6))
                    else {
                        continue;
                    };
                    if g::area(&plot) >= WHOLE_PLOT * w * d {
                        return Some(plan(plot));
                    }
                    if k == 0.0 && partial.is_none() {
                        partial = Some(plot);
                    }
                }
            }
            if let Some(plot) = partial {
                return Some(plan(plot));
            }
        }
    }
    // The front faces the road (a mill's faces inland, its back on the
    // water); a farm track runs along it.
    let toward = bank.map_or_else(
        || {
            near.as_ref()
                .map_or(Point { x: 0.0, y: 1.0 }, |n| unit(c, n.point))
        },
        |(_, inland)| inland,
    );
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

fn varied_side(path: &[Point], half: f64, depth: f64, left: bool, strength: f64, phase: f64) -> Option<Shape> {
    if strength <= 0.0 { return side(path,half,depth,left); }
    let total = *arc(path).last()?;
    let n = (total/45.0).ceil().max(1.0) as usize;
    let mut inner = vec![];
    let mut outer = vec![];
    let sign = if left {1.0} else {-1.0};
    let mut stations = arc(path);
    stations.extend((0..=n).map(|i|total*i as f64/n as f64));
    stations.sort_by(f64::total_cmp);stations.dedup_by(|a,b|(*a-*b).abs()<1e-6);
    for station in stations {
        let (p,d) = point_at(path,station);
        let normal = perp(d);
        let variation = 0.22*(station/83.0+phase).sin()+0.12*(station/37.0+phase*1.7).sin();
        inner.push(at(p,normal,sign*half));
        outer.push(at(p,normal,sign*(half+depth*(1.0+strength*variation))));
    }
    outer.reverse();inner.extend(outer);
    let mut pieces = vec![g::normalized(Shape {outer:inner,holes:vec![]})];
    for road in g::ribbon(path,&[half*2.0]) {
        pieces = pieces.iter().flat_map(|p|g::difference(p,&road)).collect();
    }
    pieces.into_iter().max_by(|a,b|g::area(a).total_cmp(&g::area(b)))
}

/// A single broad bend, keeping the junction and field end fixed. Compare just
/// two mirrored bends on the physical surface: no per-lane routing search.
fn field_lane(
    surface: Surface<'_>,
    from: Point,
    to: Point,
    bend: f64,
    grade: f64,
) -> Option<Vec<Point>> {
    let direction = unit(from, to);
    let normal = perp(direction);
    let length = dist(from, to);
    let mut best: Option<(Vec<Point>, f64)> = None;
    for offset in [bend, -bend] {
        let mut path = vec![from];
        for i in 1..4 {
            let t = i as f64 / 4.0;
            let sway = offset * (std::f64::consts::PI * t).sin().powi(2);
            path.push(at(at(from, direction, length * t), normal, sway));
        }
        path.push(to);
        if !routing::path_clear(surface, &path, grade) {
            continue;
        }
        let climb: f64 = path.windows(2)
            .map(|w| (surface.height_at(w[1]) - surface.height_at(w[0])).abs())
            .sum();
        if best.as_ref().is_none_or(|(_, cost)| climb < *cost - 1e-6) {
            best = Some((path, climb));
        }
    }
    best.map(|(path, _)| path).or_else(|| {
        routing::segment_clear(surface, from, to, grade).then(|| vec![from, to])
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
            // A compact village: house lots, never the town burgage, so the
            // ribbon stays about as long as it is wide in houses.
            ((front[0] + front[1]) * 0.5).clamp(12.0, 16.0)
        } else {
            30.0
        };
        let d = depth[1].clamp(40.0, 90.0);
        (
            d,
            (households / 2.0 * front * 1.15 + 60.0).clamp(120.0, 2400.0),
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
            let table = super::network::town_table(morph, site.population, true);
            let width: f64 = match (cfg.road_width_by_size, village) {
                (true, true) => table[1],
                (true, false) => table[3],
                (false, true) => 5.0,
                (false, false) => 3.5,
            };
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
        let lane = if cfg.road_width_by_size { super::network::town_table(morph, site.population, true)[3] } else { 3.5 };
        let mut cuts = vec![];
        let mut variation = rng.fork("v7-linear-variation");
        let mut lanes = rng.fork("street-village-field-lanes");
        let mut s = rng.range(90.0, 160.0);
        while s < total - 60.0 {
            let (p, d) = point_at(&axis, s);
            let n = perp(d);
            // A cross-lane always crosses its strip (`varied_side` deepens it up to 34 %),
            // or the strip is left uncut around a blind lane.
            let reach = half + depth * (1.0 + 0.34 * cfg.ribbon_width_variation) + 10.0;
            for sign in [-1.0, 1.0] {
                let strength = cfg.organic_branch_variation;
                // Modest variation belongs to this form even with default options.
                // Vary the field extension, rather than clamping short lanes to
                // one length; every lane must still cross the widest plot strip.
                let angle = lanes.range(-0.10, 0.10) * (1.0 + strength);
                let normal = Point {
                    x: n.x * angle.cos() - n.y * angle.sin(),
                    y: n.x * angle.sin() + n.y * angle.cos(),
                };
                let run = (reach + lanes.range(-4.0, 18.0) * (1.0 + 0.4 * strength)) / angle.cos();
                let end = at(p, normal, sign * run);
                let bend = lanes.range(1.8, 3.6) * (1.0 + 0.4 * strength)
                    * if lanes.chance(0.5) { -1.0 } else { 1.0 };
                if let Some(path) = field_lane(surface, p, end, bend, cfg.max_lane_grade) {
                    cuts.push(street(path, lane, 3, "lane"));
                }
                // Keep the optional ribbon outline's random stream unchanged.
                if strength > 0.0 {
                    variation.range(-0.20, 0.20);
                    variation.range(-0.30, 0.25);
                }
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
            let phase = if cfg.ribbon_width_variation > 0.0 { variation.range(0.0,std::f64::consts::TAU) } else {0.0};
            let Some(strip) = varied_side(&axis, half, depth, left, cfg.ribbon_width_variation, phase) else {
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
        // A cross-lane that no plot touches leads nowhere: drop it.
        cuts.retain(|lane| {
            blocks.iter().any(|(shape, kind)| {
                *kind == "block"
                    && shape
                        .outer
                        .iter()
                        .any(|&v| lane.path.windows(2).any(|w| {
                            g::distance(v, w[0], w[1]).0 < lane.widths[0] * 0.5 + 3.0
                        }))
            })
        });
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
    if cfg.camp_growth != "ring" {
        return grown_camp(site, cfg, near, obstacles, surface, rng);
    }
    // One tent per household, and a tenth more for the camp's own uses (as
    // `grown_camp`): the ring is sized for the programme it must lodge.
    let tents = (super::footprint::capacity::households(culture(site, cfg), site.population) * 1.1).ceil().max(2.0);
    let depth = 14.0;
    let half = 1.5;
    // Ring length ≈ tents along both sides at ~7 m each.
    let radius = (tents * 7.0 / 2.0 / std::f64::consts::TAU).clamp(14.0, 220.0);
    let c = site.center;
    // `ringWobble` (culture data, 0 = perfect circle): the contour swells and
    // narrows by up to that share of the radius, smoothly, so it stays a camp circle.
    let wobble = cfg.camp_ring_wobble.unwrap_or_else(|| super::catalogue()["cultures"][culture(site, cfg)]["camp"]["ringWobble"].as_f64().unwrap_or(0.0)).clamp(0.0, 0.4);
    let phases = if wobble > 0.0 { let mut w = rng.fork("ring-wobble"); [w.range(0.0, std::f64::consts::TAU), w.range(0.0, std::f64::consts::TAU), w.range(0.0, std::f64::consts::TAU)] } else { [0.0; 3] };
    let reach_at = |a: f64| radius * (1.0 + wobble * (0.5 * (2.0 * a + phases[0]).sin() + 0.3 * (3.0 * a + phases[1]).sin() + 0.2 * (5.0 * a + phases[2]).sin()));
    let n = if wobble > 0.0 { 48 } else { 24 };
    let mut ring: Vec<Point> = (0..=n)
        .map(|i| {
            let a = i as f64 * std::f64::consts::TAU / n as f64;
            at(c, Point { x: a.cos(), y: a.sin() }, reach_at(a))
        })
        .collect();
    ring[n] = ring[0];
    let sectors = ((tents / 4.0).ceil() as usize).clamp(4, 16);
    let mut bearings = vec![];
    let gaps: Vec<Shape> = (0..sectors)
        .flat_map(|k| {
            let a = (k as f64 + rng.range(-0.1, 0.1)) * std::f64::consts::TAU / sectors as f64;
            bearings.push(a);
            let d = Point {
                x: a.cos(),
                y: a.sin(),
            };
            g::ribbon(
                &[
                    at(c, d, reach_at(a) - depth - 6.0),
                    at(c, d, reach_at(a) + depth + 6.0),
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
    // Invariant: one piece per tent. Each sector is cut along the track into
    // pitches of about 7 m (the ring's sizing), so a large camp never folds
    // several households into one sector lot that houses one of them.
    let pitch_cuts: Vec<Shape> = (0..sectors)
        .flat_map(|k| {
            let (a0, a1) = (bearings[k], if k + 1 < sectors { bearings[k + 1] } else { bearings[0] + std::f64::consts::TAU });
            let mid = reach_at(0.5 * (a0 + a1));
            let n = ((a1 - a0) * mid / 7.0).round().max(1.0) as usize;
            (1..n).map(move |j| a0 + (a1 - a0) * j as f64 / n as f64).collect::<Vec<_>>()
        })
        .flat_map(|a| {
            let d = Point { x: a.cos(), y: a.sin() };
            g::ribbon(&[at(c, d, reach_at(a) - depth - 6.0), at(c, d, reach_at(a) + depth + 6.0)], &[1.0])
        })
        .collect();
    for cut in &pitch_cuts {
        let (x0, y0, x1, y1) = g::bbox(cut);
        pieces = pieces.iter().flat_map(|p| {
            let (a0, b0, a1, b1) = g::bbox(p);
            if a0 > x1 || a1 < x0 || b0 > y1 || b1 < y0 { vec![p.clone()] } else { g::difference(p, cut) }
        }).collect();
    }
    let mut blocks: Vec<(Shape, &'static str)> = pieces
        .iter()
        .filter_map(|p| settle(p, obstacles, &surface, 0.5))
        .filter(|p| g::area(p) > 40.0)
        .map(|p| (p, "block"))
        .collect();
    // The open centre: a common for herds, fires and gatherings.
    let centre_radius = radius * (1.0 - wobble) - half - depth - 2.0;
    if centre_radius > 6.0 {
        let disc = Shape {
            outer: (0..n)
                .map(|i| {
                    let a = i as f64 * std::f64::consts::TAU / n as f64;
                    at(c, Point { x: a.cos(), y: a.sin() }, (reach_at(a) - half - depth - 2.0).max(6.0))
                })
                .collect(),
            holes: vec![],
        };
        if let Some(d) = settle(&g::normalized(disc), obstacles, &surface, 0.5) {
            blocks.push((d, "place"));
        }
    }
    let mut streets = vec![street(ring.clone(), half * 2.0, 3, "track")];
    if let Some(n) = near.as_ref().filter(|n| n.distance > radius * (1.0 + wobble)) {
        let entry = at(c, unit(c, n.point), reach_at((n.point.y - c.y).atan2(n.point.x - c.x)));
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

/// A large nomad camp grown past one ring (`campGrowth`): one tent piece per
/// tent on both sides of each ring track. `concentric`: full rings around a
/// first ring of about 60 tents, joined by four radial tracks; `clusters`:
/// camps of about 40 tents around the first one, each its own ring and
/// common, joined to it by a track.
#[path = "kinds_camp_variation.rs"]
pub(in crate::urban) mod camp_variation;

fn grown_camp(
    site: &Site,
    cfg: &LayoutConfig,
    near: &Option<Near>,
    obstacles: &[Shape],
    surface: Surface<'_>,
    rng: &mut Rng,
) -> Option<Plan> {
    use std::f64::consts::{PI, TAU};
    // One piece per household, and a tenth more for the camp's own uses.
    let tents = (super::footprint::capacity::households(culture(site, cfg), site.population) * 1.1).ceil().max(2.0) as usize;
    let (pitch, depth, half, strip) = (8.0, 12.0, 1.5, 4.0);
    let step = 2.0 * (half + depth) + strip;
    let first = depth + half + 8.0;
    let c = site.center;
    let entry_dir = near.as_ref().map_or(0.0, |n| (n.point.y - c.y).atan2(n.point.x - c.x));
    let dirv = |a: f64| Point { x: a.cos(), y: a.sin() };
    let sectors = |r: f64| ((TAU * r / pitch).floor() as usize).max(3);
    // Units: (centre, ring radii, tents).
    let mut units: Vec<(Point, Vec<f64>, usize)> = vec![];
    if cfg.camp_growth == "clusters" {
        let data = &super::catalogue()["cultures"][culture(site, cfg)]["camp"];
        let spread = data["groupVariation"].as_f64().unwrap_or(0.0).clamp(0.0, 0.75);
        let mut rng = rng.fork("camp-groups");
        let per = (40.0 * rng.range(1.0 - 0.3 * spread, 1.0 + 0.3 * spread)).round() as usize;
        let disc = |o: Point, r: f64| Shape {
            outer: (0..32).map(|i| at(o, dirv(i as f64 * TAU / 32.0), r)).collect(),
            holes: vec![],
        };
        for count in (1..=tents.div_ceil(per).max(1)).rev() {
            let sizes = if spread > 0.0 { camp_variation::groups(tents, count, spread, &mut rng.fork(&count.to_string())) }
                else { (0..count).map(|u|tents/count + usize::from(u<tents%count)).collect() };
            let k = sizes.iter().copied().max().unwrap_or(tents);
            let slack = if spread > 0.0 { 0.25 } else { 0.0 };
            let r = ((k.div_ceil(2) as f64 + slack) * pitch / TAU).max(first);
            let reach = r + half + depth;
            let mut centres = vec![c];
            'unit: for _ in 1..count {
                for ring in 0..30 {
                    let d = 2.0 * reach + 12.0 + ring as f64 * 0.25 * reach;
                    for t in 0..24 {
                        let side = if t % 2 == 0 { 1.0 } else { -1.0 };
                        let a = entry_dir + PI + side * ((t + 1) / 2) as f64 * TAU / 24.0;
                        let o = at(c, dirv(a), d);
                        if centres.iter().any(|&q| dist(q, o) < 2.0 * reach + 12.0) {
                            continue;
                        }
                        if settle(&g::normalized(disc(o, reach)), obstacles, &surface, 0.95).is_some() {
                            centres.push(o);
                            continue 'unit;
                        }
                    }
                }
                break;
            }
            if centres.len() == count || count == 1 {
                units = centres.iter().zip(sizes).map(|(&o, k)| (o, vec![if spread > 0.0 { ((k.div_ceil(2) as f64 + slack) * pitch / TAU).max(first) } else { r }], k)).collect();
                break;
            }
        }
    } else {
        let r0 = (60.0 * pitch / (2.0 * TAU)).max(first);
        let (mut radii, mut held) = (vec![], 0);
        while held < tents && radii.len() < 12 {
            let r = r0 + radii.len() as f64 * step;
            held += sectors(r) * 2;
            radii.push(r);
        }
        units.push((c, radii, tents));
    }
    let outer = units[0].1.last().copied().unwrap_or(first);
    let mut streets = vec![];
    // Tracks crossing the tent rows: radial spokes, the links between camps.
    let mut cuts: Vec<Vec<Point>> = vec![];
    if units.len() == 1 && units[0].1.len() > 1 {
        let r0 = units[0].1[0];
        for j in 0..4 {
            let d = dirv(entry_dir + j as f64 * 0.5 * PI);
            cuts.push(vec![at(c, d, r0), at(c, d, outer)]);
        }
    }
    for (o, radii, _) in units.iter().skip(1) {
        cuts.push(vec![at(*o, unit(*o, c), radii[0]), at(c, unit(c, *o), outer)]);
    }
    let all: Vec<Shape> = obstacles.iter().cloned().chain(cuts.iter().flat_map(|p| g::ribbon(p, &[2.0 * half + 1.0]))).collect();
    let mut blocks: Vec<(Shape, &'static str)> = vec![];
    for (o, radii, k) in &units {
        let o = *o;
        let back = if dist(o, c) > 1.0 { (o.y - c.y).atan2(o.x - c.x) } else { entry_dir + PI };
        let mut left = *k;
        for &r in radii {
            let n = sectors(r);
            let m = ((TAU * r / 4.0).ceil() as usize).max(24);
            let mut ring: Vec<Point> = (0..=m).map(|i| at(o, dirv(i as f64 * TAU / m as f64), r)).collect();
            ring[m] = ring[0];
            streets.push(street(ring, half * 2.0, 3, "track"));
            // Sectors from the back (away from the entry) toward the front,
            // both sides of the track: a partial ring stays behind.
            let mid = |i: usize| (i as f64 + 0.5) * TAU / n as f64;
            let off = |a: f64| (a - back).rem_euclid(TAU).min(TAU - (a - back).rem_euclid(TAU));
            let mut order: Vec<usize> = (0..n).collect();
            order.sort_by(|&a, &b| off(mid(a)).total_cmp(&off(mid(b))).then(a.cmp(&b)));
            for i in order {
                let gap = 0.5 / r;
                let (a0, a1) = (i as f64 * TAU / n as f64 + gap, (i + 1) as f64 * TAU / n as f64 - gap);
                for (r_in, r_out) in [(r + half, r + half + depth), (r - half - depth, r - half)] {
                    if left == 0 || r_in <= 1.0 {
                        continue;
                    }
                    let arc = |rr: f64| (0..=4).map(move |s| (s, rr));
                    let mut outline: Vec<Point> = arc(r_out).map(|(s, rr)| at(o, dirv(a0 + (a1 - a0) * s as f64 / 4.0), rr)).collect();
                    outline.extend(arc(r_in).collect::<Vec<_>>().into_iter().rev().map(|(s, rr)| at(o, dirv(a0 + (a1 - a0) * s as f64 / 4.0), rr)));
                    let piece = g::normalized(Shape { outer: outline, holes: vec![] });
                    if let Some(p) = settle(&piece, &all, &surface, 0.5) {
                        blocks.push((p, "block"));
                        left -= 1;
                    }
                }
            }
        }
        // The open centre: a common for herds, fires and gatherings.
        let cr = radii[0] - half - depth - 2.0;
        if cr > 6.0 {
            let disc = Shape { outer: (0..24).map(|i| at(o, dirv(i as f64 * TAU / 24.0), cr)).collect(), holes: vec![] };
            if let Some(d) = settle(&g::normalized(disc), obstacles, &surface, 0.5) {
                blocks.push((d, "place"));
            }
        }
    }
    for p in cuts {
        streets.push(street(p, half * 2.0, 3, "track"));
    }
    if let Some(n) = near.as_ref().filter(|n| n.distance > outer) {
        let entry = at(c, unit(c, n.point), outer);
        streets.push(street(track(surface, n.point, entry, cfg.max_lane_grade), half * 2.0, 3, "track"));
    }
    Some(Plan { blocks, streets, center: c, axis: Point { x: 1.0, y: 0.0 } })
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
            interpolation: Default::default(),
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

    /// An isolated structure keeps its whole plot even at a road junction,
    /// and an isolated mill stands on the nearest bank, its plot backing onto
    /// the water (« un moulin est sur son bief »).
    #[test]
    fn isolated_structures_have_their_whole_plot_and_a_mill_its_bank() {
        let n = 256;
        let height = vec![0.0; n * n];
        // A river band 40 m wide, 300 m east of the site.
        let cell = 2000.0 / n as f64;
        let water: Vec<u8> = (0..n * n)
            .map(|k| {
                let x = ((k % n) as f64 + 0.5) * cell;
                u8::from((1300.0..1340.0).contains(&x))
            })
            .collect();
        let surface = Surface {
            geometry: None,
            width: 2000.0,
            n,
            height: &height,
            water: &water,
            interpolation: Default::default(),
        };
        let p = |x: f64, y: f64| Point { x, y };
        let road = |a: Point, b: Point| Street {
            path: vec![a, b],
            widths: vec![6.0, 6.0],
            rank: 1,
            role: "regional".into(),
        };
        // Three roads meeting at the site.
        let roads = [
            road(p(1000.0, 1000.0), p(400.0, 1000.0)),
            road(p(1000.0, 1000.0), p(1200.0, 1000.0)),
            road(p(1000.0, 1000.0), p(1000.0, 400.0)),
        ];
        let site = Site {
            key: "isolated".into(),
            name: String::new(),
            population: 12,
            culture: "european-organic".into(),
            center: p(1004.0, 1004.0),
            radius: 30.0,
        };
        for (role, planned) in [
            ("isolated-shrine", 16.0 * 20.0),
            ("isolated-mill", 30.0 * 40.0),
        ] {
            let mut cfg = LayoutConfig::default();
            cfg.programme.intent = role.into();
            let l = &generate_quarters(
                "isolated",
                std::slice::from_ref(&site),
                &cfg,
                surface,
                &roads,
            )
            .unwrap()[0];
            let plot = &l.blocks[0].shape;
            assert!(
                g::area(plot) >= WHOLE_PLOT * 0.9 * 0.92 * planned,
                "{role}: {}",
                g::area(plot)
            );
            let near_water = plot.outer.iter().any(|q| (1290.0..1300.5).contains(&q.x));
            assert_eq!(near_water, role == "isolated-mill", "{role}");
        }
    }

    /// The `activity` intent lays one template's yard: a plot hugging its buildings, a water
    /// template on the bank, installations as ground blocks beside it.
    #[test]
    fn an_activity_site_is_a_yard_with_its_installations() {
        let n = 256;
        let height: Vec<f32> = (0..n * n).map(|k| 0.05 * (k % n) as f32).collect();
        let cell = 2000.0 / n as f64;
        let water: Vec<u8> = (0..n * n).map(|k| 3 * u8::from((1300.0..1340.0).contains(&(((k % n) as f64 + 0.5) * cell)))).collect();
        let surface = Surface { geometry: None, width: 2000.0, n, height: &height, water: &water, interpolation: Default::default(),};
        let site = Site { key: "activity".into(), name: String::new(), population: 12, culture: "european-organic".into(), center: Point { x: 1004.0, y: 1004.0 }, radius: 30.0 };
        for template in ["river_watermill", "stone_quarry", "forest_logging"] {
            let mut cfg = LayoutConfig::default();
            cfg.programme.intent = "activity".into();
            cfg.programme.template = template.into();
            let l = &generate_quarters("activity", std::slice::from_ref(&site), &cfg, surface, &[]).unwrap()[0];
            assert!(matches!(l.blocks[0].kind.as_str(), "block" | "reserve:programme"), "{template}: {}", l.blocks[0].kind);
            let centre = l.structure.as_ref().unwrap().centers[0].point;
            let yard = super::super::activities::site_yard(template, "european-organic", "activity", centre, l.blocks[0].axis.y.atan2(l.blocks[0].axis.x), &surface);
            assert!(yard.len() >= 2, "{template}: {} buildings", yard.len());
            assert!(l.blocks.len() > 1, "{template}: no installation block");
            if template == "river_watermill" {
                assert!(l.blocks[0].shape.outer.iter().any(|q| (1290.0..1400.0).contains(&q.x)), "mill not on the bank");
            }
        }
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
        assert_eq!(l.config.as_ref().unwrap().programme.intent, "settlement");

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

#[cfg(test)]
mod field_lane_tests {
    use super::*;

    #[test]
    fn street_village_lanes_vary_without_losing_the_spine_or_field_access() {
        let p = |x, y| Point { x, y };
        let n = 128;
        let height = vec![0.0; n * n];
        let water = vec![0; n * n];
        let surface = Surface {
            geometry: None, width: 2000.0, n, height: &height, water: &water,
            interpolation: Default::default(),
        };
        let roads = vec![street(vec![p(100.0, 990.0), p(1000.0, 1010.0), p(1900.0, 980.0)], 6.0, 0, "regional")];
        let inherited = roads[0].path.clone();
        let site = Site {
            key: "field-lanes".into(), name: String::new(), population: 500,
            culture: "hanseatic".into(), center: p(1000.0, 1000.0), radius: 100.0,
        };
        let near = nearest(site.center, &roads, 600.0);
        let morph = Morph { value: serde_json::json!({
            "plotDepth": {"village": [40.0, 60.0]},
            "frontage": {"village": [12.0, 16.0]},
        }) };
        for strength in [0.0, 1.0] {
            let cfg = LayoutConfig {
                road_width_by_size: false, organic_branch_variation: strength,
                ribbon_width_variation: strength, ..LayoutConfig::default()
            };
            let build = |seed| linear(
                &site, &cfg, Kind::StreetVillage, &morph, &near, &[], &|_| 3.05,
                &roads, surface, &mut Rng::new(seed),
            ).unwrap();
            let plan = build("field-lanes");
            let paths = |plan: &Plan| plan.streets.iter().map(|s| s.path.clone()).collect::<Vec<_>>();
            assert_eq!(paths(&plan), paths(&build("field-lanes")), "seed replay");
            assert_ne!(paths(&plan), paths(&build("other-field-lanes")), "seed variation");
            assert!(plan.streets.len() >= 6, "both sides keep field access");
            let mut lengths = vec![];
            let mut angles = vec![];
            for lane in &plan.streets {
                assert_eq!(lane.path.len(), 5, "one broad bend with bounded work");
                assert_eq!(lane.widths.len(), lane.path.len());
                assert!(routing::path_clear(surface, &lane.path, cfg.max_lane_grade));
                let (a, b) = (lane.path[0], *lane.path.last().unwrap());
                let (_, segment) = roads[0].path.windows(2)
                    .map(|w| (g::distance(a, w[0], w[1]).0, w))
                    .min_by(|a, b| a.0.total_cmp(&b.0)).unwrap();
                assert!(g::distance(a, segment[0], segment[1]).0 < 1e-6, "junction stays on spine");
                let d = unit(segment[0], segment[1]);
                let outward = perp(d);
                let across = ((b.x - a.x) * outward.x + (b.y - a.y) * outward.y).abs();
                assert!(across > 3.05 + 60.0 * (1.0 + 0.34 * strength), "lane crosses the whole strip");
                let bend = g::distance(lane.path[2], a, b).0;
                assert!((1.7..5.1).contains(&bend), "gentle bend: {bend}");
                angles.push(((b.x - a.x) * d.x + (b.y - a.y) * d.y) / across);
                lengths.push(*arc(&lane.path).last().unwrap());
                // Parcels are cut by the actual curved ribbon, not its chord.
                for ribbon in g::ribbon(&lane.path, &lane.widths) {
                    for (shape, _) in plan.blocks.iter().filter(|(_, kind)| *kind == "block") {
                        let overlap: f64 = g::intersection(shape, &ribbon).iter().map(g::area).sum();
                        assert!(overlap < 0.01, "lane overlaps a plot by {overlap} m2");
                    }
                }
            }
            lengths.sort_by(f64::total_cmp);
            angles.sort_by(f64::total_cmp);
            assert!(lengths.last().unwrap() - lengths[0] > 6.0, "unequal field ends");
            assert!(angles.last().unwrap() - angles[0] > 0.03, "unequal angles");
        }
        assert_eq!(roads[0].path, inherited);

        // A low ridge on the right must win over the seed's preferred bend.
        let height: Vec<f32> = (0..n * n).map(|i| {
            let x = (i % n) as f64 * 4.0 + 2.0;
            ((x - 256.0).max(0.0) * 0.2) as f32
        }).collect();
        let terrain = Surface { width: 512.0, height: &height, ..surface };
        let path = field_lane(terrain, p(256.0, 400.0), p(256.0, 480.0), -4.0, 0.12).unwrap();
        assert!(path[2].x < 256.0, "bend follows the lower terrain cost");
        assert!(routing::path_clear(terrain, &path, 0.12));
        let flooded = vec![1; n * n];
        assert!(field_lane(Surface { water: &flooded, ..surface }, p(500.0, 400.0), p(500.0, 480.0), 4.0, 0.12).is_none());
    }
}

#[cfg(test)]
mod demographic_morphology_tests {
    use super::*;
    fn site(population: u32) -> Site {
        Site { key: "demographic-morphology".into(), name: String::new(), population,
            culture: "european-organic".into(), center: Point { x: 4000.0, y: 4000.0 }, radius: 200.0 }
    }
    #[test]
    fn demographic_morphology_boundaries_are_distinct_without_changing_population() {
        let cfg = LayoutConfig::default();
        // The automatic grammar changes exactly on the demographic class floors.
        for (population, class, kind) in [(12,"farmstead",Kind::Farmstead),(14,"farmstead",Kind::Farmstead),(15,"hamlet",Kind::Hamlet),(149,"hamlet",Kind::Hamlet),(150,"village",Kind::NucleatedVillage),(999,"village",Kind::NucleatedVillage),(1000,"town",Kind::MarketTown),(19999,"town",Kind::WalledTown),(20000,"city",Kind::City),(99999,"city",Kind::City),(100000,"metropolis",Kind::Metropolis),(1000000,"megacity",Kind::Metropolis)] {
            let s = site(population);
            assert_eq!(crate::settlements::demographics::class_of(s.population), class);
            assert_eq!(resolve(&s, &cfg, &[]), kind, "{population}");
            let (applied, resolved) = effective(&s, &cfg, &[]);
            assert_eq!(resolved, kind);
            assert_eq!(applied.settlement_form, kind.id());
            assert_eq!(s.population, population);
            assert_eq!(cfg.settlement_form, "auto");
        }
    }
    #[test]
    fn demographic_morphology_preserves_cultural_camps_and_isolated_intents() {
        let mut cfg = LayoutConfig::default();
        let mut s = site(300); s.culture = "nomad-camp".into();
        assert_eq!(resolve(&s, &cfg, &[]), Kind::Camp);
        for role in ["isolated-mill","isolated-inn","isolated-tower","isolated-shrine","roadside-temple"] {
            cfg.programme.intent = role.into();
            assert_eq!(resolve(&site(100000), &cfg, &[]), Kind::Single);
        }
        cfg.programme.intent = "isolated-farm".into();
        assert_eq!(resolve(&s, &cfg, &[]), Kind::Farmstead);
        cfg.programme.state = "ruined".into();
        assert_eq!(resolve(&s, &cfg, &[]), Kind::Ruin);
    }
    #[test]
    fn demographic_morphology_all_explicit_ids_and_old_village_preferences_keep_their_meaning() {
        let s = site(300);
        for expected in ALL {
            let mut cfg = LayoutConfig::default(); cfg.settlement_form = expected.id().into(); cfg.programme.intent = "isolated-mill".into();
            assert_eq!(resolve(&s, &cfg, &[]), expected);
        }
        let mut cfg = LayoutConfig::default(); cfg.settlement_form = "ribbon".into();
        assert_eq!(resolve(&s, &cfg, &[]), Kind::StreetVillage);
        cfg.settlement_form = "nucleated".into(); assert_eq!(resolve(&s, &cfg, &[]), Kind::NucleatedVillage);
        cfg.settlement_form = "ribbon".into(); assert_eq!(resolve(&site(100000), &cfg, &[]), Kind::Metropolis);
    }
}

#[cfg(test)]
#[path = "scenario_matrix_tests.rs"]
mod scenario_matrix_tests;

#[cfg(test)]
#[path = "kinds_camp_mapping_tests.rs"]
mod camp_kind_mapping_tests;

#[cfg(test)]
#[path = "kinds_camp_consumer_activation_tests.rs"]
mod camp_consumer_tests;
#[cfg(test)]
#[path = "camps_pnw_replay_tests.rs"]
mod camps_pnw_replay_tests;
