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

pub(super) struct Profile(Option<std::time::Instant>, &'static str);
impl Profile {
    pub(super) fn new(label: &'static str) -> Self {
        let enabled = std::env::var_os("URBAN_PROFILE").is_some();
        #[cfg(test)]
        let enabled = enabled || bridge_timing::active();
        Self(enabled.then(std::time::Instant::now), label)
    }
}
impl Drop for Profile {
    fn drop(&mut self) {
        if let Some(start) = self.0 {
            let elapsed = start.elapsed();
            #[cfg(test)]
            bridge_timing::add(elapsed);
            if std::env::var_os("URBAN_PROFILE").is_some() {
                eprintln!("  {}: {:.3}s", self.1, elapsed.as_secs_f64());
            }
        }
    }
}

#[cfg(test)]
pub(super) mod bridge_timing {
    use std::{cell::Cell, time::Duration};
    thread_local! { static TIME: Cell<Option<(Duration, usize)>> = const { Cell::new(None) }; }
    pub(super) fn active() -> bool { TIME.with(|t| t.get().is_some()) }
    pub(super) fn add(elapsed: Duration) {
        TIME.with(|t| { if let Some((total, calls)) = t.get() { t.set(Some((total + elapsed, calls + 1))); } });
    }
    pub(in crate::urban) fn measure<R>(f: impl FnOnce() -> R) -> (R, Duration, usize) {
        TIME.with(|t| t.set(Some((Duration::ZERO, 0))));
        let result = f();
        let (elapsed, calls) = TIME.with(|t| t.take().unwrap());
        (result, elapsed, calls)
    }
}

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

/// Wet intervals, including water between two dry vertices. Keep the exact
/// raster-cell boundaries; vector channels are sampled then bisected.
pub(super) fn water_intervals(surface: Surface<'_>, a: Point, b: Point) -> Vec<(f64, f64)> {
    if segment_clear(surface, a, b, f64::INFINITY) { return vec![]; }
    let len = distance(a, b);
    if len < 1e-8 { return vec![]; }
    let mut cuts = vec![0.0, 1.0];
    let cell = surface.width / surface.n as f64;
    for (start, delta) in [(a.x, b.x - a.x), (a.y, b.y - a.y)] {
        if delta.abs() < 1e-9 { continue; }
        let lo = start.min(start + delta); let hi = start.max(start + delta);
        for k in (lo / cell).floor() as i64 + 1..=(hi / cell).floor() as i64 {
            let t = (k as f64 * cell - start) / delta;
            if t > 0.0 && t < 1.0 { cuts.push(t); }
        }
    }
    if surface.geometry.is_some() {
        let steps = (len / (cell * 0.1).clamp(0.25, 0.5)).ceil() as usize;
        let mut last = surface.wet(a);
        for k in 1..=steps {
            let t = k as f64 / steps as f64;
            let wet = surface.wet(lerp(a, b, t));
            if wet != last {
                let (mut lo, mut hi) = ((k - 1) as f64 / steps as f64, t);
                for _ in 0..16 { let m = (lo + hi) * 0.5;
                    if surface.wet(lerp(a, b, m)) == last { lo = m; } else { hi = m; }
                }
                cuts.push((lo + hi) * 0.5);
            }
            last = wet;
        }
    }
    cuts.sort_by(f64::total_cmp); cuts.dedup_by(|a, b| (*a - *b).abs() < 1e-10);
    let mut runs: Vec<(f64, f64)> = vec![];
    for w in cuts.windows(2) {
        if surface.wet(lerp(a, b, (w[0] + w[1]) * 0.5)) {
            if let Some(last) = runs.last_mut().filter(|last| (last.1 - w[0]).abs() < 1e-9) { last.1 = w[1]; }
            else { runs.push((w[0], w[1])); }
        }
    }
    runs
}

/// Closed polygon membership lets existing road ends lie exactly on a town edge.
/// Intervals between crossings also catch thin holes and non-convex indentations.
/// The ring edges are binned once per shape; every test visits nearby edges only.
struct InsideIndex<'s> {
    shape: &'s Shape,
    /// Outer-ring edges, then each hole's, in ring order.
    edges: Vec<(Point, Point)>,
    x0: f64,
    y0: f64,
    cell: f64,
    n: usize,
    cells: Vec<Vec<u32>>,
    /// Per-ring parity indexes (outer first, then holes), exact like `g::contains`.
    rings: Vec<g::ContainmentIndex>,
}
impl<'s> InsideIndex<'s> {
    const PAD: f64 = 1e-3;
    fn new(shape: &'s Shape) -> Self {
        let mut edges = vec![];
        for ring in std::iter::once(&shape.outer).chain(shape.holes.iter()) {
            edges.extend(
                ring.iter()
                    .zip(ring.iter().cycle().skip(1))
                    .take(ring.len())
                    .map(|(&a, &b)| (a, b)),
            );
        }
        let (mut x0, mut y0, mut x1, mut y1) =
            (f64::INFINITY, f64::INFINITY, f64::NEG_INFINITY, f64::NEG_INFINITY);
        for &(a, b) in &edges {
            x0 = x0.min(a.x.min(b.x));
            y0 = y0.min(a.y.min(b.y));
            x1 = x1.max(a.x.max(b.x));
            y1 = y1.max(a.y.max(b.y));
        }
        if edges.is_empty() {
            (x0, y0, x1, y1) = (0.0, 0.0, 0.0, 0.0);
        }
        let n = ((edges.len() as f64).sqrt() as usize).clamp(1, 48);
        let (x0, y0) = (x0 - Self::PAD, y0 - Self::PAD);
        let cell = ((x1 + Self::PAD - x0).max(y1 + Self::PAD - y0) / n as f64).max(1e-6);
        let mut me = Self {
            shape,
            edges,
            x0,
            y0,
            cell,
            n,
            cells: vec![vec![]; n * n],
            rings: std::iter::once(&shape.outer)
                .chain(shape.holes.iter())
                .map(|r| {
                    g::ContainmentIndex::new(&Shape {
                        outer: r.clone(),
                        holes: vec![],
                    })
                })
                .collect(),
        };
        for i in 0..me.edges.len() {
            let (a, b) = me.edges[i];
            let (cx0, cx1, cy0, cy1) = me.range(a, b);
            for cy in cy0..=cy1 {
                for cx in cx0..=cx1 {
                    me.cells[cy * n + cx].push(i as u32);
                }
            }
        }
        me
    }
    fn range(&self, a: Point, b: Point) -> (usize, usize, usize, usize) {
        let c = |v: f64, o: f64| (((v - o) / self.cell).floor().max(0.0) as usize).min(self.n - 1);
        (
            c(a.x.min(b.x) - Self::PAD, self.x0),
            c(a.x.max(b.x) + Self::PAD, self.x0),
            c(a.y.min(b.y) - Self::PAD, self.y0),
            c(a.y.max(b.y) + Self::PAD, self.y0),
        )
    }
    fn near(&self, a: Point, b: Point, out: &mut Vec<u32>) {
        out.clear();
        let (cx0, cx1, cy0, cy1) = self.range(a, b);
        for cy in cy0..=cy1 {
            for cx in cx0..=cx1 {
                out.extend_from_slice(&self.cells[cy * self.n + cx]);
            }
        }
        out.sort_unstable();
        out.dedup();
    }
    fn strictly(&self, p: Point) -> bool {
        self.rings[0].contains(p) && !self.rings[1..].iter().any(|h| h.contains(p))
    }
    fn contains(&self, p: Point, scratch: &mut Vec<u32>) -> bool {
        if self.strictly(p) {
            return true;
        }
        self.near(p, p, scratch);
        scratch.iter().any(|&i| {
            let (a, b) = self.edges[i as usize];
            g::distance(p, a, b).0 < 1e-6
        })
    }
    fn inside(&self, a: Point, b: Point) -> bool {
        let mut scratch = vec![];
        if !self.contains(a, &mut scratch) || !self.contains(b, &mut scratch) {
            return false;
        }
        let mut cuts = vec![0.0, 1.0];
        self.near(a, b, &mut scratch);
        for &i in &scratch {
            let (c, d) = self.edges[i as usize];
            if let Some((t, _)) = g::segment_hit(a, b, c, d) {
                cuts.push(t.clamp(0.0, 1.0));
            }
        }
        cuts.sort_by(f64::total_cmp);
        let mut scratch = scratch;
        cuts.windows(2)
            .all(|t| self.contains(lerp(a, b, (t[0] + t[1]) * 0.5), &mut scratch))
    }
}
#[cfg(test)]
fn inside(shape: &Shape, a: Point, b: Point) -> bool {
    InsideIndex::new(shape).inside(a, b)
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

/// A bounded local lattice; bank connectors refine below city-block scale.
/// Edge grades and obstacles are cached across routes and connector searches.
pub(super) struct RoutePlanner<'a> {
    adaptation: f64,
    seam: f64,
    bank: bool,
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
            seam: 0.0,
            bank: false,
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

    /// Narrow bank paths and quay access need a finer lattice than city blocks.
    pub(super) fn bank(surface: Surface<'a>, bounds: (f64, f64, f64, f64)) -> Self {
        let mut route = Self::new(surface, bounds);
        route.bank = true;
        route.step = (surface.width / surface.n as f64 * 0.2).clamp(0.5, 1.5)
            .max((bounds.2 - bounds.0).max(bounds.3 - bounds.1) / 384.0);
        route.nx = ((bounds.2.min(surface.width) - route.x0) / route.step).floor() as usize + 1;
        route.ny = ((bounds.3.min(surface.width) - route.y0) / route.step).floor() as usize + 1;
        route
    }

    /// Constructed bank ramps may span sub-cell vector seams, never a channel.
    pub(super) fn raised_bank(surface: Surface<'a>, bounds: (f64, f64, f64, f64)) -> Self {
        let mut route = Self::bank(surface, bounds);
        route.seam = (surface.width / surface.n as f64 * 0.25).min(1.0);
        route
    }

    fn inspect(&self, a: Point, b: Point) -> Option<f64> {
        inspect_segment(self.surface, a, b, true).or_else(|| {
            if self.seam <= 0.0 || self.surface.wet(a) || self.surface.wet(b) { return None; }
            let wet: f64 = water_intervals(self.surface, a, b).iter().map(|&(lo, hi)| (hi - lo) * distance(a, b)).sum();
            (wet <= self.seam).then(|| inspect_segment(self.surface, a, b, false)).flatten()
        })
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

    fn edge_grade(&mut self, cell: usize, next: usize, dir: usize) -> f64 {
        let edge = cell * HEADINGS + dir;
        if self.grades[edge].is_nan() {
            let grade = self.inspect(self.position(cell), self.position(next)).unwrap_or(f64::INFINITY);
            self.grades[edge] = grade;
            self.grades[next * HEADINGS + (dir + HEADINGS / 2) % HEADINGS] = grade;
        }
        self.grades[edge]
    }

    // A wrong-bank ramp has no path. Prove that on cells before expanding
    // sixteen incoming headings at every reachable cell. Ignoring turns is
    // conservative: it can admit a search, never reject a possible route.
    fn connected(&mut self, origins: &[(usize, f64)], goals: &[(usize, f64)], max_grade: f64) -> bool {
        let mut seen = vec![0_u8; self.nx * self.ny];
        for &(cell, _) in goals { seen[cell] = 2; }
        let mut stack = vec![];
        for &(cell, _) in origins {
            if seen[cell] == 2 { return true; }
            seen[cell] = 1; stack.push(cell);
        }
        while let Some(cell) = stack.pop() {
            let (x, y) = ((cell % self.nx) as isize, (cell / self.nx) as isize);
            for (dir, &(dx, dy)) in DIRS.iter().enumerate() {
                let (xx, yy) = (x + dx, y + dy);
                if xx < 0 || yy < 0 || xx >= self.nx as isize || yy >= self.ny as isize { continue; }
                let next = yy as usize * self.nx + xx as usize;
                if seen[next] == 1 || self.edge_grade(cell, next, dir) > max_grade + 1e-8 { continue; }
                if seen[next] == 2 { return true; }
                seen[next] = 1; stack.push(next);
            }
        }
        false
    }

    fn anchors(&self, point: Point, max_grade: f64, shape: Option<&InsideIndex<'_>>) -> Vec<(usize, f64)> {
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
                if shape.is_some_and(|shape| !shape.inside(point, p)) {
                    continue;
                }
                if let Some(grade) = self.inspect(point, p)
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
        let index = shape.map(InsideIndex::new);
        let shape = index.as_ref();
        if !valid_surface(self.surface)
            || !on_map(self.surface, start)
            || !on_map(self.surface, end)
            || !max_grade.is_finite()
            || max_grade <= 0.0
        {
            return None;
        }
        if (self.adaptation == 0.0 || segment_grade(self.surface, start, end) < 0.015)
            && self.inspect(start, end).is_some_and(|g| g <= max_grade)
            && shape.is_none_or(|shape| shape.inside(start, end))
        {
            return Some(vec![start, end]);
        }
        let origins = self.anchors(start, max_grade, shape);
        let goals = self.anchors(end, max_grade, shape);
        if origins.is_empty() || goals.is_empty() {
            return None;
        }
        if self.grades.is_empty() {
            self.grades.resize(self.nx * self.ny * HEADINGS, f64::NAN);
        }
        if self.bank && !self.connected(&origins, &goals, max_grade) { return None; }
        if self.slots.is_empty() {
            // Most streets on level ground use the direct fast path and never
            // need the search lattice or its per-heading cache.
            let size = self.nx * self.ny * HEADINGS;
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
                        let value = if shape.inside(self.position(cell), self.position(next)) {
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
                let grade = self.edge_grade(cell, next, dir);
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
                    || shape.is_some_and(|shape| !shape.inside(path[i], path[j]))
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
                            && shape.is_none_or(|shape| shape.inside(x, y))
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
        debug_assert!(simplified.windows(2).all(|p| self.inspect(p[0], p[1]).is_some_and(|g| g <= max_grade + 1e-8)));
        debug_assert!(
            shape.is_none_or(|shape| simplified.windows(2).all(|p| shape.inside(p[0], p[1])))
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
    fn bank_connectivity_preserves_routes_and_rejects_barriers_before_heading_search() {
        let n = 48;
        let height = vec![0.0; n * n];
        let (a, b) = (Point { x: 24.0, y: 48.0 }, Point { x: 68.0, y: 48.0 });
        for closed in [false, true] {
            let water: Vec<_> = (0..n * n).map(|i| u8::from((22..26).contains(&(i % n)) && (closed || i / n < 34))).collect();
            let surface = Surface { geometry: None, width: 96.0, n, height: &height, water: &water };
            for raised in [false, true] {
                let mut planner = if raised { RoutePlanner::raised_bank(surface, (8.0, 8.0, 88.0, 88.0)) }
                    else { RoutePlanner::bank(surface, (8.0, 8.0, 88.0, 88.0)) };
                let mut original = if raised { RoutePlanner::raised_bank(surface, (8.0, 8.0, 88.0, 88.0)) }
                    else { RoutePlanner::bank(surface, (8.0, 8.0, 88.0, 88.0)) };
                original.bank = false;
                for grade in [0.12, 1e6] {
                    let path = planner.route(a, b, grade);
                    assert_eq!(path, original.route(a, b, grade));
                    assert_eq!(path.is_none(), closed);
                    if closed { assert!(planner.slots.is_empty(), "disconnected banks expanded heading states"); }
                }
            }
        }
    }

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
