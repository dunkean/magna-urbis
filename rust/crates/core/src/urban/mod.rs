//! Temporary metric urban-stage contract for Terrain Bench. Geometry, cultural
//! parameter application and deterministic partitioning execute only in Rust.
//! Layouts are retained inputs to the parcel stage; this is not the future World model.
mod access;
pub mod building_sites;
pub mod display;
mod composition;
// Structural user edits (shape, delete, reroll): urban/edits.rs.
mod edits;
pub use edits::quarter_removed;
pub mod culture;
pub mod programme;
pub use culture::{CultureMapping, UrbanAdmissibility};
pub use programme::{ProgrammeContext, UrbanProgramme};
mod footprint;
mod fortification;
mod fringe;
mod geography;
mod geometry;
pub use geography::{Geography, VectorGeography};
mod influences;
pub mod kinds;
mod macroplan;
mod network;
mod par;
mod parcels;
mod profiles;
mod quarters;
#[cfg(test)]
mod refonte_tests;
#[cfg(test)]
mod regression;
pub mod roles;
mod routing;
mod widths;

use crate::rng::Rng;
pub use crate::settlements::Point;
use serde::{Deserialize, Serialize};
use serde_json::{Value, json};
use std::collections::BTreeSet;
use std::sync::OnceLock;

