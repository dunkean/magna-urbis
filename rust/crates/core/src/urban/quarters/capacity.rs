//! Capacity-based replanning, borrowed tissue and the reference quarter probe.

use super::closes::closes;
use super::field::Field;
use super::frames::frame;
use super::pass::generate_once;
use super::street_index::{Bins, RegionalIndex};
use super::subdivision::split_quarter;
use super::vacancy::{drop_vacant_quarters, peel_vacant_edges};
use crate::urban::{
    Block, Layout, LayoutConfig, Morph, Point, Quarter, Shape, Site, Street, Surface, edits,
    footprint::capacity, fortification, geography, geometry as g, kinds, macroplan, par, profile::Lap, roles, warnings,
};
use crate::{noise::Noise, rng::Rng};

/// Quarters of one site. Closed loop of the adaptive capacity: when the
/// measure of the real blocks falls short of the plan by more than 5 % (10 %
/// for a town walled along water; the probe over-predicted the tissue), the
/// site is drawn once more with the
/// probed yields scaled by measured / predicted, so the footprint, the
/// densification and any borrowing are sized on the measured yield. The
/// better of the two drawings is kept; the shortfall stays explicit.
pub(in crate::urban) fn generate(
    seed: &str,
    site: &Site,
    cfg: &LayoutConfig,
    m: &Morph,
    surface: Surface<'_>,
    roads: &[Street],
    stilt_grounded: bool,
) -> Result<Layout, String> {
    let mut laps = Lap::new("quarters");
    let mut layout = generate_planned(seed, site, cfg, m, surface, roads, stilt_grounded)?;
    laps.lap("planned");
    // A minimum of one household per enclosed block must fit the +30 %
    // programme. Replan the land budget; wall tracing remains unchanged.
    let culture = if cfg.culture == "site" { &site.culture } else { &cfg.culture };
    let limit = (1.3 * site.population as f64 / roles::settlement_occupancy(culture, site.population).household_size).floor().max(1.0);
    // Rings indexed once, blocks tested in parallel (same arithmetic as `g::contains`).
    let enclosed_blocks = |l: &Layout| {
        let rings: Vec<g::ContainmentIndex> = l.enclosures.iter().map(|e| g::ContainmentIndex::new(&Shape { outer: e.path.clone(), holes: vec![] })).collect();
        if rings.is_empty() { return 0; }
        par::map(&l.blocks, |_, b| b.kind == "block" && { let p = g::interior_point(&b.shape); rings.iter().any(|r| r.contains(p)) })
            .into_iter().filter(|&inside| inside).count()
    };
    let mut count = enclosed_blocks(&layout);
    for _ in 0..3 {
        if count as f64 <= limit || cfg.footprint.mechanism == "legacy" { break; }
        let Some(structure) = &layout.structure else { break };
        let target = structure.metrics.target_area * (limit / count as f64) * 0.9;
        if target <= 0.0 { break; }
        let mut smaller = cfg.clone();
        smaller.footprint.budget = "population".into();
        smaller.footprint.gross_density = site.population as f64 * 10_000.0 / target;
        let mut next = generate_planned(seed, site, &smaller, m, surface, roads, stilt_grounded)?;
        let next_count = enclosed_blocks(&next);
        if next_count >= count { break; }
        next.warnings.push(warnings::walled_land_reduced());
        layout = next;
        count = next_count;
    }
    laps.lap("enclosed");
    let mut dropped = drop_vacant_quarters(&mut layout);
    let peeled = peel_vacant_edges(&mut layout);
    // Growth quarters the peeling emptied go too.
    dropped += drop_vacant_quarters(&mut layout);
    laps.lap("vacant");
    if dropped + peeled > 0 {
        layout.warnings.push(warnings::vacant_land_released(dropped, peeled));
    }
    Ok(layout)
}
fn generate_planned(
    seed: &str,
    site: &Site,
    cfg: &LayoutConfig,
    m: &Morph,
    surface: Surface<'_>,
    roads: &[Street],
    stilt_grounded: bool,
) -> Result<Layout, String> {
    // Raster-only callers clip against the water's cell-scale contour, not its
    // right-angle staircase (geography.rs; vector geography is kept as given).
    let shoreline = geography::raster_shoreline(&surface);
    let surface = shoreline.as_ref().map_or(surface, |s| s.surface(surface));
    // The common entry already owns the stilt site/surface. Preserve the
    // existing priority of that shore over a second harbour relocation.
    // A ring camp (tents, huts round a byre) has no quay: it keeps its own ground.
    let culture = if cfg.culture == "site" { &site.culture } else { &cfg.culture };
    let camp = kinds::ring_camp(culture, site.population, cfg);
    let harboured = (!stilt_grounded && !cfg.fixed_sites.contains(&site.key) && site.population < 3000 && !camp)
        .then(|| macroplan::harbour::sited(site, cfg, surface))
        .flatten();
    // The landing is a move for the better only: a relocation that leaves no
    // block (a bank no street reaches) keeps the settlement on its own site.
    let (first, site) = match &harboured {
        Some(moved) => {
            let there = generate_once(seed, moved, cfg, m, surface, roads)?;
            // Households the plan can lodge (blocks when no capacity plan).
            let housed = |l: &Layout| if l.blocks.is_empty() { 0.0 } else { capacity::of(l).map_or(1.0, |p| p.predicted) };
            let poor = there.blocks.is_empty() || capacity::of(&there).is_some_and(|p| p.predicted < 0.25 * p.required);
            let here = if poor { Some(generate_once(seed, site, cfg, m, surface, roads)?) } else { None };
            match here {
                Some(mut here) if housed(&here) > housed(&there) => {
                    here.warnings.push(warnings::landing_abandoned());
                    (here, site)
                }
                _ => (there, moved),
            }
        }
        None => (generate_once(seed, site, cfg, m, surface, roads)?, site),
    };
    // Villages move to their landing; towns retain their nucleus and grow a
    // connected waterfront nucleus (footprint), with the same total demand.
    let Some(p) = capacity::of(&first) else {
        return Ok(first);
    };
    // A town whose wall stands along water keeps its drawing up to 10 % short (the capacity
    // warning says so): its circuit stands back from the bank, and a trace moved by a few metres
    // must not buy a second plan of the whole town.
    let share = if fortification::walled_on_water(&first, surface) { 0.10 } else { 0.05 };
    let tolerance = (share * p.required).max(if cfg.small_place_capacity { 8.0 } else { 0.0 });
    if cfg.capacity_yield > 0.0
        || p.forecast <= 0.0
        || p.shortfall <= tolerance
        || p.measured_plan <= 0.0
    {
        return Ok(first);
    }
    // Probe and measure at the same densification: the lots as finally
    // densified on the real blocks, against the probed forecast at that level.
    let planned = p.network_densify.clamp(0.0, 1.0);
    let t = p.densify.clamp(planned, 1.0);
    let at = if planned < 1.0 {
        p.forecast + (p.forecast_dense - p.forecast) * (t - planned) / (1.0 - planned)
    } else {
        p.forecast
    };
    let measured = if t > planned {
        p.predicted
    } else {
        p.measured_plan
    };
    // On a fully extended, fully densified plan, a sample within the planning
    // tolerance confirms the forecast. Recalibrate only for a new deficit or
    // when the measured blocks cannot accommodate the households themselves.
    if planned == 1.0 && p.extension >= capacity::EXTENSION
        && measured >= p.households && measured >= at - tolerance {
        return Ok(first);
    }
    let ratio = (measured / at.max(1e-9)).clamp(0.3, 0.99);
    let again = LayoutConfig {
        capacity_yield: ratio,
        capacity_floor: t,
        ..cfg.clone()
    };
    let second = generate_once(seed, site, &again, m, surface, roads)?;
    let short = |l: &Layout| capacity::of(l).map_or(f64::INFINITY, |p| p.shortfall);
    Ok(if short(&second) < short(&first) {
        second
    } else {
        first
    })
}

