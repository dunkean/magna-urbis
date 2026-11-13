//! Roof solids and their union.
//!
//! A pitched roof over a convex mass is the lower envelope of a few planes
//! (two for a gable, one per wall for a hip, a steep and a shallow one per
//! side for a gambrel or a mansard…). The roof of a lot is the upper envelope
//! of its masses' roofs: a pan is kept where no other mass stands above it.
//! Both envelopes only need half-plane clipping of convex polygons, so the
//! cost is a few dozen clips per building and there is no general boolean.
//!
//! A wing whose gable end stands against a body at least as high runs into
//! that body's roof up to its ridge (an *extension* solid with the wing's own
//! planes): the union then draws the valleys. Flat and curved roofs (drawn by
//! the renderers from their kind) only occlude.
//!
//! Heights are metres above the building ground; rings are plan coordinates.
use super::super::Point;

pub(in crate::urban) type P3 = [f64; 3];

/// Pieces under this area (m²) are dropped.
const MIN_AREA: f64 = 0.02;
/// Roof above the wall top by less than this is no gable wall.
const MIN_GABLE: f64 = 0.12;

#[derive(Clone, Copy, Debug)]
pub(in crate::urban) struct Plane {
    a: f64,
    b: f64,
    c: f64,
}
impl Plane {
    fn z(&self, p: Point) -> f64 {
        self.a * p.x + self.b * p.y + self.c
    }
    /// Height `h` on the line through `q` with inward unit normal `n`, rising
    /// `slope` metres per metre inwards.
    fn rising(q: Point, n: Point, h: f64, slope: f64) -> Self {
        Plane { a: slope * n.x, b: slope * n.y, c: h - slope * (n.x * q.x + n.y * q.y) }
    }
    fn level(h: f64) -> Self {
        Plane { a: 0.0, b: 0.0, c: h }
    }
}

struct Solid {
    /// Convex footprint of the roof, counter-clockwise.
    ring: Vec<Point>,
    planes: Vec<Plane>,
    owner: usize,
    /// False: occludes only (flat and curved roofs, drawn from their kind).
    emit: bool,
    bbox: [f64; 4],
    /// A second solid of its owner (the gable over a gablet's hips): wall
    /// faces stand on its ring above this height.
    gable_base: Option<f64>,
}

/// One mass of a lot, as the roof pass reads it.
pub(in crate::urban) struct Mass<'a> {
    /// Wall ring (convex for a pitched roof).
    pub ring: &'a [Point],
    /// `gable | hip | shed | pyramid | halfhip | gambrel | mansard | saltbox`
    /// are composed here; any other kind (flat, dome, cone, tent, barrel…) only
    /// occludes.
    pub kind: &'a str,
    /// Ridge axis (unit).
    pub axis: Point,
    /// Wall top and roof rise above it (m).
    pub eave: f64,
    pub rise: f64,
    /// Eaves past the walls (m).
    pub overhang: f64,
    /// Towards the high side of a shed, the low rear side of a saltbox.
    pub high: Point,
}

/// The composed roof of one mass.
#[derive(Default)]
pub(in crate::urban) struct Roofed {
    /// Visible roof pans (already clipped by the other masses).
    pub pans: Vec<Vec<P3>>,
    /// Wall faces above the wall top (gable ends, the high wall of a shed).
    pub gables: Vec<Vec<P3>>,
    /// Lowest roof height along the walls: the wall top to extrude to.
    pub eave: f64,
    /// Highest roof point above `eave`.
    pub rise: f64,
}

pub(in crate::urban) fn composed(kind: &str) -> bool {
    matches!(kind, "gable" | "hip" | "shed" | "pyramid" | "halfhip" | "gablet" | "gambrel" | "mansard" | "saltbox")
}

