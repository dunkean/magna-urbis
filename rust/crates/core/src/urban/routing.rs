//! Local terrain routing for urban streets. Cultural fields suggest routes; this
//! module enforces water obstacles and longitudinal grades on the physical surface.
//! The anisotropic path cost follows the approach of Galin et al. (2010), without
//! changing the terrain or creating bridges. Existing regional crossings are owned
//! by the regional road network and are not passed through this dry-land router.
use super::{Point, Shape, Surface, geometry as g};
use std::cmp::Ordering;
use std::collections::BinaryHeap;

const DIRS: [(isize, isize); 16] = [
    (1, 0),
    (2, 1),
    (1, 1),
    (1, 2),
    (0, 1),
    (-1, 2),
    (-1, 1),
    (-2, 1),
    (-1, 0),
    (-2, -1),
    (-1, -1),
    (-1, -2),
    (0, -1),
    (1, -2),
    (1, -1),
    (2, -1),
];
const HEADINGS: usize = DIRS.len();
const NONE: usize = usize::MAX;
/// Route cost of one switchback hairpin, in metres of ordinary road.
const HAIRPIN: f64 = 45.0;

fn distance(a: Point, b: Point) -> f64 {
    (b.x - a.x).hypot(b.y - a.y)
}

fn lerp(a: Point, b: Point, t: f64) -> Point {
    Point {
        x: a.x + (b.x - a.x) * t,
        y: a.y + (b.y - a.y) * t,
    }
}

fn valid_surface(surface: Surface<'_>) -> bool {
    surface.n > 0
        && surface.width.is_finite()
        && surface.width > 0.0
        && surface.height.len() == surface.n * surface.n
        && surface.water.len() == surface.n * surface.n
}

fn on_map(surface: Surface<'_>, p: Point) -> bool {
    p.x.is_finite()
        && p.y.is_finite()
        && p.x >= 0.0
        && p.y >= 0.0
        && p.x < surface.width
        && p.y < surface.width
}

/// Visit intervals bounded by both water-cell edges and height interpolation
/// knots. On each interval bilinear height restricted to a line is a quadratic.
/// Its greatest absolute derivative is at one of the interval's endpoints; three
/// height samples therefore give the exact grade, including a hidden crest.
fn inspect_segment(surface: Surface<'_>, a: Point, b: Point, dry: bool) -> Option<f64> {
    if !valid_surface(surface) || !on_map(surface, a) || !on_map(surface, b) {
        return None;
    }
    if dry && surface.geometry.is_some_and(|g| !g.segment_dry(a, b)) {
        return None;
    }
    let distance = distance(a, b);
    if distance < 1e-8 {
        return (!dry || !surface.wet(a)).then_some(0.0);
    }
    let half = surface.width / surface.n as f64 * 0.5;
    let crossing = |origin: f64, delta: f64| {
        if delta.abs() < 1e-12 {
            return (f64::INFINITY, f64::INFINITY);
        }
        let k = if delta > 0.0 {
            (origin / half).floor() + 1.0
        } else {
            (origin / half).ceil() - 1.0
        };
        ((k * half - origin) / delta, half / delta.abs())
    };
    let (mut tx, sx) = crossing(a.x, b.x - a.x);
    let (mut ty, sy) = crossing(a.y, b.y - a.y);
    let mut t0 = 0.0;
    let mut h0 = surface.height_at(a);
    let mut steepest = 0.0_f64;
    while t0 < 1.0 {
        let t1 = tx.min(ty).min(1.0);
        let mid = lerp(a, b, (t0 + t1) * 0.5);
        if dry && surface.wet(mid) {
            return None;
        }
        let h1 = surface.height_at(lerp(a, b, t1));
        let hm = surface.height_at(mid);
        let run = (t1 - t0) * distance;
        if run > 1e-8 {
            let entry = (4.0 * hm - 3.0 * h0 - h1) / run;
            let exit = (3.0 * h1 + h0 - 4.0 * hm) / run;
            steepest = steepest.max(entry.abs()).max(exit.abs());
        }
        if !h0.is_finite() || !h1.is_finite() || !hm.is_finite() {
            return None;
        }
        if tx <= t1 + 1e-12 {
            tx += sx;
        }
        if ty <= t1 + 1e-12 {
            ty += sy;
        }
        t0 = t1;
        h0 = h1;
    }
    Some(steepest)
}

