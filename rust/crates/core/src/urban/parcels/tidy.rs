//! Final tidy of a block's lots: no hairlines, no needle tips, no wedge or
//! sliver lots. Every operation moves ground between lots of one block (the
//! block keeps its exact coverage) and never takes a lot's witness away.
use super::*;

/// A convex corner sharper than this (degrees) is a needle tip.
const TIP_ANGLE: f64 = 25.0;
/// A needle tip is cut where it is this wide (m): the point goes to the
/// neighbour it lies against, the lot keeps a blunt end.
const TIP_WIDTH: f64 = 3.0;
/// A rear-land lot filling less than this share of its oriented box is a wedge.
const WEDGE_FILL: f64 = 0.62;
/// ... and ending in a point sharper than this (degrees).
const WEDGE_POINT: f64 = 38.0;
/// ... and smaller than this (m2): a long curved garden is no wedge.
const WEDGE_AREA: f64 = 160.0;
/// A lot narrower than this (m) and many times longer than wide is a sliver.
const THIN_WIDTH: f64 = 4.2;
const THIN_ASPECT: f64 = 8.0;
/// No lot is narrower than this (m), whatever its length.
const HAIR_WIDTH: f64 = 3.0;

fn open_lot(p: &Parcel) -> bool {
    matches!(p.use_kind.as_str(), "plot" | "garden") && p.family != "reserve"
}

/// (short side, long side, fill) of the smallest oriented box around the lot.
pub(super) fn oriented(s: &Shape) -> (f64, f64, f64) {
    let r = &s.outer;
    let n = r.len();
    let mut best = (f64::MAX, 0.0, 0.0);
    for i in 0..n {
        let d = sub(r[(i + 1) % n], r[i]);
        if length(d) < 1e-6 {
            continue;
        }
        let (u, v) = (unit(d), normal(unit(d)));
        let (mut x0, mut x1, mut y0, mut y1) = (f64::MAX, f64::MIN, f64::MAX, f64::MIN);
        for p in r {
            let (x, y) = (dot(*p, u), dot(*p, v));
            x0 = x0.min(x);
            x1 = x1.max(x);
            y0 = y0.min(y);
            y1 = y1.max(y);
        }
        let (w, h) = (x1 - x0, y1 - y0);
        if w * h < best.0 {
            best = (w * h, w, h);
        }
    }
    let (box_area, w, h) = best;
    (w.min(h), w.max(h), area(s) / box_area.max(1e-9))
}

/// The sharpest convex corner of a lot (radians), seen at 3 m along each side
/// so that a rounded or noisy vertex does not count.
pub(super) fn pointed(s: &Shape) -> f64 {
    let r = &s.outer;
    let n = r.len();
    let ccw = super::super::geometry::signed(r) >= 0.0;
    let walk = |i: usize, step: isize| {
        let mut at = r[i];
        let mut left = 3.0;
        let mut k = i;
        for _ in 0..n {
            let next = r[(k as isize + step).rem_euclid(n as isize) as usize];
            let d = length(sub(next, at));
            if d >= left {
                return add(at, scale(unit(sub(next, at)), left));
            }
            left -= d;
            at = next;
            k = (k as isize + step).rem_euclid(n as isize) as usize;
        }
        at
    };
    let mut best = std::f64::consts::PI;
    for i in 0..n {
        let (a, b) = (sub(walk(i, -1), r[i]), sub(walk(i, 1), r[i]));
        let (la, lb) = (length(a), length(b));
        if la < 1.0 || lb < 1.0 {
            continue;
        }
        let cross = a.x * b.y - a.y * b.x;
        if if ccw { cross < 0.0 } else { cross > 0.0 } {
            best = best.min((dot(a, b) / (la * lb)).clamp(-1.0, 1.0).acos());
        }
    }
    best
}

/// Contacts of a lot whose outline changed (same rule as every other pass).
fn refresh(p: &mut Parcel, fronts: &[Front], layout: &Layout) {
    p.contacts = contacts::boundary_contacts(&p.shape, fronts)
        .iter()
        .map(|f| super::super::ParcelContact {
            a: f.a,
            b: f.b,
            street: f.street,
            rank: f.rank,
            length: length(sub(f.b, f.a)),
            kind: access_kind(f, layout).into(),
        })
        .collect();
}

fn witness_kept(p: &Parcel, shape: &Shape) -> bool {
    p.envelope
        .as_ref()
        .is_none_or(|e| difference(e, shape).iter().map(area).sum::<f64>() < 1e-3)
}

