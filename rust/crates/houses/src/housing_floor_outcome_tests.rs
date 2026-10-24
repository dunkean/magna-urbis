use super::*;
use crate::geometry::{rectangle, unite};
use crate::model::Surface;
use crate::placement::{ArchitectureFunction, ArchitectureVolume, PlacementRequest, VolumeLevel};
use crate::plans::{PlanBatchRequest, PlanProgrammeOutcome, plan_batch};
use crate::programme::{ArchitectureProgramme, HousingFloorModel, HousingFloorNeed};
use serde::Deserialize;

#[derive(Deserialize)]
struct Fixture { request: PlacementRequest, retained_building: PlanBuilding }
fn fixture() -> Fixture {
    serde_json::from_str(include_str!("../tests/fixtures/programme-outcome-c1358.json")).unwrap()
}
fn need(households: f64, wealth: f64) -> HousingFloorNeed {
    let factor = 0.7 + 0.8*wealth;
    HousingFloorNeed { version:"indicative-housing-floor-1".into(), unit:"useful_floor_m2".into(),
        scope:"housing_in_body_levels".into(), requested_m2:households*60.*factor,
        allocated_households:households, basis:"allocation_households_times_wealth_scaled_floor_allowance".into(),
        model:HousingFloorModel { family:"insular".into(), profile_provenance:"generic-compatibility-defaults".into(),
            calibration:"not-culture-calibrated".into(), floor_m2_per_household:60., wealth,
            wealth_factor:factor, effective_floor_m2_per_household:60.*factor, persons_per_household:4.5 } }
}
fn model(request: &mut PlacementRequest) {
    request.programme.as_mut().unwrap().housing_floor_need = Some(need(3., 0.25));
}
fn volume(id: &str, levels: Vec<(Surface, f64, f64)>) -> ArchitectureVolume {
    let mut value = fixture().retained_building.volumes.remove(0);
    value.id=id.into(); value.z_m=levels[0].1;
    value.wall_height_m=levels.iter().map(|l|l.2).sum();
    value.footprint=unite(&levels.iter().map(|l|l.0.clone()).collect::<Vec<_>>());
    value.levels=levels.into_iter().enumerate().map(|(i,(footprint,z_m,height_m))|
        VolumeLevel { index:i as u32,footprint,z_m,height_m,materials:None }).collect();
    value
}
fn building(volumes: Vec<ArchitectureVolume>) -> PlanBuilding {
    let mut b=fixture().retained_building;
    b.footprint=unite(&volumes.iter().flat_map(|v|v.levels.iter().map(|l|l.footprint.clone())).collect::<Vec<_>>());
    b.volumes=volumes; b
}
fn outcome(b: &PlanBuilding) -> HousingFloorOutcome { HousingFloorOutcome::from_final_plan(&need(3.,0.25),b) }
fn measured(b: &PlanBuilding) -> f64 {
    let report=outcome(b);
    assert_eq!(report.inventory_status,"retained_plan_levels", "{:?}",report.inventory_limitation);
    assert_eq!(report.actual_useful_m2,None);
    assert_eq!(report.functional_certification,"unknown");
    report.gross_floor_m2.unwrap()
}

#[test]
fn housing_floor_outcome_heterogeneous_levels_and_missing_upper_level() {
    let mut b=building(vec![volume("body",vec![(rectangle(0.,0.,10.,10.),0.,2.7),
        (rectangle(0.,0.,6.,10.),2.7,4.)])]);
    assert!((measured(&b)-160.).abs()<1e-9);
    let r=outcome(&b);
    assert_eq!(r.necessary_area_status,NecessaryHousingAreaStatus::InsufficientGross);
    assert!((r.useful_shortfall_lower_bound_m2.unwrap()-2.).abs()<1e-9);
    b.volumes[0].levels.pop(); // wall height still records the missing level
    let missing=outcome(&b);
    assert_eq!(missing.necessary_area_status,NecessaryHousingAreaStatus::Unknown);
    assert_eq!(missing.gross_floor_m2,None);
    assert_eq!(missing.useful_shortfall_lower_bound_m2,None);
}

