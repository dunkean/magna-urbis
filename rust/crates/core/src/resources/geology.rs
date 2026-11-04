//! Realised geology: the structure of `surface_context.py::geology()` (warped folded
//! strata, basement windows, granite intrusions, suture lenses, lava flows) on keyed
//! world noise, with eight classes whose area shares follow the regional prior.
//!
//! `class(x) = argmax_k [ln(w_k + 0.03) + ln E_k + 0.35 N_k + b_k]` (Neural Earth
//! §16.3): `w_k` the structural proportions, `E_k` the prior shares, `N_k` a per-rock
//! province noise and `b_k` biases fitted per LOD-10 parent cell (30.72 km) by a few
//! proportional iterations. Every point takes the biases of exactly one parent, the cell
//! holding its warped position (so the seams follow the folds), and each parent is fitted
//! on exactly the samples it owns: the realised shares of every parent domain equal the
//! prior, up to sampling. (Interpolating biases between parents broke this: a bias only
//! means something against its own cell's samples, and blends drifted granite to 2x.)
//! Every term is a function of the world point, so two windows agree where they overlap.
use super::keys::{cell_size, key, unit, ValueNoise};
use super::prior::RegionPrior;

const PARENT_LOD: i32 = 10;
/// Calibration samples per parent side, and proportional-fitting rounds (cheap: argmax only).
const SAMPLES: usize = 48;
/// Bound of the warp displacement (sum of the warp amplitudes), m.
const WARP_MAX: f64 = 2400.0 + 650.0 + 180.0 + 55.0;
const ROUNDS: usize = 40;
pub const HARDNESS: [f32; 8] = [0.85, 0.57, 0.67, 0.24, 0.91, 0.80, 0.88, 0.15];
pub const WEATHERABILITY: [f32; 8] = [0.38, 0.65, 0.46, 0.88, 0.55, 0.42, 0.60, 0.95];
/// Source texture (sand, silt, clay) of each rock's regolith.
pub const TEXTURE: [[f32; 3]; 8] = [
    [0.66, 0.24, 0.10],
    [0.20, 0.48, 0.32],
    [0.83, 0.12, 0.05],
    [0.10, 0.40, 0.50],
    [0.30, 0.36, 0.34],
    [0.45, 0.38, 0.17],
    [0.25, 0.35, 0.40],
    [0.15, 0.45, 0.40],
];
/// Strata bands on the fold phase: (rock, centre, half width).
const STRATA: [(usize, f64, f64); 4] = [(1, 0.20, 0.20), (7, 0.38, 0.035), (2, 0.56, 0.16), (3, 0.86, 0.14)];

pub struct Rock {
    pub class: u8,
    /// Structural proportions before realisation (sum 1).
    pub weights: [f32; 8],
    pub hardness: f32,
    pub weatherability: f32,
    /// Bed azimuth, tangent to the folded contacts, degrees clockwise from north in [0, 180).
    pub azimuth: f32,
}

fn smoothstep(a: f64, b: f64, x: f64) -> f64 {
    let t = ((x - a) / (b - a)).clamp(0.0, 1.0);
    t * t * (3.0 - 2.0 * t)
}

pub struct Geology {
    warp: [[ValueNoise; 4]; 2],
    fold: ValueNoise,
    phase: [ValueNoise; 3],
    contact: ValueNoise,
    basement: [ValueNoise; 3],
    intrusion: [ValueNoise; 4],
    suture: [ValueNoise; 2],
    lava: [ValueNoise; 4],
    variation: [ValueNoise; 3],
    rock: [ValueNoise; 8],
    strike: (f64, f64),
    phase0: f64,
    log_prior: [f64; 8],
    /// Fitted biases of the parent cells `[i0, i0 + side) x [j0, j0 + side)` (warped frame).
    parents: (i64, i64, usize, Vec<[f64; 8]>),
}

