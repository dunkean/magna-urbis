//! Explicit atlas recipes and compatibility rules, shared by native and WASM.
use crate::model::{HistoricalMode, HouseConfig, MaterialSlots, Role, RoofSpec};
use serde::{Deserialize, Serialize};
use std::sync::OnceLock;

#[derive(Clone, Debug, Serialize, Deserialize)]
pub struct SourceDigest {
    pub path: String,
    pub sha256: String,
}

#[derive(Clone, Debug, Serialize, Deserialize)]
pub struct SourceReference {
    pub path: String,
    pub line: u32,
}

#[derive(Clone, Debug, Serialize, Deserialize)]
pub struct Pack {
    pub id: String,
    pub label: String,
    pub source_line: u32,
    pub eras: Vec<String>,
    pub confidence: String,
    pub sources: Vec<String>,
}

#[derive(Clone, Debug, Serialize, Deserialize)]
pub struct Material {
    pub id: String,
    pub label: String,
    pub roles: Vec<String>,
    pub pattern: String,
    #[serde(default = "atlas_material_origin")]
    pub origin: String,
    #[serde(default)]
    pub source_ref: Option<String>,
}
fn atlas_material_origin() -> String {
    "atlas".into()
}

#[derive(Clone, Debug, Serialize, Deserialize)]
pub struct Temporal {
    pub eras: Vec<String>,
    pub tradition_long: bool,
    pub late_only: bool,
    pub from_year: Option<i32>,
    pub to_year: Option<i32>,
}

#[derive(Clone, Copy, Debug, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "snake_case")]
pub enum Layout {
    Single,
    Strip,
    Courtyard,
    Peristyle,
    Atrium,
    IwanCourt,
    Siheyuan,
    Kancha,
    HutCompound,
    Kraal,
    Multiyard,
    Pueblo,
    GreatHouse,
    Ring,
    Cliff,
    Excavated,
    Platform,
    Parallel,
    Bridge,
    Additive,
    Broch,
    Shinden,
    HighHall,
}

#[derive(Clone, Copy, Debug, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "snake_case")]
pub enum Envelope {
    Walled,
    Open,
    Shell,
    Rockcut,
    Membrane,
}

#[derive(Clone, Copy, Debug, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "snake_case")]
pub enum EnclosureFamily {
    None,
    EarthWall,
    StoneWall,
    TimberPalisade,
    ThornFence,
}

#[derive(Clone, Copy, Debug, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "snake_case")]
pub enum VerticalAccess {
    None,
    InternalStair,
    ExteriorStair,
    Ladder,
    RoofHatch,
    IntramuralStair,
}

#[derive(Clone, Copy, Debug, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "snake_case")]
pub enum SupportKind {
    Ground,
    Posts,
    Piers,
    Raft,
    Rock,
}

#[derive(Clone, Copy, Debug, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "snake_case")]
pub enum Placement {
    Main,
    North,
    South,
    East,
    West,
    Peripheral,
    Adjacent,
    Central,
    Courtyard,
    Rear,
    FacingMain,
    AlongFront,
}

#[derive(Clone, Debug, Serialize, Deserialize, PartialEq)]
pub struct Support {
    pub kind: SupportKind,
    pub material: Option<String>,
    pub height_m: [f64; 2],
}

#[derive(Clone, Debug, Serialize, Deserialize)]
pub struct LevelMaterial {
    pub from_level: u32,
    pub to_level: u32,
    pub materials: MaterialSlots,
}

#[derive(Clone, Debug, Serialize, Deserialize, PartialEq)]
pub struct VerticalRoute {
    pub kind: VerticalAccess,
    pub from_level: u32,
    pub to_level: u32,
    pub placement: Placement,
    pub min_width_m: f64,
}

#[derive(Clone, Debug, Serialize, Deserialize)]
pub struct EnclosureSpec {
    pub family: EnclosureFamily,
    pub placement: Placement,
    pub gate_width_m: f64,
}

#[derive(Clone, Debug, Serialize, Deserialize)]
pub struct ShellSpec {
    pub outer_wall_m: f64,
    pub gallery_m: f64,
    pub inner_wall_m: f64,
    pub inner_diameter_m: f64,
}

#[derive(Clone, Debug, Serialize, Deserialize)]
pub struct Component {
    pub id: String,
    pub role: Role,
    pub count: [u32; 2],
    pub footprint_family: String,
    pub roof_system: String,
    pub roof_spec: RoofSpec,
    pub roof_pitch_deg: [f64; 2],
    pub overhang_m: [f64; 2],
    pub materials: MaterialSlots,
    pub structure_system: String,
    pub envelope: Envelope,
    pub placement: Placement,
    pub width_ratio: [f64; 2],
    pub depth_ratio: [f64; 2],
    pub floors: [u32; 2],
    pub level_height_m: f64,
    pub rooms_per_body: [u32; 2],
    pub vertical_access: VerticalAccess,
    pub vertical_routes: Vec<VerticalRoute>,
    pub support: Support,
    pub level_materials: Vec<LevelMaterial>,
    pub wall_thickness_m: [f64; 2],
    pub courtyard_ratio: [f64; 2],
}

/// Declared graphical defaults for auxiliary covers; domains/supports are resolved by layout.
#[derive(Clone, Debug, Serialize, Deserialize)]
pub struct GalleryCover {
    pub enabled: bool,
    pub rf: String,
    pub spec: RoofSpec,
    pub height_m: f64,
    pub width_m: f64,
    pub pitch_deg: f64,
    pub max_span_m: f64,
    pub support_spacing_m: f64,
}

#[derive(Clone, Debug, Serialize, Deserialize)]
pub struct DetailSpec {
    pub confidence: String,
    pub floor_material: String,
    pub floor_thickness_m: f64,
    pub flue_material: String,
    pub flue_width_m: f64,
    pub flue_depth_m: f64,
    pub rope_material: Option<String>,
    pub rope_diameter_m: f64,
    pub rope_anchor_extension_ratio: f64,
    pub diagonal_lean_ratio: f64,
    pub window_sill_m: f64,
    pub window_height_m: f64,
    pub window_width_m: f64,
    pub narrow_window_width_m: f64,
}

#[derive(Clone, Copy, Debug, Serialize, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "snake_case")]
pub enum CourtTopology {
    Axial,
    Grid,
}

#[derive(Clone, Debug, Serialize, Deserialize)]
#[serde(deny_unknown_fields)]
pub struct CourtSpec {
    pub rank: u32,
    pub ratio: f64,
    pub aspect: f64,
}

#[derive(Clone, Debug, Serialize, Deserialize)]
#[serde(deny_unknown_fields)]
pub struct ThresholdSpec {
    pub width_m: f64,
    pub wall_m: f64,
    pub height_m: f64,
    pub material: String,
}

