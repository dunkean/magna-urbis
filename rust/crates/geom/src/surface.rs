//! Read-only terrain sampling in map-local metres.

use crate::{Point, Shape};

/// A square terrain extent with its origin at `(0, 0)`.
pub trait TerrainView {
    /// Side length of the terrain in metres.
    fn width(&self) -> f64;

    /// Number of height samples per side of the terrain.
    fn height_resolution(&self) -> usize;

    /// Number of planning-grid water cells per side of the terrain.
    fn water_resolution(&self) -> usize;

    /// Interpolated elevation in metres.
    fn height_at(&self, p: Point) -> f64;

    /// Rise over run along x and y, sampled `step` metres to either side of
    /// `p` on each axis. The step must be positive.
    #[inline]
    fn slope_at(&self, p: Point, step: f64) -> (f64, f64) {
        let gx = (self.height_at(Point { x: p.x + step, y: p.y })
            - self.height_at(Point { x: p.x - step, y: p.y }))
            / (2.0 * step);
        let gy = (self.height_at(Point { x: p.x, y: p.y + step })
            - self.height_at(Point { x: p.x, y: p.y - step }))
            / (2.0 * step);
        (gx, gy)
    }

    /// Whether `p` is wet, blocked by solid rock, or outside the terrain.
    fn wet(&self, p: Point) -> bool;

    /// Water class from the planning grid and shoreline (1 sea, 2 lake, 3
    /// river, 0 if unclassified). Use [`Self::wet`] to test whether a point is wet.
    fn water_code(&self, p: Point) -> u8;

    /// Intersect a polygon with the dry land inside the terrain extent using
    /// the available vector or raster shoreline.
    fn dry_clip(&self, shape: &Shape) -> Vec<Shape>;
}