impl Geology {
    /// Calibrates the parent cells the warped window `[x0, x1] x [y0, y1]` (world m) can reach.
    pub fn new(seed: u64, prior: &RegionPrior, window: [f64; 4]) -> Self {
        let n = |name: &str, lod| ValueNoise::new(seed, &format!("geology-{name}"), lod);
        let strike = 0.3 + 2.4 * unit(key(seed, &["resources", "geology", "strike"]));
        let mut geology = Self {
            warp: [
                [n("warp-x8", 8), n("warp-x6", 6), n("warp-x4", 4), n("warp-x2", 2)],
                [n("warp-y8", 8), n("warp-y6", 6), n("warp-y4", 4), n("warp-y2", 2)],
            ],
            fold: n("fold", 6),
            phase: [n("phase5", 5), n("phase3", 3), n("phase1", 1)],
            contact: n("contact", 5),
            basement: [n("basement8", 8), n("basement6", 6), n("basement4", 4)],
            intrusion: [n("intrusion8", 8), n("intrusion6", 6), n("intrusion4", 4), n("intrusion2", 2)],
            suture: [n("suture7", 7), n("suture5", 5)],
            lava: [n("lava8", 8), n("lava5", 5), n("lava3", 3), n("lava2", 2)],
            variation: [n("variation5", 5), n("variation3", 3), n("variation1", 1)],
            rock: std::array::from_fn(|k| n(&format!("rock-{}", super::prior::ROCKS[k]), 6)),
            strike: (strike.cos(), strike.sin()),
            phase0: 10.0 * unit(key(seed, &["resources", "geology", "phase"])),
            log_prior: prior.rock_shares.map(|s| if s > 0.0 { (s as f64).ln() } else { f64::NEG_INFINITY }),
            parents: (0, 0, 0, Vec::new()),
        };
        let p = cell_size(PARENT_LOD);
        let lo = |v: f64| (v / p).floor() as i64;
        let (i0, j0) = (lo(window[0] - WARP_MAX), lo(window[1] - WARP_MAX));
        let side = ((lo(window[2] + WARP_MAX) - i0).max(lo(window[3] + WARP_MAX) - j0) + 1) as usize;
        let target = prior.rock_shares;
        let biases = crate::urban::par::range(side * side, |c| {
            let (i, j) = (i0 + (c % side) as i64, j0 + (c / side) as i64);
            geology.calibrate(i, j, &target)
        });
        geology.parents = (i0, j0, side, biases);
        geology
    }

    /// Parent cell owning a world point: the one holding its warped position.
    fn parent(&self, x: f64, y: f64) -> (i64, i64) {
        let p = cell_size(PARENT_LOD);
        let (xx, yy) = self.warped(x, y);
        ((xx / p).floor() as i64, (yy / p).floor() as i64)
    }

    /// Proportional fitting of the biases on the samples one parent owns (a regular grid
    /// over the cell grown by the warp bound, kept where [`Self::parent`] is this cell).
    fn calibrate(&self, i: i64, j: i64, target: &[f32; 8]) -> [f64; 8] {
        let p = cell_size(PARENT_LOD);
        let step = p / SAMPLES as f64;
        let n = ((p + 2.0 * WARP_MAX) / step).ceil() as usize;
        let (x0, y0) = (i as f64 * p - WARP_MAX, j as f64 * p - WARP_MAX);
        let base: Vec<[f64; 8]> = (0..n * n)
            .filter_map(|s| {
                let x = x0 + ((s % n) as f64 + 0.5) * step;
                let y = y0 + ((s / n) as f64 + 0.5) * step;
                (self.parent(x, y) == (i, j)).then(|| self.scores(x, y, &self.structure(x, y).0))
            })
            .collect();
        if base.is_empty() {
            return [0.0; 8];
        }
        let floor = 0.5 / base.len() as f64;
        let mut bias = [0.0_f64; 8];
        let active = target.iter().filter(|&&t| t > 0.0).count().max(1) as f64;
        for round in 0..ROUNDS {
            let mut count = [0usize; 8];
            for s in &base {
                count[argmax(s, &bias)] += 1;
            }
            // Decaying gain against the oscillation of hard shares; centred (argmax ignores a shift).
            let gain = 0.8 / (1.0 + round as f64 / 6.0);
            for k in 0..8 {
                if target[k] > 0.0 {
                    let share = (count[k] as f64 / base.len() as f64).max(floor);
                    bias[k] += gain * (target[k] as f64 / share).ln();
                }
            }
            let mean = (0..8).filter(|&k| target[k] > 0.0).map(|k| bias[k]).sum::<f64>() / active;
            bias.iter_mut().for_each(|b| *b = (*b - mean).clamp(-8.0, 8.0));
        }
        bias
    }

