//! The harbour road: the least-cost route at street grade from the founding focus to a distant
//! front's landing, laid at founding as an armature chain.

use std::cmp::Ordering;
use std::collections::{BinaryHeap, HashMap};

use magna_urbis_geom::{Point, simplify};

use super::{FrontChoice, road_chain};
use crate::armature::{Draw, Tip, chain_ops, crossings};
use crate::graph::{EdgeClass, Key, NodeKind};
use crate::journal::{Op, Stage};
use crate::spec::HarbourSpec;
use crate::survey::{Survey, SurveyCell};

/// The eight moves between survey cells.
const MOVES: [(f64, f64); 8] = [
    (1.0, 0.0),
    (0.0, 1.0),
    (-1.0, 0.0),
    (0.0, -1.0),
    (1.0, 1.0),
    (-1.0, 1.0),
    (-1.0, -1.0),
    (1.0, -1.0),
];
/// Simplification tolerance of the route, in cells: under half a cell keeps it on its cells.
const TOLERANCE: f64 = 0.45;
/// The search gives up beyond this many times the straight distance, plus a few cells.
const DETOUR: f64 = 3.0;

#[derive(Clone, Copy)]
struct Entry {
    cost: f64,
    index: usize,
}

impl Ord for Entry {
    fn cmp(&self, other: &Self) -> Ordering {
        other
            .cost
            .total_cmp(&self.cost)
            .then(other.index.cmp(&self.index))
    }
}

impl PartialOrd for Entry {
    fn partial_cmp(&self, other: &Self) -> Option<Ordering> {
        Some(self.cmp(other))
    }
}

impl PartialEq for Entry {
    fn eq(&self, other: &Self) -> bool {
        self.cmp(other) == Ordering::Equal
    }
}

impl Eq for Entry {}

/// The least-cost route from `focus` to the landing of `front` over open survey cells, every
/// move at most the street grade (`works.roadGrade`), costed by length and grade; simplified to
/// under half a cell. `None` when no such route exists (a cliff coast, an island).
pub fn harbour_road(
    survey: &Survey,
    focus: Point,
    front: &FrontChoice,
    spec: &HarbourSpec,
) -> Option<Vec<Point>> {
    road_to_landing(survey, focus, front.landing, spec.works.road_grade)
}

pub(super) fn road_to_landing(
    survey: &Survey,
    focus: Point,
    target: Point,
    road_grade: f64,
) -> Option<Vec<Point>> {
    let step = survey.cell_size();
    let grade_limit = road_grade.max(1e-6);
    let open = |p: Point| survey.cell_at(p).filter(|c| !c.closed);
    let start = open(focus)?;
    // The landing lies on the waterline's inland side: the nearest open cell takes it.
    let goal = (-2..=2)
        .flat_map(|dx| (-2..=2).map(move |dy| (dx, dy)))
        .filter_map(|(dx, dy)| {
            open(Point {
                x: target.x + f64::from(dx) * step,
                y: target.y + f64::from(dy) * step,
            })
        })
        .min_by(|a, b| {
            a.position
                .distance(target)
                .total_cmp(&b.position.distance(target))
                .then(a.index.cmp(&b.index))
        })?;
    let bound = DETOUR * focus.distance(target) + 8.0 * step;

    let mut best: HashMap<usize, f64> = HashMap::from([(start.index, 0.0)]);
    let mut previous: HashMap<usize, usize> = HashMap::new();
    let mut queue = BinaryHeap::from([Entry {
        cost: 0.0,
        index: start.index,
    }]);
    let mut reached = false;
    while let Some(Entry { cost, index }) = queue.pop() {
        if index == goal.index {
            reached = true;
            break;
        }
        if cost > best.get(&index).copied().unwrap_or(f64::INFINITY) || cost > bound {
            continue;
        }
        let Some(cell) = survey.cell(index) else {
            continue;
        };
        for (dx, dy) in MOVES {
            let Some(next) = neighbour(survey, cell, dx, dy, step) else {
                continue;
            };
            let length = cell.position.distance(next.position);
            let grade = (cell.elevation - next.elevation).abs() / length;
            if !(grade <= grade_limit) {
                continue;
            }
            let total = cost + length * (1.0 + grade / grade_limit);
            if total < best.get(&next.index).copied().unwrap_or(f64::INFINITY) {
                best.insert(next.index, total);
                previous.insert(next.index, index);
                queue.push(Entry {
                    cost: total,
                    index: next.index,
                });
            }
        }
    }
    if !reached {
        return None;
    }
    let mut cells = vec![goal.index];
    while let Some(&p) = previous.get(cells.last()?) {
        cells.push(p);
    }
    cells.reverse();
    let mut path: Vec<Point> = vec![focus];
    path.extend(
        cells
            .iter()
            .skip(1)
            .filter_map(|&i| survey.cell(i))
            .map(|c| c.position),
    );
    path.push(target);
    path.dedup_by(|a, b| a.distance(*b) < 1e-6);
    if path.len() < 2 {
        return None;
    }
    let simple = simplify(&path, TOLERANCE * step, |_| false);
    Some(if on_open_land(survey, &simple) {
        simple
    } else {
        path
    })
}

