//! Forest control field of the V2 render (port of `rust/bridge/terrainForest.ts`
//! `buildForestField`): Render's tree eligibility, the base climate grid and the
//! full-resolution clearing pass, plus the riparian bank envelope
//! (`forest_bank.rs`) and the crown-root beach grid (`forest_beach.rs`).
//!
//! Same algorithm and the same integer hashes as the TypeScript original; only
//! float rounding of libm functions may differ. Rows run in parallel through
//! `terrain_par`, every row writing only its own slice, so the output does not
//! depend on the thread count. Display only: never feeds terrain.

use crate::forest_bank::{bank_field, forest_bank_density, lake_interior, routing_river_segments, Bank, BankContext};
use crate::forest_beach::beach_grid;
use crate::terrain_par::rows;
use serde::Deserialize;
use std::f64::consts::PI;
use std::sync::OnceLock;

pub(crate) fn clamp(v: f64, a: f64, b: f64) -> f64 {
    if v < a { a } else if v > b { b } else { v }
}
pub(crate) fn sstep(a: f64, b: f64, v: f64) -> f64 {
    let mut t = (v - a) / (b - a);
    t = if t < 0.0 { 0.0 } else if t > 1.0 { 1.0 } else { t };
    t * t * (3.0 - 2.0 * t)
}
/// `Math.round` for the non-negative values used here.
pub(crate) fn js_round(v: f64) -> f64 {
    (v + 0.5).floor()
}
/// `Math.floor(v)` taken through `ToInt32`, as `Math.imul` does.
pub(crate) fn floor_i32(v: f64) -> i32 {
    v.floor() as i64 as i32
}
fn byte(v: f64) -> u8 {
    if v <= 0.0 { 0 } else if v >= 1.0 { 255 } else { (v * 255.0 + 0.5) as u8 }
}

pub(crate) fn forest_hash(x: i32, y: i32, z: i32, seed: u32) -> u32 {
    let mut h = (x as u32).wrapping_mul(0x9e37_79b9) ^ (y as u32).wrapping_mul(0x85eb_ca6b) ^ (z as u32).wrapping_mul(0xc2b2_ae35) ^ seed;
    h = (h ^ (h >> 16)).wrapping_mul(0x7feb_352d);
    h = (h ^ (h >> 15)).wrapping_mul(0x846c_a68b);
    h ^ (h >> 16)
}

fn gradients() -> &'static ([f64; 16], [f64; 16]) {
    static G: OnceLock<([f64; 16], [f64; 16])> = OnceLock::new();
    G.get_or_init(|| {
        let (mut gx, mut gy) = ([0.0; 16], [0.0; 16]);
        for i in 0..16 {
            let a = i as f64 * PI / 8.0 + 0.2;
            gx[i] = a.cos();
            gy[i] = a.sin();
        }
        (gx, gy)
    })
}
fn quintic(f: f64) -> f64 {
    f * f * f * (f * (f * 6.0 - 15.0) + 10.0)
}
/// 2D gradient noise, unit standard deviation.
pub(crate) fn noise(x: f64, y: f64, salt: u32) -> f64 {
    let (gx, gy) = gradients();
    let (ix, iy) = (floor_i32(x), floor_i32(y));
    let (fx, fy) = (x - x.floor(), y - y.floor());
    let (u, v) = (quintic(fx), quintic(fy));
    let g = |dx: i32, dy: i32| (forest_hash(ix.wrapping_add(dx), iy.wrapping_add(dy), 0, salt) & 15) as usize;
    let mut h = g(0, 0);
    let a = gx[h] * fx + gy[h] * fy;
    h = g(1, 0);
    let b = gx[h] * (fx - 1.0) + gy[h] * fy;
    h = g(0, 1);
    let c = gx[h] * fx + gy[h] * (fy - 1.0);
    h = g(1, 1);
    let d = gx[h] * (fx - 1.0) + gy[h] * (fy - 1.0);
    ((a + (b - a) * u) * (1.0 - v) + (c + (d - c) * u) * v) * 4.639
}
fn fbm(x: f64, y: f64, wavelength: f64, octaves: u32, salt: u32) -> f64 {
    let (mut sum, mut norm, mut a, mut l) = (0.0, 0.0, 1.0, wavelength);
    for i in 0..octaves {
        let fi = i as f64;
        sum += a * noise(x / l + 31.7 * fi, y / l - 17.3 * fi, salt.wrapping_add(i.wrapping_mul(0x9e37)));
        norm += a * a;
        a *= 0.55;
        l *= 0.5;
    }
    sum / f64::sqrt(norm)
}
fn upper_quantile(fraction: f64) -> f64 {
    ((1.0 - fraction) / fraction).ln() / 1.702
}

