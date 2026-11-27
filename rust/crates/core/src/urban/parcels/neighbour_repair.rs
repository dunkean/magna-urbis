//! Local boundary redraws, corner splits and redistribution between neighbouring lots.

use super::{contacts, tidy};
use super::contacts::{Front, frontage};
use super::cut_geometry::{add, bounds, dot, half, half_area, length, normal, scale, sub, unit};
use super::identity::parcel;
use super::seams::{boxes_touch, joined, shared};
use crate::urban::{Parcel, Point, Shape};
use crate::urban::geometry::{area, difference, intersection, signed};

pub(super) enum Repair {
    Merge(Shape, Shape),
    Split([(Shape, Shape); 2]),
}

/// The union of two neighbours cut again into two equal areas, parallel to
/// their longest common side (the original cut). None when that cut does not
/// leave exactly two connected lots.
pub(super) fn rebalance(union: &Shape, a: &Shape, b: &Shape) -> Option<[Shape; 2]> {
    split_share(union, normal(common_side(a, b)?.0), 0.5)
}

/// Direction and endpoints of the longest overlap (> 0.5 m) on the first lot.
fn common_side(a: &Shape, b: &Shape) -> Option<(Point, [Point; 2])> {
    let mut best: Option<(f64, Point, [Point; 2])> = None;
    for i in 0..a.outer.len() {
        let p = a.outer[i];
        let q = a.outer[(i + 1) % a.outer.len()];
        let edge = length(sub(q, p));
        if edge < 0.5 {
            continue;
        }
        let dir = unit(sub(q, p));
        for j in 0..b.outer.len() {
            let r = b.outer[j];
            let s = b.outer[(j + 1) % b.outer.len()];
            if dot(dir, unit(sub(s, r))).abs() < 0.9999 {
                continue;
            }
            let off = sub(r, p);
            if (off.x * dir.y - off.y * dir.x).abs() > 0.01 {
                continue;
            }
            let (u, v) = (dot(off, dir), dot(sub(s, p), dir));
            let (lo, hi) = (u.min(v).max(0.0), u.max(v).min(edge));
            let overlap = hi - lo;
            if overlap > best.map_or(0.5, |b| b.0) {
                best = Some((overlap, dir, [add(p, scale(dir, lo)), add(p, scale(dir, hi))]));
            }
        }
    }
    best.map(|(_, dir, side)| (dir, side))
}

/// `union` cut by one line normal to `n`, its `dot(n, p) <= at` side holding
/// `share` of the area. None unless both sides are single connected lots.
fn split_share(union: &Shape, n: Point, share: f64) -> Option<[Shape; 2]> {
    let whole = area(union);
    let (mut lo, mut hi) = bounds(union, n);
    for _ in 0..40 {
        let m = 0.5 * (lo + hi);
        if half_area(union, n, m) < share * whole {
            lo = m;
        } else {
            hi = m;
        }
        if hi - lo < 0.01 {
            break;
        }
    }
    let at = 0.5 * (lo + hi);
    let mut x = half(union, n, at, true);
    let mut y = half(union, n, at, false);
    (x.len() == 1 && y.len() == 1).then(|| [x.remove(0), y.remove(0)])
}

/// Redraw just enough land to bring the pair below 3:1. A long donor can
/// face several smaller lots, so when a straight cut across the union would
/// move too much ground, extend the smaller lot only through its shared side.
pub(super) fn redraw_close_pair(
    small: &Shape,
    large: &Shape,
    mut accept: impl FnMut(Shape, Shape) -> bool,
) {
    let Some((along, [a, b])) = common_side(large, small) else {
        return;
    };
    let n = normal(along);
    let (sa, la) = (area(small), area(large));
    let total = sa + la;
    let transfer = total / 3.8 - sa;
    if let Some(union) = joined(small, large) {
        let below = dot(crate::urban::geometry::centroid(small), n)
            < dot(crate::urban::geometry::centroid(large), n);
        let share = (sa + transfer) / total;
        if let Some([x, y]) = split_share(&union, n, if below { share } else { 1.0 - share }) {
            let (s, l) = if below { (x, y) } else { (y, x) };
            if accept(s, l) {
                return;
            }
        }
    }
    let inward = if signed(&large.outer) > 0.0 { n } else { scale(n, -1.0) };
    let depth = transfer / length(sub(b, a));
    // The donor may taper immediately behind the party wall.
    for factor in [1.0, 1.5, 2.0] {
        let step = scale(inward, factor * depth);
        let base = scale(inward, -0.01);
        let band = Shape { outer: vec![add(a, base), add(b, base), add(b, step), add(a, step)], holes: vec![] };
        let mut land = intersection(large, &band);
        if land.len() != 1 {
            continue;
        }
        let Some(grown) = joined(small, &land.remove(0)) else {
            continue;
        };
        let mut rest = difference(large, &band);
        if rest.len() == 1 && accept(grown, rest.remove(0)) {
            return;
        }
    }
}