#[derive(Clone, Debug, Serialize, Deserialize)]
#[serde(deny_unknown_fields)]
pub struct IwanSpec {
    pub count: u32,
    pub min_open_ratio: f64,
    pub bearing_ratio: f64,
}

#[derive(Clone, Debug, Serialize, Deserialize)]
#[serde(deny_unknown_fields)]
pub struct PorticoSpec {
    pub span_m: f64,
    pub post_m: f64,
}

#[derive(Clone, Debug, Serialize, Deserialize)]
#[serde(deny_unknown_fields)]
pub struct HallSpec {
    pub height_m: f64,
    pub depth_m: f64,
}

#[derive(Clone, Debug, Serialize, Deserialize)]
#[serde(deny_unknown_fields)]
pub struct CourtProgram {
    pub courts: Vec<CourtSpec>,
    pub topology: CourtTopology,
    pub threshold: ThresholdSpec,
    pub iwans: Option<IwanSpec>,
    pub compartments: u32,
    pub portico: Option<PorticoSpec>,
    pub north_hall: Option<HallSpec>,
    pub body_footprint: Option<String>,
    pub confidence: String,
}

#[derive(Clone, Copy, Debug, Serialize, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "snake_case")]
pub enum PortalShape {
    Rect,
    Trapezoid,
}

#[derive(Clone, Copy, Debug, Serialize, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "snake_case")]
pub enum PortalPlacement {
    Axial,
    Court,
    Distributed,
    Differentiated,
}

#[derive(Clone, Debug, Serialize, Deserialize)]
#[serde(deny_unknown_fields)]
pub struct PortalProfile {
    pub entries: Vec<PortalSpec>,
    pub count: [u32; 2],
    pub placement: PortalPlacement,
    pub confidence: String,
}

#[derive(Clone, Debug, Serialize, Deserialize)]
#[serde(deny_unknown_fields)]
pub struct PortalSpec {
    pub id: String,
    pub shape: PortalShape,
    pub width_m: f64,
    pub top_width_m: f64,
    pub head_m: f64,
    pub sill_m: f64,
    pub min_clear_height_m: f64,
}

#[derive(Clone, Copy, Debug, Serialize, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "snake_case")]
pub enum StructureWallRole {
    Exterior,
    Enclosure,
    Shell,
    Base,
}

#[derive(Clone, Debug, Serialize, Deserialize)]
#[serde(deny_unknown_fields)]
pub struct WallProfile {
    pub role: StructureWallRole,
    pub min_thickness_m: f64,
    pub min_height_m: f64,
    pub material: Option<String>,
    pub from_level: u32,
    pub to_level: u32,
}

#[derive(Clone, Debug, Serialize, Deserialize)]
#[serde(deny_unknown_fields)]
pub struct LightwellSpec {
    pub count: u32,
    pub width_m: f64,
    pub depth_m: f64,
    pub border_m: f64,
    pub material: String,
}

#[derive(Clone, Debug, Serialize, Deserialize)]
#[serde(deny_unknown_fields)]
pub struct BankSpec {
    pub width_m: f64,
    pub height_m: f64,
    pub material: String,
    pub base_depth_m: f64,
    pub gate_width_m: f64,
}

#[derive(Clone, Debug, Serialize, Deserialize)]
#[serde(deny_unknown_fields)]
pub struct InnerTentSpec {
    pub width_ratio: f64,
    pub depth_ratio: f64,
    pub wall_height_m: f64,
    pub roof_rise_m: f64,
    pub membrane_material: String,
    pub frame_material: String,
    pub door_width_m: f64,
    pub door_height_m: f64,
    pub membrane_thickness_m: f64,
    pub post_width_m: f64,
    pub post_spacing_m: f64,
}

#[derive(Clone, Debug, Serialize, Deserialize)]
#[serde(deny_unknown_fields)]
pub struct MooringSpec {
    pub count: u32,
    pub material: String,
    pub diameter_m: f64,
    pub anchor_offset_m: f64,
    pub anchor_depth_m: f64,
    pub anchor_material: String,
    pub anchor_width_m: f64,
    pub anchor_height_m: f64,
}

#[derive(Clone, Debug, Serialize, Deserialize)]
#[serde(deny_unknown_fields)]
pub struct IslandSpec {
    pub height_m: f64,
    pub water_depth_m: f64,
    pub pile_depth_m: f64,
    pub margin_m: f64,
    pub pile_spacing_m: f64,
    pub canal_width_m: f64,
    pub garden_ratio: f64,
    pub material: String,
    pub pile_material: String,
}

#[derive(Clone, Debug, Serialize, Deserialize)]
#[serde(deny_unknown_fields)]
pub struct RetainingSpec {
    pub thickness_m: f64,
    pub material: String,
    pub terrain_slope_deg: f64,
    pub terrace_rise_m: f64,
    pub base_depth_m: f64,
}

#[derive(Clone, Copy, Debug, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "snake_case")]
pub enum TerraceCoreDoor {
    Forbid,
    Declared,
}

#[derive(Clone, Debug, Serialize, Deserialize)]
#[serde(deny_unknown_fields)]
pub struct HighHallSpec {
    pub core_level_height_m: f64,
    pub wing_order: Vec<Placement>,
    pub passage_width_m: f64,
    pub joint_overhang_m: f64,
    pub terrace_core_door: TerraceCoreDoor,
    pub confidence: String,
}

#[derive(Clone, Debug, Serialize, Deserialize)]
#[serde(deny_unknown_fields)]
pub struct LatticeSpec {
    pub bay_width_m: f64,
    pub rows: u32,
    pub batten_width_m: f64,
    pub batten_depth_m: f64,
    pub material: String,
    pub max_pieces: u32,
}

#[derive(Clone, Debug, Serialize, Deserialize)]
#[serde(deny_unknown_fields)]
pub struct LogJointSpec {
    pub courses: u32,
    pub course_spacing_m: f64,
    pub diameter_m: f64,
    pub extension_m: f64,
    pub material: String,
}

#[derive(Clone, Debug, Serialize, Deserialize)]
#[serde(deny_unknown_fields)]
pub struct StructuralSpec {
    pub confidence: String,
    pub walls: Vec<WallProfile>,
    pub lightwell: Option<LightwellSpec>,
    pub bank: Option<BankSpec>,
    pub inner_tent: Option<InnerTentSpec>,
    pub mooring: Option<MooringSpec>,
    pub island: Option<IslandSpec>,
    pub retaining: Option<RetainingSpec>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub high_hall: Option<HighHallSpec>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub lattice: Option<LatticeSpec>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub log_joints: Option<LogJointSpec>,
}

