//! Replay the unmodified City Bench request and its captured raster, no server.
use magna_urbis_core::urban::{Geography,LayoutConfig,Site,Street,Surface,VectorGeography,generate_quarters};
use serde::Deserialize;
#[derive(Deserialize)]
#[serde(rename_all="camelCase")]
struct Case {seed:String,n:usize,width:f64,height:Vec<f32>,water:Vec<u8>,geometry:Option<VectorGeography>,sites:Vec<Site>,roads:Vec<Street>,layout_config:LayoutConfig}
fn main()->Result<(),Box<dyn std::error::Error>> {
    let args:Vec<_>=std::env::args().collect();
    let f:Case=serde_json::from_slice(&std::fs::read(&args[1])?)?;
    let geography=f.geometry.map(|g|Geography::new(g,f.width)).transpose()?;
    let surface=Surface{geometry:geography.as_ref(),n:f.n,width:f.width,height:&f.height,water:&f.water};
    let layouts=generate_quarters(&f.seed,&f.sites,&f.layout_config,surface,&f.roads)?;
    std::fs::create_dir_all(&args[2])?;
    std::fs::write(format!("{}/layouts.json",args[2]),serde_json::to_vec(&layouts)?)?;
    println!("{}",serde_json::json!({"detachment":f.layout_config.port_detachment,"shelter":f.layout_config.port_shelter,"layouts":layouts.iter().map(|l|serde_json::json!({"center":l.center,"blocks":l.blocks.len(),"quarters":l.quarters.len(),"quays":l.streets.iter().filter(|s|s.role=="quay").collect::<Vec<_>>(),"works":l.streets.iter().filter(|s|matches!(s.role.as_str(),"mole"|"pier"|"landing")).collect::<Vec<_>>() })).collect::<Vec<_>>()}));
    Ok(())
}

