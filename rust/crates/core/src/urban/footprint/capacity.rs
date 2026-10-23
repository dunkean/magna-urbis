//! Adaptive housing capacity, sized before the footprint grows.
//!
//! Invariant: the parcels of a settlement can hold its households. The yield
//! of a tissue (households per hectare) is never read from its catalogue
//! density: the parcel cutting and the household rule of the city itself
//! (`parcels::generate`, `programme::allocate`) are run on blocks, so the
//! prediction and the result share one estimator.
//! - Before the footprint exists, on reference blocks of the tissue at the
//!   access pressure of each growth epoch (`probe`), to size the footprint.
//! - Once the blocks exist, on a deterministic sample of the real blocks
//!   (`measure`), to set the lot densification and the fringe vacancy.
//!
//! When the yield is short, bounded steps follow in a fixed order, each
//! reported in French: (1) densify within the culture's own ranges (narrower
//! lots and smaller blocks toward the preset minima, coverage and floors toward
//! the upper bounds, fewer fringe fields); (2) extend the footprint up to
//! `EXTENSION` times the nominal area; (3) borrow the street spacing and lot
//! cutting of a compact tissue on a share of the quarters (`graft`): only the
//! tissue, never the houses, floors or household figures of the receiving
//! culture. Beyond that the shortfall stays explicit; no capacity is invented.
use super::super::geometry as g;
use super::super::programme::{BlockEnvironment, Demand, UrbanProgramme};
use super::super::{
    Block, CapacityPlan, GrowthPhase, Layout, LayoutConfig, Morph, ParcelConfig, Point, Quarter,
    Site, UrbanMetrics, UrbanStructure, catalogue, composition, roles,
};
use std::collections::{BTreeMap, HashMap};
use std::sync::{Mutex, OnceLock};

/// Households the parcels must hold per household of the population: the
/// demand, the plots taken by trades and shops, and a 5 % margin.
pub(in crate::urban) const MARGIN: f64 = 1.12;
/// Bound of the footprint extension over the catalogue area.
pub(in crate::urban) const EXTENSION: f64 = 1.6;
/// Densification taken before any extension (« on la densifie un peu et on
/// étend »): the rest of the culture's ranges is used only at full extension.
const SOFT: f64 = 0.5;
/// Predicted gap (share of the requirement) below which no tissue is
/// borrowed: the lots and the fringe of the measured blocks close it.
const BORROW_GAP: f64 = 0.08;
/// Fewest blocks of a measured stratum (`measure`).
const STRATUM: usize = 4;
/// A donor must yield this much more than the densified own tissue: a small
/// gain never justifies replacing a culture's network on most of its land.
const DONOR_GAIN: f64 = 1.2;
/// Land of a footprint outside ordinary blocks beyond the tissue streets of the
/// probe and the reserved institutions: arterials, places, unserved strips.
const OTHER_LAND: f64 = 0.06;
/// Land of the ordinary blocks lost after the quarter stage: squares,
/// institutions reserving whole blocks, streetless strips.
pub(in crate::urban) const BLOCK_LOSS: f64 = 0.06;
/// Sampling error of the block measure (median ≈ 6 % on the capacity sweep):
/// the lots and fringe fields are set to hold this much more than required.
pub(in crate::urban) const MEASURE_MARGIN: f64 = 1.05;
/// Forecast over requirement beyond which the real blocks are not measured
/// (the sweep's largest over-prediction is +80 %).
pub(in crate::urban) const AMPLE: f64 = 2.0;
/// Compact tissues with regular, subdividable blocks that may lend their
/// cutting, by street pattern. A donor is chosen by its probed yield with the
/// receiving culture's houses, never by its catalogue density.
const DONORS: &[(&str, &str)] = &[
    ("indus-planned", "grid"),
    ("bastide", "grid"),
    ("rynek-town", "grid"),
    ("european-organic", "organic"),
    ("byzantine-greek", "organic"),
    ("caucasian-highland", "organic"),
];
/// Morph keys of the tissue (network and lot cutting) a donor lends. The
/// receiver keeps its plot family, house areas, coverage, storeys and densities.
const TISSUE_KEYS: &[&str] = &[
    "streets",
    "streetOp",
    "closeOp",
    "laneSpacing",
    "wardArea",
    "spineAmp",
    "kinks",
    "gridSpacing",
    "gridSkew",
    "blockSize",
    "minBlock",
    "minWidth",
    "deadEndRatio",
    "slitDepth",
    "frontage",
    "plotDepth",
    "plotTilt",
    "wideLotChance",
    "cornerFill",
    "curvature",
    "fieldNoise",
    "fieldWavelength",
    "fieldRandom",
    "fieldTwist",
    "placeThreshold",
];

/// Adaptation applies to the automatic population budget of the cultural
/// tissue; explicit presets, parameters, densities or radii are kept as given.
pub(in crate::urban) fn enabled(cfg: &LayoutConfig) -> bool {
    // Measurement switch (same tree, adaptation off): URBAN_CAPACITY=off.
    if std::env::var("URBAN_CAPACITY").is_ok_and(|v| v == "off") {
        return false;
    }
    cfg.footprint.budget == "population"
        && cfg.footprint.gross_density <= 0.0
        && cfg.preset == "culture"
        && cfg.recipe == "auto"
        && cfg.tissue == "culture"
        && cfg.composition == "settlement"
        && cfg.placement == "center"
        && cfg.params.as_object().is_none_or(|p| p.is_empty())
}
/// Same rule for the parcel stage inputs.
pub(in crate::urban) fn parcels_enabled(cfg: &ParcelConfig) -> bool {
    cfg.operator == "culture"
        && cfg.preset == "culture"
        && cfg.recipe == "auto"
        && cfg.params.as_object().is_none_or(|p| p.is_empty())
}
pub(in crate::urban) fn of(layout: &Layout) -> Option<&CapacityPlan> {
    layout
        .structure
        .as_ref()
        .and_then(|s| s.metrics.capacity.as_ref())
}

