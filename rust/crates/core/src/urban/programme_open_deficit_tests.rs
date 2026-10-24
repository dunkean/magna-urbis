//! Partial outcome transport regression on TWO real historical open requests.
//! No accepted compact-plan building is replayed or credited as capacity.
use super::*;
use serde_json::{json, Value};

const HORREUM: &str = "layout-f9dab5910f08a8a2/block-534caa150eda7de7/parcel-ffd73c3204267a37";
const TEMPLE: &str = "layout-f9dab5910f08a8a2/block-fec2c1fd938da55b/parcel-2c651ca5f91cb329";
fn fixture() -> (Vec<Partition>, Vec<Value>, BuiltScene) {
    let partitions = serde_json::from_slice(include_bytes!("fixtures/open-deficit-roman04-partitions.json")).unwrap();
    let requests = serde_json::from_slice(include_bytes!("fixtures/open-deficit-roman04-requests.json")).unwrap();
    let a: Value = serde_json::from_slice(include_bytes!("fixtures/open-deficit-roman04-houses00.json")).unwrap();
    let b: Value = serde_json::from_slice(include_bytes!("fixtures/open-deficit-roman04-houses01.json")).unwrap();
    let open: Vec<_> = [a,b].iter().flat_map(|s| s["open_spaces"].as_array().unwrap())
        .filter(|s| [HORREUM,TEMPLE].contains(&s["parcel_id"].as_str().unwrap())).cloned().collect();
    assert_eq!(open.len(),2);
    let scene = serde_json::from_value(json!({"buildings":[],"refusals":[],"open_spaces":open})).unwrap();
    (partitions,requests,scene)
}
fn snapshot<T: Serialize>(v: &T) -> Vec<u8> { serde_json::to_vec(v).unwrap() }

#[test]
fn open_deficit_real_roman04_partial_chain_keeps_warehouse_and_collective_demand_with_zero_credit() {
    let (partitions,requests,scene) = fixture();
    assert!(reconcile_built(&partitions,&scene).is_err(),"legacy non-attested import remains rejected");
    let before = snapshot(&partitions);
    let carried = carry_open_deficits(&partitions,&scene,&requests).unwrap();
    assert!(carried.buildings.is_empty() && carried.refusals.is_empty());
    for old in &scene.open_spaces {
        let kept=carried.open_spaces.iter().find(|s|s.parcel_id==old.parcel_id).unwrap();
        assert_eq!(old.id,kept.id);assert_eq!(snapshot(&old.surface),snapshot(&kept.surface));
    }
    let result = reconcile_built(&partitions,&carried).unwrap();
    assert_eq!(before,snapshot(&partitions),"caller partitions are immutable");
    for (parcel,role,function,cause,requested) in [
        (HORREUM,"storage.horreum","warehouse","source_absente","1077.528010406445"),
        (TEMPLE,"worship.temple","collective","pente","810.9243748081782"),
    ] {
        let origin = partitions[0].programme.as_ref().unwrap();
        let allocation = origin.allocations.iter().find(|a|a.parcel_id==parcel).unwrap();
        let old = origin.demands.iter().find(|d|d.id==allocation.demand_id).unwrap();
        let demand = result[0].programme.as_ref().unwrap().demands.iter().find(|d|d.id==allocation.demand_id).unwrap();
        let evidence = carried.open_spaces.iter().find(|s|s.parcel_id==parcel).unwrap().deficit.as_ref().unwrap();
        assert_eq!(evidence.original_function,function);assert_eq!(evidence.role,role);assert_eq!(evidence.cause,cause);
        assert_eq!(old.requested,demand.requested);assert_eq!(old.requested,serde_json::from_str::<f64>(requested).unwrap());
        assert_eq!(demand.built_capacity,0.);assert_eq!(demand.open_capacity,0.);assert_eq!(demand.deficit,demand.requested);
        assert_eq!(old.parcel_capacity,demand.parcel_capacity);assert_eq!(old.unit,demand.unit);
        assert_eq!(old.provenance,demand.provenance);assert_eq!(old.function,demand.function);assert_eq!(old.role,demand.role);
        assert!(demand.reasons.iter().any(|r|r.starts_with("Architectural deficit: ") && r.contains(cause) && r.contains(function)));
        for reason in &old.reasons {assert!(demand.reasons.contains(reason));}
    }
    let second = reconcile_built(&result,&carried).unwrap();assert_eq!(snapshot(&result),snapshot(&second),"reconciliation idempotent");
    assert_eq!(snapshot(&carried),snapshot(&carry_open_deficits(&partitions,&carried,&requests).unwrap()),"transport idempotent");
}

