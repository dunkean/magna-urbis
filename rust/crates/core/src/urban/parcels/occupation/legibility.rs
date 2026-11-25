//! Building bodies that remain legible on irregular lots.

use super::*;

/// Polygonal body of an odd-shaped lot (« même dégénérées : en ville les formes
/// bizarres au sol sont courantes »): the street strip of `run`, `to` deep, of
/// the domain (the whole domain without a run), opened by `wing` so that no
/// part is thinner than a body. Built where no square body or legible range
/// fits, so an allocated lot always carries a house when a body fits at all.
pub(super) fn polygonal(
    b: &[Point],
    run: Option<&[Front]>,
    inward: Point,
    to: f64,
    wing: f64,
) -> Vec<Vec<Point>> {
    let domain = run
        .and_then(|r| street_strip(r, inward, to).ok())
        .map_or_else(|| vec![b.to_vec()], |strip| clip_inside(b, &strip));
    let mut out: Vec<Vec<Point>> = domain.iter().flat_map(|d| opened(d, wing)).collect();
    if out.is_empty() && run.is_some() {
        out = opened(b, wing);
    }
    out
}

/// A rear wing or back building against one party wall (« aile en retour
/// sur le mur mitoyen »): the part of the domain within `w` of its side wall
/// on the `left` (low `s`) or right, from level `t0` (the street range's back
/// wall, so the two meet at the lot's own angle) to `t1`, its far end square
/// to the wall. Its long sides follow the party wall the neighbour's wing
/// shares; `None` when no straight side wall bounds that band.
pub(super) fn side_wing(
    b: &[Point],
    f: &Frame,
    fronts: &[Front],
    left: bool,
    w: f64,
    t0: f64,
    t1: f64,
    wing: f64,
) -> Option<Vec<Point>> {
    if w < wing - 1e-9 || t1 - t0 < wing - 1e-9 {
        return None;
    }
    let band = largest(clip_parts(b, &[f.above(t0), f.below(t1)]));
    if band.len() < 3 {
        return None;
    }
    let (bs0, bs1, _, _) = f.range(&band);
    let mid = 0.5 * (bs0 + bs1);
    let n = band.len();
    let (a, c) = (0..n)
        .map(|i| (band[i], band[(i + 1) % n]))
        .filter(|&(a, c)| {
            let d = sub(c, a);
            let l = length(d);
            let m = scale(add(a, c), 0.5);
            l >= wing
                && dot(d, f.n).abs() / l > 0.8
                && (f.s(m) < mid) == left
                && !fronts.iter().any(|g| distance(m, g.a, g.b) < 0.3)
        })
        .max_by(|x, y| length(sub(x.1, x.0)).total_cmp(&length(sub(y.1, y.0))))?;
    let mut e = unit(sub(c, a));
    if dot(e, f.n) < 0.0 {
        e = scale(e, -1.0);
    }
    let mut m = normal(e);
    if (dot(m, f.u) > 0.0) != left {
        m = scale(m, -1.0);
    }
    // The wall's corner at the far level, then the end square to the wall.
    let far = add(a, scale(e, (t1 - f.t(a)) / dot(e, f.n)));
    let planes = [
        (m, dot(m, a) + w),
        (scale(m, -1.0), -(dot(m, a) - 0.05)),
        f.above(t0),
        (e, dot(e, far)),
    ];
    let r = dedup(largest(clip_parts(b, &planes)));
    (r.len() >= 3
        && simple(&r)
        && ring_area(&r).abs() >= wing * wing
        && thickness(&r, None) >= wing - 1e-6)
        .then_some(r)
}

