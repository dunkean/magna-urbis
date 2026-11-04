//! Flat-ground culture witnesses, no service or shared engine required.
use magna_urbis_core::urban::{LayoutConfig,ParcelConfig,Site,Street,Surface,generate_quarters,generate_parcels,building_sites};
use std::fmt::Write;

fn main()->Result<(),Box<dyn std::error::Error>> {
    let args:Vec<_>=std::env::args().collect();
    let out=std::path::Path::new(args.get(1).ok_or("Expected output directory")?);
    std::fs::create_dir_all(out)?;
    let cultures=std::env::var("CULTURES").unwrap_or("nomad-camp,inuit-camp,native-plains".into());
    for culture in cultures.split(',') {
        let population=std::env::var("POP").ok().and_then(|s|s.parse().ok()).unwrap_or(if culture=="native-plains" {500}else{1500});
        let mut cfg:LayoutConfig=serde_json::from_str(include_str!("../src/urban/fixtures/small-layout-config.json"))?;cfg.camp_growth=std::env::var("GROWTH").unwrap_or(if culture=="nomad-camp" {"clusters"} else {"ring"}.into());cfg.camp_ring_wobble=std::env::var("WOBBLE").ok().map(|v|v.parse()).transpose()?;
        let site=Site{key:format!("review-{culture}"),name:String::new(),culture:culture.into(),population,center:magna_urbis_core::urban::Point{x:2000.,y:2000.},radius:magna_urbis_core::settlements::extent_radius(population)};
        let height=vec![10.;128*128];let water=vec![0;128*128];let level=vec![0.;128*128];
        let surface=Surface{geometry:None,width:4000.,n:128,height:&height,water:&water};
        let roads:Vec<Street>=vec![];
        let start=std::time::Instant::now();
        let layouts=generate_quarters("camp-review",&[site],&cfg,surface,&roads)?;
        let parts=generate_parcels("camp-review",&layouts,&ParcelConfig::default())?;
        let requests=building_sites::requests("camp-review",&layouts,&parts,surface,&level,None)?;
        let mut bounds=(f64::MAX,f64::MAX,f64::MIN,f64::MIN);
        for p in parts[0].parcels.iter().flat_map(|p|&p.shape.outer) {bounds=(bounds.0.min(p.x),bounds.1.min(p.y),bounds.2.max(p.x),bounds.3.max(p.y));}
        let mut svg=format!("<svg xmlns='http://www.w3.org/2000/svg' width='1000' height='1000' viewBox='{} {} {} {}'><rect x='0' y='0' width='4000' height='4000' fill='#ddd4ab'/>",bounds.0-10.,bounds.1-10.,bounds.2-bounds.0+20.,bounds.3-bounds.1+20.);
        for p in &parts[0].parcels {
            let fill=match p.use_kind.as_str(){"plot"|"compound"=>"#b8a57a","court"=>"#eeddb0",_=>"#d4cd9f"};
            let points=p.shape.outer.iter().map(|p|format!("{},{}",p.x,p.y)).collect::<Vec<_>>().join(" ");
            write!(svg,"<polygon points='{points}' fill='{fill}' stroke='#8c825e' stroke-width='.35'/>")?;
        }
        for p in requests.iter().filter_map(|r|r["preview"].as_array()).flatten() {
            if let Some(outer)=p["outer"].as_array() {
                let points=outer.iter().map(|p|format!("{},{}",p["x"],p["y"])).collect::<Vec<_>>().join(" ");
                write!(svg,"<polygon points='{points}' fill='#716955' stroke='#4e493c' stroke-width='.4'/>")?;
            }
        }
        svg.push_str("</svg>");
        std::fs::write(out.join(format!("{culture}.svg")),svg)?;
        std::fs::write(out.join(format!("{culture}.json")),serde_json::to_vec(&(&layouts,&parts,&requests))?)?;
        let pr=parts[0].programme.as_ref().ok_or("Missing programme")?;
        println!("{culture}/{population}: {:.2}s, {} requests, {:.0}/{:.0} households, {} open cells",start.elapsed().as_secs_f64(),requests.len(),pr.allocations.iter().map(|a|a.households).sum::<f64>(),pr.demands.iter().filter(|d|d.unit=="domesticUnits").map(|d|d.requested).sum::<f64>(),parts[0].parcels.iter().filter(|p|p.reason=="camp-open").count());
    }
    Ok(())
}
