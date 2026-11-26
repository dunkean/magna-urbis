//! Terrain-aware land budget of a steep site.
//!
//! The house slope gate (`profiles::house_slope`, applied per block by the
//! programme on `BlockEnvironment::slope`) refuses the steep part of a site.
//! This module measures, before anything is drawn, how much of the land a town
//! would take passes that gate at each relaxation level, with the gate's own
//! statistic: the steepest rise from a block's centre to its rim, here a ring
//! of a typical block's size. From that field the capacity forecast counts
//! only the housable land, the relaxation is chosen in the first pass, and the
//! accessible growth takes flat land first and stops once it holds the
//! households.
//!
//! Ordinary ground never enters this path: it runs only where the strict gate
//! refuses more than `1 - REFUSAL` of the land (`Survey::refused`).
use super::super::{LayoutConfig, Point, Site, Surface, profiles};
use std::f64::consts::TAU;

/// Relaxation levels of the house slope gate, strict first, then the steps of
/// the flank ladder (`profiles::SLOPE_RELAX_STEPS`).
pub(super) const LEVELS: [f64; 4] = [
    0.0,
    profiles::SLOPE_RELAX_STEPS[0],
    profiles::SLOPE_RELAX_STEPS[1],
    profiles::SLOPE_RELAX_STEPS[2],
];
/// Share of the land the strict gate must admit for the site to count as
/// ordinary ground (the layout is then untouched): the goal of the measured
/// fallback (`generate_quarters`), since the land is measured where the
/// growth really takes it (`generate`), block by block as the programme does.
pub(super) const REFUSAL: f64 = profiles::SLOPE_RELAX_GOAL;
/// Directions of the block-scale slope ring.
const RING: usize = 8;
/// Ring radius over the square root of the typical block area: a block's rim
/// lies between its half-width and its half-diagonal from its centroid.
const RING_SCALE: f64 = 0.6;
/// Growth cost premium of a cell the strict gate refuses but the town's
/// relaxed gate admits (terraced land), and of a cell no house may use.
const RELAXED_PREMIUM: f64 = 0.5;
const REFUSED_PREMIUM: f64 = 2.0;

/// The house slope gate of a town, measured at block scale.
#[derive(Clone, Copy, Debug)]
pub(super) struct Gate {
    /// Strict limit of the culture's houses (terraced cultures included).
    pub strict: f64,
    /// Limit at the town's relaxation (`ProgrammeContext::slope_relax`).
    pub limit: f64,
    /// Ring radius (m) of the block-scale slope.
    pub reach: f64,
}
impl Gate {
    /// None when the culture has no house admissibility (no gate to measure).
    pub fn new(site: &Site, cfg: &LayoutConfig, block: f64) -> Option<Self> {
        let culture = if cfg.culture == "site" { &site.culture } else { &cfg.culture };
        let native = super::super::culture::mapping_for(culture, &cfg.programme.period)?.admissibility.max_slope;
        if !native.is_finite() {
            return None;
        }
        let strict = profiles::house_slope(culture, native, 0.0);
        let block = if block.is_finite() && block > 0.0 { block } else { 2500.0 };
        Some(Self {
            strict,
            limit: profiles::relaxed(strict, cfg.programme.slope_relax),
            reach: (RING_SCALE * block.sqrt()).clamp(12.0, 120.0),
        })
    }
    /// Limit at a relaxation level.
    pub fn at(&self, relax: f64) -> f64 {
        profiles::relaxed(self.strict, relax)
    }
    pub fn block_side(&self) -> f64 {
        self.reach / RING_SCALE
    }
    /// Growth cost factor of a cell of block-scale slope `s`: flat land first,
    /// then the land the relaxed gate admits, then land no house uses.
    pub fn premium(&self, s: f64) -> f64 {
        let relaxed = if s > self.strict { RELAXED_PREMIUM } else { 0.0 };
        let refused = if s > self.limit { REFUSED_PREMIUM } else { 0.0 };
        1.0 + relaxed + refused
    }
}

/// Block-scale slope at `p`: the steepest rise from `p` to a ring of radius
/// `reach`, as `programme::prepare` reads a block (rim vertex against centroid).
pub(in crate::urban) fn block_slope(surface: Surface<'_>, p: Point, reach: f64) -> f64 {
    let h = surface.height_at(p);
    let r = reach.max(1.0);
    (0..RING)
        .map(|k| {
            let a = k as f64 * TAU / RING as f64;
            let q = Point { x: p.x + r * a.cos(), y: p.y + r * a.sin() };
            (surface.height_at(q) - h).abs() / r
        })
        .fold(0.0, f64::max)
}

