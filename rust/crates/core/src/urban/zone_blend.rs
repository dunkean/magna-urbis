//! Density gradient between growth phases (`zoneDensity: gradient`).
//!
//! With `phases` (the default) every block reads its own phase's zone tables.
//! With `gradient`, a block near a phase of another zone, recipe or culture
//! takes intermediate values: `weight` is 0.5 on the boundary (both sides
//! meet at the mid value) and falls smoothly to 0 at `band` metres from it.
//! A town circuit (an enclosure without a purpose) separates its two sides:
//! no blend across it. Village phases never blend.
//!
//! The weight is pure geometry of the phase shapes, the circuits and a point,
//! so every stage (street split, lot cutting, programme, buildings) reads the
//! same value. Numeric zone tables are interpolated (`blend`); the storey range
//! and the core pressure floor travel in `arch._zoneBlend` and are read by
//! `storeys_of` / `floored`, so the integer `arch.storeys` stay untouched.
//! Categorical choices (attached row or detached house, pack and admission)
//! are dithered per lot instead: a lot takes the neighbouring zone's tissue
//! with probability `weight` (`flipped`, `lot_zone`, `culture::lot_morph`).
use super::geometry::{area, contains, distance, interior_point};
use super::{Enclosure, GrowthPhase, Layout, Morph, Point, Shape};
use serde_json::{Value, json};
use std::sync::{Arc, Mutex};

/// Zone-keyed numeric tables interpolated between the two phases. The side
/// gap stays the zone's own: it decides attached rows against detached houses
/// (`parcels::occupation`), a categorical choice dithered per lot (`flipped`).
const KEYS: [&str; 7] = [
    "blockSize", "frontage", "plotDepth", "houseArea", "coverage", "setback", "buildDepth",
];
/// Keys `parcels::pressure::apply` reads along its core/edge gradient.
const GRADED: [&str; 4] = ["frontage", "plotDepth", "houseArea", "coverage"];
/// Pressure floor of a core block (`parcels::pressure::local`).
pub(super) const CORE_FLOOR: f64 = 0.65;
/// The nearest point of the other phase is pushed this far beyond its
/// boundary before the circuit test, so a wall on that boundary still counts.
const PUSH: f64 = 2.0;

#[derive(Clone, Copy, Debug, PartialEq)]
pub(super) struct Blend {
    /// Index of the neighbouring phase in `layout.phases`.
    pub phase: usize,
    /// Share of the neighbour's values, 0 to 0.5.
    pub weight: f64,
}

/// Width of the transition on each side of a phase boundary: about a quarter
/// deep (30 % of the radius of the built town), bounded.
pub(super) fn band(phases: &[GrowthPhase]) -> f64 {
    let built: f64 = phases.iter().flat_map(|p| &p.shapes).map(area).sum();
    (0.3 * (built / std::f64::consts::PI).sqrt()).clamp(150.0, 600.0)
}

/// Share of the core's standing of a block: 1 in a core block, 0 elsewhere;
/// in a band, 1 − w on the core side and w on the other side of the boundary.
pub(super) fn core_weight(layout: &Layout, blend: Option<Blend>, block: usize) -> f64 {
    let own = layout.blocks.get(block).is_some_and(|b| b.zone == "core");
    let base = if own { 1.0 } else { 0.0 };
    let Some(b) = blend else { return base };
    let other = layout.phases.get(b.phase).is_some_and(|p| p.zone == "core");
    (1.0 - b.weight) * base + b.weight * if other { 1.0 } else { 0.0 }
}

fn smoothstep(t: f64) -> f64 {
    let t = t.clamp(0.0, 1.0);
    t * t * (3.0 - 2.0 * t)
}

pub(super) fn lerp2(a: [f64; 2], b: [f64; 2], w: f64) -> [f64; 2] {
    [a[0] + (b[0] - a[0]) * w, a[1] + (b[1] - a[1]) * w]
}

/// Phase boundary segments binned on a uniform grid.
struct Segments {
    cells: Vec<Vec<(Point, Point)>>,
}

