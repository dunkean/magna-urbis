//! Temporary metric urban-stage contract for Terrain Bench. Geometry, cultural
//! parameter application and deterministic partitioning execute only in Rust.
//! Layouts are retained inputs to the parcel stage; this is not the future World model.
mod geometry;
mod parcels;
mod quarters;

use crate::rng::Rng;
pub use crate::settlements::Point;
use serde::{Deserialize, Serialize};
use serde_json::{Value, json};
use std::collections::BTreeSet;
use std::sync::OnceLock;

#[derive(Clone, Debug, Serialize, Deserialize)]
pub struct Shape {
    pub outer: Vec<Point>,
    #[serde(default)]
    pub holes: Vec<Vec<Point>>,
}
#[derive(Clone, Debug, Serialize, Deserialize)]
pub struct Street {
    pub path: Vec<Point>,
    pub widths: Vec<f64>,
    pub rank: usize,
    pub role: String,
}
#[derive(Clone, Debug, Serialize, Deserialize)]
pub struct Quarter {
    pub shape: Shape,
    pub phase: usize,
}
#[derive(Clone, Debug, Serialize, Deserialize)]
pub struct Block {
    pub shape: Shape,
    pub quarter: usize,
    pub kind: String,
    pub axis: Point,
}
#[derive(Clone, Debug, Serialize, Deserialize)]
pub struct Layout {
    pub key: String,
    pub culture: String,
    pub center: Point,
    pub quarters: Vec<Quarter>,
    pub streets: Vec<Street>,
    pub blocks: Vec<Block>,
    pub warnings: Vec<String>,
}
#[derive(Clone, Debug, Serialize, Deserialize)]
pub struct Parcel {
    pub shape: Shape,
    pub block: usize,
    #[serde(rename = "use")]
    pub use_kind: String,
    pub front: Option<[Point; 2]>,
    pub axis: Point,
    pub rank: usize,
}
#[derive(Clone, Debug, Serialize, Deserialize)]
pub struct Partition {
    pub key: String,
    pub parcels: Vec<Parcel>,
    pub warnings: Vec<String>,
}
#[derive(Clone, Debug, Deserialize)]
pub struct Site {
    pub key: String,
    #[serde(default)]
    pub name: String,
    pub population: u32,
    pub culture: String,
    pub center: Point,
    pub radius: f64,
}

#[derive(Clone, Debug, Serialize, Deserialize)]
#[serde(default, rename_all = "camelCase", deny_unknown_fields)]
pub struct LayoutConfig {
    pub culture: String,
    pub preset: String,
    pub recipe: String,
    pub zone: String,
    pub density: f64,
    pub count: usize,
    pub rings: usize,
    /// Zero uses the settlement's existing population-derived radius.
    pub radius: f64,
    pub radius_scale: f64,
    pub placement: String,
    pub monument: String,
    pub params: Value,
}
impl Default for LayoutConfig {
    fn default() -> Self {
        Self {
            culture: "site".into(),
            preset: "culture".into(),
            recipe: "core".into(),
            zone: "core".into(),
            density: 1.0,
            count: 4,
            rings: 1,
            radius: 0.0,
            radius_scale: 1.0,
            placement: "center".into(),
            monument: "none".into(),
            params: json!({}),
        }
    }
}
#[derive(Clone, Debug, Serialize, Deserialize)]
#[serde(default, rename_all = "camelCase", deny_unknown_fields)]
pub struct ParcelConfig {
    pub culture: String,
    pub preset: String,
    pub recipe: String,
    pub zone: String,
    pub density: f64,
    pub params: Value,
}
impl Default for ParcelConfig {
    fn default() -> Self {
        Self {
            culture: "site".into(),
            preset: "culture".into(),
            recipe: "core".into(),
            zone: "core".into(),
            density: 1.0,
            params: json!({}),
        }
    }
}

#[derive(Clone, Copy)]
pub struct Surface<'a> {
    pub width: f64,
    pub n: usize,
    pub height: &'a [f32],
    pub water: &'a [u8],
}
impl Surface<'_> {
    pub fn height_at(&self, p: Point) -> f64 {
        let x = (p.x / self.width * self.n as f64 - 0.5).clamp(0.0, (self.n - 1) as f64);
        let y = (p.y / self.width * self.n as f64 - 0.5).clamp(0.0, (self.n - 1) as f64);
        let (ix, iy) = (x.floor() as usize, y.floor() as usize);
        let h = |dx: usize, dy: usize| {
            self.height[(iy + dy).min(self.n - 1) * self.n + (ix + dx).min(self.n - 1)] as f64
        };
        let (tx, ty) = (x.fract(), y.fract());
        (h(0, 0) * (1.0 - tx) + h(1, 0) * tx) * (1.0 - ty)
            + (h(0, 1) * (1.0 - tx) + h(1, 1) * tx) * ty
    }
    pub fn wet(&self, p: Point) -> bool {
        if p.x < 0.0 || p.y < 0.0 || p.x >= self.width || p.y >= self.width {
            return true;
        }
        let x = (p.x / self.width * self.n as f64) as usize;
        let y = (p.y / self.width * self.n as f64) as usize;
        self.water[y.min(self.n - 1) * self.n + x.min(self.n - 1)] != 0
    }
}

