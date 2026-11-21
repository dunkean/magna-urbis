//! Distance weighting and automatic zoning shared by the field and blocks.

use crate::urban::Point;

pub(super) fn smooth(x: f64, a: f64, b: f64) -> f64 {
    let t = ((x - a) / (b - a)).clamp(0.0, 1.0);
    t * t * (3.0 - 2.0 * t)
}
pub(super) fn zone_at(p: Point, center: Point, radius: f64, population: u32) -> &'static str {
    let d = (p.x - center.x).hypot(p.y - center.y) / radius;
    if population < 500 {
        "village"
    } else if d < 0.4 {
        "core"
    } else if d < 0.72 {
        "middle"
    } else {
        "edge"
    }
}
