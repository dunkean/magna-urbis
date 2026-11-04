//! Enclosure of lots (town) and fields (countryside), per culture (`enclosures.json`).
//! `plotEnclosure` is the share of lots enclosed (0 all open, 1 all enclosed); lot fences are
//! traced on the parcel limits by the web renderer (`cityLotEnclosures.ts`) from the values
//! resolved here. `fieldEnclosure` is consumed by the land-use stage.
use super::ParcelConfig;
use serde::{Deserialize, Serialize};
use serde_json::Value;
use std::sync::OnceLock;

fn data() -> &'static Value {
    static DATA: OnceLock<Value> = OnceLock::new();
    DATA.get_or_init(|| serde_json::from_str(include_str!("enclosures.json")).expect("enclosure table"))
}

/// Resolved values of a culture, after the user's overrides.
#[derive(Clone, Debug, Default, PartialEq, Serialize, Deserialize)]
#[serde(default, rename_all = "camelCase")]
pub struct Resolved {
    pub plot: f64,
    pub field: f64,
    /// `wall|hedge|fence`.
    pub material: String,
    /// Boundary of the countryside fields (`hedge|wall|fence`); a forced `enclosureMaterial` wins.
    pub field_material: String,
    pub front: f64,
    pub side: f64,
    pub back: f64,
}

fn entry(culture: &str, key: &str) -> Option<&'static Value> {
    let d = data();
    d["cultures"].get(culture).and_then(|c| c.get(key)).or_else(|| {
        d["groups"].as_object()?.values()
            .find(|g| g["cultures"].as_array().is_some_and(|l| l.iter().any(|c| c == culture)))
            .and_then(|g| g.get(key))
    }).or_else(|| d["default"].get(key))
}
fn num(culture: &str, key: &str) -> f64 { entry(culture, key).and_then(Value::as_f64).unwrap_or(0.0) }

fn material_forced(cfg: &ParcelConfig) -> bool { ["wall", "hedge", "fence"].contains(&cfg.enclosure_material.as_str()) }
pub(super) fn resolve(culture: &str, cfg: &ParcelConfig) -> Resolved {
    let material = if material_forced(cfg) { cfg.enclosure_material.clone() }
        else { entry(culture, "material").and_then(Value::as_str).unwrap_or("fence").to_string() };
    Resolved {
        plot: cfg.plot_enclosure.unwrap_or_else(|| num(culture, "plot")).clamp(0.0, 1.0),
        // Field hedges are off unless the user asks for them (`fieldEnclosure`, `countrysideEnclosures`).
        field: cfg.field_enclosure.unwrap_or_else(|| if cfg.countryside_enclosures { num(culture, "field") } else { 0.0 }).clamp(0.0, 1.0),
        field_material: if material_forced(cfg) { cfg.enclosure_material.clone() } else { entry(culture, "fieldMaterial").and_then(Value::as_str).unwrap_or("hedge").to_string() },
        material, front: num(culture, "front"), side: num(culture, "side"), back: num(culture, "back"),
    }
}
pub(super) fn valid(cfg: &ParcelConfig) -> bool {
    [cfg.plot_enclosure, cfg.field_enclosure].iter().flatten().all(|v| v.is_finite() && (0.0..=1.0).contains(v))
        && ["", "auto", "wall", "hedge", "fence"].contains(&cfg.enclosure_material.as_str())
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn overrides_win_and_every_catalogue_culture_has_an_entry() {
        let mut cfg = ParcelConfig::default();
        cfg.plot_enclosure = Some(0.0);
        assert_eq!(resolve("chinese", &cfg).plot, 0.0);
        cfg.plot_enclosure = Some(1.0);
        let r = resolve("chinese", &cfg);
        assert_eq!((r.plot, r.material.as_str()), (1.0, "wall"));
        let catalogue: Value = serde_json::from_str(include_str!("catalogue.json")).unwrap();
        for c in catalogue["cultures"].as_object().unwrap().keys() {
            let listed = data()["groups"].as_object().unwrap().values()
                .any(|g| g["cultures"].as_array().unwrap().iter().any(|x| x == c.as_str()));
            assert!(listed, "culture {c} missing from enclosures.json");
        }
        cfg.enclosure_material = "bogus".into();
        assert!(!valid(&cfg));
    }
}