/// Frame of the lot's own orientation (« l'orientation de la parcelle »):
/// depth along its side walls (their length-weighted mean direction), the
/// main street's frame where the lot has no side wall roughly along it.
pub(super) fn lot_frame(b: &[Point], main: &Frame, fronts: &[Front]) -> Frame {
    let n = b.len();
    let mut d = Point { x: 0.0, y: 0.0 };
    for i in 0..n {
        let (a, c) = (b[i], b[(i + 1) % n]);
        let e = sub(c, a);
        let l = length(e);
        let m = scale(add(a, c), 0.5);
        if l < 3.0
            || dot(e, main.n).abs() / l < 0.8
            || fronts.iter().any(|g| distance(m, g.a, g.b) < 0.3)
        {
            continue;
        }
        d = add(
            d,
            if dot(e, main.n) < 0.0 {
                scale(e, -1.0)
            } else {
                e
            },
        );
    }
    if length(d) < 1e-6 {
        return *main;
    }
    let nn = unit(d);
    let mut u = normal(nn);
    if dot(u, main.u) < 0.0 {
        u = scale(u, -1.0);
    }
    let t0 = b.iter().map(|&p| dot(nn, p)).fold(f64::INFINITY, f64::min);
    Frame { u, n: nn, t0 }
}

/// Largest frame rectangle `[s0, s1, t0, t1]` inside `ring`, over bands between
/// twelve levels of its depth (`fit` exact for each band).
pub(super) fn inscribed(ring: &[Point], f: &Frame) -> Option<[f64; 4]> {
    inscribed_by(ring, f, |w, d| w * d)
}
/// `inscribed` for the best `score` of a rectangle's width and depth.
pub(super) fn inscribed_by(ring: &[Point], f: &Frame, score: impl Fn(f64, f64) -> f64) -> Option<[f64; 4]> {
    let (s0, s1, t0, t1) = f.range(ring);
    let levels: Vec<f64> = (0..=11).map(|i| t0 + (t1 - t0) * i as f64 / 11.0).collect();
    let mut best: Option<([f64; 4], f64)> = None;
    for i in 0..levels.len() {
        for j in i + 1..levels.len() {
            let (a, b) = (levels[i], levels[j]);
            if let Some((l, r)) = fit_any(ring, f, a, b, 0.5 * (s0 + s1)) {
                let v = score(r - l, b - a);
                if best.is_none_or(|(_, x)| v > x) {
                    best = Some(([l, r, a, b], v));
                }
            }
        }
    }
    best.map(|(r, _)| r)
}

/// Every convex corner of the ring (edges of 0.8 m or more, sub-decimetre
/// cadastral jogs smoothed away) is at least 64.5 degrees: a wall leans at
/// most 25 degrees off square, as a street range's party walls (`front_range`).
pub(super) fn open_corners(ring: &[Point]) -> bool {
    open_corners_at(ring, &[])
}
/// `open_corners`, a corner between two street walls (on `streets`) keeping
/// the streets' angle down to 60 degrees.
pub(super) fn open_corners_at(ring: &[Point], streets: &[Front]) -> bool {
    let street = |p: Point, q: Point| {
        let m = scale(add(p, q), 0.5);
        streets.iter().any(|g| distance(m, g.a, g.b) < 0.3)
    };
    let mut r = smoothed(ring, 0.12);
    if ring_area(&r) < 0.0 {
        r.reverse();
    }
    let n = r.len();
    n >= 3
        && (0..n).all(|i| {
            let (a, v, c) = (r[(i + n - 1) % n], r[i], r[(i + 1) % n]);
            let (e, f) = (sub(v, a), sub(c, v));
            let (le, lf) = (length(e), length(f));
            let limit = if street(a, v) && street(v, c) {
                120.0
            } else {
                115.5
            };
            le < 0.8
                || lf < 0.8
                || e.x * f.y - e.y * f.x <= 0.0
                || dot(e, f) / (le * lf) >= f64::to_radians(limit).cos()
        })
}

/// A piece of the lot itself is a legible body (« bâti lisible »): simple, at
/// least `wing` thick, its corners open (`open_corners`). Its walls are then
/// the lot's own sides, so it fills the lot from wall to wall.
pub(super) fn legible(ring: &[Point], wing: f64) -> bool {
    ring.len() >= 3 && simple(ring) && open_corners(ring) && thickness(ring, None) >= wing - 1e-6
}

