//! Detailed coasts, broad mainland sectors, branched islands and offshore rocks.
//! Signed distance is positive inland; GPU and CPU share this FP32 coast plan.
use crate::{Noise, Rng, smooth};
use std::f64::consts::TAU;

/// Header floats: profile (slot 0: direction mask or TRACED), natural slopes and shore cut
/// (slots 6, 8, 9), character, bumps, then the relief fit
/// (slots 56..61: shift, median, inverse spread, drowning, band, shelf), sea count (62)
/// and field size (63). After the 64-float header: 8 floats per sea capsule, then the
/// optional row-major n*n sea field padded to 4 floats, then 12 floats per land capsule.
const HEADER: usize = 64;
const BUMPS: usize = 32;
const MAX_BUMPS: usize = 6;
/// Relief fit slots, mirrored by `terrainCoast.wgsl` (vec4 14 and 15).
const SHIFT: usize = 56;
const RELIEF_MEDIAN: usize = 57;
const RELIEF_INVERSE: usize = 58;
const DROWNING: usize = 59;
const DROWNING_BAND: usize = 60;
const SHELF: usize = 61;
/// Sea capsules (8 floats each) follow the header, before the field and land capsules.
const SEA_COUNT: usize = 62;
const FIELD_N: usize = 63;
/// Natural shore slopes: mean rise per metre inland (vec4 1.z), tallest cliff in metres and
/// amplitude of the shore cut in map widths (vec4 2.xy).
const SLOPE: usize = 6;
const CLIFF: usize = 8;
const CUT: usize = 9;
/// The shore cut acts within this distance of the shoreline, at this first wavelength (map widths).
const CUT_REACH: f64 = 0.03;
const CUT_WAVE: f64 = 0.012;
/// Largest factor of `CUT`, on the steepest stretches.
const CUT_STEEP: f64 = 1.15;
const SEA_STRIDE: usize = 8;
/// Active mainland marker, outside the eight direction bits and distinct from islands.
const TRACED: f32 = 256.0;
/// Upper bound of |simplex noise|, hence of any fractal sum of it: three corners of
/// at most 75 * max((0.5 - r²)⁴ r) = 75 * 0.0092 each.
const NOISE_BOUND: f64 = 2.1;

/// Width of the shoreline transition; never moves the coastline. A narrower width also allows
/// steeper natural slopes behind the shore.
#[derive(Clone, Copy, Debug, serde::Deserialize, serde::Serialize)]
#[serde(default, deny_unknown_fields)]
pub struct CoastProfile {
    pub width: f64,
    pub variability: f64,
}
impl Default for CoastProfile {
    fn default() -> Self { Self { width: 250.0, variability: 0.5 } }
}
impl CoastProfile {
    pub fn validate(self) -> Result<Self, String> {
        if !self.width.is_finite() || !(0.0..=10000.0).contains(&self.width)
            || !self.variability.is_finite() || !(0.0..=1.0).contains(&self.variability) {
            return Err("Invalid coastal smoothing".into());
        }
        Ok(self)
    }
}

pub(crate) struct Coast {
    profile: CoastProfile,
    rng: Rng,
    /// Map width, in metres.
    width: f64,
    pub noise: Noise,
    pub parameters: Vec<f32>,
    /// Plan length before the offshore islets, which are placed again once fitted.
    islets_from: usize,
    archipelago: bool,
}

impl Coast {
    pub fn new(rng: Rng, width: f64, motif: f64, amp: f64, marine_datum: f64) -> Self {
        Self {
            profile: CoastProfile::default(),
            noise: Noise::new(rng.fork("shore-noise")),
            rng,
            width,
            parameters: vec![
                0.0,
                0.0,
                (motif * 0.070).clamp(35.0, 450.0).min(width * 0.060) as f32 / width as f32,
                // The sea floor of a small map stays at the scale of that map.
                (amp * 0.25).clamp(12.0, 250.0).min(width * 0.02).max(6.0) as f32,
                0.0,
                0.0,
                0.0,
                marine_datum as f32,
            ],
            islets_from: 0,
            archipelago: false,
        }
    }

    pub fn configure(&mut self, mask: u32, mode: &str) -> Result<(), String> {
        let traced = mode.starts_with("traced:");
        if mask > 255 && !traced {
            return Err("Les côtes doivent être un masque de huit directions (0 à 255).".into());
        }
        if !traced && !matches!(mode, "island" | "archipelago" | "random" | "peninsula") {
            return Err("Choisissez île, archipel, presqu’île ou aléatoire.".into());
        }
        self.parameters.truncate(8);
        self.parameters.resize(HEADER, 0.0);
        self.parameters[0] = mask as f32;
        self.parameters[1] = 0.0;
        // GPU vec4 1.xy, mirrored by terrainCoast.wgsl.
        self.parameters[4] = self.profile.width as f32;
        self.parameters[5] = self.profile.variability as f32;
        // Seeded coast character: a broad warp and noise amplitudes from smooth sandy
        // bights to ragged rocky shores.
        let mut character = self.rng.fork("coast-character");
        let rugged = character.float();
        let header = [
            character.range(0.03, 0.14),
            character.range(0.25, 0.55),
            0.035 + 0.085 * rugged * character.range(0.6, 1.0),
            character.range(0.16, 0.36),
            0.008 + 0.026 * rugged * character.range(0.5, 1.0),
            character.range(0.035, 0.075),
        ];
        for (i, value) in header.into_iter().enumerate() {
            self.parameters[24 + i] = value as f32;
        }
        // How far the sea follows the relief: from smooth, almost geometric shores to
        // drowned coasts whose valleys become rias and whose ridges stand as headlands.
        // The drowning stays below 0.6 band, so the coast distance stays monotonic.
        let mut drowned = self.rng.fork("coast-drowning");
        let band = drowned.range(0.10, 0.20);
        self.parameters[DROWNING] = (drowned.range(0.035, 0.17)).min(band * 0.6) as f32;
        self.parameters[DROWNING_BAND] = band as f32;
        self.parameters[SHELF] = drowned.range(0.55, 2.1) as f32;
        // Natural slopes behind the shore; cliffs are a local style some coasts never draw.
        let mut slopes = self.rng.fork("coast-slopes");
        self.parameters[SLOPE] = slopes.range(0.22, 0.42) as f32;
        self.parameters[CLIFF] = ((slopes.float() - 0.3).max(0.0) * 64.0) as f32;
        self.parameters[CUT] = slopes.range(0.0015, 0.0045) as f32;
        self.islets_from = HEADER;
        self.archipelago = false;
        if mask == 0 {
            return Ok(());
        }
        if traced {
            self.parameters[0] = 0.0;
            let field = traced_field(mode)?;
            if (1..=254).contains(&mask) {
                self.edge_seas(mask);
                self.parameters[0] = mask as f32;
            }
            if let Some((n, field)) = field {
                self.parameters[0] = TRACED;
                self.parameters[FIELD_N] = n as f32;
                self.parameters.extend(field);
                self.parameters.resize(self.land_start(), 0.0);
            }
            if !self.active() {
                return Ok(());
            }
            // The same softening as the other mainland layouts.
            self.parameters[24] *= 0.5;
            self.parameters[26] *= 0.6;
            let mut rng = self.rng.fork("shape-v2");
            self.shore_features(&mut rng, false);
            self.islets_from = self.parameters.len();
            self.place_islets(&|_, _| 0.0);
            return Ok(());
        }
        if mask != 255 {
            // Edge seas are coves and corner seas: a softer warp and large-scale noise keep them whole.
            self.parameters[24] *= 0.5;
            self.parameters[26] *= 0.6;
            self.edge_seas(mask);
        }
        let mut rng = self.rng.fork("shape-v2");
        let peninsula = mode == "peninsula";
        let archipelago = !peninsula
            && (mode == "archipelago" || (mode == "random" && self.rng.fork("mode").float() < 0.5));
        let mut narrow = false;
        if mask == 255 && peninsula {
            narrow = self.peninsula(&mut rng);
        } else if mask == 255 {
            let count = if archipelago {
                3 + (rng.float() * 5.0) as usize
            } else {
                1
            };
            let mut centers: Vec<(f64, f64)> = Vec::new();
            if archipelago {
                let separation = 0.20 + (7 - count) as f64 * 0.025;
                for _ in 0..512 {
                    let candidate = (rng.range(0.18, 0.82), rng.range(0.18, 0.82));
                    if centers
                        .iter()
                        .all(|&(x, y)| (candidate.0 - x).hypot(candidate.1 - y) >= separation)
                    {
                        centers.push(candidate);
                    }
                    if centers.len() == count {
                        break;
                    }
                }
                if centers.len() != count {
                    let turn = rng.range(0.0, TAU);
                    centers = (0..count)
                        .map(|i| {
                            let a = turn + i as f64 * TAU / count as f64;
                            (0.5 + 0.27 * a.cos(), 0.5 + 0.27 * a.sin())
                        })
                        .collect();
                }
            } else {
                centers.push((rng.range(0.44, 0.56), rng.range(0.44, 0.56)));
            }
            for (i, &(cx, cy)) in centers.iter().enumerate() {
                let radius = if archipelago {
                    let spacing = centers
                        .iter()
                        .enumerate()
                        .filter(|&(j, _)| j != i)
                        .map(|(_, &(x, y))| (cx - x).hypot(cy - y))
                        .fold(1.0_f64, f64::min);
                    (spacing * 0.44)
                        .min(0.17)
                        .min(cx.min(cy).min(1.0 - cx).min(1.0 - cy) * 0.85)
                } else {
                    rng.range(0.30, 0.40)
                };
                let arms = if archipelago {
                    1
                } else {
                    1 + (rng.float() * 2.5) as usize
                };
                self.body(&mut rng, cx, cy, radius, arms);
            }
        }
        // Bays could sever a narrow land; islands only take small coves and points.
        let lone_cove = mask.count_ones() == 1 && mask.trailing_zeros() % 2 == 0;
        if !archipelago && !narrow && !lone_cove {
            self.shore_features(&mut rng, false);
        }
        self.islets_from = self.parameters.len();
        self.archipelago = archipelago;
        self.place_islets(&|_, _| 0.0);
        Ok(())
    }

