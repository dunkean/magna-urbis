//! A cached, source-driven index of coherent architectural bundles.
//!
//! Entries borrow the atlas once. Selecting a style never clones the catalogue or
//! mixes independently selected materials, roofs and layouts. Facets describe
//! authored data; planned functional mappings remain explicitly planned.
use crate::catalogue::{
    Catalogue, FunctionalMapping, Layout, Parameters, Placement, Recipe, SourceDigest,
    SourceReference, Temporal, catalogue,
};
use crate::model::{HistoricalMode, HouseConfig, MaterialSlots, Role};
use crate::placement::ArchitectureTypology;
use magna_urbis_random::Rng;
use serde::{Deserialize, Serialize};
use std::collections::{BTreeMap, BTreeSet, VecDeque};
use std::sync::{Mutex, OnceLock};

pub const STYLE_INDEX_VERSION: &str = "building-styles-1";

#[derive(Clone, Copy, Debug, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "snake_case")]
pub enum Morphology {
    Single,
    Linear,
    Courtyard,
    Compound,
    Terraced,
    Ring,
    Specialized,
}

#[derive(Clone, Copy, Debug, Serialize)]
pub struct StyleCapabilities {
    /// The existing native generator can consume this bundle.
    pub native_plan: bool,
    /// The constrained morphology operator explicitly supports this bundle.
    pub constrained_composition: bool,
    /// This version does not promise arbitrary polygon decomposition.
    pub imposed_polygon: bool,
    /// A bounded orthogonal footprint may be decomposed, subject to the native
    /// operator's body count, minimum dimensions and access restrictions.
    pub imposed_orthogonal_footprint: bool,
}

/// Source ranges are nominal recipe dimensions, not universal fit guarantees.
/// In particular a complex native programme may extend beyond its main body.
#[derive(Debug, Serialize)]
pub struct StyleConstraints {
    pub nominal_width_m: [f64; 2],
    pub nominal_depth_m: [f64; 2],
    pub floors: [u32; 2],
    pub bodies: [u32; 2],
    pub cells: [u32; 2],
    pub courtyard_ratio: [f64; 2],
    pub wall_thickness_m: [f64; 2],
    pub roof_pitch_deg: [f64; 2],
    pub overhang_m: [f64; 2],
    pub allowed_footprints: &'static [String],
    pub allowed_roofs: &'static [String],
    pub components: Vec<ComponentConstraint>,
}

#[derive(Debug, Serialize)]
pub struct ComponentConstraint {
    pub id: &'static str,
    pub role: Role,
    pub placement: Placement,
    pub count: [u32; 2],
    /// Optionality is declared by a zero count minimum, never inferred from names.
    pub optional: bool,
    pub footprint_family: &'static str,
    pub roof_system: &'static str,
    pub width_ratio: [f64; 2],
    pub depth_ratio: [f64; 2],
    pub floors: [u32; 2],
}

#[derive(Debug, Serialize)]
pub struct StyleConfidence {
    pub recipe: &'static str,
    pub variant: &'static str,
    pub roof: &'static str,
    pub chronology: &'static str,
    pub pack: &'static str,
}

#[derive(Debug, Serialize)]
pub struct StyleEntry {
    /// Stable atlas identity, independent of sorting and camera/detail level.
    pub id: String,
    pub recipe_id: &'static str,
    pub variant_id: &'static str,
    pub label: &'static str,
    pub variant_label: &'static str,
    pub pack_id: &'static str,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub tradition_id: Option<&'static str>,
    pub inspired_only: bool,
    pub role: Role,
    /// Exact source profile; this is the explicit typology facet.
    pub profile: &'static str,
    pub component_kind: Option<&'static str>,
    pub layout: Layout,
    pub typology: ArchitectureTypology,
    pub morphology: Morphology,
    pub footprint_family: &'static str,
    pub roof_system: &'static str,
    /// Actual primary/component systems, separate from override allowlists.
    pub footprint_families: Vec<&'static str>,
    pub roof_systems: Vec<&'static str>,
    /// Principal, component and level material slots, including support material.
    pub materials: Vec<&'static str>,
    pub temporal: &'static Temporal,
    pub confidence: StyleConfidence,
    pub sources: &'static [SourceReference],
    pub settlement_pattern: &'static str,
    pub settlement_archetype: &'static str,
    pub subtradition: &'static str,
    pub compound_pattern: &'static str,
    pub surface_language: &'static str,
    pub weight: u32,
    /// These associations retain their authored status; they are not capabilities.
    pub functional_mappings: Vec<&'static FunctionalMapping>,
    pub capabilities: StyleCapabilities,
    pub constraints: StyleConstraints,
    #[serde(skip)]
    recipe: &'static Recipe,
    #[serde(skip)]
    parameters: &'static Parameters,
}

impl StyleEntry {
    pub fn recipe(&self) -> &'static Recipe {
        self.recipe
    }

    pub fn parameters(&self) -> &'static Parameters {
        self.parameters
    }
}

/// Each posting list contains sorted positions into `entries`. Both the entries
/// and facet keys are sorted, making serialization and seeded selection stable.
#[derive(Debug, Serialize)]
pub struct StyleIndex {
    pub schema_version: &'static str,
    pub catalogue_version: &'static str,
    pub generator_version: &'static str,
    pub sources: &'static [SourceDigest],
    pub entries: Vec<StyleEntry>,
    pub facets: BTreeMap<String, BTreeMap<String, Vec<usize>>>,
    #[serde(skip)]
    compatible_palettes: Mutex<VecDeque<(String, CompatiblePalette)>>,
}

const PALETTE_CACHE_COUNT: usize = 64;
const PALETTE_CACHE_KEY_BYTES: usize = 4096;

/// Optional facts from automatic urban placement, never a fit certificate.
/// The available area must bound the projected union of all body levels, not
/// household capacity, floor area, or a parcel box. Omit it when not known.
#[derive(Clone, Copy, Debug)]
pub(crate) struct AutomaticSelectionContext {
    pub parcel_fit: bool,
    pub available_body_area_m2: Option<f64>,
}

/// The native Single/RECT constructor has one body inside its nominal box.
/// Keep this deliberately narrower than the general morphology capability.
fn simple_rectangle_source(entry: &StyleEntry, config: &HouseConfig) -> bool {
    use crate::catalogue::{Envelope, SupportKind};
    let p = entry.parameters();
    if p.layout != Layout::Single
        || p.footprint_family != "FP-RECT"
        || p.support.kind != SupportKind::Ground
        || p.envelope != Envelope::Walled
        || p.bodies != [1, 1]
        || p.cells[1] > 0
        || p.gallery_cover.enabled
        || !p.enclosures.is_empty()
        || p.court_program.is_some()
        || p.structural_spec.is_some()
        || p.shell.is_some()
        || p.roof_spec.shell.is_some()
        || p.roof_spec.corbel.is_some()
        || !(p.components.is_empty() || p.components.len() == 1 && p.components[0].id == "main")
        || p.details.iter().any(|detail| {
            matches!(
                detail.as_str(),
                "arcade" | "jetty" | "jetties" | "street_jetty"
            )
        })
        || config.overrides.footprint.is_some()
        || config.overrides.bodies.is_some()
        || config.overrides.courtyard_ratio.is_some()
        || config.overrides.roof.is_some()
    {
        return false;
    }
    true
}

/// Nominal area used by the initial Single/RECT programme dimensioner. This is
/// a soft preference, not the inspired x2 allowance, a feasible pose or a
/// certified capacity: room/stair minima, terrain, roof and access remain native.
fn nominal_body_area_range(entry: &StyleEntry, config: &HouseConfig) -> Option<[f64; 2]> {
    if !simple_rectangle_source(entry, config) {
        return None;
    }
    let p = entry.parameters();
    let w = p.width_m.map(|v| v * config.size);
    let d = p.depth_m.map(|v| v * config.size);
    let area = [w[0] * d[0], w[1] * d[1]];
    (w.iter()
        .chain(&d)
        .chain(&area)
        .all(|v| v.is_finite() && *v > 0.)
        && w[0] <= w[1]
        && d[0] <= d[1])
        .then_some(area)
}

/// Keep every complex/unknown slot and every already drawn variant unchanged.
/// Only known simple slots are stably partitioned inside ONE equal programme
/// rank group. A source outside the nominal target remains in the fallback.
fn prefer_nominal_body_budget(ordered: &mut [&StyleEntry], config: &HouseConfig, target: f64) {
    let mut slots = Vec::new();
    let mut preferred = Vec::new();
    let mut remaining = Vec::new();
    for (position, &entry) in ordered.iter().enumerate() {
        if let Some([minimum, maximum]) = nominal_body_area_range(entry, config) {
            slots.push(position);
            if maximum >= target * 0.9 && minimum <= target * 1.1 {
                preferred.push(entry);
            } else {
                remaining.push(entry);
            }
        }
    }
    for (position, entry) in slots
        .into_iter()
        .zip(preferred.into_iter().chain(remaining))
    {
        ordered[position] = entry;
    }
}

/// Exact declared residential intent, not a recipe/culture name heuristic or a
/// claim that a source contains a certified number of independent households.
#[derive(Clone, Copy)]
enum ResidentialIntent {
    House,
    Tenement,
}

impl ResidentialIntent {
    fn from_programme(programme: &crate::programme::ArchitectureProgramme) -> Option<Self> {
        if programme.composition != Some(crate::programme::ProgrammeComposition::Row) {
            return None;
        }
        match programme.role.as_deref()? {
            "dwelling.house" => Some(Self::House),
            "dwelling.tenement" => Some(Self::Tenement),
            _ => None,
        }
    }

    fn affinity(self, role: Role) -> Option<u8> {
        match (self, role) {
            (Self::House, Role::Dwelling) | (Self::Tenement, Role::CommunalDwelling) => Some(0),
            (_, Role::MixedResidential) => Some(1),
            (Self::House, Role::CommunalDwelling) | (Self::Tenement, Role::Dwelling) => Some(2),
            _ => None,
        }
    }
}

