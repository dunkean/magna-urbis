//! Finite coarse → base → decoder chain for one square map.
//!
//! Profile 4/1/1: coarse4 distilled solver (four evaluations of the original
//! coarse UNet), original base in one evaluation, distilled decoder student.
//! Noise, window geometry, blending and reconstruction follow Terrain Diffusion.
use crate::edm::{Edm, EdmConfig, up};
use crate::gpu::{Gpu, f16, read};
use crate::noise::NoiseTiles;
use crate::plan::{
    BASE_SIZE, BASE_STRIDE, COARSE_SIZE, COARSE_STRIDE, DECODER_SIZE, DECODER_STRIDE, LATENT, Plan,
};
use crate::reconstruct::{Grid, elevation, resample};
use crate::sketch::Sketch;
use crate::student::Student;
use crate::weights::Bundle;
use burn::tensor::Tensor;
use half::bf16;

/// Coarse statistics of the pinned `terrain-diffusion-30m` pipeline configuration.
const COARSE_MEANS: [f32; 6] = [-37.70001, 1.140307, 18.10249, 332.8343, 1332.208, 52.66009];
const COARSE_STDS: [f32; 6] = [39.742, 1.768184, 8.921469, 321.766, 842.9294, 31.07999];
const COND_MEANS: [f32; 7] = [14.99, 11.65, 15.87, 619.26, 833.12, 69.40, 0.66];
const COND_STDS: [f32; 7] = [21.72, 21.78, 10.40, 452.29, 738.09, 34.59, 0.47];
const SIGMA_DATA: f32 = 0.5;

fn round(v: f32) -> f32 {
    bf16::from_f32(v).to_f32()
}

/// Upstream `linear_weight_window`.
fn weight_window(size: usize) -> Vec<f32> {
    let mid = (size as f32 - 1.0) / 2.0;
    let axis: Vec<f32> = (0..size)
        .map(|i| 1.0 - (1.0 - 1e-3) * ((i as f32 - mid).abs() / mid).clamp(0.0, 1.0))
        .collect();
    let mut w = Vec::with_capacity(size * size);
    for y in &axis {
        for x in &axis {
            w.push(y * x);
        }
    }
    w
}

/// Accumulates weighted windows of `channels` values plus a weight channel.
struct Field {
    channels: usize,
    start: i64,
    n: usize,
    v: Vec<f32>,
}

impl Field {
    fn new(channels: usize, start: i64, n: usize) -> Self {
        Self {
            channels,
            start,
            n,
            v: vec![0.0; (channels + 1) * n * n],
        }
    }

    /// Adds a `(channels, size, size)` window at `(y0, x0)`, clipped to the field.
    fn add(&mut self, window: &[f32], y0: i64, x0: i64, size: usize, weight: &[f32]) {
        let plane = self.n * self.n;
        for wy in 0..size {
            let y = y0 + wy as i64 - self.start;
            if y < 0 || y >= self.n as i64 {
                continue;
            }
            for wx in 0..size {
                let x = x0 + wx as i64 - self.start;
                if x < 0 || x >= self.n as i64 {
                    continue;
                }
                let at = y as usize * self.n + x as usize;
                let w = weight[wy * size + wx];
                for c in 0..self.channels {
                    self.v[c * plane + at] += window[(c * size + wy) * size + wx] * w;
                }
                self.v[self.channels * plane + at] += w;
            }
        }
    }

    /// Normalized channel `c` over `[y0, y0+size) × [x0, x0+size)`.
    /// Rewrites one cell's normalized values in place, keeping its weight.
    fn update(&mut self, y: usize, x: usize, f: impl FnOnce(&mut [f32])) {
        let plane = self.n * self.n;
        let at = y * self.n + x;
        let w = self.v[self.channels * plane + at].max(1e-12);
        let mut values: Vec<f32> = (0..self.channels)
            .map(|c| self.v[c * plane + at] / w)
            .collect();
        f(&mut values);
        for (c, value) in values.into_iter().enumerate() {
            self.v[c * plane + at] = value * w;
        }
    }

