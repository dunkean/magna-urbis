use serde::{Deserialize, Serialize};
#[derive(Clone, Copy, Debug, Default, Deserialize, Serialize, PartialEq)]
pub struct Point {
    pub x: f64,
    pub y: f64,
}
pub type Polygon = Vec<Point>;
#[derive(Clone, Debug, Default, Deserialize, Serialize)]
pub struct Region {
    #[serde(serialize_with = "super::wire::polygon")]
    pub outer: Polygon,
    #[serde(default)]
    #[serde(serialize_with = "super::wire::polygons")]
    pub holes: Vec<Polygon>,
}
pub fn p(x: f64, y: f64) -> Point {
    Point { x, y }
}
pub fn dist(a: Point, b: Point) -> f64 {
    (a.x - b.x).hypot(a.y - b.y)
}
pub fn lerp(a: Point, b: Point, t: f64) -> Point {
    p(a.x + (b.x - a.x) * t, a.y + (b.y - a.y) * t)
}
pub fn area(a: &[Point]) -> f64 {
    if a.is_empty() {
        return 0.0;
    }
    a.iter()
        .zip(a.iter().cycle().skip(1))
        .map(|(a, b)| a.x * b.y - b.x * a.y)
        .sum::<f64>()
        / 2.0
}
pub fn region_area(r: &Region) -> f64 {
    area(&r.outer).abs() - r.holes.iter().map(|h| area(h).abs()).sum::<f64>()
}
pub fn centroid(a: &[Point]) -> Point {
    let (mut x, mut y, mut s) = (0.0, 0.0, 0.0);
    for i in 0..a.len() {
        let b = a[(i + 1) % a.len()];
        let c = a[i].x * b.y - b.x * a[i].y;
        s += c;
        x += (a[i].x + b.x) * c;
        y += (a[i].y + b.y) * c;
    }
    if s.abs() < 1e-9 {
        p(
            a.iter().map(|p| p.x).sum::<f64>() / a.len() as f64,
            a.iter().map(|p| p.y).sum::<f64>() / a.len() as f64,
        )
    } else {
        p(x / (3.0 * s), y / (3.0 * s))
    }
}
pub fn contains(a: &[Point], q: Point) -> bool {
    let mut inside = false;
    if a.is_empty() {
        return false;
    }
    let mut j = a.len() - 1;
    for i in 0..a.len() {
        let (a, b) = (a[i], a[j]);
        if (a.y > q.y) != (b.y > q.y) && q.x < (b.x - a.x) * (q.y - a.y) / (b.y - a.y) + a.x {
            inside = !inside;
        }
        j = i;
    }
    inside
}
pub fn inside(r: &Region, q: Point) -> bool {
    contains(&r.outer, q) && !r.holes.iter().any(|h| contains(h, q))
}
#[derive(Clone, Copy, Debug)]
pub struct Box2 {
    pub x0: f64,
    pub y0: f64,
    pub x1: f64,
    pub y1: f64,
}
impl Box2 {
    pub fn meets(self, b: Self) -> bool {
        self.x0 <= b.x1 && self.x1 >= b.x0 && self.y0 <= b.y1 && self.y1 >= b.y0
    }
    pub fn grow(self, m: f64) -> Self {
        Self {
            x0: self.x0 - m,
            y0: self.y0 - m,
            x1: self.x1 + m,
            y1: self.y1 + m,
        }
    }
    pub fn contains(self, p: Point) -> bool {
        p.x >= self.x0 && p.x <= self.x1 && p.y >= self.y0 && p.y <= self.y1
    }
}
pub fn bbox(a: &[Point]) -> Box2 {
    let mut b = Box2 {
        x0: f64::INFINITY,
        y0: f64::INFINITY,
        x1: f64::NEG_INFINITY,
        y1: f64::NEG_INFINITY,
    };
    for p in a {
        b.x0 = b.x0.min(p.x);
        b.x1 = b.x1.max(p.x);
        b.y0 = b.y0.min(p.y);
        b.y1 = b.y1.max(p.y);
    }
    b
}
pub fn orient(mut a: Polygon) -> Polygon {
    if area(&a) < 0.0 {
        a.reverse();
    }
    a
}
pub fn piece(a: Polygon) -> Region {
    Region {
        outer: orient(a),
        holes: vec![],
    }
}
pub fn closed(a: &[Point]) -> Polygon {
    let mut o = a.to_vec();
    if let Some(&p) = a.first() {
        o.push(p);
    }
    o
}
pub fn rect(x: f64, y: f64, l: f64, w: f64, a: f64) -> Polygon {
    let (c, s) = (a.cos(), a.sin());
    [
        (-l / 2.0, -w / 2.0),
        (l / 2.0, -w / 2.0),
        (l / 2.0, w / 2.0),
        (-l / 2.0, w / 2.0),
    ]
    .iter()
    .map(|&(u, v)| p(x + u * c - v * s, y + u * s + v * c))
    .collect()
}
pub fn circle(c: Point, r: f64, n: usize) -> Polygon {
    (0..n)
        .map(|i| {
            let a = i as f64 / n as f64 * 2.0 * std::f64::consts::PI;
            p(c.x + a.cos() * r, c.y + a.sin() * r)
        })
        .collect()
}
pub fn nearest(p: Point, a: Point, b: Point) -> Point {
    let (dx, dy) = (b.x - a.x, b.y - a.y);
    let l = dx * dx + dy * dy;
    let t =
        (((p.x - a.x) * dx + (p.y - a.y) * dy) / if l == 0.0 { 1.0 } else { l }).clamp(0.0, 1.0);
    lerp(a, b, t)
}
pub fn line_dist(p: Point, a: &[Point]) -> f64 {
    a.windows(2)
        .map(|s| dist(p, nearest(p, s[0], s[1])))
        .fold(f64::INFINITY, f64::min)
}
pub fn simplify(a: &[Point], tol: f64) -> Polygon {
    if a.len() < 3 {
        return a.to_vec();
    }
    let mut keep = vec![false; a.len()];
    keep[0] = true;
    keep[a.len() - 1] = true;
    let mut stack = vec![(0, a.len() - 1)];
    while let Some((s, e)) = stack.pop() {
        let (mut md, mut bi) = (0.0, None);
        for i in s + 1..e {
            let d = dist(a[i], nearest(a[i], a[s], a[e]));
            if d > md {
                md = d;
                bi = Some(i);
            }
        }
        if md > tol {
            if let Some(i) = bi {
                keep[i] = true;
                stack.push((s, i));
                stack.push((i, e));
            }
        }
    }
    a.iter()
        .enumerate()
        .filter_map(|(i, &p)| keep[i].then_some(p))
        .collect()
}
pub fn chaikin(a: &[Point], iterations: usize) -> Polygon {
    let mut cur = a.to_vec();
    for _ in 0..iterations {
        if cur.len() < 3 {
            return cur;
        }
        let mut out = Vec::with_capacity(cur.len() * 2);
        for i in 0..cur.len() {
            let (a, b) = (cur[i], cur[(i + 1) % cur.len()]);
            out.push(p(0.75 * a.x + 0.25 * b.x, 0.75 * a.y + 0.25 * b.y));
            out.push(p(0.25 * a.x + 0.75 * b.x, 0.25 * a.y + 0.75 * b.y));
        }
        cur = out;
    }
    cur
}
pub fn ribbon_widths(a: &[Point], widths: &[f64]) -> Polygon {
    if a.len() < 2 {
        return vec![];
    }
    let mut l = vec![];
    let mut r = vec![];
    for i in 0..a.len() {
        let (x, y) = (a[i.saturating_sub(1)], a[(i + 1).min(a.len() - 1)]);
        let (dx, dy) = (y.x - x.x, y.y - x.y);
        let len = dx.hypot(dy);
        let len = if len == 0.0 { 1.0 } else { len };
        let w = widths[i] / 2.0;
        l.push(p(a[i].x - dy / len * w, a[i].y + dx / len * w));
        r.push(p(a[i].x + dy / len * w, a[i].y - dx / len * w));
    }
    r.reverse();
    l.extend(r);
    l
}
pub fn ribbon(a: &[Point], w: f64) -> Polygon {
    ribbon_widths(a, &vec![w; a.len()])
}
pub fn smooth(x: f64, a: f64, b: f64) -> f64 {
    let t = ((x - a) / if b == a { 1e-9 } else { b - a }).clamp(0.0, 1.0);
    t * t * (3.0 - 2.0 * t)
}
pub fn valid(a: &[Region]) -> bool {
    a.iter().all(|r| {
        std::iter::once(&r.outer)
            .chain(&r.holes)
            .all(|a| a.iter().all(|p| p.x.is_finite() && p.y.is_finite()))
    })
}