pub(super) struct Morph {
    pub value: Value,
}
impl Morph {
    pub fn number(&self, key: &str) -> f64 {
        self.number_or(key, 0.0)
    }
    pub fn number_or(&self, key: &str, default: f64) -> f64 {
        self.value[key].as_f64().unwrap_or(default)
    }
    pub fn pair(&self, key: &str) -> [f64; 2] {
        [
            self.value[key][0].as_f64().unwrap_or(0.0),
            self.value[key][1].as_f64().unwrap_or(0.0),
        ]
    }
    pub fn range(&self, key: &str, zone: &str) -> [f64; 2] {
        [
            self.value[key][zone][0].as_f64().unwrap_or(0.0),
            self.value[key][zone][1].as_f64().unwrap_or(0.0),
        ]
    }
    pub fn text(&self, key: &str) -> &str {
        self.value[key].as_str().unwrap_or("")
    }
    pub fn flag(&self, key: &str) -> bool {
        self.value[key].as_bool().unwrap_or(false)
    }
    pub fn width(&self, rank: usize, rng: &mut Rng) -> f64 {
        self.value["widthByRank"][rank.min(4)]
            .as_f64()
            .unwrap_or(3.0)
            * self.number("widthScale")
            * rng.range(
                1.0 - self.number("widthJitter"),
                1.0 + self.number("widthJitter"),
            )
    }
}
fn catalogue() -> &'static Value {
    static CATALOGUE: OnceLock<Value> = OnceLock::new();
    CATALOGUE.get_or_init(|| {
        serde_json::from_str(include_str!("catalogue.json")).expect("versioned urban catalogue")
    })
}
fn resolve(
    culture: &str,
    preset: &str,
    recipe: &str,
    zone: &str,
    density: f64,
    params: &Value,
    stage: &str,
) -> Result<Morph, String> {
    if !["core", "middle", "edge", "faubourg", "village"].contains(&zone)
        || !density.is_finite()
        || !(0.1..=10.0).contains(&density)
    {
        return Err("Zone ou densité urbaine invalide".into());
    }
    let cat = catalogue();
    let preset_id = if preset == "culture" {
        format!("{culture}/{recipe}")
    } else {
        preset.into()
    };
    let mut value = cat["presets"][&preset_id]["params"].clone();
    if !value.is_object() {
        return Err(format!("Préréglage urbain inconnu : {preset_id}"));
    }
    // Same density transformation as TypeScript applySprawl, applied before overrides.
    let f = (1.0 / density).clamp(0.5, 2.0).log2();
    for (key, scale, lo, hi) in [
        ("coverage", 1.0 - 0.24 * f, 0.05, 0.97),
        ("frontage", 1.0 + 0.32 * f, 3.5, f64::MAX),
        ("plotDepth", 1.0 + 0.22 * f, 8.0, f64::MAX),
        (
            "blockSize",
            1.0 + if f > 0.0 { 0.45 } else { 0.1 } * f,
            300.0,
            f64::MAX,
        ),
        (
            "houseArea",
            1.0 + if f > 0.0 { 0.25 } else { 0.12 } * f,
            30.0,
            f64::MAX,
        ),
    ] {
        if let Some(zones) = value[key].as_object_mut() {
            for range in zones.values_mut() {
                if let Some(a) = range.as_array_mut() {
                    for n in a {
                        *n = json!((n.as_f64().unwrap_or(0.0) * scale).clamp(lo, hi));
                    }
                }
            }
        }
    }
    let overrides = params
        .as_object()
        .ok_or("Les paramètres urbains doivent être un objet JSON")?;
    for (key, val) in overrides {
        if !cat["fields"][stage]
            .as_array()
            .is_some_and(|a| a.iter().any(|v| v.as_str() == Some(key)))
        {
            return Err(format!("{key} n'est pas utilisé par l'étape {stage}"));
        }
        let optional = match key.as_str() {
            "deepFill" => json!(false),
            _ => json!(0.0),
        };
        let reference = if value.get(key).is_some() {
            &value[key]
        } else {
            &optional
        };
        validate_param(key, val, reference)?;
        merge(&mut value[key], val);
    }
    let morph = Morph { value };
    if !["organic", "grid"].contains(&morph.text("streetOp"))
        || !["closes", "culDeSacTree", "hutong", "roji", "none"].contains(&morph.text("closeOp"))
        || !["road", "cardinal", "terrain", "water"].contains(&morph.text("orientation"))
        || ![
            "burgage",
            "courtyard",
            "siheyuan",
            "machiya",
            "compound",
            "garden",
            "wholeBlock",
        ]
        .contains(&morph.text("plotOp"))
    {
        return Err("Opérateur urbain inconnu".into());
    }
    for key in ["widthScale", "minWidth", "fieldWavelength", "accessDepth"] {
        if morph.number(key) <= 0.0 {
            return Err(format!("{key} doit être supérieur à zéro"));
        }
    }
    if morph.pair("gridSpacing").iter().any(|&v| v <= 0.0)
        || morph.range("frontage", zone)[0] <= 0.0
        || morph.range("houseArea", zone)[0] <= 0.0
        || morph.range("blockSize", zone)[0] <= 0.0
    {
        return Err("Espacement, surface et façade doivent être positifs".into());
    }
    Ok(morph)
}
fn validate_param(key: &str, value: &Value, reference: &Value) -> Result<(), String> {
    let invalid = || format!("{key} : valeur ou type invalide");
    match (value, reference) {
        (Value::Number(n), Value::Number(_)) => {
            let n = n.as_f64().ok_or_else(invalid)?;
            if !n.is_finite() || n.abs() > 1e9 || n < 0.0 && key != "fieldTwist" {
                return Err(invalid());
            }
            if [
                "coverage",
                "wideLotChance",
                "deadEndRatio",
                "slitDepth",
                "widthJitter",
                "contourFollow",
                "contourBlend",
                "fieldRandom",
            ]
            .contains(&key)
                && n > 1.0
            {
                return Err(invalid());
            }
        }
        (Value::Array(a), Value::Array(b)) if a.len() == b.len() => {
            for (v, r) in a.iter().zip(b) {
                validate_param(key, v, r)?;
            }
            if a.len() == 2
                && !["gridSpacing", "laneSpacing"].contains(&key)
                && a[0].as_f64() > a[1].as_f64()
            {
                return Err(invalid());
            }
        }
        (Value::Object(a), Value::Object(b)) => {
            for (k, v) in a {
                validate_param(key, v, b.get(k).ok_or_else(invalid)?)?;
            }
        }
        (Value::Bool(_), Value::Bool(_)) | (Value::String(_), Value::String(_)) => {}
        _ => return Err(invalid()),
    }
    Ok(())
}
fn merge(base: &mut Value, patch: &Value) {
    if let (Some(b), Some(p)) = (base.as_object_mut(), patch.as_object()) {
        for (key, v) in p {
            merge(b.entry(key).or_insert(Value::Null), v);
        }
    } else {
        *base = patch.clone();
    }
}

