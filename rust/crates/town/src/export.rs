//! Finished graph and growth metadata for downstream consumers.

use magna_urbis_geom::Point;

use crate::graph::{Clock, FaceId, Graph, Key};
use crate::growth::QuarterRecord;
use crate::journal::{Checkpoint, Cursor, Journal};

/// A growth regime reached at a dated promotion.
#[derive(Clone, Debug, PartialEq)]
pub struct DatedPhase {
    pub born: Clock,
    pub kind: String,
    pub recipe: String,
    pub zone: String,
    pub population: f64,
    pub target_area: f64,
}

/// The live faces descended from one opened quarter, with its birth regime.
#[derive(Clone, Debug, PartialEq)]
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
    /// Where growth stopped, to resume the town or reopen it once.
    pub stop: Stop,
}

/// Where growth stopped: the journal and cursor, the target and the count of every quarter.
#[derive(Clone, Debug, PartialEq)]
pub struct Stop {
    /// The journal and the cursor; resuming replays the journal.
    pub checkpoint: Checkpoint,
    /// Households growth was asked to house.
    pub target: Clock,
    /// Position of the phase reached in the phase plan.
    pub phase: usize,
    /// Every opened quarter in birth order, with its counts per fill step and the step reached.
    pub records: Vec<QuarterRecord>,
}

impl Default for Stop {
    /// A stop before founding: an empty journal.
    fn default() -> Self {
        Self {
            checkpoint: Checkpoint {
                journal: Journal::new(32.0),
                cursor: Cursor {
                    ring: 0,
                    last_station: None,
                    cost_field_at: 0,
                },
            },
            target: Clock::ZERO,
            phase: 0,
            records: Vec::new(),
        }
    }
}