#[derive(Clone, Debug, Serialize, Deserialize, PartialEq)]
pub struct Shape {
    pub outer: Vec<Point>,
    #[serde(default)]
    pub holes: Vec<Vec<Point>>,
}
#[derive(Clone, Debug, Serialize, Deserialize)]
pub struct Street {
    pub path: Vec<Point>,
    pub widths: Vec<f64>,
    pub rank: usize,
    pub role: String,
}
#[derive(Clone, Debug, Serialize, Deserialize)]
pub struct Quarter {
    pub shape: Shape,
    pub phase: usize,
    #[serde(default = "core_zone")]
    pub zone: String,
}
fn core_zone() -> String {
    "core".into()
}
/// A fortified circuit. `path`, `kind`, `gates` and `towers` keep their old
/// meaning; the other fields (`fortification::build`) describe the integrated
/// structures and are omitted when empty, so old clients read the same JSON.
#[derive(Clone, Debug, Default, Serialize, Deserialize)]
pub struct Enclosure {
    pub path: Vec<Point>,
    pub kind: String,
    pub gates: Vec<Point>,
    /// Tower anchors on the curtain: `towers[i] == towers_detail[i].anchor`
    /// (gate towers, then corners, then flanks).
    #[serde(default, skip_serializing_if = "Vec::is_empty")]
    pub towers: Vec<Point>,
    /// `palisade|gord|hedge|curtain|flanked|concentric|rammed-earth|wengcheng|bastioned`.
    #[serde(default, skip_serializing_if = "String::is_empty")]
    pub style: String,
    /// `timber|timber-earth|thorn|stone|brick|rammed-earth|earth-stone`.
    #[serde(default, skip_serializing_if = "String::is_empty")]
    pub material: String,
    /// Curtain body thickness from the inner face (offset −½ ribbon) outward.
    #[serde(default, skip_serializing_if = "is_zero")]
    pub curtain_width_m: f64,
    #[serde(default, skip_serializing_if = "is_zero")]
    pub height_m: f64,
    #[serde(default, skip_serializing_if = "Vec::is_empty")]
    pub towers_detail: Vec<Tower>,
    #[serde(default, skip_serializing_if = "Vec::is_empty")]
    pub gatehouses: Vec<Gatehouse>,
    #[serde(default, skip_serializing_if = "Vec::is_empty")]
    pub bastions: Vec<Work>,
    /// `outer-wall|barbican|antemural|wengcheng|ravelin|citadel|glacis`.
    #[serde(default, skip_serializing_if = "Vec::is_empty")]
    pub outworks: Vec<Work>,
    /// Ditch pieces, kind `dry|wet`, cut by causeways at the gates.
    #[serde(default, skip_serializing_if = "Vec::is_empty")]
    pub ditch: Vec<Work>,
    #[serde(default, skip_serializing_if = "Vec::is_empty")]
    pub attached: Vec<Attached>,
    /// Union of the curtain body and every structure outside the inner face:
    /// land no quarter, block or lot occupies.
    #[serde(default, skip_serializing_if = "Vec::is_empty")]
    pub reserve: Vec<Shape>,
}
fn is_zero(v: &f64) -> bool {
    *v == 0.0
}
#[derive(Clone, Debug, Serialize, Deserialize)]
pub struct Tower {
    /// On the curtain path.
    pub anchor: Point,
    pub center: Point,
    /// `round|square|d|rect`.
    pub shape: String,
    /// Half size across (radius for a round tower).
    pub radius_m: f64,
    /// Outward depth (`rect` only).
    #[serde(default, skip_serializing_if = "is_zero")]
    pub depth_m: f64,
    /// Curtain tangent (rad).
    pub angle: f64,
    pub height_m: f64,
    /// `corner|flank|gate|water`.
    pub kind: String,
    /// Clipped polygon actually built.
    pub footprint: Shape,
}
#[derive(Clone, Debug, Serialize, Deserialize)]
pub struct Gatehouse {
    /// Index in `Enclosure::gates`.
    pub gate: usize,
    /// `timber|tower|twin-tower|bab|ravelin|water|postern`.
    pub kind: String,
    /// Whole gate block, spanning the passage (upper storey, lintel).
    pub shape: Shape,
    /// Ground masses: `shape` minus the street, as they enter the reserve.
    #[serde(default, skip_serializing_if = "Vec::is_empty")]
    pub masses: Vec<Shape>,
    /// Inner face to outer end along the street (a water gate: bank to bank).
    pub passage: [Point; 2],
    pub passage_width_m: f64,
    pub height_m: f64,
}
#[derive(Clone, Debug, Serialize, Deserialize)]
pub struct Work {
    pub kind: String,
    pub shape: Shape,
    pub height_m: f64,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub passage: Option<[Point; 2]>,
}
#[derive(Clone, Debug, Serialize, Deserialize)]
pub struct Attached {
    /// `lean-to`.
    pub kind: String,
    /// `out` (outer face).
    pub side: String,
    pub shape: Shape,
    pub height_m: f64,
}
#[derive(Clone, Debug, Serialize, Deserialize)]
pub struct Block {
    pub shape: Shape,
    pub quarter: usize,
    pub kind: String,
    pub axis: Point,
    #[serde(default = "core_zone")]
    pub zone: String,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub phase: Option<usize>,
}
#[derive(Clone, Debug, Serialize, Deserialize)]
pub struct Layout {
    /// Applied inputs travel with retained geometry into programme and buildings.
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub config: Option<LayoutConfig>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub programme: Option<UrbanProgramme>,
    pub key: String,
    pub culture: String,
    pub center: Point,
    pub quarters: Vec<Quarter>,
    pub streets: Vec<Street>,
    pub blocks: Vec<Block>,
    pub warnings: Vec<String>,
    #[serde(default)]
    pub enclosures: Vec<Enclosure>,
    #[serde(default)]
    pub phases: Vec<GrowthPhase>,
    #[serde(default)]
    pub archetype: String,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub structure: Option<UrbanStructure>,
}
#[derive(Clone, Debug, Default, Serialize, Deserialize)]
#[serde(default, rename_all = "camelCase")]
pub struct UrbanStructure {
    pub version: u32,
    pub mechanism: String,
    pub family: String,
    pub reserve: Vec<Shape>,
    pub allocated: Vec<Shape>,
    pub centers: Vec<UrbanCenter>,
    pub districts: Vec<UrbanDistrict>,
    pub history: Vec<UrbanEvent>,
    pub metrics: UrbanMetrics,
}
#[derive(Clone, Debug, Serialize, Deserialize)]
pub struct UrbanCenter {
    pub id: usize,
    pub point: Point,
    pub weight: f64,
}
#[derive(Clone, Debug, Serialize, Deserialize)]
pub struct UrbanDistrict {
    pub id: usize,
    pub center: usize,
    pub phase: usize,
    pub tissue: String,
    pub quarters: Vec<usize>,
    /// Functional role (`civic`, `market`, `religious`, `craft:<trade>`, `port`,
    /// `elite`, `commoner`, `poor`, `garrison`, `gardens`, `foreign`); see `roles`.
    #[serde(default)]
    pub role: String,
    /// Relative social standing, 0 (poorest) to 1 (richest).
    #[serde(default)]
    pub wealth: f64,
    /// French label of the role for the UI (`Quartier des tanneurs`).
    #[serde(default, skip_serializing_if = "String::is_empty")]
    pub label: String,
}
#[derive(Clone, Debug, Serialize, Deserialize)]
pub struct UrbanEvent {
    pub epoch: usize,
    pub kind: String,
    pub center: usize,
    pub area: f64,
}
#[derive(Clone, Debug, Default, Serialize, Deserialize)]
#[serde(default, rename_all = "camelCase")]
pub struct UrbanMetrics {
    pub target_area: f64,
    pub allocated_area: f64,
    pub street_area: f64,
    pub reserved_area: f64,
    pub gross_density: f64,
    pub planned_population: f64,
    pub shortfall_area: f64,
    pub components: usize,
    pub access_added: usize,
    /// Housing capacity plan (adaptive capacity), absent for explicit budgets.
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub capacity: Option<CapacityPlan>,
}
/// Housing capacity of a settlement, sized before the footprint grows: the
/// households to house, the tissue's predicted yield (the culture's own lot
/// cutting probed on reference blocks), and the bounded steps taken, in order:
/// densify within the culture's ranges, extend the footprint, then borrow the
/// street spacing and lot cutting of a compact tissue on a share of quarters.
/// Borrowing changes only the tissue; houses, floors and households stay the
/// receiving culture's.
#[derive(Clone, Debug, Default, Serialize, Deserialize)]
#[serde(default, rename_all = "camelCase")]
pub struct CapacityPlan {
    /// Households of the population (domestic and mixed).
    pub households: f64,
    /// Households the parcels must hold (demand, trades and margin).
    pub required: f64,
    /// Footprint of the catalogue densities, before any extension (m²).
    pub nominal_area: f64,
    /// Predicted households per hectare of allocated land, own tissue as drawn.
    pub nominal_yield: f64,
    /// Same, after densification.
    pub planned_yield: f64,
    /// Predicted share of block land left as gardens, own tissue as drawn.
    pub garden_share: f64,
    /// Same, densified as planned with the footprint.
    pub densified_garden: f64,
    /// Land the institutions reserve as whole blocks, estimated (m²).
    pub reserved_area: f64,
    /// Densification of the lots and floors within the culture's own ranges,
    /// 0 (as drawn) to 1.
    pub densify: f64,
    /// Densification of the street network (block sizes, lattice spacing),
    /// decided with the footprint; the lots may densify further.
    pub network_densify: f64,
    /// Share of the real block land left as gardens, measured on the sample.
    pub measured_garden: f64,
    /// Footprint target over the nominal one (1 to the extension bound).
    pub extension: f64,
    /// Compact tissue lending its street spacing and lot cutting (empty: none).
    pub donor: String,
    pub donor_yield: f64,
    /// Share of the land cut with the donor tissue, 0 to 1.
    pub borrowed_share: f64,
    /// Quarters (indices in `layout.quarters`) cut with the donor tissue.
    pub borrowed_quarters: Vec<usize>,
    /// Scale of the fringe vacancy left as fields (1 = the culture's own).
    pub vacancy: f64,
    /// Households the footprint stage predicts (probed yields × housing land
    /// of the target), before the real blocks exist.
    pub forecast: f64,
    /// Same land, tissue fully densified (the closed loop compares probe and
    /// measure at the same densification).
    pub forecast_dense: f64,
    /// Households the real blocks hold with the tissue as planned (before
    /// any lot densification or fringe reduction of the quarter stage).
    pub measured_plan: f64,
    /// Households predicted on the final blocks.
    pub predicted: f64,
    /// Households still predicted missing (terrain or bounds reached).
    pub shortfall: f64,
    /// Correction of the probed yields after a first measure of the real
    /// blocks fell short (1 = none; `quarters::generate`).
    pub calibration: f64,
}
/// Applied growth budgets and their disjoint land, before street carving.
#[derive(Clone, Debug, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct GrowthPhase {
    #[serde(default, skip_serializing_if = "String::is_empty")]
    pub culture: String,
    pub kind: String,
    pub zone: String,
    pub recipe: String,
    pub population: f64,
    pub target_area: f64,
    pub shapes: Vec<Shape>,
}
#[derive(Clone, Debug, Serialize, Deserialize)]
pub struct Parcel {
    #[serde(default)]
    pub pressure: f64,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub envelope: Option<Shape>,
    #[serde(default)]
    pub id: String,
    #[serde(default)]
    #[serde(rename = "parentIds", alias = "parent_ids")]
    pub parent_ids: Vec<String>,
    #[serde(default)]
    pub provenance: Vec<String>,
    #[serde(default)]
    pub family: String,
    #[serde(default)]
    pub reason: String,
    #[serde(default)]
    pub contacts: Vec<ParcelContact>,
    pub shape: Shape,
    pub block: usize,
    #[serde(rename = "use")]
    pub use_kind: String,
    pub front: Option<[Point; 2]>,
    pub axis: Point,
    pub rank: usize,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub access: Option<ParcelAccess>,
}
#[derive(Clone, Debug, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ParcelContact {
    pub a: Point,
    pub b: Point,
    pub street: usize,
    pub rank: usize,
    pub length: f64,
    pub kind: String,
}
#[derive(Clone, Debug, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ParcelAccess {
    pub kind: String,
    pub street: Option<usize>,
    pub front_length: f64,
}
#[derive(Clone, Debug, Serialize, Deserialize)]
pub struct Partition {
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub config: Option<ParcelConfig>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub programme: Option<UrbanProgramme>,
    pub key: String,
    pub parcels: Vec<Parcel>,
    pub warnings: Vec<String>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub diagnostics: Option<PartitionDiagnostics>,
}
#[derive(Clone, Debug, Default, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct PartitionDiagnostics {
    pub covered_area: f64,
    pub residual_area: f64,
    pub overlap_area: f64,
    pub unserved_area: f64,
}

