use super::*;
use serde_json::{Value,json};

#[path="native_assembly_lazy_union_tests.rs"]
mod lazy_union_tests;

#[path="native_assembly_context_tests.rs"]
mod context_tests;

fn request_signature(v:&Value)->std::collections::BTreeMap<String,String>{
    fn walk(v:&Value,path:&str,out:&mut std::collections::BTreeMap<String,String>){
        let scalar=match v{
            Value::Number(n) if n.is_f64()=>Some(format!("f64:{:016x}",n.as_f64().unwrap().to_bits())),
            Value::Number(n)=>Some(format!("integer:{n}")),
            Value::String(s)=>Some(format!("string:{s}")),Value::Bool(b)=>Some(format!("bool:{b}")),Value::Null=>Some("null".into()),
            Value::Array(a)=>{out.insert(path.into(),format!("array:{}",a.len()));for (i,v) in a.iter().enumerate(){walk(v,&format!("{path}/{i}"),out);}None},
            Value::Object(a)=>{out.insert(path.into(),format!("object:{}",a.len()));for (k,v) in a{walk(v,&format!("{path}/{}",k.replace('~',"~0").replace('/',"~1")),out);}None},
        };if let Some(s)=scalar{out.insert(path.into(),s);}
    }
    let mut out=std::collections::BTreeMap::new();walk(v,"",&mut out);out
}
fn synthetic_input()->AssemblePairRequest{
    let source:Value=serde_json::from_str(include_str!("../tests/fixtures/native-assembly-source.json")).unwrap();
    let compact:CompactArchitecture=serde_json::from_value(source["resolved"].clone()).unwrap();
    let retained=compact.unpack().unwrap();
    let mut config=retained.config.clone();config.recipe=None;config.overrides=Overrides::default();
    let mut r:PlacementRequest=serde_json::from_value(json!({
        "id":"synthetic-native-assembly-contract","parcel_id":"synthetic-native-assembly-contract-parcel",
        "cadastral":rectangle(0.,0.,300.,300.),"buildable":rectangle(0.,0.,300.,300.),"roof_domain":rectangle(0.,0.,300.,300.),
        "reserves":[],"accesses":[],"party_boundaries":[],"neighbors":[],"parcel_fit":true,
        "culture":{"culture":"javanese-courts","pack":"AS-ISL","mode":"historical_inspired","borrowing":null},
        "function":"domestic","seed":retained.config.seed,"config":config,"programme":source["programme"],
        "terrain":{"origin":{"x":0.,"y":0.},"ground_z_m":0.,"gradient":[0.,0.],"water_z_m":null,"max_foundation_step_m":0.75}
    })).unwrap();
    let b=bounds(&retained.plan.bodies[0].footprint);
    let entry=retained.entrance.as_ref().unwrap();
    let mid=point((entry.opening[0].x+entry.opening[1].x)*0.5,(entry.opening[0].y+entry.opening[1].y)*0.5);
    let mut sides=[((mid.y-b[1]).abs(),0),((mid.y-b[3]).abs(),1),((mid.x-b[0]).abs(),2),((mid.x-b[2]).abs(),3)];
    sides.sort_by(|a,b|a.0.total_cmp(&b.0).then(a.1.cmp(&b.1)));
    let segment=match sides[0].1{0=>[point(0.,0.),point(300.,0.)],1=>[point(0.,300.),point(300.,300.)],2=>[point(0.,0.),point(0.,300.)],_=>[point(300.,0.),point(300.,300.)]};
    r.accesses=vec![ArchitectureAccess{id:"actual-synthetic-public-boundary".into(),segment,kind:"public".into(),width_m:3.}];
    let prepared=PreparedPlan::with_native_entry(&retained);
    let mut old=visual_with_front_access_prepared(&r,&prepared,Transform{origin:point(100.-b[0],100.-b[1]),orientation_deg:0.},&vec![],true,false,Some(&r.accesses[0]),true).unwrap();
    old.programme_outcome=Some(PlanProgrammeOutcome::from_final_plan(&r,&old));
    AssemblePairRequest{site:r,occupied_parts:vec![],occupied_roof_parts:vec![],incumbent:old}
}
fn positive()->(RetainedNativeAssembly,NativeAssemblyArchive){
    let input=synthetic_input();
    let original=input.incumbent.clone();
    let result=assemble_pair(input).unwrap();
    match result{
        AssemblyDecision::Assembled{assembly,archive,report}=>{
            assert!(report.necessary_checks<=8&&report.necessary_terrain_checks<=8);
            assert_eq!(report.source_resolutions,0);assert_eq!(report.new_body_rebuilds,1);
            assert_eq!(report.new_native_preparations,1);assert!((1..=4).contains(&report.new_admissions));
            assert_eq!(report.incumbent_preparations,1);assert_eq!(report.incumbent_admissions,1);
            assert!(matches!(assembly.circulation.branches[1].target,AssemblyBranchTarget::MemberBranchCap{..}));
            assert!(assembly.outcome.housed_households.is_none()&&assembly.outcome.actual_useful_m2.is_none());
            assert_eq!(serde_json::to_vec(&original.resolved).unwrap(),serde_json::to_vec(&assembly.members[0].plan.resolved).unwrap());
            assert_eq!(original.transform,assembly.members[0].plan.transform);
            assert_eq!(original.ground_z_m.to_bits(),assembly.members[0].plan.ground_z_m.to_bits());
            (assembly,archive)
        },
        AssemblyDecision::Retained{report,..}=>panic!("synthetic true internal group was not admitted: {} / {:?}",report.reason,report.errors),
    }
}