#[test]
fn housing_floor_outcome_unions_coplanar_components_but_sums_distinct_elevations() {
    let a=volume("a",vec![(rectangle(0.,0.,8.,10.),0.,3.)]);
    let b=volume("b",vec![(rectangle(6.,0.,6.,10.),-0.,3.)]);
    assert!((measured(&building(vec![a.clone(),b.clone()]))-120.).abs()<1e-9);
    let mut raised=b.clone(); raised.z_m=3.;raised.levels[0].z_m=3.;
    assert!((measured(&building(vec![a.clone(),raised]))-140.).abs()<1e-9);
    // A nearby, but distinct, actual plane must never be merged by epsilon.
    let mut split=b; split.z_m=0.000_000_000_1; split.levels[0].z_m=split.z_m;
    assert!((measured(&building(vec![a,split]))-140.).abs()<1e-9);
}

#[test]
fn housing_floor_outcome_preserves_holes_annexes_and_raised_or_sunken_bases() {
    let mut holed=rectangle(0.,0.,10.,10.);
    holed[0].holes.push(rectangle(2.,2.,4.,4.)[0].outer.clone());
    let mut b=building(vec![volume("main",vec![(holed,2.,3.)]),
        volume("annex",vec![(rectangle(12.,0.,4.,5.),-2.4,3.)])]);
    // Exact body levels:84+20. Neither base elevation nor a garden/roof is area.
    b.courtyards=rectangle(-100.,-100.,1000.,1000.);
    b.circulation=b.courtyards.clone();b.roof_footprint=b.courtyards.clone();
    b.useful_area_m2=99999.; b.domestic_units=99;
    assert!((measured(&b)-104.).abs()<1e-9);
    assert_eq!(outcome(&b).actual_useful_m2,None);
}

#[test]
fn housing_floor_outcome_sufficient_gross_never_certifies_useful_or_households() {
    let b=building(vec![volume("mixed_and_common",vec![(rectangle(0.,0.,20.,10.),0.,3.)])]);
    let r=outcome(&b);
    assert_eq!(r.necessary_area_status,NecessaryHousingAreaStatus::NotDisprovedByGross);
    assert_eq!(r.useful_shortfall_lower_bound_m2,Some(0.));
    assert_eq!(r.actual_useful_m2,None);
    assert_eq!(r.functional_certification,"unknown");
}

#[test]
fn housing_floor_outcome_missing_nonfinite_or_unmatched_inventory_is_unknown() {
    let valid=building(vec![volume("body",vec![(rectangle(0.,0.,10.,10.),0.,3.)])]);
    let mut cases=vec![];
    let mut b=valid.clone(); b.volumes.clear(); cases.push(b);
    let mut b=valid.clone(); b.volumes[0].levels[0].z_m=f64::NAN; cases.push(b);
    let mut b=valid.clone(); b.volumes[0].levels[0].height_m=0.; cases.push(b);
    let mut b=valid.clone(); b.volumes[0].levels[0].footprint.clear(); cases.push(b);
    let mut b=valid.clone(); b.footprint=rectangle(0.,0.,12.,10.); cases.push(b);
    let mut b=valid.clone(); b.volumes.push(b.volumes[0].clone()); cases.push(b);
    for b in cases {
        let r=outcome(&b); assert_eq!(r.gross_floor_m2,None);
        assert_eq!(r.necessary_area_status,NecessaryHousingAreaStatus::Unknown);
        assert_eq!(r.useful_shortfall_lower_bound_m2,None);
        assert!(r.inventory_limitation.is_some());
    }
}

#[test]
fn housing_floor_need_validation_accepts_f64_roundtrip_and_old_display_rounding() {
    let mut p=ArchitectureProgramme {households:Some(2.35), housing_floor_need:Some(need(2.345,0.25)),..Default::default()};
    p.validate().unwrap();
    let n=p.housing_floor_need.as_mut().unwrap();
    n.allocated_households=f64::from_bits(n.allocated_households.to_bits()-1);
    n.model.wealth_factor=f64::from_bits(n.model.wealth_factor.to_bits()+1);
    // The transmitted requested/effective scalars remain a valid roundtrip of
    // the original arithmetic, rather than being recalculated by the receiver.
    let encoded=serde_json::to_vec(&p).unwrap();
    let decoded:ArchitectureProgramme=serde_json::from_slice(&encoded).unwrap();
    decoded.validate().unwrap();
    assert!(!decoded.has_wishes());
    let mut r=fixture().request;model(&mut r);r.function=ArchitectureFunction::Mixed;
    crate::plans::validate_request(&r).unwrap();
    r.function=ArchitectureFunction::Warehouse;
    assert!(crate::plans::validate_request(&r).unwrap_err().contains("housing_floor_need"));
}

