//! Tissue drafts turned into graph operations, and the canonical commit of parallel drafts.

use std::collections::HashSet;

use magna_urbis_geom::{Point, distance};

use super::{Anchor, EventKind, JournalError, Op, Writer};
use crate::graph::{
    Clock, EdgeClass, EdgeSpec, Graph, Key, Level, MIN_PIECE, NodeKind, Station, tag,
};
use crate::tissue::TissueDraft;

/// Largest gap between a draft street end and the edge it sits on (metres).
const SEAT: f64 = MIN_PIECE;
/// Largest gap between a draft street end and the node it takes (metres). An end farther from
/// every node than this sits on its edge at least `MIN_PIECE` from the edge's nodes, so the
/// split it makes is never refused as too close to a node.
const NODE_SEAT: f64 = 2.0 * MIN_PIECE;

/// A quarter's tissue draft, laid in parallel with its ring's other quarters.
#[derive(Clone, Debug, PartialEq)]
pub struct QuarterDraft {
    /// The quarter's ring.
    pub ring: u32,
    /// Where the quarter hangs on the armature.
    pub station: Station,
    /// Name of the tissue that laid the draft.
    pub tissue: String,
    /// Keys of the edges bounding the quarter when the draft was laid.
    pub outline: Vec<Key>,
    /// The streets laid inside the outline.
    pub draft: TissueDraft,
}

impl QuarterDraft {
    /// The quarter's key.
    pub fn key(&self) -> Key {
        Key::quarter(self.ring, &self.station)
    }
}

/// The outcome of one quarter's commit.
#[derive(Clone, Debug, PartialEq)]
pub struct Committed {
    /// The quarter's key.
    pub quarter: Key,
    /// Position of its `OpenQuarter` event in the journal, or why it was refused.
    pub result: Result<usize, JournalError>,
}

/// Commit the drafts of one ring in the canonical order of their stations, whatever order they
/// come in. Each draft is turned into operations against the graph as it stands after the drafts
/// before it, so that streets of neighbouring quarters meeting on a shared edge are seated on
/// each other. `date` gives the date of the next commit, or `None` to stop the ring there (a
/// truncated ring keeps the quarters up to the one that reaches the target). A refused quarter
/// leaves the graph as it was and the commit goes on with the next.
pub fn commit_drafts(
    writer: &mut Writer,
    mut drafts: Vec<QuarterDraft>,
    mut date: impl FnMut(&Writer, &QuarterDraft) -> Option<Clock>,
) -> Vec<Committed> {
    drafts.sort_by(|a, b| (a.ring, &a.station).cmp(&(b.ring, &b.station)));
    let mut out = Vec::with_capacity(drafts.len());
    for draft in drafts {
        let Some(at) = date(writer, &draft) else {
            break;
        };
        let quarter = draft.key();
        let ops = ops_for_draft(&draft.draft, &quarter, &draft.outline, writer.graph());
        let kind = EventKind::OpenQuarter {
            ring: draft.ring,
            station: draft.station,
            tissue: draft.tissue,
            outline: draft.outline,
        };
        let result = writer.apply(at, kind, ops);
        out.push(Committed { quarter, result });
    }
    out
}

/// A draft street already turned into an operation: its key and its line with seated ends.
struct Laid {
    key: Key,
    path: Vec<Point>,
}

/// Where one street end sits, and the point it is moved to.
struct Seat {
    anchor: Anchor,
    point: Point,
}

