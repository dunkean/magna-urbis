//! The open land of a ring: survey cells cheaper than the ring's outer level, as one outline.
//!
//! The cells reachable from the focus below the level are taken by 4-connected flood fill, their
//! holes filled (a pond inside the land is no boundary of the ring) and the corners where two
//! cells touch only diagonally widened by one cell, so that the cells' outer edge is one simple
//! loop. The loop runs along cell sides, so it follows banks and cliffs (closed cells) to half a
//! cell; it is simplified to less than half a cell, which keeps the focus inside.

use magna_urbis_geom::{Point, Shape, signed, simple, simplify};

use crate::survey::{CostField, Survey};

/// Simplification tolerance in cells: under half a cell, so the centre cell stays inside.
const TOLERANCE: f64 = 0.45;
/// Rounds of hole filling and corner widening before the loop is traced.
const CLEAN_ROUNDS: usize = 8;

/// Survey costs on an integer lattice centred on the survey centre, padded by one empty cell.
pub(super) struct Lattice {
    /// Lattice coordinate of the first column and row (before padding), relative to the centre.
    first: (i64, i64),
    /// Padded size.
    width: usize,
    height: usize,
    step: f64,
    centre: Point,
    cost: Vec<f64>,
}

/// The land open below a level.
pub(super) struct Land {
    /// Outer loop, counter-clockwise, first point not repeated.
    pub outline: Vec<Point>,
    /// Whether the land holds every cell reachable from the centre: no later ring can add any.
    pub whole: bool,
}

impl Lattice {
    /// The lattice of `costs` over the cells of `survey`.
    pub(super) fn new(survey: &Survey, costs: &CostField) -> Self {
        let (centre, step) = (survey.center(), survey.cell_size());
        let coord = |p: Point| {
            (
                ((p.x - centre.x) / step).round() as i64,
                ((p.y - centre.y) / step).round() as i64,
            )
        };
        let (mut lo, mut hi) = ((0_i64, 0_i64), (0_i64, 0_i64));
        for cell in survey.cells() {
            let (i, j) = coord(cell.position);
            lo = (lo.0.min(i), lo.1.min(j));
            hi = (hi.0.max(i), hi.1.max(j));
        }
        let width = (hi.0 - lo.0 + 3) as usize;
        let height = (hi.1 - lo.1 + 3) as usize;
        let mut cost = vec![f64::INFINITY; width * height];
        for cell in survey.cells() {
            let (i, j) = coord(cell.position);
            let at = (j - lo.1 + 1) as usize * width + (i - lo.0 + 1) as usize;
            cost[at] = costs.cost(cell.index);
        }
        Self {
            first: lo,
            width,
            height,
            step,
            centre,
            cost,
        }
    }

    /// The land reachable from the centre at a cost below `level`, or `None` when even the centre
    /// is not open.
    pub(super) fn land(&self, level: f64) -> Option<Land> {
        let start = self.index(-self.first.0 + 1, -self.first.1 + 1);
        if !(self.cost[start] < level) {
            return None;
        }
        let mut mask = self.flood(start, |c| c < level);
        let reachable = self.flood(start, f64::is_finite);
        let count = |m: &[bool]| m.iter().filter(|&&x| x).count();
        let whole = count(&mask) == count(&reachable);
        for _ in 0..CLEAN_ROUNDS {
            self.fill_holes(&mut mask);
            if !self.widen_corners(&mut mask) {
                break;
            }
        }
        self.fill_holes(&mut mask);
        let outline = self.trace(&mask)?;
        Some(Land { outline, whole })
    }

    fn index(&self, i: i64, j: i64) -> usize {
        j as usize * self.width + i as usize
    }

