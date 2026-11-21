//! Plain-data inputs of the organic tissue: the culture's street morphology and
//! the town context shared by all of its quarters.

use crate::tissue::stairs::StairParams;
use magna_urbis_geom::Point;
use magna_urbis_random::Rng;
use serde::{Deserialize, Serialize};

/// Base orientation of the street field before noise, slope and roads act on it.
#[derive(Clone, Copy, Debug, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "kebab-case")]
pub enum FieldOrientation {
    /// Due east and north.
    Cardinal,
    /// Along the contour at the town centre.
    Terrain,
    /// Along the nearest shore seen from the town centre.
    Water,
    /// Along the road nearest the town centre.
    Road,
}

/// Street morphology of an organic tissue, resolved by the caller from the
/// culture, the quarter's zone and the layout settings. Defaults are classic's
/// values for the European organic core.
#[derive(Clone, Debug, PartialEq, Serialize, Deserialize)]
#[serde(default, rename_all = "camelCase")]
pub struct OrganicParams {
    /// Base orientation of the field (catalogue `orientation`; default road).
    pub orientation: FieldOrientation,
    /// Wavelength in metres of the orientation noise (`fieldWavelength`; 150).
    pub field_wavelength: f64,
    /// Amplitude in degrees of the orientation noise (`fieldNoise`; 17).
    pub field_noise: f64,
    /// Constant turn in radians added to the base orientation (`fieldTwist`; 0).
    pub field_twist: f64,
    /// Share of a slow random orientation mixed into the field (`fieldRandom`; 0.45).
    pub field_random: f64,
    /// Share of the contour direction taken on slopes from 2 to 6 % instead of
    /// the base orientation; above 0 the field follows contours like terraces
    /// (`contourFollow`; 0).
    pub contour_follow: f64,
    /// Extra share of the contour direction from 2.5 to 8 % slope (`contourBlend`; 0).
    pub contour_blend: f64,
    /// Turn allowed per 5 m step, in units of 5 degrees (`curvature`; 0.55).
    pub curvature: f64,
    /// Radial base orientation, pointing away from the town centre (culture
    /// pattern `radial` or the radial tissue; false).
    pub radial: bool,
    /// Orientation taken from the armature roads nearby rather than from the
    /// culture's base (layout `axisAlignment: regional`; true).
    pub align_to_roads: bool,
    /// Strength of the response to slope and banks, 0 to 2 (`siteAdaptation`; 1).
    pub site_adaptation: f64,
    /// Block size range in square metres for the quarter's zone (`blockSize`;
    /// core 2200 to 6500). A village zone passes 2.5 times its catalogue range.
    pub block_size: [f64; 2],
    /// Smallest block in square metres a cut may leave (`minBlock`; 700).
    pub min_block: f64,
    /// Smallest width in metres a cut may leave on either side (`minWidth`; 17).
    pub min_width: f64,
    /// Largest leftover in square metres kept as a small place (`placeThreshold`; 900).
    pub place_threshold: f64,
    /// Length from which a cut stays a street of rank 2 when it keeps street
    /// grade, 0 for none (`longCut`; 0).
    pub long_cut: f64,
    /// Elongation (long over short side) above which a piece smaller than its
    /// target is still cut: 2.6, or 7 in a faubourg.
    pub max_aspect: f64,
    /// Width in metres per street rank 0 to 4 (`widthByRank`; 8, 6.2, 4.6, 3.2, 2.5).
    pub width_by_rank: [f64; 5],
    /// Multiplier on every width (`widthScale`; 1).
    pub width_scale: f64,
    /// Relative random spread of a street's width at each end (`widthJitter`; 0.12).
    pub width_jitter: f64,
    /// Steepest grade of a street (`maxStreetGrade`; 0.12).
    pub max_street_grade: f64,
    /// Steepest grade of a lane (`maxLaneGrade`; 0.18).
    pub max_lane_grade: f64,
    /// Steepest grade of a flight of stairs (`maxStairGrade`; 0.65).
    pub max_stair_grade: f64,
    /// Whether cuts may be stairs: the layout setting and a culture that builds
    /// stairs or terraces (false for the European organic culture).
    pub allow_stairs: bool,
    /// Response to slope: contour streets on steep quarters, the terraced tissue and the
    /// stepped links between contour streets.
    pub slope: SlopeParams,
}

