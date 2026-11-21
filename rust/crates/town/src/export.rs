//! Exports of graph geometry, dates, warnings and regional road results.

use serde::{Deserialize, Serialize};

/// Graph data passed to the caller.
#[derive(Clone, Debug, Default, PartialEq, Serialize, Deserialize)]
pub struct GraphExport {}

/// A town layout and its generation warnings.
#[derive(Clone, Debug, Default, PartialEq, Serialize, Deserialize)]
pub struct TownPlan {
    /// Exported town graph.
    pub graph: GraphExport,
    /// Short messages about generation limits or decisions.
    pub warnings: Vec<String>,
}
