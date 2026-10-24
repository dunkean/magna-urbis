use super::*;
use serde_json::{Value,json};
use std::time::Instant;

#[derive(Deserialize)]
struct Fixture { request:PlacementRequest,retained_building:PlanBuilding,preceding_admitted_buildings:Vec<PlanBuilding>,preceding_batch_requests:Vec<PlacementRequest> }
fn fixture()->Fixture {serde_json::from_str(include_str!("../tests/fixtures/single-incumbent-c1358.json")).unwrap()}
#[derive(Deserialize)]
struct Case {global_index:usize,request:PlacementRequest,preceding_admitted_buildings:Vec<PlanBuilding>}
#[derive(Deserialize)]
struct Cohort {eligible_count:usize,cases:Vec<Case>}
fn occupation(r:&PlacementRequest,buildings:&[PlanBuilding])->Surface {
    let mut index=OccupationIndex::default();
    for b in buildings {
        let mut parts=vec![b.footprint.clone(),b.courtyards.clone(),b.circulation.clone()];
        parts.extend(b.structural_features.iter().map(|f|f.surface.clone()));index.insert(unite(&parts));
    }
    index.local(&r.cadastral)
}
fn compare(index:usize,r:&PlacementRequest,previous:&[PlanBuilding])->Value {
    let occupied=occupation(r,previous);
    let start=Instant::now();
    let old={let _mode=Mode::new(false);plan_one(r,&occupied,None,false)};
    let old_ms=start.elapsed().as_secs_f64()*1000.;
    let start=Instant::now();
    let new={let _mode=Mode::new(true);plan_one(r,&occupied,None,false)};
    let new_ms=start.elapsed().as_secs_f64()*1000.;
    let mut row=json!({"global_index":index,"old_ms":old_ms,"new_ms":new_ms,
        "request_target_m2":r.programme.as_ref().and_then(|p|p.built_area_m2),
        "requested_households":r.programme.as_ref().and_then(|p|p.households),"housed_households":null});
    match (old,new) {
        (Ok(old),Ok(new))=>{
            let report=last_report().expect("pilot records an outcome for every admitted incumbent");
            row["old_area_m2"]=json!(area(&old.footprint));row["new_area_m2"]=json!(area(&new.footprint));
            row["old_native_entry"]=json!(old.resolved.has_retained_entrance());
            row["new_native_entry"]=json!(new.resolved.has_retained_entrance());
            row["same_source"]=json!(old.recipe_id==new.recipe_id&&old.variant_id==new.variant_id);
            row["same_orientation"]=json!(old.transform.orientation_deg.to_bits()==new.transform.orientation_deg.to_bits());
            row["old_source"]=json!(old.recipe_id);row["new_source"]=json!(new.recipe_id);
            let old_json=serde_json::to_value(&old).unwrap();let new_json=serde_json::to_value(&new).unwrap();
            row["unchanged_when_not_replaced"]=json!(report.replaced||old_json==new_json);
            let a=old.resolved.unpack().unwrap();let b=new.resolved.unpack().unwrap();
            row["same_config_and_seed"]=json!(serde_json::to_value(&a.config).unwrap()==serde_json::to_value(&b.config).unwrap());
            let mut ap=serde_json::to_value(&a.parameters).unwrap();let mut bp=serde_json::to_value(&b.parameters).unwrap();
            for key in ["width_m","depth_m"]{ap.as_object_mut().unwrap().remove(key);bp.as_object_mut().unwrap().remove(key);}
            row["same_non_dimension_parameters"]=json!(ap==bp);
            row["same_body_and_floor_counts"]=json!(a.plan.bodies.len()==b.plan.bodies.len()
                && a.plan.bodies.iter().zip(&b.plan.bodies).all(|(a,b)|a.levels.len()==b.levels.len()));
            row["route"]=json!(report);
            if index==1358 {row["request"]=json!(r);row["old_building"]=old_json;row["new_building"]=new_json;}
        },
        (Err(a),Err(b))=>{row["old_error"]=json!(a);row["new_error"]=json!(b);},
        (Ok(_),Err(error))=>{row["lost_admission"]=json!(error);},
        (Err(error),Ok(_))=>{row["unexpected_new_admission_after_old_error"]=json!(error);},
    }
    row
}
fn assert_preservation(row:&Value) {
    assert!(row.get("lost_admission").is_none(),"{row}");
    assert!(row.get("unexpected_new_admission_after_old_error").is_none(),"{row}");
    if row.get("old_error").is_some(){assert_eq!(row["old_error"],row["new_error"]);return;}
    assert!(row["new_area_m2"].as_f64().unwrap()+1e-7>=row["old_area_m2"].as_f64().unwrap(),"{row}");
    assert!(!row["old_native_entry"].as_bool().unwrap()||row["new_native_entry"].as_bool().unwrap(),"{row}");
    for field in ["same_source","same_orientation","same_config_and_seed","same_non_dimension_parameters",
        "same_body_and_floor_counts","unchanged_when_not_replaced"] {assert_eq!(row[field],true,"{field}: {row}");}
    for (field,cap) in [("dimension_checks",8),("terrain_evaluations",8),("body_plan_constructions",1),
        ("native_preparations",1),("admissions",1),("source_resolutions",0)] {
        assert!(row["route"][field].as_u64().unwrap()<=cap,"{field}: {row}");
    }
    if row["route"]["replaced"]==true {assert_eq!(row["new_native_entry"],true);}
    assert!(row["housed_households"].is_null());
}

