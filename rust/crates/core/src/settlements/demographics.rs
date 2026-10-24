//! Canonical demographic bands shared with TypeScript. Native morphological
//! kinds and cultural growth thresholds deliberately retain their own meaning.
use serde::Deserialize;
use std::{collections::BTreeMap, sync::OnceLock};
#[derive(Deserialize)]
struct Catalogue { classes: BTreeMap<String, Class> }
#[derive(Deserialize)]
struct Class { minimum: u32, shortcut: u32 }
fn catalogue() -> &'static Catalogue {
    static DATA: OnceLock<Catalogue> = OnceLock::new();
    DATA.get_or_init(|| {
        let data: Catalogue = serde_json::from_str(include_str!("demographic_classes.json"))
            .expect("demographic classes catalogue");
        // Shortcuts are population examples, not floors. Validate the shared
        // table once at load, including in non-test native builds.
        for (id, class) in &data.classes {
            assert!(class.shortcut >= class.minimum
                && data.classes.values().all(|other| {
                    other.minimum <= class.minimum || class.shortcut < other.minimum
                }), "demographic shortcut outside its class: {id}");
        }
        data
    })
}
pub fn class_of(population: u32) -> &'static str {
    catalogue().classes.iter().filter(|(_, c)| population >= c.minimum)
        .max_by_key(|(_, c)| c.minimum).map(|(id, _)| id.as_str()).expect("zero demographic floor")
}
#[cfg(test)]
mod tests {
    use super::*;
    #[test]
    fn demographic_classes_have_unique_floors_and_shortcuts_inside_their_band() {
        let c = catalogue();
        assert_eq!(c.classes.len(), 7);
        assert_eq!(c.classes.values().filter(|v| v.minimum == 0).count(), 1);
        let floors: std::collections::BTreeSet<_> = c.classes.values().map(|v| v.minimum).collect();
        assert_eq!(floors.len(), c.classes.len());
        for (id, value) in &c.classes {
            assert_eq!(class_of(value.minimum), id);
            assert_eq!(class_of(value.shortcut), id);
            if value.minimum > 0 { assert_ne!(class_of(value.minimum - 1), id); }
        }
    }
    #[test]
    fn demographic_classes_preserve_every_legacy_boundary() {
        for (population, id) in [(0,"farmstead"),(12,"farmstead"),(13,"farmstead"),(14,"farmstead"),(15,"hamlet"),(149,"hamlet"),(150,"village"),(999,"village"),(1000,"town"),(19999,"town"),(20000,"city"),(99999,"city"),(100000,"metropolis"),(199999,"metropolis"),(200000,"metropolis"),(999999,"metropolis"),(1000000,"megacity"),(u32::MAX,"megacity")] {
            assert_eq!(class_of(population), id, "{population}");
        }
    }
}
