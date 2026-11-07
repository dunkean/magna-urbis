//! City display ground: lot, block and quarter shapes minus the physical water
//! (port of web/src/render/cityGround.ts `CityGround.clip`, formerly
//! polygon-clipping through gen/geo/bool.ts `tryDifference`).
//!
//! The water is the planner raster (wet = value in 1..=3, never the dry stilt
//! value 4) plus the vector canals that can fall between two dry raster
//! centres. Booleans use i_overlay (non-zero fill, every ring oriented so that
//! overlapping clip operands add up, as polygon-clipping's multi-operand
//! difference); results equal the TS ones up to float rounding.

use super::{Ring, Shape, orient_positive, signed_area};
use i_overlay::core::fill_rule::FillRule;
use i_overlay::core::overlay_rule::OverlayRule;
use i_overlay::float::overlay::FloatOverlay;

/// Floating-point area floor of the checked booleans (`BOOL_AREA_EPS`, m²).
const AREA_EPS: f64 = 1e-6;
/// Minimum area of a canal piece kept from the ring xor (m²).
const CANAL_MIN_AREA: f64 = 0.001;

#[derive(Clone, Copy, Debug)]
struct Bounds {
    x0: f64,
    y0: f64,
    x1: f64,
    y1: f64,
}

fn ring_bounds(ring: &[[f64; 2]]) -> Bounds {
    let mut b = Bounds { x0: f64::INFINITY, y0: f64::INFINITY, x1: f64::NEG_INFINITY, y1: f64::NEG_INFINITY };
    for p in ring {
        b.x0 = b.x0.min(p[0]);
        b.y0 = b.y0.min(p[1]);
        b.x1 = b.x1.max(p[0]);
        b.y1 = b.y1.max(p[1]);
    }
    b
}

/// Canal pieces of the vector water: each group's rings xor-ed (islands and
/// side arms), a single ring kept as is (`channels` in cityGround.ts).
pub fn canal_shapes(groups: &[Shape]) -> Vec<Shape> {
    let mut out = Vec::new();
    for group in groups {
        let rings: Vec<&Ring> = group.iter().filter(|r| r.len() >= 3).collect();
        if rings.len() == 1 {
            out.push(vec![rings[0].clone()]);
            continue;
        }
        if rings.is_empty() {
            continue;
        }
        let contours: Vec<Ring> = rings.into_iter().cloned().collect();
        let shapes = FloatOverlay::with_subj(&contours).overlay(OverlayRule::Subject, FillRule::EvenOdd);
        out.extend(normalize(shapes, CANAL_MIN_AREA));
    }
    out
}

/// Planner water raster of a city.
pub struct GroundRaster<'a> {
    pub n: usize,
    pub width: f64,
    pub water: &'a [u8],
}

/// Result of one clip: the subject itself (no water near it) or its pieces.
#[derive(Debug, PartialEq)]
pub enum Clipped {
    Unchanged,
    Pieces(Vec<Shape>),
}

/// Prepared clipper for many subjects against one raster and canal set.
pub struct CityGround<'a> {
    raster: GroundRaster<'a>,
    canals: Vec<Shape>,
    canal_bounds: Vec<Bounds>,
}

const fn wet(v: u8) -> bool {
    v > 0 && v < 4
}

impl<'a> CityGround<'a> {
    /// `canals`: pieces from `canal_shapes`.
    pub fn new(raster: GroundRaster<'a>, canals: Vec<Shape>) -> Self {
        let canal_bounds = canals.iter().map(|s| s.first().map_or(ring_bounds(&[]), |r| ring_bounds(r))).collect();
        Self { raster, canals, canal_bounds }
    }

