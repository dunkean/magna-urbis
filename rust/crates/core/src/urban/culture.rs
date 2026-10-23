//! Explicit urban-to-architecture correspondence. Values are artistic prototype
//! land families. Metric admission envelopes come from actual houses recipes;
//! the houses engine has final geometric and period admission.
use serde::{Deserialize, Serialize};
use std::collections::HashMap;
use std::sync::{Mutex, OnceLock};

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
    // Cultures added for the medieval/fantasy world (docs/CITY_CULTURES.md).
    // Each reuses an existing native pack; none invents a house recipe.
    // "communal" = one household per lot (tents, igloos, family huts); "town" lets
    // lineage compounds, plank houses, warrens and the grown ordu hold several.
    (
        "al-andalus",
        "courtyard",
        "AF-MAG",
        false,
        "town",
        "courtyard",
    ),
    (
        "italian-comune",
        "frontage",
        "EUR-MED",
        false,
        "town",
        "frontage",
    ),
    (
        "flemish-cloth-town",
        "frontage",
        "EUR-MED",
        false,
        "town",
        "frontage",
    ),
    (
        "rynek-town",
        "frontage",
        "EUR-MED",
        false,
        "town",
        "frontage",
    ),
    (
        "slavic-gord",
        "compound",
        "EUR-EAST",
        false,
        "town",
        "compound",
    ),
    (
        "caucasian-highland",
        "compact",
        "EUR-EAST",
        false,
        "town",
        "compact",
    ),
    (
        "ethiopian-highland",
        "compound",
        "AF-EAST",
        false,
        "town",
        "common",
    ),
    (
        "great-zimbabwe",
        "compound",
        "AF-SOUTH",
        false,
        "town",
        "compound",
    ),
    (
        "hausa-kano",
        "courtyard",
        "AF-SAHEL",
        false,
        "town",
        "courtyard",
    ),
    (
        "hadhrami-tower",
        "compact",
        "AS-MIDE",
        false,
        "town",
        "compact",
    ),
    (
        "rajput-fort",
        "courtyard",
        "AS-IND",
        false,
        "town",
        "courtyard",
    ),
    (
        "dravidian-temple",
        "frontage",
        "AS-IND",
        false,
        "institutional",
        "frontage",
    ),
    ("bagan", "compound", "AS-SEA", false, "town", "platform"),
    (
        "vietnamese-citadel",
        "compound",
        "AS-SEA",
        false,
        "town",
        "compound",
    ),
    (
        "tibetan-monastery",
        "compound",
        "AS-HIM",
        false,
        "institutional",
        "compact",
    ),
    (
        "mongol-ordu",
        "compound",
        "AS-STEP",
        false,
        "town",
        "compound",
    ),
    (
        "maori-pa", "compound", "OC-PAC", false, "communal", "compound",
    ),
    (
        "pnw-plank-village",
        "inherited",
        "AM-PNW",
        false,
        "town",
        "inherited",
    ),
    (
        "inuit-camp",
        "compound",
        "AM-ARC",
        false,
        "communal",
        "compound",
    ),
    (
        "siberian-camp",
        "compound",
        "AS-SIB",
        false,
        "communal",
        "compound",
    ),
    (
        "guarani-village",
        "compound",
        "AM-SOUTH",
        false,
        "communal",
        "compound",
    ),
    (
        "budj-bim", "compound", "OC-AUS", false, "communal", "compound",
    ),
    (
        "lizardfolk-swamp",
        "compound",
        "AM-TROP",
        true,
        "communal",
        "platform",
    ),
    (
        "merfolk-tidal",
        "compound",
        "OC-PAC",
        true,
        "communal",
        "platform",
    ),
    (
        "giant-hold",
        "compound",
        "EUR-NOR",
        true,
        "communal",
        "compound",
    ),
    (
        "goblin-warren",
        "compound",
        "AS-SIB",
        true,
        "town",
        "compound",
    ),
];
/// Culture → native recipe to use as the default route when the land-family
/// heuristic of `recipe_profile` would pick a less specific house of the same pack
/// (smallest envelope first). Ignored when unsupported for the requested period.
const PREFERRED: &[(&str, &str)] = &[
    ("italian-comune", "EUR-MED-B09"),
    ("flemish-cloth-town", "EUR-MED-B11"),
    ("rynek-town", "EUR-MED-B03"),
    ("slavic-gord", "EUR-EAST-B01"),
    ("caucasian-highland", "EUR-EAST-B03"),
    ("hadhrami-tower", "AS-MIDE-B13"),
    ("dravidian-temple", "AS-IND-B01"),
    ("vietnamese-citadel", "AS-SEA-B04"),
    ("giant-hold", "EUR-NOR-B01"),
    ("goblin-warren", "AS-SIB-B08"),
    ("guarani-village", "AM-SOUTH-B03"),
    ("budj-bim", "OC-AUS-B03"),
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
    /// Tradition inside a shared pack (e.g. `javanese` in AS-ISL).
    #[serde(default)]
    tradition_id: Option<String>,
    /// Late or artistic source: admitted in inspired mode whatever the period.
    #[serde(default)]
    inspired_only: bool,
}
impl RecipeAdmission {
    fn in_period(&self, period: &str) -> bool {
        period.is_empty()
            || period == "any"
            || self.eras.iter().any(|era| era == period)
            || (self.inspired_only && self.eras.is_empty())
    }
}
#[derive(Deserialize)]
struct AdmissionCatalogue {
    profiles: Vec<RecipeAdmission>,
    functional_programmes: FunctionalAdmission,
    #[serde(default)]
    cultural_palettes: CulturalPalettes,
    #[serde(default)]
    functional_choices: FunctionalChoices,
}
/// Houses' `functional-choices-1` registry: exact (culture, pack, role,
/// function, composition, mode) rules that houses resolves itself.
#[derive(Deserialize, Default)]
struct FunctionalChoices {
    #[serde(default)]
    rules: Vec<FunctionalChoiceRule>,
}
#[derive(Deserialize)]
struct FunctionalChoiceRule {
    culture_id: String,
    pack_id: String,
    urban_role: String,
    function: String,
    composition: String,
    #[serde(default)]
    modes: Vec<String>,
    /// The simple native sources the rule may draw (style id, nominal ranges).
    #[serde(default)]
    sources: Vec<FunctionalChoiceSource>,
}
#[derive(Deserialize)]
struct FunctionalChoiceSource {
    style_id: String,
    #[serde(default)]
    nominal_width_m: Option<[f64; 2]>,
    #[serde(default)]
    nominal_depth_m: Option<[f64; 2]>,
}
/// The declared sources of the functional-choice rule houses resolves for
/// this programme: their style ids and the body-area range their nominal
/// dimensions span (smallest minimum to largest maximum, m²). `None` when no
/// rule applies or it declares no sized source.
pub(super) fn functional_choice_sources(
    culture: &str,
    pack: &str,
    role: &str,
    function: &str,
    composition: &str,
    mode: &str,
) -> Option<(Vec<&'static str>, [f64; 2])> {
    let rule = admission_catalogue()
        .functional_choices
        .rules
        .iter()
        .find(|r| {
            r.culture_id == culture
                && r.pack_id == pack
                && r.urban_role == role
                && r.function == function
                && r.composition == composition
                && r.modes.iter().any(|m| m == mode)
        })?;
    let mut range = [f64::INFINITY, 0.0_f64];
    for s in &rule.sources {
        if let (Some(w), Some(d)) = (s.nominal_width_m, s.nominal_depth_m) {
            range = [range[0].min(w[0] * d[0]), range[1].max(w[1] * d[1])];
        }
    }
    let styles = rule.sources.iter().map(|s| s.style_id.as_str()).collect();
    (range[0] <= range[1]).then_some((styles, range))
}
/// Whether houses resolves this role itself (any functional programme or
/// functional-choice rule of the pack): the city then pins no admission recipe.
pub(super) fn functional_role_resolved(
    culture: &str,
    pack: &str,
    role: &str,
    function: &str,
) -> bool {
    let catalogue = admission_catalogue();
    catalogue.functional_choices.rules.iter().any(|r| {
        r.culture_id == culture
            && r.pack_id == pack
            && r.urban_role == role
            && r.function == function
    }) || catalogue.functional_programmes.programmes.iter().any(|p| {
        p.pack_id == pack && p.function == function && p.urban_roles.iter().any(|r| r == role)
    })
}
/// True when houses chooses this programme from its own functional registry:
/// the city then emits no admission pin and no hard floors for it.
pub(super) fn functional_choice_registered(
    culture: &str,
    pack: &str,
    role: &str,
    function: &str,
    composition: &str,
    mode: &str,
) -> bool {
    admission_catalogue()
        .functional_choices
        .rules
        .iter()
        .any(|r| {
            r.culture_id == culture
                && r.pack_id == pack
                && r.urban_role == role
                && r.function == function
                && r.composition == composition
                && r.modes.iter().any(|m| m == mode)
        })
}
/// Houses' common palette registry: a culture mapped to one tradition of its
/// pack admits only that tradition's recipes (no silent neighbour tradition).
#[derive(Deserialize, Default)]
struct CulturalPalettes {
    #[serde(default)]
    mappings: Vec<PaletteMapping>,
}
#[derive(Deserialize)]
struct PaletteMapping {
    culture_id: String,
    pack_id: String,
    tradition_id: String,
}
/// The tradition a culture's admission is restricted to inside `pack`.
pub(super) fn palette_tradition(culture: &str, pack: &str) -> Option<&'static str> {
    admission_catalogue()
        .cultural_palettes
        .mappings
        .iter()
        .find(|m| m.culture_id == culture && m.pack_id == pack)
        .map(|m| m.tradition_id.as_str())
}
/// Tradition of a native recipe, from the same registry.
#[allow(dead_code)]
pub(super) fn recipe_tradition(recipe: &str) -> Option<&'static str> {
    admission_catalogue()
        .profiles
        .iter()
        .find(|p| p.id == recipe)
        .and_then(|p| p.tradition_id.as_deref())
}
#[derive(Deserialize)]
struct FunctionalAdmission {
    version: String,
    programmes: Vec<FunctionalProgrammeAdmission>,
}
/// Exact functional capabilities exported by the houses registry, not a second
/// architectural mapping inferred from city role names or parcel dimensions.
#[derive(Deserialize)]
pub(super) struct FunctionalProgrammeAdmission {
    pub recipe_id: String,
    pub composition: String,
    pack_id: String,
    function: String,
    urban_roles: Vec<String>,
    eras: Vec<String>,
    late_only: bool,
    modes: Vec<String>,
}
pub(super) fn functional_programme(
    pack: &str,
    role: &str,
    function: &str,
    period: &str,
    mode: &str,
) -> Option<&'static FunctionalProgrammeAdmission> {
    let registry = &admission_catalogue().functional_programmes;
    if registry.version != "functional-programmes-1" {
        return None;
    }
    registry.programmes.iter().find(|p| {
        p.pack_id == pack
            && p.function == function
            && p.urban_roles.iter().any(|r| r == role)
            && p.modes.iter().any(|m| m == mode)
            && !p.late_only
            && (period.is_empty() || period == "any" || p.eras.iter().any(|era| era == period))
    })
}
fn admission_catalogue() -> &'static AdmissionCatalogue {
    static PROFILES: OnceLock<AdmissionCatalogue> = OnceLock::new();
    PROFILES.get_or_init(|| {
        serde_json::from_str(include_str!("../../../houses/data/urban-admission.json"))
            .expect("versioned houses admission catalogue")
    })
}
#[cfg(test)]
fn recipe_profile(pack: &str, family: &str, period: &str) -> Option<&'static RecipeAdmission> {
    recipe_profile_in(pack, family, period, None)
}
fn recipe_profile_in(
    pack: &str,
    family: &str,
    period: &str,
    tradition: Option<&str>,
) -> Option<&'static RecipeAdmission> {
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
                && r.in_period(period)
                && (tradition.is_none() || r.tradition_id.as_deref() == tradition)
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
/// One named native recipe, when supported for the period.
fn supported_recipe(recipe: &str, period: &str) -> Option<&'static RecipeAdmission> {
    admission_catalogue()
        .profiles
        .iter()
        .find(|p| p.id == recipe && p.status == "supported" && p.in_period(period))
}
pub fn mapping(culture: &str) -> Option<CultureMapping> {
    mapping_for(culture, "any")
}
/// Memo for pure catalogue lookups: (culture, period[, zone, plot op, class]).
type MappingCache = Mutex<HashMap<[String; 5], Option<CultureMapping>>>;
fn memo(
    cache: &'static OnceLock<MappingCache>,
    key: [&str; 5],
    f: impl FnOnce() -> Option<CultureMapping>,
) -> Option<CultureMapping> {
    let cache = cache.get_or_init(Default::default);
    let key = key.map(str::to_string);
    if let Some(hit) = cache.lock().ok().and_then(|c| c.get(&key).cloned()) {
        return hit;
    }
    let value = f();
    if let Ok(mut c) = cache.lock() {
        c.insert(key, value.clone());
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
    let morph = capacity_tissue(layout, None, b, recipe, zone, morph);
    let tissue = layout
        .structure
        .as_ref()
        .and_then(|s| s.districts.iter().find(|d| d.quarters.contains(&b.quarter)))
        .map_or("culture", |d| d.tissue.as_str());
    let morph = super::with_tissue(morph, tissue);
    Some((&b.zone, morph))
}
/// The adaptive-capacity tissue of a block (`footprint::capacity`): densified,
/// and the donor's lot cutting in a borrowed quarter, as the cut used it.
fn capacity_tissue(
    layout: &super::Layout,
    parcels: Option<&super::ParcelConfig>,
    b: &super::Block,
    recipe: &str,
    zone: &str,
    morph: super::Morph,
) -> super::Morph {
    let capacity = super::footprint::capacity::of(layout)
        .filter(|_| parcels.is_none_or(super::footprint::capacity::parcels_enabled));
    let population = layout.programme.as_ref().map_or_else(
        || {
            layout
                .structure
                .as_ref()
                .map_or(0, |s| s.metrics.planned_population.round() as u32)
        },
        |p| p.population,
    );
    let density = parcels.map_or_else(
        || layout.config.as_ref().map_or(1.0, |c| c.density),
        |c| c.density,
    );
    super::footprint::capacity::adapt(
        morph,
        capacity,
        Some(b.quarter),
        recipe,
        zone,
        population,
        density,
        "parcels",
    )
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
    let recipe = phase.map_or("auto", |p| p.recipe.as_str());
    let morph = super::composition::phase_morph(
        culture,
        recipe,
        zone,
        &cfg.preset,
        &cfg.recipe,
        cfg.density,
        &cfg.params,
        "parcels",
    )
    .ok()?;
    let morph = capacity_tissue(layout, Some(cfg), b, recipe, zone, morph);
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
    if layout
        .programme
        .as_ref()
        .is_some_and(|pr| super::roles::is_isolated(&pr.context.role))
    {
        return isolated_mapping(culture, period, &layout.programme.as_ref()?.context.role);
    }
    if p.family == "reserve" {
        return block_mapping(layout, culture, p.block, function, period);
    }
    // An explicitly forced court keeps its complete native court profile.
    if matches!(p.family.as_str(), "courtyard" | "compound") {
        let mut m = mapping_for(culture, period)?;
        // Lots admitted only by the pack's compact house ask for that recipe,
        // also when the lot carries no stored witness (repaired or merged
        // lots): a main-street lot too small for the full court house gets
        // the small house instead of standing empty.
        if let Some(small) =
            super::parcels::compact_fallback(&m.architecture_pack, period, &m.admissibility)
        {
            let stored = |a: &UrbanAdmissibility| {
                p.envelope
                    .as_ref()
                    .is_some_and(|e| super::parcels::witnessed_by(e, a))
            };
            let full = &m.admissibility;
            let fits_full = stored(full)
                || super::parcels::parcel_envelope(
                    p,
                    full.min_frontage,
                    full.min_depth,
                    full.min_access_width,
                )
                .is_some();
            if stored(&small) || !fits_full {
                m.admissibility = small;
            }
        }
        return Some(m);
    }
    let zone = layout
        .blocks
        .get(p.block)
        .map_or("core", |b| b.zone.as_str());
    contextual_mapping(culture, period, zone, &p.family, function)
}
pub(super) fn isolated_mapping(culture: &str, period: &str, role: &str) -> Option<CultureMapping> {
    // An isolated dwelling (farm) uses the village frontage house profile.
    if super::roles::isolated(role).is_some_and(|r| r.function == "domestic") {
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
        // The lot minimum is the exported native envelope (houses owns its
        // numbers) plus the shared 0.6 m clearance.
        let native = supported_recipe("AF-MAG-B01", "M").expect("exported souk house");
        assert!((souk.admissibility.min_frontage - (native.min_envelope_m[0] + 0.6)).abs() < 1e-6);
        assert!((souk.admissibility.min_depth - (native.min_envelope_m[1] + 0.6)).abs() < 1e-6);
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
    fn registered_functional_choices_are_matched_exactly() {
        assert!(functional_choice_registered(
            "javanese-courts", "AS-ISL", "storage.granary", "warehouse", "hall", "historical_inspired"
        ));
        assert!(!functional_choice_registered(
            "javanese-courts", "AS-ISL", "storage.granary", "warehouse", "hall", "historical_strict"
        ));
        assert!(!functional_choice_registered(
            "javanese-courts", "AS-ISL", "worship.shrine", "collective", "religious", "historical_inspired"
        ));
    }
    #[test]
    fn a_palette_mapped_culture_admits_only_its_tradition() {
        let java = mapping("javanese-courts").unwrap();
        assert_eq!(java.architecture_pack, "AS-ISL");
        assert_eq!(palette_tradition("javanese-courts", "AS-ISL"), Some("javanese"));
        assert_eq!(recipe_tradition(&java.admissibility.recipe_id), Some("javanese"));
        // Same for the compact fallback and in a dated period.
        if let Some(small) = super::super::parcels::compact_fallback("AS-ISL", "M", &java.admissibility) {
            assert_eq!(recipe_tradition(&small.recipe_id), Some("javanese"));
        }
        let medieval = mapping_for("javanese-courts", "M").unwrap();
        assert_eq!(recipe_tradition(&medieval.admissibility.recipe_id), Some("javanese"));
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
            let preferred = PREFERRED.iter().find(|p| p.0 == id.as_str());
            let profile = match preferred {
                Some(&(_, recipe)) => supported_recipe(recipe, "any").expect("preferred recipe"),
                None => recipe_profile_in(
                    &route.architecture_pack,
                    &route.architecture_family,
                    "any",
                    palette_tradition(id, &route.architecture_pack),
                )
                .expect("supported native source"),
            };
            assert_eq!(profile.pack_id, route.architecture_pack, "{id}");
            assert_eq!(profile.status, "supported", "{id}");
            assert_eq!(route.admissibility.recipe_id, profile.id, "{id}");
            assert_eq!(route.admissibility.native_layout, profile.layout, "{id}");
            assert!(
                route.admissibility.min_area.is_finite() && route.admissibility.min_area > 0.0,
                "{id}"
            );
        }
    }
    /// Every catalogue culture, real or fantasy, plans a small town end to end on
    /// the same flat crossroads: quarters, lots, then building-site requests.
    #[test]
    fn every_catalogue_culture_generates_a_small_town() {
        use super::super::{LayoutConfig, ParcelConfig, Point, Site, Street, Surface};
        let n = 64;
        let height = vec![20.0; n * n];
        let water = vec![0; n * n];
        let level = vec![0.0; n * n];
        let surface = Surface {
            geometry: None,
            width: 1600.0,
            n,
            height: &height,
            water: &water,
        };
        let road = |a: (f64, f64), b: (f64, f64)| Street {
            path: vec![Point { x: a.0, y: a.1 }, Point { x: b.0, y: b.1 }],
            widths: vec![6.0, 6.0],
            rank: 1,
            role: "regional".into(),
        };
        let roads = [
            road((100.0, 800.0), (1500.0, 800.0)),
            road((800.0, 100.0), (800.0, 1500.0)),
        ];
        let cfg = LayoutConfig {
            footprint: super::super::legacy_footprint(),
            ..LayoutConfig::default()
        };
        let cat = super::super::catalogue();
        let mut failures = vec![];
        for (culture, data) in cat["cultures"].as_object().unwrap() {
            for r in data["recipes"].as_array().unwrap() {
                for stage in ["quarters", "parcels"] {
                    if let Err(error) = super::super::resolve(
                        culture,
                        "culture",
                        r["id"].as_str().unwrap(),
                        r["zone"].as_str().unwrap(),
                        1.0,
                        &serde_json::json!({}),
                        stage,
                    ) {
                        failures.push(format!("{culture}/{}: {error}", r["id"]));
                    }
                }
            }
            let site = Site {
                key: "town".into(),
                name: "Town".into(),
                population: 1500,
                culture: culture.clone(),
                center: Point { x: 800.0, y: 800.0 },
                radius: 320.0,
            };
            let seed = format!("culture-town-{culture}");
            let result = super::super::generate_quarters(&seed, &[site], &cfg, surface, &roads)
                .and_then(|layouts| {
                    let partitions =
                        super::super::generate_parcels(&seed, &layouts, &ParcelConfig::default())?;
                    let sites = super::super::building_sites::requests(
                        &seed,
                        &layouts,
                        &partitions,
                        surface,
                        &level,
                        None,
                    )?;
                    Ok((layouts, partitions, sites))
                });
            match result {
                Ok((layouts, partitions, sites)) => {
                    let blocks = layouts[0].blocks.len();
                    let lots = partitions[0].parcels.len();
                    if blocks == 0 || lots == 0 || sites.is_empty() {
                        failures.push(format!(
                            "{culture}: {blocks} blocks, {lots} lots, {} sites",
                            sites.len()
                        ));
                    }
                }
                Err(error) => failures.push(format!("{culture}: {error}")),
            }
        }
        assert!(failures.is_empty(), "{failures:#?}");
    }
}
