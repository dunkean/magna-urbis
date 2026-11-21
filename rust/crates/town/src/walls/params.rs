//! The parameter trace: stiffness, terrain adherence and the crest limit applied to a
//! traced circuit. Simplification is metric and steep or wet shortcuts are refused.

use std::collections::HashMap;

use magna_urbis_geom::{self as g, Point, Shape, surface::TerrainView};

use super::geometry::{
    MAX_GRADE, V, add, area_of, clear_within, closed, dir, dist, normals, segment_clear, wet_run,
};

/// Simplification tolerance added at full stiffness, in metres (classic `trace.stiffDeviationM`).
const STIFF_DEVIATION: f64 = 36.0;
/// How far a sample may move outward towards a break of slope at full adherence (`trace.terrainReachM`).
const TERRAIN_REACH: f64 = 32.0;
/// Spacing of the samples taken along the circuit, in metres.
const SAMPLE_STEP: f64 = 16.0;

/// The charter's regularity controls for one circuit.
#[derive(Clone, Copy, Debug, PartialEq)]
pub struct Regularity {
    /// Pull toward straight runs and distinct corners (0–1).
    pub stiffness: f64,
    /// Pull of the samples toward a break of slope (0–1).
    pub adherence: f64,
    /// Height in metres a straight run may rise above its higher end.
    pub crest_limit: f64,
    /// Whether the curtain is drawn to a bank within 80 m outward.
    pub bank_walls: bool,
    /// Curtain width in metres, kept clear of the water outside it.
    pub curtain_width: f64,
}

/// Regularise a closed circuit. Stiffness sets a simplification tolerance of
/// 1.5 + 36·s² m and keeps at least 99 − 14·s % of the land inside; a straight run
/// that would cross a crest above the limit, or more water than the founding line
/// between its ends, keeps the founding samples under it instead. Adherence first
/// moves each dry sample outward toward the nearest break of slope. Returns the
/// circuit unchanged when no control applies or no simplification is valid.
pub fn parameter_trace(shape: Shape, terrain: &dyn TerrainView, r: &Regularity) -> Shape {
    if (r.stiffness == 0.0 && r.adherence == 0.0 && !r.bank_walls) || shape.outer.len() < 3 {
        return shape;
    }
    let points = samples(&shape, terrain, r);
    let n = points.len() - 1;
    let bits = |p: Point| [p.x.to_bits(), p.y.to_bits()];
    let mut index: HashMap<[u64; 2], usize> = HashMap::with_capacity(n);
    for (i, &p) in points[..n].iter().enumerate() {
        index.entry(bits(p)).or_insert(i);
    }
    let index_of = |p: Point| index.get(&bits(p)).copied();
    // Wet length of each founding step, summed along the arc a run replaces.
    let step_wet: Vec<f64> = (0..n)
        .map(|k| wet_run(terrain, points[k], points[k + 1]))
        .collect();
    // The founding arc a run replaces is the shorter way round: normalisation may
    // have reversed the candidate ring.
    let arc = |i: usize, j: usize| {
        if (j + n - i) % n <= (i + n - j) % n {
            (i, j)
        } else {
            (j, i)
        }
    };
    let wetter = |i: usize, j: usize| {
        let (mut k, end) = arc(i, j);
        let mut along = 0.0;
        while k != end {
            along += step_wet[k];
            k = (k + 1) % n;
        }
        wet_run(terrain, points[i], points[j]) > along + 4.0
    };
    // A run made only of kept founding samples is the founding line itself.
    let founding = |i: usize, j: usize, kept: &[bool]| {
        if (i + 1) % n == j || (j + 1) % n == i {
            return true;
        }
        let (mut k, end) = arc(i, j);
        let mut all = kept[end];
        while k != end {
            all &= kept[k];
            k = (k + 1) % n;
        }
        all
    };
    let min_inside = g::area(&shape) * (0.99 - 0.14 * r.stiffness);
    let mut epsilon = 1.5 + STIFF_DEVIATION * r.stiffness.powi(2);
    while epsilon >= 0.1 {
        let mut kept = vec![false; n];
        for _ in 0..16 {
            let mut outer = g::simplify(&points, epsilon, |p| index_of(p).is_some_and(|i| kept[i]));
            outer.pop();
            let candidate = g::normalized(Shape {
                outer,
                holes: shape.holes.clone(),
            });
            if !(candidate.outer.len() >= 3
                && g::simple(&candidate)
                && area_of(&g::intersection(&candidate, &shape)) >= min_inside)
            {
                break;
            }
            let ring = closed(&candidate.outer);
            let bad: Vec<(usize, usize)> = ring
                .windows(2)
                .filter_map(|w| {
                    let (i, j) = (index_of(w[0])?, index_of(w[1])?);
                    let blocked = !clear_within(terrain, w[0], w[1], r.crest_limit) || wetter(i, j);
                    (blocked && !founding(i, j, &kept)).then_some((i, j))
                })
                .collect();
            if bad.is_empty() {
                return candidate;
            }
            let before = kept.iter().filter(|&&k| k).count();
            for (i, j) in bad {
                let (mut k, end) = arc(i, j);
                while k != end {
                    kept[k] = true;
                    k = (k + 1) % n;
                }
                kept[end] = true;
            }
            if kept.iter().filter(|&&k| k).count() == before {
                break;
            }
        }
        epsilon *= 0.5;
    }
    shape
}