struct Grid {
    x0: f64,
    y0: f64,
    cell: f64,
    nx: usize,
    ny: usize,
}
impl Grid {
    fn span(&self, lo: f64, hi: f64, origin: f64, n: usize) -> (usize, usize) {
        let a = ((lo - origin) / self.cell).floor().max(0.0) as usize;
        let b = ((hi - origin) / self.cell).floor().max(0.0) as usize;
        (a.min(n - 1), b.min(n - 1))
    }
    fn cells(&self, x: (f64, f64), y: (f64, f64)) -> impl Iterator<Item = usize> + '_ {
        let (i0, i1) = self.span(x.0, x.1, self.x0, self.nx);
        let (j0, j1) = self.span(y.0, y.1, self.y0, self.ny);
        (j0..=j1).flat_map(move |j| (i0..=i1).map(move |i| j * self.nx + i))
    }
}

pub(super) struct Field {
    band: f64,
    grid: Grid,
    /// Zone, recipe and culture of each phase.
    phases: Vec<(String, String, String)>,
    segments: Vec<Segments>,
    circuits: Vec<Shape>,
}

fn circuits(enclosures: &[Enclosure]) -> Vec<&Vec<Point>> {
    enclosures.iter().filter(|e| e.purpose.is_empty() && e.path.len() >= 3).map(|e| &e.path).collect()
}

impl Field {
    pub(super) fn new(phases: &[GrowthPhase], enclosures: &[Enclosure]) -> Self {
        let band = band(phases);
        let points = || phases.iter().flat_map(|p| &p.shapes).flat_map(|s| s.outer.iter());
        let (mut x0, mut y0, mut x1, mut y1) = (f64::MAX, f64::MAX, f64::MIN, f64::MIN);
        for p in points() {
            (x0, y0, x1, y1) = (x0.min(p.x), y0.min(p.y), x1.max(p.x), y1.max(p.y));
        }
        if x0 > x1 {
            (x0, y0, x1, y1) = (0.0, 0.0, 1.0, 1.0);
        }
        let cell = band.max((x1 - x0).max(y1 - y0) / 256.0);
        let grid = Grid {
            x0,
            y0,
            cell,
            nx: ((x1 - x0) / cell).floor() as usize + 1,
            ny: ((y1 - y0) / cell).floor() as usize + 1,
        };
        let segments = phases
            .iter()
            .map(|p| {
                let mut cells = vec![Vec::new(); grid.nx * grid.ny];
                for s in &p.shapes {
                    for r in std::iter::once(&s.outer).chain(&s.holes) {
                        for (&a, &b) in r.iter().zip(r.iter().cycle().skip(1)).take(r.len()) {
                            for c in grid.cells((a.x.min(b.x), a.x.max(b.x)), (a.y.min(b.y), a.y.max(b.y))) {
                                cells[c].push((a, b));
                            }
                        }
                    }
                }
                Segments { cells }
            })
            .collect();
        Self {
            band,
            grid,
            phases: phases.iter().map(|p| (p.zone.clone(), p.recipe.clone(), p.culture.clone())).collect(),
            segments,
            circuits: circuits(enclosures).into_iter().map(|r| Shape { outer: r.clone(), holes: vec![] }).collect(),
        }
    }

    #[cfg(test)]
    fn band(&self) -> f64 {
        self.band
    }

    /// Nearest boundary point of phase `b` within the band, scanned in a fixed
    /// order (the first of equal distances wins).
    fn nearest(&self, b: usize, p: Point) -> Option<(f64, Point)> {
        let r = self.band;
        let mut best: Option<(f64, Point)> = None;
        for c in self.grid.cells((p.x - r, p.x + r), (p.y - r, p.y + r)) {
            for &(a, e) in &self.segments[b].cells[c] {
                let (d, _, q) = distance(p, a, e);
                if best.is_none_or(|(bd, _)| d < bd) {
                    best = Some((d, q));
                }
            }
        }
        best.filter(|(d, _)| *d < r)
    }

