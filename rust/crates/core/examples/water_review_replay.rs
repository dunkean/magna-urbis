//! Replay a captured City Bench request; no server or terrain replacement.
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
    let start=std::time::Instant::now();
    let layouts=generate_quarters(&f.seed,&f.sites,&f.layout_config,surface,&f.roads)?;
    let ms=start.elapsed().as_secs_f64()*1000.0;
    std::fs::create_dir_all(&args[2])?;
    std::fs::write(format!("{}/layouts.json",args[2]),serde_json::to_vec(&layouts)?)?;
    let length=|s:&Street|s.path.windows(2).map(|w|(w[1].x-w[0].x).hypot(w[1].y-w[0].y)).sum::<f64>();
    let metrics=serde_json::json!({"quartersMs":ms,"layouts":layouts.iter().map(|l|serde_json::json!({"blocks":l.blocks.len(),"bridges":l.streets.iter().filter(|s|s.role=="bridge").count(),"quayMetres":l.streets.iter().filter(|s|s.role=="quay").map(length).sum::<f64>(),"works":l.streets.iter().filter(|s|matches!(s.role.as_str(),"mole"|"pier"|"landing")).count(),"walls":l.enclosures.iter().map(|e|serde_json::json!({"material":e.material,"width":e.curtain_width_m,"height":e.height_m,"waterGates":e.gatehouses.iter().filter(|g|g.kind=="water").count(),"shoreEnds":e.gatehouses.iter().filter(|g|g.kind=="shore").count(),"ditchPieces":e.ditch.len()})).collect::<Vec<_>>()})).collect::<Vec<_>>()});
    std::fs::write(format!("{}/metrics.json",args[2]),serde_json::to_vec_pretty(&metrics)?)?;
    println!("{metrics}");Ok(())
}
