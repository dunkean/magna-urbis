//! Offline faubourg witnesses: fixture.json output-directory. No server used.
use magna_urbis_core::urban::{Geography,LayoutConfig,ParcelConfig,Site,Street,Surface,VectorGeography,Shape,
    generate_quarters,generate_parcels};
use serde::Deserialize;
use std::{fmt::Write,path::PathBuf};
use geo::{Area,BooleanOps,LineString,Polygon};
#[derive(Deserialize)] #[serde(rename_all="camelCase")]
struct Fixture {seed:String,n:usize,width:f64,height:Vec<f32>,water:Vec<u8>,geometry:Option<VectorGeography>,
    water_level:Vec<f32>,sites:Vec<Site>,roads:Vec<Street>,layout_config:LayoutConfig}
fn polygon(svg:&mut String,s:&Shape,fill:&str,stroke:&str) {
    write!(svg,"<path fill='{fill}' stroke='{stroke}' stroke-width='.45' fill-rule='evenodd' d='").unwrap();
    for ring in std::iter::once(&s.outer).chain(&s.holes) {
        for (i,p) in ring.iter().enumerate() {write!(svg,"{}{},{} ",if i==0 {"M"} else {"L"},p.x,p.y).unwrap();} svg.push('Z');
    } svg.push_str("'/>");
}
fn land(quarters:&[magna_urbis_core::urban::Quarter])->geo::MultiPolygon<f64> {
    let ring=|points:&Vec<magna_urbis_core::urban::Point>| {
        let mut p:Vec<_>=points.iter().map(|p|(p.x,p.y)).collect();if let Some(a)=p.first().copied() {p.push(a);}
        LineString::from(p)
    };
    let polygons:Vec<_>=quarters.iter().map(|q|Polygon::new(ring(&q.shape.outer),q.shape.holes.iter().map(ring).collect())).collect();
    geo::algorithm::bool_ops::unary_union(&polygons)
}
fn main()->Result<(),Box<dyn std::error::Error>> {
    let args:Vec<_>=std::env::args().collect();if args.len()!=3 {return Err("fixture.json output-directory".into());}
    let f:Fixture=serde_json::from_slice(&std::fs::read(&args[1])?)?;
    let water_shapes=f.geometry.as_ref().map(|g|g.water.clone());
    let geography=f.geometry.map(|g|Geography::new(g,f.width)).transpose()?;
    let surface=Surface {geometry:geography.as_ref(),width:f.width,n:f.n,height:&f.height,water:&f.water};
    let out=PathBuf::from(&args[2]);std::fs::create_dir_all(&out)?;
    let mut baseline=None;let mut inherited=None;let mut reports=vec![];
    for strength in [0.0,0.5,1.0] {
        let mut cfg=f.layout_config.clone();cfg.gate_village=Some(strength);cfg.gate_villages=false;
        let layouts=generate_quarters(&f.seed,&f.sites,&cfg,surface,&f.roads)?;
        if strength==0.0 {
            let mut old=cfg.clone();old.gate_village=None;
            let old=generate_quarters(&f.seed,&f.sites,&old,surface,&f.roads)?;
            let geometry=|layouts:&Vec<magna_urbis_core::urban::Layout>|layouts.iter().map(|l|
                serde_json::json!({"quarters":l.quarters,"blocks":l.blocks,"streets":l.streets,"enclosures":l.enclosures,"phases":l.phases})).collect::<Vec<_>>();
            assert_eq!(geometry(&layouts),geometry(&old),"zero changed old geometry");
        }
        let parts=generate_parcels(&f.seed,&layouts,&ParcelConfig::default())?;
        let requests=magna_urbis_core::urban::building_sites::requests(&f.seed,&layouts,&parts,surface,&f.water_level,None)?;
        for (l,partition) in layouts.iter().zip(&parts) {
            let quarters=land(&l.quarters);
            let changed=inherited.as_ref().map_or(0.0,|old|quarters.xor(old).unsigned_area());
            println!("{} strength={strength} inherited land delta={changed:.6} m2",l.culture);
            if inherited.is_none() {inherited=Some(quarters);}
            assert!(changed<1.0,"strength moved inherited land by {changed} m2");
            let id=format!("{}-{strength}",l.culture);
            std::fs::write(out.join(format!("{id}.json")),serde_json::to_vec(&serde_json::json!({"layout":l,"partition":partition}))?)?;
            let bounds=baseline.get_or_insert_with(|| {
                let points:Vec<_>=l.blocks.iter().flat_map(|b|&b.shape.outer).collect();
                (points.iter().map(|p|p.x).fold(f64::INFINITY,f64::min)-80.0,
                points.iter().map(|p|p.y).fold(f64::INFINITY,f64::min)-80.0,
                points.iter().map(|p|p.x).fold(f64::NEG_INFINITY,f64::max)+80.0,
                points.iter().map(|p|p.y).fold(f64::NEG_INFINITY,f64::max)+80.0)
            });
            let (x0,y0,x1,y1)=*bounds;
            let side=(x1-x0).max(y1-y0);let cx=(x0+x1)*0.5;let cy=(y0+y1)*0.5;
            let (x0,y0,x1,y1)=(cx-side*0.5,cy-side*0.5,cx+side*0.5,cy+side*0.5);
            let mut svg=format!("<svg xmlns='http://www.w3.org/2000/svg' width='1500' height='1500' viewBox='{x0} {y0} {} {}'><rect x='{x0}' y='{y0}' width='{}' height='{}' fill='#d6d7b0'/>",x1-x0,y1-y0,x1-x0,y1-y0);
            if let Some(water)=&water_shapes {for rings in water {
                polygon(&mut svg,&Shape {outer:rings.first().cloned().unwrap_or_default(),holes:rings.iter().skip(1).cloned().collect()},"#73979e","none");
            }}
            for b in &l.blocks {polygon(&mut svg,&b.shape,if b.kind=="place" {"#f3d28c"} else {"#e8ddbe"},"#b5a483");}
            let allocations=partition.programme.as_ref().map(|p|&p.allocations);
            for p in &partition.parcels {
                let role=allocations.and_then(|a|a.iter().find(|a|a.parcel_id==p.id)).map_or("",|a|a.role.as_str());
                let fill=if matches!(role,"commerce.inn"|"worship.parish"|"commerce.market.gate") {"#a65c3a"}
                    else if role.starts_with("open.") {"#b4bd94"} else {"#aa9c80"};
                polygon(&mut svg,&p.shape,if matches!(p.use_kind.as_str(),"place"|"market") {"#edd8a5"}
                    else if role.starts_with("open.") {"#b4bd94"} else {"#e2d5b3"},"#c8b99a");
                if let Some(request)=requests.iter().find(|r|r["parcel_id"]==p.id) {
                    if let Ok(shapes)=serde_json::from_value::<Vec<Shape>>(request["preview"].clone()) {
                        for s in shapes {polygon(&mut svg,&s,fill,"#85795f");}
                    }
                }
            }
            for s in &l.streets {
                write!(svg,"<polyline fill='none' stroke='{}' stroke-width='{}' points='","#fff2d4",s.widths.first().copied().unwrap_or(3.0))?;
                for p in &s.path {write!(svg,"{},{} ",p.x,p.y)?;}svg.push_str("'/>");
            }
            for e in &l.enclosures {
                write!(svg,"<polyline fill='none' stroke='#736954' stroke-width='{}' points='",e.curtain_width_m.max(2.0))?;
                for p in &e.path {write!(svg,"{},{} ",p.x,p.y)?;}svg.push_str("'/>");
                for p in &e.gates {write!(svg,"<circle cx='{}' cy='{}' r='4' fill='#f9edce' stroke='#736954' stroke-width='1'/>",p.x,p.y)?;}
            }
            svg.push_str("</svg>");std::fs::write(out.join(format!("{id}.svg")),svg)?;
            let nuclei=l.structure.as_ref().map_or(0,|s|s.gate_village_centers.len());
            let lanes=l.streets.iter().filter(|s|s.role=="faubourg-lane").count();
            let report=serde_json::json!({"culture":l.culture,"strength":strength,"inheritedLandDeltaM2":changed,"nuclei":nuclei,"lanes":lanes,
                "markets":l.blocks.iter().filter(|b|b.kind=="place"&&b.zone=="faubourg").count(),
                "marketAreaM2":l.blocks.iter().filter(|b|b.kind=="place"&&b.zone=="faubourg").map(|b| {
                    let mut ring:Vec<_>=b.shape.outer.iter().map(|p|(p.x,p.y)).collect();ring.push(ring[0]);
                    Polygon::new(LineString::from(ring),vec![]).unsigned_area()
                }).sum::<f64>(),
                "gateServices":allocations.into_iter().flatten().filter(|a|a.demand_id.contains("/gate-village/")).map(|a| {
                    let parcel=partition.parcels.iter().find(|p|p.id==a.parcel_id).unwrap();
                    let center=l.structure.as_ref().unwrap().gate_village_centers[a.demand_id.rsplit('/').next().unwrap().parse::<usize>().unwrap()];
                    let distance=parcel.shape.outer.iter().map(|p|(p.x-center.x).hypot(p.y-center.y)).fold(f64::INFINITY,f64::min);
                    serde_json::json!({"role":a.role,"nucleus":a.demand_id.rsplit('/').next(),"distanceM":distance})
                }).collect::<Vec<_>>(),
                "parcels":partition.parcels.len(),"warnings":l.warnings,
                "services":allocations.into_iter().flatten().filter(|a|matches!(a.role.as_str(),"commerce.inn"|"worship.parish")).count()});
            println!("{}",report);reports.push(report);
        }
    }
    std::fs::write(out.join(format!("{}-metrics.json",f.sites[0].culture)),serde_json::to_vec_pretty(&reports)?)?;
    Ok(())
}