    /// Water rectangles of the window, merging identical runs of successive rows.
    fn water_runs(&self, x0: usize, y0: usize, x1: usize, y1: usize) -> Vec<[usize; 4]> {
        let n = self.raster.n;
        let mut finished: Vec<[usize; 4]> = Vec::new();
        let mut active: Vec<[usize; 4]> = Vec::new();
        for y in y0..y1 {
            let mut next: Vec<[usize; 4]> = Vec::new();
            let mut x = x0;
            while x < x1 {
                if !wet(self.raster.water[y * n + x]) {
                    x += 1;
                    continue;
                }
                let start = x;
                x += 1;
                while x < x1 && wet(self.raster.water[y * n + x]) {
                    x += 1;
                }
                // [x0, x1, y0, y1]
                match active.iter().position(|r| r[0] == start && r[1] == x) {
                    Some(i) => {
                        let mut run = active.swap_remove(i);
                        run[3] = y + 1;
                        next.push(run);
                    }
                    None => next.push([start, x, y, y + 1]),
                }
            }
            finished.append(&mut active);
            active = next;
        }
        finished.append(&mut active);
        finished
    }

    /// `CityGround.clip`: the subject minus the wet cells and the canals.
    pub fn clip(&self, subject: &[Ring]) -> Clipped {
        let GroundRaster { n, width, water } = self.raster;
        let cell = width / n as f64;
        let Some(outer) = subject.first() else { return Clipped::Unchanged };
        if n == 0 || !(cell > 0.0) || water.len() != n * n || outer.is_empty() {
            return Clipped::Unchanged;
        }
        let b = ring_bounds(outer);
        let window = |lo: f64, hi: f64| -> (usize, usize) {
            let a = (lo / cell).floor().max(0.0);
            let z = (hi / cell).ceil().min(n as f64);
            if !(a < z) { (0, 0) } else { (a as usize, z as usize) }
        };
        let (x0, x1) = window(b.x0, b.x1);
        let (y0, y1) = window(b.y0, b.y1);
        let runs = if x0 < x1 && y0 < y1 { self.water_runs(x0, y0, x1, y1) } else { Vec::new() };
        let mut clips: Vec<Shape> = Vec::new();
        if !runs.is_empty() {
            let wet_cells: usize = runs.iter().map(|r| (r[1] - r[0]) * (r[3] - r[2])).sum();
            if b.x0 >= 0.0 && b.y0 >= 0.0 && b.x1 <= width && b.y1 <= width && wet_cells == (x1 - x0) * (y1 - y0) {
                return Clipped::Pieces(Vec::new());
            }
            clips.extend(runs.iter().map(|r| {
                let (ax, bx, ay, by) = (r[0] as f64 * cell, r[1] as f64 * cell, r[2] as f64 * cell, r[3] as f64 * cell);
                vec![vec![[ax, ay], [bx, ay], [bx, by], [ax, by]]]
            }));
        }
        for (canal, cb) in self.canals.iter().zip(&self.canal_bounds) {
            if cb.x0 <= b.x1 && cb.y0 <= b.y1 && cb.x1 >= b.x0 && cb.y1 >= b.y0 {
                clips.push(canal.clone());
            }
        }
        if clips.is_empty() {
            return Clipped::Unchanged;
        }
        Clipped::Pieces(difference(subject, &clips, b))
    }
}

/// Every coordinate is finite (polygon-clipping fails on NaN: the checked
/// difference then fails closed, returning no land).
fn finite(rings: &[Ring]) -> bool {
    rings.iter().all(|r| r.iter().all(|p| p[0].is_finite() && p[1].is_finite()))
}

