//! Organic street tissue: a street direction field over a quarter and the
//! recursive split of the quarter by streets traced through it.
//!
//! Ported from classic's `rust/crates/core/src/urban/quarters.rs`:
//! - `params`: `OrganicParams` holds what classic's `FieldParams::new` and
//!   `split_quarter` read from the culture's `Morph` (`orientation`,
//!   `fieldWavelength`, `fieldNoise`, `fieldTwist`, `fieldRandom`,
//!   `contourFollow`, `contourBlend`, `curvature`, `blockSize`, `minBlock`,
//!   `minWidth`, `placeThreshold`, `longCut`, `widthByRank`, `widthScale`,
//!   `widthJitter`; `Morph::width`) and from `LayoutConfig` (`site_adaptation`,
//!   `axis_alignment`, the street, lane and stair grades, `allow_stairs`, the
//!   faubourg elongation limit); `OrganicSite` the town values of `Field`
//!   (`center`, `radius`, the `field` noise stream).
//! - `field`: `Field::angle`, `Field::adapt_angle`, `Field::base`, the
//!   town angles computed in `generate_once` (road, terrain, water), and
//!   `RegionalIndex` with the `major` street pull, both fed by the armature.
//! - `noise`: the terrain crate's `Noise::fbm` (unfiltered).
//! - `grade`: `routing::segment_grade`, `segment_clear` and `path_clear`.
//! - `trace`: `Field::trace`, `TraceIndex`, `PathGrid`.
//! - `split`: `split_quarter`, `cut_candidate`, `street_anchors`,
//!   `straight_cut`, `chord_split`, `acute_ends`, `frame`, `add`.
//!
//! On a steep quarter (`slope`: mean grade past `SlopeParams::steep_grade`) the
//! field takes the contour as a floor on its contour weights, the split adds a
//! cost to cuts across the contours and lays no stairs; the stepped links
//! between its contour streets are laid afterwards by `tissue::stairs`. A quarter
//! on terraced land is laid with `OrganicParams::terraced`.
//!
//! Left to other tissues or stages: the planned grid (`streetOp: grid`,
//! lattices and frames), camps, growth phases inside one quarter and their
//! zone blend, dead-end closes (`closes`), and block carving by street ribbons.
//! Classic's check that a cut reaches the street network is implied here:
//! every side of a piece lies on the quarter outline or on a draft street.
//! The planning-grid water stencil reads the terrain's water class per cell.

mod field;
pub(crate) mod grade;
mod noise;
mod params;
mod slope;
mod split;
mod trace;

#[cfg(test)]
mod tests;

pub use params::{FieldOrientation, OrganicParams, OrganicSite, SlopeParams, TerracedParams};
pub use split::{Piece, PieceKind};

use crate::tissue::{DraftStreet, TissueDraft};
use field::Field;
use magna_urbis_geom::surface::TerrainView;
use magna_urbis_geom::{Point, Shape};
use magna_urbis_random::Rng;
use split::Splitter;

/// Streets and pieces of one quarter split by the organic tissue.
#[derive(Clone, Debug)]
pub struct OrganicSplit {
    /// Streets in the order they were laid.
    pub streets: Vec<DraftStreet>,
    /// The pieces between the outline and the streets, centre lines included.
    pub pieces: Vec<Piece>,
}

/// Split a quarter outline by organic streets. `armature` holds the
/// polylines of the town's main chains and regional roads, which orient the
/// field as classic's regional roads and main streets do; `site` the town
/// values shared by its quarters; `rng` the quarter's own stream.
pub fn split_quarter(
    outline: &Shape,
    terrain: &dyn TerrainView,
    armature: &[Vec<Point>],
    site: &OrganicSite,
    params: &OrganicParams,
    rng: &mut Rng,
) -> OrganicSplit {
    let steep = slope::steepness(outline, terrain, params);
    let field = Field::new(terrain, armature, site, params, steep);
    let mut splitter = Splitter::new(&field);
    let pieces = splitter.run(outline, rng);
    OrganicSplit {
        streets: splitter.streets,
        pieces,
    }
}

/// The streets classic's recursive split lays inside one quarter outline.
pub fn lay_streets(
    outline: &Shape,
    terrain: &dyn TerrainView,
    armature: &[Vec<Point>],
    site: &OrganicSite,
    params: &OrganicParams,
    rng: &mut Rng,
) -> TissueDraft {
    TissueDraft {
        streets: split_quarter(outline, terrain, armature, site, params, rng).streets,
    }
}
