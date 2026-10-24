//! Native protocol/index tests; synthetic geometry/protocol sites are explicit.
use super::*;
use super::leaf_index::{LeafIndex,BatchLeaves,Kind,test_leaf};
use sha2::{Digest,Sha256};
fn fixture()->super::super::assembly::AssemblePairRequest{
    super::super::assembly::transport::parse_pair_request(include_bytes!("../tests/fixtures/native-assembly-public-input.json")).unwrap()
}
fn source()->ParentSessionSource{ParentSessionSource{fingerprint:"test-exact-source".into(),revision:"test-digest-terrain-layout-partitions".into(),coordinate_space:"world-metres".into()}}
fn begin(run:&str,total:usize)->BeginParentSessionRequest{BeginParentSessionRequest{schema_version:PARENT_SESSION_SCHEMA.into(),run_id:run.into(),source:source(),total_requests:total,settings:None}}
fn plan(handle:&BeginParentSessionReply,key:&str,offset:usize,site:PlacementRequest)->PlanParentSessionRequest{
    PlanParentSessionRequest{schema_version:PARENT_SESSION_SCHEMA.into(),session_id:handle.session_id.clone(),source_fingerprint:handle.source.fingerprint.clone(),revision:handle.source.revision.clone(),
        expected_offset:offset,key:key.into(),requests:vec![site],footprints:BTreeMap::new()}
}
fn open(id:&str)->PlacementRequest{let mut r=fixture().site;r.id=id.into();r.parcel_id=format!("{id}-parcel");r.function=ArchitectureFunction::OpenSpace;r.programme=None;r}
fn close(handle:&BeginParentSessionReply)->CloseParentSessionRequest{CloseParentSessionRequest{schema_version:PARENT_SESSION_SCHEMA.into(),session_id:handle.session_id.clone(),source_fingerprint:handle.source.fingerprint.clone(),revision:handle.source.revision.clone()}}
fn receipt(bytes:&[u8])->ParentSessionReceipt{
    let wire:serde_json::Value=serde_json::from_slice(bytes).unwrap();assert_eq!(wire["ok"],true);
    let json=wire["data"]["batch_json"].as_str().unwrap();let receipt:ParentSessionReceipt=serde_json::from_value(wire["data"]["receipt"].clone()).unwrap();
    assert_eq!(receipt.batch_sha256,format!("{:x}",Sha256::digest(json.as_bytes())));receipt
}
fn raw_rect(x:f64,y:f64,w:f64,h:f64)->Surface{vec![Polygon{outer:vec![Point{x,y},Point{x:x+w,y},Point{x:x+w,y:y+h},Point{x,y:y+h}],holes:vec![]}]}
#[test]
fn native_parent_session_pending_retry_ack_once_and_exact_native_bytes(){
    let rt=ParentSessionRuntime::new("test-instance-a".into()).unwrap();let b=begin("synthetic-protocol",2);let handle=rt.begin(b.clone(),0).unwrap();
    assert_eq!(rt.begin(b,1).unwrap().session_id,handle.session_id);
    let first=plan(&handle,"batch0",0,open("open0"));let bytes=rt.plan(first.clone(),2).unwrap();let native=receipt(&bytes);
    let retry=rt.plan(first.clone(),3).unwrap();assert!(Arc::ptr_eq(&bytes,&retry));assert_eq!(bytes,retry);
    let mut changed=first;changed.requests[0].seed.push_str("/changed");assert!(rt.plan(changed,4).is_err());
    assert!(rt.plan(plan(&handle,"batch1",1,open("open1")),4).is_err());
    let ack=AckParentSessionRequest{schema_version:PARENT_SESSION_SCHEMA.into(),receipt:native.clone()};
    let first=rt.ack(ack,5).unwrap();assert_eq!(first.completed,1);assert_eq!(first.prefix.parents,0);
    assert_eq!(rt.ack(AckParentSessionRequest{schema_version:PARENT_SESSION_SCHEMA.into(),receipt:native},6).unwrap().state,"already_acked");
    let second=rt.plan(plan(&handle,"batch1",1,open("open1")),7).unwrap();let last=receipt(&second);
    assert_eq!(rt.ack(AckParentSessionRequest{schema_version:PARENT_SESSION_SCHEMA.into(),receipt:last},8).unwrap().state,"complete");
    assert_eq!(rt.close(close(&handle),9).unwrap().state,"released");assert_eq!(rt.close(close(&handle),10).unwrap().state,"already_released");
}
#[test]
fn native_parent_session_identity_zero_idle_cleanup_and_registry_cap(){
    let rt=ParentSessionRuntime::new("test-instance-b".into()).unwrap();let handle=rt.begin(begin("zero",0),0).unwrap();
    assert_eq!(handle.state,"complete");assert_eq!(handle.batch_schema_version,parent_batch::PARENT_BATCH_SCHEMA);
    let mut changed=begin("zero",0);changed.source.revision.push('x');assert!(rt.begin(changed,1).is_err());
    assert!(rt.plan(plan(&handle,"wrong-total",0,open("x")),2).is_err());
    let mut handles=vec![handle];for i in 1..4{handles.push(rt.begin(begin(&format!("run{i}"),1),i).unwrap());}
    assert!(rt.begin(begin("run4",1),5).is_err());
    let newer=rt.begin(begin("after-idle",1),15*60*1000+100).unwrap();
    assert!(rt.plan(plan(&handles[0],"old",0,open("old")),15*60*1000+101).is_err());
    let other=ParentSessionRuntime::new("test-instance-RESTART".into()).unwrap();let restart=other.begin(begin("after-idle",1),0).unwrap();
    assert_ne!(newer.session_id,restart.session_id);assert!(other.close(close(&newer),1).is_err());
    rt.close(close(&newer),15*60*1000+102).unwrap();other.close(close(&restart),2).unwrap();
}
#[test]
fn native_parent_session_union_threshold_handles_cumulative_and_duplicate_leaves(){
    let site=fixture().site;let query=raw_rect(0.,0.,1.,1.);
    let mut index=LeafIndex::default();index.append(BatchLeaves{parents:2,members:2,leaves:vec![
        test_leaf(Kind::Land,0,raw_rect(0.,0.,0.006,0.01)),test_leaf(Kind::Land,1,raw_rect(0.1,0.,0.006,0.01))]}).unwrap();
    {let scope=prefix_scope::Scope::enter(Arc::new(index),std::slice::from_ref(&site)).unwrap();
        assert!(land_clear(&site.id,&query).is_err());assert!(scope.finish().is_ok());}
    let mut index=LeafIndex::default();let small=raw_rect(0.,0.,0.006,0.01);
    index.append(BatchLeaves{parents:2,members:2,leaves:vec![test_leaf(Kind::Land,0,small.clone()),test_leaf(Kind::Land,1,small)]}).unwrap();
    let scope=prefix_scope::Scope::enter(Arc::new(index),std::slice::from_ref(&site)).unwrap();
    land_clear(&site.id,&query).unwrap();assert!(scope.finish().unwrap().leaf_hits>=2);
}
#[test]
fn native_parent_session_exact_query_outside_cadastral_and_roof_roof_control(){
    let mut site=fixture().site;site.cadastral=rectangle(0.,0.,200.,200.);site.buildable=site.cadastral.clone();
    let outside=raw_rect(200.001,0.,0.006,0.02);let candidate=vec![rectangle(1.,1.,150.,150.),outside.clone()].concat();
    assert!(contains(&site.cadastral,&candidate),"existing area-tolerant rights can admit this synthetic projection");
    let mut old=OccupationIndex::default();old.insert(outside.clone());assert!(old.local(&site.cadastral).is_empty());
    let mut index=LeafIndex::default();index.append(BatchLeaves{parents:1,members:1,leaves:vec![test_leaf(Kind::Land,0,outside)]}).unwrap();
    {let _scope=prefix_scope::Scope::enter(Arc::new(index),std::slice::from_ref(&site)).unwrap();assert!(land_clear(&site.id,&candidate).is_err());}
    let roof=rectangle(300.,300.,2.,2.);let mut index=LeafIndex::default();
    index.append(BatchLeaves{parents:1,members:1,leaves:vec![test_leaf(Kind::Roof,0,roof.clone())]}).unwrap();
    let _scope=prefix_scope::Scope::enter(Arc::new(index),std::slice::from_ref(&site)).unwrap();
    necessary_clear(&site.id,&rectangle(0.,0.,2.,2.),&roof).unwrap();assert!(land_clear(&site.id,&roof).is_err());
}
#[test]
fn native_parent_session_dense_query_is_administrative_not_a_truncated_context(){
    let site=fixture().site;let mut index=LeafIndex::default();let query=rectangle(0.,0.,1.,1.);
    index.append(BatchLeaves{parents:4097,members:4097,leaves:(0..4097).map(|i|test_leaf(Kind::Land,i,query.clone())).collect()}).unwrap();
    let scope=prefix_scope::Scope::enter(Arc::new(index),std::slice::from_ref(&site)).unwrap();
    assert!(land_clear(&site.id,&query).err().unwrap().contains("budget"));assert!(scope.finish().is_err());
}
#[test]
fn native_parent_session_prior_group_real_members_paths_features_and_roofs_are_exact_leaves(){
    // Actual root-produced native archive, not a fake Single or scene DTO.
    let group=super::super::assembly::transport::parse_archive(include_bytes!("../tests/fixtures/native-assembly-public-archive.json")).unwrap().unpack().unwrap();
    let plan=NativeParentPlan::Assembly{assembly:group};let (land,roofs)=plan.occupation_parts();
    let mut index=LeafIndex::default();let mut leaves=vec![];
    for (kind,parts) in [(Kind::Land,land.clone()),(Kind::Roof,roofs.clone())]{for surface in parts{if !surface.is_empty(){leaves.push(test_leaf(kind,0,surface));}}}
    index.append(BatchLeaves{parents:1,members:2,leaves}).unwrap();
    let mut report=ParentIndexQueryReport::default();let land=unite(&land);let roofs=unite(&roofs);
    let queried=index.query_union(&land,Kind::Land,&mut report).unwrap();assert_eq!(area(&difference(&land,&queried)),0.);
    let queried=index.query_union(&roofs,Kind::Roof,&mut report).unwrap();assert_eq!(area(&difference(&roofs,&queried)),0.);
    assert_eq!(index.counts.parents,1);assert_eq!(index.counts.members,2);assert!(index.counts.leaves>=4);
}
#[test]
fn native_parent_session_real_ordinary_pipeline_then_ack_reserves_its_actual_geometry(){
    let _growth=single_incumbent_growth::Mode::new(true);let _need=single_need_continuation::Mode::new(true);
    let rt=ParentSessionRuntime::new("test-instance-native".into()).unwrap();let handle=rt.begin(begin("real-native-pipeline",1),0).unwrap();
    let bytes=rt.plan(plan(&handle,"actual-native",0,fixture().site),1).unwrap();let native=receipt(&bytes);
    let wire:serde_json::Value=serde_json::from_slice(&bytes).unwrap();let batch:serde_json::Value=serde_json::from_str(wire["data"]["batch_json"].as_str().unwrap()).unwrap();
    assert_eq!(batch["counts"]["admitted_parents"],1);assert_eq!(batch["parents"].as_array().unwrap().len(),1);
    let ack=rt.ack(AckParentSessionRequest{schema_version:PARENT_SESSION_SCHEMA.into(),receipt:native},2).unwrap();
    assert_eq!(ack.prefix.parents,1);assert!(ack.prefix.members>=1&&ack.prefix.leaves>=2&&ack.prefix.vertices>0);
    rt.close(close(&handle),3).unwrap();
}

