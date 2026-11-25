//! Explicit urban-to-architecture correspondence. Values are artistic prototype
//! land families. Metric admission envelopes come from actual houses recipes;
//! the houses engine has final geometric and period admission.
use serde::{Deserialize, Serialize};
use std::collections::HashMap;
use std::sync::OnceLock;

#[derive(Clone, Debug, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct UrbanAdmissibility {
    pub recipe_id: String,
    #[serde(default)]
    pub native_layout: String,
    #[serde(default = "one_floor")]
    pub floors: [u32; 2],
    #[serde(default)]
    pub eras: Vec<String>,
    pub min_frontage: f64,
    pub min_access_width: f64,
    pub min_area: f64,
    pub min_depth: f64,
    pub max_slope: f64,
    pub shared_access: bool,
    pub party_walls: bool,
}
#[derive(Clone, Debug, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct CultureMapping {
    pub culture: String,
    pub family: String,
    pub functional_profile: String,
    #[serde(default)]
    pub architecture_family: String,
    pub architecture_pack: String,
    pub coverage: String,
    pub borrowing: String,
    pub admissibility: UrbanAdmissibility,
}
fn one_floor() -> [u32; 2] {
    [1, 1]
}
pub(super) fn architecture_pack(culture:&str) -> Option<&'static str> {
    MAPPINGS.iter().find(|m|m.0==culture).map(|m|m.2)
}

mod registry;
use registry::{MAPPINGS, PREFERRED};
mod admission;
use admission::{from_profile, recipe_profile_in, supported_recipe};
pub(super) use admission::{functional_choice_registered, functional_choice_sources, functional_mapping, functional_programme, functional_role_resolved, functional_source_gap, houses_mode, palette_tradition, recipe_tradition, requires_functional_source};
#[cfg(test)]
use admission::{AdmissionCatalogue, functional_source_coverage, functional_source_gap_in, recipe_profile};
mod tissue;
pub(super) use tissue::{block_mapping, block_morph, isolated_mapping, lot_morph, parcel_mapping, parcel_morph};
#[cfg(test)]
mod tests;

