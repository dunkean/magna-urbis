//! Circuits drawn into the graph: closed loops, open lines between two points of a standing
//! circuit, and nodes seated on a drawn circuit (gates, water gates, terminal towers).

use magna_urbis_geom::{self as g, Point, Shape};

use super::clearance::densify;
use crate::armature::{Draw, Hit, Meet, Tip, chain_ops, crossings};
use crate::graph::{EdgeClass, Graph, Key, Level, NodeKind, tag};
use crate::journal::{Op, Stage};

/// A loop's first vertex must lie this far from every edge (metres), so that the loop starts on
/// a node of its own.
const START_CLEAR: f64 = 2.0;
/// A vertex lies on a standing circuit within this distance (metres), as `attach` measures.
const ON_RING: f64 = 0.5;
/// An end of an open line finds the standing circuit within this distance (metres).
const SEAT: f64 = 1.5;
/// An end of an open line takes a node of the standing circuit within this distance (metres).
const NODE_SNAP: f64 = 1.0;
/// A node seated on a circuit reuses one of its nodes within this distance (metres).
pub(super) const REUSE: f64 = 6.0;

/// A circuit line as drawn.
#[derive(Clone, Debug)]
pub struct Line {
    /// Key of its chain.
    pub chain: Key,
    /// Its crossings with the graph as it stood, ordered along `path`.
    pub hits: Vec<Hit>,
    /// The node made or met at each crossing, in the same order.
    pub nodes: Vec<Key>,
    /// The drawn line; closed (first point repeated) for a loop.
    pub path: Vec<Point>,
}

/// The node a crossing ends on: the node met, or the one the piece ending there creates.
fn crossing_nodes(event: &Key, first: u32, hits: &[Hit]) -> Vec<Key> {
    hits.iter()
        .enumerate()
        .map(|(i, hit)| match &hit.meet {
            Meet::Node(key) => key.clone(),
            Meet::Edge(_) => Key::edge(event, first + i as u32).child(tag::END, &[1]),
        })
        .collect()
}

/// How the pieces of a circuit are drawn.
#[derive(Clone, Copy, Debug)]
pub struct Stroke {
    pub class: EdgeClass,
    pub rank: u8,
    pub width: f64,
}

/// Draw the closed counter-clockwise `ring` as a loop chain, split wherever it crosses the graph.
/// The loop starts at the first vertex clear of every edge from which it can be drawn; when no
/// vertex is, at a point of one of its sides.
pub fn insert_loop(
    stage: &mut Stage,
    event: &Key,
    rank: &mut u32,
    ring: &[Point],
    stroke: Stroke,
) -> Option<Line> {
    if ring.len() < 3 {
        return None;
    }
    insert_loop_from(stage, event, rank, ring, stroke)
        .or_else(|| insert_loop_from(stage, event, rank, &densify(ring, DENSE_START), stroke))
}

/// Spacing in metres of the extra start points tried along a loop's sides.
const DENSE_START: f64 = 5.0;

fn insert_loop_from(
    stage: &mut Stage,
    event: &Key,
    rank: &mut u32,
    ring: &[Point],
    stroke: Stroke,
) -> Option<Line> {
    let n = ring.len();
    for shift in 0..n {
        let mut closed: Vec<Point> = ring[shift..]
            .iter()
            .chain(&ring[..shift])
            .copied()
            .collect();
        closed.push(closed[0]);
        let graph = stage.graph();
        if !graph
            .edges_near(Level::Ground, closed[0], START_CLEAR)
            .is_empty()
        {
            continue;
        }
        let Some(hits) = crossings(graph, &closed, [false, false], false) else {
            continue;
        };
        let first = *rank;
        let mut next = first;
        let draw = Draw {
            event,
            next_rank: &mut next,
            chain: None,
            class: stroke.class,
            rank: stroke.rank,
            width: stroke.width,
        };
        let (ops, chain) = chain_ops(
            draw,
            &closed,
            Tip::Free(NodeKind::Junction),
            Tip::Start,
            &hits,
        );
        if stage.try_push(ops).is_ok() {
            *rank = next;
            let nodes = crossing_nodes(event, first, &hits);
            return Some(Line {
                chain,
                hits,
                nodes,
                path: closed,
            });
        }
    }
    None
}

