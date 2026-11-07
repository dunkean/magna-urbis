//! Synchronous exports, including the main-thread raster vectorizer (no rayon).
use magna_urbis_core::landuse::{self, Window};
use wasm_bindgen::prelude::*;
#[wasm_bindgen]
pub fn landuse_stage(header: &str, planes: &[u8]) -> Result<Vec<u8>, JsValue> {
    landuse::wire::execute(header, planes).map_err(|e| JsValue::from_str(&e))
}
#[wasm_bindgen]
pub fn landuse_vectorize(
    ind: &[f32],
    w: usize,
    h: usize,
    cell: f64,
    min_area: f64,
    x0: i32,
    y0: i32,
    x1: i32,
    y1: i32,
) -> Result<Vec<u8>, JsValue> {
    if w.checked_mul(h) != Some(ind.len()) || w == 0 || h == 0 || !cell.is_finite() || cell <= 0.0 {
        return Err(JsValue::from_str("Invalid region raster"));
    }
    landuse::wire::encode(&landuse::vectorize(
        ind,
        w,
        h,
        cell,
        min_area,
        Window {
            x0: x0 as isize,
            y0: y0 as isize,
            x1: x1 as isize,
            y1: y1 as isize,
        },
    ))
    .map_err(|e| JsValue::from_str(&e.to_string()))
}
#[wasm_bindgen]
pub fn landuse_farm(request: &str) -> Result<String, JsValue> {
    landuse::farm_geometry(request).map_err(|e| JsValue::from_str(&e))
}

#[wasm_bindgen]
extern "C" {
    #[wasm_bindgen(typescript_type = "(x: number, y: number) => number")]
    pub type LanduseField;
    #[wasm_bindgen(method, js_name = call)]
    fn invoke(this: &LanduseField, receiver: &JsValue, x: f64, y: f64) -> f64;
    #[wasm_bindgen(typescript_type = "() => number")]
    pub type LanduseRandom;
    #[wasm_bindgen(method, js_name = call)]
    fn draw(this: &LanduseRandom, receiver: &JsValue) -> f64;
    #[wasm_bindgen(typescript_type = "(ax: number, ay: number, bx: number, by: number) => boolean")]
    pub type LanduseClear;
    #[wasm_bindgen(method, js_name = call)]
    fn clear(this: &LanduseClear, receiver: &JsValue, ax: f64, ay: f64, bx: f64, by: f64) -> bool;
}
#[wasm_bindgen]
pub fn landuse_field_tool(
    request: &str,
    dir: &LanduseField,
    slope: &LanduseField,
    strips: &LanduseField,
    clear: &LanduseClear,
    noise: &LanduseField,
    random: &LanduseRandom,
) -> Result<String, JsValue> {
    let receiver = JsValue::UNDEFINED;
    landuse::tools::field_tool(
        request,
        &|x, y| dir.invoke(&receiver, x, y),
        &|x, y| slope.invoke(&receiver, x, y),
        &|x, y| strips.invoke(&receiver, x, y),
        &|a, b| clear.clear(&receiver, a.x, a.y, b.x, b.y),
        &|x, y| noise.invoke(&receiver, x, y),
        &mut || random.draw(&receiver),
    )
    .map_err(|e| JsValue::from_str(&e))
}
#[wasm_bindgen]
pub fn landuse_farm_tool(request: &str) -> Result<String, JsValue> {
    landuse::tools::farm_tool(request).map_err(|e| JsValue::from_str(&e))
}
#[wasm_bindgen]
pub fn landuse_growth_reserve(
    base: &[u8],
    n: usize,
    cell: f64,
    footprints: &str,
) -> Result<Vec<u8>, JsValue> {
    landuse::tools::growth_reserve(base, n, cell, footprints).map_err(|e| JsValue::from_str(&e))
}
