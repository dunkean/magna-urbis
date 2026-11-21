//! Parcel admission, housing allocation and land capacity.

use super::super::geometry::rectangle;
use super::test_fixtures::{context_for, layout, partition, prepare_case};
use super::*;
use serde_json::json;

#[test]
fn domestic_land_budget_uses_the_same_units_as_the_current_building_path() {
    let mut l = layout("european-organic");
    let height = vec![0.0; 32 * 32];
    let water = vec![0; 32 * 32];
    prepare(
        &mut l,
        14,
        &context_for("agricultural"),
        Surface {
            geometry: None,
            width: 1000.0,
            n: 32,
            height: &height,
            water: &water,
            interpolation: Default::default(),
        },
    )
    .unwrap();
    let mut p = partition(&l);
    allocate(&l, &mut p);
    let report = p.programme.unwrap();
    assert_eq!(
        report
            .allocations
            .iter()
            .filter(|a| a.unit == "domesticUnits")
            .count(),
        3,
        "Large parcel area cannot make two generated houses count as the three requested units"
    );
    assert!(
        report
            .allocations
            .iter()
            .filter(|a| a.unit == "domesticUnits")
            .all(|a| a.capacity == 1.0)
    );
}

#[test]
fn core_village_lots_do_not_turn_farm_yards_into_tenements() {
    for population in [499, 500, 999, 60000] {
        let mut l = prepare_case("crossroads", false, "european-organic");
        for b in &mut l.blocks {
            b.kind = "block".into();
            b.zone = "core".into();
        }
        let pr = l.programme.as_mut().unwrap();
        pr.population = population;
        pr.reservations.clear();
        pr.demands.retain(|d| d.function == "domestic");
        pr.demands[0].requested = f64::from(population) / 4.5;
        let mut p = partition(&l);
        // A city's tenements stand in its dense core (high access pressure).
        for lot in &mut p.parcels { lot.pressure = 1.0; }
        allocate(&l, &mut p);
        let pr = p.programme.unwrap();
        let homes: Vec<_> = pr.allocations.iter().filter(|a| a.unit == "domesticUnits").collect();
        assert!(!homes.is_empty(), "{population}: the fixture must allocate homes");
        if population < 1000 {
            assert!(homes.iter().all(|a| a.households == 1.0), "{population}: one ordinary home per yard");
            assert!(pr.housing_capacity <= p.parcels.len() as f64);
            assert!(pr.demands[0].parcel_capacity < pr.demands[0].requested,
                "a small fixed cadastre must report its missing homes");
        } else {
            assert!(homes.iter().any(|a| a.households > 1.0), "city-core tenements keep their capacity");
        }
    }
}

#[test]
fn small_town_multihousehold_cap_requires_a_large_floor_budget() {
    let profile = roles::occupancy("european-organic");
    let cap = |a: f64, population: u32, communal: bool, pressure: f64|
        household_capacity(a, 0.6, 2., &profile, 0.5, false, population, communal, pressure);
    // One household per home up to 2,000 people, whatever the house or its place.
    assert_eq!(cap(400., 1242, false, 1.0), 1.);
    // A town: only a large house shares its roof (2-3 households).
    assert_eq!(cap(200., 4000, false, 0.0), 1.);
    assert_eq!(cap(400., 4000, false, 0.0), 3.);
    // A town of 10,000 keeps its houses, even at its centre.
    assert_eq!(cap(200., 10000, false, 1.0), 1.);
    // A city reaches the tenement cap in its dense core, not on its outskirts.
    assert!(cap(200., 60000, false, 1.0) >= 3.);
    assert_eq!(cap(200., 60000, false, 0.2), 1.);
    // Longhouses and collective typologies keep the floor-area capacity.
    assert!(cap(200., 1242, true, 0.0) >= 3.);
}

#[test]
fn collective_typologies_are_catalogue_typologies() {
    let text = include_str!("../catalogue.json");
    for t in COLLECTIVE_TYPOLOGIES {
        assert!(text.contains(&format!("\"{t}\"")), "{t} is no catalogue typology");
    }
}

#[test]
fn a_private_gate_does_not_limit_the_width_of_the_domestic_body() {
    let mut l = prepare_case("agricultural", false, "medina");
    l.programme.as_mut().unwrap().reservations.clear();
    let mut p = partition(&l).parcels.remove(0);
    p.shape = rectangle(110.0, 110.0, 150.0, 150.0);
    p.use_kind = "compound".into();
    p.front = Some([Point { x: 129.0, y: 110.0 }, Point { x: 131.0, y: 110.0 }]);
    p.access.as_mut().unwrap().kind = "private".into();
    p.access.as_mut().unwrap().front_length = 2.0;
    let pr = l.programme.as_ref().unwrap();
    let d = pr
        .demands
        .iter()
        .find(|d| d.function == "domestic")
        .unwrap();
    assert!(mapping("medina").unwrap().admissibility.min_frontage > 2.0);
    assert!(eligible(&l, &p, d, pr));
    p.access.as_mut().unwrap().front_length = 0.5;
    assert!(!eligible(&l, &p, d, pr));
}