    fn bias_at(&self, x: f64, y: f64) -> [f64; 8] {
        let (i0, j0, side, ref biases) = self.parents;
        let (i, j) = self.parent(x, y);
        let i = (i - i0).clamp(0, side as i64 - 1) as usize;
        let j = (j - j0).clamp(0, side as i64 - 1) as usize;
        biases[j * side + i]
    }

    fn warped(&self, x: f64, y: f64) -> (f64, f64) {
        let amp = [2400.0, 650.0, 180.0, 55.0];
        let w = |a: &[ValueNoise; 4]| (0..4).map(|o| amp[o] * a[o].at(x, y)).sum::<f64>();
        (x + w(&self.warp[0]), y + w(&self.warp[1]))
    }

    fn fold_at(&self, x: f64, y: f64) -> f64 {
        let (xx, yy) = self.warped(x, y);
        let (c, s) = self.strike;
        let cross = xx * c + yy * s;
        let along = -xx * s + yy * c;
        cross + 1500.0 * (along / 5100.0 + 0.5 * self.fold.at(x, y)).sin()
    }

    /// Structural proportions and the fold value at a world point.
    fn structure(&self, x: f64, y: f64) -> ([f64; 8], f64) {
        let (xx, yy) = self.warped(x, y);
        let fold = self.fold_at(x, y);
        let phase = (fold / 3500.0
            + 0.07 * self.phase[0].at(x, y)
            + 0.018 * self.phase[1].at(x, y)
            + 0.004 * self.phase[2].at(x, y)
            + self.phase0)
            .rem_euclid(1.0);
        let contact = (320.0 + 400.0 * smoothstep(-0.65, 0.65, self.contact.at(x, y))) / 3500.0;
        let mut w = [0.0_f64; 8];
        for (k, centre, half) in STRATA {
            let d = ((phase - centre + 0.5).rem_euclid(1.0) - 0.5).abs();
            w[k] = smoothstep(-contact, contact, half - d);
        }
        let sum: f64 = w.iter().sum::<f64>().max(1e-8);
        w.iter_mut().for_each(|v| *v /= sum);
        let replace = |w: &mut [f64; 8], k: usize, f: f64| {
            w.iter_mut().for_each(|v| *v *= 1.0 - f);
            w[k] += f;
        };
        let b = &self.basement;
        let basement = b[0].at(xx, yy) + 0.35 * b[1].at(x, y) + 0.1 * b[2].at(x, y);
        replace(&mut w, 5, smoothstep(0.15, 0.55, basement));
        let g = &self.intrusion;
        let intrusion = g[0].at(xx, yy) + 0.38 * g[1].at(x, y) + 0.12 * g[2].at(x, y) + 0.035 * g[3].at(x, y);
        replace(&mut w, 0, smoothstep(0.10, 0.52, intrusion));
        let ridge = 1.0 - (self.suture[0].at(xx, yy) + 0.25 * self.suture[1].at(x, y)).abs();
        replace(&mut w, 6, smoothstep(0.88, 0.97, ridge));
        let l = &self.lava;
        let lava = l[0].at(xx, yy) + 0.38 * l[1].at(x, y) + 0.12 * l[2].at(x, y) + 0.035 * l[3].at(x, y);
        replace(&mut w, 4, smoothstep(0.12, 0.54, -lava));
        (w, fold)
    }