    /// Fit the plan to the bare relief, sampled cell-centred on an `n`² grid over the
    /// map: the relief median and spread drive the drowning, and the sea share of the
    /// selected edges is calibrated on the actual relief (seeded per direction), so a
    /// single edge never floods half of the map. Offshore islets are placed again.
    pub fn fit(&mut self, heights: &[f32], n: usize) -> Result<(), String> {
        if !self.active() {
            return Ok(());
        }
        if n < 2 || heights.len() != n * n || heights.iter().any(|h| !h.is_finite()) {
            return Err("Invalid coast relief samples".into());
        }
        let relief: Vec<f64> = heights.iter().map(|&h| self.marine_relief(h as f64)).collect();
        let mut land: Vec<f64> = relief.iter().copied().filter(|&h| h > 0.0).collect();
        if land.len() < relief.len() / 10 {
            land = relief.clone();
        }
        land.sort_by(f64::total_cmp);
        let quantile = |q: f64| land[((land.len() - 1) as f64 * q).round() as usize];
        let spread = quantile(0.85) - quantile(0.15);
        self.parameters[RELIEF_MEDIAN] = quantile(0.5) as f32;
        self.parameters[RELIEF_INVERSE] = if spread > 1e-6 { (1.0 / spread) as f32 } else { 0.0 };
        self.parameters[SHIFT] = 0.0;
        self.parameters.truncate(self.islets_from);
        self.parameters[1] = ((self.islets_from - self.land_start()) / 12) as f32;
        let mask = self.parameters[0] as u32;
        if mask != 255 {
            // The seeded plan sets the intended sea share; the relief only redistributes
            // it. Traces retain their planned share without the direction-mask limits.
            // A lone cardinal cove stays small; corners and runs follow their plan.
            let lone_cove = !self.traced() && mask.count_ones() == 1 && mask.trailing_zeros() % 2 == 0;
            let cell = 1.0 / n as f64;
            let geometry: Vec<f64> = (0..n * n)
                .map(|i| self.geometry((i % n) as f64 * cell + cell * 0.5, (i / n) as f64 * cell + cell * 0.5, cell).0)
                .collect();
            let planned = geometry.iter().filter(|&&g| g <= 0.0).count() as f64 / geometry.len() as f64;
            let target = if self.traced() {
                planned
            } else if lone_cove {
                planned.clamp(0.08, 0.22)
            } else {
                planned.clamp(0.03, 0.72)
            };
            let sea = |coast: &Self, shift: f64| {
                geometry.iter().zip(&relief)
                    .filter(|&(&g, &h)| g + shift + coast.relief_term(h, g + shift) <= 0.0)
                    .count() as f64 / geometry.len() as f64
            };
            // A bounded shift: the calibration never opens a cove onto the whole side.
            let (mut low, mut high) = (-0.1, 0.1);
            for _ in 0..32 {
                let middle = 0.5 * (low + high);
                if sea(self, middle) > target { low = middle } else { high = middle }
            }
            self.parameters[SHIFT] = (0.5 * (low + high)) as f32;
        }
        let at = |x: f64, y: f64| {
            let (i, j) = ((x * n as f64).floor().clamp(0.0, (n - 1) as f64) as usize, (y * n as f64).floor().clamp(0.0, (n - 1) as f64) as usize);
            relief[j * n + i]
        };
        self.place_islets(&at);
        Ok(())
    }

    /// Detached rocks near the actual shore, including beside peninsulas.
    fn place_islets(&mut self, relief: &dyn Fn(f64, f64) -> f64) {
        let mask = self.parameters[0] as u32;
        let archipelago = self.archipelago;
        let mut rng = self.rng.fork("islets");
        let wanted = if mask == 255 && archipelago {
            18.0 + (rng.float() * 15.0).floor()
        } else {
            6.0 + (rng.float() * 9.0).floor()
        };
        // A small map shows a shorter stretch of coast: fewer rocks, none under a few metres wide.
        let wanted = (wanted * (self.width / 8000.0).sqrt().clamp(0.3, 1.0)).ceil() as usize;
        let smallest = (18.0 / self.width).min(0.04);
        let mut sizes = self.rng.fork("islet-sizes");
        let radii: Vec<f64> = (0..wanted)
            .map(|i| {
                let size_class = if i == 0 {
                    0.95
                } else if i < 3 {
                    0.75
                } else {
                    sizes.float()
                };
                let radius: f64 = if size_class < 0.6 {
                    sizes.range(0.0025, 0.0085)
                } else if size_class < 0.9 {
                    sizes.range(0.009, 0.023)
                } else {
                    sizes.range(0.025, 0.045)
                };
                radius.max(smallest)
            })
            .collect();
        let mut islets: Vec<(f64, f64, f64)> = Vec::new();
        let mut target_attempts = 0;
        for _ in 0..1800 {
            if islets.len() == wanted {
                break;
            }
            // Large outcrops need a larger offshore pocket; shrink gradually
            // only if the selected sea sectors cannot accommodate this target.
            let r = radii[islets.len()] * 0.8_f64.powi(target_attempts / 160).max(0.35);
            target_attempts += 1;
            let (x, y) = (rng.range(0.045, 0.955), rng.range(0.045, 0.955));
            let clearance = r * 2.2 + 0.004;
            if x.min(y).min(1.0 - x).min(1.0 - y) < r * 2.2 + 0.01 {
                continue;
            }
            let (distance, _, _, _) = self.distance(x, y, 0.0, relief(x, y));
            if !(-clearance - 0.045..-clearance).contains(&distance)
                || islets
                    .iter()
                    .any(|&(ix, iy, ir)| (x - ix).hypot(y - iy) < (r + ir) * 2.2 + 0.007)
            {
                continue;
            }
            if (0..8).any(|i| {
                let angle = i as f64 * TAU / 8.0;
                let (px, py) = (x + r * 2.2 * angle.cos(), y + r * 2.2 * angle.sin());
                self.distance(px, py, 0.0, relief(px, py)).0 > -0.003
            }) {
                continue;
            }
            let turn = rng.range(0.0, TAU);
            self.islet(&mut rng, x, y, r, turn);
            islets.push((x, y, r));
            target_attempts = 0;
        }
    }

    fn traced(&self) -> bool {
        self.parameters[0] == TRACED
    }

    /// First land capsule, after the sea capsules and the padded sampled sea field.
    fn land_start(&self) -> usize {
        let n = self.parameters[FIELD_N] as usize;
        HEADER + self.parameters[SEA_COUNT] as usize * SEA_STRIDE + (n * n).div_ceil(4) * 4
    }

    /// Cell-centred bilinear sea distance, with constant extension beyond the grid.
    /// Mirrored by `coastSeaField` in `terrainCoast.wgsl`.
    fn sea_field(&self, x: f64, y: f64) -> f64 {
        let n = self.parameters[FIELD_N] as usize;
        let fx = (x * n as f64 - 0.5).clamp(0.0, (n - 1) as f64);
        let fy = (y * n as f64 - 0.5).clamp(0.0, (n - 1) as f64);
        let (x0, y0) = (fx.floor() as usize, fy.floor() as usize);
        let (x1, y1) = ((x0 + 1).min(n - 1), (y0 + 1).min(n - 1));
        let (tx, ty) = (fx - x0 as f64, fy - y0 as f64);
        let start = HEADER + self.parameters[SEA_COUNT] as usize * SEA_STRIDE;
        let at = |x, y| self.parameters[start + y * n + x] as f64;
        let north = at(x0, y0) * (1.0 - tx) + at(x1, y0) * tx;
        let south = at(x0, y1) * (1.0 - tx) + at(x1, y1) * tx;
        north * (1.0 - ty) + south * ty
    }

    fn sea_capsule(&mut self, a: (f64, f64), b: (f64, f64), ra: f64, rb: f64) {
        let at = self.land_start();
        self.parameters.splice(at..at, [a.0, a.1, b.0, b.1, ra, rb, 0.0, 0.0].map(|v| v as f32));
        self.parameters[SEA_COUNT] += 1.0;
    }

    /// The selected edges, as seas entering the map. The boundary is split into eight
    /// pieces: each cardinal owns the middle third of its side, each corner the last
    /// third of one side and the first third of the next. Adjacent selections form one
    /// run: SW+S+SE is the whole bottom. A lone cardinal is a bounded inlet through
    /// part of its side (cove, gulf or broad bay); anything else is a coastal band along
    /// its run, rounded at the corners and tapered at its ends.
    fn edge_seas(&mut self, mask: u32) {
        let mut rng = self.rng.fork("edge-seas");
        let selected = |i: usize| mask & (1 << (i % 8)) != 0;
        let Some(free) = (0..8).find(|&i| !selected(i)) else { return };
        let mut i = free + 1;
        while i < free + 8 {
            if !selected(i) { i += 1; continue; }
            let first = i;
            while i < free + 8 && selected(i) { i += 1; }
            let last = i - 1;
            if first == last && first % 2 == 0 {
                self.cove(&mut rng, first % 8);
                continue;
            }
            // Perimeter positions clockwise from the top-left corner, one unit per side.
            let half = |k: usize| if k % 2 == 0 { 1.0 / 6.0 } else { 1.0 / 3.0 };
            let (p0, p1) = (0.5 + 0.5 * first as f64 - half(first), 0.5 + 0.5 * last as f64 + half(last));
            let mut knots = vec![p0];
            let mut corner = p0.floor() + 1.0;
            while corner < p1 - 1e-9 {
                knots.push(corner);
                corner += 1.0;
            }
            knots.push(p1);
            // Finer knots, so the sea reach varies along a long coast.
            let mut points = vec![knots[0]];
            for pair in knots.windows(2) {
                let pieces = ((pair[1] - pair[0]) * 3.0).ceil().max(1.0) as usize;
                for k in 1..=pieces {
                    points.push(pair[0] + (pair[1] - pair[0]) * k as f64 / pieces as f64);
                }
            }
            let corner_only = first == last;
            let reach = if corner_only { rng.range(0.20, 0.32) } else { rng.range(0.15, 0.25) };
            let radii: Vec<f64> = (0..points.len())
                .map(|k| {
                    if k == 0 || k + 1 == points.len() {
                        reach * rng.range(0.25, 0.45)
                    } else {
                        reach * rng.range(0.7, 1.3)
                    }
                })
                .collect();
            for k in 1..points.len() {
                self.sea_capsule(perimeter(points[k - 1]), perimeter(points[k]), radii[k - 1], radii[k]);
            }
        }
    }

