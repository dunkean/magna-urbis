//! The land a precinct takes: the cheapest open cells of the cost field around the land it
//! already holds, as one outline.
//!
//! Cells are taken in ascending cost until their area reaches the precinct's need, so that slope
//! and water shape the precinct as they shape the rings. The chosen cells are one 4-connected
//! component (the one holding the cheapest cell), with its holes filled; when they lie on two
//! occupied banks of a channel, the channel between them is closed over so that both banks stand
//! in one circuit. The outline is the component's outer boundary along the cell sides; the
//! tracers regularise it afterwards.

use std::collections::{BTreeMap, HashMap, VecDeque};

use magna_urbis_geom::{self as g, Point, Shape};

use crate::survey::{BankId, CostField, Survey};

/// Share of the chosen cells a bank component must hold to count as occupied.
const OCCUPIED_BANK: f64 = 0.15;
/// Widest channel in metres closed over when a precinct holds both of its banks.
const CHANNEL_SPAN: f64 = 60.0;

/// The outline of a precinct's land and the bank components it occupies.
#[derive(Clone, Debug)]
pub struct Land {
    /// Counter-clockwise outline, along cell sides.
    pub outline: Shape,
    /// Bank components holding at least [`OCCUPIED_BANK`] of the chosen cells, ascending.
    pub banks: Vec<BankId>,
}

/// Square metres of land for `households` at `density` gross inhabitants per hectare.
pub fn land_for(households: f64, household_size: f64, density: f64) -> f64 {
    households.max(0.0) * household_size / density.max(1.0) * 10_000.0
}

/// The cheapest open cells of `costs` making `area` square metres together with `existing`
/// (whose own cells are always taken), as one outline. `None` when no open cell is reachable.
pub fn cheapest_land(
    survey: &Survey,
    costs: &CostField,
    existing: Option<&Shape>,
    area: f64,
) -> Option<Land> {
    let step = survey.cell_size();
    let centre = survey.center();
    let key = |p: Point| {
        (
            ((p.x - centre.x) / step).round() as i64,
            ((p.y - centre.y) / step).round() as i64,
        )
    };
    let mut chosen: Vec<(i64, i64)> = Vec::new();
    let mut banks: BTreeMap<BankId, usize> = BTreeMap::new();
    if let Some(shape) = existing {
        let b = g::bbox(shape);
        for cell in survey.cells() {
            let p = cell.position;
            if p.x >= b.0 && p.x <= b.2 && p.y >= b.1 && p.y <= b.3 && g::contains(shape, p) {
                chosen.push(key(p));
            }
        }
    }
    let mut need = area - existing.map_or(0.0, g::area);
    let mut seed = None;
    for (cell, _) in costs.cells_by_cost() {
        if seed.is_none() {
            seed = Some(key(cell.position));
        }
        if need <= 0.0 {
            break;
        }
        if existing.is_some_and(|s| g::contains(s, cell.position)) {
            continue;
        }
        chosen.push(key(cell.position));
        if let Some(bank) = cell.bank_id {
            *banks.entry(bank).or_default() += 1;
        }
        need -= step * step;
    }
    let seed = seed.or_else(|| chosen.first().copied())?;
    let total: usize = banks.values().sum();
    let occupied: Vec<BankId> = banks
        .iter()
        .filter(|&(_, &n)| n as f64 >= OCCUPIED_BANK * total.max(1) as f64)
        .map(|(&b, _)| b)
        .collect();
    let closing = if occupied.len() >= 2 {
        (CHANNEL_SPAN * 0.5 / step).ceil() as i64
    } else {
        0
    };
    let mut grid = Occupancy::new(&chosen, closing + 2);
    if closing > 0 {
        grid.close(closing);
    }
    grid.keep_component(seed);
    grid.fill_holes();
    let ring = grid.outer_ring()?;
    let outer: Vec<Point> = ring
        .into_iter()
        .map(|(a, b)| Point {
            x: centre.x + (a as f64 - 0.5) * step,
            y: centre.y + (b as f64 - 0.5) * step,
        })
        .collect();
    let mut outline = g::normalized(Shape {
        outer,
        holes: vec![],
    });
    if let Some(shape) = existing {
        let joined = g::union(&[shape.clone(), outline.clone()]);
        let inside = g::interior_point(shape);
        if let Some(best) = joined.iter().find(|s| g::contains(s, inside)).or_else(|| {
            joined
                .iter()
                .max_by(|a, b| g::area(a).total_cmp(&g::area(b)))
        }) {
            outline = Shape {
                outer: best.outer.clone(),
                holes: vec![],
            };
        }
    }
    Some(Land {
        outline,
        banks: occupied,
    })
}

