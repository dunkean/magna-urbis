//! Explicit urban-to-architecture correspondence. Values are artistic prototype
//! land families. Metric admission envelopes come from actual houses recipes;
//! the houses engine has final geometric and period admission.
use serde::{Deserialize, Serialize};
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
// Every UI culture has a deliberate entry. Fantasy borrowing is a declaration,
// The final column declares architectural layout independently of land family.
// Shared compound land can contain individual houses or native platforms.
// This is not a lexical guess and is rejected by strict mode in the programme stage.
const MAPPINGS: &[(&str, &str, &str, bool, &str, &str)] = &[
    (
        "european-organic",
        "frontage",
        "EUR-MED",
        false,
        "town",
        "frontage",
    ),
    ("bastide", "compact", "EUR-MED", false, "town", "compact"),
    ("medina", "courtyard", "AF-MAG", false, "town", "courtyard"),
    ("chinese", "courtyard", "AS-CHI", false, "town", "courtyard"),
    (
        "japanese-jokamachi",
        "compact",
        "AS-JAP",
        false,
        "town",
        "compact",
    ),
    (
        "indian-temple",
        "courtyard",
        "AS-IND",
        false,
        "institutional",
        "courtyard",
    ),
    (
        "roman-core",
        "courtyard",
        "MED-ANT",
        false,
        "town",
        "courtyard",
    ),
    (
        "elven",
        "inherited",
        "EUR-NOR",
        true,
        "communal",
        "inherited",
    ),
    ("dwarven", "compact", "EUR-EAST", true, "town", "compact"),
    (
        "necropolis",
        "compound",
        "AF-NILE",
        true,
        "institutional",
        "compound",
    ),
    (
        "russian-kremlin",
        "compound",
        "EUR-EAST",
        false,
        "town",
        "compound",
    ),
    ("aztec", "courtyard", "AM-MESO", false, "town", "courtyard"),
    ("inca", "compound", "AM-AND", false, "town", "compound"),
    (
        "byzantine-greek",
        "courtyard",
        "EUR-EAST",
        false,
        "town",
        "courtyard",
    ),
    (
        "venetian-lagoon",
        "frontage",
        "EUR-MED",
        false,
        "town",
        "frontage",
    ),
    (
        "persian",
        "courtyard",
        "AS-MIDE",
        false,
        "town",
        "courtyard",
    ),
    (
        "ottoman",
        "courtyard",
        "AS-MIDE",
        false,
        "town",
        "courtyard",
    ),
    ("sahel", "compound", "AF-SAHEL", false, "town", "common"),
    (
        "hanseatic",
        "frontage",
        "EUR-MED",
        false,
        "town",
        "frontage",
    ),
    ("korean", "courtyard", "AS-KOR", false, "town", "courtyard"),
    (
        "wizard-city",
        "compound",
        "EUR-MED",
        true,
        "institutional",
        "compound",
    ),
    ("gnomish", "compact", "EUR-MED", true, "town", "compact"),
    ("stilt-town", "compound", "AS-ISL", true, "town", "platform"),
    (
        "barbarian",
        "inherited",
        "ATL-CEL",
        true,
        "communal",
        "inherited",
    ),
    (
        "barbarian-celtic",
        "compound",
        "ATL-CEL",
        false,
        "communal",
        "compound",
    ),
    (
        "barbarian-norse",
        "inherited",
        "EUR-NOR",
        false,
        "communal",
        "inherited",
    ),
    (
        "norse-ringfort",
        "compound",
        "EUR-NOR",
        false,
        "communal",
        "compound",
    ),
    ("maya", "compound", "AM-MESO", false, "town", "compound"),
    ("khmer", "compound", "AS-SEA", false, "town", "compound"),
    (
        "celtic-oppidum",
        "inherited",
        "ATL-CEL",
        false,
        "communal",
        "inherited",
    ),
    (
        "orcish", "compound", "ATL-CEL", true, "communal", "compound",
    ),
    (
        "halfling",
        "inherited",
        "EUR-MED",
        true,
        "communal",
        "inherited",
    ),
    (
        "kraal", "compound", "AF-SOUTH", false, "communal", "compound",
    ),
    (
        "native-iroquoian",
        "compound",
        "AM-WOODS",
        false,
        "communal",
        "compound",
    ),
    (
        "native-pueblo",
        "compact",
        "AM-PUEB",
        false,
        "town",
        "compact",
    ),
    (
        "native-plains",
        "inherited",
        "AM-WOODS",
        false,
        "communal",
        "inherited",
    ),
    (
        "nomad-camp",
        "compound",
        "AS-STEP",
        true,
        "communal",
        "compound",
    ),
    (
        "swahili-stone-town",
        "courtyard",
        "AF-EAST",
        false,
        "town",
        "courtyard",
    ),
    (
        "drow-enclave",
        "courtyard",
        "AS-MIDE",
        true,
        "town",
        "courtyard",
    ),
    (
        "duergar-hold",
        "compact",
        "EUR-EAST",
        true,
        "town",
        "compact",
    ),
    (
        "myconid-colony",
        "compound",
        "AM-TROP",
        true,
        "communal",
        "compound",
    ),
    (
        "egyptian-planned",
        "compact",
        "AF-NILE",
        false,
        "town",
        "compact",
    ),
    (
        "nubian-fortified",
        "compound",
        "AF-NILE",
        false,
        "town",
        "compound",
    ),
    (
        "mesopotamian",
        "courtyard",
        "AS-MIDE",
        false,
        "town",
        "courtyard",
    ),
    (
        "levantine-tell",
        "courtyard",
        "AS-MIDE",
        false,
        "town",
        "courtyard",
    ),
    (
        "oasis-caravan",
        "courtyard",
        "AS-STEP",
        false,
        "town",
        "courtyard",
    ),
    (
        "ksar-oasis",
        "courtyard",
        "AF-MAG",
        false,
        "town",
        "courtyard",
    ),
    ("yoruba", "compound", "AF-WEST", false, "town", "compound"),
    (
        "himalayan-terraces",
        "compact",
        "AS-HIM",
        false,
        "town",
        "compact",
    ),
    ("newar", "courtyard", "AS-HIM", false, "town", "courtyard"),
    (
        "indus-planned",
        "compact",
        "AS-IND",
        false,
        "town",
        "compact",
    ),
    (
        "javanese-courts",
        "compound",
        "AS-ISL",
        false,
        "institutional",
        "compound",
    ),
    (
        "mississippian",
        "compound",
        "AM-MISS",
        false,
        "town",
        "compound",
    ),
];
// Tiny resolved-plan envelope table exported by the houses engine. No architectural
// generation logic, interiors, mesh dependency or full catalogue is embedded here.
#[derive(Deserialize)]
struct RecipeAdmission {
    #[serde(rename = "recipe_id")]
    id: String,
    #[serde(rename = "pack")]
    pack_id: String,
    layout: String,
    min_envelope_m: [f64; 2],
    min_access_width_m: f64,
    status: String,
    floors: [u32; 2],
    #[serde(default)]
    eras: Vec<String>,
}
#[derive(Deserialize)]
struct AdmissionCatalogue {
    profiles: Vec<RecipeAdmission>,
}
fn admission_catalogue() -> &'static AdmissionCatalogue {
    static PROFILES: OnceLock<AdmissionCatalogue> = OnceLock::new();
    PROFILES.get_or_init(|| {
        serde_json::from_str(include_str!("../../../houses/data/urban-admission.json"))
            .expect("versioned houses admission catalogue")
    })
}
fn recipe_profile(pack: &str, family: &str, period: &str) -> Option<&'static RecipeAdmission> {
    let profiles = admission_catalogue();
    let preference = |layout: &str| match family {
        "frontage" => {
            if layout == "strip" {
                0
            } else if layout == "single" {
                1
            } else {
                2
            }
        }
        "courtyard" => {
            if matches!(layout, "courtyard" | "siheyuan" | "atrium") {
                0
            } else if layout == "single" {
                1
            } else {
                2
            }
        }
        "platform" => {
            if layout == "platform" {
                0
            } else {
                2
            }
        }
        "compound" => {
            if matches!(layout, "hut_compound" | "kraal" | "kancha" | "multiyard") {
                0
            } else if layout == "single" {
                1
            } else {
                2
            }
        }
        _ => {
            if layout == "single" {
                0
            } else if layout == "strip" {
                1
            } else {
                2
            }
        }
    };
    profiles
        .profiles
        .iter()
        .filter(|r| {
            r.pack_id == pack
                && r.status == "supported"
                && (period.is_empty() || period == "any" || r.eras.iter().any(|era| era == period))
        })
        .min_by(|a, b| {
            (a.floors[0] > 2)
                .cmp(&(b.floors[0] > 2))
                .then(preference(&a.layout).cmp(&preference(&b.layout)))
                .then_with(|| {
                    (a.min_envelope_m[0] * a.min_envelope_m[1])
                        .total_cmp(&(b.min_envelope_m[0] * b.min_envelope_m[1]))
                })
                .then(a.id.cmp(&b.id))
        })
}
pub fn mapping(culture: &str) -> Option<CultureMapping> {
    mapping_for(culture, "any")
}
pub fn mapping_for(culture: &str, period: &str) -> Option<CultureMapping> {
    let &(id, family, pack, borrowed, functions, architecture_family) =
        MAPPINGS.iter().find(|m| m.0 == culture)?;
    let profile = recipe_profile(pack, architecture_family, period)?;
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
fn from_profile(
    id: &str,
    family: &str,
    pack: &str,
    borrowed: bool,
    functions: &str,
    architecture_family: &str,
    profile: &RecipeAdmission,
) -> CultureMapping {
    // Same 0.3 m clearance on both sides as houses placement.
    let (front, depth) = (
        profile.min_envelope_m[0] + 0.6,
        profile.min_envelope_m[1] + 0.6,
    );
    CultureMapping {
        culture: id.into(),
        family: family.into(),
        functional_profile: functions.into(),
        architecture_family: architecture_family.into(),
        architecture_pack: pack.into(),
        coverage: if borrowed {
            "declared-borrowing"
        } else {
            "shared-pack"
        }
        .into(),
        borrowing: if borrowed {
            format!("Explicit geometric adaptation from {pack}; no historical identity claimed")
        } else {
            String::new()
        },
        admissibility: UrbanAdmissibility {
            recipe_id: profile.id.clone(),
            native_layout: profile.layout.clone(),
            floors: profile.floors,
            eras: profile.eras.clone(),
            min_frontage: front,
            min_access_width: profile.min_access_width_m.max(0.8),
            min_area: front * depth,
            min_depth: depth,
            max_slope: 12.0_f64.to_radians().tan(),
            shared_access: matches!(family, "courtyard" | "compound"),
            party_walls: matches!(
                profile.layout.as_str(),
                "strip" | "courtyard" | "siheyuan" | "pueblo"
            ),
        },
    }
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
    let mut route = mapping_for(culture, period)?;
    let dense = matches!(zone, "core" | "middle");
    let small_front = matches!(plot_op, "burgage" | "compact" | "machiya" | "frontage");
    let recipe = match (culture, dense, small_front, function) {
        ("chinese", _, true, _) => Some("AS-CHI-B04"),
        ("medina", _, true, _) => Some("AF-MAG-B01"),
        ("ksar-oasis", _, true, _) => Some("AF-MAG-B05"),
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
        let p = admission_catalogue().profiles.iter().find(|p| {
            p.id == recipe
                && p.status == "supported"
                && (period.is_empty() || period == "any" || p.eras.iter().any(|e| e == period))
        })?;
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
pub(super) fn block_mapping(
    layout: &super::Layout,
    culture: &str,
    block: usize,
    function: &str,
    period: &str,
) -> Option<CultureMapping> {
    let (zone, morph) = block_morph(layout, culture, block)?;
    contextual_mapping(culture, period, zone, morph.text("plotOp"), function)
}
pub(super) fn block_morph<'a>(
    layout: &'a super::Layout,
    culture: &str,
    block: usize,
) -> Option<(&'a str, super::Morph)> {
    let b = layout.blocks.get(block)?;
    let phase = b
        .phase
        .or_else(|| layout.quarters.get(b.quarter).map(|q| q.phase))
        .and_then(|i| layout.phases.get(i));
    let recipe = phase.map_or("auto", |p| p.recipe.as_str());
    let cfg = layout.config.clone().unwrap_or_default();
    let zone = if cfg.zone == "auto" {
        &b.zone
    } else {
        &cfg.zone
    };
    let params = cfg
        .params
        .as_object()?
        .iter()
        .filter(|(key, _)| {
            super::catalogue()["fields"]["parcels"]
                .as_array()
                .is_some_and(|fields| {
                    fields
                        .iter()
                        .any(|field| field.as_str() == Some(key.as_str()))
                })
        })
        .map(|(key, value)| (key.clone(), value.clone()))
        .collect::<serde_json::Map<_, _>>();
    let morph = super::composition::phase_morph(
        culture,
        recipe,
        zone,
        &cfg.preset,
        &cfg.recipe,
        cfg.density,
        &serde_json::Value::Object(params),
        "parcels",
    )
    .ok()?;
    let tissue = layout
        .structure
        .as_ref()
        .and_then(|s| s.districts.iter().find(|d| d.quarters.contains(&b.quarter)))
        .map_or("culture", |d| d.tissue.as_str());
    let morph = super::with_tissue(morph, tissue);
    Some((&b.zone, morph))
}
/// Resolve the actual parcel-stage inputs, never an implicit density-one default.
pub(super) fn parcel_morph<'a>(
    layout: &'a super::Layout,
    partition: &'a super::Partition,
    culture: &str,
    block: usize,
) -> Option<(&'a str, super::Morph)> {
    let Some(cfg) = &partition.config else {
        return block_morph(layout, culture, block);
    };
    let b = layout.blocks.get(block)?;
    let phase = b
        .phase
        .or_else(|| layout.quarters.get(b.quarter).map(|q| q.phase))
        .and_then(|i| layout.phases.get(i));
    let zone = if cfg.zone == "auto" {
        b.zone.as_str()
    } else {
        cfg.zone.as_str()
    };
    let morph = super::composition::phase_morph(
        culture,
        phase.map_or("auto", |p| p.recipe.as_str()),
        zone,
        &cfg.preset,
        &cfg.recipe,
        cfg.density,
        &cfg.params,
        "parcels",
    )
    .ok()?;
    let tissue = layout
        .structure
        .as_ref()
        .and_then(|s| s.districts.iter().find(|d| d.quarters.contains(&b.quarter)))
        .map_or("culture", |d| d.tissue.as_str());
    Some((zone, super::with_tissue(morph, tissue)))
}
pub(super) fn parcel_mapping(
    layout: &super::Layout,
    p: &super::Parcel,
    culture: &str,
    function: &str,
) -> Option<CultureMapping> {
    let period = layout
        .programme
        .as_ref()
        .map_or("any", |p| p.context.period.as_str());
    if layout.programme.as_ref().is_some_and(|pr| {
        matches!(
            pr.context.role.as_str(),
            "isolated-farm" | "roadside-temple"
        )
    }) {
        return isolated_mapping(culture, period, &layout.programme.as_ref()?.context.role);
    }
    if p.family == "reserve" {
        return block_mapping(layout, culture, p.block, function, period);
    }
    // An explicitly forced court keeps its complete native court profile.
    if matches!(p.family.as_str(), "courtyard" | "compound") {
        return mapping_for(culture, period);
    }
    let zone = layout
        .blocks
        .get(p.block)
        .map_or("core", |b| b.zone.as_str());
    contextual_mapping(culture, period, zone, &p.family, function)
}
pub(super) fn isolated_mapping(culture: &str, period: &str, role: &str) -> Option<CultureMapping> {
    if role == "isolated-farm" {
        contextual_mapping(culture, period, "village", "frontage", "domestic")
    } else {
        mapping_for(culture, period)
    }
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

#[cfg(test)]
mod tests {
    use super::*;
    #[test]
    fn souk_cuts_use_a_real_small_house_and_explicit_courts_keep_their_profile() {
        let souk = contextual_mapping("medina", "M", "core", "burgage", "mixed").unwrap();
        assert_eq!(souk.family, "frontage");
        assert_eq!(souk.admissibility.recipe_id, "AF-MAG-B01");
        assert!(souk.admissibility.min_area < 60.0);
        // Native RF-FLAT slabs clip the roof to the true 5.0 x 7.65 m
        // domain; the shared 0.6 m clearance remains unchanged.
        assert!((souk.admissibility.min_frontage - 5.6).abs() < 1e-6);
        assert!((souk.admissibility.min_depth - 8.25).abs() < 1e-6);
        let court = contextual_mapping("medina", "M", "core", "courtyard", "domestic").unwrap();
        assert_eq!(court.admissibility.recipe_id, "AF-MAG-B02");
        assert!(court.admissibility.min_area > 900.0);
        let row = contextual_mapping("bastide", "M", "core", "burgage", "domestic").unwrap();
        assert_eq!(row.admissibility.recipe_id, "EUR-MED-B02");
        assert!(
            contextual_mapping("medina", "unsupported", "core", "burgage", "domestic").is_none()
        );
    }
    #[test]
    fn shared_land_does_not_nest_another_whole_compound() {
        let sahel = mapping("sahel").unwrap();
        assert_eq!(sahel.family, "compound");
        assert_eq!(sahel.architecture_family, "common");
        assert!(sahel.admissibility.min_frontage < 7.0);
        let stilt = mapping("stilt-town").unwrap();
        assert_eq!(stilt.architecture_family, "platform");
        let profile = recipe_profile(&stilt.architecture_pack, "platform", "any").unwrap();
        assert_eq!(profile.layout, "platform");
        assert!(stilt.admissibility.min_depth < 13.0);
    }
    #[test]
    fn period_selects_a_supported_source_before_cutting() {
        let ancient = mapping_for("persian", "A").unwrap();
        assert!(ancient.admissibility.eras.iter().any(|era| era == "A"));
        assert!(mapping_for("european-organic", "A").is_none());
        let medieval = mapping_for("persian", "M").unwrap();
        assert!(mapping_for("roman-core", "A").is_some());
        assert!(mapping_for("roman-core", "M").is_none());
        assert!(medieval.admissibility.eras.iter().any(|era| era == "M"));
        assert!(mapping_for("european-organic", "unsupported-era").is_none());
    }
    #[test]
    fn all_ui_cultures_have_an_explicit_mapping() {
        let cat = super::super::catalogue();
        assert_eq!(mappings().len(), cat["cultures"].as_object().unwrap().len());
        for id in cat["cultures"].as_object().unwrap().keys() {
            let route = mapping(id).expect("explicit UI route");
            let profile =
                recipe_profile(&route.architecture_pack, &route.architecture_family, "any")
                    .expect("supported native source");
            assert_eq!(profile.status, "supported", "{id}");
            assert_eq!(route.admissibility.recipe_id, profile.id, "{id}");
            assert_eq!(route.admissibility.native_layout, profile.layout, "{id}");
            assert!(
                route.admissibility.min_area.is_finite() && route.admissibility.min_area > 0.0,
                "{id}"
            );
        }
    }
}
