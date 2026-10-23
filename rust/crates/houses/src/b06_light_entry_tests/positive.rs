//! Child plans: use the LIGHT wrapper's own portal and the ordinary finalizer.
//! No detailed oracle chooses the entrance; enrichment only tests its replay.
use super::*;
use crate::engine::{FoundationPreparation,prepare_foundation_and_entry};

#[derive(Deserialize)]
struct Witness {
    label:String,
    request:PlacementRequest,
    occupied:Surface,
    after:PlanBuilding,
}

#[test]
fn b06_light_wrapper_retains_its_own_portal_at_the_actual_pose_and_replays_it() {
    let inputs=[include_str!("fixtures/moderate-deficit.json"),
        include_str!("fixtures/large-deficit.json"),include_str!("fixtures/target-met.json")];
    let mut upgraded_count=0;
    let mut replayed_count=0;
    for input in inputs {
        let Witness{label,request:r,occupied,after:previous}=serde_json::from_str(input).unwrap();
        let original=previous.resolved.unpack().unwrap();
        assert!(original.entrance.is_none());
        let original_bytes=serde_json::to_vec(&original).unwrap();
        let physical=match prepare_foundation_and_entry(&original).unwrap() {
            FoundationPreparation::Supported(value)=>value,
            FoundationPreparation::Unsupported(reason)=>panic!("{label}: {reason}"),
        };
        let prepared_entry=physical.entry.as_ref().unwrap();
        let light=crate::engine::single_entry_details_unit_for_probe(&original).unwrap();
        assert!(light.rooms.is_empty() && light.roofs.faces.is_empty() && light.roofs.vertices.is_empty());
        let finalized=retain_final_native_entry_result(&r,&occupied,previous.clone());
        assert_eq!(finalized.policy,FinalEntryPolicy::PreserveWinningGeometry);
        let building=finalized.building;
        let retained=building.resolved.unpack().unwrap();
        let upgraded=retained.entrance.is_some();
        let occupation_area=|b:&PlanBuilding| {
            let mut parts=vec![b.footprint.clone(),b.courtyards.clone(),b.circulation.clone()];
            parts.extend(b.structural_features.iter().map(|f|f.surface.clone()));
            area(&unite(&parts))
        };
        let mut report=serde_json::json!({"label":label,"id":r.id,"upgraded":upgraded,
            "prepared_body_entry":prepared_entry.body_entry,"prepared_site_entry":prepared_entry.site_entry,
            "native_features":physical.native_features,"bearing_parts":physical.bearing_parts,
            "occupation_parts":physical.occupation_parts,"diagnostics":building.diagnostics,
            "pose":building.transform,"selected_portals":1,"poses":1,
            "light_rooms":light.rooms.len(),"light_roof_faces":light.roofs.faces.len(),
            "before_structural_features":previous.structural_features.len(),
            "after_structural_features":building.structural_features.len(),
            "prepared_native_features":physical.native_features.len(),
            "before_plan_serialized_bytes":serde_json::to_vec(&previous).unwrap().len(),
            "after_plan_serialized_bytes":serde_json::to_vec(&building).unwrap().len(),
            "before_compact_archive_serialized_bytes":serde_json::to_vec(&previous.resolved).unwrap().len(),
            "after_compact_archive_serialized_bytes":serde_json::to_vec(&building.resolved).unwrap().len(),
            "light_unit_serialized_bytes":serde_json::to_vec(&light).unwrap().len(),
            "before_occupation_area_m2":occupation_area(&previous),
            "after_occupation_area_m2":occupation_area(&building),
            "byte_metric":"serde JSON transport bytes; not a heap-memory bound",
            "finalizer_cost_scope":"one light preparation for this finalizer call; existing nominal safeguard may invoke a second finalizer elsewhere; no intermediate-pose preparation"});
        assert_eq!(building.transform.origin,previous.transform.origin);
        assert_eq!(building.transform.orientation_deg,previous.transform.orientation_deg);
        assert_eq!(building.recipe_id,previous.recipe_id);
        assert_eq!(building.variant_id,previous.variant_id);
        assert_eq!(building.volumes.len(),previous.volumes.len());
        assert!((area(&building.footprint)-area(&previous.footprint)).abs()<0.0001);
        let mut without_entry=retained.clone();
        without_entry.entrance=None;
        assert_eq!(original_bytes,serde_json::to_vec(&without_entry).unwrap(),"source/seed/actual plan unchanged");
        if upgraded {
            upgraded_count+=1;
            assert!(crate::access::plan_entry::same_entrance(
                retained.entrance.as_ref().unwrap(),&prepared_entry.body_entry),
                "the archive must retain the light wrapper's OWN portal");
            let mut occupation=vec![building.footprint.clone(),building.courtyards.clone(),building.circulation.clone()];
            occupation.extend(building.structural_features.iter().map(|f|f.surface.clone()));
            let occupation=unite(&occupation);
            let neighbors=unite(&r.neighbors.iter().map(|n|n.footprint.clone())
                .chain(std::iter::once(occupied.clone())).collect::<Vec<_>>());
            let rights=difference(&difference(&r.cadastral,&r.reserves),&neighbors);
            for part in &physical.occupation_parts {
                let world=map_surface(part,&building.transform);
                assert!(contains(&rights,&world));
                assert!(area(&difference(&world,&occupation))<0.0001);
            }
            let bearing=unite(&physical.bearing_parts.iter()
                .map(|s|map_surface(s,&building.transform)).collect::<Vec<_>>());
            let (lo,hi,slope)=r.terrain.foundation_bounds(&bearing).unwrap();
            report["foundation_step_m"]=(hi-lo).into();
            report["foundation_slope_deg"]=slope.into();
            assert!(hi-lo<=r.terrain.max_foundation_step_m+1e-8);
            assert!(slope<=crate::placement::MAX_LEVEL_FOUNDATION_SLOPE_DEG);
            assert_eq!(building.ground_z_m,hi);
            let mut both=true;
            for interiors in [false,true] {
                let key=if interiors {"interior"}else{"exterior"};
                report[key]=match realize_plan(RealizePlanRequest{building:building.clone(),interiors}) {
                    Ok(batch)=> {
                        if interiors {
                            let detail=&batch.units[0];
                            report["replayed_detail_unit_serialized_bytes"]=serde_json::to_vec(detail).unwrap().len().into();
                            report["replayed_detail_features"]=detail.features.len().into();
                            // The full replay must preserve all grounded posts
                            // and frames prepared by the shared operators.
                            for f in &light.features {
                                let actual=detail.features.iter().find(|g|g.id==f.id).expect("native detail feature retained");
                                assert_eq!(serde_json::to_value(f).unwrap(),serde_json::to_value(actual).unwrap());
                            }
                            report["replayed_root_portals"]=detail.access.portals.iter()
                                .filter(|p|p.from==detail.access.root||p.to==detail.access.root).count().into();
                        }
                        "accepted".into()
                    }
                    Err(reason)=>{both=false;serde_json::json!({"refused":reason})}
                };
            }
            if both {replayed_count+=1;}
        } else {
            // A native refusal retains the admitted incumbent exactly except
            // for the explicit deferred diagnostic; no hidden pose/door retry.
            let mut baseline=previous.clone(); baseline.diagnostics=building.diagnostics.clone();
            assert_eq!(serde_json::to_value(&baseline).unwrap(),serde_json::to_value(&building).unwrap());
        }
        assert_eq!(original_bytes,serde_json::to_vec(&original).unwrap());
        eprintln!("b06-light-entry {}",serde_json::to_string(&report).unwrap());
        if let Some(dir)=std::env::var_os("MAGNA_B06_LIGHT_PROOF_DIR") {
            let dir=std::path::PathBuf::from(dir);std::fs::create_dir_all(&dir).unwrap();
            let file=std::fs::OpenOptions::new().write(true).create_new(true)
                .open(dir.join(format!("{label}.json"))).unwrap();
            serde_json::to_writer_pretty(file,&serde_json::json!({
                "request":r,"occupied":occupied,"before":previous,"after":building,"report":report})).unwrap();
        }
    }
    eprintln!("b06-light-entry-summary upgrades={upgraded_count}/3 replayed={replayed_count}/3");
    assert!(upgraded_count>0,"the actual lightweight portal did not recover any of the three witnesses");
    assert_eq!(replayed_count,upgraded_count,"an admitted light portal must survive both native replay modes");
}
