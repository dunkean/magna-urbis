//! Shared lot edges, joins and boundary alignment for cadastral repairs.

#[cfg(test)]
use super::shared_predicate_tests;
use super::cut_geometry::{dot, length, sub, unit};
use crate::urban::{Point, Shape};
use crate::urban::geometry::area;

pub(super) fn shared(a: &Shape, b: &Shape) -> f64 {
    let mut len = 0.0;
    for i in 0..a.outer.len() {
        let p = a.outer[i];
        let q = a.outer[(i + 1) % a.outer.len()];
        let dir = unit(sub(q, p));
        let edge_len = length(sub(q, p));
        for j in 0..b.outer.len() {
            let r = b.outer[j];
            let s = b.outer[(j + 1) % b.outer.len()];
            // Reject by the existing line-distance predicate before paying
            // for the other side's normalized direction. Both tests are pure;
            // their thresholds and the accumulation order are unchanged.
            let off = sub(r, p);
            if (off.x * dir.y - off.y * dir.x).abs() > 0.01 {
                continue;
            }
            if dot(dir, unit(sub(s, r))).abs() < 0.99999 {
                continue;
            }
            // Overlapping collinear edges may use different vertex splits.
            let u = dot(off, dir);
            let v = dot(sub(s, p), dir);
            len += (u.max(v).min(edge_len) - u.min(v).max(0.0)).max(0.0);
        }
    }
    #[cfg(test)]
    shared_predicate_tests::assert_legacy(a, b, len);
    len
}

pub(super) fn joined(a: &Shape, b: &Shape) -> Option<Shape> {
    use geo::{BooleanOps, Coord, LineString, Polygon};
    let ring = |points: &[Point]| {
        let mut coords: Vec<Coord> = points.iter().map(|p| Coord { x: p.x, y: p.y }).collect();
        if let Some(first) = coords.first().copied() {
            coords.push(first);
        }
        LineString::new(coords)
    };
    let poly = |s: &Shape| Polygon::new(ring(&s.outer), s.holes.iter().map(|r| ring(r)).collect());
    // The overlay solver can abort on a folded ring: a failed join is no
    // join (native builds also survive a solver panic on odd input).
    let overlay = |x: &Shape, y: &Shape| std::panic::catch_unwind(|| poly(x).union(&poly(y))).ok();
    let mut union = overlay(a, b)?;
    if union.0.len() != 1 {
        // Neighbours cut by separate half-planes share their side only to
        // floating precision (sub-centimetre gaps, T-junctions): conform each
        // ring to the other (vertices snapped onto it, its vertices inserted on
        // the common side) so the overlay sees one boundary, then join again.
        // A join is kept only as one ring holding both areas (no fold).
        let a1 = conform(a, b, 0.02);
        let b1 = conform(b, &a1, 0.02);
        let a2 = conform(&a1, &b1, 0.02);
        let whole = area(a) + area(b);
        union = [(&a2, &b1), (&a1, b), (a, &b1)]
            .into_iter()
            .filter_map(|(x, y)| overlay(x, y))
            .find(|u| {
                use geo::Area;
                u.0.len() == 1 && (u.unsigned_area() - whole).abs() <= 0.01 + 1e-4 * whole
            })?;
    }
    let p = &union.0[0];
    let points = |r: &LineString| {
        r.0.iter()
            .take(r.0.len().saturating_sub(1))
            .map(|p| Point { x: p.x, y: p.y })
            .collect()
    };
    Some(Shape {
        outer: points(p.exterior()),
        holes: p.interiors().iter().map(points).collect(),
    })
}

/// `shape` conformed to its neighbour `onto`: each vertex within `tolerance`
/// of a vertex of `onto` moved onto it (else onto its nearest side), and each
/// vertex of `onto` lying on one of its sides inserted there, so the common
/// boundary carries the same vertices in both rings.
fn conform(shape: &Shape, onto: &Shape, tolerance: f64) -> Shape {
    let rings: Vec<&Vec<Point>> = std::iter::once(&onto.outer)
        .chain(onto.holes.iter())
        .collect();
    let corners: Vec<Point> = rings.iter().flat_map(|r| r.iter().copied()).collect();
    let snapped = snap_onto(shape, onto, tolerance);
    let snap = |p: Point| {
        corners
            .iter()
            .copied()
            .filter(|q| length(sub(p, *q)) <= tolerance)
            .min_by(|x, y| length(sub(p, *x)).total_cmp(&length(sub(p, *y))))
            .unwrap_or(p)
    };
    let ring = |r: &[Point]| {
        let mut out: Vec<Point> = Vec::with_capacity(r.len());
        let n = r.len();
        for i in 0..n {
            let (p, q) = (snap(r[i]), snap(r[(i + 1) % n]));
            out.push(p);
            let len = length(sub(q, p));
            let mut inner: Vec<(f64, Point)> = corners
                .iter()
                .map(|&v| (crate::urban::geometry::distance(v, p, q), v))
                .filter(|(d, _)| d.0 <= tolerance && d.1 * len > 1e-6 && (1.0 - d.1) * len > 1e-6)
                .map(|(d, v)| (d.1, v))
                .collect();
            inner.sort_by(|x, y| x.0.total_cmp(&y.0));
            out.extend(inner.into_iter().map(|(_, v)| v));
        }
        let mut clean: Vec<Point> = Vec::with_capacity(out.len());
        for p in out {
            if clean.last().is_none_or(|q| length(sub(p, *q)) > 1e-7) {
                clean.push(p);
            }
        }
        while clean.len() > 1 && length(sub(clean[0], *clean.last().unwrap())) <= 1e-7 {
            clean.pop();
        }
        clean
    };
    Shape {
        outer: ring(&snapped.outer),
        holes: snapped.holes.iter().map(|r| ring(r)).collect(),
    }
}

/// `shape` with each vertex within `tolerance` of a side of `onto` moved onto
/// that side (its nearest point), so two neighbours share the side exactly.
fn snap_onto(shape: &Shape, onto: &Shape, tolerance: f64) -> Shape {
    let sides: Vec<(Point, Point)> = std::iter::once(&onto.outer)
        .chain(onto.holes.iter())
        .flat_map(|r| (0..r.len()).map(move |i| (r[i], r[(i + 1) % r.len()])))
        .collect();
    let snap = |p: Point| {
        sides
            .iter()
            .map(|&(a, b)| crate::urban::geometry::distance(p, a, b))
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

pub(super) fn boxes_touch(a: (f64, f64, f64, f64), b: (f64, f64, f64, f64)) -> bool {
    a.0 <= b.2 + 0.05 && b.0 <= a.2 + 0.05 && a.1 <= b.3 + 0.05 && b.1 <= a.3 + 0.05
}
