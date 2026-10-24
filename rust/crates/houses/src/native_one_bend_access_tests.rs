use super::*;
use super::native_one_bend_access::{OneBendContext, one_bend_on_support_line};
use crate::access::StructuralEntrance;

fn elbow_body() -> Surface {
    union(&rectangle(0., 0., 6., 8.), &rectangle(3., 8., 3., 2.))
}

fn elbow_entry() -> StructuralEntrance {
    StructuralEntrance {
        opening: [point(0.775, 8.), point(1.625, 8.)],
        passage: rectangle(0.775, 7.6, 0.85, 0.6),
        width_m: 0.85, from_z_m: 0., to_z_m: 0.,
    }
}

#[test]
fn one_bend_has_full_miter_width_and_actual_terminal_caps() {
    let body = elbow_body();
    let native = elbow_entry();
    let street = [point(10., 0.), point(10., 16.)];
    let route = one_bend_on_support_line(native.opening, &body, &vec![], street, 0.8).unwrap();
    assert!((route.bend.y - 10.4).abs() < 1e-12);
    assert!((route.contact.y - route.bend.y).abs() < 1e-12);
    for (i, joint) in route.joint.iter().enumerate() {
        for axis in [route.first, route.second] {
            let signed = (joint.x - route.bend.x) * (-axis[1])
                + (joint.y - route.bend.y) * axis[0];
            assert!((signed - if i == 0 { 0.4 } else { -0.4 }).abs() < 1e-12);
        }
    }
    for (cap, segment) in [(route.door_cap, native.opening), (route.street_cap, street)] {
        for p in cap {
            let q = nearest(p, segment[0], segment[1]);
            assert!(libm::hypot(p.x - q.x, p.y - q.y) < 1e-12);
        }
        assert!((libm::hypot(cap[1].x - cap[0].x, cap[1].y - cap[0].y) - 0.8).abs() < 1e-12);
    }
    assert!(area(&difference(&intersection(&route.path, &body), &native.passage)) < 0.002);
    assert!(area(&intersection(&route.path, &native.passage)) > 0.005);
    assert!(one_bend_on_support_line(native.opening, &body, &vec![],
        [point(0., 12.), point(12., 12.)], 0.8).is_err(), "Parallel door/street axes have no support-line bend");
    assert!(one_bend_on_support_line(native.opening, &body, &vec![],
        [point(10., 10.2), point(10., 10.6)], 0.8).is_err(), "Never extend a short street cap");
    assert!(one_bend_on_support_line(native.opening, &rectangle(0., 0., 6., 8.),
        &vec![], street, 0.8).is_err(), "Never clip a miter that consumes its door cap");
}

