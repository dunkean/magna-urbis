use super::*;
use geo::Validation;
use serde_json::{Value,json};
use std::cell::RefCell;
use std::sync::atomic::{AtomicUsize,Ordering};
std::thread_local! {static COUNTS:RefCell<Option<[usize;4]>>=const {RefCell::new(None)};}
pub(super) fn record(index:usize){COUNTS.with(|slot|{if let Some(c)=slot.borrow_mut().as_mut(){c[index]+=1;}});}
fn measured<T:Send>(run:impl FnOnce()->T+Send)->(T,[usize;4]){
 // A dedicated single-thread pool keeps every par::map conversion of this
 // call on the measured worker, without seeing unrelated Cargo test threads.
 super::super::par::with_threads(1,move||{
  COUNTS.with(|slot|assert!(slot.replace(Some([0;4])).is_none(),"No nested measurement"));
  struct Stop;impl Drop for Stop{fn drop(&mut self){COUNTS.with(|slot|{slot.replace(None);});}}
  let guard=Stop;let result=run();let counts=COUNTS.with(|slot|slot.borrow().as_ref().copied().expect("Active scoped counters"));drop(guard);(result,counts)
 })
}
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
fn encoded(v:&[Shape])->Vec<u8>{serde_json::to_vec(v).unwrap()}
fn multi(s:&Shape)->geo::MultiPolygon<f64>{geo::MultiPolygon(vec![polygon(s)])}
fn metadata()->Value{serde_json::from_str(include_str!("fixtures/byzantine-conversion-witness-bits.json")).unwrap()}
fn original_raw()->Shape{
 let m=metadata();let ring=|v:&Value|v.as_array().unwrap().iter().map(|p|{let f=|i:usize|f64::from_bits(u64::from_str_radix(p[i].as_str().unwrap(),16).unwrap());Point{x:f(0),y:f(1)}}).collect();
 Shape{outer:ring(&m["rawOuterBits"]),holes:m["rawHoleBits"].as_array().unwrap().iter().map(ring).collect()}
}
fn legacy_shapes(p: geo::MultiPolygon<f64>) -> Vec<Shape> {
    fn ring(l: &LineString<f64>) -> Vec<Point> {
        let mut r: Vec<_> = l.0.iter().map(|p| Point { x: p.x, y: p.y }).collect();
        if r.len() > 1
            && (r[0].x - r[r.len() - 1].x).abs() + (r[0].y - r[r.len() - 1].y).abs() < 1e-8
        {
            r.pop();
        }
        r.dedup_by(|a, b| (a.x - b.x).hypot(a.y - b.y) < 1e-7);
        r
    }
    p.0.into_iter()
        .filter(|p| p.unsigned_area() > 0.01)
        .map(|p| {
            normalized(Shape {
                outer: ring(p.exterior()),
                holes: p.interiors().iter().map(ring).collect(),
            })
        })
        .filter(|p| p.outer.len() >= 3)
        .collect()
}

