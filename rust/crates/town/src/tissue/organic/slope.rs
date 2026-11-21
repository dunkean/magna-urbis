//! The organic tissue's reading of slope: how steep a quarter is as a whole, which sets how
//! strongly its field follows the contours, and how far a cut runs across them.

use super::field::smooth;
use super::params::OrganicParams;
use magna_urbis_geom::surface::TerrainView;
use magna_urbis_geom::{Point, Shape, bbox, contains};

/// Smallest lattice spacing in metres of the grade samples over a quarter.
const SAMPLE: f64 = 10.0;
/// Most grade samples taken over a quarter.
const MAX_SAMPLES: f64 = 1024.0;
/// Half step in metres of a ground grade sample, the survey's half cell.
const PROBE: f64 = 4.0;
/// Half step in metres of the contour direction read along a cut.
const CONTOUR_PROBE: f64 = 35.0;
/// Grade below which the contour direction is too weak to judge a cut by.
const LEVEL: f64 = 0.01;

/// Mean ground grade over the dry land of `outline`, on a lattice; 0 without samples.
pub(super) fn mean_grade(outline: &Shape, terrain: &dyn TerrainView) -> f64 {
    let (x0, y0, x1, y1) = bbox(outline);
    if !(x0.is_finite() && y0.is_finite() && x1.is_finite() && y1.is_finite()) {
        return 0.0;
    }
    let step = SAMPLE.max(((x1 - x0) * (y1 - y0) / MAX_SAMPLES).sqrt());
    let (mut sum, mut count) = (0.0, 0usize);
    let mut y = y0 + step * 0.5;
    while y < y1 {
        let mut x = x0 + step * 0.5;
        while x < x1 {
            let p = Point { x, y };
            if contains(outline, p) && !terrain.wet(p) {
                let (gx, gy) = terrain.slope_at(p, PROBE);
                let grade = gx.hypot(gy);
                if grade.is_finite() {
                    sum += grade;
                    count += 1;
                }
            }
            x += step;
        }
        y += step;
    }
    if count == 0 { 0.0 } else { sum / count as f64 }
}

/// How fully a quarter answers its slope: 0 up to the steep grade, 1 from twice it.
pub(super) fn steepness(outline: &Shape, terrain: &dyn TerrainView, params: &OrganicParams) -> f64 {
    let onset = params.slope.steep_grade;
    if !(onset.is_finite() && onset > 0.0) {
        return 0.0;
    }
    smooth(mean_grade(outline, terrain), onset, 2.0 * onset)
}

/// Share of a path's length that runs across the contours: 0 along them, 1 straight up the
/// slope. Level stretches count as along.
pub(super) fn cross_contour(terrain: &dyn TerrainView, path: &[Point]) -> f64 {
    let (mut across, mut total) = (0.0, 0.0);
    for w in path.windows(2) {
        let length = w[0].distance(w[1]);
        if length < 1e-9 {
            continue;
        }
        let mid = Point {
            x: (w[0].x + w[1].x) * 0.5,
            y: (w[0].y + w[1].y) * 0.5,
        };
        let (gx, gy) = terrain.slope_at(mid, CONTOUR_PROBE);
        let grade = gx.hypot(gy);
        if grade.is_finite() && grade > LEVEL {
            across += ((w[1].x - w[0].x) * gx + (w[1].y - w[0].y) * gy).abs() / grade;
        }
        total += length;
    }
    if total > 0.0 { across / total } else { 0.0 }
}
