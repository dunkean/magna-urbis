//! Detailed coasts, broad mainland sectors, branched islands and offshore rocks.
//! Signed distance is positive inland; GPU and CPU share this FP32 capsule plan.
use crate::{Noise, Rng, smooth};
use std::f64::consts::TAU;

/// Header floats before the capsules: profile, per-direction reach, character, bumps.
const HEADER: usize = 56;
const BUMPS: usize = 32;
const MAX_BUMPS: usize = 6;

pub(crate) struct Coast {
    rng: Rng,
    pub noise: Noise,
    pub parameters: Vec<f32>,
}

impl Coast {
    pub fn new(rng: Rng, width: f64, motif: f64, amp: f64, marine_datum: f64) -> Self {
        Self {
            noise: Noise::new(rng.fork("shore-noise")),
            rng,
            parameters: vec![
                0.0,
                0.0,
                (motif * 0.070).clamp(35.0, 450.0).min(width * 0.060) as f32 / width as f32,
                (amp * 0.25).clamp(12.0, 250.0) as f32,
                0.0,
                0.0,
                0.0,
                marine_datum as f32,
            ],
        }
    }

    pub fn configure(&mut self, mask: u32, mode: &str) -> Result<(), String> {
        if mask > 255 {
            return Err("Les côtes doivent être un masque de huit directions (0 à 255).".into());
        }
        if !matches!(mode, "island" | "archipelago" | "random" | "peninsula") {
            return Err("Choisissez île, archipel, presqu’île ou aléatoire.".into());
        }
        self.parameters.truncate(8);
        self.parameters.resize(HEADER, 0.0);
        self.parameters[0] = mask as f32;
        self.parameters[1] = 0.0;
        let mut profile = self.rng.fork("mainland-profile");
        let turn = profile.range(-0.15, 0.15);
        self.parameters[4] = profile.range(2.5, 4.5) as f32;
        self.parameters[5] = turn.cos() as f32;
        self.parameters[6] = turn.sin() as f32;
        // Seeded coast character: uneven sea reach per direction, a broad warp
        // and noise amplitudes from smooth sandy bights to ragged rocky shores.
        let mut character = self.rng.fork("coast-character");
        for i in 0..8 {
            // Shore offset from the centre along direction i, and a turn of its shoreline.
            let diagonal = i % 2 == 1;
            self.parameters[8 + i] = if diagonal {
                character.range(0.26, 0.40)
            } else {
                character.range(0.14, 0.34)
            } as f32;
            self.parameters[16 + i] = character.range(-0.30, 0.30) as f32;
        }
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
        if mask == 0 {
            return Ok(());
        }
        let mut rng = self.rng.fork("shape-v2");
        let peninsula = mode == "peninsula";
        let archipelago = !peninsula
            && (mode == "archipelago" || (mode == "random" && self.rng.fork("mode").float() < 0.5));
        if mask == 255 && peninsula {
            self.peninsula(&mut rng);
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
        // Bays could sever an isthmus; islands only take small coves and points.
        if !archipelago && !(mask == 255 && peninsula) {
            self.shore_features(&mut rng, mask != 255);
        }
        // Detached rocks near the actual shore, including beside peninsulas.
        let wanted = if mask == 255 && archipelago {
            18 + (rng.float() * 15.0) as usize
        } else {
            6 + (rng.float() * 9.0) as usize
        };
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
                if size_class < 0.6 {
                    sizes.range(0.0025, 0.0085)
                } else if size_class < 0.9 {
                    sizes.range(0.009, 0.023)
                } else {
                    sizes.range(0.025, 0.045)
                }
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
            let (distance, _, _, _) = self.distance(x, y, 0.0);
            if !(-clearance - 0.045..-clearance).contains(&distance)
                || islets
                    .iter()
                    .any(|&(ix, iy, ir)| (x - ix).hypot(y - iy) < (r + ir) * 2.2 + 0.007)
            {
                continue;
            }
            if (0..8).any(|i| {
                let angle = i as f64 * TAU / 8.0;
                self.distance(x + r * 2.2 * angle.cos(), y + r * 2.2 * angle.sin(), 0.0)
                    .0
                    > -0.003
            }) {
                continue;
            }
            let turn = rng.range(0.0, TAU);
            self.islet(&mut rng, x, y, r, turn);
            islets.push((x, y, r));
            target_attempts = 0;
        }
        Ok(())
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

    /// A landmass joined to one map edge by a narrow, crooked isthmus that
    /// lands on a sliver of continental shore: little access by land.
    fn peninsula(&mut self, rng: &mut Rng) {
        let side = (rng.float() * 4.0) as usize % 4;
        let (nx, ny) = [(0.0, -1.0), (1.0, 0.0), (0.0, 1.0), (-1.0, 0.0)][side];
        let (tx, ty) = (-ny, nx);
        let along = rng.range(-0.22, 0.22);
        let radius = rng.range(0.27, 0.34);
        let push = rng.range(0.04, 0.10);
        let (cx, cy) = (
            0.5 - nx * push + tx * along * 0.4,
            0.5 - ny * push + ty * along * 0.4,
        );
        let arms = 1 + (rng.float() * 2.0) as usize;
        self.body(rng, cx, cy, radius, arms);
        let neck = rng.range(0.026, 0.04);
        let phase = rng.range(0.0, 100.0);
        let shore = (0.5 + tx * along + nx * 0.5, 0.5 + ty * along + ny * 0.5);
        let start = (cx + nx * radius * 0.45, cy + ny * radius * 0.45);
        let mut last = start;
        let steps = 3;
        for j in 1..=steps {
            let t = j as f64 / steps as f64;
            let bend = if j == steps {
                0.0
            } else {
                rng.range(-0.07, 0.07)
            };
            let next = (
                start.0 + (shore.0 + nx * 0.06 - start.0) * t + tx * bend,
                start.1 + (shore.1 + ny * 0.06 - start.1) * t + ty * bend,
            );
            let ra = if j == 1 { neck * 1.5 } else { neck };
            let rb = if j == steps { neck * 1.7 } else { neck };
            self.capsule(last, next, ra, rb, neck * 3.0, phase);
            last = next;
        }
        // The continent itself mostly lies beyond the frame.
        let reach = rng.range(0.14, 0.30);
        let (ox, oy) = (shore.0 + nx * 0.10, shore.1 + ny * 0.10);
        let (a, b) = (rng.range(0.6, 1.2), rng.range(0.6, 1.2));
        self.capsule(
            (ox - tx * reach * a, oy - ty * reach * a),
            (ox + tx * reach * b, oy + ty * reach * b),
            0.14,
            0.14,
            0.22,
            phase + 7.0,
        );
    }

    /// Seeded bays (negative) and headlands (positive) centred on the shore
    /// drawn so far, so that no two seeds share one caricatural outline.
    fn shore_features(&mut self, rng: &mut Rng, mainland: bool) {
        let count = 2 + (rng.float() * 5.0) as usize;
        let inside = self.distance(0.5, 0.5, 0.0).0 > 0.0;
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
                    && (self.distance(x, y, 0.0).0 > 0.0) != inside
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
            rng.range(0.45, 1.5) * (self.depth() * 0.8).clamp(10.0, 70.0)
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
    pub fn depth(&self) -> f64 {
        self.parameters[3] as f64
    }

    fn distance(&self, x: f64, y: f64, footprint: f64) -> (f64, f64, f64, f64) {
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
            // Each sea direction is a seeded shoreline (offset and turn); smooth
            // union of the seas, so corners between two coasts stay rounded.
            let mut shore = 10.0_f64;
            for i in 0..8 {
                if mask & (1 << i) == 0 {
                    continue;
                }
                let angle = i as f64 * TAU / 8.0 + at(16 + i);
                let d = at(8 + i) - ((wx - 0.5) * angle.sin() - (wy - 0.5) * angle.cos());
                let h = (0.12 - (shore - d).abs()).max(0.0) / 0.12;
                shore = shore.min(d) - h * h * 0.03;
            }
            let (large, ls, fine, fs) = (at(26), at(27), at(28), at(29));
            distance = shore
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
        for i in 0..at(1) as usize {
            let j = HEADER + i * 12;
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

    pub fn apply(&self, x: f64, y: f64, width: f64, height: f64, footprint: f64) -> f64 {
        if !self.active() {
            return height;
        }
        // Coastal plains should not stand on their inland formula's constant
        // pedestal. Express elevations above the marine datum, with a smooth
        // positive floor so low pockets retain the selected coast geography.
        let datum = self.parameters[7] as f64;
        let height = if datum > 0.0 {
            let relative = height - datum;
            0.3 + 0.5 * (relative + (relative * relative + 1.0).sqrt())
        } else {
            height
        };
        let (distance, scale, islet_height, apron) =
            self.distance(x / width, y / width, footprint / width);
        let height = if islet_height > 0.0 {
            islet_height
        } else {
            height
        };
        // Alternate gentler shores and rocky cliffs, without tapering entire islands.
        let cliff =
            smooth((self.noise.fbm(x / (width * 0.12), y / (width * 0.12), 3) - 0.20) / 0.25);
        let width_variation = 0.65
            + 1.1
                * smooth(
                    self.noise
                        .fbm(x / (width * 0.21) + 11.7, y / (width * 0.21) - 4.2, 3)
                        + 0.5,
                );
        let ramp = (self.parameters[2] as f64)
            .max(height / (width * 0.45))
            .min(scale * 0.18)
            * width_variation
            * apron
            * (1.0 - 0.90 * cliff);
        if distance <= 0.0 {
            -self.depth() * smooth(-distance / (ramp * 4.0))
        } else {
            height * smooth(distance / ramp)
        }
    }
}
