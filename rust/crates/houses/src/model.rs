//! Versioned, renderer-independent architectural records.
use serde::{Deserialize, Serialize};
#[path = "roof_model.rs"]
pub mod roof_model;
use crate::catalogue::{Envelope, VerticalAccess};
pub use roof_model::{
    CorbelProfile, CorbelSpec, HornConfidence, HornCount, HornLayout, HornRoofSpec,
    IntermediateCover, RoofArm, RoofAttachment, RoofAxis, RoofDrainage, RoofEdgeKind, RoofFaceKind,
    RoofGroup, RoofSpec, RoofTriangulation, ShellProfile, ShellSpec, VaultEnd, VaultSpec,
};

#[derive(Clone, Copy, Debug, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "snake_case")]
pub enum Role {
    Dwelling,
    ResidentialEnsemble,
    CommunalDwelling,
    MixedResidential,
    DomesticAnnex,
    SpatialComponent,
    NonDomestic,
    Landscape,
}

impl Role {
    pub fn residential(self) -> bool {
        matches!(
            self,
            Self::Dwelling
                | Self::ResidentialEnsemble
                | Self::CommunalDwelling
                | Self::MixedResidential
        )
    }
}

#[derive(Clone, Copy, Debug, Default, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "snake_case")]
pub enum HistoricalMode {
    HistoricalStrict,
    #[default]
    HistoricalInspired,
    FantasyMix,
}

#[derive(Clone, Debug, Serialize, Deserialize, PartialEq)]
#[serde(default, deny_unknown_fields)]
pub struct HouseConfig {
    pub schema_version: String,
    pub seed: String,
    pub pack: String,
    /// None selects the residential palette of the chosen pack.
    pub recipe: Option<String>,
    pub mode: HistoricalMode,
    /// A, M or any. T is a recipe tradition flag, never an era.
    pub era: String,
    pub allow_late: bool,
    pub count: u32,
    pub size: f64,
    pub variation: f64,
    pub wealth: f64,
    pub orientation_deg: f64,
    pub overrides: Overrides,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub workshop: Option<crate::workshop::WorkshopRequest>,
}

impl Default for HouseConfig {
    fn default() -> Self {
        Self {
            schema_version: crate::SCHEMA_VERSION.into(),
            seed: "42".into(),
            pack: "EUR-MED".into(),
            recipe: None,
            mode: HistoricalMode::default(),
            era: "any".into(),
            allow_late: false,
            count: 10,
            size: 1.0,
            variation: 0.65,
            wealth: 0.5,
            orientation_deg: 0.0,
            overrides: Overrides::default(),
            workshop: None,
        }
    }
}

#[derive(Clone, Debug, Default, Serialize, Deserialize, PartialEq)]
#[serde(default, deny_unknown_fields)]
pub struct Overrides {
    pub variant: Option<String>,
    pub footprint: Option<String>,
    pub roof: Option<String>,
    pub frame: Option<String>,
    pub infill: Option<String>,
    pub coating: Option<String>,
    pub cladding: Option<String>,
    pub floors: Option<u32>,
    pub bodies: Option<u32>,
    pub courtyard_ratio: Option<f64>,
    pub overhang_m: Option<f64>,
    pub roof_pitch_deg: Option<f64>,
    pub site_slope_deg: Option<f64>,
}

#[derive(Clone, Debug, Serialize, Deserialize, PartialEq)]
pub struct MaterialSlots {
    pub frame: String,
    pub infill: String,
    pub coating: String,
    pub cladding: String,
    pub base: String,
    pub roof_frame: String,
}

#[derive(Clone, Copy, Debug, PartialEq, Serialize, Deserialize)]
pub struct Point {
    pub x: f64,
    pub y: f64,
}

#[derive(Clone, Debug, PartialEq, Serialize, Deserialize)]
pub struct Polygon {
    /// Unclosed rings. Positive signed area for exteriors in x-right/y-down.
    pub outer: Vec<Point>,
    pub holes: Vec<Vec<Point>>,
}

