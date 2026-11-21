//! Dated changes to regional roads and their connections at the town limit.
//!
//! # Integration
//!
//! In `Found`, replace the plain-polyline road import with
//! [`import_regional_roads`](self::import_regional_roads), passing the founding stage and key,
//! `request.regional_roads`, the survey centre, growth reach and regional road width. Pass
//! the roads' point arrays to `armature::plan_arms` and other geometric consumers.
//! Convert the growth fixtures with `RegionalRoad::from_polyline`. Add `road_source: None`
//! to the `EdgeSpec` literal in `journal::draft::ops_for_draft`.
//!
//! At design 3.2 step 5, after promotions and before harbour, wall and water events, call
//! `road_fates(writer.graph(), &active_phase.spec, &charter, clock)`. Do this also in the
//! founding phase and after opening new sectors without a promotion: the entries follow
//! the town limit. Pass the result to `group_road_fates` against the same graph. Apply each
//! returned group as a `RetypeChain` event at this clock, with the returned chain key,
//! the next journal step for that chain (starting at 0), and `class: None, rank: None`
//! because the operations specify the changes stretch by stretch.
//!
//! Planned frames can reuse a regional alignment as a grid axis. Treat `GridAxis` as a
//! main street axis in armature queries and export it with the local street role in
//! `town_adapter::layout::street`.
//!
//! At finish, call `road_result(&graph)`, store a nonempty result in
//! `TownPlan::regional_road_result`, and use `None` when it is empty. The core adapter
//! copies it to `Layout::regional_road_result` in `town_adapter::layout::build`, serialized
//! as `regionalRoadResult` only when present. Use `None` for the capacity probe layout and
//! the adapter's `TownPlan` fixture. The page and regional network match IDs using
//! `regionalSegmentId(index)` from `urbanRoads.ts` against the input snapshot and use the
//! station intervals to update regional connectivity.

mod regional;
#[cfg(test)]
mod tests;

use std::collections::{BTreeMap, BTreeSet, HashMap, HashSet};

pub use regional::import_regional_roads;

use super::in_town;
use crate::charter::Charter;
use crate::export::RoadResult;
use crate::graph::{
    Clock, EdgeClass, EdgeId, FaceId, FaceKind, Graph, Key, Level, NodeId, NodeKind,
};
use crate::journal::{EventKind, Op};
use crate::spec::{PhaseSpec, RoadFate, TownForm};

/// Update source stretches and the entry nodes at the current graph's clock.
pub fn road_fates(
    graph: &Graph,
    phase_spec: &PhaseSpec,
    charter: &Charter,
    clock: Clock,
) -> Vec<Op> {
    let fate = match charter.form {
        TownForm::Grown => phase_spec.road_fate,
        TownForm::Planned { .. } => phase_spec.planned_road_fate,
    };
    let mut faces = HashMap::new();
    let roads = road_pieces(graph, &mut faces);
    if roads.is_empty() {
        return Vec::new();
    }
    let core = if fate == RoadFate::Demoted {
        oldest_ring(graph)
    } else {
        HashSet::new()
    };
    let mut entries = BTreeSet::new();
    let mut road_nodes = BTreeSet::new();
    let mut ops = Vec::new();
    for pieces in roads.values() {
        entries.extend(
            entry_nodes(graph, pieces, &mut faces)
                .into_iter()
                .map(|(_, node)| node),
        );
        for piece in pieces {
            let edge = graph.edge(piece.edge);
            road_nodes.extend(edge.nodes);
            if !piece.inside || fate == RoadFate::Kept {
                continue;
            }
            let (Some(&class), Some(&rank)) = (edge.class.at(clock), edge.rank.at(clock)) else {
                continue;
            };
            // Only the imported road and its earlier fates are owned by this policy.
            if !matches!(
                class,
                EdgeClass::RegionalRoad | EdgeClass::GridAxis | EdgeClass::Street
            ) {
                continue;
            }
            let (wanted_class, wanted_rank) = match fate {
                RoadFate::Kept => continue,
                RoadFate::Absorbed => (EdgeClass::GridAxis, rank.min(1)),
                RoadFate::Demoted
                    if borders(graph, piece.edge).iter().any(|f| core.contains(f)) =>
                {
                    (EdgeClass::Street, 2)
                }
                RoadFate::Demoted | RoadFate::Ended => (EdgeClass::Street, rank),
            };
            if class != wanted_class {
                ops.push(Op::SetEdgeClass {
                    edge: edge.key.clone(),
                    class: wanted_class,
                });
            }
            if rank != wanted_rank {
                ops.push(Op::SetEdgeRank {
                    edge: edge.key.clone(),
                    rank: wanted_rank,
                });
            }
        }
    }
    for id in road_nodes {
        let node = graph.node(id);
        let Some(&kind) = node.kind.at(clock) else {
            continue;
        };
        let wanted = if entries.contains(&id) {
            match kind {
                NodeKind::Junction | NodeKind::StreetEnd | NodeKind::DeadEnd => NodeKind::TownEntry,
                _ => kind,
            }
        } else if kind == NodeKind::TownEntry {
            if graph.arms(id, Level::Ground).len() > 1 {
                NodeKind::Junction
            } else {
                NodeKind::StreetEnd
            }
        } else {
            kind
        };
        if kind != wanted {
            ops.push(Op::SetNodeKind {
                node: node.key.clone(),
                kind: wanted,
            });
        }
    }
    ops
}