/// Draw `path` as an open chain whose two ends lie on standing circuit lines (walls or
/// precincts) of the graph, split wherever it crosses the graph between them.
pub fn insert_between(
    stage: &mut Stage,
    event: &Key,
    rank: &mut u32,
    path: &[Point],
    stroke: Stroke,
) -> Option<Line> {
    if path.len() < 2 {
        return None;
    }
    let graph = stage.graph();
    let (start, a) = seat_on_circuit(graph, path[0])?;
    let (end, b) = seat_on_circuit(graph, path[path.len() - 1])?;
    if matches!((&start, &end), (Tip::Node(x), Tip::Node(y)) if x == y) {
        return None;
    }
    let mut path = path.to_vec();
    let last = path.len() - 1;
    path[0] = a;
    path[last] = b;
    let hits = crossings(graph, &path, [true, true], false)?;
    let first = *rank;
    let mut next = first;
    let draw = Draw {
        event,
        next_rank: &mut next,
        chain: None,
        class: stroke.class,
        rank: stroke.rank,
        width: stroke.width,
    };
    let (ops, chain) = chain_ops(draw, &path, start, end, &hits);
    stage.try_push(ops).ok()?;
    *rank = next;
    let nodes = crossing_nodes(event, first, &hits);
    Some(Line {
        chain,
        hits,
        nodes,
        path,
    })
}

/// Draw `path` from the node `from` to a point on the nearest live edge accepted by `target`,
/// split wherever it crosses the graph. The path's last point is moved onto that edge; with no
/// such edge within reach the path ends on a street end of its own.
pub fn insert_to_edge(
    stage: &mut Stage,
    event: &Key,
    rank: &mut u32,
    path: &[Point],
    from: &Key,
    target: impl Fn(EdgeClass) -> bool,
    stroke: Stroke,
) -> Option<Line> {
    if path.len() < 2 {
        return None;
    }
    let graph = stage.graph();
    let last = path.len() - 1;
    let (end, b) = seat_on(graph, path[last], SEAT * 4.0, &target)
        .unwrap_or((Tip::Free(NodeKind::StreetEnd), path[last]));
    let mut path = path.to_vec();
    path[last] = b;
    let hits = crossings(graph, &path, [true, true], false)?;
    let first = *rank;
    let mut next = first;
    let draw = Draw {
        event,
        next_rank: &mut next,
        chain: None,
        class: stroke.class,
        rank: stroke.rank,
        width: stroke.width,
    };
    let (ops, chain) = chain_ops(draw, &path, Tip::Node(from.clone()), end, &hits);
    stage.try_push(ops).ok()?;
    *rank = next;
    let nodes = crossing_nodes(event, first, &hits);
    Some(Line {
        chain,
        hits,
        nodes,
        path,
    })
}

/// Where an open line's end sits on a standing circuit: its node within `NODE_SNAP`, else the
/// nearest point of its nearest wall or precinct edge within `SEAT`.
fn seat_on_circuit(graph: &Graph, p: Point) -> Option<(Tip, Point)> {
    seat_on(graph, p, SEAT, |class| {
        matches!(class, EdgeClass::Wall | EdgeClass::Precinct)
    })
}

fn seat_on(
    graph: &Graph,
    p: Point,
    radius: f64,
    target: impl Fn(EdgeClass) -> bool,
) -> Option<(Tip, Point)> {
    let (_, q, e) = graph
        .edges_near(Level::Ground, p, radius)
        .into_iter()
        .filter(|&e| target(*graph.edge(e).class.current()))
        .map(|e| {
            let (d, q) = nearest_on(&graph.edge(e).polyline, p);
            (d, q, e)
        })
        .min_by(|a, b| a.0.total_cmp(&b.0).then(a.2.cmp(&b.2)))?;
    let edge = graph.edge(e);
    for &n in &edge.nodes {
        let node = graph.node(n);
        if node.position.distance(q) < NODE_SNAP {
            return Some((Tip::Node(node.key.clone()), node.position));
        }
    }
    Some((Tip::OnEdge(edge.stem.clone()), q))
}

