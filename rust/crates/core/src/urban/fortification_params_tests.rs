use super::*;
const N:usize=128;
const W:f64=2048.0;
fn surface<'a>(height:&'a [f32],water:&'a [u8])->Surface<'a> {Surface {geometry:None,width:W,n:N,height,water}}
fn layout()->Layout {
    serde_json::from_value(serde_json::json!({"key":"params","culture":"hanseatic","center":pt(800.0,900.0),
        "quarters":[{"shape":g::rectangle(600.0,600.0,1000.0,1200.0),"phase":0,"zone":"core"},
            {"shape":g::rectangle(1080.0,800.0,1220.0,1100.0),"phase":0,"zone":"edge"}],
        "streets":[{"path":[pt(900.0,950.0),pt(1210.0,950.0)],"widths":[6.0,6.0],"rank":1,"role":"quay"}],
        "blocks":[],"enclosures":[],"phases":[],"warnings":[],
        "structure":{"districts":[{"id":0,"center":0,"phase":0,"tissue":"organic","quarters":[1],"role":"port"}]}})).unwrap()
}
fn ring(sh:&Shape)->Vec<Point> {let mut p=sh.outer.clone();p.push(p[0]);p}

#[test]
fn parameters_validate_round_trip_and_legacy_defaults() {
    let cfg:LayoutConfig=serde_json::from_value(serde_json::json!({"medievalWalls":true,"riverControl":true,"dryDitches":true})).unwrap();
    assert_eq!(stiffness(&cfg),1.0);assert_eq!(adherence(&cfg),1.0);assert_eq!(river_mode(&cfg),"bank-walls-chain");
    assert!(valid_parameters(&cfg));
    for value in [-0.1,1.1,f64::NAN] {assert!(!valid_parameters(&LayoutConfig {wall_terrain:Some(value),..Default::default()}));}
    let value=serde_json::json!({"wallStiffness":0.5,"wallTerrain":1.0,"wallTowerSpacing":45.0,"ditchWetness":0.0,"riverControlMode":"bank-walls","portEnclosure":"separate"});
    let cfg:LayoutConfig=serde_json::from_value(value.clone()).unwrap();assert!(valid_parameters(&cfg));
    let saved=serde_json::to_value(cfg).unwrap();for (k,v) in value.as_object().unwrap() {assert_eq!(&saved[k],v);}
    let default=serde_json::to_value(LayoutConfig::default()).unwrap();
    for k in value.as_object().unwrap().keys() {assert!(default.get(k).is_none());}
}

#[test]
fn stiffness_changes_fronts_without_coupling_tower_spacing_or_terrain() {
    let h=vec![10.0;N*N];let w=vec![0;N*N];let s=surface(&h,&w);
    let shape=disc(pt(1000.0,1000.0),280.0,160,0.0);
    assert_eq!(parameter_trace(shape.clone(),s,&LayoutConfig {wall_stiffness:Some(0.0),..Default::default()},"",3.0),shape);
    let counts:Vec<_>=[0.0,0.5,1.0].iter().map(|&v| {
        let cfg=LayoutConfig {wall_stiffness:Some(v),wall_terrain:Some(0.0),..Default::default()};
        let mut style=styled("flanked","hanseatic",10000);let before=style.tower_spacing;style.options(&cfg);assert_eq!(style.tower_spacing,before);
        parameter_trace(shape.clone(),s,&cfg,"",3.0).outer.len()
    }).collect();
    assert!(counts[0]>counts[1] && counts[1]>counts[2],"{counts:?}");
    for spacing in [20.0,60.0,120.0] {let mut style=styled("curtain","hanseatic",10000);
        style.options(&LayoutConfig {wall_tower_spacing:Some(spacing),..Default::default()});assert_eq!(style.tower_spacing,Some([spacing;2]));}
}

#[test]
fn ditch_wetness_is_monotone_and_requires_a_local_supply() {
    let h=vec![10.0;N*N];let w:Vec<_>=(0..N*N).map(|i|u8::from(i%N>=64)).collect();let s=surface(&h,&w);
    for k in 0..50 {let near=g::rectangle(980.0,200.0+k as f64*24.0,995.0,215.0+k as f64*24.0);let rng=Rng::new("wetness");
        assert_eq!(ditch_kind(&near,s,&rng,0.0),"dry");assert_eq!(ditch_kind(&near,s,&rng,1.0),"wet");
        if ditch_kind(&near,s,&rng,0.25)=="wet" {assert_eq!(ditch_kind(&near,s,&rng,0.5),"wet");}
        assert_eq!(ditch_kind(&g::rectangle(500.0,500.0,520.0,520.0),s,&rng,1.0),"dry");
    }
}

