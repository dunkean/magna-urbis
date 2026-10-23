//! Scalar and actual-request checks for the narrowly enabled source ratio.
use super::source_aspect_budget::SourceAspectBudget;
use super::*;
use crate::catalogue::Layout;

fn source(id: &str) -> &'static crate::catalogue::Parameters {
    &catalogue()
        .unwrap()
        .recipes
        .iter()
        .find(|r| r.id == id)
        .unwrap()
        .parameters
}

fn fixture() -> PlanBatchRequest {
    serde_json::from_str(include_str!(
        "../tests/fixtures/java-source-aspect-three.json"
    ))
    .unwrap()
}

#[test]
fn source_intervals_correct_java_bands_and_keep_naturally_long_roofs() {
    for (id, old) in [("AS-ISL-B14", [4.5, 22.]), ("AS-ISL-B15", [5., 26.])] {
        let p = source(id);
        let aspect = SourceAspectBudget::new(p.width_m, p.depth_m).unwrap();
        let limits = [
            [p.width_m[0], 2. * p.width_m[1]],
            [p.depth_m[0], 2. * p.depth_m[1]],
        ];
        assert!(!aspect.contains(old, limits));
        let projected = aspect.project(old, limits).unwrap();
        assert!(aspect.contains(projected, limits));
        assert!(aspect.contains(projected.map(snap), limits));
        assert!(projected[0] > old[0] && projected[1] < old[1]);
        assert!(
            (projected[0] * projected[1] - old[0] * old[1]).abs()
                < GRID_M * projected.iter().sum::<f64>()
        );
    }
    let p = source("AS-ISL-B15");
    let aspect = SourceAspectBudget::new(p.width_m, p.depth_m).unwrap();
    let limits = [[5., 16.], [9., 26.]];
    // Both ratio endpoints are valid; preserving one initial draw alone would
    // unnecessarily discard part of this full declared source interval.
    for valid in [[5., 13.], [8., 9.], [8., 13.], [10., 26.], [16., 26.]] {
        assert_eq!(
            aspect.project(valid, limits).unwrap().map(f64::to_bits),
            valid.map(f64::to_bits)
        );
    }
    let long = source("EUR-NOR-B01");
    let aspect = SourceAspectBudget::new(long.width_m, long.depth_m).unwrap();
    for valid in [[6., 36.], [12., 72.], [20., 72.]] {
        assert_eq!(
            aspect
                .project(valid, [[6., 20.], [18., 72.]])
                .unwrap()
                .map(f64::to_bits),
            valid.map(f64::to_bits)
        );
    }
    assert!(!aspect.contains([6., 72.], [[6., 20.], [18., 72.]]));
}

#[test]
fn scalar_projection_checks_bounds_grid_and_post_guide_depth() {
    let aspect = SourceAspectBudget::new([5., 8.], [9., 13.]).unwrap();
    let limits = [[5., 16.], [9., 26.]];
    let [minimum, maximum] = aspect.depth_bounds(16., limits).unwrap();
    assert_eq!(minimum, 18.);
    assert_eq!(maximum, 26.);
    assert!(!aspect.contains([16., 9.], limits));
    assert!(aspect.contains([16., minimum], limits));
    assert!(aspect.project([5., 26.], [[5., 5.], [9., 13.]]).is_none());
    for bad in [f64::NAN, f64::INFINITY, -1., 0.] {
        assert!(SourceAspectBudget::new([bad, 8.], [9., 13.]).is_none());
        assert!(aspect.project([bad, 26.], limits).is_none());
        assert!(!aspect.contains([bad, 26.], limits));
    }
    // Uniform size expands the axis limits, not the declared ratio interval.
    let size = 1.2;
    let scaled = [[5. * size, 16. * size], [9. * size, 26. * size]];
    let valid = [8. * size, 13. * size];
    assert_eq!(
        aspect.project(valid, scaled).unwrap().map(f64::to_bits),
        valid.map(f64::to_bits)
    );
    let kampung = SourceAspectBudget::new([4.5, 7.5], [6., 11.]).unwrap();
    let size = 1.0001;
    let limits = [[4.5 * size, 15. * size], [6. * size, 22. * size]];
    let raw = [4.5 * size, 11.001];
    assert!(kampung.contains(raw, limits));
    assert_eq!(
        kampung.project(raw, limits).unwrap().map(f64::to_bits),
        raw.map(f64::to_bits)
    );
    assert!(
        !kampung.contains(raw.map(snap), limits),
        "the real constructor snap crosses both the source width minimum and ratio; final guard must refuse it"
    );
}

