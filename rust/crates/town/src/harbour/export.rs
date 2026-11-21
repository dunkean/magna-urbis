//! The harbour as classic's streets: the quay, piers, landing stages and moles with classic's
//! roles and ranks, from which core's `macroplan::harbour::platforms` builds `structure.quays`
//! and the harbour furniture and roles work unchanged.

use magna_urbis_geom::Point;

use super::{HarbourState, MOLE_RANK, PIER_RANK, QUAY_RANK, mole_chain, pier_chain, quay_chain};
use crate::graph::{Graph, Key};

/// One harbour work drawn as a classic street.
#[derive(Clone, Debug, PartialEq)]
pub struct HarbourStreet {
    /// Key of the chain the work was laid as.
    pub key: Key,
    /// Centre line.
    pub path: Vec<Point>,
    /// Width at each vertex in metres.
    pub widths: Vec<f64>,
    /// Classic's street rank: 1 for the quay, 2 for a mole, 3 for a pier or a landing stage.
    pub rank: usize,
    /// Classic's street role: `quay`, `mole`, `pier` or `landing`.
    pub role: &'static str,
}

/// Classic's role of a quay-class edge of graph rank `rank`.
pub fn work_role(rank: u8) -> &'static str {
    match rank {
        QUAY_RANK => "quay",
        MOLE_RANK => "mole",
        PIER_RANK => "pier",
        _ => "landing",
    }
}

/// Classic's street rank of a quay-class edge of graph rank `rank`.
fn classic_rank(rank: u8) -> usize {
    match rank {
        QUAY_RANK => 1,
        MOLE_RANK => 2,
        _ => 3,
    }
}

/// The harbour's works as classic streets: the quay as one line per continuous stretch (one
/// per shore, as classic lays it), then each mole and pier.
pub fn export_quays(graph: &Graph, state: &HarbourState) -> Vec<HarbourStreet> {
    let front = state.front.index;
    let mut chains = vec![
        quay_chain(front),
        mole_chain(front, 0),
        mole_chain(front, 1),
    ];
    chains.extend(state.piers.iter().map(|&k| pier_chain(front, k)));
    chains
        .iter()
        .flat_map(|chain| joined(graph, chain))
        .collect()
}

/// The live edges of `chain` joined end to end into lines, in chain order.
fn joined(graph: &Graph, chain: &Key) -> Vec<HarbourStreet> {
    let mut out: Vec<HarbourStreet> = Vec::new();
    for step in graph.faces_along_chain(chain) {
        let edge = graph.edge(step.edge);
        let rank = *edge.rank.current();
        let (mut path, mut widths) = (edge.polyline.clone(), edge.widths.clone());
        if !step.half.is_forward() {
            path.reverse();
            widths.reverse();
        }
        let role = work_role(rank);
        if let Some(last) = out.last_mut()
            && last.role == role
            && last.path.last().is_some_and(|p| p.distance(path[0]) < 1e-6)
        {
            last.path.extend_from_slice(&path[1..]);
            last.widths.extend_from_slice(&widths[1..]);
            continue;
        }
        out.push(HarbourStreet {
            key: chain.clone(),
            path,
            widths,
            rank: classic_rank(rank),
            role,
        });
    }
    out
}
