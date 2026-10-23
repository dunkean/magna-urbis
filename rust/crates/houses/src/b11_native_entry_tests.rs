//! Isolated proof only: exact retained cbfa houses, never new source selection.
use super::*;
use crate::engine::{
    FoundationPreparation, prepare_foundation_and_entry, prepare_foundation_domains,
};

#[derive(serde::Deserialize)]
struct Fixture {
    cases: Vec<Witness>,
}
#[derive(serde::Deserialize)]
struct Witness {
    stage: String,
    request: PlacementRequest,
    building: PlanBuilding,
}
fn witnesses() -> Vec<Witness> {
    let fixture: Fixture = serde_json::from_str(include_str!(
        "../tests/fixtures/b11-native-entry-three.json"
    ))
    .unwrap();
    assert_eq!(fixture.cases.len(), 3);
    fixture.cases
}
fn physical(resolved: &ResolvedArchitecture) -> crate::engine::PreparedFoundationDomains {
    match prepare_foundation_and_entry(resolved).expect("actual native preparation") {
        FoundationPreparation::Supported(value) => value,
        FoundationPreparation::Unsupported(reason) => panic!("B11 remains unsupported: {reason}"),
    }
}
fn unchanged(previous: &PlanBuilding, after: &PlanBuilding) {
    let mut after = after.clone();
    after.diagnostics = previous.diagnostics.clone();
    assert_eq!(
        serde_json::to_value(previous).unwrap(),
        serde_json::to_value(after).unwrap()
    );
}
fn same_architecture(previous: &PlanBuilding, after: &PlanBuilding) {
    assert_eq!(previous.recipe_id, after.recipe_id);
    assert_eq!(previous.variant_id, after.variant_id);
    assert_eq!(previous.transform.origin, after.transform.origin);
    assert_eq!(
        previous.transform.orientation_deg,
        after.transform.orientation_deg
    );
    let before = previous.resolved.unpack().unwrap();
    let mut actual = after.resolved.unpack().unwrap();
    actual.entrance = before.entrance.clone();
    // Includes config/seed/source, all parameter bundles, BodySpecs, dimensions,
    // roof arms, courts and upper levels. Do not rebuild from nominal W/D.
    assert_eq!(
        serde_json::to_value(&before).unwrap(),
        serde_json::to_value(actual).unwrap()
    );
    let expected = map_surface(&body_domain(&before), &after.transform);
    assert_eq!(
        expected, after.footprint,
        "same-reader projection, not old JSON rounding"
    );
}
fn stepped_roof_rights(w: &Witness, unit: &HouseUnit) {
    let redents: Vec<_> = unit
        .features
        .iter()
        .filter(|feature| feature.kind == FeatureKind::SteppedGable)
        .collect();
    assert_eq!(
        redents.len(),
        2,
        "one whole rectangle must retain its two native redents"
    );
    assert!(
        unit.roofs
            .faces
            .iter()
            .any(|face| face.kind == RoofFaceKind::SteppedGable)
    );
    let resolved = w.building.resolved.unpack().unwrap();
    let body = &unit.bodies[0];
    assert_eq!(body.roof_system, "RF-STEEP-STEP");
    assert_eq!(body.roof_arms, resolved.plan.bodies[0].arms);
    let top = body.levels.last().unwrap();
    let roof_z = top.z_m + top.height_m;
    let mut real_projection_outside_body = 0.;
    for feature in redents {
        assert_eq!(feature.z_m, roof_z);
        assert!(feature.height_m > 0.);
        real_projection_outside_body += area(&difference(&feature.surface, &body.footprint));
        let world = map_surface(&feature.surface, &w.building.transform);
        // Vertical roof faces alone have zero projected area. Check the real
        // 0.16m native feature band as well, with the existing area guard.
        assert!(
            area(&difference(&world, &w.building.roof_footprint)) <= 0.0001,
            "{}: redent exceeds retained roof envelope",
            w.stage
        );
        assert!(
            area(&difference(
                &world,
                w.request
                    .roof_domain
                    .as_ref()
                    .unwrap_or(&w.request.cadastral)
            )) <= 0.0001,
            "{}: redent exceeds actual roof rights",
            w.stage
        );
    }
    assert!(
        real_projection_outside_body > 0.01,
        "this must test an actual gable protrusion"
    );
}
fn actual_walls_and_stairs(unit: &HouseUnit, entry: &crate::access::StructuralEntrance) {
    assert_eq!(unit.bodies.len(), 1);
    assert_eq!(unit.bodies[0].levels.len(), 3);
    let portal = unit
        .access
        .portals
        .iter()
        .find(|p| {
            (p.from == unit.access.root || p.to == unit.access.root)
                && p.opening == entry.opening
                && p.passage == entry.passage
                && p.width_m == entry.width_m
                && p.from_z_m == entry.from_z_m
                && p.to_z_m == entry.to_z_m
        })
        .expect("the retained portal must exist exactly in the detailed native graph");
    let wall = unit
        .walls
        .iter()
        .find(|wall| Some(&wall.id) == portal.wall_id.as_ref())
        .expect("a real facade wall, not a portal painted across an absent shell");
    assert_eq!(wall.kind, WallKind::Exterior);
    assert!(wall.opening_ids.contains(&portal.id));
    assert!(
        area(&intersection(
            &crate::wall_geometry::wall_section(wall, entry.from_z_m + 0.01),
            &entry.passage,
        )) <= 0.0001,
        "the actual solid must be cut at the retained opening"
    );
    for levels in unit.bodies[0].levels.windows(2) {
        let (a, b) = (levels[0].z_m, levels[1].z_m);
        assert!(
            unit.access
                .portals
                .iter()
                .any(|p| p.from_z_m == a && p.to_z_m == b || p.from_z_m == b && p.to_z_m == a),
            "each retained storey requires its real vertical connection"
        );
    }
}

