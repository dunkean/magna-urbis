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
        }
    }
}

/// Decisions fixed at founding.
#[derive(Clone, Debug, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct CharterSpec {
    /// Kind of focus placed by the founding event.
    pub founding_focus: FoundingFocusKind,
    /// Whether the town opens land in rings from founding or starts with a planned frame.
    pub form: TownForm,
    /// Whether and when the town begins its precinct cycle.
    pub defensive_intent: DefensiveIntent,
    /// Town-specific outcomes of the founding draws.
    pub draws: TownDraws,
}

/// Feature around which the town is founded.
#[derive(Clone, Copy, Debug, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "kebab-case")]
pub enum FoundingFocusKind {
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
    /// Kind of wall permitted for the next raise, if any.
    pub wall_kind: Option<WallKind>,
    /// Capacity multiplier used to size the next precinct at compact density.
    pub precinct_step: f64,
    /// Additional share of intramural capacity from ageing before the next survey.
    pub precinct_gain: f64,
    /// Desired treatment of the old wall line at the next raise.
    pub fossil_rule: FossilRule,
    /// Preferred shape of the next precinct extension.
    pub extension_habit: ExtensionHabit,
    /// Treatment of regional roads through the town when it reaches this phase.
    pub road_fate: RoadFate,
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
#[derive(Clone, Copy, Debug, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "kebab-case")]
pub enum RoadFate {
    /// Continue as a main street.
    Kept,
    /// Join an axis of the planned frame.
    Absorbed,
    /// Retain the connection at a lower street rank.
    Demoted,
    /// End the through connection at a town feature such as a gate or plaza.
    Ended,
}

/// Parameters for laying streets and blocks in a quarter.
#[derive(Clone, Debug, PartialEq, Serialize, Deserialize)]
pub struct TissueSpec {
    /// Stable identifier used by a phase to select this tissue.
    pub id: String,
    /// Values interpreted by the selected street and block pattern.
    pub parameters: BTreeMap<String, TissueParameter>,
    /// Street morphology when the tissue is organic.
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub organic: Option<OrganicParams>,
}

/// Scalar parameter for a tissue pattern.
#[derive(Clone, Debug, PartialEq, Serialize, Deserialize)]
#[serde(untagged)]
pub enum TissueParameter {
    /// Continuous or integer-valued numeric setting.
    Number(f64),
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
    /// Resolved style identifier for the wall trace and works.
    pub style: String,
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
