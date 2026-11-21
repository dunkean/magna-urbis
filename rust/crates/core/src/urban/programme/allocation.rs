//! Orchestration of the ordered parcel allocation bands and retained cadastral inputs.

use crate::urban::{Layout, Parcel, Partition, Point, Shape, geometry::{area, centroid},
    roles::{Frame, SiteFacts}};
use std::collections::{BTreeSet, HashMap};

use super::{Allocation, UrbanProgramme, adjacency::graph, admission::{ReservedFor, admission_rows},
    camps, districts::ParcelDistricts, dist, housing::{self, prime_frontage}, lots, outcomes, services};

/// Whether applying the parcel configuration to the layout (`allocate`) leaves
/// it as it is: same morphology inputs, culture and zones. Values compare by
/// their exact bits or JSON text, so `-0.0` against `0.0` counts as a change.
fn applies_unchanged(layout: &Layout, cfg: &crate::urban::ParcelConfig) -> bool {
    let Some(config) = &layout.config else {
        return false;
    };
    let json = |v: &serde_json::Value| serde_json::to_vec(v).expect("serialisable parameters");
    config.preset == cfg.preset
        && config.recipe == cfg.recipe
        && config.zone == cfg.zone
        && config.density.to_bits() == cfg.density.to_bits()
        && json(&config.params) == json(&cfg.params)
        && (cfg.culture == "site"
            || (layout.culture == cfg.culture && layout.phases.iter().all(|phase| phase.culture == cfg.culture)))
        && (cfg.zone == "auto" || layout.blocks.iter().all(|block| block.zone == cfg.zone))
}

/// Parcel facts shared by the allocation bands, indexed in partition order.
pub(super) struct Sites<'a> {
    pub(super) layout: &'a Layout,
    pub(super) part: &'a Partition,
    pub(super) land_areas: Vec<f64>,
    pub(super) centres: Vec<Point>,
    pub(super) center_distances: Vec<f64>,
    pub(super) prime: Vec<bool>,
    pub(super) enclosed: Vec<bool>,
    pub(super) facts: Vec<SiteFacts>,
    pub(super) districts: ParcelDistricts<'a>,
    pub(super) frame: Frame,
    pub(super) neighbours: Vec<Vec<usize>>,
    pub(super) reserved_for: &'a ReservedFor,
}

type Reference<'a> = Option<(&'a UrbanProgramme, &'a BTreeSet<String>)>;

pub(super) struct RetainedLots<'a> {
    pub(super) reference: Reference<'a>,
    previous: HashMap<&'a str, &'a Allocation>,
}

impl<'a> RetainedLots<'a> {
    fn new(reference: Reference<'a>) -> Self {
        let previous = reference.into_iter().flat_map(|(pr, _)| &pr.allocations)
            .map(|a| (a.parcel_id.as_str(), a)).collect();
        Self { reference, previous }
    }

    pub(super) fn retains(&self, p: &Parcel) -> bool {
        self.reference.is_some_and(|(_, keep)| keep.contains(&p.id))
    }

    pub(super) fn allocation(&self, p: &Parcel) -> Option<&'a Allocation> {
        self.retains(p).then(|| self.previous.get(p.id.as_str()).copied()).flatten()
    }
}

pub(super) fn take(
    pr: &mut UrbanProgramme,
    assignments: &mut [Option<usize>],
    pi: usize,
    di: usize,
    cap: f64,
) {
    assignments[pi] = Some(di);
    pr.demands[di].parcel_capacity += cap;
}

/// Reassign only uses. Streets, reservations and parcel shapes are immutable.
/// Priority bands: reserved institutions, then sited trades, then shops scaled to
/// the land actually left, then housing, then explicit gardens on the remainder.
pub fn allocate(layout: &Layout, partition: &mut Partition) {
    allocate_from_reference(layout, partition, None);
}

