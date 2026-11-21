//! Plain-data generation specs resolved by the caller from its catalogues.

use std::collections::BTreeMap;

use serde::{Deserialize, Serialize};

use crate::tissue::organic::OrganicParams;

/// Resolved specs for one town.
#[derive(Clone, Debug, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct TownSpecs {
    /// Fixed founding decisions and draws.
    pub charter: CharterSpec,
    /// Phase specs in promotion order, from the founding phase onward.
    pub phases: Vec<PhaseSpec>,
    /// Tissue specs referred to by the phases.
    pub tissues: Vec<TissueSpec>,
    /// Tracing parameters for the town's precincts and walls.
    pub wall: WallSpec,
    /// Terrain thresholds and costs used to survey the site.
    #[serde(default)]
    pub survey: SurveySpec,
    /// Harbour enclosure and expansion parameters.
    pub harbour: HarbourSpec,
    /// Ring steps, counting and armature weights of the growth loop.
    #[serde(default)]
    pub growth: GrowthSpec,
    /// Sizing and clearances of precincts, castles, citadels and camps.
    #[serde(default)]
    pub precinct: PrecinctSpec,
    /// What water the town can cross, and how.
    #[serde(default)]
    pub crossing: CrossingSpec,
}

/// Parameters of the growth loop. None of them may depend on the requested population: the
/// target enters only the stop test, which is what lets a stopped town resume to a larger one.
#[derive(Clone, Debug, PartialEq, Serialize, Deserialize)]
#[serde(default, rename_all = "camelCase")]
pub struct GrowthSpec {
    /// Cost step between two ring levels, in effective metres. The default 100 m opens about
    /// two blocks and their streets per ring on flat land.
    pub ring_step: f64,
    /// Survey reach around the founding focus in metres. The default 1500 m holds a town of
    /// about 50,000 on flat land; land beyond it never opens.
    pub reach: f64,
    /// Inhabitants per household, to read the target and the phase thresholds as households.
    /// The default 3.7 is classic's European village household (3.15 persons, 0.85 home each).
    pub household_size: f64,
    /// Radius in metres of the town's nucleus given to the street field; roads within 1.5
    /// radii orient it. The default 200 m is classic's radius of a 3,000 town.
    pub nucleus_radius: f64,
    /// Effective metres per metre along a regional road (default 0.75: rings reach a third
    /// farther along a road than across open ground).
    pub regional_road_cost: f64,
    /// Effective metres per metre along a main axis (default 0.85).
    pub axis_cost: f64,
    /// Effective metres per metre along any other street (default 0.9).
    pub street_cost: f64,
    /// Drawn width in metres of a regional road inside the town (default 8, classic's rank-0 street).
    pub regional_road_width: f64,
    /// A ring's new boundary is kept only where some point of it lies farther than this from
    /// every existing edge (metres); a shallower strip waits for the next ring. The default
    /// 15 m is a little less than classic's smallest block width (17 m).
    pub min_quarter_depth: f64,
    /// Rings opened at most, a guard for sites whose land never runs out (default 200).
    pub max_rings: u32,
}

impl Default for GrowthSpec {
    fn default() -> Self {
        Self {
            ring_step: 100.0,
            reach: 1500.0,
            household_size: 3.7,
            nucleus_radius: 200.0,
            regional_road_cost: 0.75,
            axis_cost: 0.85,
            street_cost: 0.9,
            regional_road_width: 8.0,
            min_quarter_depth: 15.0,
            max_rings: 200,
        }
    }
}