#[derive(Clone, Debug, Serialize, Deserialize)]
pub struct Parameters {
    pub variant_id: String,
    pub layout: Layout,
    pub footprint_family: String,
    pub roof_system: String,
    pub roof_spec: RoofSpec,
    pub gallery_cover: GalleryCover,
    #[serde(default)]
    pub detail_spec: Option<DetailSpec>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub court_program: Option<CourtProgram>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub portal_profile: Option<PortalProfile>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub site_gate_profile: Option<PortalProfile>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub structural_spec: Option<StructuralSpec>,
    pub structure_system: String,
    pub materials: MaterialSlots,
    pub width_m: [f64; 2],
    pub depth_m: [f64; 2],
    pub floors: [u32; 2],
    pub level_height_m: f64,
    pub bodies: [u32; 2],
    pub cells: [u32; 2],
    pub rooms_per_body: [u32; 2],
    pub elevation_family: String,
    pub details: Vec<String>,
    pub notes: Vec<String>,
    pub components: Vec<Component>,
    pub enclosure_family: EnclosureFamily,
    pub enclosures: Vec<EnclosureSpec>,
    pub level_materials: Vec<LevelMaterial>,
    pub support: Support,
    pub envelope: Envelope,
    pub vertical_access: VerticalAccess,
    pub vertical_routes: Vec<VerticalRoute>,
    pub shell: Option<ShellSpec>,
    pub roof_pitch_deg: [f64; 2],
    pub overhang_m: [f64; 2],
    pub wall_thickness_m: [f64; 2],
    pub courtyard_ratio: [f64; 2],
    pub allowed_roofs: Vec<String>,
    pub allowed_footprints: Vec<String>,
}

#[derive(Clone, Debug, Serialize, Deserialize)]
pub struct RecipeVariant {
    pub id: String,
    pub label: String,
    pub parameters: Parameters,
    pub confidence: String,
}

#[derive(Clone, Debug, Serialize, Deserialize)]
pub struct GeometryTrait {
    pub id: String,
    pub operator: String,
    pub status: String,
}

#[derive(Clone, Debug, Serialize, Deserialize)]
pub struct FunctionalMapping {
    pub label: String,
    pub source_line: u32,
    pub kind: String,
    pub recipe_ids: Vec<String>,
    pub traits: Vec<String>,
    pub usage: String,
    pub status: String,
}

#[derive(Clone, Debug, Serialize, Deserialize)]
pub struct Recipe {
    pub id: String,
    pub pack_id: String,
    pub label: String,
    pub priority: String,
    pub role: Role,
    pub profile: String,
    pub parameters: Parameters,
    pub variants: Vec<RecipeVariant>,
    pub component_kind: Option<String>,
    pub temporal: Temporal,
    pub confidence: String,
    pub roof_confidence: String,
    pub sources: Vec<SourceReference>,
    pub source_description: Vec<String>,
    pub settlement_pattern: String,
    pub settlement_archetype: String,
    pub subtradition: String,
    pub context_note: String,
    pub chronology_note: String,
    pub chronology_confidence: String,
    pub compound_pattern: String,
    pub surface_language: String,
    pub weight: u32,
}

#[derive(Clone, Debug, Serialize, Deserialize)]
pub struct CoverageEntry {
    pub id: String,
    pub role: Role,
    pub reason: String,
    pub profile: Option<String>,
    /// planned does not claim the operator has been implemented yet.
    pub status: String,
}

#[derive(Clone, Debug, Serialize, Deserialize)]
pub struct Catalogue {
    pub schema_version: String,
    pub catalogue_version: String,
    pub sources: Vec<SourceDigest>,
    pub packs: Vec<Pack>,
    pub materials: Vec<Material>,
    pub recipes: Vec<Recipe>,
    pub coverage: Vec<CoverageEntry>,
    pub geometry_traits: Vec<GeometryTrait>,
    pub functional_mappings: Vec<FunctionalMapping>,
    #[serde(default, skip_deserializing)]
    pub workshop_presets: Vec<crate::workshop::WorkshopPreset>,
}

#[derive(Clone, Debug, Serialize, Deserialize)]
pub struct SourceEntry {
    pub id: String,
    pub label: String,
    pub priority: String,
    pub pack_id: Option<String>,
    pub section: String,
    pub columns: Vec<String>,
    pub source_line: u32,
    pub source_text: String,
}

#[derive(Clone, Debug, Serialize, Deserialize)]
pub struct FunctionalForm {
    pub label: String,
    pub description: String,
    pub section: String,
    pub source_line: u32,
}

#[derive(Clone, Debug, Serialize, Deserialize)]
pub struct SourceInventory {
    pub schema_version: String,
    pub sources: Vec<SourceDigest>,
    pub entries: Vec<SourceEntry>,
    pub functional_forms: Vec<FunctionalForm>,
}

pub fn catalogue() -> Result<&'static Catalogue, String> {
    static DATA: OnceLock<Result<Catalogue, String>> = OnceLock::new();
    DATA.get_or_init(|| {
        let mut data: Catalogue = serde_json::from_str(include_str!("../data/recipes.json"))
            .map_err(|error| format!("Catalogue architectural invalide : {error}"))?;
        data.workshop_presets = crate::workshop::presets();
        Ok(data)
    })
    .as_ref()
    .map_err(Clone::clone)
}

pub fn source_inventory() -> Result<&'static SourceInventory, String> {
    static DATA: OnceLock<Result<SourceInventory, String>> = OnceLock::new();
    DATA.get_or_init(|| {
        serde_json::from_str(include_str!("../data/source-inventory.json"))
            .map_err(|error| format!("Inventaire architectural invalide : {error}"))
    })
    .as_ref()
    .map_err(Clone::clone)
}

impl Catalogue {
    pub fn material_has(&self, id: &str, roles: &[&str]) -> bool {
        self.materials.iter().any(|material| {
            material.id == id
                && material
                    .roles
                    .iter()
                    .any(|role| roles.contains(&role.as_str()))
        })
    }

    pub fn validate_materials(&self, slots: &MaterialSlots) -> Result<(), String> {
        for (slot, id, roles) in [
            ("structure", &slots.frame, &["frame", "load_bearing"][..]),
            ("remplissage", &slots.infill, &["infill"][..]),
            ("enduit", &slots.coating, &["coating"][..]),
            ("couverture", &slots.cladding, &["cladding"][..]),
            ("base", &slots.base, &["base"][..]),
            (
                "porteur du toit",
                &slots.roof_frame,
                &["roof_frame", "load_bearing"][..],
            ),
        ] {
            if (slot == "base" || slot == "enduit") && id.is_empty() {
                continue;
            }
            if !self.material_has(id, roles) {
                return Err(format!("Le matériau {id} ne peut pas servir de {slot}."));
            }
        }
        Ok(())
    }

