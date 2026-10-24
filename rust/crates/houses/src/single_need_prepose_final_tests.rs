//! Real OLD-Need transports and default final phase are different contracts.
//! This test-only audit does NOT change a runtime algorithm or native guard.
use super::*;
use serde_json::json;

struct Observation {
    report:Value,
    old:Vec<u8>,new:Vec<u8>,
    old_events:Vec<Value>,new_events:Vec<Value>,
    details:Vec<(String,bool,Value)>,
    failures:Vec<String>,
}
fn check(f:&mut Vec<String>,ok:bool,message:impl Into<String>){if !ok{f.push(message.into());}}
fn same<T:serde::Serialize>(a:&T,b:&T)->bool{serde_json::to_vec(a).unwrap()==serde_json::to_vec(b).unwrap()}
fn complete(bytes:&[u8],prepose:bool)->Result<(PlanBatch,Vec<Value>,Vec<single_native_prepose::diagnostics::Report>),String>{
    let _incumbent=single_incumbent_growth::Mode::new(true);
    let _need=Mode::new(true);
    let _prepose=single_native_prepose::Mode::new(prepose);
    let mut need_capture=Capture::new();
    let portal_capture=single_native_prepose::diagnostics::Capture::begin();
    let result=plan_batch(input(bytes))?;
    Ok((result,need_capture.take(),portal_capture.reports()))
}
fn land(b:&PlanBuilding)->Surface{
    let mut parts=vec![b.footprint.clone(),b.courtyards.clone(),b.circulation.clone()];
    parts.extend(b.structural_features.iter().map(|f|f.surface.clone()));unite(&parts)
}
fn observe(bytes:&[u8],name:&str)->Result<Observation,String>{
    let meta:Value=serde_json::from_str(REFERENCE).unwrap();let source=input(bytes);
    let (old,old_events,old_ops)=complete(bytes,false)?;
    let (new,new_events,ops)=complete(bytes,true)?;
    let old_bytes=serde_json::to_vec(&old).unwrap();let new_bytes=serde_json::to_vec(&new).unwrap();
    let mut failures=vec![];let mut rows=vec![];let mut details=vec![];
    check(&mut failures,digest(bytes)==meta["batches"][name]["requestSha256"],"original fixture identity");
    // NEVER change or bypass this old golden. Only the later phase is OFF.
    check(&mut failures,digest(&old_bytes)==meta["batches"][name]["expectedCandidateSha256"],"OLD Need golden changed with only prepose OFF");
    // This is the already observed V2 default output, NOT a replacement OLD
    // golden or a physical certificate. Every changed parent is audited below.
    let observed_v2=match name{"0002"=>"dae76c050c56d30544953155630b92c94e7e2f471caa349452134c8d011da632",
        "0080"=>"c3a23e3e4c7b26919e742662b48aa61565118c48a3ea53fd80197b8ba3f0528f",_=>return Err("unknown original witness".into())};
    check(&mut failures,digest(&new_bytes)==observed_v2,"default final transport differs from preserved V2 failing-test output");
    check(&mut failures,same(&old_events,&new_events),"OLD Need capture/checks/budgets changed before final postphase");
    check(&mut failures,old_ops.is_empty(),"prepose OFF performed work");
    check(&mut failures,old.buildings.iter().map(|b|&b.id).collect::<Vec<_>>()==new.buildings.iter().map(|b|&b.id).collect::<Vec<_>>(),"admission/order loss");
    check(&mut failures,same(&old.refusals,&new.refusals)&&same(&old.open_spaces,&new.open_spaces)&&same(&old.materials,&new.materials),"refusal/open/material changed");
    let mut published=BTreeSet::new();
    for op in &ops {
        check(&mut failures,op.preparations<=1&&op.admissions<=1&&op.pose_generations<=1&&op.generated_poses<=1,format!("additional budget {}",op.id));
        if op.batch_qualified==Some(true){check(&mut failures,published.insert(op.id.clone()),"duplicate published source");}
    }
    let old_by_id=old.buildings.iter().map(|b|(b.id.clone(),b)).collect::<BTreeMap<_,_>>();
    let mut changed=BTreeSet::new();
    for (ordinal,b) in new.buildings.iter().enumerate(){
        let Some(a)=old_by_id.get(&b.id)else{continue};
        if same(*a,b){continue;}
        changed.insert(b.id.clone());
        let mut r=source.requests.iter().find(|r|r.id==b.id).ok_or("changed request absent")?.clone();
        if let Some(fit)=source.settings.as_ref().and_then(|s|s.parcel_fit){r.parcel_fit=Some(fit);}
        let old_source=a.resolved.unpack()?;let new_source=b.resolved.unpack()?;
        let mut without_entry=new_source.clone();without_entry.entrance=None;
        let source_exact=same(&old_source,&without_entry);
        let intrinsic=|s:&ResolvedArchitecture|s.plan.bodies.iter().map(|b|b.levels.iter().map(|level|area(level).to_bits()).collect::<Vec<_>>()).collect::<Vec<_>>();
        let intrinsic_gross_exact=intrinsic(&old_source)==intrinsic(&new_source);
        check(&mut failures,source_exact,format!("intrinsic source/config/seed/dimensions drift {}",b.id));
        check(&mut failures,intrinsic_gross_exact,format!("native intrinsic body-level area changed {}",b.id));
        check(&mut failures,old_source.entrance.is_none()&&new_source.entrance.is_some(),format!("unexpected source certificate transition {}",b.id));
        check(&mut failures,a.recipe_id==b.recipe_id&&a.variant_id==b.variant_id&&a.access_id==b.access_id,format!("style/access drift {}",b.id));
        let levels=|v:&PlanBuilding|v.volumes.iter().map(|v|v.levels.len()).collect::<Vec<_>>();
        check(&mut failures,levels(a)==levels(b),format!("floor count changed {}",b.id));
        let old_report=a.programme_outcome.as_ref().ok_or("old programme outcome absent")?;
        let new_report=b.programme_outcome.as_ref().ok_or("new programme outcome absent")?;
        let old_housing=old_report.housing_floor.as_ref().ok_or("old housing need absent")?;
        let new_housing=new_report.housing_floor.as_ref().ok_or("new housing need absent")?;
        let expected=PlanProgrammeOutcome::from_final_plan(&r,b);
        check(&mut failures,same(new_report,&expected),format!("stale final measured programme {}",b.id));
        check(&mut failures,old_housing.requested_useful_m2.to_bits()==new_housing.requested_useful_m2.to_bits(),format!("need scalar drift {}",b.id));
        check(&mut failures,same(&old_housing.need_model,&new_housing.need_model),format!("frozen need model drift {}",b.id));
        check(&mut failures,old_report.body_footprint.attainment==new_report.body_footprint.attainment&&old_housing.necessary_area_status==new_housing.necessary_area_status,format!("programme status regression {}",b.id));
        let relevant=ops.iter().filter(|op|op.id==b.id&&op.batch_qualified==Some(true)).collect::<Vec<_>>();
        check(&mut failures,relevant.len()==1,format!("published chosen front absent/duplicated {}",b.id));
        let front=relevant.first().and_then(|op|op.front.as_ref()).ok_or("published actual public segment absent")?;
        check(&mut failures,r.accesses.iter().any(|a|same(a,front)),format!("chosen full segment absent from raw site {}",b.id));
        let others=unite(&new.buildings.iter().filter(|other|other.id!=b.id).map(land)
            .chain(r.neighbors.iter().map(|n|n.footprint.clone())).collect::<Vec<_>>());
        let own=land(b);let other_roofs=unite(&new.buildings.iter().filter(|other|other.id!=b.id).map(|o|o.roof_footprint.clone()).collect::<Vec<_>>());
        let collisions=[area(&intersection(&own,&others)),area(&intersection(&own,&other_roofs)),area(&intersection(&b.roof_footprint,&others))];
        check(&mut failures,collisions.iter().all(|v|*v<=0.0001),format!("final real land/roof context collision {}",b.id));
        check(&mut failures,contains(&difference(&r.buildable,&r.reserves),&b.footprint)&&contains(&difference(&r.cadastral,&r.reserves),&own)
            &&contains(&difference(r.roof_domain.as_ref().unwrap_or(&r.cadastral),&r.reserves),&b.roof_footprint),format!("retained rights/reserves {}",b.id));
        let prepared=PreparedPlan::with_native_entry(&new_source);
        let readmission=match visual_with_front_access_prepared(&r,&prepared,b.transform.clone(),&others,true,false,Some(front),true){
            Ok(ref actual)=>{
                let exact=actual.footprint==b.footprint&&actual.roof_footprint==b.roof_footprint&&actual.courtyards==b.courtyards
                    &&actual.circulation==b.circulation&&actual.entrance==b.entrance&&actual.ground_z_m.to_bits()==b.ground_z_m.to_bits()
                    &&same(&actual.volumes,&b.volumes)&&same(&actual.structural_features,&b.structural_features)
                    &&same(&actual.resolved.unpack()?,&new_source);
                check(&mut failures,exact,format!("native same-pose/source/terrain readmission differs {}",b.id));json!({"ok":true,"exact":exact})
            },Err(error)=>{failures.push(format!("native readmission {}: {error}",b.id));json!({"ok":false,"error":error})}
        };
        let parent=parent_batch::NativeParentPlan::Single{programme:r.programme.clone(),building:b.clone()};
        let archive=parent_batch::NativeParentArchive::pack(&parent)?;
        check(&mut failures,same(&archive,&parent_batch::NativeParentArchive::pack(&archive.unpack()?)?),format!("native archive roundtrip {}",b.id));
        let mut realization=vec![];
        for interiors in [false,true]{
            match parent_batch::realize_parent(parent_batch::RealizeParentRequest{parent:archive.clone(),interiors}){
                Ok(ref detailed)=>{
                    let parent_batch::RealizedParent::Single{architecture,..}=detailed else{return Err("changed Single realized wrong parent kind".into())};
                    let valid=architecture.units.len()==1&&same(&architecture.settings,&new_source.config)
                        &&same(&architecture.units[0].transform,&b.transform)&&(!interiors||(!architecture.units[0].rooms.is_empty()&&!architecture.units[0].access.portals.is_empty()));
                    check(&mut failures,valid,format!("actual detail source/pose/interior {}",b.id));
                    realization.push(json!({"interiors":interiors,"ok":true,"exact":valid,"rooms":architecture.units[0].rooms.len(),"portals":architecture.units[0].access.portals.len()}));
                    details.push((format!("changed-{ordinal:02}"),interiors,serde_json::to_value(detailed).unwrap()));
                },Err(error)=>{failures.push(format!("actual detail {}/{}: {error}",b.id,interiors));realization.push(json!({"interiors":interiors,"ok":false,"error":error}));}
            }
        }
        rows.push(json!({"id":b.id,"recipe":b.recipe_id,"old_plan_sha256":digest(&serde_json::to_vec(*a).unwrap()),"new_plan_sha256":digest(&serde_json::to_vec(b).unwrap()),
            "source_except_native_entrance_exact":source_exact,"old_native_entry":old_source.entrance.is_some(),"new_native_entry":new_source.entrance.is_some(),
            "intrinsic_body_level_area_bits_exact":intrinsic_gross_exact,"intrinsic_body_level_area_bits":intrinsic(&new_source),
            "levels":levels(b),"old_gross_m2":old_housing.gross_floor_m2,"new_gross_m2":new_housing.gross_floor_m2,
            "old_gross_bits":old_housing.gross_floor_m2.map(|v|format!("{:016x}",v.to_bits())),"new_gross_bits":new_housing.gross_floor_m2.map(|v|format!("{:016x}",v.to_bits())),
            "requested_useful_m2":new_housing.requested_useful_m2,"source_need":r.programme.as_ref().and_then(|p|p.housing_floor_need.as_ref()),
            "intersection_areas_m2":collisions,"readmission":readmission,"realization":realization,"native_archive_sha256":archive.sha256}));
    }
    check(&mut failures,changed==published,"all and only published portal parents changed");
    check(&mut failures,!changed.is_empty(),"real default final-phase witness unexpectedly has no changes");
    if name=="0080"{
        let protected="layout-f9dab5910f08a8a2/block-31745d27dc35f39a/parcel-03e9d3cd725f0063/building";
        let a=old.buildings.iter().find(|b|b.id==protected).ok_or("protected final incumbent missing before")?;
        let b=new.buildings.iter().find(|b|b.id==protected).ok_or("protected final incumbent lost")?;
        check(&mut failures,a.resolved.has_retained_entrance()&&same(a,b),"0080 previous native final incumbent changed");
    }
    let report=json!({"batch":name,"request_sha256":digest(bytes),"old_need_golden_sha256":digest(&old_bytes),"default_final_sha256":digest(&new_bytes),
        "old_need_events_exact":same(&old_events,&new_events),"old_count":old.buildings.len(),"new_count":new.buildings.len(),"changed":rows,"operators":ops,"failures":failures,
        "qualification":"SAME original transported fixture/decoder, not substituted raw Core or dropped old neighbors. OLD Need/growth ON; only later prepose OFF/ON differs. Additional audit readmissions/detail work are test-only, outside captured runtime operator budgets. No production/global-prefix or capacity claim."});
    Ok(Observation{report,old:old_bytes,new:new_bytes,old_events,new_events,details,failures})
}
fn assert_context(bytes:&[u8],name:&str){let proof=observe(bytes,name).unwrap();assert!(proof.failures.is_empty(),"{}",proof.report);}
#[test]
fn native_prepose_default_after_need_real0002_preserves_old_phase_and_certifies_final(){assert_context(GAIN,"0002");}
#[test]
fn native_prepose_default_after_need_real0080_keeps_native_incumbent_and_certifies_other_changes(){assert_context(LOSS,"0080");}
