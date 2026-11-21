//! Coordinate keys, neighbourhood indexes, and segment intersection queries.

use crate::urban::Point;

pub(in crate::urban) type Key = (i64, i64);
pub(in crate::urban) const EPS: f64 = 1e-6;

pub(in crate::urban) fn key(p: Point) -> Key {
    (
        (p.x * 10000.0).round() as i64,
        (p.y * 10000.0).round() as i64,
    )
}
pub(super) fn distance(a: Point, b: Point) -> f64 {
    (b.x - a.x).hypot(b.y - a.y)
}
pub(super) fn lerp(a: Point, b: Point, t: f64) -> Point {
    Point {
        x: a.x + (b.x - a.x) * t,
        y: a.y + (b.y - a.y) * t,
    }
}

/// Uniform grid over axis-aligned boxes: the boxes that may touch a query box,
/// in ascending index order. It is only a conservative pre-filter (a returned
/// box need not touch the query, a box that touches it is always returned), so
/// a scan that walked every box in order and applied an exact test gives the
/// same result when it walks the returned indices and applies the same test.
/// Boxes that are empty or not finite are never returned.
pub(super) struct BoxGrid {
    cell: f64,
    x0: f64,
    y0: f64,
    nx: usize,
    ny: usize,
    cells: Vec<Vec<u32>>,
    /// Boxes spanning too many cells to be listed in each: returned by every query.
    wide: Vec<u32>,
}
impl BoxGrid {
    /// Slack added to every query side, so that a test written as
    /// `p >= lo - reach` and a box query written as `lo <= p + reach` agree.
    const SLACK: f64 = 1e-6;
    pub(super) fn new(boxes: &[(f64, f64, f64, f64)], cell: f64) -> Self {
        let valid = |b: &(f64, f64, f64, f64)| b.0.is_finite() && b.1.is_finite() && b.2.is_finite() && b.3.is_finite() && b.0 <= b.2 && b.1 <= b.3;
        let (mut x0, mut y0, mut x1, mut y1) = (f64::INFINITY, f64::INFINITY, f64::NEG_INFINITY, f64::NEG_INFINITY);
        for b in boxes.iter().filter(|b| valid(b)) {
            x0 = x0.min(b.0); y0 = y0.min(b.1); x1 = x1.max(b.2); y1 = y1.max(b.3);
        }
        if !x0.is_finite() {
            return Self { cell, x0: 0.0, y0: 0.0, nx: 0, ny: 0, cells: vec![], wide: vec![] };
        }
        let mut cell = cell.max(1e-3);
        while ((x1 - x0) / cell).floor() * ((y1 - y0) / cell).floor() > 262_144.0 { cell *= 2.0; }
        let nx = ((x1 - x0) / cell).floor() as usize + 1;
        let ny = ((y1 - y0) / cell).floor() as usize + 1;
        let mut grid = Self { cell, x0, y0, nx, ny, cells: vec![vec![]; nx * ny], wide: vec![] };
        for (i, b) in boxes.iter().enumerate().filter(|(_, b)| valid(b)) {
            let ((c0, c1), (r0, r1)) = (grid.columns(b.0, b.2), grid.rows(b.1, b.3));
            if (c1 - c0 + 1) * (r1 - r0 + 1) > 256 { grid.wide.push(i as u32); continue; }
            for r in r0..=r1 { for c in c0..=c1 { grid.cells[r * nx + c].push(i as u32); } }
        }
        grid
    }
    fn columns(&self, lo: f64, hi: f64) -> (usize, usize) {
        let at = |v: f64| (((v - self.x0) / self.cell).floor().max(0.0) as usize).min(self.nx - 1);
        (at(lo), at(hi))
    }
    fn rows(&self, lo: f64, hi: f64) -> (usize, usize) {
        let at = |v: f64| (((v - self.y0) / self.cell).floor().max(0.0) as usize).min(self.ny - 1);
        (at(lo), at(hi))
    }
    /// Indices of the boxes that may touch `[x0, x1] x [y0, y1]`, ascending, without repeats.
    pub(super) fn query(&self, x0: f64, y0: f64, x1: f64, y1: f64) -> Vec<usize> {
        let mut out: Vec<usize> = self.wide.iter().map(|&i| i as usize).collect();
        if self.nx > 0 {
            let ((c0, c1), (r0, r1)) = (self.columns(x0 - Self::SLACK, x1 + Self::SLACK), self.rows(y0 - Self::SLACK, y1 + Self::SLACK));
            for r in r0..=r1 { for c in c0..=c1 { out.extend(self.cells[r * self.nx + c].iter().map(|&i| i as usize)); } }
        }
        out.sort_unstable();
        out.dedup();
        out
    }
}

