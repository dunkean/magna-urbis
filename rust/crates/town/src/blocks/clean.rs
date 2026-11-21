//! Cleaning buildable land: outlines snapped, parts narrower than the minimum width opened
//! away, pieces below the minimum area dropped.

use std::iter::once;

use magna_urbis_geom::{
    Point, Shape, area, distance, intersection, normalized, overlay_fallbacks, signed, simple,
    union, unneedled,
};

use super::stroke::{Path, cover};
use super::{BlockSpec, subtract};

/// Holes below this area (m²) close when an outline is snapped.
const TINY_HOLE: f64 = 0.01;
/// A convex corner sharper than this (cosine of the turn, about 120°, i.e. a 60° corner)
/// is a tip that may be narrower than the minimum width.
const TIP_TURN: f64 = -0.5;

/// The pieces snapped, opened where they may be narrow, and kept when large enough.
pub(super) fn cleaned(pieces: Vec<Shape>, spec: &BlockSpec) -> Vec<Shape> {
    let mut out = Vec::new();
    for piece in pieces {
        let piece = snapped(&piece, spec);
        if spec.min_width > 0.0 && narrow(&piece, spec.min_width) {
            let opened = opened(&piece, spec.min_width * 0.5, spec.miter_limit);
            out.extend(opened.iter().map(|p| snapped(p, spec)));
        } else {
            out.push(piece);
        }
    }
    out.retain(|p| p.outer.len() >= 3 && area(p) >= spec.min_area);
    out
}

/// The shape with its rings snapped (`snap_ring`); the shape as it was when snapping would
/// collapse its outer ring or make a ring cross itself.
fn snapped(s: &Shape, spec: &BlockSpec) -> Shape {
    let outer = snap_ring(&s.outer, spec.jog, spec.collinear);
    if outer.len() < 3 {
        return s.clone();
    }
    let holes = s
        .holes
        .iter()
        .map(|h| snap_ring(h, spec.jog, spec.collinear))
        .filter(|h| h.len() >= 3 && signed(h).abs() > TINY_HOLE)
        .collect();
    let out = Shape { outer, holes };
    if simple(&out) { out } else { s.clone() }
}

/// A closed ring without its jogs (a vertex within `jog` of the previous one kept, as
/// classic's `without_jogs`), its needle tips, and its vertices within `collinear` of the
/// line through their neighbours where the ring runs on.
fn snap_ring(ring: &[Point], jog: f64, collinear: f64) -> Vec<Point> {
    let mut q: Vec<Point> = Vec::with_capacity(ring.len());
    for &p in ring {
        if q.last().is_none_or(|l| l.distance(p) >= jog) {
            q.push(p);
        }
    }
    while q.len() > 3 && q[0].distance(q[q.len() - 1]) < jog {
        q.pop();
    }
    let mut q = unneedled(&q, jog);
    let mut changed = true;
    while changed && q.len() > 3 {
        changed = false;
        let mut i = 0;
        while i < q.len() && q.len() > 3 {
            let n = q.len();
            let (a, b, c) = (q[(i + n - 1) % n], q[i], q[(i + 1) % n]);
            let ahead = (b.x - a.x) * (c.x - b.x) + (b.y - a.y) * (c.y - b.y) > 0.0;
            if ahead && distance(b, a, c).0 <= collinear {
                q.remove(i);
                changed = true;
            } else {
                i += 1;
            }
        }
    }
    q
}

/// Width of the rectangle with the shape's area and perimeter: exact for a rectangle, about
/// 0.8 of the diameter for a disc, the strip's width for a long strip or ring.
pub(super) fn equivalent_width(s: &Shape) -> f64 {
    let perimeter: f64 = once(&s.outer)
        .chain(&s.holes)
        .map(|r| {
            (0..r.len())
                .map(|i| r[i].distance(r[(i + 1) % r.len()]))
                .sum::<f64>()
        })
        .sum();
    let half = perimeter * 0.5;
    (half - (half * half - 4.0 * area(s)).max(0.0).sqrt()) * 0.5
}

/// One side of a ring, with its arc position along the ring.
struct Side {
    ring: usize,
    index: usize,
    a: Point,
    b: Point,
    start: f64,
    length: f64,
}

