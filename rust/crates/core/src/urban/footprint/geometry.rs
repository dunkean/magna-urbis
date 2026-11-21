//! Shared geometry operations for dry, disjoint footprint phases.
use crate::urban::{Point, Shape, Surface, geometry as g};
use geo::algorithm::bool_ops::unary_union;

pub(super) fn distance(a: Point, b: Point) -> f64 {
    (a.x - b.x).hypot(a.y - b.y)
}
pub(in crate::urban) fn union(shapes: &[Shape]) -> Vec<Shape> {
    if shapes.is_empty() {
        return vec![];
    }
    g::shapes(unary_union(
        &shapes.iter().map(g::polygon).collect::<Vec<_>>(),
    ))
}
pub(super) fn area(shapes: &[Shape]) -> f64 {
    shapes.iter().map(g::area).sum()
}
pub(super) fn dry(surface: Surface<'_>, shapes: &[Shape]) -> Vec<Shape> {
    union(
        &shapes
            .iter()
            .flat_map(|s| g::dry_clip(&surface, s))
            .collect::<Vec<_>>(),
    )
}
pub(super) fn subtract(shapes: &[Shape], excluded: &[Shape]) -> Vec<Shape> {
    let mut result = shapes.to_vec();
    for s in excluded {
        result = result.iter().flat_map(|p| g::difference(p, s)).collect();
    }
    result
}
pub(super) fn rotate(p: Point, angle: f64) -> Point {
    Point {
        x: p.x * angle.cos() - p.y * angle.sin(),
        y: p.x * angle.sin() + p.y * angle.cos(),
    }
}
pub(super) fn at(center: Point, p: Point, angle: f64) -> Point {
    let p = rotate(p, angle);
    Point {
        x: center.x + p.x,
        y: center.y + p.y,
    }
}
