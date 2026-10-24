use super::*;
use serde::Deserialize;
use serde_json::json;
fn observed(shape: &Shape, streets: &[Street]) -> bool {
 let mut all=Bins::new(20.,usize::MAX);all.sync(streets);
 let reach=streets.iter().flat_map(|s|s.widths.iter()).fold(0_f64,|a,&w|a.max(w))*0.5+2.;
 block_boundary_served(shape,streets,&all,reach)
}
fn street(a:Point,b:Point)->Street { Street {path:vec![a,b],widths:vec![6.,6.],rank:1,role:"street".into()} }
fn baseline()->Layout {serde_json::from_slice::<Vec<Layout>>(include_bytes!("fixtures/pnw-ribbon-only-layout.json")).unwrap().remove(0)}
#[test]
fn real_pnw_carved_hole_faces_the_retained_native_street() {
 let l=baseline();assert_eq!(l.blocks.len(),1);assert_eq!(l.streets.len(),1);
 let shape=&l.blocks[0].shape;assert_eq!(shape.holes.len(),1);
 let before=serde_json::to_vec(shape).unwrap();let mut outer_only=shape.clone();outer_only.holes.clear();
 assert!(!observed(&outer_only,&l.streets),"Measured old outer-only counterexample");
 assert!(observed(shape,&l.streets),"The true carved boundary faces the actual retained street");
 assert_eq!(serde_json::to_vec(shape).unwrap(),before,"Do not fill or rewrite the hole");
}
#[test]
fn outer_frontage_keeps_the_existing_width_and_distance_contract() {
 let shape=g::rectangle(0.,0.,100.,100.);
 assert!(observed(&shape,&[street(Point{x:0.,y:-3.},Point{x:100.,y:-3.})]));
 assert!(!observed(&shape,&[street(Point{x:0.,y:-5.01},Point{x:100.,y:-5.01})]));
}
#[test]
fn a_hole_without_any_real_retained_street_does_not_supply_access() {
 let l=baseline();assert!(!l.blocks[0].shape.holes.is_empty());
 assert!(!observed(&l.blocks[0].shape,&[]));
}
#[test]
fn a_real_street_separated_from_the_hole_boundary_is_not_access() {
 let mut shape=g::rectangle(0.,0.,100.,100.);shape.holes.push(g::rectangle(20.,20.,80.,80.).outer);
 // A short street exists in the void, but is separated from every actual
 // boundary by more than its physical half-width + existing 2 m tolerance.
 assert!(!observed(&shape,&[street(Point{x:40.,y:50.},Point{x:60.,y:50.})]));
}
#[derive(Deserialize)]
#[serde(rename_all="camelCase")]
struct Fixture {seed:String,n:usize,width:f64,height:Vec<f32>,water:Vec<u8>,water_level:Vec<f32>,sites:Vec<Site>,roads:Vec<Street>,layout_config:LayoutConfig,parcel_config:crate::urban::ParcelConfig}
#[test]
fn exact_pnw_retains_a_real_served_block_and_records_the_remaining_admissions() {
 let f:Fixture=serde_json::from_slice(include_bytes!("fixtures/pnw-ribbon-exact.json")).unwrap();
 assert!(f.roads.is_empty());assert!(f.height.iter().all(|&h|h==10.));assert!(f.water.iter().all(|&w|w==0));
 let s=Surface{geometry:None,width:f.width,n:f.n,height:&f.height,water:&f.water};
 let layouts=crate::urban::generate_quarters(&f.seed,&f.sites,&f.layout_config,s,&f.roads).unwrap();
 let parts=crate::urban::generate_parcels(&f.seed,&layouts,&f.parcel_config).unwrap();
 let ids=(0..layouts.len()).collect::<Vec<_>>();let mut index=crate::urban::building_sites::BuildingSiteIndex::prepare(&layouts,&parts,&ids).unwrap();let mut sites=vec![];
 loop {let page=index.page(&f.seed,&layouts,&parts,s,&f.water_level,None,sites.len(),64,24*1024*1024).unwrap();let total=page.total;assert!(!page.requests.is_empty()||sites.len()==total);sites.extend(page.requests);if sites.len()==total{break;}}
 let programme=layouts[0].programme.as_ref().unwrap();
 let expected:serde_json::Value=serde_json::from_slice(include_bytes!("fixtures/pnw-ribbon-original-needs-bits.json")).unwrap();
 for row in expected.as_array().unwrap() {let d=programme.demands.iter().find(|n|n.id==row["id"].as_str().unwrap()).unwrap();let bits=|key:&str|u64::from_str_radix(row[key].as_str().unwrap(),16).unwrap();assert_eq!((&d.function,&d.role,&d.unit),(&row["function"].as_str().unwrap().to_string(),&row["role"].as_str().unwrap().to_string(),&row["unit"].as_str().unwrap().to_string()));assert_eq!((d.requested.to_bits(),d.target_area.to_bits(),d.target_frontage.to_bits()),(bits("requestedBits"),bits("targetAreaBits"),bits("targetFrontageBits")));}
 let report=json!({"scope":"Original PNW; retained street frontage outer+holes; no household capacity proof","quarters":layouts[0].quarters.len(),"streets":layouts[0].streets.len(),"blockKinds":layouts[0].blocks.iter().map(|b|&b.kind).collect::<Vec<_>>(),"parcels":parts.iter().map(|p|p.parcels.len()).sum::<usize>(),"siteCount":sites.len(),"siteFunctions":sites.iter().map(|r|r.get("function")).collect::<Vec<_>>(),"targetArea":layouts[0].structure.as_ref().unwrap().metrics.target_area,"capacity":"unknown"});
 if let Some(out)=std::env::var_os("PNW_BOUNDARY_OUT") {let out=std::path::PathBuf::from(out);std::fs::create_dir_all(&out).unwrap();for(name,value)in[("layouts.json",serde_json::to_value(&layouts).unwrap()),("partitions.json",serde_json::to_value(&parts).unwrap()),("requests.json",serde_json::to_value(&sites).unwrap()),("result.json",report.clone())]{std::fs::write(out.join(name),serde_json::to_vec(&value).unwrap()).unwrap();}}
 eprintln!("PNW_BLOCK_BOUNDARY {}",serde_json::to_string(&report).unwrap());
 assert!(!layouts[0].quarters.is_empty());assert!(!layouts[0].streets.is_empty());
 assert!(layouts[0].blocks.iter().any(|b|b.kind=="block"&&observed(&b.shape,&layouts[0].streets)),"A real carved public boundary must prevent the measured false reserve");
 assert!(layouts[0].structure.as_ref().unwrap().metrics.target_area>=24000.);
 assert!(f.roads.is_empty());
 // Deliberately no assertion that a resident/household is housed or any
 // native building is realised: the next admission outcome must be measured.
}
