//! Painted operation masks, never elevations. Channels: sea, plain, hills,
//! mountains, high mountains; the remaining weight keeps the selected generator.
use serde::{Deserialize, Serialize};

pub const ZONE_CHANNELS: usize = 5;

#[derive(Clone, Debug, Deserialize, Serialize)]
pub struct TerrainZones {
    pub version: u8,
    pub resolution: usize,
    pub weights: Vec<u8>,
}

impl TerrainZones {
    pub fn validate(&self) -> Result<(), String> {
        if self.version != 1
            || !(8..=128).contains(&self.resolution)
            || self.weights.len() != self.resolution * self.resolution * ZONE_CHANNELS
            || self
                .weights
                .as_chunks::<ZONE_CHANNELS>()
                .0
                .iter()
                .any(|w| w.iter().map(|&v| v as u32).sum::<u32>() > 255)
        {
            return Err("Zones invalides : cinq masques 8–128², poids cumulés ≤ 255.".into());
        }
        Ok(())
    }

    /// Normalized partition, including the untouched generator at index zero.
    pub fn sample(&self, u: f64, v: f64) -> [f64; 6] {
        let n = self.resolution;
        let x = (u * n as f64 - 0.5).clamp(0.0, (n - 1) as f64);
        let y = (v * n as f64 - 0.5).clamp(0.0, (n - 1) as f64);
        let (x0, y0) = (x.floor() as usize, y.floor() as usize);
        let (tx, ty) = (x - x0 as f64, y - y0 as f64);
        let mut out = [0.0; 6];
        for (xx, wx) in [(x0, 1.0 - tx), ((x0 + 1).min(n - 1), tx)] {
            for (yy, wy) in [(y0, 1.0 - ty), ((y0 + 1).min(n - 1), ty)] {
                let start = (yy * n + xx) * ZONE_CHANNELS;
                for k in 0..ZONE_CHANNELS {
                    out[k + 1] += wx * wy * self.weights[start + k] as f64 / 255.0;
                }
            }
        }
        out[0] = (1.0 - out[1..].iter().sum::<f64>()).max(0.0);
        out
    }

