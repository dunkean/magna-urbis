//! A camp's open land is no evidence for a native urban facility.
use super::*;
use super::super::Morph;

pub(super) fn camp(layout: &Layout, population: u32) -> bool {
    if let Some(cfg) = &layout.config { !roles::is_isolated(&cfg.programme.intent)
        && super::super::kinds::native_camp(&layout.culture, population, cfg) }
    else { super::super::kinds::native_camp(&layout.culture, population, &Default::default()) }
}

/// One declared communal house capacity drives both the cell count and allocation.
/// PNW: campHouse = 9.144 × 15.24 m (30 × 50 ft), typical Chinook plankhouse:
/// https://chinookstory.org/plankhouse/ . Four households/house is a modelling
/// assumption within its account of three to five family fires, not a census.
pub(in crate::urban) fn households_per_house(morph: &Morph) -> Option<f64> {
    let n = morph.number_or("campHouseholds", 0.0);
    (n.is_finite() && n >= 1.0).then_some(n)
}

/// A camp has occupied lots and common ground, never a vacant urban cadastre.
/// Reconcile before yard consolidation so surplus cells cannot enlarge houses.
pub(in crate::urban) fn release_unbuilt(layout: &Layout, part: &mut Partition, final_pass: bool) {
    let Some(pr) = part.programme.as_mut() else { return };
    if !camp(layout, pr.population) { return; }
    let occupied: BTreeSet<_> = pr.allocations.iter().filter(|a| a.role != "open.garden")
        .map(|a| a.parcel_id.clone()).collect();
    let activities: HashMap<_, _> = pr.allocations.iter().filter(|a| a.role != "open.garden"
        && matches!(a.function.as_str(), "market" | "common"))
        .map(|a| (a.parcel_id.as_str(), a.function.as_str())).collect();
    for p in &mut part.parcels {
        if final_pass && matches!(p.use_kind.as_str(), "plot" | "compound") && let Some(&function) = activities.get(p.id.as_str()) {
            p.use_kind = if function == "market" { "place" } else { "common" }.into();
            p.envelope = None;
        }
    }
    let mut open: BTreeMap<usize, Vec<Parcel>> = BTreeMap::new();
    let mut removed = BTreeSet::new();
    part.parcels.retain(|p| {
        let locked = part.config.as_ref().is_some_and(|c| c.overrides.parcels.contains_key(&p.id));
        if !locked && !occupied.contains(&p.id) && (p.reason == "camp-open"
            || matches!(p.use_kind.as_str(), "plot" | "compound" | "garden" | "residual")
                && p.family != "reserve" && p.reason != "camp-centre") {
            removed.insert(p.id.clone()); open.entry(p.block).or_default().push(p.clone()); false
        } else { true }
    });
    pr.allocations.retain(|a| !removed.contains(&a.parcel_id));
    for cells in open.values() {
        let shapes: Vec<_> = cells.iter().map(|p| p.shape.clone()).collect();
        let merged = super::super::geometry::union(&shapes);
        for (i, shape) in (if merged.is_empty() { shapes } else { merged }).into_iter().enumerate() {
            let mut p = cells[0].clone();
            p.id = format!("{}/open/{i}", cells[0].id);
            p.shape = shape; p.use_kind = "garden".into(); p.reason = "camp-open".into();
            p.family = "reserve".into(); p.envelope = None; p.front = None;
            p.contacts.clear(); p.parent_ids.clear(); p.rank = 99;
            p.access = Some(super::super::ParcelAccess { kind:"reserved".into(),street:None,front_length:0. });
            p.provenance = vec!["camp-open".into()];
            part.parcels.push(p);
        }
    }
    let adjacency = graph(part).0;
    part.programme.as_mut().unwrap().adjacency = adjacency;
}

pub(in crate::urban) fn needs_cell(layout: &Layout, d: &Demand) -> bool {
    let Some(pr) = &layout.programme else { return true; };
    (0..layout.blocks.len()).any(|bi| supported(layout, pr.population, bi, d, &pr.context))
}

