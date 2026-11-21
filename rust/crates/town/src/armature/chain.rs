//! Polylines inserted as chains of edges, split wherever they meet the graph.
//!
//! The graph takes an edge only if it touches other edges at its end nodes. A long line (a
//! regional road, a boundary arc, a main axis) is therefore found against the live edges of its
//! level first: every crossing becomes a node, on the crossed edge or at one of its nodes, and
//! the line is inserted as pieces between consecutive crossings, each piece starting at the node
//! the previous one made.

use magna_urbis_geom::Point;

use crate::RoadSource;
use crate::graph::{EdgeClass, EdgeId, EdgeSpec, Graph, Key, Level, NodeKind, tag};
use crate::journal::{Anchor, Op};

/// Shortest distance between two crossings along a line, or between a crossing and a line end,
/// in metres. Closer crossings would leave a piece too short to draw or to name.
pub const MIN_GAP: f64 = 0.5;
/// A crossing within this distance of an end node of the crossed edge takes that node (metres).
pub const NODE_JOIN: f64 = 0.5;
/// Contacts at a line end within this distance belong to the end's own node or edge (metres).
const END_CLEAR: f64 = 1e-3;
/// Tolerance of a contact between two segments (metres), the graph's own.
const TOUCH: f64 = 1e-7;

/// Where a chain end sits.
#[derive(Clone, Debug, PartialEq)]
pub enum Tip {
    /// On an existing node, at its position.
    Node(Key),
    /// On an existing edge, named by its stem; the edge splits there.
    OnEdge(Key),
    /// At a new node of this kind.
    Free(NodeKind),
    /// On the node the chain started from, closing a loop.
    Start,
}

/// What a crossing meets.
#[derive(Clone, Debug, PartialEq)]
pub enum Meet {
    /// An existing node.
    Node(Key),
    /// An existing edge, by stem.
    Edge(Key),
}

/// A point where a line meets a live edge.
#[derive(Clone, Debug)]
pub struct Hit {
    /// Distance along the line in metres.
    pub along: f64,
    /// Segment of the line the point lies on.
    pub segment: usize,
    /// The meeting point (the node's position when it meets a node).
    pub point: Point,
    /// What the line meets there.
    pub meet: Meet,
    /// The live edge met.
    pub edge: EdgeId,
}

impl Hit {
    /// The tip of a chain that ends at this crossing.
    pub fn tip(&self) -> Tip {
        match &self.meet {
            Meet::Node(key) => Tip::Node(key.clone()),
            Meet::Edge(stem) => Tip::OnEdge(stem.clone()),
        }
    }
}

/// How the pieces of a chain are drawn and named.
pub struct Draw<'a> {
    /// Key of the event that inserts the chain: piece keys are its edge keys.
    pub event: &'a Key,
    /// Rank of the next edge in that event, advanced by every piece.
    pub next_rank: &'a mut u32,
    /// Chain key; the key of the first piece when `None`.
    pub chain: Option<Key>,
    /// Class of every piece.
    pub class: EdgeClass,
    /// Rank of every piece.
    pub rank: u8,
    /// Drawn width in metres.
    pub width: f64,
}

/// Every contact of `path` with live ground edges, ordered along it, contacts at a node merged.
/// Contacts within `END_CLEAR` of an end flagged in `clear` are left out: they are that end's
/// own node or edge. Where the line runs along an edge, both ends of the shared stretch are
/// contacts when `overlaps` is set, and the line is refused otherwise. `None` when the line is
/// refused or two contacts are closer than `MIN_GAP`.
pub fn crossings(
    graph: &Graph,
    path: &[Point],
    clear: [bool; 2],
    overlaps: bool,
) -> Option<Vec<Hit>> {
    let total: f64 = path.windows(2).map(|w| w[0].distance(w[1])).sum();
    let mut out = Vec::new();
    let mut walked = 0.0;
    for (segment, w) in path.windows(2).enumerate() {
        let (a, b) = (w[0], w[1]);
        let length = a.distance(b);
        for e in graph.edges_crossing(Level::Ground, a, b) {
            let edge = graph.edge(e);
            for s in edge.polyline.windows(2) {
                let found: Vec<(f64, Point)> = match meet(a, b, s[0], s[1]) {
                    Contact::Clear => continue,
                    Contact::Point(t, p) => vec![(t, p)],
                    Contact::Overlap(ends) if overlaps => ends.to_vec(),
                    Contact::Overlap(_) => return None,
                };
                for (t, p) in found {
                    let along = walked + t * length;
                    let cleared =
                        (clear[0] && along < END_CLEAR) || (clear[1] && along > total - END_CLEAR);
                    if !cleared {
                        out.push(hit_on(graph, e, along, segment, p));
                    }
                }
            }
        }
        walked += length;
    }
    out.sort_by(|x, y| x.along.total_cmp(&y.along));
    let mut merged: Vec<Hit> = Vec::with_capacity(out.len());
    for hit in out {
        if let Some(last) = merged.last()
            && hit.along - last.along < MIN_GAP
        {
            let same = match (&last.meet, &hit.meet) {
                (Meet::Node(a), Meet::Node(b)) => a == b,
                (Meet::Edge(a), Meet::Edge(b)) => a == b && last.point.distance(hit.point) < 1e-6,
                _ => false,
            };
            if same {
                continue;
            }
            return None;
        }
        merged.push(hit);
    }
    if merged
        .iter()
        .any(|h| h.along < MIN_GAP || total - h.along < MIN_GAP)
    {
        return None;
    }
    Some(merged)
}

