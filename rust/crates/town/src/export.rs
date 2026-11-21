//! Finished graph and growth metadata for downstream consumers.

use magna_urbis_geom::Point;

use crate::graph::{Clock, FaceId, Graph, Key};

/// A growth regime reached at a dated promotion.
#[derive(Clone, Debug)]
pub struct DatedPhase {
    pub born: Clock,
    pub kind: String,
    pub recipe: String,
    pub zone: String,
    pub population: f64,
    pub target_area: f64,
}

/// The live faces descended from one opened quarter, with its birth regime.
#[derive(Clone, Debug)]
pub struct QuarterPlan {
    pub key: Key,
    /// Index into `TownPlan::phases`.
    pub phase: usize,
    /// Tissue pattern supplied to the downstream cadastre.
    pub tissue: String,
    /// Handles in `TownPlan::graph`.
    pub faces: Vec<FaceId>,
    pub fill_level: f64,
}

/// A town layout and its generation warnings.
#[derive(Clone, Debug)]
pub struct TownPlan {
    pub graph: Graph,
    pub clock: Clock,
    pub center: Point,
    pub focus: Point,
    pub phases: Vec<DatedPhase>,
    pub quarters: Vec<QuarterPlan>,
    /// Short messages about generation limits or decisions.
    pub warnings: Vec<String>,
}
