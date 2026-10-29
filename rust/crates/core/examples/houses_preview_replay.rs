//! Re-read frozen Roman lots with the current site programme; no city generation.
use magna_urbis_core::urban::{Layout,Partition,Surface,VectorGeography,Geography,building_sites::BuildingSiteIndex};
use serde::Deserialize;
use std::path::PathBuf;
#[derive(Deserialize)] #[serde(rename_all="camelCase")]
struct Terrain { seed:String,n:usize,width:f64,height:Vec<f32>,water:Vec<u8>,water_level:Vec<f32>,geometry:Option<VectorGeography> }
fn main()->Result<(),Box<dyn std::error::Error>> {
    let args:Vec<_>=std::env::args().collect();
    if args.len()!=4{return Err("houses_preview_replay FROZEN_DIRECTORY TERRAIN_FIXTURE OUTPUT".into());}
    let dir=PathBuf::from(&args[1]);
    let raw:serde_json::Value=serde_json::from_slice(&std::fs::read(&args[2])?)?;
    let t:Terrain=serde_json::from_value(raw)?;
    let layouts:Vec<Layout>=serde_json::from_slice(&std::fs::read(dir.join("layouts.json"))?)?;
    let partitions:Vec<Partition>=serde_json::from_slice(&std::fs::read(dir.join("partitions.json"))?)?;
    let geo=t.geometry.map(|g|Geography::new(g,t.width)).transpose()?;
    let surface=Surface{geometry:geo.as_ref(),width:t.width,n:t.n,height:&t.height,water:&t.water};
    let selected:Vec<_>=(0..layouts.len()).collect();
    let mut index=BuildingSiteIndex::prepare(&layouts,&partitions,&selected)?;
    let mut output=vec![];
    loop {
        let page=index.page(&t.seed,&layouts,&partitions,surface,&t.water_level,None,output.len(),64,24*1024*1024)?;
        if page.requests.is_empty() && output.len()<page.total{return Err("Empty incomplete native site page".into());}
        let total=page.total;output.extend(page.requests);
        if output.len()==total{break;}
    }
    std::fs::write(&args[3],serde_json::to_vec(&output)?)?;
    Ok(())
}