/// Assign the output of `road_fates` to the chains that own its `RetypeChain` events.
/// A shared entry node belongs to the first incident source chain in lineage order.
pub fn group_road_fates(graph: &Graph, ops: Vec<Op>) -> BTreeMap<Key, Vec<Op>> {
    let mut grouped: BTreeMap<Key, Vec<Op>> = BTreeMap::new();
    for op in ops {
        let chain = match &op {
            Op::SetEdgeClass { edge, .. } | Op::SetEdgeRank { edge, .. } => graph
                .edge_id(edge)
                .and_then(|id| graph.edge(id).chain.as_ref()),
            Op::SetNodeKind { node, .. } => graph.node_id(node).and_then(|id| {
                graph
                    .arms(id, Level::Ground)
                    .into_iter()
                    .map(|half| graph.edge(half.edge()))
                    .filter(|edge| edge.road_source.is_some())
                    .filter_map(|edge| edge.chain.as_ref())
                    .min()
            }),
            _ => None,
        };
        if let Some(chain) = chain {
            grouped.entry(chain.clone()).or_default().push(op);
        }
    }
    grouped
}

/// Export only the part of each source segment in the town.
pub fn road_result(graph: &Graph) -> Vec<RoadResult> {
    let mut faces = HashMap::new();
    road_pieces(graph, &mut faces)
        .into_iter()
        .filter_map(|(id, pieces)| {
            let mut kept = Vec::new();
            let mut ended = Vec::new();
            for piece in pieces.iter().filter(|piece| piece.inside) {
                let intervals = if *graph.edge(piece.edge).class.current() == EdgeClass::Street {
                    &mut ended
                } else {
                    &mut kept
                };
                if piece.interval.0 < piece.interval.1 {
                    intervals.push(piece.interval);
                }
            }
            if kept.is_empty() && ended.is_empty() {
                return None;
            }
            let entries = entry_nodes(graph, &pieces, &mut faces)
                .into_iter()
                .map(|(_, node)| graph.node(node).position)
                .collect();
            Some(RoadResult {
                id: id.to_owned(),
                entries,
                kept: merge(kept),
                ended: merge(ended),
            })
        })
        .collect()
}

struct RoadPiece {
    edge: EdgeId,
    interval: (f64, f64),
    inside: bool,
}

fn borders(graph: &Graph, edge: EdgeId) -> [FaceId; 2] {
    [graph.left_face(edge), graph.right_face(edge)]
}

fn town_face(graph: &Graph, cache: &mut HashMap<FaceId, bool>, face: FaceId) -> bool {
    *cache.entry(face).or_insert_with(|| {
        matches!(
            graph.face(face).kind.current(),
            FaceKind::Plaza | FaceKind::Apron | FaceKind::Bailey
        ) || in_town(graph, face)
    })
}