pub type Surface = Vec<Polygon>;

#[derive(Clone, Debug, Serialize, Deserialize, PartialEq)]
pub struct Transform {
    pub origin: Point,
    pub orientation_deg: f64,
}

#[derive(Clone, Debug, Serialize, Deserialize, PartialEq)]
pub struct Level {
    pub index: u32,
    pub z_m: f64,
    pub height_m: f64,
    pub footprint: Surface,
    /// Structural floor, with real stair and hatch voids.
    pub floor: Surface,
    pub intermediate_cover: IntermediateCover,
    pub roof_slab: Option<RoofSlab>,
    pub materials: MaterialSlots,
}

#[derive(Clone, Debug, Serialize, Deserialize, PartialEq)]
pub struct Room {
    pub id: String,
    pub body_id: String,
    pub level: u32,
    pub z_m: f64,
    pub floor: Surface,
    pub usage: RoomUsage,
    pub access_node: String,
    pub household_id: Option<String>,
}

#[derive(Clone, Debug, Serialize, Deserialize, PartialEq)]
pub struct Body {
    pub id: String,
    pub footprint: Surface,
    /// Authored open shafts through every structural floor and roof.
    #[serde(default, skip_serializing_if = "Vec::is_empty")]
    pub voids: Vec<Surface>,
    pub levels: Vec<Level>,
    pub roof_system: String,
    pub roof_pitch_deg: f64,
    pub overhang_m: f64,
    pub details: Vec<String>,
    pub role: Role,
    pub envelope: Envelope,
    pub vertical_access: VerticalAccess,
    #[serde(default)]
    pub vertical_routes: Vec<crate::catalogue::VerticalRoute>,
    pub wall_thickness_m: f64,
    pub component_id: Option<String>,
    pub roof_spec: RoofSpec,
    pub roof_arms: Vec<RoofArm>,
    pub cells: Vec<StructuralCell>,
}

#[derive(Clone, Debug, Serialize, Deserialize, PartialEq)]
pub struct Feature {
    pub id: String,
    pub kind: FeatureKind,
    pub surface: Surface,
    pub z_m: f64,
    pub height_m: f64,
    pub material: String,
    /// Ordered as the first exterior ring of surface, or successive stair corners.
    /// Explicit heights for slopes, steps and the underside of rock shelters.
    #[serde(default)]
    pub vertices3d: Vec<Vertex3>,
    #[serde(default)]
    pub roof: Option<RoofAttachment>,
}

#[derive(Clone, Copy, Debug, Serialize, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "snake_case")]
pub enum WallKind {
    Exterior,
    Interior,
    Enclosure,
    Party,
    Shell,
    Retaining,
    Rock,
}

#[derive(Clone, Debug, Serialize, Deserialize, PartialEq)]
pub struct Wall {
    pub id: String,
    pub kind: WallKind,
    pub body_id: Option<String>,
    pub level: u32,
    pub z_m: f64,
    pub height_m: f64,
    /// Thick solid after subtracting openings; no painted-over doorways.
    pub footprint: Surface,
    pub centerline: Vec<Point>,
    pub material: String,
    pub party: bool,
    pub opening_ids: Vec<String>,
    /// Convex solid for jambs whose section changes with height.
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub solid: Option<WallSolid>,
    /// Native horizontal cut used by the plan renderer for a variable section.
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub plan_section: Option<Surface>,
    /// Plan reference for a shell whose physical envelope is exported as roof faces.
    #[serde(default, skip_serializing_if = "is_false")]
    pub shell_reference: bool,
}

#[derive(Clone, Debug, Serialize, Deserialize, PartialEq)]
pub struct WallSolid {
    pub vertices: Vec<Vertex3>,
    pub faces: Vec<Vec<u32>>,
}

