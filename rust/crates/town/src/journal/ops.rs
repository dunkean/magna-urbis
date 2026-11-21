//! Graph operations addressed by lineage keys, and their application to the graph.

use magna_urbis_geom::Point;
use serde::{Deserialize, Serialize};

use crate::graph::{
    Change, Clock, EdgeClass, EdgeId, EdgeSpec, End, FaceKind, Graph, GraphError, Key, Level,
    NodeId, NodeKind,
};

/// One change to the graph, proposed by a module and applied by the writer at the event's date.
#[derive(Clone, Debug, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub enum Op {
    /// Add a node with no arms.
    AddNode {
        /// The node's key.
        key: Key,
        /// Level the node belongs to.
        level: Level,
        /// Position in map-local metres.
        position: Point,
        /// Kind from birth.
        kind: NodeKind,
    },
    /// Insert an edge between two nodes, ending on an edge (which splits) or dangling.
    InsertEdge {
        /// The drawn edge and its attributes.
        spec: EdgeSpec,
        /// Where its first and last points end.
        ends: [Anchor; 2],
    },
    /// Split an edge at a point with a new node.
    SplitEdge {
        /// The edge, or a retired edge standing for its live piece under `point`.
        edge: Key,
        /// Point on the edge.
        point: Point,
        /// Key of the new node.
        node: Key,
        /// Kind of the new node.
        kind: NodeKind,
    },
    /// Remove an edge, merging the faces on either side.
    RemoveEdge {
        /// The edge.
        edge: Key,
        /// Key of the merged face, derived from its outer walk when absent.
        merged: Option<Key>,
    },
    /// Merge a node into another.
    MergeNodes {
        /// The node that stays.
        keep: Key,
        /// The node that retires.
        gone: Key,
    },
    /// Change an edge's class.
    SetEdgeClass {
        /// The edge.
        edge: Key,
        /// New class.
        class: EdgeClass,
    },
    /// Change an edge's rank.
    SetEdgeRank {
        /// The edge.
        edge: Key,
        /// New rank.
        rank: u8,
    },
    /// Change the class of every live edge of a chain.
    SetChainClass {
        /// The chain.
        chain: Key,
        /// New class.
        class: EdgeClass,
    },
    /// Change the rank of every live edge of a chain.
    SetChainRank {
        /// The chain.
        chain: Key,
        /// New rank.
        rank: u8,
    },
    /// Change a node's kind.
    SetNodeKind {
        /// The node.
        node: Key,
        /// New kind.
        kind: NodeKind,
    },
    /// Change a face's kind.
    SetFaceKind {
        /// The face.
        face: Key,
        /// New kind.
        kind: FaceKind,
    },
}

/// Where an inserted edge ends, by key.
#[derive(Clone, Debug, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub enum Anchor {
    /// On an existing live node.
    Node {
        /// The node.
        node: Key,
    },
    /// On an existing edge, which splits. A retired edge stands for its live piece under the
    /// end, so an edge may be named by its stem whatever splits it went through.
    OnEdge {
        /// The edge.
        edge: Key,
        /// Kind of the new node.
        kind: NodeKind,
    },
    /// At a new node, making the edge dangle.
    Free {
        /// Kind of the new node.
        kind: NodeKind,
    },
}

/// Why one operation could not be applied.
pub(super) enum Failure {
    /// A key names no element.
    Unknown(Key),
    /// The graph refused the operation.
    Graph(GraphError),
}

impl From<GraphError> for Failure {
    fn from(error: GraphError) -> Self {
        Failure::Graph(error)
    }
}

fn node(graph: &Graph, key: &Key) -> Result<NodeId, Failure> {
    graph
        .node_id(key)
        .ok_or_else(|| Failure::Unknown(key.clone()))
}

fn edge(graph: &Graph, key: &Key) -> Result<EdgeId, Failure> {
    graph
        .edge_id(key)
        .ok_or_else(|| Failure::Unknown(key.clone()))
}

fn end(graph: &Graph, anchor: &Anchor) -> Result<End, Failure> {
    Ok(match anchor {
        Anchor::Node { node: key } => End::Node(node(graph, key)?),
        Anchor::OnEdge { edge: key, kind } => End::OnEdge {
            edge: edge(graph, key)?,
            kind: *kind,
        },
        Anchor::Free { kind } => End::Free { kind: *kind },
    })
}

/// The live edges of a chain; a chain with none is unknown.
fn chain_edges(graph: &Graph, chain: &Key) -> Result<Vec<EdgeId>, Failure> {
    let edges: Vec<EdgeId> = graph
        .faces_along_chain(chain)
        .into_iter()
        .map(|step| step.edge)
        .collect();
    if edges.is_empty() {
        return Err(Failure::Unknown(chain.clone()));
    }
    Ok(edges)
}

/// Apply one operation at `at`. The graph checks each operation before changing anything, but
/// an operation made of several graph calls (a chain retype) may stop half way; the writer
/// rolls the whole event back on any failure.
pub(super) fn apply(graph: &mut Graph, op: &Op, at: Clock) -> Result<Change, Failure> {
    let mut change = Change::default();
    match op {
        Op::AddNode {
            key,
            level,
            position,
            kind,
        } => {
            let id = graph.add_node(key.clone(), *level, *position, *kind, at)?;
            change.born.nodes.push(id);
        }
        Op::InsertEdge { spec, ends } => {
            let ends = [end(graph, &ends[0])?, end(graph, &ends[1])?];
            change = graph.insert_edge(spec.clone(), ends, at)?;
        }
        Op::SplitEdge {
            edge: key,
            point,
            node: new,
            kind,
        } => {
            let id = edge(graph, key)?;
            change = graph.split_edge(id, *point, new.clone(), *kind, at)?;
        }
        Op::RemoveEdge { edge: key, merged } => {
            let id = edge(graph, key)?;
            change = graph.remove_edge(id, at, merged.clone())?;
        }
        Op::MergeNodes { keep, gone } => {
            let (keep, gone) = (node(graph, keep)?, node(graph, gone)?);
            change = graph.merge_nodes(keep, gone, at)?;
        }
        Op::SetEdgeClass { edge: key, class } => {
            let id = edge(graph, key)?;
            graph.set_edge_class(id, *class, at)?;
        }
        Op::SetEdgeRank { edge: key, rank } => {
            let id = edge(graph, key)?;
            graph.set_edge_rank(id, *rank, at)?;
        }
        Op::SetChainClass { chain, class } => {
            for id in chain_edges(graph, chain)? {
                graph.set_edge_class(id, *class, at)?;
            }
        }
        Op::SetChainRank { chain, rank } => {
            for id in chain_edges(graph, chain)? {
                graph.set_edge_rank(id, *rank, at)?;
            }
        }
        Op::SetNodeKind { node: key, kind } => {
            let id = node(graph, key)?;
            graph.set_node_kind(id, *kind, at)?;
        }
        Op::SetFaceKind { face, kind } => {
            let id = graph
                .face_id(face)
                .ok_or_else(|| Failure::Unknown(face.clone()))?;
            graph.set_face_kind(id, *kind, at)?;
        }
    }
    Ok(change)
}