/// Separable box blur applied twice (triangle kernel), clamped edges.
fn blur(src: &[f32], n: usize, radius: usize) -> Vec<f32> {
    if radius < 1 {
        return src.to_vec();
    }
    let (mut from, mut to) = (src.to_vec(), vec![0f32; n * n]);
    let mut row = vec![0f64; n + 2 * radius + 1];
    let scale = 1.0 / (2 * radius + 1) as f64;
    for _ in 0..4 {
        for line in 0..n {
            let base = line * n;
            for (k, slot) in row.iter_mut().enumerate() {
                let idx = (k as isize - radius as isize).clamp(0, n as isize - 1) as usize;
                *slot = from[base + idx] as f64;
            }
            let mut sum = 0.0;
            for value in &row[..=2 * radius] {
                sum += value;
            }
            for k in 0..n {
                to[k * n + line] = (sum * scale) as f32;
                sum += row[k + 2 * radius + 1] - row[k];
            }
        }
        std::mem::swap(&mut from, &mut to);
    }
    from
}

// Exact port of Neural Earth's surfaceNoise/surfaceFbm/surfaceCover (terrainMaterial.ts).
fn surface_corner(cx: i32, cy: i32, cz: i32, fx: f64, fy: f64, fz: f64, salt: u32) -> f64 {
    let h = forest_hash(cx, cy, cz, salt);
    ((h & 1023) as f64 / 511.5 - 1.0) * fx + (((h >> 10) & 1023) as f64 / 511.5 - 1.0) * fy + (((h >> 20) & 1023) as f64 / 511.5 - 1.0) * fz
}
fn surface_noise(x: f64, y: f64, z: f64, salt: u32) -> f64 {
    let (ix, iy, iz) = (floor_i32(x), floor_i32(y), floor_i32(z));
    let (fx, fy, fz) = (x - x.floor(), y - y.floor(), z - z.floor());
    let (ux, uy, uz) = (quintic(fx), quintic(fy), quintic(fz));
    let (a0, a1) = (surface_corner(ix, iy, iz, fx, fy, fz, salt), surface_corner(ix.wrapping_add(1), iy, iz, fx - 1.0, fy, fz, salt));
    let (a2, a3) = (surface_corner(ix, iy.wrapping_add(1), iz, fx, fy - 1.0, fz, salt), surface_corner(ix.wrapping_add(1), iy.wrapping_add(1), iz, fx - 1.0, fy - 1.0, fz, salt));
    let (x0, x1) = (a0 + (a1 - a0) * ux, a2 + (a3 - a2) * ux);
    let y0 = x0 + (x1 - x0) * uy;
    if uz == 0.0 {
        return y0 * 5.25;
    }
    let iz1 = iz.wrapping_add(1);
    let (a0, a1) = (surface_corner(ix, iy, iz1, fx, fy, fz - 1.0, salt), surface_corner(ix.wrapping_add(1), iy, iz1, fx - 1.0, fy, fz - 1.0, salt));
    let (a2, a3) = (surface_corner(ix, iy.wrapping_add(1), iz1, fx, fy - 1.0, fz - 1.0, salt), surface_corner(ix.wrapping_add(1), iy.wrapping_add(1), iz1, fx - 1.0, fy - 1.0, fz - 1.0, salt));
    let (x0, x1) = (a0 + (a1 - a0) * ux, a2 + (a3 - a2) * ux);
    (y0 + (x0 + (x1 - x0) * uy - y0) * uz) * 5.25
}
/// (unit-variance resolved pattern, retained variance).
fn surface_fbm(x: f64, y: f64, z: f64, scale: f64, octaves: u32, footprint: f64, salt: u32) -> (f64, f64) {
    let (mut value, mut kept, mut total, mut s, mut a) = (0.0, 0.0, 0.0, scale, 1.0);
    for i in 0..octaves {
        total += a * a;
        if footprint < s * 0.25 {
            let fade = 1.0 - sstep(s * 0.125, s * 0.25, footprint);
            value += a * fade * surface_noise(x / s, y / s, z / s, salt.wrapping_add(i.wrapping_mul(0x9e37)));
            kept += a * fade * a * fade;
        }
        a *= 0.5;
        s *= 0.5;
    }
    (if kept > 0.0 { value / f64::sqrt(kept) } else { 0.0 }, kept / total)
}
fn surface_cover(fraction: f64, pattern: f64, retained: f64, sharp: f64) -> f64 {
    let c = clamp(fraction, 0.0, 1.0);
    c + clamp(sharp, 0.0, 1.0) * c * (1.0 - c) * pattern / f64::sqrt(1.0 + pattern * pattern) * f64::sqrt(retained)
}

