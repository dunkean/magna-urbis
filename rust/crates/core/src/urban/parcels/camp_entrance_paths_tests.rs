use super::*;
use super::super::super::geometry as g;

#[test]
fn a_500_inhabitant_camp_keeps_its_entrance_and_building_sites() {
    use crate::urban as u;
    // No incoming road: the generated entrance must cross the finished hedge
    // and reach the camp paths, rather than being cut to an outer-belt stub.
    let n=64;let height=vec![10.;n*n];let water=vec![0;n*n];let level=vec![0.;n*n];
    let surface=u::Surface{geometry:None,width:4000.,n,height:&height,water:&water};
    let site=u::Site{key:"probe".into(),name:String::new(),population:500,culture:"kraal".into(),center:Point{x:2000.,y:2000.},radius:150.};
    let cfg:u::LayoutConfig=serde_json::from_str(include_str!("../fixtures/small-layout-config.json")).unwrap();
    let layouts=u::generate_quarters("small-settlement",&[site],&cfg,surface,&[]).unwrap();
    let parts=u::generate_parcels("small-settlement",&layouts,&Default::default()).unwrap();
    let requests=u::building_sites::requests("small-settlement",&layouts,&parts,surface,&level,None).unwrap();
    let (l,p)=(&layouts[0],&parts[0]);let pr=p.programme.as_ref().unwrap();
    assert_eq!(l.archetype,"camp");
    assert!(l.enclosures.iter().any(|e|e.kind=="hedge"&&!e.gates.is_empty()));
    assert!(p.parcels.iter().any(|p|p.provenance.iter().any(|s|s=="camp-centre")),"Keep the central byre");
    let huts=requests.iter().filter(|r|p.parcels.iter().any(|p|r["parcel_id"]==p.id
        && p.provenance.iter().any(|s|matches!(s.as_str(),"camp-dwelling"|"camp-head")))
        && r["preview"].as_array().is_some_and(|p|!p.is_empty())).count();
    assert!(huts>=15,"real hut sites {huts}");
    for old in &l.programme.as_ref().unwrap().demands {
        let d=pr.demands.iter().find(|d|d.id==old.id).unwrap();
        assert_eq!((d.requested.to_bits(),d.target_area.to_bits(),d.target_frontage.to_bits()),
            (old.requested.to_bits(),old.target_area.to_bits(),old.target_frontage.to_bits()));
        assert_eq!(d.built_capacity,0.);
    }
    assert!(pr.allocations.iter().filter(|a|a.unit=="domesticUnits").all(|a|a.households<=1.));
    assert!(!pr.allocations.iter().any(|a|matches!(a.function.as_str(),"collective"|"warehouse"|"workshop")));
    eprintln!("CAMP_FIX kraal population=500 parcels={} requests={} realHutSites={huts}",p.parcels.len(),requests.len());
    if let Ok(path)=std::env::var("CAMPS_FIX_OUT") {
        std::fs::write(path,serde_json::to_vec(&serde_json::json!({"layout":l,"partition":p,"requests":requests,"realHutSites":huts})).unwrap()).unwrap();
    }
}

#[test]
fn camp_entries_use_real_roads_at_every_rank_and_never_a_field_track() {
    let mut layout:Layout=serde_json::from_value(serde_json::json!({"key":"entry","culture":"native-plains","center":{"x":40.,"y":20.},"quarters":[],"blocks":[],"streets":[],"warnings":[]})).unwrap();
    layout.streets.push(super::super::super::Street{path:vec![Point{x:-3.,y:0.},Point{x:-3.,y:40.}],widths:vec![6.;2],rank:1,role:"regional".into()});
    for rank in [0,1,2,4] {layout.streets[0].rank=rank;assert_eq!(forms::entries(&layout,layout.center).len(),1);}
    layout.streets[0].role="track".into();assert!(forms::entries(&layout,layout.center).is_empty());
    layout.streets[0].role="lane".into();layout.streets[0].rank=1;assert_eq!(forms::entries(&layout,layout.center).len(),1);
    layout.streets[0].widths.clear();assert_eq!(forms::entries(&layout,layout.center).len(),1,"Legacy missing widths use the native frontage fallback");
    layout.streets[0].path[1]=layout.streets[0].path[0];assert!(forms::entries(&layout,layout.center).is_empty());
}

#[test]
fn captured_p03_short_entrances_reach_real_dwelling_candidates_without_changing_need() {
    use geo::Validation;
    let layouts:Vec<Layout>=serde_json::from_slice(include_bytes!("../fixtures/camp-p03-entrances-layout.json")).unwrap();
    let out=super::super::super::generate_parcels("city-river-plain-s",&layouts,&Default::default()).unwrap();
    let pr=out[0].programme.as_ref().unwrap();
    for old in &layouts[0].programme.as_ref().unwrap().demands {
        let d=pr.demands.iter().find(|d|d.id==old.id).unwrap();
        assert_eq!((d.requested.to_bits(),d.target_area.to_bits(),d.target_frontage.to_bits()),(old.requested.to_bits(),old.target_area.to_bits(),old.target_frontage.to_bits()));
        assert_eq!(d.built_capacity,0.);
    }
    assert!(pr.allocations.iter().any(|a|a.function=="domestic"&&a.households>0.),"Entrances must serve the camp, not just end beside an unserved ring");
    assert!(out[0].parcels.iter().all(|p|g::polygon(&p.shape).is_valid()));
    let index=super::super::super::building_sites::BuildingSiteIndex::prepare(&layouts,&out,&[0]).unwrap();
    assert!(index.total()>0);
    let mut isolated=layouts.clone();isolated[0].streets.clear();
    let unserved=super::super::super::generate_parcels("city-river-plain-s",&isolated,&Default::default()).unwrap();
    assert!(!unserved[0].programme.as_ref().unwrap().allocations.iter().any(|a|a.function=="domestic"));
}
