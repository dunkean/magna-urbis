//! Street grades read on the terrain: the steepest rise over run along a
//! segment and whether it stays dry.

use magna_urbis_geom::Point;
use magna_urbis_geom::surface::TerrainView;

fn lerp(a: Point, b: Point, t: f64) -> Point {
    Point {
        x: a.x + (b.x - a.x) * t,
        y: a.y + (b.y - a.y) * t,
    }
}

fn on_map(terrain: &dyn TerrainView, p: Point) -> bool {
    p.x.is_finite()
        && p.y.is_finite()
        && p.x >= 0.0
        && p.y >= 0.0
        && p.x < terrain.width()
        && p.y < terrain.width()
}

/// Steepest grade along `a`-`b`, or `None` off the map, over undefined heights,
/// or (when `dry`) across water. The segment is visited in intervals between
/// height interpolation knots; on each, the height along a line is quadratic,
/// so the grades at its two ends from three samples bound it exactly.
fn inspect(terrain: &dyn TerrainView, a: Point, b: Point, dry: bool) -> Option<f64> {
    let width = terrain.width();
    if !(width.is_finite() && width > 0.0)
        || terrain.height_resolution() < 2
        || !on_map(terrain, a)
        || !on_map(terrain, b)
    {
        return None;
    }
    let distance = a.distance(b);
    if distance < 1e-8 {
        return (!dry || !terrain.wet(a)).then_some(0.0);
    }
    let half = width / terrain.height_resolution() as f64 * 0.5;
    let crossing = |origin: f64, delta: f64| {
        if delta.abs() < 1e-12 {
            return (f64::INFINITY, f64::INFINITY);
        }
        let k = if delta > 0.0 {
            (origin / half).floor() + 1.0
        } else {
            (origin / half).ceil() - 1.0
        };
        ((k * half - origin) / delta, half / delta.abs())
    };
    let (mut tx, sx) = crossing(a.x, b.x - a.x);
    let (mut ty, sy) = crossing(a.y, b.y - a.y);
    let mut t0 = 0.0;
    let mut h0 = terrain.height_at(a);
    let mut steepest = 0.0_f64;
    while t0 < 1.0 {
        let t1 = tx.min(ty).min(1.0);
        let mid = lerp(a, b, (t0 + t1) * 0.5);
        if dry && terrain.wet(mid) {
            return None;
        }
        let h1 = terrain.height_at(lerp(a, b, t1));
        let hm = terrain.height_at(mid);
        let run = (t1 - t0) * distance;
        if run > 1e-8 {
            let entry = (4.0 * hm - 3.0 * h0 - h1) / run;
            let exit = (3.0 * h1 + h0 - 4.0 * hm) / run;
            steepest = steepest.max(entry.abs()).max(exit.abs());
        }
        if !h0.is_finite() || !h1.is_finite() || !hm.is_finite() {
            return None;
        }
        if tx <= t1 + 1e-12 {
            tx += sx;
        }
        if ty <= t1 + 1e-12 {
            ty += sy;
        }
        t0 = t1;
        h0 = h1;
    }
    Some(steepest)
}

/// Steepest grade along the segment, wet or dry; infinite off the map.
pub(super) fn segment_grade(terrain: &dyn TerrainView, a: Point, b: Point) -> f64 {
    inspect(terrain, a, b, false).unwrap_or(f64::INFINITY)
}

/// Whether the segment stays on dry land within `max_grade`.
pub(super) fn segment_clear(terrain: &dyn TerrainView, a: Point, b: Point, max_grade: f64) -> bool {
    inspect(terrain, a, b, true).is_some_and(|g| g <= max_grade + 1e-8)
}

/// Whether every segment of the path stays on dry land within `max_grade`.
pub(super) fn path_clear(terrain: &dyn TerrainView, path: &[Point], max_grade: f64) -> bool {
    path.len() >= 2
        && path
            .windows(2)
            .all(|p| segment_clear(terrain, p[0], p[1], max_grade))
}

/// Steepest grade over the whole path.
pub(super) fn path_grade(terrain: &dyn TerrainView, path: &[Point]) -> f64 {
    path.windows(2)
        .map(|p| segment_grade(terrain, p[0], p[1]))
        .fold(0.0, f64::max)
}