/// Densify a tissue within its own ranges: lots, houses and blocks toward the
/// preset minima, coverage toward its maximum, lattice spacing down by at most
/// a quarter. `t` = 0 leaves the morph unchanged.
pub(in crate::urban) fn densify(morph: &mut Morph, t: f64) {
    let t = t.clamp(0.0, 1.0);
    if t <= 0.0 {
        return;
    }
    for (key, toward_min) in [
        ("frontage", true),
        ("houseArea", true),
        ("blockSize", true),
        ("coverage", false),
    ] {
        if let Some(zones) = morph.value[key].as_object_mut() {
            for range in zones.values_mut() {
                if let Some([lo, hi]) = range
                    .as_array()
                    .and_then(|a| Some([a.first()?.as_f64()?, a.get(1)?.as_f64()?]))
                {
                    let (lo, hi) = (lo.min(hi), lo.max(hi));
                    *range = if toward_min {
                        serde_json::json!([lo, lo + (hi - lo) * (1.0 - t)])
                    } else {
                        serde_json::json!([lo + (hi - lo) * t, hi])
                    };
                }
            }
        }
    }
    for key in ["gridSpacing", "laneSpacing"] {
        if let Some(pair) = morph.value[key].as_array_mut() {
            for v in pair.iter_mut() {
                if let Some(x) = v.as_f64() {
                    *v = serde_json::json!(x * (1.0 - 0.25 * t));
                }
            }
        }
    }
    morph.value["_densify"] = serde_json::json!(t);
}
/// The receiver's morph with the donor's network and lot cutting.
fn graft(mut own: Morph, donor: &Morph) -> Morph {
    for key in TISSUE_KEYS {
        if !donor.value[*key].is_null() {
            own.value[*key] = donor.value[*key].clone();
        }
    }
    own.value["_tissueDonor"] = donor.value["id"].clone();
    own
}
/// Recipe name of a phase recipe, without the growth prefix.
fn recipe_name(recipe: &str) -> &str {
    recipe.trim_start_matches("grown-")
}
/// The one tissue resolution of every stage: the phase morph of the receiving
/// culture, the donor's tissue when its quarter borrows it, then densified.
#[allow(clippy::too_many_arguments)]
pub(in crate::urban) fn adapt(
    morph: Morph,
    plan: Option<&CapacityPlan>,
    quarter: Option<usize>,
    recipe: &str,
    zone: &str,
    population: u32,
    density: f64,
    stage: &str,
) -> Morph {
    let Some(plan) = plan else { return morph };
    let borrowed =
        !plan.donor.is_empty() && quarter.is_some_and(|q| plan.borrowed_quarters.contains(&q));
    let mut morph = if borrowed {
        let donor_recipe = composition::recipe(&plan.donor, population, recipe_name(recipe));
        match composition::phase_morph(
            &plan.donor,
            &donor_recipe,
            zone,
            "culture",
            "auto",
            density,
            &serde_json::json!({}),
            stage,
        ) {
            Ok(d) => graft(morph, &d),
            Err(_) => morph,
        }
    } else {
        morph
    };
    densify(&mut morph, plan.densify);
    morph
}

/// Households and garden land that the parcel stage gives each block of a
/// layout, under the allocation of the city (`programme::allocate`) with an
/// unbounded housing demand: every admissible plot holds its household cap.
fn run(
    mut layout: Layout,
    environment: Vec<BlockEnvironment>,
    seed: &str,
    cfg: &LayoutConfig,
    population: u32,
) -> Option<Vec<(f64, f64)>> {
    let mut wanted = Demand {
        id: format!("{}/demand/domestic", layout.key),
        function: "domestic".into(),
        unit: "domesticUnits".into(),
        requested: 1.0e8,
        target_area: 0.0,
        target_frontage: 4.0,
        provenance: vec![],
        requires: vec![],
        parcel_capacity: 0.0,
        built_capacity: 0.0,
        open_capacity: 0.0,
        deficit: 0.0,
        reasons: vec![],
        role: "dwelling".into(),
        sites: 0,
        site: String::new(),
        landmark: false,
        district: String::new(),
        placement: String::new(),
    };
    wanted.deficit = wanted.requested;
    layout.programme = Some(UrbanProgramme {
        version: 1,
        population: population.max(1),
        context: cfg.programme.clone(),
        cultures: super::super::culture::mapping_for(&layout.culture, &cfg.programme.period)
            .into_iter()
            .collect(),
        demands: vec![wanted],
        reservations: vec![],
        allocations: vec![],
        adjacency: vec![],
        environment,
        reconciliation_passes: 0,
        warnings: vec![],
        housing_capacity: 0.0,
    });
    let parcel_cfg = ParcelConfig {
        density: cfg.density,
        ..ParcelConfig::default()
    };
    let fallback = super::super::resolve(
        &layout.culture,
        "culture",
        "auto",
        "core",
        cfg.density,
        &serde_json::json!({}),
        "parcels",
    )
    .ok()?;
    let tick = std::time::Instant::now();
    let mut partition =
        super::super::parcels::generate(seed, &layout, &parcel_cfg, &fallback).ok()?;
    let cut = tick.elapsed().as_secs_f64() * 1000.0;
    super::super::programme::allocate(&layout, &mut partition);
    if std::env::var("URBAN_PROFILE").is_ok() {
        eprintln!(
            "    capacity.run: {} blocks, cut {cut:.0} ms, allocate {:.0} ms",
            layout.blocks.len(),
            tick.elapsed().as_secs_f64() * 1000.0 - cut
        );
    }
    let mut out = vec![(0.0, 0.0); layout.blocks.len()];
    let block_of: HashMap<&str, usize> = partition
        .parcels
        .iter()
        .map(|p| (p.id.as_str(), p.block))
        .collect();
    for p in partition.parcels.iter().filter(|p| p.use_kind == "garden") {
        if let Some(o) = out.get_mut(p.block) {
            o.1 += g::area(&p.shape);
        }
    }
    for a in partition
        .programme
        .iter()
        .flat_map(|p| &p.allocations)
        .filter(|a| a.function == "domestic")
    {
        if let Some(o) = block_of
            .get(a.parcel_id.as_str())
            .and_then(|&b| out.get_mut(b))
        {
            o.0 += a.households;
        }
    }
    Some(out)
}

