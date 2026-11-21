//! A ring's new boundary: the parts of its outer cost level that lie outside the town.
//!
//! The ring's outline (the open land cheaper than its outer level, counter-clockwise) is cut
//! wherever it meets the graph. A stretch whose middle lies in a town face is dropped: there the
//! previous ring's boundary, or a street, already bounds the ring. The other stretches, joined
//! end to end, are the ring's arcs: each starts and ends on the town's limit, or closes around
//! the town when nothing is built yet. Walked counter-clockwise, an arc has the new land on its
//! left, so a ring's sectors are the faces on the left of its arcs.

use magna_urbis_geom::Point;

use super::chain::{Hit, MIN_GAP, Tip, crossings};
use crate::graph::{EdgeClass, FaceId, FaceKind, Graph, Level, NodeKind, ON_EDGE};

/// One stretch of a ring's outline to insert as a boundary chain.
#[derive(Clone, Debug)]
pub struct BoundaryArc {
    /// The drawn line, ends included.
    pub path: Vec<Point>,
    /// Where it starts.
    pub start: Tip,
    /// Where it ends.
    pub end: Tip,
    /// Its crossings with the graph between its ends.
    pub hits: Vec<Hit>,
}

/// Whether a face is part of the town: a block, or land opened by a ring and not yet laid out
/// (on the left of a boundary edge). The unbounded face and faces left between roads outside
/// the town are not.
pub fn in_town(graph: &Graph, face: FaceId) -> bool {
    if face == graph.outside(Level::Ground) {
        return false;
    }
    if *graph.face(face).kind.current() == FaceKind::Block {
        return true;
    }
    graph
        .walks(face)
        .iter()
        .flatten()
        .any(|&h| h.is_forward() && *graph.edge(h.edge()).class.current() == EdgeClass::Boundary)
}

/// The arcs of a ring whose outline is `outline` (closed, counter-clockwise, first point not
/// repeated). An arc that stays everywhere within `min_depth` of existing edges is left out:
/// the strip it would open is too thin for a quarter and waits for the next ring.
pub fn arcs(graph: &Graph, outline: &[Point], min_depth: f64) -> Vec<BoundaryArc> {
    if outline.len() < 3 {
        return Vec::new();
    }
    // Start the walk at a vertex clear of every crossing, so that the closed walk's two ends are
    // not crowded by one.
    let mut found = None;
    for shift in 0..outline.len() {
        let mut closed: Vec<Point> = outline[shift..]
            .iter()
            .chain(&outline[..shift])
            .copied()
            .collect();
        closed.push(closed[0]);
        if let Some(hits) = crossings(graph, &closed, [false, false], true) {
            found = Some((closed, hits));
            break;
        }
    }
    let Some((closed, hits)) = found else {
        return Vec::new();
    };
    // A stretch running along an existing edge is bounded already.
    let outside = |path: &[Point]| {
        let m = middle(path);
        graph.edges_near(Level::Ground, m, ON_EDGE).is_empty()
            && !in_town(graph, graph.face_at(Level::Ground, m))
    };
    if hits.is_empty() {
        if !outside(&closed) || shallow(graph, &closed, min_depth) {
            return Vec::new();
        }
        return vec![BoundaryArc {
            path: closed,
            start: Tip::Free(NodeKind::Junction),
            end: Tip::Start,
            hits: Vec::new(),
        }];
    }

    // Stretch k runs from hit k to hit k + 1, the last one through the walk's start.
    let n = hits.len();
    let stretches: Vec<Vec<Point>> = (0..n)
        .map(|k| {
            let (a, b) = (&hits[k], &hits[(k + 1) % n]);
            let mut path = vec![a.point];
            if k + 1 < n {
                path.extend_from_slice(&closed[a.segment + 1..=b.segment]);
            } else {
                path.extend_from_slice(&closed[a.segment + 1..closed.len() - 1]);
                path.extend_from_slice(&closed[..=b.segment]);
            }
            path.push(b.point);
            path.dedup_by(|p, q| p.distance(*q) < 1e-9);
            path
        })
        .collect();
    let open: Vec<bool> = stretches.iter().map(|s| outside(s)).collect();

    // Runs of open stretches, each from a hit after a closed stretch to the next closed one.
    let mut runs: Vec<(usize, usize)> = Vec::new();
    match (0..n).find(|&k| !open[k]) {
        None => runs.push((0, n)),
        Some(closed_at) => {
            let mut k = (closed_at + 1) % n;
            let mut current: Option<(usize, usize)> = None;
            for _ in 0..n {
                if open[k] {
                    current = Some(match current {
                        Some((first, count)) => (first, count + 1),
                        None => (k, 1),
                    });
                } else if let Some(run) = current.take() {
                    runs.push(run);
                }
                k = (k + 1) % n;
            }
            if let Some(run) = current {
                runs.push(run);
            }
        }
    }

    let mut out = Vec::new();
    for (first, count) in runs {
        let mut path: Vec<Point> = Vec::new();
        for i in 0..count {
            let stretch = &stretches[(first + i) % n];
            let skip = usize::from(!path.is_empty());
            path.extend_from_slice(&stretch[skip..]);
        }
        let length: f64 = path.windows(2).map(|w| w[0].distance(w[1])).sum();
        if path.len() < 2 || length < 4.0 * MIN_GAP || shallow(graph, &path, min_depth) {
            continue;
        }
        let start = hits[first].tip();
        let loop_around = count == n;
        let end = if loop_around {
            Tip::Start
        } else {
            hits[(first + count) % n].tip()
        };
        // An arc leaving and coming back to one node would be a loop on it.
        if !loop_around && matches!((&start, &end), (Tip::Node(a), Tip::Node(b)) if a == b) {
            continue;
        }
        let Some(inner) = crossings(graph, &path, [true, true], false) else {
            continue;
        };
        out.push(BoundaryArc {
            path,
            start,
            end,
            hits: inner,
        });
    }
    out
}

/// The point halfway along a polyline.
fn middle(path: &[Point]) -> Point {
    let total: f64 = path.windows(2).map(|w| w[0].distance(w[1])).sum();
    let mut left = total * 0.5;
    for w in path.windows(2) {
        let length = w[0].distance(w[1]);
        if length >= left && length > 0.0 {
            let t = left / length;
            return Point {
                x: w[0].x + (w[1].x - w[0].x) * t,
                y: w[0].y + (w[1].y - w[0].y) * t,
            };
        }
        left -= length;
    }
    path[path.len() / 2]
}

/// Whether every point of `path`, sampled every few metres, lies within `depth` of a live edge.
fn shallow(graph: &Graph, path: &[Point], depth: f64) -> bool {
    let spacing = (depth * 0.5).max(1.0);
    for w in path.windows(2) {
        let steps = (w[0].distance(w[1]) / spacing).ceil().max(1.0) as usize;
        for i in 0..=steps {
            let t = i as f64 / steps as f64;
            let p = Point {
                x: w[0].x + (w[1].x - w[0].x) * t,
                y: w[0].y + (w[1].y - w[0].y) * t,
            };
            if graph.edges_near(Level::Ground, p, depth).is_empty() {
                return false;
            }
        }
    }
    true
}
