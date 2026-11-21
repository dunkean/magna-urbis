//! Ring growth, event ordering, capacity counting, stopping and resuming.

use magna_urbis_geom::{Point, Shape};

/// One block and the frontage available to its lots.
#[derive(Clone, Debug)]
pub struct CapacityBlock {
    /// Buildable outline after street widths and reserves are deducted.
    pub outline: Shape,
    /// Segments of the outline that provide frontage.
    pub frontage_edges: Vec<[Point; 2]>,
}

/// Inputs to the lot cut frozen at birth, with the fill level being counted.
#[derive(Clone, Copy, Debug)]
pub struct CapacityInputs<'a> {
    /// Parcel pressure at birth.
    pub pressure: f64,
    /// Recipe key for the quarter's lot cut.
    pub recipe: &'a str,
    /// Growth-zone key for the quarter's lot cut.
    pub zone: &'a str,
    /// Density multiplier at birth.
    pub density: f64,
    /// Whether the quarter was born in the intramural regime.
    pub intramural: bool,
    /// Occupation share of the quarter's lots, from zero to one.
    pub fill_level: f64,
}

/// Counts households in a quarter using its blocks and birth conditions.
pub trait Capacity {
    /// Count households at the requested fill level using only this quarter.
    fn households(&self, blocks: &[CapacityBlock], inputs: CapacityInputs<'_>) -> f64;
}
