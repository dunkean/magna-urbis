//! Admission data and functional sources from the houses catalogue.

use super::*;

// Tiny resolved-plan envelope table exported by the houses engine. No architectural
// generation logic, interiors, mesh dependency or full catalogue is embedded here.
#[derive(Deserialize)]
pub(super) struct RecipeAdmission {
    #[serde(rename = "recipe_id")]
    pub(super) id: String,
    #[serde(rename = "pack")]
    pub(super) pack_id: String,
    pub(super) layout: String,
    pub(super) min_envelope_m: [f64; 2],
    pub(super) min_access_width_m: f64,
    pub(super) status: String,
    pub(super) floors: [u32; 2],
    #[serde(default)]
    pub(super) eras: Vec<String>,
    /// Tradition inside a shared pack (e.g. `javanese` in AS-ISL).
    #[serde(default)]
    pub(super) tradition_id: Option<String>,
    /// Late or artistic source: admitted in inspired mode whatever the period.
    #[serde(default)]
    pub(super) inspired_only: bool,
}
impl RecipeAdmission {
    pub(super) fn in_period(&self, period: &str) -> bool {
        period.is_empty()
            || period == "any"
            || self.eras.iter().any(|era| era == period)
            || (self.inspired_only && self.eras.is_empty())
    }
}
#[derive(Deserialize)]
pub(super) struct AdmissionCatalogue {
    pub(super) profiles: Vec<RecipeAdmission>,
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
    recipe_id: Option<String>,
    #[serde(default)]
    inspired_only: bool,
    #[serde(default)]
    temporal: Option<FunctionalSourceTemporal>,
    #[serde(default)]
    nominal_width_m: Option<[f64; 2]>,
    #[serde(default)]
    nominal_depth_m: Option<[f64; 2]>,
}
#[derive(Deserialize)]
struct FunctionalSourceTemporal {
    #[serde(default)]
    eras: Vec<String>,
    #[serde(default)]
    late_only: bool,
}
/// The declared sources of the functional-choice rule houses resolves for
/// this programme: their style ids and the body-area range their nominal
/// dimensions span (smallest minimum to largest maximum, m²). `None` when no
/// rule applies or it declares no sized source.
pub(in super::super) fn functional_choice_sources(
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
/// Versioned requirements identify roles for which a residential admission
/// fallback cannot prove functional construction. Availability is always queried
/// from Houses' exported registries; adding a real source clears the gap here
/// for both reservation and site production, without another role hardcode.
#[derive(Deserialize)]
pub(super) struct FunctionalSourceCoverage {
    version: String,
    requirements: Vec<FunctionalSourceRequirement>,
}
#[derive(Deserialize)]
pub(in super::super) struct FunctionalSourceRequirement {
    pub id: String,
    culture_id: String,
    pack_id: String,
    urban_role: String,
    function: String,
    composition: String,
    pub reason: String,
}
pub(super) fn functional_source_coverage() -> &'static FunctionalSourceCoverage {
    static COVERAGE: OnceLock<FunctionalSourceCoverage> = OnceLock::new();
    COVERAGE.get_or_init(|| {
        let coverage:FunctionalSourceCoverage=serde_json::from_str(include_str!("../functional-source-coverage.json"))
            .expect("versioned functional source requirements");
        assert_eq!(coverage.version,"functional-source-coverage-1");
        coverage
    })
}
pub(in super::super) fn requires_functional_source(role:&str,function:&str)->bool {
    functional_source_coverage().requirements.iter().any(|r|r.urban_role==role && r.function==function)
}
pub(in super::super) fn functional_source_gap(
    culture: &str, pack: &str, role: &str, function: &str, period: &str, mode: &str,
) -> Option<&'static FunctionalSourceRequirement> {
    functional_source_gap_in(functional_source_coverage(), admission_catalogue(),
        culture, pack, role, function, period, mode)
}
/// The exact same decision runs on the exported production registry and on an
/// injected test registry. The latter never registers or constructs a building.
pub(super) fn functional_source_gap_in<'a>(
    coverage: &'a FunctionalSourceCoverage, catalogue: &AdmissionCatalogue,
    culture: &str, pack: &str, role: &str, function: &str, period: &str, mode: &str,
) -> Option<&'a FunctionalSourceRequirement> {
    let requirement = coverage.requirements.iter().find(|r|
        r.culture_id == culture && r.pack_id == pack && r.urban_role == role && r.function == function)?;
    let in_era = |eras: &[String]| period.is_empty() || period == "any" || eras.iter().any(|era| era == period);
    // The legacy minimum table contains residential default witnesses only.
    // Neither its absence nor a refused/differently dated default can decide
    // coverage of a separately declared functional source/variant.
    let programme = catalogue.functional_programmes.version == "functional-programmes-1"
        && catalogue.functional_programmes.programmes.iter().any(|p|
            p.pack_id == pack && p.function == function && p.composition == requirement.composition
                && p.urban_roles.iter().any(|r| r == role) && p.modes.iter().any(|m| m == mode)
                && !p.late_only && in_era(&p.eras) && !p.recipe_id.trim().is_empty());
    let valid_range = |range: Option<[f64; 2]>| range.is_some_and(|r|
        r[0].is_finite() && r[1].is_finite() && r[0] > 0.0 && r[1] >= r[0]);
    let choice = catalogue.functional_choices.rules.iter().any(|r|
        r.culture_id == culture && r.pack_id == pack && r.urban_role == role && r.function == function
            && r.composition == requirement.composition && r.modes.iter().any(|m| m == mode)
            && r.sources.iter().any(|source|
                source.recipe_id.as_deref().is_some_and(|recipe|
                    !recipe.trim().is_empty() && source.style_id.strip_prefix(recipe).is_some_and(|suffix|suffix.starts_with("::")))
                    && !(mode == "historical_strict" && source.inspired_only)
                    && valid_range(source.nominal_width_m) && valid_range(source.nominal_depth_m)
                    && source.temporal.as_ref().is_some_and(|t| !t.late_only
                        && (in_era(&t.eras) || (source.inspired_only && t.eras.is_empty() && mode!="historical_strict")))));
    (!programme && !choice).then_some(requirement)
}