#[test]
fn incumbent_growth_guards_and_adequate_mass_keep_exact_old_without_construction() {
    let f=fixture();
    assert!(enabled_for(&f.request,None,false));
    assert!(!enabled_for(&f.request,None,true));
    assert!(!enabled_for(&f.request,Some(&f.request.buildable),false));
    for kind in ["strict","recipe","floors","size","angle","fit","no_target"] {
        let mut r=f.request.clone();match kind {
            "strict"=>r.culture.mode=HistoricalMode::HistoricalStrict,
            "recipe"=>r.config.as_mut().unwrap().recipe=Some("AS-ISL-B06".into()),
            "floors"=>r.config.as_mut().unwrap().overrides.floors=Some(1),
            "size"=>r.config.as_mut().unwrap().size=1.1,
            "angle"=>r.config.as_mut().unwrap().orientation_deg=5.,
            "fit"=>r.parcel_fit=Some(false),
            _=>r.programme.as_mut().unwrap().built_area_m2=None,
        }
        assert!(!enabled_for(&r,None,false),"{kind}");
        let got=finish(&r,&vec![],f.retained_building.clone(),None,false);
        assert_eq!(serde_json::to_value(got).unwrap(),serde_json::to_value(&f.retained_building).unwrap());
        assert_eq!(last_report().unwrap().body_plan_constructions,0);
    }
    let mut r=f.request;r.programme.as_mut().unwrap().built_area_m2=Some(area(&f.retained_building.footprint));
    let got=finish(&r,&vec![],f.retained_building.clone(),None,false);
    assert_eq!(serde_json::to_value(got).unwrap(),serde_json::to_value(f.retained_building).unwrap());
    assert_eq!(last_report().unwrap().dimension_checks,0);
}

#[test]
fn incumbent_growth_native_minimum_route_never_buys_a_growth_attempt() {
    let f=fixture();let mut r=f.request;
    r.native_minimum_candidates=serde_json::from_value(json!([{
        "identity":{"version":"stale","catalogue_version":"stale","generator_version":"stale","style_index_version":"stale",
            "source_sha256":"stale","style_id":"AS-ISL-B06::default","recipe_id":"AS-ISL-B06","variant_id":"default","seed":"stale"},
        "transform":{"origin":{"x":0.,"y":0.},"orientation_deg":0.},"access_id":"stale","contact":{"x":0.,"y":0.}
    }])).unwrap();
    assert!(!enabled_for(&r,None,false));
    let got=finish(&r,&vec![],f.retained_building.clone(),None,false);
    assert_eq!(serde_json::to_value(got).unwrap(),serde_json::to_value(f.retained_building).unwrap());
    assert_eq!(last_report().unwrap().source_resolutions,0);
    assert_eq!(last_report().unwrap().native_preparations,0);
}

#[test]
fn incumbent_growth_anchor_keeps_existing_angle_and_nested_whole_geometry() {
    let f=fixture();let resolved=f.retained_building.resolved.unpack().unwrap();
    let body=&resolved.plan.bodies[0];let b=bounds(&body.footprint);
    let edge=anchor(&f.retained_building,b,body.parameters.wall_thickness_m[0]).unwrap();
    let dims=[snap((b[2]-b[0])*1.5),snap((b[3]-b[1])*1.5)];
    let transform=pose(&f.retained_building,b,dims,edge);
    assert_eq!(transform.orientation_deg.to_bits(),f.retained_building.transform.orientation_deg.to_bits());
    let larger=map_surface(&rectangle(0.,0.,dims[0],dims[1]),&transform);
    assert!(area(&difference(&f.retained_building.footprint,&larger))<0.0001);
    assert!(area(&larger)>area(&f.retained_building.footprint));
}