#[test]
fn a_ridge_is_routed_around_even_for_a_stiff_wall() {
    let w=vec![0;N*N];let h:Vec<_>=(0..N*N).map(|i|{let x=(i%N) as f64*16.0;let y=(i/N) as f64*16.0;
        if (850.0..1050.0).contains(&x) && (480.0..720.0).contains(&y) {90.0} else {10.0}}).collect();let s=surface(&h,&w);
    let shape=g::normalized(g::rectangle(600.0,600.0,1300.0,1300.0));
    let repaired=safe_trace(&shape,s).expect("route around finite ridge");
    assert!(routing::path_clear(s,&ring(&repaired),grade()));assert!(g::simple(&repaired));
    assert_ne!(repaired,shape);
}

#[test]
fn all_port_modes_keep_entire_quarters_on_one_side() {
    let h=vec![10.0;N*N];let w=vec![0;N*N];let s=surface(&h,&w);
    for mode in ["auto","inside","separate","outside"] {
        let mut l=layout();let shape=g::rectangle(560.0,560.0,1040.0,1240.0);
        l.enclosures.push(Enclosure {path:ring(&shape),kind:"wall".into(),style:"flanked".into(),..Default::default()});
        let quarters=l.quarters.clone();
        port_walls(&mut l,&LayoutConfig {port_enclosure:mode.into(),..Default::default()},s);
        assert!(!l.enclosures.is_empty(),"{mode}: lost town wall");
        let walls:Vec<_>=l.enclosures.iter().map(wall_shape).collect();
        for q in &quarters {assert!(!cuts(&walls,&q.shape),"{mode}: split quarter");}
        assert_eq!(l.quarters.len(),quarters.len());
        if mode=="inside" {assert!(share(&walls,&quarters[1].shape)>0.999);}
        if mode=="outside" {assert!(share(&walls,&quarters[1].shape)<0.001);}
        if mode=="separate" {assert!(l.enclosures.iter().any(|e|e.purpose=="port"));}
        let before=serde_json::to_vec(&l).unwrap();
        assert!(!port_walls(&mut l,&LayoutConfig {port_enclosure:mode.into(),..Default::default()},s),"{mode}: non-idempotent reconciliation");
        assert_eq!(serde_json::to_vec(&l).unwrap(),before);
    }
}

