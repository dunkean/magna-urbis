//! Exact polygon operations shared by the two urban stages (coordinates in metres).
use super::{Point, Shape, Surface};
use geo::{Area, BooleanOps, Centroid, Coord, InteriorPoint, LineString, Polygon};

pub(super) fn signed(r: &[Point]) -> f64 {
    r.iter()
        .zip(r.iter().cycle().skip(1))
        .take(r.len())
        .map(|(a, b)| a.x * b.y - b.x * a.y)
        .sum::<f64>()
        * 0.5
}
pub(super) fn normalized(mut s: Shape) -> Shape {
    if signed(&s.outer) < 0.0 {
        s.outer.reverse();
    }
    for h in &mut s.holes {
        if signed(h) > 0.0 {
            h.reverse();
        }
    }
    s
}
pub(super) fn polygon(s: &Shape) -> Polygon<f64> {
    fn line(r: &[Point]) -> LineString<f64> {
        let mut q: Vec<_> = r.iter().map(|p| Coord { x: p.x, y: p.y }).collect();
        if let Some(p) = q.first().copied() {
            q.push(p);
        }
        LineString(q)
    }
    Polygon::new(line(&s.outer), s.holes.iter().map(|r| line(r)).collect())
}
pub(super) fn shapes(p: geo::MultiPolygon<f64>) -> Vec<Shape> {
    fn ring(l: &LineString<f64>) -> Vec<Point> {
        let mut r: Vec<_> = l.0.iter().map(|p| Point { x: p.x, y: p.y }).collect();
        if r.len() > 1
            && (r[0].x - r[r.len() - 1].x).abs() + (r[0].y - r[r.len() - 1].y).abs() < 1e-8
        {
            r.pop();
        }
        r.dedup_by(|a, b| (a.x - b.x).hypot(a.y - b.y) < 1e-7);
        r
    }
    p.0.into_iter()
        .filter(|p| p.unsigned_area() > 0.01)
        .map(|p| {
            normalized(Shape {
                outer: ring(p.exterior()),
                holes: p.interiors().iter().map(ring).collect(),
            })
        })
        .filter(|p| p.outer.len() >= 3)
        .collect()
}
pub(super) fn area(s: &Shape) -> f64 {
    polygon(s).unsigned_area()
}
pub(super) fn centroid(s: &Shape) -> Point {
    polygon(s)
        .centroid()
        .map(|p| Point { x: p.x(), y: p.y() })
        .unwrap_or(Point { x: 0.0, y: 0.0 })
}
/// Unlike a centroid, this lies in the polygon, including concave domains and holes.
pub(super) fn interior_point(s: &Shape) -> Point {
    let c = centroid(s);
    if contains(s, c) {
        return c;
    }
    polygon(s)
        .interior_point()
        .map(|p| Point { x: p.x(), y: p.y() })
        .unwrap_or(c)
}

pub(super) fn union(shapes: &[Shape]) -> Vec<Shape> {
    union_all(shapes)
}

/// Check every interval cut by outer and hole boundaries, not just sampled endpoints.
pub(super) fn segment_within(s: &Shape, a: Point, b: Point) -> bool {
    let mut ts = vec![0.0, 1.0];
    for r in std::iter::once(&s.outer).chain(s.holes.iter()) {
        for (&c, &d) in r.iter().zip(r.iter().cycle().skip(1)).take(r.len()) {
            if let Some((t, _)) = segment_hit(a, b, c, d) {
                ts.push(t.clamp(0.0, 1.0));
            }
        }
    }
    ts.sort_by(f64::total_cmp);
    ts.windows(2).all(|w| {
        let t = (w[0] + w[1]) * 0.5;
        contains(
            s,
            Point {
                x: a.x + (b.x - a.x) * t,
                y: a.y + (b.y - a.y) * t,
            },
        )
    })
}
pub(super) fn contains(s: &Shape, p: Point) -> bool {
    // This is the hottest operation during tracing. Avoid allocating a geo
    // polygon and copying every ring for each five-metre integration step.
    fn ring(r: &[Point], p: Point) -> bool {
        let mut inside = false;
        for (&a, &b) in r.iter().zip(r.iter().cycle().skip(1)).take(r.len()) {
            if (a.y > p.y) != (b.y > p.y) && p.x < (b.x - a.x) * (p.y - a.y) / (b.y - a.y) + a.x {
                inside = !inside;
            }
        }
        inside
    }
    ring(&s.outer, p) && !s.holes.iter().any(|h| ring(h, p))
}

