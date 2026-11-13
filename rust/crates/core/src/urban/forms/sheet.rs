//! The style sheet of a place (`LayoutConfig::style_sheet`), as each stage
//! reads its facet. Every draw comes from the seed and stable keys (lot id,
//! block, quarter, phase), so a place keeps its hybrid fabric from run to run.
//! A facet that names a culture the catalogue does not know is ignored.
use super::super::house_mix::HouseSettings;
use super::super::{Layout, LayoutConfig, StyleSheet};

fn sheet(layout: &Layout) -> Option<&StyleSheet> {
    layout.config.as_ref().map(|c| &c.style_sheet).filter(|s| !s.is_empty())
}

fn known(culture: &str) -> bool {
    super::super::catalogue()["cultures"][culture].is_object()
}

/// The culture whose homes a lot takes: the `rural` facet for a farm lot when
/// it chooses one, else the `houses` facet. None: the lot's own culture.
pub(in crate::urban) fn houses<'a>(layout: &'a Layout, seed: &str, lot: &str, block: usize, farm: bool) -> Option<&'a str> {
    let s = sheet(layout)?;
    let b = layout.blocks.get(block)?;
    let pick = |f: &'a HouseSettings| f.pick(seed, &layout.key, lot, block, b.quarter, &b.zone).filter(|c| known(c));
    farm.then(|| pick(&s.rural)).flatten().or_else(|| pick(&s.houses))
}

/// Culture and plan recipe a growth phase's lots are cut with under the
/// `plots` facet (one draw per phase). None: the phase's own.
pub(in crate::urban) fn plots(layout: &Layout, phase: usize) -> Option<(String, String)> {
    let s = sheet(layout)?;
    let p = layout.phases.get(phase)?;
    let culture = s.plots.pick(&layout.key, &layout.key, &format!("phase{phase}"), phase, phase, &p.zone).filter(|c| known(c))?;
    let own = if p.culture.is_empty() { layout.culture.as_str() } else { p.culture.as_str() };
    if culture == own {
        return None;
    }
    let population = layout.programme.as_ref().map_or_else(
        || layout.structure.as_ref().map_or(0, |s| s.metrics.planned_population.round() as u32),
        |p| p.population,
    );
    let name = match p.zone.as_str() {
        "village" | "core" | "faubourg" => p.zone.as_str(),
        _ => "ring",
    };
    Some((culture.to_owned(), super::super::composition::recipe(culture, population, name)))
}

/// The culture whose street grammar a growth zone takes under the `streets`
/// facet: the heaviest of the zone's mix (a street network has one grammar
/// per zone). None: the zone's own.
pub(in crate::urban) fn streets<'a>(cfg: &'a LayoutConfig, zone: &str) -> Option<&'a str> {
    cfg.style_sheet.streets.dominant(zone).filter(|c| known(c))
}

/// The cultures whose singular and utility buildings the place has, with
/// their shares (summing to 1), under the `monuments` facet. None: its own.
pub(in crate::urban) fn monuments(layout: &Layout) -> Option<Vec<(&str, f64)>> {
    // A culture without an architectural mapping cannot stand for a building's own.
    let shares: Vec<(&str, f64)> = sheet(layout)?
        .monuments
        .shares()
        .into_iter()
        .filter(|(c, _)| known(c) && super::super::culture::mapping(c).is_some())
        .collect();
    let total: f64 = shares.iter().map(|s| s.1).sum();
    (total > 0.0).then(|| shares.into_iter().map(|(c, w)| (c, w / total)).collect())
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn a_style_sheet_round_trips_and_an_empty_one_is_not_serialised() {
        let cfg: LayoutConfig = serde_json::from_value(serde_json::json!({
            "styleSheet": {"houses": {"city": {"styles": [{"culture": "chinese", "weight": 2}, {"culture": "medina", "weight": 1}], "spread": "block"}},
                "streets": {"zones": {"core": {"styles": [{"culture": "bastide", "weight": 1}]}}}}
        }))
        .unwrap();
        assert!(!cfg.style_sheet.is_empty());
        assert_eq!(streets(&cfg, "core"), Some("bastide"));
        assert_eq!(streets(&cfg, "middle"), None);
        let back = serde_json::to_value(&cfg).unwrap();
        assert_eq!(back["styleSheet"]["houses"]["city"]["styles"][0]["culture"], "chinese");
        assert!(back["styleSheet"].get("plots").is_none());
        let plain = serde_json::to_value(LayoutConfig::default()).unwrap();
        assert!(plain.get("styleSheet").is_none());
    }
}