/// Whether houses resolves this role itself (any functional programme or
/// functional-choice rule of the pack): the city then pins no admission recipe.
pub(in super::super) fn functional_role_resolved(
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
pub(in super::super) fn functional_choice_registered(
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
pub(in super::super) fn palette_tradition(culture: &str, pack: &str) -> Option<&'static str> {
    admission_catalogue()
        .cultural_palettes
        .mappings
        .iter()
        .find(|m| m.culture_id == culture && m.pack_id == pack)
        .map(|m| m.tradition_id.as_str())
}
/// Tradition of a native recipe, from the same registry.
#[allow(dead_code)]
pub(in super::super) fn recipe_tradition(recipe: &str) -> Option<&'static str> {
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
pub(in super::super) struct FunctionalProgrammeAdmission {
    pub recipe_id: String,
    pub composition: String,
    pack_id: String,
    function: String,
    urban_roles: Vec<String>,
    eras: Vec<String>,
    late_only: bool,
    modes: Vec<String>,
}
pub(in super::super) fn functional_programme(
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
/// Declared functional sources carry their own native envelope. A residential
/// default (even absent/refused/out of era) is never their admission witness.
/// Houses historical mode of an urban admission policy (`programme.mode`):
/// the one mapping strict/inspired/fantasy → historical_strict/historical_inspired/fantasy_mix
/// (the TS copy `PROGRAMME_POLICY_HOUSES` is checked against this match by a parity test).
/// The programme validation rejects any other policy before this runs.
pub(in super::super) fn houses_mode(policy: &str) -> &'static str {
    match policy {
        "strict" => "historical_strict",
        "fantasy" => "fantasy_mix",
        _ => "historical_inspired",
    }
}
pub(in super::super) fn functional_mapping(culture: &str, role: &str, function: &str, period: &str, mode: &str) -> Option<CultureMapping> {
    let &(id,family,pack,borrowed,functions,architecture_family)=MAPPINGS.iter().find(|m|m.0==culture)?;
    let programme=functional_programme(pack,role,function,period,mode)?;
    let (envelope,access,layout,floors)=super::super::building_sites::recipe_admission_witness(&programme.recipe_id)?;
    let profile=RecipeAdmission { id:programme.recipe_id.clone(),pack_id:pack.into(),layout,
        min_envelope_m:envelope,min_access_width_m:access,status:"supported".into(),floors,
        eras:programme.eras.clone(),tradition_id:None,inspired_only:mode!="historical_strict" };
    Some(from_profile(id,family,pack,borrowed,functions,architecture_family,&profile))
}
fn admission_catalogue() -> &'static AdmissionCatalogue {
    static PROFILES: OnceLock<AdmissionCatalogue> = OnceLock::new();
    PROFILES.get_or_init(|| {
        serde_json::from_str(include_str!("../../../../houses/data/urban-admission.json"))
            .expect("versioned houses admission catalogue")
    })
}
#[cfg(test)]
pub(super) fn recipe_profile(pack: &str, family: &str, period: &str) -> Option<&'static RecipeAdmission> {
    recipe_profile_in(pack, family, period, None)
}
pub(super) fn recipe_profile_in(
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
pub(super) fn supported_recipe(recipe: &str, period: &str) -> Option<&'static RecipeAdmission> {
    admission_catalogue()
        .profiles
        .iter()
        .find(|p| p.id == recipe && p.status == "supported" && p.in_period(period))
}
pub(super) fn from_profile(
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
