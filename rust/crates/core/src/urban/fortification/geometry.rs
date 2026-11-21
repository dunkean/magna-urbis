//! Curtain geometry, terrain sampling and polygon clipping for fortifications.

use crate::urban::{Point, Shape, Surface, geometry as g};

/// Half width of the curtain ribbon (inner face at −h).
pub(in super::super) fn ribbon_half(kind: &str) -> f64 {
    if kind == "wall" { 1.5 } else { 0.75 }
}

pub(super) type V = (f64, f64);
pub(super) fn pt(x: f64, y: f64) -> Point {
    Point { x, y }
}
pub(super) fn add(p: Point, d: V, k: f64) -> Point {
    pt(p.x + d.0 * k, p.y + d.1 * k)
}
pub(super) fn dir(a: Point, b: Point) -> V {
    let l = (b.x - a.x).hypot(b.y - a.y).max(1e-12);
    ((b.x - a.x) / l, (b.y - a.y) / l)
}
pub(super) fn dist(a: Point, b: Point) -> f64 {
    (a.x - b.x).hypot(a.y - b.y)
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
/// Rectangle `o + along·[a0, a1] + across·[b0, b1]`, counter-clockwise.
pub(super) fn quad(o: Point, along: V, across: V, a: [f64; 2], b: [f64; 2]) -> Shape {
    let at = |s: f64, t: f64| {
        pt(
            o.x + along.0 * s + across.0 * t,
            o.y + along.1 * s + across.1 * t,
        )
    };
    g::normalized(Shape {
        outer: vec![
            at(a[0], b[0]),
            at(a[1], b[0]),
            at(a[1], b[1]),
            at(a[0], b[1]),
        ],
        holes: vec![],
    })
}
pub(super) fn disc(c: Point, r: f64, k: usize, phase: f64) -> Shape {
    Shape {
        outer: (0..k)
            .map(|i| {
                let a = phase + i as f64 * std::f64::consts::TAU / k as f64;
                pt(c.x + r * a.cos(), c.y + r * a.sin())
            })
            .collect(),
        holes: vec![],
    }
}

pub(super) type Box2 = (f64, f64, f64, f64);
pub(super) fn overlaps(a: Box2, b: Box2, m: f64) -> bool {
    a.0 <= b.2 + m && b.0 <= a.2 + m && a.1 <= b.3 + m && b.1 <= a.3 + m
}
pub(super) fn buffer(s: &Shape, d: f64) -> Vec<Shape> {
    use geo::Buffer;
    let p = g::polygon(s);
    std::panic::catch_unwind(std::panic::AssertUnwindSafe(|| g::shapes(p.buffer(d))))
        .unwrap_or_default()
}
pub(super) fn curtain_body(path: &[Point], width: f64, half: f64) -> Vec<Shape> {
    let n = path.len().saturating_sub(1);
    if n<3 { return vec![]; }
    let ns = normals(path);
    let offset = |i:usize,d:f64| {
        let (a,b) = (ns[(i+n-1)%n],ns[i]);
        let m = (a.0+b.0,a.1+b.1); let len=m.0.hypot(m.1);
        let m = if len<1e-6 {b} else {(m.0/len,m.1/len)};
        add(path[i],m,d/dot(m,b).max(0.4))
    };
    let inner:Vec<_> = (0..n).map(|i|offset(i,-half-0.15)).collect();
    let outer:Vec<_> = (0..n).map(|i|offset(i,width-half+0.15)).collect();
    (0..n).map(|i|g::normalized(Shape {outer:vec![inner[i],inner[(i+1)%n],outer[(i+1)%n],outer[i]],holes:vec![]})).collect()
}
pub(super) fn buffer_all(shapes: &[Shape], d: f64) -> Vec<Shape> {
    use geo::Buffer;
    let mp = geo::MultiPolygon(shapes.iter().map(g::polygon).collect());
    std::panic::catch_unwind(std::panic::AssertUnwindSafe(|| g::shapes(mp.buffer(d))))
        .unwrap_or_default()
}
pub(super) fn area(v: &[Shape]) -> f64 {
    v.iter().map(g::area).sum()
}
/// Shapes split by halving until each fits in a `size` box: a ring around a
/// whole town (curtain body, outer wall, reserve) becomes pieces that box
/// tests can skip, so clipping it costs its own size, not the town's.
pub(super) fn tiles(shapes: Vec<Shape>, size: f64) -> Vec<Shape> {
    let mut out = vec![];
    let mut stack = shapes;
    while let Some(s) = stack.pop() {
        let (x0, y0, x1, y1) = g::bbox(&s);
        if (x1 - x0).max(y1 - y0) <= size || s.outer.len() <= 16 {
            out.push(s);
            continue;
        }
        let halves = if x1 - x0 >= y1 - y0 {
            let m = (x0 + x1) * 0.5;
            [
                g::rectangle(x0 - 1.0, y0 - 1.0, m, y1 + 1.0),
                g::rectangle(m, y0 - 1.0, x1 + 1.0, y1 + 1.0),
            ]
        } else {
            let m = (y0 + y1) * 0.5;
            [
                g::rectangle(x0 - 1.0, y0 - 1.0, x1 + 1.0, m),
                g::rectangle(x0 - 1.0, m, x1 + 1.0, y1 + 1.0),
            ]
        };
        for h in &halves {
            stack.extend(
                g::intersection(&s, h)
                    .into_iter()
                    .filter(|p| g::area(p) > 0.01),
            );
        }
    }
    // Deterministic order whatever the split order.
    out.sort_by(|a, b| {
        let (pa, pb) = (g::bbox(a), g::bbox(b));
        pa.0.total_cmp(&pb.0).then(pa.1.total_cmp(&pb.1))
    });
    out
}
pub(super) const TILE: f64 = 200.0;

/// Shapes with their boxes, for cheap repeated subtraction.
pub(super) struct Cut {
    pub(super) shapes: Vec<(Shape, Box2)>,
}
impl Cut {
    pub(super) fn new(shapes: Vec<Shape>) -> Self {
        Cut {
            shapes: shapes
                .into_iter()
                .map(|s| {
                    let b = g::bbox(&s);
                    (s, b)
                })
                .collect(),
        }
    }
    pub(super) fn add(&mut self, s: Shape) {
        let b = g::bbox(&s);
        self.shapes.push((s, b));
    }
    pub(super) fn from(&self, pieces: Vec<Shape>) -> Vec<Shape> {
        let mut out = pieces;
        for (c, cb) in &self.shapes {
            if out.is_empty() {
                break;
            }
            out = out
                .into_iter()
                .flat_map(|p| {
                    if overlaps(g::bbox(&p), *cb, 0.0) {
                        g::difference(&p, c)
                    } else {
                        vec![p]
                    }
                })
                .filter(|p| g::area(p) > 0.01)
                .collect();
        }
        out
    }
    pub(super) fn hits(&self, s: &Shape) -> f64 {
        let b = g::bbox(s);
        self.shapes
            .iter()
            .filter(|(_, cb)| overlaps(b, *cb, 0.0))
            .map(|(c, _)| area(&g::intersection(s, c)))
            .sum()
    }
}

/// Outward unit normal of each segment of a closed path.
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
    // The right-hand side is outward for a counter-clockwise ring; check it on
    // the longest side as `contains(m + 2n) == false`.
    if let Some(k) = (0..ns.len())
        .max_by(|&a, &b| dist(path[a], path[a + 1]).total_cmp(&dist(path[b], path[b + 1])))
    {
        let m = pt(
            (path[k].x + path[k + 1].x) * 0.5,
            (path[k].y + path[k + 1].y) * 0.5,
        );
        if g::contains(&ring, add(m, ns[k], 2.0)) {
            for n in &mut ns {
                *n = (-n.0, -n.1);
            }
        }
    }
    ns
}
pub(super) fn segment_relief(a: Point, b: Point, n: V, surface: Surface<'_>) -> f64 {
    let k = (dist(a, b) / 40.0).ceil().max(1.0) as usize;
    (0..k)
        .map(|i| {
            let t = (i as f64 + 0.5) / k as f64;
            let m = pt(a.x + (b.x - a.x) * t, a.y + (b.y - a.y) * t);
            (surface.height_at(add(m, n, 12.0)) - surface.height_at(add(m, n, -12.0))).abs() / 24.0
        })
        .sum::<f64>()
        / k as f64
}
pub(super) fn wet_outward(a: Point, b: Point, n: V, surface: Surface<'_>, off: f64) -> f64 {
    let k = (dist(a, b) / 10.0).ceil().max(1.0) as usize;
    (0..k)
        .filter(|&i| {
            let t = (i as f64 + 0.5) / k as f64;
            surface.wet(add(
                pt(a.x + (b.x - a.x) * t, a.y + (b.y - a.y) * t),
                n,
                off,
            ))
        })
        .count() as f64
        / k as f64
}
/// Length-weighted relief of the curtains (`R`) and the wet share of their
/// outward side 10 m out.
pub(in super::super) fn terrain(walls: &[Shape], surface: Surface<'_>) -> (f64, f64) {
    let (mut r, mut w, mut total) = (0.0, 0.0, 0.0);
    for wall in walls {
        let mut path = wall.outer.clone();
        path.push(path[0]);
        let ns = normals(&path);
        for (e, n) in path.windows(2).zip(&ns) {
            let l = dist(e[0], e[1]);
            r += l * segment_relief(e[0], e[1], *n, surface);
            w += l * wet_outward(e[0], e[1], *n, surface, 10.0);
            total += l;
        }
    }
    if total <= 0.0 {
        (0.0, 0.0)
    } else {
        (r / total, w / total)
    }
}

pub(super) fn turn_at(ring: &[Point], i: usize) -> f64 {
    let n = ring.len();
    let (a, p, b) = (ring[(i + n - 1) % n], ring[i], ring[(i + 1) % n]);
    let (u, v) = (dir(a, p), dir(p, b));
    cross(u, v).atan2(dot(u, v)).abs()
}

pub(super) fn closed(ring: &[Point]) -> Vec<Point> {
    ring.iter().copied().chain(ring.first().copied()).collect()
}
