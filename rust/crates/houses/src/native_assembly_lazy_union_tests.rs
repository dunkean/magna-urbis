//! Causal call counts for the two occupation unions only; no geometry shortcut.
use super::*;
use crate::plans::assembly::builder::OccupationUnionProbe;

fn retained(input:AssemblePairRequest,reason:&str)->AssemblyAttemptReport{
    let expected=serde_json::to_vec(&input.incumbent).unwrap();
    match assemble_pair(input).unwrap(){AssemblyDecision::Retained{building,report}=>{
        assert_eq!(serde_json::to_vec(&building).unwrap(),expected,"whole fallback unchanged");
        assert!(report.reason.contains(reason),"{}",report.reason);report
    },_=>panic!("expected original retained incumbent")}
}
#[test]
fn native_assembly_lazy_union_early_scope_and_native_certificate_rejects_make_zero_unions(){
    for case in ["manual","no_native_portal"]{
        let mut input=synthetic_input();
        input.occupied_parts=vec![rectangle(280.,280.,1.,1.),rectangle(280.,280.,1.,1.)];
        input.occupied_roof_parts=vec![rectangle(280.,280.,2.,2.)];
        let reason=if case=="manual"{
            input.site.config.as_mut().unwrap().recipe=Some(input.incumbent.recipe_id.clone());
            "outside unpinned automatic native assembly scope"
        }else{
            let mut source=input.incumbent.resolved.unpack().unwrap();source.entrance=None;
            input.incumbent.resolved=CompactArchitecture::pack(&source).unwrap();
            "incumbent is not one native-portal body with one level"
        };
        let probe=OccupationUnionProbe::new();let report=retained(input,reason);
        assert_eq!(probe.calls(),0,"{case}");assert!(report.occupation_union_ms.is_none());
        assert_eq!(report.occupied_parts,2);assert_eq!(report.occupied_roof_parts,1);
        assert_eq!(report.new_body_rebuilds+report.new_native_preparations+report.new_admissions,0);
    }
}
#[test]
fn native_assembly_lazy_union_complete_invalid_input_still_errors_before_early_return(){
    let mut invalid=synthetic_input();
    invalid.site.config.as_mut().unwrap().recipe=Some(invalid.incumbent.recipe_id.clone());
    invalid.occupied_parts=vec![vec![Polygon{outer:vec![point(0.,0.),point(1.,1.),point(0.,1.),point(1.,0.)],holes:vec![]}]];
    let probe=OccupationUnionProbe::new();let error=assemble_pair(invalid).err().expect("invalid neighbor cannot be bypassed by a source gate");
    assert_eq!(error,"Invalid complete native occupation input part");assert_eq!(probe.calls(),0);
    let mut oversized=synthetic_input();oversized.site.config.as_mut().unwrap().recipe=Some(oversized.incumbent.recipe_id.clone());
    oversized.occupied_roof_parts=vec![vec![];MAX_ASSEMBLY_PARTS+1];
    let error=assemble_pair(oversized).err().expect("massive empty parts still count; no truncation");
    assert!(error.contains("assembly_budget"),"{error}");assert_eq!(probe.calls(),0);
}
#[test]
fn native_assembly_lazy_union_positive_makes_two_unions_and_preserves_exact_native_archive(){
    let probe=OccupationUnionProbe::new();let (assembly,archive)=positive();assert_eq!(probe.calls(),2);
    let old:Value=serde_json::from_str(include_str!("../tests/fixtures/native-assembly-v2-rejected-source.json")).unwrap();
    let mut payload=old["lossless_payload"].clone();crate::compact::decode_floats(&mut payload).unwrap();
    let expected:RetainedNativeAssembly=serde_json::from_value(payload).unwrap();
    assert_eq!(serde_json::to_vec(&assembly).unwrap(),serde_json::to_vec(&expected).unwrap());
    assert_eq!(serde_json::to_vec(&archive).unwrap(),serde_json::to_vec(&NativeAssemblyArchive::pack(&expected).unwrap()).unwrap());
}
#[test]
fn native_assembly_lazy_union_late_physical_refusal_still_uses_two_unions_and_keeps_original(){
    let mut input=synthetic_input();input.occupied_parts=vec![input.site.cadastral.clone()];
    let probe=OccupationUnionProbe::new();let report=retained(input,"incumbent revalidation refused");
    assert_eq!(probe.calls(),2);
    #[cfg(not(target_arch="wasm32"))]
    assert!(report.occupation_union_ms.is_some());
    #[cfg(target_arch="wasm32")]
    assert!(report.occupation_union_ms.is_none());
    assert_eq!(report.new_body_rebuilds+report.new_native_preparations+report.new_admissions,0);
}
