pub trait FieldRandom {
    fn float(&mut self) -> f64;
    fn range(&mut self, a: f64, b: f64) -> f64 {
        a + (b - a) * self.float()
    }
    fn chance(&mut self, p: f64) -> bool {
        self.float() < p
    }
}
impl FieldRandom for Rng {
    fn float(&mut self) -> f64 {
        Rng::float(self)
    }
}
impl<F: FnMut() -> f64> FieldRandom for F {
    fn float(&mut self) -> f64 {
        self()
    }
}
use super::{
    Rng,
    boolean::{self as bo, Op},
    geom::*,
};
use std::f64::consts::PI;
#[derive(Clone)]
pub struct Furlong {
    pub region: Region,
    pub angle: f64,
    pub enclosed: bool,
    pub strips: Vec<Polygon>,
    pub strip_w: f64,
    pub parcel: bool,
}
#[derive(Default)]
pub struct Net {
    pub furlongs: Vec<Furlong>,
    pub ways: Vec<Polygon>,
    pub headlands: Vec<Polygon>,
    pub margins: Vec<Region>,
}
pub struct Context<'a> {
    pub dir: &'a dyn Fn(f64, f64) -> f64,
    pub slope: &'a dyn Fn(f64, f64) -> f64,
    pub closed: bool,
    pub noise: &'a dyn Fn(f64, f64) -> f64,
    pub regular: bool,
    pub access: bool,
    pub min_area: Option<f64>,
    pub strips_at: Option<&'a dyn Fn(Point) -> bool>,
}
pub fn extents(a: &[Point], ca: f64, sa: f64) -> (f64, f64, f64, f64) {
    let mut b = Box2 {
        x0: f64::INFINITY,
        y0: f64::INFINITY,
        x1: f64::NEG_INFINITY,
        y1: f64::NEG_INFINITY,
    };
    for p in a {
        let (u, v) = (p.x * ca + p.y * sa, -p.x * sa + p.y * ca);
        b.x0 = b.x0.min(u);
        b.x1 = b.x1.max(u);
        b.y0 = b.y0.min(v);
        b.y1 = b.y1.max(v);
    }
    (b.x0, b.x1, b.y0, b.y1)
}
fn trace(
    p0: Point,
    ang: &dyn Fn(f64, f64) -> f64,
    b: Box2,
    max_len: f64,
    wob: &dyn Fn(f64, f64) -> f64,
) -> Polygon {
    let run = |sign: f64| {
        let mut out: Polygon = vec![];
        let mut p = p0;
        let (mut dx, mut dy, mut prev, mut turned) = (0.0, 0.0, 0.0, 0.0);
        for k in 0..(max_len / 10.0).ceil() as usize {
            let a = ang(p.x, p.y);
            let (mut ux, mut uy) = (a.cos(), a.sin());
            if k == 0 {
                ux *= sign;
                uy *= sign;
            } else if ux * dx + uy * dy < 0.0 {
                ux = -ux;
                uy = -uy;
            }
            dx = ux;
            dy = uy;
            let hd = dy.atan2(dx);
            if k > 0 {
                let mut dh = (hd - prev).abs();
                if dh > PI {
                    dh = 2.0 * PI - dh;
                }
                turned += dh;
                if turned > 1.6 {
                    break;
                }
            }
            prev = hd;
            let w = wob(p.x, p.y);
            p = super::geom::p(p.x + dx * 10.0 - dy * w, p.y + dy * 10.0 + dx * w);
            out.push(p);
            if !b.contains(p) {
                break;
            }
            if k > 8 && out[..k - 8].iter().any(|&q| dist(q, p).powi(2) < 64.0) {
                break;
            }
        }
        out
    };
    let mut back = run(-1.0);
    back.reverse();
    back.push(p0);
    back.extend(run(1.0));
    back
}
fn chord(r: &Region, o: Point, d: Point) -> Option<Point> {
    let mut ts = vec![];
    for ring in std::iter::once(&r.outer).chain(&r.holes) {
        for i in 0..ring.len() {
            let (c, e) = (ring[i], ring[(i + 1) % ring.len()]);
            let (ex, ey) = (e.x - c.x, e.y - c.y);
            let den = d.x * ey - d.y * ex;
            if den.abs() < 1e-12 {
                continue;
            }
            let t = ((c.x - o.x) * ey - (c.y - o.y) * ex) / den;
            let u = ((c.x - o.x) * d.y - (c.y - o.y) * d.x) / den;
            if (0.0..1.0).contains(&u) {
                ts.push(t);
            }
        }
    }
    ts.sort_by(f64::total_cmp);
    let mut best = 0.0;
    let mut bt = 0.0;
    for s in ts.chunks_exact(2) {
        if s[1] - s[0] > best {
            best = s[1] - s[0];
            bt = (s[0] + s[1]) / 2.0;
        }
    }
    (best > 0.0).then_some(p(o.x + d.x * bt, o.y + d.y * bt))
}
pub fn clip_line(a: &[Point], r: &Region) -> Vec<Polygon> {
    let mut out = vec![];
    let mut cur: Polygon = vec![];
    let flush = |cur: &mut Polygon, out: &mut Vec<Polygon>| {
        if cur.len() >= 2 {
            out.push(std::mem::take(cur));
        } else {
            cur.clear();
        }
    };
    for ab in a.windows(2) {
        let (a, b) = (ab[0], ab[1]);
        let (dx, dy) = (b.x - a.x, b.y - a.y);
        if dx.hypot(dy) < 1e-9 {
            continue;
        }
        let mut cuts = vec![0.0, 1.0];
        for ring in std::iter::once(&r.outer).chain(&r.holes) {
            for i in 0..ring.len() {
                let (c, d) = (ring[i], ring[(i + 1) % ring.len()]);
                let (sx, sy) = (d.x - c.x, d.y - c.y);
                let den = dx * sy - dy * sx;
                if den.abs() < 1e-12 {
                    continue;
                }
                let t = ((c.x - a.x) * sy - (c.y - a.y) * sx) / den;
                let u = ((c.x - a.x) * dy - (c.y - a.y) * dx) / den;
                if t > 0.0 && t < 1.0 && u >= 0.0 && u <= 1.0 {
                    cuts.push(t);
                }
            }
        }
        cuts.sort_by(f64::total_cmp);
        for cut in cuts.windows(2) {
            let (lo, hi) = (cut[0], cut[1]);
            if hi - lo < 1e-9 {
                continue;
            }
            if !inside(r, lerp(a, b, (lo + hi) / 2.0)) {
                flush(&mut cur, &mut out);
                continue;
            }
            let (start, end) = (lerp(a, b, lo), lerp(a, b, hi));
            if cur.last().is_some_and(|&p| dist(p, start) > 1e-7) {
                flush(&mut cur, &mut out);
            }
            if cur.is_empty() {
                cur.push(start);
            }
            cur.push(end);
        }
    }
    flush(&mut cur, &mut out);
    out
}
fn on_ring(p: Point, r: &Region) -> bool {
    std::iter::once(&r.outer)
        .chain(&r.holes)
        .any(|ring| line_dist(p, &closed(ring)) <= 0.01)
}
fn extend(a: &[Point], d: f64) -> Polygon {
    let mut o = a.to_vec();
    let n = a.len();
    let push = |a: Point, b: Point| {
        let l = dist(a, b);
        let l = if l == 0.0 { 1.0 } else { l };
        p(a.x + (a.x - b.x) / l * d, a.y + (a.y - b.y) / l * d)
    };
    o[0] = push(a[0], a[1]);
    o[n - 1] = push(a[n - 1], a[n - 2]);
    o
}
struct Cutter<'a, 'b> {
    ctx: &'a Context<'b>,
    root_angle: f64,
    natural: bool,
}
fn angle_delta(a: f64) -> f64 {
    (2.0 * a).sin().atan2((2.0 * a).cos()) / 2.0
}
impl Cutter<'_, '_> {
    fn direction(&self, p: Point) -> f64 {
        if self.ctx.regular {
            if self.natural {
                let slope = (self.ctx.slope)(p.x, p.y);
                let follow = ((slope - 0.02) / 0.04).clamp(0.0, 1.0);
                self.root_angle
                    + follow * angle_delta((self.ctx.dir)(p.x, p.y) - self.root_angle)
                    + (1.0 - follow) * 0.07 * (self.ctx.noise)(p.x / 160.0, p.y / 160.0)
            } else {
                self.root_angle
            }
        } else {
            (self.ctx.dir)(p.x, p.y)
        }
    }
    fn once(
        &self,
        r: &Region,
        rot: f64,
        across: bool,
        f: f64,
        gap: f64,
        wob_amp: f64,
        bucket: &mut Vec<Polygon>,
        jitter: bool,
        straight: bool,
    ) -> Option<Vec<Region>> {
        let cen = centroid(&r.outer);
        let phi = self.direction(cen) + rot;
        let (ca, sa) = (phi.cos(), phi.sin());
        let (u0, u1, v0, v1) = extents(&r.outer, ca, sa);
        let (u, v, dx, dy) = if across {
            (u0 + (u1 - u0) * f, (v0 + v1) / 2.0, -sa, ca)
        } else {
            ((u0 + u1) / 2.0, v0 + (v1 - v0) * f, ca, sa)
        };
        let mid = chord(r, p(u * ca - v * sa, u * sa + v * ca), p(dx, dy))?;
        if self.ctx.regular {
            let span = 4.0 * (u1 - u0).hypot(v1 - v0) + 32.0;
            let q = |u: f64, v: f64| p(mid.x + u * dx - v * dy, mid.y + u * dy + v * dx);
            // Parcel boundaries share one separator: no gaps or overlaps where a
            // curved contour crosses an irregular road/stream outline. Coarse
            // access-track cuts and small horticultural plots stay unchanged.
            let line = if self.natural && !straight {
                let reach = (u1 - u0).hypot(v1 - v0) + 32.0;
                let steps = (reach / 32.0).ceil().max(2.0) as usize;
                let step = reach / steps as f64;
                let heading = dy.atan2(dx);
                let skew = 0.045 * (self.ctx.noise)(mid.x / 95.0 + 7.0, mid.y / 95.0);
                let run = |sign: f64| {
                    let mut out = vec![];
                    let mut offset = 0.0;
                    for k in 1..=steps {
                        let sample = q(sign * (k as f64 - 0.5) * step, offset);
                        let a = self.direction(sample) + rot + if across { PI / 2.0 } else { 0.0 };
                        offset +=
                            sign * step * (angle_delta(a - heading).tan().clamp(-0.5, 0.5) + skew);
                        out.push(q(sign * k as f64 * step, offset));
                    }
                    out
                };
                let mut line = run(-1.0);
                line.reverse();
                line.push(mid);
                line.extend(run(1.0));
                simplify(&line, 0.3)
            } else {
                vec![q(-span, 0.0), q(span, 0.0)]
            };
            let mut pcs = vec![];
            for sign in [-1.0, 1.0] {
                let mut side = line.clone();
                side.push(q(span, sign * span));
                side.push(q(-span, sign * span));
                let clip = piece(side);
                pcs.extend(bo::exact(&[r.clone()], &[clip], Op::Intersection).ok()?);
            }
            if pcs.len() < 2 {
                return None;
            }
            let minimum = self.ctx.min_area.unwrap_or(1000.0);
            let min_width = if minimum < 500.0 { 7.0 } else { 18.0 };
            if pcs.iter().any(|r| {
                let a = region_area(r);
                let (u0, u1, v0, v1) = extents(&r.outer, ca, sa);
                a < minimum || a / (u1 - u0).max(v1 - v0).max(1.0) < min_width
            }) {
                return None;
            }
            bucket.extend(clip_line(&line, r));
            return Some(pcs);
        }
        let box_ = bbox(&r.outer).grow(30.0);
        let ang = |x: f64, y: f64| {
            if straight {
                phi + if across { PI / 2.0 } else { 0.0 }
            } else {
                (self.ctx.dir)(x, y) + rot + if across { PI / 2.0 } else { 0.0 }
            }
        };
        let wob =
            |x: f64, y: f64| (self.ctx.noise)(x / 55.0 + 11.0, y / 55.0 - 3.0) * wob_amp * 0.08;
        let mut line = trace(
            mid,
            &ang,
            box_,
            1.15 * (box_.x1 - box_.x0).hypot(box_.y1 - box_.y0),
            &wob,
        );
        if jitter {
            for (i, p) in line.iter_mut().enumerate() {
                if i % 3 == 0 {
                    let q = *p;
                    p.x += (self.ctx.noise)(q.x / 28.0, q.y / 28.0) * 3.0;
                    p.y += (self.ctx.noise)(q.x / 28.0 + 9.0, q.y / 28.0) * 3.0;
                }
            }
        }
        let line = simplify(&line, 0.9);
        let crossing: Vec<_> = clip_line(&line, r)
            .into_iter()
            .filter(|a| on_ring(a[0], r) && on_ring(*a.last().unwrap(), r))
            .collect();
        if crossing.is_empty() {
            return None;
        }
        let cuts: Vec<_> = crossing
            .iter()
            .map(|a| piece(ribbon(&extend(a, gap + 1.0), gap)))
            .collect();
        let real: Vec<_> = bo::exact(&[r.clone()], &cuts, Op::Difference)
            .ok()?
            .into_iter()
            .filter(|r| area(&r.outer).abs() > 300.0)
            .collect();
        if real.len() < 2 {
            return None;
        }
        bucket.extend(crossing);
        Some(real)
    }
    fn cut(
        &self,
        r: &Region,
        rot: f64,
        across: bool,
        f: f64,
        gap: f64,
        wob: f64,
        bucket: &mut Vec<Polygon>,
        jitter: bool,
    ) -> Option<Vec<Region>> {
        for straight in [false, true] {
            for df in [0.0, 0.13, -0.13] {
                if let Some(p) = self.once(
                    r,
                    rot,
                    across,
                    (f + df).clamp(0.25, 0.75),
                    gap * if df != 0.0 { 1.07 } else { 1.0 },
                    wob,
                    bucket,
                    jitter,
                    straight,
                ) {
                    return Some(p);
                }
            }
        }
        None
    }
    fn dims(&self, r: &Region, rot: f64) -> (Point, f64, f64, f64) {
        let c = centroid(&r.outer);
        let a = self.direction(c) + rot;
        let (u0, u1, v0, v1) = extents(&r.outer, a.cos(), a.sin());
        let l = u1 - u0;
        let wb = v1 - v0;
        let area = region_area(r);
        (c, l, wb.min(area / l.max(1.0)), area / (l * wb).max(1.0))
    }
}
pub fn partition(region: &Region, ctx: &Context, rng: &mut impl FieldRandom, net: &mut Net) {
    let regular = ctx.regular;
    let closed = ctx.closed;
    let c = centroid(&region.outer);
    let cutter = Cutter {
        ctx,
        root_angle: (ctx.dir)(c.x, c.y),
        natural: false,
    };
    let agricultural = ctx.min_area.unwrap_or(1000.0) >= 500.0;
    let mut blocks: Vec<(Region, f64)> = vec![];
    let mut leaves: Vec<(Region, f64, bool)> = vec![];
    if closed && !regular {
        blocks.push((region.clone(), 0.0));
    } else {
        let mut stack = vec![(region.clone(), 0_usize)];
        let mut guard = 0;
        while !stack.is_empty() && guard < 2000 {
            guard += 1;
            let (r, depth) = stack.pop().unwrap();
            let a = region_area(&r);
            let (_, l, w, _) = cutter.dims(&r, 0.0);
            let ab = if regular {
                rng.range(55.0, 90.0)
            } else {
                rng.range(14.0, 28.0)
            } * 1e4;
            let pcs = if a > ab && depth < 10 {
                cutter.cut(
                    &r,
                    0.0,
                    l >= w * 1.15,
                    rng.range(0.4, 0.6),
                    4.4,
                    3.5,
                    &mut net.ways,
                    false,
                )
            } else {
                None
            };
            if let Some(pcs) = pcs {
                for pg in pcs {
                    stack.push((pg, depth + 1));
                }
            } else {
                blocks.push((r, 0.0));
            }
        }
        blocks.extend(stack.into_iter().map(|(r, _)| (r, 0.0)));
        let multiple = blocks.len() > 1;
        for (r, rot) in &mut blocks {
            let c = centroid(&r.outer);
            let sl = (ctx.slope)(c.x, c.y);
            let flat = 1.0 - ((sl - 0.03) / 0.05).clamp(0.0, 1.0);
            if multiple {
                let r = rng.float();
                if r < 0.4 {
                    *rot = PI / 2.0;
                } else if !regular && r < 0.52 {
                    *rot = rng.range(0.25, 0.5) * if rng.chance(0.5) { 1.0 } else { -1.0 } * flat;
                }
            }
            if regular && agricultural && sl >= 0.025 {
                // The local direction follows contours below; do not rotate
                // those elongated parcels back across the slope.
                *rot = 0.0;
            } else if regular && sl >= 0.08 {
                let rel = (ctx.dir)(c.x, c.y) - cutter.root_angle;
                *rot = (2.0 * rel).sin().atan2((2.0 * rel).cos()) / 2.0;
            }
        }
    }
    let cutter = Cutter {
        natural: regular && agricultural,
        ..cutter
    };
    for (r, rot) in blocks {
        let mut stack = vec![(r, rot, 0_usize)];
        let mut guard = 0;
        while !stack.is_empty() && guard < 3000 {
            guard += 1;
            let (r, rot, depth) = stack.pop().unwrap();
            let a = region_area(&r);
            let (c, l, w, fill) = cutter.dims(&r, rot);
            let slope = (ctx.slope)(c.x, c.y);
            let lm = if cutter.natural {
                rng.range(130.0, 290.0) * (1.0 + 0.8 * (slope / 0.12).clamp(0.0, 1.0))
            } else if regular {
                rng.range(150.0, 240.0)
            } else if closed {
                rng.range(110.0, 190.0)
            } else {
                rng.range(305.0, 345.0)
            };
            let wm = if cutter.natural {
                rng.range(90.0, 210.0) / (1.0 + (slope / 0.1).clamp(0.0, 1.0))
            } else if closed {
                rng.range(100.0, 170.0)
            } else {
                rng.range(130.0, 250.0)
            };
            let bent = !closed && fill < 0.6 && l > 270.0;
            let long = regular
                && l > 75.0
                && l > w * if (ctx.slope)(c.x, c.y) >= 0.12 {
                    5.5
                } else {
                    3.2
                };
            let across = long || bent || l > lm && (l / lm >= w / wm || w <= wm);
            let along = !across && w > wm;
            let min = if regular {
                2.2 * ctx.min_area.unwrap_or(1000.0)
            } else if closed {
                5000.0
            } else {
                14000.0
            };
            if a < min || depth > 14 || !across && !along {
                leaves.push((r, rot, closed));
                continue;
            }
            let access = !regular && closed && ctx.access && depth == 0;
            let f = if cutter.natural {
                rng.range(0.32, 0.68)
            } else if closed || !across {
                rng.range(0.4, 0.6)
            } else {
                rng.range(0.46, 0.54)
            };
            let mut ignored = vec![];
            let bucket = if regular {
                &mut ignored
            } else if access {
                &mut net.ways
            } else {
                &mut net.headlands
            };
            let pcs = cutter.cut(
                &r,
                rot,
                across,
                f,
                if access {
                    4.4
                } else if closed {
                    1.3
                } else {
                    2.4
                },
                if closed { 5.5 } else { 3.5 },
                bucket,
                closed,
            );
            if let Some(pcs) = pcs {
                for pg in pcs {
                    let rot = if closed && !regular {
                        rot + rng.range(-0.5, 0.5)
                    } else {
                        rot
                    };
                    stack.push((pg, rot, depth + 1));
                }
            } else {
                leaves.push((r, rot, closed));
            }
        }
        leaves.extend(stack.into_iter().map(|(r, rot, _)| (r, rot, closed)));
    }
    for (r, rot, enclosed) in leaves {
        let a = region_area(&r);
        if a < ctx.min_area.unwrap_or(1400.0) {
            if regular {
                net.margins.push(r);
            }
            continue;
        }
        let c = centroid(&r.outer);
        let angle = (cutter.direction(c) + rot).rem_euclid(PI);
        let (u0, u1, v0, v1) = extents(&r.outer, angle.cos(), angle.sin());
        if regular
            && a / (u1 - u0).max(v1 - v0).max(1.0)
                < if ctx.min_area.unwrap_or(1400.0) < 500.0 {
                    7.0
                } else {
                    18.0
                }
        {
            net.margins.push(r);
            continue;
        }
        let mut fl = Furlong {
            region: r,
            angle,
            enclosed,
            strips: vec![],
            strip_w: 0.0,
            parcel: regular,
        };
        if !regular && !enclosed {
            cut_strips(&mut fl, rng, ctx.strips_at, Some(ctx));
        }
        net.furlongs.push(fl);
    }
}
pub fn cut_strips(
    fl: &mut Furlong,
    rng: &mut impl FieldRandom,
    strips_at: Option<&dyn Fn(Point) -> bool>,
    ctx: Option<&Context>,
) {
    let cen = centroid(&fl.region.outer);
    let (ca, sa) = (fl.angle.cos(), fl.angle.sin());
    let (u0, u1, v0, v1) = extents(&fl.region.outer, ca, sa);
    let a = region_area(&fl.region);
    let ws = rng.range(11.0, 22.0);
    fl.strip_w = ws;
    let l = u1 - u0;
    let slabs = ((v1 - v0) / ws).ceil();
    if slabs < 2.0 || slabs > 70.0 || a <= 2500.0 || strips_at.is_some_and(|f| !f(cen)) {
        return;
    }
    let amp = rng.range(-1.0, 1.0) * (0.012 * l).min(2.5);
    let phase = rng.range(0.0, 0.4);
    let steps = 8_usize.max((l / 24.0).ceil() as usize);
    let us: Vec<_> = (0..=steps)
        .map(|k| u0 - 1.0 + (l + 2.0) * k as f64 / steps as f64)
        .collect();
    // Integrate one shared centreline at generation time. Offset boundaries
    // cannot cross, and slope strips lengthen along contours rather than climb.
    let mut bends = vec![0.0; steps + 1];
    let centre = steps / 2;
    for sign in [-1_isize, 1] {
        let mut k = centre;
        loop {
            let next = k as isize + sign;
            if next < 0 || next > steps as isize {
                break;
            }
            let next = next as usize;
            let u = (us[k] + us[next]) / 2.0;
            let v = (v0 + v1) / 2.0 + bends[k];
            let q = p(u * ca - v * sa, u * sa + v * ca);
            let tangent = ctx.map_or(0.0, |ctx| {
                let follow = (((ctx.slope)(q.x, q.y) - 0.02) / 0.04).clamp(0.0, 1.0);
                follow
                    * angle_delta((ctx.dir)(q.x, q.y) - fl.angle)
                        .tan()
                        .clamp(-0.5, 0.5)
            });
            bends[next] = bends[k] + (us[next] - us[k]) * tangent;
            k = next;
        }
    }
    for (u, bend) in us.iter().zip(&mut bends) {
        *bend += amp * (2.0 * PI * ((*u - u0) / l.max(1.0) + phase)).sin();
    }
    let padding = bends.iter().map(|v| v.abs()).fold(0.0_f64, f64::max) + ws;
    let transform = |a: &Polygon| {
        a.iter()
            .map(|p| local_point(p, ca, sa))
            .collect::<Polygon>()
    };
    fn local_point(p: &Point, ca: f64, sa: f64) -> Point {
        super::geom::p(p.x * ca + p.y * sa, -p.x * sa + p.y * ca)
    }
    let local = Region {
        outer: transform(&fl.region.outer),
        holes: fl.region.holes.iter().map(transform).collect(),
    };
    let extent = l.max(v1 - v0) + 100.0;
    let mut strips = vec![];
    fn append(
        piece: Region,
        depth: usize,
        v0: f64,
        v1: f64,
        extent: f64,
        out: &mut Vec<Region>,
    ) -> Result<(), ()> {
        if piece.holes.is_empty() {
            out.push(piece);
            return Ok(());
        }
        if depth >= 32 {
            return Ok(());
        }
        let b = bbox(&piece.holes[0]);
        let split = (b.x0 + b.x1) / 2.0;
        let b = bbox(&piece.outer);
        for (lo, hi) in [(b.x0 - 1.0, split), (split, b.x1 + 1.0)] {
            let clip = super::geom::piece(vec![
                super::geom::p(lo, v0 - extent),
                super::geom::p(hi, v0 - extent),
                super::geom::p(hi, v1 + extent),
                super::geom::p(lo, v1 + extent),
            ]);
            for pg in bo::exact(&[piece.clone()], &[clip], Op::Intersection)? {
                append(pg, depth + 1, v0, v1, extent, out)?;
            }
        }
        Ok(())
    }
    let boundary = |v: f64, taper: f64| -> Polygon {
        us.iter()
            .zip(&bends)
            .map(|(&u, &bend)| p(u, v + bend + taper * (u - (u0 + u1) / 2.0) / l.max(1.0)))
            .collect()
    };
    let mut v = v0 - padding;
    let mut lower = boundary(v, 0.0);
    for _ in 0..120 {
        v += ws * rng.range(0.65, 1.45);
        let upper = boundary(v, ws * rng.range(-0.18, 0.18));
        let mut band = lower.clone();
        band.extend(upper.iter().rev().copied());
        let result = (|| {
            for pg in bo::exact(&[local.clone()], &[piece(band)], Op::Intersection)? {
                append(pg, 0, v0, v1, extent, &mut strips)?;
            }
            Ok::<_, ()>(())
        })();
        if result.is_err() {
            strips.clear();
            break;
        }
        lower = upper;
        if v > v1 + padding {
            break;
        }
    }
    merge_strip_slivers(&mut strips, ws);
    if !strips.is_empty() {
        fl.strips = strips
            .into_iter()
            // An isolated unmergeable tip keeps the holder's base crop colour.
            .filter(|r| !strip_sliver(r, ws))
            .map(|r| {
                r.outer
                    .into_iter()
                    .map(|p| super::geom::p(p.x * ca - p.y * sa, p.x * sa + p.y * ca))
                    .collect()
            })
            .collect();
    }
}

