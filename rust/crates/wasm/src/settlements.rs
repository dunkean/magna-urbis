use magna_urbis_core::settlements::{Raster, Terrain, roads};
use wasm_bindgen::prelude::*;

/// The adapted terrain and its derived fields, kept between calls: placement and routing are
/// separate, so moving a settlement or changing a road option only reroutes.
/// All placement, scoring and routing runs in Rust. JSON only carries editable properties.
#[wasm_bindgen]
pub struct SettlementTerrain {
    inner: Terrain,
}

#[wasm_bindgen]
impl SettlementTerrain {
    /// Native urban cuts on the retained terrain. Inputs and outputs use metric JSON.
    pub fn urban_quarters(
        &self,
        seed: &str,
        sites: &str,
        config: &str,
        roads: &str,
    ) -> Result<String, JsValue> {
        let decode_error = |e: serde_json::Error| JsValue::from_str(&e.to_string());
        let sites = serde_json::from_str::<Vec<magna_urbis_core::urban::Site>>(sites)
            .map_err(decode_error)?;
        let cfg = serde_json::from_str(config).map_err(decode_error)?;
        let roads = serde_json::from_str::<Vec<magna_urbis_core::urban::Street>>(roads)
            .map_err(decode_error)?;
        let output = self
            .inner
            .urban_quarters(seed, &sites, &cfg, &roads)
            .map_err(|e| JsValue::from_str(&e))?;
        serde_json::to_string(&output).map_err(decode_error)
    }

    /// Recut parcels from retained blocks without modifying streets, terrain or sites.
    pub fn urban_parcels(
        &self,
        seed: &str,
        layouts: &str,
        config: &str,
    ) -> Result<String, JsValue> {
        let decode_error = |e: serde_json::Error| JsValue::from_str(&e.to_string());
        let layouts = serde_json::from_str::<Vec<magna_urbis_core::urban::Layout>>(layouts)
            .map_err(decode_error)?;
        let cfg = serde_json::from_str(config).map_err(decode_error)?;
        let output = magna_urbis_core::urban::generate_parcels(seed, &layouts, &cfg)
            .map_err(|e| JsValue::from_str(&e))?;
        serde_json::to_string(&output).map_err(decode_error)
    }
    #[wasm_bindgen(constructor)]
    #[allow(clippy::too_many_arguments)]
    pub fn new(
        width: f64,
        resolution: u32,
        height: &[f32],
        water: &[u8],
        water_level: &[f32],
        river_width: &[f32],
        river_ids: &[i32],
    ) -> Result<SettlementTerrain, JsValue> {
        let raster = Raster {
            width,
            n: resolution as usize,
            height,
            water,
            water_level,
            river_width,
            river_ids,
        };
        Terrain::new(raster)
            .map(|inner| Self { inner })
            .map_err(|e| JsValue::from_str(&e))
    }

    /// Settlement points from a placement configuration (JSON).
    pub fn place(&self, seed: &str, config: &str) -> Result<String, JsValue> {
        let cfg = serde_json::from_str(config).map_err(|e| JsValue::from_str(&e.to_string()))?;
        let out = self
            .inner
            .place(seed, &cfg)
            .map_err(|e| JsValue::from_str(&e))?;
        serde_json::to_string(&out).map_err(|e| JsValue::from_str(&e.to_string()))
    }

    /// Road network between `sites` (JSON array of placed settlements) from a road configuration.
    pub fn roads(&self, seed: &str, sites: &str, config: &str) -> Result<String, JsValue> {
        let sites: Vec<roads::RoadSite> =
            serde_json::from_str(sites).map_err(|e| JsValue::from_str(&e.to_string()))?;
        let cfg = serde_json::from_str(config).map_err(|e| JsValue::from_str(&e.to_string()))?;
        let out = self
            .inner
            .roads(seed, &sites, &cfg)
            .map_err(|e| JsValue::from_str(&e))?;
        serde_json::to_string(&out).map_err(|e| JsValue::from_str(&e.to_string()))
    }
}
