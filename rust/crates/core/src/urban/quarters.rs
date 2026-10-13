//! Native quarter fixture, guidance field, recursive street cuts and ribbon carving.
use super::geometry as g;
use super::{Block, Layout, LayoutConfig, Morph, Point, Quarter, Shape, Site, Street, Surface};
use crate::{noise::Noise, rng::Rng};
use std::f64::consts::{FRAC_PI_2, PI, TAU};

#[derive(Clone, Copy)]
struct Frame {
    c: Point,
    u: Point,
    v: Point,
    hu: f64,
    hv: f64,
}
fn frame(s: &Shape) -> Frame {
    let mut best = None;
    let mut ba = f64::INFINITY;
    for i in 0..s.outer.len() {
        let a = s.outer[i];
        let b = s.outer[(i + 1) % s.outer.len()];
        let l = (b.x - a.x).hypot(b.y - a.y);
        if l < 1e-8 {
            continue;
        }
        let u = Point {
            x: (b.x - a.x) / l,
            y: (b.y - a.y) / l,
        };
        let v = Point { x: -u.y, y: u.x };
        let (mut x0, mut y0, mut x1, mut y1) = (
            f64::INFINITY,
            f64::INFINITY,
            f64::NEG_INFINITY,
            f64::NEG_INFINITY,
        );
        for p in &s.outer {
            let x = p.x * u.x + p.y * u.y;
            let y = p.x * v.x + p.y * v.y;
            x0 = x0.min(x);
            x1 = x1.max(x);
            y0 = y0.min(y);
            y1 = y1.max(y)
        }
        let ar = (x1 - x0) * (y1 - y0);
        if ar < ba {
            ba = ar;
            let mut f = Frame {
                c: Point {
                    x: u.x * (x0 + x1) * 0.5 + v.x * (y0 + y1) * 0.5,
                    y: u.y * (x0 + x1) * 0.5 + v.y * (y0 + y1) * 0.5,
                },
                u,
                v,
                hu: (x1 - x0) * 0.5,
                hv: (y1 - y0) * 0.5,
            };
            if f.hu < f.hv {
                std::mem::swap(&mut f.u, &mut f.v);
                std::mem::swap(&mut f.hu, &mut f.hv)
            }
            best = Some(f)
        }
    }
    best.unwrap_or(Frame {
        c: g::centroid(s),
        u: Point { x: 1.0, y: 0.0 },
        v: Point { x: 0.0, y: 1.0 },
        hu: 0.0,
        hv: 0.0,
    })
}
fn len(path: &[Point]) -> f64 {
    path.windows(2)
        .map(|q| (q[0].x - q[1].x).hypot(q[0].y - q[1].y))
        .sum()
}
fn smooth(x: f64, a: f64, b: f64) -> f64 {
    let t = ((x - a) / (b - a)).clamp(0.0, 1.0);
    t * t * (3.0 - 2.0 * t)
}
fn delta(a: f64, b: f64) -> f64 {
    (a - b + PI).rem_euclid(TAU) - PI
}
fn nearest(p: Point, streets: &[Street], max_rank: usize) -> Option<(f64, f64)> {
    streets
        .iter()
        .filter(|s| s.rank <= max_rank)
        .flat_map(|s| s.path.windows(2))
        .map(|q| {
            (
                g::distance(p, q[0], q[1]).0,
                (q[1].y - q[0].y).atan2(q[1].x - q[0].x),
            )
        })
        .min_by(|a, b| a.0.total_cmp(&b.0))
}
fn acute_ends(s: &Shape, path: &[Point]) -> bool {
    let r = &s.outer;
    for (i, &p) in r.iter().enumerate() {
        if ![path[0], *path.last().unwrap()]
            .iter()
            .any(|q| (q.x - p.x).hypot(q.y - p.y) < 0.05)
        {
            continue;
        }
        let a = r[(i + r.len() - 1) % r.len()];
        let b = r[(i + 1) % r.len()];
        let u = Point {
            x: a.x - p.x,
            y: a.y - p.y,
        };
        let v = Point {
            x: b.x - p.x,
            y: b.y - p.y,
        };
        let angle = ((u.x * v.x + u.y * v.y) / (u.x.hypot(u.y) * v.x.hypot(v.y)).max(1e-9))
            .clamp(-1.0, 1.0)
            .acos();
        if angle < 25.0 * PI / 180.0 {
            return true;
        }
    }
    false
}
struct Field<'a> {
    p: &'a Morph,
    center: Point,
    angle: f64,
    terrain: f64,
    water: f64,
    surface: Surface<'a>,
    noise: Noise,
}
impl Field<'_> {
    fn gradient(&self, p: Point, r: f64) -> (f64, f64) {
        (
            (self.surface.height_at(Point { x: p.x + r, y: p.y })
                - self.surface.height_at(Point { x: p.x - r, y: p.y }))
                / (2.0 * r),
            (self.surface.height_at(Point { x: p.x, y: p.y + r })
                - self.surface.height_at(Point { x: p.x, y: p.y - r }))
                / (2.0 * r),
        )
    }
    fn angle(&self, p: Point, streets: &[Street]) -> f64 {
        let m = self.p;
        let wl = m.number("fieldWavelength").max(1.0);
        let nz = m.number("fieldNoise").to_radians() * self.noise.fbm(p.x / wl, p.y / wl, 2);
        let base = match m.text("orientation") {
            "cardinal" => 0.0,
            "terrain" => self.terrain,
            "water" => self.water,
            _ => self.angle,
        };
        if m.text("streetOp") == "grid" {
            return base
                + nz
                + m.number("gridSkew") * self.noise.fbm(p.x / 600.0 + 9.0, p.y / 600.0 - 3.0, 2);
        }
        let (gx, gy) = self.gradient(p, 70.0);
        let slope = gx.hypot(gy);
        let contour = gy.atan2(gx) + FRAC_PI_2;
        let cf = m.number_or("contourFollow", 0.0);
        let th = (p.y - self.center.y).atan2(p.x - self.center.x) + m.number("fieldTwist");
        let mut cx = (4.0 * th).cos();
        let mut cy = (4.0 * th).sin();
        if cf > 0.0 {
            let w = cf * smooth(slope, 0.02, 0.06);
            cx = (1.0 - w) * (4.0 * self.terrain).cos() + w * (4.0 * contour).cos();
            cy = (1.0 - w) * (4.0 * self.terrain).sin() + w * (4.0 * contour).sin();
            return cy.atan2(cx) / 4.0;
        }
        let wr = m.number("fieldRandom");
        let psi = PI * self.noise.fbm(p.x / 260.0 + 31.7, p.y / 260.0 - 12.3, 2);
        cx = (1.0 - wr) * cx + wr * (4.0 * psi).cos();
        cy = (1.0 - wr) * cy + wr * (4.0 * psi).sin();
        if let Some((d, a)) = nearest(p, streets, 1) {
            let w = 0.85 * (-d / 35.0).exp();
            cx = (1.0 - w) * cx + w * (4.0 * a).cos();
            cy = (1.0 - w) * cy + w * (4.0 * a).sin()
        }
        let cb = m.number_or("contourBlend", 0.0);
        let w = (0.75 * smooth(slope, 0.06, 0.14)).max(cb * smooth(slope, 0.025, 0.08));
        cx = (1.0 - w) * cx + w * (4.0 * contour).cos();
        cy = (1.0 - w) * cy + w * (4.0 * contour).sin();
        cy.atan2(cx) / 4.0
            + nz * (0.5
                + 0.5
                    * smooth(
                        (p.x - self.center.x).hypot(p.y - self.center.y),
                        20.0,
                        120.0,
                    ))
    }
    fn trace(
        &self,
        s: &Shape,
        seed: Point,
        heading: f64,
        streets: &[Street],
    ) -> Option<Vec<Point>> {
        let mut out = vec![seed];
        let mut cur = seed;
        let mut head = heading;
        let turn = self.p.number("curvature") * 5.0 * PI / 180.0;
        for _ in 0..800 {
            let a = self.angle(cur, streets);
            let dh = (0..4)
                .map(|k| delta(a + k as f64 * FRAC_PI_2, head))
                .min_by(|a, b| a.abs().total_cmp(&b.abs()))?;
            head += dh.clamp(-turn, turn);
            let nx = Point {
                x: cur.x + head.cos() * 5.0,
                y: cur.y + head.sin() * 5.0,
            };
            let hit = s
                .outer
                .iter()
                .zip(s.outer.iter().cycle().skip(1))
                .take(s.outer.len())
                .filter_map(|(&a, &b)| g::segment_hit(cur, nx, a, b))
                .min_by(|a, b| a.0.total_cmp(&b.0));
            if let Some((_, p)) = hit {
                out.push(p);
                return Some(out);
            }
            if !g::contains(s, nx) {
                return None;
            }
            out.push(nx);
            cur = nx;
        }
        None
    }
}
fn add(
    streets: &mut Vec<Street>,
    path: Vec<Point>,
    rank: usize,
    role: &str,
    m: &Morph,
    rng: &mut Rng,
) {
    if path.len() < 2 || len(&path) < 0.2 {
        return;
    }
    let widths = path.iter().map(|_| m.width(rank, rng)).collect();
    streets.push(Street {
        path,
        widths,
        rank,
        role: role.into(),
    })
}
#[derive(Clone)]
struct Piece {
    shape: Shape,
    level: usize,
    kind: String,
}
type Candidate = (f64, Shape, Shape, Vec<Point>, usize, bool, bool);
fn split_quarter(
    q: &Quarter,
    field: &Field<'_>,
    cfg: &LayoutConfig,
    streets: &mut Vec<Street>,
    rng: &mut Rng,
) -> Vec<Piece> {
    let m = field.p;
    let mut queue = vec![Piece {
        shape: q.shape.clone(),
        level: 1,
        kind: "block".into(),
    }];
    let mut out = vec![];
    let mut places = 0;
    let mut guard = 0;
    while let Some(pc) = queue.pop() {
        guard += 1;
        if guard > 4000 {
            out.push(pc);
            out.extend(queue);
            break;
        }
        let a0 = g::area(&pc.shape);
        let f = frame(&pc.shape);
        let bs = m.range("blockSize", &cfg.zone);
        let target = bs[0].max(1.0)
            * (bs[1].max(bs[0].max(1.0)) / bs[0].max(1.0)).powf(rng.float())
            * (0.85
                + 0.15
                    * smooth(
                        (f.c.x - field.center.x).hypot(f.c.y - field.center.y),
                        50.0,
                        320.0,
                    ));
        if pc.kind != "block"
            || (a0 < target
                && f.hu / f.hv.max(1.0) < if cfg.zone == "faubourg" { 7.0 } else { 2.6 })
            || a0 < 2.0 * m.number("minBlock")
        {
            out.push(pc);
            continue;
        }
        let angle = field.angle(f.c, streets);
        let mut best: Option<Candidate> = None;
        for fi in 0..2 {
            let heading = angle + fi as f64 * FRAC_PI_2;
            let d = Point {
                x: heading.cos(),
                y: heading.sin(),
            };
            let n = Point { x: -d.y, y: d.x };
            let mut seeds = vec![];
            let mut rank = (pc.level + 1).min(3);
            if m.text("streetOp") == "grid" {
                let lanes = m.pair("laneSpacing");
                let coarse = m.pair("gridSpacing");
                let grid_angle = match m.text("orientation") {
                    "cardinal" => 0.0,
                    "terrain" => field.terrain,
                    "water" => field.water,
                    _ => field.angle,
                };
                for (spacing, lane) in [(coarse, false), (lanes, true)] {
                    if !lane && a0 < m.number("wardArea") && (lanes[0] > 0.0 || lanes[1] > 0.0) {
                        continue;
                    }
                    rank = if lane { 3 } else { 2 };
                    let sp = spacing[if (heading - grid_angle).cos().abs() > 0.7 {
                        0
                    } else {
                        1
                    }];
                    if sp > 0.0 {
                        let project =
                            |p: Point| (p.x - field.center.x) * n.x + (p.y - field.center.y) * n.y;
                        let c = project(f.c);
                        let lo = pc
                            .shape
                            .outer
                            .iter()
                            .map(|&p| project(p))
                            .fold(f64::INFINITY, f64::min)
                            + m.number("minWidth");
                        let hi = pc
                            .shape
                            .outer
                            .iter()
                            .map(|&p| project(p))
                            .fold(f64::NEG_INFINITY, f64::max)
                            - m.number("minWidth");
                        let mut lines = vec![];
                        let mut k = ((lo - sp * 0.5) / sp).ceil();
                        while k * sp + sp * 0.5 < hi && lines.len() < 512 {
                            lines.push(k * sp + sp * 0.5);
                            k += 1.0
                        }
                        lines.sort_by(|a, b| (a - c).abs().total_cmp(&(b - c).abs()));
                        for l in lines.into_iter().take(3) {
                            let o = Point {
                                x: f.c.x + n.x * (l - c),
                                y: f.c.y + n.y * (l - c),
                            };
                            let a = Point {
                                x: o.x - d.x * 100000.0,
                                y: o.y - d.y * 100000.0,
                            };
                            let b = Point {
                                x: o.x + d.x * 100000.0,
                                y: o.y + d.y * 100000.0,
                            };
                            let mut hits: Vec<_> = pc
                                .shape
                                .outer
                                .iter()
                                .zip(pc.shape.outer.iter().cycle().skip(1))
                                .take(pc.shape.outer.len())
                                .filter_map(|(&c, &e)| g::segment_hit(a, b, c, e))
                                .collect();
                            hits.sort_by(|a, b| a.0.total_cmp(&b.0));
                            for pair in hits.as_chunks::<2>().0 {
                                seeds.push(Point {
                                    x: (pair[0].1.x + pair[1].1.x) * 0.5,
                                    y: (pair[0].1.y + pair[1].1.y) * 0.5,
                                })
                            }
                        }
                    }
                    if !seeds.is_empty() {
                        break;
                    }
                }
            } else {
                for t in [0.5, 0.4, 0.6, 0.33, 0.67] {
                    let v = (t + rng.range(-0.04, 0.04) - 0.5) * 2.0 * f.hu * 0.92;
                    let w = rng.range(-0.15, 0.15) * f.hv;
                    seeds.push(Point {
                        x: f.c.x + f.u.x * v + f.v.x * w,
                        y: f.c.y + f.u.y * v + f.v.y * w,
                    })
                }
            }
            for seed in seeds {
                if !g::contains(&pc.shape, seed) {
                    continue;
                }
                let Some(mut back) = field.trace(&pc.shape, seed, heading + PI, streets) else {
                    continue;
                };
                let Some(front) = field.trace(&pc.shape, seed, heading, streets) else {
                    continue;
                };
                back.reverse();
                back.extend(front.into_iter().skip(1));
                // Snap onto shared junction vertices, preserving the exact boundary partition.
                let mut snapped = back.clone();
                for end in [0, back.len() - 1] {
                    if let Some(&v) = pc
                        .shape
                        .outer
                        .iter()
                        .filter(|p| (p.x - back[end].x).hypot(p.y - back[end].y) < 6.0)
                        .min_by(|a, b| {
                            (a.x - back[end].x)
                                .hypot(a.y - back[end].y)
                                .total_cmp(&(b.x - back[end].x).hypot(b.y - back[end].y))
                        })
                    {
                        snapped[end] = v;
                    }
                }
                if g::split(&pc.shape, &snapped).is_some() {
                    back = snapped;
                }
                // Every recursive street must connect to the existing primary or recursive network.
                if ![back[0], *back.last().unwrap()]
                    .iter()
                    .any(|&p| nearest(p, streets, 4).is_some_and(|(d, _)| d < 0.2))
                {
                    continue;
                }
                let Some((a, b)) = g::split(&pc.shape, &back) else {
                    continue;
                };
                let aa = g::area(&a);
                let ab = g::area(&b);
                let can_place = |ar: f64| {
                    m.text("streetOp") == "organic"
                        && ar >= 120.0
                        && ar <= m.number("placeThreshold")
                        && places < 6
                };
                let bad_a = aa < m.number("minBlock") || acute_ends(&a, &back);
                let bad_b = ab < m.number("minBlock") || acute_ends(&b, &back);
                let pa = bad_a && can_place(aa);
                let pb = bad_b && can_place(ab);
                if bad_a && !pa || bad_b && !pb {
                    continue;
                }
                let fa = frame(&a);
                let fb = frame(&b);
                if fa.hv * 2.0 < if pa { 6.0 } else { m.number("minWidth") }
                    || fb.hv * 2.0 < if pb { 6.0 } else { m.number("minWidth") }
                {
                    continue;
                }
                let cost = (aa - ab).abs() / a0
                    + 0.25
                        * ((fa.hu / fa.hv.max(1.0) - 2.5).max(0.0)
                            + (fb.hu / fb.hv.max(1.0) - 2.5).max(0.0))
                    + rng.float() * 0.08;
                if best.as_ref().is_none_or(|b| cost < b.0) {
                    best = Some((cost, a, b, back, rank, pa, pb))
                }
            }
        }
        if let Some((_, a, b, path, mut rank, pa, pb)) = best {
            let lc = m.number_or("longCut", 0.0);
            if lc > 0.0 && len(&path) >= lc {
                rank = rank.min(2)
            }
            add(
                streets,
                path,
                rank,
                if rank <= 2 { "street" } else { "lane" },
                m,
                rng,
            );
            if pa || pb {
                places += 1
            }
            queue.push(Piece {
                shape: a,
                level: pc.level + 1,
                kind: if pa { "place" } else { "block" }.into(),
            });
            queue.push(Piece {
                shape: b,
                level: pc.level + 1,
                kind: if pb { "place" } else { "block" }.into(),
            });
        } else {
            out.push(pc)
        }
    }
    out
}