/// A contact at `p` with edge `e`: at the edge's end node when one is within `NODE_JOIN`.
fn hit_on(graph: &Graph, e: EdgeId, along: f64, segment: usize, p: Point) -> Hit {
    let edge = graph.edge(e);
    let near = edge
        .nodes
        .iter()
        .map(|&n| graph.node(n))
        .filter(|n| n.position.distance(p) <= NODE_JOIN)
        .min_by(|x, y| x.position.distance(p).total_cmp(&y.position.distance(p)));
    let (point, meet) = match near {
        Some(node) => (node.position, Meet::Node(node.key.clone())),
        None => (p, Meet::Edge(edge.stem.clone())),
    };
    Hit {
        along,
        segment,
        point,
        meet,
        edge: e,
    }
}

/// Operations inserting `path` from `start` to `end`, split at `hits` (from [`crossings`] on the
/// same path and graph), and the chain key. A loop with no crossing (`Free` start, `Start` end)
/// is split at its middle vertex, since an edge cannot end where it starts.
pub fn chain_ops(
    draw: Draw<'_>,
    path: &[Point],
    start: Tip,
    end: Tip,
    hits: &[Hit],
) -> (Vec<Op>, Key) {
    chain_ops_with_source(draw, path, start, end, hits, None)
}

pub(super) fn chain_ops_with_source(
    draw: Draw<'_>,
    path: &[Point],
    start: Tip,
    end: Tip,
    hits: &[Hit],
    source: Option<(&str, &[f64])>,
) -> (Vec<Op>, Key) {
    // The drawn line with the crossings as vertices; `stops` mark where pieces end.
    let mut points: Vec<Point> = vec![path[0]];
    let mut stations = source.map(|(_, stations)| vec![stations[0]]);
    let mut stops: Vec<(usize, Option<&Meet>)> = Vec::with_capacity(hits.len());
    let mut k = 0;
    let mut walked = 0.0;
    for i in 0..path.len() - 1 {
        let length = if source.is_some() { path[i].distance(path[i + 1]) } else { 0.0 };
        while k < hits.len() && hits[k].segment == i {
            let hit = &hits[k];
            let p = hit.point;
            let last = points.len() - 1;
            let station = source.map(|(_, values)| {
                let t = if length > 0.0 { ((hit.along - walked) / length).clamp(0.0, 1.0) } else { 0.0 };
                values[i] + (values[i + 1] - values[i]) * t
            });
            if points[last].distance(p) < 1e-9 && last > 0 {
                points[last] = p;
                if let Some((stations, station)) = stations.as_mut().zip(station) {
                    stations[last] = station;
                }
            } else {
                points.push(p);
                if let Some((stations, station)) = stations.as_mut().zip(station) {
                    stations.push(station);
                }
            }
            stops.push((points.len() - 1, Some(&hit.meet)));
            k += 1;
        }
        let next = path[i + 1];
        if points[points.len() - 1].distance(next) > 1e-9 {
            points.push(next);
            if let Some((stations, (_, values))) = stations.as_mut().zip(source) {
                stations.push(values[i + 1]);
            }
        }
        walked += length;
    }
    let last = points.len() - 1;
    if stops.is_empty() && matches!(start, Tip::Free(_)) && end == Tip::Start && last >= 2 {
        stops.push((last / 2, None));
    }
    let mut bounds: Vec<usize> = vec![0];
    bounds.extend(stops.iter().map(|s| s.0));
    bounds.push(last);

    let first = Key::edge(draw.event, *draw.next_rank);
    let chain = draw.chain.clone().unwrap_or_else(|| first.clone());
    let start_node = match &start {
        Tip::Node(node) => node.clone(),
        _ => first.child(tag::END, &[0]),
    };
    let mut ops = Vec::with_capacity(bounds.len() - 1);
    let mut keys: Vec<Key> = Vec::with_capacity(bounds.len() - 1);
    for piece in 0..bounds.len() - 1 {
        let key = Key::edge(draw.event, *draw.next_rank);
        *draw.next_rank += 1;
        let from = if piece == 0 {
            match &start {
                Tip::Node(node) => Anchor::Node { node: node.clone() },
                Tip::OnEdge(edge) => Anchor::OnEdge {
                    edge: edge.clone(),
                    kind: NodeKind::Junction,
                },
                Tip::Free(kind) => Anchor::Free { kind: *kind },
                Tip::Start => Anchor::Free {
                    kind: NodeKind::Junction,
                },
            }
        } else {
            match stops[piece - 1].1 {
                Some(Meet::Node(node)) => Anchor::Node { node: node.clone() },
                _ => Anchor::Node {
                    node: keys[piece - 1].child(tag::END, &[1]),
                },
            }
        };
        let to = if piece + 1 < bounds.len() - 1 {
            match stops[piece].1 {
                Some(Meet::Node(node)) => Anchor::Node { node: node.clone() },
                Some(Meet::Edge(edge)) => Anchor::OnEdge {
                    edge: edge.clone(),
                    kind: NodeKind::Junction,
                },
                None => Anchor::Free {
                    kind: NodeKind::Junction,
                },
            }
        } else {
            match &end {
                Tip::Node(node) => Anchor::Node { node: node.clone() },
                Tip::OnEdge(edge) => Anchor::OnEdge {
                    edge: edge.clone(),
                    kind: NodeKind::Junction,
                },
                Tip::Free(kind) => Anchor::Free { kind: *kind },
                Tip::Start => Anchor::Node {
                    node: start_node.clone(),
                },
            }
        };
        let polyline = points[bounds[piece]..=bounds[piece + 1]].to_vec();
        let widths = vec![draw.width; polyline.len()];
        let road_source = stations.as_ref().zip(source).map(|(stations, (id, _))| RoadSource {
            id: id.to_owned(),
            stations: stations[bounds[piece]..=bounds[piece + 1]].to_vec(),
        });
        let spec = EdgeSpec {
            key: key.clone(),
            level: Level::Ground,
            class: draw.class,
            rank: draw.rank,
            polyline,
            widths,
            owner: None,
            chain: Some(chain.clone()),
            road_source,
            face_names: None,
        };
        ops.push(Op::InsertEdge {
            spec,
            ends: [from, to],
        });
        keys.push(key);
    }
    (ops, chain)
}

