//! Cultural settlement patterns retained by the temporary Urban Bench contract.
//! The exported ranges are artistic recipes, not measured reconstructions.
use super::{catalogue, composition};

#[derive(Clone, Copy, Debug)]
pub(super) struct UrbanProfile {
    pub pattern: &'static str,
    pub enclosure: &'static str,
    pub fortification: &'static str,
    pub gates: &'static str,
    pub orientation: &'static str,
    pub stairs: bool,
    pub waterfront: bool,
}

pub(super) fn profile(culture: &str) -> UrbanProfile {
    from_plan(&catalogue()["cultures"][culture]["plan"])
}
fn from_plan(p: &'static serde_json::Value) -> UrbanProfile {
    UrbanProfile {
        pattern: p["pattern"].as_str().unwrap_or("organic"),
        enclosure: p["enclosure"].as_str().unwrap_or("organic"),
        fortification: p["fortification"].as_str().unwrap_or("none"),
        gates: p["gates"].as_str().unwrap_or("roads"),
        orientation: p["orientation"].as_str().unwrap_or("road"),
        stairs: p["stairs"].as_bool().unwrap_or(false),
        waterfront: p["waterfront"].as_bool().unwrap_or(false),
    }
}

pub(super) fn settlement_profile(culture: &str, population: u32, phases: usize) -> UrbanProfile {
    let c = composition::culture_data(culture, population);
    let mut p = from_plan(&c["plan"]);
    if population >= 1200 && phases > 1 && c["ring"].is_object() {
        let enclosure = &c["ring"]["enclosure"];
        p.enclosure = enclosure["shape"].as_str().unwrap_or(p.enclosure);
        p.fortification = enclosure["wall"].as_str().unwrap_or(p.fortification);
        p.orientation = enclosure["orientation"].as_str().unwrap_or(p.orientation);
        p.gates = enclosure["gates"].as_str().unwrap_or("roads");
        let grown = !std::ptr::eq(c, &catalogue()["cultures"][culture]);
        let recipe = if grown { "grown-ring" } else { "ring" };
        let op =
            catalogue()["presets"][format!("{culture}/{recipe}")]["params"]["streetOp"].as_str();
        if p.pattern == "grid" && op == Some("organic") {
            p.pattern = "organic";
        }
    } else if population < 1200 {
        let form = &c[if population < 200 {
            "hamlet"
        } else {
            "village"
        }];
        let enclosure = &form["enclosure"];
        p.enclosure = enclosure["shape"].as_str().unwrap_or(p.enclosure);
        p.fortification = enclosure["wall"].as_str().unwrap_or(p.fortification);
        p.orientation = enclosure["orientation"].as_str().unwrap_or(p.orientation);
        p.pattern = match form["form"].as_str() {
            Some("ring") => "radial",
            Some("terraces") => "terraces",
            Some("grove") => "dispersed",
            _ => p.pattern,
        };
    }
    p
}
/// Pedestrian stairs serve urban land only where the culture builds them
/// (stair towns, terraces) and the user allows them; everywhere else land must
/// be reachable at street grade.
pub(super) fn stairs_allowed(cfg: &super::LayoutConfig, culture: &str) -> bool {
    let p = profile(culture);
    cfg.allow_stairs && (p.stairs || p.pattern == "terraces" || cfg.tissue == "terraces")
}
pub(super) fn fortification(profile: UrbanProfile, selected: &str, population: u32) -> &str {
    let selected = if selected == "culture" {
        profile.fortification
    } else {
        selected
    };
    if selected == "auto" {
        if population >= 1000 { "wall" } else { "none" }
    } else {
        selected
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn cultural_enclosures_and_terrain_are_not_lost_at_export() {
        let chinese = profile("chinese");
        assert_eq!((chinese.pattern, chinese.enclosure), ("grid", "square"));
        assert_eq!((chinese.fortification, chinese.gates), ("wall", "cardinal"));
        assert_eq!(profile("japanese-jokamachi").fortification, "none");
        let himalaya = profile("himalayan-terraces");
        assert_eq!(himalaya.orientation, "terrain");
        assert!(himalaya.stairs);
        assert!(profile("egyptian-planned").waterfront);
        assert_eq!(profile("mississippian").fortification, "palisade");
    }

    #[test]
    fn every_culture_has_replayable_native_recipes_and_a_profile() {
        let cat = catalogue();
        let cultures = cat["cultures"].as_object().unwrap();
        assert_eq!(cultures.len(), 79);
        for (id, c) in cultures {
            let p = profile(id);
            assert!(
                [
                    "organic",
                    "grid",
                    "terraces",
                    "linear",
                    "radial",
                    "dispersed"
                ]
                .contains(&p.pattern)
            );
            assert!(!c["plan"]["sources"].as_array().unwrap().is_empty());
            for r in c["recipes"].as_array().unwrap() {
                let preset = r["preset"].as_str().unwrap();
                assert!(cat["presets"][preset]["params"].is_object(), "{preset}");
                for stage in ["quarters", "parcels"] {
                    super::super::resolve(
                        id,
                        "culture",
                        r["id"].as_str().unwrap(),
                        r["zone"].as_str().unwrap(),
                        1.0,
                        &serde_json::json!({}),
                        stage,
                    )
                    .unwrap_or_else(|error| panic!("{preset}: {error}"));
                }
            }
        }
    }
}