#[derive(Clone, Debug, Serialize, Deserialize)]
#[serde(default, rename_all = "camelCase", deny_unknown_fields)]
pub struct FootprintConfig {
    pub mechanism: String,
    pub family: String,
    pub budget: String,
    pub gross_density: f64,
    pub aspect: f64,
    pub orientation: f64,
    pub nuclei: usize,
    pub irregularity: f64,
    pub anisotropy: f64,
    pub separation: f64,
    pub epochs: usize,
    /// Infill preference; one preserves the original continuous growth.
    pub cohesion: f64,
    pub satellites: f64,
    pub branch_depth: f64,
    /// Correlated open-space scale, in metres.
    pub gap_size: f64,
}
impl Default for FootprintConfig {
    fn default() -> Self {
        Self {
            mechanism: "auto".into(),
            family: "auto".into(),
            budget: "population".into(),
            gross_density: 0.0,
            aspect: 1.4,
            orientation: 0.0,
            nuclei: 3,
            irregularity: 0.2,
            anisotropy: 0.65,
            separation: 1.3,
            epochs: 3,
            cohesion: 1.0,
            satellites: 0.0,
            branch_depth: 0.0,
            gap_size: 60.0,
        }
    }
}
fn legacy_footprint() -> FootprintConfig {
    FootprintConfig {
        mechanism: "legacy".into(),
        budget: "radius".into(),
        ..FootprintConfig::default()
    }
}
fn cultural_access() -> String {
    "cultural".into()
}
#[derive(Clone, Debug, Deserialize)]
pub struct Site {
    pub key: String,
    #[serde(default)]
    pub name: String,
    pub population: u32,
    pub culture: String,
    pub center: Point,
    pub radius: f64,
}