/// Samples every 16 m along the circuit, each dry one moved by adherence and by the
/// bank rule; the ring is closed (last sample = first).
fn samples(shape: &Shape, terrain: &dyn TerrainView, r: &Regularity) -> Vec<Point> {
    let path = closed(&shape.outer);
    let ns = normals(&path);
    let reach = TERRAIN_REACH * r.adherence;
    let mut points = vec![];
    for (i, w) in path.windows(2).enumerate() {
        let len = dist(w[0], w[1]);
        let steps = (len / SAMPLE_STEP).ceil().max(1.0) as usize;
        for k in 0..steps {
            let p = add(w[0], dir(w[0], w[1]), len * k as f64 / steps as f64);
            if terrain.wet(p) {
                points.push(p);
                continue;
            }
            let mut best = if reach > 0.0 {
                toward_break(terrain, p, ns[i], reach, r)
            } else {
                p
            };
            if r.bank_walls
                && let Some(q) = toward_bank(terrain, p, ns[i], r.curtain_width)
            {
                best = q;
            }
            points.push(best);
        }
    }
    points.push(points[0]);
    points
}

/// The best of five stations up to `reach` metres outward: a sharper break of slope
/// (high ground falling away outside) earns more, distance costs a little; the
/// curtain and its footing must stay dry and the step to the station walkable.
fn toward_break(terrain: &dyn TerrainView, p: Point, n: V, reach: f64, r: &Regularity) -> Point {
    let (mut best, mut score) = (p, 0.0);
    for j in 0..=4 {
        let off = reach * j as f64 / 4.0;
        let q = add(p, n, off);
        if !segment_clear(terrain, p, q, MAX_GRADE) || terrain.wet(add(q, n, r.curtain_width + 2.0))
        {
            continue;
        }
        let h = terrain.height_at(q);
        let inside = terrain.height_at(add(q, n, -12.0));
        let outside = terrain.height_at(add(q, n, 12.0));
        let merit = r.adherence * ((h - outside).max(0.0) + (inside - 2.0 * h + outside).abs())
            / 12.0
            - off * 0.004;
        if merit > score {
            score = merit;
            best = q;
        }
    }
    best
}

/// The station just short of the first water within 80 m outward, leaving room for
/// the curtain, when the ground there is walkable from `p`.
fn toward_bank(terrain: &dyn TerrainView, p: Point, n: V, width: f64) -> Option<Point> {
    let d = (1..=40)
        .map(|k| k as f64 * 2.0)
        .find(|&d| terrain.wet(add(p, n, d)))?;
    let q = add(p, n, (d - width - 2.0).max(0.0));
    segment_clear(terrain, p, q, MAX_GRADE).then_some(q)
}