    fn normalized(&self, c: usize, y0: i64, x0: i64, size: usize) -> Vec<f32> {
        let plane = self.n * self.n;
        let mut out = Vec::with_capacity(size * size);
        for y in 0..size {
            for x in 0..size {
                let at = (y0 - self.start + y as i64) as usize * self.n
                    + (x0 - self.start + x as i64) as usize;
                out.push(self.v[c * plane + at] / self.v[self.channels * plane + at].max(1e-12));
            }
        }
        out
    }
}

pub struct Networks {
    gpu: Gpu,
    coarse: Edm,
    base: Edm,
    decoder: Student,
}

/// Network properties exposed by the neural bench. Defaults reproduce the
/// production chain (coarse4, original base in one pass, decoder student).
#[derive(Clone, Debug, PartialEq)]
pub struct Tuning {
    /// Noise/signal ratios of the four climate conditioning channels.
    pub climate_noise: [f32; 4],
    /// Coarse solver steps; the coarse4 weights are distilled for four.
    pub coarse_steps: usize,
    /// Multiplies the coarse local relief (mean − 5th percentile, metres) given to base.
    pub relief_scale: f32,
    /// Imposes that local relief in metres instead of the coarse network's.
    pub relief_fixed: Option<f32>,
    /// Pre-softmax "beauty" histogram of the base conditioning.
    pub histogram: [f32; 5],
    /// Multiplies the decoder residual (fine detail) before reconstruction.
    pub residual_scale: f32,
}

impl Default for Tuning {
    fn default() -> Self {
        Self {
            climate_noise: [0.5; 4],
            coarse_steps: 4,
            relief_scale: 1.0,
            relief_fixed: None,
            histogram: [0.0; 5],
            residual_scale: 1.0,
        }
    }
}

#[derive(Clone, Debug)]
pub struct Request {
    pub seed: u64,
    pub sketch: Sketch,
    /// Noise/signal ratio of the height conditioning; smaller follows the sketch more closely.
    pub height_noise: f32,
    pub extent_m: f64,
    pub resolution: usize,
    pub exact: bool,
    pub origin: Option<i64>,
    pub base_batch: usize,
    pub decoder_batch: usize,
    pub keep_stages: bool,
    pub tuning: Tuning,
}

impl Request {
    /// A 40 km map from the bench settings (relief family, coasts, climate).
    #[allow(clippy::too_many_arguments)]
    pub fn regional(
        seed: &str,
        relief: &str,
        mix: f64,
        coast_mask: u8,
        islands: &str,
        climate: &str,
        height_noise: f32,
    ) -> Result<Self, String> {
        let world = crate::world_seed(seed);
        let sketch = crate::Regional::new(
            world,
            crate::Family::parse(relief)?,
            mix,
            coast_mask,
            islands,
            crate::Climate::parse(climate)?,
            40000.0,
        )?;
        if !height_noise.is_finite() || !(0.001..=2.0).contains(&height_noise) {
            return Err("Fidélité à l’esquisse invalide.".into());
        }
        let mut request = Self::new(world, Sketch::Regional(Box::new(sketch)));
        request.height_noise = height_noise;
        Ok(request)
    }

    pub fn new(seed: u64, sketch: Sketch) -> Self {
        Self {
            seed,
            sketch,
            height_noise: 0.05,
            extent_m: 40000.0,
            resolution: 1024,
            exact: false,
            origin: None,
            base_batch: 16,
            decoder_batch: 2,
            keep_stages: false,
            tuning: Tuning::default(),
        }
    }
}

#[derive(Default, Clone, Debug)]
pub struct Timings {
    pub coarse_ms: f64,
    pub base_ms: f64,
    pub decoder_ms: f64,
    pub reconstruction_ms: f64,
}

/// Normalized intermediate fields, for reference comparisons.
pub struct Stages {
    pub coarse: Vec<f32>,
    pub latent: Vec<f32>,
    pub residual: Vec<f32>,
}

/// Means over the delivered map of the sketch and of the coarse field, in metres.
#[derive(Default, Clone, Debug)]
pub struct CoarseStats {
    pub sketch_m: f64,
    pub elevation_m: f64,
    /// Local relief (mean − 5th percentile) produced by the coarse network.
    pub relief_m: f64,
    /// Local relief given to base, after the tuning override.
    pub relief_used_m: f64,
    pub cells: usize,
}