    /// Blend of a point of phase `own` toward the nearest phase of another
    /// zone, recipe or culture on the same side of every town circuit.
    pub(super) fn at(&self, p: Point, own: usize) -> Option<Blend> {
        let me = self.phases.get(own)?;
        if me.0 == "village" {
            return None;
        }
        let mut best: Option<(f64, usize)> = None;
        for (b, other) in self.phases.iter().enumerate() {
            if b == own || other.0 == "village" || other == me {
                continue;
            }
            let Some((d, q)) = self.nearest(b, p) else { continue };
            let beyond = if d > 1e-9 {
                Point { x: q.x + (q.x - p.x) / d * PUSH, y: q.y + (q.y - p.y) / d * PUSH }
            } else {
                q
            };
            if self.circuits.iter().any(|c| contains(c, p) != contains(c, beyond)) {
                continue;
            }
            if best.is_none_or(|(bd, _)| d < bd) {
                best = Some((d, b));
            }
        }
        let (d, phase) = best?;
        let weight = 0.5 * (1.0 - smoothstep(d / self.band));
        (weight > 0.0).then_some(Blend { phase, weight })
    }
}

/// Fields of the recent layouts, compared on their exact inputs (phase zones,
/// recipes, cultures and shapes, circuit paths): a hit is the field a fresh
/// build would give.
struct Entry {
    phases: Vec<GrowthPhase>,
    circuits: Vec<Vec<Point>>,
    field: Arc<Field>,
}
static FIELDS: Mutex<Vec<Arc<Entry>>> = Mutex::new(Vec::new());

fn same(e: &Entry, phases: &[GrowthPhase], walls: &[&Vec<Point>]) -> bool {
    e.phases.len() == phases.len()
        && e.circuits.len() == walls.len()
        && e.phases.iter().zip(phases).all(|(a, b)| {
            a.zone == b.zone && a.recipe == b.recipe && a.culture == b.culture && a.shapes == b.shapes
        })
        && e.circuits.iter().zip(walls).all(|(a, b)| a == *b)
}

pub(super) fn field(phases: &[GrowthPhase], enclosures: &[Enclosure]) -> Arc<Field> {
    let walls = circuits(enclosures);
    let entries = FIELDS.lock().unwrap_or_else(|e| e.into_inner()).clone();
    if let Some(e) = entries.iter().find(|e| same(e, phases, &walls)) {
        return e.field.clone();
    }
    let field = Arc::new(Field::new(phases, enclosures));
    let mut cache = FIELDS.lock().unwrap_or_else(|e| e.into_inner());
    cache.push(Arc::new(Entry {
        phases: phases.to_vec(),
        circuits: walls.into_iter().cloned().collect(),
        field: field.clone(),
    }));
    if cache.len() > 8 {
        cache.remove(0);
    }
    field
}

/// Whether the layout asks for the gradient and has phases to blend.
pub(super) fn enabled(layout: &Layout) -> bool {
    layout.config.as_ref().is_some_and(|c| c.zone_density == "gradient") && layout.phases.len() > 1
}

fn block_phase(layout: &Layout, block: usize) -> Option<usize> {
    let b = layout.blocks.get(block)?;
    b.phase.or_else(|| layout.quarters.get(b.quarter).map(|q| q.phase))
}

/// Blend of every block (None everywhere with `phases`).
pub(super) fn blocks(layout: &Layout) -> Vec<Option<Blend>> {
    if !enabled(layout) {
        return vec![None; layout.blocks.len()];
    }
    let field = field(&layout.phases, &layout.enclosures);
    super::par::map(&layout.blocks, |bi, b| {
        field.at(interior_point(&b.shape), block_phase(layout, bi)?)
    })
}

/// Blend of one block.
pub(super) fn block(layout: &Layout, block: usize) -> Option<Blend> {
    if !enabled(layout) {
        return None;
    }
    let b = layout.blocks.get(block)?;
    field(&layout.phases, &layout.enclosures).at(interior_point(&b.shape), block_phase(layout, block)?)
}

