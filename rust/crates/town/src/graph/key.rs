//! Lineage keys, dates and table handles.

use std::fmt;
use std::ops::Add;

use serde::{Deserialize, Serialize};

use super::elements::Level;

/// Segment tags. A key is a sequence of segments `[tag, length, items...]`, so keys
/// built by different constructors, or nested inside one another, never collide.
pub mod tag {
    /// A journal event: `[kind, parts...]`.
    pub const EVENT: u32 = 1;
    /// A quarter's ring.
    pub const QUARTER: u32 = 2;
    /// The host node of a station, nested.
    pub const STATION: u32 = 3;
    /// The arm a station opens at its host.
    pub const ARM: u32 = 4;
    /// A block's split path inside its quarter.
    pub const BLOCK: u32 = 5;
    /// An edge's rank in the event that created it.
    pub const EDGE: u32 = 6;
    /// A node created at one end of an edge: 0 at its start, 1 at its end.
    pub const END: u32 = 7;
    /// The start node of a piece of a split edge, nested.
    pub const PIECE_FROM: u32 = 8;
    /// The end node of a piece of a split edge, nested.
    pub const PIECE_TO: u32 = 9;
    /// A face named by a hash of its outer walk.
    pub const FACE: u32 = 10;
    /// Disambiguates a derived face key already held by an earlier face.
    pub const SALT: u32 = 11;
    /// The unbounded face of a level.
    pub const OUTSIDE: u32 = 12;
    /// An edge moved to another node by a node merge.
    pub const REANCHOR: u32 = 13;
    /// A node placed by the caller.
    pub const NODE: u32 = 14;
}

/// A lineage key: the identity of an element derived from what created it, never from
/// allocation order. Keys are compact sequences of `u32`, hashable and totally ordered.
#[derive(Clone, PartialEq, Eq, PartialOrd, Ord, Hash, Serialize, Deserialize)]
#[serde(transparent)]
pub struct Key(Box<[u32]>);

/// Where a quarter hangs on the armature: its host node and the arm it opens there.
#[derive(Clone, Debug, PartialEq, Eq, PartialOrd, Ord, Hash, Serialize, Deserialize)]
pub struct Station {
    /// Key of the node the quarter hangs from.
    pub host: Key,
    /// Rank of the arm the quarter opens at its host.
    pub arm: u32,
}

impl Key {
    /// A key of one segment.
    pub fn root(tag: u32, items: &[u32]) -> Self {
        Self(segment(&[], tag, items))
    }

    /// This key followed by one segment.
    pub fn child(&self, tag: u32, items: &[u32]) -> Self {
        Self(segment(&self.0, tag, items))
    }

    /// This key followed by a segment holding another key.
    pub fn nested(&self, tag: u32, inner: &Key) -> Self {
        self.child(tag, &inner.0)
    }

    /// The key of a journal event of `kind`, told apart from its siblings by `parts`.
    pub fn event(kind: u32, parts: &[u32]) -> Self {
        let mut items = Vec::with_capacity(parts.len() + 1);
        items.push(kind);
        items.extend_from_slice(parts);
        Self::root(tag::EVENT, &items)
    }

    /// A quarter's key: its ring and its station, independent of the order a ring is computed in.
    pub fn quarter(ring: u32, station: &Station) -> Self {
        Self::root(tag::QUARTER, &[ring])
            .nested(tag::STATION, &station.host)
            .child(tag::ARM, &[station.arm])
    }

    /// A block's key: its quarter and its path in the quarter's split (one side index per level).
    pub fn block(quarter: &Key, path: &[u8]) -> Self {
        let items: Vec<u32> = path.iter().map(|&side| u32::from(side)).collect();
        quarter.child(tag::BLOCK, &items)
    }

    /// An edge's key: the event that created it and its rank in that event.
    pub fn edge(event: &Key, rank: u32) -> Self {
        event.child(tag::EDGE, &[rank])
    }

    /// A node placed by the caller, named by `parts`.
    pub fn node(parts: &[u32]) -> Self {
        Self::root(tag::NODE, parts)
    }