#[test]
fn source_aspect_scope_keeps_strip_complex_pins_and_modes_unchanged() {
    let request = fixture().requests.remove(0);
    let initial = plan_one_initial(&request, &vec![], None, false).unwrap();
    let resolved = initial.resolved.unpack().unwrap();
    let p = source(&resolved.recipe_id);
    assert!(SourceAspectBudget::for_candidate(&request, &resolved, p).is_some());
    let mut altered = request.clone();
    altered.culture.mode = HistoricalMode::HistoricalStrict;
    assert!(SourceAspectBudget::for_candidate(&altered, &resolved, p).is_none());
    altered = request.clone();
    altered.parcel_fit = Some(false);
    assert!(SourceAspectBudget::for_candidate(&altered, &resolved, p).is_none());
    altered = request.clone();
    altered.config.as_mut().unwrap().recipe = Some(resolved.recipe_id.clone());
    assert!(SourceAspectBudget::for_candidate(&altered, &resolved, p).is_none());
    altered = request.clone();
    altered.config.as_mut().unwrap().overrides.variant = Some("default".into());
    assert!(SourceAspectBudget::for_candidate(&altered, &resolved, p).is_none());
    for layout in [Layout::Strip, Layout::Courtyard, Layout::Additive] {
        let mut changed = p.clone();
        changed.layout = layout;
        assert!(SourceAspectBudget::for_candidate(&request, &resolved, &changed).is_none());
    }
    let mut changed = p.clone();
    changed.footprint_family = "FP-LONG".into();
    assert!(SourceAspectBudget::for_candidate(&request, &resolved, &changed).is_none());
    changed = p.clone();
    changed.components[0].width_ratio = [0.8; 2];
    assert!(SourceAspectBudget::for_candidate(&request, &resolved, &changed).is_none());
    // An explicit source still follows its protected production path: the
    // automatic post-admission pass must not be entered for this request.
    altered.config.as_mut().unwrap().recipe = Some(resolved.recipe_id.clone());
    match (
        plan_one_initial(&altered, &vec![], None, false),
        plan_one(&altered, &vec![], None, false),
    ) {
        (Ok(expected), Ok(protected)) => assert_eq!(
            serde_json::to_vec(&protected).unwrap(),
            serde_json::to_vec(&expected).unwrap()
        ),
        (Err(expected), Err(protected)) => assert_eq!(protected, expected),
        _ => panic!("explicit recipe/variant changed its admission outcome"),
    }
}

#[test]
fn three_real_java_requests_keep_admission_source_and_declared_proportions() {
    let mut occupied = OccupationIndex::default();
    for request in fixture().requests {
        let neighbors = occupied.local(&request.cadastral);
        let initial = plan_one_initial(&request, &neighbors, None, false).unwrap();
        let before = initial.resolved.unpack().unwrap();
        let target = request.programme.as_ref().unwrap().built_area_m2.unwrap();
        let improved = improve_domestic_budget(&request, &neighbors, initial.clone(), target);
        let after = improved.resolved.unpack().unwrap();
        assert_eq!(before.recipe_id, after.recipe_id);
        assert_eq!(before.parameters.variant_id, after.parameters.variant_id);
        assert_eq!(
            serde_json::to_vec(&before.config).unwrap(),
            serde_json::to_vec(&after.config).unwrap()
        );
        assert_eq!(before.plan.bodies.len(), after.plan.bodies.len());
        assert_eq!(before.plan.courts, after.plan.courts);
        assert_eq!(before.plan.paths, after.plan.paths);
        assert_eq!(
            serde_json::to_vec(&before.entrance).unwrap(),
            serde_json::to_vec(&after.entrance).unwrap()
        );
        assert_eq!(
            before.plan.bodies[0].levels.len(),
            after.plan.bodies[0].levels.len()
        );
        assert_eq!(before.parameters.roof_system, after.parameters.roof_system);
        assert_eq!(
            serde_json::to_vec(&before.parameters.materials).unwrap(),
            serde_json::to_vec(&after.parameters.materials).unwrap()
        );
        let initial_error = (area(&initial.footprint) / target).ln().abs();
        assert!((area(&improved.footprint) / target).ln().abs() <= initial_error + 1e-10);
        let source = source(&after.recipe_id);
        let aspect = SourceAspectBudget::new(source.width_m, source.depth_m).unwrap();
        let bounds = bounds(&after.plan.bodies[0].footprint);
        let actual = [bounds[2] - bounds[0], bounds[3] - bounds[1]].map(snap);
        // a702's incumbent was already physically adapted below the nominal
        // depth minimum. Check the actual ratio independently of that historic
        // axis exception; new budget proposals still use native/source minima.
        assert!(
            aspect.contains(
                actual,
                [
                    [GRID_M, source.width_m[1] * before.config.size * 2.],
                    [GRID_M, source.depth_m[1] * before.config.size * 2.]
                ]
            ),
            "{} ended outside its source interval at {:?}",
            request.id,
            actual
        );
        assert!(contains(&request.buildable, &improved.footprint));
        assert!(contains(
            request.roof_domain.as_ref().unwrap_or(&request.cadastral),
            &improved.roof_footprint
        ));
        let trace = improved
            .diagnostics
            .iter()
            .find(|d| d.starts_with("Domestic footprint budget:"))
            .unwrap();
        let pairs: usize = trace
            .split("/8 dimension pairs")
            .next()
            .unwrap()
            .rsplit("; ")
            .next()
            .unwrap()
            .parse()
            .unwrap();
        let poses: usize = trace
            .split("/24 rigid poses")
            .next()
            .unwrap()
            .rsplit(", ")
            .next()
            .unwrap()
            .parse()
            .unwrap();
        assert!(pairs <= 8 && poses <= 24);
        eprintln!(
            "java source aspect {}: source={} initial={:.6}m² final={:.6}m² actual={:?} target={target} pairs={pairs} poses={poses}",
            request.parcel_id,
            after.recipe_id,
            area(&initial.footprint),
            area(&improved.footprint),
            actual
        );
        let mut parts = vec![
            improved.footprint,
            improved.courtyards,
            improved.circulation,
        ];
        parts.extend(improved.structural_features.into_iter().map(|f| f.surface));
        occupied.insert(unite(&parts));
    }
}