pub struct Output {
    pub stages: Option<Stages>,
    pub coarse: CoarseStats,
    pub native: Vec<f32>,
    pub native_n: usize,
    pub heights: Vec<f32>,
    pub resolution: usize,
    pub evaluations: (usize, usize, usize),
    pub timings: Timings,
}

pub trait Clock {
    fn now_ms(&self) -> f64;
}

impl Networks {
    pub fn load(
        gpu: Gpu,
        coarse: &Bundle,
        base: &Bundle,
        decoder: &Bundle,
    ) -> Result<Self, String> {
        Ok(Self {
            coarse: Edm::load(&gpu, coarse, &EdmConfig::coarse())?,
            base: Edm::load(&gpu, base, &EdmConfig::base())?,
            decoder: Student::load(&gpu, decoder, 4, &[1, 2, 4])?,
            gpu,
        })
    }

    pub async fn generate(&self, request: &Request, clock: &dyn Clock) -> Result<Output, String> {
        let size = Plan::cells(request.extent_m);
        let origin = request.origin.unwrap_or(if request.exact {
            0
        } else {
            crate::plan::FAST_ORIGIN
        });
        let plan = Plan::new(origin, size, request.exact);
        let mut timings = Timings::default();

        let started = clock.now_ms();
        let mut coarse = self.coarse_stage(request, &plan).await?;
        let coarse_stats = Self::tune_relief(request, &plan, size, &mut coarse);
        timings.coarse_ms = clock.now_ms() - started;

        let started = clock.now_ms();
        let latents = self.base_stage(request, &plan, &coarse).await?;
        timings.base_ms = clock.now_ms() - started;

        let started = clock.now_ms();
        let residual = self.decoder_stage(request, &plan, &latents).await?;
        timings.decoder_ms = clock.now_ms() - started;

        let started = clock.now_ms();
        let r = &plan.residual;
        let scale = request.tuning.residual_scale;
        let residual = Grid {
            n: r.len(),
            v: residual
                .normalized(0, r.start, r.start, r.len())
                .into_iter()
                .map(|v| v * scale)
                .collect(),
        };
        let low = r.start / LATENT;
        let lowfreq = Grid {
            n: r.len() / LATENT as usize,
            v: latents.normalized(4, low, low, r.len() / LATENT as usize),
        };
        let native = elevation(&residual, &lowfreq, (origin - r.start) as usize, size);
        if !native.iter().all(|h| h.is_finite()) {
            return Err("Relief neuronal non fini.".into());
        }
        let heights = resample(
            &native,
            size,
            crate::plan::NATIVE_M,
            request.extent_m,
            request.resolution,
        );
        timings.reconstruction_ms = clock.now_ms() - started;
        let stages = request.keep_stages.then(|| {
            let all = |f: &Field| -> Vec<f32> {
                (0..f.channels)
                    .flat_map(|c| f.normalized(c, f.start, f.start, f.n))
                    .collect()
            };
            Stages {
                coarse: all(&coarse),
                latent: all(&latents),
                residual: residual.v.clone(),
            }
        });
        Ok(Output {
            stages,
            coarse: coarse_stats,
            native,
            native_n: size,
            heights,
            resolution: request.resolution,
            evaluations: plan.evaluations(request.tuning.coarse_steps),
            timings,
        })
    }

