//! Autonomous tests: real small native fixtures; synthetic sites are labeled.
use super::*;
#[path="native_parent_contexts22_tests.rs"]
mod contexts22;
fn pair()->super::assembly::AssemblePairRequest{
    super::assembly::transport::parse_pair_request(include_bytes!("../tests/fixtures/native-assembly-public-input.json")).unwrap()
}
fn empty()->PriorOccupation{PriorOccupation{land_parts:vec![],roof_parts:vec![]}}

#[test]
fn native_parent_choice_keeps_whole_assembly_when_local_single_loses_inventory(){
    let input=pair();
    let old=super::assembly::transport::parse_archive(include_bytes!("../tests/fixtures/native-assembly-public-archive.json")).unwrap().unpack().unwrap();
    let parent=NativeParentPlan::Assembly{assembly:old};
    let whole=serde_json::to_vec(&NativeParentArchive::pack(&parent).unwrap()).unwrap();
    let single=NativeParentPlan::Single{programme:input.site.programme,building:input.incumbent};
    assert!(choice::accepts(&parent,&single).unwrap_err().contains("whole-parent gross"));
    assert_eq!(serde_json::to_vec(&NativeParentArchive::pack(&parent).unwrap()).unwrap(),whole);
    assert!(choice::accepts(&single,&parent).is_ok(),"a native extension preserves the whole admitted incumbent and reduces necessary debt");
    assert!(choice::accepts(&parent,&parent).is_err(),"ties retain the existing whole parent");
    let mut wrong=parent.clone();
    if let NativeParentPlan::Assembly{assembly}=&mut wrong{assembly.programme.wealth=Some(0.9);}
    assert!(choice::accepts(&parent,&wrong).is_err());
}
fn request(site:PlacementRequest)->ParentPlanBatchRequest{
    ParentPlanBatchRequest{schema_version:PARENT_BATCH_SCHEMA.into(),batch:PlanBatchRequest{
        schema_version:"1".into(),requests:vec![site],settings:None,footprints:BTreeMap::new()},prior_occupation:empty()}
}
fn scalar_bits(v:&serde_json::Value)->BTreeMap<String,String>{
    fn walk(v:&serde_json::Value,k:String,out:&mut BTreeMap<String,String>){match v{
        serde_json::Value::Array(a)=>{out.insert(k.clone(),format!("array:{}",a.len()));for(i,v)in a.iter().enumerate(){walk(v,format!("{k}/{i}"),out)}},
        serde_json::Value::Object(o)=>{out.insert(k.clone(),format!("object:{}",o.len()));for(i,v)in o{walk(v,format!("{k}/{i}"),out)}},
        serde_json::Value::Number(n) if n.is_f64()=>{out.insert(k,format!("f64:{:016x}",n.as_f64().unwrap().to_bits()));},
        v=>{out.insert(k,v.to_string());},
    }}let mut out=BTreeMap::new();walk(v,String::new(),&mut out);out
}
#[test]
fn native_parent_batch_scope_errors_unwind_nesting_and_threads(){
    let input=pair();let site=input.site;let b=input.incumbent;
    {
        let _scope=context::Scope::enter(&empty(),std::slice::from_ref(&site)).unwrap();
        assert!(context::Scope::enter(&empty(),std::slice::from_ref(&site)).is_err());
        let mut wrong=b.clone();wrong.id.push_str("/not-a-parent");
        assert!(admission_guard(&wrong).is_err());assert!(record_finalized(&b).is_err());
        admission_guard(&b).unwrap();record_finalized(&b).unwrap();
        assert!(context::active());
    }assert!(!context::active());
    let result=std::panic::catch_unwind(||{
        let _scope=context::Scope::enter(&empty(),std::slice::from_ref(&site)).unwrap();panic!("test-only scoped unwind")
    });assert!(result.is_err());assert!(!context::active());
    let after_error=(||->Result<(),String>{let _scope=context::Scope::enter(&empty(),std::slice::from_ref(&site))?;Err("test-only early Err".into())})();
    assert!(after_error.is_err());assert!(!context::active());
    let threads=(0..2).map(|_|{let site=site.clone();let b=b.clone();std::thread::spawn(move||{
        assert!(!context::active());let _scope=context::Scope::enter(&empty(),std::slice::from_ref(&site)).unwrap();
        admission_guard(&b).unwrap();record_finalized(&b).unwrap();assert!(context::active());
    })}).collect::<Vec<_>>();for thread in threads{thread.join().unwrap();}
    assert!(!context::active());admission_guard(&b).unwrap();
}
#[test]
fn native_parent_batch_prior_roof_guards_complete_land_without_roof_roof_ban(){
    let input=pair();let land=unite(&land_parts(&input.incumbent));
    {
        let prior=PriorOccupation{land_parts:vec![],roof_parts:vec![land.clone()]};
        let _scope=context::Scope::enter(&prior,std::slice::from_ref(&input.site)).unwrap();
        assert!(admission_guard(&input.incumbent).is_err());
    }
    // Real retained roof eaves only, disjoint from complete body/path/features.
    let eaves=difference(&input.incumbent.roof_footprint,&land);assert!(area(&eaves)>0.0001);
    {
        let prior=PriorOccupation{land_parts:vec![],roof_parts:vec![eaves]};
        let _scope=context::Scope::enter(&prior,std::slice::from_ref(&input.site)).unwrap();
        admission_guard(&input.incumbent).unwrap();record_finalized(&input.incumbent).unwrap();
    }
    // Circulation alone is physical land, not just the body footprint.
    let outside=difference(&input.incumbent.circulation,&input.incumbent.footprint);assert!(area(&outside)>0.0001);
    let prior=PriorOccupation{land_parts:vec![],roof_parts:vec![outside]};
    let _scope=context::Scope::enter(&prior,std::slice::from_ref(&input.site)).unwrap();
    assert!(admission_guard(&input.incumbent).is_err());
}
#[test]
fn native_parent_batch_archive_single_and_group_are_lossless_atomic(){
    let input=pair();let mut b=input.incumbent;b.transform.orientation_deg=-0.;
    let plan=NativeParentPlan::Single{programme:input.site.programme,building:b};
    let archive=NativeParentArchive::pack(&plan).unwrap();
    let wire=serde_json::to_vec(&archive).unwrap();let read=super::assembly::transport::parse_parent_archive(&wire).unwrap();
    let decoded=read.unpack().unwrap();
    assert_eq!(scalar_bits(&serde_json::to_value(&plan).unwrap()),scalar_bits(&serde_json::to_value(&decoded).unwrap()));
    let group=super::assembly::transport::parse_archive(include_bytes!("../tests/fixtures/native-assembly-public-archive.json")).unwrap().unpack().unwrap();
    let group=NativeParentPlan::Assembly{assembly:group};let group_archive=NativeParentArchive::pack(&group).unwrap();
    let bulk=unpack_parent_batch(UnpackParentBatchRequest{schema_version:PARENT_BATCH_SCHEMA.into(),archives:vec![archive,group_archive.clone()]}).unwrap();
    assert_eq!(bulk.counts.admitted_parents,2);assert_eq!(bulk.counts.physical_members,3);
    match realize_parent(RealizeParentRequest{parent:group_archive.clone(),interiors:true}).unwrap(){
        RealizedParent::Assembly{assembly}=>{assert_eq!(assembly.members.len(),2);for m in assembly.members{assert!(!m.architecture.units[0].rooms.is_empty());}},
        _=>panic!("real native group expected"),
    }
    let mut corrupt=group_archive;corrupt.sha256.push('0');
    assert!(unpack_parent_batch(UnpackParentBatchRequest{schema_version:PARENT_BATCH_SCHEMA.into(),archives:vec![corrupt]}).is_err());
}
#[test]
fn native_parent_batch_limits_and_parent_request_counts(){
    let input=pair();let mut r=request(input.site.clone());
    r.batch.requests=vec![input.site.clone();65];assert!(plan_parent_batch(r).err().unwrap().contains("64"));
    let mut r=request(input.site.clone());r.prior_occupation.roof_parts=vec![vec![];4097];
    assert!(plan_parent_batch(r).err().unwrap().contains("budget"));assert!(!context::active());
    let mut a=input.site.clone();a.function=ArchitectureFunction::OpenSpace;
    let result=plan_parent_batch(request(a)).unwrap();assert_eq!(result.counts.requests,1);assert_eq!(result.counts.open_spaces,1);
    assert_eq!(result.counts.admitted.admitted_parents,0);assert_eq!(result.counts.admitted.physical_members,0);
}
#[test]
fn native_parent_batch_same_decoder_phase1_baseline_and_old_api_after_failure(){
    let _growth=single_incumbent_growth::Mode::new(true);let _need=single_need_continuation::Mode::new(true);
    let site=pair().site;
    let baseline=plan_batch(request(site.clone()).batch).unwrap();
    let before=serde_json::to_vec(&baseline).unwrap();
    let mut invalid=request(site.clone());invalid.prior_occupation.land_parts=vec![rectangle(0.,0.,300.,300.)];
    let _=plan_parent_batch(invalid);assert!(!context::active());
    let after=serde_json::to_vec(&plan_batch(request(site.clone()).batch).unwrap()).unwrap();assert_eq!(before,after);
    let phase1=plan_parent_batch_impl(request(site),false).unwrap();assert_eq!(phase1.parents.len(),baseline.buildings.len());
    for(p,b)in phase1.parents.iter().zip(&baseline.buildings){match &p.plan{
        NativeParentPlan::Single{building,..}=>assert_eq!(serde_json::to_vec(building).unwrap(),serde_json::to_vec(b).unwrap()),_=>panic!("phase2 disabled")}}
}
#[test]
fn native_parent_batch_ordinary_search_continues_after_prior_roof_rejection(){
    let _growth=single_incumbent_growth::Mode::new(true);let _need=single_need_continuation::Mode::new(true);
    let site=pair().site;let original=plan_batch(request(site.clone()).batch).unwrap();
    assert_eq!(original.buildings.len(),1,"synthetic large flat site must admit baseline");
    let obstacle=original.buildings[0].footprint.clone();let mut input=request(site);
    input.prior_occupation.roof_parts=vec![obstacle.clone()];
    let result=plan_parent_batch_impl(input,false).unwrap();
    assert_eq!(result.parents.len(),1,"ordinary existing poses must remain available after roof rejection");
    let NativeParentPlan::Single{building,..}=&result.parents[0].plan else{panic!("phase2 disabled")};
    assert!(area(&intersection(&unite(&land_parts(building)),&obstacle))<=0.0001);
}
#[test]
fn native_parent_batch_synthetic_full_pipeline_group_archive_realize(){
    let _growth=single_incumbent_growth::Mode::new(true);let _need=single_need_continuation::Mode::new(true);
    let mut site=pair().site;
    // Explicitly SYNTHETIC large programme to exercise group contract after all
    // shipped Single growth. No real Java request/capacity is changed/claimed.
    let p=site.programme.as_mut().unwrap();p.households=Some(100.);
    let need=p.housing_floor_need.as_mut().unwrap();need.allocated_households=100.;
    need.requested_m2=100.*need.model.effective_floor_m2_per_household;
    let result=plan_parent_batch(request(site)).unwrap();
    assert_eq!(result.counts.requests,1);assert_eq!(result.counts.admitted.admitted_parents,1);
    assert_eq!(result.counts.admitted.assembly_parents,1,"requires a real in-memory plan -> group positive, not a retained fallback");
    assert_eq!(result.counts.admitted.physical_members,2);
    let record=&result.parents[0];let NativeParentPlan::Assembly{assembly}=&record.plan else{panic!("real group required")};
    assert!(assembly.outcome.housed_households.is_none());assert_eq!(assembly.programme.households,Some(100.));
    let r=record.attempt.as_ref().unwrap();assert_eq!(r.source_resolutions,0);assert!(r.new_body_rebuilds<=1&&r.new_native_preparations<=1&&r.new_admissions<=4&&r.necessary_checks<=8);
    let native=realize_parent(RealizeParentRequest{parent:record.archive.clone(),interiors:true}).unwrap();
    assert!(matches!(native,RealizedParent::Assembly{..}));
}