#[test]
fn native_assembly_positive_internal_archive_realize_fixture(){
    let (assembly,archive)=positive();
    // Root V2 already built/admitted these exact members. Its validator then
    // snapped only its recomputed expected point. V3 must change no source,
    // archive, pose, body/roof/levels, branch path, point or ground bit.
    assert_eq!(assembly.members[1].plan.entrance.x.to_bits(),0x4056da3d70a3d70b);
    let rejected:Value=serde_json::from_str(include_str!("../tests/fixtures/native-assembly-v2-rejected-source.json")).unwrap();
    assert_eq!(rejected["not_an_archive"],true);
    let mut payload=rejected["lossless_payload"].clone();crate::compact::decode_floats(&mut payload).unwrap();
    let source:RetainedNativeAssembly=serde_json::from_value(payload).unwrap();
    assert_eq!(serde_json::to_vec(&assembly).unwrap(),serde_json::to_vec(&source).unwrap(),"V3 must preserve all V2 native geometry bits");
    let restored=archive.unpack().unwrap();
    assert_eq!(serde_json::to_vec(&assembly).unwrap(),serde_json::to_vec(&restored).unwrap());
    let exterior=realize_assembly(RealizeAssemblyRequest{assembly:archive.clone(),interiors:false}).unwrap();
    let interior=realize_assembly(RealizeAssemblyRequest{assembly:archive.clone(),interiors:true}).unwrap();
    assert_eq!(exterior.members.len(),2);assert_eq!(interior.members.len(),2);
    for (m,r) in assembly.members.iter().zip(&interior.members){
        assert_eq!(m.key,r.key);assert_eq!(m.plan.id,r.member_id);
        assert_eq!(m.plan.ground_z_m.to_bits(),r.ground_z_m.to_bits());
        assert!(!r.architecture.units[0].access.portals.is_empty());
        assert!(!r.architecture.units[0].roofs.faces.is_empty());
    }
}

#[test]
fn native_assembly_manual_or_unrelated_incumbent_keeps_whole_original(){
    let input=synthetic_input();
    for change in ["request-seed","wealth","era","variation","culture","manual-variant","mode","config-mode","recipe"]{
        let mut x=input.clone();
        match change{
            "request-seed"=>x.site.seed.push_str("/different"),
            "wealth"=>x.site.config.as_mut().unwrap().wealth=0.91,
            "era"=>x.site.config.as_mut().unwrap().era="A".into(),
            "variation"=>x.site.config.as_mut().unwrap().variation=0.01,
            "culture"=>x.incumbent.culture.mode=HistoricalMode::FantasyMix,
            "manual-variant"=>x.site.config.as_mut().unwrap().overrides.variant=Some("default".into()),
            "mode"=>x.site.culture.mode=HistoricalMode::HistoricalStrict,
            "config-mode"=>x.site.config.as_mut().unwrap().mode=HistoricalMode::FantasyMix,
            "recipe"=>x.site.config.as_mut().unwrap().recipe=Some("AS-ISL-B14".into()),_=>unreachable!(),
        }
        let expected=serde_json::to_vec(&x.incumbent).unwrap();
        match assemble_pair(x).unwrap(){
            AssemblyDecision::Retained{building,report}=>{
                assert_eq!(serde_json::to_vec(&building).unwrap(),expected,"{change}");
                assert_eq!(report.new_body_rebuilds+report.new_native_preparations+report.new_admissions,0,"{change}");
            },_=>panic!("unrelated/manual site was accepted: {change}"),
        }
    }
}