/// The open neighbour of `cell` one move `(dx, dy)` away; a diagonal move needs both cells
/// beside it open, so that it cannot cut a closed corner.
fn neighbour<'a>(
    survey: &'a Survey,
    cell: &SurveyCell,
    dx: f64,
    dy: f64,
    step: f64,
) -> Option<&'a SurveyCell> {
    let at = |x: f64, y: f64| {
        survey
            .cell_at(Point {
                x: cell.position.x + x * step,
                y: cell.position.y + y * step,
            })
            .filter(|c| !c.closed)
    };
    let next = at(dx, dy)?;
    if dx != 0.0 && dy != 0.0 && (at(dx, 0.0).is_none() || at(0.0, dy).is_none()) {
        return None;
    }
    Some(next)
}

/// Whether a simplified route keeps to open cells, sampled every half cell; its last cell and a
/// half, by the water, is not tested.
fn on_open_land(survey: &Survey, path: &[Point]) -> bool {
    let step = survey.cell_size();
    let total: f64 = path.windows(2).map(|w| w[0].distance(w[1])).sum();
    let mut walked = 0.0;
    for w in path.windows(2) {
        let length = w[0].distance(w[1]);
        let count = (length / (0.5 * step)).ceil().max(1.0) as usize;
        for k in 0..=count {
            let t = k as f64 / count as f64;
            let p = Point {
                x: w[0].x + (w[1].x - w[0].x) * t,
                y: w[0].y + (w[1].y - w[0].y) * t,
            };
            if total - (walked + t * length) > 1.5 * step && survey.closed_at(p) {
                return false;
            }
        }
        walked += length;
    }
    true
}

/// Push the harbour road `path` (from [`harbour_road`]) onto the stage of the founding event
/// `found` as a chain of class harbour road from the focus node `focus` to a new landing node,
/// split where it crosses the founding graph. Its edges are keyed under the road's chain key, so
/// they never meet the keys of the founding's other edges. Returns the landing node's key;
/// `None` when the graph refuses the road (it runs along a regional road, or ends on one).
pub fn lay_harbour_road(
    stage: &mut Stage,
    found: &Key,
    path: &[Point],
    focus: &Key,
    spec: &HarbourSpec,
) -> Option<Key> {
    let graph = stage.graph();
    let node = graph.node_id(focus)?;
    let mut path = path.to_vec();
    if path.len() < 2 {
        return None;
    }
    path[0] = graph.node(node).position;
    let hits = crossings(graph, &path, [true, false], false)?;
    let chain = road_chain(found);
    let mut rank = 0;
    let draw = Draw {
        event: &chain,
        next_rank: &mut rank,
        chain: Some(chain.clone()),
        class: EdgeClass::HarbourRoad,
        rank: 1,
        width: spec.works.road_width,
    };
    let (ops, _) = chain_ops(
        draw,
        &path,
        Tip::Node(focus.clone()),
        Tip::Free(NodeKind::Landing),
        &hits,
    );
    let landing = match ops.last()? {
        Op::InsertEdge { spec, .. } => spec.key.child(crate::graph::tag::END, &[1]),
        _ => return None,
    };
    stage.try_push(ops).ok()?;
    Some(landing)
}