/// Greatest rise/run on the physical bilinear surface, not an endpoint average.
pub(super) fn segment_grade(surface: Surface<'_>, a: Point, b: Point) -> f64 {
    inspect_segment(surface, a, b, false).unwrap_or(f64::INFINITY)
}

/// Dry interiors and a hard longitudinal grade limit. Boundary endpoints may
/// touch a wet raster cell, but no positive-length interval may run inside it.
pub(super) fn segment_clear(surface: Surface<'_>, a: Point, b: Point, max_grade: f64) -> bool {
    inspect_segment(surface, a, b, true).is_some_and(|g| g <= max_grade + 1e-8)
}

pub(super) fn path_clear(surface: Surface<'_>, path: &[Point], max_grade: f64) -> bool {
    path.len() >= 2
        && path
            .windows(2)
            .all(|p| segment_clear(surface, p[0], p[1], max_grade))
}

/// Closed polygon membership lets existing road ends lie exactly on a town edge.
/// Intervals between crossings also catch thin holes and non-convex indentations.
fn inside(shape: &Shape, a: Point, b: Point) -> bool {
    let rings = || std::iter::once(&shape.outer).chain(shape.holes.iter());
    let contains = |p| {
        g::contains(shape, p)
            || rings().any(|ring| {
                ring.iter()
                    .zip(ring.iter().cycle().skip(1))
                    .take(ring.len())
                    .any(|(&a, &b)| g::distance(p, a, b).0 < 1e-6)
            })
    };
    if !contains(a) || !contains(b) {
        return false;
    }
    let mut cuts = vec![0.0, 1.0];
    for ring in rings() {
        for (&c, &d) in ring
            .iter()
            .zip(ring.iter().cycle().skip(1))
            .take(ring.len())
        {
            if let Some((t, _)) = g::segment_hit(a, b, c, d) {
                cuts.push(t.clamp(0.0, 1.0));
            }
        }
    }
    cuts.sort_by(f64::total_cmp);
    cuts.windows(2)
        .all(|t| contains(lerp(a, b, (t[0] + t[1]) * 0.5)))
}

#[derive(Clone, Copy)]
struct Slot {
    epoch: u32,
    cost: f64,
    parent: usize,
}

#[derive(Clone, Copy)]
struct Entry {
    estimate: f64,
    cost: f64,
    state: usize,
}
impl PartialEq for Entry {
    fn eq(&self, rhs: &Self) -> bool {
        self.estimate == rhs.estimate && self.state == rhs.state
    }
}
impl Eq for Entry {}
impl PartialOrd for Entry {
    fn partial_cmp(&self, rhs: &Self) -> Option<Ordering> {
        Some(self.cmp(rhs))
    }
}
impl Ord for Entry {
    fn cmp(&self, rhs: &Self) -> Ordering {
        rhs.estimate
            .total_cmp(&self.estimate)
            .then_with(|| rhs.state.cmp(&self.state))
    }
}

