use super::*;
fn p(x:f64,y:f64)->Point {Point {x,y}}
fn plan()->macroplan::Plan {
    macroplan::Plan {envelope:g::rectangle(150.0,200.0,1000.0,850.0),structure:None,
        quarters:vec![Quarter {shape:g::rectangle(150.0,200.0,1000.0,850.0),phase:0,zone:"faubourg".into()}],
        streets:vec![Street {path:vec![p(100.0,480.0),p(250.0,475.0),p(400.0,500.0),p(900.0,500.0)],
            widths:vec![6.0;4],rank:1,role:"regional".into()}],
        enclosures:vec![Enclosure {path:closed(&g::rectangle(400.0,300.0,850.0,700.0).outer),
            gates:vec![p(400.0,500.0)],kind:"wall".into(),..Default::default()}],warnings:vec![]}
}
#[test]
fn parameter_defaults_legacy_mapping_and_explicit_zero() {
    for (json,expected) in [("{}",0.0),(r#"{"gateVillages":true}"#,1.0),
        (r#"{"gateVillages":true,"gateVillage":0}"#,0.0),(r#"{"gateVillage":0.5}"#,0.5),
        (r#"{"gateVillage":7}"#,1.0),(r#"{"gateVillage":-1}"#,0.0)] {
        let cfg:LayoutConfig=serde_json::from_str(json).unwrap();assert_eq!(gate_strength(&cfg),expected);
    }
    assert!(serde_json::to_value(LayoutConfig::default()).unwrap().get("gateVillage").is_none());
}
#[test]
fn zero_keeps_the_exact_old_geometry_and_nonzero_keeps_placement() {
    let height=vec![10.0;128*128];let water=vec![0;128*128];
    let surface=Surface {width:2048.0,n:128,height:&height,water:&water,geometry:None};
    for strength in [0.0,0.5,1.0] {
        let mut plan=plan();let before=self::plan();
        let (_,added)=grow_gate_villages(&mut plan,&LayoutConfig {gate_village:Some(strength),..Default::default()},surface);
        assert_eq!(serde_json::to_value(&plan.quarters).unwrap(),serde_json::to_value(&before.quarters).unwrap());
        assert_eq!(serde_json::to_value(&plan.enclosures).unwrap(),serde_json::to_value(&before.enclosures).unwrap());
        assert_eq!(serde_json::to_value(&plan.streets[..before.streets.len()]).unwrap(),serde_json::to_value(&before.streets).unwrap());
        assert_eq!(plan.streets.len(),before.streets.len());
        if strength==0.0 {assert!(added.is_empty());continue;}
        let lanes:Vec<_>=added.iter().filter(|s|s.role=="faubourg-lane").collect();
        assert!(!lanes.is_empty());
        for lane in lanes {
            assert!(lane.path.len()>4 && lane.widths.iter().any(|w|*w!=lane.widths[0]));
            let a=lane.path[0];let b=*lane.path.last().unwrap();
            assert!(lane.path.iter().any(|&p|g::distance(p,a,b).0>5.0),"straight branch");
            assert!(routing::path_clear(surface,&lane.path,0.18));
            assert!(lane.path.iter().all(|&p|g::contains(&before.quarters[0].shape,p)));
            assert!(lane.path.iter().all(|&p|!g::contains(&Shape {outer:before.enclosures[0].path.clone(),holes:vec![]},p)));
        }
    }
}
#[test]
fn no_new_nucleus_on_unoccupied_or_wet_land() {
    let height=vec![10.0;128*128];let dry=vec![0;128*128];let wet=vec![1;128*128];
    for water in [&dry,&wet] {
        let mut plan=plan();
        if water==&dry {plan.quarters[0].shape=g::rectangle(410.0,310.0,840.0,690.0);}
        let count=plan.streets.len();
        let (centers,lanes)=grow_gate_villages(&mut plan,&LayoutConfig {gate_village:Some(1.0),..Default::default()},
            Surface {width:2048.0,n:128,height:&height,water,geometry:None});
        assert_eq!(plan.streets.len(),count);
        assert!(centers.is_empty() && lanes.is_empty());
    }
}

#[test]
fn market_reserves_public_land_and_density_falls_outward() {
    let height=vec![10.0;128*128];let water=vec![0;128*128];
    let surface=Surface {width:2048.0,n:128,height:&height,water:&water,geometry:None};
    let cfg=LayoutConfig {gate_village:Some(1.0),..Default::default()};
    let plan=plan();
    let mut layout:Layout=serde_json::from_value(serde_json::json!({"key":"faubourgs","culture":"european-organic",
        "center":p(600.0,500.0),"quarters":plan.quarters,"enclosures":plan.enclosures,"phases":[],"warnings":[],
        "config":cfg,"streets":[{"path":[p(340.0,480.0),p(330.0,480.0),p(310.0,480.0)],"widths":[4.0,8.0,4.0],"rank":2,"role":"gate-village"}],
        "blocks":[{"shape":g::rectangle(300.0,450.0,350.0,510.0),"quarter":0,"kind":"block","axis":p(1.0,0.0),"zone":"faubourg"},
            {"shape":g::rectangle(155.0,450.0,195.0,510.0),"quarter":0,"kind":"block","axis":p(1.0,0.0),"zone":"faubourg"}]})).unwrap();
    let values=gate_pressures(&layout,vec![0.4;2]);assert!(values[0]>values[1]+0.3);
    let mut pending=layout.clone();
    pending.structure=Some(crate::urban::UrbanStructure {gate_village_centers:vec![p(330.0,480.0)],
        gate_village_lanes:vec![layout.streets[0].clone()],..Default::default()});
    assert_eq!(gate_pressures(&pending,vec![0.4;2]),vec![0.4;2],"gate pressure leaked into the inherited trim");
    prepare_gate_villages(&mut layout,&cfg,surface);
    let market=layout.blocks.iter().find(|b|b.kind=="place").unwrap();
    assert!(market.shape.outer.len()>4 && g::simple(&market.shape));
    for b in layout.blocks.iter().filter(|b|b.kind=="block") {
        assert!(g::intersection(&b.shape,&market.shape).iter().map(g::area).sum::<f64>()<0.01);
    }
}

#[test]
fn upper_range_grows_a_visible_market_and_more_curved_lanes() {
    let height=vec![10.0;128*128];let water=vec![0;128*128];
    let surface=Surface {width:2048.0,n:128,height:&height,water:&water,geometry:None};
    let mut previous=None;
    for strength in [0.5,1.0] {
        let mut candidate=plan();candidate.quarters[0].shape=g::rectangle(0.0,100.0,1000.0,900.0);
        let (centers,lanes)=grow_gate_villages(&mut candidate,
            &LayoutConfig {gate_village:Some(strength),..Default::default()},surface);
        assert_eq!(centers.len(),1);
        let area=g::area(&square(centers[0],strength));
        let count=lanes.iter().filter(|s|s.role=="faubourg-lane").count();
        if let Some((center,old_area,old_count))=previous {
            assert_eq!(centers[0],center,"slider moved nucleus");
            assert!(area>old_area*1.6 && count>old_count,"upper range stayed timid: area {old_area:.0} -> {area:.0}, lanes {old_count} -> {count}");
            assert!(area>3000.0,"market must read at town overview scale");
        }
        previous=Some((centers[0],area,count));
    }
}

#[test]
fn gate_sites_redistribute_cultural_demand_without_increasing_it() {
    let mut layout:Layout=serde_json::from_value(serde_json::json!({"key":"faubourgs","culture":"european-organic",
        "center":p(600.0,500.0),"quarters":[],"enclosures":[],"phases":[],"warnings":[],"streets":[],"blocks":[],
        "config":{"gateVillage":1},"structure":{"gateVillageCenters":[p(200.0,200.0),p(800.0,200.0)]}})).unwrap();
    let demand=|role:&str|serde_json::from_value::<crate::urban::programme::Demand>(serde_json::json!({
        "id":format!("faubourgs/demand/{role}"),"function":"collective","unit":"m2","requested":2400,
        "targetArea":600,"targetFrontage":5,"provenance":[],"requires":[],"parcelCapacity":0,"builtCapacity":0,
        "deficit":2400,"reasons":[],"role":role,"sites":4,"site":"spread","placement":"parcel"})).unwrap();
    let original=vec![demand("commerce.inn"),demand("worship.parish")];
    for strength in [0.0,0.5,1.0] {
        layout.config.as_mut().unwrap().gate_village=Some(strength);
        let mut demands=original.clone();gate_demands(&layout,&mut demands);
        assert!((gate_activity(&layout,p(220.0,210.0))-strength).abs()<1e-8);
        assert!(gate_activity(&layout,p(500.0,700.0))<strength*0.01+1e-8);
        for role in ["commerce.inn","worship.parish"] {
            assert_eq!(demands.iter().filter(|d|d.role==role).map(|d|d.requested).sum::<f64>(),2400.0);
            assert_eq!(demands.iter().filter(|d|d.role==role).map(|d|d.sites).sum::<usize>(),4);
            assert_eq!(demands.iter().filter(|d|d.role==role).map(|d|d.deficit).sum::<f64>(),2400.0);
        }
        let assigned=demands.iter().filter(|d|d.id.contains("/gate-village/")).count();
        assert_eq!(assigned,if strength==0.0 {0} else if strength==0.5 {2} else {4});
    }
}
