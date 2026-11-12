//! Crown-root beach grid of the V2 forest (port of `forestBeachGrid` in
//! `rust/bridge/terrainForestBeach.ts`): the CPU copy of the shaders'
//! `forestBeachCoverage`, baked once per terrain on a world-space grid.

use crate::forest::{forest_hash, Heights};
use crate::terrain_par::rows;

fn sstep(a: f64, b: f64, x: f64) -> f64 {
    let t = f64::min(1.0, f64::max(0.0, (x - a) / (b - a)));
    t * t * (3.0 - 2.0 * t)
}

/// Uniform cubic B-spline weights and derivative weights.
fn weights(t: f64) -> ([f64; 4], [f64; 4]) {
    let (t2, t3, u) = (t * t, t * t * t, 1.0 - t);
    (
        [u * u * u / 6.0, (3.0 * t3 - 6.0 * t2 + 4.0) / 6.0, (-3.0 * t3 + 3.0 * t2 + 3.0 * t + 1.0) / 6.0, t3 / 6.0],
        [-0.5 * u * u, 1.5 * t2 - 2.0 * t, -1.5 * t2 + t + 0.5, 0.5 * t2],
    )
}

struct Layer<'a> {
    heights: &'a Heights<'a>,
    x: f64,
    y: f64,
    n: usize,
    cell: f64,
}
impl Layer<'_> {
    /// Height, dh/dx, dh/dy of the base layer at world position (`level(0, world)`).
    fn surface(&self, wxm: f64, wym: f64) -> (f64, f64, f64) {
        let (n, data) = (self.n, self.heights.data);
        let (gx0, gy0) = ((wxm - self.x) / self.cell - 0.5, (wym - self.y) / self.cell - 0.5);
        let (fx, fy) = (gx0.floor(), gy0.floor());
        let ((wx, dx), (wy, dy)) = (weights(gx0 - fx), weights(gy0 - fy));
        let (bx, by) = (fx as i64 - 1, fy as i64 - 1);
        let last = n as i64 - 1;
        let (mut h, mut gx, mut gy) = (0.0, 0.0, 0.0);
        for j in 0..4 {
            let o = (by + j as i64).clamp(0, last) as usize * n;
            let (mut r, mut rd) = (0.0, 0.0);
            for i in 0..4 {
                let v = data[o + (bx + i as i64).clamp(0, last) as usize] as f64;
                r += v * wx[i];
                rd += v * dx[i];
            }
            h += r * wy[j];
            gx += rd * wy[j];
            gy += r * dy[j];
        }
        (h, gx / self.cell, gy / self.cell)
    }
}

fn hash(cx: i32, cy: i32, cz: i32, salt: u32) -> u32 {
    forest_hash(cx, cy, cz, salt)
}
fn corner(cx: i32, cy: i32, cz: i32, fx: f64, fy: f64, fz: f64, ox: i32, oy: i32, oz: i32, salt: u32) -> f64 {
    let h = hash(cx.wrapping_add(ox), cy.wrapping_add(oy), cz.wrapping_add(oz), salt);
    ((h & 1023) as f64 / 511.5 - 1.0) * (fx - ox as f64) + (((h >> 10) & 1023) as f64 / 511.5 - 1.0) * (fy - oy as f64) + (((h >> 20) & 1023) as f64 / 511.5 - 1.0) * (fz - oz as f64)
}
/// Gradient noise on the z = 0 plane: the upper lattice layer has weight zero
/// there (`uz = 0`), so `y0 + (y1 - y0) * 0 = y0` and its corners are skipped.
fn noise(px: f64, py: f64, salt: u32) -> f64 {
    let (flx, fly) = (px.floor() as i64 as i32, py.floor() as i64 as i32);
    let (fx, fy, fz) = (px - px.floor(), py - py.floor(), 0.0);
    let q = |f: f64| f * f * f * (f * (f * 6.0 - 15.0) + 10.0);
    let (ux, uy) = (q(fx), q(fy));
    let c = |ox: i32, oy: i32| corner(flx, fly, 0, fx, fy, fz, ox, oy, 0, salt);
    let (a0, a1, a2, a3) = (c(0, 0), c(1, 0), c(0, 1), c(1, 1));
    let (x0, x1) = (a0 + (a1 - a0) * ux, a2 + (a3 - a2) * ux);
    (x0 + (x1 - x0) * uy) * 5.25
}
/// surfaceFbm at z = 0, as value * sqrt(retained variance fraction).
fn fbm(x: f64, y: f64, scale: f64, octaves: u32, footprint: f64, salt: u32) -> f64 {
    let (mut value, mut kept, mut total, mut s, mut a) = (0.0, 0.0, 0.0, scale, 1.0);
    for i in 0..octaves {
        total += a * a;
        if footprint < s * 0.25 {
            let fade = 1.0 - sstep(s * 0.125, s * 0.25, footprint);
            value += a * fade * noise(x / s, y / s, salt.wrapping_add(i.wrapping_mul(0x9e37)));
            kept += a * fade * a * fade;
        }
        a *= 0.5;
        s *= 0.5;
    }
    if kept > 0.0 {
        value /= f64::sqrt(kept);
    }
    value * f64::sqrt(kept / total)
}