/// Probed yield of one tissue: households per hectare of ordinary block land,
/// the share of that land left as gardens, and the share of its own streets.
#[derive(Clone, Copy, Debug, Default)]
pub(in crate::urban) struct Yield {
    pub households: f64,
    pub garden: f64,
    pub streets: f64,
    /// Mean area of the probe's blocks (m²).
    pub block: f64,
}
fn cache() -> &'static Mutex<HashMap<String, Yield>> {
    static CACHE: OnceLock<Mutex<HashMap<String, Yield>>> = OnceLock::new();
    CACHE.get_or_init(|| Mutex::new(HashMap::new()))
}
fn flat(block: usize, pressure: f64) -> BlockEnvironment {
    BlockEnvironment {
        pressure,
        block,
        slope: 0.0,
        wet: false,
        waterfront: false,
        height: 0.0,
        district: None,
        water: String::new(),
        water_height: 0.0,
    }
}
/// Households per hectare of block land of a tissue at an access pressure and
/// a distance to the centre, by the city's own street cutting
/// (`quarters::probe_quarter`), lot cutting and allocation.
#[allow(clippy::too_many_arguments)]
pub(in crate::urban) fn probe(
    culture: &str,
    donor: &str,
    epoch: &Epoch,
    t: f64,
    cfg: &LayoutConfig,
    population: u32,
) -> Yield {
    let pressure = (epoch.pressure * 20.0).round() / 20.0;
    let offset = (epoch.offset / 50.0).round() * 50.0;
    let key = format!(
        "{culture}\u{1}{donor}\u{1}{}\u{1}{}\u{1}{t:.3}\u{1}{pressure}\u{1}{offset}\u{1}{}\u{1}{}\u{1}{}\u{1}{}",
        epoch.recipe,
        epoch.zone,
        cfg.density,
        cfg.programme.period,
        population < 500,
        cfg.access_mode,
    );
    if let Some(y) = cache().lock().ok().and_then(|c| c.get(&key).copied()) {
        return y;
    }
    let y = probe_uncached(culture, donor, epoch, t, pressure, offset, cfg, population)
        .unwrap_or_default();
    if std::env::var("URBAN_CAPACITY_DEBUG").is_ok() {
        eprintln!(
            "probe {culture} donor={donor} {} {} t={t:.2} p={pressure} r={offset}: {y:?}",
            epoch.recipe, epoch.zone
        );
    }
    if let Ok(mut c) = cache().lock() {
        c.insert(key, y);
    }
    y
}
#[allow(clippy::too_many_arguments)]
fn probe_uncached(
    culture: &str,
    donor: &str,
    epoch: &Epoch,
    t: f64,
    pressure: f64,
    offset: f64,
    cfg: &LayoutConfig,
    population: u32,
) -> Option<Yield> {
    let (recipe, zone) = (epoch.recipe.as_str(), epoch.zone.as_str());
    let plan = CapacityPlan {
        densify: t,
        network_densify: t,
        donor: donor.into(),
        borrowed_quarters: if donor.is_empty() { vec![] } else { vec![0] },
        ..CapacityPlan::default()
    };
    let own = composition::phase_morph(
        culture,
        recipe,
        zone,
        "culture",
        "auto",
        cfg.density,
        &serde_json::json!({}),
        "quarters",
    )
    .ok()?;
    let morph = adapt(
        own,
        Some(&plan),
        Some(0),
        recipe,
        zone,
        population,
        cfg.density,
        "quarters",
    );
    let (blocks, streets, gross) = super::super::quarters::probe_quarter(
        &morph,
        cfg,
        zone,
        population,
        offset,
        "capacity-probe",
    );
    let blocks: Vec<Block> = blocks.into_iter().filter(|b| b.kind == "block").collect();
    if blocks.is_empty() {
        return None;
    }
    let area: f64 = blocks.iter().map(|b| g::area(&b.shape)).sum();
    let shapes = blocks.iter().map(|b| b.shape.clone()).collect::<Vec<_>>();
    let environment = (0..blocks.len()).map(|i| flat(i, pressure)).collect();
    let center =
        blocks
            .first()
            .map(|b| g::interior_point(&b.shape))
            .map_or(Point { x: 0.0, y: 0.0 }, |p| Point {
                x: p.x - offset,
                y: p.y,
            });
    let layout = Layout {
        config: Some(LayoutConfig {
            culture: culture.into(),
            ..cfg.clone()
        }),
        programme: None,
        key: "capacity-probe".into(),
        culture: culture.into(),
        center,
        quarters: vec![Quarter {
            shape: shapes[0].clone(),
            phase: 0,
            zone: zone.into(),
        }],
        streets,
        blocks,
        warnings: vec![],
        enclosures: vec![],
        phases: vec![GrowthPhase {
            culture: culture.into(),
            kind: "foundation".into(),
            zone: zone.into(),
            recipe: recipe.into(),
            population: population as f64,
            target_area: area,
            shapes,
        }],
        archetype: String::new(),
        structure: Some(UrbanStructure {
            version: 1,
            metrics: UrbanMetrics {
                capacity: Some(plan),
                ..UrbanMetrics::default()
            },
            ..UrbanStructure::default()
        }),
    };
    let out = std::panic::catch_unwind(std::panic::AssertUnwindSafe(|| {
        run(layout, environment, "capacity-probe", cfg, population)
    }))
    .ok()
    .flatten()?;
    let households: f64 = out.iter().map(|o| o.0).sum();
    let garden: f64 = out.iter().map(|o| o.1).sum();
    Some(Yield {
        households: households / (area / 10_000.0).max(1e-9),
        garden: garden / area.max(1e-9),
        streets: (1.0 - area / gross.max(1e-9)).clamp(0.0, 0.6),
        block: area / out.len().max(1) as f64,
    })
}