/// The simple native strip reserves a 1.25m side passage and a quarter-depth
/// court. No inferred infill, doubled adaptation bounds or footprint/household
/// capacity enters this nominal preference. Other operators remain unknown.
fn residential_nominal_body_area(entry: &StyleEntry, config: &HouseConfig) -> Option<[f64; 2]> {
    if let Some(range) = nominal_body_area_range(entry, config) {
        return Some(range);
    }
    use crate::catalogue::{Envelope, SupportKind};
    let p = entry.parameters();
    if p.layout != Layout::Strip
        || p.footprint_family != "FP-RECT"
        || p.support.kind != SupportKind::Ground
        || p.envelope != Envelope::Walled
        || p.bodies != [1, 1]
        || p.cells[1] > 0
        || p.urban_frontage_infill
        || p.gallery_cover.enabled
        || !p.enclosures.is_empty()
        || p.court_program.is_some()
        || p.structural_spec.is_some()
        || p.shell.is_some()
        || p.roof_spec.shell.is_some()
        || p.roof_spec.corbel.is_some()
        || p.roof_spec.vault.is_some()
        || p.roof_system == "uncovered"
        || !(p.components.is_empty() || p.components.len() == 1 && p.components[0].id == "main")
        || !p.details.iter().all(|d| {
            matches!(
                d.as_str(),
                "party_walls" | "rear_yard" | "shopfront" | "side_corridor" | "masonry_joints"
            )
        })
        || config.overrides != crate::model::Overrides::default()
    {
        return None;
    }
    let w = p.width_m.map(|v| v * config.size);
    let d = p.depth_m.map(|v| v * config.size);
    let body = |i: usize| {
        crate::geometry::snap(w[i] - 1.25)
            * (crate::geometry::snap(d[i]) - crate::geometry::snap(d[i] * 0.25))
    };
    let range = [body(0), body(1)];
    (w.iter()
        .chain(&d)
        .chain(&range)
        .all(|v| v.is_finite() && *v > 0.)
        && w[0] > 1.25
        && w[0] <= w[1]
        && d[0] <= d[1]
        && range[0] <= range[1])
        .then_some(range)
}

/// Compare already drawn simple sources across soft composition buckets, but
/// only within the same floor-preference distance. Complex/unknown slots and
/// the selected variants are untouched. This is not site/entry certification.
fn prefer_residential_nominal_budget(
    ordered: &mut [&StyleEntry],
    config: &HouseConfig,
    programme: &crate::programme::ArchitectureProgramme,
    intent: ResidentialIntent,
    target: f64,
) {
    let mut groups: BTreeMap<u32, Vec<(usize, &StyleEntry, f64, u8)>> = BTreeMap::new();
    for (position, &entry) in ordered.iter().enumerate() {
        let Some(affinity) = intent.affinity(entry.role) else {
            continue;
        };
        let Some([lo, hi]) = residential_nominal_body_area(entry, config) else {
            continue;
        };
        let gap = (lo - target).max(target - hi).max(0.);
        groups
            .entry(programme.rank(entry, config).1)
            .or_default()
            .push((position, entry, gap, affinity));
    }
    for entries in groups.values_mut() {
        let positions: Vec<_> = entries.iter().map(|e| e.0).collect();
        let nominal_target_available = entries.iter().any(|e| e.2 == 0.);
        // Stable sort preserves the original seeded order for equal wishes.
        // A role never forces a too-small native source when none reaches the
        // target: in that case choose the smallest nominal deficit first.
        entries.sort_by(|a, b| {
            if nominal_target_available {
                (a.2 > 0.)
                    .cmp(&(b.2 > 0.))
                    .then_with(|| a.3.cmp(&b.3))
                    .then_with(|| a.2.total_cmp(&b.2))
            } else {
                a.2.total_cmp(&b.2).then_with(|| a.3.cmp(&b.3))
            }
        });
        for (position, entry) in positions.into_iter().zip(entries.iter()) {
            ordered[position] = entry.1;
        }
    }
}

/// A conservative upper bound for the simple native constructor covered here.
/// Unknown operators remain eligible; a frozen minimum witness is not a bound.
fn maximum_body_area(
    entry: &StyleEntry,
    config: &HouseConfig,
    context: &AutomaticSelectionContext,
) -> Option<f64> {
    if !simple_rectangle_source(entry, config) {
        return None;
    }
    let p = entry.parameters();
    // Match the existing native urban allowance; do not widen source ranges.
    // Floors cannot enlarge this no-jetty rectangle's projected body union.
    let allowance = if context.parcel_fit && config.mode != HistoricalMode::HistoricalStrict {
        2.0
    } else {
        1.0
    };
    let maxima = [p.width_m[1], p.depth_m[1]].map(|value| {
        let scaled = value * config.size * allowance;
        // Native coordinates use a millimetre grid. Round the bound outward so
        // numerical snapping cannot turn a borderline target into false proof.
        libm::ceil(scaled / crate::geometry::GRID_M) * crate::geometry::GRID_M
    });
    if maxima
        .iter()
        .any(|value| !value.is_finite() || *value <= 0.)
    {
        return None;
    }
    let mut upper = maxima[0] * maxima[1];
    if !upper.is_finite() {
        return None;
    }
    if let Some(available) = context.available_body_area_m2
        && available.is_finite()
        && available >= 0.
    {
        upper = upper.min(available);
    }
    Some(upper)
}

/// Rank only proven inability to reach the current ten-percent body budget.
/// Zero deliberately combines unknown and not-proven-deficient, not "fits".
fn programme_budget_rank(
    entry: &StyleEntry,
    config: &HouseConfig,
    programme: &crate::programme::ArchitectureProgramme,
    context: Option<&AutomaticSelectionContext>,
) -> u8 {
    let Some((target, context)) = programme.built_area_m2.zip(context) else {
        return 0;
    };
    u8::from(
        maximum_body_area(entry, config, context)
            .is_some_and(|upper| upper + 1.0e-6 < target * 0.9),
    )
}

#[derive(Clone, Debug)]
struct CompatiblePalette {
    query: StyleQuery,
    positions: Vec<usize>,
}

/// Only the seed can vary without changing source compatibility. All other
/// config/facet values stay in the exact cache key; the weighted draw is never
/// cached. Invalid/non-finite input always goes through canonical validation.
fn palette_cache_key(query: &StyleQuery, config: &HouseConfig) -> Option<String> {
    if config.seed.is_empty()
        || config.seed.len() > 4096
        || ![
            config.size,
            config.variation,
            config.wealth,
            config.orientation_deg,
        ]
        .into_iter()
        .all(f64::is_finite)
        || [
            config.overrides.courtyard_ratio,
            config.overrides.overhang_m,
            config.overrides.roof_pitch_deg,
            config.overrides.site_slope_deg,
        ]
        .into_iter()
        .flatten()
        .any(|v| !v.is_finite())
    {
        return None;
    }
    let mut normalized = config.clone();
    normalized.seed.clear();
    let key = serde_json::to_string(&(query, normalized)).ok()?;
    (key.len() <= PALETTE_CACHE_KEY_BYTES).then_some(key)
}

/// Exact filters, with no keyword matching or historical inference. The default
/// reproduces the atlas' automatic residential palette. An explicit recipe may
/// select a zero-weight or non-residential entry, just as HouseConfig does.
#[derive(Clone, Debug, Serialize, Deserialize)]
#[serde(default, deny_unknown_fields)]
pub struct StyleQuery {
    pub pack_id: Option<String>,
    pub tradition_id: Option<String>,
    pub recipe_id: Option<String>,
    pub variant_id: Option<String>,
    pub role: Option<Role>,
    pub profile: Option<String>,
    pub layout: Option<Layout>,
    /// City-facing typology uses the same Layout mapping as native placement.
    /// `common` means no typology restriction.
    pub typology: Option<ArchitectureTypology>,
    pub morphology: Option<Morphology>,
    pub footprint: Option<String>,
    pub roof: Option<String>,
    pub material: Option<String>,
    pub confidence: Option<String>,
    pub source: Option<String>,
    pub settlement_archetype: Option<String>,
    pub era: String,
    pub year: Option<i32>,
    pub mode: HistoricalMode,
    pub allow_late: bool,
    pub automatic: bool,
    pub include_variants: bool,
    pub constrained_composition: Option<bool>,
}

impl Default for StyleQuery {
    fn default() -> Self {
        Self {
            pack_id: None,
            tradition_id: None,
            recipe_id: None,
            variant_id: None,
            role: None,
            profile: None,
            layout: None,
            typology: None,
            morphology: None,
            footprint: None,
            roof: None,
            material: None,
            confidence: None,
            source: None,
            settlement_archetype: None,
            era: "any".into(),
            year: None,
            mode: HistoricalMode::HistoricalInspired,
            allow_late: false,
            automatic: true,
            include_variants: true,
            constrained_composition: None,
        }
    }
}

pub fn style_index() -> Result<&'static StyleIndex, String> {
    static INDEX: OnceLock<Result<StyleIndex, String>> = OnceLock::new();
    INDEX
        .get_or_init(|| build_index(catalogue()?))
        .as_ref()
        .map_err(Clone::clone)
}

impl StyleIndex {
    pub fn get(&self, id: &str) -> Option<&StyleEntry> {
        self.entries
            .binary_search_by(|entry| entry.id.as_str().cmp(id))
            .ok()
            .map(|position| &self.entries[position])
    }

    /// Intersect the smallest facet posting list with remaining filters. Caller
    /// can keep these borrowed candidates for all buildings with the same query.
    pub fn find(&self, query: &StyleQuery) -> Vec<&StyleEntry> {
        let mut filters: Vec<(&str, String)> = Vec::with_capacity(13);
        for (facet, value) in [
            ("pack", &query.pack_id),
            ("tradition", &query.tradition_id),
            ("recipe", &query.recipe_id),
            ("variant", &query.variant_id),
            ("profile", &query.profile),
            ("footprint", &query.footprint),
            ("roof", &query.roof),
            ("material", &query.material),
            ("confidence", &query.confidence),
            ("source", &query.source),
            ("settlement_archetype", &query.settlement_archetype),
        ] {
            if let Some(value) = value {
                filters.push((facet, value.clone()));
            }
        }
        if let Some(role) = query.role {
            filters.push(("role", enum_key(&role)));
        }
        if let Some(layout) = query.layout {
            filters.push(("layout", enum_key(&layout)));
        }
        if let Some(typology) = query.typology
            && typology != ArchitectureTypology::Common
        {
            filters.push(("typology", enum_key(&typology)));
        }
        if let Some(morphology) = query.morphology {
            filters.push(("morphology", enum_key(&morphology)));
        }
        if query.era != "any" {
            filters.push(("era", query.era.clone()));
        }
        let mut lists = Vec::with_capacity(filters.len());
        for (facet, value) in &filters {
            let Some(list) = self.facets.get(*facet).and_then(|values| values.get(value)) else {
                return Vec::new();
            };
            lists.push(list);
        }
        let permitted = |position: usize| {
            lists
                .iter()
                .all(|list| list.binary_search(&position).is_ok())
                && query.permits(&self.entries[position])
        };
        if let Some(smallest) = lists.iter().min_by_key(|list| list.len()) {
            smallest
                .iter()
                .copied()
                .filter(|position| permitted(*position))
                .map(|position| &self.entries[position])
                .collect()
        } else {
            (0..self.entries.len())
                .filter(|position| permitted(*position))
                .map(|position| &self.entries[position])
                .collect()
        }
    }

