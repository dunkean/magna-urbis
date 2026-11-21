//! Growth cells, arrival ordering and road and shore attraction fields.
use super::geometry::union;
use crate::urban::{Point, Shape, Street, Surface, geometry as g};
use std::cmp::Ordering;

#[derive(Clone, Copy)]
pub(super) struct Arrival {
    pub(super) cost: f64,
    pub(super) cell: usize,
}
impl PartialEq for Arrival {
    fn eq(&self, other: &Self) -> bool {
        self.cost == other.cost && self.cell == other.cell
    }
}
impl Eq for Arrival {}
impl PartialOrd for Arrival {
    fn partial_cmp(&self, other: &Self) -> Option<Ordering> {
        Some(self.cmp(other))
    }
}
impl Ord for Arrival {
    fn cmp(&self, other: &Self) -> Ordering {
        other
            .cost
            .total_cmp(&self.cost)
            .then_with(|| other.cell.cmp(&self.cell))
    }
}

pub(super) struct Grid {
    pub(super) x0: f64,
    pub(super) y0: f64,
    pub(super) step: f64,
    pub(super) nx: usize,
    pub(super) ny: usize,
}
impl Grid {
    pub(super) fn point(&self, i: usize) -> Point {
        Point {
            x: self.x0 + (i % self.nx) as f64 * self.step + self.step * 0.5,
            y: self.y0 + (i / self.nx) as f64 * self.step + self.step * 0.5,
        }
    }
    pub(super) fn nearest(&self, p: Point) -> usize {
        let x = ((p.x - self.x0) / self.step)
            .floor()
            .clamp(0.0, (self.nx - 1) as f64) as usize;
        let y = ((p.y - self.y0) / self.step)
            .floor()
            .clamp(0.0, (self.ny - 1) as f64) as usize;
        y * self.nx + x
    }
    pub(super) fn move_cells(&self, from: usize, to: usize, costs: &[f64]) -> Vec<usize> {
        let (a, b) = (self.point(from), self.point(to));
        let steps = ((from % self.nx)
            .abs_diff(to % self.nx)
            .max((from / self.nx).abs_diff(to / self.nx))
            * 4)
        .max(4);
        let mut cells = vec![from];
        for j in 0..steps {
            let t = (j as f64 + 0.5) / steps as f64;
            let i = self.nearest(Point {
                x: a.x + (b.x - a.x) * t,
                y: a.y + (b.y - a.y) * t,
            });
            let previous = *cells.last().unwrap();
            if i == previous {
                continue;
            }
            if (i % self.nx).abs_diff(previous % self.nx) == 1
                && (i / self.nx).abs_diff(previous / self.nx) == 1
            {
                let left = previous / self.nx * self.nx + i % self.nx;
                let right = i / self.nx * self.nx + previous % self.nx;
                cells.push(if costs[left] <= costs[right] {
                    left
                } else {
                    right
                });
            }
            cells.push(i);
        }
        cells
    }
    /// Union run-length rectangles, retaining all holes and components. Collinear
    /// vertices are removed exactly; no contour simplification fills exclusions.
    pub(super) fn contours(&self, mask: &[bool]) -> Vec<Shape> {
        let mut runs = vec![];
        for y in 0..self.ny {
            let mut x = 0;
            while x < self.nx {
                if !mask[y * self.nx + x] {
                    x += 1;
                    continue;
                }
                let start = x;
                while x < self.nx && mask[y * self.nx + x] {
                    x += 1;
                }
                runs.push(g::rectangle(
                    self.x0 + start as f64 * self.step,
                    self.y0 + y as f64 * self.step,
                    self.x0 + x as f64 * self.step,
                    self.y0 + (y + 1) as f64 * self.step,
                ));
            }
        }
        union(&runs)
    }

    pub(super) fn boundary_centers(&self, mask: &[bool]) -> Vec<Point> {
        mask.iter()
            .enumerate()
            .filter_map(|(i, &selected)| {
                if !selected {
                    return None;
                }
                let (x, y) = (i % self.nx, i / self.nx);
                let boundary = x == 0
                    || y == 0
                    || x + 1 == self.nx
                    || y + 1 == self.ny
                    || !mask[i - 1]
                    || !mask[i + 1]
                    || !mask[i - self.nx]
                    || !mask[i + self.nx];
                boundary.then(|| self.point(i))
            })
            .collect()
    }
}

/// Absorb enclosed unselected lattice components smaller than `max_cells`:
/// an open space inside the town is at least a block, never a lattice square.
/// Real water inside an absorbed cell is clipped again from exact geography.
pub(super) fn fill_holes(mask: &mut [bool], grid: &Grid, max_cells: usize) {
    let mut visited = vec![false; mask.len()];
    for root in 0..mask.len() {
        if mask[root] || visited[root] {
            continue;
        }
        visited[root] = true;
        let mut patch = vec![root];
        let (mut cursor, mut open) = (0, false);
        while cursor < patch.len() {
            let i = patch[cursor];
            cursor += 1;
            let (x, y) = (i % grid.nx, i / grid.nx);
            open |= x == 0 || y == 0 || x + 1 == grid.nx || y + 1 == grid.ny;
            for j in [
                i.wrapping_sub(1),
                i + 1,
                i.wrapping_sub(grid.nx),
                i + grid.nx,
            ] {
                let adjacent = j < mask.len() && (j / grid.nx == y || j % grid.nx == x);
                if adjacent && !mask[j] && !visited[j] {
                    visited[j] = true;
                    patch.push(j);
                }
            }
        }
        if !open && patch.len() < max_cells {
            for i in patch {
                mask[i] = true;
            }
        }
    }
}