#[test]
fn native_assembly_archive_preserves_native_f64_bits_and_rejects_decimal_authority(){
    let (mut assembly,_)=positive();
    // +/-0 produce the same rotation here, but MUST survive the archive as
    // different bits. This clone is a codec control, not the positive fixture.
    assembly.members[0].plan.transform.orientation_deg=-0.;
    let archive=NativeAssemblyArchive::pack(&assembly).unwrap();
    let transport=serde_json::to_vec(&archive).unwrap();
    let restored:NativeAssemblyArchive=serde_json::from_slice(&transport).unwrap();
    let native=restored.unpack().unwrap();
    assert_eq!(native.members[0].plan.transform.orientation_deg.to_bits(),(-0.0f64).to_bits());
    for (a,b) in assembly.members.iter().zip(&native.members){
        assert_eq!(a.plan.transform.origin.x.to_bits(),b.plan.transform.origin.x.to_bits());
        assert_eq!(a.plan.transform.origin.y.to_bits(),b.plan.transform.origin.y.to_bits());
        assert_eq!(a.plan.ground_z_m.to_bits(),b.plan.ground_z_m.to_bits());
        assert_eq!(serde_json::to_vec(&a.plan.resolved).unwrap(),serde_json::to_vec(&b.plan.resolved).unwrap());
    }
    assert_eq!(serde_json::to_vec(&archive).unwrap(),serde_json::to_vec(&NativeAssemblyArchive::pack(&native).unwrap()).unwrap());
    let mut bad=archive.clone();bad.payload["members"][0]["plan"]["ground_z_m"]=json!(0.0);
    assert!(bad.unpack().is_err());
}

#[test]
fn native_assembly_archive_rejects_disconnected_or_fake_public_branch(){
    let (mut a,_)=positive();
    a.circulation.branches[1].target=AssemblyBranchTarget::PublicAccess{access_id:a.circulation.public_access.id.clone()};
    assert!(NativeAssemblyArchive::pack(&a).is_err());
}

#[test]
fn native_assembly_member_realization_failure_is_atomic(){
    let (mut a,_)=positive();
    let body=bounds(&a.members[1].plan.footprint);
    a.members[1].plan.roof_footprint=rectangle((body[0]+body[2])*0.5,(body[1]+body[3])*0.5,0.1,0.1);
    let archive=NativeAssemblyArchive::pack(&a).unwrap();
    let error=realize_assembly(RealizeAssemblyRequest{assembly:archive,interiors:false}).err().expect("one invalid native member must reject whole response");
    assert!(error.contains("added")&&error.contains("roof"),"{error}");
}

#[test]
fn native_assembly_administrative_budget_refuses_complete_input_before_unions(){
    let mut input=synthetic_input();
    input.occupied_parts=vec![rectangle(250.,250.,1.,1.);MAX_ASSEMBLY_PARTS+1];
    let error=assemble_pair(input).err().expect("oversize complete input cannot be truncated");
    assert!(error.contains("assembly_budget"),"{error}");
}


#[test]
fn native_assembly_std_native_request_complete_signature_is_exact(){
    let input=synthetic_input();let bytes=serde_json::to_vec(&input).unwrap();
    let expected=request_signature(&serde_json::to_value(&input).unwrap());
    let parsed=transport::parse_pair_request(&bytes).unwrap();
    let actual=request_signature(&serde_json::to_value(&parsed).unwrap());
    assert_eq!(expected,actual,"Std transport must preserve every typed scalar and compact f64 bit, without geometry reconstruction");
    assert_eq!(serde_json::to_vec(&input.incumbent.resolved).unwrap(),serde_json::to_vec(&parsed.incumbent.resolved).unwrap(),"opaque compact archive must remain byte-exact");
    assert_eq!(serde_json::to_vec(&parsed).unwrap(),bytes);
    let legacy:AssemblePairRequest=serde_json::from_slice(&bytes).unwrap();
    assert_ne!(expected,request_signature(&serde_json::to_value(&legacy).unwrap()),"control must still exercise the unchanged approximate historical decoder");
}

#[path="owned_pavilion_spare_slots_tests.rs"]
mod owned_pavilion_spare_slots_tests;

#[path="native_retained_frontage_selection_tests.rs"]
mod retained_frontage_selection_tests;