fn road_pieces<'a>(
    graph: &'a Graph,
    faces: &mut HashMap<FaceId, bool>,
) -> BTreeMap<&'a str, Vec<RoadPiece>> {
    let mut roads: BTreeMap<&str, Vec<RoadPiece>> = BTreeMap::new();
    for id in graph.live_edges() {
        let edge = graph.edge(id);
        let Some(source) = &edge.road_source else {
            continue;
        };
        if edge.level != Level::Ground {
            continue;
        }
        let interval = (
            source.stations[0],
            source.stations[source.stations.len() - 1],
        );
        let inside = borders(graph, id)
            .into_iter()
            .any(|face| town_face(graph, faces, face));
        roads.entry(&source.id).or_default().push(RoadPiece {
            edge: id,
            interval,
            inside,
        });
    }
    roads
}

fn entry_nodes(
    graph: &Graph,
    pieces: &[RoadPiece],
    faces: &mut HashMap<FaceId, bool>,
) -> Vec<(f64, NodeId)> {
    let mut inside: BTreeMap<NodeId, (f64, usize)> = BTreeMap::new();
    let mut outside = HashSet::new();
    for piece in pieces {
        let [a, b] = graph.edge(piece.edge).nodes;
        if !piece.inside {
            outside.extend([a, b]);
            continue;
        }
        for (node, station) in [(a, piece.interval.0), (b, piece.interval.1)] {
            inside
                .entry(node)
                .and_modify(|(first_station, degree)| {
                    *first_station = first_station.min(station);
                    *degree += 1;
                })
                .or_insert((station, 1));
        }
    }
    // A road may end at a junction of the regional network at the town limit.
    // Looking at all arms also finds entries with no continuation on this source segment.
    let mut entries: Vec<_> = inside
        .into_iter()
        .filter(|&(node, (_, degree))| {
            outside.contains(&node)
                || (degree == 1
                    && graph
                        .arms(node, Level::Ground)
                        .into_iter()
                        .any(|half| !town_face(graph, faces, graph.half(half).face)))
        })
        .map(|(node, (station, _))| (station, node))
        .collect();
    entries.sort_by(|a, b| {
        a.0.total_cmp(&b.0)
            .then_with(|| graph.node(a.1).key.cmp(&graph.node(b.1).key))
    });
    entries
}

/// The oldest boundary's left faces and everything reachable from them across internal edges.
fn oldest_ring(graph: &Graph) -> HashSet<FaceId> {
    let mut rings: BTreeMap<u32, HashSet<EdgeId>> = BTreeMap::new();
    for id in graph.live_edges() {
        let edge = graph.edge(id);
        let Some(original) = graph.edge_id(&edge.stem).map(|e| graph.edge(e)) else {
            continue;
        };
        if original.class.at(original.life.born) != Some(&EdgeClass::Boundary) {
            continue;
        }
        let Some(&ring) = edge.stem.parts().get(3) else {
            continue;
        };
        if edge
            .stem
            .parts()
            .starts_with((EventKind::ExtendArmature { ring }).key().parts())
        {
            rings.entry(ring).or_default().insert(id);
        }
    }
    let Some((_, boundary)) = rings.first_key_value() else {
        return HashSet::new();
    };
    let mut cache = HashMap::new();
    let mut pending: Vec<_> = boundary.iter().map(|&edge| graph.left_face(edge)).collect();
    let mut inside = HashSet::new();
    while let Some(face) = pending.pop() {
        if !town_face(graph, &mut cache, face) || !inside.insert(face) {
            continue;
        }
        for half in graph.walks(face).into_iter().flatten() {
            if !boundary.contains(&half.edge()) {
                pending.push(graph.half(half.twin()).face);
            }
        }
    }
    inside
}

fn merge(mut intervals: Vec<(f64, f64)>) -> Vec<(f64, f64)> {
    intervals.sort_by(|a, b| a.0.total_cmp(&b.0).then(a.1.total_cmp(&b.1)));
    let mut merged: Vec<(f64, f64)> = Vec::new();
    for (from, to) in intervals {
        if let Some(last) = merged.last_mut()
            && from <= last.1
        {
            last.1 = last.1.max(to);
        } else {
            merged.push((from, to));
        }
    }
    merged
}
