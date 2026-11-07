//! Rural land use, shared by the stateless native and synchronous WASM bridges.
mod boolean;
mod farms;
mod fields;
mod geom;
mod ground;
mod hash;
mod par;
mod raster;
mod rural;
mod rural_farms;
#[cfg(test)]
mod tests;
mod timing;
pub mod tools;
pub mod wire;
pub use geom::{Point, Polygon, Region};
pub use ground::{landscape_cover_ground, urban_landscape_ground};
use magna_urbis_random::Rng;
use magna_urbis_terrain::noise::Noise;
pub use raster::{Window, vectorize};
pub use rural::generate_rural;
use serde::{Deserialize, Serialize};
use serde_json::Value;

pub fn farm_geometry(request: &str) -> Result<String, String> {
    let v: Value = serde_json::from_str(request).map_err(|e| e.to_string())?;
    let ctx: farms::Context =
        serde_json::from_value(v["context"].clone()).map_err(|e| e.to_string())?;
    let origin: Point = serde_json::from_value(v["origin"].clone()).map_err(|e| e.to_string())?;
    let inward: Point = serde_json::from_value(v["inward"].clone()).map_err(|e| e.to_string())?;
    let size = farms::SIZES
        .iter()
        .position(|&s_| s_ == s(&v["size"]))
        .ok_or("Invalid farm size")?;
    let kind = s(&v["type"]);
    if ![
        "vierkanthof",
        "u-yard",
        "l-yard",
        "haufenhof",
        "longere",
        "einhaus",
        "masseria",
        "dvor",
        "norse-longhouse",
        "roundhouse",
        "minka",
        "hanok",
        "chinese-court",
        "indian-court",
        "ksar",
        "sahel-compound",
        "kraal",
        "ail",
        "native-longhouse",
        "pueblo-ranch",
        "solar",
        "kancha",
        "stilt",
        "fungal-farm",
        "spore-farm",
    ]
    .contains(&kind)
    {
        return Err("Invalid farm type".into());
    }
    let farm = farms::layout(
        kind,
        size,
        &ctx,
        farms::frame(inward, ctx.downhill),
        Rng::new(s(&v["seed"])),
    );
    serde_json::to_string(&farms::place(&farm, origin, inward)).map_err(|e| e.to_string())
}

#[derive(Clone, Deserialize, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct Input {
    pub seed: String,
    pub w: usize,
    pub h: usize,
    pub cell: f64,
    #[serde(default)]
    pub map_size: f64,
    #[serde(default)]
    pub biome: String,
    #[serde(default)]
    pub sea_level: f64,
    #[serde(default)]
    pub sea_fraction: f64,
    #[serde(default)]
    pub options: Value,
    #[serde(default)]
    pub geometry: Value,
    #[serde(default)]
    pub plan: Option<Value>,
    #[serde(default)]
    pub main_roads: Option<usize>,
    #[serde(default)]
    pub strip_lod: Option<Value>,
    #[serde(default)]
    pub height: Vec<f32>,
    #[serde(default)]
    pub slope: Vec<f32>,
    #[serde(default)]
    pub water: Vec<u8>,
    #[serde(default)]
    pub cost: Vec<f32>,
    #[serde(default)]
    pub hab: Vec<f32>,
    #[serde(default)]
    pub d_water: Vec<f32>,
    #[serde(default)]
    pub d_sea: Vec<f32>,
    #[serde(default)]
    pub natural_forest: Vec<f32>,
    /// Samples at exactly the TS coarse soil lattice (including its extra border).
    #[serde(default)]
    pub soil: Vec<f32>,
    /// Exact context samples at candidate farm positions are supplied by the resource model.
    #[serde(default)]
    pub soil_context: Value,
}
impl Input {
    pub fn validate(&self, rural: bool) -> Result<(), String> {
        let n = self
            .w
            .checked_mul(self.h)
            .ok_or("Landuse raster overflow")?;
        if self.w < 2
            || self.h < 2
            || n > 16_777_216
            || !self.cell.is_finite()
            || self.cell <= 0.0
            || self.height.len() != n
            || self.slope.len() != n
            || self.water.len() != n
        {
            return Err("Invalid landuse raster".into());
        }
        if rural
            && (self.w != self.h
                || [&self.cost, &self.hab, &self.d_water, &self.d_sea]
                    .iter()
                    .any(|a| a.len() != n))
        {
            return Err("Invalid rural fields".into());
        }
        if !self.natural_forest.is_empty() && self.natural_forest.len() != n {
            return Err("Invalid forest field".into());
        }
        Ok(())
    }
}

