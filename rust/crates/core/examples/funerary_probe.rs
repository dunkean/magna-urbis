//! Replay a City Bench fixture, write programme geometry and a plan SVG.
use magna_urbis_core::urban::{Geography,LayoutConfig,ParcelConfig,Site,Street,Surface,VectorGeography,building_sites,generate_parcels,generate_quarters};
use serde::Deserialize;
use std::{collections::BTreeMap,fmt::Write};
#[derive(Deserialize)]
#[serde(rename_all="camelCase")]
struct Fixture {seed:String,n:usize,width:f64,height:Vec<f32>,water:Vec<u8>,#[serde(default)] water_level:Vec<f32>,geometry:Option<VectorGeography>,sites:Vec<Site>,roads:Vec<Street>,layout_config:LayoutConfig,#[serde(default)] parcel_config:ParcelConfig}
fn main()->Result<(),Box<dyn std::error::Error>> {
    let args:Vec<_>=std::env::args().collect();
    let f:Fixture=serde_json::from_slice(&std::fs::read(&args[1])?)?;
    let geo=f.geometry.map(|g|Geography::new(g,f.width)).transpose()?;
    let surface=Surface{geometry:geo.as_ref(),width:f.width,n:f.n,height:&f.height,water:&f.water};
    let start=std::time::Instant::now();
    let layouts=generate_quarters(&f.seed,&f.sites,&f.layout_config,surface,&f.roads)?;
    let parts=generate_parcels(&f.seed,&layouts,&f.parcel_config)?;
    let level=if f.water_level.is_empty(){vec![0.;f.height.len()]}else{f.water_level};
    let request_start=std::time::Instant::now();
    let requests=building_sites::requests(&f.seed,&layouts,&parts,surface,&level,None)?;
    println!("requests {:.3}s; total {:.3}s",request_start.elapsed().as_secs_f64(),start.elapsed().as_secs_f64());
    let mut counts=BTreeMap::new();let mut pieces=BTreeMap::new();
    for r in &requests {let role=r["programme"]["role"].as_str().unwrap_or("");*counts.entry(role).or_insert(0usize)+=1;*pieces.entry(role).or_insert(0usize)+=r["preview"].as_array().map_or(0,Vec::len);}
    println!("allocations {counts:?}\npieces {pieces:?}");
    for p in &parts {if let Some(pr)=&p.programme {for d in &pr.demands {if d.role.starts_with("funerary")||d.role=="open.necropolis" {println!("{} wanted {} held {} deficit {}",d.role,d.sites,d.parcel_capacity,d.deficit);}}}}
    let mut bounds=[f64::INFINITY,f64::INFINITY,f64::NEG_INFINITY,f64::NEG_INFINITY];
    for l in &layouts {for b in &l.blocks {for p in &b.shape.outer {bounds[0]=bounds[0].min(p.x);bounds[1]=bounds[1].min(p.y);bounds[2]=bounds[2].max(p.x);bounds[3]=bounds[3].max(p.y);}}}
    let mut svg=format!("<svg xmlns='http://www.w3.org/2000/svg' width='1400' height='1100' viewBox='{} {} {} {}'><rect x='{}' y='{}' width='{}' height='{}' fill='#e3d8b6'/>",bounds[0]-20.,bounds[1]-20.,bounds[2]-bounds[0]+40.,bounds[3]-bounds[1]+40.,bounds[0]-20.,bounds[1]-20.,bounds[2]-bounds[0]+40.,bounds[3]-bounds[1]+40.);
    let path=|s:&magna_urbis_core::urban::Shape| {let mut d=String::new();for ring in std::iter::once(&s.outer).chain(&s.holes) {for(i,p) in ring.iter().enumerate(){write!(d,"{}{},{}",if i==0{"M"}else{"L"},p.x,p.y).unwrap();}d.push('Z');}d};
    for (l,p) in layouts.iter().zip(&parts) {for b in &l.blocks {write!(svg,"<path d='{}' fill='#c4bda1' stroke='#a49d84' stroke-width='.4'/>",path(&b.shape))?;}
        if let Some(pr)=&p.programme {for a in &pr.allocations {if matches!(a.role.as_str(),"open.necropolis"|"open.cemetery") {if let Some(lot)=p.parcels.iter().find(|p|p.id==a.parcel_id) {write!(svg,"<path d='{}' fill='#a8ad99' stroke='#727c6b' stroke-width='.8'/>",path(&lot.shape))?;}}}}
        for s in &l.streets {let points=s.path.iter().map(|p|format!("{},{}",p.x,p.y)).collect::<Vec<_>>().join(" ");let w=s.widths.first().copied().unwrap_or(3.);write!(svg,"<polyline points='{points}' fill='none' stroke='#e4d8ba' stroke-width='{w}'/>")?;}}
    for r in &requests {let role=r["programme"]["role"].as_str().unwrap_or("");let fill=if role.ends_with(".ruin"){"#6c6b60"}else if role.starts_with("funerary"){"#cbcabc"}else if role=="open.necropolis"||role=="open.cemetery"{"#e3dfcc"}else{"#958c78"};let shapes:Vec<magna_urbis_core::urban::Shape>=serde_json::from_value(r["preview"].clone())?;for s in shapes {write!(svg,"<path d='{}' fill='{fill}' stroke='#58594f' stroke-width='.35' fill-rule='evenodd'/>",path(&s))?;}}
    svg.push_str("</svg>");std::fs::write(format!("{}.svg",args[2]),svg)?;
    std::fs::write(format!("{}.json",args[2]),serde_json::to_vec(&serde_json::json!({"layouts":layouts,"partitions":parts,"requests":requests}))?)?;
    Ok(())
}
