//! Recursive quarter subdivision, lattice cuts and candidate validation.

use super::field::{Field, TraceIndex, TraceParams};
use super::frames::frame;
use super::streets::{add, len};
use super::tissue::{smooth, zone_at};
use crate::rng::Rng;
use crate::urban::{LayoutConfig, Morph, Point, Quarter, Shape, Street, geometry as g, routing, zone_blend};
use std::f64::consts::{FRAC_PI_2, PI};

#[derive(Clone)]
pub(super) struct Piece {
    pub(super) shape: Shape,
    pub(super) level: usize,
    pub(super) kind: String,
}
type Candidate = (f64, Shape, Shape, Vec<Point>, usize, bool, bool);

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

/// The lattice spacing of a grid place: the culture's, halved (twice at most)
/// while it exceeds three fifths of the place's radius. A small place of a
/// superblock culture would otherwise hold only the centre lines, which the
/// roads crossing there already are, and no block would front a street.
fn place_spacing(spacing: f64, radius: f64) -> f64 {
    let mut sp = spacing;
    for _ in 0..2 {
        // Under 250 m a lattice is no superblock: existing cultures keep theirs.
        if radius <= 0.0 || sp <= 0.6 * radius || sp < 250.0 {
            break;
        }
        sp *= 0.5;
    }
    sp
}

/// Whether a line of the planned grid lattice (wards first, then lanes)
/// crosses `shape` with at least `minWidth` of land on each side.
fn lattice_lines(shape: &Shape, field: &Field<'_>, m: &Morph, params: &TraceParams) -> bool {
    let angle = field.angle(g::interior_point(shape), params);
    let lanes = m.pair("laneSpacing");
    let coarse = m.pair("gridSpacing");
    let ward = g::area(shape) >= m.number("wardArea") || (lanes[0] <= 0.0 && lanes[1] <= 0.0);
    let spacing = if ward { coarse } else { lanes };
    let margin = m.number("minWidth");
    (0..2).any(|fi| {
        let heading = angle + fi as f64 * FRAC_PI_2;
        let n = Point {
            x: -heading.sin(),
            y: heading.cos(),
        };
        let sp = place_spacing(
            spacing[if (heading - field.frame.unwrap_or(field.angle)).cos().abs() > 0.7 {
                0
            } else {
                1
            }],
            field.radius,
        );
        if sp <= 0.0 {
            return false;
        }
        let project = |p: Point| (p.x - field.center.x) * n.x + (p.y - field.center.y) * n.y;
        let (lo, hi) = shape
            .outer
            .iter()
            .map(|&p| project(p))
            .fold((f64::INFINITY, f64::NEG_INFINITY), |(a, b), v| {
                (a.min(v), b.max(v))
            });
        let k = ((lo + margin) / sp).ceil();
        k * sp < hi - margin
    })
}