/// Yield of one zone at densification `t`, interpolated between the probes
/// at 0, ½ and 1 (each probe is cached).
#[allow(clippy::too_many_arguments)]
fn yield_at(
    culture: &str,
    donor: &str,
    epoch: &Epoch,
    t: f64,
    cfg: &LayoutConfig,
    population: u32,
) -> Yield {
    let t = t.clamp(0.0, 1.0);
    let at = |k: f64| probe(culture, donor, epoch, k, cfg, population);
    let (a, b, s) = if t <= 0.0 {
        return at(0.0);
    } else if t <= 0.5 {
        (at(0.0), at(0.5), t / 0.5)
    } else {
        (at(0.5), at(1.0), (t - 0.5) / 0.5)
    };
    let lerp = |x: f64, y: f64| x + (y - x) * s;
    Yield {
        households: lerp(a.households, b.households),
        garden: lerp(a.garden, b.garden),
        streets: lerp(a.streets, b.streets),
        block: lerp(a.block, b.block),
    }
}

/// One growth epoch of the plan: zone, recipe, land fraction and the access
/// pressure of its blocks (`pressure::for_layout` decays with the network
/// distance to the centre over the town's radius, capped at 600 m).
pub(in crate::urban) struct Epoch {
    pub zone: String,
    pub recipe: String,
    pub share: f64,
    pub pressure: f64,
    /// Mean distance of the epoch's land to the centre (m).
    pub offset: f64,
    /// Share of the site steeper than the culture's houses admit.
    pub steep: f64,
    /// Expected share of the epoch's blocks left as fringe fields at the
    /// culture's own vacancy (`fringe_fields`).
    pub fields: f64,
}
/// Expected share of the land of a ring (cumulative land fractions `inner` to
/// `outer` of a round footprint) left as fringe fields by the quarter stage:
/// a block's vacancy chance is `0.8 × smooth(r / R, 0.7, 1.05) ×
/// smooth(arterial distance, 18, 90)`; the arterial factor averages
/// `ARTERIAL` over a block lattice.
pub(in crate::urban) fn fringe_fields(inner: f64, outer: f64) -> f64 {
    const ARTERIAL: f64 = 0.75;
    let smooth = |x: f64| {
        let t = ((x - 0.7) / 0.35).clamp(0.0, 1.0);
        t * t * (3.0 - 2.0 * t)
    };
    let (a, b) = (inner.clamp(0.0, 1.0), outer.clamp(0.0, 1.0));
    if b <= a {
        return 0.0;
    }
    // Uniform in area: r / R = sqrt(fraction).
    let steps = 16;
    let mean = (0..steps)
        .map(|k| smooth((a + (b - a) * (k as f64 + 0.5) / steps as f64).sqrt()))
        .sum::<f64>()
        / steps as f64;
    0.8 * ARTERIAL * mean
}
/// Access pressure and mean distance to the centre of epochs of cumulative
/// land fractions `bounds` in a footprint of `area` m²: the mean radius of
/// each ring, with a network detour for the pressure.
pub(in crate::urban) fn epoch_access(bounds: &[f64], area: f64) -> Vec<(f64, f64)> {
    let radius = (area / std::f64::consts::PI).sqrt();
    let scale = radius.clamp(60.0, 600.0);
    let mut inner = 0.0_f64;
    bounds
        .iter()
        .map(|&outer| {
            let r = radius * 0.5 * (inner.sqrt() + outer.max(0.0).sqrt());
            inner = outer.max(0.0);
            (0.12 + 0.88 * (-1.3 * r / scale).exp(), r)
        })
        .collect()
}
/// Correction of the probed yields set by the closed loop (1 = none).
pub(in crate::urban) fn calibration(cfg: &LayoutConfig) -> f64 {
    if cfg.capacity_yield > 0.0 {
        cfg.capacity_yield
    } else {
        1.0
    }
}
/// Households per hectare of allocated land, all epochs together.
fn gross(
    culture: &str,
    donor: &str,
    epochs: &[Epoch],
    t: f64,
    cfg: &LayoutConfig,
    population: u32,
) -> (f64, f64) {
    let mut households = 0.0;
    let mut garden = 0.0;
    let calibration = calibration(cfg);
    for e in epochs {
        let y = yield_at(culture, donor, e, t, cfg, population);
        let net = (1.0 - y.streets - OTHER_LAND).clamp(0.2, 1.0)
            * (1.0 - e.steep.clamp(0.0, 0.8))
            * (1.0 - e.fields.clamp(0.0, 0.8));
        households += e.share * y.households * net * calibration;
        garden += e.share * y.garden;
    }
    (households, garden)
}
/// Land the programme reserves as whole blocks for a settlement
/// (`programme::prepare`): each site of a block-reserving service takes one
/// block close to `min(module, max(area, minimum))`, the module being the mean
/// block of the tissue; the open common fills blocks up to its area.
fn reserved_land(
    culture: &str,
    population: u32,
    cfg: &LayoutConfig,
    epoch: &Epoch,
    block: f64,
) -> f64 {
    let role = cfg.programme.role.as_str();
    let communal =
        super::super::culture::mapping(culture).is_some_and(|m| m.functional_profile == "communal");
    let commons = (f64::from(population)
        * if communal || role == "agricultural" || population < 500 {
            2.0
        } else {
            0.5
        })
    .max(30.0);
    let module = composition::phase_morph(
        culture,
        &epoch.recipe,
        &epoch.zone,
        "culture",
        "auto",
        cfg.density,
        &serde_json::json!({}),
        "quarters",
    )
    .map(|m| {
        let r = m.range("blockSize", &epoch.zone);
        (r[0] + r[1]) * 0.5
    })
    .unwrap_or(block);
    let minimum = super::super::culture::mapping_for(culture, &cfg.programme.period)
        .map_or(0.0, |m| m.admissibility.min_area);
    let module = module.max(minimum);
    roles::services(culture, population, role)
        .iter()
        .filter(|n| roles::reserves_block(&n.entry))
        .map(|n| n.sites as f64 * module.min(n.area.max(minimum)))
        .sum::<f64>()
        + commons.max(block.min(module))
}
/// Households of a settlement (domestic and mixed), as the programme counts them.
pub(in crate::urban) fn households(culture: &str, population: u32) -> f64 {
    f64::from(population) / roles::occupancy(culture).household_size.max(0.1)
}
/// Probe the epochs of every (donor, t) pair at once, in parallel; the probes
/// are deterministic and cached, so later reads are lookups.
fn prefetch(
    culture: &str,
    donors: &[&str],
    epochs: &[Epoch],
    ts: &[f64],
    cfg: &LayoutConfig,
    population: u32,
) {
    let jobs: Vec<(&str, usize, f64)> = donors
        .iter()
        .flat_map(|&d| (0..epochs.len()).flat_map(move |e| ts.iter().map(move |&t| (d, e, t))))
        .collect();
    super::super::par::map(&jobs, |_, &(donor, e, t)| {
        probe(culture, donor, &epochs[e], t, cfg, population);
    });
}
/// Smallest t in [lo, hi] with `y(t) >= need`, by bisection on a monotone yield.
fn solve(lo: f64, hi: f64, need: f64, y: impl Fn(f64) -> f64) -> Option<f64> {
    if y(lo) >= need {
        return Some(lo);
    }
    if y(hi) < need {
        return None;
    }
    let (mut lo, mut hi) = (lo, hi);
    for _ in 0..12 {
        let mid = 0.5 * (lo + hi);
        if y(mid) >= need {
            hi = mid;
        } else {
            lo = mid;
        }
    }
    Some((hi * 100.0).ceil() / 100.0)
}
fn pattern(culture: &str, epoch: &Epoch, cfg: &LayoutConfig) -> String {
    composition::phase_morph(
        culture,
        &epoch.recipe,
        &epoch.zone,
        "culture",
        "auto",
        cfg.density,
        &serde_json::json!({}),
        "quarters",
    )
    .map(|m| m.text("streetOp").to_owned())
    .unwrap_or_default()
}
fn culture_of<'a>(site: &'a Site, cfg: &'a LayoutConfig) -> &'a str {
    if cfg.culture == "site" {
        &site.culture
    } else {
        &cfg.culture
    }
}
/// Plan the capacity of a footprint of `nominal` m² (the catalogue budget).
/// `fixed` keeps the area as given (terrain-bounded growth): no extension.
pub(in crate::urban) fn plan(
    site: &Site,
    cfg: &LayoutConfig,
    epochs: &[Epoch],
    nominal: f64,
    fixed: Option<f64>,
) -> Option<CapacityPlan> {
    let mut plan = plan_steps(site, cfg, epochs, nominal, fixed)?;
    // Households the footprint stage predicts its parcels hold: the probed
    // yields over the housing land of the (extended) target.
    let area = fixed.unwrap_or(nominal) * plan.extension;
    let ha = (area - plan.reserved_area).max(0.3 * area) / 10_000.0;
    let share = if plan.donor.is_empty() {
        0.0
    } else {
        plan.borrowed_share
    };
    plan.forecast = ha * (plan.planned_yield * (1.0 - share) + plan.donor_yield * share);
    // Only a plan whose blocks will be measured needs its dense forecast.
    if plan.forecast < AMPLE * plan.required {
        let culture = culture_of(site, cfg);
        let dense = if plan.densify >= 1.0 {
            plan.planned_yield
        } else {
            gross(culture, "", epochs, 1.0, cfg, site.population).0
        };
        plan.forecast_dense = ha * (dense * (1.0 - share) + plan.donor_yield * share);
    } else {
        plan.forecast_dense = plan.forecast;
    }
    if std::env::var("URBAN_CAPACITY_DEBUG").is_ok() {
        // Components of the forecast, for calibration against the real yield.
        let culture = culture_of(site, cfg);
        let parts: Vec<serde_json::Value> = epochs
            .iter()
            .map(|e| {
                let y = yield_at(culture, "", e, plan.densify, cfg, site.population);
                serde_json::json!({"zone": e.zone, "share": e.share, "pressure": e.pressure,
                    "steep": e.steep, "fields": e.fields, "households": y.households, "streets": y.streets, "block": y.block})
            })
            .collect();
        eprintln!(
            "{}",
            serde_json::json!({"plan": culture, "population": site.population, "area": area,
                "reserved": plan.reserved_area, "densify": plan.densify, "forecast": plan.forecast,
                "fixed": fixed.is_some(), "epochs": parts})
        );
    }
    Some(plan)
}
fn plan_steps(
    site: &Site,
    cfg: &LayoutConfig,
    epochs: &[Epoch],
    nominal: f64,
    fixed: Option<f64>,
) -> Option<CapacityPlan> {
    if !enabled(cfg) || epochs.is_empty() || nominal <= 0.0 {
        return None;
    }
    let culture = culture_of(site, cfg);
    catalogue()["cultures"][culture].as_object()?;
    let population = site.population;
    let households = households(culture, population);
    let required = households * MARGIN;
    prefetch(culture, &[""], epochs, &[0.0], cfg, population);
    let (nominal_yield, garden) = gross(culture, "", epochs, 0.0, cfg, population);
    let mut plan = CapacityPlan {
        households,
        required,
        nominal_area: nominal,
        nominal_yield,
        planned_yield: nominal_yield,
        garden_share: garden,
        densified_garden: garden,
        extension: 1.0,
        vacancy: 1.0,
        calibration: calibration(cfg),
        ..CapacityPlan::default()
    };
    // Institutions keep whole blocks before the cadastre (`programme::prepare`):
    // their land holds no household.
    let block = yield_at(culture, "", &epochs[0], 0.0, cfg, population).block;
    let reserved = reserved_land(culture, population, cfg, &epochs[0], block);
    plan.reserved_area = reserved;
    let area = fixed.unwrap_or(nominal);
    let housing = |a: f64| (a - reserved).max(0.3 * a) / 10_000.0;
    let need = required / housing(area).max(1e-9);
    let own = |t: f64| gross(culture, "", epochs, t, cfg, population).0;
    let densified = |plan: &mut CapacityPlan, t: f64| {
        plan.densify = t;
        plan.network_densify = t;
        plan.planned_yield = own(t);
        plan.densified_garden = gross(culture, "", epochs, t, cfg, population).1;
    };
    // A densification already measured short (closed loop) is the floor.
    let floor = cfg.capacity_floor.clamp(0.0, 1.0);
    let soft = SOFT.max(floor);
    if floor <= 0.0 && own(0.0) >= need {
        return Some(plan);
    }
    prefetch(culture, &[""], epochs, &[floor, SOFT, 1.0], cfg, population);
    // (1) A little denser on the nominal land: up to `SOFT` of the ranges.
    if let Some(t) = solve(floor, soft, need, own) {
        densified(&mut plan, t);
        return Some(plan);
    }
    // (2) Then wider: the footprint grows up to `EXTENSION` times the nominal.
    densified(&mut plan, soft);
    let reach = if fixed.is_some() { 1.0 } else { EXTENSION };
    let wanted = |y: f64| ((required / y.max(1e-9) * 10_000.0 + reserved) / area).max(1.0);
    plan.extension = wanted(plan.planned_yield).min(reach);
    // `wanted` solves the equality exactly: compare with a rounding tolerance.
    if plan.planned_yield * housing(area * plan.extension) >= required * (1.0 - 1e-9) {
        return Some(plan);
    }
    // (3) Then denser again, up to the culture's bounds, on the widest land.
    plan.extension = reach;
    let need = required / housing(area * reach).max(1e-9);
    if let Some(t) = solve(soft, 1.0, need, own) {
        densified(&mut plan, t);
        return Some(plan);
    }
    densified(&mut plan, 1.0);
    let own = plan.planned_yield.max(1e-9);
    let ha = housing(area * plan.extension);
    // Borrow: the compatible donor of the best probed yield, on the share of
    // land that closes the gap (deficit / (area × yield difference)).
    // A gap within the estimator's own error is left to the lot densification
    // and the fringe of the measured blocks (quarter stage), not to a borrowed
    // tissue.
    if own * ha >= required * (1.0 - BORROW_GAP) {
        plan.shortfall = (required - own * ha).max(0.0);
        return Some(plan);
    }
    let own_pattern = pattern(culture, &epochs[0], cfg);
    let mut best: Option<(f64, &str)> = None;
    for compatible in [true, false] {
        let candidates: Vec<&str> = DONORS
            .iter()
            .filter(|&&(d, kind)| d != culture && (kind == own_pattern) == compatible)
            .map(|d| d.0)
            .collect();
        prefetch(culture, &candidates, epochs, &[1.0], cfg, population);
        for donor in candidates {
            let y = gross(culture, donor, epochs, 1.0, cfg, population).0;
            if y > own * DONOR_GAIN && best.is_none_or(|b| y > b.0) {
                best = Some((y, donor));
            }
        }
        if best.is_some() {
            break;
        }
    }
    if let Some((donor_yield, donor)) = best {
        let share = ((required - own * ha) / (ha * (donor_yield - own))).clamp(0.0, 1.0);
        plan.donor = donor.into();
        plan.donor_yield = donor_yield;
        plan.borrowed_share = share;
        plan.shortfall = (required - ha * (own * (1.0 - share) + donor_yield * share)).max(0.0);
    } else {
        plan.shortfall = (required - own * ha).max(0.0);
    }
    Some(plan)
}

