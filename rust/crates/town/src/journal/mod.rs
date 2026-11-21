//! Append-only events, graph mutation, replay, checkpoints and journal dumps.
//!
//! The town is the fold of its journal: an ordered list of dated events, each holding its
//! inputs and the graph operations it applied. The [`Writer`] is the only code that mutates the
//! graph: every other module reads the graph and proposes a list of [`Op`]s, which the writer
//! validates and applies in order under one event, rolling the whole event back if one fails.
//! Operations address elements by lineage key, never by handle, so a journal replays onto an
//! empty graph and a draft laid in parallel commits the same way whatever the worker order.

mod draft;
mod dump;
mod events;
mod ops;
mod stage;
#[cfg(test)]
mod tests;
mod writer;

use std::fmt;

use serde::{Deserialize, Serialize};

use crate::graph::{Change, Clock, Graph, GraphError, Key, Station};

pub use draft::{Committed, QuarterDraft, commit_drafts, ops_for_draft};
pub use dump::dump_event;
pub use events::{EventKind, event_stream};
pub use ops::{Anchor, Op};
pub use stage::Stage;
pub use writer::Writer;

/// The events of one town in the order they were applied.
#[derive(Clone, Debug, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct Journal {
    /// Cell size of the graph's spatial index in metres, so that a replay builds the same graph.
    pub cell: f64,
    /// Applied events, oldest first.
    pub events: Vec<Event>,
}

/// One applied event: its date, inputs, operations and what they created and retired.
#[derive(Clone, Debug, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct Event {
    /// Lineage key, derived from the inputs.
    pub key: Key,
    /// Date on the growth clock.
    pub clock: Clock,
    /// Kind and inputs.
    pub kind: EventKind,
    /// Operations applied, in order.
    pub ops: Vec<Op>,
    /// Elements born, in the order the operations made them.
    pub born: Keys,
    /// Elements retired, in the order the operations retired them.
    pub retired: Keys,
}

/// Keys of elements, grouped by table.
#[derive(Clone, Debug, Default, PartialEq, Serialize, Deserialize)]
pub struct Keys {
    /// Nodes.
    pub nodes: Vec<Key>,
    /// Edges.
    pub edges: Vec<Key>,
    /// Faces.
    pub faces: Vec<Key>,
}

impl Keys {
    /// The keys of a change's born and retired elements.
    fn of(graph: &Graph, change: &Change) -> (Keys, Keys) {
        let keys = |e: &crate::graph::Elements| Keys {
            nodes: e.nodes.iter().map(|&n| graph.node(n).key.clone()).collect(),
            edges: e.edges.iter().map(|&x| graph.edge(x).key.clone()).collect(),
            faces: e.faces.iter().map(|&f| graph.face(f).key.clone()).collect(),
        };
        (keys(&change.born), keys(&change.retired))
    }
}

/// Where growth stood when it stopped.
#[derive(Clone, Debug, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct Cursor {
    /// The ring being opened.
    pub ring: u32,
    /// The last station of the ring whose quarter was committed, if any.
    pub last_station: Option<Station>,
    /// Number of journal events applied when the ring's cost field was frozen: the field is
    /// recomputed from the graph replayed to that point, so the checkpoint needs no snapshot.
    pub cost_field_at: usize,
}

/// A stopped town: its journal and where growth stood. Resuming replays the journal.
#[derive(Clone, Debug, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct Checkpoint {
    /// Every event applied before the stop.
    pub journal: Journal,
    /// Where growth resumes.
    pub cursor: Cursor,
}

impl Checkpoint {
    /// The writer as it stood at the stop, rebuilt from the journal.
    pub fn resume(&self) -> Result<Writer, JournalError> {
        self.journal.replay()
    }

    /// The graph as it stood when the cursor's ring froze its cost field.
    pub fn frozen_graph(&self) -> Result<Graph, JournalError> {
        Ok(self
            .journal
            .replay_prefix(self.cursor.cost_field_at)?
            .into_graph())
    }
}

impl Journal {
    /// An empty journal for a graph indexed by cells of `cell` metres.
    pub fn new(cell: f64) -> Self {
        Self {
            cell,
            events: vec![],
        }
    }

    /// Position of the event holding `key`.
    pub fn position(&self, key: &Key) -> Option<usize> {
        self.events.iter().position(|e| &e.key == key)
    }

    /// Replay every event from an empty graph.
    pub fn replay(&self) -> Result<Writer, JournalError> {
        self.replay_prefix(self.events.len())
    }

    /// Replay from an empty graph up to and including the event holding `key`.
    pub fn replay_until(&self, key: &Key) -> Result<Writer, JournalError> {
        let i = self
            .position(key)
            .ok_or_else(|| JournalError::UnknownEvent(key.clone()))?;
        self.replay_prefix(i + 1)
    }

    /// Replay the first `count` events from an empty graph. Each replayed event must create and
    /// retire the elements it recorded; the returned writer holds the replayed prefix and can
    /// carry on from there.
    pub fn replay_prefix(&self, count: usize) -> Result<Writer, JournalError> {
        let mut writer = Writer::new(self.cell);
        for (i, recorded) in self.events.iter().take(count).enumerate() {
            if recorded.kind.key() != recorded.key {
                return Err(JournalError::Diverged { event: i });
            }
            writer.apply(recorded.clock, recorded.kind.clone(), recorded.ops.clone())?;
            let replayed = &writer.journal().events[i];
            if replayed.born != recorded.born || replayed.retired != recorded.retired {
                return Err(JournalError::Diverged { event: i });
            }
        }
        Ok(writer)
    }
}

/// Why an event was refused or a replay failed. A refused event leaves the graph and the
/// journal as they were.
#[derive(Clone, Debug, PartialEq)]
pub enum JournalError {
    /// An event with this key was already applied.
    DuplicateEvent(Key),
    /// The event is dated before the last applied event.
    ClockBackwards {
        /// Date of the last applied event.
        last: Clock,
        /// Date of the refused event.
        at: Clock,
    },
    /// Operation `op` of the event names an element that does not exist.
    UnknownKey {
        /// Position of the operation in the event.
        op: usize,
        /// The missing key.
        key: Key,
    },
    /// The graph refused operation `op` of the event.
    Graph {
        /// Position of the operation in the event.
        op: usize,
        /// The graph's reason.
        error: GraphError,
    },
    /// The event left the graph unsound (checked writers only).
    Invariants(Vec<String>),
    /// Replayed event `event` did not create or retire what it recorded.
    Diverged {
        /// Position of the event in the journal.
        event: usize,
    },
    /// No event holds this key.
    UnknownEvent(Key),
}

impl fmt::Display for JournalError {
    fn fmt(&self, f: &mut fmt::Formatter<'_>) -> fmt::Result {
        match self {
            JournalError::DuplicateEvent(key) => write!(f, "event already applied: {key:?}"),
            JournalError::ClockBackwards { last, at } => {
                write!(f, "event dated {} after an event dated {}", at.0, last.0)
            }
            JournalError::UnknownKey { op, key } => write!(f, "operation {op}: unknown {key:?}"),
            JournalError::Graph { op, error } => write!(f, "operation {op}: {error}"),
            JournalError::Invariants(lines) => {
                write!(f, "graph unsound after the event: {}", lines.join("; "))
            }
            JournalError::Diverged { event } => write!(f, "replay diverged at event {event}"),
            JournalError::UnknownEvent(key) => write!(f, "no event {key:?}"),
        }
    }
}

impl std::error::Error for JournalError {}
