//! JavaScript binding of the forest control field (`magna_urbis_terrain::forest_request`,
//! `rust/bridge/terrainForest.ts`). Same binary framing as the native `/terrain/forest`.

use wasm_bindgen::prelude::*;

#[wasm_bindgen]
pub fn build_forest_field(request: &[u8]) -> Result<Vec<u8>, JsValue> {
    magna_urbis_core::forest_request(request).map_err(|e| JsValue::from_str(&e))
}