#[test]
fn native_parent_session_compute_abort_inflight_and_another_run_without_global_lock(){
    let rt=ParentSessionRuntime::new("test-instance-concurrent".into()).unwrap();let a=rt.begin(begin("blocked",1),0).unwrap();
    let input=plan(&a,"batch-a",0,open("a"));let gate=rt.test_gate(&a.session_id,false);let worker=rt.clone();let call=input.clone();
    let thread=std::thread::spawn(move||worker.plan(call,1));gate.entered.wait();
    assert!(rt.plan(input,2).err().unwrap().contains("inflight"));
    let b=rt.begin(begin("independent",1),2).unwrap();let bytes=rt.plan(plan(&b,"batch-b",0,open("b")),3).unwrap();
    rt.ack(AckParentSessionRequest{schema_version:PARENT_SESSION_SCHEMA.into(),receipt:receipt(&bytes)},4).unwrap();
    assert_eq!(rt.close(close(&a),5).unwrap().state,"draining");gate.proceed.wait();
    assert!(thread.join().unwrap().err().unwrap().contains("closed"));assert!(rt.plan(plan(&a,"after-abort",0,open("a2")),6).is_err());
    rt.close(close(&b),7).unwrap();assert_eq!(rt.test_quota().retained_index_bytes,0);
}
#[test]
fn native_parent_session_compute_unwind_drops_scopes_and_releases_run(){
    let rt=ParentSessionRuntime::new("test-instance-unwind".into()).unwrap();let a=rt.begin(begin("panic-run",1),0).unwrap();
    let gate=rt.test_gate(&a.session_id,true);let worker=rt.clone();let input=plan(&a,"panic-batch",0,open("panic-source"));
    let thread=std::thread::spawn(move||{
        let panic=std::panic::catch_unwind(std::panic::AssertUnwindSafe(||worker.plan(input,1)));
        let after=worker.begin(begin("after-panic-same-thread",1),2).unwrap();
        let next=worker.plan(plan(&after,"after-panic",0,open("after-panic")),3);
        worker.close(close(&after),4).unwrap();(panic.is_err(),next.is_ok())
    });gate.entered.wait();gate.proceed.wait();assert_eq!(thread.join().unwrap(),(true,true));
    assert!(rt.plan(plan(&a,"stale",0,open("stale")),5).is_err());assert_eq!(rt.test_quota().retained_index_bytes,0);
}
#[test]
fn native_parent_session_ack_invariant_error_closes_and_releases_reserved_quota(){
    let _growth=single_incumbent_growth::Mode::new(true);let _need=single_need_continuation::Mode::new(true);
    let rt=ParentSessionRuntime::new("test-instance-ack-error".into()).unwrap();let h=rt.begin(begin("real-ack-invariant",1),0).unwrap();
    let bytes=rt.plan(plan(&h,"native",0,fixture().site),1).unwrap();let native=receipt(&bytes);
    let held=rt.test_hold_pending_index(&h.session_id); // deliberate private invariant fault, not a geometry fixture
    let error=rt.ack(AckParentSessionRequest{schema_version:PARENT_SESSION_SCHEMA.into(),receipt:native},2).err().unwrap();
    assert!(error.contains("invariant"));assert_eq!(rt.test_quota().retained_index_bytes,0);
    assert!(rt.plan(plan(&h,"cannot-reuse",0,open("never")),3).is_err());drop(held);
}
#[test]
fn native_parent_session_retired_key_and_ack_history_window_are_explicit(){
    let rt=ParentSessionRuntime::new("test-instance-history".into()).unwrap();let h=rt.begin(begin("history",257),0).unwrap();let mut first=None;
    for i in 0..257{
        let bytes=rt.plan(plan(&h,&format!("key-{i}"),i,open(&format!("open-{i}"))),i as u64*2+1).unwrap();let r=receipt(&bytes);
        if i==0{first=Some(r.clone());}
        rt.ack(AckParentSessionRequest{schema_version:PARENT_SESSION_SCHEMA.into(),receipt:r},i as u64*2+2).unwrap();
    }
    let old=first.unwrap();assert!(rt.ack(AckParentSessionRequest{schema_version:PARENT_SESSION_SCHEMA.into(),receipt:old},600).err().unwrap().contains("ack_history_expired"));
    assert!(rt.plan(plan(&h,"key-0",257,open("new-source")),601).err().unwrap().contains("already_acked"));
    rt.close(close(&h),602).unwrap();
}