const FP: f64 = 30.0;

/// forestBeachCoverage(world) in 0..1; `temperature` is the sea-level climate temperature (uMaterialClimate.x).
fn coverage_at(layer: &Layer, dirs: &[(f64, f64); 12], seed: u32, temperature: f64, wxm: f64, wym: f64) -> f64 {
    let (h, gx, gy) = layer.surface(wxm, wym);
    let slope = f64::hypot(gx, gy);
    if h < 0.0 || h >= 12.0 || slope >= 0.5 {
        return 0.0;
    }
    let r = f64::max(300.0, 2.0 * layer.cell);
    let mut shore = f64::max(h, 0.0) / f64::max(slope, 0.0001);
    let mut openness = 0.0;
    for d in dirs {
        if layer.surface(wxm + d.0 * r, wym + d.1 * r).0 < 0.0 {
            shore = f64::min(shore, r);
            openness += 1.0 / 12.0;
        }
        if layer.surface(wxm + d.0 * r * 0.5, wym + d.1 * r * 0.5).0 < 0.0 {
            shore = f64::min(shore, r * 0.5);
        }
    }
    if openness <= 0.15 {
        return 0.0;
    }
    let reach = fbm(wxm, wym, 20000.0, 3, FP, seed.wrapping_add(7));
    let grove = fbm(wxm, wym, 4800.0, 4, FP, seed.wrapping_add(3));
    let fine = fbm(wxm, wym, 240.0, 4, FP, seed.wrapping_add(5));
    // surfaceBeachWidth: the climate sets the sand supply, noise only varies it along the coast around that mean.
    let supply = 40.0 + 80.0 * sstep(8.0, 22.0, temperature);
    let along = sstep(-0.8, 0.8, 0.65 * reach + 0.5 * grove);
    let width = supply * (0.4 + 0.8 * along) * sstep(0.15, 0.4, openness) * (1.0 + 0.35 * fine);
    f64::min(1.0, f64::max(0.0, (f64::min(width, 20.0 * FP) - shore + FP) / FP)) * (1.0 - sstep(4.0, 12.0, h)) * (1.0 - sstep(0.2, 0.5, slope))
}

/// Bakes the coverage on a `resolution`² grid of texel centres (row j = increasing world y), as bytes.
#[allow(clippy::too_many_arguments)]
pub(crate) fn beach_grid(heights: &Heights, x: f64, y: f64, width: f64, n: usize, seed: u32, temperature: f64, resolution: usize) -> Vec<u8> {
    let layer = Layer { heights, x, y, n, cell: width / n as f64 };
    let c = width / resolution as f64;
    let mut dirs = [(0.0, 0.0); 12];
    for (i, d) in dirs.iter_mut().enumerate() {
        *d = ((i as f64 * 0.523598776).cos(), (i as f64 * 0.523598776).sin());
    }
    let mut data = vec![0u8; resolution * resolution];
    rows(&mut data, resolution, |j, row| {
        let wy0 = y + (j as f64 + 0.5) * c;
        for (i, out) in row.iter_mut().enumerate() {
            *out = (coverage_at(&layer, &dirs, seed, temperature, x + (i as f64 + 0.5) * c, wy0) * 255.0 + 0.5).floor() as u8;
        }
    });
    data
}
