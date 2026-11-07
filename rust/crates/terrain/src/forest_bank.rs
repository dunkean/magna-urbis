//! Riparian gallery envelope of the forest field (port of
//! `rust/bridge/terrainForestRiparian.ts`): a narrow bank-following band
//! measured from the displayed river geometry on the forest grid. Bounded
//! closest-bank transform: each segment piece only visits the texels inside
//! its own extent plus the envelope reach. Display only.

use crate::forest::{clamp, js_round, sstep, Heights};
use crate::terrain_par::rows;

/// Widest envelope, beyond the bank, in metres.
const FOREST_BANK_MAX_WIDTH: f64 = 48.0;
const EDGE_TAPER: f64 = 0.6;
const EDGE_MEAN: f64 = 1.0 - EDGE_TAPER * 0.325;

/// Gallery crown cover target, denser along wider reaches.
pub(crate) fn forest_bank_density(width: f64) -> f64 {
    0.55 + 0.35 * sstep(8.0, 36.0, width)
}

fn hash(x: i32, y: i32, seed: u32) -> u32 {
    let mut h = (x as u32).wrapping_mul(0x9e37_79b9) ^ (y as u32).wrapping_mul(0x85eb_ca6b) ^ seed;
    h = (h ^ (h >> 16)).wrapping_mul(0x7feb_352d);
    h = (h ^ (h >> 15)).wrapping_mul(0x846c_a68b);
    h ^ (h >> 16)
}
/// Value noise with quintic interpolation, roughly unit standard deviation.
fn noise(x: f64, y: f64, seed: u32) -> f64 {
    let (ix, iy) = (x.floor() as i64 as i32, y.floor() as i64 as i32);
    let (fx, fy) = (x - x.floor(), y - y.floor());
    let q = |f: f64| f * f * f * (f * (f * 6.0 - 15.0) + 10.0);
    let (u, v) = (q(fx), q(fy));
    let h = |dx: i32, dy: i32| hash(ix.wrapping_add(dx), iy.wrapping_add(dy), seed) as f64;
    let (a, b, c, d) = (h(0, 0), h(1, 0), h(0, 1), h(1, 1));
    ((a + (b - a) * u) * (1.0 - v) + (c + (d - c) * u) * v) * (2.6 / 2147483648.0) - 2.6
}
fn fbm(x: f64, y: f64, wavelength: f64, seed: u32) -> f64 {
    (noise(x / wavelength, y / wavelength, seed) + 0.5 * noise(x / wavelength * 2.03 + 17.1, y / wavelength * 2.03 - 9.4, seed.wrapping_add(1))) / 1.118
}
/// Length of [a0, a1] ∩ [b0, b1].
fn overlap(a0: f64, a1: f64, b0: f64, b1: f64) -> f64 {
    f64::max(0.0, f64::min(a1, b1) - f64::max(a0, b0))
}
fn byte(v: f64) -> u8 {
    if v <= 0.0 { 0 } else if v >= 1.0 { 255 } else { (v * 255.0 + 0.5) as u8 }
}

pub(crate) struct Bank {
    pub rgba: Vec<u8>,
    pub stature: Vec<f32>,
    pub weight: Vec<f32>,
}

/// Lake interiors on the routing grid: the cell and its 8 neighbours are lake.
pub(crate) struct LakeInterior<'a> {
    water: &'a [u8],
    n: usize,
    cell: f64,
}
impl LakeInterior<'_> {
    fn at(&self, wx: f64, wy: f64) -> bool {
        let (x, y) = ((wx / self.cell).floor() as i64, (wy / self.cell).floor() as i64);
        let top = self.n as i64 - 1;
        for j in -1..=1 {
            for i in -1..=1 {
                let (xx, yy) = ((x + i).clamp(0, top) as usize, (y + j).clamp(0, top) as usize);
                if self.water[yy * self.n + xx] != 2 {
                    return false;
                }
            }
        }
        true
    }
}
pub(crate) fn lake_interior(water: Option<&[u8]>, n: usize, width: f64) -> Option<LakeInterior<'_>> {
    let water = water?;
    water.contains(&2).then(|| LakeInterior { water, n, cell: width / n as f64 })
}

/// Fallback without displayed geometry: centres of routing river cells, zero width (f32, as a Float32Array).
pub(crate) fn routing_river_segments(water: &[u8], gx: f64, gy: f64, width: f64, n: usize) -> Vec<f32> {
    let cell = width / n as f64;
    let mut out = Vec::new();
    for (c, &code) in water.iter().enumerate() {
        if code != 3 {
            continue;
        }
        let x = (gx + ((c % n) as f64 + 0.5) * cell) as f32;
        let y = (gy + ((c / n) as f64 + 0.5) * cell) as f32;
        out.extend_from_slice(&[x, y, x, y, 0.0, 0.0, 0.0, 0.0, 0.0]);
    }
    out
}