#[test]
fn native_parent_session_internal_roof_support_checks_real_prefix_path_before_choice(){
    let mut r=fixture().site;r.cadastral=rectangle(-2.,-2.,80.,220.);r.reserves.clear();
    let body=rectangle(0.,0.,15.,22.);let roof=rectangle(15.351,-0.351,15.702,22.702);
    let native=crate::access::StructuralEntrance{opening:[point(0.572,22.),point(1.422,22.)],passage:rectangle(0.572,21.653,0.85,0.547),width_m:0.85,from_z_m:0.,to_z_m:0.};
    let cap=[super::super::NativeConnectionTarget{id:"actual-internal-cap".into(),segment:[point(16.299,166.5),point(16.299,22.2)],width_m:0.8}];
    let t=Transform{origin:point(0.,0.),orientation_deg:0.};let empty=vec![];
    let connect=||super::super::proposed_native_access_to_targets(&r,&native,&empty,&t,&body,&roof,
        Some(super::super::native_one_bend_access::OneBendContext{body_entry:&native,body_local:&body}),&cap,Some(&roof));
    let clear=connect().unwrap();
    let obstacle=rectangle(7.,22.5,1.,0.5);assert!(area(&intersection(&clear.2,&obstacle))>0.0001);
    let mut index=LeafIndex::default();index.append(BatchLeaves{parents:1,members:1,leaves:vec![test_leaf(Kind::Roof,0,obstacle)]}).unwrap();
    let scope=prefix_scope::Scope::enter(Arc::new(index),std::slice::from_ref(&r)).unwrap();
    assert!(connect().is_err(),"actual prior roof must reject the newly constructed path, not only the body necessary test");
    let report=scope.finish().unwrap();assert!(report.queries>0&&report.leaf_hits>0);
}