/// Interpolates the zone tables of `morph` (read in `own_zone`) toward
/// `other` (read in `other_zone`) by `w`. A tissue graded by pressure (not a
/// planned grid) reads its lot keys between the core and edge endpoints: those
/// are interpolated end to end. The neighbour's storey range and the softened
/// core pressure floor go to `arch._zoneBlend`.
pub(super) fn blend(morph: &mut Morph, own_zone: &str, other: &Morph, other_zone: &str, w: f64) {
    let planned = morph.text("streetOp") == "grid";
    let own_coverage = morph.range("coverage", own_zone);
    for key in KEYS {
        let ends = |m: &Morph| m.value[key]["core"].is_array() && m.value[key]["edge"].is_array();
        let graded = !planned && GRADED.contains(&key) && ends(morph) && ends(other);
        let mut out: Vec<(&str, [f64; 2])> = Vec::new();
        if graded {
            for end in ["core", "edge"] {
                out.push((end, lerp2(morph.range(key, end), other.range(key, end), w)));
            }
        }
        if !(graded && matches!(own_zone, "core" | "edge"))
            && morph.value[key][own_zone].is_array()
            && other.value[key][other_zone].is_array()
        {
            out.push((own_zone, lerp2(morph.range(key, own_zone), other.range(key, other_zone), w)));
        }
        for (zone, range) in out {
            morph.value[key][zone] = json!(range);
        }
    }
    let core = |z: &str| if z == "core" { 1.0 } else { 0.0 };
    let floor = CORE_FLOOR * ((1.0 - w) * core(own_zone) + w * core(other_zone));
    // The zone's coverage read raw (programme capacity), across the boundary.
    let coverage = lerp2(own_coverage, other.range("coverage", other_zone), w);
    morph.value["arch"]["_zoneBlend"] = json!({"weight": w, "storeys": other.value["arch"]["storeys"].clone(),
        "coreFloor": floor, "coverage": coverage});
}

/// Raw coverage range of a zone, blended across a phase boundary when the
/// tissue is (`blend`).
pub(super) fn coverage(morph: &Morph, zone: &str) -> [f64; 2] {
    let c = &morph.value["arch"]["_zoneBlend"]["coverage"];
    match (c[0].as_f64(), c[1].as_f64()) {
        (Some(lo), Some(hi)) => [lo, hi],
        _ => morph.range("coverage", zone),
    }
}

/// Blends the tissue of block `block` (read in `zone`) when it lies in a
/// transition band; `other` resolves the neighbouring phase's tissue for the
/// zone it is read in. Nothing changes outside a band or with `phases`.
pub(super) fn blend_block(
    layout: &Layout,
    blend: Option<Blend>,
    block: usize,
    zone: &str,
    morph: &mut Morph,
    other: impl FnOnce(usize, &GrowthPhase, &str) -> Option<Morph>,
) {
    let Some((b, phase, other_zone)) = neighbour(layout, blend, block, zone) else { return };
    if let Some(o) = other(b.phase, phase, other_zone) {
        self::blend(morph, zone, &o, other_zone, b.weight);
    }
}

/// The neighbouring phase of a blended block and the zone it is read in, for
/// a block read in `zone` (None outside a band and for villages).
pub(super) fn neighbour<'a>(
    layout: &'a Layout,
    blend: Option<Blend>,
    block: usize,
    zone: &'a str,
) -> Option<(Blend, &'a GrowthPhase, &'a str)> {
    let b = blend?;
    let phase = layout.phases.get(b.phase)?;
    // A stage reading every block in one forced zone reads the neighbour in it too.
    let own_zone = layout.blocks.get(block).map_or(zone, |bl| bl.zone.as_str());
    let other_zone = if zone == own_zone { phase.zone.as_str() } else { zone };
    (zone != "village" && other_zone != "village").then_some((b, phase, other_zone))
}

/// Whether lot `lot` of a blended block takes the neighbouring zone's
/// categorical choices (house form, pack and admission, back buildings,
/// storey ladder): with probability w (0.5 on the boundary, 0 beyond the
/// band), from a hash of the town and the lot's identity, so the parts of a
/// block mix row houses and detached houses in proportion.
pub(super) fn flipped(layout: &Layout, blend: Option<Blend>, lot: &str) -> bool {
    blend.is_some_and(|b| crate::rng::Rng::new(&layout.key).fork(&format!("zone-dither:{lot}")).float() < b.weight)
}