fn strip_sliver(r: &Region, width: f64) -> bool {
    let b = bbox(&r.outer);
    let a = region_area(r);
    let length = (b.x1 - b.x0).max(1.0);
    let breadth = (b.y1 - b.y0).max(1.0);
    a < 120.0_f64.max(0.6 * width * width)
        || a / length < width * 0.32
        || breadth < width * 1.8 && a / (length * breadth) < 0.58
}

// Shared-edge overlap, including collinear edges subdivided by clipping.
// Only nearby clipped tips use this; healthy strips need no union operation.
fn shared_border(a: &Polygon, b: &Polygon) -> f64 {
    let mut shared = 0.0;
    for i in 0..a.len() {
        let (p, q) = (a[i], a[(i + 1) % a.len()]);
        let len = dist(p, q);
        if len < 0.001 {
            continue;
        }
        let (dx, dy) = ((q.x - p.x) / len, (q.y - p.y) / len);
        for j in 0..b.len() {
            let (r, s) = (b[j], b[(j + 1) % b.len()]);
            if ((r.x - p.x) * dy - (r.y - p.y) * dx).abs() > 0.002
                || ((s.x - p.x) * dy - (s.y - p.y) * dx).abs() > 0.002
            {
                continue;
            }
            let t = (r.x - p.x) * dx + (r.y - p.y) * dy;
            let u = (s.x - p.x) * dx + (s.y - p.y) * dy;
            shared += (len.min(t.max(u)) - 0.0_f64.max(t.min(u))).max(0.0);
        }
    }
    shared
}

