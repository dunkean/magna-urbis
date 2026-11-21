//! Vector, ring and terrain helpers shared by the wall tracers.

use magna_urbis_geom::{self as g, Point, Shape, surface::TerrainView};

/// A direction or displacement in metres.
pub(super) type V = (f64, f64);

/// Steepest grade a curtain run may climb (classic `trace.maxGrade`).
pub(super) const MAX_GRADE: f64 = 0.9;

pub(super) fn pt(x: f64, y: f64) -> Point {
    Point { x, y }
}

pub(super) fn add(p: Point, d: V, k: f64) -> Point {
    pt(p.x + d.0 * k, p.y + d.1 * k)
}

/// Unit direction from `a` to `b`.
pub(super) fn dir(a: Point, b: Point) -> V {
    let l = (b.x - a.x).hypot(b.y - a.y).max(1e-12);
    ((b.x - a.x) / l, (b.y - a.y) / l)
}

pub(super) fn dist(a: Point, b: Point) -> f64 {
    a.distance(b)
}

pub(super) fn dot(a: V, b: V) -> f64 {
    a.0 * b.0 + a.1 * b.1
}

pub(super) fn cross(a: V, b: V) -> f64 {
    a.0 * b.1 - a.1 * b.0
}

pub(super) fn unit(v: V) -> V {
    let l = v.0.hypot(v.1).max(1e-12);
    (v.0 / l, v.1 / l)
}

pub(super) fn lerp(a: Point, b: Point, t: f64) -> Point {
    pt(a.x + (b.x - a.x) * t, a.y + (b.y - a.y) * t)
}

/// Absolute turn in radians at vertex `i` of a closed ring.
pub(super) fn turn_at(ring: &[Point], i: usize) -> f64 {
    let n = ring.len();
    let (a, p, b) = (ring[(i + n - 1) % n], ring[i], ring[(i + 1) % n]);
    let (u, v) = (dir(a, p), dir(p, b));
    cross(u, v).atan2(dot(u, v)).abs()
}

/// The ring with its first vertex repeated at the end.
pub(super) fn closed(ring: &[Point]) -> Vec<Point> {
    ring.iter().copied().chain(ring.first().copied()).collect()
}

pub(super) fn area_of(shapes: &[Shape]) -> f64 {
    shapes.iter().map(g::area).sum()
}

pub(super) fn largest(shapes: Vec<Shape>) -> Option<Shape> {
    shapes
        .into_iter()
        .max_by(|a, b| g::area(a).total_cmp(&g::area(b)))
}

/// `pieces` minus every shape of `cuts`, dropping crumbs under 0.01 m².
pub(super) fn subtract(pieces: Vec<Shape>, cuts: &[Shape]) -> Vec<Shape> {
    let mut out = pieces;
    for cut in cuts {
        if out.is_empty() {
            break;
        }
        let cb = g::bbox(cut);
        out = out
            .into_iter()
            .flat_map(|p| {
                let pb = g::bbox(&p);
                if pb.0 <= cb.2 && cb.0 <= pb.2 && pb.1 <= cb.3 && cb.1 <= pb.3 {
                    g::difference(&p, cut)
                } else {
                    vec![p]
                }
            })
            .filter(|p| g::area(p) > 0.01)
            .collect();
    }
    out
}

/// `shape` grown (positive `d`) or shrunk (negative `d`) by `|d|` metres: the shape
/// with, or without, a band of round-joined segments along each of its rings.
pub(super) fn buffer(shape: &Shape, d: f64) -> Vec<Shape> {
    if d == 0.0 {
        return vec![shape.clone()];
    }
    let band: Vec<Shape> = std::iter::once(&shape.outer)
        .chain(&shape.holes)
        .filter(|r| r.len() >= 2)
        .flat_map(|r| g::ribbon(&joined(r), &[2.0 * d.abs()]))
        .collect();
    if d > 0.0 {
        g::union(
            &band
                .into_iter()
                .chain(std::iter::once(shape.clone()))
                .collect::<Vec<_>>(),
        )
    } else {
        g::difference_many(shape, &g::union(&band))
    }
}

/// Several disjoint shapes buffered together: grown pieces that meet are merged.
pub(super) fn buffer_all(shapes: &[Shape], d: f64) -> Vec<Shape> {
    let pieces: Vec<Shape> = shapes.iter().flat_map(|s| buffer(s, d)).collect();
    if d > 0.0 && pieces.len() > 1 {
        g::union(&pieces)
    } else {
        pieces
    }
}