    /// A sea inlet through part of the side of cardinal direction `i`: mostly a cove
    /// or gulf narrower at its mouth than inside, sometimes a broad bay.
    fn cove(&mut self, rng: &mut Rng, i: usize) {
        // Side centre, along-side tangent and inward normal of N, E, S, W.
        let (m, t, inward) = [
            ((0.5, 0.0), (1.0, 0.0), (0.0, 1.0)),
            ((1.0, 0.5), (0.0, 1.0), (-1.0, 0.0)),
            ((0.5, 1.0), (-1.0, 0.0), (0.0, -1.0)),
            ((0.0, 0.5), (0.0, -1.0), (1.0, 0.0)),
        ][i / 2];
        let point = |a: f64, depth: f64| (m.0 + t.0 * a + inward.0 * depth, m.1 + t.1 * a + inward.1 * depth);
        let centre = rng.range(-0.10, 0.10);
        if rng.float() < 0.78 {
            // Mostly open coves and gulfs; a narrow mouth (under 0.10) is a rare draw (~7%).
            let mouth = 0.08 + 0.10 * rng.float().powf(0.6);
            let depth = rng.range(0.18, 0.34);
            let bulb = rng.range(0.10, 0.18).max(mouth);
            let bend = rng.range(-0.08, 0.08);
            let (a, b, c, d) = (point(centre, -0.03), point(centre + bend * 0.3, depth * 0.35),
                point(centre + bend, depth * 0.7), point(centre + bend * 1.3, depth));
            self.sea_capsule(a, b, mouth, mouth * rng.range(1.0, 1.3));
            let neck = self.parameters[self.land_start() - 3] as f64;
            self.sea_capsule(b, c, neck, bulb);
            self.sea_capsule(c, d, bulb, bulb * rng.range(0.25, 0.45));
        } else {
            // A broad bay: a disc whose chord on the side is the mouth.
            let mouth = rng.range(0.14, 0.24);
            let depth = rng.range(0.10, 0.18);
            let radius = (mouth * mouth + depth * depth) / (2.0 * depth);
            let at = point(centre, depth - radius);
            self.sea_capsule(at, at, radius, radius);
            let lobe = rng.range(-0.5, 0.5) * mouth;
            let at = point(centre + lobe, depth * 0.4);
            let r = depth * rng.range(0.4, 0.7);
            self.sea_capsule(at, at, r, r);
        }
    }

    /// One branched landmass: a crooked spine of capsules and `arms` side lobes.
    fn body(&mut self, rng: &mut Rng, cx: f64, cy: f64, radius: f64, arms: usize) {
        let turn = rng.range(0.0, TAU);
        let point = |x: f64, y: f64| {
            (
                cx + radius * (x * turn.cos() - y * turn.sin()),
                cy + radius * (x * turn.sin() + y * turn.cos()),
            )
        };
        let phase = rng.range(0.0, 100.0);
        let segments = 3 + (rng.float() * 3.0) as usize;
        let mut last = point(-0.5, rng.range(-0.16, 0.16));
        let mut last_radius = radius * rng.range(0.21, 0.31);
        for j in 1..=segments {
            let next = point(-0.5 + j as f64 / segments as f64, rng.range(-0.19, 0.19));
            let next_radius = radius
                * if j == segments {
                    rng.range(0.18, 0.30)
                } else {
                    rng.range(0.28, 0.40)
                };
            self.capsule(last, next, last_radius, next_radius, radius, phase);
            last = next;
            last_radius = next_radius;
        }
        for _ in 0..arms {
            let side = if rng.float() < 0.5 { -1.0 } else { 1.0 };
            let root = rng.range(-0.35, 0.35);
            self.capsule(
                point(root, 0.0),
                point(root + rng.range(-0.25, 0.25), side * rng.range(0.38, 0.58)),
                radius * rng.range(0.24, 0.34),
                radius * rng.range(0.13, 0.25),
                radius,
                phase,
            );
        }
    }

    /// A landmass joined to one map edge, of a seeded family: hook, tapering cape, tombolo,
    /// double lobe, narrow neck, rocky headland, curved spit, broad blunt, claw or winding
    /// ribbon. The axis, its bends and its widths are seeded too. Returns whether the land is
    /// too narrow for bays, which could sever it.
    fn peninsula(&mut self, rng: &mut Rng) -> bool {
        let side = (rng.float() * 4.0) as usize % 4;
        let (nx, ny) = [(0.0, -1.0), (1.0, 0.0), (0.0, 1.0), (-1.0, 0.0)][side];
        let (tx, ty): (f64, f64) = (-ny, nx);
        let along = rng.range(-0.3, 0.3);
        // Just beyond the map edge, aiming at the middle of the map.
        let root: (f64, f64) = (0.5 + tx * along + nx * 0.56, 0.5 + ty * along + ny * 0.56);
        let aim = (0.5 + rng.range(-0.14, 0.14) - root.0, 0.5 + rng.range(-0.14, 0.14) - root.1);
        let heading = aim.1.atan2(aim.0) + rng.range(-0.2, 0.2);
        let phase = rng.range(0.0, 100.0);
        let turn = if rng.float() < 0.5 { -1.0 } else { 1.0 };
        let family = (rng.float() * 10.0) as usize;
        // Narrowest radius near the root: the drowned relief may not sever the land there.
        let (neck, narrow) = match family {
            // Hook: an arm bending back on itself near its end.
            0 => {
                let (wide, bend) = (rng.range(0.06, 0.10), turn * rng.range(1.7, 2.7));
                let spine = walk(rng, root, heading - turn * 0.3, 0.95, 7, |t| bend * t * t, |t| wide * (1.0 - 0.6 * t));
                self.ribbon(&spine, phase);
                (wide * 0.5, true)
            }
            // Tapering cape: a broad root down to a point.
            1 => {
                let (wide, tip, bend) = (rng.range(0.15, 0.24), rng.range(0.012, 0.03), turn * rng.range(0.0, 0.8));
                let (length, taper) = (rng.range(0.6, 0.85), rng.range(0.6, 1.3));
                let spine = walk(rng, root, heading, length, 6, |t| bend * t, |t| tip + (wide - tip) * (1.0 - t.powf(taper)));
                self.ribbon(&spine, phase);
                (wide, false)
            }
            // Tombolo: an island tied to the shore by a thin bar.
            2 => {
                let (bar, length, bend) = (rng.range(0.013, 0.022), rng.range(0.28, 0.40), turn * rng.range(0.2, 0.9));
                let spine = walk(rng, root, heading, length, 4, |t| bend * t, |t| bar * (1.3 - 0.4 * t));
                self.ribbon(&spine, phase);
                let (x, y, _) = spine[spine.len() - 1];
                let radius = rng.range(0.17, 0.26);
                let reach = radius * 0.4 / (x - root.0).hypot(y - root.1).max(1e-6);
                let (cx, cy) = (x + (x - root.0) * reach, y + (y - root.1) * reach);
                self.ribbon(&[(x, y, bar), (cx, cy, radius * 0.25)], phase + 80.0);
                self.body(rng, cx, cy, radius, 1);
                (bar * 0.7, true)
            }
            // Double lobe: two swellings joined by a waist.
            3 => {
                let (waist, swell, bend) = (rng.range(0.03, 0.05), rng.range(0.09, 0.15), turn * rng.range(0.0, 0.9));
                let second = rng.range(0.5, 1.1);
                let lobes = |t: f64| waist + swell * (TAU * t * 0.95).sin().powi(2) * (if t > 0.5 { second } else { 1.0 });
                let spine = walk(rng, root, heading, 0.82, 8, |t| bend * t, lobes);
                self.ribbon(&spine, phase);
                (waist * 0.8, true)
            }
            // Narrow neck: a branched landmass behind a crooked isthmus.
            4 => {
                let (isthmus, radius, length) = (rng.range(0.024, 0.04), rng.range(0.24, 0.33), rng.range(0.30, 0.42));
                let spine = walk(rng, root, heading, length, 4, |t| turn * 0.6 * t, |t| isthmus * (1.3 - 0.4 * t));
                self.ribbon(&spine, phase);
                let (x, y, _) = spine[spine.len() - 1];
                let (cx, cy) = (0.175 + 0.65 * x, 0.175 + 0.65 * y);
                self.ribbon(&[(x, y, isthmus), (cx, cy, radius * 0.25)], phase + 80.0);
                let arms = 1 + (rng.float() * 2.0) as usize;
                self.body(rng, cx, cy, radius, arms);
                (isthmus * 0.7, true)
            }
            // Rocky headland: a broad trunk splaying into points with coves between them.
            5 => {
                let (wide, length) = (rng.range(0.14, 0.22), rng.range(0.36, 0.5));
                let trunk = walk(rng, root, heading, length, 4, |_| 0.0, |t| wide * (1.0 - 0.35 * t));
                self.ribbon(&trunk, phase);
                let (x, y, _) = trunk[trunk.len() - 1];
                let points = 3 + (rng.float() * 3.0) as usize;
                for k in 0..points {
                    let fan = heading + (k as f64 / (points - 1) as f64 - 0.5) * 2.6 + rng.range(-0.25, 0.25);
                    let (length, width) = (rng.range(0.14, 0.30), rng.range(0.035, 0.07));
                    let arm = walk(rng, (x, y), fan, length, 3, |t| turn * 0.3 * t, |t| width * (1.0 - 0.75 * t));
                    self.ribbon(&arm, phase + 80.0 * (k + 1) as f64);
                }
                (wide, false)
            }
            // Curved spit: a long thin arc of sand.
            6 => {
                let (width, bend, length) = (rng.range(0.022, 0.038), turn * rng.range(1.1, 2.0), rng.range(0.9, 1.15));
                let spine = walk(rng, root, heading - bend * 0.35, length, 9, |t| bend * t.powf(1.3), |t| width * (1.1 - 0.45 * t));
                self.ribbon(&spine, phase);
                (width * 0.6, true)
            }
            // Broad blunt: hardly a neck, a wide square head.
            7 => {
                let (wide, flare, length) = (rng.range(0.20, 0.28), rng.range(-0.15, 0.2), rng.range(0.48, 0.66));
                let spine = walk(rng, root, heading, length, 4, |t| turn * 0.25 * t, |t| wide * (1.0 + flare * t));
                self.ribbon(&spine, phase);
                (wide, false)
            }
            // Claw: two arms round a bay.
            8 => {
                let (wide, length) = (rng.range(0.07, 0.12), rng.range(0.30, 0.40));
                let trunk = walk(rng, root, heading, length, 3, |_| 0.0, |t| wide * (1.1 - 0.3 * t));
                self.ribbon(&trunk, phase);
                let (x, y, _) = trunk[trunk.len() - 1];
                for way in [-1.0, 1.0] {
                    let (spread, bend, width) = (rng.range(0.8, 1.2), rng.range(1.2, 2.0), rng.range(0.045, 0.08));
                    let length = rng.range(0.36, 0.52);
                    let arm = walk(rng, (x, y), heading + way * spread, length, 5, |t| -way * bend * t, |t| width * (1.0 - 0.6 * t));
                    self.ribbon(&arm, phase + 120.0 + 60.0 * way);
                }
                (wide * 0.7, true)
            }
            // Winding ribbon.
            _ => {
                let (width, sway, waves) = (rng.range(0.045, 0.085), turn * rng.range(0.6, 1.1), rng.range(0.8, 1.6));
                let length = rng.range(0.85, 1.05);
                let spine = walk(rng, root, heading, length, 9, |t| sway * (TAU * waves * t).sin(), |t| width * (1.0 - 0.35 * t));
                self.ribbon(&spine, phase);
                (width * 0.6, true)
            }
        };
        self.parameters[DROWNING] = self.parameters[DROWNING].min((neck * 0.5) as f32);
        // The continent itself mostly lies beyond the frame.
        let reach = rng.range(0.10, 0.34);
        let (ox, oy) = (0.5 + tx * along + nx * 0.60, 0.5 + ty * along + ny * 0.60);
        let (a, b) = (rng.range(0.5, 1.3), rng.range(0.5, 1.3));
        self.capsule(
            (ox - tx * reach * a, oy - ty * reach * a),
            (ox + tx * reach * b, oy + ty * reach * b),
            0.14,
            0.14,
            0.22,
            phase + 600.0,
        );
        narrow
    }