    /// Natural reading of a soft-brush painting, prepared once per generation.
    /// Zone borders follow seeded low-frequency noise instead of the brush outline,
    /// painted shares are smoothed into broad slopes (a painted range rises towards
    /// its axis instead of standing on a pedestal), mountains gain foothills taken
    /// from the plain, and high mountains gain a mountain margin. The sea share is
    /// left where it was painted: the coast operation owns it.
    pub fn naturalized(&self, seed: &str, width: f64, motif: f64) -> TerrainZones {
        if self.weights.iter().all(|&w| w == 0) {
            return self.clone();
        }
        const N: usize = 128;
        let cell = width / N as f64;
        let noise = crate::noise::Noise::new(
            crate::rng::Rng::new(&format!("magna-urbis:{seed}"))
                .fork("terrain")
                .fork("zones"),
        );
        let warp_amp = (0.06 * motif).min(0.035 * width) * 1.6;
        let warp_wave = (0.3 * motif).min(0.15 * width).max(cell * 6.0);
        // Land partition [auto, plain, hills, mountains, high] plus the painted sea.
        let mut land = vec![[0.0_f64; 5]; N * N];
        let mut sea = vec![0.0_f64; N * N];
        for y in 0..N {
            for x in 0..N {
                let (px, py) = ((x as f64 + 0.5) * cell, (y as f64 + 0.5) * cell);
                let here = self.sample(px / width, py / width);
                let dx = warp_amp * noise.fbm(px / warp_wave + 7.3, py / warp_wave - 2.1, 3);
                let dy = warp_amp * noise.fbm(px / warp_wave - 5.9, py / warp_wave + 4.4, 3);
                let moved = self.sample((px + dx) / width, (py + dy) / width);
                let pick = |s: &[f64; 6]| [s[0], s[2], s[3], s[4], s[5]];
                let (warped, original) = (pick(&moved), pick(&here));
                let source = if warped.iter().sum::<f64>() > 1e-6 { warped } else { original };
                let total = source.iter().sum::<f64>();
                let i = y * N + x;
                sea[i] = here[1];
                if total > 1e-9 {
                    land[i] = source.map(|v| v / total * (1.0 - here[1]));
                }
            }
        }
        let renormalize = |land: &mut [[f64; 5]], sea: &[f64]| {
            for (cell, &s) in land.iter_mut().zip(sea) {
                let total = cell.iter().sum::<f64>();
                if total > 1e-9 {
                    *cell = cell.map(|v| v / total * (1.0 - s));
                }
            }
        };
        let blur = |field: &[f64], sigma_m: f64| -> Vec<f64> {
            let sigma = (sigma_m / cell).max(0.5);
            let r = (sigma * 3.0).ceil() as isize;
            let kernel: Vec<f64> = (-r..=r)
                .map(|d| (-(d * d) as f64 / (2.0 * sigma * sigma)).exp())
                .collect();
            let norm: f64 = kernel.iter().sum();
            let mut tmp = vec![0.0; N * N];
            let mut out = vec![0.0; N * N];
            let clamp = |v: isize| v.clamp(0, N as isize - 1) as usize;
            for y in 0..N {
                for x in 0..N {
                    tmp[y * N + x] = (-r..=r)
                        .map(|d| kernel[(d + r) as usize] * field[y * N + clamp(x as isize + d)])
                        .sum::<f64>()
                        / norm;
                }
            }
            for y in 0..N {
                for x in 0..N {
                    out[y * N + x] = (-r..=r)
                        .map(|d| kernel[(d + r) as usize] * tmp[clamp(y as isize + d) * N + x])
                        .sum::<f64>()
                        / norm;
                }
            }
            out
        };
        // Broad slopes: smoothing every share keeps a partition and turns a painted
        // band into a ramp that peaks along its axis.
        let smooth_m = (0.04 * motif).min(0.025 * width);
        let channels: Vec<Vec<f64>> = (0..5)
            .map(|k| blur(&land.iter().map(|c| c[k]).collect::<Vec<_>>(), smooth_m))
            .collect();
        for (i, cell) in land.iter_mut().enumerate() {
            *cell = std::array::from_fn(|k| channels[k][i]);
        }
        renormalize(&mut land, &sea);
        let margin_m = (0.12 * motif).min(0.07 * width);
        // A high massif stands on mountains, taken from hills first, then plain.
        let high = blur(&land.iter().map(|c| c[4]).collect::<Vec<_>>(), margin_m);
        for (cell, &spread) in land.iter_mut().zip(&high) {
            let mut want = ((spread - cell[4]) * 1.5).clamp(0.0, 0.85);
            for k in [2, 1] {
                let t = want.min(cell[k]);
                cell[k] -= t;
                cell[3] += t;
                want -= t;
            }
        }
        // Mountains rise from foothills: their spread converts plain into hills.
        let massif = blur(&land.iter().map(|c| c[3] + c[4]).collect::<Vec<_>>(), margin_m);
        for (cell, &spread) in land.iter_mut().zip(&massif) {
            let t = ((spread - cell[3] - cell[4]) * 1.6).clamp(0.0, 0.9).min(cell[1]);
            cell[1] -= t;
            cell[2] += t;
        }
        let mut weights = Vec::with_capacity(N * N * ZONE_CHANNELS);
        for (cell, &s) in land.iter().zip(&sea) {
            let mut q = [s, cell[1], cell[2], cell[3], cell[4]].map(|v| (v * 255.0).round().clamp(0.0, 255.0) as u8);
            while q.iter().map(|&v| v as u32).sum::<u32>() > 255 {
                let m = (0..ZONE_CHANNELS).max_by_key(|&k| q[k]).unwrap();
                q[m] -= 1;
            }
            weights.extend(q);
        }
        TerrainZones {
            version: self.version,
            resolution: N,
            weights,
        }
    }