/// Metric house scale and exterior form, independent of the borrowed recipe.
pub(super) fn house_parameters(culture: &str) -> (f64, &'static str) {
    super::forms::kit::house_parameters(culture)
}
pub fn mapping(culture: &str) -> Option<CultureMapping> {
    mapping_for(culture, "any")
}
/// Memo for pure catalogue lookups: (culture, period[, zone, plot op, class]).
type MappingCache = std::sync::RwLock<HashMap<String, Option<CultureMapping>>>;
fn memo(
    cache: &'static OnceLock<MappingCache>,
    key: [&str; 5],
    f: impl FnOnce() -> Option<CultureMapping>,
) -> Option<CultureMapping> {
    thread_local! {
        static KEY: std::cell::RefCell<String> = const { std::cell::RefCell::new(String::new()) };
    }
    let cache = cache.get_or_init(Default::default);
    // One reusable joined key per thread: a hit allocates only the clone.
    let hit = KEY.with(|k| {
        let mut k = k.borrow_mut();
        k.clear();
        for part in key {
            k.push_str(part);
            k.push('\u{1f}');
        }
        cache.read().ok().and_then(|c| c.get(k.as_str()).cloned())
    });
    if let Some(hit) = hit {
        return hit;
    }
    let value = f();
    let mut joined = String::new();
    for part in key {
        joined.push_str(part);
        joined.push('\u{1f}');
    }
    if let Ok(mut c) = cache.write() {
        c.insert(joined, value.clone());
    }
    value
}
pub fn mapping_for(culture: &str, period: &str) -> Option<CultureMapping> {
    static CACHE: OnceLock<MappingCache> = OnceLock::new();
    memo(&CACHE, [culture, period, "", "", ""], || {
        mapping_for_uncached(culture, period)
    })
}
fn mapping_for_uncached(culture: &str, period: &str) -> Option<CultureMapping> {
    let &(id, family, pack, borrowed, functions, architecture_family) =
        MAPPINGS.iter().find(|m| m.0 == culture)?;
    let preferred = PREFERRED
        .iter()
        .find(|p| p.0 == culture)
        .and_then(|&(_, recipe)| supported_recipe(recipe, period))
        .filter(|p| p.pack_id == pack);
    let tradition = palette_tradition(culture, pack);
    let preferred = preferred.filter(|p| tradition.is_none() || p.tradition_id.as_deref() == tradition);
    let profile =
        preferred.or_else(|| recipe_profile_in(pack, architecture_family, period, tradition))?;
    Some(from_profile(
        id,
        family,
        pack,
        borrowed,
        functions,
        architecture_family,
        profile,
    ))
}
/// The land family is a cultural default, not a requirement to repeat a whole
/// monumental court in every shop lot. These are existing native catalogue types.
/// Selection precedes cadastral cuts and is reused during allocation/placement.
pub(super) fn contextual_mapping(
    culture: &str,
    period: &str,
    zone: &str,
    plot_op: &str,
    function: &str,
) -> Option<CultureMapping> {
    static CACHE: OnceLock<MappingCache> = OnceLock::new();
    // Only the mixed/domestic distinction changes the route.
    let class = match function {
        "mixed" | "domestic" => function,
        _ => "other",
    };
    memo(&CACHE, [culture, period, zone, plot_op, class], || {
        contextual_uncached(culture, period, zone, plot_op, function)
    })
}
fn contextual_uncached(
    culture: &str,
    period: &str,
    zone: &str,
    plot_op: &str,
    function: &str,
) -> Option<CultureMapping> {
    let mut route = mapping_for(culture, period)?;
    let dense = matches!(zone, "core" | "middle");
    let small_front = matches!(plot_op, "burgage" | "compact" | "machiya" | "frontage");
    let recipe = match (culture, dense, small_front, function) {
        ("chinese", _, true, _) => Some("AS-CHI-B04"),
        ("medina" | "al-andalus", _, true, _) => Some("AF-MAG-B01"),
        ("ksar-oasis", _, true, _) => Some("AF-MAG-B05"),
        ("hausa-kano", _, true, _) => Some("AF-SAHEL-B04"),
        ("rajput-fort", _, true, _) => Some("AS-IND-B01"),
        ("vietnamese-citadel", _, true, _) => Some("AS-SEA-B02"),
        // Dense comune: portico shops where the lot holds them, narrow row houses
        // otherwise (the lots are cut for the row house, not the 7 m portico).
        ("italian-comune", true, true, "mixed") => Some("EUR-MED-B09"),
        ("italian-comune", true, true, _) => Some("EUR-MED-B02"),
        ("flemish-cloth-town", true, true, "mixed") => Some("EUR-MED-B05"),
        ("flemish-cloth-town", true, true, _) => Some("EUR-MED-B11"),
        ("rynek-town", true, true, _) => Some("EUR-MED-B03"),
        // Borghi outside the walls: stone village houses, not the portico row.
        ("italian-comune", false, true, _) if zone != "village" => Some("EUR-MED-B04"),
        ("italian-comune" | "flemish-cloth-town" | "rynek-town", false, true, "domestic")
            if zone == "village" =>
        {
            Some("EUR-MED-B04")
        }
        ("european-organic" | "bastide" | "hanseatic" | "venetian-lagoon", true, true, "mixed") => {
            Some("EUR-MED-B05")
        }
        ("european-organic" | "bastide" | "hanseatic" | "venetian-lagoon", true, true, _) => {
            Some("EUR-MED-B02")
        }
        (
            "european-organic" | "bastide" | "hanseatic" | "venetian-lagoon",
            false,
            true,
            "domestic",
        ) if zone == "village" => Some("EUR-MED-B04"),
        _ => None,
    };
    if let Some(recipe) = recipe {
        let p = supported_recipe(recipe, period)?;
        route = from_profile(
            culture,
            if culture == "bastide" {
                "compact"
            } else {
                "frontage"
            },
            &route.architecture_pack,
            !route.borrowing.is_empty(),
            &route.functional_profile,
            "frontage",
            p,
        );
    }
    Some(route)
}
pub fn mappings() -> Vec<CultureMapping> {
    MAPPINGS.iter().filter_map(|m| mapping(m.0)).collect()
}
/// The applied contextual profile is the source used for cadastral cuts.
pub fn admissibility_for(layout: &super::Layout, culture: &str) -> Option<UrbanAdmissibility> {
    let period = layout
        .programme
        .as_ref()
        .map_or("any", |p| p.context.period.as_str());
    mapping_for(culture, period).map(|c| c.admissibility)
}
pub fn admissibility(culture: &str) -> UrbanAdmissibility {
    mapping(culture)
        .expect("validated UI culture")
        .admissibility
}
