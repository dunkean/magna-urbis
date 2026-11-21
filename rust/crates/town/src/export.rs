//! Finished graph and growth metadata for downstream consumers.

use magna_urbis_geom::{Point, Shape};
use serde::{Deserialize, Serialize};

use crate::graph::{Clock, FaceId, Graph, Key};
use crate::growth::QuarterRecord;
use crate::harbour::HarbourStreet;
use crate::journal::{Checkpoint, Cursor, Journal};
use crate::walls::Precinct;

/// A circuit of the town, from which the adapter builds classic's enclosure and its works.
#[derive(Clone, Debug)]
pub struct WallPlan {
    pub precinct: Precinct,
    /// Inhabitants housed when it was raised, or at the stop while it is open.
    pub population: u32,
}

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
    /// Inhabitants it holds at its fill step.
    pub population: f64,
    /// Recipe and zone of the compact tissue it was rebuilt in with age, if it was.
    pub aged: Option<(String, String)>,
}

/// How the part of one source segment inside a town connects to the regional network.
#[derive(Clone, Debug, PartialEq, Serialize, Deserialize)]
pub struct RoadResult {
    pub id: String,
    /// Town entries in ascending source-station order.
    pub entries: Vec<Point>,
    /// Intervals retaining regional connectivity, including planned axes.
    pub kept: Vec<(f64, f64)>,
    /// Intervals occupied by local streets where regional connectivity has ended.
    pub ended: Vec<(f64, f64)>,
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
    /// Regional connectivity at the stop. Defaults to `None` when no source road enters.
    pub regional_road_result: Option<Vec<RoadResult>>,
    /// The founding castle's circuit first, then the town's circuits in survey order.
    pub walls: Vec<WallPlan>,
    /// The harbour's quay, moles, piers and landing stages as classic streets.
    pub quays: Vec<HarbourStreet>,
    /// Keys of the port quarters, those that hang on the harbour.
    pub port_quarters: Vec<Key>,
    /// Stems of the ford edges, exported with role `ford`.
    pub fords: Vec<Key>,
    /// The castle's bailey, land outside the housing budget.
    pub bailey: Option<Shape>,
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
