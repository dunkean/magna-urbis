//! JavaScript binding of the main-town site choice (`magna_urbis_core::site`, `rust/bridge/siteNative.ts`).

use wasm_bindgen::prelude::*;

/// Framed request in (u32 header length, JSON header, planes), framed reply out: see `core/src/site.rs`.
#[wasm_bindgen]
pub fn site_choose(request: &[u8]) -> Result<Vec<u8>, JsValue> {
    magna_urbis_core::site::choose_site_framed(request).map_err(|e| JsValue::from_str(&e))
}
