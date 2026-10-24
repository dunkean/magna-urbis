//! Real component fixtures plus the independent existing synthetic assembly.
//! Direct component calls do not stand in for the exact-prefix city replay.
use super::*;
use crate::plans::assembly::builder::{OwnedReplayMode,owned_replay_dimensions_for_test};
fn real(case:&str)->AssemblePairRequest{
 let(site,archive)=match case{
  "0012"=>(include_str!("../tests/fixtures/owned-pavilion-real-0012-site.json"),include_bytes!("../tests/fixtures/owned-pavilion-real-0012-parent.json").as_slice()),
  _=>(include_str!("../tests/fixtures/owned-pavilion-real-0099-counter-site.json"),include_bytes!("../tests/fixtures/owned-pavilion-real-0099-counter-parent.json").as_slice()),
 };
 // Raw site bytes go to the scoped Std typed reader, never through Value.
 let wrapped=format!("{{\"schema_version\":\"native-parent-batch-1\",\"batch\":{{\"schema_version\":\"1\",\"requests\":[{site}],\"settings\":{{\"parcel_fit\":true}},\"footprints\":{{}}}},\"prior_occupation\":{{\"land_parts\":[],\"roof_parts\":[]}}}}");
 let mut batch=transport::parse_parent_batch_request(wrapped.as_bytes()).unwrap();let mut site=batch.batch.requests.remove(0);site.parcel_fit=Some(true);
 let archive:parent_batch::NativeParentArchive=serde_json::from_slice(archive).unwrap();let parent_batch::NativeParentPlan::Single{building:incumbent,..}=archive.unpack().unwrap()else{panic!("real archived Single required")};
 AssemblePairRequest{site,incumbent,occupied_parts:vec![],occupied_roof_parts:vec![]}
}
fn budget(r:&AssemblyAttemptReport){assert!(r.necessary_checks<=8&&r.necessary_terrain_checks<=8);assert!(r.new_body_rebuilds<=1&&r.new_native_preparations<=1&&r.new_admissions<=4);assert_eq!(r.source_resolutions,0);assert!(r.incumbent_preparations<=1&&r.incumbent_admissions<=1);}
fn report(d:&AssemblyDecision)->&AssemblyAttemptReport{match d{AssemblyDecision::Retained{report,..}|AssemblyDecision::Assembled{report,..}=>report}}
fn payload(d:&AssemblyDecision)->Vec<u8>{match d{AssemblyDecision::Retained{building,..}=>serde_json::to_vec(building).unwrap(),AssemblyDecision::Assembled{archive,..}=>serde_json::to_vec(archive).unwrap()}}
#[test]fn owned_pavilion_real_0012_exact_descriptor_only_uses_four_spare_checks(){
 let before=real("0012");let old=before.incumbent.clone();let original=serde_json::to_vec(&old).unwrap();
 let baseline={let _mode=OwnedReplayMode::new(false);assemble_pair(before).unwrap()};
 assert!(matches!(baseline,AssemblyDecision::Retained{..}));let prior=report(&baseline);assert_eq!(prior.necessary_checks,4);assert_eq!((prior.new_body_rebuilds,prior.new_native_preparations,prior.new_admissions),(0,0,0));
 let candidate={let _mode=OwnedReplayMode::new(true);assemble_pair(real("0012")).unwrap()};let r=report(&candidate);budget(r);assert_eq!(r.necessary_checks,8);assert_eq!(r.new_body_rebuilds,0,"owned descriptor is NOT resized/reconstructed");
 assert_eq!(serde_json::to_vec(&r.necessary[..4]).unwrap(),serde_json::to_vec(&prior.necessary).unwrap(),"all old nominal checks exact and first");assert!(r.necessary[4..].iter().all(|n|n.dimension_slot==1));
 let owned=old.resolved.unpack().unwrap();match &candidate{
  AssemblyDecision::Retained{building,..}=>assert_eq!(serde_json::to_vec(building).unwrap(),original),
  AssemblyDecision::Assembled{assembly,archive,..}=>{
   assert_eq!(assembly.members.len(),2);assert_eq!(serde_json::to_vec(&assembly.members[0].plan).unwrap(),serde_json::to_vec(&NativeMemberPlan::retain(&old)).unwrap());
   assert_eq!(serde_json::to_vec(&assembly.members[1].plan.resolved.unpack().unwrap()).unwrap(),serde_json::to_vec(&owned).unwrap());
   assert!(assembly.outcome.useful_shortfall_lower_bound_m2.unwrap()<assembly.programme.housing_floor_need.as_ref().unwrap().requested_m2-super::super::plan_programme_outcome::housing_floor_outcome::gross_floor_inventory(&old).unwrap());
   assert!(archive.unpack().is_ok());assert!(assembly.outcome.housed_households.is_none());
  }
 }
 if let Some(path)=std::env::var_os("OWNED_PAVILION_COMPONENT_OUT"){
  let value=json!({"scope":"actual0012 source/site component ONLY; no original prefix installed; not city gain proof","original_native_source":old.resolved,"decision":candidate});let raw=serde_json::to_vec_pretty(&value).unwrap();assert!(raw.len()<=4*1024*1024);std::fs::write(path,raw).unwrap();
 }
}
#[test]fn owned_pavilion_exact_source_helper_never_mutates_parameters_or_plan(){
 let _mode=OwnedReplayMode::new(true);let input=real("0012");let owned=input.incumbent.resolved.unpack().unwrap();let before=serde_json::to_vec(&owned).unwrap();
 let dims=owned_replay_dimensions_for_test(&input.site,&owned).expect("source-valid actual owned descriptor");assert!(dims[0]<14.&&dims[1]<14.);assert_eq!(serde_json::to_vec(&owned).unwrap(),before);
 let catalog=catalogue().unwrap();let source=&catalog.recipes.iter().find(|r|r.id==input.incumbent.recipe_id).unwrap().parameters;assert_eq!(source.width_m,[14.,22.]);assert_eq!(source.depth_m,[14.,22.]);
}
#[test]fn owned_pavilion_real_counter_ratio_2918_keeps_legacy_path(){
 let input=real("0099");let owned=input.incumbent.resolved.unpack().unwrap();let b=bounds(&owned.plan.bodies[0].footprint);assert!((b[2]-b[0])/(b[3]-b[1])>2.9);
 let _mode=OwnedReplayMode::new(true);assert!(owned_replay_dimensions_for_test(&input.site,&owned).is_none());
 let before={let _off=OwnedReplayMode::new(false);assemble_pair(input).unwrap()};let after=assemble_pair(real("0099")).unwrap();budget(report(&after));assert_eq!(payload(&before),payload(&after));assert_eq!(report(&before).necessary_checks,report(&after).necessary_checks);
}
#[test]fn owned_pavilion_manual_borrowed_or_pinned_floor_zero_member_work(){
 for kind in ["recipe","borrowed","floors"]{
  let _mode=OwnedReplayMode::new(true);let mut input=real("0012");match kind{"recipe"=>input.site.config.as_mut().unwrap().recipe=Some(input.incumbent.recipe_id.clone()),"borrowed"=>input.site.culture.borrowing=Some("another-tradition".into()),_=>input.site.config.as_mut().unwrap().overrides.floors=Some(2)}
  let original=serde_json::to_vec(&input.incumbent).unwrap();let decision=assemble_pair(input).unwrap();let AssemblyDecision::Retained{building,report}=decision else{panic!("explicit/foreign controls cannot open fallback")};
  assert_eq!(serde_json::to_vec(&building).unwrap(),original);budget(&report);assert_eq!((report.necessary_checks,report.new_body_rebuilds,report.new_native_preparations,report.new_admissions),(0,0,0,0));
 }
}
#[test]fn owned_pavilion_existing_successful_group_is_bit_exact_and_budget_complete(){
 let before={let _off=OwnedReplayMode::new(false);assemble_pair(synthetic_input()).unwrap()};let after={let _on=OwnedReplayMode::new(true);assemble_pair(synthetic_input()).unwrap()};
 let AssemblyDecision::Assembled{archive:a,report:ar,..}=&before else{panic!("old native group must succeed")};let AssemblyDecision::Assembled{archive:b,report:br,..}=&after else{panic!("old successful group cannot be replaced")};
 assert_eq!(serde_json::to_vec(a).unwrap(),serde_json::to_vec(b).unwrap());budget(ar);budget(br);assert_eq!(ar.necessary_checks,8);assert_eq!(br.necessary_checks,8);assert_eq!(ar.new_body_rebuilds,1);assert_eq!(br.new_body_rebuilds,1);assert_eq!(serde_json::to_vec(&ar.necessary).unwrap(),serde_json::to_vec(&br.necessary).unwrap());
}