#[derive(Clone, Debug, Serialize, Deserialize, PartialEq)]
pub struct AccessNode {
    pub id: String,
    pub kind: AccessKind,
    pub floor: Surface,
    pub z_m: f64,
    #[serde(default)]
    pub household_id: Option<String>,
}

#[derive(Clone, Debug, Serialize, Deserialize, PartialEq)]
pub struct Portal {
    pub id: String,
    pub kind: PortalKind,
    pub from: String,
    pub to: String,
    pub opening: [Point; 2],
    pub wall_id: Option<String>,
    pub feature_ids: Vec<String>,
    /// A horizontal polygon for hatches, otherwise the cut through a wall.
    pub opening_surface: Surface,
    pub passage: Surface,
    pub width_m: f64,
    pub from_z_m: f64,
    pub to_z_m: f64,
    /// Absolute height of the opening; wall solids survive above this height.
    pub head_z_m: f64,
    #[serde(default = "rect_portal", skip_serializing_if = "is_rect_portal")]
    pub shape: crate::catalogue::PortalShape,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub top_width_m: Option<f64>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub sill_z_m: Option<f64>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub profile_id: Option<String>,
}

fn rect_portal() -> crate::catalogue::PortalShape {
    crate::catalogue::PortalShape::Rect
}
fn is_false(value: &bool) -> bool {
    !*value
}
fn is_rect_portal(shape: &crate::catalogue::PortalShape) -> bool {
    *shape == crate::catalogue::PortalShape::Rect
}

#[derive(Clone, Debug, Serialize, Deserialize, PartialEq)]
pub struct AccessGraph {
    pub root: String,
    pub nodes: Vec<AccessNode>,
    pub portals: Vec<Portal>,
}

#[derive(Clone, Debug, Serialize, Deserialize, PartialEq)]
pub struct Vertex3 {
    pub x: f64,
    pub y: f64,
    pub z: f64,
}

#[derive(Clone, Debug, Serialize, Deserialize, PartialEq)]
pub struct RoofFace {
    pub body_id: String,
    #[serde(default)]
    pub feature_id: Option<String>,
    pub level: u32,
    pub kind: RoofFaceKind,
    pub rf: String,
    pub roof_group: String,
    pub component_id: Option<String>,
    pub vertices: Vec<u32>,
    pub material: String,
    pub normal: [f64; 3],
}

#[derive(Clone, Debug, Serialize, Deserialize, PartialEq)]
pub struct RoofEdge {
    pub kind: RoofEdgeKind,
    pub vertices: [u32; 2],
    pub faces: [Option<u32>; 2],
}

#[derive(Clone, Debug, Default, Serialize, Deserialize, PartialEq)]
pub struct RoofMesh {
    pub vertices: Vec<Vertex3>,
    pub faces: Vec<RoofFace>,
    pub edges: Vec<RoofEdge>,
    pub groups: Vec<RoofGroup>,
}

#[derive(Clone, Debug, Serialize, Deserialize, PartialEq)]
pub struct Partition {
    pub occupied: Surface,
    pub courtyards: Surface,
    pub circulation: Surface,
    pub service: Surface,
    pub residual: Surface,
}

#[derive(Clone, Debug, Serialize, Deserialize, PartialEq)]
pub struct LevelPartition {
    pub level: u32,
    pub z_m: f64,
    pub domain: Surface,
    pub partition: Partition,
}

#[derive(Clone, Debug, Serialize, Deserialize, PartialEq)]
pub struct HouseUnit {
    pub id: String,
    pub recipe_id: String,
    pub variant_id: String,
    pub label: String,
    pub role: Role,
    pub transform: Transform,
    pub lot: Surface,
    /// Complete parcel partition at the base level (projection for raised floors).
    pub partition: Partition,
    pub level_partitions: Vec<LevelPartition>,
    pub levels: Vec<UnitLevel>,
    pub bodies: Vec<Body>,
    pub rooms: Vec<Room>,
    pub features: Vec<Feature>,
    pub walls: Vec<Wall>,
    pub site_context: Vec<Feature>,
    pub access: AccessGraph,
    pub roofs: RoofMesh,
    pub diagnostics: Vec<String>,
}

