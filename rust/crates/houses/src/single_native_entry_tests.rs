//! Final-entry upgrades consume exact retained houses, independently of source
//! selection/dimension experiments. No native admission fixture is relabelled.
use super::*;
use crate::engine::{
    FoundationPreparation, prepare_foundation_and_entry, prepare_foundation_domains,
};

#[derive(Deserialize)]
struct Fixture {
    cases: Vec<Witness>,
}

#[derive(Deserialize)]
struct Witness {
    request: PlacementRequest,
    building: PlanBuilding,
}

fn witnesses() -> Vec<Witness> {
    serde_json::from_str::<Fixture>(include_str!(
        "../tests/fixtures/single-native-entry-five.json"
    ))
    .unwrap()
    .cases
}

// The frozen world projection is ordinary decimal JSON, while the retained
// local architecture encodes exact f64 bits. The historical serde_json parser
// (without float_roundtrip) reads a416's literal 9461.814304288533 as
// 9461.814304288531: exactly one ULP. Reprojection of the unchanged bit-exact
// local body restores .533. Compare only these world snapshots at one ULP;
// array topology, identities, retained architecture and pose stay exact.
// This is not a tolerance used by any domain, terrain or access validator.
fn same_world_snapshot(a: &serde_json::Value, b: &serde_json::Value, path: &str) {
    use serde_json::Value;
    match (a, b) {
        (Value::Number(a), Value::Number(b)) => {
            let (a, b) = (a.as_f64().unwrap(), b.as_f64().unwrap());
            assert!(
                a == b
                    || a.is_finite()
                        && b.is_finite()
                        && a.is_sign_negative() == b.is_sign_negative()
                        && a.to_bits().abs_diff(b.to_bits()) <= 1,
                "world snapshot {path}: {a:?} != {b:?} by more than one ULP"
            );
        }
        (Value::Array(a), Value::Array(b)) => {
            assert_eq!(a.len(), b.len(), "world topology {path}");
            for (i, (a, b)) in a.iter().zip(b).enumerate() {
                same_world_snapshot(a, b, &format!("{path}/{i}"));
            }
        }
        (Value::Object(a), Value::Object(b)) => {
            assert_eq!(
                a.keys().collect::<Vec<_>>(),
                b.keys().collect::<Vec<_>>(),
                "world schema {path}"
            );
            for (key, a) in a {
                same_world_snapshot(a, &b[key], &format!("{path}/{key}"));
            }
        }
        _ => assert_eq!(a, b, "world value {path}"),
    }
}

fn same_physical_house(
    request: &PlacementRequest,
    previous: &PlanBuilding,
    after: &PlanBuilding,
    prepared: &FoundationPreparation,
) {
    assert_eq!(previous.recipe_id, after.recipe_id);
    assert_eq!(previous.variant_id, after.variant_id);
    assert_eq!(previous.transform.origin, after.transform.origin);
    assert_eq!(
        previous.transform.orientation_deg,
        after.transform.orientation_deg
    );
    let before = previous.resolved.unpack().unwrap();
    let mut retained = after.resolved.unpack().unwrap();
    let upgraded = retained.entrance.is_some();
    retained.entrance = before.entrance.clone();
    assert_eq!(
        serde_json::to_value(&before).unwrap(),
        serde_json::to_value(&retained).unwrap(),
        "no native layout, dimensions, source draw or feature may change"
    );

    let mut reprojected = previous.clone();
    if upgraded {
        let physical = match prepared {
            FoundationPreparation::Supported(value) => value,
            FoundationPreparation::Unsupported(reason) => panic!("{reason}"),
        };
        // The old snapshot sampled map_surface(plan_local), while the native
        // footing samples the union of transformed bearing parts. Even for this
        // unchanged Single, the extra boolean operation before raster clipping
        // changes a416's ground by 3.975e-9 m. This derived scalar is not a raw
        // coordinate JSON round-trip. Recompute it with the same decoded input;
        // require exact new results and separately bound the snapshot drift.
        let bearing = unite(
            &physical
                .bearing_parts
                .iter()
                .map(|part| map_surface(part, &after.transform))
                .collect::<Vec<_>>(),
        );
        let (low, ground, _) = request.terrain.foundation_bounds(&bearing).unwrap();
        let elevation = |snapshot: f64, actual: f64, expected: f64, field: &str| {
            assert_eq!(actual, expected, "same-reader native elevation {field}");
            assert!(
                snapshot.is_finite() && (snapshot - expected).abs() <= 1e-8,
                "derived elevation {field}: snapshot={snapshot:?}, native={expected:?}"
            );
        };
        elevation(previous.ground_z_m, after.ground_z_m, ground, "ground");
        reprojected.ground_z_m = ground;
        assert_eq!(after.volumes.len(), before.plan.bodies.len());
        assert_eq!(previous.volumes.len(), after.volumes.len());
        for (i, body) in before.plan.bodies.iter().enumerate() {
            let old = &previous.volumes[i];
            let new = &after.volumes[i];
            let baseline = &mut reprojected.volumes[i];
            elevation(old.z_m, new.z_m, ground + body.z, "volume z");
            baseline.z_m = ground + body.z;
            elevation(
                old.foundation.z_min_m,
                new.foundation.z_min_m,
                low - 0.15,
                "foundation low",
            );
            elevation(
                old.foundation.z_max_m,
                new.foundation.z_max_m,
                ground,
                "foundation high",
            );
            baseline.foundation.z_min_m = low - 0.15;
            baseline.foundation.z_max_m = ground;
            assert_eq!(old.levels.len(), body.levels.len());
            assert_eq!(new.levels.len(), body.levels.len());
            for index in 0..body.levels.len() {
                let z = ground + body.z + index as f64 * body_level_height(body);
                elevation(old.levels[index].z_m, new.levels[index].z_m, z, "level z");
                baseline.levels[index].z_m = z;
            }
        }
    }
    let world = |b: &PlanBuilding| {
        serde_json::json!({
            "footprint": b.footprint, "roof": b.roof_footprint, "courtyards": b.courtyards,
            "ground": b.ground_z_m, "useful_area": b.useful_area_m2,
            "structures": b.structural_features, "volumes": b.volumes,
        })
    };
    same_world_snapshot(&world(&reprojected), &world(after), "physical");
}

