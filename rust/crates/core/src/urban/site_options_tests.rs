use super::*;

pub(super) fn svg(out: &str, name: &str, streets: &[Street], shapes: &[Shape], width:f64) {
    let mut text = format!("<svg xmlns='http://www.w3.org/2000/svg' viewBox='0 0 {width} {width}' width='900' height='900'><rect width='{width}' height='{width}' fill='#f3efda'/>");
    for s in shapes {text.push_str(&format!("<polygon points='{}' fill='#c9d8a1' stroke='#617552' stroke-width='1'/>",s.outer.iter().map(|p|format!("{},{}",p.x,p.y)).collect::<Vec<_>>().join(" ")));}
    for s in streets {text.push_str(&format!("<polyline points='{}' fill='none' stroke='#815a42' stroke-width='{}' stroke-linejoin='round'/>",s.path.iter().map(|p|format!("{},{}",p.x,p.y)).collect::<Vec<_>>().join(" "),s.widths.first().unwrap_or(&3.)));}
    text.push_str("</svg>");std::fs::create_dir_all(out).unwrap();std::fs::write(std::path::Path::new(out).join(format!("{name}.svg")),text).unwrap();
}

#[test]
fn site_option_defaults_are_omitted_and_explicit_false_round_trips_identically() {
    let a=LayoutConfig::default();
    let encoded=serde_json::to_value(&a).unwrap();
    for key in ["powerHighGround","mergeParallelStreets","regularGridOutline"] {assert!(encoded.get(key).is_none());}
    let mut old=encoded.clone();
    for key in ["powerHighGround","mergeParallelStreets","regularGridOutline"] {old[key]=json!(false);}
    let b:LayoutConfig=serde_json::from_value(old).unwrap();
    assert_eq!(serde_json::to_vec(&a).unwrap(),serde_json::to_vec(&b).unwrap());
}

#[test]
fn high_ground_applies_to_power_and_major_worship_without_changing_needs() {
    let cfg=LayoutConfig::default();
    let mut layout:Layout=serde_json::from_value(json!({"key":"hill", "culture":"european-organic", "center":{"x":500.,"y":500.},"quarters":[],"streets":[],"blocks":[],"warnings":[],"config":cfg})).unwrap();
    let functions=programme::ProgrammeFunctions::default();
    let off=roles::services_for_layout(&layout,10000,functions);
    layout.config.as_mut().unwrap().power_high_ground=true;
    let on=roles::services_for_layout(&layout,10000,functions);
    for (a,b) in off.iter().zip(&on) {
        assert_eq!(a.area,b.area);assert_eq!(a.sites,b.sites);assert_eq!(a.entry.role,b.entry.role);
        if ["worship.cathedral","defence.keep"].contains(&b.entry.role.as_str()) {assert_eq!(b.entry.site,"summit");}
        else {assert_eq!(a.entry.site,b.entry.site);}
    }
    let high=roles::SiteFacts{high:1.,core:1.,..Default::default()};
    let central=roles::SiteFacts{high:0.,core:0.,..Default::default()};
    assert!(roles::site_cost("nucleus",&central)<roles::site_cost("nucleus",&high));
    assert!(roles::site_cost("summit",&high)<roles::site_cost("summit",&central));
}

#[test]
fn high_ground_reserves_the_highest_admissible_blocks_for_church_and_keep() {
    let n=128;
    let height:Vec<f32>=(0..n*n).map(|i|100.+(i%n) as f32*0.4).collect();
    let water=vec![0;height.len()];
    let surface=Surface{geometry:None,width:1000.,n,height:&height,water:&water};
    let points=[150.,250.,350.,450.,550.,650.,750.,850.];
    let mut base=Layout{config:Some(LayoutConfig::default()),programme:None,key:"ridge".into(),culture:"european-organic".into(),
        center:Point{x:350.,y:500.},quarters:vec![Quarter{shape:geometry::rectangle(100.,400.,900.,600.),phase:0,zone:"core".into()}],
        streets:vec![Street{path:vec![Point{x:100.,y:465.},Point{x:900.,y:465.}],widths:vec![6.;2],rank:1,role:"street".into()}],
        blocks:points.iter().map(|&x|Block{shape:geometry::rectangle(x-32.,468.,x+32.,532.),quarter:0,kind:"block".into(),axis:Point{x:1.,y:0.},zone:"core".into(),phase:None}).collect(),
        warnings:vec![],enclosures:vec![],phases:vec![],archetype:"city".into(),structure:None};
    let mut on=base.clone();on.config.as_mut().unwrap().power_high_ground=true;
    programme::prepare(&mut base,10000,&ProgrammeContext::default(),surface).unwrap();
    programme::prepare(&mut on,10000,&ProgrammeContext::default(),surface).unwrap();
    let position=|l:&Layout,role:&str| {
        let p=l.programme.as_ref().unwrap();
        let d=p.demands.iter().find(|d|d.role==role).unwrap();
        let r=p.reservations.iter().find(|r|r.demand_id==d.id).unwrap_or_else(||panic!("{role}: {:?}",d.reasons));
        geometry::centroid(&r.shape).x
    };
    assert!(position(&on,"worship.cathedral")>position(&base,"worship.cathedral")+100.);
    assert!(position(&on,"worship.cathedral")>=750.);
    assert!(position(&on,"defence.keep")>=650.);
    if let Ok(out)=std::env::var("SITE_OPTS_WITNESSES") {
        for (name,l) in [("power-off",&base),("power-on",&on)] {
            let shapes:Vec<_>=l.programme.as_ref().unwrap().reservations.iter().filter(|r| r.demand_id.ends_with("worship.cathedral")||r.demand_id.ends_with("defence.keep")).map(|r|r.shape.clone()).collect();
            svg(&out,name,&l.streets,&shapes,1000.);
        }
    }
}