fn closes(
    pieces: &[Piece],
    streets: &mut Vec<Street>,
    field: &Field<'_>,
    cfg: &LayoutConfig,
    rng: &mut Rng,
) {
    let m = field.p;
    let op = m.text("closeOp");
    if op == "none" {
        return;
    }
    if op != "closes" {
        tree_closes(pieces, streets, m, rng);
        return;
    }
    for pc in pieces {
        if pc.kind != "block" || !rng.chance(m.number("deadEndRatio")) {
            continue;
        }
        let f = frame(&pc.shape);
        let pd = m.range("plotDepth", &cfg.zone)[1];
        if f.hv < pd * 0.95 && op == "closes" {
            continue;
        }
        let mut edges: Vec<_> = pc
            .shape
            .outer
            .iter()
            .zip(pc.shape.outer.iter().cycle().skip(1))
            .take(pc.shape.outer.len())
            .filter_map(|(&a, &b)| {
                let p = Point {
                    x: (a.x + b.x) * 0.5,
                    y: (a.y + b.y) * 0.5,
                };
                let l = (a.x - b.x).hypot(a.y - b.y);
                if nearest(p, streets, 4).is_some_and(|(d, _)| d < 0.3) {
                    Some((l, a, b))
                } else {
                    None
                }
            })
            .collect();
        edges.sort_by(|a, b| b.0.total_cmp(&a.0));
        let Some((l, a, b)) = edges.first().copied() else {
            continue;
        };
        if l < 25.0 {
            continue;
        }
        let t = rng.range(0.35, 0.65);
        let s = Point {
            x: a.x + (b.x - a.x) * t,
            y: a.y + (b.y - a.y) * t,
        };
        let n = Point {
            x: -(b.y - a.y) / l,
            y: (b.x - a.x) / l,
        };
        let far = Point {
            x: s.x + n.x * 10000.0,
            y: s.y + n.y * 10000.0,
        };
        let hit = pc
            .shape
            .outer
            .iter()
            .zip(pc.shape.outer.iter().cycle().skip(1))
            .take(pc.shape.outer.len())
            .filter_map(|(&a, &b)| g::segment_hit(s, far, a, b))
            .min_by(|a, b| a.0.total_cmp(&b.0));
        let Some((_, h)) = hit else { continue };
        let dist = (h.x - s.x).hypot(h.y - s.y);
        let length = (dist * m.number("slitDepth")).min(dist - 16.0).min(70.0);
        if length < 18.0 {
            continue;
        }
        let end = Point {
            x: s.x + n.x * length,
            y: s.y + n.y * length,
        };
        let start = Point {
            x: s.x - n.x * 2.0,
            y: s.y - n.y * 2.0,
        };
        add(streets, vec![start, end], 4, "close", m, rng);
    }
}