/// A closed ring walked from its last vertex round to its first again, so that
/// `ribbon`, which rounds interior vertices only, rounds every vertex of the ring.
fn joined(r: &[Point]) -> Vec<Point> {
    let mut path = Vec::with_capacity(r.len() + 2);
    path.push(r[r.len() - 1]);
    path.extend_from_slice(r);
    path.push(r[0]);
    path
}

/// Outward unit normal of each segment of a closed path (last point = first).
pub(super) fn normals(path: &[Point]) -> Vec<V> {
    let ring = Shape {
        outer: path[..path.len() - 1].to_vec(),
        holes: vec![],
    };
    let mut ns: Vec<V> = path
        .windows(2)
        .map(|w| {
            let (dx, dy) = dir(w[0], w[1]);
            (dy, -dx)
        })
        .collect();
    // The right-hand side is outward for a counter-clockwise ring; checked on the
    // longest side as `contains(m + 2n) == false`.
    if let Some(k) = (0..ns.len())
        .max_by(|&a, &b| dist(path[a], path[a + 1]).total_cmp(&dist(path[b], path[b + 1])))
    {
        let m = lerp(path[k], path[k + 1], 0.5);
        if g::contains(&ring, add(m, ns[k], 2.0)) {
            for n in &mut ns {
                *n = (-n.0, -n.1);
            }
        }
    }
    ns
}

/// Length in metres of the run `a`–`b` that lies in water, sampled every 2 m.
pub(super) fn wet_run(terrain: &dyn TerrainView, a: Point, b: Point) -> f64 {
    let l = dist(a, b);
    let k = (l / 2.0).ceil().max(1.0) as usize;
    (0..k)
        .filter(|&j| terrain.wet(lerp(a, b, (j as f64 + 0.5) / k as f64)))
        .count() as f64
        * l
        / k as f64
}

/// Length in metres of a closed ring that lies in water.
pub(super) fn wet_length(ring: &[Point], terrain: &dyn TerrainView) -> f64 {
    let n = ring.len();
    (0..n)
        .map(|i| wet_run(terrain, ring[i], ring[(i + 1) % n]))
        .sum()
}

fn on_map(terrain: &dyn TerrainView, p: Point) -> bool {
    p.x.is_finite()
        && p.y.is_finite()
        && p.x >= 0.0
        && p.y >= 0.0
        && p.x < terrain.width()
        && p.y < terrain.width()
}