    /// Applies the local relief override to coarse cells and measures the map's cells.
    fn tune_relief(request: &Request, plan: &Plan, size: usize, coarse: &mut Field) -> CoarseStats {
        let extent = size as f64 * crate::plan::NATIVE_M;
        let tuning = &request.tuning;
        let square = |s: f32| s.signum() * s * s;
        let root = |h: f32| h.signum() * h.abs().sqrt();
        let mut stats = CoarseStats::default();
        for y in 0..coarse.n {
            let cy = plan.coarse_center_m(coarse.start + y as i64);
            for x in 0..coarse.n {
                let cx = plan.coarse_center_m(coarse.start + x as i64);
                let mut cell = (0.0f32, 0.0f32, 0.0f32);
                coarse.update(y, x, |v| {
                    let mean = square(v[0]);
                    let relief = mean - square(v[1]);
                    let baseline = tuning.relief_fixed.unwrap_or(relief * tuning.relief_scale);
                    let used = request
                        .sketch
                        .relief_mask_at(cx, cy)
                        .map_or(baseline, |(weight, target)| {
                            baseline * (1.0 - weight) + target * weight
                        });
                    if used != relief {
                        v[1] = root(mean - used);
                    }
                    cell = (mean, relief, used);
                });
                if (0.0..extent).contains(&cy) && (0.0..extent).contains(&cx) {
                    stats.sketch_m += request.sketch.elevation(cx, cy);
                    stats.elevation_m += cell.0 as f64;
                    stats.relief_m += cell.1 as f64;
                    stats.relief_used_m += cell.2 as f64;
                    stats.cells += 1;
                }
            }
        }
        let n = stats.cells.max(1) as f64;
        stats.sketch_m /= n;
        stats.elevation_m /= n;
        stats.relief_m /= n;
        stats.relief_used_m /= n;
        stats
    }

    async fn coarse_stage(&self, request: &Request, plan: &Plan) -> Result<Field, String> {
        let tiles: Vec<(i64, i64)> = plan
            .coarse
            .tiles()
            .flat_map(|i| plan.coarse.tiles().map(move |j| (i, j)))
            .collect();
        let n = tiles.len();
        let s = COARSE_SIZE as usize;
        let plane = s * s;
        // Conditioning mixture: t = atan(noise/signal), in production BF16.
        let mut ratios = [0.5f32; 5];
        ratios[0] = request.height_noise;
        ratios[1..].copy_from_slice(&request.tuning.climate_noise);
        let steps = request.tuning.coarse_steps.clamp(1, 32);
        let t: Vec<f32> = ratios.iter().map(|r| round(r.atan())).collect();
        let labels: Vec<f32> = t
            .iter()
            .map(|t| round(round(round(t.tan()) / 8.0).ln()))
            .collect();
        let (cos, sin): (Vec<f32>, Vec<f32>) =
            t.iter().map(|t| (round(t.cos()), round(t.sin()))).unzip();
        let mut noise_tiles = NoiseTiles::default();
        let mut condition = Vec::with_capacity(n * 5 * plane);
        let mut sample = Vec::with_capacity(n * 6 * plane);
        for &(i, j) in &tiles {
            let (y0, x0) = (i * COARSE_STRIDE, j * COARSE_STRIDE);
            let fields = request.sketch.fields(plan, y0, x0, s);
            let noise = noise_tiles.patch(request.seed, y0, x0, s, s, 5, s, s);
            for c in 0..5 {
                let k = [0, 2, 3, 4, 5][c];
                for p in 0..plane {
                    let value = (fields[c * plane + p] - COARSE_MEANS[k]) / COARSE_STDS[k];
                    condition.push(cos[c] * value + sin[c] * noise[c * plane + p]);
                }
            }
            sample.extend(noise_tiles.patch(request.seed.wrapping_add(1), y0, x0, s, s, 6, s, s));
        }
        // Karras schedule of the four-step solver, then DPM-Solver++ (2M, midpoint).
        let rho = 7.0f64;
        let (lo, hi) = (0.002f64.powf(1.0 / rho), 80f64.powf(1.0 / rho));
        let mut sigmas: Vec<f64> = (0..steps)
            .map(|k| (hi + k as f64 / (steps - 1).max(1) as f64 * (lo - hi)).powf(rho))
            .collect();
        sigmas.push(0.0);
        let condition = self.gpu.image(condition, [n, 5, s, s]);
        let mut x = self
            .gpu
            .image(sample, [n, 6, s, s])
            .mul_scalar(sigmas[0] as f32);
        let mut previous: Option<Tensor<4>> = None;
        let label_rows: Vec<Vec<f32>> = labels.iter().map(|&l| vec![l; n]).collect();
        for step in 0..steps {
            let sigma = sigmas[step];
            let scale = 1.0 / (sigma * sigma + 0.25).sqrt();
            let input = Tensor::cat(
                vec![x.clone().mul_scalar(scale as f32), condition.clone()],
                1,
            );
            let label = round((sigma / 0.5).atan() as f32);
            let emb = self.coarse.embedding(&vec![label; n], &label_rows, None);
            let out = self.coarse.forward(input, &emb);
            let c_skip = 0.25 / (sigma * sigma + 0.25);
            let c_out = sigma * 0.5 / (sigma * sigma + 0.25).sqrt();
            let x0 = x
                .clone()
                .mul_scalar(c_skip as f32)
                .add(out.mul_scalar(c_out as f32));
            let next = sigmas[step + 1];
            x = if step == steps - 1 || next == 0.0 {
                x0.clone()
            } else if let Some(m1) = previous.take().filter(|_| step > 0) {
                let h = (sigma / next).ln();
                let h0 = (sigmas[step - 1] / sigma).ln();
                let r0 = h0 / h;
                let e = (-h).exp() - 1.0;
                let d1 = x0.clone().sub(m1).mul_scalar((1.0 / r0) as f32);
                x.mul_scalar((next / sigma) as f32)
                    .sub(x0.clone().mul_scalar(e as f32))
                    .sub(d1.mul_scalar((0.5 * e) as f32))
            } else {
                x.mul_scalar((next / sigma) as f32)
                    .add(x0.clone().mul_scalar((1.0 - next / sigma) as f32))
            };
            previous = Some(x0);
        }
        let values = read(x.mul_scalar(1.0 / SIGMA_DATA)).await?;
        let mut field = Field::new(6, plan.coarse_cells.start, plan.coarse_cells.len());
        let weight = weight_window(s);
        let ratio = COARSE_STDS[1] / COARSE_STDS[0];
        for (t, &(i, j)) in tiles.iter().enumerate() {
            let v = &values[t * 6 * plane..(t + 1) * 6 * plane];
            let mut physical = vec![0.0f32; 6 * plane];
            for p in 0..plane {
                let n0 = v[p];
                let n1 = n0 - v[plane + p] * ratio;
                physical[p] = n0 * COARSE_STDS[0] + COARSE_MEANS[0];
                physical[plane + p] = n1 * COARSE_STDS[0] + (COARSE_MEANS[0] - COARSE_MEANS[1]);
                for c in 2..6 {
                    physical[c * plane + p] = v[c * plane + p] * COARSE_STDS[c] + COARSE_MEANS[c];
                }
            }
            field.add(&physical, i * COARSE_STRIDE, j * COARSE_STRIDE, s, &weight);
        }
        Ok(field)
    }

