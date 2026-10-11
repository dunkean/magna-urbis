//! Portable Gaussian noise of Terrain Diffusion: PCG64 64/32 and Marsaglia polar.
//! Byte-compatible with `portable_rng.py` / `gaussian_noise_patch` (float32 output).

const MULT: u64 = 6364136223846793005;
const INC: u64 = 1442695040888963407;

#[inline]
fn pcg_next(state: &mut u64) -> u32 {
    *state = state.wrapping_mul(MULT).wrapping_add(INC);
    let s = *state;
    let x = (((s >> 18) ^ s) >> 27) as u32;
    x.rotate_right((s >> 59) as u32)
}

/// Fills `out` with standard normals from one 64-bit seed.
pub fn fill_standard_normal(seed: u64, out: &mut [f32]) {
    let mut state = seed;
    let inv = 1.0 / 4294967296.0;
    let mut i = 0;
    while i < out.len() {
        let u1 = pcg_next(&mut state);
        let u2 = pcg_next(&mut state);
        let v1 = 2.0 * (u1 as f64 + 1.0) * inv - 1.0;
        let v2 = 2.0 * (u2 as f64 + 1.0) * inv - 1.0;
        let s = v1 * v1 + v2 * v2;
        if 0.0 < s && s < 1.0 {
            let f = (-2.0 * s.ln() / s).sqrt();
            out[i] = (v1 * f) as f32;
            i += 1;
            if i < out.len() {
                out[i] = (v2 * f) as f32;
                i += 1;
            }
        }
    }
}

/// Seed of one noise tile, identical for negative tile indices.
pub fn tile_seed(base: u64, ty: i64, tx: i64) -> u64 {
    let h = base.wrapping_mul(0x9E37_79B9);
    let h = h.wrapping_add(ty as u64 & 0xFFFF_FFFF);
    h.wrapping_mul(0x9E37_79B9)
        .wrapping_add(tx as u64 & 0xFFFF_FFFF)
}

/// Seed, tile row and column, channels, tile height and width.
type TileKey = (u64, i64, i64, usize, usize, usize);

/// Memoized noise tiles: neighbouring windows overlap the same tiles.
#[derive(Default)]
pub struct NoiseTiles {
    tiles: std::collections::HashMap<TileKey, Vec<f32>>,
}

impl NoiseTiles {
    fn tile(
        &mut self,
        base: u64,
        ty: i64,
        tx: i64,
        channels: usize,
        tile_h: usize,
        tile_w: usize,
    ) -> &[f32] {
        self.tiles
            .entry((base, ty, tx, channels, tile_h, tile_w))
            .or_insert_with(|| {
                let mut tile = vec![0.0_f32; channels * tile_h * tile_w];
                fill_standard_normal(tile_seed(base, ty, tx), &mut tile);
                tile
            })
    }

    /// `(channels, h, w)` window of the infinite tile-seeded field, row-major.
    #[allow(clippy::too_many_arguments)]
    pub fn patch(
        &mut self,
        base: u64,
        y0: i64,
        x0: i64,
        h: usize,
        w: usize,
        channels: usize,
        tile_h: usize,
        tile_w: usize,
    ) -> Vec<f32> {
        let mut out = vec![0.0; channels * h * w];
        let (th, tw) = (tile_h as i64, tile_w as i64);
        for ty in y0.div_euclid(th)..=(y0 + h as i64 - 1).div_euclid(th) {
            let (oy0, oy1) = (y0.max(ty * th), (y0 + h as i64).min((ty + 1) * th));
            for tx in x0.div_euclid(tw)..=(x0 + w as i64 - 1).div_euclid(tw) {
                let (ox0, ox1) = (x0.max(tx * tw), (x0 + w as i64).min((tx + 1) * tw));
                let tile = self.tile(base, ty, tx, channels, tile_h, tile_w);
                for c in 0..channels {
                    for y in oy0..oy1 {
                        let src = (c * tile_h + (y - ty * th) as usize) * tile_w
                            + (ox0 - tx * tw) as usize;
                        let dst = (c * h + (y - y0) as usize) * w + (ox0 - x0) as usize;
                        let len = (ox1 - ox0) as usize;
                        out[dst..dst + len].copy_from_slice(&tile[src..src + len]);
                    }
                }
            }
        }
        out
    }
}

/// `(channels, h, w)` window of the infinite tile-seeded field, row-major.
#[allow(clippy::too_many_arguments)]
pub fn noise_patch(
    base: u64,
    y0: i64,
    x0: i64,
    h: usize,
    w: usize,
    channels: usize,
    tile_h: usize,
    tile_w: usize,
) -> Vec<f32> {
    let mut out = vec![0.0; channels * h * w];
    let (th, tw) = (tile_h as i64, tile_w as i64);
    let mut tile = vec![0.0_f32; channels * tile_h * tile_w];
    for ty in y0.div_euclid(th)..=(y0 + h as i64 - 1).div_euclid(th) {
        let (oy0, oy1) = (y0.max(ty * th), (y0 + h as i64).min((ty + 1) * th));
        for tx in x0.div_euclid(tw)..=(x0 + w as i64 - 1).div_euclid(tw) {
            let (ox0, ox1) = (x0.max(tx * tw), (x0 + w as i64).min((tx + 1) * tw));
            fill_standard_normal(tile_seed(base, ty, tx), &mut tile);
            for c in 0..channels {
                for y in oy0..oy1 {
                    let src = (c * tile_h + (y - ty * th) as usize) * tile_w;
                    let dst = (c * h + (y - y0) as usize) * w;
                    for x in ox0..ox1 {
                        out[dst + (x - x0) as usize] = tile[src + (x - tx * tw) as usize];
                    }
                }
            }
        }
    }
    out
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn negative_windows_assemble_tiles() {
        let whole = noise_patch(7, -64, -64, 128, 128, 2, 64, 64);
        let part = noise_patch(7, -10, 5, 30, 40, 2, 64, 64);
        assert_eq!(
            part,
            NoiseTiles::default().patch(7, -10, 5, 30, 40, 2, 64, 64)
        );
        for c in 0..2 {
            for y in 0..30 {
                for x in 0..40 {
                    assert_eq!(
                        part[(c * 30 + y) * 40 + x],
                        whole[(c * 128 + y + 54) * 128 + x + 69]
                    );
                }
            }
        }
    }
}
