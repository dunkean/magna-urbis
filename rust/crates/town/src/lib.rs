//! Dated town growth on a street and block graph.

pub mod armature;
pub mod charter;
pub mod export;
pub mod graph;
pub mod growth;
pub mod harbour;
pub mod journal;
pub mod spec;
pub mod survey;
pub mod tissue;
pub mod walls;
pub mod water;

pub use export::TownPlan;
use magna_urbis_geom::{Point, Shape, surface::TerrainView};
use serde::{Deserialize, Serialize};
use spec::TownSpecs;

/// Location and population inputs for one town.
#[derive(Clone, Debug, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct TownSite {
    /// Requested centre in map-local metres.
    pub center: Point,
    /// Whether the requested centre must be used exactly.
    pub pinned: bool,
    /// Imposed radius in metres, when growth is limited to a fixed extent.
    pub radius: Option<f64>,
    /// Requested population in inhabitants.
    pub population: u32,
    /// Culture key retained with the town for downstream stages.
    pub culture: String,
}

/// Inputs for a single run of the growth engine.
pub struct TownRequest<'a> {
    /// Site and target population.
    pub site: TownSite,
    /// Resolved generation specs supplied by the caller.
    pub specs: &'a TownSpecs,
    /// Read-only terrain at the site and its surroundings.
    pub terrain: &'a dyn TerrainView,
    /// Regional roads as polylines in map-local metres.
    pub regional_roads: &'a [Vec<Point>],
    /// Land already claimed by neighbours, including any holes.
    pub neighbour_claims: &'a [Shape],
    /// Town seed used to derive its event streams.
    pub seed: &'a str,
}

/// Generate a town layout from its site and resolved specs.
pub fn generate(_request: TownRequest<'_>) -> Result<TownPlan, String> {
    Err("not implemented".into())
}
