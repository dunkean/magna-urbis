use super::*;
use super::super::super::{composition, Site};

const N:usize=128;
const W:f64=2048.0;
fn point(x:f64,y:f64)->Point {pt(x,y)}
fn surface<'a>(height:&'a [f32],water:&'a [u8])->Surface<'a> {
    Surface {geometry:None,width:W,n:N,height,water}
}
fn street(a:Point,b:Point)->Street {Street {path:vec![a,b],widths:vec![6.0;2],rank:1,role:"regional".into()}}
fn layout(shape:Shape,streets:Vec<Street>)->Layout {
    serde_json::from_value(serde_json::json!({"key":"walls-options","culture":"european-organic",
        "center":point(900.0,1000.0),"quarters":[{"shape":shape,"phase":0,"zone":"core"}],
        "streets":streets,"blocks":[],"enclosures":[],"phases":[],"warnings":[]})).unwrap()
}
fn water()->Vec<u8> {(0..N*N).map(|i|if (64..68).contains(&(i%N)){1}else{0}).collect()}

#[test]
fn disabled_options_keep_trace_style_rng_and_serialization() {
    let cfg=LayoutConfig::default();
    let mut old=styled("curtain","european-organic",3000);
    let height=vec![10.0;N*N];let water=water();let s=surface(&height,&water);
    let shape=g::normalized(g::rectangle(600.0,600.0,1000.0,1400.0));
    assert_eq!(option_trace(shape.clone(),s,&cfg,3.0),shape);
    assert!(old.tower_spacing.is_none());old.options(&cfg);assert!(old.tower_spacing.is_none());
    assert!(styled("bastioned","european-organic",60000).tower_spacing.is_none());
    let mut l=layout(shape,vec![]);let before=serde_json::to_vec(&l).unwrap();
    prepare_options(&mut l,&cfg,s);finish_options(&mut l,&cfg,s);
    assert_eq!(serde_json::to_vec(&l).unwrap(),before);
    let json=serde_json::to_value(&cfg).unwrap();
    for k in ["oldEnclosureCitadel","medievalWalls","riverControl","dryDitches","gateVillages"] {
        assert!(json.get(k).is_none(),"off field changed old native layout payload");
    }
}

#[test]
fn medieval_flanking_uses_regular_metric_spacing() {
    let height=vec![10.0;N*N];let water=vec![0;N*N];let s=surface(&height,&water);
    let shape=g::normalized(g::rectangle(500.0,500.0,1100.0,1100.0));
    let mut path=shape.outer.clone();path.push(path[0]);
    let cfg=LayoutConfig {medieval_walls:true,..Default::default()};
    for id in ["curtain","flanked","bastioned","rammed-earth"] {
        let mut style=styled(id,"european-organic",10000);style.options(&cfg);
        let spacing=style.tower_spacing.unwrap();assert!(spacing[0]>=20.0 && spacing[1]<=40.0);
        let mut e=Enclosure {path:path.clone(),kind:"wall".into(),..Default::default()};
        build(&mut e,0,&[],&[],s,&style,10000,&Predicted {widths:[10.0,8.0,6.0,4.0,3.0],
            arterial:1,dwelling:[5.0,5.0]},&Rng::new("medieval-towers"));
        assert!(e.towers_detail.iter().filter(|t|t.kind=="flank").count()>25,"{id}");
    }
}

#[test]
fn angular_trace_uses_escarpment_and_bank_without_crossing_water() {
    let water=water();let mut height=vec![10.0;N*N];
    // A dry shelf ends at x=976; the river starts at x=1024.
    for i in 0..height.len() {if i%N>=61 {height[i]=6.0;}}
    let s=surface(&height,&water);
    let shape=g::normalized(g::rectangle(600.0,600.0,954.0,1400.0));
    let medieval=option_trace(shape.clone(),s,&LayoutConfig {medieval_walls:true,..Default::default()},3.0);
    assert!(g::bbox(&medieval).2>g::bbox(&shape).2,"no attraction to the shelf edge");
    let bank=option_trace(shape.clone(),s,&LayoutConfig {river_control:true,..Default::default()},3.0);
    assert!(g::bbox(&bank).2>1000.0,"bank curtain still too far inland");
    assert!(g::simple(&bank));assert!(wet_length(&bank.outer,s)<1.0);
    assert!(bank.outer.len()<12,"sharp long fronts on a straight bank");
    let thick=option_trace(shape,s,&LayoutConfig {river_control:true,..Default::default()},12.0);
    assert!(g::bbox(&thick).2<=1012.0,"the whole curtain body must stay on the bank");
}