fn merge_strip_slivers(strips: &mut Vec<Region>, width: f64) {
    // Two bounded passes also absorb a tip whose first neighbour was a tip.
    for _ in 0..2 {
        let mut i = 0;
        while i < strips.len() {
            if !strip_sliver(&strips[i], width) {
                i += 1;
                continue;
            }
            let b = bbox(&strips[i].outer).grow(0.01);
            let neighbour = (0..strips.len())
                .filter(|&j| j != i && b.meets(bbox(&strips[j].outer)))
                .map(|j| (j, shared_border(&strips[i].outer, &strips[j].outer)))
                .filter(|(_, shared)| *shared > 0.01)
                .max_by(|a, b| a.1.total_cmp(&b.1));
            if let Some((j, _)) = neighbour {
                if let Ok(mut joined) =
                    bo::exact(&[strips[i].clone()], &[strips[j].clone()], Op::Union)
                {
                    if joined.len() == 1 && joined[0].holes.is_empty() {
                        strips[j] = joined.remove(0);
                        strips.remove(i);
                        continue;
                    }
                }
            }
            i += 1;
        }
    }
}

pub fn prune(net: &mut Net, connectors: &[(Polygon, f64)], tol: f64) -> (usize, usize) {
    let con: Vec<_> = connectors
        .iter()
        .filter(|(p, _)| p.len() >= 2)
        .map(|(p, w)| (p, *w, bbox(p).grow(2.0 * tol)))
        .collect();
    let mut kept: Vec<(Polygon, Box2)> = vec![];
    let mut dropped = 0;
    for pl in std::mem::take(&mut net.ways) {
        if pl.len() < 2 {
            continue;
        }
        let mut ss = vec![];
        for (i, ab) in pl.windows(2).enumerate() {
            let n = 1_usize.max((dist(ab[0], ab[1]) / 10.0).ceil() as usize);
            for k in if i == 0 { 0 } else { 1 }..=n {
                ss.push(lerp(ab[0], ab[1], k as f64 / n as f64));
            }
        }
        let dup = ss
            .iter()
            .filter(|&&p| {
                con.iter()
                    .any(|(a, _, b)| b.contains(p) && line_dist(p, a) < 8.0)
                    || kept
                        .iter()
                        .any(|(a, b)| b.contains(p) && line_dist(p, a) < 6.0)
            })
            .count();
        if dup as f64 >= 0.7 * ss.len() as f64 {
            dropped += 1;
            continue;
        }
        let b = bbox(&pl).grow(2.0 * tol);
        kept.push((pl, b));
    }
    let joins = |p: Point, a: &[Point], width: f64| line_dist(p, a) <= (4.4 + width) / 2.0 + 0.5;
    let mut linked: Vec<bool> = kept
        .iter()
        .map(|(a, _)| {
            [a[0], *a.last().unwrap()]
                .iter()
                .any(|&p| con.iter().any(|(a, w, b)| b.contains(p) && joins(p, a, *w)))
        })
        .collect();
    loop {
        let mut changed = false;
        for i in 0..kept.len() {
            if linked[i] {
                continue;
            }
            for j in 0..kept.len() {
                if !linked[j] || i == j {
                    continue;
                }
                let (a, ab) = &kept[i];
                let (b, bb) = &kept[j];
                if [a[0], *a.last().unwrap()]
                    .iter()
                    .any(|&p| bb.contains(p) && joins(p, b, 4.4))
                    || [b[0], *b.last().unwrap()]
                        .iter()
                        .any(|&p| ab.contains(p) && joins(p, a, 4.4))
                {
                    linked[i] = true;
                    changed = true;
                    break;
                }
            }
        }
        if !changed {
            break;
        }
    }
    let mut demoted = 0;
    for (i, (a, _)) in kept.into_iter().enumerate() {
        if linked[i] {
            net.ways.push(a);
        } else {
            net.headlands.push(a);
            demoted += 1;
        }
    }
    (dropped, demoted)
}
pub fn connect(
    net: &mut Net,
    connectors: &[(Polygon, f64)],
    reach: f64,
    clear: impl Fn(Point, Point) -> bool,
) -> usize {
    let cell = reach.max(64.0);
    let mut grid = super::hash::HashMap::<(i32, i32), Vec<usize>>::default();
    let mut segments = vec![];
    for (path, _) in connectors {
        for ab in path.windows(2) {
            let id = segments.len();
            segments.push((ab[0], ab[1]));
            let b = bbox(ab);
            for y in (b.y0 / cell).floor() as i32..=(b.y1 / cell).floor() as i32 {
                for x in (b.x0 / cell).floor() as i32..=(b.x1 / cell).floor() as i32 {
                    grid.entry((x, y)).or_default().push(id);
                }
            }
        }
    }
    let mut links = 0;
    for way in &mut net.ways {
        if way.is_empty() {
            continue;
        }
        let mut candidates = vec![];
        for (end, p) in [(true, way[0]), (false, *way.last().unwrap())] {
            let mut seen = super::hash::HashSet::default();
            for y in ((p.y - reach) / cell).floor() as i32..=((p.y + reach) / cell).floor() as i32 {
                for x in
                    ((p.x - reach) / cell).floor() as i32..=((p.x + reach) / cell).floor() as i32
                {
                    for &id in grid.get(&(x, y)).into_iter().flatten() {
                        if !seen.insert(id) {
                            continue;
                        }
                        let (a, b) = segments[id];
                        let q = nearest(p, a, b);
                        let d = dist(p, q);
                        if d > 0.01 && d <= reach {
                            candidates.push((end, p, q, d));
                        }
                    }
                }
            }
        }
        candidates.sort_by(|a, b| a.3.total_cmp(&b.3));
        if let Some((end, _, q, _)) = candidates.into_iter().find(|(_, p, q, _)| clear(*p, *q)) {
            if end {
                way.insert(0, q);
            } else {
                way.push(q);
            }
            links += 1;
        }
    }
    links
}