/// Exact even/odd containment with edges binned by ordinate. Phase lookups use
/// the same arithmetic as contains(), but skip edges that cannot cross the ray.
pub(super) struct ContainmentIndex {
    bounds: (f64, f64, f64, f64),
    rows: Vec<Vec<(Point, Point)>>,
}
impl ContainmentIndex {
    pub(super) fn new(shape: &Shape) -> Self {
        let bounds = bbox(shape);
        let mut index = Self {
            bounds,
            rows: vec![vec![]; 64],
        };
        for ring in std::iter::once(&shape.outer).chain(shape.holes.iter()) {
            for (&a, &b) in ring
                .iter()
                .zip(ring.iter().cycle().skip(1))
                .take(ring.len())
            {
                if a.y == b.y {
                    continue;
                }
                let low = index.row(a.y.min(b.y));
                let high = index.row(a.y.max(b.y));
                for row in low..=high {
                    index.rows[row].push((a, b));
                }
            }
        }
        index
    }
    fn row(&self, y: f64) -> usize {
        (((y - self.bounds.1) / (self.bounds.3 - self.bounds.1).max(1e-12) * 64.0).floor() as usize)
            .min(63)
    }
    pub(super) fn contains(&self, p: Point) -> bool {
        let (x0, y0, x1, y1) = self.bounds;
        if p.x < x0 || p.x > x1 || p.y < y0 || p.y > y1 {
            return false;
        }
        let mut inside = false;
        for &(a, b) in &self.rows[self.row(p.y)] {
            if (a.y > p.y) != (b.y > p.y) && p.x < (b.x - a.x) * (p.y - a.y) / (b.y - a.y) + a.x {
                inside = !inside;
            }
        }
        inside
    }
}
pub(super) fn bbox(s: &Shape) -> (f64, f64, f64, f64) {
    s.outer.iter().fold(
        (
            f64::INFINITY,
            f64::INFINITY,
            f64::NEG_INFINITY,
            f64::NEG_INFINITY,
        ),
        |(a, b, c, d), p| (a.min(p.x), b.min(p.y), c.max(p.x), d.max(p.y)),
    )
}
pub(super) fn intersection(a: &Shape, b: &Shape) -> Vec<Shape> {
    overlay(
        span([a, b]),
        |r| match (operand(a, r), operand(b, r)) {
            (Some(p), Some(q)) => shapes(p.intersection(&q)),
            _ => Vec::new(),
        },
        // Conservative: an unresolvable piece claims no area.
        Vec::new,
    )
}
pub(super) fn difference(a: &Shape, b: &Shape) -> Vec<Shape> {
    overlay(
        span([a, b]),
        |r| match (operand(a, r), operand(b, r)) {
            (Some(p), Some(q)) => shapes(p.difference(&q)),
            (Some(p), None) => shapes(geo::MultiPolygon(vec![p])),
            (None, _) => Vec::new(),
        },
        // Conservative: never claim area that may lie inside `b`.
        Vec::new,
    )
}

