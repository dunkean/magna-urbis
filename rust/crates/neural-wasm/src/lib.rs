//! Regional inference using Neural Earth's direct WebGPU runtime.
use neural_runtime::{Clock, Family, Networks, Regional, Request, Sketch, Validation, sketch};
#[path = "../../neural/src/zones.rs"]
mod zones;
use serde_json::{Value, json};
use std::rc::Rc;
use wasm_bindgen::prelude::*;

#[wasm_bindgen]
extern "C" {
    #[wasm_bindgen(js_namespace = performance, js_name = now)]
    fn now_ms() -> f64;
}
struct Performance;
impl Clock for Performance {
    fn now_ms(&self) -> f64 {
        now_ms()
    }
}
fn error(value: impl std::fmt::Display) -> JsValue {
    JsValue::from_str(&value.to_string())
}

fn request(params: &str, grid: &str) -> Result<Request, String> {
    let p: Value = serde_json::from_str(params).map_err(|e| e.to_string())?;
    let text = |key: &str, default: &str| p[key].as_str().unwrap_or(default).to_owned();
    let number = |key: &str, default: f64, min: f64, max: f64| -> Result<f64, String> {
        let value = if p[key].is_null() {
            default
        } else {
            p[key]
                .as_f64()
                .or_else(|| p[key].as_str()?.parse().ok())
                .ok_or_else(|| format!("Invalid {key}"))?
        };
        if value.is_finite() && (min..=max).contains(&value) {
            Ok(value)
        } else {
            Err(format!("Invalid {key}"))
        }
    };
    let mut r = Request::regional(
        &text("seed", "42"),
        &text("relief", "hills"),
        number("mix", 0.5, 0.0, 1.0)?,
        number("coasts", 0.0, 0.0, 255.0)? as u8,
        &text("islands", "island"),
        &text("climate", "temperate"),
        number("noise", 0.05, 0.001, 2.0)? as f32,
    )?;
    if let Sketch::Regional(s) = &mut r.sketch {
        s.land_scale = number("landScale", 1.0, 0.0, 5.0)?;
        s.climate.temperature =
            number("temperature", s.climate.temperature as f64, -30.0, 40.0)? as f32;
        s.climate.temperature_std = number(
            "temperatureStd",
            s.climate.temperature_std as f64,
            0.0,
            3000.0,
        )? as f32;
        s.climate.precipitation =
            number("precipitation", s.climate.precipitation as f64, 0.0, 6000.0)? as f32;
        s.climate.precipitation_cv = number(
            "precipitationCv",
            s.climate.precipitation_cv as f64,
            0.0,
            200.0,
        )? as f32;
    }
    for (i, key) in [
        "noiseTemperature",
        "noiseTemperatureStd",
        "noisePrecipitation",
        "noisePrecipitationCv",
    ]
    .iter()
    .enumerate()
    {
        r.tuning.climate_noise[i] = number(key, 0.5, 0.001, 10.0)? as f32;
    }
    r.tuning.coarse_steps = number("steps", 4.0, 1.0, 32.0)? as usize;
    r.tuning.relief_scale = number("reliefScale", 1.0, 0.0, 5.0)? as f32;
    if !p["reliefFixed"].is_null() {
        r.tuning.relief_fixed = Some(number("reliefFixed", 0.0, 0.0, 5000.0)? as f32);
    }
    let histogram = text("histogram", "0,0,0,0,0")
        .split(',')
        .map(str::parse::<f32>)
        .collect::<Result<Vec<_>, _>>()
        .map_err(|e| e.to_string())?;
    if histogram.len() != 5 || histogram.iter().any(|v| !v.is_finite()) {
        return Err("Invalid histogram".into());
    }
    r.tuning.histogram.copy_from_slice(&histogram);
    r.tuning.residual_scale = number("detail", 1.0, 0.0, 5.0)? as f32;
    if !grid.is_empty() && grid != "null" {
        let g: Value = serde_json::from_str(grid).map_err(|e| e.to_string())?;
        if g.get("zones").is_some() {
            zones::apply(&mut r, &g)?;
            return Ok(r);
        }
        let n = g["resolution"].as_u64().unwrap_or(0) as usize;
        let h = g["heights"].as_array().ok_or("Sketch heights missing")?;
        if g["version"].as_u64() != Some(1) || !(8..=128).contains(&n) || h.len() != n * n {
            return Err("Invalid sketch dimensions".into());
        }
        let heights = h
            .iter()
            .map(|v| {
                v.as_f64()
                    .filter(|h| h.is_finite() && (-12000.0..=12000.0).contains(h))
                    .ok_or("Invalid sketch height")
            })
            .collect::<Result<Vec<_>, _>>()?;
        let region = &g["region"];
        let (extent, origin) = if region.is_null() {
            (40000.0, (0.0, 0.0))
        } else {
            (
                region["width"].as_f64().ok_or("Invalid sketch width")?,
                (
                    region["x"].as_f64().ok_or("Invalid sketch x")?,
                    region["y"].as_f64().ok_or("Invalid sketch y")?,
                ),
            )
        };
        if !extent.is_finite()
            || !(500.0..=40000.0).contains(&extent)
            || !origin.0.is_finite()
            || !origin.1.is_finite()
            || origin.0 < 0.0
            || origin.1 < 0.0
            || origin.0 + extent > 40000.000001
            || origin.1 + extent > 40000.000001
        {
            return Err("Sketch outside neural surface".into());
        }
        r.sketch = Sketch::Grid {
            resolution: n,
            heights,
            extent,
            origin,
            context: Box::new(r.sketch),
        };
    }
    Ok(r)
}