    /// Seeded, weighted recipe attempts without replacement. Each recipe carries
    /// its atlas weight exactly once, regardless of how many variants it owns.
    /// With `automatic: false`, zero-weight entries opt in at weight one.
    ///
    /// Returned recipes have at least one matching coherent bundle. If callers
    /// realize a default bundle only, set `include_variants: false` in the query.
    pub fn candidate_recipes(
        &self,
        query: &StyleQuery,
        seed: &str,
        limit: usize,
    ) -> Vec<&'static Recipe> {
        Self::order_recipes(&self.find(query), query, seed, limit)
    }

    fn order_recipes(
        matches: &[&StyleEntry],
        query: &StyleQuery,
        seed: &str,
        limit: usize,
    ) -> Vec<&'static Recipe> {
        if limit == 0 {
            return Vec::new();
        }
        let mut candidates: Vec<&'static Recipe> = Vec::new();
        for entry in matches {
            if candidates
                .last()
                .is_none_or(|recipe| recipe.id != entry.recipe_id)
            {
                candidates.push(entry.recipe());
            }
        }
        let mut weights: Vec<u32> = candidates
            .iter()
            .map(|recipe| {
                if query.recipe_id.is_some() || !query.automatic {
                    recipe.weight.max(1)
                } else {
                    recipe.weight
                }
            })
            .collect();
        let mut rng = Rng::new(seed).fork("building-style-recipes-v1");
        let count = limit.min(candidates.len());
        let mut result = Vec::with_capacity(count);
        for _ in 0..count {
            let Ok(position) = rng.weighted_index(&weights) else {
                break;
            };
            result.push(candidates.remove(position));
            weights.remove(position);
        }
        result
    }

    /// Weighted recipe ordering followed by one coherent matching bundle for
    /// each recipe. Pin its `variant_id` before realization; no later random
    /// variant may replace it. `query.variant_id` preserves an explicit request.
    /// Use `include_variants: false` when variation is disabled and no variant is
    /// explicitly selected. Detailed override compatibility remains the native
    /// resolver's responsibility, exactly as on the existing generation route.
    pub fn candidate_styles(
        &self,
        query: &StyleQuery,
        seed: &str,
        limit: usize,
    ) -> Vec<&StyleEntry> {
        let matches = self.find(query);
        Self::order_styles(&matches, query, seed, limit)
    }

    /// Spend the geometry-attempt budget only on coherent bundles compatible
    /// with explicit native configuration. This is parameter validation, never
    /// a fit guarantee: layout, roof, site and access admission still run later.
    /// Omitted overrides do not become constraints on the source ranges.
    pub fn candidate_styles_for_config(
        &self,
        query: &StyleQuery,
        config: &HouseConfig,
        seed: &str,
        limit: usize,
    ) -> Result<Vec<&StyleEntry>, String> {
        if limit == 0 {
            return Ok(Vec::new());
        }
        let (effective, compatible) = self.cached_compatible_styles(query, config)?;
        Ok(Self::order_styles(&compatible, &effective, seed, limit))
    }

    /// Urban wishes only order already compatible source bundles. Rank buckets
    /// preserve native weights and seeded variation, with each recipe attempted
    /// once. The cache contains compatibility only, never programme decisions.
    pub(crate) fn candidate_styles_for_programme(
        &self,
        query: &StyleQuery,
        config: &HouseConfig,
        seed: &str,
        limit: usize,
        programme: &crate::programme::ArchitectureProgramme,
    ) -> Result<Vec<&StyleEntry>, String> {
        self.candidate_styles_for_programme_with_context(
            query, config, seed, limit, programme, None,
        )
    }

    /// Optional conservative capacity ranking before soft composition/floor
    /// wishes. Never removes a source or changes explicit source compatibility.
    /// Complex/uncovered operators keep the same budget rank as possible ones.
    ///
    /// Evidence                         Budget rank
    /// Unknown constructor/model        0 (not a fit promise)
    /// Known upper bound >= 90% target  0 (not a fit promise)
    /// Known upper bound < 90% target   1 (proven budget deficit only)
    ///
    /// Opt-in only: truncating this order to four candidates can displace a
    /// valid partial solution behind unknown complex sources. Keep the legacy
    /// fallback or compare only known operators before production activation.
    pub(crate) fn candidate_styles_for_programme_with_context(
        &self,
        query: &StyleQuery,
        config: &HouseConfig,
        seed: &str,
        limit: usize,
        programme: &crate::programme::ArchitectureProgramme,
        context: Option<&AutomaticSelectionContext>,
    ) -> Result<Vec<&StyleEntry>, String> {
        programme.validate()?;
        if limit == 0 {
            return Ok(Vec::new());
        }
        if !programme.has_wishes() || config.recipe.is_some() || config.overrides.variant.is_some()
        {
            return self.candidate_styles_for_config(query, config, seed, limit);
        }
        let (effective, compatible) = self.cached_compatible_styles(query, config)?;
        // `config` is the original automatic configuration, before the caller
        // pins a selected recipe/variant. Explicit controls keep their order.
        // Test the supplied context before filtering it: the experimental
        // capacity-ranking route must never implicitly enable this preference.
        let nominal_target = programme.built_area_m2.filter(|_| {
            context.is_none()
                && effective.automatic
                && effective.recipe_id.is_none()
                && effective.variant_id.is_none()
                && config.mode == HistoricalMode::HistoricalInspired
                && query.mode == HistoricalMode::HistoricalInspired
                && config.recipe.is_none()
                && config.workshop.is_none()
                && config.overrides == crate::model::Overrides::default()
        });
        let residential_intent =
            nominal_target.and_then(|_| ResidentialIntent::from_programme(programme));
        let context = context.filter(|_| {
            effective.automatic
                && effective.recipe_id.is_none()
                && effective.variant_id.is_none()
                && config.workshop.is_none()
        });
        let mut ranks: BTreeMap<(u8, u8, u32), Vec<&StyleEntry>> = BTreeMap::new();
        for entry in compatible {
            let (composition, floors) = programme.rank(entry, config);
            ranks
                .entry((
                    programme_budget_rank(entry, config, programme, context),
                    composition,
                    floors,
                ))
                .or_default()
                .push(entry);
        }
        let mut used = BTreeSet::new();
        let mut result = Vec::with_capacity(limit.min(self.entries.len()));
        // The narrow residential comparison must see all already ranked
        // sources before taking four. Each existing weighted group is drawn
        // once with its unchanged fork/seed; no candidate/variant is redrawn.
        let selection_limit = if residential_intent.is_some() {
            usize::MAX
        } else {
            limit
        };
        for entries in ranks.values_mut() {
            entries.retain(|entry| !used.contains(entry.recipe_id));
            let remaining = selection_limit - result.len();
            let draw_limit = if nominal_target.is_some() {
                usize::MAX
            } else {
                remaining
            };
            // Draw the complete group once before moving/truncating simple
            // slots. Re-drawing separate preference buckets changes variants
            // and weighted diversity, which this nominal wish must preserve.
            let mut ordered = Self::order_styles(entries, &effective, seed, draw_limit);
            if let Some(target) = nominal_target {
                prefer_nominal_body_budget(&mut ordered, config, target);
            }
            for entry in ordered.into_iter().take(remaining) {
                used.insert(entry.recipe_id);
                result.push(entry);
            }
            if result.len() == selection_limit {
                break;
            }
        }
        if let (Some(intent), Some(target)) = (residential_intent, nominal_target) {
            prefer_residential_nominal_budget(&mut result, config, programme, intent, target);
            result.truncate(limit);
        }
        Ok(result)
    }

    /// One missing simple family after all four legacy attempts have failed.
    /// The caller must enforce automatic domestic/mixed placement, no exact
    /// model, and exhaustion of the original attempts. A selected simple source
    /// is never retried through another variant. No additional ranking or RNG.
    ///
    /// This helper does not replace the first four candidates: native complex
    /// successes and their morphology remain untouched. It certifies source
    /// compatibility only, not dimension, terrain, roof, access or capacity fit.
    pub(crate) fn simple_fallback_for_programme(
        &self,
        query: &StyleQuery,
        config: &HouseConfig,
        seed: &str,
        programme: &crate::programme::ArchitectureProgramme,
        attempted_recipe_ids: &[&str],
    ) -> Result<Option<&StyleEntry>, String> {
        use crate::programme::ProgrammeComposition;
        if !query.automatic
            || query.recipe_id.is_some()
            || query.variant_id.is_some()
            || config.recipe.is_some()
            || config.overrides.variant.is_some()
            || config.workshop.is_some()
            || programme.composition != Some(ProgrammeComposition::Row)
        {
            return Ok(None);
        }
        let attempted: BTreeSet<_> = attempted_recipe_ids.iter().copied().collect();
        if attempted.len() != 4 {
            return Ok(None);
        }
        // Extend the same source order, rather than drawing a new palette after
        // failure. This shares era/tradition/override admission and variant RNG.
        let ordered =
            self.candidate_styles_for_programme(query, config, seed, usize::MAX, programme)?;
        if ordered.iter().any(|entry| {
            attempted.contains(entry.recipe_id) && simple_rectangle_source(entry, config)
        }) {
            return Ok(None);
        }
        Ok(ordered.into_iter().find(|entry| {
            !attempted.contains(entry.recipe_id) && simple_rectangle_source(entry, config)
        }))
    }

    fn cached_compatible_styles(
        &self,
        query: &StyleQuery,
        config: &HouseConfig,
    ) -> Result<(StyleQuery, Vec<&StyleEntry>), String> {
        let key = palette_cache_key(query, config);
        let cached = key.as_ref().and_then(|key| {
            let mut cache = self.compatible_palettes.lock().ok()?;
            let position = cache.iter().position(|(stored, _)| stored == key)?;
            let entry = cache.remove(position)?;
            let palette = entry.1.clone();
            cache.push_back(entry);
            Some(palette)
        });
        if let Some(palette) = cached {
            let compatible: Vec<_> = palette
                .positions
                .iter()
                .map(|&i| &self.entries[i])
                .collect();
            return Ok((palette.query, compatible));
        }
        let (effective, compatible) = self.compatible_styles_for_config(query, config)?;
        if let Some(key) = key
            && let Ok(mut cache) = self.compatible_palettes.lock()
        {
            // The catalogue is immutable and this cache belongs to this index.
            // Keep only source-entry indices, never resolved parameters/plans.
            let palette = CompatiblePalette {
                query: effective.clone(),
                positions: compatible
                    .iter()
                    .map(|entry| {
                        self.entries
                            .binary_search_by(|e| e.id.cmp(&entry.id))
                            .expect("indexed style")
                    })
                    .collect(),
            };
            if let Some(position) = cache.iter().position(|(stored, _)| stored == &key) {
                cache.remove(position);
            }
            if cache.len() == PALETTE_CACHE_COUNT {
                cache.pop_front();
            }
            cache.push_back((key, palette));
        }
        Ok((effective, compatible))
    }

    fn compatible_styles_for_config(
        &self,
        query: &StyleQuery,
        config: &HouseConfig,
    ) -> Result<(StyleQuery, Vec<&StyleEntry>), String> {
        let data = catalogue()?;
        data.validate_config(config)?;
        if config.workshop.is_some() {
            return Err("Workshop templates require their explicit native selection route.".into());
        }
        // Configuration pins intersect the supplied facets; they must never be
        // replaced by an automatic fallback or a differently named variant.
        let mut effective = query.clone();
        for (filter, explicit) in [
            (&mut effective.pack_id, Some(config.pack.as_str())),
            (&mut effective.recipe_id, config.recipe.as_deref()),
            (
                &mut effective.variant_id,
                config.overrides.variant.as_deref(),
            ),
        ] {
            if let Some(explicit) = explicit {
                if filter.as_deref().is_some_and(|value| value != explicit) {
                    return Err(format!(
                        "Style query conflicts with explicit selection {explicit}."
                    ));
                }
                *filter = Some(explicit.into());
            }
        }
        effective.mode = config.mode;
        effective.allow_late &= config.allow_late;
        if config.era != "any" {
            if effective.era != "any" && effective.era != config.era {
                return Err("Style query conflicts with the explicit era.".into());
            }
            effective.era.clone_from(&config.era);
        }
        if config.overrides.variant.is_some() {
            effective.include_variants = true;
        } else if config.variation == 0.0 {
            effective.include_variants = false;
        }
        let mut compatible = Vec::new();
        let mut failures = Vec::new();
        for entry in self.find(&effective) {
            let resolved = data
                .resolve_variant_parameters(entry.recipe(), config, entry.variant_id)
                .and_then(|parameters| explicit_component_constraints(&parameters, config));
            match resolved {
                Ok(()) => compatible.push(entry),
                Err(reason) if failures.len() < 6 => {
                    failures.push(format!("{}: {reason}", entry.id))
                }
                Err(_) => {}
            }
        }
        if compatible.is_empty() {
            return Err(format!(
                "No source style satisfies the explicit configuration and requested facets. {}",
                failures.join(" ; ")
            ));
        }
        Ok((effective, compatible))
    }

    fn order_styles<'a>(
        matches: &[&'a StyleEntry],
        query: &StyleQuery,
        seed: &str,
        limit: usize,
    ) -> Vec<&'a StyleEntry> {
        let rng = Rng::new(seed).fork("building-style-variants-v1");
        Self::order_recipes(matches, query, seed, limit)
            .into_iter()
            .filter_map(|recipe| {
                let count = matches
                    .iter()
                    .filter(|entry| entry.recipe_id == recipe.id)
                    .count();
                if count == 0 {
                    return None;
                }
                let position = rng.fork(&recipe.id).int(0, count as u32 - 1) as usize;
                matches
                    .iter()
                    .copied()
                    .filter(|entry| entry.recipe_id == recipe.id)
                    .nth(position)
            })
            .collect()
    }
}

