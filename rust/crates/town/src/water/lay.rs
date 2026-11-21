//! The operations of a `CrossWater` event: the approaches, the span and its two bank nodes.

use magna_urbis_geom::Point;

use super::{Crossing, CrossingKind, GROUND, Join, far_node, near_node, tag};
use crate::armature::{Draw, Tip, chain_ops, crossings};
use crate::graph::{EdgeClass, EdgeSpec, Graph, Key, Level, NodeKind, tag as graph_tag};
use crate::journal::{Anchor, Op};

/// The operations that apply `crossing` to `graph`: for a bridge, ford or ferry, the join on the
/// chain, the near approach to the near landing, the span (a `Bridge` edge on the deck between
/// two bridge ends, or a ground street for a ford, or nothing between the two ferry landings)
/// and the far approach straight on inland, all on the crossing's chain at its rank and width;
/// for a road crossing, the road split at its two bank points and the piece between retyped to
/// `Bridge`. Keys hang from the event's key, the two banks and the chain. `None` when an approach
/// cannot be drawn against the graph.
pub fn cross_water(graph: &Graph, crossing: &Crossing) -> Option<Vec<Op>> {
    let event = crossing.event().key();
    match crossing.kind {
        CrossingKind::Road => road_ops(graph, crossing, &event),
        _ => built_ops(graph, crossing, &event),
    }
}

/// The lineage of a crossing's edges: its event, its near and far bank, its chain.
fn lineage(event: &Key, crossing: &Crossing) -> Key {
    event
        .child(
            tag::CROSSING,
            &[crossing.near_bank as u32, crossing.far_bank as u32],
        )
        .nested(tag::CHAIN, &crossing.chain)
}

/// Kind of the nodes at either end of the span.
fn end_kind(kind: CrossingKind) -> NodeKind {
    match kind {
        CrossingKind::Bridge | CrossingKind::Road => NodeKind::BridgeEnd,
        CrossingKind::Ford => NodeKind::Junction,
        CrossingKind::Ferry => NodeKind::Landing,
    }
}

fn built_ops(graph: &Graph, crossing: &Crossing, event: &Key) -> Option<Vec<Op>> {
    let base = lineage(event, crossing);
    let kind = end_kind(crossing.kind);
    let [near_at, far_at] = crossing.span;
    let mut ops = Vec::new();

    // The near landing: the join itself when the approach is empty, else a node of its own
    // reached by the approach from the join.
    let near = if crossing.near_path.is_empty() {
        match &crossing.join {
            Join::Node(node) => {
                ops.push(Op::SetNodeKind {
                    node: node.clone(),
                    kind,
                });
                node.clone()
            }
            Join::Edge(edge) => {
                ops.push(Op::SplitEdge {
                    edge: edge.clone(),
                    point: crossing.join_point,
                    node: near_node(event),
                    kind,
                });
                near_node(event)
            }
        }
    } else {
        let join = match &crossing.join {
            Join::Node(node) => node.clone(),
            Join::Edge(edge) => {
                let node = event.child(tag::JOIN, &[]);
                ops.push(Op::SplitEdge {
                    edge: edge.clone(),
                    point: crossing.join_point,
                    node: node.clone(),
                    kind: NodeKind::Junction,
                });
                node
            }
        };
        ops.push(Op::AddNode {
            key: near_node(event),
            level: GROUND,
            position: near_at,
            kind,
        });
        let hits = crossings(graph, &crossing.near_path, [true, true], false)?;
        let approach = base.child(tag::APPROACH, &[0]);
        let mut rank = 0;
        let style = approach_style(&approach, &mut rank, crossing);
        let (pieces, _) = chain_ops(
            style,
            &crossing.near_path,
            Tip::Node(join),
            Tip::Node(near_node(event)),
            &hits,
        );
        ops.extend(pieces);
        near_node(event)
    };

    ops.push(Op::AddNode {
        key: far_node(event),
        level: GROUND,
        position: far_at,
        kind,
    });
    if crossing.kind != CrossingKind::Ferry {
        let deck = [near_at, far_at];
        // A ford runs on the ground, so it may meet no other ground edge on its way; one that
        // would is laid as a bridge.
        let ford = crossing.kind == CrossingKind::Ford
            && crossings(graph, &deck, [true, true], false).is_some_and(|h| h.is_empty());
        let (level, class) = if ford {
            (GROUND, EdgeClass::Street)
        } else {
            (Level::Deck, EdgeClass::Bridge)
        };
        let mut spec = EdgeSpec::new(
            base.child(tag::SPAN, &[]),
            level,
            class,
            deck.to_vec(),
            crossing.width,
        );
        spec.rank = crossing.rank;
        spec.chain = Some(crossing.chain.clone());
        ops.push(Op::InsertEdge {
            spec,
            ends: [
                Anchor::Node { node: near },
                Anchor::Node {
                    node: far_node(event),
                },
            ],
        });
    }

    if !crossing.far_path.is_empty()
        && let Some(hits) = crossings(graph, &crossing.far_path, [true, false], false)
    {
        let approach = base.child(tag::APPROACH, &[1]);
        let mut rank = 0;
        let style = approach_style(&approach, &mut rank, crossing);
        let (pieces, _) = chain_ops(
            style,
            &crossing.far_path,
            Tip::Node(far_node(event)),
            Tip::Free(NodeKind::StreetEnd),
            &hits,
        );
        ops.extend(pieces);
    }
    Some(ops)
}