pub(super) fn supported(layout: &Layout, population: u32, block: usize, d: &Demand, context: &ProgrammeContext) -> bool {
    if roles::is_isolated(&context.intent) || !matches!(d.function.as_str(), "collective" | "warehouse" | "workshop") || !camp(layout, population) { return true; }
    let culture = block_culture(layout, block);
    let pack = profile_pack(layout, block, &d.function, &context.period);
    let mode = match context.mode.as_str() { "strict" => "historical_strict", "fantasy" => "fantasy_mix", _ => "historical_inspired" };
    // Both paths read Houses' declared functional registry. A residential
    // default cannot certify a council hall or warehouse inside a hut cell.
    super::super::culture::functional_mapping(culture, &d.role, &d.function, &context.period, mode).is_some()
        || ["hall", "compound", "single", "courtyard", "detached"].iter().any(|composition|
            super::super::culture::functional_choice_sources(culture, &pack, &d.role, &d.function, composition, mode).is_some())
}

pub(super) fn explain(layout: &Layout, population: u32, d: &mut Demand, context: &ProgrammeContext) {
    if !roles::is_isolated(&context.intent) && matches!(d.function.as_str(), "collective" | "warehouse" | "workshop") && camp(layout, population)
        && !(0..layout.blocks.len()).any(|bi| supported(layout, population, bi, d, context)) {
        d.reasons.push("source_absente: camp need retained; no declared native functional source, no generic urban building allocated".into());
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    #[test]
    fn exact_p06_reallocation_keeps_needs_and_refuses_unsourced_urban_facilities() {
        let layout: Layout = serde_json::from_slice(include_bytes!("fixtures/camp-p06-layout.json")).unwrap();
        let mut partition: Partition = serde_json::from_slice(include_bytes!("fixtures/camp-p06-partition.json")).unwrap();
        let before = partition.clone();
        let requested = layout.programme.as_ref().unwrap().demands.iter().map(|d|
            (d.id.clone(), d.requested.to_bits(), d.target_area.to_bits(), d.target_frontage.to_bits())).collect::<Vec<_>>();
        allocate(&layout, &mut partition);
        let after = partition.programme.as_ref().unwrap();
        for (id, n, area, front) in requested {
            let d = after.demands.iter().find(|d| d.id == id).unwrap();
            assert_eq!((d.requested.to_bits(), d.target_area.to_bits(), d.target_frontage.to_bits()), (n, area, front));
            assert_eq!(d.built_capacity, 0.0);
            if matches!(d.function.as_str(), "collective" | "warehouse" | "workshop") {
                assert!(d.reasons.iter().any(|r|r.starts_with("source_absente: camp need retained;")));
                assert_eq!(d.parcel_capacity,0.0);
                assert_eq!(d.deficit,d.requested);
            }
        }
        assert!(after.allocations.iter().all(|a| !matches!(a.function.as_str(), "warehouse" | "collective" | "workshop")),
            "No residential source may stand in for the missing facility source");
        assert!(after.allocations.iter().filter(|a|a.unit=="domesticUnits").all(|a|a.households<=1.),
            "One hut or tent cell holds one model household, regardless of settlement population");
        assert_eq!(before.parcels.iter().map(|p| &p.shape).collect::<Vec<_>>(), partition.parcels.iter().map(|p| &p.shape).collect::<Vec<_>>());
        let old_sites=super::super::super::building_sites::BuildingSiteIndex::prepare(std::slice::from_ref(&layout),std::slice::from_ref(&before),&[0]).unwrap().total();
        let new_sites=super::super::super::building_sites::BuildingSiteIndex::prepare(std::slice::from_ref(&layout),std::slice::from_ref(&partition),&[0]).unwrap().total();
        eprintln!("P06_EXACT_REALLOCATION before={} after={} needs={} lots={} siteCandidatesBefore={} siteCandidatesAfter={}", before.programme.as_ref().unwrap().allocations.len(), after.allocations.len(), after.demands.len(), partition.parcels.len(),old_sites,new_sites);
    }
    #[test]
    fn ordinary_urban_programmes_and_open_camp_ground_keep_their_existing_eligibility() {
        let mut l: Layout = serde_json::from_slice(include_bytes!("fixtures/camp-p06-layout.json")).unwrap();
        let pr = l.programme.clone().unwrap();
        for function in ["domestic", "mixed", "common", "market"] {
            let d = demand("test", function, 42.0, function == "domestic", String::new());
            assert!(supported(&l, pr.population, 0, &d, &pr.context));
        }
        let mut isolated=pr.context.clone();isolated.intent="isolated-mill".into();
        for d in &pr.demands { assert!(supported(&l, pr.population, 0, d, &isolated)); }
        l.culture = "european-organic".into();
        for d in &pr.demands { assert!(supported(&l, pr.population, 0, d, &pr.context)); }
    }
}