/// Extent, projected on `along`, of the common boundary of `a` and `b`.
fn shared_span(a: &Shape, b: &Shape, along: Point) -> Option<(f64, f64)> {
    let mut span: Option<(f64, f64)> = None;
    for i in 0..a.outer.len() {
        let p = a.outer[i];
        let q = a.outer[(i + 1) % a.outer.len()];
        let edge_len = length(sub(q, p));
        if edge_len < 1e-9 {
            continue;
        }
        let dir = unit(sub(q, p));
        for j in 0..b.outer.len() {
            let r = b.outer[j];
            let s = b.outer[(j + 1) % b.outer.len()];
            if dot(dir, unit(sub(s, r))).abs() < 0.99999 {
                continue;
            }
            let off = sub(r, p);
            if (off.x * dir.y - off.y * dir.x).abs() > 0.01 {
                continue;
            }
            let (u, v) = (dot(off, dir), dot(sub(s, p), dir));
            let (lo, hi) = (u.min(v).max(0.0), u.max(v).min(edge_len));
            if hi - lo < 1e-6 {
                continue;
            }
            for t in [lo, hi] {
                let x = dot(add(p, scale(dir, t)), along);
                span = Some(span.map_or((x, x), |(m, n)| (m.min(x), n.max(x))));
            }
        }
    }
    span
}