#[derive(Default, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct Area {
    pub kind: String,
    #[serde(serialize_with = "wire::polygon")]
    pub poly: Polygon,
    #[serde(skip_serializing_if = "Vec::is_empty", default)]
    #[serde(serialize_with = "wire::polygons")]
    pub holes: Vec<Polygon>,
    #[serde(skip_serializing_if = "Option::is_none", default)]
    pub strip_angle: Option<f64>,
    #[serde(skip_serializing_if = "Vec::is_empty", default)]
    #[serde(serialize_with = "wire::polygons")]
    pub strips: Vec<Polygon>,
    #[serde(skip_serializing_if = "Option::is_none", default)]
    pub field_layout: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none", default)]
    pub cultivation: Option<String>,
    #[serde(skip_serializing_if = "std::ops::Not::not", default)]
    pub enclosed: bool,
    #[serde(skip_serializing_if = "Option::is_none", default)]
    pub enclosure: Option<String>,
}
impl Area {
    fn new(kind: &str, r: Region) -> Self {
        Self {
            kind: kind.into(),
            poly: r.outer,
            holes: r.holes,
            ..Self::default()
        }
    }
    fn region(&self) -> Region {
        Region {
            outer: self.poly.clone(),
            holes: self.holes.clone(),
        }
    }
}
#[derive(Default, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct Layer {
    pub areas: Vec<Area>,
    #[serde(serialize_with = "wire::values")]
    pub farmsteads: Vec<Value>,
    #[serde(serialize_with = "wire::polygons")]
    pub reserve: Vec<Polygon>,
    #[serde(skip_serializing_if = "Option::is_none", default)]
    #[serde(serialize_with = "wire::optional_polygons")]
    pub ways: Option<Vec<Polygon>>,
    #[serde(skip_serializing_if = "Option::is_none", default)]
    #[serde(serialize_with = "wire::optional_polygons")]
    pub headlands: Option<Vec<Polygon>>,
    #[serde(skip_serializing_if = "Vec::is_empty", default)]
    pub natural_ground: Vec<Region>,
    #[serde(skip_serializing_if = "Option::is_none", default)]
    pub landscape_ground: Option<Vec<Region>>,
}
#[derive(Serialize)]
pub struct RuralOutput {
    pub layer: Layer,
    pub stats: std::collections::BTreeMap<String, f64>,
}

pub(crate) fn arr(v: &Value) -> &[Value] {
    v.as_array().map(Vec::as_slice).unwrap_or(&[])
}
pub(crate) fn num(v: &Value) -> f64 {
    v.as_f64().unwrap_or(0.0)
}
pub(crate) fn s(v: &Value) -> &str {
    v.as_str().unwrap_or("")
}
pub(crate) fn yes(v: &Value) -> bool {
    v.as_bool().unwrap_or(false)
}
pub(crate) fn poly(v: &Value) -> Polygon {
    serde::Deserialize::deserialize(v).unwrap_or_default()
}
pub(crate) fn regions(v: &Value) -> Vec<Region> {
    serde::Deserialize::deserialize(v).unwrap_or_default()
}
pub(crate) const KINDS: [&str; 10] = [
    "", "field", "meadow", "pasture", "forest", "orchard", "garden", "marsh", "commons", "field",
];
pub(crate) fn natural(k: u8) -> bool {
    [4, 2, 3, 8, 7].contains(&k)
}
pub(crate) fn biome_kind(
    k: u8,
    b: &str,
    water: f64,
    hab: f64,
    slope: f64,
    soil: f64,
    u: f64,
    r: f64,
) -> u8 {
    match b {
        "underdark" | "underdark-caverns" => {
            if k == 7 {
                7
            } else if [1, 5, 6, 9].contains(&k)
                && u < 100.0_f64.max(r * 0.35)
                && slope < 0.12
                && water < 450.0
            {
                6
            } else {
                8
            }
        }
        "desert" => {
            if water > 420.0 || hab > 28.0 {
                if soil > 0.25 && slope < 0.12 { 3 } else { 8 }
            } else if k == 4 {
                if water < 150.0 && slope < 0.12 { 5 } else { 3 }
            } else if k == 2 && water > 180.0 {
                3
            } else {
                k
            }
        }
        "forest" | "tropical" => {
            if k == 7 {
                7
            } else if u > 110.0_f64.max(r * if b == "tropical" { 0.42 } else { 0.58 })
                * (1.0 + 0.4 * soil)
            {
                4
            } else {
                k
            }
        }
        "steppe" => {
            if k == 4 {
                if water < 120.0 && soil > 0.15 { 4 } else { 3 }
            } else if k == 5 && water > 220.0 {
                3
            } else {
                k
            }
        }
        "tundra" => {
            if [7, 2].contains(&k) {
                k
            } else if [1, 6, 9].contains(&k) {
                if u < 140.0 && slope < 0.08 { k } else { 3 }
            } else if soil < -0.1 || slope > 0.15 {
                8
            } else {
                3
            }
        }
        _ => k,
    }
}