#[cfg(test)]
mod tests {
    use super::*;

    fn furlong(region: Region) -> Furlong {
        Furlong {
            region,
            angle: 0.0,
            enclosed: false,
            strips: vec![],
            strip_w: 0.0,
            parcel: true,
        }
    }

    #[test]
    fn triangular_tips_merge_without_losing_area() {
        let mut strips = vec![
            piece(vec![p(0.0, 0.0), p(20.0, 0.0), p(20.0, 8.0)]),
            piece(vec![
                p(20.0, 0.0),
                p(100.0, 0.0),
                p(100.0, 20.0),
                p(20.0, 20.0),
            ]),
        ];
        let before: f64 = strips.iter().map(region_area).sum();
        assert!(strip_sliver(&strips[0], 16.0));
        merge_strip_slivers(&mut strips, 16.0);
        assert_eq!(strips.len(), 1);
        assert!((region_area(&strips[0]) - before).abs() < 0.01);
        assert!(!strip_sliver(&strips[0], 16.0));
    }

    #[test]
    fn clipped_strips_are_deterministic_varied_and_respect_holes() {
        let mut region = piece(vec![
            p(0.0, 0.0),
            p(310.0, 8.0),
            p(285.0, 180.0),
            p(140.0, 200.0),
            p(0.0, 150.0),
        ]);
        region.holes.push(rect(150.0, 95.0, 32.0, 35.0, 0.2));
        let mut a = furlong(region.clone());
        let mut b = furlong(region.clone());
        cut_strips(&mut a, &mut Rng::new("field-clipping"), None, None);
        cut_strips(&mut b, &mut Rng::new("field-clipping"), None, None);
        assert_eq!(a.strips, b.strips);
        assert!(a.strips.len() >= 6 && a.strips.len() < 40);
        let rs: Vec<_> = a.strips.iter().cloned().map(piece).collect();
        let covered: f64 = rs.iter().map(region_area).sum();
        assert!(covered > region_area(&region) * 0.97);
        for (i, r) in rs.iter().enumerate() {
            assert!(!strip_sliver(r, a.strip_w));
            let outside: f64 = bo::exact(&[r.clone()], &[region.clone()], Op::Difference)
                .unwrap()
                .iter()
                .map(region_area)
                .sum();
            assert!(
                outside < 0.05,
                "strip crosses its holder or a hole: {outside}"
            );
            for other in &rs[..i] {
                if !bbox(&r.outer).meets(bbox(&other.outer)) {
                    continue;
                }
                let overlap: f64 = bo::exact(&[r.clone()], &[other.clone()], Op::Intersection)
                    .unwrap()
                    .iter()
                    .map(region_area)
                    .sum();
                assert!(overlap < 0.05, "strips overlap: {overlap}");
            }
        }
        // Compare sections well away from the irregular outline and hole.
        let widths: Vec<_> = rs
            .iter()
            .filter_map(|r| {
                let b = bbox(&r.outer);
                (b.x0 < 1.0 && b.x1 > 280.0).then_some(region_area(r) / (b.x1 - b.x0))
            })
            .collect();
        assert!(widths.len() >= 3);
        let low = widths.iter().copied().fold(f64::INFINITY, f64::min);
        let high = widths.iter().copied().fold(0.0_f64, f64::max);
        assert!(high > low * 1.15);
    }