/// Invariant (residual slivers): a lot left without any admissible house
/// beside admitted lots is shared out among them along their common
/// boundary, each piece joining the lot behind it (a strip left along a street
/// by deep opposite lots extends those lots to the street). Refused, and the
/// cell stays residual, when a piece has no admitted neighbour, a receiving lot
/// loses its witness, reaches past `too_deep` or more than doubles past `cap`.
/// A receiver that would grow past 2.5x its smallest admitted neighbour turns
/// the cell into open garden land instead (returns true, cell kept).
pub(super) fn share_out(
    cells: &mut Vec<Parcel>,
    i: usize,
    fronts: &[Front],
    witness: &dyn Fn(&Shape) -> Option<Shape>,
    too_deep: &dyn Fn(&Shape) -> bool,
    cap: f64,
) -> bool {
    let r = cells[i].shape.clone();
    let rb = crate::urban::geometry::bbox(&r);
    let mut near: Vec<(usize, f64)> = cells
        .iter()
        .enumerate()
        .filter(|(j, p)| {
            *j != i
                && p.use_kind == "plot"
                && p.envelope.is_some()
                && boxes_touch(rb, crate::urban::geometry::bbox(&p.shape))
        })
        .map(|(j, p)| (j, shared(&r, &p.shape)))
        .filter(|&(_, s)| s > 0.5)
        .collect();
    if near.is_empty() {
        return false;
    }
    near.sort_by(|a, b| b.1.total_cmp(&a.1).then(a.0.cmp(&b.0)));
    let Some((along, _)) = common_side(&r, &cells[near[0].0].shape) else {
        return false;
    };
    let mut spans: Vec<(usize, f64, f64)> = near
        .iter()
        .filter_map(|&(j, _)| shared_span(&r, &cells[j].shape, along).map(|(lo, hi)| (j, lo, hi)))
        .collect();
    spans.sort_by(|a, b| (a.1 + a.2).total_cmp(&(b.1 + b.2)).then(a.0.cmp(&b.0)));
    let cuts: Vec<f64> = spans
        .windows(2)
        .map(|w| {
            let (m0, m1) = (0.5 * (w[0].1 + w[0].2), 0.5 * (w[1].1 + w[1].2));
            (0.5 * (w[0].2 + w[1].1)).clamp(m0, m1.max(m0))
        })
        .collect();
    let mut grown: Vec<(usize, Shape)> = spans
        .iter()
        .map(|&(j, _, _)| (j, cells[j].shape.clone()))
        .collect();
    for k in 0..spans.len() {
        let mut pieces = vec![r.clone()];
        if k > 0 {
            pieces = pieces
                .iter()
                .flat_map(|s| half(s, along, cuts[k - 1], false))
                .collect();
        }
        if k + 1 < spans.len() {
            pieces = pieces
                .iter()
                .flat_map(|s| half(s, along, cuts[k], true))
                .collect();
        }
        for piece in pieces.into_iter().filter(|p| area(p) > 1e-6) {
            let Some((g, s)) = grown
                .iter()
                .enumerate()
                .map(|(g, (_, s))| (g, shared(&piece, s)))
                .max_by(|a, b| a.1.total_cmp(&b.1).then(b.0.cmp(&a.0)))
            else {
                return false;
            };
            if s < 0.05 {
                return false;
            }
            let Some(joint) = joined(&grown[g].1, &piece) else {
                return false;
            };
            grown[g].1 = joint;
        }
    }
    let mut accepted = Vec::new();
    for (j, shape) in grown {
        let before = area(&cells[j].shape);
        if (area(&shape) - before).abs() < 1e-9 {
            continue;
        }
        if too_deep(&shape) || area(&shape) > cap.max(2.0 * before) {
            return false;
        }
        // Lot balance: a grown lot stays within 2.5x of its smallest admitted
        // neighbour (the bound merges already keep); else the cell becomes the
        // garden of the lot behind it, never a bloated lot.
        let sb = crate::urban::geometry::bbox(&shape);
        let smallest = cells
            .iter()
            .enumerate()
            .filter(|(k, p)| {
                *k != i
                    && *k != j
                    && p.use_kind == "plot"
                    && p.envelope.is_some()
                    && boxes_touch(sb, crate::urban::geometry::bbox(&p.shape))
                    && shared(&shape, &p.shape) > 1.0
            })
            .map(|(_, p)| area(&p.shape))
            .fold(f64::INFINITY, f64::min);
        if area(&shape) > 2.5 * smallest {
            // The land is kept open instead: the garden of the lot behind it.
            let cell = &mut cells[i];
            cell.use_kind = "garden".into();
            cell.reason = "retained-backland".into();
            cell.front = None;
            cell.envelope = None;
            cell.provenance.push("balance-garden".into());
            return true;
        }
        let Some(envelope) = witness(&shape) else {
            return false;
        };
        accepted.push((j, shape, envelope));
    }
    if accepted.is_empty() {
        return false;
    }
    let residual_id = cells[i].id.clone();
    for (j, shape, envelope) in accepted {
        let old = &cells[j];
        let mut lot = parcel(shape, old.block, old.axis, fronts, "plot");
        lot.parent_ids = vec![old.id.clone(), residual_id.clone()];
        lot.provenance = old.provenance.clone();
        lot.provenance.push("residual-shared".into());
        lot.reason = old.reason.clone();
        lot.envelope = Some(envelope);
        cells[j] = lot;
    }
    cells.remove(i);
    true
}

/// The redraw of the boundary between two neighbours `a` and `b` (union
/// `union`, area ratio `ratio`): one cut parallel to their common side, placed
/// so that each keeps an area in proportion to its frontage. It must leave two
/// connected lots, divide the ratio by at least 1.25, stay within the depth
/// bound and keep both witnesses. (Cuts across the lots' fronts were tried and
/// rejected: each such redraw unbalances a third neighbour, 87 -> 160 pairs on 01-l.)
fn redraw_pair(
    union: &Shape,
    a: &Parcel,
    b: &Parcel,
    ratio: f64,
    fronts: &[Front],
    witness: &dyn Fn(&Shape) -> Option<Shape>,
    too_deep: &dyn Fn(&Shape) -> bool,
    floor: f64,
) -> Option<(Shape, Shape, Shape, Shape)> {
    let n = normal(common_side(&a.shape, &b.shape)?.0);
    let fa = frontage(&a.shape, fronts).0.max(1.0);
    let fb = frontage(&b.shape, fronts).0.max(1.0);
    let a_below =
        dot(crate::urban::geometry::centroid(&a.shape), n) < dot(crate::urban::geometry::centroid(&b.shape), n);
    // The boundary moves toward frontage-proportional areas, all the way first,
    // then part way when the full move costs a witness or the depth bound.
    let target = fa / (fa + fb);
    let current = area(&a.shape) / area(union).max(1e-6);
    for k in [1.0, 0.75, 0.5, 0.35] {
        let share = (current + k * (target - current)).clamp(0.3, 0.7);
        let below = if a_below { share } else { 1.0 - share };
        let Some([x, y]) = split_share(union, n, below) else {
            continue;
        };
        let (na, nb) = if a_below { (x, y) } else { (y, x) };
        let after = area(&na).max(area(&nb)) / area(&na).min(area(&nb)).max(1e-6);
        if after > 0.8 * ratio || too_deep(&na) || too_deep(&nb) {
            continue;
        }
        // A redraw through a concave union must not hand either lot its arm.
        if tidy::solidity(&na) < floor.min(tidy::solidity(&a.shape))
            || tidy::solidity(&nb) < floor.min(tidy::solidity(&b.shape))
        {
            continue;
        }
        if let (Some(ea), Some(eb)) = (witness(&na), witness(&nb)) {
            return Some((na, nb, ea, eb));
        }
    }
    None
}