#[derive(Clone, Debug, Serialize, Deserialize)]
#[serde(default, rename_all = "camelCase", deny_unknown_fields)]
pub struct LayoutConfig {
    pub programme: ProgrammeContext,
    #[serde(default = "culture_axis")]
    pub axis_alignment: String,
    #[serde(default)]
    pub site_adaptation: f64,
    pub mix_culture: String,
    pub mix_mode: String,
    pub mix_share: f64,
    pub mix_angle: f64,
    #[serde(default = "legacy_exits")]
    pub exit_treatment: String,
    pub peripheral_road: String,
    #[serde(default = "legacy_footprint")]
    pub footprint: FootprintConfig,
    pub tissue: String,
    #[serde(default = "cultural_access")]
    pub access_mode: String,
    pub access_depth: f64,
    pub access_budget: usize,
    pub composition: String,
    /// `auto`, `nucleated`, `ribbon`, or a settlement kind id (`kinds::Kind`:
    /// `single`, `ruin`, `farmstead`, `camp`, `hamlet`, `street-village`,
    /// `nucleated-village`, `market-town`, `walled-town`, `city`, `metropolis`).
    pub settlement_form: String,
    /// Site archetype from settlement placement (`harbor`, `bridge`, `hilltop`,
    /// `spur`, `pass`, `island`, `lakeshore`, `valley`, `plain`); empty = unknown.
    pub site_archetype: String,
    pub suburbs: String,
    /// Zero follows the cultural population thresholds.
    pub phases: usize,
    pub culture: String,
    pub preset: String,
    pub recipe: String,
    pub zone: String,
    pub density: f64,
    pub count: usize,
    pub rings: usize,
    /// Zero uses the settlement's existing population-derived radius.
    pub radius: f64,
    pub radius_scale: f64,
    pub placement: String,
    pub monument: String,
    pub fortification: String,
    /// `auto` (cultural draw) or a style of `fortification::STYLES`, applied
    /// when it fits the fortification kind (« Style de l’enceinte »).
    pub fortification_style: String,
    pub max_street_grade: f64,
    pub max_lane_grade: f64,
    pub max_stair_grade: f64,
    pub allow_stairs: bool,
    pub params: Value,
    /// Per-quarter user edits (inspector « éditer un quartier »); empty by default.
    pub overrides: UrbanOverrides,
    /// Yield correction of the adaptive-capacity plan, set only by the closed
    /// loop of `quarters::generate` (0 = none). Internal, never serialized.
    #[serde(skip)]
    pub capacity_yield: f64,
    /// Densification the closed loop already measured as insufficient: the
    /// second plan starts from it (internal, never serialized).
    #[serde(skip)]
    pub capacity_floor: f64,
}
/// User overrides keyed by the quarter's index in `layout.quarters`.
///
/// Stability rule: the composition quarters (the first ones in `layout.quarters`)
/// depend only on the seed, the site and the layout config *without* `overrides`:
/// culture/tissue/density edits act after the quarter partition, on that quarter's
/// subdivision only, with an RNG forked from the quarter index, so editing one
/// quarter never renumbers or reshapes them. Peripheral frontage strips appended
/// after them follow the final streets and may change. An edited culture reaches
/// the quarter's lots through an appended growth phase. Role and wealth overrides
/// are applied by the programme stage.
#[derive(Clone, Debug, Default, PartialEq, Serialize, Deserialize)]
#[serde(default, rename_all = "camelCase")]
pub struct UrbanOverrides {
    pub quarters: std::collections::BTreeMap<String, QuarterOverride>,
}
#[derive(Clone, Debug, Default, PartialEq, Serialize, Deserialize)]
#[serde(default, rename_all = "camelCase")]
pub struct QuarterOverride {
    pub role: Option<String>,
    pub wealth: Option<f64>,
    pub culture: Option<String>,
    pub tissue: Option<String>,
    pub density: Option<f64>,
    /// New outline (`urban/edits.rs`): clipped to dry land, the other quarters
    /// and the main streets; the quarter's interior is redrawn inside it.
    #[serde(skip_serializing_if = "Option::is_none")]
    pub shape: Option<Shape>,
    /// The quarter owns no block any more; main streets stay.
    #[serde(skip_serializing_if = "Option::is_none")]
    pub deleted: Option<bool>,
    /// Redraw of the quarter's interior (streets, blocks, lots); absent = original.
    #[serde(skip_serializing_if = "Option::is_none")]
    pub salt: Option<u32>,
}
impl Default for LayoutConfig {
    fn default() -> Self {
        Self {
            programme: ProgrammeContext::default(),
            footprint: FootprintConfig::default(),
            axis_alignment: "regional".into(),
            site_adaptation: 1.0,
            mix_culture: String::new(),
            mix_mode: "phases".into(),
            mix_share: 0.5,
            mix_angle: 0.0,
            exit_treatment: "adaptive".into(),
            peripheral_road: "auto".into(),
            tissue: "culture".into(),
            access_mode: "adaptive".into(),
            access_depth: 0.0,
            access_budget: 4,
            composition: "settlement".into(),
            settlement_form: "auto".into(),
            site_archetype: String::new(),
            suburbs: "auto".into(),
            phases: 0,
            culture: "site".into(),
            preset: "culture".into(),
            recipe: "auto".into(),
            zone: "auto".into(),
            density: 1.0,
            count: 4,
            rings: 1,
            radius: 0.0,
            radius_scale: 1.0,
            placement: "center".into(),
            monument: "none".into(),
            fortification: "culture".into(),
            fortification_style: "auto".into(),
            max_street_grade: 0.12,
            max_lane_grade: 0.18,
            max_stair_grade: 0.65,
            allow_stairs: true,
            params: json!({}),
            overrides: UrbanOverrides::default(),
            capacity_yield: 0.0,
            capacity_floor: 0.0,
        }
    }
}
fn legacy_exits() -> String {
    "legacy".into()
}
fn culture_axis() -> String {
    "culture".into()
}
#[derive(Clone, Debug, Serialize, Deserialize)]
#[serde(default, rename_all = "camelCase", deny_unknown_fields)]
pub struct ParcelConfig {
    pub operator: String,
    pub culture: String,
    pub preset: String,
    pub recipe: String,
    pub zone: String,
    pub density: f64,
    pub params: Value,
    /// Per-lot user edits (« éditer une parcelle »); empty by default.
    pub overrides: ParcelOverrides,
}
/// User overrides keyed by parcel id. Parcel ids hash the lot geometry within
/// its block, so they are stable for the same layout and parcel config; these
/// overrides only change uses, never geometry, so they never renumber lots.
/// A quarter role override can move programme reservations, hence re-cut and
/// re-identify the lots of the blocks involved.
#[derive(Clone, Debug, Default, PartialEq, Serialize, Deserialize)]
#[serde(default, rename_all = "camelCase")]
pub struct ParcelOverrides {
    pub parcels: std::collections::BTreeMap<String, ParcelOverride>,
}
/// Forced use of one lot: a catalogue role (`worship.parish`, `commerce.inn`,
/// `open.garden`, `dwelling.mansion`…), a houses function, a household count.
#[derive(Clone, Debug, Default, PartialEq, Serialize, Deserialize)]
#[serde(default, rename_all = "camelCase")]
pub struct ParcelOverride {
    pub role: Option<String>,
    pub function: Option<String>,
    pub households: Option<f64>,
    /// New outline (`urban/edits.rs`), clipped to its block; neighbours give up
    /// or take back the difference. The lot keeps its id.
    #[serde(skip_serializing_if = "Option::is_none")]
    pub shape: Option<Shape>,
    /// `merge` (absorbed by its best neighbour) or `garden` (unbuilt open ground).
    #[serde(skip_serializing_if = "Option::is_none")]
    pub deleted: Option<String>,
    /// Redraw of the lot's use among admissible demands, and of its house seed.
    #[serde(skip_serializing_if = "Option::is_none")]
    pub salt: Option<u32>,
}
impl Default for ParcelConfig {
    fn default() -> Self {
        Self {
            operator: "culture".into(),
            culture: "site".into(),
            preset: "culture".into(),
            recipe: "auto".into(),
            zone: "auto".into(),
            density: 1.0,
            params: json!({}),
            overrides: ParcelOverrides::default(),
        }
    }
}

