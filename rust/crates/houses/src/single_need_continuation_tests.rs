//! Real transported native batch witnesses; all baselines keep incumbent growth ON.
use super::*;
use sha2::{Digest,Sha256};
use serde_json::Value;
#[derive(Deserialize)]struct Buildings{buildings:Vec<PlanBuilding>}
const GAIN:&[u8]=include_bytes!("../tests/fixtures/single-need-postbatch-java-0002.json");
const LOSS:&[u8]=include_bytes!("../tests/fixtures/single-need-postbatch-java-0080.json");
const REFERENCE:&str=include_str!("../tests/fixtures/single-need-postbatch-java-reference.json");
fn input(bytes:&[u8])->PlanBatchRequest {serde_json::from_slice(bytes).unwrap()}
fn digest(bytes:&[u8])->String {format!("{:x}",Sha256::digest(bytes))}
fn run(input:PlanBatchRequest,enabled:bool)->Result<Vec<u8>,String>{
    let _incumbent=single_incumbent_growth::Mode::new(true);
    let _need=Mode::new(enabled);
    plan_batch(input).map(|b|serde_json::to_vec(&b).unwrap())
}
#[test]
fn need_postbatch_real_gain_batch_retains_exact_validated_transport(){
    let meta:Value=serde_json::from_str(REFERENCE).unwrap();
    assert_eq!(digest(GAIN),meta["batches"]["0002"]["requestSha256"]);
    assert!(supported_batch(&input(GAIN)));
    let baseline=run(input(GAIN),false).unwrap();
    assert_eq!(digest(&baseline),meta["batches"]["0002"]["expectedBaselineSha256"]);
    let mut capture=Capture::new();
    let candidate=run(input(GAIN),true).unwrap();
    assert_eq!(digest(&candidate),meta["batches"]["0002"]["expectedCandidateSha256"]);
    let events=capture.take();assert!(events.iter().any(|e|e["route"]["replaced"]==true));
    for e in events {for(key,ok)in e["checks"].as_object().unwrap(){assert_eq!(*ok,Value::Bool(true),"{key}: {e}");}}
}
#[test]
fn need_postbatch_real_regression_witness_is_the_exact_final_incumbent(){
    let meta:Value=serde_json::from_str(REFERENCE).unwrap();
    assert_eq!(digest(LOSS),meta["batches"]["0080"]["requestSha256"]);
    let baseline=run(input(LOSS),false).unwrap();let candidate=run(input(LOSS),true).unwrap();
    assert_eq!(digest(&candidate),meta["batches"]["0080"]["expectedCandidateSha256"]);
    let old:Buildings=serde_json::from_slice(&baseline).unwrap();let new:Buildings=serde_json::from_slice(&candidate).unwrap();
    let id="layout-f9dab5910f08a8a2/block-31745d27dc35f39a/parcel-03e9d3cd725f0063/building";
    let a=old.buildings.iter().find(|b|b.id==id).unwrap();let b=new.buildings.iter().find(|b|b.id==id).unwrap();
    assert_eq!(serde_json::to_vec(a).unwrap(),serde_json::to_vec(b).unwrap());
    assert!(a.resolved.has_retained_entrance());
    // Decoder here deliberately matches the original request/CLI codec. Entire
    // transport hash above proves the exact stored shape, without an epsilon.
    assert!(area(&a.footprint)>28. && area(&a.footprint)<29.);
}
#[test]
fn need_postbatch_c1358_without_need_preserves_existing_growth_whole_batch(){
    #[derive(Deserialize)]struct F{request:PlacementRequest,preceding_batch_requests:Vec<PlacementRequest>}
    let f:F=serde_json::from_slice(include_bytes!("../tests/fixtures/single-incumbent-c1358.json")).unwrap();
    let id=f.request.id.clone();let mut requests=f.preceding_batch_requests;requests.push(f.request);
    assert!(requests.iter().all(|r|r.programme.as_ref().is_none_or(|p|p.housing_floor_need.is_none())));
    let input=PlanBatchRequest{schema_version:"1".into(),requests,settings:None,footprints:BTreeMap::new()};
    assert!(!supported_batch(&input));let baseline=run(input.clone(),false).unwrap();
    let mut capture=Capture::new();let candidate=run(input,true).unwrap();assert_eq!(baseline,candidate);assert!(capture.take().is_empty());
    let b:Buildings=serde_json::from_slice(&candidate).unwrap();let target=b.buildings.iter().find(|b|b.id==id).unwrap();
    assert!(area(&target.footprint)>12. && target.resolved.has_retained_entrance(),"old incumbent recovery must remain ON");
}
fn one()->PlanBatchRequest{let mut a=input(GAIN);a.requests.truncate(1);a}
#[test]
fn need_postbatch_explicit_headers_and_pins_remain_old_exact(){
    let mut cases=Vec::new();
    let mut a=one();a.settings.as_mut().unwrap().floors=Some(1);cases.push(("header floors",a));
    let mut a=one();a.settings.as_mut().unwrap().typology=Some(ArchitectureTypology::Detached);cases.push(("header typology",a));
    let mut a=one();a.settings.as_mut().unwrap().house_config=a.requests[0].config.clone();cases.push(("header house config",a));
    let mut a=one();a.requests[0].config.as_mut().unwrap().overrides.floors=Some(1);cases.push(("request override",a));
    let mut a=one();a.requests[0].config.as_mut().unwrap().variation=0.4;cases.push(("request variation",a));
    let mut a=one();a.requests[0].typology=Some(ArchitectureTypology::Detached);cases.push(("request typology",a));
    let mut a=one();a.footprints.insert(a.requests[0].id.clone(),a.requests[0].buildable.clone());cases.push(("explicit footprint",a));
    let mut a=one();a.requests[0].config.as_mut().unwrap().recipe=Some("AS-ISL-B14".into());cases.push(("recipe pin",a));
    let mut a=one();a.requests[0].config.as_mut().unwrap().overrides.variant=Some("default".into());cases.push(("variant pin",a));
    let mut a=one();a.settings.as_mut().unwrap().parcel_fit=Some(false);cases.push(("disabled parcel fit",a));
    for(label,a)in cases{assert!(!supported_batch(&a),"{label}");let baseline=run(a.clone(),false);let mut capture=Capture::new();
        let candidate=run(a,true);assert_eq!(baseline,candidate,"{label}: no new error, geometry, diagnostic or access");assert!(capture.take().is_empty(),"{label}");}
}
#[test]
fn need_postbatch_no_or_invalid_need_never_enters_pass(){
    let mut a=one();a.requests[0].programme.as_mut().unwrap().housing_floor_need=None;
    assert!(!supported_batch(&a));assert_eq!(run(a.clone(),false),run(a,true));
    let mut a=one();a.requests[0].programme.as_mut().unwrap().housing_floor_need.as_mut().unwrap().requested_m2=f64::NAN;
    assert!(!supported_batch(&a));assert_eq!(run(a.clone(),false),run(a,true));
}