#[test]
fn stale_cadastral_witness_cannot_bypass_the_current_cultural_profile() {
    let mut l = prepare_case("agricultural", false, "medina");
    let mut p = partition(&l).parcels.remove(0);
    p.shape = rectangle(110.0, 110.0, 116.0, 120.0);
    p.front = Some([Point { x: 110.0, y: 110.0 }, Point { x: 116.0, y: 110.0 }]);
    p.envelope = Some(rectangle(110.1, 110.1, 114.1, 116.1));
    l.programme.as_mut().unwrap().reservations.clear();
    p.use_kind = "plot".into();
    let pr = l.programme.as_ref().unwrap();
    let d = pr
        .demands
        .iter()
        .find(|d| d.function == "domestic")
        .unwrap();
    assert!(!eligible(&l, &p, d, pr));
}

#[test]
fn real_neighbours_require_shared_boundary_and_envelopes_respect_holes() {
    let a = rectangle(0.0, 0.0, 20.0, 30.0);
    assert!((shared(&a, &rectangle(20.0, 0.0, 40.0, 30.0)) - 30.0).abs() < 0.001);
    assert_eq!(shared(&a, &rectangle(20.1, 0.0, 40.0, 30.0)), 0.0);
    let mut l = prepare_case("agricultural", false, "european-organic");
    let mut p = partition(&l);
    assert!(has_envelope(&p.parcels[0], 4.0, 6.0));
    p.parcels[0]
        .shape
        .holes
        .push(rectangle(110.1, 110.1, 129.9, 139.9).outer);
    assert!(!has_envelope(&p.parcels[0], 4.0, 6.0));
    l.programme.as_mut().unwrap().context.mode = "strict".into();
    l.culture = "elven".into();
    allocate(&l, &mut p);
    assert!(p.programme.unwrap().allocations.is_empty());
}

#[test]
fn an_owned_rear_garden_connects_spare_land_to_its_house() {
    let l = prepare_case("agricultural",false,"european-organic");
    let mut part = partition(&l);
    part.programme = l.programme.clone();
    let mut owner = Allocation {
        parcel_id:String::new(),demand_id:"owner".into(),function:"domestic".into(),culture:"european-organic".into(),
        architecture_pack:"EUR-MED".into(),capacity:1.,unit:"domesticUnits".into(),score:0.,reasons:vec![],
        role:"dwelling.house".into(),label:String::new(),landmark:false,households:1.,residents:None,housing_floor_need:None,
        district_role:String::new(),wealth:0.5,
    };
    let mut p = part.parcels[0].clone();
    let mut cells = vec![];
    for i in 0..3 {
        p.id = format!("relay/{i}");
        p.block = 0;
        p.shape = rectangle(i as f64*20.,0.,i as f64*20.+20.,20.);
        p.parent_ids = vec![];
        cells.push(p.clone());
    }
    owner.parcel_id = cells[0].id.clone();
    cells[1].use_kind = "garden".into();
    cells[1].reason = "attached-rear-land".into();
    cells[1].parent_ids = vec![owner.parcel_id.clone()];
    cells[1].access = Some(super::super::ParcelAccess {kind:"attached".into(),street:None,front_length:0.});
    cells[2].use_kind = "garden".into();
    cells[2].reason = "public-garden".into();
    part.parcels = cells;
    part.programme.as_mut().unwrap().allocations = vec![owner.clone()];
    part.programme.as_mut().unwrap().adjacency = graph(&part).0;
    lots::consolidate(None,&mut part);
    let rear = part.parcels.iter().find(|p|p.id == "relay/2").unwrap();
    assert_eq!(rear.parent_ids,vec![owner.parcel_id]);
    assert!(rear.access.as_ref().is_some_and(|a|a.kind == "attached" && a.street.is_none()));
    assert!(rear.front.is_none() && rear.contacts.is_empty());
}

