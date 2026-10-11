//! Laplacian reconstruction of metres from the decoder residual and the base
//! low-frequency channel, ported from `WorldPipeline._compute_elev`.

pub const RESIDUAL_STD: f32 = 0.7;
pub const LOWFREQ_MEAN: f32 = -31.4;
pub const LOWFREQ_STD: f32 = 38.6;

/// Square single-channel raster.
#[derive(Clone)]
pub struct Grid {
    pub n: usize,
    pub v: Vec<f32>,
}

impl Grid {
    pub fn at(&self, y: usize, x: usize) -> f32 {
        self.v[y * self.n + x]
    }
}

/// Bilinear weights of `torch.nn.functional.interpolate(align_corners=False)` upsampling.
fn bilinear_taps(input: usize, output: usize) -> Vec<(usize, usize, f32)> {
    let scale = input as f32 / output as f32;
    (0..output)
        .map(|o| {
            let src = ((o as f32 + 0.5) * scale - 0.5).max(0.0);
            let i0 = (src as usize).min(input - 1);
            let i1 = if i0 < input - 1 { i0 + 1 } else { i0 };
            (i0, i1, src - i0 as f32)
        })
        .collect()
}

fn resize_bilinear(src: &Grid, output: usize) -> Grid {
    let taps = bilinear_taps(src.n, output);
    let mut rows = vec![0.0f32; src.n * output];
    for y in 0..src.n {
        for (x, &(a, b, t)) in taps.iter().enumerate() {
            rows[y * output + x] = src.at(y, a) * (1.0 - t) + src.at(y, b) * t;
        }
    }
    let mut v = vec![0.0f32; output * output];
    for (y, &(a, b, t)) in taps.iter().enumerate() {
        for x in 0..output {
            v[y * output + x] = rows[a * output + x] * (1.0 - t) + rows[b * output + x] * t;
        }
    }
    Grid { n: output, v }
}

/// Antialiased bilinear downsampling (`antialias=True`, triangle filter of support `scale`).
fn resize_antialiased(src: &Grid, output: usize) -> Grid {
    let scale = src.n as f32 / output as f32;
    let support = scale;
    let taps: Vec<(usize, Vec<f32>)> = (0..output)
        .map(|i| {
            let center = scale * (i as f32 + 0.5);
            let xmin = ((center - support + 0.5) as i64).max(0) as usize;
            let xmax = ((center + support + 0.5) as i64).min(src.n as i64) as usize;
            let mut w: Vec<f32> = (xmin..xmax)
                .map(|j| {
                    let x = (j as f32 - center + 0.5) / scale;
                    (1.0 - x.abs()).max(0.0)
                })
                .collect();
            let total: f32 = w.iter().sum();
            w.iter_mut().for_each(|v| *v /= total);
            (xmin, w)
        })
        .collect();
    let mut rows = vec![0.0f32; src.n * output];
    for y in 0..src.n {
        for (x, (start, w)) in taps.iter().enumerate() {
            rows[y * output + x] = w
                .iter()
                .enumerate()
                .map(|(k, w)| src.at(y, start + k) * w)
                .sum();
        }
    }
    let mut v = vec![0.0f32; output * output];
    for (y, (start, w)) in taps.iter().enumerate() {
        for x in 0..output {
            v[y * output + x] = w
                .iter()
                .enumerate()
                .map(|(k, w)| rows[(start + k) * output + x] * w)
                .sum();
        }
    }
    Grid { n: output, v }
}

/// torchvision `gaussian_blur` with reflect padding.
fn gaussian_blur(src: &Grid, size: usize, sigma: f32) -> Grid {
    let half = (size as f32 - 1.0) * 0.5;
    let mut kernel: Vec<f32> = (0..size)
        .map(|i| {
            let x = -half + i as f32;
            (-0.5 * (x / sigma).powi(2)).exp()
        })
        .collect();
    let total: f32 = kernel.iter().sum();
    kernel.iter_mut().for_each(|k| *k /= total);
    let n = src.n as i64;
    let reflect = |i: i64| -> usize {
        let i = if i < 0 { -i } else { i };
        (if i >= n { 2 * n - 2 - i } else { i }) as usize
    };
    let r = (size / 2) as i64;
    let mut rows = vec![0.0f32; src.v.len()];
    for y in 0..src.n {
        for x in 0..src.n {
            rows[y * src.n + x] = kernel
                .iter()
                .enumerate()
                .map(|(k, w)| src.at(y, reflect(x as i64 + k as i64 - r)) * w)
                .sum();
        }
    }
    let mut v = vec![0.0f32; src.v.len()];
    for y in 0..src.n {
        for x in 0..src.n {
            v[y * src.n + x] = kernel
                .iter()
                .enumerate()
                .map(|(k, w)| rows[reflect(y as i64 + k as i64 - r) * src.n + x] * w)
                .sum();
        }
    }
    Grid { n: src.n, v }
}