    pub fn validate_config(&self, config: &HouseConfig) -> Result<(), String> {
        if config.schema_version != crate::SCHEMA_VERSION {
            return Err("Version de configuration maisons inconnue.".into());
        }
        if config.seed.len() > 4096 || config.seed.is_empty() {
            return Err("La graine doit contenir entre 1 et 4 096 octets.".into());
        }
        if !(1..=40).contains(&config.count) {
            return Err("Le lot doit contenir entre 1 et 40 unités domestiques.".into());
        }
        if !["A", "M", "any"].contains(&config.era.as_str()) {
            return Err(
                "Époque inconnue : choisir A, M ou any (T est une tradition longue).".into(),
            );
        }
        if config.mode == HistoricalMode::HistoricalStrict && config.allow_late {
            return Err(
                "Les profils tardifs ne sont pas compatibles avec le mode strict pré-1500.".into(),
            );
        }
        for (label, value, min, max) in [
            ("taille", config.size, 0.5, 2.0),
            ("variation", config.variation, 0.0, 1.0),
            ("richesse", config.wealth, 0.0, 1.0),
            ("orientation", config.orientation_deg, -360.0, 360.0),
        ] {
            finite_range(label, value, min, max)?;
        }
        if config.mode == HistoricalMode::HistoricalInspired && !(0.8..=1.25).contains(&config.size)
        {
            return Err("La taille du mode inspiré doit rester entre 0,8 et 1,25 ; utiliser fantasy pour davantage.".into());
        }
        if config.mode == HistoricalMode::HistoricalStrict && config.size != 1.0 {
            return Err(
                "Le mode strict conserve les plages dimensionnelles de la recette (taille = 1)."
                    .into(),
            );
        }
        if config.overrides.variant.is_some() && config.recipe.is_none() {
            return Err("Une variante explicite exige une recette explicite.".into());
        }
        for (label, value, min, max) in [
            ("cour", config.overrides.courtyard_ratio, 0.15, 0.7),
            ("débord", config.overrides.overhang_m, 0.0, 2.0),
            ("pente du toit", config.overrides.roof_pitch_deg, 0.0, 70.0),
            ("pente du site", config.overrides.site_slope_deg, 0.0, 35.0),
        ] {
            if let Some(value) = value {
                finite_range(label, value, min, max)?;
            }
        }
        if let Some(floors) = config.overrides.floors
            && !(1..=12).contains(&floors)
        {
            return Err("Nombre d'étages invalide (1–12).".into());
        }
        if let Some(bodies) = config.overrides.bodies
            && !(1..=600).contains(&bodies)
        {
            return Err("Nombre de corps invalide (1–600).".into());
        }
        // Validate IDs even when no specific recipe was requested.
        for (value, prefix) in [
            (&config.overrides.footprint, "FP-"),
            (&config.overrides.roof, "RF-"),
        ] {
            if let Some(value) = value
                && (!value.starts_with(prefix)
                    || !source_inventory()?
                        .entries
                        .iter()
                        .any(|entry| entry.id == *value))
            {
                return Err(format!("Primitive inconnue : {value}."));
            }
        }
        if config.workshop.is_some() {
            return crate::workshop::resolve(self, config).map(|_| ());
        }
        if !self.packs.iter().any(|pack| pack.id == config.pack) {
            return Err(format!(
                "Tradition architecturale inconnue : {}.",
                config.pack
            ));
        }
        self.admissible(config).map(|_| ())
    }