#[test]
fn native_parent_session_query_order_rejects_outside_walk_before_dense_query_then_continues(){
    let mut r=fixture().site;r.cadastral=rectangle(-2.,-2.,20.,18.);r.reserves.clear();
    let body=rectangle(0.,0.,6.,8.);let native=crate::access::StructuralEntrance{opening:[point(0.775,8.),point(1.625,8.)],passage:rectangle(0.775,7.6,0.85,0.6),width_m:0.85,from_z_m:0.,to_z_m:0.};
    let t=Transform{origin:point(0.,0.),orientation_deg:0.};let empty=vec![];
    // All leaves are real indexed roof rectangles far outside this request.
    // A rejected distant connector spans their bbox; no truncation is allowed.
    let mut index=LeafIndex::default();index.append(BatchLeaves{parents:4097,members:4097,leaves:(0..4097).map(|i|test_leaf(Kind::Roof,i,rectangle(100.+(i%100)as f64,100.+(i/100)as f64,0.25,0.25))).collect()}).unwrap();
    let scope=prefix_scope::Scope::enter(Arc::new(index),std::slice::from_ref(&r)).unwrap();
    let far=[super::super::NativeConnectionTarget{id:"outside-walk-cap".into(),segment:[point(10000.,10000.),point(10004.,10000.)],width_m:0.8}];
    assert!(super::super::proposed_native_access_to_targets(&r,&native,&empty,&t,&body,&empty,None,&far,None).is_err());
    let before=scope.finish().unwrap().queries; // Physical rejection must not poison this run.
    let nearby=[super::super::NativeConnectionTarget{id:"ordinary-valid-next-cap".into(),segment:[point(0.,12.),point(6.,12.)],width_m:0.8}];
    let accepted=super::super::proposed_native_access_to_targets(&r,&native,&empty,&t,&body,&empty,None,&nearby,None).unwrap();
    assert_eq!(accepted.1,"ordinary-valid-next-cap");assert!(contains(&r.cadastral,&accepted.2));assert!(scope.finish().unwrap().queries>=before+4,"both passage and accepted path must query actual prefix land/roof");
}
