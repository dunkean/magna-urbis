//! Birth, death and parents of an element, and attributes that change at dates.

use serde::{Deserialize, Serialize};

use super::key::{Clock, Key};

/// When an element was born and retired, and what it descends from.
#[derive(Clone, Debug, PartialEq, Serialize, Deserialize)]
pub struct Life {
    /// Date of birth.
    pub born: Clock,
    /// Date of retirement, once the element was split, merged or removed.
    pub died: Option<Clock>,
    /// Keys of the elements this one replaces: one for a split, several for a merge.
    pub parents: Vec<Key>,
}

impl Life {
    /// A live element born at `born`.
    pub fn new(born: Clock, parents: Vec<Key>) -> Self {
        Self {
            born,
            died: None,
            parents,
        }
    }

    /// Whether the element is still part of the current graph.
    #[inline]
    pub fn live(&self) -> bool {
        self.died.is_none()
    }

    /// Whether the element stood at `clock`: born at or before it, retired after it.
    /// An element born and retired at the same date never stood.
    #[inline]
    pub fn alive_at(&self, clock: Clock) -> bool {
        self.born <= clock && self.died.is_none_or(|died| clock < died)
    }
}

/// An attribute as a list of `(from, value)` changes in date order; the value at a date is
/// the last change made at or before it.
#[derive(Clone, Debug, PartialEq, Serialize, Deserialize)]
pub struct Versioned<T> {
    changes: Vec<(Clock, T)>,
}

impl<T> Versioned<T> {
    /// An attribute holding `value` from `from` on.
    pub fn new(from: Clock, value: T) -> Self {
        Self {
            changes: vec![(from, value)],
        }
    }

    /// The value at `clock`, or `None` before the first change.
    pub fn at(&self, clock: Clock) -> Option<&T> {
        let after = self.changes.partition_point(|(from, _)| *from <= clock);
        after.checked_sub(1).map(|i| &self.changes[i].1)
    }

    /// The latest value.
    pub fn current(&self) -> &T {
        // Never empty: built with one change and changes are only added.
        &self.changes[self.changes.len() - 1].1
    }

    /// Hold `value` from `from` on; a change already made at `from` is replaced.
    pub fn set(&mut self, from: Clock, value: T) {
        let i = self.changes.partition_point(|(date, _)| *date < from);
        match self.changes.get_mut(i) {
            Some(change) if change.0 == from => change.1 = value,
            _ => self.changes.insert(i, (from, value)),
        }
    }

    /// All changes in date order.
    pub fn changes(&self) -> &[(Clock, T)] {
        &self.changes
    }
}