/// Root cause of review #24: i_overlay maps each operation onto an integer grid
/// of unit 2^(floor(log2 half-extent) - 29), 6e-8 m for a 100 m pair. Out-and-back
/// antennas, spikes and slivers one or two units wide, left over by earlier
/// chained ops, become self-overlapping integer rings, and its hole binder then
/// indexes `ContourIndex::EMPTY` (panic "index ... 9223372036854775807").
/// Every boolean operand is therefore reduced first, exactly: non-finite and
/// duplicate vertices, exactly collinear runs and spike tips dropped, zero-area
/// rings dropped, rings oriented (coordinates never move, so ordinary results
/// stay as they were). Only if the overlay still panics is the operation retried
/// with vertices within `SLIVER_UNITS` overlay units of the line of their longer
/// adjacent edge removed (sub-resolution antennas the overlay cannot represent),
/// then on 1 mm and 1 cm grids, then the documented conservative result.
const SLIVER_UNITS: f64 = 4.0;
/// Retry grid (m): operands snapped to 1 mm (then 1 cm) and reduced exactly.
const GRID: f64 = 1e-3;
/// Overlays that still failed and returned their documented conservative result.
static FALLBACKS: std::sync::atomic::AtomicUsize = std::sync::atomic::AtomicUsize::new(0);
#[allow(dead_code)]
pub(super) fn overlay_fallbacks() -> usize {
    FALLBACKS.load(std::sync::atomic::Ordering::Relaxed)
}
#[derive(Clone, Copy)]
enum Reduce {
    /// Tolerance in metres; coordinates are otherwise untouched.
    Within(f64),
    /// Snap to this grid (m) and reduce exactly.
    Grid(f64),
}
/// i_overlay's integer unit (m) for an operation over these shapes.
fn span<'s>(shapes: impl IntoIterator<Item = &'s Shape>) -> f64 {
    let (mut x0, mut y0, mut x1, mut y1) = (f64::MAX, f64::MAX, f64::MIN, f64::MIN);
    for p in shapes.into_iter().flat_map(|s| s.outer.iter()) {
        if p.x.is_finite() && p.y.is_finite() {
            (x0, y0, x1, y1) = (x0.min(p.x), y0.min(p.y), x1.max(p.x), y1.max(p.y));
        }
    }
    let half = (x1 - x0).max(y1 - y0) * 0.5;
    if half > 0.0 && half.is_finite() {
        (half.log2().floor() - 29.0).exp2()
    } else {
        0.0
    }
}

/// Run `op` on exactly reduced operands; if i_overlay panics, retry with the
/// sub-resolution reduction, then on 1 mm and 1 cm snapped operands, then
/// return `conservative()` (counted by `overlay_fallbacks`). Only the overlay
/// itself is guarded; with panic=abort (wasm) it is a plain call.
fn overlay<T>(unit: f64, op: impl Fn(Reduce) -> T, conservative: impl FnOnce() -> T) -> T {
    let ladder = [
        Reduce::Within(0.0),
        Reduce::Within(SLIVER_UNITS * unit),
        Reduce::Grid(GRID),
        Reduce::Grid(GRID * 10.0),
    ];
    for r in ladder {
        if let Ok(out) = std::panic::catch_unwind(std::panic::AssertUnwindSafe(|| op(r))) {
            return out;
        }
    }
    FALLBACKS.fetch_add(1, std::sync::atomic::Ordering::Relaxed);
    conservative()
}

