use std::{
    cmp::Ordering,
    collections::{BTreeMap, BinaryHeap},
    sync::Arc,
};

use magna_urbis_geom::Point;

use super::{SurveyCell, SurveySpec, grid::Grid, interpolate};

/// An armature polyline rasterized onto survey cells for the next cost field.
#[derive(Clone, Copy, Debug)]
pub struct CostPath<'a> {
    pub points: &'a [Point],
    /// Effective metres charged per metre of travel on the rasterized chain.
    pub multiplier: f64,
    /// Whether the chain includes built crossings. Wet cells stay closed, but
    /// a complete water span connects its two open ends for a fixed charge.
    pub allow_crossings: bool,
}

/// A snapshot of the open-land costs in effective metres.
pub struct CostField {
    pub(super) grid: Arc<Grid>,
    costs: Vec<f64>,
    order: Vec<usize>,
}

impl CostField {
    pub(super) fn compute(grid: Arc<Grid>, spec: &SurveySpec, paths: &[CostPath<'_>]) -> Self {
        let cheap = cheap_edges(&grid, spec, paths);
        let costs = propagate(&grid, spec, Metric::Cost, &cheap);
        let mut order: Vec<_> = (0..costs.len()).filter(|&i| costs[i].is_finite()).collect();
        order.sort_unstable_by(|&a, &b| costs[a].total_cmp(&costs[b]).then(a.cmp(&b)));
        Self { grid, costs, order }
    }

    /// Effective metres from the site centre, or infinity if closed or unreachable.
    pub fn cost_at(&self, point: Point) -> f64 {
        self.grid
            .open_at(point)
            .map_or(f64::INFINITY, |i| self.costs[i])
    }

    /// Effective metres from the site centre to a grid cell, or infinity.
    pub fn cost(&self, index: usize) -> f64 {
        self.costs.get(index).copied().unwrap_or(f64::INFINITY)
    }

    /// Reachable cells in ascending cost order, with ties broken by cell index.
    pub fn cells_by_cost(&self) -> impl Iterator<Item = (&SurveyCell, f64)> + '_ {
        self.order
            .iter()
            .map(|&index| (&self.grid.cells[index], self.costs[index]))
    }
}

type CheapEdges = BTreeMap<usize, BTreeMap<usize, f64>>;

#[derive(Clone, Copy)]
enum Metric {
    Cost,
    Distance,
    AccessGrade,
}

pub(super) fn land_distances(grid: &Grid, spec: &SurveySpec) -> Vec<f64> {
    propagate(grid, spec, Metric::Distance, &CheapEdges::new())
}

pub(super) fn access_grades(grid: &Grid, spec: &SurveySpec) -> Vec<f64> {
    propagate(grid, spec, Metric::AccessGrade, &CheapEdges::new())
}

#[derive(Clone, Copy)]
struct Candidate {
    cost: f64,
    index: usize,
}

impl Ord for Candidate {
    fn cmp(&self, other: &Self) -> Ordering {
        other
            .cost
            .total_cmp(&self.cost)
            .then(other.index.cmp(&self.index))
    }
}

impl PartialOrd for Candidate {
    fn partial_cmp(&self, other: &Self) -> Option<Ordering> {
        Some(self.cmp(other))
    }
}

impl PartialEq for Candidate {
    fn eq(&self, other: &Self) -> bool {
        self.cmp(other) == Ordering::Equal
    }
}

impl Eq for Candidate {}