/// Bilinear height of the source layer at layer-local metres.
pub(crate) struct Heights<'a> {
    pub data: &'a [f32],
    pub n: usize,
    pub source: f64,
}
impl Heights<'_> {
    pub fn at(&self, wx: f64, wy: f64) -> f64 {
        let n = self.n;
        if n < 2 {
            return self.data[0] as f64;
        }
        let top = (n - 1) as f64;
        let gx = clamp(wx / self.source - 0.5, 0.0, top);
        let gy = clamp(wy / self.source - 0.5, 0.0, top);
        let x0 = gx.floor().min((n - 2) as f64) as usize;
        let y0 = gy.floor().min((n - 2) as f64) as usize;
        let (fx, fy) = (gx - x0 as f64, gy - y0 as f64);
        let k = y0 * n + x0;
        let d = |i: usize| self.data[i] as f64;
        (d(k) * (1.0 - fx) + d(k + 1) * fx) * (1.0 - fy) + (d(k + n) * (1.0 - fx) + d(k + n + 1) * fx) * fy
    }
}

struct Lattice {
    step: usize,
    m: usize,
    channels: usize,
    values: Vec<f32>,
}
fn sample_lattice(n: usize, cell: f64, ox: f64, oy: f64, step: usize, channels: usize, fill: impl Fn(f64, f64, &mut [f32]) + Sync + Send) -> Lattice {
    let m = n.div_ceil(step) + 2;
    let mut values = vec![0f32; m * m * channels];
    rows(&mut values, m * channels, |j, row| {
        for i in 0..m {
            fill(ox + ((i * step) as f64 + 0.5) * cell, oy + ((j * step) as f64 + 0.5) * cell, &mut row[i * channels..(i + 1) * channels]);
        }
    });
    Lattice { step, m, channels, values }
}
fn lattice_at(l: &Lattice, i: usize, j: usize) -> [f64; 4] {
    let (gi, gj) = (i as f64 / l.step as f64, j as f64 / l.step as f64);
    let cx = ((l.m - 2) as f64).min(gi.floor()) as usize;
    let cy = ((l.m - 2) as f64).min(gj.floor()) as usize;
    let (fx, fy) = (gi - cx as f64, gj - cy as f64);
    let c = l.channels;
    let c00 = (cy * l.m + cx) * c;
    let (c10, c01) = (c00 + c, c00 + l.m * c);
    let c11 = c01 + c;
    let v = &l.values;
    let mut out = [0.0; 4];
    for k in 0..c {
        out[k] = (v[c00 + k] as f64 * (1.0 - fx) + v[c10 + k] as f64 * fx) * (1.0 - fy) + (v[c01 + k] as f64 * (1.0 - fx) + v[c11 + k] as f64 * fx) * fy;
    }
    out
}