/// Shadow-distance access tree; hutong is cardinal, roji follows the local frontage.
fn tree_closes(pieces: &[Piece], streets: &mut Vec<Street>, m: &Morph, rng: &mut Rng) {
    let op = m.text("closeOp");
    let orthogonal = op == "hutong" || op == "roji";
    let depth = m.number("accessDepth").max(4.0);
    let width = m.value["widthByRank"][4].as_f64().unwrap_or(3.0) * m.number("widthScale");
    for pc in pieces.iter().filter(|p| p.kind == "block") {
        let ring = &pc.shape.outer;
        let boundary_distance = |p| {
            ring.iter()
                .zip(ring.iter().cycle().skip(1))
                .take(ring.len())
                .map(|(&a, &b)| g::distance(p, a, b).0)
                .fold(f64::INFINITY, f64::min)
        };
        let mut access = vec![];
        for (&a, &b) in ring
            .iter()
            .zip(ring.iter().cycle().skip(1))
            .take(ring.len())
        {
            let l = (b.x - a.x).hypot(b.y - a.y);
            if l < 4.0 {
                continue;
            }
            let mid = Point {
                x: (a.x + b.x) * 0.5,
                y: (a.y + b.y) * 0.5,
            };
            if nearest(mid, streets, 3).is_none_or(|(d, _)| d > 0.3) {
                continue;
            }
            let margin = if orthogonal { width * 0.5 + 7.5 } else { 0.0 };
            if l <= 2.0 * margin {
                continue;
            }
            let dir = Point {
                x: (b.x - a.x) / l,
                y: (b.y - a.y) / l,
            };
            access.push((
                Point {
                    x: a.x + dir.x * margin,
                    y: a.y + dir.y * margin,
                },
                Point {
                    x: b.x - dir.x * margin,
                    y: b.y - dir.y * margin,
                },
                Point {
                    x: -dir.y,
                    y: dir.x,
                },
            ));
        }
        if access.is_empty() {
            continue;
        }
        let axis = if op == "roji" {
            let &(a, b, _) = access
                .iter()
                .max_by(|a, b| {
                    (a.1.x - a.0.x)
                        .hypot(a.1.y - a.0.y)
                        .total_cmp(&(b.1.x - b.0.x).hypot(b.1.y - b.0.y))
                })
                .unwrap();
            let l = (b.x - a.x).hypot(b.y - a.y);
            Point {
                x: (b.x - a.x) / l,
                y: (b.y - a.y) / l,
            }
        } else {
            Point { x: 1.0, y: 0.0 }
        };
        let across = Point {
            x: -axis.y,
            y: axis.x,
        };
        let (x0, y0, x1, y1) = g::bbox(&pc.shape);
        let mut samples = vec![];
        // Four metre samples as in the source; cap only the lattice resolution on oversized wards.
        let step = 4.0_f64.max(((x1 - x0) * (y1 - y0) / 100_000.0).sqrt());
        let mut y = y0 + 2.0;
        while y < y1 {
            let mut x = x0 + 2.0;
            while x < x1 {
                let p = Point { x, y };
                if g::contains(&pc.shape, p) && boundary_distance(p) > 2.0 {
                    let d = access
                        .iter()
                        .map(|&(a, b, _)| g::distance(p, a, b).0)
                        .fold(f64::INFINITY, f64::min);
                    samples.push((p, d));
                }
                x += step;
            }
            y += step;
        }
        let mut slits: Vec<Vec<Point>> = vec![];
        let budget = if op == "roji" {
            ((samples.len() as f64 * step * step / (depth * depth)).ceil() as usize).clamp(60, 160)
        } else {
            60
        };
        for _ in 0..budget {
            let Some((bi, &(target, _))) = samples
                .iter()
                .enumerate()
                .filter(|(_, s)| s.1 > depth)
                .max_by(|a, b| a.1.1.total_cmp(&b.1.1))
            else {
                break;
            };
            let mut roots: Vec<_> = access
                .iter()
                .map(|&(a, b, n)| {
                    let (d, _, q) = g::distance(target, a, b);
                    (d, q, Some(n), None)
                })
                .collect();
            for (si, path) in slits.iter().enumerate() {
                for q in path.windows(2) {
                    let (d, _, p) = g::distance(target, q[0], q[1]);
                    roots.push((d + 3.0, p, None, Some(si)));
                }
            }
            roots.sort_by(|a, b| a.0.total_cmp(&b.0));
            let mut selected = None;
            for (_, root, n, parent) in roots.into_iter().take(if op == "roji" { 12 } else { 1 }) {
                let l = (target.x - root.x).hypot(target.y - root.y);
                let stop = (l - 4.0).min(l - depth * 0.35).min(if op == "roji" {
                    2.0 * depth
                } else {
                    f64::INFINITY
                });
                if stop < 8.0 {
                    continue;
                }
                let dir = Point {
                    x: (target.x - root.x) / l,
                    y: (target.y - root.y) / l,
                };
                let end = Point {
                    x: root.x + dir.x * stop,
                    y: root.y + dir.y * stop,
                };
                let start = n
                    .map(|n| Point {
                        x: root.x - n.x * width * 0.5,
                        y: root.y - n.y * width * 0.5,
                    })
                    .unwrap_or(root);
                let mut alternatives = vec![];
                if orthogonal {
                    let entry = n
                        .map(|n| Point {
                            x: root.x + n.x * (width * 0.5 + 7.5),
                            y: root.y + n.y * (width * 0.5 + 7.5),
                        })
                        .unwrap_or(root);
                    for d in [axis, across] {
                        let amount = (end.x - entry.x) * d.x + (end.y - entry.y) * d.y;
                        let bend = Point {
                            x: entry.x + d.x * amount,
                            y: entry.y + d.y * amount,
                        };
                        alternatives.push(vec![start, root, entry, bend, end]);
                        if op == "roji" && amount.abs() > 8.0 {
                            alternatives.push(vec![start, root, entry, bend]);
                        }
                    }
                } else if stop > 22.0 && rng.chance(0.55) {
                    let off = rng.range(-0.22, 0.22) * stop;
                    alternatives.push(vec![
                        start,
                        Point {
                            x: (root.x + end.x) * 0.5 - dir.y * off,
                            y: (root.y + end.y) * 0.5 + dir.x * off,
                        },
                        end,
                    ]);
                } else {
                    alternatives.push(vec![start, end]);
                }
                for mut path in alternatives {
                    path.dedup_by(|a, b| (a.x - b.x).hypot(a.y - b.y) < 0.05);
                    let valid = path.windows(2).all(|q| {
                        let l = (q[1].x - q[0].x).hypot(q[1].y - q[0].y);
                        let k = (l / 2.0).ceil().max(1.0) as usize;
                        (0..=k).all(|i| {
                            let t = i as f64 / k as f64;
                            let p = Point {
                                x: q[0].x + (q[1].x - q[0].x) * t,
                                y: q[0].y + (q[1].y - q[0].y) * t,
                            };
                            let along = (p.x - start.x).hypot(p.y - start.y);
                            if along
                                < if n.is_some() {
                                    width + 8.0
                                } else {
                                    width + 6.0
                                }
                            {
                                return true;
                            }
                            g::contains(&pc.shape, p)
                                && boundary_distance(p) >= width * 0.5 + 6.5
                                && slits.iter().enumerate().all(|(si, s)| {
                                    if Some(si) == parent && along <= 10.0 {
                                        return true;
                                    }
                                    s.windows(2).all(|q| {
                                        g::distance(p, q[0], q[1]).0
                                            >= if Some(si) == parent {
                                                width + 6.0
                                            } else {
                                                width + 12.0
                                            }
                                    })
                                })
                        })
                    });
                    if valid {
                        selected = Some(path);
                        break;
                    }
                }
                if selected.is_some() {
                    break;
                }
            }
            if let Some(path) = selected {
                for (p, d) in &mut samples {
                    for q in path.windows(2) {
                        *d = d.min(g::distance(*p, q[0], q[1]).0);
                    }
                }
                add(streets, path.clone(), 4, "close", m, rng);
                slits.push(path);
            } else {
                for (p, d) in &mut samples {
                    if (p.x - target.x).hypot(p.y - target.y) < 9.0 {
                        *d = 0.0
                    }
                }
                samples[bi].1 = 0.0;
            }
        }
    }
}