/// A frame whose `u` runs along `d`.
pub(super) fn frame_along(d: Point) -> Frame {
    let u = unit(d);
    Frame {
        u,
        n: normal(u),
        t0: 0.0,
    }
}

/// The largest rectangle inside `ring` square to one of `frames` or to one
/// of its own edges of at least `wing` (« une orientation qui donne un
/// rectangle praticable »), both sides at least `wing`.
pub(super) fn best_rectangle(ring: &[Point], frames: &[Frame], wing: f64) -> Option<Vec<Point>> {
    let n = ring.len();
    let own = (0..n)
        .map(|i| sub(ring[(i + 1) % n], ring[i]))
        .filter(|e| length(*e) >= wing)
        .map(frame_along);
    frames
        .iter()
        .copied()
        .chain(own)
        .filter_map(|f| {
            let r = inscribed(ring, &f)?;
            let (w, d) = (r[1] - r[0], r[3] - r[2]);
            (w >= wing - 1e-6 && d >= wing - 1e-6).then(|| {
                let at = |s: f64, t: f64| add(scale(f.u, s), scale(f.n, t));
                (
                    vec![
                        at(r[0], r[2]),
                        at(r[1], r[2]),
                        at(r[1], r[3]),
                        at(r[0], r[3]),
                    ],
                    w * d,
                )
            })
        })
        .max_by(|a, b| a.1.total_cmp(&b.1))
        .map(|(r, _)| r)
}

/// Four corners within 3 degrees of square.
pub(super) fn rectangular(ring: &[Point]) -> bool {
    let r = smoothed(&dedup(ring.to_vec()), 0.05);
    r.len() == 4
        && (0..4).all(|i| {
            let (a, v, c) = (r[(i + 3) % 4], r[i], r[(i + 1) % 4]);
            let (e, f) = (unit(sub(v, a)), unit(sub(c, v)));
            dot(e, f).abs() <= 3f64.to_radians().sin()
        })
}

/// A ring that reads as a deliberate building: it fills at least 0.72 of its
/// smallest bounding rectangle (over its own wall directions), has six
/// corners at most and is at most five times as long as wide.
pub(super) fn natural(ring: &[Point]) -> bool {
    let n = ring.len();
    let bound = (0..n)
        .map(|i| sub(ring[(i + 1) % n], ring[i]))
        .filter(|e| length(*e) > 1e-6)
        .map(|e| {
            let (s0, s1, t0, t1) = frame_along(e).range(ring);
            (s1 - s0, t1 - t0)
        })
        .min_by(|x, y| (x.0 * x.1).total_cmp(&(y.0 * y.1)));
    bound.is_some_and(|(w, d)| {
        ring_area(ring).abs() >= 0.72 * w * d && w.max(d) <= 5.0 * w.min(d)
    }) && corners(ring) <= 6
}

/// Guard against accidental shapes: an ordinary body (label `building`, no
/// court, convex) with more than six corners, or, in a tissue without party
/// walls, one that is not `natural`, becomes the largest rectangle it holds
/// when that keeps at least 55 % of its area and is `natural` itself; else
/// it stays as composed (a house is never dropped here). `attached` tissues
/// build their lot's own band between leaning party walls on purpose, and
/// concave bodies (the L of a corner or through lot, an opened court) are
/// composed on purpose: neither is squared.
pub(super) fn squared_bodies(pieces: Vec<Piece>, frames: &[Frame], wing: f64, attached: bool) -> Vec<Piece> {
    pieces
        .into_iter()
        .map(|(ring, hole, label)| {
            let odd = label == "building" && hole.is_none() && {
                let mut r = smoothed(&dedup(ring.clone()), 0.12);
                if ring_area(&r) < 0.0 {
                    r.reverse();
                }
                convex(&r) && (corners(&r) > 6 || (!attached && !natural(&r)))
            };
            let square = odd
                .then(|| best_rectangle(&ring, frames, wing))
                .flatten()
                .filter(|r| ring_area(r).abs() >= 0.55 * ring_area(&ring).abs() && natural(r));
            (square.unwrap_or(ring), hole, label)
        })
        .collect()
}

