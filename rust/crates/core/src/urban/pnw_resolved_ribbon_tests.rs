//! Real PNW input plus explicitly synthetic corridor guards; no input repair.
use super::*;
use super::super::resolve;
use serde::Deserialize;
use serde_json::{Value,json};
#[derive(Deserialize)]
#[serde(rename_all="camelCase")]
struct Fixture {
 seed:String,n:usize,width:f64,height:Vec<f32>,water:Vec<u8>,water_level:Vec<f32>,sites:Vec<Site>,roads:Vec<Street>,
 layout_config:LayoutConfig,parcel_config:crate::urban::ParcelConfig,
}
fn fixture()->Fixture { serde_json::from_slice(include_bytes!("fixtures/pnw-ribbon-exact.json")).unwrap() }
fn surface(f:&Fixture)->Surface<'_>{Surface{geometry:None,width:f.width,n:f.n,height:&f.height,water:&f.water}}
fn morph(f:&Fixture)->Morph { resolve("pnw-plank-village","culture","village","village",f.layout_config.density,&f.layout_config.params,"quarters").unwrap() }
fn covered(st:&Street,domain:&Shape,surface:Surface<'_>,cfg:&LayoutConfig)->bool {
 let p=g::polygon(domain);
 routing::path_clear(surface,&st.path,cfg.max_street_grade)&&g::ribbon(&st.path,&st.widths).iter().all(|s|g::polygon(s).relate(&p).is_coveredby())
}
#[test]
fn resolved_auto_and_explicit_ribbon_use_the_same_existing_constructor() {
 let f=fixture();assert!(f.roads.is_empty());let m=morph(&f);let s=surface(&f);
 let auto=generate(&f.seed,&f.sites[0],&f.layout_config,&m,s,&f.roads,f.sites[0].radius);
 let mut cfg=f.layout_config.clone();cfg.footprint.mechanism="ribbon".into();
 let explicit=generate(&f.seed,&f.sites[0],&cfg,&m,s,&f.roads,f.sites[0].radius);
 assert_eq!(auto.structure.mechanism,"ribbon");assert_eq!(explicit.structure.mechanism,"ribbon");
 assert_eq!(serde_json::to_vec(&auto.structure.allocated).unwrap(),serde_json::to_vec(&explicit.structure.allocated).unwrap());
 assert_eq!(serde_json::to_vec(&auto.guides).unwrap(),serde_json::to_vec(&explicit.guides).unwrap());
 assert!(!auto.guides.is_empty(),"Actual ribbon axis must survive as real circulation");
 for st in &auto.guides { assert!(auto.structure.allocated.iter().any(|d|covered(st,d,s,&cfg))); }
}
#[test]
fn an_existing_regional_axis_is_not_duplicated_as_a_fallback_guide() {
 let f=fixture();let s=surface(&f);let m=morph(&f);let c=f.sites[0].center;
 let road=Street{path:vec![Point{x:c.x-600.,y:c.y},Point{x:c.x+600.,y:c.y}],widths:vec![5.;2],rank:1,role:"regional".into()};
 let original=serde_json::to_vec(&road).unwrap();
 let output=generate(&f.seed,&f.sites[0],&f.layout_config,&m,s,std::slice::from_ref(&road),f.sites[0].radius);
 assert!(output.structure.metrics.allocated_area>0.);assert!(output.guides.is_empty(),"The imported axis already belongs to growth_roads");
 assert_eq!(serde_json::to_vec(&road).unwrap(),original);
}
fn axis()->Street{Street{path:vec![Point{x:100.,y:300.},Point{x:500.,y:300.}],widths:vec![5.;2],rank:1,role:"street".into()}}
fn test_surface<'a>(height:&'a[f32],water:&'a[u8])->Surface<'a>{Surface{geometry:None,width:640.,n:64,height,water}}
#[test]
fn a_hole_inside_the_full_stroke_refuses_an_otherwise_clear_centerline() {
 let h=vec![10.;64*64];let w=vec![0;h.len()];let s=test_surface(&h,&w);let cfg=LayoutConfig::default();
 let mut domain=g::rectangle(150.,250.,450.,350.);
 // Off-center hole: checking only the route's endpoints/centerline misses it.
 domain.holes.push(vec![Point{x:290.,y:301.},Point{x:291.,y:301.},Point{x:291.,y:302.},Point{x:290.,y:302.}]);
 let domain=g::normalized(domain);assert!(g::polygon(&domain).is_valid());
 assert!(routing::path_clear(s,&axis().path,cfg.max_street_grade));
 let before=serde_json::to_vec(&domain).unwrap();
 assert!(internal_ribbon_guides(&[axis()],std::slice::from_ref(&domain),s,&cfg).is_empty());
 assert_eq!(serde_json::to_vec(&domain).unwrap(),before,"No hole filling or envelope repair");
}
#[test]
fn an_uncrossable_terrain_barrier_refuses_the_internal_guide() {
 let h=(0..64*64).map(|i|if i%64>=32{1000.}else{10.}).collect::<Vec<f32>>();let w=vec![0;h.len()];
 let s=test_surface(&h,&w);let cfg=LayoutConfig::default();let d=g::rectangle(150.,250.,450.,350.);
 assert!(!routing::path_clear(s,&axis().path,cfg.max_street_grade));
 assert!(internal_ribbon_guides(&[axis()],&[d],s,&cfg).is_empty());
}
#[test]
fn exact_empty_road_pnw_keeps_real_circulation_through_unchanged_quarter_service() {
 let f=fixture();assert!(f.roads.is_empty());assert!(f.water.iter().all(|&w|w==0));assert!(f.height.iter().all(|&h|h==10.));
 let before=serde_json::to_vec(&f.layout_config).unwrap();let s=surface(&f);
 let layouts=crate::urban::generate_quarters(&f.seed,&f.sites,&f.layout_config,s,&f.roads).unwrap();
 let parts=crate::urban::generate_parcels(&f.seed,&layouts,&f.parcel_config).unwrap();
 let ids=(0..layouts.len()).collect::<Vec<_>>();let mut index=crate::urban::building_sites::BuildingSiteIndex::prepare(&layouts,&parts,&ids).unwrap();let mut sites=vec![];
 loop { let page=index.page(&f.seed,&layouts,&parts,s,&f.water_level,None,sites.len(),64,24*1024*1024).unwrap();let total=page.total;assert!(!page.requests.is_empty()||sites.len()==total);sites.extend(page.requests);if sites.len()==total{break;} }
 let expected:Value=serde_json::from_slice(include_bytes!("fixtures/pnw-ribbon-original-needs-bits.json")).unwrap();
 let programme=layouts[0].programme.as_ref().unwrap();let mut checks=vec![];
 for row in expected.as_array().unwrap() {
  let demand=programme.demands.iter().find(|d|d.id==row["id"].as_str().unwrap()).expect("Original demand ID retained");
  let bits=|key:&str|u64::from_str_radix(row[key].as_str().unwrap(),16).unwrap();
  checks.push(json!({"id":demand.id,"requestedExact":demand.requested.to_bits()==bits("requestedBits"),"targetAreaExact":demand.target_area.to_bits()==bits("targetAreaBits"),"frontageExact":demand.target_frontage.to_bits()==bits("targetFrontageBits"),
   "identityExact":demand.function==row["function"].as_str().unwrap()&&demand.role==row["role"].as_str().unwrap()&&demand.unit==row["unit"].as_str().unwrap()}));
 }
 let st=layouts[0].structure.as_ref().unwrap();
 let report=json!({"scope":"original PNW input; corrected resolved ribbon+real internal circulation, no incoming road/water/need edit, no household capacity proof",
  "recordedBaselineFoundationAreaBeforeDrop":23960.89953706591,"targetArea":st.metrics.target_area,"allocatedAreaAfterService":st.metrics.allocated_area,"quartersAfterService":layouts[0].quarters.len(),"streets":layouts[0].streets.len(),
  "blocks":layouts[0].blocks.len(),"parcels":parts.iter().map(|p|p.parcels.len()).sum::<usize>(),"buildingRequests":sites.len(),"needs":checks,"capacity":"unknown"});
 if let Some(out)=std::env::var_os("PNW_RIBBON_OUT") {
  let out=std::path::PathBuf::from(out);std::fs::create_dir_all(&out).unwrap();
  for(name,value)in[("layouts.json",serde_json::to_value(&layouts).unwrap()),("partitions.json",serde_json::to_value(&parts).unwrap()),("requests.json",serde_json::to_value(&sites).unwrap()),("result.json",report.clone())]{std::fs::write(out.join(name),serde_json::to_vec(&value).unwrap()).unwrap();}
 }
 eprintln!("PNW_RESOLVED_RIBBON {}",serde_json::to_string(&report).unwrap());
 assert!(!layouts[0].quarters.is_empty()&&st.metrics.allocated_area>0.,"Original measured service drop must be resolved");
 assert!(!layouts[0].streets.is_empty(),"Real circulation, not an access waiver");
 assert!(st.metrics.target_area>=24000.,"No lower target or quota");
 assert!(report["needs"].as_array().unwrap().iter().all(|r|r["requestedExact"]==true&&r["targetAreaExact"]==true&&r["frontageExact"]==true&&r["identityExact"]==true),"Every original requested need stays exact");
 assert_eq!(serde_json::to_vec(&f.layout_config).unwrap(),before);assert!(f.roads.is_empty());
}