/// Replays production quarters against the exact reviewed decor and site pairs.
#[test]
fn reviewed_witness_matrix() {
    let Ok(root)=std::env::var("WALL_PARAMS_FIXTURES") else {return;};
    #[derive(serde::Deserialize)] #[serde(rename_all="camelCase")]
    struct Fixture {seed:String,n:usize,width:f64,height:Vec<f32>,water:Vec<u8>,
        geometry:Option<super::super::super::VectorGeography>,sites:Vec<super::super::super::Site>,roads:Vec<Street>,layout_config:LayoutConfig}
    use std::fmt::Write;
    let out=std::path::PathBuf::from(std::env::var("WALL_PARAMS_OUT").unwrap());std::fs::create_dir_all(&out).unwrap();
    let cultures=std::env::var("WALL_PARAMS_CULTURES").unwrap_or("hanseatic,european-organic,al-andalus,caucasian-highland".into());
    for culture in cultures.split(',') {
        let f:Fixture=serde_json::from_slice(&std::fs::read(std::path::Path::new(&root).join(format!("{culture}.json"))).unwrap()).unwrap();
        let vector=f.geometry.as_ref().map(|g|(g.land.clone(),g.water.clone()));
        let geo=f.geometry.map(|g|super::super::super::Geography::new(g,f.width).unwrap());
        let surface=Surface {geometry:geo.as_ref(),n:f.n,width:f.width,height:&f.height,water:&f.water};
        let mut cases=vec![("default".into(),f.layout_config.clone())];
        if std::env::var("WALL_PARAMS_BASELINE").is_err() {
            for stiff in [0.0,0.5,1.0] {for terrain in [0.0,0.5,1.0] {
                cases.push((format!("s{stiff}-t{terrain}"),LayoutConfig {wall_stiffness:Some(stiff),wall_terrain:Some(terrain),..f.layout_config.clone()}));
            }}
            if culture=="hanseatic" {
                for mode in ["auto","inside","separate","outside"] {cases.push((format!("port-{mode}"),LayoutConfig {port_enclosure:mode.into(),wall_stiffness:Some(1.0),wall_terrain:Some(1.0),..f.layout_config.clone()}));}
                for spacing in [20.0,60.0,120.0] {cases.push((format!("towers-{spacing}"),LayoutConfig {wall_tower_spacing:Some(spacing),..f.layout_config.clone()}));}
                for wet in [0.0,0.5,1.0] {cases.push((format!("ditch-{wet}"),LayoutConfig {ditch_wetness:Some(wet),..f.layout_config.clone()}));}
                for mode in ["none","bank-walls","bank-walls-chain"] {cases.push((format!("river-{mode}"),LayoutConfig {river_control_mode:mode.into(),..f.layout_config.clone()}));}
            }
        }
        for (name,cfg) in cases {
            if let Ok(only)=std::env::var("WALL_PARAMS_CASES") {if !only.split(',').any(|s|s==name) {continue;}}
            let layouts=super::super::super::generate_quarters(&f.seed,&f.sites,&cfg,surface,&f.roads).unwrap();let l=&layouts[0];
            if name=="s0-t0" {
                let path=out.join(format!("{culture}-default.json"));
                if path.exists() {
                    let mut before:serde_json::Value=serde_json::from_slice(&std::fs::read(path).unwrap()).unwrap();
                    let mut after=serde_json::to_value(l).unwrap();
                    before.as_object_mut().unwrap().remove("config");after.as_object_mut().unwrap().remove("config");
                    assert_eq!(before,after,"zero controls changed default geometry");
                }
            }
            let shapes:Vec<_>=l.enclosures.iter().filter(|e|e.path.len()>=4).map(wall_shape).collect();
            let (x0,y0,x1,y1)=l.blocks.iter().map(|b|g::bbox(&b.shape)).fold((l.center.x,l.center.y,l.center.x,l.center.y),|a,b|(a.0.min(b.0),a.1.min(b.1),a.2.max(b.2),a.3.max(b.3)));
            let (x0,y0,x1,y1)=(x0-80.0,y0-80.0,x1+80.0,y1+80.0);
            let mut svg=format!("<svg xmlns='http://www.w3.org/2000/svg' width='1000' height='1000' viewBox='{x0} {y0} {} {}'><rect x='{x0}' y='{y0}' width='{}' height='{}' fill='#d2d7b4'/>",x1-x0,y1-y0,x1-x0,y1-y0);
            let cell=f.width/f.n as f64;let step=4;let heights:Vec<_>=l.blocks.iter().map(|b|surface.height_at(g::interior_point(&b.shape))).collect();
            let low=heights.iter().copied().fold(f64::INFINITY,f64::min);let high=heights.iter().copied().fold(f64::NEG_INFINITY,f64::max);
            for y in (0..f.n).step_by(step) {for x in (0..f.n).step_by(step) {
                let (px,py)=(x as f64*cell,y as f64*cell);if px<x0-20.0 || px>x1 || py<y0-20.0 || py>y1 {continue;}
                let p=pt(px+cell*step as f64*0.5,py+cell*step as f64*0.5);
                let shade=((surface.height_at(p)-low)/(high-low).max(1.0)*65.0).clamp(0.0,65.0) as u32;
                let fill=if surface.wet(p) {"#739da9".into()} else {format!("rgb({},{},{})",214-shade,220-shade,181-shade)};
                write!(svg,"<rect x='{px}' y='{py}' width='{}' height='{}' fill='{fill}'/>",cell*step as f64,cell*step as f64).unwrap();
            }}
            let path=|s:&Shape|s.outer.iter().enumerate().map(|(i,p)|format!("{}{},{}",if i==0 {"M"} else {"L"},p.x,p.y)).collect::<String>()+"Z";
            if let Some((land,water))=&vector {
                let shape=|rings:&Vec<Vec<Point>>|Shape {outer:rings.first().cloned().unwrap_or_default(),holes:rings.iter().skip(1).cloned().collect()};
                let frame=g::rectangle(x0,y0,x1,y1);
                for sea in g::difference(&frame,&shape(land)).iter().chain(water.iter().map(shape).collect::<Vec<_>>().iter()) {
                    write!(svg,"<path d='{}' fill='#739da9'/>",path(sea)).unwrap();
                }
            }
            let ports=port_quarters(l);
            for (qi,q) in l.quarters.iter().enumerate() {write!(svg,"<path d='{}' fill='{}' stroke='#b6a989' stroke-width='.6'/>",path(&q.shape),if ports.contains(&qi) {"#edb57a"}else{"#e4d6b3"}).unwrap();}
            for b in &l.blocks {write!(svg,"<path d='{}' fill='#c3b697' stroke='#a19475' stroke-width='.3'/>",path(&b.shape)).unwrap();}
            for s in &l.streets {let points=s.path.iter().map(|p|format!("{},{}",p.x,p.y)).collect::<Vec<_>>().join(" ");write!(svg,"<polyline points='{points}' fill='none' stroke='{}' stroke-width='{}'/>",if s.role=="quay" {"#ab5c2e"} else {"#fff8df"},s.widths.first().copied().unwrap_or(3.0)).unwrap();}
            for e in &l.enclosures {
                for d in &e.ditch {write!(svg,"<path d='{}' fill='{}'/>",path(&d.shape),if d.kind=="wet" {"#6ea6ba"}else{"#a88c5d"}).unwrap();}
                write!(svg,"<path d='{}' fill='none' stroke='{}' stroke-width='{}'/>",path(&wall_shape(e)),if e.purpose=="port" {"#a13c22"}else{"#3f392e"},e.curtain_width_m.max(3.0)).unwrap();
                for t in &e.towers_detail {write!(svg,"<path d='{}' fill='#3f392e'/>",path(&t.footprint)).unwrap();}
                for g in &e.gatehouses {for sh in &g.masses {write!(svg,"<path d='{}' fill='#6d4b36'/>",path(sh)).unwrap();}}
            }
            write!(svg,"<text x='{}' y='{}' font-family='sans-serif' font-size='{}' fill='#302b25'>{culture} · {name}</text></svg>",x0+20.0,y0+30.0,(x1-x0)/45.0).unwrap();
            std::fs::write(out.join(format!("{culture}-{name}.svg")),svg).unwrap();
            let steep:Vec<_>=l.enclosures.iter().flat_map(|e|e.path.windows(2)).filter(|w|routing::water_intervals(surface,w[0],w[1]).is_empty() && routing::segment_grade(surface,w[0],w[1])>grade()+1e-6).collect();
            let port_cuts=ports.iter().filter(|&&qi|cuts(&shapes,&l.quarters[qi].shape)).count();
            let border_touches=l.quarters.iter().filter(|q|cuts(&shapes,&q.shape)).count();
            let quarter_cuts=l.quarters.iter().enumerate().filter(|(qi,q)| {
                if !cuts(&shapes,&q.shape) {return false;}
                let mut inside_area=0.0;let mut total=0.0;
                for b in l.blocks.iter().filter(|b|b.quarter==*qi) {
                    let a=g::area(&b.shape);total+=a;inside_area+=share(&shapes,&b.shape)*a;
                }
                inside_area.min(total-inside_area)>20.0
            }).count();
            let port_outside=ports.iter().filter(|&&qi|!inside(&shapes,&l.quarters[qi].shape)).count();
            std::fs::write(out.join(format!("{culture}-{name}.json")),serde_json::to_vec(l).unwrap()).unwrap();
            if name=="port-inside" || name=="port-separate" {assert_eq!(port_outside,0,"{culture}/{name}: unenclosed port quarters");}
            if name=="port-outside" {assert!(ports.iter().all(|&qi|share(&shapes,&l.quarters[qi].shape)<0.0001));}
            assert!(steep.is_empty(),"{culture}/{name}: steep crossing");
            assert_eq!(port_cuts,0,"{culture}/{name}: split port quarter");
            assert_eq!(quarter_cuts,0,"{culture}/{name}: split quarter");
            let metrics=serde_json::json!({"culture":culture,"case":name,"walls":l.enclosures.len(),"vertices":l.enclosures.iter().map(|e|e.path.len()).sum::<usize>(),"towers":l.enclosures.iter().map(|e|e.towers.len()).sum::<usize>(),"steepSegments":steep.len(),"portQuarterCuts":port_cuts,"quarterCuts":quarter_cuts,"quarterBorderTouches":border_touches,"portOutside":port_outside,"portQuarters":ports.len(),"warnings":l.warnings});
            std::fs::write(out.join(format!("{culture}-{name}.metrics.json")),serde_json::to_vec_pretty(&metrics).unwrap()).unwrap();
            std::fs::write(out.join(format!("{culture}-{name}.json")),serde_json::to_vec(l).unwrap()).unwrap();
            println!("{metrics}");
        }
    }
}
