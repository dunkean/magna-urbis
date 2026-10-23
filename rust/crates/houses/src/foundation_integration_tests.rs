//! A fixed real native plan isolates physical-domain integration from palette,
//! morphology and placement searches. No interiors are certified by this proof.
use super::*;

fn witness() -> (PlacementRequest, ResolvedArchitecture) {
    let seed = "native-strip-foundation-integration";
    let mut selected = HouseConfig {
        recipe: Some("EUR-MED-B02".into()),
        seed: seed.into(),
        mode: HistoricalMode::HistoricalInspired,
        count: 1,
        ..HouseConfig::default()
    };
    selected.overrides.variant = Some("default".into());
    selected.overrides.floors = Some(1);
    let resolved = resolve_urban_architecture(
        selected,
        ArchitectureFunction::Domestic,
        [40., 40.],
        false,
        Some([8., 16.]),
        Some(0.),
        true,
    )
    .unwrap();
    // These are original urban controls, not the internally selected source.
    // The selection above fixes the native witness; this request has no pin.
    let original = HouseConfig {
        seed: seed.into(),
        mode: HistoricalMode::HistoricalInspired,
        count: 1,
        ..HouseConfig::default()
    };
    let request: PlacementRequest = serde_json::from_value(serde_json::json!({
        "id":"native-foundation/building", "parcel_id":"native-foundation",
        "cadastral":rectangle(-2., -2., 12., 20.),
        "buildable":rectangle(-2., -2., 12., 20.),
        "reserves":[],
        "roof_domain":rectangle(-2., -2., 12., 20.),
        "accesses":[{"id":"actual-front","kind":"public","width_m":12.,
            "segment":[{"x":-2.,"y":18.},{"x":10.,"y":18.}]}],
        "party_boundaries":[], "neighbors":[],
        "culture":{"culture":"european-organic","pack":"EUR-MED","mode":"historical_inspired","borrowing":null},
        "function":"domestic", "seed":seed, "config":original,
        "terrain":{"origin":{"x":0.,"y":0.},"ground_z_m":10.,"gradient":[0.,0.05],
            "water_z_m":null,"max_foundation_step_m":0.75}
    })).unwrap();
    (request, resolved)
}

fn pose() -> Transform {
    Transform {
        origin: point(0., 0.),
        orientation_deg: 0.,
    }
}

fn physical(resolved: &ResolvedArchitecture) -> crate::engine::PreparedFoundationDomains {
    match crate::engine::prepare_foundation_domains(resolved).unwrap() {
        crate::engine::FoundationPreparation::Supported(value) => value,
        crate::engine::FoundationPreparation::Unsupported(reason) => {
            panic!("Unexpected native witness exclusion: {reason}")
        }
    }
}

fn refusal(result: Result<PlanBuilding, String>) -> String {
    match result {
        Ok(_) => panic!("Expected this fixed physical pose to be refused"),
        Err(reason) => reason,
    }
}

#[test]
fn native_foundation_admits_bare_sloped_court_and_replays_all_exterior_supports() {
    let (request, resolved) = witness();
    let domains = physical(&resolved);
    let (old_low, old_high, _) = request
        .terrain
        .foundation_bounds(&plan_domain(&resolved))
        .unwrap();
    let bearing_world = unite(
        &domains
            .bearing_parts
            .iter()
            .map(|s| map_surface(s, &pose()))
            .collect::<Vec<_>>(),
    );
    let (low, high, _) = request.terrain.foundation_bounds(&bearing_world).unwrap();
    assert!(old_high - old_low > request.terrain.max_foundation_step_m);
    assert!(high - low < request.terrain.max_foundation_step_m);
    let prepared = PreparedPlan::new(&resolved);
    let building = visual_prepared(&request, &prepared, pose(), &vec![], true, false).unwrap();
    assert!((building.ground_z_m - high).abs() < 1e-9);
    assert!(
        building
            .diagnostics
            .iter()
            .any(|d| d.starts_with("Native ground-strip foundation:"))
    );
    assert_eq!(
        building.structural_features.len(),
        domains.native_features.len()
    );
    assert_eq!(
        building
            .structural_features
            .iter()
            .filter(|f| f.kind == FeatureKind::Gallery)
            .count(),
        1
    );
    assert_eq!(
        building
            .structural_features
            .iter()
            .filter(|f| f.kind == FeatureKind::Post)
            .count(),
        2
    );
    assert!(prepared.foundation.get().is_some());

    // Reuse this immutable source and its prepared physical geometry.
    let again = visual_prepared(&request, &prepared, pose(), &vec![], true, false).unwrap();
    assert_eq!(
        serde_json::to_vec(&building).unwrap(),
        serde_json::to_vec(&again).unwrap()
    );
    let retained_features = building.structural_features.clone();
    let ground = building.ground_z_m;
    let batch = realize_plan(RealizePlanRequest {
        building,
        interiors: false,
    })
    .unwrap();
    let unit = &batch.units[0];
    assert!(!unit.roofs.faces.is_empty());
    let native = crate::placement::native_site_features(unit);
    // Roof construction adds the two native upper gables afterwards. They
    // are not new ground supports: end_profile places their actual vertices
    // on the body boundary at/above the wall top; its 8cm `surface` is an
    // indexing proxy for that vertical wall. Do not discard arbitrary extras.
    let extras: Vec<_> = native
        .iter()
        .filter(|f| !retained_features.iter().any(|r| r.id == f.id))
        .collect();
    let mut extra_ids: Vec<_> = extras.iter().map(|f| f.id.as_str()).collect();
    extra_ids.sort();
    assert_eq!(
        extra_ids,
        [
            "roof:unit-0:body:0:0:end:RF-GABLE:0",
            "roof:unit-0:body:0:0:end:RF-GABLE:1",
        ]
    );
    let body = &unit.bodies[0];
    let level = &body.levels[0];
    let body_bounds = bounds(&level.footprint);
    let wall_top = snap(level.z_m + level.height_m);
    for gable in extras {
        assert_eq!(gable.kind, FeatureKind::RoofGable);
        assert!((gable.z_m - wall_top).abs() < 1e-9);
        assert!(gable.height_m > 0. && gable.vertices3d.len() >= 3);
        for v in &gable.vertices3d {
            assert!(v.z >= wall_top - 1e-9);
            assert!(v.x >= body_bounds[0] - 1e-9 && v.x <= body_bounds[2] + 1e-9);
            assert!(v.y >= body_bounds[1] - 1e-9 && v.y <= body_bounds[3] + 1e-9);
            assert!(
                (v.x - body_bounds[0])
                    .abs()
                    .min((v.x - body_bounds[2]).abs())
                    .min((v.y - body_bounds[1]).abs())
                    .min((v.y - body_bounds[3]).abs())
                    < 1e-9,
                "Upper gable vertex must remain on its real body boundary: {v:?}"
            );
        }
    }
    assert_eq!(native.len(), retained_features.len() + 2);
    for retained in &retained_features {
        let feature = native.iter().find(|f| f.id == retained.id).unwrap();
        assert_eq!(retained.kind, feature.kind);
        assert_eq!(
            retained.surface,
            map_surface(&feature.surface, &unit.transform)
        );
        assert!((retained.z_m - (ground + feature.z_m)).abs() < 1e-9);
        assert_eq!(retained.height_m, feature.height_m);
        assert_eq!(retained.material, feature.material);
    }
}