/// The union of two touching pieces as one piece, when it is one simple
/// ring keeping `a`'s court (and nothing else) as its hole.
pub(super) fn merged(a: &Piece, b: &[Point]) -> Option<Vec<Point>> {
    let u = super::super::super::geometry::union(&[
        Shape {
            outer: a.0.clone(),
            holes: vec![],
        },
        Shape {
            outer: b.to_vec(),
            holes: vec![],
        },
    ]);
    let [s] = u.as_slice() else {
        return None;
    };
    let r = dedup(s.outer.clone());
    (s.holes.is_empty() && r.len() >= 3 && simple(&r)).then_some(r)
}

/// Pieces made legible after composition (review series 2):
/// - a small piece (under 60 m²) that is not a rectangle becomes the
///   largest practicable rectangle in the best orientation (P14/P15 37,
///   P05 119), or, when only a sliver of it is a rectangle, joins the house
///   it touches (« pas de souci s'il est intégré à la maison », P02 12),
///   else stays;
/// - `absorb` (attached tissues): an unbuilt part of the lot too thin to
///   hold a 3 m yard (a wedge between a range and the lot's edge, a strip
///   along a side street) is built with the house it touches (« remplir le
///   côté », P01 9, 102, 115), so no sliver of yard is left between walls.
pub(super) fn legible_pieces(
    pieces: Vec<Piece>,
    b: &[Point],
    frames: &[Frame],
    wing: f64,
    absorb: bool,
    attached: bool,
    streets: &[Front],
) -> Vec<Piece> {
    const SMALL: f64 = 60.0;
    // The house keeps its structural width and no needle.
    let sound = |r: &[Point], hole: Option<&[Point]>| {
        thickness(r, hole) >= wing - 1e-6
            && (0..r.len()).all(|k| {
                let n = r.len();
                let (u, w) = (sub(r[(k + n - 1) % n], r[k]), sub(r[(k + 1) % n], r[k]));
                let (lu, lw) = (length(u), length(w));
                lu < 1.0 || lw < 1.0 || dot(u, w) / (lu * lw) <= 20f64.to_radians().cos()
            })
    };
    let mut out: Vec<Piece> = Vec::with_capacity(pieces.len());
    let mut small: Vec<Piece> = vec![];
    for p in pieces {
        let a = ring_area(&p.0).abs();
        if p.2 == "building" && p.1.is_none() && a < SMALL && !rectangular(&p.0) {
            small.push(p);
        } else {
            out.push(p);
        }
    }
    for p in small {
        let a = ring_area(&p.0).abs();
        let square = best_rectangle(&p.0, frames, wing).filter(|r| ring_area(r).abs() >= 0.6 * a);
        if let Some(r) = square {
            out.push((r, None, p.2));
            continue;
        }
        let host = (0..out.len())
            .filter(|&i| out[i].2 == "building")
            .find_map(|i| {
                merged(&out[i], &p.0)
                    .filter(|r| sound(r, out[i].1.as_deref()))
                    .map(|r| (i, r))
            });
        match host {
            Some((i, r)) => out[i].0 = r,
            None => out.push(p),
        }
    }
    if out.is_empty() {
        return out;
    }
    // Invariant (« remplir le côté », attached tissues): no unbuilt strip
    // under 2.5 m lies between a wall and the lot's edge. A wall whose whole
    // stretch of unbuilt ground in front of it ends within 2.5 m (at the
    // lot's edge or another house) moves onto that edge; wider ground stays
    // yard (a court keeps at least 3 m, a yard 3 m).
    // Invariant (« pas d'impasse en angle aigu », every tissue): no unbuilt
    // wedge is left between a wall and the edge closing on it at an acute
    // angle (the lot's side, another house of the lot): ground in front of
    // a wall that tapers to nothing at one end and ends within `WEDGE` (and
    // within the wall's length, 45 degrees) is built with that house, whose
    // wall then follows the edge: a right trapezoid instead of a rectangle
    // and a triangular court no one can use (review series 1-3, class A).
    // Walls are taken one by one, the largest houses first, the ground they
    // take leaving the unbuilt rest.
    const STRIP: f64 = 2.5;
    const WEDGE: f64 = 6.0;
    let mut rest = vec![Shape {
        outer: b.to_vec(),
        holes: vec![],
    }];
    for (r, _, _) in &out {
        let cut = Shape {
            outer: r.clone(),
            holes: vec![],
        };
        rest = rest.iter().flat_map(|s| difference(s, &cut)).collect();
    }
    // The houses as composed, before any ground joined them.
    let first: Vec<Vec<Point>> = out.iter().map(|p| p.0.clone()).collect();
    // A small house keeps its practicable rectangle.
    let mut order: Vec<usize> = (0..out.len())
        .filter(|&i| out[i].2 == "building" && ring_area(&out[i].0).abs() >= SMALL)
        .collect();
    order.sort_by(|&i, &j| {
        ring_area(&out[j].0)
            .abs()
            .total_cmp(&ring_area(&out[i].0).abs())
    });
    for i in order {
        let mut k = 0;
        while k < out[i].0.len() && !rest.is_empty() {
            let mut ring = out[i].0.clone();
            if ring_area(&ring) < 0.0 {
                ring.reverse();
            }
            let n = ring.len();
            let (a, c) = (ring[k % n], ring[(k + 1) % n]);
            k += 1;
            let e = sub(c, a);
            if length(e) < 1.0 {
                continue;
            }
            // Outward (right) normal of a CCW wall.
            let m = scale(normal(unit(e)), -1.0);
            let slab = |d: f64| Shape {
                outer: vec![a, c, add(c, scale(m, d)), add(a, scale(m, d))],
                holes: vec![],
            };
            let ground = |d: f64| -> Vec<Shape> {
                let s = slab(d);
                rest.iter().flat_map(|g| intersection(g, &s)).collect()
            };
            let len = length(e);
            // The ground in front of the wall within `d`, when it ends there.
            let bounded = |d: f64| -> Option<Vec<Shape>> {
                let near = ground(d);
                let gained: f64 = near.iter().map(area).sum();
                let far: f64 = ground(d + STRIP).iter().map(area).sum();
                (gained >= 0.3 && far <= gained + 0.05 * len).then_some(near)
            };
            // Depth of the unbuilt ground in front of the wall near `p`.
            let u = unit(e);
            let depth = |p: Point| -> f64 {
                let q = add(p, scale(u, 0.2));
                let s = Shape {
                    outer: vec![p, q, add(q, scale(m, WEDGE)), add(p, scale(m, WEDGE))],
                    holes: vec![],
                };
                rest.iter()
                    .flat_map(|g| intersection(g, &s))
                    .map(|g| area(&g))
                    .sum::<f64>()
                    / 0.2
            };
            let wedge = || -> Option<Vec<Shape>> {
                if len < 2.0 || !attached {
                    return None;
                }
                let near = bounded(WEDGE.min(len))?;
                let (da, dc) = (depth(add(a, scale(u, 0.05))), depth(sub(c, scale(u, 0.25))));
                // It closes on the lot's edge or on another house of the
                // lot, never on open yard.
                let domain = Shape {
                    outer: b.to_vec(),
                    holes: vec![],
                };
                let closed = near.iter().any(|g| {
                    offset(&g.outer, 0.05).into_iter().any(|r| {
                        let r = Shape {
                            outer: r,
                            holes: vec![],
                        };
                        difference(&r, &domain).iter().map(area).sum::<f64>() > 0.01
                            || (0..out.len()).filter(|&j| j != i).any(|j| {
                                let q = Shape {
                                    outer: out[j].0.clone(),
                                    holes: vec![],
                                };
                                intersection(&r, &q).iter().map(area).sum::<f64>() > 0.01
                            })
                    })
                });
                (closed && da.min(dc) < 0.5 && da.max(dc) > 1.0).then_some(near)
            };
            let strip = absorb.then(|| bounded(STRIP)).flatten();
            let Some(near) = strip.or_else(wedge) else {
                continue;
            };
            // A wall moves onto the lot's edge only where the house keeps
            // open corners: never a diamond along steep party walls.
            // Invariant (« pas de maison triangulaire sans contrainte »): the
            // ground joins a house only as a right trapezoid of it: no more
            // corners, and none further from square, than the house had
            // before any ground joined it, none sharper than 60 degrees
            // unless it had one (a wedge lot keeps its rectangles, never one
            // body following every bend of the lot).
            let joined = |j: usize| {
                let (house, hole) = (&out[j].0, out[j].1.as_deref());
                welded(house, &near, b).filter(|r| {
                    r.len() >= 3
                        && simple(r)
                        && sound(r, hole)
                        && !(open_corners_at(house, streets) && !open_corners_at(r, streets))
                        && odd_corners(r) <= odd_corners(&first[j])
                        && corners(r) <= corners(&first[j])
                        && sharpest(r) >= sharpest(&first[j]).min(60.0) - 1.0
                })
            };
            let Some(r) = joined(i) else {
                continue;
            };
            // Ground between two houses of the lot joins the one it squares
            // (« des trapèzes plutôt que des parallélogrammes »): a street
            // range keeps its back wall square to the lot's sides and the
            // rear house reaches it, rather than the range taking the rear
            // house's skew.
            let other = (0..out.len())
                .filter(|&j| j != i && out[j].2 == "building" && touches(&out[j].0, &near))
                .find_map(|j| joined(j).map(|r| (j, r)));
            let (target, r) = match other {
                Some((j, rj)) if skew(&rj) + skew(&ring) + 1.0 < skew(&r) + skew(&out[j].0) => {
                    (j, rj)
                }
                _ => (i, r),
            };
            for g in &near {
                rest = rest.iter().flat_map(|s| difference(s, g)).collect();
            }
            out[target].0 = r;
            if target == i {
                k = 0;
            }
        }
    }
    out
}

