//! Bounded source/compact/detail checks for the inspired Roman B12 envelope.
//! Neither generic room uses nor internal household IDs certify city capacity.
use magna_urbis_houses::{
    catalogue::{Layout, catalogue},
    enrich_architecture,
    geometry::{area, rectangle},
    model::{FeatureKind, HistoricalMode, RoomUsage},
    placement::{PlacementBatchSettings, PlacementRequest},
    plans::{
        PlanBatch, PlanBatchRequest, PlanBuilding, RealizePlanRequest, plan_batch, realize_plan,
    },
    resolve_architecture,
};
use std::collections::{BTreeMap, BTreeSet};

fn request(id: &str, width: f64, depth: f64) -> PlacementRequest {
    serde_json::from_value(serde_json::json!({
        "id": id, "parcel_id": format!("{id}-parcel"),
        "cadastral": rectangle(0., 0., width, depth),
        "buildable": rectangle(0., 0., width, depth),
        "roof_domain": rectangle(0., 0., width, depth),
        "reserves": [], "party_boundaries": [], "neighbors": [],
        "accesses": [{"id":"street", "kind":"public", "width_m":2.,
            "segment":[{"x":0.,"y":depth},{"x":width,"y":depth}]}],
        "culture": {"culture":"roman-core", "pack":"MED-ANT",
            "mode":"historical_inspired", "borrowing":null},
        "function":"mixed", "seed":id, "parcel_fit":false,
        "config": {"schema_version":"2", "seed":id, "pack":"MED-ANT",
            "recipe":"MED-ANT-B12", "mode":"historical_inspired", "era":"A",
            "allow_late":false, "count":1, "size":1., "variation":0., "wealth":1.,
            "orientation_deg":0., "overrides":{"variant":"default","floors":2}},
        "occupation":{"coverage":(31.5/(width*depth)).min(0.75),
            "frontage_m":4.5,"depth_m":7.},
        "programme":{"role":"dwelling.shop", "composition":"row", "floors":[2,2],
            "built_area_m2":31.5},
        "terrain":{"origin":{"x":0.,"y":0.},"ground_z_m":10.,
            "gradient":[0.,0.],"water_z_m":null,"max_foundation_step_m":0.75}
    }))
    .unwrap()
}

fn batch(requests: Vec<PlacementRequest>, settings: PlacementBatchSettings) -> PlanBatch {
    plan_batch(PlanBatchRequest {
        schema_version: "1".into(),
        requests,
        settings: Some(settings),
        footprints: BTreeMap::new(),
    })
    .unwrap()
}

fn replay_exterior_and_characterize_native_interior(building: &PlanBuilding) {
    let wire = serde_json::to_vec(building).unwrap();
    let restored: PlanBuilding = serde_json::from_slice(&wire).unwrap();
    assert_eq!(
        serde_json::to_vec(&building.resolved).unwrap(),
        serde_json::to_vec(&restored.resolved).unwrap(),
        "The compact round trip must retain exact floating-point geometry."
    );
    let resolved = restored.resolved.unpack().unwrap();
    let retained = serde_json::to_value(&resolved).unwrap();
    let exterior = realize_plan(RealizePlanRequest {
        building: restored.clone(),
        interiors: false,
    })
    .unwrap_or_else(|error| panic!("B12 retained exterior: {error}"));
    // This is the SAME unpacked plan, not resolve_architecture(config) again.
    // Prove that rooms/stairs can be built independently from the urban portal
    // connection, which is known to disagree with this generic interior entry.
    let interior = enrich_architecture(&resolved)
        .unwrap_or_else(|error| panic!("B12 native interior of retained plan: {error}"));
    for detail in [&exterior, &interior] {
        let unit = &detail.units[0];
        assert_eq!(unit.recipe_id, "MED-ANT-B12");
        assert_eq!(unit.variant_id, "default");
        assert_eq!(unit.bodies.len(), 1);
        assert_eq!(unit.bodies[0].levels.len(), 2);
        assert_eq!(
            serde_json::to_value(&unit.bodies[0].footprint).unwrap(),
            retained["plan"]["bodies"][0]["footprint"]
        );
        assert!(!unit.roofs.faces.is_empty());
    }
    let unit = &interior.units[0];
    assert!(
        unit.rooms
            .iter()
            .any(|r| r.level == 0 && r.usage == RoomUsage::Shop),
        "The native shopfront detail also assigns a generic ground-floor shop use."
    );
    assert!(unit.rooms.iter().any(|r| r.level == 1));
    assert!(
        unit.rooms
            .iter()
            .filter(|r| r.level == 1)
            .all(|r| r.usage == RoomUsage::Living)
    );
    assert!(unit.features.iter().any(|f| f.kind == FeatureKind::Stair));
    let mut reached = BTreeSet::from([unit.access.root.clone()]);
    loop {
        let before = reached.len();
        for portal in &unit.access.portals {
            if reached.contains(&portal.from) {
                reached.insert(portal.to.clone());
            }
            if reached.contains(&portal.to) {
                reached.insert(portal.from.clone());
            }
        }
        if reached.len() == before {
            break;
        }
    }
    assert!(unit.rooms.iter().all(|room| {
        reached.contains(&room.access_node)
            && unit
                .access
                .nodes
                .iter()
                .any(|node| node.id == room.access_node)
    }));
    assert_eq!(retained, serde_json::to_value(&resolved).unwrap());

    // Characterize the unresolved urban connection instead of swallowing any
    // detail failure. Native construction succeeds, but its exterior portal
    // does not coincide with the retained cartographic entrance (1mm guard).
    let angle = building.transform.orientation_deg.to_radians();
    let (sin, cos) = angle.sin_cos();
    let entry_gap = unit
        .access
        .portals
        .iter()
        .filter(|p| p.from == unit.access.root || p.to == unit.access.root)
        .map(|p| {
            let x = (p.opening[0].x + p.opening[1].x) * 0.5;
            let y = (p.opening[0].y + p.opening[1].y) * 0.5;
            let dx = building.transform.origin.x + x * cos - y * sin - building.entrance.x;
            let dy = building.transform.origin.y + x * sin + y * cos - building.entrance.y;
            dx.hypot(dy)
        })
        .fold(f64::INFINITY, f64::min);
    assert!(
        entry_gap.is_finite() && entry_gap >= 0.001,
        "entry gap={entry_gap}"
    );
    let error = realize_plan(RealizePlanRequest {
        building: restored,
        interiors: true,
    })
    .err()
    .expect("The known urban portal mismatch must remain an explicit refusal.");
    assert_eq!(
        error,
        "Native interior entrance differs from the retained planning connection. City plan preserved; detailed site admission is required."
    );
    eprintln!(
        "{}: native rooms/stairs valid; urban entry mismatch {entry_gap:.6}m remains refused",
        building.id
    );
    assert_eq!(building.domestic_units, 0);
}