pub fn generate_natural_cover(input: &Input) -> Result<Layer, String> {
    input.validate(false)?;
    let Input { w, h, cell, .. } = input;
    let (w, h, cell) = (*w, *h, *cell);
    let n = w * h;
    let mask: Vec<u8> = input
        .water
        .iter()
        .map(|&k| u8::from(k > 0 && k < 4))
        .collect();
    let (d_water, _) = raster::distance_field(&mask, w, h, cell, None);
    let noise = Noise::new(Rng::new(&input.seed).fork("natural-cover"));
    let mut classes = vec![0_u8; n];
    for y in 0..h {
        for x in 0..w {
            let i = y * w + x;
            if input.water[i] != 0 {
                continue;
            }
            let n = noise.fbm(
                (x as f64 + 0.5) * cell / 720.0,
                (y as f64 + 0.5) * cell / 720.0,
                3,
            );
            let sl = input.slope[i] as f64;
            let d = d_water[i] as f64;
            let wet = d < 100.0 && sl < 0.055;
            let low = d < 250.0 && sl < 0.09;
            let mut k = if input.biome == "underdark" {
                if low && n > -0.2 { 7 } else { 8 }
            } else if wet && input.height[i] as f64 - input.sea_level < 8.0 && n > -0.2 {
                7
            } else {
                match input.biome.as_str() {
                    "desert" => {
                        if low {
                            if n > 0.15 { 3 } else { 2 }
                        } else {
                            8
                        }
                    }
                    "tundra" => {
                        if low {
                            2
                        } else if n > 0.2 {
                            3
                        } else {
                            8
                        }
                    }
                    "steppe" => {
                        if low {
                            2
                        } else if n > 0.45 && d < 500.0 {
                            4
                        } else {
                            3
                        }
                    }
                    "forest" | "tropical" => {
                        if low && n < -0.35 {
                            2
                        } else if sl > 0.5 {
                            8
                        } else {
                            4
                        }
                    }
                    _ => {
                        if low {
                            2
                        } else if sl > 0.2 || n > 0.16 {
                            4
                        } else {
                            3
                        }
                    }
                }
            };
            if !input.natural_forest.is_empty() {
                if k == 4 {
                    k = 8;
                }
                if input.natural_forest[i] as f64 >= 0.22 && k != 7 {
                    k = 4;
                }
            }
            classes[i] = k;
        }
    }
    let mut layer = Layer::default();
    let pieces = par::map(&[4_u8, 2, 3, 8, 7], |&k| {
        let mut areas = Vec::new();
        if let Some(win) = raster::class_window(&classes, w, h, k) {
            let mask: Vec<f32> = classes
                .iter()
                .map(|&c| if c == k { 1.0 } else { 0.0 })
                .collect();
            for r in vectorize(&mask, w, h, cell, 1200.0_f64.max(2.2 * cell * cell), win) {
                areas.push(Area::new(KINDS[k as usize], r));
            }
        }
        areas
    });
    layer.areas = pieces.into_iter().flatten().collect();
    Ok(layer)
}
