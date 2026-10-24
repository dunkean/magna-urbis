use super::*;
use sha2::{Digest,Sha256};
use serde_json::{Value,json};
fn digest(bytes:&[u8])->String{format!("{:x}",Sha256::digest(bytes))}
fn cache(parts:Vec<Surface>,enabled:bool)->BatchOccupation{
    let _mode=BatchOccupationMode::new(enabled);BatchOccupation::new(parts)
}
#[test]
fn batch_occupation_reuse_matches_exact_old_order_holes_edges_and_overflow(){
    let hole=difference(&rectangle(-70.,-70.,160.,160.),&rectangle(-5.,-5.,10.,10.));
    let parts=vec![vec![],rectangle(64.,-64.,3.,3.),hole,rectangle(-64.,64.,4.,4.),rectangle(-500000.,0.,1000000.,2.),rectangle(0.,0.,3.,3.)];
    let fast=cache(parts.clone(),true);let old=cache(parts,false);assert!(fast.reuses_geometry());
    for owner in 0..fast.surfaces.len(){for query in [vec![],rectangle(-64.,-64.,128.,128.),rectangle(64.,-64.,3.,3.),rectangle(-1.,-1.,2.,2.),rectangle(400000.,0.,5.,1.)]{
        assert_eq!(fast.local_excluding(owner,&query),old.local_excluding(owner,&query),"owner {owner}, query {:?}",bounds(&query));
        let prior=rectangle(1.,1.,2.,2.);assert_eq!(fast.all_excluding_with_prior(owner,prior.clone()),old.all_excluding_with_prior(owner,prior));
    }}
}
#[test]
fn batch_occupation_reuse_replacement_updates_bounds_and_preserves_other_owner(){
    let parts=vec![rectangle(0.,0.,2.,2.),rectangle(0.,0.,2.,2.),vec![]];let mut fast=cache(parts.clone(),true);let mut old=cache(parts,false);
    assert_eq!(area(&fast.local_excluding(0,&rectangle(0.,0.,2.,2.))),4.);
    for replacement in [rectangle(128.,128.,4.,4.),vec![],rectangle(-128.,-128.,4.,4.)]{
        fast.replace(1,replacement.clone());old.replace(1,replacement);
        for owner in 0..3{for q in [rectangle(-129.,-129.,8.,8.),rectangle(-1.,-1.,4.,4.),rectangle(127.,127.,8.,8.)]{assert_eq!(fast.local_excluding(owner,&q),old.local_excluding(owner,&q));}}
    }
}
#[test]
fn batch_occupation_reuse_keeps_large_legacy_batches_untruncated(){
    let parts=(0..65).map(|i|rectangle(i as f64*70.,0.,2.,2.)).collect::<Vec<_>>();let fast=cache(parts.clone(),true);let old=cache(parts,false);
    assert!(!fast.reuses_geometry());assert_eq!(fast.local_excluding(0,&rectangle(4480.,0.,2.,2.)),old.local_excluding(0,&rectangle(4480.,0.,2.,2.)));
    assert_eq!(area(&fast.local_excluding(0,&rectangle(4480.,0.,2.,2.))),4.);
}

const GAIN:&[u8]=include_bytes!("../tests/fixtures/single-need-postbatch-java-0002.json");
const LOSS:&[u8]=include_bytes!("../tests/fixtures/single-need-postbatch-java-0080.json");
fn run(request:PlanBatchRequest,reuse:bool)->(Vec<u8>,Vec<Value>,Value){
    let _reuse=BatchOccupationMode::new(reuse);let _growth=single_incumbent_growth::Mode::new(true);
    let _need=single_need_continuation::Mode::new(true);let _prepose=single_native_prepose::Mode::new(true);
    let mut need=single_need_continuation::Capture::new();let portal=single_native_prepose::diagnostics::Capture::begin();
    let batch=plan_batch(request).unwrap();
    (serde_json::to_vec(&batch).unwrap(),need.take(),serde_json::to_value(portal.reports()).unwrap())
}
#[test]
fn batch_occupation_reuse_real0002_and0080_native_transport_and_guards_exact(){
    for (bytes,expected) in [(GAIN,"dae76c050c56d30544953155630b92c94e7e2f471caa349452134c8d011da632"),(LOSS,"c3a23e3e4c7b26919e742662b48aa61565118c48a3ea53fd80197b8ba3f0528f")]{
        let request:PlanBatchRequest=serde_json::from_slice(bytes).unwrap();let old=run(request.clone(),false);let fast=run(request,true);
        assert_eq!(digest(&old.0),expected);assert_eq!(old,fast,"whole native transport, Need checks and prepose budgets must remain exact");
    }
}