#[test]
fn native_foundation_still_refuses_required_supports_rights_and_steep_terrain() {
    let (mut request, resolved) = witness();
    request.terrain.gradient = [0.1, 0.];
    let domains = physical(&resolved);
    let (body_low, body_high, _) = request
        .terrain
        .foundation_bounds(&domains.body_domain)
        .unwrap();
    let bearing = unite(
        &domains
            .bearing_parts
            .iter()
            .map(|s| map_surface(s, &pose()))
            .collect::<Vec<_>>(),
    );
    let (low, high, _) = request.terrain.foundation_bounds(&bearing).unwrap();
    assert!(body_high - body_low < request.terrain.max_foundation_step_m);
    assert!(high - low > request.terrain.max_foundation_step_m);
    let error = refusal(visual(&request, &resolved, pose(), &vec![], true, false));
    assert!(
        error.starts_with("Architecture exceeds physical foundation/slope limits."),
        "{error}"
    );

    let (request, mut outside) = witness();
    outside.plan.features.push(crate::layouts::feature(
        "actual-outside-post",
        FeatureKind::Post,
        rectangle(12., 6., 0.2, 0.2),
        0.,
        2.7,
        "MAT-TIMBER-POST",
    ));
    assert!(
        physical(&outside)
            .native_features
            .iter()
            .any(|f| f.id == "actual-outside-post")
    );
    let error = refusal(visual(&request, &outside, pose(), &vec![], true, false));
    assert!(
        error.contains("do not fit the supplied domain")
            || error.contains("supports exceed cadastral"),
        "{error}"
    );

    let (mut steep, resolved) = witness();
    steep.terrain.gradient = [0., 0.25];
    steep.terrain.max_foundation_step_m = 100.; // isolate the unchanged12° guard
    let error = refusal(visual(&steep, &resolved, pose(), &vec![], true, false));
    assert!(
        error.contains("raster slope 14.036 deg / allowed 12 deg"),
        "{error}"
    );
}

#[test]
fn explicit_or_strict_controls_keep_the_previous_conservative_foundation_path() {
    let (original, resolved) = witness();
    for exclusion in ["exact", "recipe", "variant", "floors", "strict"] {
        let mut request = original.clone();
        let automatic = exclusion != "exact";
        match exclusion {
            "recipe" => request.config.as_mut().unwrap().recipe = Some("EUR-MED-B02".into()),
            "variant" => {
                request.config.as_mut().unwrap().overrides.variant = Some("default".into())
            }
            "floors" => request.config.as_mut().unwrap().overrides.floors = Some(1),
            "strict" => request.culture.mode = HistoricalMode::HistoricalStrict,
            _ => {}
        }
        let prepared = PreparedPlan::new(&resolved);
        let error = refusal(visual_prepared(
            &request,
            &prepared,
            pose(),
            &vec![],
            automatic,
            false,
        ));
        assert!(
            error.starts_with("Architecture exceeds physical foundation/slope limits."),
            "{exclusion}: {error}"
        );
        assert!(
            prepared.foundation.get().is_none(),
            "{exclusion}: native preparation should remain inactive"
        );
    }
}