    /// 58-value conditioning vector of one base window from its 4×4 coarse support.
    fn base_condition(coarse: &Field, i: i64, j: i64, histogram: &[f32; 5]) -> Vec<f32> {
        let mut channels: Vec<Vec<f32>> = (0..6)
            .map(|c| coarse.normalized(c, i - 1, j - 1, 4))
            .collect();
        channels.push(vec![1.0; 16]);
        for (c, values) in channels.iter_mut().enumerate() {
            values
                .iter_mut()
                .for_each(|v| *v = (*v - COND_MEANS[c]) / COND_STDS[c]);
        }
        let climate: Vec<f32> = (2..6)
            .map(|c| [5, 6, 9, 10].iter().map(|&k| channels[c][k]).sum::<f32>() / 4.0)
            .collect();
        let parts: [(Vec<f32>, usize); 6] = [
            (channels[0].clone(), 16),
            (channels[1].clone(), 16),
            (climate, 4),
            (channels[6].clone(), 16),
            (histogram.to_vec(), 5),
            (vec![-0.5 * 12f32.sqrt()], 1),
        ];
        // mp_concat with equal weights 1/6.
        let total: usize = parts.iter().map(|p| p.1).sum();
        let scale = (total as f32 / (6.0 / 36.0)).sqrt();
        parts
            .iter()
            .flat_map(|(v, n)| {
                let k = scale / (*n as f32).sqrt() / 6.0;
                v.iter().map(move |x| round(x * k))
            })
            .collect()
    }