#[test]
fn native_parent_batch_single_archive_rejects_source_and_report_forgery(){
    let input=pair();let plan=NativeParentPlan::Single{programme:input.site.programme,building:input.incumbent};
    let archive=NativeParentArchive::pack(&plan).unwrap();
    let mut forged=archive.unpack().unwrap();
    if let NativeParentPlan::Single{building,..}=&mut forged{building.volumes[0].levels[0].footprint[0].outer[0].x+=1.;}
    assert!(NativeParentArchive::pack(&forged).is_err());
    let mut forged=archive.unpack().unwrap();
    if let NativeParentPlan::Single{building,..}=&mut forged{building.programme_outcome.as_mut().unwrap().households.housed=Some(100.);}
    assert!(NativeParentArchive::pack(&forged).is_err());
    let mut forged=archive.unpack().unwrap();
    if let NativeParentPlan::Single{building,..}=&mut forged{building.roof_footprint[0].outer[0].x+=1.;}
    assert!(NativeParentArchive::pack(&forged).is_err());
}

#[test]
fn native_parent_batch_std_uses_original_raw_tokens_and_rejects_duplicate_keys(){
    let site=pair().site;let input=request(site);
    let bytes=serde_json::to_vec(&input).unwrap();
    let parsed=super::assembly::transport::parse_parent_batch_request(&bytes).unwrap();
    assert_eq!(scalar_bits(&serde_json::to_value(&input).unwrap()),scalar_bits(&serde_json::to_value(&parsed).unwrap()));
    let duplicate=br#"{"schema_version":"native-parent-batch-1","schema_versi\u006fn":"native-parent-batch-1","batch":{},"prior_occupation":{}}"#;
    assert!(super::assembly::transport::parse_parent_batch_request(duplicate).is_err());
}

