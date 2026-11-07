use wasm_bindgen::prelude::*;
/// u32 LE header length, padded JSON, then LE planes (same as /terrain/water).
#[wasm_bindgen]
pub fn vector_water_request(body: &[u8]) -> Result<Vec<u8>, JsValue> {
    magna_urbis_core::vector_water::request_with_clock(body, &|| super::performance_now())
        .map_err(|e| JsValue::from_str(&e))
}