/// The sharpest convex corner of `shape` (index, interior angle) under the
/// tip limit with both sides at least 2 m long.
fn sharpest_tip(shape: &Shape) -> Option<(usize, f64)> {
    let r = &shape.outer;
    let n = r.len();
    if n < 4 {
        return None;
    }
    let ccw = super::super::geometry::signed(r) >= 0.0;
    let mut best: Option<(usize, f64)> = None;
    for i in 0..n {
        let (a, v, b) = (r[(i + n - 1) % n], r[i], r[(i + 1) % n]);
        let (ua, ub) = (sub(a, v), sub(b, v));
        let (la, lb) = (length(ua), length(ub));
        if la.min(lb) < 2.0 {
            continue;
        }
        let cross = ua.x * ub.y - ua.y * ub.x;
        // A ccw ring turns left (cross of a-v, b-v negative) at convex corners.
        let convex = if ccw { cross < 0.0 } else { cross > 0.0 };
        if !convex {
            continue;
        }
        let angle = (dot(ua, ub) / (la * lb)).clamp(-1.0, 1.0).acos();
        if angle < TIP_ANGLE.to_radians() && best.is_none_or(|(_, w)| angle < w) {
            best = Some((i, angle));
        }
    }
    best
}

/// Cut the needle tip at corner `i` of lot `k` and give it to the neighbour
/// it lies against. `false` when no neighbour can take it.
fn cut_tip(
    cells: &mut [Parcel],
    k: usize,
    i: usize,
    angle: f64,
    fronts: &[Front],
    layout: &Layout,
) -> bool {
    let r = cells[k].shape.outer.clone();
    let n = r.len();
    let (a, v, b) = (r[(i + n - 1) % n], r[i], r[(i + 1) % n]);
    let (ua, ub) = (unit(sub(a, v)), unit(sub(b, v)));
    let reach = 0.9 * length(sub(a, v)).min(length(sub(b, v)));
    let t = (TIP_WIDTH / (2.0 * (angle / 2.0).sin())).min(reach);
    let (p, q) = (add(v, scale(ua, t)), add(v, scale(ub, t)));
    let mut outer = Vec::with_capacity(n + 1);
    for (j, &c) in r.iter().enumerate() {
        if j == i {
            outer.push(p);
            outer.push(q);
        } else {
            outer.push(c);
        }
    }
    let rest = Shape {
        outer,
        holes: cells[k].shape.holes.clone(),
    };
    let tip = Shape {
        outer: vec![p, v, q],
        holes: Vec::new(),
    };
    // The cut is a clean one: the lot minus the tip, to the square millimetre
    // (a concave lot can fold the cut line across itself).
    if !super::super::geometry::simple(&rest)
        || (area(&rest) + area(&tip) - area(&cells[k].shape)).abs() > 1e-6
    {
        return false;
    }
    // The lot keeps its street frontage (the tip is never its access).
    if area(&rest) < 0.6 * area(&cells[k].shape)
        || !witness_kept(&cells[k], &rest)
        || frontage(&rest, fronts).0 + 0.5 < frontage(&cells[k].shape, fronts).0
    {
        return false;
    }
    let mut best: Option<(usize, f64)> = None;
    for (j, c) in cells.iter().enumerate() {
        if j == k || !open_lot(c) {
            continue;
        }
        let s = shared(&tip, &c.shape);
        if s >= 1.5 && best.is_none_or(|(_, w)| s > w) {
            best = Some((j, s));
        }
    }
    let Some((j, _)) = best else {
        return false;
    };
    let Some(union) = joined(&cells[j].shape, &tip) else {
        return false;
    };
    if (area(&union) - area(&cells[j].shape) - area(&tip)).abs() > 1e-6 {
        return false;
    }
    cells[k].shape = super::super::geometry::cleaned(&rest);
    cells[k].provenance.push("tip-trimmed".into());
    cells[j].shape = super::super::geometry::cleaned(&union);
    cells[j].provenance.push("tip-received".into());
    refresh(&mut cells[k], fronts, layout);
    refresh(&mut cells[j], fronts, layout);
    true
}

/// Invariant (no needle tip): a lot keeps no convex corner sharper than
/// `TIP_ANGLE` where it could be given to the neighbour beside it.
fn trim_tips(cells: &mut [Parcel], fronts: &[Front], layout: &Layout) {
    for k in 0..cells.len() {
        if !open_lot(&cells[k]) {
            continue;
        }
        for _ in 0..4 {
            let Some((i, angle)) = sharpest_tip(&cells[k].shape) else {
                break;
            };
            if !cut_tip(cells, k, i, angle, fronts, layout) {
                break;
            }
        }
    }
}

