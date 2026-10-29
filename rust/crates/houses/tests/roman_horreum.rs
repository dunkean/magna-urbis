//! Native storage source: geometry/admission, never historical capacity.
use magna_urbis_houses::{geometry::rectangle, placement::PlacementRequest,
    plans::{PlanBatchRequest, plan_batch, RealizePlanRequest, realize_plan}};
use std::collections::BTreeMap;
fn request(mode:&str) -> PlacementRequest {
    serde_json::from_value(serde_json::json!({
        "id":"horreum", "parcel_id":"port-lot", "seed":"roman-horreum-native",
        "cadastral":rectangle(0.,0.,42.,45.), "buildable":rectangle(0.,0.,42.,45.),
        "roof_domain":rectangle(0.,0.,42.,45.), "reserves":[], "party_boundaries":[], "neighbors":[],
        "accesses":[{"id":"quay","kind":"public","width_m":4.5,
            "segment":[{"x":0.,"y":0.},{"x":42.,"y":0.}]}],
        "culture":{"culture":"roman-core","pack":"MED-ANT","mode":mode,"borrowing":null},
        "function":"warehouse", "parcel_fit":true,
        "config":{"schema_version":"2","seed":"roman-horreum-native","pack":"MED-ANT",
            "recipe":"MED-ANT-H01","mode":mode,"era":"A","count":1,"size":1.,"variation":0.65,"wealth":0.5},
        "programme":{"role":"storage.horreum","composition":"hall","built_area_m2":432.8},
        "terrain":{"origin":{"x":0.,"y":0.},"ground_z_m":10.,"gradient":[0.,0.],
            "water_z_m":null,"max_foundation_step_m":0.75}
    })).unwrap()
}
#[test]
fn horreum_is_admitted_with_three_bearing_halls_and_quay_access() {
    let result=plan_batch(PlanBatchRequest {schema_version:"1".into(),requests:vec![request("historical_inspired")],
        settings:None,footprints:BTreeMap::new()}).unwrap();
    assert_eq!(result.buildings.len(),1,"{:?}",result.refusals);
    assert!(result.refusals.is_empty() && result.open_spaces.is_empty());
    let b=&result.buildings[0];
    assert_eq!(b.recipe_id,"MED-ANT-H01");
    assert_eq!(b.volumes.len(),3);
    assert_eq!(b.domestic_units,0);
    let retained=b.resolved.unpack().unwrap();
    assert!(serde_json::to_value(retained).unwrap()["parameters"]["wall_thickness_m"][0].as_f64().unwrap()>=0.6);
    assert!((magna_urbis_houses::geometry::area(&b.footprint)-432.8).abs()<0.5);
    let exterior=realize_plan(RealizePlanRequest{building:b.clone(),interiors:false}).unwrap();
    assert_eq!(exterior.units[0].bodies.len(),3);
    assert!(!exterior.units[0].roofs.faces.is_empty());
}
#[test]
fn horreum_keeps_strict_era_and_foundation_refusals() {
    for kind in ["strict","era","terrain","access"] {
        let mut r=request("historical_inspired");
        match kind {
            "strict"=> {r=request("historical_strict");},
            "era"=>r.config.as_mut().unwrap().era="M".into(),
            "terrain"=>r.terrain.gradient=[0.3,0.3],
            _=>r.accesses.clear(),
        }
        let result=plan_batch(PlanBatchRequest{schema_version:"1".into(),requests:vec![r],settings:None,footprints:BTreeMap::new()}).unwrap();
        assert!(result.buildings.is_empty(),"{kind}");
        assert_eq!(result.refusals.len(),1,"{kind}");
    }
}
#[test]
fn roman04_retained_port_lot_admits_the_source_without_changing_target_or_terrain() {
    let r:PlacementRequest=serde_json::from_str(include_str!("fixtures/roman-horreum-port.json")).unwrap();
    assert_eq!(r.programme.as_ref().unwrap().built_area_m2,Some(352.1));
    let result=plan_batch(PlanBatchRequest{schema_version:"1".into(),requests:vec![r],settings:None,footprints:BTreeMap::new()}).unwrap();
    assert_eq!(result.buildings.len(),1,"{:?}",result.refusals);
    let b=&result.buildings[0];
    assert_eq!(b.recipe_id,"MED-ANT-H01");
    assert_eq!(b.volumes.len(),3);
    assert!((magna_urbis_houses::geometry::area(&b.footprint)-352.1).abs()<0.5);
    assert!(!b.access_id.is_empty());
    assert!(serde_json::to_value(b.resolved.unpack().unwrap()).unwrap()["entrance"].is_object());
    let exterior=realize_plan(RealizePlanRequest{building:b.clone(),interiors:false}).unwrap();
    assert_eq!(exterior.units[0].bodies.len(),3);
    assert!(!exterior.units[0].roofs.faces.is_empty());
}
