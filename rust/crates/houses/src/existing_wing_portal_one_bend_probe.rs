//! Diagnostic cfg(test) child of plans.rs; no production alternative selection.
//! One existing non-selected root portal, same source and world pose, consumed
//! by the shared one-bend connector through the complete production visual path.
use super::*;
use crate::access::{StructuralEntrance, structural_access, structural_site_entry};
use crate::access::plan_entry::PreparedPlanEntry;
use crate::engine::{FoundationPreparation, PreparedFoundationDomains};
use crate::wall_geometry::wall_section;

#[test]
fn existing_wing_portal_and_one_bend_probe_11111_without_new_architecture() {
    let fixture: PlanBatchRequest = serde_json::from_str(include_str!(
        "../tests/fixtures/native-strip-entry-eight.json"
    )).unwrap();
    let mut occupation = OccupationIndex::default();
    let mut witnesses = 0;
    for request in fixture.requests {
        let occupied = occupation.local(&request.cadastral);
        let initial = plan_one_initial(&request, &occupied, None, false).unwrap();
        let target = request.programme.as_ref().unwrap().built_area_m2.unwrap();
        let previous = improve_domestic_budget(&request, &occupied, initial, target);
        if request.parcel_id.ends_with("e099cf700f812cc3") {
            witnesses += 1;
            let resolved = previous.resolved.unpack().unwrap();
            let source_before = serde_json::to_vec(&resolved).unwrap();
            let mut unit = crate::engine::structural_unit_for_entry_probe(&resolved).unwrap();
            let selected = structural_access(&mut unit, &resolved.plan.paths, &resolved.parameters).unwrap();
            assert!(unit.rooms.is_empty() && unit.roofs.vertices.is_empty() && unit.roofs.faces.is_empty());
            let alternatives: Vec<_> = unit.access.portals.iter().filter(|portal|
                (portal.from == unit.access.root || portal.to == unit.access.root)
                    && portal.opening != selected.opening).collect();
            assert_eq!(alternatives.len(), 1, "the fixed witness has exactly one already-cut alternative");
            let portal = alternatives[0];
            let body_entry = StructuralEntrance {
                opening: portal.opening, passage: portal.passage.clone(), width_m: portal.width_m,
                from_z_m: portal.from_z_m, to_z_m: portal.to_z_m,
            };
            let site_entry = structural_site_entry(&unit, &resolved.parameters, &body_entry).unwrap();
            assert_eq!(serde_json::to_vec(&body_entry).unwrap(), serde_json::to_vec(&site_entry).unwrap());
            let z = site_entry.from_z_m + 0.01;
            let mut solids: Vec<_> = unit.walls.iter().map(|wall| wall_section(wall, z)).collect();
            solids.extend(unit.features.iter().filter(|feature|
                matches!(feature.kind, FeatureKind::Post | FeatureKind::PartyWall)
                    && feature.z_m <= z && feature.z_m + feature.height_m > z)
                .map(|feature| feature.surface.clone()));
            let site_solids = unite(&solids);
            assert!(area(&intersection(&site_entry.passage, &site_solids)) <= 0.0001);
            let native_features = crate::placement::native_site_features(&unit);
            let body_domain = unite(&unit.bodies.iter().flat_map(|body|
                body.levels.iter().map(|level| level.footprint.clone())).collect::<Vec<_>>());
            let mut bearing_parts = vec![body_domain.clone()];
            bearing_parts.extend(native_features.iter().map(|feature| feature.surface.clone()));
            let legacy = PreparedPlan::new(&resolved);
            let legacy_physical = match legacy.foundation().unwrap() {
                FoundationPreparation::Supported(value) => value,
                FoundationPreparation::Unsupported(reason) => panic!("{reason}"),
            };
            assert_eq!(bearing_parts, legacy_physical.bearing_parts);
            assert_eq!(native_features, legacy_physical.native_features);
            let mut occupation_parts = vec![body_domain.clone(), resolved.plan.courts.clone(), resolved.plan.paths.clone()];
            occupation_parts.extend(native_features.iter().map(|feature| feature.surface.clone()));
            occupation_parts.push(site_entry.passage.clone());
            let physical = PreparedFoundationDomains {
                body_domain,
                occupation_domain: unite(&occupation_parts),
                bearing_domain: unite(&bearing_parts),
                occupation_parts, bearing_parts, native_features,
                entry: Some(PreparedPlanEntry { body_entry, site_entry, site_solids: site_solids.into(), alternatives: vec![], retained_passages: vec![] }),
            };
            let prepared = PreparedPlan::with_native_entry(&resolved);
            assert!(prepared.foundation.set(Ok(FoundationPreparation::Supported(physical))).is_ok());
            let physical = match prepared.foundation().unwrap() {
                FoundationPreparation::Supported(value) => value,
                FoundationPreparation::Unsupported(_) => unreachable!(),
            };
            let native = physical.entry.as_ref().unwrap();
            let neighbors = unite(&request.neighbors.iter().map(|neighbor| neighbor.footprint.clone())
                .chain(std::iter::once(occupied.clone())).collect::<Vec<_>>());
            // Causal control: merely choosing this already-existing portal is
            // insufficient. It needs the shared full-width turn, without any
            // extension/shortening of that native door or passage.
            assert!(proposed_native_access_with_entry(&request, &native.site_entry,
                &native.site_solids, &previous.transform, &previous.footprint, &neighbors, None).is_err());
            let mut report = serde_json::json!({
                "id":request.id,"pose":previous.transform,"portalId":portal.id,"wallId":portal.wall_id,
                "openingLocal":native.site_entry.opening,"passageBoundsLocal":bounds(&native.site_entry.passage),
                "alternativePortals":1,"rigidPoses":1,"overallNativeSuccess":false,
                "productionAlternativeSelectionActivated":false,
            });
            match visual_with_front_access_prepared(&request, &prepared,
                previous.transform.clone(), &neighbors, true, false, None, true)
            {
                Err(reason) => report["visualRefusal"] = reason.into(),
                Ok(candidate) => {
                    report["visual"] = "accepted by full native visual guards".into();
                    assert_eq!(candidate.id, previous.id);
                    assert_eq!(candidate.transform.origin, previous.transform.origin);
                    assert_eq!(candidate.transform.orientation_deg, previous.transform.orientation_deg);
                    assert_eq!(candidate.ground_z_m, previous.ground_z_m);
                    assert_eq!(candidate.footprint, previous.footprint);
                    assert_eq!(candidate.roof_footprint, previous.roof_footprint);
                    assert_eq!(serde_json::to_vec(&candidate.volumes).unwrap(), serde_json::to_vec(&previous.volumes).unwrap());
                    assert_eq!(candidate.structural_features, previous.structural_features);
                    let mut retained = candidate.resolved.unpack().unwrap();
                    assert_eq!(serde_json::to_vec(retained.entrance.as_ref().unwrap()).unwrap(),
                        serde_json::to_vec(&native.body_entry).unwrap());
                    retained.entrance = resolved.entrance.clone();
                    assert_eq!(serde_json::to_vec(&retained).unwrap(), source_before);
                    report["circulationAreaM2"] = area(&candidate.circulation).into();
                    report["accessId"] = candidate.access_id.clone().into();
                    let mut success = true;
                    for interiors in [false, true] {
                        let key = if interiors { "nativeInterior" } else { "nativeExterior" };
                        report[key] = match realize_plan(RealizePlanRequest {building:candidate.clone(), interiors}) {
                            Ok(_) => "accepted".into(),
                            Err(reason) => { success = false; serde_json::json!({"refusal":reason}) },
                        };
                    }
                    report["overallNativeSuccess"] = success.into();
                }
            }
            assert_eq!(source_before, serde_json::to_vec(&resolved).unwrap());
            eprintln!("native-existing-wing-one-bend-probe {report}");
        }
        // Keep the original admission context; alternative outcomes are never
        // inserted as neighbours of subsequent requests in this diagnostic.
        let mut parts = vec![previous.footprint, previous.courtyards, previous.circulation];
        parts.extend(previous.structural_features.into_iter().map(|feature| feature.surface));
        occupation.insert(unite(&parts));
    }
    assert_eq!(witnesses, 1);
}
