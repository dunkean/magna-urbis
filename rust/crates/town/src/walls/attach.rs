//! Lobes: a town that grew on one side builds its new circuit against the old one.
//! The lobe meets the old wall at two points and the stretch between them is shared;
//! the old circuit and the lobe are two closed circuits whose union is one outline.

use magna_urbis_geom::{self as g, Point, Shape};

use super::geometry::{buffer_all, dist, largest, lerp};

/// Ring distance in metres within which a side counts as lying on the other ring.
const ON_RING: f64 = 0.5;

/// Growth is lopsided when the centroid of the full circuit sits at least a third
/// of the old circuit's radius from the old centroid.
pub fn lopsided(old: &Shape, full: &Shape) -> bool {
    let radius = (g::area(old) / std::f64::consts::PI).sqrt();
    let (co, cf) = (g::centroid(old), g::centroid(full));
    (co.x - cf.x).hypot(co.y - cf.y) >= 0.33 * radius
}

/// The lobe of `old` toward `full` (the circuit around everything), or `None` when
/// the geometry allows none. The lobe lies outside `old`, its boundary runs exactly
/// along a stretch of `old`'s boundary, and `old ∪ lobe` is one simple outline.
pub fn attach(old: &Shape, full: &Shape) -> Option<Shape> {
    let a_old = g::area(old);
    // Thin slivers between the two traces are not a lobe.
    let reach = (0.04 * a_old.sqrt()).clamp(10.0, 40.0);
    let rest = g::difference(full, old);
    let opened = buffer_all(&buffer_all(&rest, -reach), reach);
    // Grown into the old town, then cut by it: the shared stretch is old's own boundary.
    let lobe = largest(
        buffer_all(&opened, 3.0)
            .iter()
            .flat_map(|s| g::difference(s, old))
            .collect(),
    )?;
    let mut lobe = Shape {
        outer: lobe.outer,
        holes: vec![],
    };
    // A lobe reaching round the old circuit can close a pocket against it: the pocket lies
    // inside the new line, so it belongs to the lobe.
    if let [one] = g::union(&[old.clone(), lobe.clone()]).as_slice()
        && !one.holes.is_empty()
    {
        let filled = Shape {
            outer: one.outer.clone(),
            holes: vec![],
        };
        let pieces = g::difference(&filled, old);
        lobe = largest(pieces).map(|s| Shape {
            outer: s.outer,
            holes: vec![],
        })?;
    }
    if g::area(&lobe) < 15_000.0
        || g::area(&lobe) < 0.1 * a_old
        || shared_length(old, &lobe) < 3.0 * reach
    {
        return None;
    }
    match g::union(&[old.clone(), lobe.clone()]).as_slice() {
        [one] if one.holes.is_empty() && g::simple(one) => Some(lobe),
        _ => None,
    }
}

/// Sides of `b`'s ring lying on `a`'s ring (both ends and the middle within 0.5 m).
pub fn shared_stretch(a: &Shape, b: &Shape) -> Vec<(Point, Point)> {
    let m = a.outer.len();
    let on =
        |p: Point| (0..m).any(|i| g::distance(p, a.outer[i], a.outer[(i + 1) % m]).0 < ON_RING);
    let n = b.outer.len();
    (0..n)
        .map(|i| (b.outer[i], b.outer[(i + 1) % n]))
        .filter(|&(p, q)| on(p) && on(q) && on(lerp(p, q, 0.5)))
        .collect()
}

/// Length in metres of `b`'s ring lying on `a`'s ring.
pub fn shared_length(a: &Shape, b: &Shape) -> f64 {
    shared_stretch(a, b)
        .into_iter()
        .map(|(p, q)| dist(p, q))
        .sum()
}
