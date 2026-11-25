//! Geometry helpers for procedural building volumes.

use super::*;

/// Oriented box of a ring along a chosen axis: centre, unit axis, half length
/// (along the axis) and half width (across).
#[derive(Clone, Copy)]
pub(super) struct Frame {
    pub(super) c: Point,
    pub(super) u: Point,
    pub(super) half_l: f64,
    pub(super) half_w: f64,
}
pub(super) fn frame_along(ring: &[Point], u: Point) -> Frame {
    let (mut s0, mut s1, mut t0, mut t1) = (f64::MAX, f64::MIN, f64::MAX, f64::MIN);
    for p in ring {
        let s = p.x * u.x + p.y * u.y;
        let t = -p.x * u.y + p.y * u.x;
        s0 = s0.min(s);
        s1 = s1.max(s);
        t0 = t0.min(t);
        t1 = t1.max(t);
    }
    let (s, t) = ((s0 + s1) / 2.0, (t0 + t1) / 2.0);
    Frame {
        c: Point {
            x: s * u.x - t * u.y,
            y: s * u.y + t * u.x,
        },
        u,
        half_l: (s1 - s0) / 2.0,
        half_w: (t1 - t0) / 2.0,
    }
}
/// Minimum-area oriented box, its axis along the longer side.
pub(super) fn min_frame(ring: &[Point]) -> Option<Frame> {
    let mut best: Option<(f64, Frame)> = None;
    for i in 0..ring.len() {
        let (a, b) = (ring[i], ring[(i + 1) % ring.len()]);
        let l = (b.x - a.x).hypot(b.y - a.y);
        if l < 1e-6 {
            continue;
        }
        let f = frame_along(ring, Point { x: (b.x - a.x) / l, y: (b.y - a.y) / l });
        let area = f.half_l * f.half_w;
        if best.as_ref().is_none_or(|(a, _)| area < *a) {
            best = Some((area, f));
        }
    }
    best.map(|(_, f)| {
        if f.half_l >= f.half_w {
            f
        } else {
            frame_along(ring, Point { x: -f.u.y, y: f.u.x })
        }
    })
}

pub(super) fn near_segment(shape: &Shape, a: Point, b: Point, tolerance: f64) -> bool {
    let ring = &shape.outer;
    (0..ring.len()).any(|i| {
        let (p, q) = (ring[i], ring[(i + 1) % ring.len()]);
        let m = Point { x: (p.x + q.x) / 2.0, y: (p.y + q.y) / 2.0 };
        [p, m, q]
            .iter()
            .any(|&x| super::super::geometry::distance(x, a, b).0 <= tolerance)
    })
}
pub(super) fn touches(a: &Shape, b: &Shape) -> bool {
    let ring = &b.outer;
    (0..ring.len()).any(|i| near_segment(a, ring[i], ring[(i + 1) % ring.len()], 0.35))
}

/// Display massing of one ruin piece (parcels/ruins.rs `broken_walls`):
// ---- polygon helpers (convex decomposition, clipping, ridges) ----

