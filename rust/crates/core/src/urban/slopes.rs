//! Slope towns: the household ladder of a town whose normal build falls short
//! because its land is steep. Ordinary ground never enters it, so flat towns
//! keep the exact normal layout.
//!
//! Ladder, each step adopted only for a real household gain: (a) densify
//! within the culture's limits, then relax the culture streets' house gates;
//! (b) grow onto the flanks, as terrace wards on land the town left aside and
//! as terraced frontage along the existing roads; (c) warn when still short.
use super::{Block, Layout, LayoutConfig, ParcelConfig, Point, ProgrammeContext, Quarter, Shape, Site,
    Street, Surface, UrbanDistrict, geometry as g, kinds::Kind, profiles, programme};

/// Survey grade (rise over run) of steep ground: 0.34 (19°) is past ordinary street grades.
const STEEP_GRADE: f64 = 0.34;
/// Survey grid half-size: samples every third of the radius, kept within the site disc.
const SURVEY_STEPS: i32 = 3;
/// Steep dry samples (of 29 in the disc) that make a slope site; one bank or knoll is not one.
const STEEP_SAMPLES: usize = 4;
/// Survey radius cap (m): beyond it a large city's reach is fields, not its slope.
const SURVEY_RADIUS: f64 = 900.0;
/// Footprint shortfall, as a share of the land target, that signals land refused by slope.
const LAND_SHORTFALL: f64 = 0.1;
/// Fill goal: households housed over households requested.
const FILL_GOAL: f64 = 0.95;
/// A step is adopted only if it houses this share of the requested households more.
const MIN_GAIN: f64 = 0.05;
/// House gate relaxations of the culture streets, tried before terraces (the flank ladder).
const STREET_RELAX: [f64; 2] = [0.5, 0.75];
/// Terrace house gate: eight times the native gate with a finite six-metre stepped foundation.
const TERRACE_RELAX: f64 = 0.875;
/// Frontage reach from the site centre, in site radii (the urban reach of its approaches).
const FRONTAGE_REACH: f64 = 1.8;
/// Frontage station along a road (m): two plot widths.
const STATION: f64 = 24.0;
/// A station chord shorter than this crosses a hairpin tip instead of following the road.
const MIN_CHORD: f64 = 18.0;
/// Frontage depth: one six-metre terrace step of rise, clamped to a 7-20 m plot.
const DEPTH_RISE: f64 = 6.0;
const DEPTH_RANGE: (f64, f64) = (7.0, 20.0);
/// Cliff grade (51°): no terrace or frontage plot beyond it.
const CLIFF_GRADE: f64 = 1.25;
/// Smallest retained ward piece (m²): one small house and its yard.
const MIN_PIECE: f64 = 70.0;
/// Frontage candidates kept, nearest first: bounds the clipping work of a long road net.
const MAX_STRIPS: usize = 2400;
/// Sampling step (m) when clipping a polyline to a ward; the pieces stay on the source line.
const CLIP_STEP: f64 = 6.0;
/// Reach (m) of a ward street or road piece beyond its blocks' bounds.
const WARD_REACH: f64 = 12.0;
/// Zone of the added wards: ordinary town plots, outside the founding core.
const WARD_ZONE: &str = "middle";

pub(super) const DENSIFIED: &str = "Slope town: smaller plots and taller houses within the culture's limits were tried before extending onto the slopes.";
pub(super) const TERRACED: &str = "Slope town: contour terraces with stepped foundations extend housing onto the flanks the town had left aside.";
pub(super) const FRONTAGE: &str = "Slope town: terraced plots line both sides of the existing roads on the flanks.";
pub(super) const EXHAUSTED: &str = "Slope town housing shortfall: usable terraces and the culture's maximum density cannot accommodate all requested households.";