/// Reference blocks of a tissue for the capacity probe (`footprint::capacity`):
/// one square quarter on flat open ground, framed by four main streets, cut by
/// the culture's own recursive streets and closes (`split_quarter`, `closes`),
/// then carved by its street ribbons like any city. `offset` is the quarter's
/// distance to the town centre. Returns the blocks, all streets and the gross
/// land of the quarter.
pub(in crate::urban) fn probe_quarter(
    morph: &Morph,
    cfg: &LayoutConfig,
    zone: &str,
    population: u32,
    offset: f64,
    seed: &str,
) -> (Vec<Block>, Vec<Street>, f64) {
    let street = |rank: usize| {
        morph.value["widthByRank"][rank].as_f64().unwrap_or(4.5)
            * morph.number_or("widthScale", 1.0).max(0.1)
    };
    let (w, h) = if !morph.text("campLayout").is_empty() {
        // A camp is a whole figure, not ten urban blocks capped at 25 ha.
        // Measure its own household cut at the requested demographic scale.
        let density = morph.value["density"][zone].as_f64().unwrap_or(100.0).max(1.0);
        let side = (population.max(1) as f64 * 10_000.0 / density).sqrt();
        (side, side)
    } else if morph.text("streetOp") == "grid" {
        let lanes = morph.pair("laneSpacing");
        let sp = if lanes[0] > 0.0 && lanes[1] > 0.0 {
            lanes
        } else {
            morph.pair("gridSpacing")
        };
        (3.0 * sp[0].max(20.0), 3.0 * sp[1].max(20.0))
    } else {
        let [lo, hi] = morph.block_size(zone);
        let (lo, hi) = (lo.max(300.0), hi.max(lo.max(300.0)));
        let mean = if hi > lo * 1.001 {
            (hi - lo) / (hi / lo).ln()
        } else {
            lo
        };
        let side = (10.0 * mean).clamp(10_000.0, 250_000.0).sqrt();
        (side, side)
    };
    // Flat open ground; the quarter lies `offset` east of the centre.
    let width = 4.0 * (offset + w + h + 1000.0);
    let heights = [0.0_f32; 4];
    let water = [0_u8; 4];
    let surface = Surface {
        geometry: None,
        width,
        n: 2,
        height: &heights,
        water: &water,
        interpolation: Default::default(),
    };
    let center = Point {
        x: width * 0.5,
        y: width * 0.5,
    };
    let (x0, y0) = (center.x + offset, center.y - h * 0.5);
    let corners = [
        Point { x: x0, y: y0 },
        Point { x: x0 + w, y: y0 },
        Point {
            x: x0 + w,
            y: y0 + h,
        },
        Point { x: x0, y: y0 + h },
    ];
    let main = street(1);
    let base: Vec<Street> = (0..4)
        .map(|i| {
            let (a, b) = (corners[i], corners[(i + 1) % 4]);
            let path = (0..=8)
                .map(|k| Point {
                    x: a.x + (b.x - a.x) * k as f64 / 8.0,
                    y: a.y + (b.y - a.y) * k as f64 / 8.0,
                })
                .collect::<Vec<_>>();
            Street {
                widths: vec![main; path.len()],
                path,
                rank: 1,
                role: "street".into(),
            }
        })
        .collect();
    let mut base_bins = Bins::new(20.0, usize::MAX);
    base_bins.sync(&base);
    let mut major = Bins::new(50.0, 1);
    major.sync(&base);
    let bins = std::sync::Mutex::new(Bins::new(20.0, usize::MAX));
    let regional = RegionalIndex::new(&[], 100.0);
    let rng = Rng::new(seed).fork("capacity-probe-quarter");
    let field = Field {
        regional: &regional,
        align_regional: false,
        adaptation: 0.0,
        p: morph,
        center,
        angle: 0.0,
        terrain: 0.0,
        water: 0.0,
        surface,
        noise: Noise::new(rng.fork("field")),
        radius: (offset + w).max(200.0),
        population,
        radial: false,
        phases: &[],
        phase_morphs: &[],
        phase_index: &[],
        base: &base,
        base_bins: &base_bins,
        others: &[],
        bins: &bins,
        reads: None,
        major: &major,
        frame: (morph.text("streetOp") == "grid").then_some(0.0),
        blend: None,
    };
    let quarter = Quarter {
        shape: Shape {
            outer: corners.to_vec(),
            holes: vec![],
        },
        phase: 0,
        zone: zone.into(),
    };
    let local = LayoutConfig {
        zone: zone.into(),
        ..cfg.clone()
    };
    let mut own = vec![];
    let mut qr = rng.fork("split");
    let pieces = split_quarter(&quarter, &field, &local, &mut own, &mut qr);
    if cfg.access_mode != "none" {
        closes(&pieces, &mut own, &field, &local, &mut rng.fork("closes"));
    }
    let streets: Vec<Street> = base.iter().cloned().chain(own).collect();
    let ribbons: Vec<_> = streets
        .iter()
        .flat_map(|s| g::ribbon(&s.path, &s.widths))
        .collect();
    let mut blocks = vec![];
    for pc in pieces {
        let mut polys = vec![pc.shape.clone()];
        for r in &ribbons {
            polys = polys
                .into_iter()
                .flat_map(|p| g::difference(&p, r))
                .collect();
        }
        for shape in polys.into_iter().filter(|p| g::area(p) > 1.0) {
            let f = frame(&shape);
            blocks.push(Block {
                shape,
                quarter: 0,
                kind: pc.kind.clone(),
                axis: f.u,
                zone: zone.into(),
                phase: Some(0),
            });
        }
    }
    (blocks, streets, w * h)
}

/// Quarters cut with the borrowed tissue: the youngest growth first, then the
/// outermost, until their land reaches the plan's share. User-edited quarters
/// keep their own edit.
pub(super) fn borrowed_quarters(
    quarters: &[Quarter],
    center: Point,
    share: f64,
    cfg: &LayoutConfig,
) -> Vec<usize> {
    let total: f64 = quarters.iter().map(|q| g::area(&q.shape)).sum();
    let mut order: Vec<(usize, usize, f64, f64)> = quarters
        .iter()
        .enumerate()
        .filter(|(i, _)| !edits::keeps_own_tissue(cfg, *i))
        .map(|(i, q)| {
            let c = g::interior_point(&q.shape);
            (
                i,
                q.phase,
                (c.x - center.x).hypot(c.y - center.y),
                g::area(&q.shape),
            )
        })
        .collect();
    order.sort_by(|a, b| b.1.cmp(&a.1).then(b.2.total_cmp(&a.2)).then(a.0.cmp(&b.0)));
    let mut taken = 0.0;
    let mut out = vec![];
    for (i, _, _, a) in order {
        if taken >= share * total {
            break;
        }
        taken += a;
        out.push(i);
    }
    out.sort_unstable();
    out
}
