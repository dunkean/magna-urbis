//! One-sided strokes: the land an edge takes on the side of its centre line where the
//! block lies, as convex pieces (one quad per segment, one miter or bevel per outer turn).

use std::f64::consts::TAU;

use magna_urbis_geom::{Point, Shape, normalized, signed};

/// How far a stroke reaches behind its centre line. The face's boundary runs on the centre
/// line; reaching slightly past it keeps the boundary strictly inside the stroke, so the
/// difference leaves no hairline along it whatever the rounding.
const BACK: f64 = 0.05;
/// Path ends closer than this (m) meet at one node.
const SAME: f64 = 1e-4;
/// Turns whose sine is below this are straight.
const STRAIGHT: f64 = 1e-9;
/// Pieces below this area (m²) cover nothing.
const EMPTY: f64 = 1e-6;

/// A boundary walked with the land to cover on its left.
#[derive(Clone, Debug)]
pub(super) struct Path {
    /// Centre line, without repeated points.
    pub points: Vec<Point>,
    /// Half-width taken at each point.
    pub half: Vec<f64>,
}

impl Path {
    /// A path on `points` with half-widths `half` (the last value repeats where `half` is
    /// short); repeated points merge, keeping the larger half-width.
    pub fn new(points: &[Point], half: &[f64]) -> Self {
        let at = |i: usize| half.get(i).or(half.last()).copied().unwrap_or(0.0).max(0.0);
        let mut path = Self {
            points: Vec::with_capacity(points.len()),
            half: Vec::with_capacity(points.len()),
        };
        for (i, &p) in points.iter().enumerate() {
            if !(p.x.is_finite() && p.y.is_finite()) {
                continue;
            }
            if path.points.last().is_some_and(|q| q.distance(p) < 1e-9) {
                let last = path.half.len() - 1;
                path.half[last] = path.half[last].max(at(i));
            } else {
                path.points.push(p);
                path.half.push(at(i));
            }
        }
        path
    }

    /// A closed ring as a path that returns to its first point, `half` everywhere.
    pub fn ring(ring: &[Point], half: f64) -> Self {
        let mut points = ring.to_vec();
        if let Some(&first) = ring.first() {
            points.push(first);
        }
        Self::new(&points, &[half])
    }
}

/// For each path, the path its walk continues on at its end: among the paths that start where
/// it ends, the first one clockwise from the way it came, as a face walk turns at a node. A path
/// turning back on itself (the far side of a dead end) is taken only when nothing else starts
/// there. Pairs are `(arriving, leaving)`.
pub(super) fn links(paths: &[Path]) -> Vec<(usize, usize)> {
    let mut out = Vec::new();
    for (a, pa) in paths.iter().enumerate() {
        let n = pa.points.len();
        if n < 2 {
            continue;
        }
        let end = pa.points[n - 1];
        let back = angle(end, pa.points[n - 2]);
        let next = paths
            .iter()
            .enumerate()
            .filter(|(_, pb)| pb.points.len() >= 2 && pb.points[0].distance(end) <= SAME)
            .map(|(b, pb)| (clockwise(back, angle(pb.points[0], pb.points[1])), b))
            .min_by(|x, y| x.0.total_cmp(&y.0).then(x.1.cmp(&y.1)));
        if let Some((_, b)) = next {
            out.push((a, b));
        }
    }
    out
}

/// The land the paths take on their left: a quad per segment, a join at every turn inside a
/// path and at every `(arriving, leaving)` link. Each piece is convex.
pub(super) fn cover(paths: &[Path], links: &[(usize, usize)], miter_limit: f64) -> Vec<Shape> {
    let mut out = Vec::new();
    for path in paths {
        let (p, h) = (&path.points, &path.half);
        for i in 1..p.len() {
            out.extend(quad(p[i - 1], p[i], h[i - 1], h[i]));
        }
        for i in 1..p.len().saturating_sub(1) {
            out.extend(join(p[i - 1], p[i], p[i + 1], h[i], h[i], miter_limit));
        }
    }
    for &(a, b) in links {
        let (pa, pb) = (&paths[a], &paths[b]);
        let n = pa.points.len();
        if n < 2 || pb.points.len() < 2 {
            continue;
        }
        out.extend(join(
            pa.points[n - 2],
            pa.points[n - 1],
            pb.points[1],
            pa.half[n - 1],
            pb.half[0],
            miter_limit,
        ));
    }
    out
}

/// The land on the left of segment `ab` up to the half-widths at its ends, reaching `BACK`
/// behind it.
fn quad(a: Point, b: Point, ha: f64, hb: f64) -> Option<Shape> {
    if ha <= 0.0 && hb <= 0.0 {
        return None;
    }
    let u = unit(a, b)?;
    let n = left(u);
    piece(vec![
        offset(a, n, -BACK),
        offset(b, n, -BACK),
        offset(b, n, hb),
        offset(a, n, ha),
    ])
}

/// The gap the quads of `from → at` and `at → to` leave on their left at `at`: none when the
/// path turns left (the land lies inside the turn, where the quads overlap); otherwise the
/// miter up to where both offset lines meet, or the bevel between their ends when the miter
/// would reach further than `miter_limit` times the larger half-width. Turning back on itself,
/// the bevel is flat: the end of a dead end is square.
fn join(from: Point, at: Point, to: Point, h_in: f64, h_out: f64, miter_limit: f64) -> Option<Shape> {
    let (u, v) = (unit(from, at)?, unit(at, to)?);
    let turn = cross(u, v);
    if turn > STRAIGHT || (h_in <= 0.0 && h_out <= 0.0) {
        return None;
    }
    let a = offset(at, left(u), h_in);
    let b = offset(at, left(v), h_out);
    if a.distance(b) < 1e-6 {
        return None;
    }
    let mut ring = vec![at, a];
    if turn < -STRAIGHT {
        // a + s·u = b + t·v: the miter lies ahead of `a` and behind `b`.
        let d = Point {
            x: b.x - a.x,
            y: b.y - a.y,
        };
        let (s, t) = (cross(d, v) / turn, cross(d, u) / turn);
        let m = offset(a, u, s);
        if s >= 0.0 && t <= 0.0 && m.distance(at) <= miter_limit * h_in.max(h_out) {
            ring.push(m);
        }
    }
    ring.push(b);
    ring.dedup_by(|p, q| p.distance(*q) < 1e-9);
    piece(ring)
}

fn piece(outer: Vec<Point>) -> Option<Shape> {
    (outer.len() >= 3 && signed(&outer).abs() > EMPTY).then(|| {
        normalized(Shape {
            outer,
            holes: vec![],
        })
    })
}

/// Clockwise angle from direction `from` to direction `to`, in `(0, 2π]`.
fn clockwise(from: f64, to: f64) -> f64 {
    let d = (from - to).rem_euclid(TAU);
    if d < 1e-12 { TAU } else { d }
}

fn angle(a: Point, b: Point) -> f64 {
    (b.y - a.y).atan2(b.x - a.x)
}

fn unit(a: Point, b: Point) -> Option<Point> {
    let l = a.distance(b);
    (l > 1e-9).then(|| Point {
        x: (b.x - a.x) / l,
        y: (b.y - a.y) / l,
    })
}

fn left(u: Point) -> Point {
    Point { x: -u.y, y: u.x }
}

fn cross(u: Point, v: Point) -> f64 {
    u.x * v.y - u.y * v.x
}

fn offset(p: Point, dir: Point, by: f64) -> Point {
    Point {
        x: p.x + dir.x * by,
        y: p.y + dir.y * by,
    }
}