    /// The key of the unbounded face of `level`.
    pub fn outside(level: Level) -> Self {
        Self::root(tag::OUTSIDE, &[level.index() as u32])
    }

    /// The raw parts of the key.
    pub fn parts(&self) -> &[u32] {
        &self.0
    }
}

fn segment(prefix: &[u32], tag: u32, items: &[u32]) -> Box<[u32]> {
    let mut parts = Vec::with_capacity(prefix.len() + 2 + items.len());
    parts.extend_from_slice(prefix);
    parts.push(tag);
    parts.push(items.len() as u32);
    parts.extend_from_slice(items);
    parts.into_boxed_slice()
}

impl fmt::Debug for Key {
    fn fmt(&self, f: &mut fmt::Formatter<'_>) -> fmt::Result {
        f.write_str("Key(")?;
        for (i, part) in self.0.iter().enumerate() {
            if i > 0 {
                f.write_str(".")?;
            }
            write!(f, "{part}")?;
        }
        f.write_str(")")
    }
}

/// A date on the growth clock: housed households in thousandths.
///
/// The clock is a fixed-point integer rather than an `f64` so that sums of capacities are
/// exact and associative (the same date whatever order quarters are counted in, which the
/// prefix property needs), and so that dates are totally ordered and hashable.
#[derive(
    Clone, Copy, Debug, Default, PartialEq, Eq, PartialOrd, Ord, Hash, Serialize, Deserialize,
)]
#[serde(transparent)]
pub struct Clock(pub u64);

impl Clock {
    /// The founding date.
    pub const ZERO: Clock = Clock(0);
    /// Clock units per household.
    pub const PER_HOUSEHOLD: f64 = 1000.0;

    /// The date at which `households` are housed, rounded to the clock unit; negative counts give zero.
    pub fn from_households(households: f64) -> Self {
        Self((households.max(0.0) * Self::PER_HOUSEHOLD).round() as u64)
    }

    /// Housed households at this date.
    pub fn households(self) -> f64 {
        self.0 as f64 / Self::PER_HOUSEHOLD
    }
}

impl Add for Clock {
    type Output = Clock;
    fn add(self, other: Clock) -> Clock {
        Clock(self.0.saturating_add(other.0))
    }
}

macro_rules! handle {
    ($(#[$doc:meta])* $name:ident) => {
        $(#[$doc])*
        #[derive(Clone, Copy, Debug, PartialEq, Eq, PartialOrd, Ord, Hash, Serialize, Deserialize)]
        #[serde(transparent)]
        pub struct $name(pub u32);

        impl $name {
            /// Position in its table.
            #[inline]
            pub fn ix(self) -> usize {
                self.0 as usize
            }
        }
    };
}

handle!(
    /// Index of a node in the graph's node table.
    NodeId
);
handle!(
    /// Index of an edge in the graph's edge table.
    EdgeId
);
handle!(
    /// Index of a face in the graph's face table.
    FaceId
);
handle!(
    /// Index of a half-edge: edge `e` owns `2e` (along its polyline) and `2e + 1` (against it).
    HalfId
);

impl HalfId {
    /// The half of `edge` that runs along its polyline, from its first node to its second.
    #[inline]
    pub fn forward(edge: EdgeId) -> Self {
        Self(edge.0 * 2)
    }

    /// The half of `edge` that runs against its polyline.
    #[inline]
    pub fn backward(edge: EdgeId) -> Self {
        Self(edge.0 * 2 + 1)
    }

    /// The opposite half of the same edge.
    #[inline]
    pub fn twin(self) -> Self {
        Self(self.0 ^ 1)
    }

    /// The edge this half belongs to.
    #[inline]
    pub fn edge(self) -> EdgeId {
        EdgeId(self.0 >> 1)
    }

    /// Whether this half runs along its edge's polyline.
    #[inline]
    pub fn is_forward(self) -> bool {
        self.0 & 1 == 0
    }
}