/// One recursive cut through `seed` along `heading`: traced within the street
/// grades, snapped onto the piece's junctions, connected to the network, and
/// both children admissible. Returns its cost (balance, grade, slenderness).
#[allow(clippy::too_many_arguments)]
fn cut_candidate(
    pc: &Piece,
    index: &std::cell::OnceCell<TraceIndex>,
    field: &Field<'_>,
    params: &TraceParams,
    cfg: &LayoutConfig,
    streets: &[Street],
    m: &Morph,
    seed: Point,
    heading: f64,
    rank: usize,
    places: usize,
    a0: f64,
    rng: &mut Rng,
) -> Option<Candidate> {
    if !g::contains(&pc.shape, seed) {
        return None;
    }
    let grade = if rank < 3 {
        cfg.max_street_grade
    } else {
        cfg.max_lane_grade
    };
    let index = index.get_or_init(|| TraceIndex::new(&pc.shape));
    let trace = |limit| {
        Some((
            field.trace(&pc.shape, index, params, seed, heading + PI, limit)?,
            field.trace(&pc.shape, index, params, seed, heading, limit)?,
        ))
    };
    let Some((mut back, front)) =
        trace(grade)
            .or_else(|| trace(cfg.max_lane_grade))
            .or_else(|| {
                if cfg.allow_stairs {
                    trace(cfg.max_stair_grade)
                } else {
                    None
                }
            })
    else {
        return None;
    };
    back.reverse();
    back.extend(front.into_iter().skip(1));
    // The 5 m integration steps carry no shape below half a metre.
    // Fewer vertices make every later split, ribbon and boolean cheaper.
    let simple = g::simplify(&back, 0.5, |_| false);
    if simple.len() < back.len() && routing::path_clear(field.surface, &simple, cfg.max_stair_grade)
    {
        back = simple;
    }
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
    let allowed = if cfg.allow_stairs {
        cfg.max_stair_grade
    } else {
        cfg.max_lane_grade
    };
    let snapped_split = if routing::path_clear(field.surface, &snapped, allowed) {
        g::split(&pc.shape, &snapped)
    } else {
        None
    };
    if snapped_split.is_some() {
        back = snapped;
    }
    // Every recursive street must connect to the existing primary or recursive network.
    let connected = [back[0], *back.last().unwrap()].iter().any(|&p| {
        field
            .street_distance(p, streets, 4, 0.2)
            .is_some_and(|d| d < 0.2)
    }) || field.crosses_street(&back, streets);
    if !connected {
        return None;
    }
    // The snap validation already computed these exact children.
    let Some((a, b)) = snapped_split.or_else(|| g::split(&pc.shape, &back)) else {
        return None;
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
        return None;
    }
    let fa = frame(&a);
    let fb = frame(&b);
    if fa.hv * 2.0 < if pa { 6.0 } else { m.number("minWidth") }
        || fb.hv * 2.0 < if pb { 6.0 } else { m.number("minWidth") }
    {
        return None;
    }
    let steepest = back
        .windows(2)
        .map(|p| routing::segment_grade(field.surface, p[0], p[1]))
        .fold(0.0, f64::max);
    let cost = (aa - ab).abs() / a0
        + if steepest > cfg.max_lane_grade {
            0.8
        } else if steepest > grade {
            0.2
        } else {
            0.0
        }
        + 0.25
            * ((fa.hu / fa.hv.max(1.0) - 2.5).max(0.0) + (fb.hu / fb.hv.max(1.0) - 2.5).max(0.0))
        + rng.float() * 0.08;
    Some((cost, a, b, back, rank, pa, pb))
}
/// Straight cut of a large piece through holes: from a street contact (or the
/// middle) across to the outer edge on both sides. The land splits along a
/// hairline; the street is the chord without its stretches over holes, each
/// stretch kept within the stair grade. Both sides must stay real blocks and
/// the chord must reach the network.
fn straight_cut(
    pc: &Piece,
    field: &Field<'_>,
    cfg: &LayoutConfig,
    streets: &[Street],
    m: &Morph,
    half_width: f64,
) -> Option<(Vec<Shape>, Vec<Vec<Point>>)> {
    let ring = &pc.shape.outer;
    let a0 = g::area(&pc.shape);
    let f = frame(&pc.shape);
    let mut seeds = street_anchors(&pc.shape, field, streets, half_width);
    for t in [0.0, -0.3, 0.3] {
        let c = Point {
            x: f.c.x + f.u.x * f.hu * t,
            y: f.c.y + f.u.y * f.hu * t,
        };
        if g::contains(&pc.shape, c) {
            for heading in [f.u.y.atan2(f.u.x) + FRAC_PI_2, f.u.y.atan2(f.u.x)] {
                seeds.push((c, heading));
            }
        }
    }
    let reach = 2.0 * (f.hu + f.hv) + 10.0;
    let mut best: Option<(f64, Vec<Shape>, Vec<Vec<Point>>)> = None;
    for (seed, heading) in seeds {
        let d = Point {
            x: heading.cos(),
            y: heading.sin(),
        };
        // Nearest outer-ring crossing on each side of the seed.
        let end = |sign: f64| {
            let far = Point {
                x: seed.x + d.x * sign * reach,
                y: seed.y + d.y * sign * reach,
            };
            ring.iter()
                .zip(ring.iter().cycle().skip(1))
                .take(ring.len())
                .enumerate()
                .filter_map(|(k, (&a, &b))| g::segment_hit(seed, far, a, b).map(|h| (h, k)))
                .min_by(|a, b| a.0.0.total_cmp(&b.0.0))
                .map(|(h, k)| (h.1, k))
        };
        let (Some((a, ia)), Some((b, ib))) = (end(-1.0), end(1.0)) else {
            continue;
        };
        if ia == ib {
            continue;
        }
        let chord = vec![a, b];
        if (b.x - a.x).hypot(b.y - a.y) < 2.0 * m.number("minWidth").max(10.0) {
            continue;
        }
        let connected = chord.iter().any(|&p| {
            field
                .street_distance(p, streets, 4, 0.5)
                .is_some_and(|d| d < 0.5)
        }) || field.crosses_street(&chord, streets);
        if !connected {
            continue;
        }
        // Exact split along the chord (both ends lie on the outer ring); the
        // holes it crosses stay holes on either side.
        let length = (b.x - a.x).hypot(b.y - a.y);
        let mut parts = chord_split(&pc.shape, a, ia, b, ib);
        parts.sort_by(|p, q| g::area(q).total_cmp(&g::area(p)));
        if !(2..=4).contains(&parts.len())
            || parts[..2].iter().any(|p| g::area(p) < m.number("minBlock"))
            || (parts.iter().map(g::area).sum::<f64>() - a0).abs() > a0 * 1e-3
        {
            continue;
        }
        // The street: the chord's stretches over land, sampled every 2 m.
        let steps = (length / 2.0).ceil().max(2.0) as usize;
        let at = |k: usize| Point {
            x: a.x + (b.x - a.x) * k as f64 / steps as f64,
            y: a.y + (b.y - a.y) * k as f64 / steps as f64,
        };
        let mut paths = vec![];
        let mut run: Vec<Point> = vec![];
        for k in 0..=steps {
            let p = at(k);
            let inside = k == 0 || k == steps || g::contains(&pc.shape, p);
            if inside {
                run.push(p);
            }
            if !inside || k == steps {
                if run.len() >= 2 {
                    let path = vec![run[0], *run.last().unwrap()];
                    let grade = if cfg.allow_stairs {
                        cfg.max_stair_grade
                    } else {
                        cfg.max_lane_grade
                    };
                    if routing::path_clear(field.surface, &path, grade) {
                        paths.push(path);
                    }
                }
                run.clear();
            }
        }
        if paths.is_empty() {
            continue;
        }
        let (pa, pb) = (g::area(&parts[0]), g::area(&parts[1]));
        let cost = (pa - pb).abs() / a0 + 0.2 * (parts.len() - 2) as f64;
        if best.as_ref().is_none_or(|b| cost < b.0) {
            best = Some((cost, parts, paths));
        }
    }
    best.map(|(_, parts, paths)| (parts, paths))
}
/// The two sides of a chord from `a` (on outer edge `ia`) to `b` (on edge
/// `ib`): each ring walk closed by the chord, intersected with the shape so
/// its holes stay holes. Every resulting piece is returned.
fn chord_split(shape: &Shape, a: Point, ia: usize, b: Point, ib: usize) -> Vec<Shape> {
    let ring = &shape.outer;
    let n = ring.len();
    let walk = |from: usize, to: usize, start: Point, end: Point| {
        let mut r = vec![start];
        let mut k = (from + 1) % n;
        for _ in 0..n {
            r.push(ring[k]);
            if k == to {
                break;
            }
            k = (k + 1) % n;
        }
        r.push(end);
        Shape {
            outer: r,
            holes: vec![],
        }
    };
    [walk(ia, ib, a, b), walk(ib, ia, b, a)]
        .iter()
        .flat_map(|side| g::intersection(shape, side))
        .filter(|p| g::area(p) > 1.0)
        .collect()
}
/// Seeds of cuts square to the piece's street contacts: for its longest edges
/// lying on a street, a point a short way inside, heading away from the street.
fn street_anchors(
    shape: &Shape,
    field: &Field<'_>,
    streets: &[Street],
    half_width: f64,
) -> Vec<(Point, f64)> {
    let ring = &shape.outer;
    let mut contacts: Vec<(f64, Point, Point)> = ring
        .iter()
        .zip(ring.iter().cycle().skip(1))
        .take(ring.len())
        .filter_map(|(&a, &b)| {
            let length = (b.x - a.x).hypot(b.y - a.y);
            if length < 12.0 {
                return None;
            }
            let mid = Point {
                x: (a.x + b.x) * 0.5,
                y: (a.y + b.y) * 0.5,
            };
            field
                .street_distance(mid, streets, 4, 0.5)
                .is_some_and(|d| d < 0.5)
                .then(|| {
                    let n = Point {
                        x: -(b.y - a.y) / length,
                        y: (b.x - a.x) / length,
                    };
                    (length, mid, n)
                })
        })
        .collect();
    contacts.sort_by(|a, b| b.0.total_cmp(&a.0));
    let depth = (half_width * 0.5).clamp(6.0, 30.0);
    contacts
        .into_iter()
        .take(8)
        .filter_map(|(_, mid, n)| {
            [1.0, -1.0].into_iter().find_map(|sign| {
                let seed = Point {
                    x: mid.x + n.x * sign * depth,
                    y: mid.y + n.y * sign * depth,
                };
                g::contains(shape, seed).then(|| (seed, (n.y * sign).atan2(n.x * sign)))
            })
        })
        .collect()
}
pub(super) fn split_quarter(
    q: &Quarter,
    field: &Field<'_>,
    cfg: &LayoutConfig,
    streets: &mut Vec<Street>,
    rng: &mut Rng,
) -> Vec<Piece> {
    let params = TraceParams::new(field);
    let mut queue = vec![Piece {
        shape: q.shape.clone(),
        level: 1,
        kind: "block".into(),
    }];
    let mut out = vec![];
    let mut places = 0;
    let mut guard = 0;
    // A safety bound on the cuts, scaled with the quarter's land (a quarter
    // the macro plan left whole holds thousands of blocks).
    let bound = 4000 + (g::area(&q.shape) / 400.0) as usize;
    while let Some(pc) = queue.pop() {
        guard += 1;
        if guard > bound {
            out.push(pc);
            out.extend(queue);
            break;
        }
        let a0 = g::area(&pc.shape);
        let f = frame(&pc.shape);
        let point = g::interior_point(&pc.shape);
        let m = field.morph_at(point);
        let zone = if let Some(phase) = field.phase_at(point) {
            field.phases[phase].zone.as_str()
        } else if cfg.zone == "auto" {
            zone_at(f.c, field.center, field.radius, field.population)
        } else {
            &q.zone
        };
        let mut bs = m.block_size(zone);
        // `zoneDensity: gradient`: near another phase the block size leans toward its own.
        if let (Some(blend), Some(own)) = (field.blend, field.phase_at(point))
            && field.phase_morphs.len() == field.phases.len()
            && let Some(b) = blend.at(point, own)
        {
            let other = &field.phases[b.phase].zone;
            bs = zone_blend::lerp2(bs, field.phase_morphs[b.phase].block_size(other), b.weight);
        }
        let target = bs[0].max(1.0)
            * (bs[1].max(bs[0].max(1.0)) / bs[0].max(1.0)).powf(rng.float())
            * (0.85
                + 0.15
                    * smooth(
                        (f.c.x - field.center.x).hypot(f.c.y - field.center.y),
                        50.0,
                        320.0,
                    ));
        // A planned grid subdivides by its lattice, not by a random block
        // target: a piece is cut while a lattice line still crosses it, so
        // neighbouring pieces receive the same lines and junctions stay 4-way.
        let lattice = (m.text("streetOp") == "grid")
            .then(|| lattice_lines(&pc.shape, field, m, &params));
        let small = match lattice {
            Some(lines) => !lines,
            None => {
                a0 < target && f.hu / f.hv.max(1.0) < if cfg.zone == "faubourg" { 7.0 } else { 2.6 }
            }
        };
        // A camp (catalogue `campLayout`) has no lanes: its quarter stays
        // whole, laid out by `parcels/camp.rs`.
        let camp = !m.text("campLayout").is_empty();
        if pc.kind != "block" || small || camp || a0 < 2.0 * m.number("minBlock") {
            out.push(pc);
            continue;
        }
        let angle = field.angle(f.c, &params);
        let index = std::cell::OnceCell::new();
        let mut best: Option<Candidate> = None;
        for fi in 0..2 {
            let heading = angle + fi as f64 * FRAC_PI_2;
            let d = Point {
                x: heading.cos(),
                y: heading.sin(),
            };
            let n = Point { x: -d.y, y: d.x };
            let mut seeds = vec![];
            // A cut through land worth many blocks is a street; the rest are lanes.
            let mut rank = if pc.level <= 1 || a0 > 4.0 * bs[1].max(bs[0]) {
                2
            } else {
                3
            };
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
                    let sp = place_spacing(
                        spacing[if (heading - field.frame.unwrap_or(grid_angle)).cos().abs() > 0.7 {
                            0
                        } else {
                            1
                        }],
                        field.radius,
                    );
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
                        // Lattice lines pass through the town centre (cardo and
                        // decumanus) at the culture's spacing.
                        let mut lines = vec![];
                        let mut k = (lo / sp).ceil();
                        while k * sp < hi && lines.len() < 512 {
                            lines.push(k * sp);
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
                if let Some(c) = cut_candidate(
                    &pc, &index, field, &params, cfg, streets, m, seed, heading, rank, places, a0, rng,
                ) && best.as_ref().is_none_or(|b| c.0 < b.0)
                {
                    best = Some(c);
                }
            }
        }
        // Invariant: a piece worth several blocks is subdivided while it has a
        // street. When no cut from its middle reaches the network (a quarter
        // touching streets on a short stretch, holes in the way), cuts are
        // anchored on its own street contacts, square to the street.
        if best.is_none() && a0 > 2.0 * target.max(m.number("minBlock")) {
            let rank = if pc.level <= 1 || a0 > 4.0 * bs[1].max(bs[0]) {
                2
            } else {
                3
            };
            for (seed, heading) in street_anchors(&pc.shape, field, streets, f.hv) {
                if let Some(c) = cut_candidate(
                    &pc, &index, field, &params, cfg, streets, m, seed, heading, rank, places, a0, rng,
                ) && best.as_ref().is_none_or(|b| c.0 < b.0)
                {
                    best = Some(c);
                }
            }
        }
        // A piece worth many blocks that no traced cut can split (water holes
        // in the way, a quarter left whole by the macro plan) is crossed by a
        // straight street from one of its street contacts to its far edge;
        // the street stops at the holes, the land on both sides is split.
        if best.is_none()
            && a0 > 4.0 * target.max(m.number("minBlock"))
            && let Some((parts, paths)) = straight_cut(&pc, field, cfg, streets, m, f.hv)
        {
            for path in paths {
                add(streets, path, 2, "street", m, rng);
            }
            for shape in parts {
                queue.push(Piece {
                    shape,
                    level: pc.level + 1,
                    kind: "block".into(),
                });
            }
            continue;
        }
        if let Some((_, a, b, path, mut rank, pa, pb)) = best {
            let lc = m.number_or("longCut", 0.0);
            if lc > 0.0
                && len(&path) >= lc
                && routing::path_clear(field.surface, &path, cfg.max_street_grade)
            {
                rank = rank.min(2)
            }
            let steepest = path
                .windows(2)
                .map(|p| routing::segment_grade(field.surface, p[0], p[1]))
                .fold(0.0, f64::max);
            if steepest > cfg.max_street_grade {
                rank = 3;
            }
            let role = if steepest > cfg.max_lane_grade {
                rank = 3;
                "stairs"
            } else if rank <= 2 {
                "street"
            } else {
                "lane"
            };
            add(streets, path, rank, role, m, rng);
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