#[test]
fn need_postbatch_mixed_batch_preserves_core_functional_pins_exactly(){
    let request=input(GAIN);assert!(supported_batch(&request));
    let pinned:Vec<_>=request.requests.iter().filter(|r|r.config.as_ref().is_some_and(|c|c.recipe.is_some())).cloned().collect();
    assert_eq!(pinned.len(),3,"frozen Core batch0002 includes three functional recipe+floor pins");
    for r in &pinned{
        assert!(!matches!(r.function,ArchitectureFunction::Domestic|ArchitectureFunction::Mixed));
        assert_eq!(r.config.as_ref().unwrap().recipe.as_deref(),Some("AS-ISL-B14"));
        assert_eq!(r.config.as_ref().unwrap().overrides.floors,Some(1));
        assert!(!enabled_for(r,None,false),"functional pins must never enter the new construction route");
    }
    let old=run(request.clone(),false).unwrap();let mut capture=Capture::new();
    let new=run(request,true).unwrap();let events=capture.take();
    assert!(events.iter().any(|e|e["route"]["replaced"]==true));
    let old:Buildings=serde_json::from_slice(&old).unwrap();let new:Buildings=serde_json::from_slice(&new).unwrap();
    for r in pinned{
        if let Some(a)=old.buildings.iter().find(|b|b.id==r.id){
            let b=new.buildings.iter().find(|b|b.id==r.id).unwrap();
            assert_eq!(serde_json::to_vec(a).unwrap(),serde_json::to_vec(b).unwrap());
            let e=events.iter().find(|e|e["id"]==r.id).unwrap();
            for key in ["source_resolutions","dimension_checks","terrain_evaluations","body_plan_constructions","native_preparations","admissions"]{
                assert_eq!(e["route"][key],0,"functional pin attempted {key}");
            }
            assert_eq!(e["old_final_sha256"],e["retained_final_sha256"]);
        }
    }
}