/// `tryDifference(subject, ...clips)` with the clip trimming of gen/geo/bool.ts.
fn difference(subject: &[Ring], clips: &[Shape], sb: Bounds) -> Vec<Shape> {
    if subject[0].len() < 3 {
        return Vec::new();
    }
    if !finite(subject) || clips.iter().any(|c| !finite(c)) {
        return Vec::new();
    }
    let subject_rings: Vec<&Ring> = std::iter::once(&subject[0]).chain(subject[1..].iter().filter(|h| h.len() >= 3)).collect();
    let mut clip_contours: Vec<Ring> = Vec::new();
    for clip in clips {
        if clip.first().is_none_or(|r| r.len() < 3) {
            continue;
        }
        let rings: Vec<Ring> = std::iter::once(clip[0].clone()).chain(clip[1..].iter().filter(|h| h.len() >= 3).cloned()).collect();
        if let Some(trimmed) = trim_polygon(rings, sb) {
            push_oriented(&trimmed, &mut clip_contours);
        }
    }
    if clip_contours.is_empty() {
        // Nothing left to subtract: the subject, normalised.
        return normalize(vec![subject_rings.into_iter().cloned().collect()], AREA_EPS);
    }
    let mut subject_contours = Vec::new();
    push_oriented(&subject_rings.into_iter().cloned().collect::<Vec<_>>(), &mut subject_contours);
    let shapes = FloatOverlay::with_subj_and_clip(&subject_contours, &clip_contours).overlay(OverlayRule::Difference, FillRule::NonZero);
    normalize(shapes, AREA_EPS)
}

/// Outer ring positive, holes negative: non-zero winding then unions operands.
fn push_oriented(rings: &[Ring], out: &mut Vec<Ring>) {
    for (k, ring) in rings.iter().enumerate() {
        let mut r = ring.clone();
        if (signed_area(&r) < 0.0) == (k == 0) {
            r.reverse();
        }
        out.push(r);
    }
}

/// `fromGeom(g, minArea, false, true)`: outer rings below `min_area` dropped,
/// every ring positively oriented, zero-area holes dropped.
fn normalize(shapes: Vec<Vec<Ring>>, min_area: f64) -> Vec<Shape> {
    let mut out = Vec::new();
    for shape in shapes {
        let mut rings = shape.into_iter();
        let Some(outer) = rings.next() else { continue };
        if outer.len() < 3 || signed_area(&outer).abs() < min_area {
            continue;
        }
        let mut piece = vec![orient_positive(outer)];
        piece.extend(rings.filter(|h| h.len() >= 3 && signed_area(h).abs() > 0.0).map(orient_positive));
        out.push(piece);
    }
    out
}

const TRIM_MIN: usize = 96;
const TRIM_MARGIN: f64 = 60.0;

/// `trimPolygon`: a clip polygon with many vertices replaced by its rings
/// clipped to the subject's box grown by TRIM_MARGIN, when that is exact for the
/// boolean (every edge reaching within 1 m of the subject's box lies wholly
/// inside the clip box). None = polygon outside the box.
fn trim_polygon(pg: Vec<Ring>, sb: Bounds) -> Option<Vec<Ring>> {
    // (vertex count of the closed rings, as the TS Geom repeats the first point)
    let nv: usize = pg.iter().map(|r| r.len() + 1).sum();
    if nv < TRIM_MIN {
        return Some(pg);
    }
    let cb = Bounds { x0: sb.x0 - TRIM_MARGIN, y0: sb.y0 - TRIM_MARGIN, x1: sb.x1 + TRIM_MARGIN, y1: sb.y1 + TRIM_MARGIN };
    let nb = Bounds { x0: sb.x0 - 1.0, y0: sb.y0 - 1.0, x1: sb.x1 + 1.0, y1: sb.y1 + 1.0 };
    let ob = ring_bounds(&pg[0]);
    if ob.x0 >= cb.x0 && ob.y0 >= cb.y0 && ob.x1 <= cb.x1 && ob.y1 <= cb.y1 {
        return Some(pg);
    }
    for r in &pg {
        for i in 0..r.len() {
            let (a, b) = (r[i], r[(i + 1) % r.len()]);
            let (sx0, sx1, sy0, sy1) = (a[0].min(b[0]), a[0].max(b[0]), a[1].min(b[1]), a[1].max(b[1]));
            if sx0 > nb.x1 || sx1 < nb.x0 || sy0 > nb.y1 || sy1 < nb.y0 {
                continue;
            }
            if sx0 < cb.x0 || sx1 > cb.x1 || sy0 < cb.y0 || sy1 > cb.y1 {
                return Some(pg);
            }
        }
    }
    let mut out = Vec::with_capacity(pg.len());
    for (k, ring) in pg.iter().enumerate() {
        let c = clip_ring_box(ring, cb);
        if c.len() < 3 {
            if k == 0 {
                return None;
            }
            continue;
        }
        out.push(c);
    }
    Some(out)
}

