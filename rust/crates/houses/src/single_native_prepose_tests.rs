use super::*;
fn real()->(PlacementRequest,PlanBuilding){from_bytes(include_str!("../tests/fixtures/native-prepose-real-0000-site.json"),include_bytes!("../tests/fixtures/native-prepose-real-0000-parent.json"))}
fn from_bytes(site:&str,archive:&[u8])->(PlacementRequest,PlanBuilding){
    let wrapped=format!("{{\"schema_version\":\"native-parent-batch-1\",\"batch\":{{\"schema_version\":\"1\",\"requests\":[{site}],\"settings\":{{\"parcel_fit\":true}},\"footprints\":{{}}}},\"prior_occupation\":{{\"land_parts\":[],\"roof_parts\":[]}}}}");
    let mut batch=assembly::transport::parse_parent_batch_request(wrapped.as_bytes()).unwrap();let mut r=batch.batch.requests.remove(0);r.parcel_fit=Some(true);
    let a:parent_batch::NativeParentArchive=serde_json::from_slice(archive).unwrap();
    let parent_batch::NativeParentPlan::Single{building,..}=a.unpack().unwrap()else{panic!("original final Single required")};(r,building)
}
fn exact_source(old:&PlanBuilding,new:&PlanBuilding){
    let a=old.resolved.unpack().unwrap();let mut b=new.resolved.unpack().unwrap();b.entrance=None;
    assert_eq!(serde_json::to_vec(&a).unwrap(),serde_json::to_vec(&b).unwrap());
}
#[test]fn native_prepose_actual_final_b15_has_one_additional_preparation_and_admission(){
    let _mode=Mode::new(true);let(r,old)=real();let original=serde_json::to_vec(&old).unwrap();let cap=diagnostics::Capture::begin();
    let(new,replaced)=finish(&r,&vec![],old.clone());let rows=cap.reports();assert_eq!(rows.len(),1);
    let q=&rows[0];assert!(q.selected);assert_eq!((q.preparations,q.admissions,q.pose_generations),(1,1,1));assert!(q.generated_poses<=1);assert_eq!(q.native_high_y,Some(true));
    if replaced{assert!(new.resolved.has_retained_entrance());exact_source(&old,&new);}
    else{assert_eq!(serde_json::to_vec(&new).unwrap(),original);}
}
#[test]fn native_prepose_mode_off_preserves_whole_final_single_without_new_work(){
    let _mode=Mode::new(false);let(r,old)=real();let raw=serde_json::to_vec(&old).unwrap();let cap=diagnostics::Capture::begin();let(new,replaced)=finish(&r,&vec![],old);
    assert!(!replaced);assert_eq!(serde_json::to_vec(&new).unwrap(),raw);assert!(cap.reports().is_empty());
}
#[test]fn native_prepose_manual_strict_fitdisabled_borrowed_controls_are_inactive(){
    let _mode=Mode::new(true);
    for case in["recipe","floors","orientation","strict","fit","borrowed"]{
        let(mut r,old)=real();match case{
            "recipe"=>r.config.as_mut().unwrap().recipe=Some(old.recipe_id.clone()),
            "floors"=>r.config.as_mut().unwrap().overrides.floors=Some(1),
            "orientation"=>r.config.as_mut().unwrap().orientation_deg=90.,
            "strict"=>r.culture.mode=HistoricalMode::HistoricalStrict,
            "fit"=>r.parcel_fit=Some(false),_=>r.culture.borrowing=Some("foreign".into()),
        }
        let raw=serde_json::to_vec(&old).unwrap();let cap=diagnostics::Capture::begin();let(new,replaced)=finish(&r,&vec![],old);
        assert!(!replaced,"{case}");assert_eq!(serde_json::to_vec(&new).unwrap(),raw);assert!(cap.reports().is_empty());
    }
}
#[test]fn native_prepose_refusal_never_tries_a_second_pose_and_retains_whole_single(){
    let _mode=Mode::new(true);let(mut r,old)=real();r.terrain.max_foundation_step_m=0.;let raw=serde_json::to_vec(&old).unwrap();let cap=diagnostics::Capture::begin();let(new,replaced)=finish(&r,&vec![],old);
    assert!(!replaced);assert_eq!(serde_json::to_vec(&new).unwrap(),raw);let rows=cap.reports();assert_eq!(rows.len(),1);assert!(rows[0].selected);assert_eq!((rows[0].preparations,rows[0].admissions,rows[0].pose_generations),(1,1,1));
}
#[test]fn native_prepose_does_not_touch_existing_certified_native_single(){
    let _mode=Mode::new(true);let(r,old)=from_bytes(include_str!("../tests/fixtures/owned-pavilion-real-0012-site.json"),include_bytes!("../tests/fixtures/owned-pavilion-real-0012-parent.json"));
    assert!(old.resolved.has_retained_entrance(),"real archived admitted native parent, no fabricated certificate");
    let bytes=serde_json::to_vec(&old).unwrap();let cap=diagnostics::Capture::begin();let(new,replaced)=finish(&r,&vec![],old);assert!(!replaced);assert!(cap.reports().is_empty());assert_eq!(serde_json::to_vec(&new).unwrap(),bytes);
}
#[test]fn native_prepose_explicit_minimum_presence_is_closed_without_inspecting_its_identity(){
    let _mode=Mode::new(true);let(mut r,old)=real();
    // Intentionally no authority claimed for this token: mere presence closes
    // this automatic recovery; minimum identity validation belongs to its API.
    let identity=crate::admission_witness::AdmissionWitnessIdentity{
        version:"unverified".into(),catalogue_version:"unverified".into(),generator_version:"unverified".into(),
        style_index_version:"unverified".into(),source_sha256:"unverified".into(),style_id:"unverified".into(),
        recipe_id:old.recipe_id.clone(),variant_id:old.variant_id.clone(),seed:"unverified".into(),
    };
    r.native_minimum_candidates.push(crate::native_candidate::NativeMinimumCandidate{identity,transform:old.transform.clone(),access_id:old.access_id.clone(),contact:old.entrance});
    let raw=serde_json::to_vec(&old).unwrap();let cap=diagnostics::Capture::begin();let(new,replaced)=finish(&r,&vec![],old);
    assert!(!replaced);assert!(cap.reports().is_empty());assert_eq!(serde_json::to_vec(&new).unwrap(),raw);
}