    #[test]
    fn contour_parcel_separator_curves_and_preserves_coverage() {
        let ctx = Context {
            dir: &|x, _| x * 0.002,
            slope: &|_, _| 0.12,
            closed: false,
            noise: &|_, _| 0.0,
            regular: true,
            access: false,
            min_area: None,
            strips_at: None,
        };
        let cutter = Cutter {
            ctx: &ctx,
            root_angle: 0.0,
            natural: true,
        };
        let r = piece(rect(0.0, 0.0, 360.0, 200.0, 0.0));
        let mut cuts = vec![];
        let parts = cutter
            .once(&r, 0.0, false, 0.5, 0.0, 0.0, &mut cuts, false, false)
            .unwrap();
        assert_eq!(parts.len(), 2);
        assert!(parts.iter().all(|r| r.outer.len() > 5));
        let covered: f64 = parts.iter().map(region_area).sum();
        assert!((covered - region_area(&r)).abs() < 0.05);
        assert!(cuts.iter().any(|line| {
            let b = bbox(line);
            b.y1 - b.y0 > 15.0 && b.x1 - b.x0 > 350.0
        }));
        let overlap: f64 = bo::exact(&parts[..1], &parts[1..], Op::Intersection)
            .unwrap()
            .iter()
            .map(region_area)
            .sum();
        assert!(overlap < 0.05);
    }

