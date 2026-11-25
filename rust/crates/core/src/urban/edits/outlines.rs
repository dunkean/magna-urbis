//! Quarter outline edits and geometry shared with parcel edits.

use super::*;

/// Hook of the quarter stage (variant plan only, after the composition): the
/// user outline of a quarter. Only what the user really moved counts: the
/// pieces between the user outline and the current one that reach farther
/// than `QUARTER_TOLERANCE` from it (`redraw`). The gain
/// is clipped to dry land; the edited quarter wins over its neighbours, which
/// give up the overlap. Streets and walls are carved out of its blocks later,
/// like everywhere else. Every refusal reports why the outline was kept.
#[allow(clippy::too_many_arguments)]
pub(in super::super) fn reshape_quarters(
    quarters: &mut [Quarter],
    phases: &mut [GrowthPhase],
    _streets: &[Street],
    _enclosures: &[Enclosure],
    cfg: &LayoutConfig,
    surface: Surface<'_>,
    center: Point,
    radius: f64,
    warnings: &mut Vec<String>,
) {
    for (k, o) in &cfg.overrides.quarters {
        let (Some(user), false) = (&o.shape, o.deleted == Some(true)) else {
            continue;
        };
        let Some(i) = k.parse::<usize>().ok().filter(|&i| i < quarters.len()) else {
            continue;
        };
        if !valid_shape(user) {
            continue;
        }
        let old = quarters[i].shape.clone();
        let old_area = g::area(&old);
        let ignore = |why: &str, warnings: &mut Vec<String>| {
            warnings.push(warnings::quarter_shape_ignored(i, why));
        };
        let Some(valid) = largest(g::union(&[g::normalized(Shape {
            outer: user.outer.clone(),
            holes: vec![],
        })])) else {
            ignore("degenerate outline", warnings);
            continue;
        };
        if overlap_area(std::slice::from_ref(&valid), &old) < 0.1 * old_area {
            ignore("no longer covers the quarter", warnings);
            continue;
        }
        let Some(Outline {
            shape,
            gains,
            leftovers: _,
        }) = redraw(&old, &valid, QUARTER_TOLERANCE, |p| {
            g::dry_clip(&surface, p)
        })
        else {
            ignore("same as the current outline", warnings);
            continue;
        };
        let Some(shape) = shape else {
            ignore("nothing left after clipping", warnings);
            continue;
        };
        if moved_area(&shape, &old) < 1.0 {
            // Every gain fell in the water (or the overlay could not merge it).
            ignore(
                "sans effet : le gain est dans l'eau ou hors du site",
                warnings,
            );
            continue;
        }
        let area = g::area(&shape);
        let overlap = overlap_area(std::slice::from_ref(&shape), &old);
        let far = shape
            .outer
            .iter()
            .any(|p| (p.x - center.x).hypot(p.y - center.y) > 2.0 * radius.max(100.0));
        if area < 200.0 {
            ignore("under 200 m²", warnings);
            continue;
        } else if area > (4.0 * old_area).max(200_000.0) {
            ignore("outline too large", warnings);
            continue;
        } else if far {
            ignore("too far from centre", warnings);
            continue;
        } else if overlap < 0.1 * old_area {
            ignore("no longer covers the quarter", warnings);
            continue;
        }
        // The neighbours give up the land taken (the gains only, so a
        // neighbour that only touches the quarter keeps its exact outline);
        // none may vanish.
        let cutter = with_boxes(gains.clone());
        let mut shrunk = vec![];
        let mut swallowed = false;
        for (j, q) in quarters.iter().enumerate() {
            if j == i
                || !cutter
                    .iter()
                    .any(|(_, cb)| bbox_hit(g::bbox(&q.shape), *cb, 0.0))
                || overlap_area(&gains, &q.shape) <= 0.01
            {
                continue;
            }
            match largest(subtract(vec![q.shape.clone()], &cutter)) {
                Some(rest) if g::area(&rest) >= 200.0 => shrunk.push((j, clean(rest))),
                _ => swallowed = true,
            }
        }
        if swallowed {
            ignore("would absorb a neighbouring quarter", warnings);
            continue;
        }
        for (j, rest) in shrunk {
            quarters[j].shape = rest;
        }
        // The gained land joins the quarter's growth phase, so the block
        // to phase lookup keeps it.
        if let Some(p) = phases.get_mut(quarters[i].phase) {
            p.shapes
                .extend(gains.into_iter().filter(|s| g::area(s) > 1.0));
        }
        quarters[i].shape = shape;
    }
}