/// Thresholds and costs for terrain survey. Grades are rise over horizontal run.
#[derive(Clone, Debug, PartialEq, Serialize, Deserialize)]
#[serde(default, rename_all = "camelCase")]
pub struct SurveySpec {
    /// Grid spacing in metres. The default 8 m resolves a street or terrace.
    pub cell_size: f64,
    /// Maximum buildable ground grade. The default 1.25 is the cliff limit for terraces.
    pub cliff_limit: f64,
    /// Grade at which a metre costs twice as much as on flat ground.
    pub terrace_limit: f64,
    /// Exponent in the slope factor `1 + (grade / terrace_limit)^slope_power`.
    pub slope_power: f64,
    /// Minimum change in grade across a cell to flag a break. Crests use a quarter of this.
    pub slope_break: f64,
    /// Fixed cost in effective metres per entry into a water span.
    pub water_charge: f64,
    /// Minimum clear water width in metres for navigation.
    pub navigable_width: f64,
    /// Maximum straight-line distance in metres from the centre to a harbour front.
    pub harbour_reach: f64,
    /// Minimum continuous length in metres for a usable shore run.
    pub harbour_min_front: f64,
    /// Maximum grade along a front and across its inland approach strip.
    pub harbour_bank_grade: f64,
    /// Radius in metres of the ring used to measure summit prominence.
    pub strong_point_radius: f64,
    /// Minimum summit elevation above the median open ground in metres.
    pub strong_point_min_rise: f64,
    /// Minimum summit elevation above its surrounding ring in metres.
    pub strong_point_min_prominence: f64,
    /// Minimum contiguous area of a dry, level summit in square metres.
    pub strong_point_min_top_area: f64,
    /// Maximum ground grade for a level summit cell.
    pub strong_point_top_grade: f64,
    /// Maximum grade along a route to a summit.
    pub lane_grade: f64,
    /// Steepest ground a plain house stands on; steeper open land is built in terraces. The
    /// default 0.2126 (tan 12°) is the catalogue's house admissibility (`max_slope` of the
    /// culture mapping), which classic's `profiles::house_slope` widens to `TERRACE_SLOPE`
    /// (tan 30°, the terrace limit) for cultures that terrace.
    pub house_grade: f64,
    /// Grade up to which land keeps its full housing density (default 0.05, to tune on sheets).
    pub dense_grade: f64,
    /// Share of the flat-land housing density kept at and beyond the terrace limit (default
    /// 0.45, to tune on sheets). Between the dense grade and the terrace limit the share falls
    /// along a smoothstep.
    pub terrace_density: f64,
}

impl Default for SurveySpec {
    fn default() -> Self {
        Self {
            cell_size: 8.0,
            cliff_limit: 1.25,
            terrace_limit: 0.65,
            slope_power: 2.0,
            slope_break: 0.08,
            water_charge: 80.0,
            // Allow a 10 m channel and look for an 80 m bank at street grade.
            navigable_width: 10.0,
            harbour_reach: 1000.0,
            harbour_min_front: 80.0,
            harbour_bank_grade: 0.12,
            // Survey a small bailey and test its rise and local prominence.
            strong_point_radius: 60.0,
            strong_point_min_rise: 5.0,
            strong_point_min_prominence: 3.0,
            strong_point_min_top_area: 1225.0,
            strong_point_top_grade: 0.18,
            lane_grade: 0.18,
            house_grade: 0.2126,
            dense_grade: 0.05,
            terrace_density: 0.45,
        }
    }
}

/// Decisions fixed at founding.
#[derive(Clone, Debug, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct CharterSpec {
    /// Available founding focuses in culture preference order.
    pub founding_rule: Vec<FoundingFocusKind>,
    /// Housed population the first precinct of an enclosed town is sized for.
    pub founding_cohort: u32,
    /// Minimum request for which this culture can lay a planned frame.
    pub planned_founding_cohort: u32,
    /// Share of eligible towns founded with a planned frame in auto mode.
    pub planned_share: f64,
    /// Tissue of a town founded below the planned cohort.
    pub village_tissue_id: String,
    /// Tissue used in a planned frame.
    pub planned_tissue_id: String,
    /// Defensive shares at a site without an archetype-specific preference.
    pub defensive_shares: DefensiveShares,
    /// Shares that replace the default for a named site archetype.
    pub defensive_by_archetype: BTreeMap<String, DefensiveShares>,
    /// Chance of founding at a surveyed strong point without a defensive archetype.
    pub strong_point_share: f64,
    /// Radius in metres for finding local regional roads and their crossings.
    pub regional_road_reach: f64,
    /// Maximum water span in metres for a founding ford or bridge.
    pub ford_max_span: f64,
    pub bridge_max_span: f64,
    /// Grade at the surveyed centre above which the site counts as steep.
    pub steep_grade: f64,
}