pub(crate) struct BankContext<'a> {
    pub seed: u32,
    pub climate: [f64; 2],
    pub heights: &'a Heights<'a>,
    /// Layer origin: the height sampler takes layer-local metres.
    pub layer_x: f64,
    pub layer_y: f64,
    pub lake: Option<LakeInterior<'a>>,
}

#[derive(Clone, Copy)]
struct Tex {
    bank: f32,
    half: f32,
    point: [f32; 4],
}
struct Piece {
    ax: f64,
    ay: f64,
    dx: f64,
    dy: f64,
    length2: f64,
    ra: f64,
    rb: f64,
    t0: f64,
    t1: f64,
    left: usize,
    right: usize,
}
#[derive(Clone, Copy)]
struct Out {
    rgba: [u8; 4],
    stature: f32,
    weight: f32,
}

/// Bank raster on an `n`² grid at (`gx`, `gy`, `width`); `None` without segments.
pub(crate) fn bank_field(segments: &[f32], gx: f64, gy: f64, width: f64, n: usize, ctx: &BankContext) -> Option<Bank> {
    if segments.is_empty() {
        return None;
    }
    let cell = width / n as f64;
    let [temp, precip] = ctx.climate;
    let seed = ctx.seed;
    let reach = FOREST_BANK_MAX_WIDTH + 3.0 * cell;
    let mut pieces: Vec<Piece> = Vec::new();
    let mut by_row: Vec<Vec<u32>> = vec![Vec::new(); n];
    let mut k = 0;
    while k + 8 < segments.len() {
        let s = |o: usize| segments[k + o] as f64;
        let (ax, ay, bx, by) = (s(0), s(1), s(2), s(3));
        let (ra, rb) = (f64::max(0.0, s(4) * 0.5), f64::max(0.0, s(5) * 0.5));
        k += 9;
        if ![ax, ay, bx, by, ra, rb].iter().all(|v| v.is_finite()) {
            continue;
        }
        let (dx, dy) = (bx - ax, by - ay);
        let length2 = dx * dx + dy * dy;
        // Long segments are split so each box stays a thin band around its piece.
        let count = f64::max(1.0, (f64::sqrt(length2) / (8.0 * cell)).ceil()) as usize;
        for p in 0..count {
            let (t0, t1) = (p as f64 / count as f64, (p + 1) as f64 / count as f64);
            let pad = f64::max(ra, rb) + reach;
            let (x0, x1, y0, y1) = (ax + dx * t0, ax + dx * t1, ay + dy * t0, ay + dy * t1);
            let left = f64::max(0.0, ((f64::min(x0, x1) - pad - gx) / cell - 0.5).floor());
            let right = f64::min((n - 1) as f64, ((f64::max(x0, x1) + pad - gx) / cell - 0.5).ceil());
            let top = f64::max(0.0, ((f64::min(y0, y1) - pad - gy) / cell - 0.5).floor());
            let bottom = f64::min((n - 1) as f64, ((f64::max(y0, y1) + pad - gy) / cell - 0.5).ceil());
            if left > right || top > bottom {
                continue;
            }
            let id = pieces.len() as u32;
            pieces.push(Piece { ax, ay, dx, dy, length2, ra, rb, t0, t1, left: left as usize, right: right as usize });
            for row in &mut by_row[top as usize..=bottom as usize] {
                row.push(id);
            }
        }
    }
    // Signed bank distance (negative in the channel), half width, centreline and bank points.
    let mut tex = vec![Tex { bank: f32::INFINITY, half: 0.0, point: [0.0; 4] }; n * n];
    rows(&mut tex, n, |j, row| {
        let wy = gy + (j as f64 + 0.5) * cell;
        for &id in &by_row[j] {
            let pc = &pieces[id as usize];
            for i in pc.left..=pc.right {
                let wx = gx + (i as f64 + 0.5) * cell;
                let t = if pc.length2 != 0.0 { clamp(((wx - pc.ax) * pc.dx + (wy - pc.ay) * pc.dy) / pc.length2, pc.t0, pc.t1) } else { 0.0 };
                let r = pc.ra + (pc.rb - pc.ra) * t;
                let (cx, cy) = (pc.ax + t * pc.dx, pc.ay + t * pc.dy);
                let dc = f64::sqrt((wx - cx) * (wx - cx) + (wy - cy) * (wy - cy));
                let s = dc - r;
                let tx = &mut row[i];
                // Land texels keep their nearest bank; channel texels the bank of
                // their deepest capsule, so polyline joints stay in the water.
                if s < tx.bank as f64 {
                    tx.bank = s as f32;
                    tx.half = r as f32;
                    let (ux, uy) = if dc > 1e-6 {
                        ((wx - cx) / dc, (wy - cy) / dc)
                    } else if pc.length2 != 0.0 {
                        (-pc.dy / f64::sqrt(pc.length2), pc.dx / f64::sqrt(pc.length2))
                    } else {
                        (1.0, 0.0)
                    };
                    // JS: `dc > 1e-6 ? .. : length2 ? -dy/sqrt : 1` for ux, and `.. : length2 ? dx/sqrt : 0` for uy.
                    tx.point = [(cx - wx) as f32, (cy - wy) as f32, (cx + ux * r - wx) as f32, (cy + uy * r - wy) as f32];
                }
            }
        }
    });

    let humid = precip / f64::max(20.0 * temp + 280.0, 120.0);
    let wet = sstep(0.45, 1.6, humid);
    // Box footprint projected on the bank normal, averaged over directions (4/π).
    let e = 0.5 * cell * 1.273;
    let offset = |v: f64| js_round(128.0 + 127.0 * v / reach).clamp(1.0, 255.0) as u8;
    let mut out = vec![Out { rgba: [255, 255, 0, 0], stature: 0.0, weight: 0.0 }; n * n];
    rows(&mut out, n, |j, row| {
        for (i, o) in row.iter_mut().enumerate() {
            let t = &tex[j * n + i];
            let s = t.bank as f64;
            if !(s < reach) {
                continue;
            }
            let (wx, wy) = (gx + (i as f64 + 0.5) * cell, gy + (j as f64 + 0.5) * cell);
            let r = t.half as f64;
            // Offsets stay valid over sea and lake interiors, so the bilinear
            // reference stays exact at a coast; only their envelope width is zero.
            let narrow = 2.0 * r < 1.5 * cell;
            let reference = if narrow { 0 } else { 2 };
            o.rgba[0] = offset(t.point[reference] as f64);
            o.rgba[1] = offset(t.point[reference + 1] as f64);
            if ctx.heights.at(wx - ctx.layer_x, wy - ctx.layer_y) <= 0.0 || ctx.lake.as_ref().is_some_and(|l| l.at(wx - ctx.layer_x, wy - ctx.layer_y)) {
                continue;
            }
            // Along-bank variation: ~400 m reaches, finely modulated at ~90 m.
            let reach_noise = fbm(wx, wy, 400.0, seed.wrapping_add(101));
            let fine = noise(wx / 90.0 + 3.1, wy / 90.0 - 7.7, seed.wrapping_add(103));
            let shelter = sstep(0.15, 1.25, fbm(wx + 5310.0, wy - 2270.0, 1100.0, seed.wrapping_add(107)) + 0.35 * sstep(4.0, 40.0, r));
            let mut w = 7.0 + 19.0 * sstep(-1.5, 1.5, 0.8 * reach_noise + 0.35 * fine);
            w = f64::min(FOREST_BANK_MAX_WIDTH, (w + f64::min(10.0, 0.2 * r)) * (1.0 + 0.5 * wet) * (1.0 + 0.18 * shelter));
            let d = f64::max(0.0, s);
            // Low shrubs on ordinary desert banks; taller gallery trees in sheltered
            // or wetter reaches and along larger rivers, lower towards the outer edge.
            let shrub = 1.3 + 1.5 * sstep(-1.0, 1.0, noise(wx / 60.0 - 11.3, wy / 60.0 + 5.9, seed.wrapping_add(109)));
            let tree = 7.0 + 9.0 * wet + f64::min(6.0, 0.12 * r);
            o.stature = ((shrub + (tree - shrub) * clamp(shelter * (0.6 + 0.4 * wet), 0.0, 1.0)) * (1.0 - 0.4 * clamp(d / w, 0.0, 1.0))) as f32;
            o.weight = (1.0 - sstep(w, w + cell, d)) as f32;
            // Land band [r, r+w] on each side of the centreline, area-weighted per texel.
            let centre = s + r;
            let area = (overlap(centre - e, centre + e, r, r + w) + overlap(centre - e, centre + e, -r - w, -r)) / (2.0 * e);
            let reach_w = if narrow { w + r } else { w };
            o.rgba[2] = f64::min(255.0, js_round(2.0 * reach_w)) as u8;
            o.rgba[3] = byte(area * forest_bank_density(reach_w) * EDGE_MEAN);
        }
    });
    let mut bank = Bank { rgba: Vec::with_capacity(n * n * 4), stature: Vec::with_capacity(n * n), weight: Vec::with_capacity(n * n) };
    for o in &out {
        bank.rgba.extend_from_slice(&o.rgba);
        bank.stature.push(o.stature);
        bank.weight.push(o.weight);
    }
    Some(bank)
}