/// How an approach is drawn: a street of the crossing's chain, rank and width.
fn approach_style<'a>(event: &'a Key, rank: &'a mut u32, crossing: &Crossing) -> Draw<'a> {
    Draw {
        event,
        next_rank: rank,
        chain: Some(crossing.chain.clone()),
        class: EdgeClass::Street,
        rank: crossing.rank,
        width: crossing.width,
    }
}

/// The road split at its near and far bank points, and the piece between retyped to a bridge.
/// A piece is keyed by the stem and its end nodes in polyline order, so the middle piece's key
/// is known before the splits are applied.
fn road_ops(graph: &Graph, crossing: &Crossing, event: &Key) -> Option<Vec<Op>> {
    let Join::Edge(key) = &crossing.join else {
        return None;
    };
    let id = graph.edge_id(key)?;
    let edge = graph.edge(id);
    if !edge.life.live() {
        return None;
    }
    let [near_at, far_at] = crossing.span;
    let (near_key, far_key) = (near_node(event), far_node(event));
    let near_first = station(&edge.polyline, near_at) <= station(&edge.polyline, far_at);
    let (first, second) = if near_first {
        ((near_at, near_key), (far_at, far_key))
    } else {
        ((far_at, far_key), (near_at, near_key))
    };
    let end = graph.node(edge.nodes[1]).key.clone();
    let piece = |from: &Key, to: &Key| {
        edge.stem
            .nested(graph_tag::PIECE_FROM, from)
            .nested(graph_tag::PIECE_TO, to)
    };
    Some(vec![
        Op::SplitEdge {
            edge: key.clone(),
            point: first.0,
            node: first.1.clone(),
            kind: NodeKind::BridgeEnd,
        },
        Op::SplitEdge {
            edge: piece(&first.1, &end),
            point: second.0,
            node: second.1.clone(),
            kind: NodeKind::BridgeEnd,
        },
        Op::SetEdgeClass {
            edge: piece(&first.1, &second.1),
            class: EdgeClass::Bridge,
        },
    ])
}

/// Distance along a polyline to its point nearest `p`.
fn station(polyline: &[Point], p: Point) -> f64 {
    let mut walked = 0.0;
    let mut best = (f64::INFINITY, 0.0);
    for w in polyline.windows(2) {
        let (d, t, _) = magna_urbis_geom::distance(p, w[0], w[1]);
        let length = w[0].distance(w[1]);
        if d < best.0 {
            best = (d, walked + t * length);
        }
        walked += length;
    }
    best.1
}