/// How two segments meet, points given with their share `t` along the first.
enum Contact {
    Clear,
    Point(f64, Point),
    /// Along a stretch, from its start to its end on the first segment.
    Overlap([(f64, Point); 2]),
}

/// Where segments `ab` and `cd` meet, within `TOUCH` (the graph's own test, with shares).
fn meet(a: Point, b: Point, c: Point, d: Point) -> Contact {
    let (lab, lcd) = (a.distance(b), c.distance(d));
    if lab < TOUCH || lcd < TOUCH {
        return Contact::Clear;
    }
    let cross =
        |o: Point, p: Point, q: Point| (p.x - o.x) * (q.y - o.y) - (p.y - o.y) * (q.x - o.x);
    let lerp = |t: f64| Point {
        x: a.x + (b.x - a.x) * t,
        y: a.y + (b.y - a.y) * t,
    };
    // Signed distances of each end from the other segment's line.
    let (d1, d2) = (cross(c, d, a) / lcd, cross(c, d, b) / lcd);
    let (d3, d4) = (cross(a, b, c) / lab, cross(a, b, d) / lab);
    let along = |p: Point| ((p.x - a.x) * (b.x - a.x) + (p.y - a.y) * (b.y - a.y)) / lab;
    if d1.abs() < TOUCH && d2.abs() < TOUCH {
        let (tc, td) = (along(c), along(d));
        let (lo, hi) = (tc.min(td).max(0.0), tc.max(td).min(lab));
        if hi - lo > TOUCH {
            let (t0, t1) = (lo / lab, hi / lab);
            return Contact::Overlap([(t0, lerp(t0)), (t1, lerp(t1))]);
        }
        if hi - lo < -TOUCH {
            return Contact::Clear;
        }
        let t = (0.5 * (lo + hi) / lab).clamp(0.0, 1.0);
        return Contact::Point(t, lerp(t));
    }
    let apart = |u: f64, v: f64| (u > TOUCH && v < -TOUCH) || (u < -TOUCH && v > TOUCH);
    if apart(d1, d2) && apart(d3, d4) {
        let t = d1 / (d1 - d2);
        return Contact::Point(t, lerp(t));
    }
    let within = |p: Point, q: Point, r: Point| {
        let len = p.distance(q);
        let s = ((r.x - p.x) * (q.x - p.x) + (r.y - p.y) * (q.y - p.y)) / len;
        (-TOUCH..=len + TOUCH).contains(&s)
    };
    if d1.abs() < TOUCH && within(c, d, a) {
        Contact::Point(0.0, a)
    } else if d2.abs() < TOUCH && within(c, d, b) {
        Contact::Point(1.0, b)
    } else if d3.abs() < TOUCH && within(a, b, c) {
        Contact::Point((along(c) / lab).clamp(0.0, 1.0), c)
    } else if d4.abs() < TOUCH && within(a, b, d) {
        Contact::Point((along(d) / lab).clamp(0.0, 1.0), d)
    } else {
        Contact::Clear
    }
}