/// Points added over time, with the test "is one strictly closer than `reach`".
pub(super) struct PointGrid {
    cell: f64,
    cells: std::collections::HashMap<Key, Vec<usize>>,
    points: Vec<Point>,
}
impl PointGrid {
    pub(super) fn new(points: Vec<Point>, cell: f64) -> Self {
        let mut grid = Self { cell, cells: Default::default(), points: vec![] };
        for p in points { grid.push(p); }
        grid
    }
    fn at(&self, p: Point) -> Key { ((p.x / self.cell).floor() as i64, (p.y / self.cell).floor() as i64) }
    pub(super) fn push(&mut self, p: Point) {
        let k = self.at(p);
        self.cells.entry(k).or_default().push(self.points.len());
        self.points.push(p);
    }
    /// Whether some point lies at a `distance` below `reach` from `p`.
    pub(super) fn any_within(&self, p: Point, reach: f64) -> bool {
        let (lo, hi) = (self.at(Point { x: p.x - reach - 1e-6, y: p.y - reach - 1e-6 }), self.at(Point { x: p.x + reach + 1e-6, y: p.y + reach + 1e-6 }));
        let span = hi.0.saturating_sub(lo.0).saturating_add(1).saturating_mul(hi.1.saturating_sub(lo.1).saturating_add(1));
        if !(span <= self.points.len() as i64) {
            return self.points.iter().any(|&m| distance(m, p) < reach);
        }
        (lo.0..=hi.0).any(|x| (lo.1..=hi.1).any(|y| self.cells.get(&(x, y)).into_iter().flatten().any(|&i| distance(self.points[i], p) < reach)))
    }
}

/// Bounding box of the segment `a`-`b`, grown by `pad` on every side.
pub(super) fn segment_box(a: Point, b: Point, pad: f64) -> (f64, f64, f64, f64) {
    (a.x.min(b.x) - pad, a.y.min(b.y) - pad, a.x.max(b.x) + pad, a.y.max(b.y) + pad)
}

#[derive(Clone, Copy)]
pub(in crate::urban) struct Segment {
    pub(in crate::urban) street: usize,
    pub(in crate::urban) offset: usize,
    pub(in crate::urban) a: Point,
    pub(in crate::urban) b: Point,
}

