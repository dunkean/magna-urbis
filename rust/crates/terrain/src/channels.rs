//! Fixed geographic drainage corridors: erosion changes slopes, never their topology.
use crate::{Noise, smooth};

/// Half width of the trunk valley floor, and run of its sides, in motifs (symmetric means).
const FLOOR: f64 = 0.065;
const RUN: f64 = 0.32;
/// Share of the mean floor, and of the mean run, a side gains on the inside of a full bend and
/// loses on its outside.
const LEAN_FLOOR: f64 = 0.85;
const LEAN_RUN: f64 = 0.55;
/// Half span (motifs) of the curvature reading, about the valley's half width, and its gain.
const BEND_SPAN: f64 = 0.4;
const BEND_GAIN: f64 = 3.0;

/// Positive where the inside of the bend lies towards growing `across`.
pub(crate) fn valley_turn(along: f64, motif: f64, center: f64, axis: impl Fn(f64) -> f64) -> f64 {
    let h = motif * BEND_SPAN;
    let curvature = (axis(along + h) + axis(along - h) - 2.0 * center) / (h * h);
    (BEND_GAIN * curvature * motif).tanh()
}

/// A bend holds the axis against its outside. On straighter reaches, seeded wander takes over.
pub(crate) fn valley_lean(along: f64, motif: f64, turn: f64, noise: &Noise) -> f64 {
    let wander = (0.9 * noise.fbm(along / (motif * 5.0), 23.9, 2)).clamp(-0.6, 0.6);
    turn + (1.0 - turn.abs()) * wander
}

/// Widen the floor and lengthen the slope on the inside by what the outside loses.
pub(crate) fn valley_wall(offset: f64, floor: f64, run: f64, lean: f64, footprint: f64) -> f64 {
    let toward = if offset < 0.0 { -1.0 } else { 1.0 };
    let side = toward * lean;
    let run = (run * (1.0 + LEAN_RUN * side)).max(footprint);
    smooth((offset.abs() - floor * (1.0 + LEAN_FLOOR * side)) / run)
}

pub(crate) struct Channels {
    motif: f64,
    phase: f64,
    offset: f64,
    first: i32,
    branches: Vec<[Branch; 2]>,
}

struct Branch {
    join: f64,
    across: f64,
    length: f64,
    bend_phase: f64,
}

impl Channels {
    /// Temporary sampling export: header phase/offset/first/count, then branch vec4s.
    pub fn sampling_branches(&self) -> Vec<f32> {
        let mut result = vec![
            self.phase as f32,
            self.offset as f32,
            self.first as f32,
            self.branches.len() as f32,
        ];
        for branches in &self.branches {
            for branch in branches {
                result.extend([
                    branch.join as f32,
                    branch.across as f32,
                    branch.length as f32,
                    branch.bend_phase as f32,
                ]);
            }
        }
        result
    }
    pub fn new(
        motif: f64,
        phase: f64,
        offset: f64,
        extent: f64,
        noise: &Noise,
        noise2: &Noise,
    ) -> Self {
        let count = (extent / (motif * 2.6)).ceil() as i32 + 4;
        let mut result = Self {
            motif,
            phase,
            offset,
            first: -count,
            branches: Vec::new(),
        };
        result.offset -= motif
            * (2.8 * noise.fbm(0.0, phase, 2)
                + 0.65 * noise2.fbm(0.0, 7.1, 2)
                + 0.10 * noise.fbm(0.0, 3.7, 2));
        for index in -count..=count {
            let id = index as f64;
            result.branches.push(std::array::from_fn(|bank| {
                let side = if bank == 0 { -1.0 } else { 1.0 };
                let jitter = noise.noise(id * 1.73 + phase, side * 6.3);
                let join = (id + 0.5 + jitter * 0.28) * motif * 2.6;
                Branch {
                    join,
                    across: result.center(join, noise, noise2),
                    length: motif * (2.5 + 0.8 * noise2.noise(id + phase, side)),
                    bend_phase: noise2.noise(id * 3.1, side * 2.7) * 3.0,
                }
            }));
        }
        result
    }
    fn center(&self, along: f64, noise: &Noise, noise2: &Noise) -> f64 {
        self.offset + self.meander(along, noise, noise2) + self.wiggle(along, noise)
    }
    /// The large meanders of the trunk axis, without its offset and its small wiggle.
    fn meander(&self, along: f64, noise: &Noise, noise2: &Noise) -> f64 {
        self.motif * 2.8 * noise.fbm(along / (self.motif * 12.0), self.phase, 2)
            + self.motif * 0.65 * noise2.fbm(along / (self.motif * 3.2), 7.1, 2)
    }
    fn wiggle(&self, along: f64, noise: &Noise) -> f64 {
        self.motif * 0.10 * noise.fbm(along / self.motif, 3.7, 2)
    }
    /// Turn of the trunk at `along`, -1 to 1, positive where the inside of its bend lies towards
    /// growing `across`: the curvature of its large meanders over the valley's own scale.
    fn turn(&self, along: f64, meander: f64, noise: &Noise, noise2: &Noise) -> f64 {
        valley_turn(along, self.motif, meander, |p| self.meander(p, noise, noise2))
    }
    /// The trunk cross-section `offset` metres from its axis (positive towards growing `across`):
    /// zero over the floor, rising over the side to one. The two sides differ: the inside of a
    /// bend has the wider floor and the gentle slip-off slope, the outside a narrow floor under a
    /// steep cut bank. Their floors and runs keep the symmetric totals, so the valley keeps its
    /// mean width, and the floor still holds the axis (no pit, no step).
    fn trunk(
        &self,
        along: f64,
        offset: f64,
        meander: f64,
        footprint: f64,
        noise: &Noise,
        noise2: &Noise,
    ) -> f64 {
        let (floor, run) = (self.motif * FLOOR, self.motif * RUN);
        let distance = offset.abs();
        // Beyond the widest side the upland is untouched: no lean is drawn there.
        if distance >= floor * (1.0 + LEAN_FLOOR) + (run * (1.0 + LEAN_RUN)).max(footprint) {
            return 1.0;
        }
        let lean = valley_lean(along, self.motif, self.turn(along, meander, noise, noise2), noise2);
        valley_wall(offset, floor, run, lean, footprint)
    }