#[test]
fn automatic_ditches_need_local_low_supply_and_remain_probabilistic() {
    let water=water();let height=vec![10.0;N*N];let s=surface(&height,&water);
    let mut wet=0;
    for i in 0..80 {
        let ditch=g::rectangle(980.0,100.0+i as f64*20.0,995.0,115.0+i as f64*20.0);
        wet+=usize::from(ditch_kind(&ditch,s,&Rng::new(&format!("ditch-{i}")))=="wet");
        let inland=g::rectangle(500.0,100.0+i as f64*20.0,520.0,115.0+i as f64*20.0);
        assert_eq!(ditch_kind(&inland,s,&Rng::new("dry")),"dry");
    }
    assert!(wet>4 && wet<50,"{wet} wet out of 80 low river pieces");
    let mut high=height.clone();for i in 0..high.len() {if i%N<64 {high[i]=30.0;}}
    assert_eq!(ditch_kind(&g::rectangle(980.0,500.0,995.0,520.0),surface(&high,&water),&Rng::new("terrace")),"dry");
}

#[test]
fn river_controls_keep_both_banks_dry_and_bridge_passage_open() {
    let water=water();let height=vec![10.0;N*N];let s=surface(&height,&water);
    let shape=g::normalized(g::rectangle(700.0,600.0,1008.0,1400.0));
    let bridge=Street {role:"bridge".into(),..street(point(900.0,1000.0),point(1200.0,1000.0))};
    let mut l=layout(shape.clone(),vec![bridge]);
    let mut path=shape.outer;path.push(path[0]);
    l.enclosures.push(Enclosure {path,kind:"wall".into(),style:"curtain".into(),..Default::default()});
    prepare_options(&mut l,&LayoutConfig {river_control:true,..Default::default()},s);
    let works=&l.enclosures[0].outworks;
    for kind in ["bridge-tower","facing-tower","bridge-gatehouse","bridgehead","river-chain"] {
        assert!(works.iter().any(|w|w.kind==kind),"missing {kind}");
    }
    let ribbon=Cut::new(g::ribbon(&l.streets[0].path,&l.streets[0].widths));
    for w in works.iter().filter(|w|w.kind!="river-chain") {
        assert!(w.shape.outer.iter().all(|&p|!s.wet(p)),"{} wet",w.kind);
        assert!(ribbon.hits(&w.shape)<0.1,"{} blocks bridge",w.kind);
    }
}

#[test]
fn citadel_uses_cultural_model_and_gate_villages_keep_population_need() {
    assert!(keeps_citadel("al-andalus") && keeps_citadel("medina") && keeps_citadel("persian"));
    assert!(!keeps_citadel("roman-core") && !keeps_citadel("hanseatic"));
    let water=vec![0;N*N];let height=vec![10.0;N*N];let s=surface(&height,&water);
    let site=Site {key:"walls-options".into(),name:"walls-options".into(),culture:"medina".into(),
        population:10000,center:point(1000.0,1000.0),radius:320.0};
    let roads=vec![street(point(300.0,1000.0),point(1700.0,1000.0)),street(point(1000.0,300.0),point(1000.0,1700.0))];
    let cfg=LayoutConfig {old_enclosure_citadel:true,gate_villages:true,fortification:"wall".into(),..Default::default()};
    let c=composition::generate("walls-options",&site,&cfg,s,&roads,site.radius).unwrap();
    assert!(c.plan.enclosures.iter().any(|e|e.purpose=="citadel"),"old circuit not retained");
    assert!(c.plan.structure.as_ref().is_some_and(|s|!s.gate_village_centers.is_empty()),"no gate nucleus");
    assert!((c.phases.iter().map(|p|p.population).sum::<f64>()-10000.0).abs()<0.01);
    let faub=&c.phases[c.phases.len()-1];assert!(faub.target_area>0.0 && !faub.shapes.is_empty());
}