// ROOT-only small-corpus proof. Timed sections call the actual native plan API;
// Windows thread CPU comes from GetThreadTimes, never from operation counters.
#[cfg(windows)]
fn thread_cpu_100ns()->Option<u64>{
    #[repr(C)]struct FileTime{low:u32,high:u32}
    #[link(name="kernel32")]
    unsafe extern "system" {
        fn GetCurrentThread()->*mut std::ffi::c_void;
        fn GetThreadTimes(thread:*mut std::ffi::c_void,creation:*mut FileTime,exit:*mut FileTime,kernel:*mut FileTime,user:*mut FileTime)->i32;
    }
    let mut creation=FileTime{low:0,high:0};let mut exit=FileTime{low:0,high:0};let mut kernel=FileTime{low:0,high:0};let mut user=FileTime{low:0,high:0};
    let ok=unsafe{GetThreadTimes(GetCurrentThread(),&mut creation,&mut exit,&mut kernel,&mut user)};
    (ok!=0).then(||((kernel.high as u64)<<32|kernel.low as u64)+((user.high as u64)<<32|user.low as u64))
}
#[cfg(not(windows))]fn thread_cpu_100ns()->Option<u64>{None}
fn timed_native_api(request:PlanBatchRequest,reuse:bool)->(Vec<u8>,f64,Option<f64>){
    let _reuse=BatchOccupationMode::new(reuse);let _growth=single_incumbent_growth::Mode::new(true);
    let _need=single_need_continuation::Mode::new(true);let _prepose=single_native_prepose::Mode::new(true);
    // Capture is OFF in these repetitions. Parsing, input cloning and output
    // serialization are outside the measured native API/CPU interval.
    let cpu=thread_cpu_100ns();let started=std::time::Instant::now();let batch=plan_batch(request).unwrap();
    let wall_ms=started.elapsed().as_secs_f64()*1000.;let cpu_ms=cpu.zip(thread_cpu_100ns()).map(|(a,b)|(b-a)as f64/10000.);
    (serde_json::to_vec(&batch).unwrap(),wall_ms,cpu_ms)
}
fn original0000(root:&std::path::Path)->PlanBatchRequest{
    let raw=std::fs::read(root.join("web/out/java100k-single-need-cumulative-workspace-v2/core-pages/sites/0000.json")).unwrap();
    assert_eq!(digest(&raw),"e7be8ca5b6427056577c10be146e0d59a89c594fe5a062da0cb13be3399c90c9");
    let metadata:Value=serde_json::from_slice(&raw).unwrap();assert!(metadata.get("schema_version").is_none()&&metadata.get("settings").is_none()&&metadata.get("footprints").is_none());
    assert_eq!(metadata["requests"].as_array().unwrap().len(),64);
    let start=raw.iter().position(|b|!b.is_ascii_whitespace()).unwrap();let end=raw.iter().rposition(|b|!b.is_ascii_whitespace()).unwrap();
    assert_eq!(raw[start],b'{');assert_eq!(raw[end],b'}');
    // Preserve original lexical numbers. Public scoped Std decoder consumes
    // this unchanged raw page body; its pagination fields are ignored by the
    // existing non-deny_unknown PlanBatchRequest, never fed back as geometry.
    let mut wire=br#"{"schema_version":"native-parent-batch-1","batch":{"schema_version":"1","settings":{"parcel_fit":true},"footprints":{},"#.to_vec();
    wire.extend_from_slice(&raw[start+1..end]);wire.extend_from_slice(br#"},"prior_occupation":{"land_parts":[],"roof_parts":[]}}"#);
    assembly::transport::parse_parent_batch_request(&wire).unwrap().batch
}
#[test]
#[ignore="ROOT ONLY: real original64/0002/0080 CPU and byte A/B; no full132 or million"]
fn batch_occupation_reuse_small_corpus_cpu_and_bytes(){
    let root=std::path::PathBuf::from(std::env::var_os("BATCH_OCCUPATION_PROOF_ROOT").expect("repository root"));
    let out=std::path::PathBuf::from(std::env::var_os("BATCH_OCCUPATION_PROOF_OUT").expect("fresh proof output"));std::fs::create_dir(&out).unwrap();
    let cases=[("0000_original64",original0000(&root)),("0002_original_transport",serde_json::from_slice(GAIN).unwrap()),("0080_original_transport",serde_json::from_slice(LOSS).unwrap())];
    let mut timings=vec![];
    for (name,input) in cases{
        let reference=run(input.clone(),false);let candidate=run(input.clone(),true);
        std::fs::write(out.join(format!("{name}-reference.json")),&reference.0).unwrap();std::fs::write(out.join(format!("{name}-candidate.json")),&candidate.0).unwrap();
        assert_eq!(reference,candidate,"{name}: native bytes/checks/budgets");
        for round in 0..3{for reuse in if round%2==0{[false,true]}else{[true,false]}{
            let (actual,wall_ms,cpu_ms)=timed_native_api(input.clone(),reuse);
            assert_eq!(reference.0,actual,"{name}: repeated native transport drift");
            timings.push(json!({"case":name,"round":round,"reuse":reuse,"native_api_wall_ms":wall_ms,"native_api_thread_cpu_ms":cpu_ms,"transport_sha256":digest(&actual)}));
        }}
    }
    std::fs::write(out.join("summary.json"),serde_json::to_vec_pretty(&json!({"complete":true,"cases":3,"timings":timings,
        "qualification":"Actual native plan_batch API in test build with ordinary modes explicitly ON; timed repetitions have captures OFF and exclude parse/input clone/output serialization, warmups excluded. Thread CPU is measured on Windows, wall is shared-machine observation. All original requests/settings/need/seeds and exact transports/guard reports preserved. No scene population/capacity or million benchmark."})).unwrap()).unwrap();
}
