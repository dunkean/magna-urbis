//! i_overlay geometry adapter; checked cuts distinguish failure from a valid empty result.
use super::geom::*;
use i_overlay::{
    core::{fill_rule::FillRule, overlay_rule::OverlayRule},
    float::single::SingleFloatOverlay,
};
#[derive(Clone, Copy)]
pub enum Op {
    Union,
    Intersection,
    Difference,
}
fn clean(mut pts: Polygon) -> Polygon {
    for _ in 0..6 {
        let n = pts.len();
        let mut out: Polygon = vec![];
        for q in pts {
            if out.last().is_some_and(|&p| dist(p, q) < 0.005) {
                continue;
            }
            out.push(q);
        }
        while out.len() > 2 && dist(out[0], *out.last().unwrap()) < 0.005 {
            out.pop();
        }
        if out.len() < 3 {
            return vec![];
        }
        let mut keep: Polygon = vec![];
        for i in 0..out.len() {
            let a = keep
                .last()
                .copied()
                .unwrap_or(out[(i + out.len() - 1) % out.len()]);
            let b = out[i];
            let c = out[(i + 1) % out.len()];
            let (ux, uy, vx, vy) = (b.x - a.x, b.y - a.y, c.x - b.x, c.y - b.y);
            let (lu, lv) = (ux.hypot(uy), vx.hypot(vy));
            if lu < 1e-9 || lv < 1e-9 {
                continue;
            }
            let (s, co) = (
                (ux * vy - uy * vx) / (lu * lv),
                (ux * vx + uy * vy) / (lu * lv),
            );
            let tri = 0.5 * (ux * vy - uy * vx).abs();
            if s.abs() < (0.5_f64.to_radians()).sin() && co > 0.0 && tri <= 0.002
                || co < -0.99 && tri < 0.05
            {
                continue;
            }
            keep.push(b);
        }
        pts = keep;
        if pts.len() < 3 {
            return vec![];
        }
        if pts.len() == n {
            break;
        }
    }
    if area(&pts).abs() < 1e-4 { vec![] } else { pts }
}
fn canonical(mut a: Polygon) -> Polygon {
    a = orient(a);
    if let Some((i, _)) = a
        .iter()
        .enumerate()
        .min_by(|(_, a), (_, b)| a.x.total_cmp(&b.x).then(a.y.total_cmp(&b.y)))
    {
        a.rotate_left(i);
    }
    a
}
// Validate after snapping: float adapters must never see NaNs, collapsed rings,
// duplicate closing points, or an unbounded extent (integer conversion overflow).
fn sanitize_ring(ring: &[Point], snap: f64) -> Option<Polygon> {
    if ring.len() < 3
        || ring
            .iter()
            .any(|p| !p.x.is_finite() || !p.y.is_finite() || p.x.abs() > 1e12 || p.y.abs() > 1e12)
    {
        return None;
    }
    let mut out = Vec::with_capacity(ring.len());
    for &pt in ring {
        let q = if snap > 0.0 {
            p(
                (pt.x * snap + 0.5).floor() / snap,
                (pt.y * snap + 0.5).floor() / snap,
            )
        } else {
            pt
        };
        if out.last() != Some(&q) {
            out.push(q);
        }
    }
    if out.first() == out.last() {
        out.pop();
    }
    (out.len() >= 3 && area(&out).is_finite() && area(&out).abs() > 0.0).then_some(out)
}
fn sanitize(a: &[Region], snap: f64) -> Vec<Region> {
    a.iter()
        .filter_map(|r| {
            Some(Region {
                outer: sanitize_ring(&r.outer, snap)?,
                holes: r
                    .holes
                    .iter()
                    .filter_map(|h| sanitize_ring(h, snap))
                    .collect(),
            })
        })
        .collect()
}
fn shapes(a: &[Region]) -> Vec<Vec<Vec<[f64; 2]>>> {
    a.iter()
        .map(|r| {
            std::iter::once(&r.outer)
                .chain(&r.holes)
                .enumerate()
                .map(|(i, r)| {
                    let mut ring = orient(r.clone());
                    if i > 0 {
                        ring.reverse();
                    }
                    ring.iter().map(|p| [p.x, p.y]).collect()
                })
                .collect()
        })
        .collect()
}
pub fn checked(
    a: &[Region],
    b: &[Region],
    op: Op,
    snapped: bool,
    preserve: bool,
) -> Result<Vec<Region>, ()> {
    run(a, b, op, if snapped { 1000.0 } else { 0.0 }, preserve)
}
fn run(a: &[Region], b: &[Region], op: Op, snap: f64, preserve: bool) -> Result<Vec<Region>, ()> {
    let a = sanitize(a, snap);
    let b = sanitize(b, snap);
    if a.is_empty() {
        return Ok(if matches!(op, Op::Union) {
            b.to_vec()
        } else {
            vec![]
        });
    }
    if b.is_empty() {
        return Ok(if matches!(op, Op::Intersection) {
            vec![]
        } else {
            a.to_vec()
        });
    }
    let aa = shapes(&a);
    let bb = shapes(&b);
    let rule = match op {
        Op::Union => OverlayRule::Union,
        Op::Intersection => OverlayRule::Intersect,
        Op::Difference => OverlayRule::Difference,
    };
    let result =
        std::panic::catch_unwind(|| aa.overlay(&bb, rule, FillRule::NonZero)).map_err(|_| ())?;
    let mut out = vec![];
    for rs in result {
        let mut rings = rs.into_iter().map(|r| {
            let p: Polygon = r
                .into_iter()
                .map(|[x, y]| {
                    if snap > 0.0 {
                        p(
                            (x * snap + 0.5).floor() / snap,
                            (y * snap + 0.5).floor() / snap,
                        )
                    } else {
                        p(x, y)
                    }
                })
                .collect();
            canonical(if preserve { p } else { clean(p) })
        });
        let Some(outer) = rings.next() else {
            continue;
        };
        if outer.len() < 3 || area(&outer).abs() < if preserve { 1e-6 } else { 0.01 } {
            continue;
        }
        let holes = rings
            .filter(|h| {
                h.len() >= 3 && area(h).abs() >= if preserve { f64::from_bits(1) } else { 0.01 }
            })
            .collect();
        out.push(Region { outer, holes });
    }
    out.sort_by(|a, b| {
        a.outer[0]
            .x
            .total_cmp(&b.outer[0].x)
            .then(a.outer[0].y.total_cmp(&b.outer[0].y))
    });
    Ok(out)
}
pub fn safe(a: &[Region], b: &[Region], op: Op) -> Vec<Region> {
    checked(a, b, op, true, false)
        .or_else(|_| run(a, b, op, 20.0, false))
        .unwrap_or_else(|_| {
            if matches!(op, Op::Union) {
                [a, b].concat()
            } else {
                vec![]
            }
        })
}
pub fn exact(a: &[Region], b: &[Region], op: Op) -> Result<Vec<Region>, ()> {
    checked(a, b, op, false, true)
}
pub fn union_many(a: &[Region]) -> Vec<Region> {
    union_pruned(a, |_| true)
}
pub fn union_pruned(a: &[Region], keep: impl Fn(&Region) -> bool) -> Vec<Region> {
    let mut cur: Vec<Vec<Region>> = a
        .iter()
        .filter(|r| r.outer.len() >= 3)
        .map(|r| if keep(r) { vec![r.clone()] } else { vec![] })
        .collect();
    if cur.is_empty() {
        return vec![];
    }
    while cur.len() > 1 {
        cur = cur
            .chunks(24)
            .map(|group| {
                let mut iter = group.iter().filter(|a| !a.is_empty());
                let Some(first) = iter.next() else {
                    return vec![];
                };
                let rest: Vec<Region> = iter.flat_map(|r| r.iter().cloned()).collect();
                if rest.is_empty() {
                    first.clone()
                } else {
                    safe(first, &rest, Op::Union)
                }
            })
            .collect();
    }
    cur.pop().unwrap_or_default()
}
pub fn retain(a: &[Region], b: &[Region], failures: &mut f64) -> Vec<Region> {
    if a.is_empty() || b.is_empty() {
        return a.to_vec();
    }
    match checked(a, b, Op::Difference, true, true) {
        Ok(r) => r,
        Err(()) => {
            *failures += 1.0;
            if b.len() == 1 {
                return a.to_vec();
            }
            let m = b.len() / 2;
            retain(&retain(a, &b[..m], failures), &b[m..], failures)
        }
    }
}
pub fn cuts_touching(r: &Region, cuts: &[Region]) -> Vec<Region> {
    let rb = bbox(&r.outer);
    let near: Vec<&Region> = cuts.iter().filter(|c| rb.meets(bbox(&c.outer))).collect();
    if near.len() <= 16 {
        return near.into_iter().cloned().collect();
    }
    let mut grid: super::hash::HashMap<(i32, i32), Vec<(Point, Point)>> =
        super::hash::HashMap::default();
    for ring in std::iter::once(&r.outer).chain(&r.holes) {
        for i in 0..ring.len() {
            let (a, b) = (ring[i], ring[(i + 1) % ring.len()]);
            let bb = bbox(&[a, b]);
            for y in (bb.y0 / 32.0).floor() as i32..=(bb.y1 / 32.0).floor() as i32 {
                for x in (bb.x0 / 32.0).floor() as i32..=(bb.x1 / 32.0).floor() as i32 {
                    grid.entry((x, y)).or_default().push((a, b));
                }
            }
        }
    }
    fn cross(a: Point, b: Point, c: Point, d: Point) -> bool {
        let orient =
            |p: Point, q: Point, r: Point| (q.x - p.x) * (r.y - p.y) - (q.y - p.y) * (r.x - p.x);
        let (d1, d2, d3, d4) = (
            orient(c, d, a),
            orient(c, d, b),
            orient(a, b, c),
            orient(a, b, d),
        );
        (d1 > 0.0) != (d2 > 0.0) && (d3 > 0.0) != (d4 > 0.0) || [d1, d2, d3, d4].contains(&0.0)
    }
    near.into_iter()
        .filter(|c| {
            if c.outer.first().is_some_and(|&p| inside(r, p)) {
                return true;
            }
            let bb = bbox(&c.outer);
            for y in (bb.y0 / 32.0).floor() as i32..=(bb.y1 / 32.0).floor() as i32 {
                for x in (bb.x0 / 32.0).floor() as i32..=(bb.x1 / 32.0).floor() as i32 {
                    if let Some(edges) = grid.get(&(x, y)) {
                        for &(a, b) in edges {
                            if !bb.meets(bbox(&[a, b])) {
                                continue;
                            }
                            if contains(&c.outer, a)
                                || contains(&c.outer, b)
                                || (0..c.outer.len()).any(|i| {
                                    cross(a, b, c.outer[i], c.outer[(i + 1) % c.outer.len()])
                                })
                            {
                                return true;
                            }
                        }
                    }
                }
            }
            false
        })
        .cloned()
        .collect()
}
pub fn clear_roads(a: &[Region], cuts: &[Region], failures: &mut f64) -> Vec<Region> {
    a.iter()
        .flat_map(|r| {
            let near = cuts_touching(r, cuts);
            if near.is_empty() {
                vec![r.clone()]
            } else {
                retain(&[r.clone()], &near, failures)
                    .into_iter()
                    .filter(|r| region_area(r) > 0.01)
                    .collect()
            }
        })
        .collect()
}