#[test]
fn roman_b12_minimum_compact_restores_native_shop_and_living_levels() {
    let data = catalogue().unwrap();
    let recipe = data.recipes.iter().find(|r| r.id == "MED-ANT-B12").unwrap();
    assert!(recipe.inspired_only);
    assert_eq!(recipe.tradition_id.as_deref(), Some("roman_urban"));
    assert_eq!(recipe.parameters.layout, Layout::Single);
    assert_eq!(recipe.parameters.bodies, [1, 1]);
    assert_eq!(recipe.parameters.floors, [2, 2]);
    assert_eq!(recipe.parameters.width_m, [4.5, 6.5]);
    assert_eq!(recipe.parameters.depth_m, [7., 11.]);
    assert_eq!(recipe.parameters.level_height_m, 2.8);
    assert!(
        recipe
            .sources
            .iter()
            .any(|s| s.path == "docs/sources/roman-compact-domestic-architecture_FR.md")
    );

    let result = batch(
        vec![request("b12-minimum-two-levels", 8., 12.)],
        PlacementBatchSettings {
            parcel_fit: Some(false),
            ..Default::default()
        },
    );
    assert_eq!(result.buildings.len(), 1, "{:?}", result.refusals);
    assert!(result.refusals.is_empty() && result.open_spaces.is_empty());
    let building = &result.buildings[0];
    assert!((area(&building.footprint) - 31.5).abs() < 0.0001);
    assert!(building.courtyards.is_empty() && building.structural_features.is_empty());
    assert_eq!(building.volumes.len(), 1);
    assert_eq!(building.volumes[0].levels.len(), 2);
    let retained = serde_json::to_value(building.resolved.unpack().unwrap()).unwrap();
    assert_eq!(
        retained["parameters"]["width_m"],
        serde_json::json!([4.5, 4.5])
    );
    assert_eq!(
        retained["parameters"]["depth_m"],
        serde_json::json!([7., 7.])
    );
    assert_eq!(
        retained["parameters"]["components"][0]["floors"],
        serde_json::json!([2, 2])
    );
    replay_exterior_and_characterize_native_interior(building);
}

#[test]
fn roman_b12_strict_pin_hard_floor_and_impossible_lot_remain_refusals() {
    let mut strict = request("b12-strict-pin-refused", 8., 12.);
    strict.culture.mode = HistoricalMode::HistoricalStrict;
    strict.config.as_mut().unwrap().mode = HistoricalMode::HistoricalStrict;
    let mut floors = request("b12-hard-three-levels-refused", 8., 12.);
    floors.config.as_mut().unwrap().overrides.floors = Some(3);
    let narrow = request("b12-too-narrow", 2., 12.);
    let result = batch(
        vec![strict, floors, narrow],
        PlacementBatchSettings::default(),
    );
    assert!(result.buildings.is_empty() && result.open_spaces.is_empty());
    assert_eq!(result.refusals.len(), 3);
    assert!(result.refusals.iter().all(|r| !r.message.is_empty()));
}

#[test]
fn roman_b12_exact_model_keeps_two_levels_despite_soft_four_level_programme() {
    let mut req = request("b12-exact-two-levels-soft-four", 8., 12.);
    req.programme.as_mut().unwrap().floors = Some([4, 4]);
    let config = req.config.clone().unwrap();
    let original = serde_json::to_value(resolve_architecture(config.clone()).unwrap()).unwrap();
    let result = batch(
        vec![req],
        PlacementBatchSettings {
            parcel_fit: Some(false),
            house_config: Some(config),
            ..Default::default()
        },
    );
    assert_eq!(result.buildings.len(), 1, "{:?}", result.refusals);
    let building = &result.buildings[0];
    let retained = serde_json::to_value(building.resolved.unpack().unwrap()).unwrap();
    assert_eq!(original["parameters"], retained["parameters"]);
    assert_eq!(original["plan"]["bodies"], retained["plan"]["bodies"]);
    assert_eq!(building.volumes[0].levels.len(), 2);
    replay_exterior_and_characterize_native_interior(building);
}