/// Measured capacity of the real blocks of a layout.
pub(in crate::urban) struct Measure {
    /// Households of every ordinary block, extrapolated from its stratum.
    pub per_block: Vec<f64>,
    /// Share of the sampled block land left as gardens.
    pub garden: f64,
}
/// Run the parcel stage on a deterministic sample of the ordinary blocks (by
/// phase, borrowed tissue, zone and size class, at least an eighth of each
/// stratum's land) and extrapolate each stratum's households per m² to its
/// other blocks.
pub(in crate::urban) fn measure(
    layout: &Layout,
    seed: &str,
    cfg: &LayoutConfig,
    population: u32,
    surface: super::super::Surface<'_>,
) -> Option<Measure> {
    let plan = of(layout)?.clone();
    // The programme reserves its blocks (markets, temples, commons) and reads
    // the blocks' pressure, slope and wetness exactly as it will later.
    let mut prepared = layout.clone();
    super::super::programme::prepare(&mut prepared, population, &cfg.programme, surface).ok()?;
    let environment = prepared
        .programme
        .as_ref()
        .map(|p| p.environment.clone())
        .unwrap_or_default();
    let env_by_block: HashMap<usize, &BlockEnvironment> =
        environment.iter().map(|e| (e.block, e)).collect();
    let env_of = |i: usize| env_by_block.get(&i).map(|e| (*e).clone());
    let areas: Vec<f64> = prepared.blocks.iter().map(|b| g::area(&b.shape)).collect();
    // Land the programme reserves (markets, temples, commons) holds no
    // household: strata rates are per m² of the remaining land, sampled on
    // blocks without reservation.
    let mut reserved = vec![0.0; areas.len()];
    for r in prepared.programme.iter().flat_map(|p| &p.reservations) {
        if let Some(v) = reserved.get_mut(r.block) {
            *v += g::area(&r.shape);
        }
    }
    // A block steeper than the culture's houses admit holds none
    // (`programme` admission): it is neither sampled nor extrapolated.
    let max_slope = super::super::culture::mapping_for(&layout.culture, &cfg.programme.period)
        .map_or(f64::INFINITY, |m| m.admissibility.max_slope);
    let land: Vec<f64> = areas
        .iter()
        .zip(&reserved)
        .enumerate()
        .map(|(i, (a, r))| {
            if env_of(i).is_some_and(|e| e.slope > max_slope) {
                0.0
            } else {
                (a - r).max(0.0)
            }
        })
        .collect();
    let mut groups: BTreeMap<(usize, bool, String), Vec<usize>> = BTreeMap::new();
    for (i, b) in prepared.blocks.iter().enumerate() {
        if b.kind != "block" || land[i] <= 1.0 {
            continue;
        }
        let phase = b
            .phase
            .or_else(|| prepared.quarters.get(b.quarter).map(|q| q.phase))
            .unwrap_or(0);
        let borrowed = plan.borrowed_quarters.contains(&b.quarter);
        groups
            .entry((phase, borrowed, b.zone.clone()))
            .or_default()
            .push(i);
    }
    // Size classes (powers of two) of at least `STRATUM` blocks: a lone large
    // block joins its neighbour class instead of being cut on its own.
    let mut strata: Vec<Vec<usize>> = vec![];
    for blocks in groups.values_mut() {
        blocks.sort_by(|&a, &b| land[a].total_cmp(&land[b]).then(a.cmp(&b)));
        let first = strata.len();
        let mut class = i32::MIN;
        for &i in blocks.iter() {
            let size = land[i].log2().floor() as i32;
            if size != class && strata.last().is_none_or(|s| s.len() >= STRATUM)
                || strata.len() == first
            {
                strata.push(vec![]);
            }
            class = size;
            strata.last_mut().expect("a stratum").push(i);
        }
        if strata.len() > first + 1 && strata.last().is_some_and(|s| s.len() < STRATUM) {
            let tail = strata.pop().expect("a stratum");
            strata.last_mut().expect("a stratum").extend(tail);
        }
    }
    // Stable order inside a stratum: a hash of each block's position.
    let key = |i: usize| {
        let c = g::interior_point(&prepared.blocks[i].shape);
        let mut h = 0xcbf29ce484222325u64;
        for v in [(c.x * 2.0).round() as i64, (c.y * 2.0).round() as i64] {
            for byte in v.to_le_bytes() {
                h = (h ^ byte as u64).wrapping_mul(0x100000001b3);
            }
        }
        h
    };
    let mut sample = vec![];
    let mut members = vec![];
    for blocks in strata.iter_mut() {
        // Unreserved blocks first, each group in a stable hashed order.
        blocks.sort_by_key(|&i| (reserved[i] > 1.0, key(i), i));
        let total: f64 = blocks.iter().map(|&i| land[i]).sum();
        let mut taken = 0.0;
        let mut chosen = vec![];
        for &i in blocks.iter() {
            if taken >= total / 8.0 && !chosen.is_empty() {
                break;
            }
            taken += land[i];
            chosen.push(i);
        }
        members.push((blocks.clone(), chosen.clone()));
        sample.extend(chosen);
    }
    let mut per_block = vec![0.0; layout.blocks.len()];
    if sample.is_empty() {
        return Some(Measure {
            per_block,
            garden: 0.0,
        });
    }
    let index: HashMap<usize, usize> = sample.iter().enumerate().map(|(k, &i)| (i, k)).collect();
    let environment = sample
        .iter()
        .enumerate()
        .map(|(k, &i)| {
            let mut e = env_of(i).unwrap_or_else(|| flat(i, 0.5));
            e.block = k;
            e.district = None;
            e
        })
        .collect();
    let probe = Layout {
        programme: None,
        blocks: sample.iter().map(|&i| prepared.blocks[i].clone()).collect(),
        warnings: vec![],
        ..prepared
    };
    // A geometry failure while measuring leaves the plan as predicted; the
    // parcel stage itself reports it.
    let out = std::panic::catch_unwind(std::panic::AssertUnwindSafe(|| {
        run(probe, environment, seed, cfg, population)
    }))
    .ok()
    .flatten()?;
    if std::env::var("URBAN_CAPACITY_DEBUG").is_ok() {
        let mut zones: BTreeMap<String, (f64, f64, f64, usize)> = BTreeMap::new();
        for (k, &i) in sample.iter().enumerate() {
            let z = zones.entry(prepared.blocks[i].zone.clone()).or_default();
            z.0 += areas[i];
            z.1 += out[k].0;
            z.2 += env_of(i).map_or(0.0, |e| e.pressure) * areas[i];
            z.3 += 1;
        }
        let land: f64 = (0..prepared.blocks.len())
            .filter(|&i| prepared.blocks[i].kind == "block")
            .map(|i| areas[i])
            .sum();
        let all: f64 = areas.iter().sum();
        eprintln!(
            "measure: block land {land:.0} m² of {all:.0} m² blocks; {}",
            zones
                .iter()
                .map(|(z, v)| format!(
                    "{z}: {:.0} hh/ha p={:.2} n={} land={:.0}",
                    v.1 / (v.0 / 10_000.0).max(1e-9),
                    v.2 / v.0.max(1e-9),
                    v.3,
                    v.0
                ))
                .collect::<Vec<_>>()
                .join("; ")
        );
    }
    let (mut garden, mut sampled) = (0.0, 0.0);
    for (blocks, chosen) in members {
        // The sample was cut whole (reservations included): rate per m² of
        // its full blocks, applied to the free land of the others.
        let cut: f64 = chosen.iter().map(|&i| areas[i]).sum();
        let held: f64 = chosen.iter().map(|&i| out[index[&i]].0).sum();
        garden += chosen.iter().map(|&i| out[index[&i]].1).sum::<f64>();
        sampled += cut;
        let rate = held / cut.max(1e-9);
        for &i in &blocks {
            per_block[i] = match index.get(&i) {
                Some(&k) if reserved[i] <= 1.0 => out[k].0,
                _ => rate * land[i],
            };
        }
    }
    Some(Measure {
        per_block,
        garden: garden / sampled.max(1e-9),
    })
}