fn propagate(grid: &Grid, spec: &SurveySpec, metric: Metric, cheap: &CheapEdges) -> Vec<f64> {
    let mut costs = vec![f64::INFINITY; grid.cells.len()];
    let Some(center) = grid.open_at(grid.center) else {
        return costs;
    };
    let mut queue = BinaryHeap::new();
    relax(center, 0.0, &mut costs, &mut queue);
    while let Some(Candidate { cost, index }) = queue.pop() {
        if cost > costs[index] {
            continue;
        }
        for (next, length) in grid.neighbours(index) {
            if !grid.connects(index, next, |cell| !cell.closed) {
                continue;
            }
            let (a, b) = (&grid.cells[index], &grid.cells[next]);
            let grade = segment_grade(a, b, length);
            if grade > spec.cliff_limit {
                continue;
            }
            let total = match metric {
                Metric::Cost => {
                    let slope = grade.max(a.slope).max(b.slope);
                    cost + length * (1.0 + (slope / spec.terrace_limit).powf(spec.slope_power))
                }
                Metric::Distance => cost + length,
                Metric::AccessGrade if grade <= spec.lane_grade => cost.max(grade),
                Metric::AccessGrade => continue,
            };
            relax(next, total, &mut costs, &mut queue);
        }
        if let Some(edges) = cheap.get(&index) {
            for (&next, &length) in edges {
                relax(next, cost + length, &mut costs, &mut queue);
            }
        }
    }
    costs
}

fn relax(index: usize, cost: f64, costs: &mut [f64], queue: &mut BinaryHeap<Candidate>) {
    if cost < costs[index] {
        costs[index] = cost;
        queue.push(Candidate { cost, index });
    }
}

fn segment_grade(a: &SurveyCell, b: &SurveyCell, length: f64) -> f64 {
    (a.elevation - b.elevation).abs() / length
}

fn cheap_edges(grid: &Grid, spec: &SurveySpec, paths: &[CostPath<'_>]) -> CheapEdges {
    let mut edges = CheapEdges::new();
    for path in paths {
        if !path.multiplier.is_finite() || path.multiplier <= 0.0 {
            continue;
        }
        let mut last: Option<usize> = None;
        let mut span: Option<(usize, f64)> = None;
        let mut visit = |next: Option<usize>| {
            let next = next.filter(|&index| {
                let cell = &grid.cells[index];
                !cell.closed || (path.allow_crossings && cell.wet && !cell.restricted)
            });
            if next == last {
                return;
            }
            let previous = std::mem::replace(&mut last, next);
            let (Some(a), Some(b)) = (previous, next) else {
                span = None;
                return;
            };
            let (from, to) = (&grid.cells[a], &grid.cells[b]);
            let across_water = from.wet || to.wet;
            if !grid.connects(a, b, |cell| {
                !cell.closed || (across_water && cell.wet && !cell.restricted)
            }) {
                span = None;
                return;
            }
            let length = from.position.distance(to.position);
            match (from.wet, to.wet) {
                (false, false) if segment_grade(from, to, length) <= spec.cliff_limit => {
                    add_edge(&mut edges, a, b, length * path.multiplier);
                }
                (false, true) => span = Some((a, length)),
                (true, true) => {
                    if let Some((_, distance)) = &mut span {
                        *distance += length;
                    }
                }
                (true, false) => {
                    if let Some((start, distance)) = span.take() {
                        let cost = (distance + length) * path.multiplier + spec.water_charge;
                        add_edge(&mut edges, start, b, cost);
                    }
                }
                _ => {}
            }
        };

        for segment in path.points.windows(2) {
            let (a, b) = (segment[0], segment[1]);
            let Some((from, to)) = grid.clip_segment(a, b) else {
                visit(None);
                continue;
            };
            if from != a {
                visit(None);
            }
            let count = (from.distance(to) / (0.5 * grid.step)).ceil().max(1.0) as usize;
            for i in 0..=count {
                let p = interpolate(from, to, i as f64 / count as f64);
                visit(grid.path_cell(p));
            }
            if to != b {
                visit(None);
            }
        }
    }
    edges
}

fn add_edge(edges: &mut CheapEdges, a: usize, b: usize, cost: f64) {
    if a != b && cost.is_finite() {
        for (from, to) in [(a, b), (b, a)] {
            edges
                .entry(from)
                .or_default()
                .entry(to)
                .and_modify(|old| *old = (*old).min(cost))
                .or_insert(cost);
        }
    }
}