fn unchanged_except_diagnostic(previous: &PlanBuilding, after: &PlanBuilding) {
    let mut after = after.clone();
    after.diagnostics = previous.diagnostics.clone();
    assert_eq!(
        serde_json::to_value(previous).unwrap(),
        serde_json::to_value(after).unwrap()
    );
}

#[test]
fn frozen_single_entries_use_one_existing_pose_and_replay_only_certified_portals() {
    let fixtures = witnesses();
    assert_eq!(fixtures.len(), 5);
    let mut supported = 0;
    let mut accepted = 0;
    for Witness {
        request,
        building: previous,
    } in fixtures
    {
        let resolved = previous.resolved.unpack().unwrap();
        assert!(resolved.entrance.is_none());
        // This final opt-in must never change foundation admission in an
        // intermediate source/pose/dimension attempt.
        assert!(matches!(
            prepare_foundation_domains(&resolved).unwrap(),
            FoundationPreparation::Unsupported(_)
        ));
        let prepared = prepare_foundation_and_entry(&resolved).unwrap();
        let after = retain_final_native_entry(&request, &vec![], previous.clone());
        same_physical_house(&request, &previous, &after, &prepared);
        if previous.recipe_id == "MED-ANT-B01" {
            assert!(
                matches!(prepared, FoundationPreparation::Unsupported(_)),
                "flat terrace/hearth requires its separate literal/invariant proof"
            );
            unchanged_except_diagnostic(&previous, &after);
            assert!(!after.resolved.has_retained_entrance());
            assert_eq!(after.domestic_units,0);
            assert!(realize_plan(RealizePlanRequest{building:after,interiors:true}).is_err(),"a proxy cannot certify the B01 interior");
            continue;
        }
        supported += 1;
        let physical = match prepared {
            FoundationPreparation::Supported(physical) => physical,
            FoundationPreparation::Unsupported(reason) => panic!("{}: {reason}", request.id),
        };
        assert!(physical.native_features.is_empty());
        let entry = physical.entry.as_ref().unwrap();
        assert!(crate::access::plan_entry::same_entrance(
            &entry.body_entry,
            &entry.site_entry
        ));
        let retained = after.resolved.unpack().unwrap();
        if let Some(retained_entry) = &retained.entrance {
            accepted += 1;
            assert!(
                crate::access::plan_entry::same_entrance(retained_entry, &entry.body_entry),
                "Single must not select another existing door"
            );
            assert!(
                after
                    .diagnostics
                    .iter()
                    .any(|d| d.contains("final Single") && d.contains("1/1"))
            );
            assert!(
                !after
                    .diagnostics
                    .iter()
                    .any(|d| d.starts_with("Native ground-strip foundation:"))
            );
            let mut occupation_parts = vec![
                after.footprint.clone(),
                after.courtyards.clone(),
                after.circulation.clone(),
            ];
            occupation_parts.extend(after.structural_features.iter().map(|f| f.surface.clone()));
            let occupied = unite(&occupation_parts);
            for local in &physical.occupation_parts {
                assert!(
                    area(&difference(
                        &map_surface(local, &after.transform),
                        &occupied
                    )) <= 0.0001,
                    "{} must export the entire checked native passage",
                    request.id
                );
            }
            for interiors in [false, true] {
                let detailed = realize_plan(RealizePlanRequest {
                    building: after.clone(),
                    interiors,
                })
                .unwrap_or_else(|reason| panic!("{} interiors={interiors}: {reason}", request.id));
                if interiors && previous.recipe_id == "MED-ANT-B12" {
                    assert_eq!(detailed.units[0].bodies[0].levels.len(), 2);
                    assert!(
                        detailed.units[0]
                            .access
                            .portals
                            .iter()
                            .any(|portal| (portal.from_z_m - portal.to_z_m).abs() > 0.1),
                        "the two-level source must retain real vertical access"
                    );
                }
            }
        } else {
            unchanged_except_diagnostic(&previous, &after);
            assert!(
                after
                    .diagnostics
                    .iter()
                    .any(|d| d.starts_with("Native planning entrance deferred:")
                        && d.contains("1/1")),
                "{} must explain its fixed-pose refusal: {:?}",
                request.id,
                after.diagnostics
            );
        }
        eprintln!(
            "Single entry {}: {}",
            request.id,
            after
                .diagnostics
                .iter()
                .find(|d| d.starts_with("Native planning entrance upgrade:")
                    || d.starts_with("Native planning entrance deferred:"))
                .unwrap()
        );
    }
    assert_eq!(supported, 4);
    assert!(
        accepted > 0,
        "a list of unsupported/deferred cases is not evidence of a working Single entry path"
    );
    eprintln!(
        "Fixed Single witness outcome: {accepted}/4 supported entries admitted; B01 remains explicitly unsupported."
    );
}