#[test]
fn native_parent_batch_imposed_footprint_does_not_disable_other_automatic_parents(){
    let _growth=single_incumbent_growth::Mode::new(true);let _need=single_need_continuation::Mode::new(true);
    let fixture=pair();let pinned=fixture.site;let pinned_id=pinned.id.clone();let pin=fixture.incumbent.footprint;
    let mut automatic=pinned.clone();automatic.id.push_str("/automatic");automatic.parcel_id.push_str("/automatic");
    let translation=Transform{origin:point(400.,0.),orientation_deg:0.};
    automatic.cadastral=map_surface(&automatic.cadastral,&translation);automatic.buildable=map_surface(&automatic.buildable,&translation);
    automatic.roof_domain=automatic.roof_domain.as_ref().map(|s|map_surface(s,&translation));
    for a in &mut automatic.accesses{a.segment=a.segment.map(|p|transform_point(p,&translation));}
    let mut input=request(pinned);input.batch.footprints.insert(pinned_id.clone(),pin.clone());
    let automatic_id=automatic.id.clone();input.batch.requests.push(automatic);
    let result=plan_parent_batch(input).unwrap();assert_eq!(result.counts.requests,2);
    let first=result.parents.iter().find(|p|p.plan.id()==pinned_id).expect("pinned native baseline must be admitted");
    assert!(matches!(&first.plan,NativeParentPlan::Single{..}));
    let report=first.attempt.as_ref().unwrap();assert!(report.reason.contains("Imposed footprint"));assert_eq!(report.new_body_rebuilds,0);
    let other=result.parents.iter().find(|p|p.plan.id()==automatic_id).expect("independent automatic site must be admitted");
    assert!(other.attempt.is_some(),"automatic compound must reach bounded pair contract, even if it retains the valid Single");
    assert!(!other.attempt.as_ref().unwrap().reason.contains("Imposed footprint"));
}