#[derive(Clone, Copy)]
pub struct Surface<'a> {
    pub geometry: Option<&'a Geography>,
    pub width: f64,
    pub n: usize,
    pub height: &'a [f32],
    pub water: &'a [u8],
}
impl Surface<'_> {
    pub fn height_at(&self, p: Point) -> f64 {
        let x = (p.x / self.width * self.n as f64 - 0.5).clamp(0.0, (self.n - 1) as f64);
        let y = (p.y / self.width * self.n as f64 - 0.5).clamp(0.0, (self.n - 1) as f64);
        let (ix, iy) = (x.floor() as usize, y.floor() as usize);
        let h = |dx: usize, dy: usize| {
            self.height[(iy + dy).min(self.n - 1) * self.n + (ix + dx).min(self.n - 1)] as f64
        };
        let (tx, ty) = (x.fract(), y.fract());
        (h(0, 0) * (1.0 - tx) + h(1, 0) * tx) * (1.0 - ty)
            + (h(0, 1) * (1.0 - tx) + h(1, 1) * tx) * ty
    }
    pub fn wet(&self, p: Point) -> bool {
        if p.x < 0.0 || p.y < 0.0 || p.x >= self.width || p.y >= self.width {
            return true;
        }
        if let Some(geometry) = self.geometry {
            return geometry.wet(p);
        }
        let x = (p.x / self.width * self.n as f64) as usize;
        let y = (p.y / self.width * self.n as f64) as usize;
        self.water[y.min(self.n - 1) * self.n + x.min(self.n - 1)] != 0
    }
}