/// The roof kind a renderer without the composed pans falls back to.
pub(in crate::urban) fn plain(kind: &'static str) -> &'static str {
    match kind {
        "halfhip" | "gambrel" | "saltbox" => "gable",
        "gablet" | "mansard" => "hip",
        k => k,
    }
}

fn dot(a: Point, b: Point) -> f64 {
    a.x * b.x + a.y * b.y
}
fn perp(u: Point) -> Point {
    Point { x: -u.y, y: u.x }
}
fn signed_area(r: &[Point]) -> f64 {
    (0..r.len()).map(|i| { let (p, q) = (r[i], r[(i + 1) % r.len()]); p.x * q.y - q.x * p.y }).sum::<f64>() * 0.5
}
fn ccw(r: &[Point]) -> Vec<Point> {
    if signed_area(r) < 0.0 { r.iter().rev().copied().collect() } else { r.to_vec() }
}
fn centroid(r: &[Point]) -> Point {
    let (mut a, mut x, mut y) = (0.0, 0.0, 0.0);
    for i in 0..r.len() {
        let (p, q) = (r[i], r[(i + 1) % r.len()]);
        let c = p.x * q.y - q.x * p.y;
        a += c;
        x += (p.x + q.x) * c;
        y += (p.y + q.y) * c;
    }
    if a.abs() < 1e-9 {
        let n = r.len().max(1) as f64;
        return Point { x: r.iter().map(|p| p.x).sum::<f64>() / n, y: r.iter().map(|p| p.y).sum::<f64>() / n };
    }
    Point { x: x / (3.0 * a), y: y / (3.0 * a) }
}
fn bbox(r: &[Point]) -> [f64; 4] {
    r.iter().fold([f64::MAX, f64::MAX, f64::MIN, f64::MIN], |b, p| [b[0].min(p.x), b[1].min(p.y), b[2].max(p.x), b[3].max(p.y)])
}
fn convex(r: &[Point]) -> bool {
    let n = r.len();
    n >= 3 && (0..n).all(|i| {
        let (a, b, c) = (r[i], r[(i + 1) % n], r[(i + 2) % n]);
        (b.x - a.x) * (c.y - b.y) - (b.y - a.y) * (c.x - b.x) >= -1e-6
    })
}
fn inside(r: &[Point], p: Point) -> bool {
    let n = r.len();
    (0..n).all(|i| {
        let (a, b) = (r[i], r[(i + 1) % n]);
        (b.x - a.x) * (p.y - a.y) - (b.y - a.y) * (p.x - a.x) >= -1e-6
    })
}
/// Inward unit normal of edge `i` of a counter-clockwise ring (None: no length).
fn inward(r: &[Point], i: usize) -> Option<(Point, Point)> {
    let (p, q) = (r[i], r[(i + 1) % r.len()]);
    let l = (q.x - p.x).hypot(q.y - p.y);
    (l > 1e-6).then(|| (p, Point { x: -(q.y - p.y) / l, y: (q.x - p.x) / l }))
}
/// The part of a convex polygon where `a x + b y <= d`.
fn clip(poly: &[Point], a: f64, b: f64, d: f64) -> Vec<Point> {
    let n = poly.len();
    let mut out = Vec::with_capacity(n + 1);
    for i in 0..n {
        let (p, q) = (poly[i], poly[(i + 1) % n]);
        let (fp, fq) = (a * p.x + b * p.y - d, a * q.x + b * q.y - d);
        if fp <= 0.0 {
            out.push(p);
        }
        if (fp < 0.0 && fq > 0.0) || (fp > 0.0 && fq < 0.0) {
            let t = fp / (fp - fq);
            out.push(Point { x: p.x + (q.x - p.x) * t, y: p.y + (q.y - p.y) * t });
        }
    }
    out
}
fn kept(poly: &[Point]) -> bool {
    poly.len() >= 3 && signed_area(poly).abs() > MIN_AREA
}
/// Pans of a roof skirt between two tiers: from the eave of `ring` pushed out
/// by `overhang`, at height `z0`, up to `next` (the ring of the tier above,
/// same vertices in the same order) at height `z1`.
pub(in crate::urban) fn skirt(ring: &[Point], next: &[Point], z0: f64, z1: f64, overhang: f64) -> Vec<Vec<P3>> {
    if ring.len() < 3 || ring.len() != next.len() {
        return vec![];
    }
    // `outset` reads a counter-clockwise ring: turn both the same way.
    let turn = signed_area(ring) < 0.0;
    let order = |r: &[Point]| -> Vec<Point> { if turn { r.iter().rev().copied().collect() } else { r.to_vec() } };
    let (outer, inner) = (outset(&order(ring), overhang.max(0.0)), order(next));
    let n = outer.len();
    (0..n)
        .map(|i| {
            let j = (i + 1) % n;
            vec![[outer[i].x, outer[i].y, z0], [outer[j].x, outer[j].y, z0], [inner[j].x, inner[j].y, z1], [inner[i].x, inner[i].y, z1]]
        })
        .collect()
}

/// Convex ring pushed outwards by `d` (mitred).
fn outset(r: &[Point], d: f64) -> Vec<Point> {
    if d <= 0.0 {
        return r.to_vec();
    }
    let n = r.len();
    let lines: Vec<Option<(Point, Point)>> = (0..n).map(|i| inward(r, i)).collect();
    (0..n)
        .map(|i| {
            let (Some((p0, n0)), Some((p1, n1))) = (lines[(i + n - 1) % n], lines[i]) else { return r[i] };
            // Intersection of the two edge lines moved outwards by d.
            let (c0, c1) = (dot(n0, p0) - d, dot(n1, p1) - d);
            let det = n0.x * n1.y - n0.y * n1.x;
            if det.abs() < 1e-6 {
                return Point { x: r[i].x - n1.x * d, y: r[i].y - n1.y * d };
            }
            let q = Point { x: (c0 * n1.y - c1 * n0.y) / det, y: (n0.x * c1 - n1.x * c0) / det };
            // A sharp corner keeps a bounded mitre.
            let (dx, dy) = (q.x - r[i].x, q.y - r[i].y);
            let l = dx.hypot(dy);
            if l > 3.0 * d { Point { x: r[i].x + dx / l * 3.0 * d, y: r[i].y + dy / l * 3.0 * d } } else { q }
        })
        .collect()
}

/// Frame of a ring along `u`: extents along (`s`) and across (`t`).
#[derive(Clone, Copy)]
struct Span {
    u: Point,
    n: Point,
    s0: f64,
    s1: f64,
    t0: f64,
    t1: f64,
}
fn span(r: &[Point], u: Point) -> Span {
    let n = perp(u);
    let (mut s0, mut s1, mut t0, mut t1) = (f64::MAX, f64::MIN, f64::MAX, f64::MIN);
    for &p in r {
        let (s, t) = (dot(p, u), dot(p, n));
        s0 = s0.min(s);
        s1 = s1.max(s);
        t0 = t0.min(t);
        t1 = t1.max(t);
    }
    Span { u, n, s0, s1, t0, t1 }
}
impl Span {
    fn at(&self, s: f64, t: f64) -> Point {
        Point { x: self.u.x * s + self.n.x * t, y: self.u.y * s + self.n.y * t }
    }
    fn half(&self) -> f64 {
        (self.t1 - self.t0) * 0.5
    }
}

/// Planes of a pitched roof over wall ring `r` (counter-clockwise).
/// `attached[0]` / `attached[1]`: the end at `s0` / `s1` stands against a higher
/// mass (no hip there). None: the kind is not composed, or the mass is degenerate.
fn planes(m: &Mass, r: &[Point], f: Span, attached: [bool; 2]) -> Option<Vec<Plane>> {
    let half = f.half();
    if half < 0.3 || f.s1 - f.s0 < 0.3 || m.rise < 0.05 {
        return None;
    }
    let (e, rise) = (m.eave, m.rise);
    let k = rise / half;
    let neg = Point { x: -f.n.x, y: -f.n.y };
    let back = Point { x: -f.u.x, y: -f.u.y };
    // The two eave lines and the two end lines of the frame.
    let side = |h0: f64, k0: f64, far: bool| if far { Plane::rising(f.at(0.0, f.t1), neg, h0, k0) } else { Plane::rising(f.at(0.0, f.t0), f.n, h0, k0) };
    let end = |h0: f64, k0: f64, far: bool| if far { Plane::rising(f.at(f.s1, 0.0), back, h0, k0) } else { Plane::rising(f.at(f.s0, 0.0), f.u, h0, k0) };
    // Whether wall edge `i` closes an attached end.
    let closes = |i: usize| {
        let (p, q) = (r[i], r[(i + 1) % r.len()]);
        let l = (q.x - p.x).hypot(q.y - p.y).max(1e-9);
        let along = ((q.x - p.x) * f.u.x + (q.y - p.y) * f.u.y).abs() / l;
        let s = dot(Point { x: (p.x + q.x) * 0.5, y: (p.y + q.y) * 0.5 }, f.u);
        along < 0.5 && ((attached[0] && s - f.s0 < 0.25 * (f.s1 - f.s0)) || (attached[1] && f.s1 - s < 0.25 * (f.s1 - f.s0)))
    };
    let per_edge = |h0: f64, slope: &dyn Fn(usize, Point, Point) -> f64| -> Vec<Plane> {
        (0..r.len())
            .filter(|&i| !closes(i))
            .filter_map(|i| inward(r, i).map(|(p, n)| Plane::rising(p, n, h0, slope(i, p, n))))
            .collect()
    };
    Some(match m.kind {
        "gable" => vec![side(e, k, false), side(e, k, true)],
        "shed" => {
            let k = rise / (2.0 * half);
            vec![side(e, k, dot(m.high, f.n) < 0.0)]
        }
        // A gablet is a hip with a gable over its middle (a second solid, see `compose`).
        "hip" | "gablet" => per_edge(e, &|_, _, _| k),
        "pyramid" => {
            let c = centroid(r);
            per_edge(e, &|_, p, n| rise / dot(Point { x: c.x - p.x, y: c.y - p.y }, n).max(0.2))
        }
        "halfhip" => {
            let mut v = vec![side(e, k, false), side(e, k, true)];
            for (far, a) in [(false, attached[0]), (true, attached[1])] {
                if !a {
                    v.push(end(e + 0.55 * rise, k, far));
                }
            }
            v
        }
        "gambrel" => {
            // Steep lower slope, shallow upper slope (a concave profile).
            let db = 0.32 * half;
            let (k1, k2) = (0.62 * rise / db, 0.38 * rise / (half - db));
            let mut v = vec![];
            for far in [false, true] {
                v.push(side(e, k1, far));
                v.push(side(e + 0.62 * rise - k2 * db, k2, far));
            }
            v
        }
        "mansard" => {
            let db = (0.24 * half).min(1.8);
            let (k1, k2) = (0.72 * rise / db, 0.28 * rise / (half - db));
            let mut v = per_edge(e, &|_, _, _| k1);
            v.extend(per_edge(e + 0.72 * rise - k2 * db, &|_, _, _| k2));
            v
        }
        "saltbox" => {
            // Ridge off-centre: a short front slope, a long rear one down to a lower wall.
            let rear_far = dot(m.high, f.n) >= 0.0;
            let drop = (0.4 * rise).min(0.35 * e);
            let (front, rear) = (0.7 * half, 1.3 * half);
            vec![side(e, rise / front, !rear_far), side(e - drop, (rise + drop) / rear, rear_far)]
        }
        _ => return None,
    })
}

/// Pans of one solid before occlusion: (plane, polygon where it is the lowest).
fn faces(s: &Solid) -> Vec<(usize, Vec<Point>)> {
    let mut out = vec![];
    for (i, pi) in s.planes.iter().enumerate() {
        let mut poly = s.ring.clone();
        for (j, pj) in s.planes.iter().enumerate() {
            if i == j {
                continue;
            }
            // Keep pi <= pj.
            let (a, b, d) = (pi.a - pj.a, pi.b - pj.b, pj.c - pi.c);
            if a.abs() < 1e-9 && b.abs() < 1e-9 {
                if d < 0.0 || (d == 0.0 && j < i) {
                    poly.clear();
                    break;
                }
                continue;
            }
            poly = clip(&poly, a, b, d);
            if poly.len() < 3 {
                break;
            }
        }
        if kept(&poly) {
            out.push((i, poly));
        }
    }
    out
}

/// The parts of `piece` (on plane `pi`) that solid `b` does not stand above.
/// `tie` breaks coincident surfaces (the lower index stays).
fn visible(piece: Vec<Point>, pi: &Plane, b: &Solid, tie: f64) -> Vec<Vec<Point>> {
    // Hidden: inside b's ring and under every plane of b.
    let mut hs: Vec<(f64, f64, f64)> = Vec::with_capacity(b.ring.len() + b.planes.len());
    for i in 0..b.ring.len() {
        if let Some((p, n)) = inward(&b.ring, i) {
            hs.push((-n.x, -n.y, -dot(n, p)));
        }
    }
    for pj in &b.planes {
        let (a, bb, d) = (pi.a - pj.a, pi.b - pj.b, pj.c - pi.c + tie);
        if a.abs() < 1e-9 && bb.abs() < 1e-9 {
            if d <= 0.0 {
                return vec![piece];
            }
            continue;
        }
        hs.push((a, bb, d));
    }
    let mut hidden = piece.clone();
    for &(a, bb, d) in &hs {
        hidden = clip(&hidden, a, bb, d);
        if !kept(&hidden) {
            return vec![piece];
        }
    }
    let mut rest = piece;
    let mut out = vec![];
    for (a, bb, d) in hs {
        let outside = clip(&rest, -a, -bb, -d);
        if kept(&outside) {
            out.push(outside);
        }
        rest = clip(&rest, a, bb, d);
        if !kept(&rest) {
            break;
        }
    }
    out
}

/// Roof height of a solid at `p` (inside its ring).
fn height(s: &Solid, p: Point) -> f64 {
    s.planes.iter().map(|pl| pl.z(p)).fold(f64::MAX, f64::min)
}

/// Wall faces above `base` along the wall ring `r` under solid `s`.
fn gables(s: &Solid, r: &[Point], base: f64, skip: &dyn Fn(usize) -> bool) -> Vec<Vec<P3>> {
    let mut out = vec![];
    for i in 0..r.len() {
        if skip(i) {
            continue;
        }
        let (p, q) = (r[i], r[(i + 1) % r.len()]);
        let at = |t: f64| Point { x: p.x + (q.x - p.x) * t, y: p.y + (q.y - p.y) * t };
        // Breaks of the envelope along the edge.
        let mut ts = vec![0.0, 1.0];
        for a in 0..s.planes.len() {
            for b in a + 1..s.planes.len() {
                let (za0, za1) = (s.planes[a].z(p), s.planes[a].z(q));
                let (zb0, zb1) = (s.planes[b].z(p), s.planes[b].z(q));
                let den = (za1 - za0) - (zb1 - zb0);
                if den.abs() > 1e-9 {
                    let t = (zb0 - za0) / den;
                    if t > 1e-4 && t < 1.0 - 1e-4 {
                        ts.push(t);
                    }
                }
            }
        }
        ts.sort_by(|a, b| a.total_cmp(b));
        ts.dedup_by(|a, b| (*a - *b).abs() < 1e-4);
        let top: Vec<(Point, f64)> = ts.iter().map(|&t| { let x = at(t); (x, height(s, x).max(base)) }).collect();
        if top.iter().map(|v| v.1).fold(f64::MIN, f64::max) - base < MIN_GABLE {
            continue;
        }
        let mut face: Vec<P3> = vec![[p.x, p.y, base], [q.x, q.y, base]];
        for &(x, z) in top.iter().rev() {
            if z - base > 1e-3 {
                face.push([x.x, x.y, z]);
            }
        }
        if face.len() >= 3 {
            out.push(face);
        }
    }
    out
}

/// Composed roofs of a lot's masses (None for a mass that only occludes: its
/// roof stays the renderer's, from its kind).
pub(in crate::urban) fn compose(masses: &[Mass]) -> Vec<Option<Roofed>> {
    let rings: Vec<Vec<Point>> = masses.iter().map(|m| ccw(m.ring)).collect();
    let spans: Vec<Span> = masses.iter().zip(&rings).map(|(m, r)| span(r, m.axis)).collect();
    let pitched: Vec<bool> = masses.iter().zip(&rings).map(|(m, r)| composed(m.kind) && convex(r) && m.rise >= 0.05).collect();
    let top = |i: usize| masses[i].eave + if pitched[i] { masses[i].rise } else { 0.0 };
    let areas: Vec<f64> = rings.iter().map(|r| signed_area(r).abs()).collect();
    // The mass an end of `i` stands against (its wall at least as high as
    // i's): the largest one there, never a chimney or a dormer.
    let against = |i: usize, far: bool| -> Option<usize> {
        let f = spans[i];
        let mid = f.at(if far { f.s1 + 0.5 } else { f.s0 - 0.5 }, (f.t0 + f.t1) * 0.5);
        (0..masses.len())
            .filter(|&j| j != i && areas[j] >= 6.0 && masses[j].eave >= masses[i].eave - 0.3 && inside(&rings[j], mid))
            .max_by(|&a, &b| areas[a].total_cmp(&areas[b]))
    };
    let mut solids: Vec<Solid> = vec![];
    let mut own: Vec<Option<usize>> = vec![None; masses.len()];
    let mut ends: Vec<[bool; 2]> = vec![[false; 2]; masses.len()];
    for i in 0..masses.len() {
        let m = &masses[i];
        if !pitched[i] {
            // A flat or curved roof stands in the way up to (about) its top.
            let h = m.eave + if m.kind == "flat" { 0.0 } else { 0.5 * m.rise.max(0.0) };
            solids.push(Solid { bbox: bbox(&rings[i]), ring: rings[i].clone(), planes: vec![Plane::level(h)], owner: i, emit: false, gable_base: None });
            continue;
        }
        let f = spans[i];
        let ended = !matches!(m.kind, "shed" | "pyramid");
        let near = [ended.then(|| against(i, false)).flatten(), ended.then(|| against(i, true)).flatten()];
        let attached = [near[0].is_some(), near[1].is_some()];
        let Some(pl) = planes(m, &rings[i], f, attached) else {
            solids.push(Solid { bbox: bbox(&rings[i]), ring: rings[i].clone(), planes: vec![Plane::level(m.eave)], owner: i, emit: false, gable_base: None });
            continue;
        };
        ends[i] = attached;
        // Eaves past the walls, never past an attached end.
        let over = outset(&rings[i], m.overhang.max(0.0));
        let mut ring = over;
        for (far, a) in [(false, attached[0]), (true, attached[1])] {
            if a {
                ring = if far { clip(&ring, f.u.x, f.u.y, f.s1) } else { clip(&ring, -f.u.x, -f.u.y, -f.s0) };
            }
        }
        if !kept(&ring) {
            continue;
        }
        own[i] = Some(solids.len());
        solids.push(Solid { bbox: bbox(&ring), ring, planes: pl.clone(), owner: i, emit: true, gable_base: None });
        if m.kind == "gablet" {
            // The gable over the middle of the hip: each hipped end stops under a small gable wall.
            let g = (0.45 * f.half()).min(0.3 * (f.s1 - f.s0));
            let (a, b) = (f.s0 + if attached[0] { 0.0 } else { g }, f.s1 - if attached[1] { 0.0 } else { g });
            if b - a > 0.5 {
                let k = m.rise / f.half();
                let neg = Point { x: -f.n.x, y: -f.n.y };
                let top = vec![f.at(a, f.t0), f.at(b, f.t0), f.at(b, f.t1), f.at(a, f.t1)];
                let sides = vec![Plane::rising(f.at(0.0, f.t0), f.n, m.eave, k), Plane::rising(f.at(0.0, f.t1), neg, m.eave, k)];
                solids.push(Solid { bbox: bbox(&top), ring: ccw(&top), planes: sides, owner: i, emit: true, gable_base: Some(m.eave + k * g) });
            }
        }
        // A gabled end against a pitched body at least as high runs into it up to its ridge.
        for (far, j) in [(false, near[0]), (true, near[1])] {
            let Some(j) = j else { continue };
            if !pitched[j] || top(i) > top(j) + 0.05 || dot(masses[i].axis, masses[j].axis).abs() > 0.5 {
                continue;
            }
            let (lo, hi) = rings[j].iter().map(|&p| dot(p, f.u)).fold((f64::MAX, f64::MIN), |(a, b), s| (a.min(s), b.max(s)));
            let reach = (hi - lo) * 0.5 + 0.05;
            let (a, b) = if far { (f.s1, f.s1 + reach) } else { (f.s0 - reach, f.s0) };
            let mut ext = vec![f.at(a, f.t0), f.at(b, f.t0), f.at(b, f.t1), f.at(a, f.t1)];
            for e in 0..rings[j].len() {
                if let Some((p, n)) = inward(&rings[j], e) {
                    ext = clip(&ext, -n.x, -n.y, -dot(n, p));
                }
            }
            if kept(&ext) {
                // Only the wing's own slopes run on: an end plane has no meaning there.
                let sides: Vec<Plane> = pl.iter().copied().filter(|p| (p.a * f.u.x + p.b * f.u.y).abs() < 1e-6).collect();
                if !sides.is_empty() {
                    solids.push(Solid { bbox: bbox(&ext), ring: ccw(&ext), planes: sides, owner: i, emit: true, gable_base: None });
                }
            }
        }
    }
    let mut out: Vec<Option<Roofed>> = masses.iter().enumerate().map(|(i, _)| own[i].map(|_| Roofed::default())).collect();
    for (ia, a) in solids.iter().enumerate() {
        if !a.emit || out[a.owner].is_none() {
            continue;
        }
        for (pi, poly) in faces(a) {
            let plane = a.planes[pi];
            let mut pieces = vec![poly];
            for (ib, b) in solids.iter().enumerate() {
                // A mass's own solids (its extension, a gablet's gable) meet on coincident planes: the tie keeps one.
                if ib == ia || b.bbox[0] > a.bbox[2] || b.bbox[2] < a.bbox[0] || b.bbox[1] > a.bbox[3] || b.bbox[3] < a.bbox[1] {
                    continue;
                }
                let tie = if ib < ia { 1e-6 } else { -1e-6 };
                pieces = pieces.into_iter().flat_map(|p| visible(p, &plane, b, tie)).collect();
                if pieces.is_empty() {
                    break;
                }
            }
            if let Some(r) = out[a.owner].as_mut() {
                r.pans.extend(pieces.into_iter().map(|p| p.into_iter().map(|q| [q.x, q.y, plane.z(q)]).collect::<Vec<P3>>()));
            }
        }
    }
    for i in 0..masses.len() {
        let (Some(si), Some(r)) = (own[i], out[i].as_mut()) else { continue };
        let s = &solids[si];
        let f = spans[i];
        r.eave = rings[i].iter().map(|&p| height(s, p)).fold(f64::MAX, f64::min).min(masses[i].eave);
        let attached = ends[i];
        let ring = &rings[i];
        // No wall face on an attached end: it stands inside the other mass.
        r.gables = gables(s, ring, r.eave, &|e| {
            let (p, q) = (ring[e], ring[(e + 1) % ring.len()]);
            let sm = dot(Point { x: (p.x + q.x) * 0.5, y: (p.y + q.y) * 0.5 }, f.u);
            (attached[0] && sm - f.s0 < 0.05) || (attached[1] && f.s1 - sm < 0.05)
        });
        for extra in solids.iter().filter(|x| x.owner == i) {
            if let Some(base) = extra.gable_base {
                r.gables.extend(gables(extra, &extra.ring, base, &|_| false));
            }
        }
        let high = r.pans.iter().flatten().map(|p| p[2]).fold(r.eave, f64::max);
        r.rise = high - r.eave;
    }
    out
}

/// Roof height above the ground at `p` of the roof `compose` would give `m`
/// alone (chimneys and dormers are set on it). None: not a composed kind.
pub(in crate::urban) fn height_at(m: &Mass, p: Point) -> Option<f64> {
    let r = ccw(m.ring);
    if !composed(m.kind) || !convex(&r) {
        return None;
    }
    let pl = planes(m, &r, span(&r, m.axis), [false; 2])?;
    Some(pl.iter().map(|q| q.z(p)).fold(f64::MAX, f64::min))
}

#[cfg(test)]
mod tests {
    use super::*;

    fn rect(x0: f64, y0: f64, x1: f64, y1: f64) -> Vec<Point> {
        vec![Point { x: x0, y: y0 }, Point { x: x1, y: y0 }, Point { x: x1, y: y1 }, Point { x: x0, y: y1 }]
    }
    fn area3(p: &[P3]) -> f64 {
        (0..p.len()).map(|i| { let (a, b) = (p[i], p[(i + 1) % p.len()]); a[0] * b[1] - b[0] * a[1] }).sum::<f64>().abs() * 0.5
    }
    const X: Point = Point { x: 1.0, y: 0.0 };
    const Y: Point = Point { x: 0.0, y: 1.0 };

    #[test]
    fn a_gable_has_two_pans_covering_its_footprint_and_two_gable_walls() {
        let ring = rect(0.0, 0.0, 10.0, 6.0);
        let r = compose(&[Mass { ring: &ring, kind: "gable", axis: X, eave: 5.0, rise: 3.0, overhang: 0.0, high: Y }]);
        let r = r[0].as_ref().unwrap();
        assert_eq!(r.pans.len(), 2);
        assert!((r.pans.iter().map(|p| area3(p)).sum::<f64>() - 60.0).abs() < 1e-6);
        assert_eq!(r.gables.len(), 2);
        assert!((r.eave - 5.0).abs() < 1e-9 && (r.rise - 3.0).abs() < 1e-9);
    }

    #[test]
    fn a_hip_has_four_pans_and_no_gable_wall() {
        let ring = rect(0.0, 0.0, 10.0, 6.0);
        let r = compose(&[Mass { ring: &ring, kind: "hip", axis: X, eave: 5.0, rise: 3.0, overhang: 0.0, high: Y }]);
        let r = r[0].as_ref().unwrap();
        assert_eq!(r.pans.len(), 4);
        assert!(r.gables.is_empty());
        assert!((r.pans.iter().map(|p| area3(p)).sum::<f64>() - 60.0).abs() < 1e-6);
    }

    #[test]
    fn a_wing_runs_into_its_body_with_valleys_and_the_plan_stays_covered_once() {
        // Body along x, a lower wing behind it along y: an L.
        let body = rect(0.0, 0.0, 12.0, 6.0);
        let wing = rect(1.0, 6.0, 6.0, 11.0);
        let r = compose(&[
            Mass { ring: &body, kind: "gable", axis: X, eave: 5.0, rise: 3.0, overhang: 0.0, high: Y },
            Mass { ring: &wing, kind: "gable", axis: Y, eave: 5.0, rise: 2.5, overhang: 0.0, high: X },
        ]);
        let (b, w) = (r[0].as_ref().unwrap(), r[1].as_ref().unwrap());
        // The wing's pans reach inside the body (valleys), and the plan is covered exactly once.
        assert!(w.pans.iter().flatten().any(|p| p[1] < 5.9));
        let total: f64 = b.pans.iter().chain(&w.pans).map(|p| area3(p)).sum();
        assert!((total - (72.0 + 25.0)).abs() < 0.05, "covered {total}");
        // The wing keeps its free gable only.
        assert_eq!(w.gables.len(), 1);
    }

    #[test]
    fn a_tower_hides_the_roof_under_it() {
        let body = rect(0.0, 0.0, 12.0, 6.0);
        let tower = rect(4.0, 1.0, 8.0, 5.0);
        let r = compose(&[
            Mass { ring: &body, kind: "gable", axis: X, eave: 5.0, rise: 3.0, overhang: 0.0, high: Y },
            Mass { ring: &tower, kind: "flat", axis: X, eave: 14.0, rise: 0.0, overhang: 0.0, high: Y },
        ]);
        assert!(r[1].is_none());
        let total: f64 = r[0].as_ref().unwrap().pans.iter().map(|p| area3(p)).sum();
        assert!((total - (72.0 - 16.0)).abs() < 0.05, "covered {total}");
    }

    #[test]
    fn eaves_overhang_the_walls_below_the_wall_top() {
        let ring = rect(0.0, 0.0, 10.0, 6.0);
        let r = compose(&[Mass { ring: &ring, kind: "gable", axis: X, eave: 5.0, rise: 3.0, overhang: 0.4, high: Y }]);
        let r = r[0].as_ref().unwrap();
        let low = r.pans.iter().flatten().map(|p| p[2]).fold(f64::MAX, f64::min);
        assert!(low < 5.0 - 0.3 && (r.eave - 5.0).abs() < 1e-9);
    }
}