/// A town of the quarter grammar whose reach holds steep dry ground.
pub(super) fn eligible(site: &Site, cfg: &LayoutConfig, surface: Surface<'_>, kind: Kind) -> bool {
    if cfg.programme.intent != "settlement" || kind.small()
        || crate::settlements::demographics::below(site.population, "town")
        || cfg.placement != "center" || cfg.footprint.mechanism == "legacy"
        || cfg.tissue != "culture" || cfg.site_adaptation == 0.0 {
        return false;
    }
    let radius = site.radius.min(SURVEY_RADIUS);
    let d = (surface.width / surface.height_resolution() as f64).max(2.0);
    let mut steep = 0;
    for y in -SURVEY_STEPS..=SURVEY_STEPS {
        for x in -SURVEY_STEPS..=SURVEY_STEPS {
            if x * x + y * y > SURVEY_STEPS * SURVEY_STEPS { continue; }
            let step = radius / SURVEY_STEPS as f64;
            let p = Point { x: site.center.x + x as f64 * step, y: site.center.y + y as f64 * step };
            if !surface.wet(p) && grade(p, d, surface) > STEEP_GRADE { steep += 1; }
        }
    }
    steep >= STEEP_SAMPLES
}

/// Cheap shortfall signal of the normal layout, before any parcel pass: its
/// footprint fell short of the land target, or the house gates refuse most
/// of its land. Both are slope effects on an eligible site.
pub(super) fn short(layout: &Layout) -> bool {
    let land_short = layout.structure.as_ref().is_some_and(|s|
        s.metrics.target_area > 0.0 && s.metrics.shortfall_area > LAND_SHORTFALL * s.metrics.target_area);
    land_short || super::housable_share(layout) < profiles::SLOPE_RELAX_GOAL
}

fn grade(p: Point, d: f64, surface: Surface<'_>) -> f64 {
    let gx = (surface.height_at(Point { x: p.x + d, y: p.y })
        - surface.height_at(Point { x: p.x - d, y: p.y })) / (2.0 * d);
    let gy = (surface.height_at(Point { x: p.x, y: p.y + d })
        - surface.height_at(Point { x: p.x, y: p.y - d })) / (2.0 * d);
    gx.hypot(gy)
}

/// Households requested and housed by the actual cadastre, after occupancy
/// trimming and reservations. None when the trial cannot be subdivided.
fn households(seed: &str, layout: &Layout) -> Option<(f64, f64)> {
    let layouts = std::slice::from_ref(layout);
    let parts = super::generate_parcels(seed, layouts, &ParcelConfig::default()).ok()?;
    let parts = programme::reallocate(layouts, &parts).ok()?;
    Some(parts.iter().filter_map(|p| p.programme.as_ref()).flat_map(|p| &p.demands)
        .filter(|d| d.unit == "domesticUnits")
        .fold((0.0, 0.0), |(wanted, housed), d|
            (wanted + d.requested, housed + d.parcel_capacity.min(d.requested))))
}

