//! The configurations of the quarter and parcel stages, with their defaults
//! and the serde defaults and predicates of their fields.
use super::types::is_zero;
use super::{BlockEdits, ParcelOverrides, PhaseOverride, ProgrammeContext, QuarterEdits, UrbanOverrides, house_mix};
use serde::{Deserialize, Serialize};
use serde_json::{Value, json};

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
    /// Generation scope: `settlement` (whole place) or `district` (one isolated district sample).
    pub scope: String,
    /// `auto`, `nucleated`, `ribbon`, or a settlement kind id (`kinds::Kind`:
    /// `single`, `ruin`, `farmstead`, `camp`, `hamlet`, `street-village`,
    /// `nucleated-village`, `market-town`, `walled-town`, `city`, `metropolis`).
    pub settlement_form: String,
    /// Site archetype from settlement placement (`harbor`, `bridge`, `hilltop`,
    /// `spur`, `pass`, `island`, `lakeshore`, `valley`, `plain`); empty = unknown.
    pub site_archetype: String,
    /// Placement context per settlement when a request contains several towns.
    pub site_archetypes: std::collections::BTreeMap<String, String>,
    /// User-placed foundations. Every urban stage keeps the supplied centre.
    pub fixed_sites: std::collections::BTreeSet<String>,
    pub suburbs: String,
    /// Informal peripheral quarters: 0 disables, 1 cultural default, up to 3.
    pub shanty_scale: f64,
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
    /// None uses the culture's lagoon model; 0..1 selects its canal share.
    #[serde(skip_serializing_if = "Option::is_none")]
    pub lagoon_canals: Option<f64>,
    /// `auto` (cultural draw) or a style of `fortification::STYLES`, applied
    /// when it fits the fortification kind (« Style de l’enceinte »).
    pub fortification_style: String,
    #[serde(skip_serializing_if = "std::ops::Not::not")]
    pub old_enclosure_citadel: bool,
    #[serde(skip_serializing_if = "std::ops::Not::not")]
    pub medieval_walls: bool,
    #[serde(skip_serializing_if = "std::ops::Not::not")]
    pub river_control: bool,
    #[serde(skip_serializing_if = "std::ops::Not::not")]
    pub dry_ditches: bool,
    /// None retains the pre-parameter cultural/default draw.
    #[serde(skip_serializing_if = "Option::is_none")]
    pub wall_stiffness: Option<f64>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub wall_terrain: Option<f64>,
    /// 0 walls round every knoll, 1 lets straight runs cross any relief; None keeps maxCrestM.
    #[serde(skip_serializing_if = "Option::is_none")]
    pub wall_relief: Option<f64>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub wall_tower_spacing: Option<f64>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub ditch_wetness: Option<f64>,
    #[serde(skip_serializing_if = "String::is_empty")]
    pub river_control_mode: String,
    #[serde(skip_serializing_if = "String::is_empty")]
    pub port_enclosure: String,
    /// Wall of a planned (square/rect) culture: "" auto (rectangle where the land
    /// allows it), "rect" always the plan's rectangle, "follow" the town's own trace.
    #[serde(skip_serializing_if = "String::is_empty")]
    pub planned_wall: String,
    /// Castle on the heights: "" auto (culture share, where a knoll rises in
    /// or at the rim of the town), "none", "force" (the highest knoll).
    #[serde(skip_serializing_if = "String::is_empty")]
    pub heights_castle: String,
    /// Second enclosure: "" culture default (fortifications.json `wallExtension`),
    /// "concentric", "attached" (grown on one side, sharing a stretch of the old
    /// wall) or "auto" (attached when the growth is lopsided).
    #[serde(skip_serializing_if = "String::is_empty")]
    pub wall_extension: String,
    /// Moat of the town circuits (« Douve »): "" by culture and site, "none"
    /// (no ditch: suburbs and fields come up to the wall), "dry" or "wet" (one
    /// kind for the whole circuit).
    #[serde(skip_serializing_if = "String::is_empty")]
    pub moat: String,
    #[serde(skip_serializing_if = "std::ops::Not::not")]
    pub gate_villages: bool,
    /// Gate nucleus strength. Absent retains the legacy `gateVillages` meaning.
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub gate_village: Option<f64>,
    pub max_street_grade: f64,
    pub max_lane_grade: f64,
    pub max_stair_grade: f64,
    pub allow_stairs: bool,
    #[serde(skip_serializing_if = "std::ops::Not::not")]
    pub power_high_ground: bool,
    #[serde(default, skip_serializing_if = "std::ops::Not::not")]
    pub sheltered_harbour: bool,
    /// 0: waterfront of the main fabric; 1: allow a separate port quarter.
    pub port_detachment: f64,
    /// None preserves old shelteredHarbour links; explicit 0 overrides them.
    #[serde(skip_serializing_if = "Option::is_none")]
    pub port_shelter: Option<f64>,
    /// Harbour type (`harbours.json` types): `auto` draws one or two types of
    /// the culture's family with the town seed, `bare` keeps the quays and
    /// piers alone, a type id forces that type (`harbour_furniture`).
    #[serde(skip_serializing_if = "is_auto_port")]
    pub port_type: String,
    #[serde(skip_serializing_if = "std::ops::Not::not")]
    pub merge_parallel_streets: bool,
    /// Share (0..1) of sustained parallel street runs (less than 4 m of land
    /// between them) collapsed onto the more important road; the rest stay, as
    /// such doubles sometimes do. `mergeParallelStreets` forces 1.
    pub parallel_merge: f64,
    /// Major street ranks narrow below 5 000 inhabitants (off: the culture's
    /// widths whatever the size; hamlets keep their fixed 5 m / 3.5 m).
    pub road_width_by_size: bool,
    /// A regional road takes the town's main-street width inside the built
    /// land and tapers back outside.
    pub town_main_road: bool,
    /// Final pass trimming tails that overshoot a junction and spurs that
    /// never leave their host road.
    pub polish_road_ends: bool,
    /// Remove unused bank-ended branches after the final bridge selection.
    pub river_spur_filter: bool,
    /// Keep bridge decks outside the navigable water in front of a port.
    pub harbour_bridge_clearance: bool,
    /// Not read any more: town gates are decided with their circuit and the
    /// curtain turns square to their streets (`fortification`'s gate
    /// passages). Kept while the bridge configuration still sends the key.
    pub wall_gate_policy: bool,
    /// Remove short redundant triangular links before cutting the blocks.
    pub small_road_loops: bool,
    /// Connect isolated establishments to the retained regional network.
    pub isolated_access: bool,
    /// Village, hamlet and rural homes are low (two storeys under the
    /// tradition) and mostly small; faubourg homes one storey lower.
    pub low_rural_houses: bool,
    /// Share (0..1) of rural homes, farms included, that keep their outbuildings
    /// (0 none, 1 all); isolated farms included.
    pub outbuildings: f64,
    /// House plans: `simple` (one body per home, each convex part under its own
    /// roof) or `complex` (the `forms` grammar: wings, cross-wings, outshots,
    /// porches, turrets, composite roofs with valleys, chimneys and dormers).
    #[serde(skip_serializing_if = "is_simple_houses")]
    pub house_complexity: String,
    /// Density of open towns across their growth phases: `phases` (each phase
    /// keeps its zone's tables) or `gradient` (blocks near another phase take
    /// intermediate values, `zone_blend`; never across a town circuit).
    #[serde(skip_serializing_if = "is_phase_density")]
    pub zone_density: String,
    /// Density of singular and utility buildings (monuments, inns, taverns,
    /// stables, warehouses…): 1 the catalogue's counts, 0 only the nucleus
    /// landmark, up to 3.
    #[serde(skip_serializing_if = "is_one")]
    pub singular_density: f64,
    /// Back buildings of town lots (core and middle zones): the share of the
    /// lots built under half of their tissue's coverage that build the ground
    /// behind their house (0 none, 1 all, up to two thirds of that coverage);
    /// the others keep their court or garden. Only a body on a street or a
    /// lane is a house; the others are low dependencies.
    #[serde(skip_serializing_if = "is_half")]
    pub back_buildings: f64,
    /// Style sheet of a hybrid place: per facet, the cultures it draws from.
    /// An empty facet follows the place's own culture.
    #[serde(skip_serializing_if = "StyleSheet::is_empty")]
    pub style_sheet: StyleSheet,
    /// Access ways (closes, derbs) start on their street's axis and nubs go (off: 2 m past it, as drawn).
    pub road_mouths: bool,
    /// Remnants of moved crossings, spurs inside another street's ribbon and short doubled links go.
    pub road_remnants: bool,
    /// A loose street end whose ribbon reaches another street joins it, before the blocks are cut.
    pub road_end_joins: bool,
    /// Share (0 to 1) of the street tidying decisions left as first drawn, so
    /// that a town keeps some of the mess of a place patched over time: a
    /// road that was there, works done in a hurry, tidied later. 0 tidies
    /// every one, 1 none. Each decision draws once from its own seeded stream,
    /// keyed on the thing decided (never on thread or hash order). Real faults
    /// (a street through a wall without a gate, a gate without a street, a
    /// loose diversion) are always fixed. First rule to use it: a town gate
    /// whose street is not square to the curtain keeps its skew instead of a
    /// squared gate front (`fortification`'s gate passages).
    #[serde(skip_serializing_if = "is_quarter")]
    pub street_improvisation: f64,
    /// Small places (under ~650 inhabitants) redraw for capacity only past 8 missing households.
    pub small_place_capacity: bool,
    /// V7: prune unused local paths as well as streets; retain necessary through routes.
    #[serde(skip_serializing_if = "std::ops::Not::not")]
    pub street_frontage: bool,
    #[serde(skip_serializing_if = "std::ops::Not::not")]
    pub natural_camp_approaches: bool,
    /// None keeps the culture's circle; 0..0.4 swells its circular track.
    #[serde(skip_serializing_if = "Option::is_none")]
    pub camp_ring_wobble: Option<f64>,
    #[serde(skip_serializing_if = "std::ops::Not::not")]
    pub align_enclosed_grid: bool,
    #[serde(skip_serializing_if = "std::ops::Not::not")]
    pub hide_unused_quarters: bool,
    /// V7: very deep blocks get a back lane (`deep_blocks`) so houses fill their core.
    #[serde(skip_serializing_if = "std::ops::Not::not")]
    pub deep_block_lanes: bool,
    /// V7: a village (one crossing's demand) builds the bridges its banks need,
    /// counting bank networks already joined on land by the regional road as
    /// one; its bridgeheads keep no approaches or stubs of dropped decks.
    #[serde(skip_serializing_if = "std::ops::Not::not")]
    pub village_bridge_budget: bool,
    /// V7: a footprint patch beyond the first joins the nearest served road
    /// when it is nearer than the kept land's nucleus: no parallel link
    /// across a camp's tent rows to its centre.
    #[serde(skip_serializing_if = "std::ops::Not::not")]
    pub links_join_roads: bool,
    /// V7 (round 22): prune useless roads. After the bridge choice, any place
    /// re-runs the door-based bridgehead pass when a street still ends on a
    /// bank (dead ends to the river that serve no door go); bank networks the
    /// regional road joins on land are one bank, and a quota crossing must join
    /// two built banks; before the blocks are cut, small junction triangles and
    /// doubled runs lose their least important side.
    #[serde(default, skip_serializing_if = "std::ops::Not::not")]
    pub road_network_prune: bool,
    /// V7 (round 1114): village streets. A street village draws its cross-lanes
    /// at an irregular rhythm, staggered, angled and gently curved, its green
    /// off the middle, and sometimes a back lane drifting away from the main
    /// street with a small quarter of its own (`kinds::linear`); in a village
    /// (under 1 000 inhabitants) an exit (`outbound`, `peripheral`) that serves
    /// no lot and ends in nothing is trimmed back to its junction (`trim`).
    #[serde(default, skip_serializing_if = "std::ops::Not::not")]
    pub village_streets: bool,
    #[serde(skip_serializing_if = "is_zero")]
    pub organic_branch_variation: f64,
    #[serde(skip_serializing_if = "is_zero")]
    pub ribbon_width_variation: f64,
    /// How a large camp grows past one figure (ring and court camps, the
    /// legacy nomad ring): `ring` one figure with overflow rows (as drawn),
    /// `concentric` full concentric rows past a capped first ring,
    /// `clusters` several figures (daughter camps) linked by footpaths.
    #[serde(skip_serializing_if = "is_ring_growth")]
    pub camp_growth: String,
    #[serde(skip_serializing_if = "std::ops::Not::not")]
    pub regular_grid_outline: bool,
    pub params: Value,
    /// Per growth zone (`core`, `middle`, `edge`, `faubourg`, `village`): another culture,
    /// recipe or street tissue than the settlement's. Empty = the culture's own.
    pub phase_overrides: std::collections::BTreeMap<String, PhaseOverride>,
    /// Per-quarter user edits (inspector « éditer un quartier »); empty by default.
    pub overrides: UrbanOverrides,
    /// Set by the parcel stage on a layout whose blocks carry structural block
    /// edits (`edits/blocks.rs`): what to restore before preparing it again.
    #[serde(skip_serializing_if = "Option::is_none")]
    pub block_edits: Option<BlockEdits>,
    /// Output only, set by the quarter stage when quarter splits were applied
    /// (`edits/quarter_parts.rs`); never read as an input.
    #[serde(skip_serializing_if = "Option::is_none")]
    pub quarter_edits: Option<QuarterEdits>,
    /// Yield correction of the adaptive-capacity plan, set only by the closed
    /// loop of `quarters::generate` (0 = none). Internal, never serialized.
    #[serde(skip)]
    pub capacity_yield: f64,
    /// Densification the closed loop already measured as insufficient: the
    /// second plan starts from it (internal, never serialized).
    #[serde(skip)]
    pub capacity_floor: f64,
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
            scope: "settlement".into(),
            settlement_form: "auto".into(),
            site_archetype: String::new(),
            site_archetypes: std::collections::BTreeMap::new(),
            fixed_sites: std::collections::BTreeSet::new(),
            suburbs: "auto".into(),
            shanty_scale: 1.0,
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
            lagoon_canals: None,
            fortification_style: "auto".into(),
            old_enclosure_citadel: false,
            medieval_walls: false,
            river_control: false,
            dry_ditches: false,
            wall_stiffness: None,
            wall_terrain: None,
            wall_relief: None,
            wall_tower_spacing: None,
            ditch_wetness: None,
            river_control_mode: String::new(),
            port_enclosure: String::new(),
            planned_wall: String::new(),
            heights_castle: String::new(),
            wall_extension: String::new(),
            moat: String::new(),
            gate_villages: false,
            gate_village: None,
            max_street_grade: 0.12,
            max_lane_grade: 0.18,
            max_stair_grade: 0.65,
            allow_stairs: true,
            power_high_ground: false,
            sheltered_harbour: false,
            port_detachment: 1.0,
            port_shelter: None,
            port_type: "auto".into(),
            merge_parallel_streets: false,
            parallel_merge: 0.0,
            road_width_by_size: true,
            town_main_road: true,
            polish_road_ends: true,
            river_spur_filter: true,
            harbour_bridge_clearance: true,
            wall_gate_policy: true,
            small_road_loops: true,
            isolated_access: true,
            low_rural_houses: true,
            outbuildings: 0.5,
            house_complexity: "simple".into(),
            zone_density: "phases".into(),
            singular_density: 1.0,
            back_buildings: 0.5,
            style_sheet: StyleSheet::default(),
            road_mouths: false,
            road_remnants: false,
            road_end_joins: false,
            street_improvisation: 0.25,
            small_place_capacity: false,
            street_frontage: false,
            natural_camp_approaches: false,
            camp_ring_wobble: None,
            align_enclosed_grid: false,
            hide_unused_quarters: false,
            deep_block_lanes: false,
            village_bridge_budget: false,
            links_join_roads: false,
            road_network_prune: false,
            village_streets: false,
            organic_branch_variation: 0.0,
            ribbon_width_variation: 0.0,
            camp_growth: "ring".into(),
            regular_grid_outline: false,
            params: json!({}),
            phase_overrides: Default::default(),
            overrides: UrbanOverrides::default(),
            block_edits: None,
            quarter_edits: None,
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
fn cultural_access() -> String {
    "cultural".into()
}
pub(super) fn legacy_footprint() -> FootprintConfig {
    FootprintConfig {
        mechanism: "legacy".into(),
        budget: "radius".into(),
        ..FootprintConfig::default()
    }
}
fn is_ring_growth(v: &str) -> bool {
    v == "ring"
}
fn is_auto_port(v: &str) -> bool {
    v == "auto"
}
fn is_simple_houses(v: &str) -> bool {
    v.is_empty() || v == "simple"
}
fn is_phase_density(v: &str) -> bool {
    v.is_empty() || v == "phases"
}
fn is_one(v: &f64) -> bool {
    *v == 1.0
}
fn is_quarter(v: &f64) -> bool {
    *v == 0.25
}
fn is_half(v: &f64) -> bool {
    *v == 0.5
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
/// Style sheet of a place: which cultures each facet of its fabric draws
/// from. A facet is a mix for the whole place, a growth zone (`core`,
/// `middle`, `edge`, `faubourg`, `village`) or a quarter; each lot, block or
/// quarter draws one culture of its mix (`spread`), from the seed alone.
/// - `streets`: the street pattern and block sizes of a zone (the mix's
///   heaviest culture: a street network has one grammar per zone);
/// - `plots`: the cadastral cut (plot operator, frontage, depth, coverage);
/// - `houses`: the homes (plan vocabulary, roofs, materials, storeys);
/// - `monuments`: the singular and utility buildings (which ones, and their forms);
/// - `rural`: the farm types of rural lots.
/// An old core of one culture inside extensions of another, or the homes of
/// one people on the plots of another, are style sheets.
#[derive(Clone, Debug, Default, PartialEq, Serialize, Deserialize)]
#[serde(default, rename_all = "camelCase", deny_unknown_fields)]
pub struct StyleSheet {
    #[serde(skip_serializing_if = "house_mix::HouseSettings::is_empty")]
    pub streets: house_mix::HouseSettings,
    #[serde(skip_serializing_if = "house_mix::HouseSettings::is_empty")]
    pub plots: house_mix::HouseSettings,
    #[serde(skip_serializing_if = "house_mix::HouseSettings::is_empty")]
    pub houses: house_mix::HouseSettings,
    #[serde(skip_serializing_if = "house_mix::HouseSettings::is_empty")]
    pub monuments: house_mix::HouseSettings,
    #[serde(skip_serializing_if = "house_mix::HouseSettings::is_empty")]
    pub rural: house_mix::HouseSettings,
}
impl StyleSheet {
    pub fn is_empty(&self) -> bool {
        [&self.streets, &self.plots, &self.houses, &self.monuments, &self.rural].iter().all(|f| f.is_empty())
    }
}
#[derive(Clone, Debug, Serialize, Deserialize)]
#[serde(default, rename_all = "camelCase", deny_unknown_fields)]
pub struct ParcelConfig {
    /// Loose homes keep their main body square to their actual street frontage.
    #[serde(skip_serializing_if = "std::ops::Not::not")]
    pub street_aligned_homes: bool,
    /// Applied rural-generation setting, consumed by the retained land-use stage.
    #[serde(skip_serializing_if = "std::ops::Not::not")]
    pub denser_smallholdings: bool,
    /// Town lot enclosure 0..1 (0 open lots, 1 closed compounds); None = culture default (`enclosures.json`).
    #[serde(skip_serializing_if = "Option::is_none")]
    pub plot_enclosure: Option<f64>,
    /// Countryside field enclosure 0..1 (openfield to bocage); None = culture default.
    #[serde(skip_serializing_if = "Option::is_none")]
    pub field_enclosure: Option<f64>,
    /// Village, hamlet and rural lots and the fields keep their culture's enclosures (off: open unless set).
    #[serde(skip_serializing_if = "std::ops::Not::not")]
    pub countryside_enclosures: bool,
    /// `wall|hedge|fence`; empty or `auto` = culture default.
    #[serde(skip_serializing_if = "String::is_empty")]
    pub enclosure_material: String,
    pub operator: String,
    pub culture: String,
    pub preset: String,
    pub recipe: String,
    pub zone: String,
    pub density: f64,
    pub params: Value,
    /// Parcel operator of one growth zone, instead of `operator`.
    pub zone_operators: std::collections::BTreeMap<String, String>,
    /// Per-lot user edits (« éditer une parcelle »); empty by default.
    pub overrides: ParcelOverrides,
}
impl Default for ParcelConfig {
    fn default() -> Self {
        Self {
            street_aligned_homes: false,
            denser_smallholdings: false,
            plot_enclosure: None,
            field_enclosure: None,
            countryside_enclosures: false,
            enclosure_material: String::new(),
            operator: "culture".into(),
            culture: "site".into(),
            preset: "culture".into(),
            recipe: "auto".into(),
            zone: "auto".into(),
            density: 1.0,
            params: json!({}),
            zone_operators: Default::default(),
            overrides: ParcelOverrides::default(),
        }
    }
}