    pub fn admissible<'a>(&'a self, config: &HouseConfig) -> Result<Vec<&'a Recipe>, String> {
        let candidates: Vec<_> = self
            .recipes
            .iter()
            .filter(|recipe| {
                recipe.pack_id == config.pack
                    && config
                        .recipe
                        .as_ref()
                        .map_or(recipe.weight > 0 && recipe.role.residential(), |id| {
                            recipe.id == *id
                        })
                    && (!recipe.temporal.late_only
                        || (config.allow_late && config.mode != HistoricalMode::HistoricalStrict))
                    && (config.era == "any" || recipe.temporal.eras.contains(&config.era))
            })
            .collect();
        if candidates.is_empty() {
            return Err(
                "Aucune recette admissible pour ces choix de tradition, époque et profils tardifs."
                    .into(),
            );
        }
        let mut reasons = Vec::new();
        let compatible: Vec<_> = candidates
            .into_iter()
            .filter(|recipe| match self.resolve_parameters(recipe, config) {
                Ok(_) => true,
                Err(error) => {
                    reasons.push(format!("{}: {error}", recipe.id));
                    false
                }
            })
            .collect();
        if compatible.is_empty() {
            return Err(format!(
                "Aucune recette compatible avec ces paramètres. {}",
                reasons.join(" ; ")
            ));
        }
        Ok(compatible)
    }

    pub fn resolve_parameters(
        &self,
        recipe: &Recipe,
        config: &HouseConfig,
    ) -> Result<Parameters, String> {
        if let Some(id) = &config.overrides.variant {
            return self.resolve_variant_parameters(recipe, config, id);
        }
        if config.mode == HistoricalMode::FantasyMix {
            return self.resolve_variant_parameters(recipe, config, "default");
        }
        let mut failures = Vec::new();
        for id in std::iter::once("default")
            .chain(recipe.variants.iter().map(|variant| variant.id.as_str()))
        {
            match self.resolve_variant_parameters(recipe, config, id) {
                Ok(parameters) => return Ok(parameters),
                Err(error) => failures.push(error),
            }
        }
        Err(format!(
            "Aucun bundle compatible pour {} : {}",
            recipe.id,
            failures.join(" ; ")
        ))
    }

    /// Resolve an explicitly chosen, coherent source bundle before geometry.
    pub fn resolve_variant_parameters(
        &self,
        recipe: &Recipe,
        config: &HouseConfig,
        variant_id: &str,
    ) -> Result<Parameters, String> {
        if let Some(requested) = &config.overrides.variant
            && requested != variant_id
        {
            return Err(format!(
                "Variante {variant_id} incompatible avec la variante explicitement demandée {requested}."
            ));
        }
        let mut parameters = if variant_id == "default" {
            recipe.parameters.clone()
        } else {
            recipe
                .variants
                .iter()
                .find(|variant| variant.id == variant_id)
                .ok_or_else(|| format!("Variante inconnue {variant_id} pour {}.", recipe.id))?
                .parameters
                .clone()
        };
        let custom = &config.overrides;
        if let Some(value) = &custom.footprint {
            let program_replaces = parameters.components.iter().any(|c| {
                c.role.residential()
                    && c.placement != Placement::FacingMain
                    && c.id != "main"
                    && c.id != "upper_frame"
            });
            let active = !program_replaces
                && match parameters.layout {
                    Layout::Single | Layout::Platform => true,
                    Layout::Additive => custom.bodies.unwrap_or(parameters.bodies[1]) == 1,
                    Layout::Courtyard
                    | Layout::Peristyle
                    | Layout::Atrium
                    | Layout::IwanCourt
                    | Layout::Excavated => ["FP-COURT", "FP-U", "FP-L"].contains(&value.as_str()),
                    Layout::Ring => ["FP-COURT", "FP-ELLIPTICAL-RING"].contains(&value.as_str()),
                    Layout::Pueblo | Layout::GreatHouse => value == "FP-APSIDAL",
                    _ => false,
                };
            if !active && value != &parameters.footprint_family {
                return Err(format!(
                    "Plan {value} non consommé par le programme {:?} de {} ; sélectionner une variante native.",
                    parameters.layout, recipe.id
                ));
            }
            if config.mode != HistoricalMode::FantasyMix
                && !parameters.allowed_footprints.contains(value)
            {
                return Err(format!(
                    "{} n'admet pas le plan {value} dans ce mode.",
                    recipe.label
                ));
            }
            parameters.footprint_family.clone_from(value);
        }
        if let Some(value) = custom.courtyard_ratio {
            let active = match parameters.layout {
                Layout::Courtyard
                | Layout::Peristyle
                | Layout::Atrium
                | Layout::IwanCourt
                | Layout::Excavated
                | Layout::Ring
                | Layout::Pueblo
                | Layout::GreatHouse
                | Layout::Siheyuan
                | Layout::Kancha
                | Layout::Shinden => true,
                Layout::Single | Layout::Platform => {
                    ["FP-COURT", "FP-ROCKCUT", "FP-ELLIPTICAL-RING"]
                        .contains(&parameters.footprint_family.as_str())
                }
                Layout::Additive => {
                    custom.bodies.unwrap_or(parameters.bodies[1]) == 1
                        && ["FP-COURT", "FP-ROCKCUT", "FP-ELLIPTICAL-RING"]
                            .contains(&parameters.footprint_family.as_str())
                }
                Layout::Multiyard => parameters.court_program.is_some(),
                _ => false,
            };
            if !active && parameters.courtyard_ratio != [value, value] {
                return Err(format!(
                    "Ratio de cour non consommé par le programme {:?} de {} ; sélectionner une variante native.",
                    parameters.layout, recipe.id
                ));
            }
        }
        if let Some(value) = &custom.roof {
            if config.mode != HistoricalMode::FantasyMix
                && !parameters.allowed_roofs.contains(value)
            {
                return Err(format!(
                    "{} n'admet pas le toit {value} dans ce mode.",
                    recipe.label
                ));
            }
            parameters.roof_system.clone_from(value);
        }
        for (target, value) in [
            (&mut parameters.materials.frame, &custom.frame),
            (&mut parameters.materials.infill, &custom.infill),
            (&mut parameters.materials.coating, &custom.coating),
            (&mut parameters.materials.cladding, &custom.cladding),
        ] {
            if let Some(value) = value {
                if config.mode != HistoricalMode::FantasyMix && value != target {
                    return Err(format!(
                        "Matériau {value} hors variante de la recette {}.",
                        recipe.id
                    ));
                }
                target.clone_from(value);
            }
        }
        if let Some(value) = custom.floors {
            if config.mode != HistoricalMode::FantasyMix
                && !(parameters.floors[0]..=parameters.floors[1]).contains(&value)
            {
                return Err("Étages hors plage de cette recette.".into());
            }
            parameters.floors = [value, value];
        }
        if let Some(value) = custom.bodies {
            if config.mode != HistoricalMode::FantasyMix
                && !(parameters.bodies[0]..=parameters.bodies[1]).contains(&value)
            {
                return Err("Nombre de corps hors plage de cette recette.".into());
            }
            parameters.bodies = [value, value];
        }
        for (target, value) in [
            (&mut parameters.roof_pitch_deg, custom.roof_pitch_deg),
            (&mut parameters.overhang_m, custom.overhang_m),
            (&mut parameters.courtyard_ratio, custom.courtyard_ratio),
        ] {
            if let Some(value) = value {
                if config.mode != HistoricalMode::FantasyMix
                    && !(target[0]..=target[1]).contains(&value)
                {
                    return Err(format!(
                        "Paramètre {value} hors plage de la recette {}.",
                        recipe.id
                    ));
                }
                *target = [value, value];
            }
        }
        if parameters.components.len() == 1
            && let Some(component) = parameters.components.first_mut()
            && component.id == "main"
        {
            component.count = parameters.bodies;
            component
                .footprint_family
                .clone_from(&parameters.footprint_family);
            component.roof_system.clone_from(&parameters.roof_system);
            component.roof_spec.clone_from(&parameters.roof_spec);
            component.roof_pitch_deg = parameters.roof_pitch_deg;
            component.overhang_m = parameters.overhang_m;
            component.materials.clone_from(&parameters.materials);
            component.floors = parameters.floors;
            component.level_height_m = parameters.level_height_m;
            component.rooms_per_body = parameters.rooms_per_body;
            component.courtyard_ratio = parameters.courtyard_ratio;
        }
        self.validate_parameters(&parameters)?;
        Ok(parameters)
    }

    pub fn validate_parameters(&self, parameters: &Parameters) -> Result<(), String> {
        self.validate_materials(&parameters.materials)?;
        let p = parameters;
        finite_range("hauteur de niveau", p.level_height_m, 1.2, 8.0)?;
        if let Some(profile) = &p.portal_profile {
            validate_portal_profile(profile, p.level_height_m)?;
        }
        if let Some(profile) = &p.site_gate_profile {
            let height = p.court_program.as_ref().map_or_else(
                || {
                    p.structural_spec.as_ref().map_or(2.2, |s| {
                        s.walls
                            .iter()
                            .filter(|w| w.role == StructureWallRole::Enclosure)
                            .map(|w| w.min_height_m)
                            .fold(2.2, f64::max)
                    })
                },
                |c| c.threshold.height_m,
            );
            validate_portal_profile(profile, height)?;
        }
        if p.layout == Layout::HighHall
            && p.structural_spec
                .as_ref()
                .and_then(|s| s.high_hall.as_ref())
                .is_none()
        {
            return Err("Salle haute sans programme structurel explicite.".into());
        }
        if let Some(s) = &p.structural_spec {
            if s.confidence != "stylized" {
                return Err("Structures : confiance de construction non déclarée.".into());
            }
            if let Some(l) = &s.lattice {
                finite_range("baie treillis", l.bay_width_m, 0.3, 3.0)?;
                finite_range("largeur baguette", l.batten_width_m, 0.015, 0.12)?;
                finite_range("profondeur baguette", l.batten_depth_m, 0.015, 0.12)?;
                if !(1..=4).contains(&l.rows)
                    || !(1..=256).contains(&l.max_pieces)
                    || !self.material_has(&l.material, &["frame"])
                {
                    return Err(
                        "Treillis : rangs, plafond de morceaux ou bois de charpente invalide."
                            .into(),
                    );
                }
            }
            if let Some(l) = &s.log_joints {
                finite_range("écartement cours de rondins", l.course_spacing_m, 0.1, 0.5)?;
                finite_range("diamètre bouts de rondins", l.diameter_m, 0.05, 0.3)?;
                finite_range("extension bouts de rondins", l.extension_m, 0.05, 0.4)?;
                if !(2..=8).contains(&l.courses)
                    || l.course_spacing_m < l.diameter_m
                    || !self.material_has(&l.material, &["frame", "load_bearing"])
                {
                    return Err("Rondins d'angle : cours, espacement ou matériau invalide.".into());
                }
            }
            if let Some(h) = &s.high_hall {
                finite_range("hauteur salle centrale", h.core_level_height_m, 1.2, 8.0)?;
                finite_range("largeur passage entre ailes", h.passage_width_m, 0.75, 2.0)?;
                if p.layout != Layout::HighHall
                    || p.roof_system != "RF-FLAT"
                    || p.footprint_family != "FP-COMPLEX"
                    || p.overhang_m != [0.0; 2]
                    || p.courtyard_ratio != [0.0; 2]
                    || h.joint_overhang_m != 0.0
                    || h.core_level_height_m <= p.level_height_m
                    || h.wing_order
                        != [
                            Placement::East,
                            Placement::West,
                            Placement::North,
                            Placement::South,
                        ]
                    || p.bodies[0] < 3
                    || p.bodies[1] > 5
                    || p.floors[0] < 2
                    || p.floors[1] > 3
                    || h.confidence != "stylized"
                {
                    return Err("Salle haute : programme fermé RF-FLAT de 3–5 corps et 2–3 niveaux, noyau plus haut, joints sans débord requis.".into());
                }
            } else if p.layout == Layout::HighHall {
                return Err("Salle haute sans programme structurel explicite.".into());
            }
            for w in &s.walls {
                finite_range("épaisseur profil de mur", w.min_thickness_m, 0.02, 5.0)?;
                finite_range("hauteur profil de mur", w.min_height_m, 0.05, 50.0)?;
                if w.from_level > w.to_level
                    || w.to_level >= 12
                    || w.material
                        .as_ref()
                        .is_some_and(|m| !self.materials.iter().any(|a| &a.id == m))
                {
                    return Err("Profil de mur : niveaux ou matériau inconnus.".into());
                }
            }
            if let Some(b) = &s.bank {
                for (name, value, lo, hi) in [
                    ("largeur talus", b.width_m, 0.2, 10.0),
                    ("hauteur talus", b.height_m, 0.1, 8.0),
                    ("fondation talus", b.base_depth_m, 0.02, 5.0),
                    ("entrée talus", b.gate_width_m, 1.4, 5.0),
                ] {
                    finite_range(name, value, lo, hi)?;
                }
                if !self.material_has(&b.material, &["load_bearing", "infill"]) {
                    return Err("Talus sans matériau terre/tourbe déclaré.".into());
                }
            }
            if let Some(r) = &s.retaining {
                for (name, value, lo, hi) in [
                    ("épaisseur retenue", r.thickness_m, 0.1, 3.0),
                    ("pente de gradins", r.terrain_slope_deg, 0.0, 35.0),
                    ("hauteur gradin", r.terrace_rise_m, 0.1, 2.0),
                    ("fondation retenue", r.base_depth_m, 0.05, 3.0),
                ] {
                    finite_range(name, value, lo, hi)?;
                }
                if !self.material_has(&r.material, &["load_bearing"]) {
                    return Err("Retenue sans matériau porteur déclaré.".into());
                }
            }
            if let Some(i) = &s.island {
                for (name, value, lo, hi) in [
                    ("hauteur îlot", i.height_m, 0.1, 3.0),
                    ("profondeur canaux", i.water_depth_m, 0.1, 3.0),
                    ("profondeur pieux", i.pile_depth_m, 0.2, 5.0),
                    ("marge îlot", i.margin_m, 1.4, 10.0),
                    ("espacement pieux", i.pile_spacing_m, 0.5, 6.0),
                    ("largeur canaux", i.canal_width_m, 1.4, 10.0),
                    ("ratio jardins", i.garden_ratio, 0.05, 0.45),
                ] {
                    finite_range(name, value, lo, hi)?;
                }
                if i.pile_depth_m <= i.water_depth_m
                    || !self.material_has(&i.material, &["load_bearing"])
                    || !self.material_has(&i.pile_material, &["support", "frame"])
                {
                    return Err("Îlot : fondation/pieux ou matériaux incompatibles.".into());
                }
            }
        }
        if let Some(s) = &p.roof_spec.corbel {
            if !self.material_has(&s.material, &["load_bearing"]) {
                return Err("Assises en encorbellement sans matériau maçonné porteur.".into());
            }
            if s.profile == crate::model::CorbelProfile::Barrel
                && (p.floors != [1, 1]
                    || p.roof_system != "RF-FLAT"
                    || p.overhang_m != [0.0, 0.0]
                    || p.roof_spec.oculus_ratio > 0.0)
            {
                return Err("La voûte sous terrasse exige un seul niveau et RF-FLAT sans avancée ni oculus.".into());
            }
            if s.profile == crate::model::CorbelProfile::Dome
                && (p.roof_system != "RF-DOME"
                    || p.overhang_m != [0.0, 0.0]
                    || p.roof_spec.oculus_ratio > 0.0)
            {
                return Err(
                    "Le dôme en encorbellement exige RF-DOME sans avancée ni oculus.".into(),
                );
            }
        }
        if let Some(s) = &p.detail_spec {
            if s.confidence != "stylized"
                || !self.material_has(&s.floor_material, &["floor"])
                || !self.material_has(&s.flue_material, &["load_bearing", "infill"])
                || s.rope_material
                    .as_ref()
                    .is_some_and(|m| !self.material_has(m, &["rope"]))
            {
                return Err("Détails : confiance ou matériaux de sol/conduit invalides.".into());
            }
            for (name, value, lo, hi) in [
                ("épaisseur sol", s.floor_thickness_m, 0.02, 0.5),
                ("largeur conduit", s.flue_width_m, 0.05, 0.5),
                ("profondeur conduit", s.flue_depth_m, 0.05, 0.5),
                ("diamètre cordage", s.rope_diameter_m, 0.005, 0.1),
                ("extension ancrage", s.rope_anchor_extension_ratio, 0.1, 1.0),
                ("inclinaison diagonale", s.diagonal_lean_ratio, 0.05, 0.5),
                ("allège fenêtre", s.window_sill_m, 0.5, 2.0),
                ("hauteur fenêtre", s.window_height_m, 0.2, 1.5),
                ("largeur fenêtre", s.window_width_m, 0.2, 1.5),
                (
                    "largeur fenêtre étroite",
                    s.narrow_window_width_m,
                    0.15,
                    0.8,
                ),
            ] {
                finite_range(name, value, lo, hi)?;
            }
        }
        if let Some(c) = &p.court_program {
            if c.confidence != "stylized"
                || c.courts.is_empty()
                || c.courts.len() > 8
                || c.compartments > 2
            {
                return Err(
                    "Programme de cours : domaines, poches ou confiance non déclarés.".into(),
                );
            }
            for court in &c.courts {
                finite_range("proportion de cour classée", court.ratio, 0.01, 8.0)?;
                finite_range("aspect de cour classée", court.aspect, 0.1, 8.0)?;
            }
            finite_range("largeur seuil de cour", c.threshold.width_m, 1.4, 4.0)?;
            finite_range("épaisseur seuil de cour", c.threshold.wall_m, 0.1, 1.5)?;
            finite_range("hauteur seuil de cour", c.threshold.height_m, 2.2, 8.0)?;
            if !self.material_has(&c.threshold.material, &["load_bearing", "infill", "frame"]) {
                return Err("Seuil de cour sans matière porteuse.".into());
            }
            if let Some(s) = &c.portico {
                finite_range("profondeur portique", s.span_m, 0.5, 3.0)?;
                finite_range("diamètre appui de portique", s.post_m, 0.08, 0.5)?;
            }
        }
        if p.gallery_cover.rf != "RF-SHED" {
            return Err("Couverture de galerie hors opérateur déclaré RF-SHED.".into());
        }
        for (name, value, minimum, maximum) in [
            ("hauteur galerie", p.gallery_cover.height_m, 2.0, 6.0),
            ("largeur galerie", p.gallery_cover.width_m, 0.5, 3.0),
            ("pente galerie", p.gallery_cover.pitch_deg, 0.0, 45.0),
            ("portée galerie", p.gallery_cover.max_span_m, 0.1, 6.0),
            (
                "espacement supports galerie",
                p.gallery_cover.support_spacing_m,
                0.25,
                3.0,
            ),
        ] {
            finite_range(name, value, minimum, maximum)?;
        }
        if p.gallery_cover.support_spacing_m > p.gallery_cover.max_span_m {
            return Err("Espacement des poteaux supérieur à la portée de galerie.".into());
        }
        for (name, values, minimum, maximum) in [
            ("largeur", p.width_m, 0.5, 1000.0),
            ("profondeur", p.depth_m, 0.5, 1000.0),
            ("pente du toit", p.roof_pitch_deg, 0.0, 70.0),
            ("débord", p.overhang_m, 0.0, 4.0),
            ("mur", p.wall_thickness_m, 0.05, 4.0),
            (
                "cour",
                p.courtyard_ratio,
                if p.layout == Layout::HighHall {
                    0.0
                } else {
                    0.1
                },
                0.8,
            ),
            ("support", p.support.height_m, 0.0, 10.0),
        ] {
            finite_range(name, values[0], minimum, maximum)?;
            finite_range(name, values[1], minimum, maximum)?;
            if values[0] > values[1] {
                return Err(format!("Plage inversée : {name}."));
            }
        }
        for (name, values, max) in [
            ("corps", p.bodies, 600),
            ("cellules", p.cells, 600),
            ("niveaux", p.floors, 12),
            ("pièces", p.rooms_per_body, 600),
        ] {
            if values[0] > values[1] || values[1] > max {
                return Err(format!("Plage invalide : {name}."));
            }
        }
        if p.floors[0] == 0 {
            return Err("Un bâtiment possède au moins un niveau.".into());
        }
        if ![
            "post_beam",
            "masonry",
            "earth_wall",
            "half_timber",
            "log",
            "flexible_frame",
            "earth_shell",
            "snow_shell",
            "rockcut",
        ]
        .contains(&p.structure_system.as_str())
        {
            return Err(format!("Système porteur inconnu : {}.", p.structure_system));
        }
        if p.floors[1] > 1 && p.vertical_access == VerticalAccess::None {
            return Err("Plusieurs niveaux exigent un accès vertical déclaré.".into());
        }
        if let Some(material) = &p.support.material
            && !self.material_has(material, &["support", "load_bearing", "frame", "base"])
        {
            return Err(format!("Matériau de support invalide : {material}."));
        }
        if p.details
            .iter()
            .any(|id| !self.geometry_traits.iter().any(|trait_| trait_.id == *id))
        {
            return Err("Trait géométrique absent du registre fermé.".into());
        }
        for level in &p.level_materials {
            self.validate_materials(&level.materials)?;
            if level.from_level > level.to_level || level.to_level > 11 {
                return Err("Plage de matériaux par niveau invalide.".into());
            }
        }
        for enclosure in &p.enclosures {
            finite_range("porte de clôture", enclosure.gate_width_m, 0.6, 4.0)?;
            if enclosure.family == EnclosureFamily::None {
                return Err("Une enceinte déclarée exige une famille constructive.".into());
            }
        }
        for route in &p.vertical_routes {
            if route.kind == VerticalAccess::None
                || route.to_level <= route.from_level
                || route.to_level > 12
            {
                return Err("Route verticale invalide.".into());
            }
            finite_range("largeur d'accès vertical", route.min_width_m, 0.5, 4.0)?;
        }
        for component in &p.components {
            finite_range(
                "hauteur de niveau composant",
                component.level_height_m,
                1.2,
                8.0,
            )?;
            self.validate_materials(&component.materials)?;
            if component.floors[1] > 1 && component.vertical_access == VerticalAccess::None {
                return Err(format!(
                    "Le composant {} manque d'accès vertical.",
                    component.id
                ));
            }
            if component.count[0] > component.count[1] || component.count[1] > 600 {
                return Err(format!("Nombre de composants invalide : {}.", component.id));
            }
            if component.role == Role::SpatialComponent && component.rooms_per_body != [0, 0] {
                return Err(format!(
                    "Le composant spatial {} ne peut pas porter de pièces occupables.",
                    component.id
                ));
            }
            for (name, range) in [
                ("largeur relative", component.width_ratio),
                ("profondeur relative", component.depth_ratio),
            ] {
                finite_range(name, range[0], 0.01, 1.0)?;
                finite_range(name, range[1], 0.01, 1.0)?;
                if range[0] > range[1] {
                    return Err(format!("Plage inversée : {} {name}.", component.id));
                }
            }
            if let Some(material) = &component.support.material
                && !self.material_has(material, &["support", "load_bearing", "frame", "base"])
            {
                return Err(format!("Support invalide dans {}.", component.id));
            }
        }
        if p.roof_system == "uncovered" {
            if p.bodies != [0, 0] || p.rooms_per_body != [0, 0] || p.roof_pitch_deg != [0.0, 0.0] {
                return Err(
                    "Un composant découvert ne possède ni corps couvert ni pièce habitée.".into(),
                );
            }
            return Ok(());
        }
        if !source_inventory()?
            .entries
            .iter()
            .any(|entry| entry.id == p.roof_system && entry.id.starts_with("RF-"))
            || !source_inventory()?
                .entries
                .iter()
                .any(|entry| entry.id == p.footprint_family && entry.id.starts_with("FP-"))
        {
            return Err("Identifiant de plan ou couverture inconnu.".into());
        }
        let flat = ["RF-FLAT", "RF-STEP"].contains(&p.roof_system.as_str());
        if flat && p.roof_pitch_deg != [0.0, 0.0] {
            return Err("Une terrasse doit conserver une pente architecturale de 0 degré.".into());
        }
        let pitched = [
            "RF-GABLE",
            "RF-HIP",
            "RF-SHED",
            "RF-EAVES",
            "RF-CURVED",
            "RF-TIERED",
            "RF-REED-HIP",
            "RF-SADDLE",
            "RF-GAMBREL",
            "RF-STEEP-STEP",
            "RF-MULTIPAV",
            "RF-CONE",
            "RF-TENT",
        ]
        .contains(&p.roof_system.as_str());
        let minimum = match p.materials.cladding.as_str() {
            "MAT-THATCH" | "MAT-PALM" | "MAT-REED" => 25.0,
            "MAT-TILE-CLAY" | "MAT-SLATE" => 15.0,
            _ => 5.0,
        };
        if pitched && p.roof_pitch_deg[0] < minimum {
            return Err(format!(
                "La couverture {} exige au moins {minimum} degrés.",
                p.materials.cladding
            ));
        }
        if flat
            && [
                "MAT-THATCH",
                "MAT-PALM",
                "MAT-REED",
                "MAT-TILE-CLAY",
                "MAT-SLATE",
            ]
            .contains(&p.materials.cladding.as_str())
        {
            return Err("Cette couverture n'est pas une terrasse étanche praticable.".into());
        }
        if ["RF-CONE", "RF-TENT", "RF-SNOW"].contains(&p.roof_system.as_str())
            && ![
                "FP-ROUND",
                "FP-OVAL",
                "FP-POLYGON",
                "FP-CLUSTER-ROUND",
                "FP-ELLIPTICAL-RING",
            ]
            .contains(&p.footprint_family.as_str())
        {
            return Err("Ce toit exige une emprise ronde, ovale ou polygonale compatible.".into());
        }
        let textile_drum = p.roof_system == "RF-DOME-CONE" && p.envelope == Envelope::Membrane;
        if textile_drum && !self.material_has(&p.materials.roof_frame, &["frame"]) {
            return Err("La coupole textile sur tambour exige une ossature déclarée.".into());
        }
        let heavy = ["RF-VAULT", "RF-CROSSVAULT", "RF-DOME-CONE"].contains(&p.roof_system.as_str())
            && !textile_drum;
        if heavy && !self.material_has(&p.materials.roof_frame, &["load_bearing"]) {
            return Err(
                "Une voûte ou coupole maçonnée exige des appuis et un porteur minéral.".into(),
            );
        }
        if p.roof_system == "RF-SNOW" && p.materials.frame != "MAT-ICE-SNOW" {
            return Err("La voûte de neige doit être une coque de blocs de neige.".into());
        }
        if p.bodies[1]
            .saturating_mul(p.rooms_per_body[1])
            .saturating_mul(p.floors[1])
            > 2400
        {
            return Err("Budget dépassé : plus de 2 400 pièces occupables par unité.".into());
        }
        Ok(())
    }
}