/// Run the ladder on a slope town whose normal layout is short. Never fails:
/// a trial that errors is a rejected candidate. `Err(normal)` when the
/// cadastre houses the town after all (the caller keeps its own flank ladder).
#[allow(clippy::too_many_arguments)]
pub(super) fn complete(
    seed: &str, site: &Site, cfg: &LayoutConfig, surface: Surface<'_>, roads: &[Street], others: &[Point],
    normal: Layout, lay: impl Fn(&LayoutConfig) -> Result<Layout, String>,
    retail: impl Fn(&mut Layout, &ProgrammeContext, bool) -> Result<(), String>,
) -> Result<Layout, Layout> {
    let Some((wanted, mut housed)) = households(seed, &normal) else { return Err(normal) };
    let goal = wanted * FILL_GOAL;
    if wanted <= 0.0 || housed >= goal { return Err(normal); }
    let gain = (wanted * MIN_GAIN).max(1.0);
    let better = |candidate: &Layout, housed: f64| households(seed, candidate)
        .map(|(_, found)| found).filter(|&found| found >= housed + gain);
    let mut best = normal;
    // (a) Densify within the culture's limits.
    let mut base = cfg.clone();
    base.capacity_floor = 1.0;
    let mut densified = false;
    if let Ok(candidate) = lay(&base) && let Some(found) = better(&candidate, housed) {
        (best, housed, densified) = (candidate, found, true);
    }
    if !densified { base = cfg.clone(); }
    // Then the culture streets with relaxed house gates, while the gates
    // refuse most of the land (otherwise relaxing them cannot help).
    let mut relaxed = 0.0;
    for relax in STREET_RELAX {
        if housed >= goal || super::housable_share(&best) >= profiles::SLOPE_RELAX_GOAL { break; }
        let mut trial = base.clone();
        trial.programme.slope_relax = relax;
        if let Ok(candidate) = lay(&trial) && let Some(found) = better(&candidate, housed) {
            (best, housed, relaxed) = (candidate, found, relax);
            base = trial;
        }
    }
    // (b) Grow onto the flanks: terrace wards on the land the town left aside.
    let context = |layout: &Layout| {
        let mut c = layout.programme.as_ref().map_or_else(|| base.programme.clone(), |p| p.context.clone());
        c.slope_relax = c.slope_relax.max(TERRACE_RELAX);
        c
    };
    let mut terraced = false;
    let mut warded = false;
    if housed < goal {
        let mut trial = base.clone();
        trial.tissue = "terraces".into();
        trial.axis_alignment = "culture".into();
        trial.programme.slope_relax = trial.programme.slope_relax.max(TERRACE_RELAX);
        if let Ok(terraces) = lay(&trial) {
            let mut candidate = best.clone();
            let grafted = (graft(&mut candidate, &terraces, site, surface, roads, others)
                && retail(&mut candidate, &context(&best), false).is_ok())
                .then(|| better(&candidate, housed)).flatten();
            // The whole terrace layout replaces the town only when it houses
            // more than the grafted wards (a town that kept little useful land).
            let whole = better(&terraces, housed).filter(|&w| grafted.is_none_or(|g| w > g));
            if let Some(found) = whole {
                (best, housed, terraced) = (terraces, found, true);
            } else if let Some(found) = grafted {
                (best, housed, terraced, warded) = (candidate, found, true, true);
            }
        }
    }
    // Then terraced frontage along the existing roads (switchbacks unchanged).
    let mut fronted = false;
    if housed < goal {
        let mut candidate = best.clone();
        if extend_frontage(&mut candidate, site, surface, roads, others)
            && retail(&mut candidate, &context(&best), false).is_ok()
            && let Some(found) = better(&candidate, housed) {
            (best, housed, fronted, warded) = (candidate, found, true, true);
        }
    }
    // The rest of the finish tail, once, on the adopted wards.
    if warded {
        let mut tailed = best.clone();
        if retail(&mut tailed, &context(&best), true).is_ok() { best = tailed; }
    }
    // (c) Say what was done, and warn when the town is truly full.
    if densified { best.warnings.push(DENSIFIED.into()); }
    if relaxed > 0.0 {
        best.warnings.push(format!(
            "Site trop pentu pour les règles ordinaires : maisons admises sur des pentes plus fortes, sur soubassements en gradins (assouplissement {:.0} %).",
            relaxed * 100.0
        ));
    }
    if terraced { best.warnings.push(TERRACED.into()); }
    if fronted { best.warnings.push(FRONTAGE.into()); }
    if housed < goal { best.warnings.push(EXHAUSTED.into()); }
    Ok(best)
}

fn overlaps(a: (f64, f64, f64, f64), b: (f64, f64, f64, f64)) -> bool {
    a.0 < b.2 && b.0 < a.2 && a.1 < b.3 && b.1 < a.3
}

fn expand(b: (f64, f64, f64, f64), m: f64) -> (f64, f64, f64, f64) { (b.0 - m, b.1 - m, b.2 + m, b.3 + m) }

