use super::source_aspect_budget::SourceAspectBudget;
use super::source_terrain_budget::reduce;
use super::*;
use crate::catalogue::Layout;

fn request() -> PlacementRequest {
    let mut batch: PlanBatchRequest = serde_json::from_str(include_str!(
        "../tests/fixtures/java-source-terrain-054.json"
    ))
    .unwrap();
    batch.requests.remove(0)
}

fn source() -> &'static crate::catalogue::Parameters {
    &catalogue()
        .unwrap()
        .recipes
        .iter()
        .find(|r| r.id == "AS-ISL-B14")
        .unwrap()
        .parameters
}

#[test]
fn real_java_054_reuses_current_poses_and_improves_within_the_same_native_budget() {
    let r = request();
    let initial = plan_one_initial(&r, &vec![], None, false).unwrap();
    let original = initial.resolved.unpack().unwrap();
    let before = area(&initial.footprint);
    let target = r.programme.as_ref().unwrap().built_area_m2.unwrap();
    let improved = improve_domestic_budget(&r, &vec![], initial, target);
    let retained = improved.resolved.unpack().unwrap();
    let actual = area(&improved.footprint);
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
    let terrain_trace = improved
        .diagnostics
        .iter()
        .find(|d| d.starts_with("Source aspect terrain guide:"));
    eprintln!(
        "054 terrain guide: initial={before:.9} final={actual:.9} target={target}; {trace}; {terrain_trace:?}"
    );
    assert!(
        actual > before + 1.,
        "the actual pipeline must recover area, not only an archived pose"
    );
    assert!(pairs <= 8 && poses <= 24);
    let terrain_trace = terrain_trace.expect("the actual guide must be exercised");
    let evaluations: usize = terrain_trace
        .split("/8 exact")
        .next()
        .unwrap()
        .rsplit(' ')
        .next()
        .unwrap()
        .parse()
        .unwrap();
    assert!(evaluations <= 8);
    assert!(terrain_trace.contains("1/1 reduced dimension allocated"));
    assert_eq!(retained.recipe_id, original.recipe_id);
    assert_eq!(
        retained.parameters.variant_id,
        original.parameters.variant_id
    );
    assert_eq!(
        serde_json::to_vec(&retained.config).unwrap(),
        serde_json::to_vec(&original.config).unwrap()
    );
    assert_eq!(
        retained.plan.bodies[0].levels.len(),
        original.plan.bodies[0].levels.len()
    );
    assert_eq!(
        retained.plan.bodies[0].parameters.materials,
        original.plan.bodies[0].parameters.materials
    );
    assert_eq!(
        retained.plan.bodies[0].parameters.roof_system,
        original.plan.bodies[0].parameters.roof_system
    );
    assert!(
        retained.plan.courts.is_empty()
            && retained.plan.paths.is_empty()
            && retained.plan.features.is_empty()
    );
    let b = bounds(&retained.plan.bodies[0].footprint);
    let dimensions = [b[2] - b[0], b[3] - b[1]].map(snap);
    let aspect = SourceAspectBudget::new(source().width_m, source().depth_m).unwrap();
    assert!(aspect.contains(dimensions, [[4.5, 15.], [6., 22.]]));
    let (low, high, slope) = r.terrain.foundation_bounds(&improved.footprint).unwrap();
    assert!(
        high - low <= r.terrain.max_foundation_step_m + 1e-8
            && slope <= MAX_LEVEL_FOUNDATION_SLOPE_DEG
    );
    assert!(contains(&r.buildable, &improved.footprint));
    assert!(contains(
        r.roof_domain.as_ref().unwrap(),
        &improved.roof_footprint
    ));
}