/// Invariant (corner lots): a corner lot holding 3 times or more the area of
/// an admitted neighbour of similar frontage on its street gives its far part
/// along the side street to a lot of its own, cut square to that street, so
/// the corner keeps about 1.6 times its neighbour. Both parts keep a witness
/// and the depth bound, the side part a frontage on the side street; the
/// partition stays exact (two half-planes of the same lot).
pub(super) fn split_corners(
    cells: &mut Vec<Parcel>,
    fronts: &[Front],
    witness: &dyn Fn(&Shape) -> Option<Shape>,
    too_deep: &dyn Fn(&Shape) -> bool,
) {
    let cos45 = 45.0_f64.to_radians().cos();
    let mut i = 0;
    while i < cells.len() {
        let corner = &cells[i];
        // A corner: street contacts of 3 m or more in two directions 45
        // degrees apart (the `corner-lot` rule of `qualify`).
        let long: Vec<Point> = contacts::boundary_contacts(&corner.shape, fronts)
            .iter()
            .filter(|f| length(sub(f.b, f.a)) >= 3.0)
            .map(|f| unit(sub(f.b, f.a)))
            .collect();
        let is_corner = long
            .iter()
            .enumerate()
            .any(|(k, u)| long[k + 1..].iter().any(|v| dot(*u, *v).abs() < cos45));
        if corner.use_kind != "plot" || corner.envelope.is_none() || !is_corner {
            i += 1;
            continue;
        }
        let ai = area(&corner.shape);
        let (fi, _) = frontage(&corner.shape, fronts);
        // The smallest admitted neighbour of similar frontage along a street.
        let neighbour = cells
            .iter()
            .enumerate()
            .filter(|(j, q)| *j != i && q.use_kind == "plot" && q.envelope.is_some())
            .filter(|(_, q)| shared(&corner.shape, &q.shape) >= 1.0)
            .filter_map(|(_, q)| {
                let (len, f) = frontage(&q.shape, fronts);
                let f = f?;
                (len > 0.0 && fi > 0.0 && ai >= 3.0 * area(&q.shape)).then_some((area(&q.shape), f))
            })
            .min_by(|a, b| a.0.total_cmp(&b.0));
        let Some((aj, fj)) = neighbour else {
            i += 1;
            continue;
        };
        let u1 = unit(sub(fj.b, fj.a));
        let contacts = contacts::boundary_contacts(&corner.shape, fronts);
        let side = contacts
            .iter()
            .filter(|f| dot(unit(sub(f.b, f.a)), u1).abs() < cos45)
            .max_by(|a, b| length(sub(a.b, a.a)).total_cmp(&length(sub(b.b, b.a))));
        let main = contacts
            .iter()
            .filter(|f| dot(unit(sub(f.b, f.a)), u1).abs() >= cos45)
            .max_by(|a, b| length(sub(a.b, a.a)).total_cmp(&length(sub(b.b, b.a))));
        let (Some(side), Some(main)) = (side, main) else {
            i += 1;
            continue;
        };
        let n = unit(sub(side.b, side.a));
        let (lo, hi) = bounds(&corner.shape, n);
        // The corner part is the one on the main street's side.
        let corner_low = dot(n, scale(add(main.a, main.b), 0.5)) < 0.5 * (lo + hi);
        let target = (1.6 * aj / ai).clamp(0.3, 0.7);
        let split = [target, 0.5, 0.45, 0.55, 0.4, 0.6, 0.35, 0.65]
            .into_iter()
            .find_map(|share| {
                let [x, y] = split_share(
                    &corner.shape,
                    n,
                    if corner_low { share } else { 1.0 - share },
                )?;
                let (c, rest) = if corner_low { (x, y) } else { (y, x) };
                let (ac, ar) = (area(&c), area(&rest));
                if ac.max(aj) / ac.min(aj) >= 3.0
                    || ar < 0.5 * aj
                    || too_deep(&c)
                    || too_deep(&rest)
                    || frontage(&rest, fronts).0 < 3.0
                {
                    return None;
                }
                Some((c.clone(), witness(&c)?, rest.clone(), witness(&rest)?))
            });
        let Some((c, ec, rest, er)) = split else {
            i += 1;
            continue;
        };
        let (block, axis) = (corner.block, corner.axis);
        let mut provenance = corner.provenance.clone();
        provenance.push("corner-split".into());
        let parent = corner.id.clone();
        let make = |shape: Shape, envelope: Shape| {
            let mut p = parcel(shape, block, axis, fronts, "plot");
            p.envelope = Some(envelope);
            p.parent_ids = vec![parent.clone()];
            p.provenance = provenance.clone();
            p.reason = "admissibility-repaired".into();
            p
        };
        cells[i] = make(c, ec);
        let mut side_lot = make(rest, er);
        side_lot.provenance.retain(|x| x != "corner-lot");
        cells.push(side_lot);
        i += 1;
    }
}