/// The zone the categorical choices of a lot read: None for its block's own
/// zone, the neighbour's zone when the lot is `flipped`. Every stage (programme,
/// building sites) reads it here.
pub(super) fn lot_zone<'a>(layout: &'a Layout, parcel: &super::Parcel) -> Option<&'a str> {
    if !enabled(layout) {
        return None;
    }
    let blend = block(layout, parcel.block);
    let zone = layout.blocks.get(parcel.block)?.zone.as_str();
    let (_, _, other) = neighbour(layout, blend, parcel.block, zone)?;
    flipped(layout, blend, &parcel.id).then_some(other)
}

/// Pressure along the density curve: a core block keeps a floor, softened
/// near another zone (`blend`: both sides meet at half the floor).
pub(super) fn floored(arch: &Value, zone: &str, pressure: f64) -> f64 {
    match arch["_zoneBlend"]["coreFloor"].as_f64() {
        Some(floor) => pressure.max(floor),
        None if zone == "core" => pressure.max(CORE_FLOOR),
        None => pressure,
    }
}

/// Weight and storey range of the neighbouring phase, when blended.
pub(super) fn storeys_of(arch: &Value) -> Option<(f64, [f64; 2])> {
    let b = &arch["_zoneBlend"];
    let w = b["weight"].as_f64()?;
    let s = &b["storeys"];
    Some((w, [s[0].as_f64()?, s[1].as_f64()?]))
}

/// A storey range blended toward the neighbour's (floats; `own` unchanged
/// without a blend).
pub(super) fn mix(own: [f64; 2], other: Option<(f64, [f64; 2])>) -> [f64; 2] {
    other.map_or(own, |(w, o)| lerp2(own, o, w))
}

/// Floors at position `t` of the storey range `lo..hi` blended toward the
/// neighbour's range, rounded; None without a blend (the caller's own rule).
pub(super) fn floors_at(arch: &Value, lo: u32, hi: u32, t: f64) -> Option<u32> {
    let [l, h] = mix([f64::from(lo), f64::from(hi)], Some(storeys_of(arch)?));
    Some((l + (h - l).max(0.0) * t).round().max(1.0) as u32)
}

#[cfg(test)]
mod tests {
    use super::super::geometry::rectangle;
    use super::*;

    fn phase(zone: &str, recipe: &str, shape: Shape) -> GrowthPhase {
        GrowthPhase {
            culture: String::new(),
            kind: "growth".into(),
            zone: zone.into(),
            recipe: recipe.into(),
            population: 0.0,
            target_area: 0.0,
            shapes: vec![shape],
        }
    }
    fn wall(x0: f64, y0: f64, x1: f64, y1: f64) -> Enclosure {
        Enclosure { path: rectangle(x0, y0, x1, y1).outer, kind: "wall".into(), ..Default::default() }
    }
    /// Two 1 km halves meeting at x = 1000.
    fn halves(a: (&str, &str), b: (&str, &str)) -> Vec<GrowthPhase> {
        vec![
            phase(a.0, a.1, rectangle(0.0, 0.0, 1000.0, 1000.0)),
            phase(b.0, b.1, rectangle(1000.0, 0.0, 2000.0, 1000.0)),
        ]
    }
    fn at(f: &Field, x: f64, own: usize) -> Option<Blend> {
        f.at(Point { x, y: 500.0 }, own)
    }

    #[test]
    fn weight_is_half_on_the_boundary_and_vanishes_beyond_the_band() {
        let f = Field::new(&halves(("core", "core"), ("middle", "ring")), &[]);
        let band = f.band();
        assert!((150.0..=600.0).contains(&band));
        let edge = at(&f, 1000.0, 0).unwrap();
        assert_eq!(edge.phase, 1);
        assert!((edge.weight - 0.5).abs() < 1e-9);
        // Symmetric on both sides.
        for d in [10.0, band * 0.3, band * 0.7] {
            let (a, b) = (at(&f, 1000.0 - d, 0).unwrap(), at(&f, 1000.0 + d, 1).unwrap());
            assert_eq!(b.phase, 0);
            assert!((a.weight - b.weight).abs() < 1e-9 && a.weight < 0.5 && a.weight > 0.0);
        }
        assert!(at(&f, 1000.0 - band * 0.3, 0).unwrap().weight > at(&f, 1000.0 - band * 0.7, 0).unwrap().weight);
        assert_eq!(at(&f, 1000.0 - band - 1.0, 0), None);
        assert_eq!(at(&f, 1000.0 + band + 1.0, 1), None);
    }