#[test]
fn exact_root_boolean_raw_ring_is_retained_when_approximate_dedup_crosses(){
 let raw=original_raw();assert_eq!(raw.outer.len(),12);assert!(polygon(&raw).is_valid());
 let old=legacy_shapes(multi(&raw));assert_eq!(old.len(),1);assert_eq!(old[0].outer.len(),11);assert!(!polygon(&old[0]).is_valid());
 let (got,c)=measured(||shapes(multi(&raw)));assert_eq!(c,[1,1,1,1]);assert!(polygon(&got[0]).is_valid());
 assert_eq!(encoded(&got),encoded(&[normalized(raw)]),"Only preserve the actual raw boundary, no repair or coordinate displacement");
}
#[test]
fn valid_historical_near_vertex_simplification_is_byte_exact(){
 let raw=Shape{outer:vec![Point{x:0.,y:0.},Point{x:1e-8,y:0.},Point{x:10.,y:0.},Point{x:10.,y:10.},Point{x:0.,y:10.}],holes:vec![]};
 let old=legacy_shapes(multi(&raw));assert!(polygon(&old[0]).is_valid());
 let (got,c)=measured(||shapes(multi(&raw)));assert_eq!(encoded(&got),encoded(&old));assert_eq!(c,[1,1,0,0]);
}
#[test]
fn exact_duplicate_removal_never_runs_validators(){
 let raw=Shape{outer:vec![Point{x:0.,y:0.},Point{x:0.,y:0.},Point{x:10.,y:0.},Point{x:10.,y:10.},Point{x:0.,y:10.}],holes:vec![]};
 let (got,c)=measured(||shapes(multi(&raw)));assert_eq!(encoded(&got),encoded(&legacy_shapes(multi(&raw))));assert_eq!(c,[1,0,0,0]);
}
#[test]
fn ordinary_outer_and_hole_keep_the_no_validation_fast_path(){
 let mut raw=rectangle(0.,0.,100.,100.);raw.holes.push(rectangle(20.,20.,30.,30.).outer);
 let (got,c)=measured(||shapes(multi(&raw)));assert_eq!(encoded(&got),encoded(&legacy_shapes(multi(&raw))));assert_eq!(c,[1,0,0,0]);assert_eq!(got[0].holes.len(),1);
}
#[test]
fn minimum_valid_triangle_cannot_disappear_when_near_vertices_are_distinct(){
 let raw=Shape{outer:vec![Point{x:0.,y:0.},Point{x:1e-8,y:0.},Point{x:1e7,y:1e7}],holes:vec![]};
 assert!(area(&raw)>0.01);assert!(polygon(&raw).is_valid());assert!(legacy_shapes(multi(&raw)).is_empty());
 let (got,c)=measured(||shapes(multi(&raw)));assert_eq!(c,[1,1,1,1]);assert_eq!(encoded(&got),encoded(&[raw]));
}
#[test]
fn a_risky_hole_keeps_its_raw_boundary_and_the_same_outer(){
 let raw=Shape{outer:rectangle(2090.,2020.,2120.,2050.).outer,holes:vec![original_raw().outer]};
 assert!(polygon(&raw).is_valid());assert!(!polygon(&legacy_shapes(multi(&raw))[0]).is_valid());
 let (got,c)=measured(||shapes(multi(&raw)));assert_eq!(c,[1,1,1,1]);assert_eq!(encoded(&got),encoded(&[normalized(raw)]));assert!(polygon(&got[0]).is_valid());
}
#[test]
fn invalid_raw_input_is_never_repaired_or_certified_by_this_guard(){
 let raw=Shape{outer:vec![Point{x:0.,y:0.},Point{x:6.,y:4.},Point{x:0.,y:4.},Point{x:4.,y:0.},Point{x:4.-1e-8,y:0.},Point{x:-2.,y:-1.}],holes:vec![]};
 assert!(!polygon(&raw).is_valid());assert!(area(&raw)>0.01);
 let old=legacy_shapes(multi(&raw));assert_eq!(old.len(),1);assert!(!polygon(&old[0]).is_valid());
 let (got,c)=measured(||shapes(multi(&raw)));assert_eq!(encoded(&got),encoded(&old));assert_eq!(c,[1,1,1,0]);
}
#[test]
fn exact_byzantine_recut_records_cost_and_real_programme_allocation_deltas(){
 let raw=include_str!("fixtures/byzantine-raw-layouts.json");let config_raw=include_str!("fixtures/byzantine-parcel-config.json");
 let layouts:Vec<super::super::Layout>=serde_json::from_str(raw).unwrap();let cfg:super::super::ParcelConfig=serde_json::from_str(config_raw).unwrap();
 let (result,c)=measured(||super::super::generate_parcels("core-wasm-79-cultures-v1",&layouts,&cfg).unwrap());
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