#[test]
fn b11_retained_shell_portal_and_redents_are_native_before_site_admission() {
    for w in witnesses() {
        let resolved = w.building.resolved.unpack().unwrap();
        assert_eq!(resolved.recipe_id, "EUR-MED-B11");
        assert_eq!(resolved.parameters.variant_id, "default");
        assert!(resolved.entrance.is_none());
        assert!(
            matches!(
                prepare_foundation_domains(&resolved).unwrap(),
                FoundationPreparation::Unsupported(_)
            ),
            "intermediate Single path stays unchanged"
        );
        let prepared = physical(&resolved);
        assert!(prepared.native_features.is_empty());
        let entry = prepared.entry.as_ref().unwrap();
        assert!(crate::access::plan_entry::same_entrance(
            &entry.body_entry,
            &entry.site_entry
        ));
        assert!(entry.retained_passages.is_empty());
        for passage in [&entry.body_entry.passage, &entry.site_entry.passage] {
            assert!(area(&difference(passage, &prepared.occupation_domain)) <= 0.0001);
        }
        // Full walls/rooms/stairs are intentionally not generated by the cheap
        // preparation. This independent native replay closes that local risk;
        // it does NOT assert cadastral/public access feasibility.
        let mut retained = resolved.clone();
        retained.entrance = Some(entry.body_entry.clone());
        let native = crate::engine::enrich_architecture(&retained)
            .unwrap_or_else(|reason| panic!("{} local native replay refused: {reason}", w.stage));
        actual_walls_and_stairs(&native.units[0], &entry.body_entry);
        stepped_roof_rights(&w, &native.units[0]);
        // Existing exterior replay remains a separate assertion.
        let exterior = realize_plan(RealizePlanRequest {
            building: w.building.clone(),
            interiors: false,
        })
        .unwrap_or_else(|reason| panic!("{} retained exterior refused: {reason}", w.stage));
        stepped_roof_rights(&w, &exterior.units[0]);
        eprintln!(
            "B11 {}: structural preparation + actual walls/stairs/retained door + redents PASS; site connection not implied",
            w.stage
        );
    }
}

#[test]
fn b11_final_entry_tries_only_the_archived_pose_and_preserves_every_refusal() {
    let mut accepted = 0;
    for w in witnesses() {
        let before = w.building.resolved.unpack().unwrap();
        let prepared = physical(&before);
        let after = retain_final_native_entry(&w.request, &vec![], w.building.clone());
        if let Some(entry) = after.resolved.unpack().unwrap().entrance {
            accepted += 1;
            same_architecture(&w.building, &after);
            assert!(crate::access::plan_entry::same_entrance(
                &entry,
                &prepared.entry.as_ref().unwrap().body_entry
            ));
            let mut parts = vec![
                after.footprint.clone(),
                after.courtyards.clone(),
                after.circulation.clone(),
            ];
            parts.extend(
                after
                    .structural_features
                    .iter()
                    .map(|feature| feature.surface.clone()),
            );
            let occupied = unite(&parts);
            for part in &prepared.occupation_parts {
                assert!(
                    area(&difference(&map_surface(part, &after.transform), &occupied)) <= 0.0001
                );
            }
            for interiors in [false, true] {
                let replay = realize_plan(RealizePlanRequest {
                    building: after.clone(),
                    interiors,
                })
                .unwrap_or_else(|reason| {
                    panic!("{} admitted interiors={interiors}: {reason}", w.stage)
                });
                stepped_roof_rights(&w, &replay.units[0]);
                if interiors {
                    actual_walls_and_stairs(&replay.units[0], &entry);
                }
            }
        } else {
            unchanged(&w.building, &after);
        }
        let trace = after
            .diagnostics
            .iter()
            .find(|d| {
                d.starts_with("Native planning entrance upgrade:")
                    || d.starts_with("Native planning entrance deferred:")
            })
            .expect("explicit fixed-pose outcome");
        assert!(
            trace.contains("final Single") && trace.contains("1/1"),
            "{trace}"
        );
        eprintln!("B11 {} fixed-pose outcome: {trace}", w.stage);
    }
    // Zero is an honest outcome of this isolated eligibility experiment;
    // passing this test does not advertise a successful city/detail upgrade.
    eprintln!(
        "B11 SITE RESULT: {accepted}/3 archived poses admit the native entrance; {} retained their old proxy. No source/dimension/pose/door retry.",
        3 - accepted
    );
}

