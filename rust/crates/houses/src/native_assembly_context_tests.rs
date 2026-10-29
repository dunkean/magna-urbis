use super::*;
use super::super::builder::StreetContextMode;
use sha2::{Digest,Sha256};

#[test]
fn native_assembly_street_context_is_retained_in_both_native_members_and_detail(){
    let mut input=synthetic_input();
    let mut source=input.incumbent.resolved.unpack().unwrap();
    source.plan.context.push(Feature{id:"source-street-context".into(),kind:FeatureKind::Street,
        surface:rectangle(-20.,-20.,10.,3.),z_m:0.,height_m:0.,material:String::new(),vertices3d:vec![],roof:None});
    let prepared=PreparedPlan::with_native_entry(&source);
    input.incumbent=visual_with_front_access_prepared(&input.site,&prepared,input.incumbent.transform.clone(),&vec![],true,false,Some(&input.site.accesses[0]),true).unwrap();
    input.incumbent.programme_outcome=Some(PlanProgrammeOutcome::from_final_plan(&input.site,&input.incumbent));
    let retained_member=NativeMemberPlan::retain(&input.incumbent);
    let before=serde_json::to_vec(&input.incumbent).unwrap();
    {let _off=StreetContextMode::new(false);
        let AssemblyDecision::Retained{building,report}=assemble_pair(input.clone()).unwrap()else{panic!("old context-free scope")};
        assert_eq!(serde_json::to_vec(&building).unwrap(),before);assert_eq!(report.new_admissions,0);
    }
    let AssemblyDecision::Assembled{assembly,archive,..}=assemble_pair(input).unwrap()else{panic!("native-supported street context must reach construction")};
    for member in &assembly.members{assert_eq!(member.plan.resolved.unpack().unwrap().plan.context,source.plan.context);}
    assert_eq!(serde_json::to_vec(&assembly.members[0].plan).unwrap(),serde_json::to_vec(&retained_member).unwrap());
    let detail=realize_assembly(RealizeAssemblyRequest{assembly:archive,interiors:true}).unwrap();
    for member in detail.members{assert_eq!(member.architecture.units[0].site_context,source.plan.context);}
    assert!(assembly.outcome.actual_useful_m2.is_none()&&assembly.outcome.housed_households.is_none());
}

#[test]
fn native_assembly_obstacle_context_is_refused_whole_without_member_work(){
    let mut input=synthetic_input();let mut source=input.incumbent.resolved.unpack().unwrap();
    source.plan.context.push(Feature{id:"real-obstacle".into(),kind:FeatureKind::Neighbor,
        surface:rectangle(0.,0.,3.,3.),z_m:0.,height_m:3.,material:String::new(),vertices3d:vec![],roof:None});
    input.incumbent.resolved=CompactArchitecture::pack(&source).unwrap();
    let before=serde_json::to_vec(&input.incumbent).unwrap();
    let AssemblyDecision::Retained{building,report}=assemble_pair(input).unwrap()else{panic!("obstacle context requires another native grammar")};
    assert_eq!(serde_json::to_vec(&building).unwrap(),before);assert_eq!(report.new_body_rebuilds+report.new_native_preparations+report.new_admissions,0);
}

#[test]
fn native_assembly_fixed_twenty_two_contexts_preserve_old_admissions_and_archives(){
    let directory=std::path::Path::new(env!("CARGO_MANIFEST_DIR")).join("tests/fixtures/assembly-contexts22");
    let manifest:Value=serde_json::from_slice(&std::fs::read(directory.join("manifest.json")).unwrap()).unwrap();
    let cases=manifest["cases"].as_array().unwrap();assert_eq!(cases.len(),22);
    let mut rows=vec![];let mut old_groups=0;let mut groups=0;
    for case in cases{
        let bytes=std::fs::read(directory.join(case["file"].as_str().unwrap())).unwrap();
        assert_eq!(format!("{:x}",Sha256::digest(&bytes)),case["sha256"].as_str().unwrap());
        let input=transport::parse_pair_request(&bytes).unwrap();assert_eq!(input.site.id,case["id"].as_str().unwrap());
        let original=serde_json::to_vec(&input.incumbent).unwrap();
        let old={let _off=StreetContextMode::new(false);assemble_pair(input.clone()).unwrap()};
        let new=assemble_pair(input).unwrap();
        let report=match &new{
            AssemblyDecision::Retained{building,report}=>{assert_eq!(serde_json::to_vec(building).unwrap(),original);report},
            AssemblyDecision::Assembled{assembly,archive,report}=>{
                groups+=1;assert!(archive.unpack().is_ok());
                assert!(assembly.outcome.housed_households.is_none()&&assembly.outcome.actual_useful_m2.is_none());
                // Both actual native exteriors must be constructible before a
                // representative component is counted as a detailed assembly.
                assert_eq!(realize_assembly(RealizeAssemblyRequest{assembly:archive.clone(),interiors:true}).unwrap().members.len(),2);
                report
            },
        };
        if let AssemblyDecision::Assembled{archive,..}=&old{
            old_groups+=1;
            let AssemblyDecision::Assembled{archive:after,..}=&new else{panic!("old admitted assembly lost")};
            assert_eq!(serde_json::to_vec(archive).unwrap(),serde_json::to_vec(after).unwrap());
        }
        assert_eq!(report.source_resolutions,0);
        assert!(report.necessary_checks<=8&&report.necessary_terrain_checks<=8&&report.new_body_rebuilds<=1&&report.new_native_preparations<=1&&report.new_admissions<=4);
        rows.push(json!({"case":case,"old_assembled":matches!(old,AssemblyDecision::Assembled{..}),"assembled":matches!(new,AssemblyDecision::Assembled{..}),"report":report}));
    }
    let result=json!({"scope":manifest["scope"],"cases":22,"old_groups":old_groups,"groups":groups,"housed_households":null,"rows":rows});
    if let Some(path)=std::env::var_os("ASSEMBLY_CONTEXTS_OUT"){std::fs::write(path,serde_json::to_vec_pretty(&result).unwrap()).unwrap();}
    eprintln!("fixed22: old_groups={old_groups} groups={groups}; full failures retained; household capacity unknown");
}
