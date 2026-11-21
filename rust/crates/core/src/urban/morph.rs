//! Morphology resolution: the versioned urban catalogue (`catalogue.json`),
//! a culture's preset resolved with the density transform and the user's
//! parameter overrides (`resolve`), the street tissue applied on top of it
//! (`with_tissue`), and the catalogue's site preferences of the cultures.
use crate::rng::Rng;
use serde_json::{Value, json};
use std::sync::OnceLock;

#[derive(Clone)]
pub(crate) struct Morph {
    pub value: Value,
}
/// Tissue is independent from footprint and cultural defaults. Access recipes stay cultural.
pub(crate) fn with_tissue(mut morph: Morph, tissue: &str) -> Morph {
    match tissue {
        "grid" => {
            morph.value["streetOp"] = json!("grid");
            morph.value["fieldNoise"] = json!(0.0);
        }
        "organic" => {
            morph.value["streetOp"] = json!("organic");
            morph.value["fieldRandom"] = json!(0.6);
        }
        "radial" => {
            morph.value["streetOp"] = json!("organic");
            morph.value["fieldRandom"] = json!(0.0);
        }
        "terraces" => {
            morph.value["streetOp"] = json!("organic");
            morph.value["contourFollow"] = json!(1.0);
        }
        "dendritic" => {
            morph.value["streetOp"] = json!("organic");
            morph.value["closeOp"] = json!("derbs");
            morph.value["deadEndRatio"] = json!(0.8);
        }
        "clusters" => {
            morph.value["streetOp"] = json!("organic");
            morph.value["closeOp"] = json!("closes");
        }
        _ => {}
    }
    morph
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
    /// Block size range of a zone. A village's blocks are the land between
    /// its few roads: house plots on the street, gardens and fields behind,
    /// never the lane mesh of a town (2.5× the tissue's catalogue range).
    pub fn block_size(&self, zone: &str) -> [f64; 2] {
        let [lo, hi] = self.range("blockSize", zone);
        if zone == "village" { [lo * 2.5, hi * 2.5] } else { [lo, hi] }
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
/// Culture preference for a settlement site archetype (catalogue
/// `cultures.<id>.sitePrefs`, 1 = neutral): marsh folk seek lakes, tide folk
/// the shore. Read by the placement stage on top of the user's preferences.
pub fn culture_site_weight(culture: &str, site: &str) -> f64 {
    catalogue()["cultures"][culture]["sitePrefs"][site]
        .as_f64()
        .unwrap_or(1.0)
}
/// Culture site preference by key with an explicit default (e.g. `mountainFace`, 0 = none).
pub fn culture_site_pref(culture: &str, key: &str, default: f64) -> f64 {
    catalogue()["cultures"][culture]["sitePrefs"][key]
        .as_f64()
        .unwrap_or(default)
}
pub(super) fn catalogue() -> &'static Value {
    static CATALOGUE: OnceLock<Value> = OnceLock::new();
    CATALOGUE.get_or_init(|| {
        serde_json::from_str(include_str!("catalogue.json")).expect("versioned urban catalogue")
    })
}
pub(super) fn resolve(
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
        format!(
            "{culture}/{}",
            if recipe == "auto" { "core" } else { recipe }
        )
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
                "lotMergeChance",
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