/// Render's tree eligibility E in [0,1] per field texel.
fn render_eligibility(p: &ForestParams, heights: &Heights, nn: usize) -> Vec<f32> {
    let [t, pr] = p.climate;
    let (cell, source, seed) = (p.width / nn as f64, p.width / p.n as f64, p.seed);
    let rock_tan = (40.0 * PI / 180.0).tan();
    let crag_step = 2usize;
    let crag = sample_lattice(nn, cell, p.x, p.y, crag_step, 2, |x, y, out| {
        let f = surface_fbm(x, y, 0.0, 700.0, 4, crag_step as f64 * cell, seed.wrapping_add(4));
        out[0] = f.0 as f32;
        out[1] = f.1 as f32;
    });
    let radius = f64::max(300.0, 2.0 * source);
    let coarse_step = f64::max(1.0, (140.0 / cell).round()) as usize;
    let coarse = sample_lattice(nn, cell, p.x, p.y, coarse_step, 4, |x, y, out| {
        let a = surface_fbm(x, y, 0.0, 4800.0, 4, cell, seed.wrapping_add(3));
        out[0] = (a.0 * f64::sqrt(a.1)) as f32;
        let b = surface_fbm(x, y, 0.0, 64000.0, 4, cell, seed.wrapping_add(1));
        out[1] = (b.0 * f64::sqrt(b.1)) as f32;
        let c = surface_fbm(x + 5101.0, y - 2297.0, 3313.0, 48000.0, 4, cell, seed.wrapping_add(2));
        out[2] = (c.0 * f64::sqrt(c.1)) as f32;
        let (lx, ly) = (x - p.x, y - p.y);
        out[3] = ((heights.at(lx + radius, ly) + heights.at(lx - radius, ly) + heights.at(lx, ly + radius) + heights.at(lx, ly - radius)) * 0.25) as f32;
    });
    let boost = 0.5 * f64::max(0.0, 10.0 - t);
    let mut eligible = vec![0f32; nn * nn];
    rows(&mut eligible, nn, |j, row| {
        for (i, out) in row.iter_mut().enumerate() {
            let (wx, wy) = ((i as f64 + 0.5) * cell, (j as f64 + 0.5) * cell);
            let z = heights.at(wx, wy);
            let h = f64::max(z, 0.0);
            if z <= 0.0 {
                continue;
            }
            let gx = (heights.at(wx + source, wy) - heights.at(wx - source, wy)) / (2.0 * source);
            let gy = (heights.at(wx, wy + source) - heights.at(wx, wy - source)) / (2.0 * source);
            let lerp = lattice_at(&coarse, i, j);
            let (grove, m1, m2) = (lerp[0], lerp[1], lerp[2]);
            let tpi = (z - lerp[3]) / (6.0 * radius);
            let grade = f64::sqrt(gx * gx + gy * gy);
            let cl = lattice_at(&crag, i, j);
            let (crag_value, crag_kept) = (cl[0], cl[1]);
            let ts = clamp(t + 6.0 - 0.0065 * h, -45.0, 45.0);
            let tw = clamp(t - 6.0 - 0.0065 * h, -45.0, 45.0);
            let t_hot = f64::max(ts, tw) + 0.8 * m2 * (0.25 + 0.75 * sstep(0.015, 0.12, tpi.abs()));
            let wet_shift = (0.1 * m1).exp();
            let valley = sstep(0.0, -0.12, tpi);
            let ridge = sstep(0.0, 0.12, tpi);
            let mut humid = pr / f64::max(20.0 * (ts + tw) * 0.5 + 280.0, 120.0) * wet_shift;
            humid *= 1.0 + 0.7 * valley * (1.0 - sstep(1.5, 3.0, humid)) - 0.18 * ridge;
            let rock_tan_eff = rock_tan * (0.55 + 0.45 * sstep(0.3, 1.3, humid));
            let alpine = 1.0 - sstep(2.0, 9.0, t_hot);
            let exposure = sstep(rock_tan_eff * 0.5, rock_tan_eff * 1.3, grade) + 0.45 * alpine * sstep(rock_tan_eff * 0.15, rock_tan_eff * 0.7, grade)
                + 0.35 * ridge * sstep(0.35, 0.9, grade / rock_tan)
                - 0.3 * valley;
            let outcrop = surface_cover(exposure, 0.75 * crag_value + 0.25 * grove, crag_kept, 0.35);
            let supply = sstep(60.0, 400.0, pr * wet_shift * (1.0 + 0.5 * valley - 0.25 * ridge));
            let perennial = sstep(2.5, -2.5, f64::max(ts, tw) + 0.35 * m1) * supply;
            let rock = sstep(0.3, 0.85, 1.0 - outcrop) * (1.0 - sstep(rock_tan * 0.9, rock_tan * 1.6, grade));
            *out = (rock * (1.0 - perennial) * sstep(5.5, 13.5, t_hot + boost + 0.8 * valley)) as f32;
        }
    });
    eligible
}

/// CPU counterpart of canonical v2StandCoverage; optical gap law, not measured LAI.
fn v2_stand_coverage(cover: f64, stand: f64, disturbed: f64, trop: f64) -> f64 {
    let mosaic = 0.22 * (1.0 - 0.75 * trop);
    let density = (mosaic * stand + 0.05 * stand * (1.0 - cover)).exp() * (1.0 - 0.3 * disturbed * (1.0 - 0.7 * trop));
    1.0 - f64::powf(f64::max(1.0 - cover, 0.001), density)
}

/// Field texels of about 16 m, capped at 1024² (39 m over 40 km).
pub fn forest_field_resolution(width: f64) -> usize {
    (width / 16.0).ceil().clamp(32.0, 1024.0) as usize
}

pub struct ForestParams<'a> {
    pub seed: u32,
    /// Sea-level annual mean Celsius, annual precipitation mm.
    pub climate: [f64; 2],
    pub x: f64,
    pub y: f64,
    pub width: f64,
    pub n: usize,
    pub height: &'a [f32],
    /// Routing-grid codes (0 land, 1 sea, 2 lake, 3 river), `n`² cells.
    pub water: Option<&'a [u8]>,
    /// Nine floats per displayed river segment.
    pub river_segments: Option<&'a [f32]>,
    pub enabled: bool,
    pub density: f64,
    pub clearings: f64,
    /// V2 appearance profile (`clearingProfile === 'progressive'`).
    pub progressive: bool,
}
pub struct ForestPlanes {
    pub n: usize,
    pub rgba: Vec<u8>,
    pub bank: Option<Vec<u8>>,
    pub beach_n: usize,
    /// Empty unless `progressive`.
    pub beach: Vec<u8>,
}