#[test]
fn inner_estates_keep_a_gate_and_gate_squares_are_real_public_land() {
    let water=vec![0;N*N];let height=vec![10.0;N*N];let s=surface(&height,&water);
    let domain=g::rectangle(400.0,400.0,1400.0,1400.0);
    let mut l=layout(domain,vec![street(point(450.0,500.0),point(1200.0,500.0))]);
    let demand=|id:&str,role:&str|serde_json::json!({"id":id,"function":"collective","role":role,
        "unit":"usefulAreaM2","requested":800.0,"targetArea":800.0,"targetFrontage":8.0,
        "provenance":[],"requires":[],"parcelCapacity":0.0,"builtCapacity":0.0,"deficit":800.0,"reasons":[]});
    let estates=[g::rectangle(500.0,505.0,560.0,590.0),g::rectangle(650.0,505.0,710.0,580.0)];
    l.programme=Some(serde_json::from_value(serde_json::json!({"version":1,"population":10000,
        "context":{},"cultures":[],"demands":[demand("cathedral","worship.cathedral"),demand("castle","defence.castle")],
        "reservations":[{"id":"a","demandId":"cathedral","block":0,"shape":estates[0],"street":0,"frontage":60.0},
            {"id":"b","demandId":"castle","block":1,"shape":estates[1],"street":0,"frontage":60.0}],
        "allocations":[],"adjacency":[],"environment":[],"reconciliationPasses":0,"warnings":[]})).unwrap());
    finish_options(&mut l,&LayoutConfig {old_enclosure_citadel:true,..Default::default()},s);
    assert_eq!(l.enclosures.len(),2);
    for (e,estate) in l.enclosures.iter().zip(&estates) {
        assert!(matches!(e.purpose.as_str(),"cathedral-close"|"urban-castle"));
        assert!(e.path.iter().all(|&p|g::contains(estate,p)));
        assert_eq!(e.gates.len(),1);
        assert!(!e.path.contains(&e.gates[0]),"a courtyard gate belongs on a front, not a corner");
    }
    l.programme=None;l.enclosures.clear();l.quarters[0].zone="faubourg".into();
    let center=point(800.0,850.0);
    l.blocks.push(super::super::super::Block {shape:g::rectangle(760.0,810.0,840.0,890.0),
        quarter:0,kind:"block".into(),zone:"faubourg".into(),phase:Some(0),axis:point(1.0,0.0)});
    l.streets.push(Street {role:"gate-village".into(),..street(point(800.0,750.0),center)});
    prepare_options(&mut l,&LayoutConfig {gate_villages:true,..Default::default()},s);
    let place=l.blocks.iter().find(|b|b.kind=="place").unwrap();
    assert!(g::contains(&place.shape,center));
    assert!(l.streets.iter().any(|s|s.role=="market" && s.path.len()>=5));
    for block in l.blocks.iter().filter(|b|b.kind=="block") {
        assert!(area(&g::intersection(&block.shape,&place.shape))<0.01,"housing on gate square");
    }
}