    #[test]
    fn no_weight_across_a_town_circuit_or_between_like_phases() {
        let phases = halves(("core", "core"), ("middle", "ring"));
        let walled = Field::new(&phases, &[wall(-10.0, -10.0, 1000.0, 1010.0)]);
        assert_eq!(at(&walled, 990.0, 0), None);
        assert_eq!(at(&walled, 1010.0, 1), None);
        // A citadel or other purposeful enclosure is no town boundary.
        let mut citadel = wall(-10.0, -10.0, 1000.0, 1010.0);
        citadel.purpose = "citadel".into();
        assert!(at(&Field::new(&phases, &[citadel]), 990.0, 0).is_some());
        let like = Field::new(&halves(("middle", "ring"), ("middle", "ring")), &[]);
        assert_eq!(at(&like, 1000.0, 0), None);
        let village = Field::new(&halves(("village", "village"), ("middle", "ring")), &[]);
        assert_eq!(at(&village, 1000.0, 0), None);
        assert_eq!(at(&village, 1000.0, 1), None);
    }

    fn morph(core: [f64; 2], middle: [f64; 2], storeys: [u32; 2], grid: bool) -> Morph {
        Morph {
            value: json!({
                "streetOp": if grid { "grid" } else { "organic" },
                "frontage": {"core": core, "middle": middle, "edge": [middle[0] * 2.0, middle[1] * 2.0]},
                "blockSize": {"core": core, "middle": middle},
                "arch": {"storeys": storeys}
            }),
        }
    }

    #[test]
    fn blend_reaches_mid_values_at_half_weight_and_keeps_integer_storeys() {
        let other = morph([20.0, 40.0], [30.0, 60.0], [1, 2], true);
        let mut own = morph([10.0, 20.0], [12.0, 24.0], [3, 5], true);
        blend(&mut own, "core", &other, "middle", 0.5);
        assert_eq!(own.range("frontage", "core"), [20.0, 40.0]);
        assert_eq!(own.range("blockSize", "core"), [20.0, 40.0]);
        assert_eq!(own.value["arch"]["storeys"], json!([3, 5]));
        assert_eq!(mix([3.0, 5.0], storeys_of(&own.value["arch"])), [2.0, 3.5]);
        assert!((floored(&own.value["arch"], "core", 0.0) - 0.325).abs() < 1e-12);
        // Weight zero: own values (graded tissue: the endpoints are blended).
        let mut own = morph([10.0, 20.0], [12.0, 24.0], [3, 5], false);
        let before = own.value.clone();
        blend(&mut own, "middle", &other, "middle", 0.0);
        for key in ["frontage", "blockSize"] {
            assert_eq!(own.value[key], before[key]);
        }
        // Pressure-graded keys interpolate their endpoints.
        blend(&mut own, "middle", &other, "middle", 0.5);
        assert_eq!(own.range("frontage", "core"), [15.0, 30.0]);
        assert_eq!(own.range("blockSize", "middle"), [21.0, 42.0]);
        assert_eq!(floored(&json!({}), "core", 0.1), CORE_FLOOR);
        assert_eq!(floored(&json!({}), "middle", 0.1), 0.1);
    }

    use super::super::{LayoutConfig, ParcelConfig, Partition, Site, Street, Surface, generate_parcels, generate_quarters};

    /// A flat town on a regional road; `density` None leaves the option out.
    fn town(density: Option<&str>, fortification: &str) -> (Vec<Layout>, Vec<Partition>) {
        let n = 128;
        let (height, water) = (vec![10.0; n * n], vec![0; n * n]);
        let surface = Surface { geometry: None, width: 6000.0, n, height: &height, water: &water, interpolation: Default::default() };
        let site = Site {
            key: "gradient".into(), name: String::new(), population: 8000, culture: "european-organic".into(),
            center: Point { x: 3000.0, y: 3000.0 }, radius: 150.0, neighbours: Vec::new(),
        };
        let mut cfg: LayoutConfig = serde_json::from_str(include_str!("fixtures/small-layout-config.json")).unwrap();
        cfg.fortification = fortification.into();
        if let Some(d) = density {
            cfg.zone_density = d.into();
        }
        let roads = vec![Street {
            key: None,
            path: vec![Point { x: 0.0, y: 3000.0 }, Point { x: 6000.0, y: 3000.0 }],
            widths: vec![8.0; 2], rank: 1, role: "regional".into(),
        }];
        let layouts = generate_quarters("gradient", &[site], &cfg, surface, &roads).unwrap();
        let parts = generate_parcels("gradient", &layouts, &ParcelConfig::default()).unwrap();
        (layouts, parts)
    }
    fn shortfall(l: &Layout) -> (f64, f64) {
        l.structure.as_ref().and_then(|s| s.metrics.capacity.as_ref()).map_or((0.0, 0.0), |c| (c.shortfall, c.required))
    }