#[derive(Clone, Debug, Serialize, Deserialize, PartialEq)]
pub struct HouseBatch {
    pub schema_version: String,
    pub catalogue_version: String,
    pub generator_version: String,
    pub settings: HouseConfig,
    pub units: Vec<HouseUnit>,
    pub diagnostics: Vec<String>,
}

#[derive(Clone, Debug, Serialize, Deserialize, PartialEq)]
pub struct UnitLevel {
    pub index: u32,
    pub z_min: f64,
    pub z_max: f64,
}

#[derive(Clone, Copy, Debug, Serialize, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "snake_case")]
pub enum RoomUsage {
    Living,
    Kitchen,
    Storage,
    Workshop,
    Shop,
    Byre,
    Barn,
    Communal,
    Guest,
    Service,
    Ritual,
    Hall,
    Gallery,
    Office,
}

#[derive(Clone, Copy, Debug, Serialize, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "snake_case")]
pub enum AccessKind {
    Exterior,
    Courtyard,
    Circulation,
    Room,
    StairLanding,
    Terrace,
    Gallery,
    Platform,
    Tunnel,
}

#[derive(Clone, Copy, Debug, Serialize, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "snake_case")]
pub enum PortalKind {
    Door,
    Gate,
    Passage,
    Stair,
    Ladder,
    Hatch,
    Tunnel,
    Bridge,
}

#[derive(Clone, Copy, Debug, Serialize, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "snake_case")]
pub enum FeatureKind {
    Terrace,
    PartyWall,
    RockShelter,
    Gallery,
    ArcticTunnel,
    Post,
    Pier,
    Raft,
    Water,
    SiteSlope,
    RockFace,
    Neighbor,
    Street,
    Enclosure,
    Stair,
    Ladder,
    Landing,
    Hatch,
    PortalLintel,
    Hearth,
    Well,
    Drain,
    Flue,
    Scupper,
    Parapet,
    Balcony,
    Arcade,
    Frame,
    Bay,
    StorageBin,
    Impluvium,
    Windcatcher,
    Window,
    DecorativeWall,
    Platform,
    Deck,
    Mooring,
    Anchor,
    WallFooting,
    FloorSlab,
    Excavation,
    Retaining,
    RoofDrum,
    SteppedGable,
    RoofRiser,
    RoofPavilion,
    RoofDrain,
    RoofSkirt,
    RoofGable,
    RoofTympanum,
    TentCrown,
    RoofArc,
    DecorativePanel,
    Fence,
    RitualCourt,
    LivestockPen,
    DryingRack,
    Beam,
    InnerMembrane,
    Courtyard,
    Threshold,
    Garden,
}

#[derive(Clone, Debug, Serialize, Deserialize, PartialEq)]
pub struct RoofSlab {
    pub surface: Surface,
    pub z_m: f64,
    pub walkable: bool,
    pub access_node: Option<String>,
}

#[derive(Clone, Debug, Serialize, Deserialize, PartialEq)]
pub struct StructuralCell {
    pub id: String,
    pub footprint: Surface,
    pub floors: u32,
    pub household_id: Option<String>,
}

#[derive(Clone, Debug, Serialize, Deserialize)]
pub struct ResourceEstimate {
    pub bodies: u32,
    pub rooms: u32,
    pub faces: u32,
}

#[derive(Clone, Debug, Serialize, Deserialize)]
pub struct RejectedRecipe {
    pub id: String,
    pub reason: String,
}

#[derive(Clone, Debug, Serialize, Deserialize)]
pub struct Preflight {
    pub schema_version: String,
    pub settings: HouseConfig,
    pub admissible_recipes: Vec<String>,
    pub rejected_recipes: Vec<RejectedRecipe>,
    pub estimate: ResourceEstimate,
    pub budgets: ResourceEstimate,
}
