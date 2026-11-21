//! The kinds of journal events, their inputs and their lineage keys.

use magna_urbis_geom::Point;
use magna_urbis_random::Rng;
use serde::{Deserialize, Serialize};

use super::Event;
use crate::graph::{EdgeClass, Key, Station, tag};

/// Event kind codes, the first item of an event key. An opened quarter is keyed by its quarter
/// key instead, so that its streets and blocks hang directly from it.
mod code {
    pub const FOUND: u32 = 1;
    pub const PROMOTE: u32 = 2;
    pub const EXTEND_ARMATURE: u32 = 3;
    pub const AGE_QUARTER: u32 = 5;
    pub const SURVEY_PRECINCT: u32 = 6;
    pub const RAISE_WALL: u32 = 7;
    pub const RETYPE_CHAIN: u32 = 8;
    pub const OPEN_HARBOUR: u32 = 9;
    pub const EXTEND_HARBOUR: u32 = 10;
    pub const CROSS_WATER: u32 = 11;
}

/// What an event does, with its inputs as plain data.
#[derive(Clone, Debug, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub enum EventKind {
    /// Applies the charter: regional roads, founding focus, harbour or castle road, founding
    /// precinct and founding quarter.
    Found {
        /// Centre of the town in map-local metres.
        center: Point,
        /// Founding focus, as the charter names it.
        focus: String,
    },
    /// Moves the town to its next phase; what is born afterwards follows the new phase.
    Promote {
        /// Position of the phase in the charter's ladder.
        phase: u32,
        /// Name of the phase.
        name: String,
    },
    /// Prolongs the main chains across a ring.
    ExtendArmature {
        /// The ring the chains are prolonged across.
        ring: u32,
    },
    /// Lays a quarter's streets and blocks in a sector. Its key is the quarter's key.
    OpenQuarter {
        /// The quarter's ring.
        ring: u32,
        /// Where the quarter hangs on the armature.
        station: Station,
        /// Name of the tissue that laid the streets.
        tissue: String,
        /// Keys of the edges bounding the quarter when its draft was laid.
        outline: Vec<Key>,
    },
    /// Raises the fill level of a quarter's blocks by one step.
    AgeQuarter {
        /// The quarter's key.
        quarter: Key,
        /// The fill step reached, from 1.
        step: u32,
    },
    /// Traces the next precinct on open land, with its gates, wall street and reserves.
    SurveyPrecinct {
        /// Position of the precinct in the town's sequence, from 0.
        precinct: u32,
        /// Multiple of the housed households the precinct is sized for.
        step: f64,
    },
    /// Retypes a full precinct into a wall; creates no geometry.
    RaiseWall {
        /// Position of the precinct in the town's sequence.
        precinct: u32,
        /// Kind of the raised wall, as the wall spec names it.
        kind: String,
    },
    /// Changes a chain's class or rank: road demotion, old wall into boulevard, fossil.
    RetypeChain {
        /// The chain's key.
        chain: Key,
        /// Position of this change among the chain's changes, from 0.
        step: u32,
        /// New class, if it changes.
        class: Option<EdgeClass>,
        /// New rank, if it changes.
        rank: Option<u8>,
    },
    /// Inserts the quay edge, apron face and landing nodes on a surveyed front.
    OpenHarbour {
        /// Position of the front in the survey.
        front: u32,
    },
    /// Lengthens the quay and adds works and water gates.
    ExtendHarbour {
        /// Position of the front in the survey.
        front: u32,
        /// Position of this extension among the front's extensions, from 1.
        step: u32,
        /// Quay length after the extension, in metres.
        quay_length: f64,
    },
    /// Inserts a bridge or ferry landing and opens a far bank.
    CrossWater {
        /// Position of the crossing in the town's sequence, from 0.
        crossing: u32,
        /// Survey component of the far bank.
        bank: u32,
    },
}

impl EventKind {
    /// The event's lineage key, from its kind and the inputs that tell it from its siblings.
    pub fn key(&self) -> Key {
        match self {
            EventKind::Found { .. } => Key::event(code::FOUND, &[]),
            EventKind::Promote { phase, .. } => Key::event(code::PROMOTE, &[*phase]),
            EventKind::ExtendArmature { ring } => Key::event(code::EXTEND_ARMATURE, &[*ring]),
            EventKind::OpenQuarter { ring, station, .. } => Key::quarter(*ring, station),
            EventKind::AgeQuarter { quarter, step } => {
                Key::event(code::AGE_QUARTER, &[*step]).nested(tag::SUBJECT, quarter)
            }
            EventKind::SurveyPrecinct { precinct, .. } => {
                Key::event(code::SURVEY_PRECINCT, &[*precinct])
            }
            EventKind::RaiseWall { precinct, .. } => Key::event(code::RAISE_WALL, &[*precinct]),
            EventKind::RetypeChain { chain, step, .. } => {
                Key::event(code::RETYPE_CHAIN, &[*step]).nested(tag::SUBJECT, chain)
            }
            EventKind::OpenHarbour { front } => Key::event(code::OPEN_HARBOUR, &[*front]),
            EventKind::ExtendHarbour { front, step, .. } => {
                Key::event(code::EXTEND_HARBOUR, &[*front, *step])
            }
            EventKind::CrossWater { crossing, .. } => Key::event(code::CROSS_WATER, &[*crossing]),
        }
    }
}

impl Event {
    /// The event's random stream: the town seed forked by the event's lineage key, so that an
    /// event draws the same numbers whatever was computed before it.
    pub fn stream(&self, town_seed: &str) -> Rng {
        event_stream(town_seed, &self.key)
    }
}

/// The random stream of the event holding `key`, for modules that draw before the event exists.
pub fn event_stream(town_seed: &str, key: &Key) -> Rng {
    let label: Vec<String> = key.parts().iter().map(u32::to_string).collect();
    Rng::new(town_seed).fork(&format!("event:{}", label.join(".")))
}