/// Review #17: with more lots than households, gardens go to the lane
/// lots and every main-street lot holds a house, even when the lane lots
/// are nearer the centre; infill respects the population margin.
#[test]
fn main_street_lots_are_housed_before_any_garden() {
    let blocks = (0..8)
        .map(|i| {
            let x = 20.0 * i as f64;
            json!({"shape":rectangle(x,110.0,x+20.0,140.0),"quarter":0,"kind":"block","axis":{"x":1.0,"y":0.0}})
        })
        .collect::<Vec<_>>();
    let mut l: Layout = serde_json::from_value(json!({"key":"street-wall","culture":"european-organic",
        "center":{"x":150.0,"y":130.0},"quarters":[],"blocks":blocks,
        "streets":[{"path":[{"x":-10.0,"y":105.0},{"x":170.0,"y":105.0}],"widths":[8.0,8.0],"rank":1,"role":"street"}],
        "warnings":[]})).unwrap();
    let (height, water) = (vec![0.0; 32 * 32], vec![0; 32 * 32]);
    prepare(
        &mut l,
        18,
        &ProgrammeContext::default(),
        Surface {
            geometry: None,
            width: 1000.0,
            n: 32,
            height: &height,
            water: &water,
            interpolation: Default::default(),
        },
    )
    .unwrap();
    let mut p = partition(&l);
    // Lots 4..8 open on a lane (rank 3) and sit nearest the centre.
    for lot in &mut p.parcels[4..] {
        lot.rank = 3;
    }
    allocate(&l, &mut p);
    let pr = p.programme.unwrap();
    let wanted: f64 = pr
        .demands
        .iter()
        .filter(|d| d.unit == "domesticUnits")
        .map(|d| d.requested)
        .sum();
    assert!(
        wanted < 8.0,
        "the case needs surplus land, {wanted} households"
    );
    let role = |i: usize| {
        pr.allocations
            .iter()
            .find(|a| a.parcel_id == format!("lot/{i}"))
            .map_or("", |a| a.role.as_str())
    };
    for i in 0..4 {
        assert!(
            role(i).starts_with("dwelling"),
            "main-street lot {i} is {}",
            role(i)
        );
    }
    let housed: f64 = pr.allocations.iter().map(|a| a.households).sum();
    assert!(
        housed >= wanted.round() && housed <= (1.3 * wanted).floor(),
        "{housed} households for {wanted}"
    );
    if housed + 1.0 > 1.3 * wanted {
        assert!((4..8).any(|i| role(i) == "open.garden"), "the population margin stops infill");
    }
    // Spread: exact total, busiest plots first, no rounding cliff.
    let caps = [6.0, 6.0, 6.0, 6.0, 1.0];
    let spread = spread_households(&caps, &[0.9, 0.1, 0.1, 0.1, 0.5], &[true; 5], 11.0, None);
    assert_eq!(spread.iter().sum::<f64>(), 11.0);
    assert!(spread[0] > spread[1] && spread[4] == 1.0, "{spread:?}");
}
#[test]
fn housing_floor_need_core_is_frozen_only_by_actual_allocation() {
    let mut l = prepare_case("crossroads", false, "javanese-courts");
    for block in &mut l.blocks { block.kind = "block".into(); }
    let pr = l.programme.as_mut().unwrap();
    pr.reservations.clear();
    pr.demands.retain(|d| d.function == "domestic");
    pr.demands[0].requested = 3.;
    let population = pr.population;
    let mut p = partition(&l);
    allocate(&l, &mut p);
    let pr = p.programme.as_ref().unwrap();
    assert_eq!(pr.population, population);
    assert_eq!(pr.demands[0].requested, 3.);
    assert_eq!(pr.demands[0].built_capacity, 0.);
    let homes: Vec<_> = pr.allocations.iter().filter(|a| a.function == "domestic").collect();
    assert!(!homes.is_empty());
    for a in homes {
        let need = a.housing_floor_need.as_ref().expect("actual allocation freezes its own model");
        assert_eq!(need.allocated_households.to_bits(), a.households.to_bits());
        assert_eq!(need.model.wealth.to_bits(), a.wealth.clamp(0., 1.).to_bits());
        assert!((need.requested_m2 - a.households*60.*(0.7+0.8*a.wealth)).abs() < 1e-10);
        assert_eq!(need.model.calibration, "not-culture-calibrated");
        let mut old = serde_json::to_value(a).unwrap();
        old.as_object_mut().unwrap().remove("housingFloorNeed");
        let old_allocation: Allocation = serde_json::from_value(old.clone()).unwrap();
        assert!(old_allocation.housing_floor_need.is_none());
        assert_eq!(serde_json::to_value(old_allocation).unwrap(), old);
    }
}


#[test]
fn parcel_capacity_warning_never_claims_housed_households() {
    for requested in [1., 300.] {
        let mut l = prepare_case("crossroads", false, "european-organic");
        for block in &mut l.blocks { block.kind = "block".into(); }
        let pr = l.programme.as_mut().unwrap();
        pr.reservations.clear();
        pr.demands.retain(|d| d.function == "domestic");
        pr.demands[0].requested = requested;
        let mut without_plan = partition(&l);
        allocate(&l, &mut without_plan);
        // This metadata forces the explanatory warning, without modifying
        // any densification/allocation input. No Houses call is made.
        l.structure = Some(serde_json::from_value(json!({"metrics":{"capacity":{
            "densify":0.0,"extension":1.10,"vacancy":1.0
        }}})).unwrap());
        let mut with_plan = partition(&l);
        allocate(&l, &mut with_plan);
        assert_eq!(serde_json::to_value(&with_plan.programme).unwrap(),
            serde_json::to_value(&without_plan.programme).unwrap());
        let pr = with_plan.programme.as_ref().unwrap();
        assert!(pr.demands.iter().all(|d| d.built_capacity == 0. && d.open_capacity == 0.));
        let warning = with_plan.warnings.iter().find(|w| w.starts_with("Lot capacity "))
            .expect("parcel estimate must state its planning scope");
        assert!(warning.ends_with(" — model estimate"), "{warning}");
        if requested == 1. { assert!(warning.contains("100 %"), "{warning}"); }
    }
}
