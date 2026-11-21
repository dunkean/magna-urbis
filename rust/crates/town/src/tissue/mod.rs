//! Street and block patterns fitted to a quarter's outline and its surrounding features.

pub mod organic;

use magna_urbis_geom::Point;
use serde::{Deserialize, Serialize};

/// Streets a tissue lays inside one quarter outline, as plain polylines. Each
/// end lies on the outline or on another street of the draft; the journal turns
/// the draft into graph operations.
#[derive(Clone, Debug, Default, PartialEq, Serialize, Deserialize)]
pub struct TissueDraft {
    /// Streets in the order they were laid.
    pub streets: Vec<DraftStreet>,
}

/// One street of a tissue draft.
#[derive(Clone, Debug, PartialEq, Serialize, Deserialize)]
pub struct DraftStreet {
    /// Centre line in map-local metres.
    pub path: Vec<Point>,
    /// Street rank: 2 for a street through land worth many blocks, 3 for a lane.
    pub rank: u8,
    /// `street`, `lane` or `stairs`.
    pub role: String,
    /// Carriageway width in metres at each vertex of `path`.
    pub widths: Vec<f64>,
}
