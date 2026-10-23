//! Explicit city-to-tradition selection within broad architecture packs.
//! The exported registry is shared with urban admission; recipe membership
//! stays in the catalogue rather than a second list of recipe identifiers.
use crate::model::HouseConfig;
use crate::placement::ArchitectureCulture;
use serde::Serialize;

pub const CULTURAL_PALETTE_VERSION: &str = "cultural-palettes-1";

#[derive(Debug, Serialize)]
pub struct CulturalPalette {
    pub culture_id: &'static str,
    pub pack_id: &'static str,
    pub tradition_id: &'static str,
}

const PALETTES: &[CulturalPalette] = &[CulturalPalette {
    culture_id: "javanese-courts",
    pack_id: "AS-ISL",
    tradition_id: "javanese",
}];

pub fn registry() -> &'static [CulturalPalette] {
    PALETTES
}

/// Restrict only automatic choices made for a declared city culture. Explicit
/// recipes, variants, workshop templates and cultural borrowing retain their
/// own selection. This is a source filter, never permission to bypass period,
/// historical mode, native geometry or terrain constraints.
pub fn automatic_tradition(
    culture: &ArchitectureCulture,
    config: &HouseConfig,
    exact: bool,
) -> Option<&'static str> {
    if exact
        || config.recipe.is_some()
        || config.workshop.is_some()
        || config.overrides.variant.is_some()
        || culture.borrowing.as_deref().is_some_and(|v| !v.trim().is_empty())
        || config.pack != culture.pack
    {
        return None;
    }
    registry()
        .iter()
        .find(|p| p.culture_id == culture.culture && p.pack_id == culture.pack)
        .map(|p| p.tradition_id)
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::model::HistoricalMode;
    use crate::style_index::{StyleQuery, style_index};

    #[test]
    fn declared_palette_uses_catalogue_traditions_and_respects_explicit_choices() {
        let mut culture = ArchitectureCulture {
            culture: "javanese-courts".into(), pack: "AS-ISL".into(),
            mode: HistoricalMode::HistoricalInspired, borrowing: None,
        };
        let mut config = HouseConfig { pack: culture.pack.clone(), ..Default::default() };
        assert_eq!(automatic_tradition(&culture, &config, false), Some("javanese"));
        assert_eq!(automatic_tradition(&culture, &config, true), None);
        config.recipe = Some("AS-ISL-B05".into());
        assert_eq!(automatic_tradition(&culture, &config, false), None);
        config.recipe = None;
        config.overrides.variant = Some("default".into());
        assert_eq!(automatic_tradition(&culture, &config, false), None);
        config.overrides.variant = None;
        culture.borrowing = Some("explicit source choice".into());
        assert_eq!(automatic_tradition(&culture, &config, false), None);
        culture.borrowing = None;
        culture.culture = "stilt-town".into();
        assert_eq!(automatic_tradition(&culture, &config, false), None);

        let index = style_index().unwrap();
        for palette in registry() {
            let entries: Vec<_> = index.entries.iter().filter(|e|
                e.pack_id == palette.pack_id && e.tradition_id == Some(palette.tradition_id)
            ).collect();
            assert!(!entries.is_empty(), "Declared tradition must have native catalogue entries");
            assert!(entries.iter().all(|e| e.capabilities.native_plan));
            // Query serialization is also the cache identity: a restricted
            // city palette must never reuse the broad pack's cached results.
            let query = StyleQuery {
                pack_id: Some(palette.pack_id.into()),
                tradition_id: Some(palette.tradition_id.into()), ..Default::default()
            };
            assert_ne!(serde_json::to_string(&query).unwrap(), serde_json::to_string(&StyleQuery {
                tradition_id: None, ..query
            }).unwrap());
        }
    }
}