/// Unconditional shares of each defensive intent. The remaining share is unwalled.
#[derive(Clone, Copy, Debug, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct DefensiveShares {
    pub enclosed_from_founding: f64,
    pub walled_when_grown: f64,
}

/// Feature around which the town is founded.
#[derive(Clone, Copy, Debug, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "kebab-case")]
pub enum FoundingFocusKind {
    /// The requested site when no preferred feature is available.
    Site,
    /// Crossing of regional roads.
    RoadCrossing,
    /// Ford on a regional route.
    Ford,
    /// Bridge on a regional route.
    Bridge,
    /// Navigable harbour front.
    HarbourFront,
    /// Defensible height for a castle and its bailey.
    StrongPoint,
    /// The axes of a planned town frame.
    PlannedFrame,
}

/// Whether a town starts with a frame for a given population.
#[derive(Clone, Copy, Debug, PartialEq, Eq, Serialize, Deserialize)]
#[serde(tag = "kind", rename_all = "kebab-case", rename_all_fields = "camelCase")]
pub enum TownForm {
    /// Open land in rings from the founding focus.
    Grown,
    /// Lay the frame at founding and fill it over time.
    Planned {
        /// Population in inhabitants the frame is sized to hold.
        capacity: u32,
    },
}

/// Founding decision about when to enclose land.
#[derive(Clone, Copy, Debug, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "kebab-case")]
pub enum DefensiveIntent {
    /// Survey the first precinct before placing the founding quarter.
    EnclosedFromFounding,
    /// Survey the first precinct around aged quarters at a later phase.
    WalledWhenGrown,
    /// Grow without precincts.
    Never,
}

/// Draws made once for this town from the caller's culture and site inputs.
#[derive(Clone, Debug, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct TownDraws {
    /// Promotion and wall-cycle draws keyed by phase name.
    pub phases: BTreeMap<String, PhaseDraw>,
    /// Preferred relationship of the harbour front to a wall.
    pub harbour_enclosure: HarbourEnclosure,
}

/// Town-specific values drawn from a phase's spec.
#[derive(Clone, Debug, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct PhaseDraw {
    /// Promotion threshold in inhabitants after the draw and before circumstance modifiers.
    pub promotion_threshold: u32,
    /// Kind of wall permitted for the next raise, if any.
    pub wall_kind: Option<WallKind>,
    /// Style of the next wall trace and its works.
    pub wall_style: Option<String>,
    /// Capacity multiplier used to size the next precinct at compact density.
    pub precinct_step: f64,
    /// Additional share of intramural capacity from ageing before the next survey.
    pub precinct_gain: f64,
    /// Treatment of the old wall line when another wall is raised.
    pub fossil_rule: FossilRule,
    /// How the next precinct extends the existing town.
    pub extension_habit: ExtensionHabit,
}

