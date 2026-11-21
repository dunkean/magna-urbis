//! Element records and kinds, operation inputs and results.

use std::fmt;

use magna_urbis_geom::{Point, Shape};
use serde::{Deserialize, Serialize};

use super::history::{Life, Versioned};
use super::key::{EdgeId, FaceId, HalfId, Key, NodeId};

/// One planar subdivision. Edges of different levels may cross without a node.
#[derive(Clone, Copy, Debug, PartialEq, Eq, PartialOrd, Ord, Hash, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub enum Level {
    /// Streets, walls and quays on the ground.
    Ground,
    /// Bridges over streets or water.
    Deck,
    /// Terraces above or below the ground on steep sites.
    Terrace,
}

impl Level {
    /// Every level, in table order.
    pub const ALL: [Level; 3] = [Level::Ground, Level::Deck, Level::Terrace];

    /// Position of the level in per-level tables.
    #[inline]
    pub fn index(self) -> usize {
        self as usize
    }
}

/// What a node is.
#[derive(Clone, Copy, Debug, PartialEq, Eq, PartialOrd, Ord, Hash, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub enum NodeKind {
    /// Where streets meet.
    Junction,
    /// The open end of a street at the edge of the built land.
    StreetEnd,
    /// The closed end of a cul-de-sac or derb.
    DeadEnd,
    /// A gate in a wall.
    Gate,
    /// A gate between a wall and the water.
    WaterGate,
    /// A landing on a quay or bank.
    Landing,
    /// Where a bridge meets the ground.
    BridgeEnd,
    /// Where a regional road enters the town.
    TownEntry,
    /// A gate in a castle circuit.
    CastleGate,
}

/// What an edge carries or marks.
#[derive(Clone, Copy, Debug, PartialEq, Eq, PartialOrd, Ord, Hash, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub enum EdgeClass {
    /// A street.
    Street,
    /// A narrow lane.
    Lane,
    /// Stairs across contours.
    Stairs,
    /// A raised wall.
    Wall,
    /// A quay along the water.
    Quay,
    /// A bridge.
    Bridge,
    /// A regional road crossing or reaching the town.
    RegionalRoad,
    /// A regional alignment taken into a planned town's main grid.
    GridAxis,
    /// The road between the town and its harbour.
    HarbourRoad,
    /// The road up to a castle.
    CastleRoad,
    /// A canal.
    Canal,
    /// A limit of open land with no street, such as a quarter's outer edge.
    Boundary,
}

/// What a face is used for.
#[derive(Clone, Copy, Debug, PartialEq, Eq, PartialOrd, Ord, Hash, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub enum FaceKind {
    /// A block cut into lots.
    Block,
    /// An open square.
    Plaza,
    /// Land held back for later use.
    Reserve,
    /// Ditches, glacis and other wall works.
    Works,
    /// The working strip behind a quay.
    Apron,
    /// Common land.
    Common,
    /// A castle's bailey.
    Bailey,
    /// Land not built on, including the unbounded face.
    Unbuilt,
}

/// A node: a point where edges meet or end.
#[derive(Clone, Debug)]
pub struct Node {
    /// Lineage key.
    pub key: Key,
    /// Dates and parents.
    pub life: Life,
    /// The level the node belongs to when it has no arms; edges of any level may end on it.
    pub level: Level,
    /// Position in map-local metres.
    pub position: Point,
    /// Kind over time.
    pub kind: Versioned<NodeKind>,
    /// Live outgoing half-edges, on every level, in no particular order.
    pub(super) out: Vec<HalfId>,
}

/// An edge: a polyline between two nodes, drawn as it is.
#[derive(Clone, Debug)]
pub struct Edge {
    /// Lineage key.
    pub key: Key,
    /// Key of the edge this one is a piece of after splits (its own key when it was never split).
    pub stem: Key,
    /// Dates and parents.
    pub life: Life,
    /// Planar subdivision the edge lies in.
    pub level: Level,
    /// First and second node; the polyline runs from the first to the second.
    pub nodes: [NodeId; 2],
    /// The drawn line; its ends equal the positions of its nodes.
    pub polyline: Vec<Point>,
    /// Width in metres at each polyline vertex.
    pub widths: Vec<f64>,
    /// Class over time.
    pub class: Versioned<EdgeClass>,
    /// Rank over time (0 for the main streets, higher for lesser ones).
    pub rank: Versioned<u8>,
    /// Key of the element (a quarter, for instance) that laid the edge, if any.
    pub owner: Option<Key>,
    /// Key of the chain (a street or wall drawn as one line) the edge belongs to, if any.
    pub chain: Option<Key>,
}

/// One side of an edge. Its face lies on its left.
#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub struct HalfEdge {
    /// Node the half leaves from.
    pub origin: NodeId,
    /// Next half along the same face walk.
    pub next: HalfId,
    /// Previous half along the same face walk.
    pub prev: HalfId,
    /// Face on the left.
    pub face: FaceId,
}

/// A face of one level: a block, a plaza, or the unbounded outside.
#[derive(Clone, Debug)]
pub struct Face {
    /// Lineage key.
    pub key: Key,
    /// Dates and parents.
    pub life: Life,
    /// Planar subdivision the face belongs to.
    pub level: Level,
    /// Kind over time.
    pub kind: Versioned<FaceKind>,
    /// One half on the counter-clockwise outer walk; `None` for the unbounded face.
    pub outer: Option<HalfId>,
    /// One half on each inner walk: holes and detached trees, walked clockwise.
    pub inners: Vec<HalfId>,
    /// The outline at retirement, kept for queries at earlier dates.
    pub final_outline: Option<Shape>,
}

