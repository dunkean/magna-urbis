//! Programme inputs, demand and allocation records with their serialisation contract.

use crate::urban::{Shape, roles, culture::CultureMapping};
use serde::{Deserialize, Serialize};
use std::collections::BTreeMap;

use super::ProgrammeFunctions;

#[derive(Clone, Debug, Serialize, Deserialize)]
#[serde(default, rename_all = "camelCase", deny_unknown_fields)]
pub struct ProgrammeContext {
    /// Intent axis (`settlementAxes.ts`): `settlement`, or one isolated
    /// establishment (`roles::isolated`). Never a specialisation.
    pub intent: String,
    /// `activity` intent: the `activities.json` site template standing as the place.
    #[serde(skip_serializing_if = "String::is_empty")]
    pub template: String,
    /// Specialisation: weighted functions. None = automatic (population,
    /// cultural profile, declared port siting); Some(empty) = none.
    #[serde(skip_serializing_if = "Option::is_none")]
    pub functions: Option<ProgrammeFunctions>,
    pub resources: Vec<String>,
    pub period: String,
    pub mode: String,
    pub navigable_access: bool,
    pub lore: Vec<String>,
    /// Settlement condition (`services.json` states): `thriving`, `declining`,
    /// `abandoned`, `ruined`. Empty buildings get a role suffix and no household.
    pub state: String,
    /// Share of empty buildings; `None` uses the state's default.
    pub decay: Option<f64>,
    /// Relaxation of the house slope gates, 0 (strict) to 1 (open)
    /// (`profiles::house_slope`). Chosen by `generate_quarters` when the
    /// strict gates leave most of the town's land unbuildable.
    #[serde(skip_serializing_if = "is_zero")]
    pub slope_relax: f64,
    /// Requested building counts per catalogue role (`worship.parish`,
    /// `defence.keep`): a missing role stays automatic, 0 means none
    /// (`roles::resolve_counts`, at most `roles::MAX_ROLE_COUNT`).
    #[serde(skip_serializing_if = "BTreeMap::is_empty")]
    pub counts: BTreeMap<String, u32>,
    /// How `counts` apply: `suggest` (targets placed in the ordinary order,
    /// reduced silently when the town lacks size or sites) or `force` (exact
    /// counts placed before the automatic buildings, a warning per shortfall).
    #[serde(skip_serializing_if = "is_suggest")]
    pub count_mode: String,
}
fn is_zero(v: &f64) -> bool { *v == 0.0 }
fn is_suggest(v: &str) -> bool { v == "suggest" }
fn is_false(v: &bool) -> bool { !*v }
impl Default for ProgrammeContext {
    fn default() -> Self {
        Self {
            intent: "settlement".into(),
            template: String::new(),
            functions: None,
            resources: vec![],
            period: String::new(),
            mode: "inspired".into(),
            navigable_access: false,
            lore: vec![],
            state: "thriving".into(),
            decay: None,
            slope_relax: 0.0,
            counts: BTreeMap::new(),
            count_mode: "suggest".into(),
        }
    }
}
#[derive(Clone, Debug, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct Demand {
    pub id: String,
    pub function: String,
    pub unit: String,
    pub requested: f64,
    pub target_area: f64,
    pub target_frontage: f64,
    pub provenance: Vec<String>,
    pub requires: Vec<String>,
    pub parcel_capacity: f64,
    pub built_capacity: f64,
    #[serde(default)]
    pub open_capacity: f64,
    pub deficit: f64,
    pub reasons: Vec<String>,
    /// Rich building role (`worship.parish`, `commerce.inn`, `dwelling`…).
    #[serde(default, skip_serializing_if = "String::is_empty")]
    pub role: String,
    /// Number of distinct buildings wanted; 0 = legacy area-driven demand.
    #[serde(default)]
    pub sites: usize,
    /// Preferred siting rule (`nucleus`, `gate`, `waterfront`, `downstream`, `hill`, `edge`, `spread`).
    #[serde(default, skip_serializing_if = "String::is_empty")]
    pub site: String,
    #[serde(default)]
    pub landmark: bool,
    /// Preferred district role prefix.
    #[serde(default, skip_serializing_if = "String::is_empty")]
    pub district: String,
    /// `block` = whole block reserved before cuts; `parcel` = plot chosen after cuts.
    #[serde(default, skip_serializing_if = "String::is_empty")]
    pub placement: String,
    /// A forced count (`ProgrammeContext::count_mode`): placed before the
    /// automatic demands, outside the trade budget and the open-land cap.
    #[serde(default, skip_serializing_if = "is_false")]
    pub explicit: bool,
}
#[derive(Clone, Debug, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct Reservation {
    pub id: String,
    pub demand_id: String,
    pub block: usize,
    pub shape: Shape,
    pub street: usize,
    pub frontage: f64,
}
#[derive(Clone, Debug, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct Allocation {
    pub parcel_id: String,
    pub demand_id: String,
    pub function: String,
    pub culture: String,
    pub architecture_pack: String,
    pub capacity: f64,
    pub unit: String,
    pub score: f64,
    pub reasons: Vec<String>,
    /// Rich building role; `function` stays one of the six houses functions.
    #[serde(default)]
    pub role: String,
    /// French label of `role` for the UI (`Église paroissiale`, `Tannerie en ruine`).
    #[serde(default)]
    pub label: String,
    #[serde(default)]
    pub landmark: bool,
    /// Households housed on this plot (0 for non-domestic uses).
    #[serde(default)]
    pub households: f64,
    /// Planned occupants, not a certification of built housing capacity.
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub residents: Option<f64>,
    /// Frozen model generated only during an actual allocation. Old saved
    /// allocations stay without a model; never infer one on request export.
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub housing_floor_need: Option<roles::HousingFloorNeed>,
    #[serde(default)]
    pub district_role: String,
    #[serde(default)]
    pub wealth: f64,
}
#[derive(Clone, Debug, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct Adjacency {
    pub a: String,
    pub b: String,
    pub shared_length: f64,
}
#[derive(Clone, Debug, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct BlockEnvironment {
    #[serde(default)]
    pub pressure: f64,
    pub block: usize,
    pub slope: f64,
    pub wet: bool,
    pub waterfront: bool,
    /// Ground height at the block centroid (m).
    #[serde(default)]
    pub height: f64,
    /// Index into `structure.districts`.
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub district: Option<usize>,
    /// Water the block fronts: `river`, `sea` or `lake` (empty when dry).
    #[serde(default, skip_serializing_if = "String::is_empty")]
    pub water: String,
    /// Ground height under that water next to the block; along a river it
    /// falls downstream, which orders the banks by flow.
    #[serde(default)]
    pub water_height: f64,
}
#[derive(Clone, Debug, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct UrbanProgramme {
    pub version: u32,
    pub population: u32,
    pub context: ProgrammeContext,
    pub cultures: Vec<CultureMapping>,
    pub demands: Vec<Demand>,
    pub reservations: Vec<Reservation>,
    pub allocations: Vec<Allocation>,
    pub adjacency: Vec<Adjacency>,
    pub environment: Vec<BlockEnvironment>,
    pub reconciliation_passes: usize,
    pub warnings: Vec<String>,
    /// Households all the domestic-admissible plots could hold (household
    /// caps summed before allocation): the capacity the plan predicted.
    #[serde(default)]
    pub housing_capacity: f64,
    /// Measured navigable quay frontage (`harbour::navigable`): the only
    /// evidence port storage is allocated against. Never a declared label.
    #[serde(default)]
    pub navigable_frontage: bool,
    /// Building counts per role: the automatic draw, the request and the
    /// sites placed, so the UI shows the default draw and the result.
    #[serde(default, skip_serializing_if = "Vec::is_empty")]
    pub counts: Vec<CountOutcome>,
}
/// One role of `UrbanProgramme::counts`.
#[derive(Clone, Debug, Default, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct CountOutcome {
    pub role: String,
    /// Sites the programme draws for the role without a request.
    pub auto: u32,
    /// Requested count (`ProgrammeContext::counts`).
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub requested: Option<u32>,
    /// Distinct sites (reserved blocks or plots) holding the role after allocation.
    #[serde(default)]
    pub placed: u32,
}
