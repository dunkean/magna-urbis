//! Cultural settlement patterns retained by the temporary Urban Bench contract.
//! The exported ranges are artistic recipes, not measured reconstructions.
use super::catalogue;

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
    let p = &catalogue()["cultures"][culture]["plan"];
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
        assert_eq!(cultures.len(), 53);
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