#[test]
fn one_bend_is_last_and_keeps_rights_solids_passage_and_entry_identity_guards() {
    let mut fixture: PlanBatchRequest = serde_json::from_str(include_str!(
        "../tests/fixtures/native-strip-entry-eight.json"
    )).unwrap();
    let mut request = fixture.requests.remove(0);
    request.cadastral = rectangle(-1., -1., 13., 18.);
    request.reserves.clear();
    request.accesses = vec![ArchitectureAccess {
        id: "side-street".into(), kind: "public".into(), width_m: 2.,
        segment: [point(10., 0.), point(10., 16.)],
    }];
    let transform = Transform { origin: point(0., 0.), orientation_deg: 0. };
    let body = elbow_body();
    let native = elbow_entry();
    let empty = vec![];
    let context = || Some(OneBendContext { body_entry: &native, body_local: &body });
    assert!(proposed_native_access_with_entry(&request, &native, &empty,
        &transform, &body, &empty, None).is_err(), "Every straight/analytic connector crosses the wing");
    let accepted = proposed_native_access_with_entry(&request, &native, &empty,
        &transform, &body, &empty, context()).unwrap();
    assert_eq!(accepted.1, "side-street");
    assert!(contains(&accepted.2, &native.passage), "The complete native passage is retained");

    let obstacle = rectangle(7., 10., 1., 1.);
    request.reserves = obstacle.clone();
    assert!(proposed_native_access_with_entry(&request, &native, &empty,
        &transform, &body, &empty, context()).is_err());
    request.reserves.clear();
    assert!(proposed_native_access_with_entry(&request, &native, &empty,
        &transform, &body, &obstacle, context()).is_err(), "Occupied neighbour still blocks the turn");
    let post = rectangle(0.9, 8.8, 0.6, 0.6);
    assert!(proposed_native_access_with_entry(&request, &native, &post,
        &transform, &body, &empty, context()).is_err(), "An uncut post cannot be traversed");
    let blocked_body = union(&body, &post);
    assert!(proposed_native_access_with_entry(&request, &native, &empty,
        &transform, &blocked_body, &empty,
        Some(OneBendContext { body_entry: &native, body_local: &blocked_body })).is_err(),
        "The turn cannot penetrate another body beyond the native passage");
    let mut different_body_entry = native.clone();
    different_body_entry.opening[0].x += 0.01;
    assert!(proposed_native_access_with_entry(&request, &native, &empty,
        &transform, &body, &empty,
        Some(OneBendContext { body_entry: &different_body_entry, body_local: &body })).is_err());
    let mut different_level = native.clone();
    different_level.to_z_m = 0.0005;
    assert!(proposed_native_access_with_entry(&request, &different_level, &empty,
        &transform, &body, &empty,
        Some(OneBendContext { body_entry: &different_level, body_local: &body })).is_err(),
        "The new turn does not introduce even a small level transition");
    request.accesses.push(ArchitectureAccess {
        id: "direct-street".into(), kind: "public".into(), width_m: 2.,
        segment: [point(-1., 12.), point(2., 12.)],
    });
    let straight = proposed_native_access_with_entry(&request, &native, &empty,
        &transform, &body, &empty, None).unwrap();
    assert_eq!(straight, proposed_native_access_with_entry(&request, &native, &empty,
        &transform, &body, &empty, context()).unwrap(), "Keep any existing straight success exactly");
}

#[test]
fn one_bend_upgrades_real_11976_at_identical_pose_and_replays_both_details() {
    let fixture: PlanBatchRequest = serde_json::from_str(include_str!(
        "../tests/fixtures/native-strip-entry-eight.json"
    )).unwrap();
    let mut occupation = OccupationIndex::default();
    let mut found = false;
    for request in fixture.requests {
        let occupied = occupation.local(&request.cadastral);
        let initial = plan_one_initial(&request, &occupied, None, false).unwrap();
        let target = request.programme.as_ref().unwrap().built_area_m2.unwrap();
        let previous = improve_domestic_budget(&request, &occupied, initial, target);
        if request.parcel_id.ends_with("53c6fbc1ac486b3b") {
            found = true;
            let original = previous.resolved.unpack().unwrap();
            let original_bytes = serde_json::to_vec(&original).unwrap();
            assert!(original.entrance.is_none());
            let prepared = PreparedPlan::with_native_entry(&original);
            let physical = match prepared.foundation().unwrap() {
                crate::engine::FoundationPreparation::Supported(value) => value,
                crate::engine::FoundationPreparation::Unsupported(reason) => panic!("{reason}"),
            };
            let native = physical.entry.as_ref().unwrap();
            assert!(OneBendContext { body_entry: &native.body_entry,
                body_local: &prepared.body_local }.matches_site(&native.site_entry));
            let legacy_prepared = PreparedPlan::new(&original);
            let legacy = match legacy_prepared.foundation().unwrap() {
                crate::engine::FoundationPreparation::Supported(value) => value,
                crate::engine::FoundationPreparation::Unsupported(reason) => panic!("{reason}"),
            };
            assert_eq!(physical.bearing_parts, legacy.bearing_parts);
            assert_eq!(physical.native_features, legacy.native_features);
            let neighbors = unite(&request.neighbors.iter().map(|n| n.footprint.clone())
                .chain(std::iter::once(occupied.clone())).collect::<Vec<_>>());
            assert!(proposed_native_access_with_entry(&request, &native.site_entry,
                &native.site_solids, &previous.transform, &previous.footprint,
                &neighbors, None).is_err(), "The old straight path remains a real refusal");
            let building = retain_final_native_entry(&request, &occupied, previous.clone());
            assert!(building.diagnostics.iter().any(|d| d.starts_with("Native planning entrance upgrade:")));
            assert_eq!(building.transform.origin, previous.transform.origin);
            assert_eq!(building.transform.orientation_deg, previous.transform.orientation_deg);
            assert_eq!(building.recipe_id, previous.recipe_id);
            assert_eq!(building.variant_id, previous.variant_id);
            assert_eq!(building.footprint, previous.footprint);
            assert_eq!(building.roof_footprint, previous.roof_footprint);
            assert_eq!(building.ground_z_m, previous.ground_z_m);
            assert_eq!(building.useful_area_m2, previous.useful_area_m2);
            assert_eq!(serde_json::to_vec(&building.structural_features).unwrap(),
                serde_json::to_vec(&previous.structural_features).unwrap());
            let mut retained = building.resolved.unpack().unwrap();
            assert!(retained.entrance.is_some());
            retained.entrance = None;
            assert_eq!(serde_json::to_vec(&retained).unwrap(), original_bytes);
            let roundtrip: PlanBuilding = serde_json::from_slice(&serde_json::to_vec(&building).unwrap()).unwrap();
            for interiors in [false, true] {
                realize_plan(RealizePlanRequest { building: roundtrip.clone(), interiors })
                    .unwrap_or_else(|e| panic!("11976 interiors={interiors}: {e}"));
            }
            assert_eq!(serde_json::to_vec(&original).unwrap(), original_bytes);
            break;
        }
        // Keep exactly the pre-upgrade neighbourhood from the causal probe.
        let mut parts = vec![previous.footprint, previous.courtyards, previous.circulation];
        parts.extend(previous.structural_features.into_iter().map(|f| f.surface));
        occupation.insert(unite(&parts));
    }
    assert!(found);
}


