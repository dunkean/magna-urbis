use super::*;
use crate::direct_convex_fit::PendingCheck;
use crate::engine::{resolve_architecture, volume_unit};
use crate::geometry::{bounds, point, unite};
use crate::model::{HouseConfig, Polygon};

fn witness(id: &str) -> (PlacementRequest, ResolvedArchitecture, String) {
    let seed = format!("direct-native:{id}");
    let original = HouseConfig {
        pack: "AS-ISL".into(),
        seed: seed.clone(),
        count: 1,
        mode: HistoricalMode::HistoricalInspired,
        ..HouseConfig::default()
    };
    let mut selected = original.clone();
    selected.recipe = Some(id.into());
    selected.overrides.variant = Some("default".into());
    let resolved = resolve_architecture(selected).unwrap();
    let request: PlacementRequest = serde_json::from_value(serde_json::json!({
        "id":"direct-native", "parcel_id":"direct-native",
        "cadastral":rectangle(0.,0.,20.,25.), "buildable":rectangle(0.,0.,20.,25.),
        "roof_domain":rectangle(0.,0.,20.,25.), "reserves":[], "neighbors":[], "party_boundaries":[],
        "accesses":[{"id":"front","kind":"public","width_m":20.,"segment":[{"x":0.,"y":0.},{"x":20.,"y":0.}]}],
        "culture":{"culture":"javanese-courts","pack":"AS-ISL","mode":"historical_inspired","borrowing":null},
        "function":"domestic", "seed":seed, "config":original,
        "terrain":{"origin":{"x":0.,"y":0.},"ground_z_m":0.,"gradient":[0.,0.],"water_z_m":null,"max_foundation_step_m":0.75}
    })).unwrap();
    (request, resolved, format!("houses:v2:{seed}:unit:0"))
}

fn ready<'a>(
    request: &PlacementRequest,
    resolved: &'a ResolvedArchitecture,
    seed: &str,
) -> NativeSingleRectangle<'a> {
    match prepare(request, resolved, seed, false, true).unwrap() {
        Preparation::Ready(value) => value,
        Preparation::Unsupported(reason) => panic!("Expected native descriptor: {reason}"),
    }
}

fn candidate(value: NativeFitOutcome) -> NativeRectangleCandidate {
    match value {
        NativeFitOutcome::Candidate(value) => value,
        NativeFitOutcome::EmptyFixedDomain => panic!("Unexpected empty fixed convex domain"),
        NativeFitOutcome::Unsupported(reason) => panic!("Unexpected unsupported fit: {reason}"),
    }
}

fn trapezoid() -> Surface {
    vec![Polygon {
        outer: vec![
            point(0., 0.),
            point(16., 0.),
            point(13., 18.),
            point(1., 18.),
        ],
        holes: vec![],
    }]
}

fn fixed_site(domain: &Surface) -> FixedFrontSite<'_> {
    FixedFrontSite {
        buildable: domain,
        architectural: domain,
        roof: domain,
        front_y: 0.8,
        preferred_body_x: 1.,
    }
}

