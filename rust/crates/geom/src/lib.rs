//! Planar geometry and polygon operations in metres.

mod overlay;
mod polygon;
mod spatial;

#[cfg(any(test, feature = "test-support"))]
#[doc(hidden)]
pub mod test_support;

pub use overlay::{
    cleaned, difference, difference_many, intersection, overlay_fallbacks, shapes, union,
};
pub use polygon::{
    area, bbox, centroid, contains, distance, interior_point, normalized, polygon, rectangle,
    ribbon, segment_hit, segment_within, signed, simple, simple_around, simplify, split,
    touching_side, unneedled,
};
pub use spatial::{
    BandEdges, BoxGrid, ContainmentIndex, Region, band_edges, band_within, boxes_meet,
};

use serde::{Deserialize, Serialize};

/// A planar point in metres.
#[derive(Clone, Copy, Debug, Default, Serialize, Deserialize, PartialEq)]
pub struct Point {
    pub x: f64,
    pub y: f64,
}
impl Point {
    /// Euclidean distance in metres.
    #[inline]
    pub fn distance(self, b: Self) -> f64 {
        (self.x - b.x).hypot(self.y - b.y)
    }
}

/// A polygon with an exterior ring and optional hole rings.
#[derive(Clone, Debug, Serialize, Deserialize, PartialEq)]
pub struct Shape {
    pub outer: Vec<Point>,
    #[serde(default)]
    pub holes: Vec<Vec<Point>>,
}