/// These are the source-only feasibility checks in engine::resolve_draws for
/// explicit compound overrides. The parent floor range can include a tower;
/// it does not authorize that many floors in the main dwelling. Even FantasyMix
/// retains the authored component programme on the native route.
fn explicit_component_constraints(p: &Parameters, config: &HouseConfig) -> Result<(), String> {
    if p.components.len() == 1 && p.components[0].id == "main" {
        return Ok(());
    }
    let resident = |c: &&crate::catalogue::Component| {
        c.role.residential() && c.placement != Placement::FacingMain
    };
    let primary = p
        .components
        .iter()
        .filter(resident)
        .find(|c| c.placement == Placement::Main)
        .or_else(|| {
            p.components
                .iter()
                .find(|c| c.role.residential() && c.placement != Placement::FacingMain)
        });
    let Some(primary) = primary else {
        return Ok(());
    };
    if let Some(floors) = config.overrides.floors
        && !(primary.floors[0]..=primary.floors[1]).contains(&floors)
    {
        return Err(format!(
            "Composant {} : {floors} niveaux hors programme déclaré.",
            primary.id
        ));
    }
    if let Some(bodies) = config.overrides.bodies {
        let (min, max) = p
            .components
            .iter()
            .filter(resident)
            .fold((0u64, 0u64), |(min, max), c| {
                (min + u64::from(c.count[0]), max + u64::from(c.count[1]))
            });
        if !(min..=max).contains(&u64::from(bodies)) {
            return Err(format!(
                "Programme composé : {bodies} corps principaux incompatibles avec les quantités de ses composants."
            ));
        }
    }
    Ok(())
}

impl StyleQuery {
    fn permits(&self, entry: &StyleEntry) -> bool {
        if entry.inspired_only && self.mode == HistoricalMode::HistoricalStrict {
            return false;
        }
        if self.automatic
            && self.recipe_id.is_none()
            && (entry.weight == 0 || (self.role.is_none() && !entry.role.residential()))
        {
            return false;
        }
        if !self.include_variants && entry.variant_id != "default" {
            return false;
        }
        if entry.temporal.late_only
            && (!self.allow_late || self.mode == HistoricalMode::HistoricalStrict)
        {
            return false;
        }
        if let Some(year) = self.year
            && (entry.temporal.from_year.is_some_and(|from| year < from)
                || entry.temporal.to_year.is_some_and(|to| year > to))
        {
            return false;
        }
        self.constrained_composition
            .is_none_or(|value| entry.capabilities.constrained_composition == value)
    }
}

fn build_index(data: &'static Catalogue) -> Result<StyleIndex, String> {
    let mut entries = Vec::with_capacity(
        data.recipes.len() + data.recipes.iter().map(|r| r.variants.len()).sum::<usize>(),
    );
    for recipe in &data.recipes {
        let pack = data
            .packs
            .iter()
            .find(|pack| pack.id == recipe.pack_id)
            .ok_or_else(|| format!("Recette {} sans pack {}.", recipe.id, recipe.pack_id))?;
        let bundles = std::iter::once((
            "default",
            recipe.label.as_str(),
            recipe.confidence.as_str(),
            &recipe.parameters,
        ))
        .chain(recipe.variants.iter().map(|variant| {
            (
                variant.id.as_str(),
                variant.label.as_str(),
                variant.confidence.as_str(),
                &variant.parameters,
            )
        }));
        for (variant_id, variant_label, confidence, parameters) in bundles {
            let mut footprints = BTreeSet::from([parameters.footprint_family.as_str()]);
            let mut roofs = BTreeSet::from([parameters.roof_system.as_str()]);
            let mut materials = BTreeSet::new();
            material_slots(&parameters.materials, &mut materials);
            if let Some(material) = &parameters.support.material {
                materials.insert(material.as_str());
            }
            for level in &parameters.level_materials {
                material_slots(&level.materials, &mut materials);
            }
            if parameters.gallery_cover.enabled {
                roofs.insert(parameters.gallery_cover.rf.as_str());
            }
            for component in &parameters.components {
                footprints.insert(component.footprint_family.as_str());
                roofs.insert(component.roof_system.as_str());
                material_slots(&component.materials, &mut materials);
                if let Some(material) = &component.support.material {
                    materials.insert(material.as_str());
                }
                for level in &component.level_materials {
                    material_slots(&level.materials, &mut materials);
                }
            }
            entries.push(StyleEntry {
                id: format!("{}::{variant_id}", recipe.id),
                recipe_id: &recipe.id,
                variant_id,
                label: &recipe.label,
                variant_label,
                pack_id: &recipe.pack_id,
                tradition_id: recipe.tradition_id.as_deref(),
                inspired_only: recipe.inspired_only,
                role: recipe.role,
                profile: &recipe.profile,
                component_kind: recipe.component_kind.as_deref(),
                layout: parameters.layout,
                typology: crate::placement::typology(parameters.layout),
                morphology: morphology(parameters),
                footprint_family: &parameters.footprint_family,
                roof_system: &parameters.roof_system,
                footprint_families: footprints.into_iter().collect(),
                roof_systems: roofs.into_iter().collect(),
                materials: materials.into_iter().collect(),
                temporal: &recipe.temporal,
                confidence: StyleConfidence {
                    recipe: &recipe.confidence,
                    variant: confidence,
                    roof: &recipe.roof_confidence,
                    chronology: &recipe.chronology_confidence,
                    pack: &pack.confidence,
                },
                sources: &recipe.sources,
                settlement_pattern: &recipe.settlement_pattern,
                settlement_archetype: &recipe.settlement_archetype,
                subtradition: &recipe.subtradition,
                compound_pattern: &recipe.compound_pattern,
                surface_language: &recipe.surface_language,
                weight: recipe.weight,
                functional_mappings: data
                    .functional_mappings
                    .iter()
                    .filter(|mapping| mapping.recipe_ids.contains(&recipe.id))
                    .collect(),
                capabilities: StyleCapabilities {
                    native_plan: true,
                    constrained_composition: crate::morphology::supports(parameters),
                    imposed_polygon: false,
                    imposed_orthogonal_footprint: crate::morphology::supports_imposed(parameters),
                },
                constraints: StyleConstraints {
                    nominal_width_m: parameters.width_m,
                    nominal_depth_m: parameters.depth_m,
                    floors: parameters.floors,
                    bodies: parameters.bodies,
                    cells: parameters.cells,
                    courtyard_ratio: parameters.courtyard_ratio,
                    wall_thickness_m: parameters.wall_thickness_m,
                    roof_pitch_deg: parameters.roof_pitch_deg,
                    overhang_m: parameters.overhang_m,
                    allowed_footprints: &parameters.allowed_footprints,
                    allowed_roofs: &parameters.allowed_roofs,
                    components: parameters
                        .components
                        .iter()
                        .map(|component| ComponentConstraint {
                            id: &component.id,
                            role: component.role,
                            placement: component.placement,
                            count: component.count,
                            optional: component.count[0] == 0,
                            footprint_family: &component.footprint_family,
                            roof_system: &component.roof_system,
                            width_ratio: component.width_ratio,
                            depth_ratio: component.depth_ratio,
                            floors: component.floors,
                        })
                        .collect(),
                },
                recipe,
                parameters,
            });
        }
    }
    entries.sort_by(|a, b| a.id.cmp(&b.id));
    if entries.windows(2).any(|pair| pair[0].id == pair[1].id) {
        return Err("Identité de style dupliquée dans le catalogue.".into());
    }
    let mut facets: BTreeMap<String, BTreeMap<String, Vec<usize>>> = BTreeMap::new();
    for (position, entry) in entries.iter().enumerate() {
        let mut add = |facet: &str, value: &str| {
            if !value.is_empty() {
                let list = facets
                    .entry(facet.into())
                    .or_default()
                    .entry(value.into())
                    .or_default();
                if list.last() != Some(&position) {
                    list.push(position);
                }
            }
        };
        for (facet, value) in [
            ("pack", entry.pack_id),
            ("recipe", entry.recipe_id),
            ("variant", entry.variant_id),
            ("profile", entry.profile),
            ("settlement_archetype", entry.settlement_archetype),
            ("compound_pattern", entry.compound_pattern),
            ("subtradition", entry.subtradition),
        ] {
            add(facet, value);
        }
        if let Some(tradition) = entry.tradition_id {
            add("tradition", tradition);
        }
        add("role", &enum_key(&entry.role));
        add("layout", &enum_key(&entry.layout));
        add("typology", &enum_key(&entry.typology));
        add("morphology", &enum_key(&entry.morphology));
        for value in &entry.temporal.eras {
            add("era", value);
        }
        for value in &entry.footprint_families {
            add("footprint", value);
        }
        for value in &entry.roof_systems {
            add("roof", value);
        }
        for value in &entry.materials {
            add("material", value);
        }
        for source in entry.sources {
            add("source", &source.path);
        }
        for value in [
            entry.confidence.recipe,
            entry.confidence.variant,
            entry.confidence.roof,
            entry.confidence.chronology,
            entry.confidence.pack,
        ] {
            add("confidence", value);
        }
    }
    Ok(StyleIndex {
        schema_version: STYLE_INDEX_VERSION,
        catalogue_version: &data.catalogue_version,
        generator_version: crate::GENERATOR_VERSION,
        sources: &data.sources,
        entries,
        facets,
        compatible_palettes: Mutex::new(VecDeque::new()),
    })
}