#[test]
fn nested_terrain_guide_is_bounded_and_keeps_safe_unknown_and_unsupported_paths() {
    let mut r = request();
    let initial = plan_one_initial(&r, &vec![], None, false).unwrap();
    let mut candidate = initial.resolved.unpack().unwrap();
    let shape =
        crate::morphology::domestic_budget_shape(&candidate.parameters, &candidate.plan).unwrap();
    // Match the production call: the native builder snaps both dimensions.
    // In particular, 7.757 and snap(7.757) differ by one f64 ULP.
    let full = [9.695, 7.757].map(snap);
    candidate.plan = crate::morphology::domestic_budget_plan(
        &candidate.parameters,
        &candidate.plan,
        &shape,
        full[0],
        full[1],
    )
    .unwrap();
    candidate.parameters.width_m = [full[0]; 2];
    candidate.parameters.depth_m = [full[1]; 2];
    assert_eq!(
        bounds(&candidate.plan.bodies[0].footprint),
        [0., 0., full[0], full[1]]
    );
    let frozen = serde_json::to_vec(&candidate).unwrap();
    r.cadastral = rectangle(-100., -100., 200., 200.);
    r.buildable = r.cadastral.clone();
    r.roof_domain = Some(r.cadastral.clone());
    r.reserves.clear();
    r.neighbors.clear();
    r.terrain.grid = None;
    r.terrain.origin = Point { x: 0., y: 0. };
    r.terrain.ground_z_m = 0.;
    r.terrain.gradient = [0., 0.];
    r.terrain.water_z_m = None;
    let pose = Transform {
        origin: Point { x: 0., y: 1. },
        orientation_deg: 0.,
    };
    let access = ArchitectureAccess {
        id: "front".into(),
        kind: "public".into(),
        width_m: 200.,
        segment: [Point { x: -100., y: 0. }, Point { x: 100., y: 0. }],
    };
    let aspect = SourceAspectBudget::new(source().width_m, source().depth_m).unwrap();
    let allowed = [[4.5, 15.], [6., 22.]];
    let evaluate = |r: &PlacementRequest, c: &ResolvedArchitecture, budget| {
        reduce(r, c, full, &pose, &access, &vec![], aspect, allowed, budget)
    };
    let safe = evaluate(&r, &candidate, 8);
    assert!(safe.proposal.is_none() && safe.evaluations == 1);
    r.terrain.gradient = [0., 0.11];
    let result = evaluate(&r, &candidate, 8);
    assert_eq!(result.evaluations, 8);
    let reduced = result.proposal.unwrap();
    assert!(reduced.dimensions[0] < full[0] && reduced.dimensions[1] < full[1]);
    assert!(aspect.contains(reduced.dimensions, allowed));
    let facade = transform_point(
        Point {
            x: full[0] * 0.5,
            y: 0.,
        },
        &pose,
    );
    let new_facade = transform_point(
        Point {
            x: reduced.dimensions[0] * 0.5,
            y: 0.,
        },
        &reduced.transform,
    );
    assert!((facade.x - new_facade.x).abs() < 1e-12 && (facade.y - new_facade.y).abs() < 1e-12);
    let body = map_surface(
        &rectangle(0., 0., reduced.dimensions[0], reduced.dimensions[1]),
        &reduced.transform,
    );
    let (_, high, _) = r.terrain.foundation_bounds(&body).unwrap();
    assert!(high.is_finite());
    let used = evaluate(&r, &candidate, 1);
    assert!(used.proposal.is_none() && used.evaluations == 1);
    let empty = evaluate(&r, &candidate, 0);
    assert!(empty.proposal.is_none() && empty.evaluations == 0);
    r.terrain.gradient = [0., 1.];
    let impossible_minimum = evaluate(&r, &candidate, 8);
    assert!(impossible_minimum.proposal.is_none() && impossible_minimum.evaluations == 2);
    r.terrain.gradient = [0., 0.];
    r.terrain.water_z_m = Some(1.);
    let wet = evaluate(&r, &candidate, 8);
    assert!(wet.proposal.is_none() && wet.evaluations == 2);
    let mut strip = candidate.clone();
    strip.parameters.layout = Layout::Strip;
    let unsupported = evaluate(&r, &strip, 8);
    assert!(unsupported.proposal.is_none() && unsupported.evaluations == 0);
    let mut different_roof = candidate.clone();
    different_roof.plan.bodies[0].parameters.roof_system = "RF-STEEP-STEP".into();
    assert_eq!(evaluate(&r, &different_roof, 8).evaluations, 0);
    r.terrain.water_z_m = None;
    r.terrain.grid = Some(GroundGrid {
        origin: Point { x: 0., y: 0. },
        step_m: 0.001,
        width: 2,
        height: 2,
        elevations_m: vec![0.; 4],
    });
    let unknown = evaluate(&r, &candidate, 8);
    assert!(unknown.proposal.is_none() && unknown.evaluations == 1);
    assert_eq!(serde_json::to_vec(&candidate).unwrap(), frozen);
}