#[test]
fn real_plain_gable_and_hip_sources_materialize_one_fitted_whole_native_body() {
    let domain = trapezoid();
    for id in ["AS-ISL-B14", "AS-ISL-B15"] {
        let (request, original, seed) = witness(id);
        let frozen = serde_json::to_vec(&original).unwrap();
        let descriptor = ready(&request, &original, &seed);
        let result = candidate(descriptor.solve(&fixed_site(&domain), 60.).unwrap());
        assert!((result.body_area_m2 - 60.).abs() < 0.04);
        assert_eq!(result.target_error_m2, result.body_area_m2 - 60.);
        assert_eq!(
            result.resolved.parameters.width_m,
            [result.nominal_dimensions_m[0]; 2]
        );
        assert_eq!(
            result.resolved.parameters.depth_m,
            [result.nominal_dimensions_m[1]; 2]
        );
        assert!(
            result
                .analytical
                .pending_checks
                .contains(&PendingCheck::PhysicalTerrain)
        );
        assert!(
            result
                .analytical
                .pending_checks
                .contains(&PendingCheck::EntranceAndAccess)
        );
        assert!(result.resolved.plan.courts.is_empty() && result.resolved.plan.paths.is_empty());
        assert!(result.resolved.plan.features.is_empty());
        assert_eq!(result.transform.orientation_deg, 180.);
        let body = &result.resolved.plan.bodies[0];
        let world = transformed(&body.footprint, &result.transform);
        assert!(area(&difference(&world, &domain)) < 0.0001);
        assert!((bounds(&world)[1] - 0.8).abs() < 1e-7);

        // Only the two dimensions changed; the whole native bundle survives.
        let mut unchanged = result.resolved.parameters.clone();
        unchanged.width_m = original.parameters.width_m;
        unchanged.depth_m = original.parameters.depth_m;
        assert_eq!(
            serde_json::to_vec(&unchanged).unwrap(),
            serde_json::to_vec(&original.parameters).unwrap()
        );
        assert_eq!(
            serde_json::to_vec(&result.resolved.config).unwrap(),
            serde_json::to_vec(&original.config).unwrap()
        );
        assert_eq!(frozen, serde_json::to_vec(&original).unwrap());

        // The helper itself creates no mesh. This independent native replay
        // verifies its eave model on both real source roof systems.
        let volume = volume_unit(&result.resolved).unwrap();
        assert_eq!(volume.bodies[0].footprint, body.footprint);
        assert!(!volume.roofs.faces.is_empty());
        let roof = unite(
            &volume
                .roofs
                .faces
                .iter()
                .filter_map(|face| {
                    let surface = vec![Polygon {
                        outer: face
                            .vertices
                            .iter()
                            .map(|i| {
                                let v = &volume.roofs.vertices[*i as usize];
                                Point { x: v.x, y: v.y }
                            })
                            .collect(),
                        holes: vec![],
                    }];
                    (area(&surface) > 1e-8).then_some(surface)
                })
                .collect::<Vec<_>>(),
        );
        assert!(area(&difference(&transformed(&roof, &result.transform), &domain)) < 0.0001);
        let again = candidate(descriptor.solve(&fixed_site(&domain), 60.).unwrap());
        assert_eq!(
            serde_json::to_vec(&result.resolved).unwrap(),
            serde_json::to_vec(&again.resolved).unwrap()
        );
        assert_eq!(result.nominal_dimensions_m, again.nominal_dimensions_m);
    }
}

#[test]
fn source_minima_and_maxima_remain_hard_and_unknown_geometry_keeps_its_old_path() {
    let (request, resolved, seed) = witness("AS-ISL-B14");
    let descriptor = ready(&request, &resolved, &seed);
    let large = rectangle(-5., -5., 80., 80.);
    let site = fixed_site(&large);
    let low = candidate(descriptor.solve(&site, 1.).unwrap());
    let high = candidate(descriptor.solve(&site, 100_000.).unwrap());
    assert_eq!(low.nominal_dimensions_m, [4.5, 6.]);
    assert_eq!(high.nominal_dimensions_m, [15., 22.]);
    assert!(!low.analytical.target_met && !high.analytical.target_met);
    let tiny = rectangle(0., 0., 2., 2.);
    assert!(matches!(
        descriptor.solve(&fixed_site(&tiny), 60.).unwrap(),
        NativeFitOutcome::EmptyFixedDomain
    ));
    let mut hole = trapezoid();
    hole[0]
        .holes
        .push(rectangle(2., 2., 1., 1.)[0].outer.clone());
    assert!(matches!(
        descriptor.solve(&fixed_site(&hole), 60.).unwrap(),
        NativeFitOutcome::Unsupported(_)
    ));

    let mut strip = resolved.clone();
    strip.parameters.layout = Layout::Strip;
    assert!(matches!(
        prepare(&request, &strip, &seed, false, true).unwrap(),
        Preparation::Unsupported(_)
    ));
    let mut porch = resolved.clone();
    porch.parameters.details.push("front_porch".into());
    assert!(matches!(
        prepare(&request, &porch, &seed, false, true).unwrap(),
        Preparation::Unsupported(_)
    ));
}

#[test]
fn original_pins_strict_exact_and_disabled_parcel_fit_are_not_reinterpreted() {
    let (request, resolved, seed) = witness("AS-ISL-B14");
    for exclusion in ["recipe", "variant", "floors", "strict", "exact", "no-fit"] {
        let mut original = request.clone();
        match exclusion {
            "recipe" => original.config.as_mut().unwrap().recipe = Some("AS-ISL-B14".into()),
            "variant" => {
                original.config.as_mut().unwrap().overrides.variant = Some("default".into())
            }
            "floors" => original.config.as_mut().unwrap().overrides.floors = Some(1),
            "strict" => original.culture.mode = HistoricalMode::HistoricalStrict,
            _ => {}
        }
        assert!(
            matches!(
                prepare(
                    &original,
                    &resolved,
                    &seed,
                    exclusion == "exact",
                    exclusion != "no-fit"
                )
                .unwrap(),
                Preparation::Unsupported(_)
            ),
            "{exclusion}"
        );
    }
}