#[test]
fn housing_floor_need_validation_rejects_inconsistent_models_explicitly() {
    let base=need(3.,0.25); let mut bad=vec![];
    let mut n=base.clone();n.unit="footprint_m2".into();bad.push(n);
    let mut n=base.clone();n.scope="entire_parcel".into();bad.push(n);
    let mut n=base.clone();n.version="future-unknown".into();bad.push(n);
    let mut n=base.clone();n.model.profile_provenance.clear();bad.push(n);
    let mut n=base.clone();n.requested_m2=617.9;bad.push(n);
    let mut n=base.clone();n.model.effective_floor_m2_per_household=60.;bad.push(n);
    let mut n=base.clone();n.model.wealth=f64::NAN;bad.push(n);
    let mut n=base.clone();n.allocated_households=2.;bad.push(n);
    for n in bad {
        let p=ArchitectureProgramme {households:Some(3.),housing_floor_need:Some(n),..Default::default()};
        assert!(p.validate().unwrap_err().contains("housing_floor_need"));
    }
    let missing=ArchitectureProgramme {housing_floor_need:Some(base),..Default::default()};
    assert!(missing.validate().is_err());
}

#[test]
fn housing_floor_outcome_c1358_old_model_is_not_inferred_and_new_report_is_additive() {
    let mut f=fixture();
    let old=PlanProgrammeOutcome::from_final_plan(&f.request,&f.retained_building);
    let before=serde_json::to_value(&old).unwrap();
    assert!(before.get("housing_floor").is_none());
    let restored:PlanProgrammeOutcome=serde_json::from_value(before.clone()).unwrap();
    assert_eq!(serde_json::to_value(restored).unwrap(),before);
    model(&mut f.request);
    let r=PlanProgrammeOutcome::from_final_plan(&f.request,&f.retained_building);
    assert_eq!(r.body_footprint.requested_m2,Some(617.9));
    assert_eq!(r.households.requested,Some(3.));assert_eq!(r.households.housed,None);
    let h=r.housing_floor.as_ref().unwrap();
    assert!((h.gross_floor_m2.unwrap()-4.0602250024).abs()<1e-7);
    assert!((h.useful_shortfall_lower_bound_m2.unwrap()-157.9397749976).abs()<1e-7);
    assert_eq!(h.actual_useful_m2,None);
    let mut after=serde_json::to_value(&r).unwrap();after.as_object_mut().unwrap().remove("housing_floor");
    assert_eq!(after,before);
    // Ignore an intentionally stale report and stale nominal/useful scalars.
    f.retained_building.programme_outcome=Some(r);
    f.retained_building.useful_area_m2=9000.;
    assert!((PlanProgrammeOutcome::from_final_plan(&f.request,&f.retained_building)
        .housing_floor.unwrap().gross_floor_m2.unwrap()-4.0602250024).abs()<1e-7);
}

#[test]
fn housing_floor_outcome_real_batch_finalization_preserves_all_older_fields() {
    let old_request=fixture().request;
    let run=|request|plan_batch(PlanBatchRequest {schema_version:"1".into(),requests:vec![request],
        settings:None,footprints:Default::default()}).unwrap();
    let old=run(old_request.clone());
    let mut new_request=old_request;model(&mut new_request);
    if let Ok(path)=std::env::var("CORE_HOUSING_FLOOR_NEED_IN") {
        new_request.programme.as_mut().unwrap().housing_floor_need=Some(
            serde_json::from_slice(&std::fs::read(path).unwrap()).unwrap());
    }
    let new=run(new_request.clone());
    // Optional evidence for the central runner; no author execution required.
    if let Ok(path)=std::env::var("HOUSES_HOUSING_FLOOR_OUT") {
        std::fs::write(path,serde_json::to_vec_pretty(&serde_json::json!({
            "scope":"same C1358 request; only explicit indicative allocation model added",
            "new_request":&new_request,"old_output":&old,"new_output":&new,
        })).unwrap()).unwrap();
    }
    let b=new.buildings.first().expect("C1358 retains its original admission");
    let report=b.programme_outcome.as_ref().unwrap();
    assert_eq!(*report,PlanProgrammeOutcome::from_final_plan(&new_request,b));
    assert!(report.housing_floor.as_ref().unwrap().gross_floor_m2.is_some());
    assert_eq!(report.households.housed,None);
    let mut newer=serde_json::to_value(&new).unwrap();
    for b in newer["buildings"].as_array_mut().unwrap() {
        b["programme_outcome"].as_object_mut().unwrap().remove("housing_floor");
    }
    assert_eq!(newer,serde_json::to_value(&old).unwrap());
}