/// Clip centreline intervals at exact cell/map and urban-boundary crossings.
fn clip_street(st: &Street, surface: Surface<'_>, quarters: Option<&[Quarter]>) -> Vec<Street> {
    let mut out = vec![];
    let mut path: Vec<Point> = vec![];
    let mut widths = vec![];
    let cell = surface.width / surface.n as f64;
    for (i, q) in st.path.windows(2).enumerate() {
        let a = q[0];
        let b = q[1];
        let dx = b.x - a.x;
        let dy = b.y - a.y;
        let mut ts = vec![0.0, 1.0];
        for (a, b, delta) in [(a.x, b.x, dx), (a.y, b.y, dy)] {
            if delta.abs() < 1e-9 {
                continue;
            }
            let lo = (a.min(b) / cell).floor().max(0.0) as usize;
            let hi = ((a.max(b) / cell).ceil() as usize).min(surface.n);
            for k in lo..=hi {
                let t = (k as f64 * cell - a) / delta;
                if t > 0.0 && t < 1.0 {
                    ts.push(t)
                }
            }
        }
        if let Some(quarters) = quarters {
            for quarter in quarters {
                let ring = &quarter.shape.outer;
                for (&c, &d) in ring
                    .iter()
                    .zip(ring.iter().cycle().skip(1))
                    .take(ring.len())
                {
                    if let Some((t, _)) = g::segment_hit(a, b, c, d) {
                        ts.push(t)
                    }
                }
            }
        }
        ts.sort_by(f64::total_cmp);
        ts.dedup_by(|a, b| (*a - *b).abs() < 1e-9);
        for pair in ts.windows(2) {
            let mid = (pair[0] + pair[1]) * 0.5;
            let p = Point {
                x: a.x + dx * mid,
                y: a.y + dy * mid,
            };
            let keep = !surface.wet(p)
                && quarters.is_none_or(|qs| qs.iter().any(|q| g::contains(&q.shape, p)));
            if keep {
                let start = Point {
                    x: a.x + dx * pair[0],
                    y: a.y + dy * pair[0],
                };
                let end = Point {
                    x: a.x + dx * pair[1],
                    y: a.y + dy * pair[1],
                };
                let wa = st.widths.get(i).copied().unwrap_or(4.0);
                let wb = st.widths.get(i + 1).copied().unwrap_or(wa);
                if path
                    .last()
                    .is_some_and(|p| (p.x - start.x).hypot(p.y - start.y) > 1e-6)
                {
                    out.push(Street {
                        path: std::mem::take(&mut path),
                        widths: std::mem::take(&mut widths),
                        rank: st.rank,
                        role: st.role.clone(),
                    });
                }
                if path.is_empty() {
                    path.push(start);
                    widths.push(wa + (wb - wa) * pair[0]);
                }
                path.push(end);
                widths.push(wa + (wb - wa) * pair[1]);
            } else if path.len() > 1 {
                out.push(Street {
                    path: std::mem::take(&mut path),
                    widths: std::mem::take(&mut widths),
                    rank: st.rank,
                    role: st.role.clone(),
                });
            }
        }
    }
    if path.len() > 1 {
        out.push(Street {
            path,
            widths,
            rank: st.rank,
            role: st.role.clone(),
        });
    }
    out
}

