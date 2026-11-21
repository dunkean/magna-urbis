//! Dated town growth on a street and block graph.

pub mod armature;
pub mod blocks;
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
use charter::PlannedSetting;
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
    /// Site archetype supplied by settlement placement, when available.
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub archetype: Option<String>,
}

/// A segment of the regional network in its source direction.
#[derive(Clone, Debug, PartialEq, Serialize, Deserialize)]
pub struct RegionalRoad {
    pub id: String,
    pub points: Vec<Point>,
    /// Metres from the start of the source segment, one value per point.
    pub stations: Vec<f64>,
    pub rank: u8,
}

/// Provenance of a drawn piece of a regional segment.
#[derive(Clone, Debug, PartialEq, Serialize, Deserialize)]
pub struct RoadSource {
    pub id: String,
    /// Source stations in the drawn line's vertex order.
    pub stations: Vec<f64>,
}

impl RoadSource {
    /// Whether the ID and station sequence can describe this many vertices.
    pub fn matches_vertices(&self, count: usize) -> bool {
        !self.id.is_empty()
            && self.stations.len() == count
            && self.stations.iter().all(|s| s.is_finite() && *s >= 0.0)
            && self.stations.windows(2).all(|w| w[0] <= w[1])
    }
}

impl RegionalRoad {
    /// A plain polyline defines its own source segment, starting at station zero.
    pub fn from_polyline(id: String, points: Vec<Point>, rank: u8) -> Self {
        let mut stations = Vec::with_capacity(points.len());
        if !points.is_empty() {
            stations.push(0.0);
        }
        for (i, pair) in points.windows(2).enumerate() {
            stations.push(stations[i] + pair[0].distance(pair[1]));
        }
        Self {
            id,
            points,
            stations,
            rank,
        }
    }
}

/// Inputs for a single run of the growth engine.
pub struct TownRequest<'a> {
    /// Site and target population.
    pub site: TownSite,
    /// Resolved generation specs supplied by the caller.
    pub specs: &'a TownSpecs,
    /// Read-only terrain at the site and its surroundings, shared by the quarters laid in parallel.
    pub terrain: &'a (dyn TerrainView + Sync),
    /// Regional roads in map-local metres, with their source stationing.
    pub regional_roads: &'a [RegionalRoad],
    /// Land already claimed by neighbours, including any holes.
    pub neighbour_claims: &'a [Shape],
    /// Town seed used to derive its event streams.
    pub seed: &'a str,
    /// Whether to use the culture's planned share or explicitly lay a frame.
    pub planned: PlannedSetting,
    /// The landing of the harbour front the regional placement reserved for this town, if any:
    /// its harbour is opened on the front at that landing.
    pub harbour_landing: Option<Point>,
}

/// Generate a town layout from its site and resolved specs, counting its quarters with
/// `capacity`. [`growth::resume`] and [`growth::reopen`] continue a stopped town.
pub fn generate(
    request: TownRequest<'_>,
    capacity: &dyn growth::Capacity,
) -> Result<TownPlan, String> {
    growth::generate(&request, capacity)
}