    fn scores(&self, x: f64, y: f64, w: &[f64; 8]) -> [f64; 8] {
        std::array::from_fn(|k| (w[k] + 0.03).ln() + self.log_prior[k] + 0.35 * self.rock[k].at(x, y))
    }

    pub fn rock(&self, x: f64, y: f64) -> Rock {
        let (w, fold) = self.structure(x, y);
        let class = argmax(&self.scores(x, y, &w), &self.bias_at(x, y));
        let v = &self.variation;
        let variation = (0.5 + 0.25 * v[0].at(x, y) + 0.14 * v[1].at(x, y) + 0.07 * v[2].at(x, y)).clamp(0.0, 1.0);
        // The realised class dominates; the structural mix keeps contacts gradual.
        let mix = |table: &[f32; 8]| {
            0.7 * table[class] as f64 + 0.3 * (0..8).map(|k| w[k] * table[k] as f64).sum::<f64>()
        };
        let h = 10.0;
        let (gx, gy) = (self.fold_at(x + h, y) - fold, self.fold_at(x, y + h) - fold);
        Rock {
            class: class as u8,
            weights: w.map(|v| v as f32),
            hardness: (mix(&HARDNESS) * (0.94 + 0.12 * variation)) as f32,
            weatherability: (mix(&WEATHERABILITY) * (0.90 + 0.20 * variation)) as f32,
            azimuth: (-gy).atan2(-gx).to_degrees().rem_euclid(180.0) as f32,
        }
    }
}

fn argmax(scores: &[f64; 8], bias: &[f64; 8]) -> usize {
    let mut best = 0;
    for k in 1..8 {
        if scores[k] + bias[k] > scores[best] + bias[best] {
            best = k;
        }
    }
    best
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::resources::prior::{RegionInput, RegionPrior};

    /// Every parent domain realises the prior shares (dense check, finer than the
    /// calibration grid), so a map does too up to its partial domains.
    #[test]
    fn parent_domains_follow_the_prior() {
        let prior = RegionPrior::synthesize(&RegionInput { seed: "7".into(), ..Default::default() });
        let g = Geology::new(super::super::keys::seed_of("7"), &prior, [0.0, 0.0, 30000.0, 30000.0]);
        let p = cell_size(PARENT_LOD);
        let (n, step) = (200usize, 30000.0 / 200.0);
        let (mut map, mut domain) = ([0f64; 8], std::collections::HashMap::<(i64, i64), [f64; 9]>::new());
        // The map window, then the whole parent cell (0, 0) and its warp margin.
        for (x0, side, m) in [(0.0, 30000.0, true), (-WARP_MAX, p + 2.0 * WARP_MAX, false)] {
            let n = if m { n } else { 240 };
            let step = if m { step } else { side / n as f64 };
            for s in 0..n * n {
                let (x, y) = (x0 + ((s % n) as f64 + 0.5) * step, x0 + ((s / n) as f64 + 0.5) * step);
                let c = g.rock(x, y).class as usize;
                if m {
                    map[c] += 1.0 / (n * n) as f64;
                } else {
                    let e = domain.entry(g.parent(x, y)).or_default();
                    e[c] += 1.0;
                    e[8] += 1.0;
                }
            }
        }
        let d = domain[&(0, 0)];
        for k in 0..8 {
            let share = d[k] / d[8];
            assert!((share - prior.rock_shares[k] as f64).abs() < 0.015, "{} domain {share:.3} prior {:.3}", ROCKS[k], prior.rock_shares[k]);
        }
        assert!((map[0] - prior.rock_shares[0] as f64).abs() < 0.02, "granite map {:.3} prior {:.3}", map[0], prior.rock_shares[0]);
    }
    use crate::resources::ROCKS;
}