/// Local distance bins bound the road-attraction work. Only road segments whose
/// expanded boxes touch a bin are queried; distant roads have zero attraction.
pub(super) struct RoadField {
    bins: Vec<Vec<(Point, Point)>>,
    grid: (f64, f64, f64, f64),
    reach: f64,
}
impl RoadField {
    pub(super) fn new(roads: &[Street], grid: &Grid, reach: f64) -> Self {
        let bounds = (
            grid.x0,
            grid.y0,
            grid.nx as f64 * grid.step / 16.0,
            grid.ny as f64 * grid.step / 16.0,
        );
        let mut result = Self {
            bins: vec![vec![]; 256],
            grid: bounds,
            reach,
        };
        for w in roads.iter().flat_map(|s| s.path.windows(2)) {
            let x0 = ((w[0].x.min(w[1].x) - reach - bounds.0) / bounds.2).floor();
            let y0 = ((w[0].y.min(w[1].y) - reach - bounds.1) / bounds.3).floor();
            let x1 = ((w[0].x.max(w[1].x) + reach - bounds.0) / bounds.2).floor();
            let y1 = ((w[0].y.max(w[1].y) + reach - bounds.1) / bounds.3).floor();
            if x1 < 0.0 || y1 < 0.0 || x0 > 15.0 || y0 > 15.0 {
                continue;
            }
            for y in y0.clamp(0.0, 15.0) as usize..=y1.clamp(0.0, 15.0) as usize {
                for x in x0.clamp(0.0, 15.0) as usize..=x1.clamp(0.0, 15.0) as usize {
                    result.bins[y * 16 + x].push((w[0], w[1]));
                }
            }
        }
        result
    }
    pub(super) fn distance(&self, p: Point) -> f64 {
        let x = ((p.x - self.grid.0) / self.grid.2).floor().clamp(0.0, 15.0) as usize;
        let y = ((p.y - self.grid.1) / self.grid.3).floor().clamp(0.0, 15.0) as usize;
        self.bins[y * 16 + x]
            .iter()
            .map(|&(a, b)| g::distance(p, a, b).0)
            .fold(self.reach, f64::min)
    }
}

/// Nearest water on the bounded growth lattice. Only land is ever allocated;
/// this attraction chooses which accessible dry side receives the next budget.
pub(super) struct ShoreField {
    pub(super) distances: Vec<f64>,
    pub(super) sources: Vec<usize>,
}
impl ShoreField {
    /// Distance to water. A port (`navigable`) reads only the sea or a lake
    /// when the grid holds some: a brook does not draw its harbour.
    pub(super) fn new(grid: &Grid, surface: Surface<'_>, navigable: bool) -> Self {
        let n = grid.nx * grid.ny;
        let mut result = Self {
            distances: vec![f64::INFINITY; n],
            sources: vec![usize::MAX; n],
        };
        let mut heap = std::collections::BinaryHeap::new();
        let code = |p: Point| {
            let x = ((p.x / surface.width * surface.n as f64) as usize).min(surface.n - 1);
            let y = ((p.y / surface.width * surface.n as f64) as usize).min(surface.n - 1);
            surface.water[y * surface.n + x]
        };
        let inside = |p: Point| p.x < surface.width && p.y < surface.width;
        let open = navigable
            && (0..n).any(|i| {
                let p = grid.point(i);
                inside(p) && matches!(code(p), 1 | 2)
            });
        for i in 0..n {
            let p = grid.point(i);
            if inside(p) && surface.wet(p) && (!open || matches!(code(p), 1 | 2)) {
                result.distances[i] = 0.0;
                result.sources[i] = i;
                heap.push(Arrival { cost: 0.0, cell: i });
            }
        }
        while let Some(Arrival { cost, cell }) = heap.pop() {
            if cost > result.distances[cell] + 1e-9 {
                continue;
            }
            let x = (cell % grid.nx) as isize;
            let y = (cell / grid.nx) as isize;
            for (dx, dy) in [
                (-1, -1),
                (0, -1),
                (1, -1),
                (-1, 0),
                (1, 0),
                (-1, 1),
                (0, 1),
                (1, 1),
            ] {
                let nx = x + dx;
                let ny = y + dy;
                if nx < 0 || ny < 0 || nx >= grid.nx as isize || ny >= grid.ny as isize {
                    continue;
                }
                let next = ny as usize * grid.nx + nx as usize;
                let value = cost + grid.step * (dx as f64).hypot(dy as f64);
                if value + 1e-9 < result.distances[next] {
                    result.distances[next] = value;
                    result.sources[next] = result.sources[cell];
                    heap.push(Arrival {
                        cost: value,
                        cell: next,
                    });
                }
            }
        }
        result
    }
}