fn inside_bounds(b: (f64, f64, f64, f64), p: Point) -> bool { p.x >= b.0 && p.x <= b.2 && p.y >= b.1 && p.y <= b.3 }

/// Closer to this town's centre than to any other site: two towns never
/// claim the same flank or road stretch.
fn own_side(site: &Site, others: &[Point], p: Point) -> bool {
    let d = (p.x - site.center.x).hypot(p.y - site.center.y);
    others.iter().all(|o| (p.x - o.x).hypot(p.y - o.y) > d)
}

type Bounded = Vec<((f64, f64, f64, f64), Shape)>;

/// Everything a new ward must not cover: every block (reserves, gate
/// villages and institutions included), quays, spring sites, and the
/// transport corridors of the town, of the map roads and of the walls.
/// Reserve blocks that hold no institution or common: land the town left to
/// the fields, which a ward may take (`add_ward` cuts them).
fn open_reserves(layout: &Layout) -> Vec<bool> {
    let held: std::collections::HashSet<usize> = layout.programme.iter()
        .flat_map(|p| &p.reservations).map(|r| r.block).collect();
    layout.blocks.iter().enumerate().map(|(i, b)| b.kind == "reserve" && !held.contains(&i)).collect()
}

fn obstacles(layout: &Layout, roads: &[Street], reach: (f64, f64, f64, f64)) -> (Bounded, Bounded) {
    let open = open_reserves(layout);
    let mut land: Bounded = layout.blocks.iter().zip(&open).filter(|(_, o)| !**o)
        .map(|(b, _)| (g::bbox(&b.shape), b.shape.clone())).collect();
    if let Some(s) = &layout.structure {
        land.extend(s.quays.iter().map(|q| (g::bbox(&q.shape), q.shape.clone())));
        land.extend(s.spring_sites.iter().map(|w| (g::bbox(&w.shape), w.shape.clone())));
    }
    let near = |s: &&Street| s.path.iter().any(|&p| inside_bounds(reach, p));
    let corridors = layout.streets.iter().chain(roads.iter().filter(near))
        .flat_map(|s| g::ribbon(&s.path, &s.widths))
        .chain(layout.enclosures.iter().flat_map(|e| g::ribbon(&e.path, &[e.curtain_width_m.max(4.0) + 2.0])))
        .map(|s| (g::bbox(&s), s)).collect();
    (land, corridors)
}

fn cut(shape: Shape, against: &[&Bounded]) -> Vec<Shape> {
    let bounds = g::bbox(&shape);
    let mut pieces = vec![shape];
    for (_, used) in against.iter().flat_map(|b| b.iter()).filter(|(b, _)| overlaps(bounds, *b)) {
        pieces = pieces.into_iter().flat_map(|p| g::difference(&p, used)).collect();
        if pieces.is_empty() { break; }
    }
    pieces
}

/// Points along a polyline every `step` metres, the source vertices included,
/// with the width of their segment. One pass over the polyline.
fn resample(path: &[Point], widths: &[f64], step: f64) -> Vec<(Point, f64, bool)> {
    let width = |i: usize| widths.get(i).copied().or_else(|| widths.first().copied()).unwrap_or(4.0);
    let mut out = vec![];
    for (i, w) in path.windows(2).enumerate() {
        let len = (w[1].x - w[0].x).hypot(w[1].y - w[0].y);
        let n = (len / step).ceil().max(1.0) as usize;
        for k in 0..n {
            let t = k as f64 / n as f64;
            out.push((Point { x: w[0].x + (w[1].x - w[0].x) * t, y: w[0].y + (w[1].y - w[0].y) * t }, width(i), k == 0));
        }
    }
    if let Some(&last) = path.last() { out.push((last, width(path.len().saturating_sub(2)), true)); }
    out
}

