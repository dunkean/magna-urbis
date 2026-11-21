//! A trial copy of the graph on which one event's operations are gathered group by group.

use super::ops::{Failure, apply};
use super::{JournalError, Op, Writer};
use crate::graph::{Clock, Graph};

/// The operations of one event being built, checked against a copy of the graph as they are
/// proposed. A module whose event is made of parts that may each be refused (one regional road,
/// one boundary arc, one street) pushes them as groups: a group the graph accepts is kept and
/// the copy moves on, a refused group leaves the copy as it was. The writer later applies the
/// kept operations as one event and reaches the same graph, since operations are deterministic.
#[derive(Clone, Debug)]
pub struct Stage {
    graph: Graph,
    at: Clock,
    ops: Vec<Op>,
}

impl Writer {
    /// A stage for an event dated `at`, starting from the graph as it stands.
    pub fn stage(&self, at: Clock) -> Stage {
        Stage {
            graph: self.graph().clone(),
            at,
            ops: Vec::new(),
        }
    }
}

impl Stage {
    /// The graph with every kept group applied.
    pub fn graph(&self) -> &Graph {
        &self.graph
    }

    /// The kept operations, in order.
    pub fn ops(&self) -> &[Op] {
        &self.ops
    }

    /// The kept operations, for the writer.
    pub fn into_ops(self) -> Vec<Op> {
        self.ops
    }

    /// Apply `group` to the copy: all of it, or nothing. A single edge, node or kind operation
    /// is checked before it changes the graph, so only longer groups and chain retypes, which
    /// may stop half way, need a backup.
    pub fn try_push(&mut self, group: Vec<Op>) -> Result<(), JournalError> {
        let partial = group.len() > 1
            || group
                .iter()
                .any(|op| matches!(op, Op::SetChainClass { .. } | Op::SetChainRank { .. }));
        let backup = partial.then(|| self.graph.clone());
        for (op, item) in group.iter().enumerate() {
            if let Err(failure) = apply(&mut self.graph, item, self.at) {
                if let Some(backup) = backup {
                    self.graph = backup;
                }
                return Err(match failure {
                    Failure::Unknown(key) => JournalError::UnknownKey { op, key },
                    Failure::Graph(error) => JournalError::Graph { op, error },
                });
            }
        }
        self.ops.extend(group);
        Ok(())
    }
}