/// A shared, bounded local lattice. The maximum side is 161 nodes; edge grades
/// and obstacles are cached across primary routes and connector searches.
pub(super) struct RoutePlanner<'a> {
    adaptation: f64,
    surface: Surface<'a>,
    x0: f64,
    y0: f64,
    step: f64,
    nx: usize,
    ny: usize,
    grades: Vec<f64>,
    slots: Vec<Slot>,
    epoch: u32,
}
impl<'a> RoutePlanner<'a> {
    pub(super) fn new(surface: Surface<'a>, bounds: (f64, f64, f64, f64)) -> Self {
        let limit = (surface.width - 1e-6).max(0.0);
        let x0 = bounds.0.clamp(0.0, limit);
        let y0 = bounds.1.clamp(0.0, limit);
        let x1 = bounds.2.clamp(x0, limit);
        let y1 = bounds.3.clamp(y0, limit);
        let step = (surface.width / surface.n.max(1) as f64 * 0.4)
            .clamp(3.0, 8.0)
            .max(((x1 - x0).max(y1 - y0)) / 160.0);
        let nx = ((x1 - x0) / step).floor() as usize + 1;
        let ny = ((y1 - y0) / step).floor() as usize + 1;
        Self {
            adaptation: 0.0,
            surface,
            x0,
            y0,
            step,
            nx,
            ny,
            grades: vec![],
            slots: vec![],
            epoch: 0,
        }
    }

    fn cost(&self, length: f64, grade: f64, max_grade: f64) -> f64 {
        route_cost(length, grade, max_grade)
            + length * self.adaptation * 6.0 * (grade / max_grade).powi(2)
    }
    fn position(&self, cell: usize) -> Point {
        Point {
            x: self.x0 + (cell % self.nx) as f64 * self.step,
            y: self.y0 + (cell / self.nx) as f64 * self.step,
        }
    }

    fn anchors(&self, point: Point, max_grade: f64, shape: Option<&Shape>) -> Vec<(usize, f64)> {
        let x = ((point.x - self.x0) / self.step).round() as isize;
        let y = ((point.y - self.y0) / self.step).round() as isize;
        let mut out = vec![];
        for dy in -2..=2 {
            for dx in -2..=2 {
                let xx = x + dx;
                let yy = y + dy;
                if xx < 0 || yy < 0 || xx >= self.nx as isize || yy >= self.ny as isize {
                    continue;
                }
                let cell = yy as usize * self.nx + xx as usize;
                let p = self.position(cell);
                if shape.is_some_and(|shape| !inside(shape, point, p)) {
                    continue;
                }
                if let Some(grade) = inspect_segment(self.surface, point, p, true)
                    && grade <= max_grade + 1e-8
                {
                    out.push((cell, route_cost(distance(point, p), grade, max_grade)));
                }
            }
        }
        out
    }

    /// Connect exact endpoints over dry land. A failed search returns no road;
    /// callers may explicitly try a separate stair limit and tag that result.
    pub(super) fn set_adaptation(&mut self, value: f64) {
        self.adaptation = value;
    }

    pub(super) fn route(&mut self, start: Point, end: Point, max_grade: f64) -> Option<Vec<Point>> {
        self.route_inner(start, end, max_grade, None)
    }

    /// Reroute an existing urban corridor without searching outside its footprint.
    /// Water/grade caches are reusable; polygon-edge validity belongs to this call.
    pub(super) fn route_within(
        &mut self,
        start: Point,
        end: Point,
        max_grade: f64,
        shape: &Shape,
    ) -> Option<Vec<Point>> {
        self.route_inner(start, end, max_grade, Some(shape))
    }

