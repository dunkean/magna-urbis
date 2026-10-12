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
