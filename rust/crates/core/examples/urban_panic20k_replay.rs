//! Replay captured /urban quarters and /raster bodies without a server.
use magna_urbis_core::{settlements, urban};
use serde::Deserialize;
#[derive(Deserialize)]
#[serde(rename_all="camelCase")]
struct Request { seed:String, sites:Vec<urban::Site>, roads:Vec<urban::Street>, layout_config:urban::LayoutConfig }
#[derive(Deserialize)]
struct Header { width:f64, n:usize, geometry:Option<urban::VectorGeography> }
fn main()->Result<(),Box<dyn std::error::Error>> {
    if std::env::var_os("RAYON_NUM_THREADS").is_none() {
        let threads = std::thread::available_parallelism().map_or(2, |n| n.get());
        // Single threaded, before the first Rayon work.
        unsafe { std::env::set_var("RAYON_NUM_THREADS", threads.saturating_sub(2).max(1).to_string()) };
    }
    let args:Vec<_>=std::env::args().collect();
    if args.len()!=3 {return Err("Expected request.json raster.bin".into());}
    let request:Request=serde_json::from_slice(&std::fs::read(&args[1])?)?;
    let bytes=std::fs::read(&args[2])?;
    let end=4+u32::from_le_bytes(bytes[..4].try_into()?) as usize;
    let h:Header=serde_json::from_slice(&bytes[4..end])?;
    let data=&bytes[end..];let count=h.n*h.n;
    let floats=|i:usize| data[i*count*4..(i+1)*count*4].chunks_exact(4).map(|b|f32::from_le_bytes(b.try_into().unwrap())).collect::<Vec<_>>();
    let height=floats(0);let water_level=floats(1);let river_width=floats(2);
    let river_ids:Vec<_>=data[3*count*4..4*count*4].chunks_exact(4).map(|b|i32::from_le_bytes(b.try_into().unwrap())).collect();
    let mut terrain=settlements::Terrain::new(settlements::Raster{width:h.width,n:h.n,height:&height,water_level:&water_level,river_width:&river_width,river_ids:&river_ids,water:&data[4*count*4..]})?;
    if let Some(g)=h.geometry {terrain.set_urban_geometry(g)?;}
    let started=std::time::Instant::now();
    let layouts=terrain.urban_quarters(&request.seed,&request.sites,&request.layout_config,&request.roads)?;
    for layout in layouts {println!("{}: {} quarters, {} blocks, {} streets ({:?})",layout.culture,layout.quarters.len(),layout.blocks.len(),layout.streets.len(),started.elapsed());}
    Ok(())
}