    fn route_inner(
        &mut self,
        start: Point,
        end: Point,
        max_grade: f64,
        shape: Option<&Shape>,
    ) -> Option<Vec<Point>> {
        if !valid_surface(self.surface)
            || !on_map(self.surface, start)
            || !on_map(self.surface, end)
            || !max_grade.is_finite()
            || max_grade <= 0.0
        {
            return None;
        }
        if (self.adaptation == 0.0 || segment_grade(self.surface, start, end) < 0.015)
            && segment_clear(self.surface, start, end, max_grade)
            && shape.is_none_or(|shape| inside(shape, start, end))
        {
            return Some(vec![start, end]);
        }
        let origins = self.anchors(start, max_grade, shape);
        let goals = self.anchors(end, max_grade, shape);
        if origins.is_empty() || goals.is_empty() {
            return None;
        }
        if self.slots.is_empty() {
            // Most streets on level ground use the direct fast path and never
            // need the search lattice or its per-heading cache.
            let size = self.nx * self.ny * HEADINGS;
            self.grades.resize(size, f64::NAN);
            self.slots.resize(
                size,
                Slot {
                    epoch: 0,
                    cost: f64::INFINITY,
                    parent: NONE,
                },
            );
        }
        self.epoch = self.epoch.wrapping_add(1);
        if self.epoch == 0 {
            for slot in &mut self.slots {
                slot.epoch = 0;
            }
            self.epoch = 1;
        }
        let epoch = self.epoch;
        let mut constraint_edges = shape.map(|_| vec![0_u8; self.grades.len()]);
        let mut heap = BinaryHeap::new();
        // Initial directions are unconstrained at a junction. Subsequent states
        // retain incoming heading, so bend costs do not erase cheaper arrivals.
        for (cell, cost) in origins {
            for dir in 0..HEADINGS {
                let state = cell * HEADINGS + dir;
                self.slots[state] = Slot {
                    epoch,
                    cost,
                    parent: NONE,
                };
                heap.push(Entry {
                    estimate: cost + distance(self.position(cell), end),
                    cost,
                    state,
                });
            }
        }
        let mut tails = vec![f64::INFINITY; self.nx * self.ny];
        for (cell, cost) in goals {
            tails[cell] = cost;
        }
        let mut best = (f64::INFINITY, NONE);
        while let Some(entry) = heap.pop() {
            if entry.estimate >= best.0 {
                break;
            }
            if entry.cost > self.slots[entry.state].cost {
                continue;
            }
            let cell = entry.state / HEADINGS;
            if entry.cost + tails[cell] < best.0 {
                best = (entry.cost + tails[cell], entry.state);
            }
            let incoming = DIRS[entry.state % HEADINGS];
            let x = (cell % self.nx) as isize;
            let y = (cell / self.nx) as isize;
            for (dir, &(dx, dy)) in DIRS.iter().enumerate() {
                let (xx, yy) = (x + dx, y + dy);
                if xx < 0 || yy < 0 || xx >= self.nx as isize || yy >= self.ny as isize {
                    continue;
                }
                let cosine = (incoming.0 * dx + incoming.1 * dy) as f64
                    / (((incoming.0 * incoming.0 + incoming.1 * incoming.1) * (dx * dx + dy * dy))
                        as f64)
                        .sqrt();
                // Allow a tight switchback on a uniformly steep flank; forcing
                // a wider bend would require an over-grade uphill segment.
                if cosine < -0.71 {
                    continue;
                }
                let next = yy as usize * self.nx + xx as usize;
                let edge = cell * HEADINGS + dir;
                if let (Some(shape), Some(valid)) = (shape, constraint_edges.as_mut()) {
                    if valid[edge] == 0 {
                        let value = if inside(shape, self.position(cell), self.position(next)) {
                            1
                        } else {
                            2
                        };
                        valid[edge] = value;
                        valid[next * HEADINGS + (dir + HEADINGS / 2) % HEADINGS] = value;
                    }
                    if valid[edge] == 2 {
                        continue;
                    }
                }
                let grade = if self.grades[edge].is_nan() {
                    let grade = inspect_segment(
                        self.surface,
                        self.position(cell),
                        self.position(next),
                        true,
                    )
                    .unwrap_or(f64::INFINITY);
                    self.grades[edge] = grade;
                    // Opposite directions use identical obstacles and grades.
                    self.grades[next * HEADINGS + (dir + HEADINGS / 2) % HEADINGS] = grade;
                    grade
                } else {
                    self.grades[edge]
                };
                if grade > max_grade + 1e-8 {
                    continue;
                }
                let length = self.step * ((dx * dx + dy * dy) as f64).sqrt();
                // A hairpin is a built structure (retaining wall, turning
                // space): it costs a fixed run of road, so a climb uses few
                // hairpins and long legs instead of a lattice-sized sawtooth.
                let hairpin = if cosine < -0.1 { HAIRPIN } else { 0.0 };
                let bend = self.step * 0.35 * (1.0 - cosine).powi(2) + hairpin;
                let cost = entry.cost + self.cost(length, grade, max_grade) + bend;
                let state = next * HEADINGS + dir;
                if self.slots[state].epoch != epoch || cost < self.slots[state].cost {
                    self.slots[state] = Slot {
                        epoch,
                        cost,
                        parent: entry.state,
                    };
                    heap.push(Entry {
                        estimate: cost + distance(self.position(next), end),
                        cost,
                        state,
                    });
                }
            }
        }
        if best.1 == NONE {
            return None;
        }
        let mut path = vec![end];
        let mut state = best.1;
        while state != NONE {
            path.push(self.position(state / HEADINGS));
            state = self.slots[state].parent;
        }
        path.push(start);
        path.reverse();
        path.dedup_by(|a, b| distance(*a, *b) < 1e-8);
        let mut simplified = vec![start];
        let mut i = 0;
        while i + 1 < path.len() {
            let mut j = (i + 24).min(path.len() - 1);
            while j > i + 1
                && (!segment_clear(self.surface, path[i], path[j], max_grade)
                    || shape.is_some_and(|shape| !inside(shape, path[i], path[j]))
                    || self.adaptation > 0.0
                        && self.cost(
                            distance(path[i], path[j]),
                            segment_grade(self.surface, path[i], path[j]),
                            max_grade,
                        ) > path[i..=j]
                            .windows(2)
                            .map(|p| {
                                self.cost(
                                    distance(p[0], p[1]),
                                    segment_grade(self.surface, p[0], p[1]),
                                    max_grade,
                                )
                            })
                            .sum::<f64>()
                            * 1.05)
            {
                j -= 1;
            }
            simplified.push(path[j]);
            i = j;
        }
        // Round the lattice corners (staircase steps, 45° kinks) by corner
        // cutting, keeping each cut only where the new legs stay dry, within
        // the grade limit and inside the corridor. Hairpins keep their apex.
        for _ in 0..2 {
            let mut rounded = vec![simplified[0]];
            for k in 1..simplified.len().saturating_sub(1) {
                let (a, v, b) = (simplified[k - 1], simplified[k], simplified[k + 1]);
                let (la, lb) = (distance(a, v), distance(v, b));
                let cosine =
                    ((v.x - a.x) * (b.x - v.x) + (v.y - a.y) * (b.y - v.y)) / (la * lb).max(1e-9);
                let cut = (la.min(lb) * 0.3).min(25.0);
                let p = lerp(v, a, cut / la.max(1e-9));
                let q = lerp(v, b, cut / lb.max(1e-9));
                let last = *rounded.last().unwrap();
                let valid = cosine < 0.97
                    && cosine > -0.1
                    && cut > 1.0
                    && [(last, p), (p, q), (q, b)].iter().all(|&(x, y)| {
                        segment_clear(self.surface, x, y, max_grade)
                            && shape.is_none_or(|shape| inside(shape, x, y))
                    });
                if valid {
                    rounded.push(p);
                    rounded.push(q);
                } else {
                    rounded.push(v);
                }
            }
            if let Some(&end) = simplified.last() {
                rounded.push(end);
            }
            simplified = rounded;
        }
        debug_assert!(path_clear(self.surface, &simplified, max_grade));
        debug_assert!(
            shape.is_none_or(|shape| simplified.windows(2).all(|p| inside(shape, p[0], p[1])))
        );
        Some(simplified)
    }
}

