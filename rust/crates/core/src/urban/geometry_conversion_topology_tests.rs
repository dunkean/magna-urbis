use super::{area, polygon};
use geo::Validation;
use magna_urbis_geom::test_support::measure_conversions;
use serde_json::{Value,json};
use std::sync::atomic::{AtomicUsize,Ordering};
static OUTPUT_SEQUENCE:AtomicUsize=AtomicUsize::new(0);
struct OwnedOutput{path:std::path::PathBuf,root:std::path::PathBuf,temporary:bool}
impl Drop for OwnedOutput{fn drop(&mut self){
 if self.temporary&&std::fs::canonicalize(&self.path).ok().as_ref().and_then(|p|p.parent())==Some(self.root.as_path()){
  // Only the unique directory created by this test is eligible for cleanup.
  let _=std::fs::remove_dir_all(&self.path);
 }
}}
fn owned_output()->OwnedOutput{
 let (base,temporary)=match std::env::var_os("BYZ_TOPOLOGY_OUT"){
  Some(path)=>(std::path::PathBuf::from(path),false),
  None=>(std::env::temp_dir().join("magna-urbis-byz-topology-tests"),true),
 };
 std::fs::create_dir_all(&base).expect("Create optional artifact root");let root=std::fs::canonicalize(base).expect("Resolve artifact root");
 loop{
  let n=OUTPUT_SEQUENCE.fetch_add(1,Ordering::Relaxed);let path=root.join(format!("exact-byzantine-{}-{n}",std::process::id()));
  match std::fs::create_dir(&path){Ok(())=>return OwnedOutput{path,root,temporary},Err(e)if e.kind()==std::io::ErrorKind::AlreadyExists=>continue,Err(e)=>panic!("Create unique owned test directory: {e}")}
 }
}
fn metadata()->Value{serde_json::from_str(include_str!("fixtures/byzantine-conversion-witness-bits.json")).unwrap()}
#[test]
fn exact_byzantine_recut_records_cost_and_real_programme_allocation_deltas(){
 let raw=include_str!("fixtures/byzantine-raw-layouts.json");let config_raw=include_str!("fixtures/byzantine-parcel-config.json");
 let layouts:Vec<super::super::Layout>=serde_json::from_str(raw).unwrap();let cfg:super::super::ParcelConfig=serde_json::from_str(config_raw).unwrap();
 // The single-thread pool keeps parallel conversions on the measured worker.
 let (result,c)=super::super::par::with_threads(1, || {
     measure_conversions(|| super::super::generate_parcels("core-wasm-79-cultures-v1", &layouts, &cfg).unwrap())
 });
 let original=metadata();let programme=result[0].programme.as_ref().unwrap();
 for d in original["demands"].as_array().unwrap().iter().filter(|d|d["role"]!="open.garden") {
  let actual=programme.demands.iter().find(|a|a.id==d["id"].as_str().unwrap()).expect("Every original request retained");let bits=|key:&str|u64::from_str_radix(d[key].as_str().unwrap(),16).unwrap();
  assert_eq!((actual.function.as_str(),actual.role.as_str(),actual.unit.as_str()),(d["function"].as_str().unwrap(),d["role"].as_str().unwrap(),d["unit"].as_str().unwrap()));
  assert_eq!((actual.requested.to_bits(),actual.target_area.to_bits(),actual.target_frontage.to_bits()),(bits("requestedBits"),bits("targetAreaBits"),bits("targetFrontageBits")));
 }
 let invalid:Vec<_>=result.iter().flat_map(|p|p.parcels.iter()).filter(|p|!polygon(&p.shape).is_valid()).map(|p|p.id.clone()).collect();
 let gardens:Vec<_>=result.iter().flat_map(|p|p.parcels.iter()).filter(|p|p.use_kind=="garden").collect();
 let selected:Vec<_>=(0..layouts.len()).collect();let site_count=super::super::building_sites::BuildingSiteIndex::prepare(&layouts,&result,&selected).unwrap().total();
 let out=owned_output();
 let report=json!({"scope":"exact frozen BYZ layout recut; bounded boolean conversion guard only; no house/capacity proof","measurementScope":"only this call, thread-local counters inside dedicated one-thread Rayon pool","artifactDirectory":out.path,"counts":{"convertedPolygons":c[0],"riskyConversions":c[1],"convertedValidationCalls":c[1],"rawValidationCalls":c[2],"rawFallbacks":c[3]},"validationCalls":c[1]+c[2],"maxPerRiskContract":2,"parcels":result.iter().map(|p|p.parcels.len()).sum::<usize>(),"gardens":gardens.len(),"gardenArea":gardens.iter().map(|p|area(&p.shape)).sum::<f64>(),"allocations":programme.allocations.len(),"siteIndexTotal":site_count,"invalidParcels":invalid,"capacity":"unknown"});
 for(name,data)in[("raw-layouts.json",raw.as_bytes().to_vec()),("raw-parcel-config.json",config_raw.as_bytes().to_vec()),("native-before.json",include_bytes!("fixtures/byzantine-native-before.json").to_vec()),("partitions.json",serde_json::to_vec(&result).unwrap()),("result.json",serde_json::to_vec_pretty(&report).unwrap())]{std::fs::write(out.path.join(name),data).unwrap();}
 eprintln!("BYZ_TOPOLOGY_OUTPUT {}",out.path.display());
 let temporary=out.temporary;let artifact_path=out.path.clone();drop(out);if temporary{assert!(!artifact_path.exists(),"Owned temporary test output must be cleaned");}
 eprintln!("BYZ_TOPOLOGY {}",serde_json::to_string(&report).unwrap());
 assert!(invalid.is_empty(),"The exact invalid garden must be prevented at conversion, not tolerated");
 assert!(c[0]>0&&c[1]>0,"Scoped counters must observe actual conversions, never fabricate zero");
 assert!(c[3]>=1,"Must exercise the real raw-ring fallback");assert!(c[2]<=c[1]&&c[1]+c[2]<=2*c[1]);
}