/// Culture label for messages (« Java » for « Java · ville de cours et enclos »).
pub(in crate::urban) fn label(culture: &str) -> String {
    catalogue()["cultures"][culture]["label"]
        .as_str()
        .map(|l| l.split(" · ").next().unwrap_or(l).to_owned())
        .unwrap_or_else(|| culture.to_owned())
}
/// French decimal: 1.4 → « 1,4 ».
pub(in crate::urban) fn decimal(x: f64, digits: usize) -> String {
    format!("{x:.digits$}").replace('.', ",")
}
/// The plan's thresholds, in French (empty when the tissue suffices as drawn).
pub(in crate::urban) fn describe(culture: &str, plan: &CapacityPlan) -> Vec<String> {
    let mut steps = vec![];
    if plan.densify > 0.0 {
        let (before, after) = (
            (plan.garden_share * 100.0).round(),
            (plan.densified_garden * 100.0).round(),
        );
        steps.push(format!(
            "tissu {} densifié à {} % de ses bornes{}",
            label(culture),
            (plan.densify * 100.0).round(),
            if after < before {
                format!(" (jardins {before} → {after} %)")
            } else {
                String::new()
            }
        ));
    }
    if plan.calibration > 0.0 && (plan.calibration - 1.0).abs() > 0.001 {
        steps.push(format!(
            "rendement du tissu recalé à {} % de la prévision après mesure des îlots",
            (plan.calibration * 100.0).round()
        ));
    }
    if plan.vacancy < 0.999 {
        steps.push(format!(
            "champs de lisière réduits à {} %",
            (plan.vacancy * 100.0).round()
        ));
    }
    if plan.extension > 1.001 {
        steps.push(format!("emprise ×{}", decimal(plan.extension, 2)));
    }
    if !plan.donor.is_empty() && plan.borrowed_share > 0.0 {
        steps.push(format!(
            "découpe empruntée à {} sur {} % des quartiers",
            label(&plan.donor),
            (plan.borrowed_share * 100.0).round()
        ));
    }
    steps
}
