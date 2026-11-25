//! Read-only street incidence with ground and deck arms at shared landings.
//! It requires only nodes, edges and chains. All handles are local to one
//! snapshot.

use crate::{EdgeId, HalfId, Level, NodeId};
use magna_urbis_geom::Point;

#[derive(Debug)]
pub struct StreetNode {
    pub point: Point,
    /// Whether a deck terminates here, permitting a transition to ground.
    pub bridge_landing: bool,
    /// Outgoing arms sorted by tangent angle, then by handle.
    pub arms: Vec<HalfId>,
}

#[derive(Debug)]
pub struct StreetEdge {
    pub ends: [NodeId; 2],
    /// Samples strictly between the two endpoints, in drawn order.
    pub shape: Vec<Point>,
    /// Width at each sample, including the two endpoints.
    pub widths: Vec<f64>,
    /// Index in the snapshot's chain table.
    pub chain: usize,
}

#[derive(Debug)]
pub struct StreetChain {
    /// Index in the input street slice, and the surviving piece within it.
    pub source: usize,
    pub piece: u32,
    pub rank: usize,
    pub role: String,
    pub level: Level,
    /// Edge handles in drawn order, each traversed forward.
    pub edges: Vec<EdgeId>,
}

#[derive(Debug)]
pub struct StreetTopology {
    nodes: Vec<StreetNode>,
    edges: Vec<StreetEdge>,
    chains: Vec<StreetChain>,
}

impl StreetTopology {
    /// Construct from an already noded graph. The input must have valid node
    /// and chain handles and carry one width per sample.
    pub fn from_noded(positions: Vec<(Point, bool)>, edges: Vec<StreetEdge>, chains: Vec<StreetChain>) -> Self {
        let mut nodes: Vec<_> = positions
            .into_iter()
            .map(|(point, bridge_landing)| StreetNode { point, bridge_landing, arms: Vec::new() })
            .collect();
        for (i, edge) in edges.iter().enumerate() {
            let id = EdgeId(i as u32);
            nodes[edge.ends[0].ix()].arms.push(HalfId::forward(id));
            nodes[edge.ends[1].ix()].arms.push(HalfId::backward(id));
        }
        let angle = |arm: HalfId| {
            let edge = &edges[arm.edge().ix()];
            let end = usize::from(!arm.is_forward());
            let origin = nodes[edge.ends[end].ix()].point;
            let other = nodes[edge.ends[1 - end].ix()].point;
            let sample = if arm.is_forward() {
                edge.shape.iter().copied().find(|&p| p != origin)
            } else {
                edge.shape.iter().rev().copied().find(|&p| p != origin)
            }
            .unwrap_or(other);
            (sample.y - origin.y).atan2(sample.x - origin.x)
        };
        // Compute tangents from the positions before borrowing the arm lists mutably.
        let angles: Vec<_> = (0..edges.len() * 2).map(|i| angle(HalfId(i as u32))).collect();
        for node in &mut nodes {
            node.arms.sort_unstable_by(|a, b| angles[a.ix()].total_cmp(&angles[b.ix()]).then_with(|| a.cmp(b)));
        }
        Self { nodes, edges, chains }
    }

    pub fn nodes(&self) -> &[StreetNode] {
        &self.nodes
    }

    pub fn edges(&self) -> &[StreetEdge] {
        &self.edges
    }

    pub fn chains(&self) -> &[StreetChain] {
        &self.chains
    }

    /// Whether two outgoing arms at a junction meet topologically. This only
    /// checks level transitions. The role remains available for travel rules.
    pub fn connects(&self, a: HalfId, b: HalfId) -> bool {
        let port = |arm: HalfId| {
            let edge = &self.edges[arm.edge().ix()];
            (edge.ends[usize::from(!arm.is_forward())], self.chains[edge.chain].level)
        };
        let ((node, a), (other, b)) = (port(a), port(b));
        node == other
            && (a == b
                || (self.nodes[node.ix()].bridge_landing
                    && matches!((a, b), (Level::Ground, Level::Deck) | (Level::Deck, Level::Ground))))
    }
}