/// Traverse only cells crossed by the segment, including both sides of an exact
/// corner. Work is proportional to length instead of rectangular bounding area.
/// Pairs `(j, i)`, `j < i`, ascending and without repeats.
pub(in crate::urban) fn candidates(segments: &[Segment], cell: f64) -> Vec<(usize, usize)> {
    let mut buckets: std::collections::HashMap<(i64, i64), Vec<usize>> = Default::default();
    let mut pairs = Vec::new();
    for (i, segment) in segments.iter().enumerate() {
        let mut visit = |x, y| {
            let bucket = buckets.entry((x, y)).or_default();
            if bucket.last() == Some(&i) {
                return;
            }
            for &j in bucket.iter() {
                let other = segments[j];
                if segment.a.x.min(segment.b.x) > other.a.x.max(other.b.x) + EPS
                    || segment.a.x.max(segment.b.x) < other.a.x.min(other.b.x) - EPS
                    || segment.a.y.min(segment.b.y) > other.a.y.max(other.b.y) + EPS
                    || segment.a.y.max(segment.b.y) < other.a.y.min(other.b.y) - EPS
                {
                    continue;
                }
                if segment.street != other.street || segment.offset.abs_diff(other.offset) > 1 {
                    pairs.push((j, i));
                }
            }
            bucket.push(i);
        };
        let (mut x, mut y) = (
            (segment.a.x / cell).floor() as i64,
            (segment.a.y / cell).floor() as i64,
        );
        let (end_x, end_y) = (
            (segment.b.x / cell).floor() as i64,
            (segment.b.y / cell).floor() as i64,
        );
        let axis = |a: f64, b: f64, index: i64| {
            let delta = b - a;
            // Even a sub-epsilon delta can straddle a bucket boundary.
            if delta == 0.0 {
                (0, f64::INFINITY, f64::INFINITY)
            } else {
                let step = if delta > 0.0 { 1 } else { -1 };
                let edge = (index + i64::from(step > 0)) as f64 * cell;
                (step, (edge - a) / delta, cell / delta.abs())
            }
        };
        let (sx, mut tx, dx) = axis(segment.a.x, segment.b.x, x);
        let (sy, mut ty, dy) = axis(segment.a.y, segment.b.y, y);
        visit(x, y);
        while x != end_x || y != end_y {
            let next_x = if x == end_x { f64::INFINITY } else { tx };
            let next_y = if y == end_y { f64::INFINITY } else { ty };
            if (next_x - next_y).abs() < 1e-12 {
                visit(x + sx, y);
                visit(x, y + sy);
                x += sx;
                y += sy;
                tx += dx;
                ty += dy;
            } else if next_x < next_y {
                x += sx;
                tx += dx;
            } else {
                y += sy;
                ty += dy;
            }
            visit(x, y);
        }
    }
    pairs.sort_unstable();
    pairs.dedup();
    pairs
}

fn projection(p: Point, a: Point, b: Point) -> Option<f64> {
    let dx = b.x - a.x;
    let dy = b.y - a.y;
    let t = ((p.x - a.x) * dx + (p.y - a.y) * dy) / (dx * dx + dy * dy);
    if (-EPS..=1.0 + EPS).contains(&t) && distance(p, lerp(a, b, t)) < EPS {
        Some(t.clamp(0.0, 1.0))
    } else {
        None
    }
}

pub(in crate::urban) fn crossings(a: Segment, b: Segment) -> Vec<(f64, f64, Point)> {
    let ax = a.b.x - a.a.x;
    let ay = a.b.y - a.a.y;
    let bx = b.b.x - b.a.x;
    let by = b.b.y - b.a.y;
    let det = ax * by - ay * bx;
    if det.abs() > 1e-10 * ax.hypot(ay) * bx.hypot(by) {
        let dx = b.a.x - a.a.x;
        let dy = b.a.y - a.a.y;
        let t = (dx * by - dy * bx) / det;
        let u = (dx * ay - dy * ax) / det;
        if (-EPS..=1.0 + EPS).contains(&t) && (-EPS..=1.0 + EPS).contains(&u) {
            let t = t.clamp(0.0, 1.0);
            let u = u.clamp(0.0, 1.0);
            return vec![(t, u, lerp(a.a, a.b, t))];
        }
        return vec![];
    }
    // Collinear overlaps get matching vertices at each overlap endpoint, so
    // downstream de-duplication removes their shared portion exactly.
    let mut hits = vec![];
    for (t, p) in [(0.0, a.a), (1.0, a.b)] {
        if let Some(u) = projection(p, b.a, b.b) {
            hits.push((t, u, p));
        }
    }
    for (u, p) in [(0.0, b.a), (1.0, b.b)] {
        if let Some(t) = projection(p, a.a, a.b) {
            hits.push((t, u, p));
        }
    }
    hits
}