/// Catalogue values for a dated promotion and the regime it introduces.
#[derive(Clone, Debug, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct PhaseSpec {
    /// Phase name, including culture-specific names.
    pub name: String,
    /// Nominal housed-population threshold in inhabitants.
    pub threshold: u32,
    /// Fractional spread on either side of the nominal threshold (0.3 means ±30%).
    pub threshold_spread: f64,
    /// Effects of surveyed circumstances on the drawn threshold.
    pub circumstance_modifiers: CircumstanceModifiers,
    /// Tissue identifier for quarters born in this phase.
    pub tissue_id: String,
    /// Tissue used inside a surveyed precinct.
    pub compact_tissue_id: String,
    /// Gross inhabitants per hectare for newly opened land.
    pub density: f64,
    /// Gross inhabitants per hectare used to size an open precinct.
    pub compact_density: f64,
    /// Occupied share of a quarter's fixed lots at birth and each successive age.
    pub fill_schedule: Vec<f64>,
    /// Kind of wall permitted for the next raise, if any.
    pub wall_kind: Option<WallKind>,
    /// Weighted styles eligible for this phase's wall kind.
    pub wall_styles: Vec<WallStyleSpec>,
    /// This phase allows a town walled when grown to start its first precinct.
    pub walls_when_grown: bool,
    /// Capacity multiplier used to size the next precinct at compact density.
    pub precinct_step: f64,
    /// Additional share of intramural capacity from ageing before the next survey.
    pub precinct_gain: f64,
    /// Absolute spread about the phase's precinct step and gain, respectively.
    pub precinct_step_spread: f64,
    pub precinct_gain_spread: f64,
    /// Desired treatment of the old wall line at the next raise.
    pub fossil_rule: FossilRule,
    /// Preferred shape of the next precinct extension.
    pub extension_habit: ExtensionHabit,
    /// Treatment of regional roads through the town in this phase. Defaults to kept.
    #[serde(default)]
    pub road_fate: RoadFate,
    /// Treatment of those roads in a planned town. Defaults to absorbed by the grid.
    #[serde(default = "default_planned_road_fate")]
    pub planned_road_fate: RoadFate,
    /// Population thresholds for the reused programme.
    pub programme: ProgrammeThresholds,
    /// Population thresholds for harbour works permitted in this phase.
    pub harbour_works: HarbourThresholds,
}

/// A wall style eligible for a phase, with its resulting kind and relative weight.
#[derive(Clone, Debug, PartialEq, Serialize, Deserialize)]
pub struct WallStyleSpec {
    pub id: String,
    pub kind: WallKind,
    pub weight: u32,
}

/// Housed population in inhabitants at which a programme can be introduced.
#[derive(Clone, Debug, PartialEq, Serialize, Deserialize)]
pub struct ProgrammeThresholds {
    pub market: Option<u32>,
    pub hall: Option<u32>,
    pub cathedral: Option<u32>,
}

/// Multipliers on the drawn promotion threshold. A value of 1 leaves it unchanged.
#[derive(Clone, Debug, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct CircumstanceModifiers {
    /// A road crossing can bring a promotion forward.
    pub road_crossing: f64,
    /// A navigable harbour can bring a promotion forward.
    pub navigable_harbour: f64,
    /// An isolated site can delay a promotion.
    pub isolated_site: f64,
    /// A steep site can delay a promotion.
    pub steep_site: f64,
}

/// Kind of defence raised along a full precinct.
#[derive(Clone, Copy, Debug, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "kebab-case")]
pub enum WallKind {
    /// Hedge enclosure.
    Hedge,
    /// Ditch enclosure.
    Ditch,
    /// Timber palisade.
    Palisade,
    /// Earthwork rampart.
    Earthwork,
    /// Masonry wall.
    Wall,
    /// Bastioned circuit.
    Bastioned,
}

/// Treatment of a wall overtaken by a later circuit.
#[derive(Clone, Copy, Debug, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "kebab-case")]
pub enum FossilRule {
    /// Retain the standing wall.
    Keep,
    /// Convert the wall line into a boulevard.
    Boulevard,
    /// Retire the old wall line.
    Remove,
}

/// Relationship of an extension to the former outer precinct.
#[derive(Clone, Copy, Debug, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "kebab-case")]
pub enum ExtensionHabit {
    /// Attach a lobe on the cheapest side.
    Lobes,
    /// Enclose the former precinct in a new circuit.
    Concentric,
}

