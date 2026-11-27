//! Build-time validated additions to the city morphology and silhouette style tables.
use std::sync::OnceLock;

use serde_json::{Map, Value};

fn catalogue() -> &'static Value {
    static CATALOGUE: OnceLock<Value> = OnceLock::new();
    CATALOGUE.get_or_init(|| {
        serde_json::from_str(include_str!(concat!(
            env!("OUT_DIR"),
            "/contributor-cultures.json"
        )))
        .expect("prepared contributor cultures")
    })
}

pub(super) fn add_morphologies(urban: &mut Value) {
    for table in ["cultures", "presets"] {
        urban[table]
            .as_object_mut()
            .expect("urban catalogue table")
            .extend(
                catalogue()[table]
                    .as_object()
                    .expect("prepared catalogue table")
                    .clone(),
            );
    }
}

pub(super) fn styles() -> &'static Map<String, Value> {
    catalogue()["styles"]
        .as_object()
        .expect("prepared style table")
}

pub(super) fn base(culture: &str) -> &str {
    styles()
        .get(culture)
        .and_then(|entry| entry["base"].as_str())
        .unwrap_or(culture)
}
