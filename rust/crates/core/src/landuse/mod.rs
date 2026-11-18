//! Rural land use, shared by the stateless native and synchronous WASM bridges.
mod boolean;
mod farm_access;
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
// The regional road stage ends its field tracks inside the land these rules farm.
pub(crate) use rural::{holding_ha, rural_households, working_reach};
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
    /// Without a `cost` plane: travel cost is computed here from this cell over the `pass` plane
    /// (0 blocked, 1 land, 2 brook, 3 bridged), as `site::travel_cost`.
    #[serde(default)]
    pub travel_from: Option<usize>,
    #[serde(skip)]
    pub pass: Vec<u8>,
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

/// Width (m) a river needs before its banks keep a meadow in this biome: in arid climates runoff keeps grass only
/// beside large perennial rivers, never along a wadi or a dry bed.
fn meadow_river_width(biome: &str) -> f64 {
    match biome {
        "desert" => 30.0,
        "steppe" => 10.0,
        _ => 0.0,
    }
}
/// Riverside meadow (floodplain) cells: the valley floor beside a real river, not a fixed buffer. A cell belongs to it
/// when it lies within the reach of its nearest river (wider for a wider river: 120 m + 12 widths, at most 1.5 km) and
/// no higher above that river's channel than its flood stage (1 m + 4 % of the width, with a seeded irregularity), on
/// gentle ground. The edge follows the relief. River size comes from the displayed river widths of the geometry
/// (`terrain.rivers`: path and per-vertex width, metres); the stage receives no discharge or flow regime, so the width
/// stands for them. Without river geometry there is no riverside meadow.
pub(crate) fn floodplain_meadow(input: &Input, w: usize, h: usize, cell: f64) -> Vec<bool> {
    let total = w * h;
    let mut src = vec![0_u8; total];
    let mut width = vec![0_f32; total];
    for rv in arr(&input.geometry["terrain"]["rivers"]) {
        let path = poly(&rv["path"]);
        let widths: Vec<f64> = arr(&rv["width"]).iter().map(num).collect();
        if path.len() < 2 || widths.len() != path.len() {
            continue;
        }
        for k in 1..path.len() {
            let wv = (0.5 * (widths[k - 1] + widths[k])) as f32;
            raster::near_line(&path[k - 1..=k], w, h, cell, 0.75 * cell, |i| {
                src[i] = 1;
                width[i] = width[i].max(wv);
            });
        }
    }
    let min_width = meadow_river_width(&input.biome);
    if !src.iter().zip(&width).any(|(&s, &wv)| s == 1 && wv as f64 > min_width) {
        return vec![false; total];
    }
    let level: Vec<f32> = (0..total).map(|i| if src[i] == 1 { input.height[i] } else { 0.0 }).collect();
    let (d, near_width) = raster::distance_field(&src, w, h, cell, Some(&width));
    let (_, near_level) = raster::distance_field(&src, w, h, cell, Some(&level));
    let noise = Noise::new(Rng::new(&input.seed).fork("floodplain"));
    (0..total)
        .map(|i| {
            let wv = near_width[i] as f64;
            if input.water[i] != 0 || wv <= min_width || input.slope[i] as f64 > 0.08 {
                return false;
            }
            let (x, y) = ((i % w) as f64 + 0.5, (i / w) as f64 + 0.5);
            let rough = noise.fbm(x * cell / 260.0, y * cell / 260.0, 3);
            let reach = (120.0 + 12.0 * wv).min(1500.0) * (1.0 + 0.35 * rough);
            let stage = (1.0 + 0.04 * wv) * (1.0 + 0.6 * rough);
            (d[i] as f64) <= reach && (input.height[i] - near_level[i]) as f64 <= stage
        })
        .collect()
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
    let flood = floodplain_meadow(input, w, h, cell);
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
            // No settlement works this land: it is wild. Only natural cover is classed (woods, coastal marsh and the
            // floodplain meadow of real rivers); the rest stays unclassified (0), never commons, pasture or meadow.
            let mut k = if input.biome == "underdark" {
                if low && n > -0.2 { 7 } else { 8 }
            } else if wet && input.height[i] as f64 - input.sea_level < 8.0 && n > -0.2 {
                7
            } else if flood[i] {
                2
            } else {
                match input.biome.as_str() {
                    "desert" | "tundra" => 0,
                    "steppe" => {
                        if n > 0.45 && d < 500.0 {
                            4
                        } else {
                            0
                        }
                    }
                    "forest" | "tropical" => {
                        if sl > 0.5 {
                            0
                        } else {
                            4
                        }
                    }
                    _ => {
                        if sl > 0.2 || n > 0.16 {
                            4
                        } else {
                            0
                        }
                    }
                }
            };
            // Underdark: no trees grow without light; the climate forest field does not apply.
            if !input.natural_forest.is_empty() && !input.biome.starts_with("underdark") {
                if k == 4 {
                    k = 0;
                }
                if input.natural_forest[i] as f64 >= 0.22 && k != 7 {
                    k = 4;
                }
            }
            classes[i] = k;
        }
    }
    let mut layer = Layer::default();
    // The drawn water (rivers with their widths, lakes, water domains) is cut out of every natural class.
    let lakes = ground::tile_water(
        &ground::water_regions(input),
        geom::bbox(&[geom::p(0.0, 0.0), geom::p(w as f64 * cell, h as f64 * cell)]),
    );
    let lake_index = boolean::cut_index(&lakes);
    let pieces = par::map(&[4_u8, 2, 3, 8, 7], |&k| {
        let mut areas = Vec::new();
        if let Some(win) = raster::class_window(&classes, w, h, k) {
            let mask: Vec<f32> = classes
                .iter()
                .map(|&c| if c == k { 1.0 } else { 0.0 })
                .collect();
            let traced = vectorize(&mask, w, h, cell, 1200.0_f64.max(2.2 * cell * cell), win);
            for r in ground::exclude_lakes(traced, &lakes, &lake_index) {
                areas.push(Area::new(KINDS[k as usize], r));
            }
        }
        areas
    });
    layer.areas = pieces.into_iter().flatten().collect();
    Ok(layer)
}