/// `house` with the ground `near` built in, as one simple ring. Boolean noise
/// (millimetre slivers and pin holes along shared edges) is no ground: it
/// neither joins nor blocks the wall. Ground cut along a wall can stand a
/// hair off it after the booleans: the union is closed by a centimetre
/// (grown, then shrunk back) so that the two weld into one body.
fn welded(house: &[Point], near: &[Shape], b: &[Point]) -> Option<Vec<Point>> {
    let mut parts = vec![Shape {
        outer: house.to_vec(),
        holes: vec![],
    }];
    parts.extend(near.iter().filter(|g| area(g) >= 0.05).cloned());
    let mut u = super::super::super::geometry::union(&parts);
    u.retain(|s| area(s) >= 0.05);
    if u.iter()
        .any(|s| s.holes.iter().any(|h| ring_area(h).abs() >= 0.05))
    {
        return None;
    }
    // Closed in every case: a seam of the lot crossed by the new wall would
    // otherwise stay a slit in the body.
    let grown: Vec<Shape> = u
        .iter()
        .flat_map(|s| offset(&s.outer, 0.01))
        .map(|r| Shape {
            outer: r,
            holes: vec![],
        })
        .collect();
    let joined = super::super::super::geometry::union(&grown);
    let [one] = joined.as_slice() else {
        return None;
    };
    let shrunk = offset(&one.outer, -0.01);
    let [r] = shrunk.as_slice() else {
        return None;
    };
    // Kept in the domain: the closing never leaves the lot.
    let outer = largest(clip_inside(r, b));
    let r = dedup(outer);
    (r.len() >= 3).then_some(r)
}