    async fn base_stage(
        &self,
        request: &Request,
        plan: &Plan,
        coarse: &Field,
    ) -> Result<Field, String> {
        let tiles: Vec<(i64, i64)> = plan
            .base
            .tiles()
            .flat_map(|i| plan.base.tiles().map(move |j| (i, j)))
            .collect();
        let s = BASE_SIZE as usize;
        let plane = s * s;
        let t = round((80.0f32 / SIGMA_DATA).atan());
        let (cos, sin) = (round(t.cos()), round(t.sin()));
        let weight = weight_window(s);
        let mut field = Field::new(5, plan.latent.start, plan.latent.len());
        let mut noise_tiles = NoiseTiles::default();
        for batch in tiles.chunks(request.base_batch.max(1)) {
            let n = batch.len();
            let mut noise = Vec::with_capacity(n * 5 * plane);
            let mut conditions = Vec::with_capacity(n * 58);
            for &(i, j) in batch {
                noise.extend(noise_tiles.patch(
                    request.seed.wrapping_add(5819),
                    i * BASE_STRIDE,
                    j * BASE_STRIDE,
                    s,
                    s,
                    5,
                    s,
                    s,
                ));
                conditions.extend(Self::base_condition(
                    coarse,
                    i,
                    j,
                    &request.tuning.histogram,
                ));
            }
            let noise_gpu = self.gpu.image(noise.clone(), [n, 5, s, s]);
            let emb = self
                .base
                .embedding(&vec![t; n], &[], Some((&conditions, 58)));
            let out = self.base.forward(noise_gpu.clone().mul_scalar(sin), &emb);
            let sample = noise_gpu.mul_scalar(cos * sin).add(out.mul_scalar(sin));
            let values = read(sample).await?;
            for (k, &(i, j)) in batch.iter().enumerate() {
                field.add(
                    &values[k * 5 * plane..(k + 1) * 5 * plane],
                    i * BASE_STRIDE,
                    j * BASE_STRIDE,
                    s,
                    &weight,
                );
            }
        }
        Ok(field)
    }

    async fn decoder_stage(
        &self,
        request: &Request,
        plan: &Plan,
        latents: &Field,
    ) -> Result<Field, String> {
        let tiles: Vec<(i64, i64)> = plan
            .decoder
            .tiles()
            .flat_map(|i| plan.decoder.tiles().map(move |j| (i, j)))
            .collect();
        let s = DECODER_SIZE as usize;
        let l = s / LATENT as usize;
        let weight = weight_window(s);
        let mut field = Field::new(1, plan.residual.start, plan.residual.len());
        let mut noise_tiles = NoiseTiles::default();
        for batch in tiles.chunks(request.decoder_batch.max(1)) {
            let n = batch.len();
            let mut noise = Vec::with_capacity(n * s * s);
            let mut latent = Vec::with_capacity(n * 4 * l * l);
            for &(i, j) in batch {
                let (y, x) = (i * DECODER_STRIDE, j * DECODER_STRIDE);
                noise.extend(noise_tiles.patch(
                    request.seed.wrapping_add(5819),
                    y,
                    x,
                    s,
                    s,
                    1,
                    s,
                    s,
                ));
                for c in 0..4 {
                    latent.extend(latents.normalized(c, y / LATENT, x / LATENT, l));
                }
            }
            let input = Tensor::cat(
                vec![
                    f16(self.gpu.image(noise, [n, 1, s, s])),
                    f16(up(self.gpu.image(latent, [n, 4, l, l]), LATENT as usize)),
                    Tensor::<4>::zeros([n, 11, s, s], self.gpu.f16_options()),
                ],
                1,
            );
            let values = read(self.decoder.forward(input)).await?;
            for (k, &(i, j)) in batch.iter().enumerate() {
                field.add(
                    &values[k * s * s..(k + 1) * s * s],
                    i * DECODER_STRIDE,
                    j * DECODER_STRIDE,
                    s,
                    &weight,
                );
            }
        }
        Ok(field)
    }
}
