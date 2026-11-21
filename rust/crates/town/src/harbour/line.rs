//! Polyline helpers for quay lines measured in metres along their length.

use magna_urbis_geom::{Point, distance};

/// Length of a polyline in metres.
pub(super) fn length(path: &[Point]) -> f64 {
    path.windows(2).map(|w| w[0].distance(w[1])).sum()
}

/// Unit vector from `a` to `b`.
pub(super) fn unit(a: Point, b: Point) -> Point {
    let l = a.distance(b).max(1e-9);
    Point {
        x: (b.x - a.x) / l,
        y: (b.y - a.y) / l,
    }
}

/// The left normal of a unit direction.
pub(super) fn left(t: Point) -> Point {
    Point { x: -t.y, y: t.x }
}

/// `p` moved `d` metres along `n`.
pub(super) fn add(p: Point, n: Point, d: f64) -> Point {
    Point {
        x: p.x + n.x * d,
        y: p.y + n.y * d,
    }
}

/// The point `s` metres along a polyline (clamped to its ends) and the direction there.
pub(super) fn point_at(path: &[Point], s: f64) -> (Point, Point) {
    let mut rest = s.max(0.0);
    for w in path.windows(2) {
        let l = w[0].distance(w[1]);
        if l <= 1e-9 {
            continue;
        }
        if rest <= l {
            let t = rest / l;
            let p = Point {
                x: w[0].x + (w[1].x - w[0].x) * t,
                y: w[0].y + (w[1].y - w[0].y) * t,
            };
            return (p, unit(w[0], w[1]));
        }
        rest -= l;
    }
    let n = path.len();
    let direction = if n >= 2 {
        unit(path[n - 2], path[n - 1])
    } else {
        Point { x: 1.0, y: 0.0 }
    };
    (path[n - 1], direction)
}

/// Station of the point of a polyline nearest `p`, in metres along it, and the distance to it.
pub(super) fn project(path: &[Point], p: Point) -> (f64, f64) {
    let mut walked = 0.0;
    let mut best = (0.0, f64::INFINITY);
    for w in path.windows(2) {
        let l = w[0].distance(w[1]);
        let (d, t, _) = distance(p, w[0], w[1]);
        if d < best.1 {
            best = (walked + t * l, d);
        }
        walked += l;
    }
    best
}

/// The part of a polyline between stations `from` and `to` (`from < to`), ends interpolated.
pub(super) fn sub_path(path: &[Point], from: f64, to: f64) -> Vec<Point> {
    let mut out: Vec<Point> = vec![point_at(path, from).0];
    let mut walked = 0.0;
    for w in path.windows(2) {
        walked += w[0].distance(w[1]);
        if walked > from + 1e-9 && walked < to - 1e-9 {
            out.push(w[1]);
        }
    }
    let end = point_at(path, to).0;
    if out.last().is_none_or(|q| q.distance(end) > 1e-9) {
        out.push(end);
    }
    out
}

/// A polyline offset `d` metres to its left (negative: to its right), vertex by vertex along the
/// mean of the adjacent segments' normals.
pub(super) fn offset(path: &[Point], d: f64) -> Vec<Point> {
    let n = path.len();
    (0..n)
        .map(|i| {
            let a = path[i.saturating_sub(1)];
            let b = path[(i + 1).min(n - 1)];
            add(path[i], left(unit(a, b)), d)
        })
        .collect()
}

/// The interval of `span` metres of a line `total` long centred on `at`, kept inside the line.
/// Intervals centred on one station nest as they grow, so a lengthened quay keeps its old stretch.
pub(super) fn centred(total: f64, at: f64, span: f64) -> [f64; 2] {
    let span = span.min(total);
    let from = (at - span * 0.5).clamp(0.0, (total - span).max(0.0));
    [from, from + span]
}