    /// A normalized cross-section. Zero is the floor, one the surrounding upland.
    pub fn wall(
        &self,
        along: f64,
        across: f64,
        footprint: f64,
        noise: &Noise,
        noise2: &Noise,
    ) -> f64 {
        let floor = self.motif * FLOOR;
        let slope = (self.motif * RUN).max(footprint);
        let meander = self.meander(along, noise, noise2);
        let offset = across - (self.offset + meander + self.wiggle(along, noise));
        let mut wall = self.trunk(along, offset, meander, footprint, noise, noise2);
        let spacing = self.motif * 2.6;
        // Tributaries join the same trunk on both banks and narrow toward their heads.
        // Looking up nearby confluences is bounded independently of map size.
        let cell = (along / spacing).floor() as i32;
        for index in cell - 1..=cell + 2 {
            let Some(branches) = self.branches.get((index - self.first) as usize) else {
                continue;
            };
            for (bank, branch) in branches.iter().enumerate() {
                let side = if bank == 0 { -1.0 } else { 1.0 };
                let join = branch.join;
                let r = side * (across - branch.across);
                let length = branch.length;
                if r < -self.motif * 0.25 || r > length {
                    continue;
                }
                let t = (r / length).max(0.0);
                let bend = self.motif
                    * 0.22
                    * (t * std::f64::consts::PI).sin()
                    * (branch.bend_phase + t * 3.0).sin()
                    * smooth(t / 0.15);
                let branch_along = join - 0.85 * r + bend;
                let d = (along - branch_along).abs() / 1.31;
                let taper = 1.0 - smooth((t - 0.45) / 0.55);
                let branch = smooth((d - floor * 0.65 * taper) / (slope * 0.7));
                // Do not clip an affluent at r=0: that half-plane cut left straight
                // edges across the shoulders even after smoothing the union.
                let entrance = smooth((r + self.motif * 0.25) / (self.motif * 0.25));
                let other = 1.0 - (1.0 - branch) * taper * entrance;
                // Blend intersecting valley shoulders instead of a hard minimum crease.
                // A clipped profile at 1 represents no incision. It must remain
                // neutral, rather than carving a strip from smooth_min(1, 1).
                let width = 0.22 * smooth((1.0 - wall) / 0.15) * smooth((1.0 - other) / 0.15);
                let blend = if width > 1e-9 {
                    ((width - (wall - other).abs()) / width).max(0.0)
                } else {
                    0.0
                };
                wall = (wall.min(other) - width * 0.25 * blend * blend).max(0.0);
            }
        }
        wall
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::rng::Rng;

    /// Distances from the axis at which the trunk section reaches half height, `[below, above]`.
    fn half_widths(c: &Channels, along: f64, noise: &Noise, noise2: &Noise) -> [f64; 2] {
        let meander = c.meander(along, noise, noise2);
        [-1.0, 1.0].map(|toward| {
            let (mut lo, mut hi) = (0.0, 2.0 * c.motif);
            for _ in 0..60 {
                let mid = 0.5 * (lo + hi);
                if c.trunk(along, toward * mid, meander, 0.0, noise, noise2) < 0.5 {
                    lo = mid
                } else {
                    hi = mid
                }
            }
            0.5 * (lo + hi)
        })
    }

    /// On its sharpest bend the trunk valley is wider and gentler inside than outside; along the
    /// whole course its two sides keep the symmetric total width, and the axis stays on the floor.
    #[test]
    fn trunk_valley_leans_into_its_bends_and_keeps_its_mean_width() {
        let root = Rng::new("channels-test");
        let (noise, noise2) = (Noise::new(root.fork("noise")), Noise::new(root.fork("noise2")));
        let motif = 2400.0;
        let c = Channels::new(motif, 0.37, 0.0, 120000.0, &noise, &noise2);
        let symmetric = 2.0 * motif * (FLOOR + 0.5 * RUN);
        let mut sharpest = (0.0_f64, 0.0_f64);
        for k in -600..=600 {
            let along = k as f64 * 100.0;
            let [below, above] = half_widths(&c, along, &noise, &noise2);
            assert!((below + above - symmetric).abs() < 1e-3, "width {} at {along}", below + above);
            let meander = c.meander(along, &noise, &noise2);
            assert_eq!(c.trunk(along, 0.0, meander, 0.0, &noise, &noise2), 0.0, "axis on the floor");
            let turn = c.turn(along, meander, &noise, &noise2);
            if turn.abs() > sharpest.1.abs() {
                sharpest = (along, turn);
            }
        }
        let (along, turn) = sharpest;
        assert!(turn.abs() > 0.5, "no bend on the course: sharpest turn {turn:.2}");
        let [below, above] = half_widths(&c, along, &noise, &noise2);
        let (inside, outside) = if turn > 0.0 { (above, below) } else { (below, above) };
        assert!(inside > 1.1 * outside, "bend at {along}: inside {inside:.0} m, outside {outside:.0} m");
    }
}