/// Steepest rise over run along a dry segment, walked in half height cells with a
/// quadratic fit per step; `None` when it leaves the map, touches water or meets a
/// non-finite height.
fn dry_grade(terrain: &dyn TerrainView, a: Point, b: Point) -> Option<f64> {
    if !on_map(terrain, a) || !on_map(terrain, b) {
        return None;
    }
    let distance = dist(a, b);
    if distance < 1e-8 {
        return (!terrain.wet(a)).then_some(0.0);
    }
    let half = terrain.width() / terrain.height_resolution().max(1) as f64 * 0.5;
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
    let (mut t0, mut h0) = (0.0, terrain.height_at(a));
    let mut steepest = 0.0_f64;
    while t0 < 1.0 {
        let t1 = tx.min(ty).min(1.0);
        let mid = lerp(a, b, (t0 + t1) * 0.5);
        if terrain.wet(mid) {
            return None;
        }
        let h1 = terrain.height_at(lerp(a, b, t1));
        let hm = terrain.height_at(mid);
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

/// A dry segment on the map no steeper than `max_grade`.
pub(super) fn segment_clear(terrain: &dyn TerrainView, a: Point, b: Point, max_grade: f64) -> bool {
    dry_grade(terrain, a, b).is_some_and(|grade| grade <= max_grade + 1e-8)
}

/// A segment that is not dry: it crosses water (or leaves the map).
fn crosses_water(terrain: &dyn TerrainView, a: Point, b: Point) -> bool {
    dry_grade(terrain, a, b).is_none()
}

/// Whether a straight run rises more than `limit` metres above its higher end.
pub(super) fn crest_above(terrain: &dyn TerrainView, a: Point, b: Point, limit: f64) -> bool {
    if !limit.is_finite() {
        return false;
    }
    let n = (dist(a, b) / 8.0).ceil().max(1.0) as usize;
    let high = terrain.height_at(a).max(terrain.height_at(b)) + limit;
    (1..n).any(|k| terrain.height_at(lerp(a, b, k as f64 / n as f64)) > high)
}

/// A run a curtain may take straight: below the crest limit and the curtain grade,
/// or across water (a river crossing, which water gates handle).
pub(super) fn clear_within(terrain: &dyn TerrainView, a: Point, b: Point, limit: f64) -> bool {
    (!crest_above(terrain, a, b, limit) && segment_clear(terrain, a, b, MAX_GRADE))
        || crosses_water(terrain, a, b)
}

/// Mean cross-grade of the ground under one side, 12 m to either side every 40 m.
fn side_relief(terrain: &dyn TerrainView, a: Point, b: Point, n: V) -> f64 {
    let k = (dist(a, b) / 40.0).ceil().max(1.0) as usize;
    (0..k)
        .map(|i| {
            let m = lerp(a, b, (i as f64 + 0.5) / k as f64);
            (terrain.height_at(add(m, n, 12.0)) - terrain.height_at(add(m, n, -12.0))).abs() / 24.0
        })
        .sum::<f64>()
        / k as f64
}

/// Length-weighted relief across a closed outline (classic `terrain`'s `R`).
pub(super) fn relief(shape: &Shape, terrain: &dyn TerrainView) -> f64 {
    if shape.outer.len() < 3 {
        return 0.0;
    }
    let path = closed(&shape.outer);
    let ns = normals(&path);
    let (mut r, mut total) = (0.0, 0.0);
    for (w, n) in path.windows(2).zip(&ns) {
        let l = dist(w[0], w[1]);
        r += l * side_relief(terrain, w[0], w[1], *n);
        total += l;
    }
    if total > 0.0 { r / total } else { 0.0 }
}

/// Box of `points` in the frame turned by `angle`: its four corners and its area.
pub(super) fn framed_box(points: &[Point], angle: f64) -> (Vec<Point>, f64) {
    let (u, v) = ((angle.cos(), angle.sin()), (-angle.sin(), angle.cos()));
    let (mut a0, mut a1, mut b0, mut b1) = (
        f64::INFINITY,
        f64::NEG_INFINITY,
        f64::INFINITY,
        f64::NEG_INFINITY,
    );
    for p in points {
        let (a, b) = (p.x * u.0 + p.y * u.1, p.x * v.0 + p.y * v.1);
        (a0, a1, b0, b1) = (a0.min(a), a1.max(a), b0.min(b), b1.max(b));
    }
    let at = |a: f64, b: f64| pt(a * u.0 + b * v.0, a * u.1 + b * v.1);
    (
        vec![at(a0, b0), at(a1, b0), at(a1, b1), at(a0, b1)],
        (a1 - a0).max(0.0) * (b1 - b0).max(0.0),
    )
}

/// Convex hull, counter-clockwise (monotone chain).
fn hull(points: &[Point]) -> Vec<Point> {
    let mut p: Vec<Point> = points.to_vec();
    p.sort_by(|a, b| a.x.total_cmp(&b.x).then(a.y.total_cmp(&b.y)));
    p.dedup_by(|a, b| a.x == b.x && a.y == b.y);
    if p.len() < 3 {
        return p;
    }
    let turn = |o: Point, a: Point, b: Point| (a.x - o.x) * (b.y - o.y) - (a.y - o.y) * (b.x - o.x);
    // Lower chain left to right, then upper chain right to left; each chain drops
    // its last point, the first point of the other.
    let mut h: Vec<Point> = Vec::with_capacity(2 * p.len());
    let chain = |h: &mut Vec<Point>, q: Point, start: usize| {
        while h.len() >= start + 2 && turn(h[h.len() - 2], h[h.len() - 1], q) <= 0.0 {
            h.pop();
        }
        h.push(q);
    };
    for &q in &p {
        chain(&mut h, q, 0);
    }
    h.pop();
    let start = h.len();
    for &q in p.iter().rev() {
        chain(&mut h, q, start);
    }
    h.pop();
    h
}

/// The smallest-area rectangle around `points` with a side on a hull edge: its
/// corners in ring order and its area.
pub(super) fn min_rotated_rect(points: &[Point]) -> Option<(Vec<Point>, f64)> {
    let h = hull(points);
    if h.len() < 3 {
        return None;
    }
    (0..h.len())
        .map(|i| {
            let (a, b) = (h[i], h[(i + 1) % h.len()]);
            framed_box(&h, (b.y - a.y).atan2(b.x - a.x))
        })
        .min_by(|x, y| x.1.total_cmp(&y.1))
}
