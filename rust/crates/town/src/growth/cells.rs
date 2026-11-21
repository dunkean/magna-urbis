//! The town's frontier: the unopened cells of the street skeleton that touch the town, each with
//! its station and its cost.

use magna_urbis_geom::{Point, Shape, area, interior_point};

use crate::armature::in_town;
use crate::graph::{FaceKind, Graph, HalfId, Key, Level, NodeId, Station};
use crate::survey::CostField;

/// Faces smaller than this are not opened (square metres).
const MIN_AREA: f64 = 1.0;
/// Spacing in metres of the cost samples along a cell's edges.
const SAMPLE: f64 = 20.0;
/// Metres the samples are moved into the cell, off its edges.
const INSET: f64 = 6.0;

/// A cell of the skeleton to open as one quarter.
#[derive(Clone, Debug)]
pub(super) struct Cell {
    /// Where the quarter hangs: the origin of the half of smallest edge key on the cell's walk,
    /// and that half's rank among the node's arms. The same whatever order cells are computed in.
    pub station: Station,
    /// Key of the face.
    pub face: Key,
    /// Its outline.
    pub outline: Shape,
    /// Keys of the edges bounding it, in key order.
    pub outline_edges: Vec<Key>,
    /// What reaching it costs (effective metres): the mean of the cheapest third of its samples,
    /// so that a cell along a road or a built street is cheap even when its far side is not.
    pub cost: f64,
}

/// The unopened cells touching the town, cheapest first, then in station order. With nothing
/// opened yet, the town is `seeds` (the focus); a far bank starts at its landings (`landings`).
pub(super) fn frontier(
    graph: &Graph,
    costs: &CostField,
    seeds: &[NodeId],
    landings: &[Point],
) -> Vec<Cell> {
    let outside = graph.outside(Level::Ground);
    let landing_faces: Vec<_> = landings
        .iter()
        .map(|&p| graph.face_at(Level::Ground, p))
        .collect();
    let mut cells: Vec<Cell> = graph
        .live_faces()
        .filter(|&f| {
            f != outside
                && graph.face(f).level == Level::Ground
                && *graph.face(f).kind.current() == FaceKind::Unbuilt
        })
        .filter_map(|f| {
            let halves: Vec<HalfId> = graph.walks(f).into_iter().flatten().collect();
            let touches = landing_faces.contains(&f)
                || halves.iter().any(|&h| {
                    seeds.contains(&graph.half(h).origin)
                        || in_town(graph, graph.half(h.twin()).face)
                });
            if !touches {
                return None;
            }
            let outline = graph.outline(f)?;
            if area(&outline) < MIN_AREA {
                return None;
            }
            let cost = cost(graph, costs, &halves, &outline);
            if !cost.is_finite() {
                return None;
            }
            let first = halves
                .iter()
                .copied()
                .min_by(|&a, &b| {
                    graph
                        .edge(a.edge())
                        .key
                        .cmp(&graph.edge(b.edge()).key)
                        .then(b.is_forward().cmp(&a.is_forward()))
                })?;
            let host = graph.half(first).origin;
            let arm = graph
                .arms(host, Level::Ground)
                .iter()
                .position(|&h| h == first)? as u32;
            let mut outline_edges: Vec<Key> = halves
                .iter()
                .map(|h| graph.edge(h.edge()).key.clone())
                .collect();
            outline_edges.sort();
            outline_edges.dedup();
            Some(Cell {
                station: Station {
                    host: graph.node(host).key.clone(),
                    arm,
                },
                face: graph.face(f).key.clone(),
                outline,
                outline_edges,
                cost,
            })
        })
        .collect();
    cells.sort_by(|a, b| a.cost.total_cmp(&b.cost).then_with(|| a.station.cmp(&b.station)));
    cells
}

/// The cost of a cell: samples every `SAMPLE` metres along its walk, moved `INSET` metres into
/// it, and its interior point; the mean of the cheapest third of the finite ones.
fn cost(graph: &Graph, costs: &CostField, halves: &[HalfId], outline: &Shape) -> f64 {
    let mut samples = vec![costs.cost_at(interior_point(outline))];
    for &h in halves {
        let edge = graph.edge(h.edge());
        let mut points = edge.polyline.clone();
        if !h.is_forward() {
            points.reverse();
        }
        for w in points.windows(2) {
            let length = w[0].distance(w[1]);
            if length < 1e-9 {
                continue;
            }
            let (ux, uy) = ((w[1].x - w[0].x) / length, (w[1].y - w[0].y) / length);
            let count = (length / SAMPLE).ceil() as usize;
            for k in 0..count {
                let t = (k as f64 + 0.5) / count as f64 * length;
                // The face lies on the left of its halves.
                let p = Point {
                    x: w[0].x + ux * t - uy * INSET,
                    y: w[0].y + uy * t + ux * INSET,
                };
                samples.push(costs.cost_at(p));
            }
        }
    }
    let mut finite: Vec<f64> = samples.into_iter().filter(|c| c.is_finite()).collect();
    if finite.is_empty() {
        return f64::INFINITY;
    }
    finite.sort_by(f64::total_cmp);
    let third = finite.len().div_ceil(3);
    finite[..third].iter().sum::<f64>() / third as f64
}
