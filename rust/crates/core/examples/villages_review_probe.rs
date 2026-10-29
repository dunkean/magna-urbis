//! Replay the five captured city-13 camp rasters without a native service.
use magna_urbis_core::urban::{LayoutConfig,ParcelConfig,Site,Street,Surface,generate_quarters,generate_parcels,building_sites};
use serde::Deserialize;
use std::path::PathBuf;

#[derive(Deserialize)]
#[serde(rename_all="camelCase")]
struct Fixture {
    seed:String,n:usize,width:f64,height:Vec<f32>,water:Vec<u8>,water_level:Vec<f32>,
    sites:Vec<Site>,roads:Vec<Street>,layout_config:LayoutConfig,
}
fn main()->Result<(),Box<dyn std::error::Error>> {
    let args:Vec<_>=std::env::args().collect();
    let root=PathBuf::from(args.get(1).ok_or("Expected camp fixture directory")?);
    let cases=args.get(2).map_or("mongol-ordu,inuit-camp,pnw-plank-village,guarani-village,kraal",String::as_str);
    let output=args.get(3).map_or_else(||root.join("after"),PathBuf::from);
    for culture in cases.split(',') {
        let named=root.join(format!("{culture}-fixture.json"));
        let input=if named.exists(){named}else{root.join(format!("{culture}.json"))};
        let f:Fixture=serde_json::from_slice(&std::fs::read(input)?)?;
        let surface=Surface{geometry:None,width:f.width,n:f.n,height:&f.height,water:&f.water};
        let layouts=generate_quarters(&f.seed,&f.sites,&f.layout_config,surface,&f.roads)?;
        let parts=generate_parcels(&f.seed,&layouts,&ParcelConfig::default())?;
        let requests=building_sites::requests(&f.seed,&layouts,&parts,surface,&f.water_level,None)?;
        let out=output.join(culture);std::fs::create_dir_all(&out)?;
        for (name,value) in [("layouts.json",serde_json::to_value(&layouts)?),("partitions.json",serde_json::to_value(&parts)?),("requests.json",serde_json::to_value(&requests)?)] {
            std::fs::write(out.join(name),serde_json::to_vec(&value)?)?;
        }
        let pr=parts[0].programme.as_ref().ok_or("Missing camp programme")?;
        println!("{culture}: {} previews, {:.1}/{:.1} households",requests.iter().filter(|r|r["preview"].as_array().is_some_and(|p|!p.is_empty())).count(),
            pr.allocations.iter().map(|a|a.households).sum::<f64>(),pr.demands.iter().filter(|d|d.unit=="domesticUnits").map(|d|d.requested).sum::<f64>());
    }
    Ok(())
}