/// Whether some of the ground `near` lies against `house` (within 5 cm).
fn touches(house: &[Point], near: &[Shape]) -> bool {
    offset(house, 0.05).into_iter().any(|r| {
        let r = Shape {
            outer: r,
            holes: vec![],
        };
        near.iter()
            .any(|g| intersection(&r, g).iter().map(area).sum::<f64>() > 0.01)
    })
}

/// Corners of a ring (walls of 0.8 m or more) neither within 25 degrees of
/// square, nor of a straight joint, nor of a reflex right corner.
pub(super) fn odd_corners(ring: &[Point]) -> usize {
    let mut r = smoothed(&dedup(ring.to_vec()), 0.12);
    if ring_area(&r) < 0.0 {
        r.reverse();
    }
    let n = r.len();
    (0..n)
        .filter(|&i| {
            let (a, v, c) = (r[(i + n - 1) % n], r[i], r[(i + 1) % n]);
            let (e, f) = (sub(v, a), sub(c, v));
            if length(e) < 0.8 || length(f) < 0.8 {
                return false;
            }
            let turn = (e.x * f.y - e.y * f.x).atan2(dot(e, f)).to_degrees().abs();
            turn.min((turn - 90.0).abs()) > 25.0
        })
        .count()
}

/// Corners of a ring: turns over 10 degrees between walls of 0.8 m or more
/// (sub-decimetre jogs smoothed away).
pub(super) fn corners(ring: &[Point]) -> usize {
    let mut r = smoothed(&dedup(ring.to_vec()), 0.12);
    if ring_area(&r) < 0.0 {
        r.reverse();
    }
    let n = r.len();
    (0..n)
        .filter(|&i| {
            let (a, v, c) = (r[(i + n - 1) % n], r[i], r[(i + 1) % n]);
            let (e, f) = (sub(v, a), sub(c, v));
            let turn = (e.x * f.y - e.y * f.x).atan2(dot(e, f)).to_degrees().abs();
            length(e) >= 0.8 && length(f) >= 0.8 && turn > 10.0
        })
        .count()
}