    pub(crate) fn strongest(&self, fallback: crate::Relief) -> crate::Relief {
        use crate::Relief;
        let profiles = [
            Relief::Flat,
            Relief::Flat,
            Relief::Hills,
            Relief::Mountains,
            Relief::HighMountains,
        ];
        let mut strongest = Relief::Flat;
        for cell in self.weights.as_chunks::<ZONE_CHANNELS>().0.iter() {
            if cell.iter().map(|&v| v as u32).sum::<u32>() < 255
                && fallback.amplitude(2400.0) > strongest.amplitude(2400.0)
            {
                strongest = fallback;
            }
            for (k, &weight) in cell.iter().enumerate() {
                if weight > 0 && profiles[k].amplitude(2400.0) > strongest.amplitude(2400.0) {
                    strongest = profiles[k];
                }
            }
        }
        strongest
    }
}

/// Local relief scale of a painted massif, in half-widths: a band 1 km wide gets
/// the structure of a 2.5 km motif, never more than the user's motif.
const FEATURE_SCALE: f64 = 5.0;

fn smoothstep(t: f64) -> f64 {
    let t = t.clamp(0.0, 1.0);
    t * t * (3.0 - 2.0 * t)
}

/// Geometry of the painted massifs (mountains + high mountains share >= 1/2) on the
/// zone grid, so that the relief structure follows what was painted: how deep a
/// cell lies inside its massif, the local half-width of the massif, and the local
/// relief scale (the user's motif away from narrow massifs, smaller in and around
/// them). The map edge is not a massif border: a range painted off the map goes on.
pub(crate) struct ReliefShape {
    n: usize,
    width: f64,
    /// Distance to the massif border, metres (0 outside).
    depth: Vec<f32>,
    /// Radius of the largest inscribed disc containing the cell, metres (0 outside).
    half: Vec<f32>,
    /// Local relief scale, metres, in `min_scale..=motif`.
    scale: Vec<f32>,
    /// Scale of the nearest narrow massif without the fade: constant out to three
    /// half-widths from its axis, then back to the motif by six. Piedmont hills use it,
    /// so their amplitude only decreases away from the massif (no raised ring).
    core: Vec<f32>,
    /// Scale of the whole massif (its widest inscribed disc), held and faded like
    /// `core`: what counts as narrow is the feature, not the local width at its tips.
    wide: Vec<f32>,
}

/// Core scale holds out to `CORE_HOLD` radii from a massif axis, back to the motif by `CORE_END`.
const CORE_HOLD: f64 = 3.0;
const CORE_END: f64 = 6.0;