/// Invariant (no wedge, no sliver): rear land that is a wedge, and a lot too
/// thin to carry a house, join the lot beside them (the owner first) as long
/// as the union stays one ring within the depth bound; a degenerate lot with
/// nobody to join becomes open land of its own.
fn merge_slivers(
    cells: &mut Vec<Parcel>,
    fronts: &[Front],
    layout: &Layout,
    depth_limit: Option<f64>,
) {
    let mut i = 0;
    while i < cells.len() {
        let c = &cells[i];
        let kind = if c.use_kind == "garden"
            && matches!(
                c.reason.as_str(),
                "retained-backland" | "attached-rear-land"
            )
            && c.family != "reserve"
        {
            Some(true)
        } else if c.use_kind == "plot" && c.envelope.is_some() {
            Some(false)
        } else {
            None
        };
        let Some(garden) = kind else {
            i += 1;
            continue;
        };
        let (short, long, fill) = oriented(&c.shape);
        let bad = if garden {
            fill < WEDGE_FILL
                && area(&cells[i].shape) < WEDGE_AREA
                && pointed(&cells[i].shape) < WEDGE_POINT.to_radians()
        } else {
            short < HAIR_WIDTH || (short < THIN_WIDTH && long > THIN_ASPECT * short)
        };
        if !bad {
            i += 1;
            continue;
        }
        let rb = super::super::geometry::bbox(&c.shape);
        let mut near: Vec<(usize, f64, bool)> = cells
            .iter()
            .enumerate()
            .filter(|(j, p)| {
                *j != i && open_lot(p) && boxes_touch(rb, super::super::geometry::bbox(&p.shape))
            })
            .map(|(j, p)| {
                (
                    j,
                    shared(&cells[i].shape, &p.shape),
                    cells[i].parent_ids.contains(&p.id),
                )
            })
            .filter(|&(j, s, _)| {
                s >= if garden { 1.5 } else { 3.0 } && (garden || cells[j].use_kind == "plot")
            })
            .collect();
        near.sort_by(|a, b| b.2.cmp(&a.2).then(b.1.total_cmp(&a.1)).then(a.0.cmp(&b.0)));
        let target = near.iter().find_map(|&(j, _, _)| {
            let u = joined(&cells[i].shape, &cells[j].shape)?;
            if (area(&u) - area(&cells[i].shape) - area(&cells[j].shape)).abs() > 1e-3 {
                return None;
            }
            // Never worse shaped than the lot it joins: a union that is a mere
            // frame around a hole of other lots is no tidier than the wedge.
            let shape_ok =
                oriented(&u).2 >= 0.55 || oriented(&u).2 + 0.05 >= oriented(&cells[j].shape).2;
            (shape_ok
                && reach(&u, &cells[j], fronts, depth_limit)
                && balanced(cells, &u, i, j)
                && u.holes.len() <= cells[j].shape.holes.len() + cells[i].shape.holes.len())
            .then_some((j, u))
        });
        match target {
            Some((j, union)) => {
                let id = cells[i].id.clone();
                let tag = if garden {
                    "wedge-merged"
                } else {
                    "sliver-merged"
                };
                cells[j].shape = super::super::geometry::cleaned(&union);
                cells[j].parent_ids.push(id);
                cells[j].provenance.push(tag.into());
                refresh(&mut cells[j], fronts, layout);
                cells.remove(i);
                i = i.saturating_sub(1).min(cells.len());
            }
            None => {
                let degenerate = cells[i].provenance.iter().any(|x| x == "degenerate-lot");
                if !garden && degenerate && short < THIN_WIDTH {
                    let street = cells[i].access.as_ref().and_then(|a| a.street);
                    let p = &mut cells[i];
                    p.use_kind = "garden".into();
                    p.reason = "retained-backland".into();
                    p.envelope = None;
                    p.front = None;
                    p.provenance.push("thin-strip".into());
                    p.provenance.push("dense-leftover".into());
                    p.access = Some(super::super::ParcelAccess {
                        kind: "attached".into(),
                        street,
                        front_length: 0.0,
                    });
                }
                i += 1;
            }
        }
    }
}

/// The union stays within the depth bound of the lot it joins.
fn reach(s: &Shape, p: &Parcel, fronts: &[Front], depth_limit: Option<f64>) -> bool {
    depth_limit
        .is_none_or(|limit| p.use_kind != "plot" || lot_depth(s, fronts) <= 1.25 * limit + 0.5)
}