pub fn generate_quarters(
    seed: &str,
    sites: &[Site],
    config: &LayoutConfig,
    surface: Surface<'_>,
    roads: &[Street],
) -> Result<Vec<Layout>, String> {
    if sites.len() > 1000
        || !(3..=64).contains(&config.count)
        || !(1..=2).contains(&config.rings)
        || !config.radius.is_finite()
        || !(0.0..=25000.0).contains(&config.radius)
        || !config.radius_scale.is_finite()
        || !(0.1..=5.0).contains(&config.radius_scale)
        || !["center", "rectangle", "skew", "notched"].contains(&config.placement.as_str())
    {
        return Err("Configuration de quartiers invalide".into());
    }
    let mut keys = BTreeSet::new();
    let mut out = vec![];
    for site in sites {
        if !keys.insert(&site.key)
            || site.key.is_empty()
            || !site.radius.is_finite()
            || site.radius <= 0.0
            || site.radius > 25000.0
            || !site.center.x.is_finite()
            || !site.center.y.is_finite()
            || !(0.0..=surface.width).contains(&site.center.x)
            || !(0.0..=surface.width).contains(&site.center.y)
        {
            return Err("Settlement urbain invalide".into());
        }
        let culture = if config.culture == "site" {
            &site.culture
        } else {
            &config.culture
        };
        let morph = resolve(
            culture,
            &config.preset,
            &config.recipe,
            &config.zone,
            config.density,
            &config.params,
            "quarters",
        )?;
        let key_seed = format!("{seed}\u{1}settlement:{}", site.key);
        out.push(quarters::generate(
            &key_seed, site, config, &morph, surface, roads,
        )?);
    }
    Ok(out)
}
pub fn generate_parcels(
    seed: &str,
    layouts: &[Layout],
    config: &ParcelConfig,
) -> Result<Vec<Partition>, String> {
    let mut out = vec![];
    for layout in layouts {
        let culture = if config.culture == "site" {
            &layout.culture
        } else {
            &config.culture
        };
        let morph = resolve(
            culture,
            &config.preset,
            &config.recipe,
            &config.zone,
            config.density,
            &config.params,
            "parcels",
        )?;
        let key_seed = format!("{seed}\u{1}settlement:{}", layout.key);
        out.push(parcels::generate(&key_seed, layout, config, &morph)?);
    }
    Ok(out)
}
