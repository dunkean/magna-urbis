use super::*;
use crate::urban::{self, *};
use serde_json::{Value, json};

fn town(culture: &str, population: u32, width: f64, slope: f64, island: Option<f64>) -> (Vec<Layout>, Vec<Partition>, Vec<Value>) {
    let n = 64;
    let center = Point { x: width * 0.5, y: width * 0.5 };
    let height: Vec<f32> = (0..n*n).map(|i| (20.0 + slope * (i % n) as f64 * width / n as f64) as f32).collect();
    let water: Vec<u8> = (0..n*n).map(|i| u8::from(island.is_some_and(|radius|
        ((i % n) as f64 * width / n as f64 - center.x).hypot((i / n) as f64 * width / n as f64 - center.y) > radius))).collect();
    let level = vec![0.0; n*n];
    let surface = Surface { geometry: None, width, n, height: &height, water: &water, interpolation: Default::default() };
    let site = Site { key: "package-g".into(), name: String::new(), population, culture: culture.into(), center,
        radius: crate::settlements::extent_radius(population) };
    let mut cfg: LayoutConfig = serde_json::from_str(include_str!("fixtures/small-layout-config.json")).unwrap();
    cfg.align_enclosed_grid = true;
    let layouts = generate_quarters("magna-urbis-v2", &[site], &cfg, surface, &[]).unwrap();
    let parts = generate_parcels("magna-urbis-v2", &layouts, &ParcelConfig::default()).unwrap();
    let mut index = building_sites::BuildingSiteIndex::prepare(&layouts, &parts, &[0]).unwrap();
    let total = index.total();
    let mut requests = vec![];
    for _ in 0..total.div_ceil(64).max(1) {
        let page = index.page("magna-urbis-v2", &layouts, &parts, surface, &level, None,
            requests.len(), 64, building_sites::MAX_SITE_PAGE_BYTES).unwrap();
        assert!(!page.requests.is_empty() || requests.len() == total, "Paging must make progress");
        requests.extend(page.requests);
        if requests.len() == total { break; }
    }
    assert_eq!(requests.len(), total);
    (layouts, parts, requests)
}

#[test]
fn skinny_and_degenerate_sampling_has_a_hard_attempt_cap() {
    let points = samples((0.0, 0.0, 40_000.0, 0.01), 0.001, 600);
    assert!(!points.is_empty() && points.len() <= 600);
    assert!(points.iter().all(|p| p.x < 40_000.0 && p.y < 0.01));
    assert!(samples((0.0, 0.0, f64::INFINITY, 1.0), 1.0, 600).is_empty());
    assert!(samples((0.0, 0.0, 1.0, 1.0), 0.0, 600).is_empty());
}

#[test]
fn celtic_200_has_one_dwelling_per_cultural_household() {
    let (layouts, parts, requests) = town("celtic-oppidum", 200, 4000.0, 0.0, None);
    let programme = parts[0].programme.as_ref().unwrap();
    let homes: Vec<_> = programme.allocations.iter().filter(|a| a.unit == "domesticUnits").collect();
    let wanted = 200.0 / urban::roles::occupancy("celtic-oppidum").household_size;
    let held: f64 = homes.iter().map(|a| a.households).sum();
    eprintln!("CELTIC200 homes={} households={held}/{wanted} requests={} walls={}", homes.len(), requests.len(), layouts[0].enclosures.len());
    assert!(homes.len() as f64 >= wanted * 0.9, "{} homes for {wanted} households", homes.len());
    assert!(held >= wanted * 0.9);
    assert!(homes.iter().all(|a| a.households <= 1.0));
    assert!(!requests.is_empty());
}

#[test]
fn wizard_800_reserves_and_allocates_its_cultural_tower() {
    let (_, parts, requests) = town("wizard-city", 800, 4000.0, 0.0, None);
    let programme = parts[0].programme.as_ref().unwrap();
    let tower = programme.demands.iter().find(|d| d.role == "civic.wizard-tower").unwrap();
    assert_eq!(tower.sites, 1);
    assert!(programme.allocations.iter().any(|a| a.demand_id == tower.id), "Tower must receive land");
    assert!(requests.iter().any(|r| r["programme"]["role"] == "civic.wizard-tower" && r["function"] != "open_space"), "Tower must have a native source");
    let larger = urban::roles::services("wizard-city", 8000);
    assert!(larger.iter().find(|n| n.entry.role == tower.role).unwrap().sites > tower.sites);
}

#[test]
fn constrained_medina_keeps_what_fits_and_reports_achieved_population() {
    let (layouts, parts, requests) = town("medina", 8000, 4000.0, 0.0, Some(110.0));
    assert!(!requests.is_empty(), "A habitable island must retain a partial town");
    assert!(!layouts[0].blocks.is_empty());
    assert!(parts[0].warnings.iter().any(|w| w.starts_with("Population target not reached:") && w.contains("/8000 inhabitants.")), "{:?}", parts[0].warnings);
}

#[test]
fn celtic_mu3_choices_keep_real_deficit_requests_compatible_with_allocations() {
    // TODO's second MU3: magna-urbis-v2, Celtic oppidum, tundra, high mountains,
    // 8000 inhabitants, 40 km. The neural raster is not embedded in the code;
    // this sloping raster exercises its native foothold/deficit transport.
    let (_, parts, requests) = town("celtic-oppidum", 8000, 40_000.0, 0.04, None);
    let opens: Vec<_> = requests.iter().filter(|r| r["function"] == "open_space"
        && r["programme"]["deficit"].is_object()).map(|r| json!({
            "id": r["id"], "parcel_id": r["parcel_id"], "surface": r["cadastral"],
        })).collect();
    assert!(!opens.is_empty(), "Replay must exercise native architectural deficits");
    assert!(requests.iter().any(|r| r["function"] != "open_space"), "Replay keeps buildable town lots too");
    let scene: programme::BuiltScene = serde_json::from_value(json!({"buildings":[],"refusals":[],"open_spaces":opens})).unwrap();
    let carried = programme::carry_open_deficits(&parts, &scene, &requests).unwrap();
    let reconciled = programme::reconcile_built(&parts, &carried).unwrap();
    assert_eq!(carried.open_spaces.len(), scene.open_spaces.len());
    assert!(reconciled[0].warnings.iter().any(|w| w.starts_with("Population target not reached:")));
}