/// The runs of a street where `keep` holds, on the source line itself.
fn clip(street: &Street, keep: impl Fn(Point) -> bool) -> Vec<Street> {
    let mut out = vec![];
    let mut run: Vec<(Point, f64)> = vec![];
    let mut flush = |run: &mut Vec<(Point, f64)>| {
        if run.len() >= 2 {
            out.push(Street { path: run.iter().map(|r| r.0).collect(), widths: run.iter().map(|r| r.1).collect(),
                rank: street.rank, role: street.role.clone() });
        }
        run.clear();
    };
    for (p, w, _) in resample(&street.path, &street.widths, CLIP_STEP) {
        if keep(p) { run.push((p, w)); } else { flush(&mut run); }
    }
    flush(&mut run);
    out
}

/// Add a ward: one `middle` quarter per block (a `fringe` zone cuts garden and
/// farm lots, not town plots), in the latest growth phase, one
/// district for the whole ward, the ward streets, and the allocated land.
fn add_ward(layout: &mut Layout, blocks: Vec<(Shape, Point)>, streets: Vec<Street>, tissue: &str) {
    // Open reserves give up the ward's land; block indices change, and the
    // programme is prepared again after every ward.
    let open = open_reserves(layout);
    let cutters: Bounded = blocks.iter().map(|(s, _)| (g::bbox(s), s.clone())).collect();
    for (i, block) in std::mem::take(&mut layout.blocks).into_iter().enumerate() {
        if !open[i] { layout.blocks.push(block); continue; }
        for shape in cut(block.shape.clone(), &[&cutters]).into_iter().filter(|s| g::area(s) >= 4.0) {
            layout.blocks.push(Block { shape, ..block.clone() });
        }
    }
    let phase = layout.quarters.iter().map(|q| q.phase).max().unwrap_or(0);
    let mut quarters = vec![];
    for (shape, axis) in blocks {
        let quarter = layout.quarters.len();
        quarters.push(quarter);
        layout.quarters.push(Quarter { shape: shape.clone(), phase, zone: WARD_ZONE.into() });
        layout.blocks.push(Block { shape, quarter, kind: "block".into(), axis, zone: WARD_ZONE.into(), phase: Some(phase) });
    }
    layout.streets.extend(streets);
    if let Some(structure) = &mut layout.structure {
        // Wards hang off the first (founding) centre.
        structure.districts.push(UrbanDistrict { id: structure.districts.len(), center: 0, phase, tissue: tissue.into(),
            quarters, role: "commoner".into(), wealth: 0.25, label: String::new() });
        structure.allocated = g::union(&layout.blocks.iter().filter(|b| b.kind == "block")
            .map(|b| b.shape.clone()).collect::<Vec<_>>());
        structure.metrics.allocated_area = structure.allocated.iter().map(g::area).sum();
        structure.metrics.shortfall_area = (structure.metrics.target_area - structure.metrics.allocated_area).max(0.0);
        if let Some(plan) = structure.metrics.capacity.as_mut() {
            plan.densify = 1.0;
            plan.vacancy = 0.0;
        }
    }
}

fn reach_bounds(site: &Site) -> (f64, f64, f64, f64) {
    let r = site.radius * FRONTAGE_REACH;
    (site.center.x - r, site.center.y - r, site.center.x + r, site.center.y + r)
}