/// A reduced ring, counter-clockwise; `None` when it encloses no area. On a
/// grid the arithmetic is exact (integer-valued f64 in grid units).
fn reduced_ring(r: &[Point], reduce: Reduce) -> Option<Vec<Coord<f64>>> {
    let (unit, eps) = match reduce {
        Reduce::Within(eps) => (1.0, eps),
        Reduce::Grid(g) => (g, 0.0),
    };
    let snap = |v: f64| match reduce {
        Reduce::Within(_) => v,
        Reduce::Grid(g) => (v / g).round(),
    };
    let first = r.iter().find(|p| p.x.is_finite() && p.y.is_finite())?;
    let o = (snap(first.x), snap(first.y));
    let same = |a: (f64, f64), b: (f64, f64)| (a.0 - b.0).abs().max((a.1 - b.1).abs()) <= eps;
    // b is redundant when it lies within eps of the line of its longer edge:
    // a collinear continuation, a spike tip or one side of a thin antenna.
    let redundant = |a: (f64, f64), b: (f64, f64), c: (f64, f64)| {
        let (u, v) = ((b.0 - a.0, b.1 - a.1), (c.0 - b.0, c.1 - b.1));
        (u.0 * v.1 - u.1 * v.0).abs() <= eps * u.0.hypot(u.1).max(v.0.hypot(v.1))
    };
    let mut q: Vec<(f64, f64)> = Vec::with_capacity(r.len());
    for p in r.iter().filter(|p| p.x.is_finite() && p.y.is_finite()) {
        let v = (snap(p.x) - o.0, snap(p.y) - o.1);
        if q.last().is_some_and(|&l| same(l, v)) {
            continue;
        }
        while q.len() >= 2 && redundant(q[q.len() - 2], q[q.len() - 1], v) {
            q.pop();
        }
        if !q.last().is_some_and(|&l| same(l, v)) {
            q.push(v);
        }
    }
    let mut start = 0;
    loop {
        if q.len() < start + 3 {
            return None;
        }
        let n = q.len();
        if same(q[n - 1], q[start]) || redundant(q[n - 2], q[n - 1], q[start]) {
            q.pop();
        } else if redundant(q[n - 1], q[start], q[start + 1]) {
            start += 1;
        } else {
            break;
        }
    }
    let mut q = q.split_off(start);
    let twice: f64 = q
        .iter()
        .zip(q.iter().cycle().skip(1))
        .map(|(a, b)| a.0 * b.1 - b.0 * a.1)
        .sum();
    if twice == 0.0 {
        return None;
    }
    if twice < 0.0 {
        q.reverse();
    }
    Some(
        q.into_iter()
            .map(|(x, y)| Coord {
                x: (x + o.0) * unit,
                y: (y + o.1) * unit,
            })
            .collect(),
    )
}
/// The reduced overlay operand of a shape (holes clockwise); `None` without area.
fn operand(s: &Shape, reduce: Reduce) -> Option<Polygon<f64>> {
    let line = |mut c: Vec<Coord<f64>>, hole: bool| {
        if hole {
            c.reverse();
        }
        c.push(c[0]);
        LineString(c)
    };
    let outer = line(reduced_ring(&s.outer, reduce)?, false);
    let holes = s
        .holes
        .iter()
        .filter_map(|h| reduced_ring(h, reduce))
        .map(|h| line(h, true))
        .collect();
    Some(Polygon::new(outer, holes))
}
/// Reduced union; if the overlay cannot resolve it, the conservative result is
/// the (possibly overlapping) inputs themselves, so coverage is never lost.
fn union_all(shapes: &[Shape]) -> Vec<Shape> {
    let unit = span(shapes);
    overlay(
        unit,
        |r| {
            let ps: Vec<_> = shapes.iter().filter_map(|s| operand(s, r)).collect();
            self::shapes(geo::algorithm::bool_ops::unary_union(&ps))
        },
        || {
            shapes
                .iter()
                .filter_map(|s| operand(s, Reduce::Within(0.0)))
                .flat_map(|p| self::shapes(geo::MultiPolygon(vec![p])))
                .collect()
        },
    )
}
pub(super) fn rectangle(x0: f64, y0: f64, x1: f64, y1: f64) -> Shape {
    Shape {
        outer: vec![
            Point { x: x0, y: y0 },
            Point { x: x1, y: y0 },
            Point { x: x1, y: y1 },
            Point { x: x0, y: y1 },
        ],
        holes: vec![],
    }
}
pub(super) fn distance(p: Point, a: Point, b: Point) -> (f64, f64, Point) {
    let dx = b.x - a.x;
    let dy = b.y - a.y;
    let t =
        (((p.x - a.x) * dx + (p.y - a.y) * dy) / (dx * dx + dy * dy).max(1e-15)).clamp(0.0, 1.0);
    let q = Point {
        x: a.x + t * dx,
        y: a.y + t * dy,
    };
    ((p.x - q.x).hypot(p.y - q.y), t, q)
}
/// Douglas-Peucker simplification of an open polyline. Both ends and every
/// vertex for which `keep` holds (shared junctions) are retained exactly, so the
/// simplified line still meets its neighbours at the same points.
pub(super) fn simplify(path: &[Point], tolerance: f64, keep: impl Fn(Point) -> bool) -> Vec<Point> {
    if path.len() <= 2 || tolerance <= 0.0 {
        return path.to_vec();
    }
    let mut retained = vec![false; path.len()];
    retained[0] = true;
    retained[path.len() - 1] = true;
    for (i, &p) in path.iter().enumerate() {
        if keep(p) {
            retained[i] = true;
        }
    }
    let anchors: Vec<usize> = (0..path.len()).filter(|&i| retained[i]).collect();
    let mut stack: Vec<(usize, usize)> = anchors.windows(2).map(|w| (w[0], w[1])).collect();
    while let Some((a, b)) = stack.pop() {
        if b <= a + 1 {
            continue;
        }
        let (mut worst, mut at) = (0.0, a);
        for (i, &p) in path.iter().enumerate().take(b).skip(a + 1) {
            let d = distance(p, path[a], path[b]).0;
            if d > worst {
                worst = d;
                at = i;
            }
        }
        if worst > tolerance {
            retained[at] = true;
            stack.push((a, at));
            stack.push((at, b));
        }
    }
    path.iter()
        .zip(retained)
        .filter_map(|(&p, r)| r.then_some(p))
        .collect()
}
/// Whether every ring of `s` is simple: no two non-adjacent sides touch or
/// cross. Boolean operations need simple input (a folded ring, such as a
/// sliver whose vertices were snapped back over each other, can abort the
/// overlay solver). Quadratic in the ring size, which is a lot's, not a city's.
pub(super) fn simple(s: &Shape) -> bool {
    fn cross(o: Point, a: Point, b: Point) -> f64 {
        (a.x - o.x) * (b.y - o.y) - (a.y - o.y) * (b.x - o.x)
    }
    fn touch(a: Point, b: Point, c: Point, d: Point) -> bool {
        let eps = 1e-9;
        let (d1, d2) = (cross(c, d, a), cross(c, d, b));
        let (d3, d4) = (cross(a, b, c), cross(a, b, d));
        if ((d1 > eps && d2 < -eps) || (d1 < -eps && d2 > eps))
            && ((d3 > eps && d4 < -eps) || (d3 < -eps && d4 > eps))
        {
            return true;
        }
        let on = |p: Point, q: Point, r: Point, v: f64| {
            v.abs() <= eps
                && r.x >= p.x.min(q.x) - eps
                && r.x <= p.x.max(q.x) + eps
                && r.y >= p.y.min(q.y) - eps
                && r.y <= p.y.max(q.y) + eps
        };
        on(c, d, a, d1) || on(c, d, b, d2) || on(a, b, c, d3) || on(a, b, d, d4)
    }
    std::iter::once(&s.outer).chain(&s.holes).all(|r| {
        let n = r.len();
        if n < 3 {
            return false;
        }
        (0..n).all(|i| {
            let (a, b) = (r[i], r[(i + 1) % n]);
            (i + 2..n).all(|j| {
                if i == 0 && j == n - 1 {
                    return true;
                }
                !touch(a, b, r[j], r[(j + 1) % n])
            })
        })
    })
}
pub(super) fn segment_hit(a: Point, b: Point, c: Point, d: Point) -> Option<(f64, Point)> {
    let ux = b.x - a.x;
    let uy = b.y - a.y;
    let vx = d.x - c.x;
    let vy = d.y - c.y;
    let z = ux * vy - uy * vx;
    if z.abs() < 1e-9 {
        return None;
    }
    let t = ((c.x - a.x) * vy - (c.y - a.y) * vx) / z;
    let u = ((c.x - a.x) * uy - (c.y - a.y) * ux) / z;
    if t > 1e-7 && t <= 1.0 + 1e-8 && (-1e-8..=1.0 + 1e-8).contains(&u) {
        Some((
            t,
            Point {
                x: a.x + t * ux,
                y: a.y + t * uy,
            },
        ))
    } else {
        None
    }
}
/// Split an outer ring by a simple boundary-to-boundary chord, distributing holes exactly.
pub(super) fn split(s: &Shape, path: &[Point]) -> Option<(Shape, Shape)> {
    if path.len() < 2 {
        return None;
    }
    let n = s.outer.len();
    let locate = |p: Point| {
        (0..n)
            .map(|i| {
                let (d, t, q) = distance(p, s.outer[i], s.outer[(i + 1) % n]);
                (i, d, t, q)
            })
            .min_by(|a, b| a.1.total_cmp(&b.1))
    };
    let (i, di, _, a) = locate(path[0])?;
    let (j, dj, _, b) = locate(*path.last()?)?;
    if di > 0.1 || dj > 0.1 || i == j {
        return None;
    }
    let mut chord = path.to_vec();
    chord[0] = a;
    *chord.last_mut()? = b;
    let boundary = |from: usize, to: usize, start: Point, end: Point| {
        let mut r = vec![start];
        let mut k = (from + 1) % n;
        for _ in 0..n {
            r.push(s.outer[k]);
            if k == to {
                break;
            }
            k = (k + 1) % n;
        }
        r.push(end);
        r
    };
    let mut ra = boundary(i, j, a, b);
    ra.extend(chord.iter().rev().skip(1).copied());
    let mut rb = boundary(j, i, b, a);
    rb.extend(chord.iter().skip(1).copied());
    let aa = Shape {
        outer: ra,
        holes: vec![],
    };
    let bb = Shape {
        outer: rb,
        holes: vec![],
    };
    let mut pa = intersection(s, &aa);
    let mut pb = intersection(s, &bb);
    if pa.len() != 1 || pb.len() != 1 {
        return None;
    }
    let a = pa.pop()?;
    let b = pb.pop()?;
    if (area(&a) + area(&b) - area(s)).abs() > area(s) * 1e-5 + 0.01 {
        return None;
    }
    Some((a, b))
}
/// Variable-width segment trapezoids and round interior joins, flat endpoint caps.
pub(super) fn ribbon(path: &[Point], widths: &[f64]) -> Vec<Shape> {
    let mut ps = vec![];
    let w = |i: usize| {
        widths
            .get(i)
            .copied()
            .or_else(|| widths.first().copied())
            .unwrap_or(4.0)
            * 0.5
    };
    for (i, q) in path.windows(2).enumerate() {
        let a = q[0];
        let b = q[1];
        let l = (b.x - a.x).hypot(b.y - a.y);
        if l < 1e-7 {
            continue;
        }
        let nx = -(b.y - a.y) / l;
        let ny = (b.x - a.x) / l;
        ps.push(normalized(Shape {
            outer: vec![
                Point {
                    x: a.x + nx * w(i),
                    y: a.y + ny * w(i),
                },
                Point {
                    x: a.x - nx * w(i),
                    y: a.y - ny * w(i),
                },
                Point {
                    x: b.x - nx * w(i + 1),
                    y: b.y - ny * w(i + 1),
                },
                Point {
                    x: b.x + nx * w(i + 1),
                    y: b.y + ny * w(i + 1),
                },
            ],
            holes: vec![],
        }));
    }
    for (i, p) in path
        .iter()
        .enumerate()
        .take(path.len().saturating_sub(1))
        .skip(1)
    {
        ps.push(Shape {
            outer: (0..12)
                .map(|k| {
                    let a = k as f64 * std::f64::consts::TAU / 12.0;
                    Point {
                        x: p.x + w(i) * a.cos(),
                        y: p.y + w(i) * a.sin(),
                    }
                })
                .collect(),
            holes: vec![],
        });
    }
    union_all(&ps)
}
/// Clip only the site's local raster window; run-length water cells are unioned before subtraction.
pub(super) fn dry_clip(surface: &Surface<'_>, s: &Shape) -> Vec<Shape> {
    let land = intersection(s, &rectangle(0.0, 0.0, surface.width, surface.width));
    if let Some(geometry) = surface.geometry {
        return land.iter().flat_map(|s| geometry.clip(s)).collect();
    }
    if surface.n == 0 || surface.water.is_empty() {
        return land;
    }
    let cell = surface.width / surface.n as f64;
    let (x0, y0, x1, y1) = bbox(s);
    let ix0 = (x0 / cell).floor().max(0.0) as usize;
    let iy0 = (y0 / cell).floor().max(0.0) as usize;
    let ix1 = ((x1 / cell).ceil() as usize).min(surface.n);
    let iy1 = ((y1 / cell).ceil() as usize).min(surface.n);
    let mut wet = vec![];
    for y in iy0..iy1 {
        let mut x = ix0;
        while x < ix1 {
            if surface.water.get(y * surface.n + x).copied().unwrap_or(0) == 0 {
                x += 1;
                continue;
            }
            let a = x;
            while x < ix1 && surface.water[y * surface.n + x] != 0 {
                x += 1
            }
            wet.push(rectangle(
                a as f64 * cell,
                y as f64 * cell,
                x as f64 * cell,
                (y + 1) as f64 * cell,
            ));
        }
    }
    if wet.is_empty() {
        return land;
    }
    let water = union_all(&wet);
    land.into_iter()
        .flat_map(|p| {
            overlay(
                span(std::iter::once(&p).chain(water.iter())),
                |r| {
                    let Some(dry) = operand(&p, r) else {
                        return Vec::new();
                    };
                    let wet =
                        geo::MultiPolygon(water.iter().filter_map(|w| operand(w, r)).collect());
                    shapes(dry.difference(&wet))
                },
                // Conservative: possibly wet land is not claimed.
                Vec::new,
            )
        })
        .collect()
}

