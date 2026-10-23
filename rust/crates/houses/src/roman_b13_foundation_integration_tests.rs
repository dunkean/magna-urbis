//! Controlled B13 source witnesses, not a claim about automatic palette choice.
//! Requests have no source pin. Production visual/entry guards remain authority.
use super::*;

fn witness(
    variant: &str,
    floors: u32,
    nominal: [f64; 2],
) -> (PlacementRequest, ResolvedArchitecture) {
    let [width, depth] = nominal;
    let seed = format!("b13-native-foundation:{variant}:{width}:{depth}");
    let original = HouseConfig {
        pack: "MED-ANT".into(),
        seed: seed.clone(),
        era: "A".into(),
        mode: HistoricalMode::HistoricalInspired,
        count: 1,
        size: 1.,
        variation: 0.,
        ..HouseConfig::default()
    };
    let mut selected = original.clone();
    selected.recipe = Some("MED-ANT-B13".into());
    selected.overrides.variant = Some(variant.into());
    selected.overrides.floors = Some(floors);
    let resolved = resolve_urban_architecture(
        selected,
        ArchitectureFunction::Domestic,
        [40., 40.],
        false,
        Some(nominal),
        Some(0.),
        false,
    )
    .unwrap();
    let request = serde_json::from_value(serde_json::json!({
        "id":seed, "parcel_id":format!("{seed}:parcel"), "seed":seed,
        "cadastral":rectangle(-2., -2., width+4., depth+4.),
        "buildable":rectangle(-2., -2., width+4., depth+4.),
        "roof_domain":rectangle(-2., -2., width+4., depth+4.),
        "reserves":[], "neighbors":[], "party_boundaries":[],
        "accesses":[{"id":"real-street", "kind":"public", "width_m":2.,
            "segment":[{"x":-2.,"y":depth+2.},{"x":width+2.,"y":depth+2.}]}],
        "culture":{"culture":"roman-core", "pack":"MED-ANT",
            "mode":"historical_inspired", "borrowing":null},
        "function":"domestic", "config":original,
        "programme":{"composition":"row", "floors":[floors,floors]},
        "terrain":{"origin":{"x":0.,"y":0.},"ground_z_m":10.,
            "gradient":[0.,0.8/depth], "water_z_m":null,"max_foundation_step_m":0.75}
    }))
    .unwrap();
    (request, resolved)
}

fn pose() -> Transform {
    Transform {
        origin: point(0., 0.),
        orientation_deg: 0.,
    }
}

fn physical<'a>(prepared: &'a PreparedPlan<'_>) -> &'a crate::engine::PreparedFoundationDomains {
    match prepared.foundation().unwrap() {
        crate::engine::FoundationPreparation::Supported(value) => value,
        crate::engine::FoundationPreparation::Unsupported(reason) => panic!("{reason}"),
    }
}

fn error(result: Result<PlanBuilding, String>) -> String {
    result
        .err()
        .expect("The unchanged physical guard must refuse this site")
}