#[derive(Clone, Copy, Default)]
struct BaseCell {
    cover: f32,
    bias: f32,
    height: f32,
    needle: f32,
    tone: f32,
    optical: f32,
}

pub fn build_forest_field(p: &ForestParams) -> Result<ForestPlanes, String> {
    let nsrc = p.n;
    if nsrc < 1 || p.height.len() != nsrc * nsrc || !(p.width > 0.0) {
        return Err("Invalid forest height grid.".into());
    }
    if p.water.is_some_and(|w| w.len() != nsrc * nsrc) {
        return Err("Invalid forest water grid.".into());
    }
    let (t, pr) = (p.climate[0], p.climate[1]);
    let seed = p.seed;
    let nn = forest_field_resolution(p.width);
    let cell = p.width / nn as f64;
    let source = p.width / nsrc as f64;
    let density = clamp(p.density, 0.0, 2.0);
    let clearings = clamp(p.clearings, 0.0, 1.0);
    let heights = Heights { data: p.height, n: nsrc, source };
    let eligible = render_eligibility(p, &heights, nn);

    // Narrow gallery envelope from the displayed river banks; routing river
    // cells give a slightly wider fallback.
    let fallback;
    let segments: Option<&[f32]> = match (p.river_segments, p.water) {
        (Some(s), _) => Some(s),
        (None, Some(w)) => {
            fallback = routing_river_segments(w, p.x, p.y, p.width, nsrc);
            Some(&fallback[..])
        }
        _ => None,
    };
    let lake = lake_interior(p.water, nsrc, p.width);
    let ctx = BankContext { seed, climate: p.climate, heights: &heights, layer_x: p.x, layer_y: p.y, lake };
    let mut bank: Option<Bank> = segments.and_then(|s| bank_field(s, p.x, p.y, p.width, nn, &ctx));
    if let Some(bank) = bank.as_mut() {
        for o in 0..nn * nn {
            let gate = sstep(0.0, 0.4, eligible[o] as f64);
            bank.rgba[o * 4 + 2] = js_round(bank.rgba[o * 4 + 2] as f64 * gate) as u8;
            bank.rgba[o * 4 + 3] = js_round(bank.rgba[o * 4 + 3] as f64 * eligible[o] as f64) as u8;
        }
    }

    // Base grid, half the field resolution.
    let b = usize::max(16, nn.div_ceil(2));
    let bcell = p.width / b as f64;
    let mut h = vec![0f32; b * b];
    rows(&mut h, b, |j, row| {
        for (i, out) in row.iter_mut().enumerate() {
            *out = heights.at((i as f64 + 0.5) * bcell, (j as f64 + 0.5) * bcell) as f32;
        }
    });
    let near = blur(&h, b, (150.0 / bcell).round() as usize);
    let far = blur(&h, b, (600.0 / bcell).round() as usize);
    // Landscape-scale noises (>= 520 m) on a ~140 m lattice, bilinear upsampled.
    let step = f64::max(1.0, (140.0 / bcell).round()) as usize;
    let m = b.div_ceil(step) + 2;
    let mut coarse = vec![[0f32; 6]; m * m];
    rows(&mut coarse, m, |j, row| {
        for (i, out) in row.iter_mut().enumerate() {
            let x = p.x + ((i * step) as f64 + 0.5) * bcell;
            let y = p.y + ((j * step) as f64 + 0.5) * bcell;
            let wx = 900.0 * fbm(x, y, 5200.0, 2, seed.wrapping_add(11));
            let wy = 900.0 * fbm(x + 7310.0, y - 2210.0, 5200.0, 2, seed.wrapping_add(13));
            out[0] = fbm(x + wx, y + wy, 2400.0, 3, seed.wrapping_add(17)) as f32;
            out[1] = fbm(x - wy, y + wx, 1100.0, 2, seed.wrapping_add(19)) as f32;
            out[2] = fbm(x, y, 1800.0, 2, seed.wrapping_add(23)) as f32;
            out[3] = fbm(x + wy, y - wx, 1300.0, 2, seed.wrapping_add(29)) as f32;
            out[4] = fbm(x, y, 9000.0, 2, seed.wrapping_add(31)) as f32;
            out[5] = fbm(x, y, 520.0, 2, seed.wrapping_add(37)) as f32;
        }
    });
    let w_trop_region = sstep(13.0, 19.0, t - 6.0);
    let grow_boost = 0.5 * f64::max(0.0, 10.0 - t);
    let mut base = vec![BaseCell::default(); b * b];
    rows(&mut base, b, |j, row| {
        for (i, cellout) in row.iter_mut().enumerate() {
            let o = j * b + i;
            let z = h[o] as f64;
            let left = h[j * b + i.saturating_sub(1)] as f64;
            let right = h[j * b + usize::min(b - 1, i + 1)] as f64;
            let up = h[j.saturating_sub(1) * b + i] as f64;
            let down = h[usize::min(b - 1, j + 1) * b + i] as f64;
            let slope = f64::sqrt((right - left).powi(2) + (down - up).powi(2)) / (2.0 * bcell);
            let tpi_near = (z - near[o] as f64) / 150.0;
            let tpi_far = (z - far[o] as f64) / 600.0;
            let valley = f64::max(sstep(0.0, -0.06, tpi_far), 0.7 * sstep(0.0, -0.05, tpi_near));
            let ridge = f64::max(sstep(0.0, 0.06, tpi_far), 0.6 * sstep(0.0, 0.05, tpi_near));
            let local = t - 0.0065 * f64::max(z, 0.0);
            let grow = local + 6.0 + grow_boost;
            let humid0 = pr / f64::max(20.0 * local + 280.0, 120.0);
            let (gx, gy) = (i as f64 / step as f64, j as f64 / step as f64);
            let cx = ((m - 2) as f64).min(gx.floor()) as usize;
            let cy = ((m - 2) as f64).min(gy.floor()) as usize;
            let (fx, fy) = (gx - cx as f64, gy - cy as f64);
            let (c00, c10, c01, c11) = (cy * m + cx, cy * m + cx + 1, (cy + 1) * m + cx, (cy + 1) * m + cx + 1);
            let (w00, w10, w01, w11) = ((1.0 - fx) * (1.0 - fy), fx * (1.0 - fy), (1.0 - fx) * fy, fx * fy);
            let mut noise6 = [0f64; 6];
            for c in 0..6 {
                noise6[c] = coarse[c00][c] as f64 * w00 + coarse[c10][c] as f64 * w10 + coarse[c01][c] as f64 * w01 + coarse[c11][c] as f64 * w11;
            }
            let (stand, disturbed, conifer, tone_noise) = (noise6[0], sstep(1.05, 1.5, noise6[1]), noise6[2], noise6[3]);
            let humid = humid0 * (1.0 + 0.7 * valley * (1.0 - sstep(1.5, 3.0, humid0)) - 0.18 * ridge) * (0.12 * noise6[4]).exp();
            let treeline = grow + 0.9 * noise6[5] + 0.7 * valley - 0.5 * ridge;
            let thermal = sstep(5.0, 8.5, treeline);
            let moisture = sstep(0.38, 1.25, humid);
            let cover_max = 0.6 + 0.38 * sstep(0.8, 2.2, humid);
            let bog = valley * (1.0 - sstep(0.02, 0.08, slope)) * sstep(1.6, 3.0, humid) * (1.0 - sstep(11.0, 17.0, grow)) * (1.0 - w_trop_region);
            let mut cover = thermal * moisture * cover_max * (1.0 - 0.6 * bog) * (1.0 - 0.2 * ridge * (1.0 - moisture));
            let optical = v2_stand_coverage(cover, stand, disturbed, w_trop_region);
            let mosaic = 0.22 * (1.0 - 0.75 * w_trop_region);
            cover = clamp(cover * (1.0 + mosaic * stand) + 0.05 * stand * cover * (1.0 - cover), 0.0, 1.0) * (1.0 - 0.3 * disturbed * (1.0 - 0.7 * w_trop_region));
            let gentle = 1.0 - sstep(0.05, 0.25, slope);
            let rugged = sstep(0.35, 0.8, slope);
            let bias = 0.45 * (ridge - valley) + 0.3 * (gentle - 0.5) - 0.6 * rugged + 0.35 * stand + 0.45 * noise6[4]
                + noise(p.x / 400.0 + (i as f64 + 0.5) * bcell / 400.0, p.y / 400.0 + (j as f64 + 0.5) * bcell / 400.0, seed.wrapping_add(41)) / 1.077;
            let thermal_height = 0.5 * sstep(5.5, 9.5, grow) + 0.5 * sstep(9.0, 22.0, grow);
            let mut height = 3.0 + 31.0 * f64::powf(sstep(0.4, 2.8, humid), 0.8) * thermal_height;
            height *= (1.0 + (0.16 + 0.08 * w_trop_region) * stand) * (1.0 - 0.55 * disturbed) * (1.0 + 0.15 * valley - 0.12 * ridge) * (0.35 + 0.65 * sstep(5.0, 9.0, treeline));
            let needle = clamp(
                1.0 - sstep(10.0, 19.0, grow) + 0.3 * conifer + 0.35 * (1.0 - sstep(0.7, 1.4, humid)) * (1.0 - w_trop_region) - w_trop_region,
                0.0,
                1.0,
            );
            let tone = clamp(0.5 + (0.16 + 0.1 * w_trop_region) * tone_noise + 0.22 * disturbed - 0.05 * valley, 0.0, 1.0);
            *cellout = BaseCell { cover: cover as f32, bias: bias as f32, height: height as f32, needle: needle as f32, tone: tone as f32, optical: optical as f32 };
        }
    });

    // Full resolution: clearings or bounded V2 thinning, eligibility, sea exclusion.
    let humid_annual = pr / f64::max(20.0 * t + 280.0, 120.0);
    let clearing_rate = if p.progressive { 0.4 + (0.08 - 0.4) * sstep(0.8, 1.8, humid_annual) } else { 0.4 };
    let cleared_fraction = clearing_rate * clearings * (1.0 - 0.85 * sstep(13.0, 19.0, t - 6.0));
    let threshold = 1.15 * upper_quantile(f64::max(cleared_fraction, 1e-4));
    let mut rgba = vec![0u8; nn * nn * 4];
    rows(&mut rgba, nn * 4, |j, row| {
        let wy = (j as f64 + 0.5) * cell;
        let gy = clamp(wy / bcell - 0.5, 0.0, (b - 1) as f64);
        let y0 = gy.floor().min((b - 2) as f64) as usize;
        let fy = gy - y0 as f64;
        for i in 0..nn {
            let wx = (i as f64 + 0.5) * cell;
            let o = j * nn + i;
            let gx = clamp(wx / bcell - 0.5, 0.0, (b - 1) as f64);
            let x0 = gx.floor().min((b - 2) as f64) as usize;
            let fx = gx - x0 as f64;
            let (b00, b10, b01, b11) = (&base[y0 * b + x0], &base[y0 * b + x0 + 1], &base[(y0 + 1) * b + x0], &base[(y0 + 1) * b + x0 + 1]);
            let (w00, w10, w01, w11) = ((1.0 - fx) * (1.0 - fy), fx * (1.0 - fy), (1.0 - fx) * fy, fx * fy);
            let at = |f: fn(&BaseCell) -> f32| f(b00) as f64 * w00 + f(b10) as f64 * w10 + f(b01) as f64 * w01 + f(b11) as f64 * w11;
            let score = 0.4 * noise((p.x + wx) / 200.0 + 31.7, (p.y + wy) / 200.0 - 17.3, seed.wrapping_add(41).wrapping_add(0x9e37)) / 1.077 + at(|c| c.bias);
            let opened = if cleared_fraction <= 0.0 {
                0.0
            } else if p.progressive {
                f64::min(0.55, 2.0 * cleared_fraction / (1.0 + (clamp(-score / 1.15, -20.0, 20.0)).exp()))
            } else {
                sstep(threshold - 0.25, threshold + 0.25, score)
            };
            let potential = if p.progressive { at(|c| c.optical) } else { at(|c| c.cover) };
            let mut cover = potential * (1.0 - opened);
            if density != 1.0 {
                cover = 1.0 - f64::powf(1.0 - f64::min(cover, 0.999), density);
            }
            let e = eligible[o] as f64;
            cover *= e;
            if !p.enabled || heights.at(wx, wy) <= 0.0 {
                cover = 0.0;
            }
            let g = bank.as_ref().map_or(0.0, |bk| bk.weight[o] as f64 * (1.0 - sstep(0.2, 0.6, cover)));
            let hgt = at(|c| c.height);
            let height = if g > 0.0 { hgt + (bank.as_ref().unwrap().stature[o] as f64 - hgt) * g } else { hgt };
            row[i * 4] = byte(cover);
            row[i * 4 + 1] = byte(height * sstep(0.0, 0.4, e) / 50.0);
            row[i * 4 + 2] = byte(at(|c| c.needle) * (1.0 - 0.7 * g));
            row[i * 4 + 3] = byte(at(|c| c.tone));
        }
    });

    // Density changes canopy occupancy, never the physical bank width.
    let mut bank_rgba = if p.enabled && density > 0.0 { bank.map(|bk| bk.rgba) } else { None };
    if let (Some(bank_rgba), true) = (bank_rgba.as_mut(), density != 1.0) {
        for o in 0..nn * nn {
            let k = o * 4;
            let base_density = forest_bank_density(bank_rgba[k + 2] as f64 * 0.5);
            bank_rgba[k + 3] = f64::min(255.0, js_round(bank_rgba[k + 3] as f64 * (1.0 - f64::powf(1.0 - base_density, density)) / base_density)) as u8;
        }
    }

    // Only V2 crowns avoid beaches; about 8 m texels.
    let (beach_n, beach) = if p.progressive {
        let res = f64::min(2048.0, f64::max(256.0, 2f64.powi((p.width / 8.0).log2().ceil() as i32))) as usize;
        (res, beach_grid(&heights, p.x, p.y, p.width, nsrc, seed, res))
    } else {
        (0, Vec::new())
    };
    Ok(ForestPlanes { n: nn, rgba, bank: bank_rgba, beach_n, beach })
}