#[cfg(test)]
mod tests {
    use super::*;
    /// Regression (review #24): this pair made i_overlay 4.5.2 panic in its hole
    /// binder. Sanitized operands resolve it without falling back, and the result
    /// never exceeds the subject.
    #[test]
    fn sub_grid_sliver_overlays_without_panic() {
        #[derive(serde::Deserialize)]
        struct Case {
            subject: Shape,
            clip: Shape,
        }
        let case: Case = serde_json::from_str(include_str!(
            "../../tests/fixtures/overlay_sliver_panic.json"
        ))
        .unwrap();
        let before = overlay_fallbacks();
        let out = intersection(&case.subject, &case.clip);
        let rest = difference(&case.subject, &case.clip);
        let both = union(&[case.subject.clone(), case.clip.clone()]);
        assert_eq!(overlay_fallbacks(), before);
        let total: f64 = out.iter().map(area).sum();
        assert!(total <= area(&case.subject) + 1e-3);
        let rest: f64 = rest.iter().map(area).sum();
        assert!((total + rest - area(&case.subject)).abs() < 0.05);
        assert!((both.iter().map(area).sum::<f64>() - area(&case.clip) - rest).abs() < 0.05);
        // Ring reduction: NaN, duplicates, collinear runs and spikes vanish; CCW out.
        let p = |x: f64, y: f64| Point { x, y };
        let ring = [
            p(0.0, 0.0),
            p(f64::NAN, 1.0),
            p(5.0, 0.0),
            p(5.0, 0.0),
            p(10.0, 0.0),
            p(10.0, 10.0),
            p(10.0, 20.0),
            p(10.0, 10.0),
            p(0.0, 10.0),
            p(0.0, 5.0),
        ];
        for r in [Reduce::Within(1e-6), Reduce::Grid(GRID)] {
            let mut q: Vec<_> = reduced_ring(&ring, r)
                .unwrap()
                .iter()
                .map(|c| ((c.x * 1e3).round() as i64, (c.y * 1e3).round() as i64))
                .collect();
            assert!(
                signed(
                    &q.iter()
                        .map(|&(x, y)| p(x as f64, y as f64))
                        .collect::<Vec<_>>()
                ) > 0.0
            );
            q.sort();
            assert_eq!(q, vec![(0, 0), (0, 10_000), (10_000, 0), (10_000, 10_000)]);
            assert!(reduced_ring(&[p(0.0, 0.0), p(1.0, 1.0), p(2.0, 2.0)], r).is_none());
        }
    }
    #[test]
    fn chord_and_water_preserve_the_partition() {
        let mut shape = rectangle(0.0, 0.0, 100.0, 100.0);
        shape.holes.push(rectangle(65.0, 20.0, 85.0, 40.0).outer);
        let (a, b) = split(
            &shape,
            &[Point { x: 50.0, y: 0.0 }, Point { x: 50.0, y: 100.0 }],
        )
        .unwrap();
        assert!((area(&a) + area(&b) - area(&shape)).abs() < 0.01);
        assert!(intersection(&a, &b).is_empty());
        let heights = vec![0.0; 100];
        let mut water = vec![0; 100];
        for y in 0..10 {
            water[y * 10 + 4] = 1;
        }
        let surface = Surface {
            geometry: None,
            width: 100.0,
            n: 10,
            height: &heights,
            water: &water,
        };
        let pieces = dry_clip(&surface, &shape);
        assert!((pieces.iter().map(area).sum::<f64>() - 8600.0).abs() < 0.01);
        assert_eq!(pieces.len(), 2);
    }
}
