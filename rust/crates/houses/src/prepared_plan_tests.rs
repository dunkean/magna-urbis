use super::*;

#[test]
fn prepared_rigid_poses_preserve_full_output_and_do_not_prepare_failed_roofs() {
    #[derive(Deserialize)]
    struct Fixture {
        request: PlacementRequest,
    }
    let fixture: Fixture =
        serde_json::from_str(include_str!("../tests/fixtures/frontage-deep-bastide.json")).unwrap();
    // The frozen request remains authoritative; its old opaque archive may
    // belong to an earlier catalogue version and must not bypass that guard.
    let center = plan_one_initial(&fixture.request, &vec![], None, false).unwrap();
    let resolved = center.resolved.unpack().unwrap();
    let original = serde_json::to_vec(&resolved).unwrap();
    let prepared = PreparedPlan::new(&resolved);
    assert_eq!(prepared.body_local, body_domain(&resolved));
    assert_eq!(prepared.plan_local, plan_domain(&resolved));

    let mut outside = center.transform.clone();
    outside.origin.x += 1_000_000.;
    assert!(visual_prepared(&fixture.request, &prepared, outside, &vec![], true, false).is_err());
    assert!(prepared.roof_parts.get().is_none());
    assert!(prepared.local_ridges.get().is_none());
    assert!(prepared.level_areas.get().is_none());
    assert!(prepared.packed.get().is_none());

    let fresh = visual(
        &fixture.request,
        &resolved,
        center.transform.clone(),
        &vec![],
        true,
        false,
    )
    .unwrap();
    let cached = visual_prepared(
        &fixture.request,
        &prepared,
        center.transform,
        &vec![],
        true,
        false,
    )
    .unwrap();
    assert_eq!(
        serde_json::to_vec(&fresh).unwrap(),
        serde_json::to_vec(&cached).unwrap()
    );
    let roofs = prepared.roofs().as_ptr();
    let domain = difference(&fixture.request.buildable, &fixture.request.reserves);
    for (transform, access) in frontage_poses_prepared(&fixture.request, &prepared, &domain)
        .into_iter()
        .take(3)
    {
        let fresh = visual_with_front(
            &fixture.request,
            &resolved,
            transform.clone(),
            &vec![],
            true,
            false,
            Some(access),
        );
        let cached = visual_with_front_access_prepared(
            &fixture.request,
            &prepared,
            transform,
            &vec![],
            true,
            false,
            Some(access),
            false,
        );
        assert_eq!(
            serde_json::to_vec(&fresh).unwrap(),
            serde_json::to_vec(&cached).unwrap()
        );
        assert_eq!(prepared.roofs().as_ptr(), roofs);
    }
    assert_eq!(original, serde_json::to_vec(&resolved).unwrap());
}