/// Whether some part of `s` may be narrower than `width`, so that opening it may change it: a
/// whole piece whose equivalent rectangle is under twice `width`; a convex tip sharper than
/// 60°; two sides of different rings closer than `width`; or two sides of one ring closer than
/// `width` whose boundary path apart is at least twice their gap (a neck or a tail, not the two
/// sides of a corner). A false positive only costs an opening that changes nothing.
fn narrow(s: &Shape, width: f64) -> bool {
    if equivalent_width(s) < 2.0 * width {
        return true;
    }
    let rings: Vec<&Vec<Point>> = once(&s.outer).chain(&s.holes).collect();
    let mut sides = Vec::new();
    let mut totals = Vec::new();
    for (r, ring) in rings.iter().enumerate() {
        let n = ring.len();
        let mut arc = 0.0;
        for i in 0..n {
            let (a, b, c) = (ring[i], ring[(i + 1) % n], ring[(i + 2) % n]);
            let (u, v) = ((b.x - a.x, b.y - a.y), (c.x - b.x, c.y - b.y));
            let (lu, lv) = (u.0.hypot(u.1), v.0.hypot(v.1));
            // Every ring has the piece on its left: a left turn is a convex corner.
            if lu > 1e-9
                && lv > 1e-9
                && u.0 * v.1 - u.1 * v.0 > 0.0
                && (u.0 * v.0 + u.1 * v.1) / (lu * lv) < TIP_TURN
            {
                return true;
            }
            sides.push(Side {
                ring: r,
                index: i,
                a,
                b,
                start: arc,
                length: lu,
            });
            arc += lu;
        }
        totals.push(arc);
    }
    for (i, p) in sides.iter().enumerate() {
        for q in &sides[i + 1..] {
            if p.ring == q.ring {
                let n = rings[p.ring].len();
                if q.index == p.index + 1 || (p.index == 0 && q.index == n - 1) {
                    continue;
                }
            }
            if box_gap(p, q) >= width {
                continue;
            }
            let (gap, tp, tq) = closest(p.a, p.b, q.a, q.b);
            if gap >= width {
                continue;
            }
            if p.ring != q.ring {
                return true;
            }
            let along = (q.start + tq * q.length - p.start - tp * p.length).abs();
            if along.min(totals[p.ring] - along) >= 2.0 * gap {
                return true;
            }
        }
    }
    false
}

/// Gap between the bounding boxes of two sides; a lower bound of their distance.
fn box_gap(p: &Side, q: &Side) -> f64 {
    let gx = (p.a.x.min(p.b.x) - q.a.x.max(q.b.x)).max(q.a.x.min(q.b.x) - p.a.x.max(p.b.x));
    let gy = (p.a.y.min(p.b.y) - q.a.y.max(q.b.y)).max(q.a.y.min(q.b.y) - p.a.y.max(p.b.y));
    gx.max(gy).max(0.0)
}

/// Distance between segments `ab` and `cd`, which do not cross, with the positions of the
/// closest points along each (0 at `a` or `c`, 1 at `b` or `d`).
fn closest(a: Point, b: Point, c: Point, d: Point) -> (f64, f64, f64) {
    let candidates = [
        {
            let (g, t, _) = distance(a, c, d);
            (g, 0.0, t)
        },
        {
            let (g, t, _) = distance(b, c, d);
            (g, 1.0, t)
        },
        {
            let (g, t, _) = distance(c, a, b);
            (g, t, 0.0)
        },
        {
            let (g, t, _) = distance(d, a, b);
            (g, t, 1.0)
        },
    ];
    candidates
        .into_iter()
        .min_by(|x, y| x.0.total_cmp(&y.0))
        .unwrap_or((f64::INFINITY, 0.0, 0.0))
}

/// Morphological opening of `piece` by a disc of radius `r`, with miter joins: erode by
/// strokes of half-width `r` inside every ring, dilate the remains by strokes outside theirs,
/// and keep what lies in the piece. Parts narrower than `2r` vanish; corners of 60° and more
/// come back exactly (the miter of the dilation lands on them), sharper tips are bevelled.
/// The piece is kept whole if the overlay cannot resolve the dilation.
fn opened(piece: &Shape, r: f64, miter_limit: f64) -> Vec<Shape> {
    let (inward, links) = ring_paths(piece, r, false);
    let eroded = subtract(piece, &cover(&inward, &links, miter_limit));
    if eroded.is_empty() {
        return Vec::new();
    }
    let mut grown = Vec::new();
    for e in &eroded {
        let (outward, links) = ring_paths(e, r, true);
        grown.extend(cover(&outward, &links, miter_limit));
        grown.push(e.clone());
    }
    let before = overlay_fallbacks();
    let dilated = union(&grown);
    if overlay_fallbacks() != before {
        return vec![piece.clone()];
    }
    dilated
        .iter()
        .flat_map(|d| intersection(d, piece))
        .collect()
}

/// Each ring of `s` as a closed path with the piece on its left (or, `outward`, the outside on
/// its left), joined to itself where it closes.
fn ring_paths(s: &Shape, half: f64, outward: bool) -> (Vec<Path>, Vec<(usize, usize)>) {
    let s = normalized(s.clone());
    let paths: Vec<Path> = once(&s.outer)
        .chain(&s.holes)
        .map(|ring| {
            let mut ring = ring.clone();
            if outward {
                ring.reverse();
            }
            Path::ring(&ring, half)
        })
        .collect();
    let links = (0..paths.len()).map(|k| (k, k)).collect();
    (paths, links)
}