/// The union `u` of lots `i` and `j` must not become 3x a neighbour lot of
/// similar frontage (no new unbalanced pair).
fn balanced(cells: &[Parcel], u: &Shape, i: usize, j: usize) -> bool {
    let (au, front) = (
        area(u),
        cells[j].access.as_ref().map_or(0.0, |a| a.front_length),
    );
    let ub = super::super::geometry::bbox(u);
    cells.iter().enumerate().all(|(k, p)| {
        let f = p.access.as_ref().map_or(0.0, |a| a.front_length);
        k == i
            || k == j
            || p.use_kind != "plot"
            || cells[j].use_kind != "plot"
            || f.min(front) <= 0.0
            || f.max(front) > 1.5 * f.min(front)
            || !boxes_touch(ub, super::super::geometry::bbox(&p.shape))
            || shared(u, &p.shape) < 1.0
            || au < 3.0 * area(&p.shape)
    })
}

/// Invariant (no new small lot beside a big one in a dense zone): a degenerate,
/// polygonal or trimmed lot under a third of a neighbour of similar frontage
/// joins that neighbour (whose witness it contains) when the union keeps the
/// depth bound and unbalances nobody else.
fn fold_small(
    cells: &mut Vec<Parcel>,
    fronts: &[Front],
    layout: &Layout,
    depth_limit: Option<f64>,
) {
    let odd = |p: &Parcel| {
        p.provenance.iter().any(|x| {
            matches!(
                x.as_str(),
                "degenerate-lot" | "polygonal-lot" | "tip-trimmed" | "residual-absorbed"
            )
        })
    };
    let mut i = 0;
    while i < cells.len() {
        let c = &cells[i];
        if c.use_kind != "plot" || c.envelope.is_none() || !odd(c) {
            i += 1;
            continue;
        }
        let front = c.access.as_ref().map_or(0.0, |a| a.front_length);
        let rb = super::super::geometry::bbox(&c.shape);
        let mut near: Vec<(usize, f64)> = cells
            .iter()
            .enumerate()
            .filter(|(j, p)| {
                let f = p.access.as_ref().map_or(0.0, |a| a.front_length);
                *j != i
                    && p.use_kind == "plot"
                    && p.envelope.is_some()
                    && area(&p.shape) >= 3.0 * area(&cells[i].shape)
                    && front.min(f) > 0.0
                    && front.max(f) <= 1.5 * front.min(f)
                    && boxes_touch(rb, super::super::geometry::bbox(&p.shape))
            })
            .map(|(j, p)| (j, shared(&cells[i].shape, &p.shape)))
            .filter(|&(_, s)| s >= 1.0)
            .collect();
        near.sort_by(|a, b| b.1.total_cmp(&a.1).then(a.0.cmp(&b.0)));
        let target = near.iter().find_map(|&(j, _)| {
            let u = joined(&cells[i].shape, &cells[j].shape)?;
            if (area(&u) - area(&cells[i].shape) - area(&cells[j].shape)).abs() > 1e-3 {
                return None;
            }
            (oriented(&u).2 + 0.05 >= oriented(&cells[j].shape).2
                && reach(&u, &cells[j], fronts, depth_limit)
                && balanced(cells, &u, i, j))
            .then_some((j, u))
        });
        let Some((j, union)) = target else {
            i += 1;
            continue;
        };
        let id = cells[i].id.clone();
        cells[j].shape = super::super::geometry::cleaned(&union);
        cells[j].parent_ids.push(id);
        cells[j].provenance.push("pair-merged".into());
        refresh(&mut cells[j], fronts, layout);
        cells.remove(i);
        i = i.saturating_sub(1).min(cells.len());
    }
}

pub(super) fn tidy(
    cells: &mut Vec<Parcel>,
    fronts: &[Front],
    layout: &Layout,
    depth_limit: Option<f64>,
    organic: bool,
    dense: bool,
) {
    // A/B: URBAN_TIDY=off leaves the lots as the other passes drew them.
    if std::env::var("URBAN_TIDY").is_ok_and(|v| v == "off") {
        return;
    }
    for p in cells.iter_mut() {
        p.shape = super::super::geometry::cleaned(&p.shape);
    }
    if organic {
        return;
    }
    trim_tips(cells, fronts, layout);
    merge_slivers(cells, fronts, layout, depth_limit);
    if dense {
        fold_small(cells, fronts, layout, depth_limit);
    }
}