impl ReliefShape {
    pub(crate) fn new(zones: &TerrainZones, width: f64, motif: f64, min_scale: f64) -> Self {
        let n = zones.resolution;
        let cell = width / n as f64;
        let min_scale = min_scale.min(motif);
        let inside: Vec<bool> = zones
            .weights
            .as_chunks::<ZONE_CHANNELS>()
            .0
            .iter()
            .map(|w| w[3] as u32 + w[4] as u32 >= 128)
            .collect();
        // Two-pass chamfer distance, in cells, to the nearest cell outside a massif.
        let far = n as f32;
        let mut d: Vec<f32> = inside.iter().map(|&i| if i { far } else { 0.0 }).collect();
        let diagonal = std::f32::consts::SQRT_2;
        for y in 0..n {
            for x in 0..n {
                let i = y * n + x;
                if !inside[i] {
                    continue;
                }
                let mut v = d[i];
                if x > 0 {
                    v = v.min(d[i - 1] + 1.0);
                }
                if y > 0 {
                    v = v.min(d[i - n] + 1.0);
                    if x > 0 {
                        v = v.min(d[i - n - 1] + diagonal);
                    }
                    if x + 1 < n {
                        v = v.min(d[i - n + 1] + diagonal);
                    }
                }
                d[i] = v;
            }
        }
        for y in (0..n).rev() {
            for x in (0..n).rev() {
                let i = y * n + x;
                if !inside[i] {
                    continue;
                }
                let mut v = d[i];
                if x + 1 < n {
                    v = v.min(d[i + 1] + 1.0);
                }
                if y + 1 < n {
                    v = v.min(d[i + n] + 1.0);
                    if x + 1 < n {
                        v = v.min(d[i + n + 1] + diagonal);
                    }
                    if x > 0 {
                        v = v.min(d[i + n - 1] + diagonal);
                    }
                }
                d[i] = v.min(far);
            }
        }
        // The border lies half a cell outside the last inside cell centre.
        let depth: Vec<f32> = d
            .iter()
            .map(|&v| ((v - 0.5).max(0.0) as f64 * cell) as f32)
            .collect();
        let mut half = vec![0.0_f32; n * n];
        let mut scale = vec![motif as f32; n * n];
        let mut core = vec![motif as f32; n * n];
        let mut wide = vec![motif as f32; n * n];
        if inside.iter().all(|&i| i) || inside.iter().all(|&i| !i) {
            // One massif covering the map, or none: nothing narrow to adapt to.
            return Self {
                n,
                width,
                half: depth.clone(),
                depth,
                scale,
                core,
                wide,
            };
        }
        // Massifs as 8-connected components, each with its widest inscribed radius.
        let mut label = vec![usize::MAX; n * n];
        let mut widest: Vec<f32> = Vec::new();
        for start in 0..n * n {
            if !inside[start] || label[start] != usize::MAX {
                continue;
            }
            let id = widest.len();
            let mut radius = 0.0_f32;
            let mut stack = vec![start];
            label[start] = id;
            while let Some(i) = stack.pop() {
                radius = radius.max(d[i] - 0.5);
                let (x, y) = ((i % n) as isize, (i / n) as isize);
                for (dx, dy) in [(-1, -1), (0, -1), (1, -1), (-1, 0), (1, 0), (-1, 1), (0, 1), (1, 1)] {
                    let (nx, ny) = (x + dx, y + dy);
                    if nx < 0 || ny < 0 || nx >= n as isize || ny >= n as isize {
                        continue;
                    }
                    let j = ny as usize * n + nx as usize;
                    if inside[j] && label[j] == usize::MAX {
                        label[j] = id;
                        stack.push(j);
                    }
                }
            }
            widest.push(radius);
        }
        // Every inside cell stamps its inscribed disc (radius capped: beyond it the
        // massif is broad and its dome flattens into regional relief).
        const RADIUS_CAP: f32 = 24.0;
        for cy in 0..n {
            for cx in 0..n {
                let i = cy * n + cx;
                let r = (d[i] - 0.5).min(RADIUS_CAP);
                if !inside[i] || r <= 0.0 {
                    continue;
                }
                let span = (r + 0.5).ceil() as isize;
                for y in (cy as isize - span).max(0)..=(cy as isize + span).min(n as isize - 1) {
                    for x in (cx as isize - span).max(0)..=(cx as isize + span).min(n as isize - 1) {
                        let j = y as usize * n + x as usize;
                        let dist = ((x - cx as isize) as f32).hypot((y - cy as isize) as f32);
                        if inside[j] && dist <= r + 0.5 {
                            half[j] = half[j].max(r * cell as f32);
                        }
                    }
                }
            }
        }
        // Medial cells (local maxima of the distance) set a local scale fading back
        // to the motif over one more radius around their disc (foothills), and the
        // core scale held further out for the piedmont hills.
        for cy in 0..n {
            for cx in 0..n {
                let i = cy * n + cx;
                let r = d[i] - 0.5;
                if !inside[i] || r <= 0.0 {
                    continue;
                }
                let mut medial = true;
                for (dx, dy) in [(-1, -1), (0, -1), (1, -1), (-1, 0), (1, 0), (-1, 1), (0, 1), (1, 1)] {
                    let (nx, ny) = (cx as isize + dx, cy as isize + dy);
                    if nx >= 0 && ny >= 0 && (nx as usize) < n && (ny as usize) < n
                        && d[ny as usize * n + nx as usize] > d[i]
                    {
                        medial = false;
                        break;
                    }
                }
                if !medial {
                    continue;
                }
                let r = r as f64;
                let feature = (FEATURE_SCALE * r * cell).clamp(min_scale, motif);
                if feature >= motif {
                    continue;
                }
                let whole = (FEATURE_SCALE * widest[label[i]] as f64 * cell).clamp(min_scale, motif);
                let reach = 2.0 * r + 1.0;
                let core_reach = CORE_END * r + 1.0;
                let span = core_reach.ceil() as isize;
                for y in (cy as isize - span).max(0)..=(cy as isize + span).min(n as isize - 1) {
                    for x in (cx as isize - span).max(0)..=(cx as isize + span).min(n as isize - 1) {
                        let j = y as usize * n + x as usize;
                        let dist = ((x - cx as isize) as f64).hypot((y - cy as isize) as f64);
                        if dist > core_reach {
                            continue;
                        }
                        let blend = |t: f64| (feature.ln() * (1.0 - t) + motif.ln() * t).exp() as f32;
                        let held = smoothstep(
                            (dist - CORE_HOLD * r) / ((CORE_END - CORE_HOLD) * r + 1.0),
                        );
                        core[j] = core[j].min(blend(held));
                        if whole < motif {
                            let whole_blend = (whole.ln() * (1.0 - held) + motif.ln() * held).exp() as f32;
                            wide[j] = wide[j].min(whole_blend);
                        }
                        if dist <= reach {
                            scale[j] = scale[j].min(blend(smoothstep((dist - r) / (r + 1.0))));
                        }
                    }
                }
            }
        }
        for j in 0..n * n {
            if inside[j] {
                half[j] = half[j].max(depth[j]);
            }
        }
        Self {
            n,
            width,
            depth,
            half,
            scale,
            core,
            wide,
        }
    }