/// Keep the ownership of unchanged lots when a structural edit reallocates
/// their neighbours. Kept allocations are charged against the same demands.
pub(in crate::urban) fn allocate_from_reference(
    layout: &Layout,
    partition: &mut Partition,
    reference: Option<(&UrbanProgramme, &BTreeSet<String>)>,
) {
    if let std::borrow::Cow::Owned(formal) = crate::urban::shanty::formal_layout(layout) {
        partition.parcels.retain(|p| !p.provenance.iter().any(|s| s == "informal-growth"));
        allocate_from_reference(&formal, partition, reference);
        crate::urban::shanty::allocate(layout, partition);
        return;
    }
    // Source sites have their own fixed geometry and never compete for homes.
    partition.parcels.retain(|p| p.reason != "spring-water");
    #[cfg(not(target_arch = "wasm32"))]
    let tick = std::time::Instant::now();
    #[cfg(target_arch = "wasm32")]
    let lap = |_: &str| {};
    #[cfg(not(target_arch = "wasm32"))]
    let lap = |label: &str| {
        if std::env::var("URBAN_PROFILE").is_ok() {
            eprintln!(
                "  allocate.{label}: {:.0} ms",
                tick.elapsed().as_secs_f64() * 1000.0
            );
        }
    };
    // The parcel stage can deliberately override cultural/default morphology.
    // Resolve allocation against those applied inputs without editing its parent.
    // The layout is cloned only when the parcel configuration changes one of
    // these fields; otherwise the applied layout is the layout itself.
    let mut applied = std::borrow::Cow::Borrowed(layout);
    if let Some(cfg) = partition.config.as_ref().filter(|cfg| !applies_unchanged(layout, cfg)) {
        let local = applied.to_mut();
        let config = local
            .config
            .get_or_insert_with(crate::urban::LayoutConfig::default);
        config.preset = cfg.preset.clone();
        config.recipe = cfg.recipe.clone();
        config.zone = cfg.zone.clone();
        config.density = cfg.density;
        config.params = cfg.params.clone();
        if cfg.culture != "site" {
            local.culture = cfg.culture.clone();
            for phase in &mut local.phases {
                phase.culture = cfg.culture.clone();
            }
        }
        if cfg.zone != "auto" {
            for block in &mut local.blocks {
                block.zone = cfg.zone.clone();
            }
        }
    }
    let layout = applied.as_ref();
    let Some(mut pr) = layout.programme.clone() else {
        return;
    };
    // Explicit reallocation rechecks the current native admission source, including
    // imported programmes whose old envelope/recipe may no longer match it.
    pr.cultures = pr
        .cultures
        .iter()
        .filter_map(|c| {
            crate::urban::culture::isolated_mapping(&c.culture, &pr.context.period, &pr.context.intent)
        })
        .collect();
    if let Some(cfg) = &partition.config
        && cfg.culture != "site"
    {
        pr.cultures = crate::urban::culture::mapping_for(&cfg.culture, &pr.context.period)
            .into_iter()
            .collect();
        // The cultures the style sheet brings stay applied: their singular
        // buildings are allocated in their own culture.
        for (culture, _) in crate::urban::forms::sheet::monuments(layout).unwrap_or_default() {
            if !pr.cultures.iter().any(|c| c.culture == culture) {
                pr.cultures.extend(crate::urban::culture::isolated_mapping(
                    culture,
                    &pr.context.period,
                    &pr.context.intent,
                ));
            }
        }
    }
    pr.allocations.clear();
    pr.reconciliation_passes = 0;
    // Gardens are the remainder of each allocation, never an input.
    pr.demands.retain(|d| d.role != "open.garden");
    for p in &mut partition.parcels {
        if p.reason == "public-garden" && p.envelope.is_some()
            && !partition.config.as_ref().is_some_and(|c|c.overrides.parcels.contains_key(&p.id)) {
            p.use_kind = if p.family == "compound" { "compound" } else { "plot" }.into();
            p.reason = "programme-retry".into();
        }
    }
    for d in &mut pr.demands {
        d.parcel_capacity = 0.0;
        d.built_capacity = 0.0;
        d.open_capacity = 0.0;
        d.deficit = d.requested;
        d.reasons
            .retain(|r| !r.starts_with("Insufficient admissible") && !r.starts_with("Placed ") && !r.starts_with("source_absente: camp need retained;"));
        camps::explain(layout, pr.population, d, &pr.context);
    }
    let part: &Partition = partition;
    let parcels = &part.parcels;
    let retained = RetainedLots::new(reference);
    let (edges, neighbours) = graph(part);
    pr.adjacency = edges;
    lap("graph");
    let mut assignments: Vec<Option<usize>> = vec![None; parcels.len()];
    let reserved_for = ReservedFor::new(&pr);
    // Reserved blocks of each demand, and the parcels of every reserved block
    // (ascending): sited and reserved demands visit only their own land.
    let mut blocks_of: HashMap<&str, Vec<usize>> = HashMap::new();
    for (block, id) in reserved_for.by_block.iter().enumerate() {
        if let Some(id) = id {
            blocks_of.entry(id.as_str()).or_default().push(block);
        }
    }
    let mut block_parcels: Vec<Vec<usize>> = vec![vec![]; reserved_for.by_block.len()];
    for (pi, p) in parcels.iter().enumerate() {
        if reserved_for.contains_key(&p.block) {
            block_parcels[p.block].push(pi);
        }
    }
    let reserved_parcels = |id: &str| -> Vec<usize> {
        let mut out: Vec<usize> = blocks_of
            .get(id)
            .into_iter()
            .flatten()
            .flat_map(|&block| block_parcels[block].iter().copied())
            .collect();
        out.sort_unstable();
        out
    };
    // Pure per parcel: in parallel, in parcel order.
    let land_areas = crate::urban::par::map(parcels, |_, p| area(&p.shape));
    let centres = crate::urban::par::map(parcels, |_, p| centroid(&p.shape));
    let center_distances = centres
        .iter()
        .map(|&c| dist(c, layout.center))
        .collect::<Vec<_>>();
    let prime = crate::urban::par::map(parcels, |_, p| prime_frontage(p));
    // Whether a parcel centre lies inside an enclosure (any circuit, a later
    // epoch's wall included), read once for every parcel through an index.
    let enclosure_shapes: Vec<crate::urban::geometry::ContainmentIndex> = layout
        .enclosures
        .iter()
        .map(|e| crate::urban::geometry::ContainmentIndex::new(&Shape { outer: e.path.clone(), holes: vec![] }))
        .collect();
    let enclosed: Vec<bool> = if enclosure_shapes.is_empty() {
        vec![false; parcels.len()]
    } else {
        crate::urban::par::map(&centres, |_, &c| enclosure_shapes.iter().any(|s| s.contains(c)))
    };
    let frame = Frame::new(layout, &pr.environment);
    let facts: Vec<SiteFacts> = {
        let environment = &pr.environment;
        crate::urban::par::map(parcels, |pi, p| frame.facts(centres[pi], environment.get(p.block)))
    };
    let districts = ParcelDistricts::new(layout, &pr.environment);
    lap("facts");
    let sites = Sites {
        layout, part, land_areas, centres, center_distances, prime, enclosed,
        facts, districts, frame, neighbours, reserved_for: &reserved_for,
    };
    let (mut admission, mut memo) =
        admission_rows(layout, parcels, &pr, &reserved_for, &reserved_parcels);
    lap("admission");

    let mut early = services::assign(
        &sites, &retained, &mut pr, &mut admission, &mut assignments, &mut memo, &reserved_parcels,
    );
    lap("bands");
    let mut housing = housing::assign(
        &sites, &retained, &mut pr, &admission, &mut assignments, &mut memo, &mut early, &lap,
    );
    lap("dwellings");

    services::reconcile(&sites, &mut pr, &admission, &mut assignments, &early, &housing.households);
    housing::scatter_households(
        &sites, &retained, &mut pr, &admission, &mut assignments, &early, &mut housing.households,
    );
    outcomes::record(&sites, &retained, &mut pr, &mut assignments, &mut memo, &early, &housing, &lap);
    outcomes::finish(layout, partition, pr, reference);
    lap("done");
}

pub(in crate::urban) fn consolidate(partition: &mut Partition) {
    lots::consolidate(None,partition);
}
pub(in crate::urban) fn consolidate_cadastre(partition: &mut Partition, kept: &BTreeSet<String>) {
    lots::consolidate_cadastre(None, partition, kept);
}
pub(in crate::urban) fn finish_cadastre(layout: &Layout, partition: &mut Partition, kept: &BTreeSet<String>) {
    lots::consolidate_cadastre(Some(layout), partition, kept);
    crate::urban::springs::allocate(layout, partition);
}

/// Allocation-only call for retained cadastral inputs, with no geometry mutation.
pub fn reallocate(layouts: &[Layout], partitions: &[Partition]) -> Result<Vec<Partition>, String> {
    let mut out = partitions.to_vec();
    for p in &mut out {
        let layout = layouts
            .iter()
            .find(|l| l.key == p.key)
            .ok_or("Partition has no retained layout")?;
        if p.prepared.is_some() {
            let prepared = crate::urban::partition_layout(layout, p);
            allocate(&prepared, p);
        } else {
            allocate(layout, p);
        }
    }
    Ok(out)
}