    /// A chain of capsules along `(x, y, radius)` points. Each one has its own phase: the
    /// detail noise is cached per phase and scales with the local width.
    fn ribbon(&mut self, points: &[(f64, f64, f64)], phase: f64) {
        for (k, pair) in points.windows(2).enumerate() {
            let (a, b) = (pair[0], pair[1]);
            let scale = (2.4 * a.2.min(b.2)).clamp(0.03, 0.30);
            self.capsule((a.0, a.1), (b.0, b.1), a.2, b.2, scale, phase + 3.3 * (k + 1) as f64);
        }
    }

    /// Seeded bays (negative) and headlands (positive) centred on the shore
    /// drawn so far, so that no two seeds share one caricatural outline.
    fn shore_features(&mut self, rng: &mut Rng, mainland: bool) {
        let count = 2 + (rng.float() * 5.0) as usize;
        let inside = self.geometry(0.5, 0.5, 0.0).0 > 0.0;
        let mut placed = 0;
        for _ in 0..count * 6 {
            if placed == count {
                break;
            }
            let angle = rng.range(0.0, TAU);
            // One broad gulf or cape, then smaller coves and points.
            let (radius, depth) = if !mainland {
                (rng.range(0.04, 0.12), rng.range(0.35, 0.8))
            } else if placed == 0 {
                (rng.range(0.22, 0.42), rng.range(0.25, 0.5))
            } else {
                (rng.range(0.05, 0.18), rng.range(0.35, 0.8))
            };
            let depth = depth * if rng.float() < 0.55 { -1.0 } else { 1.0 };
            let (dx, dy) = (angle.cos(), angle.sin());
            let Some(r) = (2..72).map(|k| k as f64 * 0.01).find(|&r| {
                let (x, y) = (0.5 + dx * r, 0.5 + dy * r);
                (0.0..=1.0).contains(&x)
                    && (0.0..=1.0).contains(&y)
                    && (self.geometry(x, y, 0.0).0 > 0.0) != inside
            }) else {
                continue;
            };
            let j = BUMPS + placed * 4;
            self.parameters[j..j + 4].copy_from_slice(&[
                (0.5 + dx * r) as f32,
                (0.5 + dy * r) as f32,
                radius as f32,
                (radius * depth) as f32,
            ]);
            placed += 1;
        }
        self.parameters[30] = placed as f32;
    }

    #[allow(clippy::too_many_arguments)]
    fn capsule(&mut self, a: (f64, f64), b: (f64, f64), ra: f64, rb: f64, scale: f64, phase: f64) {
        self.parameters.extend([
            a.0 as f32,
            a.1 as f32,
            b.0 as f32,
            b.1 as f32,
            ra as f32,
            rb as f32,
            scale as f32,
            phase as f32,
            0.0,
            0.0,
            0.0,
            1.0,
        ]);
        self.parameters[1] += 1.0;
    }

    fn islet(&mut self, rng: &mut Rng, x: f64, y: f64, r: f64, turn: f64) {
        let shape = (rng.float() * 6.0) as usize;
        let phase = rng.range(0.0, 100.0);
        // Low sandy outcrops and taller rocks are independent
        // of the mainland's height at their offshore position.
        let rocky = rng.float() < 0.55;
        let peak = if rocky {
            (rng.range(0.45, 1.5) * (self.depth() * 0.8).clamp(10.0, 70.0)).min(r * self.width * 0.5)
        } else {
            rng.range(0.8, 5.0)
        };
        // Retain the former detail draws so removing interior noise does not
        // change this seed's silhouettes, sizes or subsequent placements.
        if rocky {
            rng.range(0.2, 0.5);
            rng.range(0.35, 0.8);
        }
        let apron = if rocky {
            rng.range(0.45, 1.0)
        } else {
            rng.range(1.5, 2.4)
        };
        let lean = rng.range(0.45, 0.85);
        // One broad, barely raised mound for larger plain islets. Reuse the
        // existing phase so neither the silhouette nor RNG sequence changes.
        let relief_center = if rocky {
            (0.0, 0.0)
        } else {
            (x + r * 0.3 * phase.cos(), y + r * 0.3 * phase.sin())
        };
        let point = |a: (f64, f64)| {
            (
                x + r * (a.0 * turn.cos() - a.1 * turn.sin()),
                y + r * (a.0 * turn.sin() + a.1 * turn.cos()),
            )
        };
        let mut segment = |a, b, ra: f64, rb: f64| {
            self.capsule(point(a), point(b), r * ra, r * rb, r * 3.0, phase);
            let start = self.parameters.len() - 4;
            self.parameters[start..].copy_from_slice(&[
                peak as f32,
                relief_center.0 as f32,
                relief_center.1 as f32,
                apron as f32,
            ]);
        };
        match shape {
            // Compact asymmetric rock; no repeated long capsule.
            0 => segment((-0.2, 0.05), (0.25, -0.1), 0.95, lean),
            // Angular three-armed outcrop.
            1 => {
                segment((-0.6, 0.4), (0.2, -0.65), 0.5, 0.35);
                segment((-0.2, 0.0), (0.7, 0.35), 0.6, 0.35);
            }
            // Broad two-lobed island.
            2 => {
                segment((-0.55, 0.0), (0.1, 0.15), 0.85, 0.4);
                segment((0.0, 0.1), (0.75, -0.15), 0.4, lean);
            }
            // Crooked crescent, with a cove on its inner side.
            3 => {
                segment((-0.9, -0.35), (-0.3, 0.4), 0.28, 0.45);
                segment((-0.3, 0.4), (0.45, 0.4), 0.45, 0.4);
                segment((0.45, 0.4), (0.85, -0.25), 0.4, 0.22);
            }
            // Irregular branching reef or ridge.
            4 => {
                segment((-0.75, 0.0), (0.7, 0.1), 0.42, 0.36);
                segment((-0.15, 0.0), (-0.35, -0.8), 0.5, 0.25);
                segment((0.3, 0.05), (0.55, 0.7), 0.4, 0.3);
            }
            // Keep occasional long outcrops, rather than making all islets round.
            _ => segment((-1.2, -0.12), (1.0, 0.18), 0.42, 0.3),
        }
    }
    pub fn active(&self) -> bool {
        self.parameters[0] != 0.0
    }
    pub fn set_profile(&mut self, profile: CoastProfile) -> Result<(), String> {
        self.profile = profile.validate()?;
        Ok(())
    }
    pub fn depth(&self) -> f64 {
        self.parameters[3] as f64
    }

    pub fn set_marine_datum(&mut self, datum: f64) {
        self.parameters[7] = datum as f32;
    }