#[test]
fn internal_roof_support_real_cap_avoids_measured_b14_failure_without_new_attempts(){
    // Explicit synthetic coordinate frame matching the fixed automatic B14
    // geometry; full pipeline positive remains unchanged in parent_batch tests.
    let body=rectangle(0.,0.,15.,22.);
    let opening=[point(0.5720000000000001,22.),point(1.422,22.)];
    let roof=rectangle(15.35099998903275,-0.35100001096725,15.7020000219345,22.7020000219345);
    let cap=[point(16.29900002384187,166.49999994182588),point(16.29900002384187,22.199999989509593)];
    assert!(one_bend_on_support_line(opening,&body,&vec![],cap,0.8).is_err(),"old own-body support cannot reach the actual cap interior");
    let route=super::native_one_bend_access::one_bend_on_support_line_with_support(opening,&body,&vec![],Some(&roof),cap,0.8).unwrap();
    assert!(route.bend.y>22.7&&route.bend.y<22.8);
    assert!(area(&intersection(&route.path,&roof))<0.0001);
    let passage=rectangle(0.572,21.653,0.85,0.547);
    assert!(area(&difference(&intersection(&route.path,&body),&passage))<0.002);
    assert!(area(&intersection(&route.path,&passage))>0.005);
    let too_short=[point(cap[0].x,22.2),point(cap[0].x,22.7)];
    assert!(super::native_one_bend_access::one_bend_on_support_line_with_support(opening,&body,&vec![],Some(&roof),too_short,0.8).is_err(),"never extend the actual cap");
}

#[test]
fn internal_roof_support_lower_pose_remains_refused(){
    let mut r:PlanBatchRequest=serde_json::from_str(include_str!("../tests/fixtures/native-strip-entry-eight.json")).unwrap();
    let mut r=r.requests.remove(0);r.cadastral=rectangle(-2.,-2.,80.,220.);r.reserves.clear();
    let body=rectangle(0.,0.,15.,22.);let roof=rectangle(-0.351,22.351,15.702,22.702);
    let native=StructuralEntrance{opening:[point(0.572,22.),point(1.422,22.)],passage:rectangle(0.572,21.653,0.85,0.547),width_m:0.85,from_z_m:0.,to_z_m:0.};
    let caps=[NativeConnectionTarget{id:"actual-lower-pose-cap".into(),segment:[point(1.397,44.902),point(1.397,189.202)],width_m:0.8}];
    let t=Transform{origin:point(0.,0.),orientation_deg:0.};let empty=vec![];
    let result=proposed_native_access_to_targets(&r,&native,&empty,&t,&body,&roof,
        Some(OneBendContext{body_entry:&native,body_local:&body}),&caps,Some(&roof));
    assert!(result.is_err(),"support guidance must not turn the blocked lower pose into an admitted connection");
}
