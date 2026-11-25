use super::{Street, StreetGraph, key};
use magna_urbis_graph::street_topology::{StreetChain, StreetEdge};
use magna_urbis_graph::{EdgeId, Level, NodeId};

pub use magna_urbis_graph::street_topology::StreetTopology;

/// Explicitly run the street cleaner's noding and overlap resolution on a
/// street slice, then capture junction incidence, widths and directed chains.
///
/// Uses the same candidate search as the production cleaner with the supplied
/// town radius (metres). This snapshot stops before loose-end seating,
/// grade-aware surface checks and later cleaning passes. Call it on finalized
/// layout streets to inspect that network. Only explicit bridge roles supply
/// deck levels because street records do not encode a general elevation port.
/// Node and edge handles are scoped to the returned snapshot.
#[must_use]
pub fn street_topology(streets: &[Street], radius: f64) -> StreetTopology {
    let graph = StreetGraph::load(streets, radius);
    let mut positions: Vec<_> = graph.nodes.into_iter().map(|node| (node.p, false)).collect();
    let edges = graph
        .edges
        .into_iter()
        .map(|edge| {
            let chain = &graph.chains[edge.chain as usize];
            if chain.level == 1 {
                let path = &streets[chain.source as usize].path;
                let ends = [key(path[0]), key(path[path.len() - 1])];
                for node in edge.ends {
                    let (point, landing) = &mut positions[node as usize];
                    *landing |= ends.contains(&key(*point));
                }
            }
            StreetEdge { ends: edge.ends.map(NodeId), shape: edge.shape, widths: edge.widths, chain: edge.chain as usize }
        })
        .collect();
    let chains = graph
        .chains
        .into_iter()
        .map(|chain| StreetChain {
            source: chain.source as usize,
            piece: chain.piece,
            rank: chain.rank,
            role: chain.role,
            level: if chain.level == 1 { Level::Deck } else { Level::Ground },
            edges: chain.edges.into_iter().map(EdgeId).collect(),
        })
        .collect();
    StreetTopology::from_noded(positions, edges, chains)
}
