//! Captured City Bench shoreline replay, without touching the shared engine.
use magna_urbis_core::urban::{Geography,LayoutConfig,ParcelConfig,Site,Street,Surface,VectorGeography,generate_quarters,generate_parcels};
use serde::Deserialize;
#[derive(Deserialize)]
#[serde(rename_all="camelCase")]
struct Case {seed:String,n:usize,width:f64,height:Vec<f32>,water:Vec<u8>,geometry:Option<VectorGeography>,sites:Vec<Site>,roads:Vec<Street>,layout_config:LayoutConfig}
fn main()->Result<(),Box<dyn std::error::Error>> {
    let args:Vec<_>=std::env::args().collect();
    let mut f:Case=serde_json::from_slice(&std::fs::read(&args[1])?)?;
    if let Some(c)=args.get(3) {for s in &mut f.sites {s.culture=c.clone();}}
    if let Some(c)=args.get(4) {f.layout_config.lagoon_canals=Some(c.parse()?);}
    let geography=f.geometry.map(|g|Geography::new(g,f.width)).transpose()?;
    let surface=Surface{geometry:geography.as_ref(),n:f.n,width:f.width,height:&f.height,water:&f.water, interpolation: Default::default(),};
    let start=std::time::Instant::now();
    let layouts=generate_quarters(&f.seed,&f.sites,&f.layout_config,surface,&f.roads)?;
    let quarters_ms=start.elapsed().as_secs_f64()*1000.;
    let parts=generate_parcels(&f.seed,&layouts,&ParcelConfig::default())?;
    let metrics=serde_json::json!({"quartersMs":quarters_ms,"totalMs":start.elapsed().as_secs_f64()*1000.,"sites":layouts.iter().zip(&parts).map(|(l,p)| {
        let centroid=|s:&magna_urbis_core::urban::Shape|{let n=s.outer.len() as f64;magna_urbis_core::urban::Point{x:s.outer.iter().map(|p|p.x).sum::<f64>()/n,y:s.outer.iter().map(|p|p.y).sum::<f64>()/n}};
        let used:Vec<_>=p.parcels.iter().filter(|p|matches!(p.use_kind.as_str(),"plot"|"compound")).collect();
        let wet=used.iter().filter(|p|surface.wet(centroid(p.envelope.as_ref().unwrap_or(&p.shape)))).count();
        serde_json::json!({"culture":l.culture,"lots":used.len(),"wetLots":wet,"wetShare":wet as f64/used.len().max(1) as f64,"boardwalks":l.streets.iter().filter(|s|matches!(s.role.as_str(),"pier"|"boardwalk")).count(),"waterways":l.structure.as_ref().map_or(0,|s|s.waterways.len()),"warnings":l.warnings})
    }).collect::<Vec<_>>()});
    std::fs::create_dir_all(&args[2])?;
    std::fs::write(format!("{}/layouts.json",args[2]),serde_json::to_vec(&layouts)?)?;
    std::fs::write(format!("{}/partitions.json",args[2]),serde_json::to_vec(&parts)?)?;
    std::fs::write(format!("{}/metrics.json",args[2]),serde_json::to_vec_pretty(&metrics)?)?;
    println!("{metrics}");Ok(())
}
