use crate::resident::Resident;
use magna_urbis_core::settlements::{Raster, Terrain, roads};
use wasm_bindgen::prelude::*;

/// The adapted terrain and its derived fields, kept between calls: placement and routing are
/// separate, so moving a settlement or changing a road option only reroutes.
/// All placement, scoring and routing runs in Rust. JSON only carries editable properties.
/// Urban products (layouts, partitions) stay resident here, addressed by ids
/// (`resident.rs`): stages pass handles, not geometry.
#[wasm_bindgen]
pub struct SettlementTerrain {
    pub(crate) inner: Terrain,
    pub(crate) resident: Resident,
}

#[wasm_bindgen]
impl SettlementTerrain {
    /// Feature handshake before a caller sends explicit composable weights.
    /// Old generated JS/WASM lacks this static method and must fail closed.
    pub fn urban_programme_functions_version() -> u32 {
        magna_urbis_core::urban::programme::PROGRAMME_FUNCTIONS_VERSION
    }
    pub fn set_urban_geometry(&mut self, geometry: &str) -> Result<(), JsValue> {
        let input =
            serde_json::from_str(geometry).map_err(|e| JsValue::from_str(&e.to_string()))?;
        self.inner
            .set_urban_geometry(input)
            .map_err(|e| JsValue::from_str(&e))
    }
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
    /// Compact display buffers of a plan (same blob as the native `displayBuffers`
    /// read): typed geometry and attribute codes for drawing, no JSON geometry.
    pub fn urban_display_buffers(
        &self,
        layouts: &str,
        partitions: &str,
        ids: bool,
    ) -> Result<Vec<u8>, JsValue> {
        let decode = |e: serde_json::Error| JsValue::from_str(&e.to_string());
        let layouts: Vec<magna_urbis_core::urban::Layout> =
            serde_json::from_str(layouts).map_err(decode)?;
        let partitions: Vec<magna_urbis_core::urban::Partition> =
            serde_json::from_str(partitions).map_err(decode)?;
        Ok(magna_urbis_core::urban::display::display_buffers(
            &layouts,
            &partitions,
            ids,
        ))
    }
    /// Reconcile only allocation on retained blocks and parcels.
    pub fn urban_programme(&self, layouts: &str, partitions: &str) -> Result<String, JsValue> {
        let decode = |e: serde_json::Error| JsValue::from_str(&e.to_string());
        let layouts: Vec<magna_urbis_core::urban::Layout> =
            serde_json::from_str(layouts).map_err(decode)?;
        let partitions: Vec<magna_urbis_core::urban::Partition> =
            serde_json::from_str(partitions).map_err(decode)?;
        let result = magna_urbis_core::urban::programme::reallocate(&layouts, &partitions)
            .map_err(|e| JsValue::from_str(&e))?;
        serde_json::to_string(&result).map_err(decode)
    }
    pub fn urban_building_sites(
        &self,
        seed: &str,
        layouts: &str,
        partitions: &str,
        architecture_culture: Option<String>,
    ) -> Result<String, JsValue> {
        let decode = |e: serde_json::Error| JsValue::from_str(&e.to_string());
        let layouts = serde_json::from_str::<Vec<magna_urbis_core::urban::Layout>>(layouts)
            .map_err(decode)?;
        let partitions =
            serde_json::from_str::<Vec<magna_urbis_core::urban::Partition>>(partitions)
                .map_err(decode)?;
        let result = self
            .inner
            .urban_building_sites_with_culture(
                seed,
                &layouts,
                &partitions,
                architecture_culture.as_deref(),
            )
            .map_err(|e| JsValue::from_str(&e))?;
        serde_json::to_string(&result).map_err(decode)
    }
    /// Number of building sites `urban_building_sites` emits for these inputs.
    pub fn urban_building_sites_total(layouts: &str, partitions: &str) -> Result<u32, JsValue> {
        let decode = |e: serde_json::Error| JsValue::from_str(&e.to_string());
        let layouts = serde_json::from_str::<Vec<magna_urbis_core::urban::Layout>>(layouts)
            .map_err(decode)?;
        let partitions =
            serde_json::from_str::<Vec<magna_urbis_core::urban::Partition>>(partitions)
                .map_err(decode)?;
        magna_urbis_core::urban::building_sites::request_count(&layouts, &partitions)
            .map(|n| n as u32)
            .map_err(|e| JsValue::from_str(&e))
    }
    /// Sites `start..end` of `urban_building_sites` as a JSON array: worker
    /// pools split one city's sites and concatenate the ranges in order.
    pub fn urban_building_sites_range(
        &self,
        seed: &str,
        layouts: &str,
        partitions: &str,
        architecture_culture: Option<String>,
        start: u32,
        end: u32,
    ) -> Result<String, JsValue> {
        let decode = |e: serde_json::Error| JsValue::from_str(&e.to_string());
        let layouts = serde_json::from_str::<Vec<magna_urbis_core::urban::Layout>>(layouts)
            .map_err(decode)?;
        let partitions =
            serde_json::from_str::<Vec<magna_urbis_core::urban::Partition>>(partitions)
                .map_err(decode)?;
        let result = self
            .inner
            .urban_building_sites_range(
                seed,
                &layouts,
                &partitions,
                architecture_culture.as_deref(),
                start as usize,
                end as usize,
            )
            .map_err(|e| JsValue::from_str(&e))?;
        serde_json::to_string(&result).map_err(decode)
    }
    pub fn urban_built_capacity(&self, partitions: &str, scene: &str) -> Result<String, JsValue> {
        let decode = |e: serde_json::Error| JsValue::from_str(&e.to_string());
        let partitions =
            serde_json::from_str::<Vec<magna_urbis_core::urban::Partition>>(partitions)
                .map_err(decode)?;
        let scene = serde_json::from_str::<magna_urbis_core::urban::programme::BuiltScene>(scene)
            .map_err(decode)?;
        let result = magna_urbis_core::urban::programme::reconcile_built(&partitions, &scene)
            .map_err(|e| JsValue::from_str(&e))?;
        serde_json::to_string(&result).map_err(decode)
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
            .map(|inner| Self {
                inner,
                resident: Resident::default(),
            })
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