#[test]
fn incumbent_growth_exact_c1358_ab_records_native_gain_or_exact_incumbent_without_a_second_attempt() {
    let f=fixture();let row=compare(1358,&f.request,&f.preceding_admitted_buildings);
    if let Ok(path)=std::env::var("HOUSES_INCUMBENT_GROWTH_C1358_OUT") {
        std::fs::write(path,serde_json::to_vec_pretty(&row).unwrap()).unwrap();
    }
    eprintln!("{}",serde_json::to_string_pretty(&row["route"]).unwrap());
    assert_preservation(&row);
    assert!(row["old_area_m2"].as_f64().unwrap()<5.);
    assert_eq!(row["old_source"],"AS-ISL-B06");
    assert_eq!(row["request_target_m2"],617.9);
    // The public result is measured, never selected for a desired outcome.
    // Cohort test below requires a real gain before this tranche is useful.
}

#[test]
fn incumbent_growth_fixed_real_c_cohort_requires_a_measurable_native_mass_gain_and_zero_losses() {
    let f:Cohort=serde_json::from_str(include_str!("../tests/fixtures/single-incumbent-c-cohort.json")).unwrap();
    let rows:Vec<_>=f.cases.iter().map(|case|compare(case.global_index,&case.request,&case.preceding_admitted_buildings)).collect();
    let old:f64=rows.iter().filter_map(|r|r["old_area_m2"].as_f64()).sum();
    let new:f64=rows.iter().filter_map(|r|r["new_area_m2"].as_f64()).sum();
    let old_doors=rows.iter().filter(|r|r["old_native_entry"]==true).count();
    let new_doors=rows.iter().filter(|r|r["new_native_entry"]==true).count();
    let replaced=rows.iter().filter(|r|r["route"]["replaced"]==true).count();
    let document=json!({"scope":"Fixed original same-batch contexts; not a cumulative new city or population capacity estimate",
        "eligible_archive_count":f.eligible_count,"case_count":rows.len(),"old_mass_m2":old,"new_mass_m2":new,
        "mass_gain_m2":new-old,"old_native_entries":old_doors,"new_native_entries":new_doors,
        "replaced":replaced,"housed_households":null,"rows":rows});
    if let Ok(path)=std::env::var("HOUSES_INCUMBENT_GROWTH_OUT") {
        std::fs::write(path,serde_json::to_vec_pretty(&document).unwrap()).unwrap();
    }
    eprintln!("{}",serde_json::to_string_pretty(&json!({"cases":document["case_count"],"mass_gain_m2":new-old,"replaced":replaced})).unwrap());
    assert_eq!(document["case_count"],21);
    for row in document["rows"].as_array().unwrap(){assert_preservation(row);}
    assert!(new>old+1e-6&&replaced>0,"pilot has no measured constructive gain; do not promote");
    assert!(new_doors>=old_doors);
}

#[test]
fn incumbent_growth_real_prefix_batch_preserves_old_admissions_and_reports_final_geometry() {
    let f=fixture();let mut requests=f.preceding_batch_requests;requests.push(f.request);
    let run=|enabled|{
        let _mode=Mode::new(enabled);
        plan_batch(PlanBatchRequest {schema_version:"1".into(),requests:requests.clone(),
            settings:None,footprints:Default::default()}).unwrap()
    };
    let old=run(false);let new=run(true);
    let document=json!({"scope":"Real original C batch021 prefix through1358, with actual cumulative old/new occupation; no city capacity extrapolation",
        "request_count":requests.len(),"old":&old,"new":&new});
    if let Ok(path)=std::env::var("HOUSES_INCUMBENT_GROWTH_BATCH_OUT") {
        std::fs::write(path,serde_json::to_vec_pretty(&document).unwrap()).unwrap();
    }
    let next:BTreeMap<_,_>=new.buildings.iter().map(|b|(b.id.as_str(),b)).collect();
    for previous in &old.buildings {
        let b=next.get(previous.id.as_str()).expect("an old admitted identity must remain admitted");
        assert!(area(&b.footprint)+1e-7>=area(&previous.footprint));
        assert!(!previous.resolved.has_retained_entrance()||b.resolved.has_retained_entrance());
        let r=requests.iter().find(|r|r.id==b.id).unwrap();
        assert_eq!(*b.programme_outcome.as_ref().unwrap(),PlanProgrammeOutcome::from_final_plan(r,b));
        assert!(b.programme_outcome.as_ref().unwrap().households.housed.is_none());
    }
}