#[test]
fn b13_minimum_and_maximum_native_entries_pass_real_urban_guards_and_detail_replay() {
    for nominal in [[6.5, 10.], [10., 18.]] {
        for (variant, floors) in [("default", 2), ("three_storeys", 3), ("four_storeys", 4)] {
            let (request, resolved) = witness(variant, floors, nominal);
            assert!(native_ground_preparation_allowed(&request, true));
            assert_eq!(resolved.parameters.width_m, [nominal[0]; 2]);
            assert_eq!(resolved.parameters.depth_m, [nominal[1]; 2]);
            assert!(!resolved.parameters.urban_frontage_infill);
            assert_eq!(resolved.parameters.details, ["masonry_joints", "rear_yard"]);
            let frozen = serde_json::to_vec(&resolved).unwrap();
            let prepared = PreparedPlan::new(&resolved);
            let domains = physical(&prepared);
            let (old_low, old_high, _) = request
                .terrain
                .foundation_bounds(&prepared.plan_local)
                .unwrap();
            let world_bearing = unite(
                &domains
                    .bearing_parts
                    .iter()
                    .map(|part| map_surface(part, &pose()))
                    .collect::<Vec<_>>(),
            );
            let (low, high, _) = request.terrain.foundation_bounds(&world_bearing).unwrap();
            assert!(old_high - old_low > request.terrain.max_foundation_step_m);
            assert!(high - low < request.terrain.max_foundation_step_m);

            // First the existing foundation admission, then the real final-entry
            // production path. No fabricated entrance or direct plan injection.
            let previous = visual_prepared(&request, &prepared, pose(), &vec![], true, false)
                .unwrap_or_else(|reason| panic!("{} initial admission: {reason}", request.id));
            assert!(
                previous
                    .diagnostics
                    .iter()
                    .any(|d| d.starts_with("Native ground-strip foundation:"))
            );
            assert!(previous.resolved.unpack().unwrap().entrance.is_none());
            let building = retain_final_native_entry(&request, &vec![], previous.clone());
            assert!(
                building
                    .diagnostics
                    .iter()
                    .any(|d| d.starts_with("Native planning entrance upgrade:")),
                "{}: {:?}",
                request.id,
                building.diagnostics
            );
            assert_eq!(building.transform.origin, previous.transform.origin);
            assert_eq!(
                building.transform.orientation_deg,
                previous.transform.orientation_deg
            );
            assert_eq!(building.footprint, previous.footprint);
            assert_eq!(building.courtyards, previous.courtyards);
            assert_eq!(building.structural_features, previous.structural_features);
            assert!((building.ground_z_m - high).abs() < 1e-9);
            let restored: PlanBuilding =
                serde_json::from_slice(&serde_json::to_vec(&building).unwrap()).unwrap();
            assert_eq!(
                serde_json::to_vec(&restored.resolved).unwrap(),
                serde_json::to_vec(&building.resolved).unwrap()
            );
            let mut retained = restored.resolved.unpack().unwrap();
            let entry = retained
                .entrance
                .take()
                .expect("A genuine native portal must be retained");
            assert_eq!(
                serde_json::to_vec(&retained).unwrap(),
                frozen,
                "Only the retained entrance may be added to this same native architecture"
            );
            assert!(contains(
                &request.cadastral,
                &map_surface(&entry.passage, &building.transform)
            ));
            assert!(contains(
                request.roof_domain.as_ref().unwrap(),
                &building.roof_footprint
            ));
            for interiors in [false, true] {
                let batch = realize_plan(RealizePlanRequest {
                    building: restored.clone(),
                    interiors,
                })
                .unwrap_or_else(|reason| panic!("{} interiors={interiors}: {reason}", request.id));
                let unit = &batch.units[0];
                assert_eq!(unit.recipe_id, "MED-ANT-B13");
                assert_eq!(unit.variant_id, variant);
                assert_eq!(unit.bodies.len(), 1);
                assert_eq!(unit.bodies[0].footprint, resolved.plan.bodies[0].footprint);
                assert_eq!(unit.bodies[0].levels.len(), floors as usize);
                assert!(!unit.roofs.faces.is_empty());
                if interiors {
                    assert!(unit.features.iter().any(
                        |f| f.id.starts_with("detail-masonry_joints-")
                            && f.kind == FeatureKind::DecorativePanel
                            && f.roof.is_none()
                    ));
                    assert!(
                        unit.access
                            .portals
                            .iter()
                            .any(|p| (p.from == unit.access.root || p.to == unit.access.root)
                                && p.opening == entry.opening
                                && p.passage == entry.passage)
                    );
                }
            }
            assert_eq!(serde_json::to_vec(&resolved).unwrap(), frozen);
            eprintln!(
                "{}: same pose/source, {:.3}m true footing versus {:.3}m full court; exterior+interior valid",
                request.id,
                high - low,
                old_high - old_low
            );
        }
    }
}

#[test]
fn b13_native_entry_keeps_cadastral_terrain_and_explicit_control_refusals() {
    let (request, resolved) = witness("default", 2, [6.5, 10.]);
    let prepared = PreparedPlan::with_native_entry(&resolved);
    let domains = physical(&prepared);
    let entry = &domains.entry.as_ref().unwrap().site_entry;
    let solid_top = bounds(&unite(&[
        prepared.plan_local.clone(),
        unite(&domains.bearing_parts),
    ]))[3];
    let passage_top = bounds(&entry.passage)[3];
    assert!(
        passage_top > solid_top + 0.01,
        "Witness must cut only the exterior native landing: solid={solid_top}, passage={passage_top}"
    );
    let mut limited = request.clone();
    limited.cadastral = rectangle(-2., -2., 10.5, (solid_top + passage_top) * 0.5 + 2.);
    assert!(contains(&limited.cadastral, &prepared.plan_local));
    assert!(!contains(&limited.cadastral, &entry.passage));
    let denied = error(visual_with_front_access_prepared(
        &limited,
        &prepared,
        pose(),
        &vec![],
        true,
        false,
        None,
        true,
    ));
    assert!(
        denied.starts_with("Native circulation or supports exceed cadastral"),
        "{denied}"
    );

    let mut steep = request.clone();
    steep.terrain.gradient = [0., 0.11];
    let denied = error(visual_with_front_access_prepared(
        &steep,
        &prepared,
        pose(),
        &vec![],
        true,
        false,
        None,
        true,
    ));
    assert!(
        denied.starts_with("Architecture exceeds physical foundation/slope limits."),
        "{denied}"
    );

    // These exclusions keep the old whole-domain footing policy, which this
    // sloped-court witness deliberately fails. The detail whitelist does not
    // grant automatic native entry or foundation handling to explicit inputs.
    for exclusion in ["recipe", "variant", "strict", "exact"] {
        let mut explicit = request.clone();
        match exclusion {
            "recipe" => explicit.config.as_mut().unwrap().recipe = Some("MED-ANT-B13".into()),
            "variant" => {
                explicit.config.as_mut().unwrap().overrides.variant = Some("default".into())
            }
            "strict" => explicit.culture.mode = HistoricalMode::HistoricalStrict,
            _ => {}
        }
        assert!(!native_ground_preparation_allowed(
            &explicit,
            exclusion != "exact"
        ));
        let denied = error(visual_with_front_access_prepared(
            &explicit,
            &prepared,
            pose(),
            &vec![],
            exclusion != "exact",
            false,
            None,
            true,
        ));
        assert!(
            denied.starts_with("Architecture exceeds physical foundation/slope limits."),
            "{exclusion}: {denied}"
        );
    }
}