fn pad_linear(src: &Grid) -> Grid {
    let n = src.n;
    let m = n + 2;
    let mut v = vec![0.0f32; m * m];
    for y in 0..n {
        for x in 0..n {
            v[(y + 1) * m + x + 1] = src.at(y, x);
        }
    }
    for x in 1..=n {
        v[x] = 2.0 * v[m + x] - v[2 * m + x];
        v[(m - 1) * m + x] = 2.0 * v[(m - 2) * m + x] - v[(m - 3) * m + x];
    }
    for y in 0..m {
        v[y * m] = 2.0 * v[y * m + 1] - v[y * m + 2];
        v[y * m + m - 1] = 2.0 * v[y * m + m - 2] - v[y * m + m - 3];
    }
    Grid { n: m, v }
}

/// `resize_extrapolated`: linear extrapolation by one cell, then bilinear resize.
fn resize_extrapolated(src: &Grid, output: usize) -> Grid {
    let scale = output / src.n;
    let padded = resize_bilinear(&pad_linear(src), output + 2 * scale);
    let mut v = vec![0.0f32; output * output];
    for y in 0..output {
        v[y * output..(y + 1) * output].copy_from_slice(
            &padded.v[(y + scale) * padded.n + scale..(y + scale) * padded.n + scale + output],
        );
    }
    Grid { n: output, v }
}

/// Signed metres of the crop `[offset, offset + size)` of the padded region.
/// `residual` is the normalized decoder field (`n = 8 · lowfreq.n`).
pub fn elevation(residual: &Grid, lowfreq: &Grid, offset: usize, size: usize) -> Vec<f32> {
    let residual = Grid {
        n: residual.n,
        v: residual.v.iter().map(|r| r * RESIDUAL_STD).collect(),
    };
    let lowfreq = Grid {
        n: lowfreq.n,
        v: lowfreq
            .v
            .iter()
            .map(|l| l * LOWFREQ_STD + LOWFREQ_MEAN)
            .collect(),
    };
    // laplacian_denoise: decode with extrapolation, then re-encode the low band.
    let up = resize_extrapolated(&lowfreq, residual.n);
    let decoded = Grid {
        n: residual.n,
        v: residual.v.iter().zip(&up.v).map(|(r, l)| r + l).collect(),
    };
    let denoised = gaussian_blur(&resize_antialiased(&decoded, lowfreq.n), 11, 5.0);
    let up = resize_bilinear(&denoised, residual.n);
    let mut out = Vec::with_capacity(size * size);
    for y in offset..offset + size {
        for x in offset..offset + size {
            let s = residual.at(y, x) + up.at(y, x);
            out.push(s.signum() * s * s);
        }
    }
    out
}

/// Bilinear resampling of a native crop to `n²` cell centres over `extent_m`.
pub fn resample(native: &[f32], native_n: usize, cell_m: f64, extent_m: f64, n: usize) -> Vec<f32> {
    let coord = |i: usize| {
        ((i as f64 + 0.5) * extent_m / n as f64 / cell_m - 0.5).clamp(0.0, (native_n - 1) as f64)
    };
    let taps: Vec<(usize, usize, f32)> = (0..n)
        .map(|i| {
            let c = coord(i);
            let a = c.floor() as usize;
            let b = (a + 1).min(native_n - 1);
            (a, b, (c - a as f64) as f32)
        })
        .collect();
    let mut out = vec![0.0f32; n * n];
    for (y, &(ya, yb, ty)) in taps.iter().enumerate() {
        for (x, &(xa, xb, tx)) in taps.iter().enumerate() {
            let top = native[ya * native_n + xa] * (1.0 - tx) + native[ya * native_n + xb] * tx;
            let bottom = native[yb * native_n + xa] * (1.0 - tx) + native[yb * native_n + xb] * tx;
            out[y * n + x] = top * (1.0 - ty) + bottom * ty;
        }
    }
    out
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn antialiased_constant_is_preserved() {
        let g = Grid {
            n: 64,
            v: vec![3.0; 64 * 64],
        };
        let d = resize_antialiased(&g, 8);
        assert!(d.v.iter().all(|v| (v - 3.0).abs() < 1e-5));
        let b = gaussian_blur(&d, 11, 5.0);
        assert!(b.v.iter().all(|v| (v - 3.0).abs() < 1e-5));
    }

    #[test]
    fn extrapolation_keeps_linear_ramps() {
        let g = Grid {
            n: 6,
            v: (0..36).map(|i| (i % 6) as f32).collect(),
        };
        let up = resize_extrapolated(&g, 48);
        for x in 0..48 {
            let expected = (x as f32 + 0.5) / 8.0 - 0.5;
            assert!(
                (up.at(10, x) - expected).abs() < 1e-4,
                "{x}: {}",
                up.at(10, x)
            );
        }
    }
}
