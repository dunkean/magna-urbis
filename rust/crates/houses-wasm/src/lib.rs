//! Coarse JSON boundary; all architectural decisions belong to the native crate.
use magna_urbis_houses::{catalogue, model::HouseConfig};
use serde::Serialize;
use wasm_bindgen::prelude::*;

const MAX_JSON_BYTES: usize = 64 * 1024 * 1024;

#[derive(Serialize)]
struct ApiError<'a> {
    code: &'a str,
    field: Option<&'a str>,
    message: &'a str,
}

#[derive(Serialize)]
struct Success<T> {
    ok: bool,
    data: T,
}

#[derive(Serialize)]
struct CatalogueBundle<'a> {
    catalogue: &'a catalogue::Catalogue,
    inventory: &'a catalogue::SourceInventory,
}

fn failure(code: &str, field: Option<&str>, message: &str) -> String {
    // These fields cannot fail JSON serialization; no geometry is included.
    serde_json::json!({"ok": false, "error": ApiError { code, field, message }}).to_string()
}

fn success<T: Serialize>(data: T) -> String {
    match serde_json::to_string(&Success { ok: true, data }) {
        Ok(json) if json.len() <= MAX_JSON_BYTES => json,
        Ok(_) => failure(
            "output_budget",
            None,
            "La réponse dépasse le plafond de 64 Mio.",
        ),
        Err(error) => failure("serialization_failed", None, &error.to_string()),
    }
}

fn config(input: &str) -> Result<HouseConfig, String> {
    if input.len() > 32 * 1024 {
        return Err(failure(
            "input_budget",
            None,
            "Configuration JSON trop volumineuse.",
        ));
    }
    serde_json::from_str(input).map_err(|error| failure("invalid_json", None, &error.to_string()))
}

#[wasm_bindgen]
pub fn catalogue_json() -> String {
    match (catalogue::catalogue(), catalogue::source_inventory()) {
        (Ok(catalogue), Ok(inventory)) => success(CatalogueBundle {
            catalogue,
            inventory,
        }),
        (Err(error), _) | (_, Err(error)) => failure("catalogue_failed", None, &error),
    }
}

#[wasm_bindgen]
pub fn preflight_json(input: &str) -> String {
    let config = match config(input) {
        Ok(config) => config,
        Err(error) => return error,
    };
    match magna_urbis_houses::preflight(config) {
        Ok(preflight) => success(preflight),
        Err(error) => failure("invalid_config", Some("config"), &error),
    }
}

#[wasm_bindgen]
pub fn generate_houses_json(input: &str) -> String {
    let config = match config(input) {
        Ok(config) => config,
        Err(error) => return error,
    };
    if let Err(error) = magna_urbis_houses::preflight(config.clone()) {
        return failure("invalid_config", Some("config"), &error);
    }
    match magna_urbis_houses::generate_batch(config) {
        Ok(batch) => success(batch),
        Err(error) => failure("generation_failed", None, &error),
    }
}

#[wasm_bindgen]
pub fn architecture_profiles_json() -> String {
    match magna_urbis_houses::placement::admissibility_profiles() {
        Ok(profiles) => success(profiles),
        Err(error) => failure("architecture_profiles", None, &error),
    }
}

#[wasm_bindgen]
pub fn architecture_capabilities_json() -> String {
    success(&[
        "houses.placement",
        "houses.profiles",
        "houses.enrich",
        "houses.config-template",
        "houses.workshop-template",
        "houses.parcel-fit",
        "houses.compact-plans",
        "houses.style-index",
        "houses.native-minimum-candidates-v1",
        "houses.functional-choices-v1",
    ])
}

#[wasm_bindgen]
pub fn place_buildings_json(input: &str) -> String {
    if input.len() > 32 * 1024 * 1024 {
        return failure("input_budget", None, "Placement input exceeds 32 MiB.");
    }
    let request = match serde_json::from_str(input) {
        Ok(request) => request,
        Err(error) => return failure("invalid_json", None, &error.to_string()),
    };
    match magna_urbis_houses::placement::place_batch(request) {
        Ok(batch) => success(batch),
        Err(error) => failure("placement_failed", None, &error),
    }
}

#[wasm_bindgen]
pub fn enrich_placement_json(input: &str) -> String {
    if input.len() > 32 * 1024 * 1024 {
        return failure(
            "input_budget",
            None,
            "Retained architecture exceeds 32 MiB.",
        );
    }
    let building = match serde_json::from_str(input) {
        Ok(building) => building,
        Err(error) => return failure("invalid_json", None, &error.to_string()),
    };
    match magna_urbis_houses::placement::enrich_placement(building) {
        Ok(batch) => success(batch),
        Err(error) => failure("enrichment_refused", None, &error),
    }
}

#[wasm_bindgen]
pub fn architecture_style_index_json() -> String {
    match magna_urbis_houses::style_index::style_index() {
        Ok(index) => success(index),
        Err(error) => failure("style_index", None, &error),
    }
}

#[wasm_bindgen]
pub fn plan_buildings_json(input: &str) -> String {
    if input.len() > 32 * 1024 * 1024 { return failure("input_budget", None, "Plan input exceeds 32 MiB."); }
    let request = match serde_json::from_str(input) {
        Ok(request) => request, Err(error) => return failure("invalid_json", None, &error.to_string()),
    };
    match magna_urbis_houses::plans::plan_batch(request) {
        Ok(batch) => success(batch), Err(error) => failure("plan_generation", None, &error),
    }
}

#[wasm_bindgen]
pub fn realize_plan_json(input: &str) -> String {
    if input.len() > 32 * 1024 * 1024 { return failure("input_budget", None, "Retained plan exceeds 32 MiB."); }
    let request = match serde_json::from_str(input) {
        Ok(request) => request, Err(error) => return failure("invalid_json", None, &error.to_string()),
    };
    match magna_urbis_houses::plans::realize_plan(request) {
        Ok(batch) => success(batch), Err(error) => failure("realization_refused", None, &error),
    }
}