    /// Drowning of the relief near the shore: low ground (valleys, river mouths,
    /// lowlands) lets the sea in as bays, rias and estuaries; high ground holds out as
    /// headlands and, offshore, as islets. Bounded by the drowning, fading beyond its band.
    fn relief_term(&self, relief: f64, distance: f64) -> f64 {
        let band = self.parameters[DROWNING_BAND] as f64;
        self.parameters[DROWNING] as f64 * self.relief_rank(relief) * smooth(1.0 - distance.abs() / band)
    }

    /// Place of this marine relief between the low (-1) and high (1) ground; 0 before the fit.
    fn relief_rank(&self, relief: f64) -> f64 {
        ((relief - self.parameters[RELIEF_MEDIAN] as f64) * self.parameters[RELIEF_INVERSE] as f64).tanh()
    }

    /// Signed distance (positive inland) of the fitted coast over this marine `relief`.
    fn distance(&self, x: f64, y: f64, footprint: f64, relief: f64) -> (f64, f64, f64, f64) {
        let (mut distance, scale, islet_height, apron) = self.geometry(x, y, footprint);
        if islet_height == 0.0 {
            distance += self.parameters[SHIFT] as f64;
            distance += self.relief_term(relief, distance);
            distance += self.shore_cut(x, y, footprint, distance);
        }
        (distance, scale, islet_height, apron)
    }

    /// Stretches of coast, 0 on the steep resistant ones to 1 on the gentle ones.
    fn gentleness(&self, x: f64, y: f64) -> f64 {
        smooth(self.noise.fbm(x / 0.21 + 11.7, y / 0.21 - 4.2, 3) + 0.5)
    }

    /// Fractal cut of the shoreline, evaluated near it only: indented where the coast is
    /// steep and resistant, almost nothing on gentle stretches. The shore keeps its side
    /// beyond the reach. `shoreDetail.ts` continues it below the cells.
    fn shore_cut(&self, x: f64, y: f64, footprint: f64, distance: f64) -> f64 {
        let near = 1.0 - distance.abs() / CUT_REACH;
        if near <= 0.0 {
            return 0.0;
        }
        self.parameters[CUT] as f64 * (CUT_STEEP - self.gentleness(x, y)) * smooth(near)
            * self.noise.fbm_filtered(x / CUT_WAVE + 31.7, y / CUT_WAVE - 8.3, 4, 0.6, footprint / CUT_WAVE)
    }

    /// Natural height limit `metres` behind the shore: a seeded slope, gentler near the water
    /// on the gentle stretches and following the relief's ridges and valleys (`z`), plus on the
    /// steepest stretches a cliff of limited height. An island cannot stand higher than its
    /// distance to the sea allows, whatever its size. `islet` is an islet's size in metres.
    fn ceiling(&self, metres: f64, gentle: f64, apron: f64, z: f64, islet: f64) -> f64 {
        let steep = 1.0 - gentle;
        let tilt = (250.0 / self.profile.width.max(40.0)).sqrt().clamp(0.5, 1.6);
        let slope = self.parameters[SLOPE] as f64 * (0.65 + 0.7 * steep) * tilt * (1.0 + 0.35 * z) / apron.sqrt();
        let beach = 0.25 + 0.75 * steep;
        let ease = beach + (1.0 - beach) * metres / (metres + (self.width * 0.012).min(120.0));
        let cliff = self.cliff(gentle, islet);
        cliff * smooth(metres / (1.0 + 0.6 * cliff)) + slope * metres * ease
    }

    /// Cliff height of a stretch, bounded by the map and by the islet it stands on.
    fn cliff(&self, gentle: f64, islet: f64) -> f64 {
        let limit = (self.parameters[CLIFF] as f64).min(self.width * 0.004);
        let limit = if islet > 0.0 { limit.min(islet * 0.04) } else { limit };
        limit * smooth((0.28 - gentle) / 0.2)
    }

    /// The geometric plan alone: shorelines, landmasses, islets, bays and headlands.
    fn geometry(&self, x: f64, y: f64, footprint: f64) -> (f64, f64, f64, f64) {
        let at = |i: usize| self.parameters[i] as f64;
        let mask = at(0) as u32;
        let mut distance = -2.0;
        let mut scale = 0.2;
        let mut islet_height = 0.0;
        let mut apron = 1.0;
        if mask != 255 {
            // A broad seeded warp bends the straight shorelines into bights and capes.
            let (warp, ws) = (at(24), at(25));
            let (wx, wy) = (
                x + warp
                    * self
                        .noise
                        .fbm_filtered(x / ws + 5.2, y / ws + 1.3, 3, 0.5, footprint / ws),
                y + warp
                    * self
                        .noise
                        .fbm_filtered(x / ws - 7.7, y / ws + 9.1, 3, 0.5, footprint / ws),
            );
            // Union of the traced field and edge-sea capsules, positive in the sea.
            let mut sea = -10.0_f64;
            if at(FIELD_N) > 0.0 {
                sea = self.sea_field(wx, wy);
            }
            for k in 0..at(SEA_COUNT) as usize {
                let j = HEADER + k * SEA_STRIDE;
                let (ax, ay, bx, by) = (at(j), at(j + 1), at(j + 2), at(j + 3));
                let (dx, dy) = (bx - ax, by - ay);
                let t = (((wx - ax) * dx + (wy - ay) * dy) / (dx * dx + dy * dy).max(1e-12)).clamp(0.0, 1.0);
                sea = sea.max(at(j + 4) * (1.0 - t) + at(j + 5) * t - (wx - ax - t * dx).hypot(wy - ay - t * dy));
            }
            let (large, ls, fine, fs) = (at(26), at(27), at(28), at(29));
            distance = -sea
                + large
                    * self
                        .noise
                        .fbm_filtered(x / ls, y / ls, 7, 0.56, footprint / ls)
                + fine
                    * self
                        .noise
                        .fbm_filtered(x / fs, y / fs, 5, 0.55, footprint / fs);
        }
        let mut cached_phase = f64::NAN;
        let mut detail = 0.0;
        let land = self.land_start();
        for i in 0..at(1) as usize {
            let j = land + i * 12;
            let (ax, ay, bx, by) = (at(j), at(j + 1), at(j + 2), at(j + 3));
            let (dx, dy) = (bx - ax, by - ay);
            let t =
                (((x - ax) * dx + (y - ay) * dy) / (dx * dx + dy * dy).max(1e-12)).clamp(0.0, 1.0);
            let base =
                at(j + 4) * (1.0 - t) + at(j + 5) * t - (x - ax - t * dx).hypot(y - ay - t * dy);
            let s = at(j + 6);
            if base + s * 0.165 <= distance {
                continue;
            }
            let phase = at(j + 7);
            if phase != cached_phase {
                detail = s
                    * (0.14
                        * self.noise.fbm_filtered(
                            x / (s * 1.1) + phase,
                            y / (s * 1.1) - phase,
                            7,
                            0.56,
                            footprint / (s * 1.1),
                        )
                        + 0.025
                            * self.noise.fbm_filtered(
                                x / (s * 0.13) - phase,
                                y / (s * 0.13) + phase,
                                4,
                                0.55,
                                footprint / (s * 0.13),
                            ));
                cached_phase = phase;
            }
            if base + detail > distance {
                distance = base + detail;
                scale = s;
                // Branches share one broad plain-islet rise, only a few meters high.
                // Tiny islets and rocky outcrops keep their simple elevation.
                islet_height = at(j + 8);
                apron = at(j + 11);
                if apron > 1.0 {
                    let size = smooth((s / 3.0 - 0.009) / 0.016);
                    let radial = (x - at(j + 9)).hypot(y - at(j + 10)) / (s * 0.6);
                    let rise = 8.0 * (0.75 + 0.25 * phase.cos());
                    islet_height += rise * size * (1.0 - smooth(radial));
                }
            }
        }
        // Seeded bays and headlands; islets keep their own outline.
        if islet_height == 0.0 {
            for k in 0..(at(30) as usize).min(MAX_BUMPS) {
                let j = BUMPS + k * 4;
                let d2 = ((x - at(j)).powi(2) + (y - at(j + 1)).powi(2)) / at(j + 2).powi(2);
                if d2 < 1.0 {
                    distance += at(j + 3) * (1.0 - d2) * (1.0 - d2);
                }
            }
        }
        (distance, scale, islet_height, apron)
    }

    /// Width of the sea slope, in map widths, of a shore of this `scale` and `apron` on an
    /// average stretch. It grows with the relief it cuts and never falls to the sea floor
    /// steeper than a natural slope. Beyond it the sea floor is flat at `-depth`.
    fn sea_slope(&self, scale: f64, apron: f64, relief: f64, width: f64) -> f64 {
        let ramp = (self.parameters[2] as f64).max(relief / (width * 0.45)).min(scale * 0.18).max(self.depth() / width);
        4.0 * ramp * apron * self.shelf()
    }

    /// Coastal band, in map widths: the sea slope on its widest stretch.
    fn shore_band(&self, scale: f64, apron: f64, relief: f64, width: f64) -> f64 {
        self.sea_slope(scale, apron, relief, width) * 1.75
    }

    /// Seeded shelf width: narrow steep shores to broad shallow ones.
    fn shelf(&self) -> f64 {
        let shelf = self.parameters[SHELF] as f64;
        if shelf > 0.0 { shelf } else { 1.0 }
    }