pub(super) fn generate(
    seed: &str,
    site: &Site,
    cfg: &LayoutConfig,
    m: &Morph,
    surface: Surface<'_>,
    roads: &[Street],
) -> Result<Layout, String> {
    let rng = Rng::new(seed).fork(&format!("urban-layout:{}", site.key));
    let mut prim = rng.fork("primary");
    let center = site.center;
    let radius = if cfg.radius > 0.0 {
        cfg.radius
    } else {
        site.radius * cfg.radius_scale
    };
    let count = cfg.count.clamp(3, 64);
    let rings = cfg.rings.clamp(1, 2);
    let road_angle = nearest(center, roads, 4)
        .map(|(_, a)| a)
        .unwrap_or_else(|| prim.range(0.0, TAU));
    let angle = if m.text("orientation") == "cardinal" {
        0.0
    } else {
        road_angle
    };
    let mut streets = vec![];
    let mut raw = vec![];
    if cfg.placement != "center" {
        let cols = count.div_ceil(2);
        let allcols = cols * rings;
        let x0 = center.x + radius * 0.14;
        let y0 = center.y - radius * 0.7;
        let width = radius * 1.4 * rings as f64;
        let height = radius * 1.4;
        let jitter_x = 8.0_f64.min(0.2 * width / allcols as f64);
        let jitter_y = 10.0_f64.min(0.2 * height / 2.0);
        let nodes: Vec<Vec<_>> = (0..3)
            .map(|r| {
                (0..=allcols)
                    .map(|c| {
                        let mut p = Point {
                            x: x0
                                + width * c as f64 / allcols as f64
                                + if c > 0 && c < allcols {
                                    prim.range(-jitter_x, jitter_x)
                                } else {
                                    0.0
                                },
                            y: y0
                                + height * r as f64 / 2.0
                                + if r == 1 {
                                    prim.range(-jitter_y, jitter_y)
                                } else {
                                    0.0
                                },
                        };
                        if cfg.placement == "skew" {
                            let u = (p.x - x0) / width;
                            let v = (p.y - y0) / height;
                            p.x += radius * (0.55 * v + 0.12 * u * v);
                            p.y += radius * 0.3 * u
                        }
                        p
                    })
                    .collect()
            })
            .collect();
        let horizontal: Vec<Vec<Vec<Point>>> = nodes
            .iter()
            .enumerate()
            .map(|(r, row)| {
                row.windows(2)
                    .enumerate()
                    .map(|(c, q)| {
                        if cfg.placement == "notched" && r == 0 && c % cols == cols / 2 {
                            vec![
                                q[0],
                                Point {
                                    x: (q[0].x + q[1].x) * 0.5,
                                    y: (q[0].y + q[1].y) * 0.5 + height * 0.3,
                                },
                                q[1],
                            ]
                        } else {
                            q.to_vec()
                        }
                    })
                    .collect()
            })
            .collect();
        for row in &horizontal {
            for p in row {
                add(&mut streets, p.clone(), 1, "street", m, &mut prim)
            }
        }
        for r in 0..2 {
            for (c, &p) in nodes[r].iter().enumerate() {
                add(
                    &mut streets,
                    vec![p, nodes[r + 1][c]],
                    if c == 0 { 0 } else { 1 },
                    "street",
                    m,
                    &mut prim,
                )
            }
        }
        for band in 0..rings {
            for local in 0..count {
                let row = local / cols;
                let col = band * cols + local % cols;
                let end = (col
                    + if count % 2 == 1 && local == count - 1 {
                        2
                    } else {
                        1
                    })
                .min(allcols);
                let mut pts = vec![];
                for p in &horizontal[row][col..end] {
                    pts.extend(p.iter().skip(usize::from(!pts.is_empty())).copied())
                }
                let mut bottom = vec![];
                for p in &horizontal[row + 1][col..end] {
                    bottom.extend(p.iter().skip(usize::from(!bottom.is_empty())).copied())
                }
                bottom.reverse();
                pts.extend(bottom);
                raw.push(Quarter {
                    shape: g::normalized(Shape {
                        outer: pts,
                        holes: vec![],
                    }),
                    phase: band,
                })
            }
        }
    } else {
        let jitter_angle = 0.12_f64.min(0.2 * TAU / count as f64);
        let angles: Vec<_> = (0..count)
            .map(|i| {
                angle + i as f64 * TAU / count as f64 + prim.range(-jitter_angle, jitter_angle)
            })
            .collect();
        let inner_r = (if cfg.zone == "core" {
            25.0_f64
        } else {
            16.0_f64
        })
        .min(radius * 0.2);
        let inner: Vec<_> = angles
            .iter()
            .map(|&a| Point {
                x: center.x + a.cos() * inner_r,
                y: center.y + a.sin() * inner_r,
            })
            .collect();
        let mut previous = inner;
        for band in 0..rings {
            let rr = radius + if band == 0 { 0.0 } else { 100.0 };
            let outer: Vec<_> = angles
                .iter()
                .map(|&a| {
                    let r = rr * prim.range(0.85, 1.15);
                    Point {
                        x: center.x + a.cos() * r,
                        y: center.y + a.sin() * r,
                    }
                })
                .collect();
            for i in 0..count {
                let j = (i + 1) % count;
                add(
                    &mut streets,
                    vec![previous[i], outer[i]],
                    0,
                    "radial",
                    m,
                    &mut prim,
                );
                add(
                    &mut streets,
                    vec![previous[i], previous[j]],
                    1,
                    "ring",
                    m,
                    &mut prim,
                );
                raw.push(Quarter {
                    shape: g::normalized(Shape {
                        outer: vec![previous[i], outer[i], outer[j], previous[j]],
                        holes: vec![],
                    }),
                    phase: band,
                })
            }
            previous = outer
        }
    }
    let quarters: Vec<_> = raw
        .into_iter()
        .flat_map(|q| {
            g::dry_clip(&surface, &q.shape)
                .into_iter()
                .filter(|p| g::area(p) > 1.0)
                .map(move |shape| Quarter {
                    shape,
                    phase: q.phase,
                })
        })
        .collect();
    if quarters.is_empty() {
        return Ok(Layout {
            key: site.key.clone(),
            culture: if cfg.culture == "site" {
                site.culture.clone()
            } else {
                cfg.culture.clone()
            },
            center,
            quarters,
            streets: vec![],
            blocks: vec![],
            warnings: vec![
                "Aucun quartier constructible à cet emplacement et avec ce rayon.".into(),
            ],
        });
    }
    streets = streets
        .iter()
        .flat_map(|s| clip_street(s, surface, None))
        .collect();
    // Regional roads become native frontage only where they intersect the settlement's extent.
    for st in roads {
        streets.extend(clip_street(st, surface, Some(&quarters)));
    }
    let gradients = |p: Point| {
        let r = 70.0;
        (
            (surface.height_at(Point { x: p.x + r, y: p.y })
                - surface.height_at(Point { x: p.x - r, y: p.y }))
                / (2.0 * r),
            (surface.height_at(Point { x: p.x, y: p.y + r })
                - surface.height_at(Point { x: p.x, y: p.y - r }))
                / (2.0 * r),
        )
    };
    let (gx, gy) = gradients(center);
    let terrain = if gx.hypot(gy) > 1e-6 {
        gy.atan2(gx) + FRAC_PI_2
    } else {
        angle
    };
    let water = (0..32)
        .filter_map(|i| {
            let a = i as f64 * TAU / 32.0;
            let p = Point {
                x: center.x + a.cos() * radius,
                y: center.y + a.sin() * radius,
            };
            surface.wet(p).then_some(a + FRAC_PI_2)
        })
        .next()
        .unwrap_or(angle);
    let field = Field {
        p: m,
        center,
        angle,
        terrain,
        water,
        surface,
        noise: Noise::new(rng.fork("field")),
    };
    let mut pieces = vec![];
    for (i, q) in quarters.iter().enumerate() {
        let mut qr = rng.fork(&format!("quarter:{i}"));
        let pcs = split_quarter(q, &field, cfg, &mut streets, &mut qr);
        pieces.push(pcs)
    }
    let mut cr = rng.fork("closes");
    closes(
        &pieces.iter().flatten().cloned().collect::<Vec<_>>(),
        &mut streets,
        &field,
        cfg,
        &mut cr,
    );
    let ribbons: Vec<_> = streets
        .iter()
        .flat_map(|s| g::ribbon(&s.path, &s.widths))
        .map(|p| {
            let bb = g::bbox(&p);
            (p, bb)
        })
        .collect();
    let mut blocks = vec![];
    for (qi, pcs) in pieces.into_iter().enumerate() {
        for pc in pcs {
            let bb = g::bbox(&pc.shape);
            let mut polys = vec![pc.shape];
            for (r, rb) in &ribbons {
                if bb.0 > rb.2 || bb.2 < rb.0 || bb.1 > rb.3 || bb.3 < rb.1 {
                    continue;
                }
                polys = polys
                    .into_iter()
                    .flat_map(|p| g::difference(&p, r))
                    .collect();
                if polys.is_empty() {
                    break;
                }
            }
            for shape in polys.into_iter().filter(|p| g::area(p) > 1.0) {
                let f = frame(&shape);
                blocks.push(Block {
                    shape,
                    quarter: qi,
                    kind: pc.kind.clone(),
                    axis: f.u,
                })
            }
        }
    }
    if cfg.monument != "none"
        && let Some(b) = blocks
            .iter_mut()
            .filter(|b| b.kind == "block")
            .max_by(|a, b| g::area(&a.shape).total_cmp(&g::area(&b.shape)))
    {
        b.kind = format!("compound:{}", cfg.monument)
    }
    Ok(Layout {
        key: site.key.clone(),
        culture: if cfg.culture == "site" {
            site.culture.clone()
        } else {
            cfg.culture.clone()
        },
        center,
        quarters,
        streets,
        blocks,
        warnings: vec![],
    })
}