    /// Bilinear scale (metres) of the whole nearest narrow massif: narrow-massif rules
    /// follow the feature, so the tips of a broad massif are not treated as a band.
    pub(crate) fn wide_scale(&self, px: f64, py: f64) -> f64 {
        self.bilinear(&self.wide, px, py)
    }

    /// Bilinear core scale (metres) of the nearest narrow massif, for piedmont hills.
    pub(crate) fn core_scale(&self, px: f64, py: f64) -> f64 {
        self.bilinear(&self.core, px, py)
    }

    fn bilinear(&self, field: &[f32], px: f64, py: f64) -> f64 {
        let n = self.n;
        let x = (px / self.width * n as f64 - 0.5).clamp(0.0, (n - 1) as f64);
        let y = (py / self.width * n as f64 - 0.5).clamp(0.0, (n - 1) as f64);
        let (x0, y0) = (x.floor() as usize, y.floor() as usize);
        let (tx, ty) = (x - x0 as f64, y - y0 as f64);
        let mut out = 0.0;
        for (xx, wx) in [(x0, 1.0 - tx), ((x0 + 1).min(n - 1), tx)] {
            for (yy, wy) in [(y0, 1.0 - ty), ((y0 + 1).min(n - 1), ty)] {
                out += wx * wy * field[yy * n + xx] as f64;
            }
        }
        out
    }

    /// Bilinear (depth, half-width, local scale) in metres at a map position.
    pub(crate) fn at(&self, px: f64, py: f64) -> (f64, f64, f64) {
        let n = self.n;
        let x = (px / self.width * n as f64 - 0.5).clamp(0.0, (n - 1) as f64);
        let y = (py / self.width * n as f64 - 0.5).clamp(0.0, (n - 1) as f64);
        let (x0, y0) = (x.floor() as usize, y.floor() as usize);
        let (tx, ty) = (x - x0 as f64, y - y0 as f64);
        let mut out = (0.0, 0.0, 0.0);
        for (xx, wx) in [(x0, 1.0 - tx), ((x0 + 1).min(n - 1), tx)] {
            for (yy, wy) in [(y0, 1.0 - ty), ((y0 + 1).min(n - 1), ty)] {
                let i = yy * n + xx;
                out.0 += wx * wy * self.depth[i] as f64;
                out.1 += wx * wy * self.half[i] as f64;
                out.2 += wx * wy * self.scale[i] as f64;
            }
        }
        out
    }