    /// Open sea: `(x, y)`, in map widths, is provably beyond the coastal band of every
    /// shore that could pass here, so the coast returns the exact sea floor `-depth`
    /// whatever the relief `height` below. THE definition of open sea: the signed
    /// distance is bounded with each noise at its bound, so no noise is evaluated. The
    /// shore nearest to a cell decides its ramp, and each one clears its own band.
    pub fn open_sea(&self, x: f64, y: f64, width: f64, height: f64) -> bool {
        let at = |i: usize| self.parameters[i] as f64;
        // Bays and headlands widen the sea or the land by at most their own bump.
        let mut raised = 0.0;
        for k in 0..(at(30) as usize).min(MAX_BUMPS) {
            let j = BUMPS + k * 4;
            let d2 = ((x - at(j)).powi(2) + (y - at(j + 1)).powi(2)) / at(j + 2).powi(2);
            if d2 < 1.0 {
                raised += at(j + 3).max(0.0) * (1.0 - d2) * (1.0 - d2);
            }
        }
        // The fitted shift and the relief drowning raise the land by at most this much.
        raised += at(DROWNING) * self.relief_rank(height).max(0.0);
        raised += at(SHIFT).max(0.0) + at(CUT) * CUT_STEEP * NOISE_BOUND;
        let mask = at(0) as u32;
        if mask != 255 {
            // The warp moves the sample by at most `reach`; bound the field and
            // capsule variation over that displacement before adding the shore band.
            let reach = at(24).abs() * NOISE_BOUND * std::f64::consts::SQRT_2;
            let mut sea = -10.0_f64;
            if at(FIELD_N) > 0.0 {
                // Each grid-axis slope is at most one; bilinear interpolation is
                // sqrt(2)-Lipschitz, including the clamped extension outside the map.
                sea = self.sea_field(x, y) - std::f64::consts::SQRT_2 * reach;
            }
            for k in 0..at(SEA_COUNT) as usize {
                let j = HEADER + k * SEA_STRIDE;
                let (ax, ay, bx, by) = (at(j), at(j + 1), at(j + 2), at(j + 3));
                let (dx, dy) = (bx - ax, by - ay);
                let length = dx.hypot(dy);
                let t = (((x - ax) * dx + (y - ay) * dy) / (dx * dx + dy * dy).max(1e-12)).clamp(0.0, 1.0);
                let slope = if length > 1e-9 { (at(j + 5) - at(j + 4)).abs() / length } else { 0.0 };
                let base = at(j + 4) * (1.0 - t) + at(j + 5) * t - (x - ax - t * dx).hypot(y - ay - t * dy);
                sea = sea.max(base - (1.0 + slope) * reach);
            }
            let top = -sea + (at(26).abs() + at(28).abs()) * NOISE_BOUND + raised;
            if top + self.shore_band(0.2, 1.0, height, width) > 0.0 {
                return false;
            }
        } else if raised - 2.0 + self.shore_band(0.2, 1.0, height, width) > 0.0 {
            return false;
        }
        let land = self.land_start();
        for i in 0..at(1) as usize {
            let j = land + i * 12;
            let (ax, ay, bx, by) = (at(j), at(j + 1), at(j + 2), at(j + 3));
            let (dx, dy) = (bx - ax, by - ay);
            let t =
                (((x - ax) * dx + (y - ay) * dy) / (dx * dx + dy * dy).max(1e-12)).clamp(0.0, 1.0);
            let scale = at(j + 6);
            let top = at(j + 4) * (1.0 - t) + at(j + 5) * t - (x - ax - t * dx).hypot(y - ay - t * dy)
                + scale * 0.165 * NOISE_BOUND
                + raised;
            // An islet stands on its own height, with a rise of at most eight metres.
            let relief = height.max(at(j + 8) + 8.0);
            if top + self.shore_band(scale, at(j + 11), relief, width) > 0.0 {
                return false;
            }
        }
        true
    }

    pub fn apply(&self, x: f64, y: f64, width: f64, height: f64, footprint: f64) -> f64 {
        if !self.active() {
            return height;
        }
        let relief = self.marine_relief(height);
        if self.open_sea(x / width, y / width, width, relief) {
            return -self.depth();
        }
        self.shore(x, y, width, height, footprint)
    }

    fn marine_relief(&self, height: f64) -> f64 {
        let datum = self.parameters[7] as f64;
        if datum > 0.0 {
            let relative = height - datum;
            0.3 + 0.5 * (relative + (relative * relative + 1.0).sqrt())
        } else {
            height
        }
    }

    /// A low-frequency width field sampled along the shore: coherent stretches of irregular
    /// length, smoothly joined. Variation changes its amplitude, never the coastline.
    fn smoothing_width(&self, x: f64, y: f64) -> f64 {
        if self.profile.variability == 0.0 { return self.profile.width; }
        // Cubic B-spline interpolation gives C2 joins between seeded control values.
        let weights = |t: f64| [(1.0-t).powi(3)/6.0, (3.0*t*t*t-6.0*t*t+4.0)/6.0,
            (-3.0*t*t*t+3.0*t*t+3.0*t+1.0)/6.0, t*t*t/6.0];
        let (x, y) = (x / 1200.0, y / 1200.0);
        let (ix, iy) = (x.floor() as i32, y.floor() as i32);
        let (wx, wy) = (weights(x-x.floor()), weights(y-y.floor()));
        let mut wave = 0.0;
        for j in 0..4 { for i in 0..4 {
            let (cx, cy) = (((ix+i as i32-1)&255) as usize, ((iy+j as i32-1)&255) as usize);
            let value = self.noise.perm[cx+self.noise.perm[cy] as usize] as f64 / 127.5 - 1.0;
            wave += wx[i]*wy[j]*value;
        }}
        self.profile.width * (1.0 + self.profile.variability * (2.0*wave).tanh())
    }

    fn shore(&self, x: f64, y: f64, width: f64, height: f64, footprint: f64) -> f64 {
        // Coastal plains should not stand on their inland formula's constant
        // pedestal. Express elevations above the marine datum, with a smooth
        // positive floor so low pockets retain the selected coast geography.
        let height = self.marine_relief(height);
        let (distance, scale, islet_height, apron) =
            self.distance(x / width, y / width, footprint / width, height);
        let islet = islet_height > 0.0;
        let height = if islet { islet_height } else { height };
        let gentle = self.gentleness(x / width, y / width);
        if distance <= 0.0 {
            let slope = self.sea_slope(scale, apron, height, width) * (0.65 + 1.1 * gentle);
            return -self.depth() * rise(-distance / slope, 0.5);
        }
        let metres = distance * width;
        // The smoothing never covers a whole small map, and narrows at the foot of a cliff.
        let islet_size = if islet { scale * width } else { 0.0 };
        let cliff = self.cliff(gentle, islet_size);
        let band = self.smoothing_width(x, y).min(width * 0.12) * (1.0 - 0.85 * smooth(cliff / 20.0));
        let land = if band > 0.0 { height * rise(metres / band, 0.3) } else { height };
        if land <= 0.0 {
            return land;
        }
        // Smooth minimum: the relief well under the natural limit keeps its height.
        let z = if islet { 0.0 } else { self.relief_rank(height) };
        let limit = self.ceiling(metres, gentle, apron, z, islet_size);
        let (low, high) = (land.min(limit), land.max(limit));
        low / (1.0 + (low / high).powi(4)).powf(0.25)
    }
}

/// Rise from 0 to 1 over `t` in 0..1, leaving the shore at a slope `toe` and joining flat.
fn rise(t: f64, toe: f64) -> f64 {
    let t = t.clamp(0.0, 1.0);
    t * t * (3.0 - 2.0 * t) + toe * t * (1.0 - t) * (1.0 - t)
}

/// Points `(x, y, radius)` along a path of this `length` and initial `heading`, two per step:
/// `turn(t)` bends it, `radius(t)` sets its width, both with seeded irregularity. The path
/// stays inside the map, short of its edges.
fn walk(
    rng: &mut Rng,
    from: (f64, f64),
    heading: f64,
    length: f64,
    steps: usize,
    turn: impl Fn(f64) -> f64,
    radius: impl Fn(f64) -> f64,
) -> Vec<(f64, f64, f64)> {
    let pieces = steps * 2;
    let (mut x, mut y) = from;
    let mut points = vec![(x, y, radius(0.0))];
    for k in 1..=pieces {
        let t = k as f64 / pieces as f64;
        let angle = heading + turn(t) + rng.range(-0.28, 0.28);
        let step = length / pieces as f64 * rng.range(0.75, 1.25);
        let width = radius(t) * rng.range(0.74, 1.26);
        let margin = 0.06 + width * 0.6;
        x = (x + angle.cos() * step).clamp(margin, 1.0 - margin);
        y = (y + angle.sin() * step).clamp(margin, 1.0 - margin);
        points.push((x, y, width));
    }
    points
}

/// Decode the web mask and retain the centre of an edge-replicated, padded exact EDT.
/// An all-land mask has no coast; an all-sea mask cannot define a landmass.
fn traced_field(mode: &str) -> Result<Option<(usize, Vec<f32>)>, String> {
    let invalid = || "Invalid traced coast: expected traced:<16..128>:<lowercase hex mask>".to_string();
    let (size, hex) = mode.strip_prefix("traced:").and_then(|s| s.split_once(':')).ok_or_else(invalid)?;
    if size.is_empty() || !size.bytes().all(|b| b.is_ascii_digit()) {
        return Err(invalid());
    }
    let n: usize = size.parse().map_err(|_| invalid())?;
    if !(16..=128).contains(&n) || hex.len() != (n * n).div_ceil(8) * 2 {
        return Err(invalid());
    }
    let digit = |b| match b {
        b'0'..=b'9' => Ok(b - b'0'),
        b'a'..=b'f' => Ok(b - b'a' + 10),
        _ => Err(invalid()),
    };
    let bytes: Vec<u8> = hex.as_bytes().chunks_exact(2)
        .map(|pair| Ok((digit(pair[0])? << 4) | digit(pair[1])?))
        .collect::<Result<_, String>>()?;
    let sea: Vec<bool> = (0..n * n).map(|i| (bytes[i >> 3] >> (i & 7)) & 1 != 0).collect();
    let sea_count = sea.iter().filter(|&&s| s).count();
    if sea_count == n * n {
        return Err("A traced coast must contain at least one land cell".into());
    }
    if sea_count == 0 {
        return Ok(None);
    }
    let pad = n / 2;
    let padded_n = n + 2 * pad;
    let padded: Vec<bool> = (0..padded_n * padded_n).map(|i| {
        let x = (i % padded_n).saturating_sub(pad).min(n - 1);
        let y = (i / padded_n).saturating_sub(pad).min(n - 1);
        sea[y * n + x]
    }).collect();
    let to_land = squared_distances(&padded, padded_n, false);
    let to_sea = squared_distances(&padded, padded_n, true);
    let field = (0..n * n).map(|i| {
        let j = (i / n + pad) * padded_n + i % n + pad;
        let distance = if sea[i] { to_land[j].sqrt() - 0.5 } else { 0.5 - to_sea[j].sqrt() };
        (distance / n as f64).clamp(-2.0, 2.0) as f32
    }).collect();
    Ok(Some((n, field)))
}