    #[test]
    fn open_town_phases_unchanged_and_gradient_lots_between_zones() {
        let base = town(None, "none");
        let phases = town(Some("phases"), "none");
        assert!(serde_json::to_string(&base).unwrap() == serde_json::to_string(&phases).unwrap(), "phases changed the town");
        let (layouts, parts) = town(Some("gradient"), "none");
        let l = &layouts[0];
        assert!(l.phases.len() > 1, "no phases to blend");
        let (gap, required) = shortfall(l);
        assert!(gap <= shortfall(&base.0[0]).0 + 0.05 * required, "gradient leaves households unhoused: {gap} of {required}");
        // The band covers most of a small town: the zone means are those of the
        // phases-mode town, the band mean that of the blended blocks.
        let blends = blocks(l);
        let mut band = (0.0, 0usize);
        for p in &parts[0].parcels {
            if l.blocks.get(p.block).is_some_and(|b| b.kind == "block" && b.zone != "village") && blends[p.block].is_some() {
                (band.0 += area(&p.shape), band.1 += 1);
            }
        }
        let mut zones = std::collections::BTreeMap::<String, (f64, usize)>::new();
        for p in &base.1[0].parcels {
            let Some(b) = base.0[0].blocks.get(p.block).filter(|b| b.kind == "block" && b.zone != "village") else { continue };
            let z = zones.entry(b.zone.clone()).or_default();
            (z.0 += area(&p.shape), z.1 += 1);
        }
        let means: Vec<f64> = zones.values().filter(|z| z.1 > 0).map(|z| z.0 / z.1 as f64).collect();
        assert!(band.1 > 0 && means.len() > 1, "no band or a single zone: {band:?} {zones:?}");
        let mean = band.0 / band.1 as f64;
        let (lo, hi) = means.iter().fold((f64::MAX, f64::MIN), |(lo, hi), &m| (lo.min(m), hi.max(m)));
        assert!(mean >= lo * 0.95 && mean <= hi * 1.05, "band mean {mean} outside zone means {lo}..{hi}");
    }

    #[test]
    fn walled_town_blends_no_block_across_its_circuit() {
        let (layouts, _) = town(Some("gradient"), "wall");
        let l = &layouts[0];
        let walls: Vec<Shape> = circuits(&l.enclosures).into_iter().map(|r| Shape { outer: r.clone(), holes: vec![] }).collect();
        assert!(!walls.is_empty(), "no town circuit");
        let f = field(&l.phases, &l.enclosures);
        let mut blended = 0;
        for (bi, b) in blocks(l).into_iter().enumerate() {
            let Some(b) = b else { continue };
            blended += 1;
            let p = interior_point(&l.blocks[bi].shape);
            // The path to the neighbour's land crosses each circuit an even number of times.
            let (d, q) = f.nearest(b.phase, p).unwrap();
            let q = if d > 1e-9 { Point { x: q.x + (q.x - p.x) / d * PUSH, y: q.y + (q.y - p.y) / d * PUSH } } else { q };
            for w in &walls {
                let r = &w.outer;
                let hits = r.iter().zip(r.iter().cycle().skip(1)).take(r.len())
                    .filter(|&(&a, &c)| super::super::geometry::segment_hit(p, q, a, c).is_some()).count();
                assert!(hits % 2 == 0, "block {bi} blended across a circuit");
            }
        }
        assert!(blended > 0, "no block blended");
    }
}