/// Dated treatment of a regional road stretch through the town.
#[derive(Clone, Copy, Debug, Default, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "kebab-case")]
pub enum RoadFate {
    /// Continue as a main street.
    #[default]
    Kept,
    /// Join an axis of the planned frame.
    Absorbed,
    /// End the through route at the town entries and demote its oldest-ring streets to rank 2.
    Demoted,
    /// End the through route at the town entries, retaining the local street ranks.
    Ended,
}

fn default_planned_road_fate() -> RoadFate {
    RoadFate::Absorbed
}

/// Parameters for laying streets and blocks in a quarter.
#[derive(Clone, Debug, PartialEq, Serialize, Deserialize)]
pub struct TissueSpec {
    /// Stable identifier used by a phase to select this tissue.
    pub id: String,
    /// Street and block pattern interpreted by the tissue stage.
    pub pattern: String,
    /// Culture recipe and zone used by the downstream lot cut.
    pub recipe: String,
    pub zone: String,
    /// Values interpreted by the selected street and block pattern.
    pub parameters: BTreeMap<String, TissueParameter>,
    /// Street morphology when the tissue is organic.
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub organic: Option<OrganicParams>,
}

/// Parameter for a tissue pattern, resolved for its zone.
#[derive(Clone, Debug, PartialEq, Serialize, Deserialize)]
#[serde(untagged)]
pub enum TissueParameter {
    /// Continuous or integer-valued numeric setting.
    Number(f64),
    /// Range or other ordered numeric settings.
    Numbers(Vec<f64>),
    /// Boolean switch.
    Flag(bool),
    /// Named mode or choice.
    Text(String),
}

/// Controls for tracing and raising a precinct.
#[derive(Clone, Debug, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct WallSpec {
    /// Degree of regularisation toward straight runs and distinct corners (0–1).
    pub stiffness: f64,
    /// Attraction to terrain features such as banks and breaks of slope (0–1).
    pub terrain_adherence: f64,
    /// Maximum crest relief, in metres, that a straight run can cross.
    pub crest_limit: f64,
    /// Baseline style when a phase does not supply an eligible style.
    pub style: String,
    /// Cultural shape of the enclosure, used with the phase's wall style.
    pub enclosure_shape: String,
    /// Whether the culture keeps a citadel on open land when there is no castle.
    pub keeps_citadel: bool,
}

/// Starting values for precincts, castles, citadels and camps, to tune on review sheets.
#[derive(Clone, Debug, PartialEq, Serialize, Deserialize)]
#[serde(default, rename_all = "camelCase")]
pub struct PrecinctSpec {
    /// Gross inhabitants per hectare a precinct is sized at when the phase gives no compact
    /// density. The default 150 is classic's `ENCLOSED_DENSITY` (`footprint.rs`).
    pub enclosed_density: f64,
    /// A new precinct encloses at least this multiple of the land of the one it extends
    /// (default 1.15), so that a raise always opens some land.
    pub min_growth: f64,
    /// Clear distance in metres between a precinct line and a neighbour's claim (default 25 m,
    /// a ditch and a road).
    pub neighbour_clearance: f64,
    /// Clear distance in metres between a precinct line and a harbour's quay, apron or service
    /// row it must stay out of (default 6 m).
    pub harbour_clearance: f64,
    /// Width in metres of the street along the inside of a precinct (default 4 m, classic's
    /// wall lane).
    pub wall_street_width: f64,
    /// Below this many inhabitants an extension with the lobe habit is a lobe; beyond it the
    /// town builds concentric circuits (default 10,000, design 5.2).
    pub lobe_limit: f64,
    /// Land of a citadel on open land in square metres (default 10,000 m², 1 ha).
    pub citadel_area: f64,
    /// Inhabitants one camp unit's figure is sized for (default 500).
    pub camp_unit: u32,
    /// Length over width of a flat camp's figure (default 1.25, the Roman playing card).
    pub camp_aspect: f64,
    /// Share of a defensive camp's enclosed land kept open as common (default 0.3).
    pub camp_common_share: f64,
    /// Fall in metres below the summit at which a defensive camp's scarp line runs (default 8).
    pub scarp_drop: f64,
    /// Farthest a castle road may run from the castle gate to reach the regional road, in
    /// metres (default 900).
    pub castle_road_reach: f64,
}

