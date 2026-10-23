//! Isolated diagnostic, registered only as a child of plans under cfg(test).
//! The eight raw requests are rebuilt in the current version. A translated
//! result never changes the baseline neighbour context of the next witness.
use super::*;
use crate::rigid_translation_fit::{TranslationOutcome, TranslationProblem, solve};

#[test]
fn eight_retained_native_plans_probe_one_exact_convex_translation() {
    let fixture: PlanBatchRequest = serde_json::from_str(include_str!(
        "../tests/fixtures/native-strip-entry-eight.json"
    ))
    .unwrap();
    assert_eq!(fixture.requests.len(), 8);
    assert!(fixture.settings.is_none() && fixture.footprints.is_empty());
    let mut occupation = OccupationIndex::default();
    let mut counts = [0_usize; 5]; // preparation unavailable, unsupported, empty, rejected, admitted
    let mut detail_failures = vec![];
    for request in fixture.requests {
        let occupied = occupation.local(&request.cadastral);
        let initial = plan_one_initial(&request, &occupied, None, false).unwrap();
        let target = request.programme.as_ref().unwrap().built_area_m2.unwrap();
        let previous = improve_domestic_budget(&request, &occupied, initial, target);
        let resolved = previous.resolved.unpack().unwrap();
        let prepared = PreparedPlan::with_native_entry(&resolved);
        let mut report = serde_json::json!({
            "id":request.id,
            "recipe":previous.recipe_id,
            "variant":previous.variant_id,
            "baselinePose":previous.transform,
            "baselineAreaM2":area(&previous.footprint),
            "targetM2":target,
            "baselineContext":"same-version initial+budget, without final-entry upgrade",
            "candidateCount":0,
        });
        match prepared.foundation() {
            Err(reason) => {
                counts[0] += 1;
                report["preparationError"] = reason.into();
            }
            Ok(crate::engine::FoundationPreparation::Unsupported(reason)) => {
                counts[0] += 1;
                report["preparationUnsupported"] = reason.clone().into();
            }
            Ok(crate::engine::FoundationPreparation::Supported(physical)) => {
                let entry = physical
                    .entry
                    .as_ref()
                    .expect("Opt-in native entry missing");
                let neighbors = unite(
                    &request
                        .neighbors
                        .iter()
                        .map(|n| n.footprint.clone())
                        .chain(std::iter::once(occupied.clone()))
                        .collect::<Vec<_>>(),
                );
                let buildable = difference(
                    &difference(&request.buildable, &request.reserves),
                    &neighbors,
                );
                let architectural_rights = difference(
                    &difference(&request.cadastral, &request.reserves),
                    &neighbors,
                );
                // Identical roof rights to visual: neighbour footprints are
                // excluded from land occupation, not invented as roof rights.
                let roof_rights = difference(
                    request.roof_domain.as_ref().unwrap_or(&request.cadastral),
                    &request.reserves,
                );
                let body = map_surface(&prepared.body_local, &previous.transform);
                let mut occupation_parts =
                    vec![map_surface(&prepared.plan_local, &previous.transform)];
                occupation_parts.extend(
                    physical
                        .occupation_parts
                        .iter()
                        .map(|s| map_surface(s, &previous.transform)),
                );
                let native_occupation = unite(&occupation_parts);
                let mut roof_parts: Vec<_> = prepared
                    .roofs()
                    .iter()
                    .map(|s| map_surface(s, &previous.transform))
                    .collect();
                roof_parts.extend(
                    resolved
                        .plan
                        .features
                        .iter()
                        .filter_map(|f| f.roof.as_ref())
                        .map(|roof| map_surface(&roof.domain, &previous.transform)),
                );
                let roof = unite(&roof_parts);
                report["nativePassageOutsideRightsM2"] = area(&difference(
                    &map_surface(&entry.site_entry.passage, &previous.transform),
                    &architectural_rights,
                ))
                .into();
                report["rightsPolygonCounts"] = serde_json::json!([
                    buildable.len(),
                    architectural_rights.len(),
                    roof_rights.len(),
                ]);
                let outcome = solve(&TranslationProblem {
                    body: &body,
                    buildable: &buildable,
                    occupation: &native_occupation,
                    architectural_rights: &architectural_rights,
                    roof: &roof,
                    roof_rights: &roof_rights,
                });
                match outcome {
                    TranslationOutcome::Unsupported(reason) => {
                        counts[1] += 1;
                        report["translationUnsupported"] = reason.into();
                    }
                    TranslationOutcome::EmptyFixedDomains => {
                        counts[2] += 1;
                        report["translation"] = "empty_fixed_domains".into();
                    }
                    TranslationOutcome::Fit(fit) => {
                        let mut pose = previous.transform.clone();
                        pose.origin.x += fit.delta.x;
                        pose.origin.y += fit.delta.y;
                        report["candidateCount"] = 1.into();
                        report["delta"] = serde_json::json!(fit.delta);
                        report["distanceM"] = fit.distance_m.into();
                        report["constraints"] = fit.constraints.into();
                        report["translatedPose"] = serde_json::json!(pose);
                        report["zeroTranslation"] = (fit.delta.x == 0. && fit.delta.y == 0.).into();
                        match visual_with_front_access_prepared(
                            &request, &prepared, pose, &neighbors, true, false, None, true,
                        ) {
                            Err(reason) => {
                                counts[3] += 1;
                                report["visualRefusal"] = reason.into();
                            }
                            Ok(building) => {
                                counts[4] += 1;
                                report["visual"] = "accepted".into();
                                assert_eq!(building.recipe_id, previous.recipe_id);
                                assert_eq!(building.variant_id, previous.variant_id);
                                assert_eq!(
                                    building.transform.orientation_deg,
                                    previous.transform.orientation_deg
                                );
                                assert!(
                                    (area(&building.footprint) - area(&previous.footprint)).abs()
                                        < 0.0001,
                                    "{} changed footprint area",
                                    request.id
                                );
                                assert!(
                                    (building.useful_area_m2 - previous.useful_area_m2).abs()
                                        < 0.0001,
                                    "{} changed useful area",
                                    request.id
                                );
                                let mut retained = building.resolved.unpack().unwrap();
                                assert!(retained.entrance.is_some());
                                retained.entrance = resolved.entrance.clone();
                                assert_eq!(
                                    serde_json::to_vec(&retained).unwrap(),
                                    serde_json::to_vec(&resolved).unwrap(),
                                    "{} changed source draws or local architecture",
                                    request.id
                                );
                                for interiors in [false, true] {
                                    let key = if interiors {
                                        "nativeInterior"
                                    } else {
                                        "nativeExterior"
                                    };
                                    match realize_plan(RealizePlanRequest {
                                        building: building.clone(),
                                        interiors,
                                    }) {
                                        Ok(_) => report[key] = "accepted".into(),
                                        Err(error) => {
                                            detail_failures
                                                .push(format!("{} {key}: {error}", request.id));
                                            report[key] = serde_json::json!({"refusal":error});
                                        }
                                    }
                                }
                            }
                        }
                    }
                }
            }
        }
        eprintln!("native-translation-probe {report}");
        // Keep neighbours identical to the baseline admission sequence. This
        // diagnostic is not a new batch planner or a sequential city replay.
        let mut parts = vec![
            previous.footprint,
            previous.courtyards,
            previous.circulation,
        ];
        parts.extend(previous.structural_features.into_iter().map(|f| f.surface));
        occupation.insert(unite(&parts));
    }
    assert_eq!(counts.iter().sum::<usize>(), 8);
    eprintln!(
        "native-translation-probe-summary {}",
        serde_json::json!({
            "witnesses":8,
            "preparationUnavailable":counts[0],
            "unsupported":counts[1],
            "emptyFixedDomains":counts[2],
            "visualRefused":counts[3],
            "visualAdmitted":counts[4],
            "detailFailures":detail_failures,
            "productionActivated":false,
        })
    );
    assert!(
        detail_failures.is_empty(),
        "Native detail failures: {detail_failures:?}"
    );
}