/// How the organic tissue answers a slope. A quarter whose mean grade passes `steep_grade`
/// turns its streets along the contours and prefers cuts along them; its cuts are never stairs,
/// as flights are laid afterwards by the stepped links under the owner's rule (short, sparse,
/// never side by side).
#[derive(Clone, Debug, PartialEq, Serialize, Deserialize)]
#[serde(default, rename_all = "camelCase")]
pub struct SlopeParams {
    /// Mean grade of a quarter from which its streets turn along the contours; the response is
    /// full from twice this grade (default 0.08, between the 6 % at which classic's field
    /// starts turning streets along contours and the 12 % street grade).
    pub steep_grade: f64,
    /// Share of the contour direction in the field of a fully steep quarter (default 0.95).
    pub contour_weight: f64,
    /// Cost added to a cut running straight across the contours in a fully steep quarter, on
    /// the scale of the split's balance and slenderness costs (default 1.5: a cut along the
    /// contours wins until the strips it leaves grow about five times longer than deep).
    pub contour_cut: f64,
    /// Tissue of a quarter most of whose land is terraced.
    pub terraced: TerracedParams,
    /// Stepped links between contour streets.
    pub stairs: StairParams,
}

impl Default for SlopeParams {
    fn default() -> Self {
        Self {
            steep_grade: 0.08,
            contour_weight: 0.95,
            contour_cut: 1.5,
            terraced: TerracedParams::default(),
            stairs: StairParams::default(),
        }
    }
}

/// The terraced form of a tissue: shallow blocks drawn out along the contour between two
/// contour streets, with narrow lots. Defaults to tune on sheets.
#[derive(Clone, Debug, PartialEq, Serialize, Deserialize)]
#[serde(default, rename_all = "camelCase")]
pub struct TerracedParams {
    /// Multiplier on the zone's block size range and smallest block (default 0.6).
    pub block_scale: f64,
    /// Smallest block width in metres, across the contour (default 14: a row of shallow
    /// terrace houses back to back with the row above).
    pub min_width: f64,
    /// Elongation up to which a block smaller than its target is left uncut (default 6: long
    /// strips along the contour are the terrace's form).
    pub max_aspect: f64,
    /// Multiplier on lot frontage for the lot cut of terraced blocks (default 0.75: terrace lots
    /// are narrower along the contour).
    pub lot_frontage_scale: f64,
}

impl Default for TerracedParams {
    fn default() -> Self {
        Self {
            block_scale: 0.6,
            min_width: 14.0,
            max_aspect: 6.0,
            lot_frontage_scale: 0.75,
        }
    }
}

impl Default for OrganicParams {
    fn default() -> Self {
        Self {
            orientation: FieldOrientation::Road,
            field_wavelength: 150.0,
            field_noise: 17.0,
            field_twist: 0.0,
            field_random: 0.45,
            contour_follow: 0.0,
            contour_blend: 0.0,
            curvature: 0.55,
            radial: false,
            align_to_roads: true,
            site_adaptation: 1.0,
            block_size: [2200.0, 6500.0],
            min_block: 700.0,
            min_width: 17.0,
            place_threshold: 900.0,
            long_cut: 0.0,
            max_aspect: 2.6,
            width_by_rank: [8.0, 6.2, 4.6, 3.2, 2.5],
            width_scale: 1.0,
            width_jitter: 0.12,
            max_street_grade: 0.12,
            max_lane_grade: 0.18,
            max_stair_grade: 0.65,
            allow_stairs: false,
            slope: SlopeParams::default(),
        }
    }
}

impl OrganicParams {
    /// The same tissue in its terraced form, for a quarter most of whose land is terraced.
    pub fn terraced(&self) -> Self {
        let t = &self.slope.terraced;
        Self {
            block_size: self.block_size.map(|a| a * t.block_scale),
            min_block: self.min_block * t.block_scale,
            min_width: self.min_width.min(t.min_width),
            max_aspect: self.max_aspect.max(t.max_aspect),
            ..self.clone()
        }
    }

    /// Width of a new street of `rank` at one of its ends.
    pub(super) fn width(&self, rank: u8, rng: &mut Rng) -> f64 {
        self.width_by_rank[usize::from(rank).min(4)]
            * self.width_scale
            * rng.range(1.0 - self.width_jitter, 1.0 + self.width_jitter)
    }
}

/// Town context shared by every quarter of a town, so that the street field
/// runs on across quarter edges.
#[derive(Clone)]
pub struct OrganicSite {
    /// Town centre in map-local metres.
    pub centre: Point,
    /// Radius in metres of the town's nucleus. Roads within 1.5 radii orient the field.
    pub radius: f64,
    /// The town's street field stream: it seeds the orientation noise and the
    /// fallback orientation of a town without roads.
    pub field: Rng,
}