/// Terrace wards from a terrace layout of the same site, on the land the
/// town left aside only: the existing town, its core and its streets stay.
fn graft(layout: &mut Layout, terraces: &Layout, site: &Site, surface: Surface<'_>, roads: &[Street], others: &[Point]) -> bool {
    let d = (surface.width / surface.height_resolution() as f64).max(2.0);
    let (land, corridors) = obstacles(layout, roads, reach_bounds(site));
    let mut blocks = vec![];
    for block in terraces.blocks.iter().filter(|b| b.kind == "block") {
        for piece in cut(block.shape.clone(), &[&land, &corridors]) {
            if g::area(&piece) < MIN_PIECE || grade(g::interior_point(&piece), d, surface) > CLIFF_GRADE
                || !piece.outer.iter().all(|&p| own_side(site, others, p)) { continue; }
            blocks.push((piece, block.axis));
        }
    }
    if blocks.is_empty() { return false; }
    let near: Vec<_> = blocks.iter().map(|(s, _)| expand(g::bbox(s), WARD_REACH)).collect();
    let town: Vec<_> = layout.blocks.iter().map(|b| (g::bbox(&b.shape), &b.shape)).collect();
    let keep = |p: Point| near.iter().any(|&b| inside_bounds(b, p)) && own_side(site, others, p)
        && !town.iter().any(|(b, s)| inside_bounds(*b, p) && g::contains(s, p))
        && !corridors.iter().any(|(b, s)| inside_bounds(*b, p) && g::contains(s, p));
    let streets = terraces.streets.iter()
        .filter(|s| !matches!(s.role.as_str(), "regional" | "bridge" | "causeway" | "approach" | "quay"))
        .filter(|s| s.path.iter().any(|&p| near.iter().any(|&b| inside_bounds(b, p))))
        .flat_map(|s| clip(s, &keep)).collect();
    add_ward(layout, blocks, streets, "terraces");
    true
}

/// Terraced frontage on both sides of the map's regional roads. The road
/// centrelines, widths, grades and switchbacks are never modified; only the
/// road pieces that serve the new plots join the town's streets.
fn extend_frontage(layout: &mut Layout, site: &Site, surface: Surface<'_>, roads: &[Street], others: &[Point]) -> bool {
    let reach = reach_bounds(site);
    let (land, corridors) = obstacles(layout, roads, reach);
    let d = (surface.width / surface.height_resolution() as f64).max(2.0);
    let regional: Vec<&Street> = roads.iter().filter(|r| r.role == "regional")
        .filter(|r| r.path.iter().any(|&p| inside_bounds(reach, p))).collect();
    let mut candidates = vec![];
    for road in &regional {
        let stations = resample(&road.path, &road.widths, STATION);
        // Fixed stations along the road, one pass; vertices only split them.
        let mut kept: Vec<(Point, f64)> = vec![];
        let mut along = 0.0;
        let mut last: Option<Point> = None;
        for &(p, w, _) in &stations {
            if let Some(q) = last { along += (p.x - q.x).hypot(p.y - q.y); }
            last = Some(p);
            if kept.is_empty() || along >= STATION - 1e-6 { kept.push((p, w)); along = 0.0; }
        }
        for pair in kept.windows(2) {
            let ((a, wa), (b, wb)) = (pair[0], pair[1]);
            let len = (b.x - a.x).hypot(b.y - a.y);
            if len < MIN_CHORD { continue; }
            let axis = Point { x: (b.x - a.x) / len, y: (b.y - a.y) / len };
            let middle = Point { x: (a.x + b.x) * 0.5, y: (a.y + b.y) * 0.5 };
            let distance = (middle.x - site.center.x).hypot(middle.y - site.center.y);
            if distance > site.radius * FRONTAGE_REACH || !own_side(site, others, middle) { continue; }
            let slope = grade(middle, d, surface);
            if slope > CLIFF_GRADE { continue; }
            let depth = (DEPTH_RISE / slope.max(0.2)).clamp(DEPTH_RANGE.0, DEPTH_RANGE.1);
            let near = wa.max(wb) * 0.5 + 0.25;
            for side in [-1.0, 1.0] {
                let normal = Point { x: -axis.y * side, y: axis.x * side };
                let p = |q: Point, offset: f64| Point { x: q.x + normal.x * offset, y: q.y + normal.y * offset };
                let shape = g::normalized(Shape { outer: vec![p(a, near), p(b, near), p(b, near + depth), p(a, near + depth)], holes: vec![] });
                if shape.outer.iter().any(|p| p.x < 0.0 || p.y < 0.0 || p.x > surface.width || p.y > surface.width) { continue; }
                candidates.push((distance, shape, axis));
            }
        }
    }
    candidates.sort_by(|a, b| a.0.total_cmp(&b.0));
    let mut added: Bounded = vec![];
    let mut blocks = vec![];
    for (_, shape, axis) in candidates.into_iter().take(MAX_STRIPS) {
        let dry = g::dry_clip(&surface, &shape);
        let pieces: Vec<_> = dry.into_iter().flat_map(|s| cut(s, &[&land, &corridors, &added])).collect();
        for piece in pieces {
            // Reject cliff remnants; the house admission then checks the real
            // foundation at every supported pose on this retained platform.
            if g::area(&piece) < MIN_PIECE || grade(g::interior_point(&piece), d, surface) > CLIFF_GRADE
                || !piece.outer.iter().all(|&p| own_side(site, others, p)) { continue; }
            added.push((g::bbox(&piece), piece.clone()));
            blocks.push((piece, axis));
        }
    }
    if blocks.is_empty() { return false; }
    // Only the road pieces beside the new plots, outside the town's own streets.
    let near: Vec<_> = added.iter().map(|(b, _)| expand(*b, WARD_REACH)).collect();
    let own: Vec<_> = layout.streets.iter().flat_map(|s| g::ribbon(&s.path, &s.widths)).map(|s| (g::bbox(&s), s)).collect();
    let keep = |p: Point| near.iter().any(|&b| inside_bounds(b, p))
        && !own.iter().any(|(b, s)| inside_bounds(*b, p) && g::contains(s, p));
    let streets = regional.iter().flat_map(|r| clip(r, &keep)).collect();
    add_ward(layout, blocks, streets, "frontage");
    true
}