#[test]
fn open_deficit_missing_or_wrong_source_request_is_rejected_without_mutation() {
    let (partitions,requests,scene) = fixture();let part_before=snapshot(&partitions);let scene_before=snapshot(&scene);
    let mut missing=requests.clone();missing.retain(|r|r["parcel_id"]!=HORREUM);
    assert!(carry_open_deficits(&partitions,&scene,&missing).is_err());
    let mut wrong=requests.clone();wrong.iter_mut().find(|r|r["parcel_id"]==HORREUM).unwrap()["programme"]["role"]=json!("storage.granary");
    assert!(carry_open_deficits(&partitions,&scene,&wrong).is_err());
    let mut wrong=requests.clone();wrong.iter_mut().find(|r|r["parcel_id"]==HORREUM).unwrap()["programme"]["deficit"]=Value::Null;
    assert!(carry_open_deficits(&partitions,&scene,&wrong).is_err());
    let mut wrong=requests.clone();wrong.iter_mut().find(|r|r["parcel_id"]==HORREUM).unwrap()["function"]=json!("warehouse");
    assert!(carry_open_deficits(&partitions,&scene,&wrong).is_err());
    let mut wrong=requests.clone();wrong.iter_mut().find(|r|r["parcel_id"]==HORREUM).unwrap()["programme"]["source_coverage"]["functional_footing_tested"]=json!(true);
    assert!(carry_open_deficits(&partitions,&scene,&wrong).is_err());
    assert_eq!(part_before,snapshot(&partitions));assert_eq!(scene_before,snapshot(&scene));
}

#[test]
fn open_deficit_forged_attestation_role_function_demand_and_request_identity_are_rejected() {
    let (partitions,requests,scene)=fixture();let carried=carry_open_deficits(&partitions,&scene,&requests).unwrap();
    let original=snapshot(&partitions);
    for field in ["version","request_id","demand_id","original_function","role","cause"] {
        let mut v=serde_json::to_value(&carried).unwrap();v["open_spaces"][0]["deficit"][field]=json!("forged");
        let bad:BuiltScene=serde_json::from_value(v).unwrap();assert!(reconcile_built(&partitions,&bad).is_err(),"{field}");
        assert!(carry_open_deficits(&partitions,&bad,&requests).is_err(),"{field}");
    }
    let mut bad=carried.clone();bad.open_spaces[0].deficit.as_mut().unwrap().households=1.;
    assert!(reconcile_built(&partitions,&bad).is_err());
    let mut bad=carried.clone();bad.open_spaces[0].deficit.as_mut().unwrap().message.push_str(" forged");
    assert!(carry_open_deficits(&partitions,&bad,&requests).is_err());
    let mut bad=carried.clone();bad.open_spaces[0].id=Some("old-import".into());assert!(reconcile_built(&partitions,&bad).is_err());
    let mut changed=partitions.clone();changed[0].programme.as_mut().unwrap().demands.iter_mut().find(|d|d.role=="storage.horreum").unwrap().role="storage.granary".into();
    assert!(reconcile_built(&changed,&carried).is_err());
    assert_eq!(original,snapshot(&partitions));
}

#[test]
fn open_deficit_transaction_keeps_inputs_whole_when_a_later_outcome_is_invalid() {
    let (partitions,requests,scene)=fixture();let carried=carry_open_deficits(&partitions,&scene,&requests).unwrap();
    let before=snapshot(&partitions);let mut bad=carried.clone();
    bad.open_spaces[1].deficit.as_mut().unwrap().demand_id="unrelated/demand".into();
    assert!(reconcile_built(&partitions,&bad).is_err());assert_eq!(before,snapshot(&partitions));
    bad=carried.clone();bad.open_spaces.push(bad.open_spaces[0].clone());
    assert!(reconcile_built(&partitions,&bad).is_err());assert_eq!(before,snapshot(&partitions));
    bad=carried.clone();bad.open_spaces[1].surface=vec![super::super::geometry::rectangle(0.,0.,10.,10.)];
    assert!(reconcile_built(&partitions,&bad).is_err());assert_eq!(before,snapshot(&partitions));
    bad=carried.clone();bad.buildings.push(BuiltCapacity{parcel_id:bad.open_spaces[0].parcel_id.clone(),function:bad.open_spaces[0].deficit.as_ref().unwrap().original_function.clone(),useful_area_m2:100.,domestic_units:0.});
    assert!(reconcile_built(&partitions,&bad).is_err());assert_eq!(before,snapshot(&partitions));
    let good=reconcile_built(&partitions,&carried).unwrap();
    assert_eq!(snapshot(&good),snapshot(&reconcile_built(&partitions,&carried).unwrap()));
}

#[test]
fn open_deficit_legacy_market_and_common_without_attestation_keep_their_real_open_credit() {
    let (partitions,_,_)=fixture();
    for function in ["market","common"] {
        let p=&partitions[0];let pr=p.programme.as_ref().unwrap();
        let a=pr.allocations.iter().find(|a|a.function==function).unwrap();
        let parcel=p.parcels.iter().find(|p|p.id==a.parcel_id).unwrap();
        let scene=BuiltScene{buildings:vec![],refusals:vec![],open_spaces:vec![BuiltOpenSpace{id:None,parcel_id:a.parcel_id.clone(),surface:vec![parcel.shape.clone()],deficit:None}]};
        let result=reconcile_built(&partitions,&scene).unwrap();
        let demand=result[0].programme.as_ref().unwrap().demands.iter().find(|d|d.id==a.demand_id).unwrap();
        assert_eq!(demand.built_capacity,0.);assert!(demand.open_capacity>0.);
        assert_eq!(demand.deficit,(demand.requested-demand.open_capacity).max(0.));
        assert_eq!(snapshot(&scene),snapshot(&carry_open_deficits(&partitions,&scene,&[]).unwrap()));
    }
}