/// What to insert: the drawn edge and its attributes.
#[derive(Clone, Debug, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct EdgeSpec {
    /// Lineage key: the creating event's key and the edge's rank in it.
    pub key: Key,
    /// Planar subdivision.
    pub level: Level,
    /// Class from birth.
    pub class: EdgeClass,
    /// Rank from birth.
    pub rank: u8,
    /// Drawn line from the first end to the second.
    pub polyline: Vec<Point>,
    /// Width at each polyline vertex.
    pub widths: Vec<f64>,
    /// Element that lays the edge.
    pub owner: Option<Key>,
    /// Chain the edge belongs to.
    pub chain: Option<Key>,
    /// Keys for the faces on the left and right of the edge when it splits a face; derived from
    /// the faces' outer walks when absent.
    pub face_names: Option<[Key; 2]>,
}

impl EdgeSpec {
    /// A rank-0 edge of constant `width`, with no owner, chain or face names.
    pub fn new(key: Key, level: Level, class: EdgeClass, polyline: Vec<Point>, width: f64) -> Self {
        let widths = vec![width; polyline.len()];
        Self {
            key,
            level,
            class,
            rank: 0,
            polyline,
            widths,
            owner: None,
            chain: None,
            face_names: None,
        }
    }
}

/// Where an inserted edge ends.
#[derive(Clone, Copy, Debug, PartialEq)]
pub enum End {
    /// On an existing live node, at its position.
    Node(NodeId),
    /// On an existing edge, which retires and is replaced by two pieces joined by a new node.
    /// A retired edge stands for its live piece under the polyline end.
    OnEdge {
        /// The edge the polyline end falls on.
        edge: EdgeId,
        /// Kind of the new node.
        kind: NodeKind,
    },
    /// At a new node inside a face, making the edge dangle.
    Free {
        /// Kind of the new node.
        kind: NodeKind,
    },
}

/// The angular gap between two consecutive arms of a node, counter-clockwise.
#[derive(Clone, Copy, Debug, PartialEq)]
pub struct Sector {
    /// Arm the sector starts from.
    pub from: HalfId,
    /// Next arm counter-clockwise (equal to `from` at a node with one arm).
    pub to: HalfId,
    /// Face the sector opens onto (the face on the left of `from`).
    pub face: FaceId,
    /// Opening angle in radians, in `(0, 2π]`.
    pub opening: f64,
}

/// One edge of a chain, in chain order.
#[derive(Clone, Copy, Debug, PartialEq)]
pub struct ChainStep {
    /// The edge.
    pub edge: EdgeId,
    /// Its half in the direction the chain is walked.
    pub half: HalfId,
    /// Face on the left of the walk.
    pub left: FaceId,
    /// Face on the right of the walk.
    pub right: FaceId,
}

/// Handles of elements, grouped by table.
#[derive(Clone, Debug, Default, PartialEq)]
pub struct Elements {
    /// Nodes.
    pub nodes: Vec<NodeId>,
    /// Edges.
    pub edges: Vec<EdgeId>,
    /// Faces.
    pub faces: Vec<FaceId>,
}

impl Elements {
    fn extend(&mut self, other: Elements) {
        self.nodes.extend(other.nodes);
        self.edges.extend(other.edges);
        self.faces.extend(other.faces);
    }
}

/// What an operation created and retired.
#[derive(Clone, Debug, Default, PartialEq)]
pub struct Change {
    /// Elements born.
    pub born: Elements,
    /// Elements retired.
    pub retired: Elements,
}

impl Change {
    /// Append another change made after this one.
    pub fn extend(&mut self, other: Change) {
        self.born.extend(other.born);
        self.retired.extend(other.retired);
    }
}

/// Why an operation was refused.
#[derive(Clone, Debug, PartialEq)]
pub enum GraphError {
    /// The key is already held by another element.
    DuplicateKey(Key),
    /// The handle is outside its table.
    Unknown,
    /// The element is retired.
    Retired,
    /// The input is degenerate; the text says how.
    Degenerate(&'static str),
    /// A polyline end is not at the position of its node.
    OffNode,
    /// A polyline end said to be on an edge is not on it.
    OffEdge,
    /// A point on an edge is too close to one of its nodes to split it there.
    AtNode,
    /// Both ends of the edge are the same point.
    Loop,
    /// The polyline crosses or overlaps this edge away from shared nodes.
    Crossing(EdgeId),
    /// The ends of the polyline open onto different faces.
    DifferentFaces,
    /// The structure is not as expected; the text says where.
    Inconsistent(&'static str),
}

impl fmt::Display for GraphError {
    fn fmt(&self, f: &mut fmt::Formatter<'_>) -> fmt::Result {
        match self {
            GraphError::DuplicateKey(key) => write!(f, "key already used: {key:?}"),
            GraphError::Unknown => f.write_str("unknown element"),
            GraphError::Retired => f.write_str("element is retired"),
            GraphError::Degenerate(what) => write!(f, "degenerate input: {what}"),
            GraphError::OffNode => f.write_str("polyline end is not at its node"),
            GraphError::OffEdge => f.write_str("polyline end is not on its edge"),
            GraphError::AtNode => f.write_str("split point too close to a node"),
            GraphError::Loop => f.write_str("edge ends where it starts"),
            GraphError::Crossing(edge) => write!(f, "crosses edge {}", edge.0),
            GraphError::DifferentFaces => f.write_str("ends open onto different faces"),
            GraphError::Inconsistent(what) => write!(f, "inconsistent graph: {what}"),
        }
    }
}

impl std::error::Error for GraphError {}
