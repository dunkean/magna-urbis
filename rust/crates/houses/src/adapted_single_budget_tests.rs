//! Native regression tests for the isolated shared-minimum budget proposal.
//! It reconstructs current native plans, never decodes an old architecture.
use super::*;

use super::adapted_single_budget as adapted_minimum;

#[derive(Deserialize)]
struct Prior {
    footprint: Surface,
    courtyards: Surface,
    circulation: Surface,
    structural_features: Vec<Feature>,
}

#[derive(Deserialize)]
struct Witness {
    request: PlacementRequest,
    preceding_occupation: Vec<Prior>,
    baseline: PlanBuilding,
}

fn fixture(label: &str) -> (PlacementRequest, Surface, PlanBuilding) {
    let mut all: BTreeMap<String, Witness> = serde_json::from_str(include_str!(
        "../tests/fixtures/b06-adapted-budget-r5.json"
    )).unwrap();
    let witness = all.remove(label).unwrap();
    let r = witness.request;
    let mut index = OccupationIndex::default();
    for p in witness.preceding_occupation {
        let mut parts = vec![p.footprint, p.courtyards, p.circulation];
        parts.extend(p.structural_features.into_iter().map(|f| f.surface));
        index.insert(unite(&parts));
    }
    let occupied = index.local(&r.cadastral);
    (r, occupied, witness.baseline)
}

fn counts(b: &PlanBuilding) -> (usize, usize) {
    let trace = b.diagnostics.iter().rev().find(|s| s.starts_with("Domestic footprint budget:")).unwrap();
    let pairs = trace.split("/8 dimension pairs").next().unwrap().rsplit("; ").next().unwrap().parse().unwrap();
    let poses = trace.split("/24 rigid poses").next().unwrap().rsplit(", ").next().unwrap().parse().unwrap();
    (pairs, poses)
}

#[test]
fn real_b06_intermediate_rectangles_keep_source_topology_and_native_guards() {
    let mut improvements = 0;
    for label in ["moderate-deficit", "large-deficit", "target-met"] {
        let (r, occupied, before) = fixture(label);
        let initial = plan_one_initial(&r, &occupied, None, false).unwrap();
        let original = initial.resolved.unpack().unwrap();
        let initial_area = area(&initial.footprint);
        assert_eq!(original.recipe_id, "AS-ISL-B06");
        let source = &catalogue().unwrap().recipes.iter().find(|s| s.id == original.recipe_id).unwrap().parameters;
        let body = &original.plan.bodies[0];
        let bounds_before = bounds(&body.footprint);
        let dims_before = [snap(bounds_before[2] - bounds_before[0]), snap(bounds_before[3] - bounds_before[1])];
        let minimum = crate::morphology::constrained_minimum_domain(&body.parameters);
        let selected = adapted_minimum::adapted_axis_minima(&r, &original, source, [14.; 2]);
        let target = r.programme.as_ref().unwrap().built_area_m2.unwrap();
        // These witnesses had no successful legacy budget change. Check the
        // exact current native initial against its archived baseline geometry.
        assert!((initial_area - area(&before.footprint)).abs() < 0.00001);
        assert!(area(&difference(&initial.footprint, &before.footprint)) < 0.00001);
        let after = improve_domestic_budget(&r, &occupied, initial.clone(), target);
        let native = after.resolved.unpack().unwrap();
        let b = bounds(&native.plan.bodies[0].footprint);
        let dims_after = [snap(b[2] - b[0]), snap(b[3] - b[1])];
        let (pairs, poses) = counts(&after);
        let (low, high, slope) = r.terrain.foundation_bounds(&after.footprint).unwrap();
        let ground_step = high - low;
        eprintln!("B06 budget proposal: label={label} id={} initial_m2={initial_area:.9} old_m2={:.9} proposed_m2={:.9} target={target} before_dims={dims_before:?} after_dims={dims_after:?} structural_minimum={minimum:?} selected_lower_bounds={selected:?} dimensions={pairs}/8 admissions={poses}/24 step={ground_step:.9} slope={slope:.9} compound_requested=true native_bodies={}", r.id, area(&before.footprint), area(&after.footprint), native.plan.bodies.len());
        eprintln!("B06 budget trace: label={label} {:?}", after.diagnostics.iter().filter(|d| d.starts_with("Domestic footprint budget:") || d.starts_with("Source aspect")).collect::<Vec<_>>());
        assert!(pairs <= 8 && poses <= 24);
        assert_eq!(native.recipe_id, original.recipe_id);
        assert_eq!(native.parameters.variant_id, original.parameters.variant_id);
        assert_eq!(serde_json::to_value(&native.config).unwrap(), serde_json::to_value(&original.config).unwrap());
        assert_eq!(native.plan.bodies.len(), 1);
        assert_eq!(native.plan.bodies[0].levels.len(), body.levels.len());
        assert_eq!(native.plan.bodies[0].parameters.materials, body.parameters.materials);
        assert_eq!(native.plan.bodies[0].parameters.details, body.parameters.details);
        assert_eq!(native.plan.bodies[0].parameters.roof_system, body.parameters.roof_system);
        assert!(native.plan.courts.is_empty() && native.plan.paths.is_empty() && native.plan.features.is_empty());
        assert!(contains(&difference(&r.buildable, &r.reserves), &after.footprint));
        assert!(contains(r.roof_domain.as_ref().unwrap_or(&r.cadastral), &after.roof_footprint));
        assert!(contains(&difference(&r.cadastral, &r.reserves), &after.circulation));
        let occupied_parts = unite(&[after.footprint.clone(), after.courtyards.clone(), after.circulation.clone()]);
        assert!(area(&intersection(&occupied_parts, &occupied)) < 0.0001);
        assert!(ground_step <= r.terrain.max_foundation_step_m + 1e-8 && slope <= MAX_LEVEL_FOUNDATION_SLOPE_DEG);
        let ratio = source_aspect_budget::SourceAspectBudget::new(source.width_m, source.depth_m).unwrap();
        assert!(ratio.contains(dims_after, [[minimum[0], 44.], [minimum[1], 44.]]));
        if label == "target-met" {
            assert!(selected.is_none());
            assert_eq!(initial.footprint, after.footprint);
            assert_eq!(initial.roof_footprint, after.roof_footprint);
            assert_eq!(initial.circulation, after.circulation);
            assert_eq!(serde_json::to_vec(&initial.resolved).unwrap(), serde_json::to_vec(&after.resolved).unwrap());
        }
        if area(&after.footprint) > area(&before.footprint) + 1. {
            improvements += 1;
        }
        let finalized = retain_final_native_entry(&r, &occupied, after);
        let exterior = realize_plan(RealizePlanRequest { building: finalized.clone(), interiors: false });
        let interior = realize_plan(RealizePlanRequest { building: finalized.clone(), interiors: true });
        eprintln!("B06 detail proposal: label={label} exterior={:?} interior={:?} entry={:?}", exterior.as_ref().map(|_| ()), interior.as_ref().map(|_| ()), finalized.diagnostics.iter().filter(|s| s.starts_with("Native planning entrance")).collect::<Vec<_>>());
        if let Some(folder) = std::env::var_os("MAGNA_B06_PROOF_DIR") {
            let folder = std::path::PathBuf::from(folder);
            std::fs::create_dir_all(&folder).unwrap();
            let path = folder.join(format!("{label}.json"));
            let file = std::fs::OpenOptions::new().write(true).create_new(true).open(path).unwrap();
            serde_json::to_writer_pretty(file, &serde_json::json!({
                "label": label, "request": r, "occupied": occupied,
                "before": before, "after": finalized,
                "source_physical_minimum_m": minimum,
                "proposed_axis_minimum_m": selected,
                "before_dimensions_m": dims_before, "after_dimensions_m": dims_after,
                "exterior": exterior.as_ref().map(|_| ()).map_err(|e| e.as_str()),
                "interior": interior.as_ref().map(|_| ()).map_err(|e| e.as_str()),
                "dimensions": pairs, "admissions": poses,
                "foundation_step_m": ground_step, "foundation_slope_deg": slope,
            })).unwrap();
        }
        exterior.expect("full native exterior must preserve the admitted proposed building");
        // Interior remains an independent doorway/enrichment result, not an
        // implied capacity certificate from one rectangle's area.
    }
    assert!(improvements > 0, "a native intermediate improvement is required; None is not evidence");
}

