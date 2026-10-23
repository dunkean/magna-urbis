// Register as a child module of plans.rs. The fixture retains the eight raw
// requests used by native-foundation-detail-proof, not stale compact archives.
use super::*;

#[test]
fn final_native_entry_keeps_eight_admitted_programmes_and_certifies_only_successes() {
    let fixture: PlanBatchRequest = serde_json::from_str(include_str!(
        "../tests/fixtures/native-strip-entry-eight.json"
    )).unwrap();
    assert_eq!(fixture.requests.len(), 8);
    assert!(fixture.settings.is_none() && fixture.footprints.is_empty());
    let mut occupation = OccupationIndex::default();
    let mut upgraded = 0;
    let mut deferred = 0;
    for request in fixture.requests {
        let occupied = occupation.local(&request.cadastral);
        let initial = plan_one_initial(&request, &occupied, None, false).unwrap();
        let target = request.programme.as_ref().unwrap().built_area_m2.unwrap();
        // The same-version, pre-upgrade admission path remains authoritative.
        // No old archive is unpacked and no generator/version guard is bypassed.
        let previous = improve_domestic_budget(&request, &occupied, initial, target);
        let mut before = previous.resolved.unpack().unwrap();
        assert!(before.entrance.is_none(), "{} already had an entry", request.id);
        let building = retain_final_native_entry(&request, &occupied, previous.clone());
        let mut after = building.resolved.unpack().unwrap();
        assert_eq!(building.recipe_id, previous.recipe_id, "{} source", request.id);
        assert_eq!(building.variant_id, previous.variant_id, "{} variant", request.id);
        assert!((area(&building.footprint) - area(&previous.footprint)).abs() <= 0.0001,
            "{} changed footprint area", request.id);
        assert!((building.useful_area_m2 - previous.useful_area_m2).abs() <= 0.0001,
            "{} changed level area", request.id);

        let accepted = building.diagnostics.iter()
            .any(|d| d.starts_with("Native planning entrance upgrade:"));
        let postponed = building.diagnostics.iter()
            .any(|d| d.starts_with("Native planning entrance deferred:"));
        // These six real requests now have a correct wall-axis portal and
        // a native passage with its separation on the interior side; the
        // oblique 61ca frontage also retains its full-width cap. Keep
        // that measured improvement; an explicit deferral alone is not a pass.
        if ["67b7b66f83cf7f55", "8e8c98677955ef3d", "d561062d78bcb94c", "61ca50ea7c5550ac",
            "19d616127d82e927", "3c53fa43f11481d8"]
            .iter().any(|id| request.parcel_id.ends_with(id))
        {
            assert!(accepted, "{} lost its verified native entry: {:?}", request.id,
                building.diagnostics.iter().filter(|d| d.starts_with("Native planning entrance deferred:")).collect::<Vec<_>>());
        }
        if postponed {
            eprintln!("native-entry-diagnostic {}", entry_diagnostic(
                &request, &occupied, &previous, &before,
                building.diagnostics.iter().filter(|d|
                    d.starts_with("Native planning entrance deferred:")
                ).cloned().collect(),
            ));
        }
        assert_ne!(accepted, postponed, "{} needs one explicit entry outcome", request.id);
        assert_eq!(after.entrance.is_some(), accepted, "{} entry archive", request.id);
        if accepted {
            upgraded += 1;
            assert!(building.diagnostics.iter()
                .any(|d| d.starts_with("Native planning entrance:")));
            realize_plan(RealizePlanRequest { building: building.clone(), interiors: true })
                .unwrap_or_else(|error| panic!("{} accepted entry failed interior: {error}", request.id));
        } else {
            deferred += 1;
            let mut unchanged = building.clone();
            unchanged.diagnostics = previous.diagnostics.clone();
            assert_eq!(serde_json::to_vec(&unchanged).unwrap(), serde_json::to_vec(&previous).unwrap(),
                "{} must retain its admitted proxy on failure", request.id);
        }
        realize_plan(RealizePlanRequest { building: building.clone(), interiors: false })
            .unwrap_or_else(|error| panic!("{} exterior changed: {error}", request.id));

        // A successful retry may change its rigid world pose and entrance only.
        // All local source draws, bodies, levels, courts and paths stay exact.
        before.entrance = None;
        after.entrance = None;
        before.plan.diagnostics.clear();
        after.plan.diagnostics.clear();
        assert_eq!(serde_json::to_vec(&before).unwrap(), serde_json::to_vec(&after).unwrap(),
            "{} changed retained architecture", request.id);
        eprintln!("native entry witness {}: {}", request.id,
            if accepted { "upgraded; interior passed" } else { "deferred; admitted proxy retained" });

        let mut parts = vec![building.footprint, building.courtyards, building.circulation];
        parts.extend(building.structural_features.into_iter().map(|f| f.surface));
        occupation.insert(unite(&parts));
    }
    assert_eq!(upgraded + deferred, 8);
    assert!(upgraded >= 6, "the native portal and frontage corrections must retain their six demonstrated interiors");
    eprintln!("Native entry eight-witness outcome: {upgraded}/8 upgraded, {deferred}/8 deferred.");
}

