//! JavaScript bindings of the vector water chain's priority flood
//! (`magna_urbis_core::flood_grids`, `web/src/ui/simpleHydrology.ts`).

use magna_urbis_core::{FloodGrids, erode_grid, flood_grids};
use wasm_bindgen::prelude::*;

/// Grids of one flood; each `take_*` hands its array to JavaScript once.
#[wasm_bindgen]
pub struct Flood {
    grids: FloodGrids,
}

#[wasm_bindgen]
impl Flood {
    pub fn take_filled(&mut self) -> Vec<f32> {
        std::mem::take(&mut self.grids.filled)
    }
    pub fn take_receiver(&mut self) -> Vec<i32> {
        std::mem::take(&mut self.grids.receiver)
    }
    pub fn take_order(&mut self) -> Vec<i32> {
        std::mem::take(&mut self.grids.order)
    }
    pub fn take_accumulation(&mut self) -> Vec<f32> {
        std::mem::take(&mut self.grids.accumulation)
    }
    pub fn take_basin(&mut self) -> Vec<i32> {
        std::mem::take(&mut self.grids.basin)
    }
    pub fn take_sea(&mut self) -> Vec<u8> {
        std::mem::take(&mut self.grids.sea)
    }
    #[wasm_bindgen(getter)]
    pub fn outlets(&self) -> u32 {
        self.grids.outlets
    }
}

/// Priority-flood from the sea, the map edge and the `outlet` cells, then D8
/// on the filled surface, upstream areas and basins. Empty `weight`, `outlet`
/// and `loss` slices mean none.
#[wasm_bindgen]
pub fn flood_hydrology(
    height: &[f32],
    n: usize,
    cell_area: f64,
    weight: &[f32],
    outlet: &[u8],
    loss: &[f32],
) -> Result<Flood, JsValue> {
    let total = n * n;
    if n < 2 || height.len() != total {
        return Err(JsValue::from_str("Grille hydrologique invalide."));
    }
    let weight = (weight.len() == total).then_some(weight);
    let outlet = (outlet.len() == total).then_some(outlet);
    let loss = (loss.len() == total).then_some(loss);
    Ok(Flood { grids: flood_grids(height, n, cell_area, weight, outlet, loss) })
}

/// The pre-hydrology stream-power erosion (`erode` of `web/src/ui/reliefConditioning.ts`):
/// one call instead of one flood copy-out per step.
#[wasm_bindgen]
pub fn erode_relief(
    height: &mut [f32],
    n: usize,
    cell_area: f64,
    steps: u32,
    deposit: f64,
) -> Result<(), JsValue> {
    if n < 2 || height.len() != n * n {
        return Err(JsValue::from_str("Grille hydrologique invalide."));
    }
    erode_grid(height, n, cell_area, steps, deposit);
    Ok(())
}