#[test]
fn single_native_passage_rights_are_checked_without_moving_or_replacing_the_house() {
    let Witness {
        mut request,
        building,
    } = witnesses().remove(0);
    let resolved = building.resolved.unpack().unwrap();
    let prepared = PreparedPlan::with_native_entry(&resolved);
    let physical = match prepared.foundation().unwrap() {
        FoundationPreparation::Supported(value) => value,
        FoundationPreparation::Unsupported(reason) => panic!("{reason}"),
    };
    let passage = map_surface(
        &physical.entry.as_ref().unwrap().site_entry.passage,
        &building.transform,
    );
    let outside_body = difference(&passage, &building.footprint);
    assert!(
        area(&outside_body) > 0.01,
        "the negative case must obstruct a real external landing"
    );
    request.reserves = union(&request.reserves, &outside_body);
    let neighbors = unite(
        &request
            .neighbors
            .iter()
            .map(|n| n.footprint.clone())
            .collect::<Vec<_>>(),
    );
    let error = visual_with_front_access_prepared(
        &request,
        &prepared,
        building.transform.clone(),
        &neighbors,
        true,
        false,
        None,
        true,
    )
    .err()
    .unwrap();
    assert!(
        error.contains("Native circulation or supports exceed cadastral"),
        "{error}"
    );
    let after = retain_final_native_entry(&request, &vec![], building.clone());
    unchanged_except_diagnostic(&building, &after);
    assert!(after.resolved.unpack().unwrap().entrance.is_none());
    assert!(
        after
            .diagnostics
            .iter()
            .any(|d| d.starts_with("Native planning entrance deferred:") && d.contains("1/1"))
    );
}

#[test]
fn single_final_entry_keeps_explicit_modes_and_unsupported_geometry_on_the_old_path() {
    let Witness { request, building } = witnesses().remove(0);
    let mut exclusions = vec![];
    let mut pinned = request.clone();
    pinned.config.as_mut().unwrap().recipe = Some(building.recipe_id.clone());
    exclusions.push(pinned);
    let mut variant = request.clone();
    variant.config.as_mut().unwrap().overrides.variant = Some(building.variant_id.clone());
    exclusions.push(variant);
    let mut overridden = request.clone();
    overridden.config.as_mut().unwrap().overrides.floors = Some(1);
    exclusions.push(overridden);
    let mut strict = request.clone();
    strict.culture.mode = HistoricalMode::HistoricalStrict;
    strict.config.as_mut().unwrap().mode = HistoricalMode::HistoricalStrict;
    exclusions.push(strict);
    let mut no_fit = request.clone();
    no_fit.parcel_fit = Some(false);
    exclusions.push(no_fit);
    for excluded in exclusions {
        let after = retain_final_native_entry(&excluded, &vec![], building.clone());
        assert_eq!(
            serde_json::to_value(&after).unwrap(),
            serde_json::to_value(&building).unwrap()
        );
    }
    // Exact entrypoint deliberately skips both budget and final upgrade.
    let before_exact = plan_one_initial(&request, &vec![], None, true);
    let after_exact = plan_one(&request, &vec![], None, true);
    assert_eq!(
        serde_json::to_value(&before_exact).unwrap(),
        serde_json::to_value(&after_exact).unwrap()
    );

    let mut with_court = building.resolved.unpack().unwrap();
    with_court.plan.courts = rectangle(-2., 0., 1., 1.);
    assert!(matches!(
        prepare_foundation_and_entry(&with_court).unwrap(),
        FoundationPreparation::Unsupported(_)
    ));
    let mut with_gallery = building.resolved.unpack().unwrap();
    with_gallery.parameters.details.push("side_corridor".into());
    assert!(matches!(
        prepare_foundation_and_entry(&with_gallery).unwrap(),
        FoundationPreparation::Unsupported(_)
    ));
}