/// Bounded trace of the same local portal and at most four production poses.
/// This is diagnostic evidence only: no passage is shortened or reinterpreted.
fn entry_diagnostic(
    request: &PlacementRequest,
    occupied: &Surface,
    previous: &PlanBuilding,
    resolved: &ResolvedArchitecture,
    deferred: Vec<String>,
) -> serde_json::Value {
    let prepared = PreparedPlan::with_native_entry(resolved);
    let physical = match prepared.foundation() {
        Ok(crate::engine::FoundationPreparation::Supported(value)) => value,
        Ok(crate::engine::FoundationPreparation::Unsupported(reason)) => {
            return serde_json::json!({"id":request.id,"unsupported":reason,"deferred":deferred});
        }
        Err(reason) => return serde_json::json!({"id":request.id,"error":reason,"deferred":deferred}),
    };
    let Some(entry) = &physical.entry else {
        return serde_json::json!({"id":request.id,"error":"No prepared native entry","deferred":deferred});
    };
    let neighbors = unite(&request.neighbors.iter().map(|n| n.footprint.clone())
        .chain(std::iter::once(occupied.clone())).collect::<Vec<_>>());
    let walk = difference(&difference(&request.cadastral, &request.reserves), &neighbors);
    let domain = difference(&difference(&request.buildable, &request.reserves), &neighbors);
    let mut poses = vec![(previous.transform.clone(), None)];
    poses.extend(frontage_poses_prepared(request, &prepared, &domain).into_iter()
        .filter(|(pose, _)| pose.origin != previous.transform.origin
            || pose.orientation_deg != previous.transform.orientation_deg)
        .take(3).map(|(pose, front)| (pose, Some(front))));
    let pose_results: Vec<_> = poses.into_iter().map(|(pose, front)| {
        let passage = map_surface(&entry.site_entry.passage, &pose);
        let solids = map_surface(&entry.site_solids, &pose);
        let result = visual_with_front_access_prepared(
            request, &prepared, pose.clone(), &neighbors, true, false, front, true,
        );
        serde_json::json!({
            "pose":pose,
            "passageOutsideWalkM2":area(&difference(&passage, &walk)),
            "passageSolidOverlapM2":area(&intersection(&passage, &solids)),
            "result":result.map(|_| "accepted".to_string()),
        })
    }).collect();
    serde_json::json!({
        "id":request.id,
        "recipe":resolved.recipe_id,
        "bodyCount":resolved.plan.bodies.len(),
        "bodyBoundsLocal":bounds(&body_domain(resolved)),
        "lotBoundsLocal":bounds(&resolved.plan.lot),
        "bodyOpening":entry.body_entry.opening,
        "siteOpening":entry.site_entry.opening,
        "siteWidthM":entry.site_entry.width_m,
        "bodyPassageBoundsLocal":bounds(&entry.body_entry.passage),
        "sitePassageBoundsLocal":bounds(&entry.site_entry.passage),
        "sitePassageAreaM2":area(&entry.site_entry.passage),
        "sitePassageOutsideLocalLotM2":area(&difference(&entry.site_entry.passage, &resolved.plan.lot)),
        "poseCount":pose_results.len(),
        "poses":pose_results,
        "deferred":deferred,
    })
}