impl Default for PrecinctSpec {
    fn default() -> Self {
        Self {
            enclosed_density: 150.0,
            min_growth: 1.15,
            neighbour_clearance: 25.0,
            harbour_clearance: 6.0,
            wall_street_width: 4.0,
            lobe_limit: 10_000.0,
            citadel_area: 10_000.0,
            camp_unit: 500,
            camp_aspect: 1.25,
            camp_common_share: 0.3,
            scarp_drop: 8.0,
            castle_road_reach: 900.0,
        }
    }
}

/// Controls for choosing and extending a harbour front.
#[derive(Clone, Debug, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct HarbourSpec {
    /// Preferred wall treatment at a chosen harbour front.
    pub enclosure_habit: HarbourEnclosure,
    /// Metres of quay per square root of housed population in inhabitants.
    pub quay_per_sqrt_pop: f64,
    /// Population thresholds for opening and extending the harbour.
    pub thresholds: HarbourThresholds,
    /// Quay, landing, road and works geometry.
    #[serde(default)]
    pub works: HarbourWorksSpec,
}

/// Geometry of a harbour's quay, landings, road and works. The defaults are classic's
/// (`macroplan/harbour.rs`: `Harbour::default`, `quay_budget`, `landing_streets`, `works`).
#[derive(Clone, Debug, PartialEq, Serialize, Deserialize)]
#[serde(default, rename_all = "camelCase")]
pub struct HarbourWorksSpec {
    /// Whether the town keeps a harbour on a front that is not its founding focus: classic's
    /// port town (a harbour site archetype, navigable access or a port function). Default false:
    /// only a town founded on its front has a harbour.
    pub port_town: bool,
    /// Drawn quay width in metres (default 6).
    pub quay_width: f64,
    /// Metres of quay per housed inhabitant, the demand of a small landing; the quay is the
    /// smaller of this and `quayPerSqrtPop`·√P (default 0.035, classic's `quay_budget`).
    pub quay_share: f64,
    /// Multiplier on `quay_share` for a port function or a harbour site (default 1; classic
    /// uses 1.5 for a harbour archetype).
    pub port_factor: f64,
    /// Shortest quay in metres (default 20).
    pub min_quay: f64,
    /// Distance between landings along the quay in metres (default 120).
    pub landing_spacing: f64,
    /// Longest landing street from a landing to the town in metres (default 80).
    pub landing_reach: f64,
    /// Drawn width of a landing street in metres (default 4).
    pub landing_width: f64,
    /// Drawn width of the harbour road in metres (default 5, classic's port road).
    pub road_width: f64,
    /// Steepest grade of the harbour road and the landing streets (default 0.12, classic's street grade).
    pub road_grade: f64,
    /// Length in metres of the cost discount around the chosen front (default 150): land on the
    /// quay costs that much less, land that far from it nothing less.
    pub front_discount: f64,
    /// A front whose landing lies within this distance of the founding focus is the focus's own
    /// harbour, with no harbour road (metres, default 120).
    pub attached_reach: f64,
    /// Weight of shelter against distance over land when a front is chosen (default 0.5).
    pub shelter_weight: f64,
    /// Radius in metres kept free of other settlements around the landing (default 150).
    pub reservation_radius: f64,
    /// Full width in metres kept free along the straight approach to the landing (default 60).
    pub reservation_corridor_width: f64,
    /// Distance between piers along the quay in metres (default 110).
    pub pier_spacing: f64,
    /// Shortest and longest pier over open water in metres (default 18 to 45).
    pub pier_length: [f64; 2],
}