/// The sharpest convex corner of a ring in degrees (walls of 0.8 m or more,
/// sub-decimetre jogs smoothed away); 180 for a ring without one.
pub(super) fn sharpest(ring: &[Point]) -> f64 {
    let mut r = smoothed(&dedup(ring.to_vec()), 0.12);
    if ring_area(&r) < 0.0 {
        r.reverse();
    }
    let n = r.len();
    (0..n)
        .filter_map(|i| {
            let (a, v, c) = (r[(i + n - 1) % n], r[i], r[(i + 1) % n]);
            let (e, f) = (sub(v, a), sub(c, v));
            let turn = (e.x * f.y - e.y * f.x).atan2(dot(e, f)).to_degrees();
            (length(e) >= 0.8 && length(f) >= 0.8 && turn > 0.0).then_some(180.0 - turn)
        })
        .fold(180.0, f64::min)
}

/// How far a ring's corners stand from square, in degrees summed over its
/// walls of 0.8 m or more (a straight joint, a right or a reflex right
/// corner count nothing): rectangles score 0, trapezoids less than
/// parallelograms of the same lean.
pub(super) fn skew(ring: &[Point]) -> f64 {
    let mut r = smoothed(&dedup(ring.to_vec()), 0.12);
    if ring_area(&r) < 0.0 {
        r.reverse();
    }
    let n = r.len();
    (0..n)
        .map(|i| {
            let (a, v, c) = (r[(i + n - 1) % n], r[i], r[(i + 1) % n]);
            let (e, f) = (sub(v, a), sub(c, v));
            if length(e) < 0.8 || length(f) < 0.8 {
                return 0.0;
            }
            let turn = (e.x * f.y - e.y * f.x).atan2(dot(e, f)).to_degrees().abs();
            turn.min((turn - 90.0).abs()).min((180.0 - turn).abs())
        })
        .sum()
}

