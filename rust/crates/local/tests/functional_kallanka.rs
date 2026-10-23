//! Cross-crate contract: an existing city allocation selects the exported native
//! hall capability before user edits, without a second recipe mapping in core.
use magna_urbis_core::urban::{self, building_sites::BuildingSiteIndex};
use magna_urbis_houses::{
    geometry::area,
    placement::PlacementRequest,
    plans::{self, PlanBatchRequest, RealizePlanRequest},
};
use serde_json::{Value, json};
use std::collections::BTreeMap;

fn fixture(
    culture: &str,
    role: &str,
    function: &str,
    period: &str,
    mode: &str,
) -> (Vec<urban::Layout>, Vec<urban::Partition>) {
    let mapping = urban::culture::mapping(culture).unwrap();
    let shape = json!({"outer":[{"x":40.,"y":60.},{"x":120.,"y":60.},{"x":120.,"y":180.},{"x":40.,"y":180.}],"holes":[]});
    let programme = json!({"version":1,"population":6000,"context":{"period":period,"mode":mode},"cultures":[mapping],
        "demands":[],"reservations":[],"allocations":[{"parcelId":"city/hall","demandId":"kallanka", "function":function,
            "culture":culture,"architecturePack":mapping.architecture_pack,"capacity":600.,"unit":"usefulArea","score":1.,"reasons":[],"role":role,"landmark":true}],
        "adjacency":[],"environment":[],"reconciliationPasses":0,"warnings":[]});
    let layout = serde_json::from_value(json!({"key":"city","culture":culture,"config":{},"programme":programme,
        "center":{"x":80.,"y":120.},"quarters":[{"shape":shape,"phase":0,"zone":"core"}],
        "streets":[{"path":[{"x":30.,"y":57.},{"x":130.,"y":57.}],"widths":[6.,6.],"rank":1,"role":"street"}],
        "blocks":[{"shape":shape,"quarter":0,"kind":"civic","axis":{"x":1.,"y":0.},"zone":"core"}],"warnings":[]})).unwrap();
    let partition = serde_json::from_value(json!({"key":"city","config":{},"parcels":[{"id":"city/hall","shape":shape,"block":0,"use":"collective",
        "front":null,"axis":{"x":1.,"y":0.},"rank":0,"pressure":0.85,"family":"compound"}],"programme":programme,"warnings":[]})).unwrap();
    (vec![layout], vec![partition])
}

fn sites(
    culture: &str,
    role: &str,
    function: &str,
    period: &str,
    mode: &str,
) -> Result<Vec<Value>, String> {
    let (layouts, partitions) = fixture(culture, role, function, period, mode);
    let surface = urban::Surface {
        geometry: None,
        width: 512.,
        n: 16,
        height: &[20.; 256],
        water: &[0; 256],
    };
    let whole = urban::building_sites::requests(
        "production-kallanka",
        &layouts,
        &partitions,
        surface,
        &[20.; 256],
        None,
    )?;
    let mut index = BuildingSiteIndex::prepare(&layouts, &partitions, &[0])?;
    let page = index.page(
        "production-kallanka",
        &layouts,
        &partitions,
        surface,
        &[20.; 256],
        None,
        0,
        1,
        24 * 1024 * 1024,
    )?;
    assert_eq!(
        page.requests, whole,
        "production capability preserves page/collect equality"
    );
    Ok(whole)
}

fn plan(site: Value) -> plans::PlanBatch {
    let request: PlacementRequest = serde_json::from_value(site).unwrap();
    plans::plan_batch(PlanBatchRequest {
        schema_version: "1".into(),
        requests: vec![request],
        settings: None,
        footprints: BTreeMap::new(),
    })
    .unwrap()
}

#[test]
fn kallanka_allocation_selects_the_declared_hall_before_explicit_user_constraints() {
    for mode in ["strict", "inspired"] {
        let site = sites("inca", "civic.kallanka", "collective", "M", mode)
            .unwrap()
            .remove(0);
        assert_eq!(site["config"]["recipe"], "AM-AND-B04");
        assert_eq!(site["programme"]["composition"], "hall");
        assert!(site["programme"]["floors"].is_array());
        assert!(site["config"]["overrides"]["floors"].is_null());
        let mut outcome = plan(site.clone());
        assert_eq!(outcome.buildings.len(), 1, "{:?}", outcome.refusals);
        let building = outcome.buildings.remove(0);
        assert_eq!(building.recipe_id, "AM-AND-B04");
        assert_eq!(building.volumes.len(), 1);
        assert_eq!(building.volumes[0].levels.len(), 1);
        assert!((360. - 0.1..=960. + 0.1).contains(&area(&building.footprint)));
        assert!(
            building
                .diagnostics
                .iter()
                .any(|d| d.contains("hall-am-and-b04-v1"))
        );
        let restored = serde_json::from_slice(&serde_json::to_vec(&building).unwrap()).unwrap();
        let detailed = plans::realize_plan(RealizePlanRequest {
            building: restored,
            interiors: false,
        })
        .unwrap();
        assert!(!detailed.units[0].roofs.faces.is_empty());
        let mut explicit_floors = site.clone();
        explicit_floors["config"]["overrides"]["floors"] = json!(2);
        let rejected = plan(explicit_floors);
        assert!(rejected.buildings.is_empty());
        assert_eq!(rejected.refusals.len(), 1);
        // An edit made after site generation stays a pin; the consumer does not
        // reapply the automatic role mapping to overwrite it.
        let mut explicit_recipe = site;
        explicit_recipe["config"]["recipe"] = json!("AM-AND-B01");
        let edited = plan(explicit_recipe);
        assert!(edited.buildings.iter().all(|b| b.recipe_id == "AM-AND-B01"));
        assert_eq!(edited.buildings.len() + edited.refusals.len(), 1);
    }
    if let Ok(older) = sites("inca", "civic.kallanka", "collective", "A", "strict") {
        assert!(older.iter().all(|s| s["config"]["recipe"] != "AM-AND-B04"));
    }
    for (culture, role, function) in [
        ("inca", "worship.ushnu", "collective"),
        ("inca", "elite.kancha-palace", "collective"),
        ("inca", "commerce.market", "market"),
        ("yoruba", "civic.palace", "collective"),
    ] {
        let site = sites(culture, role, function, "M", "inspired")
            .unwrap()
            .remove(0);
        assert_ne!(site["config"]["recipe"], "AM-AND-B04");
        assert_ne!(site["config"]["recipe"], "AF-WEST-B03");
        assert!(!site["config"]["overrides"]["floors"].is_null());
        if function == "market" {
            assert_eq!(site["function"], "open_space");
        }
    }
}