fn material_slots(slots: &'static MaterialSlots, materials: &mut BTreeSet<&'static str>) {
    for material in [
        &slots.frame,
        &slots.infill,
        &slots.coating,
        &slots.cladding,
        &slots.base,
        &slots.roof_frame,
    ] {
        materials.insert(material.as_str());
    }
}

fn enum_key(value: &impl Serialize) -> String {
    // All callers are string-backed enums. Deriving the facet key through serde
    // prevents a second naming table from drifting from the public contract.
    serde_json::to_value(value)
        .expect("string enum")
        .as_str()
        .expect("string enum")
        .to_owned()
}

pub(crate) fn morphology(parameters: &Parameters) -> Morphology {
    match parameters.layout {
        Layout::Strip | Layout::Parallel => Morphology::Linear,
        Layout::Courtyard
        | Layout::Peristyle
        | Layout::Atrium
        | Layout::IwanCourt
        | Layout::Siheyuan
        | Layout::Kancha
        | Layout::Multiyard => Morphology::Courtyard,
        Layout::HutCompound
        | Layout::Kraal
        | Layout::Additive
        | Layout::Shinden
        | Layout::HighHall => Morphology::Compound,
        Layout::Pueblo | Layout::GreatHouse => Morphology::Terraced,
        Layout::Ring | Layout::Broch => Morphology::Ring,
        Layout::Cliff | Layout::Excavated | Layout::Bridge => Morphology::Specialized,
        Layout::Single | Layout::Platform => match parameters.footprint_family.as_str() {
            "FP-L" | "FP-U" | "FP-COMPLEX" | "FP-REDENT" => Morphology::Compound,
            "FP-COURT" | "FP-ROCKCUT" => Morphology::Courtyard,
            "FP-ELLIPTICAL-RING" => Morphology::Ring,
            _ => Morphology::Single,
        },
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::model::HouseConfig;

    #[test]
    fn cached_compatibility_keeps_seeded_order_constraints_and_bounded_storage() {
        let index = build_index(catalogue().unwrap()).unwrap();
        let query = StyleQuery {
            pack_id: Some("EUR-MED".into()),
            ..Default::default()
        };
        let mut config = HouseConfig::default();
        config.overrides.floors = Some(3);
        let (effective, compatible) = index.compatible_styles_for_config(&query, &config).unwrap();
        for i in 0..100 {
            config.seed = format!("palette-cache-{i}");
            let actual = index
                .candidate_styles_for_config(&query, &config, &config.seed, 4)
                .unwrap();
            let expected = StyleIndex::order_styles(&compatible, &effective, &config.seed, 4);
            assert_eq!(
                actual.iter().map(|e| &e.id).collect::<Vec<_>>(),
                expected.iter().map(|e| &e.id).collect::<Vec<_>>()
            );
        }
        assert_eq!(index.compatible_palettes.lock().unwrap().len(), 1);
        // NaN serializes as null: it must never alias a cached omitted override.
        config.overrides.overhang_m = Some(f64::NAN);
        assert!(
            index
                .candidate_styles_for_config(&query, &config, "seed", 4)
                .is_err()
        );
        config.overrides.overhang_m = None;
        config.seed.clear();
        assert!(
            index
                .candidate_styles_for_config(&query, &config, "seed", 4)
                .is_err()
        );
        config.seed = "seed".into();
        config.overrides.floors = Some(2);
        let (effective, compatible) = index.compatible_styles_for_config(&query, &config).unwrap();
        assert_eq!(
            index
                .candidate_styles_for_config(&query, &config, "seed", 4)
                .unwrap()
                .iter()
                .map(|e| &e.id)
                .collect::<Vec<_>>(),
            StyleIndex::order_styles(&compatible, &effective, "seed", 4)
                .iter()
                .map(|e| &e.id)
                .collect::<Vec<_>>()
        );
        for i in 0..PALETTE_CACHE_COUNT + 10 {
            config.wealth = i as f64 / 100.;
            index
                .candidate_styles_for_config(&query, &config, "seed", 4)
                .unwrap();
        }
        assert_eq!(
            index.compatible_palettes.lock().unwrap().len(),
            PALETTE_CACHE_COUNT
        );
    }

    #[test]
    fn every_recipe_and_variant_has_one_borrowed_stable_entry() {
        let data = catalogue().unwrap();
        let index = style_index().unwrap();
        assert!(std::ptr::eq(index, style_index().unwrap()));
        assert_eq!(index.catalogue_version, data.catalogue_version);
        assert_eq!(index.generator_version, crate::GENERATOR_VERSION);
        assert_eq!(
            index.entries.len(),
            data.recipes.len() + data.recipes.iter().map(|r| r.variants.len()).sum::<usize>()
        );
        assert_eq!(index.facets["pack"].len(), data.packs.len());
        for recipe in &data.recipes {
            let entry = index.get(&format!("{}::default", recipe.id)).unwrap();
            assert!(std::ptr::eq(entry.recipe(), recipe));
            assert!(std::ptr::eq(entry.parameters(), &recipe.parameters));
            for variant in &recipe.variants {
                let entry = index
                    .get(&format!("{}::{}", recipe.id, variant.id))
                    .unwrap();
                assert!(std::ptr::eq(entry.parameters(), &variant.parameters));
                assert_eq!(
                    entry.constraints.nominal_width_m,
                    variant.parameters.width_m
                );
            }
        }
    }

    #[test]
    fn index_is_deterministic_and_postings_are_exact() {
        let first = style_index().unwrap();
        let second = build_index(catalogue().unwrap()).unwrap();
        assert_eq!(
            serde_json::to_string(first).unwrap(),
            serde_json::to_string(&second).unwrap()
        );
        for values in first.facets.values() {
            for list in values.values() {
                assert!(list.windows(2).all(|pair| pair[0] < pair[1]));
                assert!(list.iter().all(|index| *index < first.entries.len()));
            }
        }
        let example = first
            .entries
            .iter()
            .find(|e| e.weight > 0 && e.role.residential() && !e.temporal.late_only)
            .unwrap();
        let query = StyleQuery {
            pack_id: Some(example.pack_id.into()),
            role: Some(example.role),
            profile: Some(example.profile.into()),
            roof: Some(example.roof_system.into()),
            material: Some(example.materials[0].into()),
            ..StyleQuery::default()
        };
        let matches = first.find(&query);
        assert!(matches.iter().any(|entry| entry.id == example.id));
        assert!(matches.iter().all(|entry| entry.pack_id == example.pack_id
            && entry.profile == example.profile
            && entry.role == example.role
            && entry.roof_systems.contains(&example.roof_system)
            && entry.materials.contains(&example.materials[0])));
        assert!(
            first
                .find(&StyleQuery {
                    pack_id: Some("unknown".into()),
                    ..StyleQuery::default()
                })
                .is_empty()
        );
    }

    #[test]
    fn automatic_selection_matches_catalogue_era_and_late_restrictions() {
        let data = catalogue().unwrap();
        let index = style_index().unwrap();
        for pack in &data.packs {
            for era in ["any", "A", "M"] {
                for mode in [
                    HistoricalMode::HistoricalStrict,
                    HistoricalMode::HistoricalInspired,
                    HistoricalMode::FantasyMix,
                ] {
                    for allow_late in [false, true] {
                        let query = StyleQuery {
                            pack_id: Some(pack.id.clone()),
                            era: era.into(),
                            mode,
                            allow_late,
                            ..StyleQuery::default()
                        };
                        let config = HouseConfig {
                            pack: pack.id.clone(),
                            era: era.into(),
                            mode,
                            allow_late,
                            ..HouseConfig::default()
                        };
                        let actual: BTreeSet<_> = index
                            .find(&query)
                            .into_iter()
                            .map(|entry| entry.recipe_id)
                            .collect();
                        let expected: BTreeSet<_> = data
                            .admissible(&config)
                            .unwrap_or_default()
                            .into_iter()
                            .map(|recipe| recipe.id.as_str())
                            .collect();
                        assert_eq!(
                            actual, expected,
                            "{} {era} {mode:?} allow_late={allow_late}",
                            pack.id
                        );
                    }
                }
            }
        }
    }

    #[test]
    fn capabilities_and_optionality_are_supported_by_authored_data() {
        for entry in &style_index().unwrap().entries {
            assert!(!entry.capabilities.imposed_polygon);
            assert_eq!(
                entry.capabilities.constrained_composition,
                crate::morphology::supports(entry.parameters())
            );
            assert_eq!(
                entry.capabilities.imposed_orthogonal_footprint,
                crate::morphology::supports_imposed(entry.parameters())
            );
            for component in &entry.constraints.components {
                assert_eq!(component.optional, component.count[0] == 0);
            }
            for mapping in &entry.functional_mappings {
                assert!(mapping.recipe_ids.iter().any(|id| id == entry.recipe_id));
            }
        }
    }

    #[test]
    fn explicit_selection_keeps_historical_and_year_bounds() {
        let index = style_index().unwrap();
        for entry in &index.entries {
            let query = StyleQuery {
                recipe_id: Some(entry.recipe_id.into()),
                variant_id: Some(entry.variant_id.into()),
                allow_late: true,
                automatic: false,
                ..StyleQuery::default()
            };
            assert_eq!(index.find(&query).len(), 1);
            if entry.temporal.late_only {
                assert!(
                    index
                        .find(&StyleQuery {
                            mode: HistoricalMode::HistoricalStrict,
                            ..query.clone()
                        })
                        .is_empty()
                );
            }
            if let Some(from) = entry.temporal.from_year {
                assert!(
                    index
                        .find(&StyleQuery {
                            year: Some(from - 1),
                            ..query.clone()
                        })
                        .is_empty()
                );
            }
            if let Some(to) = entry.temporal.to_year {
                assert!(
                    index
                        .find(&StyleQuery {
                            year: Some(to + 1),
                            ..query.clone()
                        })
                        .is_empty()
                );
            }
        }
    }

    #[test]
    fn recipe_attempts_are_bounded_deterministic_and_not_variant_biased() {
        let index = style_index().unwrap();
        let query = StyleQuery {
            pack_id: Some("EUR-MED".into()),
            ..StyleQuery::default()
        };
        for seed in ["farm", "town", "metropolis"] {
            let first = index.candidate_recipes(&query, seed, 5);
            let second = index.candidate_recipes(&query, seed, 5);
            let defaults = index.candidate_recipes(
                &StyleQuery {
                    include_variants: false,
                    ..query.clone()
                },
                seed,
                5,
            );
            let ids = |recipes: Vec<&Recipe>| {
                recipes
                    .into_iter()
                    .map(|recipe| recipe.id.clone())
                    .collect::<Vec<_>>()
            };
            let first = ids(first);
            assert_eq!(first.len(), 5);
            assert_eq!(first, ids(second));
            assert_eq!(
                first,
                ids(defaults),
                "variant multiplicity must not change recipe weights"
            );
            assert_eq!(first.iter().collect::<BTreeSet<_>>().len(), first.len());
        }
        assert!(index.candidate_recipes(&query, "seed", 0).is_empty());
        let all = index.candidate_recipes(&query, "seed", usize::MAX);
        assert_eq!(
            all.len(),
            index
                .find(&query)
                .iter()
                .map(|entry| entry.recipe_id)
                .collect::<BTreeSet<_>>()
                .len()
        );
    }

    #[test]
    fn city_typology_uses_native_layout_mapping_for_each_bundle() {
        let index = style_index().unwrap();
        for typology in [
            ArchitectureTypology::Row,
            ArchitectureTypology::Courtyard,
            ArchitectureTypology::Compound,
            ArchitectureTypology::Detached,
        ] {
            let query = StyleQuery {
                typology: Some(typology),
                ..StyleQuery::default()
            };
            let entries = index.find(&query);
            assert!(!entries.is_empty());
            assert!(
                entries
                    .iter()
                    .all(|entry| crate::placement::typology(entry.layout) == typology)
            );
            for recipe in index.candidate_recipes(&query, "typology", 8) {
                assert!(entries.iter().any(|entry| entry.recipe_id == recipe.id));
            }
        }
        assert_eq!(
            index
                .find(&StyleQuery {
                    typology: Some(ArchitectureTypology::Common),
                    ..StyleQuery::default()
                })
                .len(),
            index.find(&StyleQuery::default()).len()
        );
    }

    #[test]
    fn coherent_candidates_preserve_typology_and_explicit_variant() {
        let index = style_index().unwrap();
        let query = StyleQuery {
            typology: Some(ArchitectureTypology::Courtyard),
            ..StyleQuery::default()
        };
        let first = index.candidate_styles(&query, "city-01", 8);
        let second = index.candidate_styles(&query, "city-01", 8);
        assert_eq!(
            first
                .iter()
                .map(|entry| entry.id.as_str())
                .collect::<Vec<_>>(),
            second
                .iter()
                .map(|entry| entry.id.as_str())
                .collect::<Vec<_>>()
        );
        assert!(
            first
                .iter()
                .all(|entry| entry.typology == ArchitectureTypology::Courtyard)
        );
        assert_eq!(
            first
                .iter()
                .map(|entry| entry.recipe_id)
                .collect::<BTreeSet<_>>()
                .len(),
            first.len()
        );
        let variant = index
            .entries
            .iter()
            .find(|entry| {
                entry.variant_id != "default"
                    && entry.weight > 0
                    && entry.role.residential()
                    && !entry.temporal.late_only
            })
            .unwrap();
        let exact = index.candidate_styles(
            &StyleQuery {
                recipe_id: Some(variant.recipe_id.into()),
                variant_id: Some(variant.variant_id.into()),
                ..StyleQuery::default()
            },
            "exact",
            4,
        );
        assert_eq!(exact.len(), 1);
        assert_eq!(exact[0].id, variant.id);
        assert!(
            index
                .candidate_styles(
                    &StyleQuery {
                        include_variants: false,
                        ..StyleQuery::default()
                    },
                    "defaults",
                    16
                )
                .iter()
                .all(|entry| entry.variant_id == "default")
        );
    }

    #[test]
    fn simple_fallback_extends_native_order_without_retrying_pins_or_sources() {
        use crate::programme::{ArchitectureProgramme, ProgrammeComposition};
        let index = style_index().unwrap();
        let query = StyleQuery {
            pack_id: Some("MED-ANT".into()),
            ..StyleQuery::default()
        };
        let config = HouseConfig {
            pack: "MED-ANT".into(),
            count: 1,
            overrides: crate::model::Overrides {
                floors: Some(1),
                ..Default::default()
            },
            ..HouseConfig::default()
        };
        let programme = ArchitectureProgramme {
            composition: Some(ProgrammeComposition::Row),
            floors: Some([1, 2]),
            built_area_m2: Some(99.3),
            ..Default::default()
        };
        // Captured R5 seed, with an explicit single-level constraint. This
        // excludes the newer two-level B12 while retaining the missing-simple
        // case; it is no longer presented as the unmodified captured request.
        let seed = "city-mountain-bay-s/layout-f9dab5910f08a8a2/block-0d3568179998c859/parcel-d85568ded9431341";
        let first = index
            .candidate_styles_for_programme(&query, &config, seed, 4, &programme)
            .unwrap();
        assert_eq!(first.len(), 4);
        assert!(
            first
                .iter()
                .all(|entry| !simple_rectangle_source(entry, &config))
        );
        let attempted: Vec<_> = first.iter().map(|entry| entry.recipe_id).collect();
        let fallback = index
            .simple_fallback_for_programme(&query, &config, seed, &programme, &attempted)
            .unwrap()
            .unwrap();
        assert!(simple_rectangle_source(fallback, &config));
        assert!(!attempted.contains(&fallback.recipe_id));
        assert!(fallback.constraints.floors[0] <= 1);
        let full = index
            .candidate_styles_for_programme(&query, &config, seed, usize::MAX, &programme)
            .unwrap();
        let next_simple = full[4..]
            .iter()
            .find(|entry| simple_rectangle_source(entry, &config))
            .unwrap();
        assert_eq!(fallback.id, next_simple.id);
        assert_eq!(
            first.iter().map(|e| &e.id).collect::<Vec<_>>(),
            full[..4].iter().map(|e| &e.id).collect::<Vec<_>>()
        );

        // Changing seed retains the native coherent variant draw. If a simple
        // source was already attempted, no other variant is tried afterward.
        let mut variants = BTreeSet::new();
        for i in 0..128 {
            let seed = format!("simple-fallback-{i}");
            let first = index
                .candidate_styles_for_programme(&query, &config, &seed, 4, &programme)
                .unwrap();
            let attempted: Vec<_> = first.iter().map(|e| e.recipe_id).collect();
            let fallback = index
                .simple_fallback_for_programme(&query, &config, &seed, &programme, &attempted)
                .unwrap();
            if first
                .iter()
                .any(|entry| simple_rectangle_source(entry, &config))
            {
                assert!(fallback.is_none());
            } else {
                let fallback = fallback.unwrap();
                let full = index
                    .candidate_styles_for_programme(&query, &config, &seed, usize::MAX, &programme)
                    .unwrap();
                assert_eq!(
                    fallback.id,
                    full[4..]
                        .iter()
                        .find(|entry| simple_rectangle_source(entry, &config))
                        .unwrap()
                        .id
                );
                assert!(!attempted.contains(&fallback.recipe_id));
                variants.insert(fallback.variant_id);
            }
        }
        assert!(
            variants.len() > 1,
            "fallback must preserve seeded variant diversity"
        );

        // With the current unrestricted palette a simple source is already
        // selected for this seed. Even another eligible simple source must not
        // produce a fifth retry after those four attempts.
        let unrestricted = HouseConfig {
            overrides: Default::default(),
            ..config.clone()
        };
        let current = index
            .candidate_styles_for_programme(&query, &unrestricted, seed, 4, &programme)
            .unwrap();
        assert!(
            current
                .iter()
                .any(|entry| simple_rectangle_source(entry, &unrestricted))
        );
        let current_attempted: Vec<_> = current.iter().map(|entry| entry.recipe_id).collect();
        assert!(
            index
                .simple_fallback_for_programme(
                    &query,
                    &unrestricted,
                    seed,
                    &programme,
                    &current_attempted,
                )
                .unwrap()
                .is_none()
        );

        let mut pinned = config.clone();
        pinned.recipe = Some("MED-ANT-B01".into());
        assert!(
            index
                .simple_fallback_for_programme(&query, &pinned, seed, &programme, &attempted)
                .unwrap()
                .is_none()
        );
        pinned.recipe = None;
        pinned.overrides.variant = Some("flat_earth".into());
        assert!(
            index
                .simple_fallback_for_programme(&query, &pinned, seed, &programme, &attempted)
                .unwrap()
                .is_none()
        );
        let court = ArchitectureProgramme {
            composition: Some(ProgrammeComposition::Courtyard),
            ..programme.clone()
        };
        assert!(
            index
                .simple_fallback_for_programme(&query, &config, seed, &court, &attempted)
                .unwrap()
                .is_none()
        );
        assert!(
            index
                .simple_fallback_for_programme(&query, &config, seed, &programme, &attempted[..3])
                .unwrap()
                .is_none()
        );
        let defaults = StyleQuery {
            include_variants: false,
            ..query.clone()
        };
        assert_eq!(
            index
                .simple_fallback_for_programme(&defaults, &config, seed, &programme, &attempted)
                .unwrap()
                .unwrap()
                .variant_id,
            "default"
        );
        let mut three_floors = config.clone();
        three_floors.overrides.floors = Some(3);
        assert!(
            index
                .simple_fallback_for_programme(&query, &three_floors, seed, &programme, &attempted)
                .unwrap()
                .is_none()
        );
        let foreign = StyleQuery {
            tradition_id: Some("javanese".into()),
            ..query.clone()
        };
        assert!(
            index
                .simple_fallback_for_programme(&foreign, &config, seed, &programme, &attempted)
                .is_err()
        );
        let wrong_era = StyleQuery {
            era: "M".into(),
            ..query
        };
        assert!(
            index
                .simple_fallback_for_programme(&wrong_era, &config, seed, &programme, &attempted)
                .is_err()
        );
    }

    #[test]
    fn nominal_budget_prefers_known_capacity_without_moving_complexes_or_redrawing_variants() {
        use crate::programme::ArchitectureProgramme;
        let index = style_index().unwrap();
        let query = StyleQuery {
            pack_id: Some("MED-ANT".into()),
            ..StyleQuery::default()
        };
        let config = HouseConfig {
            pack: "MED-ANT".into(),
            ..HouseConfig::default()
        };
        // No composition/floor preference: all sources share one rank group,
        // so interleaved complex sources exercise slot preservation directly.
        let programme = ArchitectureProgramme {
            built_area_m2: Some(99.3),
            ..Default::default()
        };
        let ids =
            |entries: &[&StyleEntry]| entries.iter().map(|e| e.id.clone()).collect::<Vec<_>>();
        let mut b01_variants = BTreeSet::new();
        let mut small_target_b12_precedes_b01 = false;
        for i in 0..32 {
            let seed = format!("nominal-roman-{i}");
            let native = index
                .candidate_styles_for_config(&query, &config, &seed, usize::MAX)
                .unwrap();
            let preferred = index
                .candidate_styles_for_programme(&query, &config, &seed, usize::MAX, &programme)
                .unwrap();
            let position = |entries: &[&StyleEntry], recipe| {
                entries.iter().position(|e| e.recipe_id == recipe).unwrap()
            };
            assert!(position(&preferred, "MED-ANT-B01") < position(&preferred, "MED-ANT-B12"));
            assert_eq!(
                ids(&native).into_iter().collect::<BTreeSet<_>>(),
                ids(&preferred).into_iter().collect()
            );
            for (slot, entry) in native.iter().enumerate() {
                if nominal_body_area_range(entry, &config).is_none() {
                    assert_eq!(preferred[slot].id, entry.id, "Complex/unknown slot changed");
                }
                assert_eq!(
                    preferred
                        .iter()
                        .find(|e| e.recipe_id == entry.recipe_id)
                        .unwrap()
                        .variant_id,
                    entry.variant_id,
                    "A nominal wish must not redraw the source variant"
                );
            }
            b01_variants.insert(preferred[position(&preferred, "MED-ANT-B01")].variant_id);
            assert_eq!(
                ids(&preferred[..4]),
                ids(&index
                    .candidate_styles_for_programme(&query, &config, &seed, 4, &programme)
                    .unwrap())
            );
            assert_eq!(
                ids(&preferred),
                ids(&index
                    .candidate_styles_for_programme(&query, &config, &seed, usize::MAX, &programme)
                    .unwrap())
            );

            // Both sources' nominal ranges contain 50m2. Neither is removed or
            // always favoured, and the native seed order is retained exactly.
            let small = ArchitectureProgramme {
                built_area_m2: Some(50.),
                ..Default::default()
            };
            let small_order = index
                .candidate_styles_for_programme(&query, &config, &seed, usize::MAX, &small)
                .unwrap();
            assert_eq!(ids(&native), ids(&small_order));
            small_target_b12_precedes_b01 |=
                position(&small_order, "MED-ANT-B12") < position(&small_order, "MED-ANT-B01");
        }
        assert!(
            b01_variants.len() > 1,
            "Source variant diversity must remain seeded"
        );
        assert!(
            small_target_b12_precedes_b01,
            "B12 remains selectable first for small targets"
        );

        let b01 = index.get("MED-ANT-B01::default").unwrap();
        let b12 = index.get("MED-ANT-B12::default").unwrap();
        assert_eq!(nominal_body_area_range(b01, &config), Some([35., 108.]));
        assert_eq!(nominal_body_area_range(b12, &config), Some([31.5, 71.5]));
        assert_eq!(
            nominal_body_area_range(b12, &HouseConfig { size: 2., ..config }),
            Some([126., 286.])
        );
    }

    #[test]
    fn nominal_budget_keeps_strict_pins_overrides_no_target_and_context_route_unchanged() {
        use crate::programme::{ArchitectureProgramme, ProgrammeComposition};
        let index = style_index().unwrap();
        let query = StyleQuery {
            pack_id: Some("MED-ANT".into()),
            include_variants: false,
            ..Default::default()
        };
        let config = HouseConfig {
            pack: "MED-ANT".into(),
            ..Default::default()
        };
        let programme = ArchitectureProgramme {
            built_area_m2: Some(99.3),
            ..Default::default()
        };
        let seed = "roman-budget";
        let ids = |entries: Vec<&StyleEntry>| {
            entries
                .into_iter()
                .map(|e| e.id.clone())
                .collect::<Vec<_>>()
        };
        for control in [
            "strict",
            "fantasy",
            "recipe",
            "variant",
            "floors",
            "query-pin",
            "manual",
        ] {
            let mut q = query.clone();
            let mut c = config.clone();
            match control {
                "strict" => {
                    c.mode = HistoricalMode::HistoricalStrict;
                    q.mode = c.mode;
                }
                "fantasy" => {
                    c.mode = HistoricalMode::FantasyMix;
                    q.mode = c.mode;
                }
                "recipe" => c.recipe = Some("MED-ANT-B12".into()),
                "variant" => {
                    c.recipe = Some("MED-ANT-B12".into());
                    c.overrides.variant = Some("default".into());
                }
                "floors" => c.overrides.floors = Some(2),
                "query-pin" => q.recipe_id = Some("MED-ANT-B12".into()),
                "manual" => q.automatic = false,
                _ => unreachable!(),
            }
            assert_eq!(
                ids(index
                    .candidate_styles_for_programme(&q, &c, seed, usize::MAX, &programme)
                    .unwrap()),
                ids(index
                    .candidate_styles_for_config(&q, &c, seed, usize::MAX)
                    .unwrap()),
                "{control}"
            );
        }
        let native = ids(index
            .candidate_styles_for_config(&query, &config, seed, usize::MAX)
            .unwrap());
        assert_eq!(
            native,
            ids(index
                .candidate_styles_for_programme(
                    &query,
                    &config,
                    seed,
                    usize::MAX,
                    &ArchitectureProgramme::default()
                )
                .unwrap())
        );
        // With x2 experimental bounds both simples have rank zero. Supplying
        // context must keep this old weighted order, not enable nominal ranks.
        let context = AutomaticSelectionContext {
            parcel_fit: true,
            available_body_area_m2: None,
        };
        assert_eq!(
            native,
            ids(index
                .candidate_styles_for_programme_with_context(
                    &query,
                    &config,
                    seed,
                    usize::MAX,
                    &programme,
                    Some(&context)
                )
                .unwrap())
        );

        let court = ArchitectureProgramme {
            composition: Some(ProgrammeComposition::Courtyard),
            ..programme.clone()
        };
        let court_without_target = ArchitectureProgramme {
            built_area_m2: None,
            ..court.clone()
        };
        let preferred = index
            .candidate_styles_for_programme(&query, &config, seed, usize::MAX, &court)
            .unwrap();
        let previous = index
            .candidate_styles_for_programme(
                &query,
                &config,
                seed,
                usize::MAX,
                &court_without_target,
            )
            .unwrap();
        // Soft composition outranks this local preference: every complex keeps
        // its previous slot, including the preferred courts at the front.
        for (slot, entry) in previous.iter().enumerate() {
            if nominal_body_area_range(entry, &config).is_none() {
                assert_eq!(preferred[slot].id, entry.id);
            }
        }
        assert_eq!(preferred[0].typology, ArchitectureTypology::Courtyard);
    }

    #[test]
    fn row_residential_nominal_quality_precedes_soft_composition_without_redrawing() {
        use crate::programme::{ArchitectureProgramme, ProgrammeComposition};
        let index = style_index().unwrap();
        let query = StyleQuery {
            pack_id: Some("MED-ANT".into()),
            ..Default::default()
        };
        let config = HouseConfig {
            pack: "MED-ANT".into(),
            ..Default::default()
        };
        let ids =
            |entries: &[&StyleEntry]| entries.iter().map(|e| e.id.clone()).collect::<Vec<_>>();
        let mut dwelling_variants = BTreeSet::new();
        for (role, target, floors, expected_role, expected_minimum) in [
            ("dwelling.house", 99.3, [1, 2], Role::Dwelling, None),
            (
                "dwelling.tenement",
                24.8,
                [2, 2],
                Role::MixedResidential,
                Some(31.5),
            ),
        ] {
            let programme = ArchitectureProgramme {
                role: Some(role.into()),
                composition: Some(ProgrammeComposition::Row),
                floors: Some(floors),
                built_area_m2: Some(target),
                ..Default::default()
            };
            let without_role = ArchitectureProgramme {
                role: None,
                ..programme.clone()
            };
            for n in 0..24 {
                let seed = format!("residential-nominal-{n}");
                let before = index
                    .candidate_styles_for_programme(
                        &query,
                        &config,
                        &seed,
                        usize::MAX,
                        &without_role,
                    )
                    .unwrap();
                let after = index
                    .candidate_styles_for_programme(&query, &config, &seed, usize::MAX, &programme)
                    .unwrap();
                assert_eq!(
                    ids(&before).into_iter().collect::<BTreeSet<_>>(),
                    ids(&after).into_iter().collect(),
                    "No source or variant was replaced"
                );
                assert_eq!(
                    after.len(),
                    after
                        .iter()
                        .map(|e| e.recipe_id)
                        .collect::<BTreeSet<_>>()
                        .len()
                );
                for (slot, entry) in before.iter().enumerate() {
                    if residential_nominal_body_area(entry, &config).is_none() {
                        assert_eq!(after[slot].id, entry.id, "Complex/unknown slot moved");
                    }
                    assert_eq!(
                        programme.rank(entry, &config).1,
                        programme.rank(after[slot], &config).1,
                        "Floor-preference groups must not cross"
                    );
                }
                let first = after
                    .iter()
                    .find(|e| {
                        residential_nominal_body_area(e, &config).is_some()
                            && programme.rank(e, &config).1 == 0
                    })
                    .unwrap();
                assert_eq!(first.role, expected_role);
                let range = residential_nominal_body_area(first, &config).unwrap();
                if let Some(minimum) = expected_minimum {
                    assert_eq!(range[0], minimum);
                    assert!(
                        range[0] > target * 1.1,
                        "The small target remains unmet, not certified"
                    );
                } else {
                    assert!(range[0] <= target && target <= range[1]);
                    dwelling_variants.insert(first.id.clone());
                }
                assert_eq!(
                    ids(&after[..4]),
                    ids(&index
                        .candidate_styles_for_programme(&query, &config, &seed, 4, &programme)
                        .unwrap())
                );
                // An already ordered list must stay byte-for-byte in the same
                // order; stable ties never consume another source/variant draw.
                let mut repeated = after.clone();
                prefer_residential_nominal_budget(
                    &mut repeated,
                    &config,
                    &programme,
                    ResidentialIntent::from_programme(&programme).unwrap(),
                    target,
                );
                assert_eq!(ids(&after), ids(&repeated));
            }
        }
        assert!(
            dwelling_variants.len() > 1,
            "Existing variant diversity remains seeded"
        );
        let strip = index.get("MED-ANT-B13::default").unwrap();
        assert_eq!(
            residential_nominal_body_area(strip, &config),
            Some([39.375, 118.125])
        );
        assert_eq!(
            residential_nominal_body_area(strip, &HouseConfig { size: 2., ..config }),
            Some([176.25, 506.25]),
            "The native passage is 1.25m, not scaled with size"
        );
    }

    #[test]
    fn row_residential_preference_preserves_explicit_and_uncovered_routes() {
        use crate::programme::{ArchitectureProgramme, ProgrammeComposition};
        let index = style_index().unwrap();
        let query = StyleQuery {
            pack_id: Some("MED-ANT".into()),
            ..Default::default()
        };
        let config = HouseConfig {
            pack: "MED-ANT".into(),
            ..Default::default()
        };
        let programme = ArchitectureProgramme {
            role: Some("dwelling.house".into()),
            composition: Some(ProgrammeComposition::Row),
            floors: Some([1, 2]),
            built_area_m2: Some(99.3),
            ..Default::default()
        };
        let context = AutomaticSelectionContext {
            parcel_fit: true,
            available_body_area_m2: None,
        };
        for control in [
            "strict",
            "fantasy",
            "recipe",
            "variant",
            "floors",
            "query-pin",
            "manual",
            "no-target",
            "court",
            "other-role",
            "context",
        ] {
            let mut q = query.clone();
            let mut c = config.clone();
            let mut p = programme.clone();
            match control {
                "strict" => {
                    c.mode = HistoricalMode::HistoricalStrict;
                    q.mode = c.mode;
                }
                "fantasy" => {
                    c.mode = HistoricalMode::FantasyMix;
                    q.mode = c.mode;
                }
                "recipe" => c.recipe = Some("MED-ANT-B12".into()),
                "variant" => {
                    c.recipe = Some("MED-ANT-B12".into());
                    c.overrides.variant = Some("default".into());
                }
                "floors" => c.overrides.floors = Some(2),
                "query-pin" => q.recipe_id = Some("MED-ANT-B12".into()),
                "manual" => q.automatic = false,
                "no-target" => p.built_area_m2 = None,
                "court" => p.composition = Some(ProgrammeComposition::Courtyard),
                "other-role" => p.role = Some("commerce.shop".into()),
                "context" => (),
                _ => unreachable!(),
            }
            let without_role = ArchitectureProgramme {
                role: None,
                ..p.clone()
            };
            let ctx = (control == "context").then_some(&context);
            let ids = |p: &ArchitectureProgramme| {
                index
                    .candidate_styles_for_programme_with_context(
                        &q,
                        &c,
                        "residential-controls",
                        4,
                        p,
                        ctx,
                    )
                    .unwrap()
                    .into_iter()
                    .map(|e| e.id.clone())
                    .collect::<Vec<_>>()
            };
            assert_eq!(ids(&p), ids(&without_role), "{control}");
        }
    }

    #[test]
    fn optional_budget_ranking_is_conservative_and_keeps_unknown_styles() {
        use crate::programme::{ArchitectureProgramme, ProgrammeComposition};
        let index = style_index().unwrap();
        let query = StyleQuery {
            pack_id: Some("MED-ANT".into()),
            include_variants: false,
            ..StyleQuery::default()
        };
        let config = HouseConfig {
            pack: "MED-ANT".into(),
            ..HouseConfig::default()
        };
        let programme = ArchitectureProgramme {
            composition: Some(ProgrammeComposition::Detached),
            floors: Some([1, 2]),
            built_area_m2: Some(496.4),
            ..Default::default()
        };
        let context = AutomaticSelectionContext {
            parcel_fit: true,
            available_body_area_m2: Some(1000.),
        };
        let small = index.get("MED-ANT-B01::default").unwrap();
        let complex = index.get("MED-ANT-B04::default").unwrap();
        assert_eq!(maximum_body_area(small, &config, &context), Some(432.));
        assert_eq!(maximum_body_area(complex, &config, &context), None);
        assert_eq!(
            programme_budget_rank(small, &config, &programme, Some(&context)),
            1
        );
        assert_eq!(
            programme_budget_rank(complex, &config, &programme, Some(&context)),
            0
        );
        let ids = |entries: Vec<&StyleEntry>| {
            entries
                .into_iter()
                .map(|e| e.id.clone())
                .collect::<Vec<_>>()
        };
        let legacy = ids(index
            .candidate_styles_for_programme(&query, &config, "roman-budget", usize::MAX, &programme)
            .unwrap());
        let position =
            |entries: &[String], id: &str| entries.iter().position(|entry| entry == id).unwrap();
        assert!(position(&legacy, &small.id) < position(&legacy, &complex.id));
        let ranked = ids(index
            .candidate_styles_for_programme_with_context(
                &query,
                &config,
                "roman-budget",
                usize::MAX,
                &programme,
                Some(&context),
            )
            .unwrap());
        assert!(position(&ranked, &complex.id) < position(&ranked, &small.id));
        let budget_ranks: Vec<_> = ranked
            .iter()
            .map(|id| {
                programme_budget_rank(index.get(id).unwrap(), &config, &programme, Some(&context))
            })
            .collect();
        assert!(budget_ranks.windows(2).all(|pair| pair[0] <= pair[1]));
        assert_eq!(
            ranked.iter().collect::<BTreeSet<_>>(),
            legacy.iter().collect::<BTreeSet<_>>()
        );
        assert!(ranked.iter().any(|id| id == "MED-ANT-B04::default"));
        assert_eq!(
            ranked,
            ids(index
                .candidate_styles_for_programme_with_context(
                    &query,
                    &config,
                    "roman-budget",
                    usize::MAX,
                    &programme,
                    Some(&context),
                )
                .unwrap())
        );
        assert_eq!(
            legacy,
            ids(index
                .candidate_styles_for_programme_with_context(
                    &query,
                    &config,
                    "roman-budget",
                    usize::MAX,
                    &programme,
                    None,
                )
                .unwrap())
        );

        // A target within every covered upper bound is not a placement success;
        // it only removes all penalties, reproducing the existing seeded order.
        // B12's upper bound is smaller than B01's, so 400 m2 no longer does so.
        let smaller = ArchitectureProgramme {
            built_area_m2: Some(250.),
            ..programme.clone()
        };
        assert_eq!(
            programme_budget_rank(small, &config, &smaller, Some(&context)),
            0
        );
        assert_eq!(
            legacy,
            ids(index
                .candidate_styles_for_programme_with_context(
                    &query,
                    &config,
                    "roman-budget",
                    usize::MAX,
                    &smaller,
                    Some(&context),
                )
                .unwrap())
        );
        assert_eq!(
            maximum_body_area(
                small,
                &config,
                &AutomaticSelectionContext {
                    parcel_fit: false,
                    ..context
                }
            ),
            Some(108.)
        );
        assert_eq!(
            maximum_body_area(
                small,
                &config,
                &AutomaticSelectionContext {
                    available_body_area_m2: Some(75.),
                    ..context
                }
            ),
            Some(75.)
        );
        let strict = HouseConfig {
            mode: HistoricalMode::HistoricalStrict,
            ..config.clone()
        };
        assert_eq!(maximum_body_area(small, &strict, &context), Some(108.));
        let mut explicit_shape = config.clone();
        explicit_shape.overrides.footprint = Some("FP-L".into());
        assert_eq!(maximum_body_area(small, &explicit_shape, &context), None);

        // A pinned source remains the source even when its budget is too small.
        let pinned = HouseConfig {
            recipe: Some(small.recipe_id.into()),
            ..config.clone()
        };
        assert_eq!(
            ids(index
                .candidate_styles_for_programme_with_context(
                    &query,
                    &pinned,
                    "roman-budget",
                    4,
                    &programme,
                    Some(&context),
                )
                .unwrap()),
            vec![small.id.clone()]
        );
    }

    #[test]
    fn explicit_floors_filter_before_the_four_style_budget_without_replacing_pins() {
        let index = style_index().unwrap();
        let query = StyleQuery {
            pack_id: Some("EUR-MED".into()),
            ..StyleQuery::default()
        };
        let mut config = HouseConfig {
            pack: "EUR-MED".into(),
            ..HouseConfig::default()
        };
        config.overrides.floors = Some(3);
        let compatible = index
            .candidate_styles_for_config(&query, &config, "city-floor-3", usize::MAX)
            .unwrap();
        assert!(compatible.len() >= 4);
        assert!(
            compatible.iter().all(|entry| {
                entry.recipe_id != "EUR-MED-B01" && entry.recipe_id != "EUR-MED-B07"
            })
        );
        for seed in ["city-floor-3", "narrow-plot", "wealthy-quarter"] {
            let selected = index
                .candidate_styles_for_config(&query, &config, seed, 4)
                .unwrap();
            assert_eq!(selected.len(), 4);
            assert_eq!(
                selected
                    .iter()
                    .map(|entry| entry.recipe_id)
                    .collect::<BTreeSet<_>>()
                    .len(),
                4
            );
            for entry in selected {
                let resolved = catalogue()
                    .unwrap()
                    .resolve_variant_parameters(entry.recipe(), &config, entry.variant_id)
                    .unwrap();
                assert_eq!(resolved.floors, [3, 3]);
                explicit_component_constraints(&resolved, &config).unwrap();
            }
        }
        // Without an explicit floor request these source bundles remain eligible.
        let mut unpinned = config.clone();
        unpinned.overrides.floors = None;
        let natural = index
            .candidate_styles_for_config(&query, &unpinned, "source", usize::MAX)
            .unwrap();
        assert!(natural.iter().any(|entry| entry.recipe_id == "EUR-MED-B01"));
        assert!(natural.iter().any(|entry| entry.recipe_id == "EUR-MED-B07"));

        // The B07 parent envelope includes a tower; it does not permit three
        // floors in the explicitly authored main_house component.
        let mut pinned = config.clone();
        pinned.recipe = Some("EUR-MED-B07".into());
        pinned.overrides.variant = Some("default".into());
        let error = index
            .candidate_styles_for_config(&query, &pinned, "pin", 4)
            .unwrap_err();
        assert!(error.contains("main_house"), "{error}");
        pinned.recipe = Some("EUR-MED-B02".into());
        let exact = index
            .candidate_styles_for_config(&query, &pinned, "pin", 4)
            .unwrap();
        assert_eq!(exact.len(), 1);
        assert_eq!(exact[0].id, "EUR-MED-B02::default");
        pinned.overrides.variant = Some("missing-source-variant".into());
        assert!(
            index
                .candidate_styles_for_config(&query, &pinned, "pin", 4)
                .is_err()
        );
        pinned.overrides.variant = Some("default".into());
        pinned.size = 1.5;
        assert!(
            index
                .candidate_styles_for_config(&query, &pinned, "pin", 4)
                .is_err()
        );
    }
}