#[derive(Clone)]
pub(super) struct Morph {
    pub value: Value,
}
/// Tissue is independent from footprint and cultural defaults. Access recipes stay cultural.
pub(super) fn with_tissue(mut morph: Morph, tissue: &str) -> Morph {
    match tissue {
        "grid" => {
            morph.value["streetOp"] = json!("grid");
            morph.value["fieldNoise"] = json!(0.0);
        }
        "organic" => {
            morph.value["streetOp"] = json!("organic");
            morph.value["fieldRandom"] = json!(0.6);
        }
        "radial" => {
            morph.value["streetOp"] = json!("organic");
            morph.value["fieldRandom"] = json!(0.0);
        }
        "terraces" => {
            morph.value["streetOp"] = json!("organic");
            morph.value["contourFollow"] = json!(1.0);
        }
        "dendritic" => {
            morph.value["streetOp"] = json!("organic");
            morph.value["closeOp"] = json!("derbs");
            morph.value["deadEndRatio"] = json!(0.8);
        }
        "clusters" => {
            morph.value["streetOp"] = json!("organic");
            morph.value["closeOp"] = json!("closes");
        }
        _ => {}
    }
    morph
}
impl Morph {
    pub fn number(&self, key: &str) -> f64 {
        self.number_or(key, 0.0)
    }
    pub fn number_or(&self, key: &str, default: f64) -> f64 {
        self.value[key].as_f64().unwrap_or(default)
    }
    pub fn pair(&self, key: &str) -> [f64; 2] {
        [
            self.value[key][0].as_f64().unwrap_or(0.0),
            self.value[key][1].as_f64().unwrap_or(0.0),
        ]
    }
    pub fn range(&self, key: &str, zone: &str) -> [f64; 2] {
        [
            self.value[key][zone][0].as_f64().unwrap_or(0.0),
            self.value[key][zone][1].as_f64().unwrap_or(0.0),
        ]
    }
    pub fn text(&self, key: &str) -> &str {
        self.value[key].as_str().unwrap_or("")
    }
    pub fn flag(&self, key: &str) -> bool {
        self.value[key].as_bool().unwrap_or(false)
    }
    pub fn width(&self, rank: usize, rng: &mut Rng) -> f64 {
        self.value["widthByRank"][rank.min(4)]
            .as_f64()
            .unwrap_or(3.0)
            * self.number("widthScale")
            * rng.range(
                1.0 - self.number("widthJitter"),
                1.0 + self.number("widthJitter"),
            )
    }
}
fn catalogue() -> &'static Value {
    static CATALOGUE: OnceLock<Value> = OnceLock::new();
    CATALOGUE.get_or_init(|| {
        serde_json::from_str(include_str!("catalogue.json")).expect("versioned urban catalogue")
    })
}
fn resolve(
    culture: &str,
    preset: &str,
    recipe: &str,
    zone: &str,
    density: f64,
    params: &Value,
    stage: &str,
) -> Result<Morph, String> {
    if !["core", "middle", "edge", "faubourg", "village"].contains(&zone)
        || !density.is_finite()
        || !(0.1..=10.0).contains(&density)
    {
        return Err("Zone ou densité urbaine invalide".into());
    }
    let cat = catalogue();
    let preset_id = if preset == "culture" {
        format!(
            "{culture}/{}",
            if recipe == "auto" { "core" } else { recipe }
        )
    } else {
        preset.into()
    };
    let mut value = cat["presets"][&preset_id]["params"].clone();
    if !value.is_object() {
        return Err(format!("Préréglage urbain inconnu : {preset_id}"));
    }
    // Same density transformation as TypeScript applySprawl, applied before overrides.
    let f = (1.0 / density).clamp(0.5, 2.0).log2();
    for (key, scale, lo, hi) in [
        ("coverage", 1.0 - 0.24 * f, 0.05, 0.97),
        ("frontage", 1.0 + 0.32 * f, 3.5, f64::MAX),
        ("plotDepth", 1.0 + 0.22 * f, 8.0, f64::MAX),
        (
            "blockSize",
            1.0 + if f > 0.0 { 0.45 } else { 0.1 } * f,
            300.0,
            f64::MAX,
        ),
        (
            "houseArea",
            1.0 + if f > 0.0 { 0.25 } else { 0.12 } * f,
            30.0,
            f64::MAX,
        ),
    ] {
        if let Some(zones) = value[key].as_object_mut() {
            for range in zones.values_mut() {
                if let Some(a) = range.as_array_mut() {
                    for n in a {
                        *n = json!((n.as_f64().unwrap_or(0.0) * scale).clamp(lo, hi));
                    }
                }
            }
        }
    }
    let overrides = params
        .as_object()
        .ok_or("Les paramètres urbains doivent être un objet JSON")?;
    for (key, val) in overrides {
        if !cat["fields"][stage]
            .as_array()
            .is_some_and(|a| a.iter().any(|v| v.as_str() == Some(key)))
        {
            return Err(format!("{key} n'est pas utilisé par l'étape {stage}"));
        }
        let optional = match key.as_str() {
            "deepFill" => json!(false),
            _ => json!(0.0),
        };
        let reference = if value.get(key).is_some() {
            &value[key]
        } else {
            &optional
        };
        validate_param(key, val, reference)?;
        merge(&mut value[key], val);
    }
    let morph = Morph { value };
    if !["organic", "grid"].contains(&morph.text("streetOp"))
        || !["closes", "culDeSacTree", "hutong", "roji", "none"].contains(&morph.text("closeOp"))
        || !["road", "cardinal", "terrain", "water"].contains(&morph.text("orientation"))
        || ![
            "burgage",
            "courtyard",
            "siheyuan",
            "machiya",
            "compound",
            "garden",
            "wholeBlock",
        ]
        .contains(&morph.text("plotOp"))
    {
        return Err("Opérateur urbain inconnu".into());
    }
    for key in ["widthScale", "minWidth", "fieldWavelength", "accessDepth"] {
        if morph.number(key) <= 0.0 {
            return Err(format!("{key} doit être supérieur à zéro"));
        }
    }
    if morph.pair("gridSpacing").iter().any(|&v| v <= 0.0)
        || morph.range("frontage", zone)[0] <= 0.0
        || morph.range("houseArea", zone)[0] <= 0.0
        || morph.range("blockSize", zone)[0] <= 0.0
    {
        return Err("Espacement, surface et façade doivent être positifs".into());
    }
    Ok(morph)
}
fn validate_param(key: &str, value: &Value, reference: &Value) -> Result<(), String> {
    let invalid = || format!("{key} : valeur ou type invalide");
    match (value, reference) {
        (Value::Number(n), Value::Number(_)) => {
            let n = n.as_f64().ok_or_else(invalid)?;
            if !n.is_finite() || n.abs() > 1e9 || n < 0.0 && key != "fieldTwist" {
                return Err(invalid());
            }
            if [
                "coverage",
                "wideLotChance",
                "deadEndRatio",
                "slitDepth",
                "widthJitter",
                "contourFollow",
                "contourBlend",
                "fieldRandom",
            ]
            .contains(&key)
                && n > 1.0
            {
                return Err(invalid());
            }
        }
        (Value::Array(a), Value::Array(b)) if a.len() == b.len() => {
            for (v, r) in a.iter().zip(b) {
                validate_param(key, v, r)?;
            }
            if a.len() == 2
                && !["gridSpacing", "laneSpacing"].contains(&key)
                && a[0].as_f64() > a[1].as_f64()
            {
                return Err(invalid());
            }
        }
        (Value::Object(a), Value::Object(b)) => {
            for (k, v) in a {
                validate_param(key, v, b.get(k).ok_or_else(invalid)?)?;
            }
        }
        (Value::Bool(_), Value::Bool(_)) | (Value::String(_), Value::String(_)) => {}
        _ => return Err(invalid()),
    }
    Ok(())
}
fn merge(base: &mut Value, patch: &Value) {
    if let (Some(b), Some(p)) = (base.as_object_mut(), patch.as_object()) {
        for (key, v) in p {
            merge(b.entry(key).or_insert(Value::Null), v);
        }
    } else {
        *base = patch.clone();
    }
}