/// Turn a tissue draft into edge insertions. Each street end takes a node within `NODE_SEAT`
/// (an outline node or one made by an earlier street), else sits on an outline edge or an
/// earlier street within `SEAT` (which splits at the meeting point), else dangles. Streets are
/// keyed by the quarter key and their rank in the draft, and the faces each street splits off by
/// the street key and the side, so that a re-run gives the same keys whatever else was committed
/// first. Edges are addressed by their stem, which stands for whichever piece lies under the end
/// when the operation is applied. A street whose ends take the same node is left out.
pub fn ops_for_draft(
    draft: &TissueDraft,
    quarter: &Key,
    outline_edges: &[Key],
    graph: &Graph,
) -> Vec<Op> {
    let stems: HashSet<Key> = outline_edges
        .iter()
        .filter_map(|k| graph.edge_id(k))
        .map(|e| graph.edge(e).stem.clone())
        .collect();
    let mut laid: Vec<Laid> = Vec::with_capacity(draft.streets.len());
    let mut made: Vec<(Key, Point)> = Vec::new();
    let mut ops = Vec::with_capacity(draft.streets.len());
    for (rank, street) in draft.streets.iter().enumerate() {
        if street.path.len() < 2 {
            continue;
        }
        let key = Key::edge(quarter, rank as u32);
        let mut path = street.path.clone();
        let last = path.len() - 1;
        let ends = [
            seat(graph, &stems, &laid, &made, path[0]),
            seat(graph, &stems, &laid, &made, path[last]),
        ];
        if let (Anchor::Node { node: a }, Anchor::Node { node: b }) =
            (&ends[0].anchor, &ends[1].anchor)
            && a == b
        {
            continue;
        }
        path[0] = ends[0].point;
        path[last] = ends[1].point;
        for (i, end) in ends.iter().enumerate() {
            if !matches!(end.anchor, Anchor::Node { .. }) {
                made.push((key.child(tag::END, &[i as u32]), end.point));
            }
        }
        let spec = EdgeSpec {
            key: key.clone(),
            level: Level::Ground,
            class: class_of(&street.role),
            rank: street.rank,
            polyline: path.clone(),
            widths: street.widths.clone(),
            owner: Some(quarter.clone()),
            chain: Some(key.clone()),
            face_names: Some([key.child(tag::BLOCK, &[0]), key.child(tag::BLOCK, &[1])]),
        };
        let [a, b] = ends;
        ops.push(Op::InsertEdge {
            spec,
            ends: [a.anchor, b.anchor],
        });
        laid.push(Laid { key, path });
    }
    ops
}

fn class_of(role: &str) -> EdgeClass {
    match role {
        "lane" => EdgeClass::Lane,
        "stairs" => EdgeClass::Stairs,
        _ => EdgeClass::Street,
    }
}

/// Distance from `p` to a polyline and the nearest point on it.
fn nearest(polyline: &[Point], p: Point) -> (f64, Point) {
    polyline
        .windows(2)
        .map(|w| {
            let (d, _, q) = distance(p, w[0], w[1]);
            (d, q)
        })
        .fold(
            (f64::INFINITY, p),
            |best, x| if x.0 < best.0 { x } else { best },
        )
}

/// Seat one street end: on a node, on an edge, or free.
fn seat(
    graph: &Graph,
    stems: &HashSet<Key>,
    laid: &[Laid],
    made: &[(Key, Point)],
    p: Point,
) -> Seat {
    let outline: Vec<_> = graph
        .edges_near(Level::Ground, p, NODE_SEAT)
        .into_iter()
        .filter(|&e| stems.contains(&graph.edge(e).stem))
        .collect();
    let mut node: Option<(f64, Key, Point)> = None;
    let mut consider = |d: f64, key: &Key, at: Point| {
        if d <= NODE_SEAT && node.as_ref().is_none_or(|(best, _, _)| d < *best) {
            node = Some((d, key.clone(), at));
        }
    };
    for &e in &outline {
        for n in graph.edge(e).nodes {
            let n = graph.node(n);
            consider(n.position.distance(p), &n.key, n.position);
        }
    }
    for (key, at) in made {
        consider(at.distance(p), key, *at);
    }
    if let Some((_, key, at)) = node {
        return Seat {
            anchor: Anchor::Node { node: key },
            point: at,
        };
    }
    let mut on: Option<(f64, Key, Point)> = None;
    let candidates = outline
        .iter()
        .map(|&e| (&graph.edge(e).stem, graph.edge(e).polyline.as_slice()))
        .chain(laid.iter().map(|l| (&l.key, l.path.as_slice())));
    for (key, polyline) in candidates {
        let (d, q) = nearest(polyline, p);
        if d <= SEAT && on.as_ref().is_none_or(|(best, _, _)| d < *best) {
            on = Some((d, key.clone(), q));
        }
    }
    match on {
        Some((_, edge, q)) => Seat {
            anchor: Anchor::OnEdge {
                edge,
                kind: NodeKind::Junction,
            },
            point: q,
        },
        None => Seat {
            anchor: Anchor::Free {
                kind: NodeKind::DeadEnd,
            },
            point: p,
        },
    }
}
