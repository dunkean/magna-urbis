//! Enclosure of lots (town) and fields (countryside), per culture (`enclosures.json`).
//! `plotEnclosure` is the share of lots enclosed (0 all open, 1 all enclosed); lot fences are
//! traced on the parcel limits by the web renderer (`cityLotEnclosures.ts`) from the values
//! resolved here. `fieldEnclosure` is consumed by the land-use stage.
//! An entry may carry a `village` object: its keys win for a settlement below
//! the town class (hamlet, village), so a culture can wall its town courts and
//! leave its villages' yards open (swept yards of the African roadside village).
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
    /// The culture draws no lot limits (catalogue `render.plotLines: false`: camps,
    /// myconid colonies...): the plan views leave the built lots unoutlined.
    #[serde(skip_serializing_if = "std::ops::Not::not")]
    pub hide_lot_lines: bool,
    /// Share of the country lots (village, hamlet zones) that keep a yard; the
    /// renderer's floor for those zones (0.95 by default).
    pub country: f64,
}

/// The culture's value, else its group's, else the default; at village scale
/// each level's `village` object is read first.
fn entry(culture: &str, village: bool, key: &str) -> Option<&'static Value> {
    let d = data();
    let group = d["groups"].as_object().and_then(|g| {
        g.values().find(|g| g["cultures"].as_array().is_some_and(|l| l.iter().any(|c| c == culture)))
    });
    let levels = [d["cultures"].get(culture), group, Some(&d["default"])];
    let scaled = levels.into_iter().flatten().filter(|_| village).find_map(|l| l.get("village").and_then(|v| v.get(key)));
    scaled.or_else(|| levels.into_iter().flatten().find_map(|l| l.get(key)))
}

fn material_forced(cfg: &ParcelConfig) -> bool { ["wall", "hedge", "fence"].contains(&cfg.enclosure_material.as_str()) }
/// `population`: the settlement's, when known (below the town class reads the `village` values).
pub(super) fn resolve(culture: &str, population: Option<u32>, cfg: &ParcelConfig) -> Resolved {
    let village = population.is_some_and(|p| crate::settlements::demographics::below(p, "town"));
    let entry = |key: &str| entry(culture, village, key);
    let num = |key: &str| entry(key).and_then(Value::as_f64).unwrap_or(0.0);
    let material = if material_forced(cfg) { cfg.enclosure_material.clone() }
        else { entry("material").and_then(Value::as_str).unwrap_or("fence").to_string() };
    Resolved {
        plot: cfg.plot_enclosure.unwrap_or_else(|| num("plot")).clamp(0.0, 1.0),
        // Field hedges are off unless the user asks for them (`fieldEnclosure`, `countrysideEnclosures`).
        field: cfg.field_enclosure.unwrap_or_else(|| if cfg.countryside_enclosures { num("field") } else { 0.0 }).clamp(0.0, 1.0),
        field_material: if material_forced(cfg) { cfg.enclosure_material.clone() } else { entry("fieldMaterial").and_then(Value::as_str).unwrap_or("hedge").to_string() },
        material, front: num("front"), side: num("side"), back: num("back"),
        // No lot limits drawn: the catalogue's `render.plotLines: false`, or the
        // table's `lotLines: false` (open yards of a village without fences).
        hide_lot_lines: super::catalogue()["cultures"][culture]["render"]["plotLines"].as_bool() == Some(false)
            || entry("lotLines").and_then(Value::as_bool) == Some(false),
        // A forced enclosure share holds for the country lots too.
        country: cfg.plot_enclosure.unwrap_or_else(|| entry("country").and_then(Value::as_f64).unwrap_or(0.95)).clamp(0.0, 1.0),
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
        assert_eq!(resolve("chinese", None, &cfg).plot, 0.0);
        cfg.plot_enclosure = Some(1.0);
        let r = resolve("chinese", None, &cfg);
        assert_eq!((r.plot, r.material.as_str()), (1.0, "wall"));
        let catalogue: Value = serde_json::from_str(include_str!("catalogue.json")).unwrap();
        for c in catalogue["cultures"].as_object().unwrap().keys() {
            let listed = data()["groups"].as_object().unwrap().values()
                .any(|g| g["cultures"].as_array().unwrap().iter().any(|x| x == c.as_str()));
            assert!(listed, "culture {c} missing from enclosures.json");
        }
        // Lot limits follow the catalogue's `render.plotLines`; a myconid colony has neither lot limits nor yards.
        let open = resolve("myconid-colony", None, &ParcelConfig::default());
        assert!(open.hide_lot_lines && open.plot == 0.0, "{open:?}");
        assert!(!resolve("european-organic", None, &ParcelConfig::default()).hide_lot_lines);
        // Village scale: the African roadside village keeps open swept yards, its town walled courts.
        let d = ParcelConfig::default();
        let (town, village) = (resolve("sub-saharan-african-metropolis", Some(20_000), &d), resolve("sub-saharan-african-metropolis", Some(400), &d));
        assert!(town.material == "wall" && town.plot > 0.9 && !town.hide_lot_lines, "{town:?}");
        assert!(village.material != "wall" && village.plot <= 0.25 && village.country <= 0.25 && village.hide_lot_lines, "{village:?}");
        assert_eq!(resolve("european-organic", Some(400), &d).country, 0.95);
        cfg.enclosure_material = "bogus".into();
        assert!(!valid(&cfg));
    }
}