/// Share the exact regional conditioning with the Python inference service.
#[wasm_bindgen]
pub fn conditioning_json(params: &str, grid: &str) -> Result<String, JsValue> {
    let r = request(params, grid).map_err(error)?;
    let origin = neural_runtime::plan::FAST_ORIGIN;
    let plan =
        neural_runtime::plan::Plan::new(origin, neural_runtime::plan::Plan::cells(40000.0), false);
    let start = plan.coarse.start * neural_runtime::plan::COARSE_STRIDE;
    let end = (plan.coarse.end - 1) * neural_runtime::plan::COARSE_STRIDE
        + neural_runtime::plan::COARSE_SIZE;
    let n = (end - start) as usize;
    let mut relief = Vec::with_capacity(n * n);
    let mut strength = Vec::with_capacity(n * n);
    for y in 0..n {
        for x in 0..n {
            let value = r.sketch.relief_mask_at(
                plan.coarse_center_m(start + x as i64),
                plan.coarse_center_m(start + y as i64),
            );
            let (w, h) = value.unwrap_or((0.0, 0.0));
            strength.push(w);
            relief.push(h);
        }
    }
    Ok(
        json!({"seed": r.seed.to_string(), "origin": origin, "start": start, "size": n,
        "fields": r.sketch.fields(&plan, start, start, n), "localRelief": relief, "localReliefWeight": strength})
        .to_string(),
    )
}

#[wasm_bindgen]
pub fn sketch_json(params: &str) -> Result<String, JsValue> {
    let r = request(params, "").map_err(error)?;
    let mut heights = Vec::with_capacity(64 * 64);
    for y in 0..64 {
        for x in 0..64 {
            heights.push(
                r.sketch
                    .elevation((x as f64 + 0.5) * 625.0, (y as f64 + 0.5) * 625.0),
            );
        }
    }
    Ok(json!({"version": 1, "resolution": 64, "heights": heights}).to_string())
}

#[wasm_bindgen]
pub struct NeuralOutput {
    heights: Vec<f32>,
    meta: String,
}
#[wasm_bindgen]
impl NeuralOutput {
    #[wasm_bindgen(getter)]
    pub fn heights(&self) -> Vec<f32> {
        self.heights.clone()
    }
    #[wasm_bindgen(getter)]
    pub fn meta(&self) -> String {
        self.meta.clone()
    }
}
#[wasm_bindgen]
pub struct NeuralRelief {
    networks: Rc<Networks>,
}
#[wasm_bindgen]
impl NeuralRelief {
    pub async fn create(
        coarse: Vec<u8>,
        base: Vec<u8>,
        decoder: Vec<u8>,
    ) -> Result<NeuralRelief, JsValue> {
        console_error_panic_hook::set_once();
        Ok(Self {
            networks: Rc::new(
                neural_runtime::load_networks(coarse, base, decoder)
                    .await
                    .map_err(error)?,
            ),
        })
    }
    pub async fn generate_json(
        &self,
        params: String,
        grid: String,
    ) -> Result<NeuralOutput, JsValue> {
        let r = request(&params, &grid).map_err(error)?;
        // Cached windows depend on seed and conditioning, so clear them between maps.
        self.networks.clear_cache();
        let started = now_ms();
        let out = self
            .networks
            .generate(&r, &Performance)
            .await
            .map_err(error)?;
        let t = &out.timings;
        let meta = json!({"backend": "wasm-webgpu", "profile": "coarse4-nf4-b75-t2-decoder", "precision": self.networks.precision(),
            "totalMs": now_ms() - started, "coarseMs": t.coarse_ms, "baseMs": t.base_ms, "decoderMs": t.decoder_ms,
            "reconstructionMs": t.reconstruction_ms, "evaluations": [out.evaluations.0, out.evaluations.1, out.evaluations.2],
            "land": out.heights.iter().filter(|v| **v > 0.0).count() as f64 / out.heights.len() as f64,
            "edited": !grid.is_empty() && grid != "null", "sketchRegion": true});
        Ok(NeuralOutput {
            heights: out.heights,
            meta: meta.to_string(),
        })
    }
}