fn finite_range(label: &str, value: f64, min: f64, max: f64) -> Result<(), String> {
    if !value.is_finite() || !(min..=max).contains(&value) {
        return Err(format!(
            "{label} doit être fini et compris entre {min} et {max}."
        ));
    }
    Ok(())
}

fn validate_portal_profile(profile: &PortalProfile, height: f64) -> Result<(), String> {
    if profile.entries.is_empty()
        || profile.count[0] == 0
        || profile.count[0] > profile.count[1]
        || profile.count[1] > 600
    {
        return Err("Profil de portail : entrées ou plage de compte invalides.".into());
    }
    let mut ids = std::collections::BTreeSet::new();
    for entry in &profile.entries {
        if entry.id.is_empty() || !ids.insert(&entry.id) {
            return Err("Profil de portail : identifiants d’entrées vides ou dupliqués.".into());
        }
        finite_range("largeur portail", entry.width_m, 0.75, 1000.0)?;
        finite_range("largeur haute portail", entry.top_width_m, 0.75, 1000.0)?;
        finite_range("seuil portail", entry.sill_m, 0.0, 0.45)?;
        finite_range(
            "hauteur libre portail",
            entry.min_clear_height_m,
            f64::MIN_POSITIVE,
            8.0,
        )?;
        if !entry.head_m.is_finite()
            || entry.head_m > height - 0.15
            || entry.head_m - entry.sill_m < entry.min_clear_height_m
            || (entry.shape == PortalShape::Rect
                && (entry.top_width_m - entry.width_m).abs() > 1e-9)
            || (entry.shape == PortalShape::Trapezoid && entry.top_width_m > entry.width_m)
        {
            return Err(format!(
                "Profil de portail {} : tête, seuil ou section incompatible avec le volume déclaré.",
                entry.id
            ));
        }
    }
    if profile.placement == PortalPlacement::Differentiated
        && !profile.entries.iter().enumerate().any(|(i, a)| {
            profile
                .entries
                .iter()
                .skip(i + 1)
                .any(|b| (a.width_m - b.width_m).abs() >= 0.2 - 1e-9)
        })
    {
        return Err(
            "Portes différenciées : au moins deux largeurs distinctes de 0,2 m sont nécessaires."
                .into(),
        );
    }
    Ok(())
}