/// Sutherland–Hodgman clip of an open ring to a box (`clipRingBox`).
fn clip_ring_box(ring: &[[f64; 2]], b: Bounds) -> Ring {
    let mut pts: Ring = ring.to_vec();
    for plane in 0..4 {
        if pts.is_empty() {
            break;
        }
        let side = |p: [f64; 2]| match plane {
            0 => p[0] - b.x0,
            1 => b.x1 - p[0],
            2 => p[1] - b.y0,
            _ => b.y1 - p[1],
        };
        let mut out = Vec::with_capacity(pts.len() + 4);
        for i in 0..pts.len() {
            let (p, q) = (pts[i], pts[(i + 1) % pts.len()]);
            let (sp, sq) = (side(p), side(q));
            if sp >= 0.0 {
                out.push(p);
            }
            if (sp >= 0.0) != (sq >= 0.0) {
                let t = sp / (sp - sq);
                out.push([p[0] + (q[0] - p[0]) * t, p[1] + (q[1] - p[1]) * t]);
            }
        }
        pts = out;
    }
    let mut dedup: Ring = Vec::with_capacity(pts.len());
    for p in pts {
        if dedup.last() != Some(&p) {
            dedup.push(p);
        }
    }
    while dedup.len() > 1 && dedup.first() == dedup.last() {
        dedup.pop();
    }
    dedup
}

#[cfg(test)]
mod tests {
    use super::*;
    use serde_json::Value;

    fn ring(v: &Value) -> Ring {
        v.as_array().unwrap().iter().map(|p| [p["x"].as_f64().unwrap(), p["y"].as_f64().unwrap()]).collect()
    }

    /// Fixture dumped from the TS `CityGround.clip` (polygon-clipping).
    #[test]
    fn clip_matches_typescript_fixture() {
        let fixture: Value = serde_json::from_str(include_str!("../../tests/fixtures/render-city-ground.json")).unwrap();
        let water: Vec<u8> = fixture["water"].as_array().unwrap().iter().map(|v| v.as_u64().unwrap() as u8).collect();
        let canal: Shape = fixture["canal"].as_array().unwrap().iter().map(ring).collect();
        let ground = CityGround::new(
            GroundRaster { n: fixture["n"].as_u64().unwrap() as usize, width: fixture["width"].as_f64().unwrap(), water: &water },
            canal_shapes(&[canal]),
        );
        for (subject, expected) in fixture["subjects"].as_array().unwrap().iter().zip(fixture["results"].as_array().unwrap()) {
            let shape: Shape = std::iter::once(ring(&subject["outer"])).chain(subject["holes"].as_array().unwrap().iter().map(ring)).collect();
            match ground.clip(&shape) {
                Clipped::Unchanged => assert!(expected["unchanged"].as_bool().unwrap(), "{subject}"),
                Clipped::Pieces(pieces) => {
                    assert!(!expected["unchanged"].as_bool().unwrap(), "{subject}");
                    assert_eq!(pieces.len() as u64, expected["pieces"].as_u64().unwrap(), "{subject}");
                    let area: f64 = pieces.iter().map(|p| signed_area(&p[0]) - p[1..].iter().map(|h| signed_area(h)).sum::<f64>()).sum();
                    assert!((area - expected["area"].as_f64().unwrap()).abs() < 1e-6, "{subject}: {area}");
                }
            }
        }
    }
}
