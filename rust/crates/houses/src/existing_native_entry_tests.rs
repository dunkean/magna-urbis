//! Production integration: an existing wing door is the last fallback, while
//! a successful canonical door keeps its original result and priority.
use super::*;
use crate::access::plan_entry::{MAX_EXISTING_ENTRY_ALTERNATIVES, same_entrance};
use crate::engine::{FoundationPreparation, prepare_foundation_and_entry};
use std::sync::Arc;

#[test]
fn existing_native_door_is_last_fallback_and_replays_without_replacing_architecture() {
    let fixture: PlanBatchRequest = serde_json::from_str(include_str!(
        "../tests/fixtures/native-strip-entry-eight.json"
    ))
    .unwrap();
    let mut occupation = OccupationIndex::default();
    let mut alternative_checked = false;
    let mut canonical_checked = false;
    for request in fixture.requests {
        let occupied = occupation.local(&request.cadastral);
        let initial = plan_one_initial(&request, &occupied, None, false).unwrap();
        let target = request.programme.as_ref().unwrap().built_area_m2.unwrap();
        let previous = improve_domestic_budget(&request, &occupied, initial, target);
        let is_wing_witness = request.parcel_id.ends_with("e099cf700f812cc3");
        let is_canonical_witness = request.parcel_id.ends_with("53c6fbc1ac486b3b");
        if is_wing_witness || is_canonical_witness {
            let resolved = previous.resolved.unpack().unwrap();
            let source = serde_json::to_vec(&resolved).unwrap();
            let prepared = PreparedPlan::with_native_entry(&resolved);
            let physical = match prepared.foundation().unwrap() {
                FoundationPreparation::Supported(value) => value,
                FoundationPreparation::Unsupported(reason) => panic!("{reason}"),
            };
            let entry = physical.entry.as_ref().unwrap();
            assert!(!entry.alternatives.is_empty());
            assert!(entry.alternatives.len() <= MAX_EXISTING_ENTRY_ALTERNATIVES);
            assert!(
                entry
                    .alternatives
                    .windows(2)
                    .all(|w| w[0].portal_id <= w[1].portal_id)
            );
            let neighbors = unite(
                &request
                    .neighbors
                    .iter()
                    .map(|n| n.footprint.clone())
                    .chain(std::iter::once(occupied.clone()))
                    .collect::<Vec<_>>(),
            );
            let canonical = visual_with_front_access_prepared(
                &request,
                &prepared,
                previous.transform.clone(),
                &neighbors,
                true,
                false,
                None,
                true,
            );
            let upgraded = retain_final_native_entry(&request, &occupied, previous.clone());
            let retained = upgraded.resolved.unpack().unwrap();
            let retained_entry = retained
                .entrance
                .as_ref()
                .expect("native entry must be admitted");
            if is_canonical_witness {
                canonical_checked = true;
                assert!(entry.retained_passages.is_empty());
                let expected = finish_native_entry_upgrade(&previous, canonical.unwrap(),
                    "Native planning entrance upgrade: admitted final source, dimensions, floors and programme retained; 1/4 rigid poses checked. No new source selection or dimension search.".into());
                assert!(same_entrance(retained_entry, &entry.body_entry));
                assert_eq!(
                    serde_json::to_vec(&upgraded).unwrap(),
                    serde_json::to_vec(&expected).unwrap(),
                    "the canonical success must return before inspecting any alternative"
                );
            } else {
                alternative_checked = true;
                assert!(canonical.is_err());
                let index = entry
                    .alternatives
                    .iter()
                    .position(|pair| same_entrance(retained_entry, &pair.body_entry))
                    .expect("retain a door from the one native graph");
                assert!(!same_entrance(retained_entry, &entry.body_entry));
                let selected = prepared.with_existing_entry(index).unwrap();
                let selected_physical = match selected.foundation().unwrap() {
                    FoundationPreparation::Supported(value) => value,
                    FoundationPreparation::Unsupported(_) => unreachable!(),
                };
                assert!(Arc::ptr_eq(
                    &entry.site_solids,
                    &selected_physical.entry.as_ref().unwrap().site_solids
                ));
                assert_eq!(physical.bearing_parts, selected_physical.bearing_parts);
                assert_eq!(physical.native_features, selected_physical.native_features);
                assert!(
                    selected_physical
                        .occupation_parts
                        .starts_with(&physical.occupation_parts),
                    "no canonical passage/court/support right may disappear on an alternative"
                );
                assert!(
                    selected_physical
                        .occupation_parts
                        .contains(&retained_entry.passage)
                );
                let selected_entry = selected_physical.entry.as_ref().unwrap();
                assert_eq!(
                    selected_entry.retained_passages,
                    vec![entry.body_entry.passage.clone()]
                );
                // Reconstruct the pre-fix export using the exact admitted
                // connector: it included only the chosen door. The original
                // rear passage genuinely disappeared outside the bodies.
                let (_, _, chosen_path, _) = proposed_native_access_with_entry(
                    &request,
                    &selected_entry.site_entry,
                    &selected_entry.site_solids,
                    &previous.transform,
                    &previous.footprint,
                    &neighbors,
                    Some(native_one_bend_access::OneBendContext {
                        body_entry: &selected_entry.body_entry,
                        body_local: &selected.body_local,
                    }),
                )
                .unwrap();
                let old_circulation = union(
                    &map_surface(&resolved.plan.paths, &previous.transform),
                    &chosen_path,
                );
                let mut old_parts = vec![
                    upgraded.footprint.clone(),
                    upgraded.courtyards.clone(),
                    old_circulation,
                ];
                old_parts.extend(
                    upgraded
                        .structural_features
                        .iter()
                        .map(|f| f.surface.clone()),
                );
                let canonical_passage = map_surface(&entry.body_entry.passage, &previous.transform);
                let missing_before = area(&difference(&canonical_passage, &unite(&old_parts)));
                assert!(
                    missing_before > 0.01,
                    "11111 must exhibit the real omitted passage, got {missing_before}m²"
                );
                let mut exported_parts = vec![
                    upgraded.footprint.clone(),
                    upgraded.courtyards.clone(),
                    upgraded.circulation.clone(),
                ];
                exported_parts.extend(
                    upgraded
                        .structural_features
                        .iter()
                        .map(|f| f.surface.clone()),
                );
                let mut exported_occupation = OccupationIndex::default();
                exported_occupation.insert(unite(&exported_parts));
                let indexed = exported_occupation.local(&request.cadastral);
                for part in &selected_physical.occupation_parts {
                    assert!(
                        area(&difference(
                            &map_surface(part, &previous.transform),
                            &indexed
                        )) <= 0.0001,
                        "exported occupation must preserve every admitted native domain"
                    );
                }
                eprintln!(
                    "existing native entry11111: omitted canonical passage before correction={missing_before:.9}m²; complete native occupation retained in output/index"
                );
                assert!(
                    upgraded
                        .diagnostics
                        .iter()
                        .any(|d| d.starts_with("Native planning entrance upgrade:")
                            && d.contains("then existing portal"))
                );

                let replayed = match prepare_foundation_and_entry(&retained).unwrap() {
                    FoundationPreparation::Supported(value) => value,
                    FoundationPreparation::Unsupported(reason) => panic!("{reason}"),
                };
                assert!(
                    same_entrance(&replayed.entry.as_ref().unwrap().body_entry, retained_entry),
                    "preparation must not relabel an archived alternative as max-y"
                );
                assert_eq!(
                    replayed.occupation_parts,
                    selected_physical.occupation_parts
                );
                assert_eq!(
                    replayed.entry.as_ref().unwrap().retained_passages,
                    selected_entry.retained_passages
                );
                let mut unknown = retained.clone();
                unknown.entrance.as_mut().unwrap().opening[0].x += 0.01;
                let rejection = prepare_foundation_and_entry(&unknown)
                    .err()
                    .expect("unknown entrance must fail");
                assert!(
                    rejection.contains("differs from every prepared existing portal"),
                    "{rejection}"
                );
            }
            assert_eq!(upgraded.id, previous.id);
            assert_eq!(upgraded.transform.origin, previous.transform.origin);
            assert_eq!(
                upgraded.transform.orientation_deg,
                previous.transform.orientation_deg
            );
            assert_eq!(upgraded.footprint, previous.footprint);
            assert_eq!(upgraded.roof_footprint, previous.roof_footprint);
            assert_eq!(upgraded.ground_z_m, previous.ground_z_m);
            assert_eq!(upgraded.useful_area_m2, previous.useful_area_m2);
            assert_eq!(upgraded.structural_features, previous.structural_features);
            assert_eq!(
                serde_json::to_vec(&upgraded.volumes).unwrap(),
                serde_json::to_vec(&previous.volumes).unwrap()
            );
            let mut unchanged = retained;
            unchanged.entrance = resolved.entrance.clone();
            assert_eq!(serde_json::to_vec(&unchanged).unwrap(), source);
            for interiors in [false, true] {
                realize_plan(RealizePlanRequest {
                    building: upgraded.clone(),
                    interiors,
                })
                .unwrap_or_else(|reason| panic!("{} interiors={interiors}: {reason}", request.id));
            }
        }
        // Freeze the same original neighbouring admissions for both controls.
        let mut parts = vec![
            previous.footprint,
            previous.courtyards,
            previous.circulation,
        ];
        parts.extend(
            previous
                .structural_features
                .into_iter()
                .map(|feature| feature.surface),
        );
        occupation.insert(unite(&parts));
    }
    assert!(alternative_checked && canonical_checked);
}
