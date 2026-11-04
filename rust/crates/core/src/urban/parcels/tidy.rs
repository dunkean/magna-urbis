//! Final tidy of a block's lots: no hairlines, no needle tips, no wedge or
//! sliver lots, no long thin arm. Every operation moves ground between lots of
//! one block (the block keeps its exact coverage) and never takes a lot's
//! witness away.
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

/// Solidity (area over convex hull area) under which a lot is looked at for an
/// arm, when the catalogue's `lotSolidity` says nothing of its culture or tissue.
pub(super) const LOT_SOLIDITY: f64 = 0.8;
/// A cut must raise the solidity of the part kept by at least this much.
const ARM_GAIN: f64 = 0.04;
/// Neither side of a cut is smaller than this (m2).
const ARM_AREA: f64 = 6.0;
/// Longest cut (m), and the distance (m) at which a corner is read, so that a
/// jog of the street ribbon is no corner.
const ARM_CHORD: f64 = 30.0;
const ARM_LOOK: f64 = 1.5;
/// A corner turning back by less than this sine is no corner (about 10 degrees).
const ARM_TURN: f64 = 0.17;
/// An arm of a built lot is long (aspect) and thin: under `ARM_WIDTH` metres, or
/// under `ARM_WIDTH_SHARE` of the width of what is kept. Anything wider is a
/// real L, a corner lot, and stays.
const ARM_ASPECT: f64 = 1.6;
const ARM_WIDTH: f64 = 7.0;
const ARM_WIDTH_SHARE: f64 = 0.7;
/// Arms cut from one built lot, and from one garden (back land has more of them).
const LOT_ARMS: usize = 4;
const GARDEN_ARMS: usize = 8;
/// Work bounds: a longer ring (a river bank, a whole rural block) is not searched,
/// and no ring tries more corners than this, so a pass costs the same on any
/// ground. The largest block ring of 24 captured towns has 415 vertices.
const ARM_RING: usize = 512;
const ARM_CORNERS: usize = 24;
/// Slices of one arm, and ring vertices one block may visit in the arm search.
/// Past the budget the lots stay as they are: an arm is a blemish, not a fault.
const ARM_PIECES: usize = 12;
const ARM_WORK: usize = 4_000_000;
/// A walk along a ring gives up after this many sides of a few millimetres.
const WALK_STEPS: usize = 64;
/// An out-and-back spike holding less than this (m2) is a hairline of the
/// overlay, not ground: the same measure as the holes `cleaned` drops.
const NEEDLE: f64 = 1e-4;

/// What the final passes need from the lot's own admission tier.
pub(super) struct Rules<'a> {
    pub(super) floor: f64,
    /// `shape` keeps the surface and an entry of the lot's tier.
    pub(super) admits: &'a dyn Fn(&Parcel, &Shape) -> bool,
    /// Rebuilds a lot's contacts, front, rank, street, access and corner mark.
    pub(super) reseat: &'a dyn Fn(&mut Parcel),
}

fn open_lot(p: &Parcel) -> bool {
    matches!(p.use_kind.as_str(), "plot" | "garden") && p.family != "reserve"
}