// Actual Java100k native output, all f64 scalars stored as bits. This decoder
// avoids decimal parser roundtrip drift; it does not change any geometry.
fn java_inventory_fixture(text: &str) -> PlanBuilding {
    fn decode(v: &mut serde_json::Value) {
        match v {
            serde_json::Value::Object(o) if o.len() == 1 && o.contains_key("$f64") => {
                let bits = u64::from_str_radix(o["$f64"].as_str().unwrap(), 16).unwrap();
                *v = serde_json::Value::Number(serde_json::Number::from_f64(f64::from_bits(bits)).unwrap());
            }
            serde_json::Value::Object(o) => o.values_mut().for_each(decode),
            serde_json::Value::Array(a) => a.iter_mut().for_each(decode),
            _ => {}
        }
    }
    let mut value: serde_json::Value = serde_json::from_str(text).unwrap();
    decode(&mut value);
    serde_json::from_value(value).unwrap()
}
fn java_inventory_fixtures() -> Vec<PlanBuilding> {
    [include_str!("../tests/fixtures/housing-inventory-java-as-isl-b06.json"),
        include_str!("../tests/fixtures/housing-inventory-java-as-isl-b14.json"),
        include_str!("../tests/fixtures/housing-inventory-java-as-isl-b15.json")]
        .into_iter().map(java_inventory_fixture).collect()
}
#[test]
fn housing_floor_inventory_exact_source_witness_measures_real_java_levels() {
    for b in java_inventory_fixtures() {
        let old = b.programme_outcome.as_ref().unwrap().housing_floor.as_ref().unwrap();
        assert_eq!(old.inventory_limitation.as_deref(), Some("Retained levels do not reproduce the final body projection exactly."));
        assert_eq!(old.gross_floor_m2, None);
        assert_eq!(b.volumes.len(), 1); assert_eq!(b.volumes[0].levels.len(), 1);
        let level = &b.volumes[0].levels[0].footprint;
        assert_eq!(level, &b.volumes[0].footprint);
        assert_ne!(level, &b.footprint);
        assert!(!difference(level, &b.footprint).is_empty()
            || !difference(&b.footprint, level).is_empty());
        assert!(retained_source_inventory_matches(&b), "{}", b.id);
        let measured = HousingFloorOutcome::from_final_plan(&old.need_model, &b);
        assert_eq!(measured.gross_floor_m2.unwrap().to_bits(), area(level).to_bits());
        assert_eq!(measured.inventory_status, "retained_plan_levels");
        assert_eq!(measured.actual_useful_m2, None);
        assert_eq!(measured.functional_certification, "unknown");
    }
}
#[test]
fn housing_floor_inventory_source_witness_refuses_actual_inventory_mutations() {
    for b in java_inventory_fixtures() {
        let old = b.programme_outcome.as_ref().unwrap().housing_floor.as_ref().unwrap();
        let mut mutations = vec![];
        let mut bad=b.clone();bad.footprint[0].outer[0].x+=0.01;mutations.push(bad);
        let mut bad=b.clone();bad.volumes[0].levels[0].footprint[0].outer[0].x+=0.01;mutations.push(bad);
        let mut bad=b.clone();bad.volumes[0].levels.clear();mutations.push(bad);
        let mut bad=b.clone();bad.volumes[0].wall_height_m+=1.;mutations.push(bad);
        let mut bad=b.clone();bad.resolved.format="future-inventory".into();mutations.push(bad);
        for bad in mutations {
            assert!(!retained_source_inventory_matches(&bad));
            let measured=HousingFloorOutcome::from_final_plan(&old.need_model,&bad);
            assert_eq!(measured.gross_floor_m2,None);
            assert_eq!(measured.necessary_area_status,NecessaryHousingAreaStatus::Unknown);
        }
        // Even one changed bit is NOT accepted by the common-source witness.
        let mut bit=b.clone();let x=&mut bit.volumes[0].levels[0].footprint[0].outer[0].x;
        *x=f64::from_bits(x.to_bits()+1);
        assert!(!retained_source_inventory_matches(&bit));
    }
}
