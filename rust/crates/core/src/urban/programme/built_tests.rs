//! Reconciliation of realised buildings, refusals and open ground.

use super::super::geometry::rectangle;
use super::test_fixtures::{partition, prepare_case};
use super::*;

#[test]
fn realized_capacity_keeps_land_built_refusals_and_open_surfaces_separate() {
    let l = prepare_case("crossroads", false, "european-organic");
    let mut p = partition(&l);
    let key = p.key.clone();
    let mut pr = l.programme.clone().unwrap();
    let domestic = pr
        .demands
        .iter()
        .find(|d| d.function == "domestic")
        .unwrap()
        .id
        .clone();
    let market = pr
        .demands
        .iter()
        .find(|d| d.function == "market")
        .unwrap()
        .id
        .clone();
    pr.allocations = vec![
        Allocation {
            parcel_id: "lot/0".into(),
            demand_id: domestic.clone(),
            function: "domestic".into(),
            culture: l.culture.clone(),
            architecture_pack: "EUR-MED".into(),
            capacity: 99.0,
            unit: "domesticUnits".into(),
            score: 1.0,
            reasons: vec![],
            role: String::new(),
            label: String::new(),
            landmark: false,
            households: 0.0,
            residents: None,
            housing_floor_need: None,
            district_role: String::new(),
            wealth: 0.5,
        },
        Allocation {
            parcel_id: "lot/1".into(),
            demand_id: domestic.clone(),
            function: "domestic".into(),
            culture: l.culture.clone(),
            architecture_pack: "EUR-MED".into(),
            capacity: 99.0,
            unit: "domesticUnits".into(),
            score: 1.0,
            reasons: vec![],
            role: String::new(),
            label: String::new(),
            landmark: false,
            households: 0.0,
            residents: None,
            housing_floor_need: None,
            district_role: String::new(),
            wealth: 0.5,
        },
        Allocation {
            parcel_id: "lot/2".into(),
            demand_id: market.clone(),
            function: "market".into(),
            culture: l.culture.clone(),
            architecture_pack: "EUR-MED".into(),
            capacity: 600.0,
            unit: "usefulAreaM2".into(),
            score: 1.0,
            reasons: vec![],
            role: String::new(),
            label: String::new(),
            landmark: false,
            households: 0.0,
            residents: None,
            housing_floor_need: None,
            district_role: String::new(),
            wealth: 0.5,
        },
    ];
    for d in &mut pr.demands {
        d.parcel_capacity = 500.0;
    }
    p.programme = Some(pr);
    let scene = BuiltScene {
        buildings: vec![BuiltCapacity {
            parcel_id: "lot/0".into(),
            function: "domestic".into(),
            useful_area_m2: 400.0,
            domestic_units: 1.0,
        }],
        refusals: vec![BuiltRefusal {
            parcel_id: "lot/1".into(),
            message: "no compatible foundation".into(),
        }],
        open_spaces: vec![BuiltOpenSpace {
            id: None,
            deficit: None,
            parcel_id: "lot/2".into(),
            surface: vec![p.parcels[2].shape.clone()],
        }],
    };
    let result = reconcile_built(std::slice::from_ref(&p), &scene).unwrap();
    assert_eq!(result[0].key, key);
    let report = result[0].programme.as_ref().unwrap();
    let housing = report.demands.iter().find(|d| d.id == domestic).unwrap();
    assert_eq!(housing.parcel_capacity, 500.0);
    assert_eq!(housing.built_capacity, 1.0);
    assert_eq!(housing.open_capacity, 0.0);
    assert_eq!(housing.deficit, housing.requested - 1.0);
    assert!(
        housing
            .reasons
            .iter()
            .any(|s| s.contains("no compatible foundation"))
    );
    let open = report.demands.iter().find(|d| d.id == market).unwrap();
    assert_eq!(open.built_capacity, 0.0);
    assert_eq!(open.open_capacity, 600.0);
    assert_eq!(open.deficit, (open.requested - 600.0).max(0.0));
    assert_eq!(
        serde_json::to_value(reconcile_built(&result, &scene).unwrap()).unwrap(),
        serde_json::to_value(&result).unwrap()
    );
    let mut invalid = scene.clone();
    invalid.buildings.push(invalid.buildings[0].clone());
    assert!(reconcile_built(std::slice::from_ref(&p), &invalid).is_err());
    invalid = scene.clone();
    invalid.buildings[0].function = "warehouse".into();
    assert!(reconcile_built(std::slice::from_ref(&p), &invalid).is_err());
    invalid = scene.clone();
    invalid.open_spaces.push(invalid.open_spaces[0].clone());
    assert!(reconcile_built(std::slice::from_ref(&p), &invalid).is_err());
    invalid = scene.clone();
    let duplicate = invalid.open_spaces[0].surface[0].clone();
    invalid.open_spaces[0].surface.push(duplicate);
    assert!(reconcile_built(std::slice::from_ref(&p), &invalid).is_err());
    invalid = scene.clone();
    invalid.open_spaces[0].surface = vec![rectangle(0.0, 0.0, 10.0, 10.0)];
    assert!(reconcile_built(std::slice::from_ref(&p), &invalid).is_err());
}
