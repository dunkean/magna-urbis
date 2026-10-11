//! Experimental browser bindings of the neural relief (WebGPU), not used by the bench.
//!
//! Status with burn 0.22 / cubecl 0.11 on an RTX 3090 in Chromium: the chain runs
//! after the `subgroups` workaround below, but takes ≈52 s per map instead of ≈1 s
//! natively (no tensor cores through WGSL), and maps after the first one are wrong
//! once autotuned WGSL kernels are selected. The bench therefore uses the native
//! service; this crate is kept as the starting point for a compact distilled base.
use magna_urbis_neural::burn::tensor::Device;
use magna_urbis_neural::{Clock, Networks, Request, gpu::Gpu, weights::Bundle};
use std::rc::Rc;
use wasm_bindgen::prelude::*;

#[wasm_bindgen]
extern "C" {
    #[wasm_bindgen(js_namespace = performance, js_name = now)]
    fn performance_now() -> f64;
}

// wgpu 30 cannot request the `subgroups` WebGPU feature, while cubecl's WGSL
// kernels declare `enable subgroups;`. Request it for every adapter that offers it.
#[wasm_bindgen(inline_js = "export function enable_subgroups() {
  const proto = globalThis.GPUAdapter?.prototype;
  if (!proto || proto.__magnaSubgroups) return;
  const request = proto.requestDevice;
  proto.requestDevice = function (descriptor = {}) {
    const features = new Set(descriptor.requiredFeatures ?? []);
    for (const name of ['subgroups', 'shader-f16']) if (this.features.has(name)) features.add(name);
    return request.call(this, { ...descriptor, requiredFeatures: [...features] });
  };
  proto.__magnaSubgroups = true;
}")]
extern "C" {
    fn enable_subgroups();
}

struct Performance;
impl Clock for Performance {
    fn now_ms(&self) -> f64 {
        performance_now()
    }
}

fn error(message: impl std::fmt::Display) -> JsValue {
    JsValue::from_str(&message.to_string())
}

/// Delivered 1024² signed heights in metres over 40 km, with stage timings.
#[wasm_bindgen]
pub struct NeuralOutput {
    heights: Vec<f32>,
    timings: Vec<f64>,
    evaluations: Vec<u32>,
}

#[wasm_bindgen]
impl NeuralOutput {
    #[wasm_bindgen(getter)]
    pub fn heights(&self) -> Vec<f32> {
        self.heights.clone()
    }
    /// coarse, base, decoder, reconstruction (ms).
    #[wasm_bindgen(getter)]
    pub fn timings(&self) -> Vec<f64> {
        self.timings.clone()
    }
    /// Network evaluations: coarse, base, decoder.
    #[wasm_bindgen(getter)]
    pub fn evaluations(&self) -> Vec<u32> {
        self.evaluations.clone()
    }
}

#[wasm_bindgen]
pub struct NeuralRelief {
    networks: Rc<Networks>,
}

#[wasm_bindgen]
impl NeuralRelief {
    /// Initializes WebGPU, then uploads the three prepared bundles (consumed).
    pub async fn create(
        coarse: Vec<u8>,
        base: Vec<u8>,
        decoder: Vec<u8>,
    ) -> Result<NeuralRelief, JsValue> {
        console_error_panic_hook::set_once();
        enable_subgroups();
        let device: Device = Device::wgpu_options()
            .init_async()
            .await
            .map_err(|e| error(format!("WebGPU : {e:?}")))?;
        let networks = Networks::load(
            Gpu::new(device),
            &Bundle::parse(&coarse).map_err(error)?,
            &Bundle::parse(&base).map_err(error)?,
            &Bundle::parse(&decoder).map_err(error)?,
        )
        .map_err(error)?;
        Ok(Self {
            networks: Rc::new(networks),
        })
    }

    /// Generates one 40 km map. Returns a `Promise<NeuralOutput>`.
    #[allow(clippy::too_many_arguments)]
    pub fn generate(
        &self,
        seed: String,
        relief: String,
        mix: f64,
        coast_mask: u32,
        islands: String,
        climate: String,
        height_noise: f64,
    ) -> js_sys::Promise {
        let networks = self.networks.clone();
        wasm_bindgen_futures::future_to_promise(async move {
            let request = Request::regional(
                &seed,
                &relief,
                mix,
                coast_mask as u8,
                &islands,
                &climate,
                height_noise as f32,
            )
            .map_err(error)?;
            let output = networks
                .generate(&request, &Performance)
                .await
                .map_err(error)?;
            let t = &output.timings;
            Ok(JsValue::from(NeuralOutput {
                heights: output.heights,
                timings: vec![t.coarse_ms, t.base_ms, t.decoder_ms, t.reconstruction_ms],
                evaluations: [
                    output.evaluations.0,
                    output.evaluations.1,
                    output.evaluations.2,
                ]
                .map(|v| v as u32)
                .to_vec(),
            }))
        })
    }
}
