//! Polygon cleanup, offsets, and insets for parcel footprints.

use super::*;

/// The ring without vertices lying within `tolerance` of the line through
/// their neighbours (repeated until none is left), at least a triangle.
pub(super) fn smoothed(ring: &[Point], tolerance: f64) -> Vec<Point> {
    let mut out = ring.to_vec();
    let mut changed = true;
    while changed && out.len() > 3 {
        changed = false;
        let mut i = 0;
        while i < out.len() && out.len() > 3 {
            let n = out.len();
            let (a, v, c) = (out[(i + n - 1) % n], out[i], out[(i + 1) % n]);
            if distance(v, a, c) < tolerance {
                out.remove(i);
                changed = true;
            } else {
                i += 1;
            }
        }
    }
    out
}

/// `ring` offset by `d` (negative: inwards), corners mitred down to 25
/// degrees (sharper ones bevelled), every component as an outer ring.
pub(super) fn offset(ring: &[Point], d: f64) -> Vec<Vec<Point>> {
    use geo::algorithm::buffer::{Buffer, BufferStyle, LineJoin};
    let poly = super::super::super::geometry::polygon(&Shape {
        outer: ring.to_vec(),
        holes: vec![],
    });
    let style = BufferStyle::new(d).line_join(LineJoin::Miter(25f64.to_radians()));
    super::super::super::geometry::shapes(poly.buffer_with_style(style))
        .into_iter()
        .filter(|s| s.holes.is_empty())
        .map(|s| s.outer)
        .collect()
}

/// Morphological opening of `ring` by a disk `wing` across: what is left once
/// every part thinner than a body is removed (slivers, spikes, folded
/// cadastral seams), kept inside `ring` and without its sub-decimetre jogs.
pub(super) fn opened(ring: &[Point], wing: f64) -> Vec<Vec<Point>> {
    let mut out = vec![];
    // A tapered end survives a bevelled opening thinner than the disk: such a
    // part is opened again by a wider disk, until it holds the body width.
    let mut todo = vec![(ring.to_vec(), 0.5 * wing - 1e-3)];
    while let Some((ring, r)) = todo.pop() {
        for core in offset(&ring, -r) {
            for grown in offset(&core, r) {
                for part in clip_inside(&grown, &ring) {
                    let part = blunted(smoothed(&dedup(part), 0.05), wing);
                    if part.len() < 3 || !simple(&part) || ring_area(&part).abs() < wing * wing {
                        continue;
                    }
                    if thickness(&part, None) >= wing - 1e-6 {
                        out.push(part);
                    } else if r < 0.9 * wing {
                        todo.push((part, r * 1.3));
                    }
                }
            }
        }
    }
    out
}

/// The ring with every corner sharper than 70 degrees cut square to its
/// bisector where the wedge is `wing` wide: an opening keeps acute tips, and
/// a tip is a sliver a body cannot use.
pub(super) fn blunted(ring: Vec<Point>, wing: f64) -> Vec<Point> {
    blunted_at(ring, wing, 70.0)
}
/// `blunted` for corners sharper than `limit` degrees.
pub(super) fn blunted_at(mut ring: Vec<Point>, wing: f64, limit: f64) -> Vec<Point> {
    if ring_area(&ring) < 0.0 {
        ring.reverse();
    }
    for _ in 0..8 {
        let n = ring.len();
        if n < 3 {
            break;
        }
        let tip = (0..n).find_map(|i| {
            let (a, v, c) = (ring[(i + n - 1) % n], ring[i], ring[(i + 1) % n]);
            let (e, f) = (sub(a, v), sub(c, v));
            let (le, lf) = (length(e), length(f));
            let convex = (v.x - a.x) * (c.y - v.y) - (v.y - a.y) * (c.x - v.x) > 0.0;
            let cos = dot(e, f) / (le * lf).max(1e-12);
            (convex && le > 1e-6 && lf > 1e-6 && cos > limit.to_radians().cos()).then(|| {
                let half = 0.5 * cos.clamp(-1.0, 1.0).acos();
                let b = unit(add(scale(e, 1.0 / le), scale(f, 1.0 / lf)));
                let d = 0.5 * wing / half.tan().max(1e-6);
                (scale(b, -1.0), -(dot(b, v) + d))
            })
        });
        let Some(plane) = tip else {
            break;
        };
        ring = dedup(largest(clip_parts(&ring, &[plane])));
    }
    ring
}

pub(super) fn clip_inside(a: &[Point], b: &[Point]) -> Vec<Vec<Point>> {
    super::super::super::geometry::intersection(
        &Shape {
            outer: a.to_vec(),
            holes: vec![],
        },
        &Shape {
            outer: b.to_vec(),
            holes: vec![],
        },
    )
    .into_iter()
    .filter(|s| s.holes.is_empty())
    .map(|s| s.outer)
    .collect()
}

/// `ring` inset by `d` on every side: the same polygon with each wall moved
/// in (edge by edge when convex, exact), so a court keeps its house's shape.
pub(super) fn inset(ring: &[Point], d: f64) -> Option<Vec<Point>> {
    let mut r = ring.to_vec();
    if ring_area(&r) < 0.0 {
        r.reverse();
    }
    let out = if convex(&r) {
        let planes: Vec<Plane> = (0..r.len())
            .filter_map(|i| {
                let (a, b) = (r[i], r[(i + 1) % r.len()]);
                (length(sub(b, a)) > 1e-6).then(|| {
                    // Inward (left) normal of a CCW edge.
                    let e = unit(sub(b, a));
                    let m = Point { x: -e.y, y: e.x };
                    (scale(m, -1.0), -(dot(m, a) + d))
                })
            })
            .collect();
        clip(&r, &planes)
    } else {
        largest(offset(&r, -d))
    };
    let out = dedup(out);
    (out.len() >= 3 && ring_area(&out).abs() > 1e-6).then_some(out)
}