/// Native replay of a real decor, also writes reviewable ON/OFF SVGs without a server.
#[test]
fn river_witness_on_off_svg() {
    let Ok(path)=std::env::var("WALLS_OPTS_FIXTURE") else {return;};
    #[derive(serde::Deserialize)] #[serde(rename_all="camelCase")]
    struct Fixture {seed:String,n:usize,width:f64,height:Vec<f32>,water:Vec<u8>,
        geometry:Option<super::super::super::VectorGeography>,sites:Vec<Site>,roads:Vec<Street>,layout_config:LayoutConfig}
    let f:Fixture=serde_json::from_slice(&std::fs::read(path).unwrap()).unwrap();
    let geography=f.geometry.map(|g|super::super::super::Geography::new(g,f.width).unwrap());
    let s=Surface {geometry:geography.as_ref(),width:f.width,n:f.n,height:&f.height,water:&f.water};
    let out=std::env::var("WALLS_OPTS_OUT").unwrap();std::fs::create_dir_all(&out).unwrap();
    for culture in ["european-organic","bastide","al-andalus","medina","hanseatic"] {
        let mut site=f.sites[0].clone();site.culture=culture.into();
        for on in [false,true] {
            let cfg=LayoutConfig {old_enclosure_citadel:on,medieval_walls:on,river_control:on,dry_ditches:on,gate_villages:on,
                ..f.layout_config.clone()};
            let c=composition::generate(&f.seed,&site,&cfg,s,&f.roads,site.radius).unwrap();
            for road in c.plan.streets.iter().filter(|s|s.role=="gate-village") {
                assert!(super::super::super::routing::path_clear(s,&road.path,0.12),"gate village crosses water or a cliff");
            }
            let (x0,y0,x1,y1)=g::bbox(&c.plan.envelope);
            let mut svg=format!("<svg xmlns='http://www.w3.org/2000/svg' viewBox='{} {} {} {}' width='1100' height='1100'><rect x='{}' y='{}' width='{}' height='{}' fill='#f2e5bf'/>",x0-80.0,y0-80.0,x1-x0+160.0,y1-y0+160.0,x0-80.0,y0-80.0,x1-x0+160.0,y1-y0+160.0);
            let path=|s:&Shape|s.outer.iter().enumerate().map(|(i,p)|format!("{}{},{}",if i==0{"M"}else{"L"},p.x,p.y)).collect::<String>()+"Z";
            let mut wet=vec![c.plan.envelope.clone()];
            for dry in g::dry_clip(&s,&c.plan.envelope) {wet=wet.iter().flat_map(|w|g::difference(w,&dry)).collect();}
            for w in wet {svg+=&format!("<path d='{}' fill='#6b9198'/>",path(&w));}
            for q in &c.plan.quarters {svg+=&format!("<path d='{}' fill='#dbcfab' stroke='#b8ab8a' stroke-width='1'/>",path(&q.shape));}
            for st in &c.plan.streets {let sh=Shape {outer:st.path.clone(),holes:vec![]};svg+=&format!("<path d='{}' fill='none' stroke='white' stroke-width='4'/>",path(&sh).trim_end_matches('Z'));}
            for e in &c.plan.enclosures {
                for d in &e.ditch {svg+=&format!("<path d='{}' fill='{}'/>",path(&d.shape),if d.kind=="wet"{"#8eb1bd"}else{"#b3a17c"});}
                svg+=&format!("<path d='{}' fill='none' stroke='{}' stroke-width='4'/>",path(&Shape {outer:e.path.clone(),holes:vec![]}),if e.purpose=="citadel"{"#9f5938"}else{"#5f5546"});
                for t in &e.towers_detail {svg+=&format!("<path d='{}' fill='#51483c'/>",path(&t.footprint));}
            }
            svg+="</svg>";
            std::fs::write(std::path::Path::new(&out).join(format!("{culture}-{}.svg",if on{"on"}else{"off"})),svg).unwrap();
            std::fs::write(std::path::Path::new(&out).join(format!("{culture}-{}.json",if on{"on"}else{"off"})),
                serde_json::to_vec(&serde_json::json!({"enclosures":c.plan.enclosures,"quarters":c.plan.quarters,"streets":c.plan.streets})).unwrap()).unwrap();
            if culture=="european-organic" && on {
                let cities=super::super::super::generate_quarters(&f.seed,&[site.clone()],&cfg,s,&f.roads).unwrap();
                let city=&cities[0];
                assert_eq!(city.programme.as_ref().unwrap().population,10000);
                assert!(city.blocks.iter().any(|b|b.kind=="place" && b.zone=="faubourg"),"no real gate square");
                assert!(city.enclosures.iter().any(|e|e.purpose=="cathedral-close"),"no cathedral close on the reserved estate");
                assert!(city.enclosures.iter().flat_map(|e|&e.outworks).any(|w|w.kind=="river-chain"),"no channel control at the river-bank town");
                let parts=super::super::super::generate_parcels(&f.seed,&cities,&super::super::super::ParcelConfig::default()).unwrap();
                let pr=parts[0].programme.as_ref().unwrap();
                for role in ["commerce.inn","worship.parish"] {
                    let outside=pr.allocations.iter().filter(|a|a.role==role).filter(|a| {
                        let Some(p)=parts[0].parcels.iter().find(|p|p.id==a.parcel_id) else {return false;};
                        let c=g::centroid(&p.shape);
                        !city.enclosures.iter().filter(|e|e.purpose.is_empty()).any(|e|g::contains(&Shape {outer:e.path.clone(),holes:vec![]},c))
                    }).count();
                    assert!(outside>0,"no {role} in the gate villages");
                }
                std::fs::write(std::path::Path::new(&out).join("european-full-programme.json"),
                    serde_json::to_vec(&serde_json::json!({"city":city,"partition":parts[0]})).unwrap()).unwrap();
            }
        }
    }
}