/// Invariant (lot balance): two admitted neighbours, whether on one street or
/// back to back on two, never hold areas in a ratio of 3 or more when their
/// common boundary can move: the boundary is redrawn parallel to itself so
/// each keeps an area in proportion to its frontage, provided both keep their
/// witness and depth bound. Pairs come from a sweep over bounding boxes.
pub(super) fn balance_neighbours(
    cells: &mut [Parcel],
    fronts: &[Front],
    witness: &dyn Fn(&Shape) -> Option<Shape>,
    too_deep: &dyn Fn(&Shape) -> bool,
    floor: f64,
) {
    for _ in 0..2 {
        let lots: Vec<usize> = (0..cells.len())
            .filter(|&i| cells[i].use_kind == "plot" && cells[i].envelope.is_some())
            .collect();
        let boxes: Vec<_> = lots
            .iter()
            .map(|&i| crate::urban::geometry::bbox(&cells[i].shape))
            .collect();
        let areas: Vec<f64> = cells.iter().map(|p| area(&p.shape)).collect();
        let mut order: Vec<usize> = (0..lots.len()).collect();
        order.sort_by(|&a, &b| boxes[a].0.total_cmp(&boxes[b].0).then(a.cmp(&b)));
        let mut pairs = Vec::new();
        for (k, &a) in order.iter().enumerate() {
            for &b in &order[k + 1..] {
                if boxes[b].0 > boxes[a].2 + 0.05 {
                    break;
                }
                if !boxes_touch(boxes[a], boxes[b]) {
                    continue;
                }
                let (x, y) = (lots[a], lots[b]);
                let ratio = areas[x].max(areas[y]) / areas[x].min(areas[y]).max(1e-6);
                if ratio >= 2.5 && shared(&cells[x].shape, &cells[y].shape) >= 1.0 {
                    pairs.push((ratio, x.min(y), x.max(y)));
                }
            }
        }
        pairs.sort_by(|a, b| b.0.total_cmp(&a.0).then(a.1.cmp(&b.1)).then(a.2.cmp(&b.2)));
        let mut touched = vec![false; cells.len()];
        let mut changed = false;
        for (ratio, a, b) in pairs {
            if touched[a] || touched[b] {
                continue;
            }
            let Some(union) = joined(&cells[a].shape, &cells[b].shape) else {
                continue;
            };
            let Some((na, nb, ea, eb)) = redraw_pair(
                &union, &cells[a], &cells[b], ratio, fronts, witness, too_deep, floor,
            ) else {
                continue;
            };
            let parents = vec![cells[a].id.clone(), cells[b].id.clone()];
            for (k, shape, envelope) in [(a, na, ea), (b, nb, eb)] {
                let old = &cells[k];
                let mut lot = parcel(shape, old.block, old.axis, fronts, "plot");
                lot.parent_ids = parents.clone();
                lot.provenance = old.provenance.clone();
                lot.provenance.push("neighbour-balance".into());
                lot.reason = old.reason.clone();
                lot.envelope = Some(envelope);
                cells[k] = lot;
                touched[k] = true;
            }
            changed = true;
        }
        if !changed {
            break;
        }
    }
}