#[cfg(test)]
mod tests {
    use super::*;

    fn slope_surface(height: &[f32], water: &[u8], n: usize) -> Surface<'static> {
        let (height, water): (&'static [f32], &'static [u8]) = (height.to_vec().leak(), water.to_vec().leak());
        Surface { geometry: None, width: 4000.0, n, height, water, interpolation: Default::default() }
    }

    fn empty_layout(site: &Site) -> Layout {
        serde_json::from_value(serde_json::json!({
            "key": site.key, "culture": "byzantine-greek", "center": site.center,
            "quarters": [], "streets": [], "blocks": [], "warnings": []})).unwrap()
    }

    #[test]
    fn switchback_frontage_imports_only_the_road_pieces_it_lines() {
        let n = 64;
        let height: Vec<f32> = (0..n * n).map(|i| 10.0 + (i % n) as f32 * 20.0).collect();
        let surface = slope_surface(&height, &vec![0; n * n], n);
        let site = Site { key: "city".into(), name: String::new(), population: 10_000, culture: "byzantine-greek".into(),
            center: Point { x: 2000.0, y: 2000.0 }, radius: 735.0 };
        let path = vec![Point { x: 2000.0, y: 1400.0 }, Point { x: 2050.0, y: 2600.0 }, Point { x: 2100.0, y: 1400.0 }];
        // A far road the town must not import, beyond its reach.
        let far = vec![Point { x: 100.0, y: 100.0 }, Point { x: 300.0, y: 100.0 }];
        let roads = vec![Street { widths: vec![4.0; path.len()], path, rank: 2, role: "regional".into() },
            Street { widths: vec![4.0; 2], path: far, rank: 2, role: "regional".into() }];
        let mut layout = empty_layout(&site);
        assert!(extend_frontage(&mut layout, &site, surface, &roads, &[]));
        // Map roads are never copied whole into the town; roads outside it are untouched.
        assert!(!layout.streets.iter().any(|s| s.path == roads[0].path || s.path == roads[1].path));
        assert!(layout.streets.iter().flat_map(|s| &s.path).all(|p| p.x > 1900.0));
        // Imported pieces lie on the source switchback.
        for p in layout.streets.iter().flat_map(|s| &s.path) {
            let d = roads[0].path.windows(2).map(|w| g::distance(*p, w[0], w[1]).0).fold(f64::INFINITY, f64::min);
            assert!(d < 1e-6, "{p:?} off the road by {d}");
        }
        assert!(layout.blocks.iter().any(|b| g::centroid(&b.shape).x < 2000.0));
        assert!(layout.blocks.iter().any(|b| g::centroid(&b.shape).x > 2100.0));
        let corridor = g::ribbon(&roads[0].path, &roads[0].widths);
        for block in &layout.blocks {
            assert!(corridor.iter().flat_map(|s| g::intersection(s, &block.shape)).map(|s| g::area(&s)).sum::<f64>() < 0.01);
            assert_eq!(block.zone, WARD_ZONE);
        }
    }

    /// Two towns on one road split it; reserves and quays stay free.
    #[test]
    fn frontage_respects_neighbours_reserves_and_quays() {
        let n = 64;
        let height: Vec<f32> = (0..n * n).map(|i| 10.0 + (i % n) as f32 * 20.0).collect();
        let surface = slope_surface(&height, &vec![0; n * n], n);
        let path = vec![Point { x: 2050.0, y: 1000.0 }, Point { x: 2050.0, y: 3000.0 }];
        let roads = vec![Street { widths: vec![4.0; 2], path, rank: 2, role: "regional".into() }];
        let a = Site { key: "a".into(), name: String::new(), population: 10_000, culture: "byzantine-greek".into(),
            center: Point { x: 2000.0, y: 1700.0 }, radius: 735.0 };
        let b = Site { key: "b".into(), center: Point { x: 2000.0, y: 2300.0 }, ..a.clone() };
        let reserve = Shape { outer: vec![Point { x: 2000.0, y: 1500.0 }, Point { x: 2100.0, y: 1500.0 },
            Point { x: 2100.0, y: 1560.0 }, Point { x: 2000.0, y: 1560.0 }], holes: vec![] };
        let quay = Shape { outer: vec![Point { x: 2000.0, y: 1300.0 }, Point { x: 2100.0, y: 1300.0 },
            Point { x: 2100.0, y: 1340.0 }, Point { x: 2000.0, y: 1340.0 }], holes: vec![] };
        let mut la = empty_layout(&a);
        la.blocks.push(Block { shape: reserve.clone(), quarter: 0, kind: "reserve".into(), axis: Point { x: 1.0, y: 0.0 },
            zone: "core".into(), phase: Some(0) });
        la.structure = Some(super::super::UrbanStructure { quays: vec![super::super::macroplan::harbour::Quay {
            kind: "quay".into(), shape: quay.clone(), deck_z_m: 0.0, material: "stone".into() }], ..Default::default() });
        let mut lb = empty_layout(&b);
        assert!(extend_frontage(&mut la, &a, surface, &roads, &[b.center]));
        assert!(extend_frontage(&mut lb, &b, surface, &roads, &[a.center]));
        let area = |x: &Shape, y: &Shape| g::intersection(x, y).iter().map(g::area).sum::<f64>();
        // The open reserve (no institution) gives up the ward's land: no overlap remains.
        assert!(la.blocks.iter().any(|b| b.kind == "reserve"));
        for ba in la.blocks.iter().filter(|b| b.kind == "block") {
            assert!(area(&ba.shape, &quay) < 0.01);
            for r in la.blocks.iter().filter(|b| b.kind == "reserve") { assert!(area(&ba.shape, &r.shape) < 0.01); }
            for bb in &lb.blocks { assert!(area(&ba.shape, &bb.shape) < 0.01, "neighbour frontage overlaps"); }
            assert!(ba.shape.outer.iter().all(|p| p.y <= 2000.0 + 1e-6));
        }
    }
}