/// Housable shares of the land a town would take.
#[derive(Clone, Copy, Debug)]
pub(super) struct Survey {
    pub gate: Gate,
    /// Share of the dry land within the gate at each of `LEVELS`.
    pub levels: [f64; 4],
    /// Share at the town's own relaxation (`Gate::limit`).
    pub level: f64,
}
impl Survey {
    /// The strict gate refuses the land: the terrain-aware path runs.
    pub fn refused(&self) -> bool {
        self.levels[0] < REFUSAL
    }
    /// Lowest relaxation at which the houses may use the goal share of the
    /// land (`profiles::SLOPE_RELAX_GOAL`); 0 on ground the strict gate admits.
    pub fn relaxation(&self) -> f64 {
        if !self.refused() {
            return 0.0;
        }
        LEVELS
            .iter()
            .zip(self.levels)
            .find(|&(_, share)| share >= profiles::SLOPE_RELAX_GOAL)
            .map_or(1.0, |(&level, _)| level)
    }
}

/// Survey of dry sample cells (centres of square cells of half-size `half`):
/// each cell is read at its centre and four inner points, a point counting
/// when its block-scale slope is within the limit.
pub(super) fn survey(surface: Surface<'_>, cells: &[Point], half: f64, gate: Gate) -> Option<Survey> {
    let d = half * 0.5;
    let points = cells
        .iter()
        .flat_map(|c| [(0.0, 0.0), (d, 0.0), (-d, 0.0), (0.0, d), (0.0, -d)].map(|(dx, dy)| Point { x: c.x + dx, y: c.y + dy }));
    tally(surface, points, gate)
}
/// Shares of dry sample points (equal land each) within the gate's limits.
pub(super) fn tally(surface: Surface<'_>, points: impl Iterator<Item = Point>, gate: Gate) -> Option<Survey> {
    let limits = [gate.at(LEVELS[0]), gate.at(LEVELS[1]), gate.at(LEVELS[2]), gate.at(LEVELS[3]), gate.limit];
    let mut counts = [0usize; 5];
    let mut samples = 0;
    for p in points {
        samples += 1;
        let s = block_slope(surface, p, gate.reach);
        for (count, &limit) in counts.iter_mut().zip(&limits) {
            *count += usize::from(s <= limit);
        }
    }
    if samples == 0 { return None; }
    let share = |k: usize| counts[k] as f64 / samples as f64;
    Some(Survey {
        gate,
        levels: [share(0), share(1), share(2), share(3)],
        level: share(4),
    })
}

/// Housable-land target of the accessible growth on a refused site.
#[derive(Clone, Copy, Debug)]
pub(super) struct Flood {
    pub gate: Gate,
    /// Housable land (m²) the footprint gathers before it stops: the target
    /// area times the housable share the capacity forecast counted on.
    pub goal: f64,
}

#[cfg(test)]
mod tests {
    use super::*;

    fn plane(grade: f64) -> Surface<'static> {
        let n = 64;
        let height: Vec<f32> = (0..n * n).map(|i| ((i % n) as f64 * 4000.0 / n as f64 * grade) as f32).collect();
        Surface { geometry: None, width: 4000.0, n, height: height.leak(), water: vec![0u8; n * n].leak(), interpolation: Default::default() }
    }

    #[test]
    fn flat_land_keeps_the_strict_gate_and_a_flank_reads_its_relaxation() {
        let site = Site { key: "t".into(), name: String::new(), population: 10_000, culture: "halfling".into(),
            center: Point { x: 2000.0, y: 2000.0 }, radius: 700.0,
            neighbours: Vec::new(), };
        let cfg = LayoutConfig { culture: "site".into(), ..LayoutConfig::default() };
        let gate = Gate::new(&site, &cfg, 2500.0).expect("houses have a slope gate");
        let cells: Vec<Point> = (0..9).map(|k| Point { x: 1800.0 + 50.0 * k as f64, y: 2000.0 }).collect();
        let flat = survey(plane(0.0), &cells, 25.0, gate).unwrap();
        assert_eq!(flat.levels, [1.0; 4]);
        assert!(!flat.refused());
        assert_eq!(flat.relaxation(), 0.0);
        // Steeper than the strict gate, within the gate relaxed by half.
        let flank = survey(plane(1.4 * gate.strict), &cells, 25.0, gate).unwrap();
        assert!(flank.refused());
        assert_eq!(flank.relaxation(), LEVELS[1]);
        assert!(gate.premium(1.4 * gate.strict) > gate.premium(0.0));
    }
}