#[test]
fn adapted_minima_do_not_authorize_pins_modes_or_unsupported_topologies() {
    let (r, occupied, _) = fixture("moderate-deficit");
    let b = plan_one_initial(&r, &occupied, None, false).unwrap();
    let resolved = b.resolved.unpack().unwrap();
    let source = &catalogue().unwrap().recipes.iter().find(|s| s.id == resolved.recipe_id).unwrap().parameters;
    assert!(adapted_minimum::adapted_axis_minima(&r, &resolved, source, [14.; 2]).is_some());
    // Mixed incumbent: one native axis below nominal, the other above it.
    // Eligibility must not turn the latter back into permission to shrink it.
    let mut mixed = resolved.clone();
    let body = &mut mixed.plan.bodies[0];
    body.footprint = rectangle(0., 0., 10., 15.);
    for level in &mut body.levels {
        *level = body.footprint.clone();
    }
    assert_eq!(
        adapted_minimum::adapted_axis_minima(&r, &mixed, source, [14.; 2]),
        Some([10., 15.]),
    );
    for change in 0..5 {
        let mut altered = r.clone();
        match change {
            0 => altered.config.as_mut().unwrap().recipe = Some(resolved.recipe_id.clone()),
            1 => altered.config.as_mut().unwrap().mode = HistoricalMode::HistoricalStrict,
            2 => altered.culture.mode = HistoricalMode::HistoricalStrict,
            3 => altered.parcel_fit = Some(false),
            _ => altered.config.as_mut().unwrap().overrides.floors = Some(1),
        }
        assert!(adapted_minimum::adapted_axis_minima(&altered, &resolved, source, [14.; 2]).is_none());
    }
    for layout in [crate::catalogue::Layout::Strip, crate::catalogue::Layout::Additive, crate::catalogue::Layout::Courtyard] {
        let mut altered = resolved.clone();
        altered.parameters.layout = layout;
        assert!(adapted_minimum::adapted_axis_minima(&r, &altered, source, [14.; 2]).is_none());
    }
}
