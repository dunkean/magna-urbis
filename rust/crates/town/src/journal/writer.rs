//! The single writer: applies events to the graph and records them in the journal.

use std::collections::HashSet;

use super::ops::{Failure, apply as apply_op};
use super::{Checkpoint, Cursor, Event, EventKind, Journal, JournalError, Keys, Op};
use crate::graph::{Change, Clock, Graph, Key};

/// A town's graph and the journal of the events that built it. Only the writer mutates the graph.
#[derive(Clone, Debug)]
pub struct Writer {
    graph: Graph,
    journal: Journal,
    applied: HashSet<Key>,
    checked: bool,
}

impl Writer {
    /// An empty town whose graph indexes cells of `cell` metres.
    pub fn new(cell: f64) -> Self {
        Self {
            graph: Graph::new(cell),
            journal: Journal::new(cell),
            applied: HashSet::new(),
            checked: false,
        }
    }

    /// The graph as it stands after the last event.
    pub fn graph(&self) -> &Graph {
        &self.graph
    }

    /// Every event applied so far.
    pub fn journal(&self) -> &Journal {
        &self.journal
    }

    /// The event at position `index`.
    pub fn event(&self, index: usize) -> Option<&Event> {
        self.journal.events.get(index)
    }

    /// The graph, dropping the journal.
    pub fn into_graph(self) -> Graph {
        self.graph
    }

    /// When set, every event is followed by the graph's invariant checks and refused if they
    /// fail. The checks walk the whole graph: for tests and debugging.
    pub fn set_checked(&mut self, checked: bool) {
        self.checked = checked;
    }

    /// The journal and `cursor`, from which growth can resume.
    pub fn checkpoint(&self, cursor: Cursor) -> Checkpoint {
        Checkpoint {
            journal: self.journal.clone(),
            cursor,
        }
    }

    /// Apply an event: its operations in order, at date `at`. On success the event is appended to
    /// the journal and its position returned; on failure the graph and journal stay as they were.
    pub fn apply(
        &mut self,
        at: Clock,
        kind: EventKind,
        ops: Vec<Op>,
    ) -> Result<usize, JournalError> {
        let key = kind.key();
        if self.applied.contains(&key) {
            return Err(JournalError::DuplicateEvent(key));
        }
        if let Some(last) = self.journal.events.last()
            && at < last.clock
        {
            return Err(JournalError::ClockBackwards {
                last: last.clock,
                at,
            });
        }
        let change = self.run(&ops, at)?;
        let (born, retired) = Keys::of(&self.graph, &change);
        self.applied.insert(key.clone());
        self.journal.events.push(Event {
            key,
            clock: at,
            kind,
            ops,
            born,
            retired,
        });
        Ok(self.journal.events.len() - 1)
    }

    /// Apply `list` as one unit: all of it, or nothing.
    fn run(&mut self, list: &[Op], at: Clock) -> Result<Change, JournalError> {
        let backup = self.graph.clone();
        let mut change = Change::default();
        for (op, item) in list.iter().enumerate() {
            match apply_op(&mut self.graph, item, at) {
                Ok(done) => change.extend(done),
                Err(failure) => {
                    self.graph = backup;
                    return Err(match failure {
                        Failure::Unknown(key) => JournalError::UnknownKey { op, key },
                        Failure::Graph(error) => JournalError::Graph { op, error },
                    });
                }
            }
        }
        if self.checked {
            let violations = self.graph.check_invariants();
            if !violations.is_empty() {
                self.graph = backup;
                return Err(JournalError::Invariants(violations));
            }
        }
        Ok(change)
    }
}