/// Area that differs between two outlines (both differences).
pub(super) fn moved_area(a: &Shape, b: &Shape) -> f64 {
    g::difference(a, b)
        .iter()
        .chain(&g::difference(b, a))
        .map(g::area)
        .sum()
}
/// An outline edit resolved against the current outline `old`.
pub(super) struct Outline {
    /// The new outline (`None`: nothing left after the cuts).
    pub(super) shape: Option<Shape>,
    /// The land really taken outside `old` (what the neighbours give up).
    pub(super) gains: Vec<Shape>,
    /// The land of `old` given away (what the neighbours receive).
    pub(super) leftovers: Vec<Shape>,
}
/// Only what the user really moved counts: the pieces between the user
/// outline `valid` and `old` that reach farther than `tolerance` from `old`'s
/// boundary (editor rounding and simplification chords are not edits). The
/// outline is built from the robust union `old ∪ valid` minus the pieces that
/// do not count, so a gain that touches `old` is never left apart by the
/// overlay. `admit` clips a gain to the land it may take (dry land, block…).
/// `None` when nothing was moved.
pub(super) fn redraw(
    old: &Shape,
    valid: &Shape,
    (min_area, tolerance): (f64, f64),
    admit: impl Fn(&Shape) -> Vec<Shape>,
) -> Option<Outline> {
    let (raw_gain, raw_loss) = (g::difference(valid, old), g::difference(old, valid));
    let (gained, noise): (Vec<Shape>, Vec<Shape>) = raw_gain
        .into_iter()
        .partition(|p| counts(old, p, min_area, tolerance));
    let lost = significant(old, raw_loss, min_area, tolerance);
    if gained.is_empty() && lost.is_empty() {
        return None;
    }
    let gains: Vec<Shape> = gained
        .iter()
        .flat_map(&admit)
        .filter(|p| g::area(p) >= min_area)
        .map(clean)
        .collect();
    // Gains not admitted are cut back out of the union, like the noise.
    let refused = subtract(gained, &with_boxes(gains.clone()));
    let cut = with_boxes(
        noise
            .into_iter()
            .chain(refused)
            .chain(lost.clone())
            .collect(),
    );
    let base = keeping(g::union(&[old.clone(), valid.clone()]), old)?;
    let mut pieces = subtract(vec![base], &cut);
    pieces.retain(|p| g::area(p) > 0.01);
    let kept = pieces
        .iter()
        .enumerate()
        .max_by(|(_, a), (_, b)| {
            overlap_area(std::slice::from_ref(*a), old)
                .total_cmp(&overlap_area(std::slice::from_ref(*b), old))
                .then(g::area(a).total_cmp(&g::area(b)))
        })
        .map(|(k, s)| (k, s.clone()));
    // A piece of `old` cut off from the kept outline is given away too.
    let mut leftovers = lost;
    for (k, p) in pieces.iter().enumerate() {
        if kept.as_ref().is_some_and(|(j, _)| *j != k) {
            leftovers.extend(g::intersection(p, old));
        }
    }
    let shape = kept.map(|(_, s)| clean(s));
    let gains = match &shape {
        Some(s) => gains
            .into_iter()
            .filter(|p| overlap_area(std::slice::from_ref(s), p) > 0.5 * g::area(p))
            .collect(),
        None => vec![],
    };
    Some(Outline {
        shape,
        gains,
        leftovers,
    })
}

// -------------------------------------------------------------- lot edits