pub(super) fn cross3(a: Point, b: Point, c: Point) -> f64 {
    (b.x - a.x) * (c.y - a.y) - (b.y - a.y) * (c.x - a.x)
}
pub(super) fn ring_area(r: &[Point]) -> f64 {
    super::super::geometry::signed(r).abs()
}
/// Drops repeated and collinear vertices.
fn clean(ring: Vec<Point>) -> Vec<Point> {
    let mut r: Vec<Point> = Vec::with_capacity(ring.len());
    for p in ring {
        if r.last().is_none_or(|q| (q.x - p.x).hypot(q.y - p.y) > 1e-5) {
            r.push(p);
        }
    }
    while r.len() > 1 && (r[0].x - r[r.len() - 1].x).hypot(r[0].y - r[r.len() - 1].y) <= 1e-5 {
        r.pop();
    }
    let mut changed = true;
    while changed && r.len() > 3 {
        changed = false;
        for i in 0..r.len() {
            let (p, v, q) = (r[(i + r.len() - 1) % r.len()], r[i], r[(i + 1) % r.len()]);
            let l = (v.x - p.x).hypot(v.y - p.y) * (q.x - v.x).hypot(q.y - v.y);
            if cross3(p, v, q).abs() <= 1e-6 * l.max(1e-9) {
                r.remove(i);
                changed = true;
                break;
            }
        }
    }
    r
}
pub(super) fn orient(r: &[Point]) -> f64 {
    if super::super::geometry::signed(r) >= 0.0 { 1.0 } else { -1.0 }
}
fn reflex_at(r: &[Point], i: usize, sg: f64) -> bool {
    let n = r.len();
    let (p, v, q) = (r[(i + n - 1) % n], r[i], r[(i + 1) % n]);
    let l = (v.x - p.x).hypot(v.y - p.y) * (q.x - v.x).hypot(q.y - v.y);
    l > 1e-9 && cross3(p, v, q) * sg < -0.03 * l
}
pub(super) fn reflex_count(r: &[Point]) -> usize {
    let sg = orient(r);
    (0..r.len()).filter(|&i| reflex_at(r, i, sg)).count()
}
/// Cuts the ring from reflex vertex `i` along the extension of its edge
/// towards `from`; returns the two parts and the cut length.
fn cut_from(r: &[Point], i: usize, from: usize) -> Option<(Vec<Point>, Vec<Point>, f64)> {
    let n = r.len();
    let v = r[i];
    let (dx, dy) = (v.x - r[from].x, v.y - r[from].y);
    let l = dx.hypot(dy);
    if l < 1e-9 {
        return None;
    }
    let d = Point { x: dx / l, y: dy / l };
    let skip = [(i + n - 1) % n, i];
    let mut best: Option<(f64, usize)> = None;
    for j in 0..n {
        if skip.contains(&j) {
            continue;
        }
        let (a, b) = (r[j], r[(j + 1) % n]);
        let e = Point { x: b.x - a.x, y: b.y - a.y };
        let den = d.x * e.y - d.y * e.x;
        if den.abs() < 1e-12 {
            continue;
        }
        let av = Point { x: a.x - v.x, y: a.y - v.y };
        let t = (av.x * e.y - av.y * e.x) / den;
        let s = (av.x * d.y - av.y * d.x) / den;
        if t > 1e-6 && (-1e-9..1.0).contains(&s) && best.is_none_or(|(bt, _)| t < bt) {
            best = Some((t, j));
        }
    }
    let (t, j) = best?;
    let h = Point { x: v.x + d.x * t, y: v.y + d.y * t };
    let mut a = vec![v];
    let mut k = (i + 1) % n;
    loop {
        a.push(r[k]);
        if k == j {
            break;
        }
        k = (k + 1) % n;
    }
    a.push(h);
    let mut b = vec![h];
    let mut k = (j + 1) % n;
    while k != i {
        b.push(r[k]);
        k = (k + 1) % n;
    }
    b.push(v);
    let (a, b) = (clean(a), clean(b));
    if a.len() < 3 || b.len() < 3 || ring_area(&a) < 0.5 || ring_area(&b) < 0.5 {
        return None;
    }
    Some((a, b, t))
}
/// Convex decomposition at reflex vertices: each cut extends an edge across
/// the reflex corner, the cut leaving the fewest reflex corners (then the
/// shortest) wins. Parts that stay non-convex (cut budget spent) are kept.
pub(super) fn convex_parts(ring: Vec<Point>, budget: &mut usize) -> Vec<Vec<Point>> {
    let ring = clean(ring);
    if ring.len() < 3 || reflex_count(&ring) == 0 || *budget == 0 {
        return vec![ring];
    }
    let sg = orient(&ring);
    let n = ring.len();
    let mut best: Option<(usize, f64, Vec<Point>, Vec<Point>)> = None;
    for i in 0..n {
        if !reflex_at(&ring, i, sg) {
            continue;
        }
        for from in [(i + n - 1) % n, (i + 1) % n] {
            if let Some((a, b, len)) = cut_from(&ring, i, from) {
                let score = reflex_count(&a) + reflex_count(&b);
                if best.as_ref().is_none_or(|(s, l, _, _)| (score, len) < (*s, *l)) {
                    best = Some((score, len, a, b));
                }
            }
        }
    }
    let Some((_, _, a, b)) = best else {
        return vec![ring];
    };
    *budget -= 1;
    let mut out = convex_parts(a, budget);
    out.extend(convex_parts(b, budget));
    out
}
/// Keeps the part of a convex ring with `p·n >= d`.
pub(super) fn clip_half(r: &[Point], n: Point, d: f64) -> Vec<Point> {
    let mut out = Vec::new();
    for i in 0..r.len() {
        let (a, b) = (r[i], r[(i + 1) % r.len()]);
        let (da, db) = (a.x * n.x + a.y * n.y - d, b.x * n.x + b.y * n.y - d);
        if da >= 0.0 {
            out.push(a);
        }
        if (da >= 0.0) != (db >= 0.0) {
            let k = da / (da - db);
            out.push(Point { x: a.x + (b.x - a.x) * k, y: a.y + (b.y - a.y) * k });
        }
    }
    clean(out)
}
/// Part of a convex ring with `lo <= p·axis <= hi`.
pub(in crate::urban) fn clip_band(r: &[Point], axis: Point, lo: f64, hi: f64) -> Vec<Point> {
    let a = clip_half(r, axis, lo);
    if a.len() < 3 {
        return a;
    }
    clip_half(&a, Point { x: -axis.x, y: -axis.y }, -hi)
}
pub(super) fn perp(u: Point) -> Point {
    Point { x: -u.y, y: u.x }
}
/// Extent along `u` of the line `p·perp(u) = t` inside a convex ring.
pub(super) fn chord(r: &[Point], u: Point, t: f64) -> Option<(f64, f64)> {
    let n = perp(u);
    let (mut s0, mut s1) = (f64::MAX, f64::MIN);
    for i in 0..r.len() {
        let (a, b) = (r[i], r[(i + 1) % r.len()]);
        let (ta, tb) = (a.x * n.x + a.y * n.y - t, b.x * n.x + b.y * n.y - t);
        if ta * tb <= 0.0 && (ta - tb).abs() > 1e-12 {
            let k = ta / (ta - tb);
            let p = Point { x: a.x + (b.x - a.x) * k, y: a.y + (b.y - a.y) * k };
            let s = p.x * u.x + p.y * u.y;
            s0 = s0.min(s);
            s1 = s1.max(s);
        }
    }
    (s1 > s0).then_some((s0, s1))
}
pub(super) fn at_st(u: Point, s: f64, t: f64) -> Point {
    Point { x: s * u.x - t * u.y, y: s * u.y + t * u.x }
}
pub(super) fn ring_centroid(r: &[Point]) -> Point {
    super::super::geometry::centroid(&Shape { outer: r.to_vec(), holes: vec![] })
}
pub(super) fn ring_json(r: &[Point]) -> Value {
    Value::Array(r.iter().map(|p| json!([round2(p.x), round2(p.y)])).collect())
}
