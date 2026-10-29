//! Bounded current city-path replay of the original requests/complete historical
//! context. Each is independent; no 100k regeneration or cumulative gain claim.
use super::*;
use serde_json::{Value,json};
#[test]
fn native_parent_current_city_path_on_fixed_twenty_two_requests(){
    let _growth=single_incumbent_growth::Mode::new(true);
    let _need=single_need_continuation::Mode::new(true);
    let directory=std::path::Path::new(env!("CARGO_MANIFEST_DIR")).join("tests/fixtures/assembly-contexts22");
    let manifest:Value=serde_json::from_slice(&std::fs::read(directory.join("manifest.json")).unwrap()).unwrap();
    let mut rows=vec![];let(mut parents,mut groups,mut members,mut refused)=(0,0,0,0);
    let mut baseline_groups=0;
    let mut svg_written=false;
    for case in manifest["cases"].as_array().unwrap(){
        let bytes=std::fs::read(directory.join(case["file"].as_str().unwrap())).unwrap();
        assert_eq!(format!("{:x}",Sha256::digest(&bytes)),case["sha256"].as_str().unwrap());
        let context=super::super::assembly::transport::parse_pair_request(&bytes).unwrap();
        let programme=context.site.programme.clone();let id=context.site.id.clone();
        let input=ParentPlanBatchRequest{schema_version:PARENT_BATCH_SCHEMA.into(),batch:PlanBatchRequest{
            schema_version:"1".into(),requests:vec![context.site],settings:None,footprints:BTreeMap::new()},
            prior_occupation:PriorOccupation{land_parts:context.occupied_parts,roof_parts:context.occupied_roof_parts}};
        let baseline=super::super::assembly::with_street_context(false,||plan_parent_batch(ParentPlanBatchRequest{
            schema_version:input.schema_version.clone(),batch:input.batch.clone(),prior_occupation:input.prior_occupation.clone()})).unwrap();
        baseline_groups+=baseline.counts.admitted.assembly_parents;
        let result=plan_parent_batch(input).unwrap();let c=&result.counts;
        assert_eq!(baseline.counts.admitted.admitted_parents,c.admitted.admitted_parents);
        for old in &baseline.parents{
            let new=result.parents.iter().find(|p|p.plan.id()==old.plan.id()).unwrap();
            if matches!(old.plan,NativeParentPlan::Assembly{..}){
                assert_eq!(serde_json::to_vec(&old.archive).unwrap(),serde_json::to_vec(&new.archive).unwrap(),"old admitted whole assembly must stay exact");
            }else if matches!(new.plan,NativeParentPlan::Single{..}){
                assert_eq!(serde_json::to_vec(&old.archive).unwrap(),serde_json::to_vec(&new.archive).unwrap(),"failed/unsupported extension keeps the actual whole Single");
            }
        }
        assert_eq!(c.requests,1);assert_eq!(c.admitted.admitted_parents+c.refusals+c.open_spaces,1);
        parents+=c.admitted.admitted_parents;groups+=c.admitted.assembly_parents;members+=c.admitted.physical_members;refused+=c.refusals;
        for record in &result.parents{
            assert_eq!(record.plan.id(),id);let restored=record.archive.unpack().unwrap();
            assert_eq!(serde_json::to_vec(&restored).unwrap(),serde_json::to_vec(&record.plan).unwrap());
            if let Some(path)=std::env::var_os("ASSEMBLY_CITY_SUBSET_OUT"){
                let directory=std::path::PathBuf::from(path).parent().unwrap().join("parents");std::fs::create_dir_all(&directory).unwrap();
                std::fs::write(directory.join(format!("case-{}-parent.native.json",case["globalIndex"].as_u64().unwrap())),serde_json::to_vec(&record.archive).unwrap()).unwrap();
            }
            let actual=match &record.plan{NativeParentPlan::Single{programme,..}=>programme.as_ref(),NativeParentPlan::Assembly{assembly}=>{
                assert!(assembly.outcome.housed_households.is_none()&&assembly.outcome.actual_useful_m2.is_none());
                Some(&assembly.programme)
            }};
            assert_eq!(serde_json::to_vec(&actual).unwrap(),serde_json::to_vec(&programme).unwrap());
            if let NativeParentPlan::Assembly{assembly}=&record.plan{
                let native=realize_parent(RealizeParentRequest{parent:record.archive.clone(),interiors:true}).unwrap();
                let RealizedParent::Assembly{assembly:detailed}=native else{panic!("native parent kind changed")};
                assert_eq!(detailed.members.len(),assembly.members.len());
                let(land,roof)=record.plan.occupation_parts();assert!(land.len()>=4&&roof.len()==2);
                if !svg_written{if let Some(path)=std::env::var_os("ASSEMBLY_SUBSET_SVG"){
                    let b=bounds(&unite(&land));let pad=3.;
                    let mut svg=format!("<svg xmlns='http://www.w3.org/2000/svg' viewBox='{} {} {} {}'><title>Real native parent: {}. Two members; household capacity unknown.</title><rect x='{}' y='{}' width='{}' height='{}' fill='#faf7ef'/>",b[0]-pad,b[1]-pad,b[2]-b[0]+2.*pad,b[3]-b[1]+2.*pad,assembly.id,b[0]-pad,b[1]-pad,b[2]-b[0]+2.*pad,b[3]-b[1]+2.*pad);
                    for (surface,color,fill) in assembly.circulation.branches.iter().map(|c|(&c.path,"#a68f67",true))
                        .chain(assembly.members.iter().map(|m|(&m.plan.roof_footprint,"#a99d89",false)))
                        .chain(assembly.members.iter().enumerate().map(|(i,m)|(&m.plan.footprint,if i==0{"#52785e"}else{"#bf874d"},true))){
                        let d=surface.iter().flat_map(|p|std::iter::once(&p.outer).chain(&p.holes)).map(|ring|{
                            let mut d=String::new();for(i,p)in ring.iter().enumerate(){d.push_str(&format!("{}{} {} ",if i==0{"M"}else{"L"},p.x,p.y));}d.push('Z');d
                        }).collect::<String>();
                        svg.push_str(&format!("<path d='{d}' fill='{}' fill-rule='evenodd' stroke='{color}' stroke-width='.15'/>",if fill{color}else{"none"}));
                    }
                    svg.push_str("</svg>");std::fs::write(path,svg).unwrap();svg_written=true;
                }}
            }
        }
        rows.push(json!({"case":case,"baseline_counts":baseline.counts,"counts":c,"attempt":result.parents.first().and_then(|r|r.attempt.as_ref()),
            "programme":programme,"parents":result.parents.iter().map(|r|{
                let(body,gross)=match &r.plan{
                    NativeParentPlan::Single{building,..}=>(area(&building.footprint),plan_programme_outcome::housing_floor_outcome::gross_floor_inventory(building).ok()),
                    NativeParentPlan::Assembly{assembly}=>(assembly.outcome.body_footprint.actual_m2,assembly.outcome.gross_floor_m2),
                };
                json!({"id":r.plan.id(),"archive_sha256":r.archive.sha256,"physical_members":r.plan.physical_members(),"body_m2":body,"gross_floor_m2":gross,
                    "necessary_useful_shortfall_lower_bound_m2":programme.as_ref().and_then(|p|p.housing_floor_need.as_ref()).zip(gross).map(|(n,g)|(n.requested_m2-g).max(0.)),"housed_households":null})
            }).collect::<Vec<_>>(),
            "refusals":result.refusals,"open_spaces":result.open_spaces}));
    }
    let report=json!({"scope":"22 independent original requests through current native city parent path, with complete captured occupation; not a city total",
        "parents":parents,"baseline_assemblies":baseline_groups,"assemblies":groups,"physical_members":members,"refusals":refused,"housed_households":null,"rows":rows});
    if let Some(path)=std::env::var_os("ASSEMBLY_CITY_SUBSET_OUT"){std::fs::write(path,serde_json::to_vec_pretty(&report).unwrap()).unwrap();}
    eprintln!("current city subset22: parents={parents} baseline_assemblies={baseline_groups} assemblies={groups} members={members} refusals={refused}; household capacity unknown");
    assert!(parents>0&&groups>0,"the real city flow must commit a native assembly on this subset");
}