#[cfg(test)]
mod tests {
    use super::*;
    #[test]
    fn small_settlement_keeps_disjoint_quarters_and_dry_paths() {
        let heights = vec![0.0; 64 * 64];
        let mut water = vec![0; 64 * 64];
        for y in 0..64 {
            water[y * 64 + 32] = 1;
        }
        let surface = Surface {
            width: 512.0,
            n: 64,
            height: &heights,
            water: &water,
        };
        let site = Site {
            key: "small".into(),
            name: "Small".into(),
            population: 80,
            culture: "european".into(),
            center: Point { x: 240.0, y: 256.0 },
            radius: 24.0,
        };
        let cfg = LayoutConfig {
            preset: "morph/european-organic".into(),
            ..LayoutConfig::default()
        };
        let m = super::super::resolve(
            &site.culture,
            &cfg.preset,
            &cfg.recipe,
            &cfg.zone,
            cfg.density,
            &cfg.params,
            "quarters",
        )
        .unwrap();
        let a = generate("small-radius-regression", &site, &cfg, &m, surface, &[]).unwrap();
        let b = generate("small-radius-regression", &site, &cfg, &m, surface, &[]).unwrap();
        assert_eq!(
            serde_json::to_string(&a).unwrap(),
            serde_json::to_string(&b).unwrap()
        );
        assert!(!a.quarters.is_empty());
        for (i, q) in a.quarters.iter().enumerate() {
            for r in a.quarters.iter().skip(i + 1) {
                assert!(g::intersection(&q.shape, &r.shape).is_empty());
            }
        }
        for s in &a.streets {
            for p in s.path.windows(2) {
                assert!(!surface.wet(Point {
                    x: (p[0].x + p[1].x) * 0.5,
                    y: (p[0].y + p[1].y) * 0.5
                }));
            }
        }
        let tiny_cfg = LayoutConfig {
            placement: "rectangle".into(),
            count: 8,
            radius_scale: 0.1,
            ..cfg.clone()
        };
        let tiny_site = Site {
            radius: 80.0,
            ..site.clone()
        };
        let tiny = generate(
            "tiny-rectangle-regression",
            &tiny_site,
            &tiny_cfg,
            &m,
            surface,
            &[],
        )
        .unwrap();
        assert_eq!(tiny.quarters.len(), 8);
        for (i, q) in tiny.quarters.iter().enumerate() {
            for r in tiny.quarters.iter().skip(i + 1) {
                assert!(g::intersection(&q.shape, &r.shape).is_empty());
            }
        }
        let dense_cfg = LayoutConfig {
            count: 64,
            radius: 240.0,
            ..cfg
        };
        let dry_surface = Surface {
            water: &vec![0; 64 * 64],
            ..surface
        };
        let dense = generate(
            "dense-ring-regression",
            &site,
            &dense_cfg,
            &m,
            dry_surface,
            &[],
        )
        .unwrap();
        assert_eq!(dense.quarters.len(), 64);
        for (i, q) in dense.quarters.iter().enumerate() {
            let r = &dense.quarters[(i + 1) % dense.quarters.len()];
            assert!(g::intersection(&q.shape, &r.shape).is_empty());
        }
    }
}