/// Structural minimum thickness of a piece (outer ring and optional hole):
/// the smallest distance from a vertex to a facing edge across the solid.
/// Unlike `2A/perimeter`, a thin wing attached to a wide body is measured at
/// the wing, and a court whose wall thins to a line is measured there.
/// Measured on the rings without their sub-decimetre jogs (`JOG`): the
/// zigzags cadastral cuts leave on party walls are not walls of the body.
pub(in crate::urban::parcels) fn thickness(outer: &[Point], hole: Option<&[Point]>) -> f64 {
    const JOG: f64 = 0.12;
    // Rings with the solid on their left (outer CCW, hole CW).
    let mut rings: Vec<Vec<Point>> = vec![smoothed(outer, JOG)];
    if ring_area(&rings[0]) < 0.0 {
        rings[0].reverse();
    }
    if let Some(h) = hole {
        let mut h = smoothed(h, JOG);
        if ring_area(&h) > 0.0 {
            h.reverse();
        }
        rings.push(h);
    }
    // Outward normal of an edge: right-hand normal of its direction.
    let out = |a: Point, b: Point| {
        let d = unit(sub(b, a));
        Point { x: d.y, y: -d.x }
    };
    let mut best = f64::INFINITY;
    for (ri, r) in rings.iter().enumerate() {
        let n = r.len();
        for i in 0..n {
            let v = r[i];
            let vn = unit(add(out(r[(i + n - 1) % n], v), out(v, r[(i + 1) % n])));
            for (rj, s) in rings.iter().enumerate() {
                let m = s.len();
                for j in 0..m {
                    if ri == rj && (j == i || (j + 1) % m == i) {
                        continue;
                    }
                    let (a, b) = (s[j], s[(j + 1) % m]);
                    let e = sub(b, a);
                    let len2 = dot(e, e);
                    if len2 < 1e-12 {
                        continue;
                    }
                    let en = out(a, b);
                    if dot(en, vn) > -0.3 || dot(sub(v, a), en) > 1e-9 {
                        continue;
                    }
                    let k = dot(sub(v, a), e) / len2;
                    if !(0.0..=1.0).contains(&k) {
                        continue;
                    }
                    best = best.min(-dot(sub(v, a), en));
                }
            }
        }
    }
    best
}

/// True when no two non-adjacent edges of the ring cross or touch.
pub(super) fn simple(ring: &[Point]) -> bool {
    let n = ring.len();
    if n < 3 {
        return false;
    }
    let cross = |o: Point, a: Point, b: Point| {
        let (u, v) = (sub(a, o), sub(b, o));
        u.x * v.y - u.y * v.x
    };
    for i in 0..n {
        let (a, b) = (ring[i], ring[(i + 1) % n]);
        for j in i + 1..n {
            if j == i + 1 || (i == 0 && j == n - 1) {
                continue;
            }
            let (c, d) = (ring[j], ring[(j + 1) % n]);
            let (d1, d2) = (cross(a, b, c), cross(a, b, d));
            let (d3, d4) = (cross(c, d, a), cross(c, d, b));
            if d1 * d2 <= 0.0 && d3 * d4 <= 0.0 {
                // Collinear disjoint segments are fine.
                if d1 == 0.0 && d2 == 0.0 {
                    let e = sub(b, a);
                    let (p, q) = (dot(sub(c, a), e), dot(sub(d, a), e));
                    if p.max(q) < 0.0 || p.min(q) > dot(e, e) {
                        continue;
                    }
                }
                return false;
            }
        }
    }
    true
}