#[test]
fn reduced_target_success_keeps_the_remaining_full_size_poses_of_its_pair() {
    #[derive(serde::Deserialize)]
    struct Context {
        id: String,
        expected_full_area_m2: f64,
        prior_parts: Vec<Vec<Surface>>,
    }
    #[derive(serde::Deserialize)]
    struct Contexts {
        contexts: Vec<Context>,
    }
    let batch: PlanBatchRequest = serde_json::from_str(include_str!(
        "../tests/fixtures/source-terrain-early-stop-two.json"
    ))
    .unwrap();
    let contexts: Contexts = serde_json::from_str(include_str!(
        "../tests/fixtures/source-terrain-early-stop-occupation.json"
    ))
    .unwrap();
    assert_eq!(batch.requests.len(), 2);
    assert_eq!(batch.settings.as_ref().unwrap().parcel_fit, Some(true));
    for mut r in batch.requests {
        // Mirror the real bridge page setting and native prior-admission
        // occupation. A two-request empty-neighbour replay is not equivalent.
        r.parcel_fit = Some(true);
        let context = contexts.contexts.iter().find(|c| c.id == r.id).unwrap();
        let mut index = OccupationIndex::default();
        for parts in &context.prior_parts {
            index.insert(unite(parts));
        }
        let occupied = index.local(&r.cadastral);
        assert!(
            occupied.is_empty(),
            "the frozen bridge-page neighbours are spatially disjoint here"
        );
        let initial = plan_one_initial(&r, &occupied, None, false).unwrap();
        let original = initial.resolved.unpack().unwrap();
        let target = r.programme.as_ref().unwrap().built_area_m2.unwrap();
        let result = improve_domestic_budget(&r, &occupied, initial, target);
        let actual = area(&result.footprint);
        let trace = result
            .diagnostics
            .iter()
            .find(|d| d.starts_with("Domestic footprint budget:"))
            .unwrap();
        let terrain = result
            .diagnostics
            .iter()
            .find(|d| d.starts_with("Source aspect terrain guide:"))
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
        eprintln!(
            "terrain early-stop witness {}: actual={actual:.9} historical full={:.9} target={target}; {trace}; {terrain}",
            r.parcel_id, context.expected_full_area_m2
        );
        assert!(terrain.contains("1/1 reduced dimension allocated"));
        assert!(poses > 2 && poses <= 24 && pairs <= 8);
        assert!(
            actual >= context.expected_full_area_m2 - 0.001,
            "a reduction inside 10% must not pre-empt this pair's better full-size pose"
        );
        let retained = result.resolved.unpack().unwrap();
        assert_eq!(retained.recipe_id, original.recipe_id);
        assert_eq!(retained.config.seed, original.config.seed);
        assert_eq!(
            retained.plan.bodies[0].levels.len(),
            original.plan.bodies[0].levels.len()
        );
        assert!(contains(&r.buildable, &result.footprint));
        assert!(contains(
            r.roof_domain.as_ref().unwrap_or(&r.cadastral),
            &result.roof_footprint
        ));
        assert!(area(&intersection(&result.footprint, &occupied)) <= 0.0001);
    }
}