/// Exact squared Euclidean distances in O(n*n), by separable lower envelopes of
/// parabolas. A finite sentinel keeps empty rows well-defined during the first pass.
fn squared_distances(sea: &[bool], n: usize, target_sea: bool) -> Vec<f64> {
    let mut distances: Vec<f64> = sea.iter().map(|&s| if s == target_sea { 0.0 } else { 1e12 }).collect();
    let mut input = vec![0.0; n];
    let mut sites = vec![0; n];
    let mut boundaries = vec![0.0; n + 1];
    for axis in 0..2 {
        for line in 0..n {
            let (start, stride) = if axis == 0 { (line * n, 1) } else { (line, n) };
            for q in 0..n { input[q] = distances[start + q * stride]; }
            let mut k = 0;
            sites[0] = 0;
            boundaries[0] = f64::NEG_INFINITY;
            boundaries[1] = f64::INFINITY;
            for q in 1..n {
                let intersection = |v: usize| {
                    (input[q] + (q * q) as f64 - input[v] - (v * v) as f64)
                        / (2.0 * (q - v) as f64)
                };
                let mut split = intersection(sites[k]);
                while split <= boundaries[k] {
                    k -= 1;
                    split = intersection(sites[k]);
                }
                k += 1;
                sites[k] = q;
                boundaries[k] = split;
                boundaries[k + 1] = f64::INFINITY;
            }
            k = 0;
            for q in 0..n {
                while boundaries[k + 1] < q as f64 { k += 1; }
                let delta = q as f64 - sites[k] as f64;
                distances[start + q * stride] = delta * delta + input[sites[k]];
            }
        }
    }
    distances
}

/// Point of the map boundary at perimeter `p`, clockwise from the top-left corner,
/// one unit per side (y grows southwards).
fn perimeter(p: f64) -> (f64, f64) {
    let p = p.rem_euclid(4.0);
    let f = p.fract();
    match p as usize {
        0 => (f, 0.0),
        1 => (1.0, f),
        2 => (1.0 - f, 1.0),
        _ => (0.0, 1.0 - f),
    }
}

#[cfg(test)]
mod open_sea_tests {
    use super::*;

    #[test]
    fn smoothing_width_is_constant_or_slowly_variable_without_changing_geography() {
        let make = |width, variability| {
            let mut coast = Coast::new(Rng::new("coast-width"), 4000.0, 10000.0, 300.0, 0.0);
            coast.set_profile(CoastProfile { width, variability }).unwrap();
            coast.configure(255, "island").unwrap();
            coast.fit(&vec![300.0; 64 * 64], 64).unwrap();
            coast
        };
        let (cut, constant, varied, wide) = (make(0.0, 0.0), make(250.0, 0.0), make(250.0, 0.8), make(1000.0, 0.0));
        let mut widths = Vec::new();
        let mut softened = 0;
        for y in 0..64 { for x in 0..64 {
            let (x, y) = ((x as f64 + 0.5) * 62.5, (y as f64 + 0.5) * 62.5);
            assert_eq!(constant.smoothing_width(x, y), 250.0);
            let local = varied.smoothing_width(x, y);
            assert!((50.0..=450.0).contains(&local));
            assert!((local - varied.smoothing_width(x + 1.0, y)).abs() < 2.0);
            widths.push(local);
            let original = cut.distance(x / 4000.0, y / 4000.0, 0.0, 300.0);
            assert_eq!(original, varied.distance(x / 4000.0, y / 4000.0, 0.0, 300.0));
            let (a, b) = (cut.apply(x, y, 4000.0, 300.0, 0.0), wide.apply(x, y, 4000.0, 300.0, 0.0));
            assert_eq!(a > 0.0, b > 0.0);
            if a <= 0.0 { assert_eq!(a, b); }
            if a - b > 10.0 { softened += 1; }
        }}
        let span = widths.iter().copied().fold(f64::NEG_INFINITY, f64::max) - widths.iter().copied().fold(f64::INFINITY, f64::min);
        assert!(span > 50.0 && softened > 10);
    }

