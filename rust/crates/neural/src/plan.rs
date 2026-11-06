//! Finite window plan for one square map, from the delivered crop back to coarse.
//!
//! Coordinates are integer cells of each stage: residual cells of 30 m, latent
//! cells of 240 m and coarse cells of 7 680 m. Tile `t` of a stage covers
//! `[stride·t, stride·t + size)`, exactly as the upstream infinite tensors.

pub const NATIVE_M: f64 = 30.0;
pub const MAX_EXTENT_M: f64 = 200_000.0;
pub const LATENT: i64 = 8;
pub const COARSE: i64 = 32;
pub const DECODER_SIZE: i64 = 512;
pub const DECODER_STRIDE: i64 = 384;
pub const BASE_SIZE: i64 = 64;
pub const BASE_STRIDE: i64 = 32;
pub const COARSE_SIZE: i64 = 64;
pub const COARSE_STRIDE: i64 = 48;
/// Laplacian reconstruction margin: (11 // 2 + 1) latent cells.
pub const ELEVATION_PAD: i64 = 6 * LATENT;

/// A fixed world-grid placement that keeps the full-context dependency inside
/// one coarse tile for every supported regional extent, including 200 km.
pub const REGIONAL_ORIGIN: i64 = 4784;

#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub struct Span {
    pub start: i64,
    pub end: i64,
}

impl Span {
    pub fn len(&self) -> usize {
        (self.end - self.start).max(0) as usize
    }
    pub fn is_empty(&self) -> bool {
        self.end <= self.start
    }
    pub fn tiles(&self) -> impl Iterator<Item = i64> {
        self.start..self.end
    }
}

/// Tiles whose `[stride·t, stride·t + size)` intersects `[a, b)`.
fn overlapping(a: i64, b: i64, size: i64, stride: i64) -> Span {
    Span {
        start: (a - size).div_euclid(stride) + 1,
        end: (b - 1).div_euclid(stride) + 1,
    }
}

#[derive(Clone, Debug)]
pub struct Plan {
    /// Delivered native crop `[origin, origin + size)` on both axes.
    pub origin: i64,
    pub size: usize,
    /// Residual cells read by the reconstruction.
    pub residual: Span,
    pub decoder: Span,
    /// Latent cells written by base windows and read downstream.
    pub latent: Span,
    pub base: Span,
    pub coarse_cells: Span,
    pub coarse: Span,
}

impl Plan {
    /// Full-context regional plan. Reject a request whose dependencies cross
    /// another coarse tile rather than silently adding a second coarse pass.
    pub fn regional(extent_m: f64) -> Result<Self, String> {
        if !extent_m.is_finite() || !(500.0..=MAX_EXTENT_M).contains(&extent_m) {
            return Err(format!(
                "Neural extent must be between 500 and {MAX_EXTENT_M} metres"
            ));
        }
        let plan = Self::with_context(
            REGIONAL_ORIGIN,
            Self::cells(extent_m),
            true,
            ELEVATION_PAD,
            1,
            3,
        );
        if plan.coarse.len() != 1 {
            return Err("Neural region requires more than one coarse window".into());
        }
        Ok(plan)
    }

    /// `exact` blends every decoder window of the margin, as the infinite reference.
    pub fn new(origin: i64, size: usize, exact: bool) -> Self {
        Self::with_context(origin, size, exact, ELEVATION_PAD, 1, 3)
    }

    fn with_context(
        origin: i64,
        size: usize,
        exact: bool,
        pad: i64,
        coarse_before: i64,
        coarse_after: i64,
    ) -> Self {
        let residual = Span {
            start: (origin - pad).div_euclid(LATENT) * LATENT,
            end: -(-(origin + size as i64 + pad)).div_euclid(LATENT) * LATENT,
        };
        let decoder = if exact {
            overlapping(residual.start, residual.end, DECODER_SIZE, DECODER_STRIDE)
        } else {
            overlapping(origin, origin + size as i64, DECODER_SIZE, DECODER_STRIDE)
        };
        let decoder_latent = Span {
            start: decoder.start * DECODER_STRIDE / LATENT,
            end: (decoder.end - 1) * DECODER_STRIDE / LATENT + DECODER_SIZE / LATENT,
        };
        let latent = Span {
            start: decoder_latent.start.min(residual.start / LATENT),
            end: decoder_latent.end.max(residual.end / LATENT),
        };
        let base = overlapping(latent.start, latent.end, BASE_SIZE, BASE_STRIDE);
        let coarse_cells = Span {
            start: base.start - coarse_before,
            end: base.end - 1 + coarse_after,
        };
        let coarse = overlapping(
            coarse_cells.start,
            coarse_cells.end,
            COARSE_SIZE,
            COARSE_STRIDE,
        );
        Self {
            origin,
            size,
            residual,
            decoder,
            latent,
            base,
            coarse_cells,
            coarse,
        }
    }

    /// Native cells for an extent in metres (1 334 for 40 km).
    pub fn cells(extent_m: f64) -> usize {
        (extent_m / NATIVE_M).ceil() as usize
    }

    pub fn evaluations(&self, coarse_steps: usize) -> (usize, usize, usize) {
        (
            self.coarse.len().pow(2) * coarse_steps,
            self.base.len().pow(2),
            self.decoder.len().pow(2),
        )
    }

    /// Map metres of a coarse cell centre, relative to the delivered crop origin.
    pub fn coarse_center_m(&self, cell: i64) -> f64 {
        (cell as f64 + 0.5) * (COARSE * LATENT) as f64 * NATIVE_M - self.origin as f64 * NATIVE_M
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn reference_origin_matches_validation_counts() {
        let plan = Plan::new(0, Plan::cells(40000.0), true);
        assert_eq!(plan.evaluations(4), (16, 100, 25));
    }

    #[test]
    fn regional_plan_keeps_one_coarse_window_with_full_context() {
        for extent in [500.0, 2_000.0, 40_000.0, 120_000.0, 200_000.0] {
            let plan = Plan::regional(extent).unwrap();
            assert_eq!(plan.coarse.len(), 1, "{extent}");
            assert!(plan.residual.start >= plan.decoder.start * DECODER_STRIDE);
            assert!(plan.residual.end <= (plan.decoder.end - 1) * DECODER_STRIDE + DECODER_SIZE);
        }
        assert_eq!(Plan::regional(200_000.0).unwrap().size, 6667);
        assert_eq!(Plan::new(REGIONAL_ORIGIN, 6688, true).coarse.len(), 1);
        assert_eq!(Plan::new(REGIONAL_ORIGIN, 6689, true).coarse.len(), 2);
        assert!(Plan::regional(200_001.0).is_err());
        assert!(Plan::regional(f64::NAN).is_err());
    }
}
