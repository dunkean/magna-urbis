//! Finite window plan for one square map, from the delivered crop back to coarse.
//!
//! Coordinates are integer cells of each stage: residual cells of 30 m, latent
//! cells of 240 m and coarse cells of 7 680 m. Tile `t` of a stage covers
//! `[stride·t, stride·t + size)`, exactly as the upstream infinite tensors.

pub const NATIVE_M: f64 = 30.0;
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

/// Native crop origin where a 40 km map needs only 1 coarse, 8×8 base and 4×4
/// decoder windows. Its 48 m reconstruction margin is the only area that
/// blends fewer decoder windows than an infinite world would.
pub const FAST_ORIGIN: i64 = 6304;

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
    /// `exact` blends every decoder window of the margin, as the infinite reference.
    pub fn new(origin: i64, size: usize, exact: bool) -> Self {
        let residual = Span {
            start: (origin - ELEVATION_PAD).div_euclid(LATENT) * LATENT,
            end: -(-(origin + size as i64 + ELEVATION_PAD)).div_euclid(LATENT) * LATENT,
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
            start: base.start - 1,
            end: base.end - 1 + 3,
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
    fn fast_origin_needs_minimum_windows() {
        let plan = Plan::new(FAST_ORIGIN, Plan::cells(40000.0), false);
        assert_eq!(plan.evaluations(4), (4, 64, 16));
        assert!(plan.residual.start >= plan.decoder.start * DECODER_STRIDE);
        assert!(plan.residual.end <= (plan.decoder.end - 1) * DECODER_STRIDE + DECODER_SIZE);
    }
}
