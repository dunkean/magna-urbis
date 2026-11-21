//! A ring's sectors: the faces its boundary arcs enclose, with their stations and frozen outlines.

use std::collections::{BTreeMap, BTreeSet};

use magna_urbis_geom::{Shape, area, interior_point};

use crate::graph::{EdgeClass, EdgeId, FaceId, Graph, HalfId, Key, Level, Station};
use crate::journal::Op;
use crate::survey::CostField;

/// Faces smaller than this are not opened (square metres).
const MIN_AREA: f64 = 1.0;

/// Land enclosed by a ring, to be opened as one quarter.
#[derive(Clone, Debug)]
pub(super) struct Sector {
    /// Where the quarter hangs on the armature.
    pub station: Station,
    /// Key of the face as the ring's armature left it.
    pub face: Key,
    /// Its outline then.
    pub outline: Shape,
    /// Keys of the edges bounding it then, in key order.
    pub outline_edges: Vec<Key>,
    /// Cost of its interior point in the ring's frozen cost field (effective metres).
    pub cost: f64,
}

/// The sectors of a ring, in station order, read from the graph just after the ring's
/// `ExtendArmature` event, whose operations are `ops`. A sector is a face on the left of one of
/// the ring's boundary arcs. Its station is the first node of its arc piece of smallest key and
/// the rank of that piece among the node's arms: the same whatever order the ring is computed in.
pub(super) fn of_ring(graph: &Graph, ops: &[Op], costs: &CostField) -> Vec<Sector> {
    let chains: BTreeSet<&Key> = ops
        .iter()
        .filter_map(|op| match op {
            Op::InsertEdge { spec, .. } if spec.class == EdgeClass::Boundary => spec.chain.as_ref(),
            _ => None,
        })
        .collect();
    let outside = graph.outside(Level::Ground);
    let mut faces: BTreeMap<FaceId, EdgeId> = BTreeMap::new();
    for chain in chains {
        for step in graph.faces_along_chain(chain) {
            let face = graph.left_face(step.edge);
            if face == outside {
                continue;
            }
            let key = &graph.edge(step.edge).key;
            faces
                .entry(face)
                .and_modify(|best| {
                    if key < &graph.edge(*best).key {
                        *best = step.edge;
                    }
                })
                .or_insert(step.edge);
        }
    }
    let mut sectors: Vec<Sector> = faces
        .into_iter()
        .filter_map(|(face, piece)| {
            let outline = graph.outline(face)?;
            if area(&outline) < MIN_AREA {
                return None;
            }
            let host = graph.edge(piece).nodes[0];
            let arm = graph
                .arms(host, Level::Ground)
                .iter()
                .position(|&h| h == HalfId::forward(piece))? as u32;
            let mut outline_edges: Vec<Key> = graph
                .walks(face)
                .into_iter()
                .flatten()
                .map(|h| graph.edge(h.edge()).key.clone())
                .collect();
            outline_edges.sort();
            outline_edges.dedup();
            Some(Sector {
                station: Station {
                    host: graph.node(host).key.clone(),
                    arm,
                },
                face: graph.face(face).key.clone(),
                cost: costs.cost_at(interior_point(&outline)),
                outline,
                outline_edges,
            })
        })
        .collect();
    sectors.sort_by(|a, b| a.station.cmp(&b.station));
    sectors
}