    /// Uplift profile of a massif across its width: highest along its axis, so that a
    /// painted massif of any size drains outward instead of holding an inner basin.
    pub(crate) fn dome(&self, px: f64, py: f64) -> f64 {
        let (depth, half, _) = self.at(px, py);
        if half <= 0.0 {
            return 0.35;
        }
        let p = (depth / half).clamp(0.0, 1.0);
        0.35 + 0.65 * p * (2.0 - p)
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn erased_operations_restore_the_seeded_generator() {
        let zones = TerrainZones {
            version: 1,
            resolution: 8,
            weights: vec![0; 8 * 8 * 5],
        };
        let ordinary =
            crate::TerrainGenerator::new("zones-regression", 2400.0, "flat", 0.7, 3000.0).unwrap();
        let edited = crate::TerrainGenerator::with_zones(
            "zones-regression",
            2400.0,
            "flat",
            0.7,
            3000.0,
            0.5,
            None,
            &zones,
        )
        .unwrap();
        assert_eq!(
            ordinary.sample_region(0.0, 0.0, 2400.0, 64).unwrap().height,
            edited.sample_region(0.0, 0.0, 2400.0, 64).unwrap().height
        );
    }

    #[test]
    fn mountain_operations_generate_seeded_relief_inside_their_mask() {
        let mut zones = TerrainZones {
            version: 1,
            resolution: 16,
            weights: vec![0; 16 * 16 * 5],
        };
        for y in 0..16 {
            for x in 0..16 {
                zones.weights[(y * 16 + x) * 5 + if x < 8 { 1 } else { 3 }] = 255;
            }
        }
        let generate = |seed| {
            crate::generate_motif_base_with_noise(
                seed,
                12000.0,
                "flat",
                0.7,
                64,
                4000.0,
                0.5,
                None,
                Some(&zones),
            )
            .unwrap()
            .height
        };
        let first = generate("zones-regression");
        let mut plain = Vec::new();
        let mut mountains = Vec::new();
        for y in 8..56 {
            for x in 4..28 {
                plain.push(first[y * 64 + x]);
                mountains.push(first[y * 64 + x + 32]);
            }
        }
        let range = |v: &[f32]| {
            v.iter().copied().fold(f32::NEG_INFINITY, f32::max)
                - v.iter().copied().fold(f32::INFINITY, f32::min)
        };
        assert!(range(&mountains) > range(&plain) * 5.0);
        assert_eq!(first, generate("zones-regression"));
        assert_ne!(first, generate("zones-other-seed"));
        let mut tiny = TerrainZones {
            version: 1,
            resolution: 16,
            weights: vec![0; 16 * 16 * 5],
        };
        tiny.weights[(8 * 16 + 8) * 5 + 4] = 255;
        let height = crate::generate_motif_base_with_noise(
            "tiny-massif",
            12000.0,
            "flat",
            0.7,
            64,
            4000.0,
            0.5,
            None,
            Some(&tiny),
        )
        .unwrap()
        .height;
        assert!(
            height.iter().all(|h| h.is_finite() && *h < 10000.0),
            "A small mask must not normalize against the plain's percentile."
        );
    }

    #[test]
    fn marine_operation_cuts_neural_land_without_sculpting_other_zones() {
        let mut zones = TerrainZones {
            version: 1,
            resolution: 8,
            weights: vec![0; 8 * 8 * 5],
        };
        for y in 0..8 {
            for x in 4..8 {
                zones.weights[(y * 8 + x) * 5] = 255;
            }
        }
        let field = vec![1000.0; 1024 * 1024];
        let terrain = crate::TerrainGenerator::with_zoned_surface(
            "sea-operation",
            40000.0,
            6000.0,
            &field,
            &zones,
        )
        .unwrap()
        .sample_region(0.0, 0.0, 40000.0, 64)
        .unwrap();
        assert_eq!(terrain.height[32 * 64 + 8], 1000.0);
        assert!(terrain.height[32 * 64 + 56] < 0.0);
        let mut procedural = crate::TerrainGenerator::with_zones(
            "sea-operation",
            2400.0,
            "flat",
            0.0,
            3000.0,
            0.5,
            None,
            &zones,
        )
        .unwrap();
        // The painted east sea now arrives through the traced coast contract.
        // Four land bytes then four sea bytes per row on a 64-cell grid.
        let mode = format!("traced:64:{}", "00000000ffffffff".repeat(64));
        procedural.set_coast(1 << 6, &mode).unwrap();
        let retained = procedural.sample_region(0.0, 0.0, 2400.0, 64).unwrap();
        assert!(retained.height[32 * 64 + 56] < 0.0);
        assert!((8..56).any(|y| retained.height[y * 64] < 0.0));
    }

    #[test]
    fn tips_of_a_broad_massif_are_not_narrow() {
        // A wide disc (radius 10 cells of 100 m) with a thin tongue: one massif, so the
        // tongue keeps the whole massif's scale for the narrow-massif rules.
        let mut zones = TerrainZones {
            version: 1,
            resolution: 64,
            weights: vec![0; 64 * 64 * 5],
        };
        for y in 0..64 {
            for x in 0..64 {
                let disc = ((x as f64 - 20.5).powi(2) + (y as f64 - 32.5).powi(2)).sqrt() < 10.0;
                let tongue = (30..50).contains(&x) && (31..34).contains(&y);
                zones.weights[(y * 64 + x) * 5 + if disc || tongue { 3 } else { 1 }] = 255;
            }
        }
        let shape = ReliefShape::new(&zones, 6400.0, 10000.0, 300.0);
        // Tongue centre: local scale from its 150 m half-width, whole scale from the disc.
        let (_, _, local) = shape.at(4000.0, 3250.0);
        let whole = shape.wide_scale(4000.0, 3250.0);
        assert!(local < 1500.0, "tongue local scale {local}");
        assert!(whole > 4000.0, "tongue whole scale {whole}");
    }

    #[test]
    fn relief_shape_scales_to_a_narrow_painted_band() {
        // 32² zones over 3.2 km: a north-south mountain band eight cells (800 m) wide.
        let mut zones = TerrainZones {
            version: 1,
            resolution: 32,
            weights: vec![0; 32 * 32 * 5],
        };
        for y in 0..32 {
            for x in 0..32 {
                zones.weights[(y * 32 + x) * 5 + if (12..20).contains(&x) { 3 } else { 1 }] = 255;
            }
        }
        let shape = ReliefShape::new(&zones, 3200.0, 10000.0, 300.0);
        let (depth, half, scale) = shape.at(1600.0, 1600.0);
        assert!((300.0..=420.0).contains(&depth), "axis depth {depth}");
        assert!((300.0..=420.0).contains(&half), "axis half-width {half}");
        // Five half-widths: a band 800 m wide gets the structure of a ~1.8 km motif.
        assert!((1400.0..=2200.0).contains(&scale), "axis scale {scale}");
        assert!(shape.dome(1600.0, 1600.0) > 0.95);
        assert!(shape.dome(1250.0, 1600.0) < shape.dome(1450.0, 1600.0));
        assert_eq!(shape.dome(150.0, 1600.0), 0.35);
        // Far from the band the user's motif is kept.
        assert!((shape.at(150.0, 1600.0).2 - 10000.0).abs() < 1.0);
        // Piedmont hills 700 m from the axis keep the band's own scale (no fade).
        assert!((1400.0..=2200.0).contains(&shape.core_scale(2300.0, 1600.0)));
        assert!(shape.core_scale(2300.0, 1600.0) < shape.at(2300.0, 1600.0).2);
        // One straight band: the whole feature has the axis scale.
        assert!((shape.wide_scale(1600.0, 1600.0) - shape.core_scale(1600.0, 1600.0)).abs() < 1.0);
    }

    #[test]
    fn narrow_flanks_are_bounded_in_final_units() {
        // A flat-topped north-south ridge whose flanks rise 60 m per 30 m cell (63
        // degrees) over ten cells: wide enough for the bounded low-pass flank.
        let n = 48;
        let mut h: Vec<f32> = (0..n * n)
            .map(|i| (60.0 * (18.0 - ((i % n) as f32 - 24.0).abs())).clamp(0.0, 600.0))
            .collect();
        // Rise across the west flank, from its foot (x = 6) to its shoulder (x = 16).
        let rise = |h: &[f32]| h[24 * n + 16] - h[24 * n + 6];
        let (before, mass) = (rise(&h), h.iter().map(|&v| v as f64).sum::<f64>());
        crate::erosion::limit_slopes(&mut h, n, 30.0, &vec![1.0; n * n]);
        assert!(rise(&h) < before - 10.0, "flank rise {} not below {before}", rise(&h));
        let after = h.iter().map(|&v| v as f64).sum::<f64>();
        assert!((after - mass).abs() < mass * 1e-3, "mass {mass} -> {after}");
        let n = 24;
        // Fine relief rides on the bounded flank: a 3 m ripple along the ridge survives.
        let mut rippled: Vec<f32> = (0..n * n)
            .map(|i| {
                let (x, y) = ((i % n) as f32, (i / n) as f32);
                (300.0 - 60.0 * (x - 12.0).abs()).max(0.0) + if (y as usize) % 2 == 0 { 3.0 } else { 0.0 }
            })
            .collect();
        crate::erosion::limit_slopes(&mut rippled, n, 30.0, &vec![1.0; n * n]);
        let ripple = (rippled[12 * n + 9] - rippled[13 * n + 9]).abs();
        assert!(ripple > 1.0, "detail lost: {ripple}");
        // Untouched where the weight is zero.
        let mut flat = vec![5.0_f32; n * n];
        flat[12 * n + 12] = 500.0;
        crate::erosion::limit_slopes(&mut flat, n, 30.0, &vec![0.0; n * n]);
        assert_eq!(flat[12 * n + 12], 500.0);
    }

    #[test]
    fn painted_massif_is_highest_inside() {
        // A solid mountain disc in a plain must not come out as a ring crater.
        let mut zones = TerrainZones {
            version: 1,
            resolution: 32,
            weights: vec![0; 32 * 32 * 5],
        };
        for y in 0..32 {
            for x in 0..32 {
                let r = ((x as f64 - 15.5).powi(2) + (y as f64 - 15.5).powi(2)).sqrt();
                zones.weights[(y * 32 + x) * 5 + if r < 8.0 { 3 } else { 1 }] = 255;
            }
        }
        let height = crate::generate_motif_base_with_noise(
            "massif-dome",
            12000.0,
            "hills",
            1.0,
            64,
            4000.0,
            0.5,
            None,
            Some(&zones),
        )
        .unwrap()
        .height;
        let (mut inner, mut rim) = (f32::MIN, f32::MIN);
        for y in 0..64 {
            for x in 0..64 {
                // Radius in zone cells (two height cells per zone cell).
                let r = ((x as f64 + 0.5) / 2.0 - 16.0).hypot((y as f64 + 0.5) / 2.0 - 16.0);
                let h = height[y * 64 + x];
                if r < 4.0 {
                    inner = inner.max(h);
                } else if (5.0..8.0).contains(&r) {
                    rim = rim.max(h);
                }
            }
        }
        assert!(inner > rim, "summit {inner} must be inside the massif, rim {rim}");
    }
}