/// The outline of the survey cells at `cells` (their centres): the 4-connected component of
/// the cell nearest `seed`, holes filled. `None` when no cell is given.
pub fn cells_outline(survey: &Survey, cells: &[Point], seed: Point) -> Option<Shape> {
    let step = survey.cell_size();
    let centre = survey.center();
    let key = |p: Point| {
        (
            ((p.x - centre.x) / step).round() as i64,
            ((p.y - centre.y) / step).round() as i64,
        )
    };
    let chosen: Vec<(i64, i64)> = cells.iter().map(|&p| key(p)).collect();
    if chosen.is_empty() {
        return None;
    }
    let mut grid = Occupancy::new(&chosen, 2);
    grid.keep_component(key(seed));
    grid.fill_holes();
    let outer = grid
        .outer_ring()?
        .into_iter()
        .map(|(a, b)| Point {
            x: centre.x + (a as f64 - 0.5) * step,
            y: centre.y + (b as f64 - 0.5) * step,
        })
        .collect();
    Some(g::normalized(Shape {
        outer,
        holes: vec![],
    }))
}

/// Chosen cells on a local grid with a margin.
struct Occupancy {
    origin: (i64, i64),
    width: i64,
    height: i64,
    on: Vec<bool>,
}

impl Occupancy {
    fn new(cells: &[(i64, i64)], margin: i64) -> Self {
        let (mut x0, mut y0, mut x1, mut y1) = (i64::MAX, i64::MAX, i64::MIN, i64::MIN);
        for &(i, j) in cells {
            (x0, y0, x1, y1) = (x0.min(i), y0.min(j), x1.max(i), y1.max(j));
        }
        if cells.is_empty() {
            (x0, y0, x1, y1) = (0, 0, 0, 0);
        }
        let origin = (x0 - margin, y0 - margin);
        let (width, height) = (x1 - x0 + 1 + 2 * margin, y1 - y0 + 1 + 2 * margin);
        let mut grid = Self {
            origin,
            width,
            height,
            on: vec![false; (width * height) as usize],
        };
        for &(i, j) in cells {
            let k = grid.index(i, j).expect("inside the grid");
            grid.on[k] = true;
        }
        grid
    }

    fn index(&self, i: i64, j: i64) -> Option<usize> {
        let (x, y) = (i - self.origin.0, j - self.origin.1);
        (x >= 0 && y >= 0 && x < self.width && y < self.height)
            .then(|| (y * self.width + x) as usize)
    }

    fn get(&self, i: i64, j: i64) -> bool {
        self.index(i, j).is_some_and(|k| self.on[k])
    }

    /// Morphological closing by a square of half side `r` cells: channels up to `2 r` cells
    /// wide between chosen cells are filled.
    fn close(&mut self, r: i64) {
        self.filter(r, true);
        self.filter(r, false);
    }

    /// Dilation (`grow`) or erosion by a square of half side `r`, rows then columns.
    fn filter(&mut self, r: i64, grow: bool) {
        for pass in 0..2 {
            let source = self.on.clone();
            for y in 0..self.height {
                for x in 0..self.width {
                    let mut hit = !grow;
                    for d in -r..=r {
                        let (u, v) = if pass == 0 { (x + d, y) } else { (x, y + d) };
                        let value = u >= 0
                            && v >= 0
                            && u < self.width
                            && v < self.height
                            && source[(v * self.width + u) as usize];
                        if grow && value {
                            hit = true;
                            break;
                        }
                        if !grow && !value {
                            hit = false;
                            break;
                        }
                    }
                    self.on[(y * self.width + x) as usize] = hit;
                }
            }
        }
    }

    /// Keep the 4-connected component of `seed`, or of the chosen cell nearest it.
    fn keep_component(&mut self, seed: (i64, i64)) {
        let start = if self.get(seed.0, seed.1) {
            Some(seed)
        } else {
            (0..self.on.len())
                .filter(|&k| self.on[k])
                .map(|k| {
                    let k = k as i64;
                    (
                        self.origin.0 + k % self.width,
                        self.origin.1 + k / self.width,
                    )
                })
                .min_by_key(|&(i, j)| (i - seed.0).pow(2) + (j - seed.1).pow(2))
        };
        let mut kept = vec![false; self.on.len()];
        if let Some((i, j)) = start {
            let mut queue = VecDeque::from([(i, j)]);
            kept[self.index(i, j).expect("chosen cell")] = true;
            while let Some((i, j)) = queue.pop_front() {
                for (u, v) in [(i + 1, j), (i - 1, j), (i, j + 1), (i, j - 1)] {
                    if let Some(k) = self.index(u, v)
                        && self.on[k]
                        && !kept[k]
                    {
                        kept[k] = true;
                        queue.push_back((u, v));
                    }
                }
            }
        }
        self.on = kept;
    }