/// Shared boundary length of two lots (collinear edge overlaps, 5 cm).
pub(super) fn shared_length(a: &Shape, b: &Shape) -> f64 {
    shared_edges(a, b).iter().map(|e| e.0).sum()
}
/// Collinear edge overlaps of two lots within 5 cm: the overlap length and the
/// thin quad between the two edges (cut lots may leave sub-centimetre gaps).
fn shared_edges(a: &Shape, b: &Shape) -> Vec<(f64, Shape)> {
    let mut out = vec![];
    if !bbox_hit(g::bbox(a), g::bbox(b), 0.1) {
        return out;
    }
    let edges = |s: &Shape| -> Vec<(Point, Point)> {
        std::iter::once(&s.outer)
            .chain(&s.holes)
            .flat_map(|r| {
                r.iter()
                    .zip(r.iter().cycle().skip(1))
                    .take(r.len())
                    .map(|(&p, &q)| (p, q))
            })
            .collect()
    };
    let (ea, eb) = (edges(a), edges(b));
    for &(p, q) in &ea {
        let l = (q.x - p.x).hypot(q.y - p.y);
        if l < 1e-6 {
            continue;
        }
        let (ux, uy) = ((q.x - p.x) / l, (q.y - p.y) / l);
        for &(r, s) in &eb {
            if g::distance(r, p, q).0 > 0.05 && g::distance(s, p, q).0 > 0.05 {
                continue;
            }
            let off = |v: Point| ((v.x - p.x) * uy - (v.y - p.y) * ux).abs();
            if off(r) > 0.05 || off(s) > 0.05 {
                continue;
            }
            let t = |v: Point| (v.x - p.x) * ux + (v.y - p.y) * uy;
            let (t0, t1) = (t(r).min(t(s)).max(0.0), t(r).max(t(s)).min(l));
            if t1 - t0 <= 0.0 {
                continue;
            }
            let on_a = |t: f64| Point {
                x: p.x + ux * t,
                y: p.y + uy * t,
            };
            let on_b = |v: Point| g::distance(v, r, s).2;
            let (p0, p1) = (on_a(t0), on_a(t1));
            out.push((
                t1 - t0,
                g::normalized(Shape {
                    outer: vec![p0, p1, on_b(p1), on_b(p0)],
                    holes: vec![],
                }),
            ));
        }
    }
    out
}
/// Union of two adjacent lots as one polygon, the gaps along their shared
/// edges bridged; `None` when they do not form one piece.
pub(super) fn single_union(a: &Shape, b: &Shape) -> Option<Shape> {
    let unite = |a: &Shape, b: &Shape| {
        let mut parts = vec![a.clone(), b.clone()];
        parts.extend(
            shared_edges(a, b)
                .into_iter()
                .map(|e| e.1)
                .filter(|q| g::area(q) > 1e-9),
        );
        let mut u = g::union(&parts);
        // One simple polygon only: a folded or self-touching union is refused
        // (the caller tries the next neighbour).
        (u.len() == 1).then(|| clean(u.remove(0))).filter(g::simple)
    };
    unite(a, b).or_else(|| {
        // Sides shared only to floating precision: snap each onto the other
        // (the lot stage's own repair), simple rings only.
        let a2 = snap_onto(a, b, 0.05);
        let b2 = snap_onto(b, &a2, 0.05);
        (g::simple(&a2) && g::simple(&b2))
            .then(|| unite(&a2, &b2))
            .flatten()
    })
}
/// `shape` with each vertex within `tolerance` of a side of `onto` moved onto it.
fn snap_onto(shape: &Shape, onto: &Shape, tolerance: f64) -> Shape {
    let sides: Vec<(Point, Point)> = std::iter::once(&onto.outer)
        .chain(&onto.holes)
        .flat_map(|r| (0..r.len()).map(move |i| (r[i], r[(i + 1) % r.len()])))
        .collect();
    let snap = |p: Point| {
        sides
            .iter()
            .map(|&(a, b)| g::distance(p, a, b))
            .filter(|d| d.0 <= tolerance)
            .min_by(|x, y| x.0.total_cmp(&y.0))
            .map_or(p, |d| d.2)
    };
    Shape {
        outer: shape.outer.iter().map(|&p| snap(p)).collect(),
        holes: shape
            .holes
            .iter()
            .map(|r| r.iter().map(|&p| snap(p)).collect())
            .collect(),
    }
}