/// (short side, long side, fill) of the smallest oriented box around the lot.
/// That box lies on a side of the convex hull: only the hull is scanned.
pub(super) fn oriented(s: &Shape) -> (f64, f64, f64) {
    use geo::ConvexHull;
    let hull = super::super::geometry::polygon(s).convex_hull();
    let r: Vec<Point> = hull
        .exterior()
        .0
        .iter()
        .take(hull.exterior().0.len().saturating_sub(1))
        .map(|c| Point { x: c.x, y: c.y })
        .collect();
    let n = r.len();
    let mut best = (f64::MAX, 0.0, 0.0);
    for i in 0..n {
        let d = sub(r[(i + 1) % n], r[i]);
        if length(d) < 1e-6 {
            continue;
        }
        let (u, v) = (unit(d), normal(unit(d)));
        let (mut x0, mut x1, mut y0, mut y1) = (f64::MAX, f64::MIN, f64::MAX, f64::MIN);
        for p in &r {
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
    let mut best = std::f64::consts::PI;
    for i in 0..n {
        let (a, b) = (sub(along(r, i, -1, 3.0), r[i]), sub(along(r, i, 1, 3.0), r[i]));
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

/// The point `dist` metres from corner `i` along the ring, walking by `step`.
fn along(r: &[Point], i: usize, step: isize, dist: f64) -> Point {
    let n = r.len();
    let mut at = r[i];
    let mut left = dist;
    let mut k = i;
    for _ in 0..n.min(WALK_STEPS) {
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
}

/// Contacts alone, for the tests that run these passes outside `generate`.
#[cfg(test)]
pub(super) fn refresh(p: &mut Parcel, fronts: &[Front], layout: &Layout) {
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
    rules: &Rules,
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
    if concave_join(&union, &tip, &cells[j].shape, rules.floor) {
        return false;
    }
    cells[k].shape = super::super::geometry::cleaned(&rest);
    cells[k].provenance.push("tip-trimmed".into());
    cells[j].shape = super::super::geometry::cleaned(&union);
    cells[j].provenance.push("tip-received".into());
    (rules.reseat)(&mut cells[k]);
    (rules.reseat)(&mut cells[j]);
    true
}

/// Invariant (no needle tip): a lot keeps no convex corner sharper than
/// `TIP_ANGLE` where it could be given to the neighbour beside it.
fn trim_tips(cells: &mut [Parcel], fronts: &[Front], rules: &Rules) {
    for k in 0..cells.len() {
        if !open_lot(&cells[k]) {
            continue;
        }
        for _ in 0..4 {
            let Some((i, angle)) = sharpest_tip(&cells[k].shape) else {
                break;
            };
            if !cut_tip(cells, k, i, angle, fronts, rules) {
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
    depth_limit: Option<f64>,
    rules: &Rules,
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
                && !concave_join(&u, &cells[i].shape, &cells[j].shape, rules.floor)
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
                (rules.reseat)(&mut cells[j]);
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
    depth_limit: Option<f64>,
    rules: &Rules,
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
                && !concave_join(&u, &cells[i].shape, &cells[j].shape, rules.floor)
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
        (rules.reseat)(&mut cells[j]);
        cells.remove(i);
        i = i.saturating_sub(1).min(cells.len());
    }
}

/// The share of its convex hull a shape fills: 1 for a convex lot, about 0.45
/// for a lot hooked around its neighbours.
pub(super) fn solidity(s: &Shape) -> f64 {
    use geo::{Area, ConvexHull};
    let hull = super::super::geometry::polygon(s).convex_hull().unsigned_area();
    if hull <= 1e-9 {
        1.0
    } else {
        (area(s) / hull).min(1.0)
    }
}

/// The solidity floor of a block's lots: the catalogue's `lotSolidity`, by
/// culture first (a Roman atrium lot stays a rectangle), then by tissue (court
/// and compound lots are meant to be irregular), then its default.
pub(super) fn solidity_floor(culture: &str, plot_op: &str) -> f64 {
    let table = &super::super::catalogue()["lotSolidity"];
    table["cultures"][culture]
        .as_f64()
        .or_else(|| table["tissues"][plot_op].as_f64())
        .or_else(|| table["default"].as_f64())
        .unwrap_or(LOT_SOLIDITY)
}

/// The floor set on a block's morph by `generate`.
pub(super) fn floor_of(morph: &Morph) -> f64 {
    morph.number_or("_lotSolidity", LOT_SOLIDITY)
}

/// True when `union` of `a` and `b` is a concave shape neither part was: under
/// the floor and clearly less solid than the worse of the two.
pub(super) fn concave_join(union: &Shape, a: &Shape, b: &Shape, floor: f64) -> bool {
    let s = solidity(union);
    s < floor && s + 0.02 < solidity(a).min(solidity(b))
}

/// `r` without its out-and-back spikes of no real surface, in linear time: each
/// vertex is pushed once and popped at most once, the seam by a few more passes.
fn despiked(r: &[Point]) -> Vec<Point> {
    let hairline = |a: Point, b: Point, c: Point| {
        let (u, v) = (sub(b, a), sub(c, b));
        dot(u, v) < 0.0 && 0.5 * (u.x * v.y - u.y * v.x).abs() <= NEEDLE
    };
    let mut q: Vec<Point> = r.to_vec();
    for _ in 0..3 {
        let before = q.len();
        let mut out: Vec<Point> = Vec::with_capacity(q.len());
        for &p in &q {
            while out.len() >= 2 && hairline(out[out.len() - 2], out[out.len() - 1], p) {
                out.pop();
            }
            out.push(p);
        }
        while out.len() > 3 && hairline(out[out.len() - 2], out[out.len() - 1], out[0]) {
            out.pop();
        }
        while out.len() > 3 && hairline(out[out.len() - 1], out[0], out[1]) {
            out.remove(0);
        }
        q = out;
        if q.len() == before {
            break;
        }
    }
    q
}

/// The same ground without repeated vertices and without hairlines. The lot
/// stays as it was unless the outline is what it should be: a simple ring of the
/// same surface, holes still inside it.
fn tidied(s: &Shape) -> Shape {
    let mut c = super::super::geometry::cleaned(s);
    let outer = despiked(&c.outer);
    if outer.len() == c.outer.len() || outer.len() < 3 {
        return c;
    }
    let bare = ring(outer.clone());
    let same = (area(&ring(c.outer.clone())) - area(&bare)).abs() <= 10.0 * NEEDLE;
    if same
        && c.holes
            .iter()
            .all(|h| h.iter().all(|p| super::super::geometry::contains(&bare, *p)))
    {
        c.outer = outer;
    }
    c
}

fn ring(outer: Vec<Point>) -> Shape {
    Shape {
        outer,
        holes: Vec::new(),
    }
}

fn on_ring(p: Point, r: &[Point]) -> bool {
    (0..r.len()).any(|i| super::super::geometry::distance(p, r[i], r[(i + 1) % r.len()]).0 < 0.03)
}

/// Geometric order of two points, whatever the ring's start.
fn by_place(a: Point, b: Point) -> std::cmp::Ordering {
    a.x.total_cmp(&b.x).then(a.y.total_cmp(&b.y))
}

/// Corners where the outline turns back into the lot, read at `ARM_LOOK` metres:
/// the sharpest ones, at least 0.4 m apart, the same on any start of the ring.
fn reflex_corners(r: &[Point]) -> Vec<usize> {
    let ccw = super::super::geometry::signed(r) >= 0.0;
    let mut all: Vec<(f64, usize)> = (0..r.len())
        .filter_map(|i| {
            let a = unit(sub(r[i], along(r, i, -1, ARM_LOOK)));
            let b = unit(sub(along(r, i, 1, ARM_LOOK), r[i]));
            let turn = a.x * b.y - a.y * b.x;
            let turn = if ccw { turn } else { -turn };
            // Millidegree-scale noise must not reorder equal corners.
            (turn < -ARM_TURN).then_some(((turn * 1e6).round(), i))
        })
        .collect();
    all.sort_by(|a, b| a.0.total_cmp(&b.0).then(by_place(r[a.1], r[b.1])));
    let mut out: Vec<usize> = Vec::new();
    for (_, i) in all {
        if out.iter().all(|&p| length(sub(r[i], r[p])) > 0.4) {
            out.push(i);
            if out.len() == ARM_CORNERS {
                break;
            }
        }
    }
    out
}

/// A straight cut from corner `from` to the point `to` of side `edge`.
struct Chord {
    from: usize,
    edge: usize,
    to: Point,
    length: f64,
}

/// First side hit by the ray from corner `from` along `d`.
fn ray_hit(r: &[Point], d: Point, from: usize) -> Option<Chord> {
    let n = r.len();
    let o = r[from];
    let mut best: Option<Chord> = None;
    for k in 0..n {
        if k == from || (k + 1) % n == from {
            continue;
        }
        let (b, e) = (r[k], sub(r[(k + 1) % n], r[k]));
        let den = d.x * e.y - d.y * e.x;
        if den.abs() < 1e-10 {
            continue;
        }
        let v = sub(b, o);
        let t = (v.x * e.y - v.y * e.x) / den;
        let s = (v.x * d.y - v.y * d.x) / den;
        if t > 0.02
            && (-1e-9..=1.0 + 1e-9).contains(&s)
            && best.as_ref().is_none_or(|c| t < c.length)
        {
            best = Some(Chord {
                from,
                edge: k,
                to: add(b, scale(e, s.clamp(0.0, 1.0))),
                length: t,
            });
        }
    }
    best
}

/// Candidate cuts of a ring. From each reflex corner: the prolongation of its
/// two sides (the cut continues a limit that exists) and the four nearest
/// points of the other sides (the neck). A cut ends anywhere on a side.
fn chords(r: &[Point]) -> Vec<Chord> {
    let n = r.len();
    let mut out = Vec::new();
    for i in reflex_corners(r) {
        for step in [-1, 1] {
            let d = unit(sub(r[i], along(r, i, step, ARM_LOOK)));
            if let Some(c) = ray_hit(r, d, i)
                && c.length <= ARM_CHORD
            {
                out.push(c);
            }
        }
        let mut necks: Vec<Chord> = (0..n)
            .filter(|&e| e != i && (e + 1) % n != i)
            .filter_map(|edge| {
                let (length, _, to) =
                    super::super::geometry::distance(r[i], r[edge], r[(edge + 1) % n]);
                (length > 0.8 && length <= ARM_CHORD).then_some(Chord {
                    from: i,
                    edge,
                    to,
                    length,
                })
            })
            .collect();
        necks.sort_by(|a, b| a.length.total_cmp(&b.length).then(by_place(a.to, b.to)));
        necks.truncate(4);
        out.extend(necks);
    }
    out
}

/// The chord stays inside the ring and crosses none of its sides.
fn clear(s: &Shape, c: &Chord) -> bool {
    let r = &s.outer;
    let n = r.len();
    let a = r[c.from];
    let side = |p: Point, q: Point, x: Point| {
        let (u, v) = (sub(q, p), sub(x, p));
        u.x * v.y - u.y * v.x
    };
    super::super::geometry::contains(s, scale(add(a, c.to), 0.5))
        && (0..n).all(|k| {
            let (p, q) = (r[k], r[(k + 1) % n]);
            k == c.edge
                || k == c.from
                || (k + 1) % n == c.from
                || side(a, c.to, p) * side(a, c.to, q) >= -1e-7
                || side(p, q, a) * side(p, q, c.to) >= -1e-7
        })
}

/// The two rings on either side of a chord (exact: no boolean operation).
fn split_ring(r: &[Point], c: &Chord) -> (Vec<Point>, Vec<Point>) {
    let n = r.len();
    let (mut first, mut second) = (Vec::new(), vec![c.to]);
    let mut k = c.from;
    loop {
        first.push(r[k]);
        if k == c.edge {
            break;
        }
        k = (k + 1) % n;
    }
    first.push(c.to);
    k = (c.edge + 1) % n;
    loop {
        second.push(r[k]);
        if k == c.from {
            break;
        }
        k = (k + 1) % n;
    }
    (first, second)
}

/// The cuts of `s` that lift the kept side's solidity, best first: a solid
/// kept part, a solid arm, a short chord. `keep_first` names the kept side;
/// `thin` keeps only long thin arms. Returns (kept, arm) pairs.
fn cuts(s: &Shape, thin: bool, keep_first: &dyn Fn(&Shape, &Shape) -> bool) -> Vec<(Shape, Shape)> {
    if s.outer.len() > ARM_RING {
        return Vec::new();
    }
    let whole = area(s);
    let before = solidity(s);
    let mut found: Vec<(f64, Point, Point, Shape, Shape)> = Vec::new();
    for c in chords(&s.outer) {
        if !clear(s, &c) {
            continue;
        }
        let (a, b) = split_ring(&s.outer, &c);
        let (a, b) = (ring(a), ring(b));
        let (aa, ab) = (area(&a), area(&b));
        if aa.min(ab) < ARM_AREA || (aa + ab - whole).abs() > 1e-6 * whole.max(1.0) {
            continue;
        }
        let (keep, arm) = if keep_first(&a, &b) { (a, b) } else { (b, a) };
        let kept = solidity(&keep);
        if kept < before + ARM_GAIN {
            continue;
        }
        if thin {
            let (width, long, _) = oriented(&arm);
            let wide = oriented(&keep).0;
            if long < ARM_ASPECT * width || (width > ARM_WIDTH && width > ARM_WIDTH_SHARE * wide) {
                continue;
            }
        }
        let score = kept + 0.5 * solidity(&arm) - 0.01 * c.length;
        found.push((score, s.outer[c.from], c.to, keep, arm));
    }
    found.sort_by(|a, b| {
        b.0.total_cmp(&a.0)
            .then(by_place(a.1, b.1))
            .then(by_place(a.2, b.2))
    });
    found.into_iter().map(|(_, _, _, k, a)| (k, a)).collect()
}

/// Source rule of `strips`: a frontage territory without the long thin arms it
/// only reaches through its own end. The arm is not lost, it stays available.
pub(super) fn without_arms(mut territory: Shape, run: &[Front], floor: f64) -> Shape {
    for _ in 0..LOT_ARMS {
        if !territory.holes.is_empty() || solidity(&territory) >= floor {
            break;
        }
        let whole = frontage(&territory, run).0;
        let keep = cuts(&territory, true, &|a, b| {
            frontage(a, run).0 >= frontage(b, run).0
        })
        .into_iter()
        .find(|(k, _)| frontage(k, run).0 >= 0.9 * whole);
        let Some((keep, _)) = keep else {
            break;
        };
        territory = keep;
    }
    territory
}

/// Land an arm can be dealt to, and lots that can shed one.
fn plain_lot(p: &Parcel) -> bool {
    open_lot(p) && p.shape.holes.is_empty()
}

fn sheds_arms(p: &Parcel) -> bool {
    plain_lot(p)
        && match p.use_kind.as_str() {
            "plot" => p.envelope.is_some(),
            _ => matches!(
                p.reason.as_str(),
                "retained-backland" | "attached-rear-land"
            ),
        }
}

/// The best cut of a lot under the floor. A built lot keeps its witness and
/// what its tier asks of a lot, or stays whole; a garden keeps its larger side.
fn cut_of(p: &Parcel, rules: &Rules) -> Option<(Shape, Shape)> {
    let Some(envelope) = p.envelope.as_ref().filter(|_| p.use_kind == "plot") else {
        return cuts(&p.shape, false, &|a, b| area(a) >= area(b))
            .into_iter()
            .next();
    };
    let inside = super::super::geometry::centroid(envelope);
    cuts(&p.shape, true, &|a, _| {
        super::super::geometry::contains(a, inside)
    })
    .into_iter()
    .find(|(keep, _)| witness_kept(p, keep) && (rules.admits)(p, keep))
}

/// `arm` cut along the party walls of its neighbours: each wall that ends on
/// the arm is prolonged across it, so every neighbour faces its own slice.
fn slices(arm: Shape, walls: &[&[Point]]) -> Vec<Shape> {
    let whole = area(&arm);
    let (x0, y0, x1, y1) = super::super::geometry::bbox(&arm);
    let mut pieces = vec![arm.clone()];
    let mut seen: Vec<Point> = Vec::new();
    for r in walls.iter().filter(|r| r.len() <= ARM_RING) {
        for i in 0..r.len() {
            let w = r[i];
            if pieces.len() >= ARM_PIECES
                || w.x < x0 - 0.05
                || w.x > x1 + 0.05
                || w.y < y0 - 0.05
                || w.y > y1 + 0.05
                || !pieces.iter().any(|p| on_ring(w, &p.outer))
            {
                continue;
            }
            for step in [-1, 1] {
                let back = along(r, i, step, 3.0);
                let on_arm = |x: Point| pieces.iter().any(|p| on_ring(x, &p.outer));
                if length(sub(back, w)) < 1.0
                    || on_arm(back)
                    || on_arm(scale(add(back, w), 0.5))
                    || seen.iter().any(|s| length(sub(*s, w)) < 0.5)
                {
                    continue;
                }
                let d = unit(sub(w, back));
                let probe = add(w, scale(d, 0.1));
                let Some(at) = pieces.iter().position(|p| {
                    on_ring(w, &p.outer) && super::super::geometry::contains(p, probe)
                }) else {
                    continue;
                };
                let outer = &pieces[at].outer;
                let n = outer.len();
                // The wall meets the arm on its nearest side, at its projection
                // there: the side keeps its line, the arm its outline.
                let Some((e, foot)) = (0..n)
                    .map(|e| {
                        let d = super::super::geometry::distance(w, outer[e], outer[(e + 1) % n]);
                        (e, d.0, d.2)
                    })
                    .min_by(|a, b| a.1.total_cmp(&b.1).then(a.0.cmp(&b.0)))
                    .map(|(e, _, foot)| (e, foot))
                else {
                    continue;
                };
                let mut q = outer.clone();
                q.insert(e + 1, foot);
                let Some(c) = ray_hit(&q, d, e + 1) else {
                    continue;
                };
                let host = ring(q);
                if !clear(&host, &c) {
                    continue;
                }
                let (a, b) = split_ring(&host.outer, &c);
                let (a, b) = (ring(a), ring(b));
                let (aa, ab) = (area(&a), area(&b));
                if aa < 1.0
                    || ab < 1.0
                    || (aa + ab - area(&pieces[at])).abs() > 1e-6 * whole.max(1.0)
                    || !super::super::geometry::simple(&a)
                    || !super::super::geometry::simple(&b)
                {
                    continue;
                }
                pieces[at] = a;
                pieces.push(b);
                seen.push(w);
            }
        }
    }
    // The slices are the arm, or the arm stays whole.
    let total: f64 = pieces.iter().map(area).sum();
    if (total - whole).abs() > 1e-6 * whole.max(1.0) {
        return vec![arm];
    }
    pieces
}

/// Lot `k` keeps `keep`; each slice of `arm` joins the neighbour it faces when
/// that one stays solid and within its depth bound, else it is a garden of its
/// own, attached to the lot it came from. Back land stays back land: a garden
/// is only sliced, or joined to another garden, so a built lot never grows out
/// of proportion with its house.
#[allow(clippy::too_many_arguments)]
fn deal_arm(
    cells: &mut Vec<Parcel>,
    k: usize,
    keep: Shape,
    arm: Shape,
    fronts: &[Front],
    depth_limit: Option<f64>,
    rules: &Rules,
) {
    let rear = cells[k].use_kind != "plot";
    cells[k].shape = tidied(&keep);
    cells[k].provenance.push("arm-cut".into());
    (rules.reseat)(&mut cells[k]);
    let near = |cells: &[Parcel], s: &Shape| -> Vec<(usize, f64)> {
        let b = super::super::geometry::bbox(s);
        let mut out: Vec<(usize, f64)> = cells
            .iter()
            .enumerate()
            .filter(|(j, p)| {
                *j != k
                    && plain_lot(p)
                    && boxes_touch(b, super::super::geometry::bbox(&p.shape))
            })
            .map(|(j, p)| (j, shared(s, &p.shape)))
            .filter(|&(_, l)| l >= 0.5)
            .collect();
        out.sort_by(|a, b| b.1.total_cmp(&a.1).then(a.0.cmp(&b.0)));
        out
    };
    let pieces = {
        let around = near(&cells[..], &arm);
        let walls: Vec<&[Point]> = around
            .iter()
            .map(|&(j, _)| cells[j].shape.outer.as_slice())
            .collect();
        slices(arm, &walls)
    };
    for piece in pieces {
        let around = near(&cells[..], &piece);
        let target = around.iter().find_map(|&(j, _)| {
            if rear && cells[j].use_kind == "plot" {
                return None;
            }
            let u = joined(&cells[j].shape, &piece)?;
            let lot = &cells[j];
            (u.holes.is_empty()
                && (area(&u) - area(&lot.shape) - area(&piece)).abs() <= 1e-3
                && solidity(&u) >= rules.floor.min(solidity(&lot.shape))
                && reach(&u, lot, fronts, depth_limit)
                && balanced(cells, &u, k, j))
            .then_some((j, u))
        });
        if let Some((j, union)) = target {
            cells[j].shape = tidied(&union);
            cells[j].provenance.push("arm-received".into());
            (rules.reseat)(&mut cells[j]);
            continue;
        }
        // The lot the slice lies behind owns it (the lot it left, for an arm).
        let owner = around
            .iter()
            .map(|&(j, _)| &cells[j])
            .find(|p| rear && p.use_kind == "plot")
            .unwrap_or(&cells[k]);
        let mut garden = parcel(tidied(&piece), owner.block, owner.axis, &[], "garden");
        garden.family = owner.family.clone();
        garden.reason = "attached-rear-land".into();
        garden.parent_ids = vec![owner.id.clone()];
        garden.provenance.push("arm-garden".into());
        garden.access = Some(super::super::ParcelAccess {
            kind: "attached".into(),
            street: owner.access.as_ref().and_then(|a| a.street),
            front_length: 0.0,
        });
        (rules.reseat)(&mut garden);
        cells.push(garden);
    }
}

/// Invariant (no long thin arm): what source rules leave of a lot under the
/// solidity floor is cut at its neck, off the buildable witness, and dealt to
/// the neighbours along it. Only lots under the floor pay for the search, and
/// only their own block is looked at.
fn cut_arms(
    cells: &mut Vec<Parcel>,
    fronts: &[Front],
    depth_limit: Option<f64>,
    rules: &Rules,
) {
    // The arms dealt become lots to look at: both counts are bounded up front,
    // and so is the ring work of the whole block.
    let stop = 4 * cells.len() + 16;
    let mut budget = 2 * cells.len() + 16;
    let mut work = ARM_WORK;
    let mut k = 0;
    while k < cells.len() && k < stop && budget > 0 {
        if sheds_arms(&cells[k]) {
            let passes = if cells[k].use_kind == "plot" {
                LOT_ARMS
            } else {
                GARDEN_ARMS
            };
            for _ in 0..passes {
                if budget == 0 || solidity(&cells[k].shape) >= rules.floor {
                    break;
                }
                let cost = cells[k].shape.outer.len() * ARM_CORNERS * 6;
                if cost > work {
                    return;
                }
                work -= cost;
                let Some((keep, arm)) = cut_of(&cells[k], rules) else {
                    break;
                };
                budget -= 1;
                deal_arm(cells, k, keep, arm, fronts, depth_limit, rules);
            }
        }
        k += 1;
    }
}

pub(super) fn tidy(
    cells: &mut Vec<Parcel>,
    fronts: &[Front],
    depth_limit: Option<f64>,
    organic: bool,
    dense: bool,
    rules: &Rules,
) {
    // A/B: URBAN_TIDY=off leaves the lots as the other passes drew them.
    if std::env::var("URBAN_TIDY").is_ok_and(|v| v == "off") {
        return;
    }
    for p in cells.iter_mut() {
        let clean = tidied(&p.shape);
        let needled = clean.outer.len() != p.shape.outer.len();
        p.shape = clean;
        // A hairline can carry a phantom street contact all around a lot: back
        // land framed that way loses the front it never really had.
        if needled {
            (rules.reseat)(p);
        }
    }
    if organic {
        return;
    }
    trim_tips(cells, fronts, rules);
    merge_slivers(cells, fronts, depth_limit, rules);
    if dense {
        fold_small(cells, fronts, depth_limit, rules);
    }
    cut_arms(cells, fronts, depth_limit, rules);
}

#[cfg(test)]
mod tests {
    use super::super::super::Street;
    use super::*;
    use serde_json::json;

    fn at(x: f64, y: f64) -> Point {
        Point { x, y }
    }
    fn square(x0: f64, y0: f64, x1: f64, y1: f64) -> Shape {
        ring(vec![at(x0, y0), at(x1, y0), at(x1, y1), at(x0, y1)])
    }

    /// The `lot-u.png` defect: a corner lot whose arm climbs behind two
    /// neighbours. The street ribbon's jog no longer ends the frontage, and
    /// the arm goes to the neighbours, along the prolongation of their wall.
    #[test]
    fn arm_is_cut_at_its_neck_and_dealt_along_party_walls() {
        let front = |a: Point, b: Point| Front {
            a,
            b,
            rank: 1,
            street: 0,
            shared: false,
            gate: false,
        };
        let jogged = [
            front(at(0.0, 0.0), at(12.0, 0.0)),
            front(at(12.0, 0.0), at(12.0, 0.001)),
            front(at(12.1, 0.0), at(24.0, 0.0)),
        ];
        assert_eq!(street_runs(&jogged).len(), 1);

        let mut layout: Layout = serde_json::from_value(json!({
            "key": "arm", "culture": "european-organic", "center": {"x": 0.0, "y": 0.0},
            "quarters": [], "blocks": [], "warnings": [], "streets": []
        }))
        .unwrap();
        layout.streets = vec![Street {
            path: vec![at(0.0, -3.0), at(60.0, -3.0)],
            widths: vec![6.0; 2],
            rank: 1,
            role: "street".into(),
        }];
        let fronts = [front(at(0.0, 0.0), at(60.0, 0.0))];
        let lot = |outer: Vec<Point>, envelope: Shape| {
            let mut p = parcel(ring(outer), 0, at(1.0, 0.0), &fronts, "plot");
            p.envelope = Some(envelope);
            p
        };
        let hooked = vec![
            at(40.0, 0.0),
            at(60.0, 0.0),
            at(60.0, 40.0),
            at(52.0, 40.0),
            at(52.0, 15.0),
            at(40.0, 15.0),
        ];
        let beside = vec![
            at(0.0, 0.0),
            at(40.0, 0.0),
            at(40.0, 15.0),
            at(52.0, 15.0),
            at(52.0, 27.0),
            at(0.0, 27.0),
        ];
        let behind = square(0.0, 27.0, 52.0, 40.0).outer;
        let mut cells = vec![
            lot(hooked, square(42.0, 1.0, 58.0, 12.0)),
            lot(beside, square(2.0, 1.0, 30.0, 12.0)),
            lot(behind, square(2.0, 28.0, 30.0, 39.0)),
        ];
        let before: f64 = cells.iter().map(|p| area(&p.shape)).sum();
        assert!(solidity(&cells[0].shape) < LOT_SOLIDITY);

        let reseat = |p: &mut Parcel| refresh(p, &fronts, &layout);
        let rules = Rules {
            floor: LOT_SOLIDITY,
            admits: &|_, _| true,
            reseat: &reseat,
        };
        cut_arms(&mut cells, &fronts, None, &rules);

        assert_eq!(cells.len(), 3, "both slices joined a neighbour");
        assert!((area(&cells[0].shape) - 300.0).abs() < 1e-6, "the neck is y = 15");
        assert!((area(&cells[1].shape) - 1320.0).abs() < 1e-6);
        assert!((area(&cells[2].shape) - 780.0).abs() < 1e-6);
        assert!((cells.iter().map(|p| area(&p.shape)).sum::<f64>() - before).abs() < 1e-6);
        for p in &cells {
            assert!(solidity(&p.shape) >= LOT_SOLIDITY);
            assert!(witness_kept(p, &p.shape));
        }
    }

    /// Termination: however long and jagged the ground, the arm search does a
    /// bounded amount of work (a hard deadline, not a timing benchmark).
    #[test]
    fn arm_search_ends_on_a_long_jagged_ring() {
        let teeth = |n: usize| -> Shape {
            let mut outer = vec![at(0.0, 0.0), at(n as f64 * 4.0, 0.0)];
            for i in (0..n).rev() {
                let x = i as f64 * 4.0;
                outer.push(at(x + 3.0, 30.0));
                outer.push(at(x + 1.0, 8.0));
            }
            ring(outer)
        };
        let done = std::sync::mpsc::channel();
        std::thread::spawn(move || {
            let layout: Layout = serde_json::from_value(json!({
                "key": "teeth", "culture": "european-organic", "center": {"x": 0.0, "y": 0.0},
                "quarters": [], "blocks": [], "warnings": [], "streets": []
            }))
            .unwrap();
            for n in [100, 200, 2000] {
                let shape = teeth(n);
                let front = Front {
                    a: at(0.0, 0.0),
                    b: at(n as f64 * 4.0, 0.0),
                    rank: 1,
                    street: 0,
                    shared: false,
                    gate: false,
                };
                let mut garden = parcel(shape.clone(), 0, at(1.0, 0.0), &[], "garden");
                garden.reason = "retained-backland".into();
                let mut cells = vec![garden];
                let reseat = |p: &mut Parcel| refresh(p, &[], &layout);
                let rules = Rules {
                    floor: LOT_SOLIDITY,
                    admits: &|_, _| true,
                    reseat: &reseat,
                };
                cut_arms(&mut cells, &[], None, &rules);
                let total: f64 = cells.iter().map(|p| area(&p.shape)).sum();
                assert!((total - area(&shape)).abs() < 1e-3);
                without_arms(shape, &[front], LOT_SOLIDITY);
            }
            done.0.send(()).unwrap();
        });
        done.1
            .recv_timeout(std::time::Duration::from_secs(60))
            .expect("the arm search did not end");
    }
}