#[test]
fn b11_does_not_bypass_domains_access_modes_or_other_roof_exclusions() {
    let w = witnesses().pop().unwrap();
    let resolved = w.building.resolved.unpack().unwrap();
    let prepared = PreparedPlan::with_native_entry(&resolved);
    let physical = physical(&resolved);
    let mut illegal = w.request.clone();
    illegal.buildable = vec![];
    let error = visual_with_front_access_prepared(
        &illegal,
        &prepared,
        w.building.transform.clone(),
        &vec![],
        true,
        false,
        None,
        true,
    )
    .err()
    .unwrap();
    assert!(error.contains("do not fit the supplied domain"), "{error}");
    unchanged(
        &w.building,
        &retain_final_native_entry(&illegal, &vec![], w.building.clone()),
    );
    let mut no_access = w.request.clone();
    no_access.accesses.clear();
    let entry = physical.entry.as_ref().unwrap();
    // Call the exact connector so an earlier cadastral failure cannot mask
    // whether the missing access is rejected.
    assert!(
        proposed_native_access_with_entry(
            &no_access,
            &entry.site_entry,
            &entry.site_solids,
            &w.building.transform,
            &w.building.footprint,
            &vec![],
            None
        )
        .is_err()
    );
    unchanged(
        &w.building,
        &retain_final_native_entry(&no_access, &vec![], w.building.clone()),
    );
    let mut protected = Vec::new();
    let mut pin = w.request.clone();
    pin.config.as_mut().unwrap().recipe = Some(w.building.recipe_id.clone());
    protected.push(pin);
    let mut variant = w.request.clone();
    variant.config.as_mut().unwrap().overrides.variant = Some("default".into());
    protected.push(variant);
    let mut strict = w.request.clone();
    strict.culture.mode = HistoricalMode::HistoricalStrict;
    strict.config.as_mut().unwrap().mode = HistoricalMode::HistoricalStrict;
    protected.push(strict);
    let mut no_fit = w.request.clone();
    no_fit.parcel_fit = Some(false);
    protected.push(no_fit);
    for request in protected {
        let result = retain_final_native_entry(&request, &vec![], w.building.clone());
        assert_eq!(
            serde_json::to_value(result).unwrap(),
            serde_json::to_value(&w.building).unwrap()
        );
    }
    for rf in ["RF-FLAT", "RF-DOME", "RF-SHED", "RF-STEP", "RF-UNKNOWN"] {
        let mut p = resolved.parameters.clone();
        p.roof_system = rf.into();
        p.details.clear();
        assert!(
            !crate::engine::single_native_entry_parameters(&p),
            "RF {rf} broadened"
        );
    }
    let mut wrong_trait = resolved.parameters.clone();
    wrong_trait.roof_system = "RF-GABLE".into();
    assert!(
        !crate::engine::single_native_entry_parameters(&wrong_trait),
        "B11 details must be conditional on its RF"
    );
    let mut unknown = resolved.parameters.clone();
    unknown.details.push("side_corridor".into());
    assert!(!crate::engine::single_native_entry_parameters(&unknown));
    let mut structural = resolved.clone();
    structural.plan.features.push(crate::layouts::feature(
        "declared-party-wall",
        FeatureKind::PartyWall,
        rectangle(0., 0., 0.3, 2.),
        0.,
        2.8,
        "MAT-BURNT-BRICK",
    ));
    assert!(
        matches!(
            prepare_foundation_and_entry(&structural).unwrap(),
            FoundationPreparation::Unsupported(_)
        ),
        "a real party feature must not become an ignored textual trait"
    );
}