    /// Choose every free cell that the border cannot reach through free cells.
    fn fill_holes(&mut self) {
        let mut outside = vec![false; self.on.len()];
        let mut queue = VecDeque::new();
        for y in 0..self.height {
            for x in 0..self.width {
                if (x == 0 || y == 0 || x == self.width - 1 || y == self.height - 1)
                    && !self.on[(y * self.width + x) as usize]
                {
                    outside[(y * self.width + x) as usize] = true;
                    queue.push_back((x, y));
                }
            }
        }
        while let Some((x, y)) = queue.pop_front() {
            for (u, v) in [(x + 1, y), (x - 1, y), (x, y + 1), (x, y - 1)] {
                if u < 0 || v < 0 || u >= self.width || v >= self.height {
                    continue;
                }
                let k = (v * self.width + u) as usize;
                if !self.on[k] && !outside[k] {
                    outside[k] = true;
                    queue.push_back((u, v));
                }
            }
        }
        for k in 0..self.on.len() {
            self.on[k] = !outside[k];
        }
    }

    /// The largest boundary loop along cell sides, counter-clockwise, as cell-corner indices
    /// (corner `(a, b)` is the lower-left corner of cell `(a, b)`), collinear corners dropped.
    fn outer_ring(&self) -> Option<Vec<(i64, i64)>> {
        let mut out: HashMap<(i64, i64), Vec<(i64, i64)>> = HashMap::new();
        let mut sides = 0usize;
        for y in 0..self.height {
            for x in 0..self.width {
                if !self.on[(y * self.width + x) as usize] {
                    continue;
                }
                let (i, j) = (self.origin.0 + x, self.origin.1 + y);
                let mut side = |a: (i64, i64), b: (i64, i64)| {
                    out.entry(a).or_default().push(b);
                    sides += 1;
                };
                if !self.get(i, j - 1) {
                    side((i, j), (i + 1, j));
                }
                if !self.get(i + 1, j) {
                    side((i + 1, j), (i + 1, j + 1));
                }
                if !self.get(i, j + 1) {
                    side((i + 1, j + 1), (i, j + 1));
                }
                if !self.get(i - 1, j) {
                    side((i, j + 1), (i, j));
                }
            }
        }
        let mut starts: Vec<(i64, i64)> = out.keys().copied().collect();
        starts.sort_unstable();
        let mut best: Option<(i64, Vec<(i64, i64)>)> = None;
        for start in starts {
            while out.get(&start).is_some_and(|l| !l.is_empty()) {
                let mut ring = vec![start];
                let mut at = start;
                let mut came: Option<(i64, i64)> = None;
                for _ in 0..=sides {
                    let Some(list) = out.get_mut(&at) else { break };
                    if list.is_empty() {
                        break;
                    }
                    // At a corner two cells touch diagonally: turn left, keeping to one cell.
                    let pick = match came {
                        Some(d) if list.len() > 1 => (0..list.len())
                            .max_by_key(|&k| {
                                let e = (list[k].0 - at.0, list[k].1 - at.1);
                                d.0 * e.1 - d.1 * e.0
                            })
                            .unwrap_or(0),
                        _ => 0,
                    };
                    let next = list.swap_remove(pick);
                    came = Some((next.0 - at.0, next.1 - at.1));
                    at = next;
                    if at == start {
                        break;
                    }
                    ring.push(at);
                }
                let twice: i64 = (0..ring.len())
                    .map(|k| {
                        let (p, q) = (ring[k], ring[(k + 1) % ring.len()]);
                        p.0 * q.1 - q.0 * p.1
                    })
                    .sum();
                if best.as_ref().is_none_or(|(a, _)| twice.abs() > *a) {
                    best = Some((twice.abs(), ring));
                }
            }
        }
        let (_, ring) = best?;
        let n = ring.len();
        let kept: Vec<(i64, i64)> = (0..n)
            .filter(|&k| {
                let (a, p, b) = (ring[(k + n - 1) % n], ring[k], ring[(k + 1) % n]);
                (p.0 - a.0) * (b.1 - p.1) - (p.1 - a.1) * (b.0 - p.0) != 0
            })
            .map(|k| ring[k])
            .collect();
        (kept.len() >= 3).then_some(kept)
    }
}
