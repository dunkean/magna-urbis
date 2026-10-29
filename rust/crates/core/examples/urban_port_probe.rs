//! Offline harbour witness: fixture.json output-directory. Extract decor samples
//! with urban_port_fixtures.py; no native service is used. Orange = port sites,
//! grey = ordinary allocated sites, cream = blocks, red = harbour works.
use magna_urbis_core::urban::{Geography, LayoutConfig, ParcelConfig, Site, Street, Surface, VectorGeography, generate_quarters, generate_parcels};
use serde::Deserialize;
use std::{fmt::Write, path::PathBuf};

#[derive(Deserialize)]
#[serde(rename_all = "camelCase")]
struct Fixture {
    seed: String, n: usize, width: f64, height: Vec<f32>, water: Vec<u8>,
    water_level: Vec<f32>, geometry: Option<VectorGeography>, sites: Vec<Site>, roads: Vec<Street>, layout_config: LayoutConfig,
}
fn polygon(svg: &mut String, shape: &magna_urbis_core::urban::Shape, fill: &str) {
    write!(svg,"<path fill='{fill}' fill-rule='evenodd' stroke='#887859' stroke-width='.3' d='").unwrap();
    for ring in std::iter::once(&shape.outer).chain(&shape.holes) {
        for (i,p) in ring.iter().enumerate() { write!(svg,"{}{},{} ",if i==0 {"M"} else {"L"},p.x,p.y).unwrap(); }
        svg.push('Z');
    }
    svg.push_str("'/>");
}
fn main() -> Result<(), Box<dyn std::error::Error>> {
    let args: Vec<_> = std::env::args().collect();
    if !(3..=5).contains(&args.len()) { return Err("Expected fixture.json output-directory [portDetachment [portShelter]]".into()); }
    let mut f: Fixture = serde_json::from_slice(&std::fs::read(&args[1])?)?;
    if let Some(v)=args.get(3) {f.layout_config.port_detachment=v.parse()?;}
    if let Some(v)=args.get(4) {f.layout_config.port_shelter=Some(v.parse()?);}
    let vector=f.geometry.as_ref().map(|g|(g.land.clone(),g.water.clone()));
    let geography = f.geometry.map(|g| Geography::new(g, f.width)).transpose()?;
    let surface = Surface { geometry: geography.as_ref(), width:f.width, n:f.n, height:&f.height, water:&f.water };
    let layouts = generate_quarters(&f.seed,&f.sites,&f.layout_config,surface,&f.roads)?;
    let parts = generate_parcels(&f.seed,&layouts,&ParcelConfig::default())?;
    let requests=magna_urbis_core::urban::building_sites::requests(&f.seed,&layouts,&parts,surface,&f.water_level,None)?;
    let out=PathBuf::from(&args[2]); std::fs::create_dir_all(&out)?;
    std::fs::write(out.join("layouts.json"),serde_json::to_vec(&layouts)?)?;
    std::fs::write(out.join("partitions.json"),serde_json::to_vec(&parts)?)?;
    std::fs::write(out.join("requests.json"),serde_json::to_vec(&requests)?)?;
    for (l,p) in layouts.iter().zip(&parts) {
        let base=if f.sites[0].population<1000 {250.} else {900.};
        let reach=l.blocks.iter().flat_map(|b|&b.shape.outer).chain(l.structure.iter().flat_map(|s|&s.quays).flat_map(|q|&q.shape.outer))
            .map(|p|(p.x-l.center.x).abs().max((p.y-l.center.y).abs())+60.).fold(base,f64::max).min(f.width*0.5);
        let left=(l.center.x-reach).clamp(0.,f.width-reach*2.);
        let top=(l.center.y-reach).clamp(0.,f.width-reach*2.);
        let mut svg=format!("<svg xmlns='http://www.w3.org/2000/svg' width='1400' height='1400' viewBox='{left} {top} {} {}'><rect x='0' y='0' width='{}' height='{}' fill='#cbd3ad'/>",reach*2.,reach*2.,f.width,f.width);
        let cell=f.width/f.n as f64;
        if let Some((land,water))=&vector {
            write!(svg,"<rect width='{}' height='{}' fill='#628d9b'/>",f.width,f.width)?;
            let shape=|rings:&Vec<Vec<magna_urbis_core::urban::Point>>| magna_urbis_core::urban::Shape {outer:rings.first().cloned().unwrap_or_default(),holes:rings.iter().skip(1).cloned().collect()};
            polygon(&mut svg,&shape(land),"#cbd3ad");
            for group in water {polygon(&mut svg,&shape(group),"#628d9b");}
        } else {for y in 0..f.n { for x in 0..f.n {
            let (px,py)=(x as f64*cell,y as f64*cell);
            if f.water[y*f.n+x]!=0 && (px-l.center.x).abs()<reach && (py-l.center.y).abs()<reach {
                write!(svg,"<rect x='{px}' y='{py}' width='{cell}' height='{cell}' fill='#628d9b'/>")?;
            }
        }}}
        for b in &l.blocks { polygon(&mut svg,&b.shape,if b.kind=="reserve" {"#a9bb85"} else {"#e3d5b6"}); }
        if let Some(pr)=&p.programme { for a in &pr.allocations {
            if a.role.starts_with("open.") {continue;}
            let port=pr.demands.iter().any(|d|d.id==a.demand_id && d.site=="quay");
            if let Some(r)=requests.iter().find(|r|r["parcel_id"]==a.parcel_id) {
                if let Ok(shapes)=serde_json::from_value::<Vec<magna_urbis_core::urban::Shape>>(r["preview"].clone()) {
                    for shape in shapes {polygon(&mut svg,&shape,if port {"#db6c26"} else {"#827b6d"});}
                }
            }
        }}
        for s in &l.streets {
            let port=matches!(s.role.as_str(),"quay"|"pier"|"mole"|"landing");
            write!(svg,"<polyline fill='none' stroke='{}' stroke-width='{}' points='",if port {"#bd3529"} else {"#fff3ce"},s.widths.first().copied().unwrap_or(3.))?;
            for p in &s.path {write!(svg,"{},{} ",p.x,p.y)?;} svg.push_str("'/>");
        }
        if let Some(s)=&l.structure {for q in &s.quays {polygon(&mut svg,&q.shape,"#b8a18a");}}
        if let Some(s)=&l.structure {for d in &s.port_districts {for shape in &d.shapes {
            svg.push_str("<g fill-opacity='0.12' stroke='#8b239b' stroke-width='1.4'>");
            polygon(&mut svg,shape,"#be72bc");svg.push_str("</g>");
        }}}
        write!(svg,"<circle cx='{}' cy='{}' r='7' fill='#b52b2b'/>",l.center.x,l.center.y)?;
        svg.push_str("</svg>"); std::fs::write(out.join(format!("{}.svg",l.culture)),svg)?;
        let pr=p.programme.as_ref().unwrap();
        let port:Vec<_>=pr.allocations.iter().filter(|a|pr.demands.iter().any(|d|d.id==a.demand_id&&d.site=="quay")).map(|a|a.role.as_str()).collect();
        let metres:f64=l.streets.iter().filter(|s|s.role=="quay").flat_map(|s|s.path.windows(2)).map(|w|(w[0].x-w[1].x).hypot(w[0].y-w[1].y)).sum();
        let unsupported:Vec<_>=l.streets.iter().filter(|s|!matches!(s.role.as_str(),"quay"|"pier"|"mole"|"landing"|"bridge"|"causeway"|"crossing"))
            .flat_map(|s|s.path.windows(2).filter_map(|w|{
                let length=(w[0].x-w[1].x).hypot(w[0].y-w[1].y);
                let wet=(1..20).filter(|&k|surface.wet(magna_urbis_core::urban::Point{x:w[0].x+(w[1].x-w[0].x)*k as f64/20.,y:w[0].y+(w[1].y-w[0].y)*k as f64/20.})).count();
                (length>10.&&wet>5).then(||serde_json::json!({"role":s.role,"length":length,"path":w}))
            })).collect();
        let report=serde_json::json!({"culture":l.culture,"population":f.sites[0].population,"center":l.center,"blocks":l.blocks.len(),"quayMetres":metres,"portRoles":port,
            "shelteredHarbour":f.layout_config.sheltered_harbour,"centerDry":!surface.wet(l.center),
            "portDetachment":f.layout_config.port_detachment,"portShelter":f.layout_config.port_shelter.unwrap_or(f64::from(f.layout_config.sheltered_harbour)),
            "portMasks":l.structure.iter().flat_map(|s|&s.port_districts).collect::<Vec<_>>(),
            "portDistricts":l.structure.iter().flat_map(|s|&s.districts).filter(|d|d.role=="port").collect::<Vec<_>>(),
            "moleMetres":l.streets.iter().filter(|s|s.role=="mole").flat_map(|s|s.path.windows(2)).map(|w|(w[0].x-w[1].x).hypot(w[0].y-w[1].y)).sum::<f64>(),
            "quayTouchesWater":l.structure.iter().flat_map(|s|&s.quays).filter(|q|q.kind=="quay").any(|q|q.shape.outer.iter().any(|&p|surface.wet(p))),
            "works":l.streets.iter().filter(|s|matches!(s.role.as_str(),"pier"|"mole"|"landing")).map(|s|s.role.as_str()).collect::<Vec<_>>(),
            "unsupportedStreets":unsupported,"portPreviews":requests.iter().filter(|r|pr.allocations.iter().any(|a|r["parcel_id"]==a.parcel_id && pr.demands.iter().any(|d|d.id==a.demand_id&&d.site=="quay"))).map(|r|serde_json::json!({"parcel":r["parcel_id"],"role":r["programme"]["role"],"function":r["function"],"preview":r["preview"]})).collect::<Vec<_>>()});
        std::fs::write(out.join("metrics.json"),serde_json::to_vec_pretty(&report)?)?;
        println!("{} pop={} center={:?} blocks={} quay_m={metres:.1} works={} port={port:?}",l.culture,f.sites[0].population,l.center,l.blocks.len(),l.streets.iter().filter(|s|matches!(s.role.as_str(),"pier"|"landing"|"mole")).count());
    }
    Ok(())
}
