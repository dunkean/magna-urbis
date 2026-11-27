//! The products of the quarter and parcel stages (`Layout`, `Partition`) and
//! the records they hold, as the bridge serializes them, and the `Site` a
//! quarter call lays out.
use super::{BlockEdits, LayoutConfig, ParcelConfig, Point, Shape, UrbanProgramme, edits, enclosure, lagoon, macroplan, neighbours, shanty, springs};
use serde::{Deserialize, Serialize};

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
    #[serde(default, skip_serializing_if = "String::is_empty")]
    pub edit_key: String,
    pub path: Vec<Point>,
    pub kind: String,
    pub gates: Vec<Point>,
    /// Indices in `gates` of the gates that open on an attached extension
    /// (between old and new town): not outer gates.
    #[serde(default, skip_serializing_if = "Vec::is_empty")]
    pub inner_gates: Vec<usize>,
    /// Tower anchors on the curtain: `towers[i] == towers_detail[i].anchor`
    /// (gate towers, then corners, then flanks).
    #[serde(default, skip_serializing_if = "Vec::is_empty")]
    pub towers: Vec<Point>,
    /// `palisade|gord|hedge|curtain|flanked|concentric|rammed-earth|wengcheng|bastioned`.
    #[serde(default, skip_serializing_if = "String::is_empty")]
    pub style: String,
    #[serde(default, skip_serializing_if = "String::is_empty")]
    pub purpose: String,
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
    /// Ditch pieces, kind `dry|wet|pool`: one per reach of `moat.runs`, plus the detached ditches of outworks.
    #[serde(default, skip_serializing_if = "Vec::is_empty")]
    pub ditch: Vec<Work>,
    /// Form and water joins of the ditch (`fortification::moat`); absent without a ditch.
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub moat: Option<MoatSpec>,
    #[serde(default, skip_serializing_if = "Vec::is_empty")]
    pub attached: Vec<Attached>,
    /// Union of the curtain body and every structure outside the inner face:
    /// land no quarter, block or lot occupies.
    #[serde(default, skip_serializing_if = "Vec::is_empty")]
    pub reserve: Vec<Shape>,
}
pub(super) fn is_zero(v: &f64) -> bool {
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
/// How a circuit's ditch is cut and where it meets natural water. The fill of each piece (dry bottom,
/// low, stagnant or brim-full water, ice) follows climate and season: the renderers decide it.
#[derive(Clone, Debug, Default, PartialEq, Serialize, Deserialize)]
pub struct MoatSpec {
    /// Form id of `fortifications.json` `moats` (profile, revetment, scarp).
    pub form: String,
    /// Sluices of a wet ditch: from the middle of a `water` run end whose reach is fed to the natural water it stops short of.
    #[serde(default, skip_serializing_if = "Vec::is_empty")]
    pub sluices: Vec<[Point; 2]>,
    /// Dams between two fed reaches of a run, across it at their shared station: inner lip, outer lip.
    #[serde(default, skip_serializing_if = "Vec::is_empty")]
    pub dams: Vec<[Point; 2]>,
    /// State of the town (`thriving|declining|abandoned|ruined`, empty: unknown): an unkept ditch silts and grows over.
    #[serde(default, skip_serializing_if = "String::is_empty")]
    pub state: String,
    /// Nominal breadth and depth of the ditch (m).
    #[serde(default, skip_serializing_if = "is_zero")]
    pub width_m: f64,
    #[serde(default, skip_serializing_if = "is_zero")]
    pub depth_m: f64,
    /// The ditch itself (`fortification::moat_line`): every stretch between two natural stops, as stations.
    /// `Enclosure::ditch` is derived from them (one polygon per reach).
    #[serde(default, skip_serializing_if = "Vec::is_empty")]
    pub runs: Vec<MoatRun>,
    /// Where a street crosses a run. A crossing never interrupts the ditch.
    #[serde(default, skip_serializing_if = "Vec::is_empty")]
    pub crossings: Vec<MoatCrossing>,
}
/// One continuous stretch of ditch. Station `k` is the cross-section from `inner[k]` (scarp lip, curtain side)
/// to `outer[k]` (counterscarp lip); the four arrays have one entry per station, in walking order.
#[derive(Clone, Debug, Default, PartialEq, Serialize, Deserialize)]
pub struct MoatRun {
    /// A ring: the last station joins the first.
    #[serde(default)]
    pub closed: bool,
    pub inner: Vec<Point>,
    pub outer: Vec<Point>,
    /// Ground height (m) of the lower of the two lips, in the height frame of the urban request.
    pub rim: Vec<f32>,
    /// Height (m) of the bottom, same frame: smooth along the run, level across it.
    pub bed: Vec<f32>,
    /// What stops the run before its first and after its last station: `closed|water|slope|work`.
    pub ends: [String; 2],
    /// Reaches in walking order, covering every station; two neighbours share their boundary station, and the
    /// last reach of a closed run ends on station 0 (`to <= from`; a closed run of one reach is `0..=0`, the ring).
    pub reaches: Vec<MoatReach>,
}
/// Stations `from..=to` of a run: one supply, one water level.
#[derive(Clone, Debug, Default, PartialEq, Serialize, Deserialize)]
pub struct MoatReach {
    pub from: usize,
    pub to: usize,
    /// `fed` (joined to a river, the sea or a canal, and not above it), `pool` (a wet moat without a source), `dry`.
    pub supply: String,
    /// Water surface (m, frame of `MoatRun::rim`) of a `fed` reach; the fill of a `pool` follows climate and season.
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub level: Option<f32>,
}
#[derive(Clone, Debug, Default, PartialEq, Serialize, Deserialize)]
pub struct MoatCrossing {
    /// Index in `MoatSpec::runs`.
    pub run: usize,
    /// Centre line of the crossing, from 1 m inside the inner lip to 3 m beyond the outer lip (two points or more).
    pub path: Vec<Point>,
    pub half_width_m: f64,
    /// `bridge` (the ditch runs on under a deck) or `causeway` (the ditch is filled across, with a culvert).
    pub kind: String,
    /// Index in `Enclosure::gates` of a gate crossing; absent for another street.
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub gate: Option<usize>,
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
    /// The land and edge streets this town holds, for the towns generated after it.
    #[serde(default)]
    pub claim: neighbours::Claim,
}
#[derive(Clone, Debug, Default, Serialize, Deserialize)]
#[serde(default, rename_all = "camelCase")]
pub struct UrbanStructure {
    /// Source plan data needed to keep unaffected lots through a quarter redraw.
    #[serde(skip_serializing_if = "Option::is_none")]
    pub quarter_baseline: Option<Box<edits::quarter_baseline::QuarterBaseline>>,
    /// Appended informal quarters, with the formal prefix boundaries retained.
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub shanty: Option<shanty::Extension>,
    /// Source-bound water buildings, independent of optional service budgets.
    #[serde(skip_serializing_if = "Vec::is_empty")]
    pub spring_sites: Vec<springs::SpringSite>,
    /// Gate markets retained independently of street merging and deduplication.
    #[serde(skip_serializing_if = "Vec::is_empty")]
    pub gate_village_centers: Vec<Point>,
    /// Pending local cuts, applied after the inherited streets and trim.
    #[serde(skip)]
    pub gate_village_lanes: Vec<Street>,
    /// Built waterfront platforms, retained independently from street centrelines.
    pub quays: Vec<macroplan::harbour::Quay>,
    #[serde(skip_serializing_if = "Vec::is_empty")]
    pub waterways: Vec<lagoon::Waterway>,
    pub version: u32,
    pub mechanism: String,
    pub family: String,
    pub reserve: Vec<Shape>,
    pub allocated: Vec<Shape>,
    pub centers: Vec<UrbanCenter>,
    pub districts: Vec<UrbanDistrict>,
    /// Explicit port masks for enclosure decisions, after the nucleus carve.
    #[serde(skip_serializing_if = "Vec::is_empty")]
    pub port_districts: Vec<PortDistrict>,
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
pub struct PortDistrict {
    pub district: usize,
    pub role: String,
    pub quarters: Vec<usize>,
    pub shapes: Vec<Shape>,
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
    /// Underdark: land per home over the culture's once a cave town found too little floor
    /// (`settlements::CAVE_LAND_PER_HOME` to 1; 0 = as drawn); storeys rise in proportion,
    /// up to `settlements::CAVE_HEIGHT`.
    #[serde(skip_serializing_if = "cave_pack_unset")]
    pub cave_pack: f64,
}
fn cave_pack_unset(v: &f64) -> bool {
    *v == 0.0
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
    /// Resolved enclosure values (culture defaults and overrides) of this city.
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub enclosure: Option<enclosure::Resolved>,
    /// The blocks `parcels[].block` indexes when structural block edits
    /// changed the input layout's (`partition_layout`); absent otherwise.
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub prepared: Option<PreparedBlocks>,
}
#[derive(Clone, Debug, Default, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct PartitionDiagnostics {
    pub covered_area: f64,
    pub residual_area: f64,
    pub overlap_area: f64,
    pub unserved_area: f64,
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
    /// Claims of the towns generated before this one (`neighbours`): land this
    /// town never builds on, streets it joins.
    #[serde(default)]
    pub neighbours: Vec<neighbours::Claim>,
}
/// Blocks the lots of a partition index, when structural block edits changed
/// them: the caller replaces `layout.blocks` with `blocks` and
/// `layout.config.block_edits` with `edits` (`partition_layout`).
#[derive(Clone, Debug, Default, Serialize, Deserialize)]
#[serde(default, rename_all = "camelCase")]
pub struct PreparedBlocks {
    pub blocks: Vec<Block>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub edits: Option<BlockEdits>,
}