// ---------------------------------------------------------------------------
// Request framing shared by the native `/terrain/forest` endpoint and the WASM
// export: u32 LE header length, JSON header padded with spaces to a multiple
// of 4, then little-endian planes. Reply: the same framing.

#[derive(Deserialize)]
#[serde(rename_all = "camelCase")]
struct RequestHeader {
    seed: u32,
    climate: [f64; 2],
    x: f64,
    y: f64,
    width: f64,
    n: usize,
    water: bool,
    /// Number of nine-float river segments (0: none, fall back to routing cells).
    segments: usize,
    enabled: bool,
    density: f64,
    clearings: f64,
    progressive: bool,
}

fn take_bytes<'a>(body: &'a [u8], at: &mut usize, len: usize) -> Result<&'a [u8], String> {
    let end = at.checked_add(len).ok_or("Forest request incomplete.")?;
    let bytes = body.get(*at..end).ok_or("Forest request incomplete.")?;
    *at = end;
    Ok(bytes)
}

/// Request: header, f32 heights (`n`²), optional u8 water (`n`², padded to 4), f32 segments.
/// Reply: header `{n, bank, beachN}`, RGBA8 field, optional RGBA8 bank, optional R8 beach.
pub fn forest_request(body: &[u8]) -> Result<Vec<u8>, String> {
    let incomplete = || "Forest request incomplete.".to_string();
    let header_len = u32::from_le_bytes(body.get(..4).ok_or_else(incomplete)?.try_into().map_err(|_| incomplete())?) as usize;
    let end = 4usize.checked_add(header_len).ok_or_else(incomplete)?;
    let header: RequestHeader = serde_json::from_slice(body.get(4..end).ok_or_else(incomplete)?).map_err(|e| e.to_string())?;
    let cells = header.n.checked_mul(header.n).filter(|&c| c > 0 && c <= 1 << 26).ok_or("Invalid forest grid.")?;
    let mut at = end;
    let height: Vec<f32> = take_bytes(body, &mut at, cells * 4)?.chunks_exact(4).map(|b| f32::from_le_bytes([b[0], b[1], b[2], b[3]])).collect();
    let water_padded = cells.div_ceil(4) * 4;
    let water = if header.water { Some(take_bytes(body, &mut at, water_padded)?[..cells].to_vec()) } else { None };
    let segments: Vec<f32> = take_bytes(body, &mut at, header.segments.checked_mul(36).ok_or_else(incomplete)?)?.chunks_exact(4).map(|b| f32::from_le_bytes([b[0], b[1], b[2], b[3]])).collect();
    let planes = build_forest_field(&ForestParams {
        seed: header.seed,
        climate: header.climate,
        x: header.x,
        y: header.y,
        width: header.width,
        n: header.n,
        height: &height,
        water: water.as_deref(),
        river_segments: (!segments.is_empty()).then_some(&segments[..]),
        enabled: header.enabled,
        density: header.density,
        clearings: header.clearings,
        progressive: header.progressive,
    })?;
    let mut head = format!("{{\"n\":{},\"bank\":{},\"beachN\":{}}}", planes.n, planes.bank.is_some(), planes.beach_n).into_bytes();
    while head.len() % 4 != 0 {
        head.push(b' ');
    }
    let mut out = Vec::with_capacity(4 + head.len() + planes.rgba.len() * 2 + planes.beach.len());
    out.extend_from_slice(&(head.len() as u32).to_le_bytes());
    out.extend_from_slice(&head);
    out.extend_from_slice(&planes.rgba);
    if let Some(bank) = &planes.bank {
        out.extend_from_slice(bank);
    }
    out.extend_from_slice(&planes.beach);
    Ok(out)
}