fn route_cost(length: f64, grade: f64, max_grade: f64) -> f64 {
    length * (1.0 + 3.0 * (grade / max_grade).powi(2))
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn adaptation_keeps_a_cheaper_contour_detour_even_when_direct_grade_is_legal() {
        let n = 65;
        let width = 520.0;
        let height: Vec<_> = (0..n * n)
            .map(|i| {
                let x = (i % n) as f64 * width / n as f64 + 4.0 - 260.0;
                let y = (i / n) as f64 * width / n as f64 + 4.0 - 260.0;
                (20.0 + 30.0 * (-(x * x + y * y) / 10000.0).exp()) as f32
            })
            .collect();
        let water = vec![0; height.len()];
        let surface = Surface {
            geometry: None,
            width,
            n,
            height: &height,
            water: &water,
        };
        let a = Point { x: 70.0, y: 260.0 };
        let b = Point { x: 450.0, y: 260.0 };
        let mut planner = RoutePlanner::new(surface, (30.0, 30.0, 490.0, 490.0));
        assert_eq!(planner.route(a, b, 0.3).unwrap().len(), 2);
        planner.set_adaptation(1.0);
        let path = planner.route(a, b, 0.3).unwrap();
        assert!(path.iter().any(|p| (p.y - 260.0).abs() > 40.0), "{path:?}");
        let cost: f64 = path
            .windows(2)
            .map(|p| {
                planner.cost(
                    distance(p[0], p[1]),
                    segment_grade(surface, p[0], p[1]),
                    0.3,
                )
            })
            .sum();
        assert!(cost < planner.cost(distance(a, b), segment_grade(surface, a, b), 0.3));
        assert!(path_clear(surface, &path, 0.3));
    }

    #[test]
    fn grade_detects_crest_and_bilinear_derivative() {
        let height = [0.0, 10.0, 0.0, 0.0, 10.0, 0.0, 0.0, 10.0, 0.0];
        let surface = Surface {
            geometry: None,
            width: 30.0,
            n: 3,
            height: &height,
            water: &[0; 9],
        };
        let a = Point { x: 5.0, y: 15.0 };
        let b = Point { x: 25.0, y: 15.0 };
        assert!((segment_grade(surface, a, b) - 1.0).abs() < 1e-9);
        assert!(!segment_clear(surface, a, b, 0.15));

        let surface = Surface {
            geometry: None,
            width: 20.0,
            n: 2,
            height: &[0.0, 0.0, 0.0, 10.0],
            water: &[0; 4],
        };
        let a = Point { x: 5.0, y: 5.0 };
        let b = Point { x: 15.0, y: 15.0 };
        assert!((segment_grade(surface, a, b) - 2.0_f64.sqrt()).abs() < 1e-9);
    }

    #[test]
    fn routes_around_water_without_corner_cutting_and_keeps_endpoints() {
        let n = 40;
        let height = vec![0.0; n * n];
        let mut water = vec![0; n * n];
        for y in 12..28 {
            for x in 18..22 {
                water[y * n + x] = 1;
            }
        }
        let surface = Surface {
            geometry: None,
            width: 200.0,
            n,
            height: &height,
            water: &water,
        };
        let a = Point { x: 50.3, y: 100.2 };
        let b = Point { x: 149.1, y: 101.7 };
        let mut planner = RoutePlanner::new(surface, (0.0, 0.0, 200.0, 200.0));
        let route = planner.route(a, b, 0.12).unwrap();
        assert!(route.len() > 2);
        assert_eq!(route[0].x, a.x);
        assert_eq!(route[0].y, a.y);
        assert_eq!(route.last().unwrap().x, b.x);
        assert_eq!(route.last().unwrap().y, b.y);
        assert!(path_clear(surface, &route, 0.12));
        assert_eq!(
            serde_json::to_string(&route).unwrap(),
            serde_json::to_string(&planner.route(a, b, 0.12).unwrap()).unwrap()
        );
        // A long diagonal barely entering a wet corner must also be rejected.
        assert!(!segment_clear(
            surface,
            Point { x: 80.0, y: 50.0 },
            Point { x: 110.1, y: 80.0 },
            0.12
        ));
    }

    #[test]
    fn steep_terrain_needs_a_longer_route_or_explicit_stair_limit() {
        let n = 48;
        let height: Vec<_> = (0..n * n).map(|i| (i % n) as f32 * 5.0 * 0.24).collect();
        let water = vec![0; n * n];
        let surface = Surface {
            geometry: None,
            width: 240.0,
            n,
            height: &height,
            water: &water,
        };
        let a = Point { x: 80.0, y: 120.0 };
        let b = Point { x: 120.0, y: 120.0 };
        let mut planner = RoutePlanner::new(surface, (20.0, 20.0, 220.0, 220.0));
        let road = planner.route(a, b, 0.12).unwrap();
        assert!(path_clear(surface, &road, 0.12));
        assert!(road.windows(2).map(|p| distance(p[0], p[1])).sum::<f64>() > 80.0);
        let stairs = planner.route(a, b, 0.5).unwrap();
        assert_eq!(stairs.len(), 2);
        assert!(!path_clear(surface, &stairs, 0.12));
    }

    #[test]
    fn continuous_water_barrier_has_no_dry_route() {
        let n = 32;
        let height = vec![0.0; n * n];
        let mut water = vec![0; n * n];
        for y in 0..n {
            water[y * n + 16] = 3;
        }
        let surface = Surface {
            geometry: None,
            width: 160.0,
            n,
            height: &height,
            water: &water,
        };
        let mut planner = RoutePlanner::new(surface, (30.0, 30.0, 130.0, 130.0));
        assert!(
            planner
                .route(Point { x: 60.0, y: 80.0 }, Point { x: 100.0, y: 80.0 }, 0.2)
                .is_none()
        );
    }

    #[test]
    fn constrained_route_respects_holes_concavity_and_boundary_endpoints() {
        let n = 64;
        let height = vec![0.0; n * n];
        let water = vec![0; n * n];
        let surface = Surface {
            geometry: None,
            width: 256.0,
            n,
            height: &height,
            water: &water,
        };
        let mut planner = RoutePlanner::new(surface, (0.0, 0.0, 256.0, 256.0));
        let mut region = g::rectangle(20.0, 20.0, 220.0, 220.0);
        region
            .holes
            .push(g::rectangle(90.0, 40.0, 110.0, 150.0).outer);
        let a = Point { x: 20.0, y: 80.0 };
        let b = Point { x: 220.0, y: 80.0 };
        assert_eq!(planner.route(a, b, 0.12).unwrap().len(), 2);
        let path = planner.route_within(a, b, 0.12, &region).unwrap();
        assert!(path.len() > 2);
        assert!(path.windows(2).all(|p| inside(&region, p[0], p[1])));
        assert_eq!(path[0].x, a.x);
        assert_eq!(path.last().unwrap().x, b.x);
        // Shape validity is per query and never poisons physical edge caches.
        assert_eq!(planner.route(a, b, 0.12).unwrap().len(), 2);
        let concave = Shape {
            outer: vec![
                Point { x: 20.0, y: 20.0 },
                Point { x: 220.0, y: 20.0 },
                Point { x: 220.0, y: 220.0 },
                Point { x: 140.0, y: 220.0 },
                Point { x: 140.0, y: 70.0 },
                Point { x: 100.0, y: 70.0 },
                Point { x: 100.0, y: 220.0 },
                Point { x: 20.0, y: 220.0 },
            ],
            holes: vec![],
        };
        let path = planner
            .route_within(
                Point { x: 60.0, y: 180.0 },
                Point { x: 180.0, y: 180.0 },
                0.12,
                &concave,
            )
            .unwrap();
        assert!(path.iter().any(|p| p.y <= 70.0));
        assert!(path.windows(2).all(|p| inside(&concave, p[0], p[1])));

        let mut water = water.clone();
        for y in 0..50 {
            for x in 23..28 {
                water[y * n + x] = 3;
            }
        }
        let surface = Surface {
            water: &water,
            ..surface
        };
        let mut planner = RoutePlanner::new(surface, (0.0, 0.0, 256.0, 256.0));
        let limited = g::rectangle(20.0, 20.0, 220.0, 180.0);
        assert!(
            planner.route(a, b, 0.12).is_some(),
            "dry detour exists below the river end"
        );
        assert!(
            planner.route_within(a, b, 0.12, &limited).is_none(),
            "detour must not leave the footprint"
        );
    }
}