    fn neighbours(&self, at: usize) -> impl Iterator<Item = usize> + '_ {
        let (i, j) = (at % self.width, at / self.width);
        [(1_i64, 0_i64), (0, 1), (-1, 0), (0, -1)]
            .into_iter()
            .filter_map(move |(di, dj)| {
                let (x, y) = (i as i64 + di, j as i64 + dj);
                (x >= 0 && y >= 0 && (x as usize) < self.width && (y as usize) < self.height)
                    .then(|| y as usize * self.width + x as usize)
            })
    }

    /// Cells 4-connected to `start` whose cost passes `keep`.
    fn flood(&self, start: usize, keep: impl Fn(f64) -> bool) -> Vec<bool> {
        let mut mask = vec![false; self.cost.len()];
        let mut stack = vec![start];
        mask[start] = true;
        while let Some(at) = stack.pop() {
            for next in self.neighbours(at) {
                if !mask[next] && keep(self.cost[next]) {
                    mask[next] = true;
                    stack.push(next);
                }
            }
        }
        mask
    }

    /// Add every empty cell not 4-connected to the padding.
    fn fill_holes(&self, mask: &mut [bool]) {
        let mut outside = vec![false; mask.len()];
        let mut stack = vec![0];
        outside[0] = true;
        while let Some(at) = stack.pop() {
            for next in self.neighbours(at) {
                if !outside[next] && !mask[next] {
                    outside[next] = true;
                    stack.push(next);
                }
            }
        }
        for (cell, out) in mask.iter_mut().zip(outside) {
            *cell |= !out;
        }
    }

    /// Where two cells of the mask touch only at a corner, add the cheaper of the two empty
    /// cells of that corner. Returns whether a cell was added.
    fn widen_corners(&self, mask: &mut [bool]) -> bool {
        let mut changed = false;
        for j in 0..self.height - 1 {
            for i in 0..self.width - 1 {
                let cells = [
                    j * self.width + i,
                    j * self.width + i + 1,
                    (j + 1) * self.width + i,
                    (j + 1) * self.width + i + 1,
                ];
                let [a, b, c, d] = cells.map(|x| mask[x]);
                let empty = if a && d && !b && !c {
                    [cells[1], cells[2]]
                } else if b && c && !a && !d {
                    [cells[0], cells[3]]
                } else {
                    continue;
                };
                let pick = if self.cost[empty[1]] < self.cost[empty[0]] {
                    empty[1]
                } else {
                    empty[0]
                };
                mask[pick] = true;
                changed = true;
            }
        }
        changed
    }

    /// The outer loop of a hole-free, 4-connected mask without diagonal-only corners,
    /// counter-clockwise, collinear corners dropped, then simplified.
    fn trace(&self, mask: &[bool]) -> Option<Vec<Point>> {
        let corners = self.width + 1;
        let corner = |i: usize, j: usize| j * corners + i;
        let mut next = vec![usize::MAX; corners * (self.height + 1)];
        let filled = |i: i64, j: i64| {
            i >= 0
                && j >= 0
                && (i as usize) < self.width
                && (j as usize) < self.height
                && mask[j as usize * self.width + i as usize]
        };
        let mut first = None;
        for j in 0..self.height {
            for i in 0..self.width {
                if !mask[j * self.width + i] {
                    continue;
                }
                let (x, y) = (i as i64, j as i64);
                // Sides with an empty neighbour, walked with the cell on their left.
                if !filled(x, y - 1) {
                    next[corner(i, j)] = corner(i + 1, j);
                }
                if !filled(x + 1, y) {
                    next[corner(i + 1, j)] = corner(i + 1, j + 1);
                }
                if !filled(x, y + 1) {
                    next[corner(i + 1, j + 1)] = corner(i, j + 1);
                }
                if !filled(x - 1, y) {
                    next[corner(i, j + 1)] = corner(i, j);
                }
                first.get_or_insert(corner(i, j));
            }
        }
        let start = first?;
        let mut ring = Vec::new();
        let mut at = start;
        for _ in 0..next.len() {
            ring.push(at);
            at = next[at];
            if at == usize::MAX {
                return None;
            }
            if at == start {
                break;
            }
        }
        let point = |c: usize| {
            let (i, j) = ((c % corners) as i64, (c / corners) as i64);
            Point {
                x: self.centre.x + (self.first.0 + i - 1) as f64 * self.step - self.step * 0.5,
                y: self.centre.y + (self.first.1 + j - 1) as f64 * self.step - self.step * 0.5,
            }
        };
        let points: Vec<Point> = ring.into_iter().map(point).collect();
        let corners_only = drop_collinear(&points);
        let simplified = simplify_ring(&corners_only, TOLERANCE * self.step);
        let valid = |r: &[Point]| {
            r.len() >= 3
                && signed(r) > 0.0
                && simple(&Shape {
                    outer: r.to_vec(),
                    holes: vec![],
                })
        };
        if valid(&simplified) {
            Some(simplified)
        } else if valid(&corners_only) {
            Some(corners_only)
        } else {
            None
        }
    }
}

/// A closed ring without the vertices where it runs straight on.
fn drop_collinear(ring: &[Point]) -> Vec<Point> {
    let n = ring.len();
    (0..n)
        .filter(|&k| {
            let (a, b, c) = (ring[(k + n - 1) % n], ring[k], ring[(k + 1) % n]);
            ((b.x - a.x) * (c.y - b.y) - (b.y - a.y) * (c.x - b.x)).abs() > 1e-9
        })
        .map(|k| ring[k])
        .collect()
}

/// Douglas-Peucker on a closed ring, cut at its first vertex and the vertex farthest from it.
fn simplify_ring(ring: &[Point], tolerance: f64) -> Vec<Point> {
    if ring.len() < 4 {
        return ring.to_vec();
    }
    let far = (1..ring.len())
        .max_by(|&a, &b| {
            ring[0]
                .distance(ring[a])
                .total_cmp(&ring[0].distance(ring[b]))
        })
        .unwrap_or(ring.len() / 2);
    let first = simplify(&ring[..=far], tolerance, |_| false);
    let mut second: Vec<Point> = ring[far..].to_vec();
    second.push(ring[0]);
    let second = simplify(&second, tolerance, |_| false);
    let mut out = first;
    out.extend_from_slice(&second[1..second.len() - 1]);
    out
}