impl Default for HarbourWorksSpec {
    fn default() -> Self {
        Self {
            port_town: false,
            quay_width: 6.0,
            quay_share: 0.035,
            port_factor: 1.0,
            min_quay: 20.0,
            landing_spacing: 120.0,
            landing_reach: 80.0,
            landing_width: 4.0,
            road_width: 5.0,
            road_grade: 0.12,
            front_discount: 150.0,
            attached_reach: 120.0,
            shelter_weight: 0.5,
            reservation_radius: 150.0,
            reservation_corridor_width: 60.0,
            pier_spacing: 110.0,
            pier_length: [18.0, 45.0],
        }
    }
}

/// Relationship of a curtain to the quay and its service row.
#[derive(Clone, Copy, Debug, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "kebab-case")]
pub enum HarbourEnclosure {
    /// Run the curtain on the land side of the quay with water gates at landings.
    SeaWall,
    /// End the curtain at the waterline on either side of the quay.
    OpenFront,
    /// Keep the harbour beyond the curtain with a gate on the harbour road.
    HarbourOutside,
}

/// Housed-population thresholds in inhabitants for harbour works.
#[derive(Clone, Debug, PartialEq, Serialize, Deserialize)]
pub struct HarbourThresholds {
    /// Open the landing when the harbour is the founding focus.
    pub landing: u32,
    /// Add piers when permitted in the current phase.
    pub piers: Option<u32>,
    /// Add moles when permitted in the current phase.
    pub moles: Option<u32>,
    /// Add basins when permitted in the current phase.
    pub basins: Option<u32>,
}

/// What water a growing town can cross, and how. The span rule is classic's
/// (`footprint::crossings::spans`): `builders` × `spanPerSqrtThousand` × √(P / 1000) metres, at
/// most `maxSpan`; a ford where the stream is narrow and the culture fords.
#[derive(Clone, Debug, PartialEq, Serialize, Deserialize)]
#[serde(default, rename_all = "camelCase")]
pub struct CrossingSpec {
    /// The culture's bridge builders: 1.25 for strong builders, 0.55 for cultures that rarely
    /// bridge, 1 otherwise (default 1, classic's factor).
    pub builders: f64,
    /// Metres of span per √(inhabitants / 1000) at a builders factor of 1 (default 12: a
    /// 5,000 town spans about 27 m).
    pub span_per_sqrt_thousand: f64,
    /// Widest bridge any town builds, in metres (default 400).
    pub max_span: f64,
    /// Widest non-navigable water forded rather than bridged, in metres; 0 for a culture that
    /// never fords (default 10, classic's).
    pub ford_span: f64,
    /// A town of strong or ordinary builders fords only below this many inhabitants; above it
    /// it bridges (default 1,200, classic's).
    pub ford_population: u32,
    /// Widest water crossed by a ferry landing pair when it is too wide to bridge, in metres;
    /// 0 for no ferries (default 600).
    pub ferry_span: f64,
    /// Effective metres per metre of water crossed by ferry (default 3), against the main
    /// axis's cost per metre on a bridge or a ford.
    pub ferry_cost: f64,
    /// Smallest dry open land of a far bank worth crossing to, in square metres (default
    /// 5,000, half a hectare: no bridge to an islet).
    pub min_far_land: f64,
    /// Longest approach from the chain to the bridge's near landing, in metres (default 150).
    pub approach_reach: f64,
    /// Narrowest drawn bridge or ford, in metres (default 4).
    pub min_width: f64,
}

impl Default for CrossingSpec {
    fn default() -> Self {
        Self {
            builders: 1.0,
            span_per_sqrt_thousand: 12.0,
            max_span: 400.0,
            ford_span: 10.0,
            ford_population: 1200,
            ferry_span: 600.0,
            ferry_cost: 3.0,
            min_far_land: 5000.0,
            approach_reach: 150.0,
            min_width: 4.0,
        }
    }
}