/// Distance from `p` to a polyline and the nearest point on it.
pub(super) fn nearest_on(polyline: &[Point], p: Point) -> (f64, Point) {
    polyline
        .windows(2)
        .map(|w| {
            let (d, _, q) = g::distance(p, w[0], w[1]);
            (d, q)
        })
        .fold(
            (f64::INFINITY, p),
            |best, x| if x.0 < best.0 { x } else { best },
        )
}

/// Distance from `p` to a closed ring.
pub(super) fn ring_distance(ring: &[Point], p: Point) -> f64 {
    let n = ring.len();
    (0..n)
        .map(|i| g::distance(p, ring[i], ring[(i + 1) % n]).0)
        .fold(f64::INFINITY, f64::min)
}

/// Whether `p` lies on the outer ring of `standing`.
pub(super) fn on_ring(standing: &Shape, p: Point) -> bool {
    ring_distance(&standing.outer, p) < ON_RING
}

/// The part of the closed `ring` off the `standing` circuit, from the last vertex on it before
/// the longest run off it to the first vertex on it after: the line a lobe or a circuit joining
/// a castle draws. `None` when the ring does not meet the standing circuit, or lies on it.
pub fn open_path(ring: &[Point], standing: &Shape) -> Option<Vec<Point>> {
    let n = ring.len();
    let on: Vec<bool> = ring.iter().map(|&p| on_ring(standing, p)).collect();
    if on.iter().all(|&x| x) || !on.iter().any(|&x| x) {
        return None;
    }
    let mut best: Option<(usize, usize)> = None;
    for k in 0..n {
        if !(on[k] && !on[(k + 1) % n]) {
            continue;
        }
        let mut m = 1;
        while !on[(k + m) % n] {
            m += 1;
        }
        if best.is_none_or(|(_, len)| m > len) {
            best = Some((k, m));
        }
    }
    let (k, m) = best?;
    Some((0..=m).map(|i| ring[(k + i) % n]).collect())
}

/// Live nodes of a chain, in the order its walk meets them.
pub(super) fn chain_nodes(graph: &Graph, chain: &Key) -> Vec<(Key, Point)> {
    let mut out: Vec<(Key, Point)> = Vec::new();
    for step in graph.faces_along_chain(chain) {
        for n in graph.edge(step.edge).nodes {
            let node = graph.node(n);
            if !out.iter().any(|(k, _)| k == &node.key) {
                out.push((node.key.clone(), node.position));
            }
        }
    }
    out
}

/// Seat a node of `kind` on the chain at each of `points`: the chain's node within `REUSE` takes
/// the kind, else the chain splits there with a node keyed `event`/`slot`/its position in
/// `points`. Returns the node of each point that could be seated.
pub fn seat_nodes(
    stage: &mut Stage,
    chain: &Key,
    points: &[Point],
    kind: NodeKind,
    event: &Key,
    slot: u32,
) -> Vec<(Key, Point)> {
    let mut out = Vec::new();
    for (i, &p) in points.iter().enumerate() {
        let graph = stage.graph();
        let near = chain_nodes(graph, chain)
            .into_iter()
            .filter(|(_, q)| q.distance(p) < REUSE)
            .min_by(|a, b| a.1.distance(p).total_cmp(&b.1.distance(p)));
        let op = match near {
            Some((key, q)) => {
                let set = Op::SetNodeKind {
                    node: key.clone(),
                    kind,
                };
                if stage.try_push(vec![set]).is_ok() {
                    out.push((key, q));
                }
                continue;
            }
            None => {
                let Some((edge, q)) = graph
                    .faces_along_chain(chain)
                    .into_iter()
                    .map(|s| {
                        let edge = graph.edge(s.edge);
                        let (d, q) = nearest_on(&edge.polyline, p);
                        (d, q, edge.key.clone())
                    })
                    .min_by(|a, b| a.0.total_cmp(&b.0))
                    .map(|(_, q, key)| (key, q))
                else {
                    continue;
                };
                let node = event.child(tag::NODE, &[slot, i as u32]);
                (
                    Op::SplitEdge {
                        edge,
                        point: q,
                        node: node.clone(),
                        kind,
                    },
                    node,
                    q,
                )
            }
        };
        let (split, node, q) = op;
        if stage.try_push(vec![split]).is_ok() {
            out.push((node, q));
        }
    }
    out
}