    #[test]
    fn smoothing_rejects_removed_cliff_profiles_and_invalid_widths() {
        for profile in [CoastProfile { width: -1.0, variability: 0.0 }, CoastProfile { width: f64::NAN, variability: 0.0 }, CoastProfile { width: 250.0, variability: 1.1 }] {
            assert!(profile.validate().is_err());
        }
        assert!(serde_json::from_str::<CoastProfile>(r#"{"cliffs":1}"#).is_err());
    }

    /// Small islands under high relief: the height is bounded by the distance to the sea, and
    /// a cliff by the size of the map.
    #[test]
    fn islands_rise_from_the_sea_on_natural_slopes() {
        for (width, mode) in [(1500.0, "archipelago"), (4000.0, "archipelago"), (4000.0, "island"), (4000.0, "peninsula"), (25000.0, "archipelago")] {
            for seed in 0..3 {
                let mut coast = Coast::new(Rng::new(&format!("natural-{seed}")).fork("coast"), width, 10000.0, 1500.0, 0.0);
                coast.configure(255, mode).unwrap();
                let relief: Vec<f32> = hills(48).into_iter().map(|h| h * 4.0).collect();
                coast.fit(&relief, 48).unwrap();
                let mut land = 0;
                for i in 0..96 * 96 {
                    let (x, y) = (((i % 96) as f64 + 0.5) / 96.0, ((i / 96) as f64 + 0.5) / 96.0);
                    let height = relief[(i / 192) * 48 + (i % 96) / 2] as f64;
                    let h = coast.apply(x * width, y * width, width, height, 0.0);
                    let metres = coast.distance(x, y, 0.0, height).0 * width;
                    assert_eq!(h > 0.0, metres > 0.0);
                    if h > 0.0 {
                        land += 1;
                        assert!(h <= metres * 0.95 + (width * 0.004).min(45.0), "{mode} {width} m, seed {seed}: {h} m at {metres} m from the sea");
                    }
                }
                assert!(land > 0);
            }
        }
    }

    /// Rerolls draw different peninsulas: each stays joined to a side and keeps open sea, and
    /// two consecutive seeds never draw the same land.
    #[test]
    fn peninsulas_are_diverse() {
        let n = 48;
        let masks: Vec<Vec<bool>> = (0..20).map(|seed| {
            let mut coast = Coast::new(Rng::new(&format!("peninsula-{seed}")).fork("coast"), 25000.0, 10000.0, 1000.0, 0.0);
            coast.configure(255, "peninsula").unwrap();
            let land: Vec<bool> = (0..n * n).map(|i| coast.geometry(((i % n) as f64 + 0.5) / n as f64, ((i / n) as f64 + 0.5) / n as f64, 0.0).0 > 0.0).collect();
            let share = land.iter().filter(|&&l| l).count() as f64 / land.len() as f64;
            assert!((0.02..0.85).contains(&share), "seed {seed}: land share {share}");
            assert!((0..n).any(|k| land[k] || land[(n - 1) * n + k] || land[k * n] || land[k * n + n - 1]), "seed {seed}: not joined to a side");
            land
        }).collect();
        for (k, pair) in masks.windows(2).enumerate() {
            let differ = pair[0].iter().zip(&pair[1]).filter(|(a, b)| a != b).count();
            assert!(differ * 20 >= n * n, "seeds {k} and {} differ by {differ} cells", k + 1);
        }
    }

    /// Pack cell-centred sea samples in the web contract's least-significant-bit order.
    fn traced_mode(n: usize, sea: impl Fn(f64, f64) -> bool) -> String {
        let mut bytes = vec![0u8; (n * n).div_ceil(8)];
        for y in 0..n {
            for x in 0..n {
                if sea((x as f64 + 0.5) / n as f64, (y as f64 + 0.5) / n as f64) {
                    let i = y * n + x;
                    bytes[i >> 3] |= 1 << (i & 7);
                }
            }
        }
        let hex: String = bytes.iter().map(|b| format!("{b:02x}")).collect();
        format!("traced:{n}:{hex}")
    }

    #[test]
    fn open_sea_is_exactly_what_the_shore_returns() {
        let width = 25000.0;
        let west = traced_mode(48, |x, _| x < 0.35);
        let island = traced_mode(48, |x, y| (x - 0.5).hypot(y - 0.5) >= 0.3);
        for (mask, mode, fitted) in [(255, "island", false), (255, "archipelago", false), (255, "peninsula", true), (3, "island", false), (136, "island", true), (1, "island", true), (56, "island", true), (255, west.as_str(), true), (64, island.as_str(), true), (255, island.as_str(), true)] {
            let mut coast = Coast::new(Rng::new("open-sea").fork("coast"), width, 10000.0, 1000.0, 0.0);
            coast.configure(mask, mode).unwrap();
            if fitted {
                coast.fit(&hills(48), 48).unwrap();
            }
            let mut open = 0;
            for y in 0..160 {
                for x in 0..160 {
                    let (px, py) = ((x as f64 + 0.5) * width / 160.0, (y as f64 + 0.5) * width / 160.0);
                    let height = 5.0 + 150.0 * ((x * 7 + y * 3) % 11) as f64 / 11.0;
                    let full = coast.shore(px, py, width, height, 150.0);
                    let quick = coast.apply(px, py, width, height, 150.0);
                    assert_eq!(full.to_bits(), quick.to_bits(), "{mask} {mode} at {x},{y}");
                    open += usize::from(coast.open_sea(px / width, py / width, width, height));
                }
            }
            println!("{mask} {mode}: open sea {:.1}%", open as f64 / 256.0);
        }
    }

    #[test]
    fn a_traced_coast_follows_its_mask() {
        let width = 25000.0;
        let n = 64;
        let relief = hills(n);
        // Signed analytic sea distances for a west sea and a circular island.
        let shapes: [fn(f64, f64) -> f64; 2] = [
            |x, _| 0.35 - x,
            |x, y| (x - 0.5).hypot(y - 0.5) - 0.3,
        ];
        for (shape, distance) in shapes.into_iter().enumerate() {
            let mode = traced_mode(n, |x, y| distance(x, y) > 0.0);
            for seed in 0..3 {
                let mut coast = Coast::new(Rng::new(&format!("traced-coast-{seed}")).fork("coast"), width, 10000.0, 1000.0, 0.0);
                coast.configure(255, &mode).unwrap();
                coast.fit(&hills(48), 48).unwrap();
                let (mut far, mut agree, mut planned_sea, mut actual_sea) = (0, 0, 0, 0);
                for y in 0..n {
                    for x in 0..n {
                        let (px, py) = ((x as f64 + 0.5) / n as f64, (y as f64 + 0.5) / n as f64);
                        let d = distance(px, py);
                        let sea = coast.apply(px * width, py * width, width, relief[y * n + x] as f64, width / n as f64) <= 0.0;
                        planned_sea += usize::from(d > 0.0);
                        actual_sea += usize::from(sea);
                        if d.abs() > 0.12 {
                            far += 1;
                            agree += usize::from(sea == (d > 0.0));
                        }
                    }
                }
                assert!(far > 0 && agree * 100 >= far * 97, "shape {shape}, seed {seed}: {agree}/{far} far cells agree");
                let error = (actual_sea as f64 - planned_sea as f64).abs() / (n * n) as f64;
                assert!(error <= 0.08, "shape {shape}, seed {seed}: sea share error {error}");
            }
        }
    }

    #[test]
    fn west_edge_sea_and_traced_east_bay_are_united() {
        let width = 25000.0;
        let mode = traced_mode(64, |x, y| x > 0.65 && (y - 0.5).abs() < 0.25);
        let mut coast = Coast::new(Rng::new("combined-seas"), width, 10000.0, 1000.0, 0.0);
        coast.configure(1 << 6, &mode).unwrap();
        assert!(coast.parameters[SEA_COUNT] > 0.0);
        assert_eq!(coast.parameters[FIELD_N], 64.0);
        coast.fit(&vec![100.0; 64 * 64], 64).unwrap();
        let sea_at = |x, y| coast.apply(x * width, y * width, width, 100.0, width / 64.0) < 0.0;
        assert!((8..56).any(|y| sea_at(0.01, y as f64 / 64.0)));
        assert!(sea_at(0.95, 0.5));
        assert!(!sea_at(0.5, 0.15));
    }

    #[test]
    fn traced_modes_validate_only_when_active() {
        let mut coast = Coast::new(Rng::new("traced-validation"), 25000.0, 10000.0, 1000.0, 0.0);
        let hex = "00".repeat(32);
        let malformed = [
            "traced:".to_string(), "traced:16".to_string(),
            format!("traced:15:{hex}"), format!("traced:129:{hex}"),
            format!("traced:+16:{hex}"), format!("traced:16:{hex}:extra"),
            "traced:16:00".to_string(), format!("traced:16:{}", "gg".repeat(32)),
            format!("traced:16:{}", "AA".repeat(32)),
            traced_mode(16, |_, _| true),
        ];
        for mode in &malformed {
            assert!(coast.configure(255, mode).is_err(), "{mode}");
            coast.configure(0, mode).unwrap();
            assert!(!coast.active());
            assert_eq!(coast.parameters[FIELD_N], 0.0);
        }
        coast.configure(255, &traced_mode(16, |_, _| false)).unwrap();
        assert!(!coast.active());
        // Every non-zero mask activates a traced plan, even outside direction bits.
        for mask in [1, 255, 256, u32::MAX] {
            coast.configure(mask, &traced_mode(17, |x, _| x < 0.5)).unwrap();
            assert!(coast.traced());
            assert!(!coast.archipelago);
            let seas = coast.parameters[SEA_COUNT] as usize;
            assert_eq!(seas > 0, mask == 1);
            assert_eq!(coast.parameters[FIELD_N], 17.0);
            let field_start = HEADER + seas * SEA_STRIDE;
            assert_eq!(coast.land_start(), field_start + 292);
            assert_eq!(&coast.parameters[field_start + 289..field_start + 292], &[0.0; 3]);
            coast.configure(0, "traced:...").unwrap();
            assert!(!coast.active());
        }
    }

    #[test]
    fn traced_field_preserves_distances_and_extends_map_edges() {
        let n = 17;
        let mode = traced_mode(n, |x, _| x < 0.5);
        let (_, field) = traced_field(&mode).unwrap().unwrap();
        for y in 0..n {
            for x in 0..n {
                let expected = (7.5 - x as f64) / n as f64;
                assert!((field[y * n + x] as f64 - expected).abs() < 1e-7);
            }
        }
        let mut coast = Coast::new(Rng::new("traced-field"), 25000.0, 10000.0, 1000.0, 0.0);
        coast.configure(255, &mode).unwrap();
        assert!((coast.sea_field(0.25, 0.5) - (8.0 / n as f64 - 0.25)).abs() < 1e-7);
        assert_eq!(coast.sea_field(-1.0, -1.0), field[0] as f64);
        assert_eq!(coast.sea_field(2.0, 2.0), field[n * n - 1] as f64);
        // An isolated land cell exercises true Euclidean, rather than grid-path, distance.
        let (_, disc) = traced_field(&traced_mode(n, |x, y| {
            (x - 0.5).abs() > 0.01 || (y - 0.5).abs() > 0.01
        })).unwrap().unwrap();
        assert!((disc[0] as f64 - ((128.0_f64).sqrt() - 0.5) / n as f64).abs() < 1e-7);
        assert_eq!(disc[8 * n + 8], -0.5 / n as f32);
    }

    /// Rolling relief with valleys of several sizes, in metres, on an `n`² grid.
    fn hills(n: usize) -> Vec<f32> {
        (0..n * n).map(|i| {
            let (x, y) = ((i % n) as f64 / n as f64, (i / n) as f64 / n as f64);
            (180.0 + 120.0 * (x * 9.0).sin() * (y * 7.0).cos() + 45.0 * (x * 23.0 + y * 17.0).sin()) as f32
        }).collect()
    }

    /// Sea cells of a fitted coast on the `n`² sampling grid of `relief`.
    fn sea_cells(mask: u32, seed: usize, relief: &[f32], n: usize) -> Vec<bool> {
        let width = 25000.0;
        let mut coast = Coast::new(Rng::new(&format!("coast-share-{seed}")).fork("coast"), width, 10000.0, 1000.0, 0.0);
        coast.configure(mask, "island").unwrap();
        coast.fit(relief, n).unwrap();
        let cell = width / n as f64;
        (0..n * n).map(|i| coast.apply(((i % n) as f64 + 0.5) * cell, ((i / n) as f64 + 0.5) * cell, width, relief[i] as f64, cell) <= 0.0).collect()
    }

    /// A lone south edge is a cove or gulf through part of the bottom side: small, it
    /// reaches the edge, and most draws keep land on both flanks of that side.
    #[test]
    fn a_lone_cardinal_is_a_cove_through_part_of_its_side() {
        let n = 48;
        let relief = hills(n);
        let (mut enclosed, mut shares, mut masks) = (0, Vec::new(), Vec::new());
        let draws = 20;
        for seed in 0..draws {
            let sea = sea_cells(16, seed, &relief, n);
            let share = sea.iter().filter(|&&s| s).count() as f64 / (n * n) as f64;
            let bottom = &sea[(n - 1) * n..];
            let open = bottom.iter().filter(|&&s| s).count();
            assert!(share <= 0.25, "seed {seed}: share {share}");
            assert!(open > 0 && open < n * 7 / 10, "seed {seed}: {open} of {n} bottom cells");
            // No sea along the other sides.
            assert!(sea[..n].iter().all(|&s| !s), "seed {seed}: top side");
            assert!((0..n * 2 / 3).all(|y| !sea[y * n] && !sea[y * n + n - 1]), "seed {seed}: east and west sides");
            let flank = n * 15 / 100;
            enclosed += usize::from(bottom[..flank].iter().chain(&bottom[n - flank..]).all(|&s| !s));
            shares.push(share);
            masks.push(sea);
        }
        assert!(enclosed * 10 >= draws * 7, "{enclosed} of {draws} draws enclosed");
        // The calibration holds the share near its target: the draws differ by their shape.
        let differ = |a: &[bool], b: &[bool]| a.iter().zip(b).filter(|(x, y)| x != y).count();
        assert!(masks[1..].iter().all(|m| differ(m, &masks[0]) * 100 >= n * n), "shares {shares:?}");
    }

    /// SW + S + SE is the whole bottom side; a lone corner stays in its corner.
    #[test]
    fn adjacent_edges_merge_into_one_coast() {
        let n = 48;
        let relief = hills(n);
        for seed in 0..8 {
            let sea = sea_cells(32 | 16 | 8, seed, &relief, n);
            let bottom = sea[(n - 1) * n..].iter().filter(|&&s| s).count();
            assert!(bottom * 10 >= n * 8, "seed {seed}: {bottom} of {n} bottom cells");
            for third in 0..3 {
                assert!(sea[(n - 1) * n + third * n / 3..(n - 1) * n + (third + 1) * n / 3].iter().any(|&s| s), "seed {seed}: third {third}");
            }
            let corner = sea_cells(8, seed, &relief, n);
            assert!(corner[n * n - 1], "seed {seed}: SE corner");
            assert!(!corner[0] && !corner[n - 1] && !corner[(n - 1) * n], "seed {seed}: other corners");
        }
    }
}