pub fn generate_quarters(
    seed: &str,
    sites: &[Site],
    config: &LayoutConfig,
    surface: Surface<'_>,
    roads: &[Street],
) -> Result<Vec<Layout>, String> {
    if !["regional", "culture"].contains(&config.axis_alignment.as_str())
        || !config.site_adaptation.is_finite()
        || !(0.0..=2.0).contains(&config.site_adaptation)
        || !["phases", "sectors"].contains(&config.mix_mode.as_str())
        || !config.mix_share.is_finite()
        || !(0.0..=1.0).contains(&config.mix_share)
        || !config.mix_angle.is_finite()
        || !(-180.0..=180.0).contains(&config.mix_angle)
        || (!config.mix_culture.is_empty()
            && !catalogue()["cultures"][&config.mix_culture].is_object())
        || !["legacy", "adaptive", "closed"].contains(&config.exit_treatment.as_str())
        || !["auto", "none", "partial", "full"].contains(&config.peripheral_road.as_str())
    {
        return Err("Configuration des influences ou des sorties invalide".into());
    }
    let f = &config.footprint;
    if ![
        "auto",
        "legacy",
        "planned",
        "accessibility",
        "ribbon",
        "fusion",
    ]
    .contains(&f.mechanism.as_str())
        || ![
            "auto",
            "circle",
            "rectangle",
            "polygon",
            "compact",
            "elongated",
            "linear",
            "fan",
            "fingers",
            "dendritic",
            "lobed",
            "archipelago",
            "composite",
        ]
        .contains(&f.family.as_str())
        || !["population", "radius"].contains(&f.budget.as_str())
        || !f.gross_density.is_finite()
        || !(0.0..=1000.0).contains(&f.gross_density)
        || !f.aspect.is_finite()
        || !(1.0..=6.0).contains(&f.aspect)
        || !f.orientation.is_finite()
        || !(-180.0..=180.0).contains(&f.orientation)
        || !(1..=6).contains(&f.nuclei)
        || !(1..=5).contains(&f.epochs)
        || !f.irregularity.is_finite()
        || !(0.0..=1.0).contains(&f.irregularity)
        || !f.anisotropy.is_finite()
        || !(0.0..=1.0).contains(&f.anisotropy)
        || !f.separation.is_finite()
        || !(0.4..=3.0).contains(&f.separation)
        || [f.cohesion, f.satellites, f.branch_depth]
            .iter()
            .any(|v| !v.is_finite() || !(0.0..=1.0).contains(v))
        || !f.gap_size.is_finite()
        || !(10.0..=500.0).contains(&f.gap_size)
        || ![
            "culture",
            "grid",
            "organic",
            "radial",
            "terraces",
            "dendritic",
            "clusters",
        ]
        .contains(&config.tissue.as_str())
        || !["adaptive", "cultural", "none"].contains(&config.access_mode.as_str())
        || !config.access_depth.is_finite()
        || !(0.0..=200.0).contains(&config.access_depth)
        || config.access_budget > 12
    {
        return Err("Configuration d’empreinte, de tissu ou de desserte invalide".into());
    }
    if surface.n < 2
        || !surface.width.is_finite()
        || surface.width <= 0.0
        || surface.height.len() != surface.n * surface.n
        || surface.water.len() != surface.n * surface.n
        || surface.height.iter().any(|h| !h.is_finite())
        || roads.iter().any(|s| {
            s.path.iter().any(|p| !p.x.is_finite() || !p.y.is_finite())
                || s.widths
                    .iter()
                    .any(|w| !w.is_finite() || *w <= 0.0 || *w > 100.0)
        })
    {
        return Err("Terrain ou routes urbaines invalides".into());
    }
    if sites.len() > 1000
        || !["settlement", "district"].contains(&config.composition.as_str())
        || !(["auto", "nucleated", "ribbon"].contains(&config.settlement_form.as_str())
            || kinds::Kind::from_id(&config.settlement_form).is_some())
        || config.site_archetype.len() > 32
        || !["auto", "none", "few", "many"].contains(&config.suburbs.as_str())
        || config.phases > 5
        || !(3..=64).contains(&config.count)
        || !(1..=2).contains(&config.rings)
        || !config.radius.is_finite()
        || !(0.0..=25000.0).contains(&config.radius)
        || !config.radius_scale.is_finite()
        || !(0.1..=5.0).contains(&config.radius_scale)
        || !["center", "rectangle", "skew", "notched"].contains(&config.placement.as_str())
        || !["culture", "none", "wall", "palisade"].contains(&config.fortification.as_str())
        || !(config.fortification_style == "auto"
            || fortification::STYLES.contains(&config.fortification_style.as_str()))
        || !config.max_street_grade.is_finite()
        || !(0.02..=0.3).contains(&config.max_street_grade)
        || !config.max_lane_grade.is_finite()
        || !(config.max_street_grade..=0.4).contains(&config.max_lane_grade)
        || !config.max_stair_grade.is_finite()
        || !(config.max_lane_grade..=1.0).contains(&config.max_stair_grade)
    {
        return Err("Configuration de quartiers invalide".into());
    }
    let mut keys = BTreeSet::new();
    let mut out = vec![];
    for site in sites {
        if !keys.insert(&site.key)
            || site.key.is_empty()
            || !site.radius.is_finite()
            || site.radius <= 0.0
            || site.radius > 25000.0
            || !site.center.x.is_finite()
            || !site.center.y.is_finite()
            || !(0.0..=surface.width).contains(&site.center.x)
            || !(0.0..=surface.width).contains(&site.center.y)
        {
            return Err("Settlement urbain invalide".into());
        }
        // The settlement kind sets the macro grammar; the layout keeps the
        // user's configuration (`kinds::finish`).
        let original = config;
        let (effective, kind) = kinds::effective(site, original, roads);
        let config = &effective;
        let culture = if config.culture == "site" {
            &site.culture
        } else {
            &config.culture
        };
        let morph = resolve(
            culture,
            &config.preset,
            &config.recipe,
            if config.zone == "auto" {
                "core"
            } else {
                &config.zone
            },
            config.density,
            &config.params,
            "quarters",
        )?;
        let morph = with_tissue(morph, &config.tissue);
        let key_seed = format!("{seed}\u{1}settlement:{}", site.key);
        // edits hook (urban/edits.rs): structural quarter edits splice a
        // variant plan into this one; without them this is plan then finish.
        let plan = |config: &LayoutConfig| -> Result<Layout, String> {
            let small = (kind.small() && config.footprint.mechanism != "legacy")
                .then(|| kinds::lay_out(&key_seed, site, config, kind, &morph, surface, roads))
                .flatten();
            let mut layout = match small {
                Some(layout) => layout,
                None => quarters::generate(&key_seed, site, config, &morph, surface, roads)?,
            };
            kinds::stamp(&mut layout, kind, original);
            access::refine(&mut layout, config, &morph, surface);
            // Fortifications follow the final streets and blocks.
            fortification::settle(&mut layout, surface);
            Ok(layout)
        };
        let finish = |layout: &mut Layout| -> Result<(), String> {
            access::summarize(layout, config);
            programme::prepare(layout, site.population, &config.programme, surface)?;
            kinds::finish(layout, kind, original);
            Ok(())
        };
        out.push(edits::with_quarter_edits(config, plan, finish)?);
    }
    Ok(out)
}
pub fn generate_parcels(
    seed: &str,
    layouts: &[Layout],
    config: &ParcelConfig,
) -> Result<Vec<Partition>, String> {
    if ![
        "culture",
        "strips",
        "oriented",
        "compact",
        "inherited",
        "courtyard",
        "frontage",
        "compound",
        "wholeBlock",
        "garden",
    ]
    .contains(&config.operator.as_str())
    {
        return Err("Opérateur de parcelles inconnu".into());
    }
    edits::validate_parcels(config)?;
    let mut out = vec![];
    for layout in layouts {
        let culture = if config.culture == "site" {
            &layout.culture
        } else {
            &config.culture
        };
        let morph = resolve(
            culture,
            &config.preset,
            &config.recipe,
            if config.zone == "auto" {
                "core"
            } else {
                &config.zone
            },
            config.density,
            &config.params,
            "parcels",
        )?;
        let key_seed = format!("{seed}\u{1}settlement:{}", layout.key);
        let mut partition = parcels::generate(&key_seed, layout, config, &morph)?;
        // edits hook (urban/edits.rs): lot shapes and deletions.
        edits::apply_parcel_edits(layout, &mut partition);
        programme::allocate(layout, &mut partition);
        out.push(partition);
    }
    Ok(out)
}