    #[test]
    fn contour_strips_bend_and_partition_stays_deterministic() {
        let ctx = Context {
            dir: &|x, _| x * 0.002,
            slope: &|_, _| 0.12,
            closed: false,
            noise: &|x, y| (x + y).sin(),
            regular: true,
            access: false,
            min_area: None,
            strips_at: None,
        };
        let r = piece(rect(0.0, 0.0, 360.0, 200.0, 0.0));
        let mut sloped = furlong(r.clone());
        let mut flat = furlong(r.clone());
        cut_strips(
            &mut sloped,
            &mut Rng::new("contour-strips"),
            None,
            Some(&ctx),
        );
        cut_strips(&mut flat, &mut Rng::new("contour-strips"), None, None);
        assert_ne!(sloped.strips, flat.strips);
        // At a parcel's centre the contour is horizontal; its ends turn uphill
        // symmetrically. At least one strip retains this curved shared edge.
        assert!(sloped.strips.iter().any(|ring| ring.len() > 10));
        let mut first = Net::default();
        let mut second = Net::default();
        partition(&r, &ctx, &mut Rng::new("contour-parcels"), &mut first);
        partition(&r, &ctx, &mut Rng::new("contour-parcels"), &mut second);
        assert!(first.furlongs.len() > 1 && first.furlongs.len() < 30);
        assert_eq!(first.furlongs.len(), second.furlongs.len());
        for (a, b) in first.furlongs.iter().zip(&second.furlongs) {
            assert_eq!(a.region.outer, b.region.outer);
            assert_eq!(a.angle, b.angle);
            let (_, length, breadth, _) = Cutter {
                ctx: &ctx,
                root_angle: 0.0,
                natural: true,
            }
            .dims(&a.region, 0.0);
            assert!(length > breadth, "slope parcels must extend along contours");
        }
    }
}
