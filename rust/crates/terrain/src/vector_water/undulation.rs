//! Hollows of a marsh before the conditioning. A marsh keeps ponds in its hollows, and the water budget needs real
//! basins for them: this stage digs them, as the negative half of a noise, and leaves the ground between them level
//! (the hollows no pond keeps are silted level again by the conditioning). Only the wetland zone asks for it: on other
//! ground, an undulated surface showed as rippled farmland, and the courses wind by their meander seeds instead.
//! - three octaves of simplex noise, each turned by its own angle (no axis is shared with the grid), from six cells
//!   of the erosion grid (120 m at least) up;
//! - a depth set by the gradient it adds, `LEVEL` on level ground, growing with the local slope up to `MOST`;
//! - nothing under half a metre above the sea, and a fade over the next four metres: the coast does not move.
//! The change is part of the conditioning delta, so the displayed ground shows the hollows the ponds stand in.
use crate::noise::Noise;
use crate::rng::Rng;

/// Gradient added on level ground.
const LEVEL: f64 = 0.003;
/// Share of the local slope added to it, and the largest gradient added.
const SLOPE_SHARE: f64 = 0.35;
const MOST: f64 = 0.010;
/// Wavelength ratios and turns (radians) of the octaves.
const OCTAVES: [(f64, f64); 3] = [(1.0, 0.41), (2.1, 1.53), (4.3, 2.77)];

/// Shortest wavelength of the undulations (m): six cells of the grid the conditioning erodes on (512 at most).
pub(super) fn base_wavelength(n: usize, width: f64) -> f64 {
    (6.0 * width / n.min(512) as f64).max(120.0)
}

/// `height` with the undulations of `strength` (1: the default) added. The draw only depends on `seed`.
pub(super) fn undulate(height: &[f32], n: usize, width: f64, seed: &str, strength: f64) -> Vec<f32> {
    let mut out = height.to_vec();
    if n < 8 || strength <= 0.0 {
        return out;
    }
    let cell = width / n as f64;
    let noise = Noise::new(Rng::new(&format!("undulation:{seed}")));
    let base = base_wavelength(n, width);
    crate::terrain_par::rows(&mut out, n, |y, row| {
        for x in 0..n {
            let h = height[y * n + x] as f64;
            if h <= 0.5 {
                continue;
            }
            let (x0, x1, y0, y1) = (x.saturating_sub(2), (x + 2).min(n - 1), y.saturating_sub(2), (y + 2).min(n - 1));
            let gx = (height[y * n + x1] as f64 - height[y * n + x0] as f64) / ((x1 - x0) as f64 * cell);
            let gy = (height[y1 * n + x] as f64 - height[y0 * n + x] as f64) / ((y1 - y0) as f64 * cell);
            let gradient = (LEVEL + SLOPE_SHARE * gx.hypot(gy)).min(MOST);
            let t = ((h - 0.5) / 4.0).min(1.0);
            let shore = t * t * (3.0 - 2.0 * t);
            let (wx, wy) = ((x as f64 + 0.5) * cell, (y as f64 + 0.5) * cell);
            let mut v = 0.0;
            for (k, &(ratio, turn)) in OCTAVES.iter().enumerate() {
                let l = base * ratio;
                let (s, c) = turn.sin_cos();
                // Amplitude: a quarter of the gradient times the geometric mean of this wavelength and the shortest.
                v += (l * base).sqrt() * noise.noise((wx * c - wy * s) / l + 17.3 * k as f64, (wx * s + wy * c) / l - 9.1 * k as f64)
            }
            // Hollows only: the ground between them stays where it was.
            row[x] = (h + 0.25 * strength * gradient * shore * v.min(0.0)) as f32
        }
    });
    out
}

/// Lakes beyond the basins of the relief: the `lakes` setting above 2, with `extra` = (lakes - 2) / 2 from 0 to 1.
/// At 2 the conditioning keeps every suitable basin and has no more to give, and a relief without basins (a plain, the
/// hills of a 40 km map) has none: this digs bowls that become lakes. They are sized like lakes, not ponds: a radius of
/// 3 % of the map width (150 to 900 m, ±30 %), about 3 + 0.012 per km² of them at `extra` 1 (4 on a 10 km map, 22 on a
/// 40 km one), each a smooth bowl 3 to 5 m deep with an uneven outline. They are only dug on nearly level ground (under
/// 1 % across the bowl, and deep enough to close there), away from the sea and from each other: no lake on a slope.
/// Hollows only, as the marsh hollows: the conditioning keeps them as lakes (`kept_lakes`), or silts them level.
pub(super) fn lake_hollows(height: &[f32], n: usize, width: f64, seed: &str, extra: f64) -> Vec<f32> {
    let mut out = height.to_vec();
    let extra = extra.clamp(0.0, 1.0);
    if n < 16 || extra <= 0.0 {
        return out;
    }
    let cell = width / n as f64;
    let km2 = (width / 1000.0).powi(2);
    let count = (extra * (3.0 + 0.012 * km2)).round() as usize;
    let mut rng = Rng::new(&format!("lake-hollows:{seed}"));
    let sample = |x: f64, y: f64| {
        let (i, j) = ((x / cell).floor().clamp(0.0, (n - 1) as f64) as usize, (y / cell).floor().clamp(0.0, (n - 1) as f64) as usize);
        height[j * n + i] as f64
    };
    let mut sites: Vec<(f64, f64, f64)> = Vec::new();
    for _ in 0..count {
        for _ in 0..12 {
            let r = (0.03 * width).clamp(150.0, 900.0) * rng.range(0.7, 1.3);
            let (x, y) = (rng.range(2.0 * r, width - 2.0 * r), rng.range(2.0 * r, width - 2.0 * r));
            if x >= width - 2.0 * r || y >= width - 2.0 * r || sites.iter().any(|&(sx, sy, sr)| (sx - x).hypot(sy - y) < 2.0 * (r + sr)) {
                continue;
            }
            let z = sample(x, y);
            let rim = [(r, 0.0), (-r, 0.0), (0.0, r), (0.0, -r), (0.7 * r, 0.7 * r), (-0.7 * r, 0.7 * r), (0.7 * r, -0.7 * r), (-0.7 * r, -0.7 * r)];
            let (low, high) = rim.iter().fold((f64::INFINITY, f64::NEG_INFINITY), |(lo, hi), &(dx, dy)| {
                let v = sample(x + dx, y + dy);
                (lo.min(v), hi.max(v))
            });
            if z <= 2.0 || low <= 2.0 || (high - low) / (2.0 * r) > 0.01 {
                continue;
            }
            sites.push((x, y, r));
            break;
        }
    }
    for &(x, y, r) in &sites {
        // Deep enough to close on the slope across it, 3 to 5 m below that.
        let tilt = {
            let rim = [(r, 0.0), (-r, 0.0), (0.0, r), (0.0, -r)];
            let v: Vec<f64> = rim.iter().map(|&(dx, dy)| sample(x + dx, y + dy)).collect();
            v.iter().cloned().fold(f64::NEG_INFINITY, f64::max) - v.iter().cloned().fold(f64::INFINITY, f64::min)
        };
        let depth = (rng.range(3.0, 5.0) + tilt).min(12.0);
        let (p1, p2, a1, a2) = (rng.range(0.0, std::f64::consts::TAU), rng.range(0.0, std::f64::consts::TAU), rng.range(0.08, 0.2), rng.range(0.04, 0.1));
        let reach = 1.3 * r;
        let (i0, i1) = (((x - reach) / cell).floor().max(0.0) as usize, (((x + reach) / cell).ceil() as usize).min(n - 1));
        let (j0, j1) = (((y - reach) / cell).floor().max(0.0) as usize, (((y + reach) / cell).ceil() as usize).min(n - 1));
        for j in j0..=j1 {
            for i in i0..=i1 {
                let c = j * n + i;
                let h = height[c] as f64;
                if h <= 0.5 {
                    continue;
                }
                let (dx, dy) = ((i as f64 + 0.5) * cell - x, (j as f64 + 0.5) * cell - y);
                let angle = dy.atan2(dx);
                let edge = r * (1.0 + a1 * (2.0 * angle + p1).sin() + a2 * (3.0 * angle + p2).sin());
                let u = dx.hypot(dy) / edge;
                if u >= 1.0 {
                    continue;
                }
                let t = ((h - 0.5) / 4.0).min(1.0);
                let dug = h - depth * (1.0 - u * u).powi(2) * t * t * (3.0 - 2.0 * t);
                if (dug as f32) < out[c] {
                    out[c] = dug as f32
                }
            }
        }
    }
    out
}

#[cfg(test)]
mod tests {
    use super::*;
    /// The sea and the shore do not move, the draw is stable, no ground is raised, and the hollows are decimetres deep.
    #[test]
    fn undulations_are_small_seeded_and_leave_the_sea() {
        let (n, width) = (128_usize, 2560.0);
        let height: Vec<f32> = (0..n * n).map(|c| if c % n < 20 { -3.0 } else { 0.4 + 0.02 * (c % n - 20) as f32 }).collect();
        let a = undulate(&height, n, width, "s", 1.0);
        assert_eq!(a, undulate(&height, n, width, "s", 1.0));
        assert_ne!(a, undulate(&height, n, width, "t", 1.0));
        assert_eq!(height, undulate(&height, n, width, "s", 0.0));
        let mut most = 0.0_f32;
        for c in 0..n * n {
            if height[c] <= 0.5 {
                assert_eq!(a[c], height[c], "sea and shore untouched");
            }
            assert!(height[c] <= 0.0 || a[c] > 0.0, "land stays land");
            assert!(a[c] <= height[c], "hollows only: no ground is raised");
            most = most.max((a[c] - height[c]).abs());
        }
        assert!(most > 0.03 && most < 1.0, "undulation of {most} m");
    }

    /// Invariants of the lake bowls: nothing at `extra` 0, hollows only, more of them with `extra`, none on a slope
    /// steeper than 1 %, and each a closed basin on a level plain.
    #[test]
    fn lake_hollows_are_closed_bowls_on_level_ground_only() {
        let (n, width) = (256_usize, 10_000.0);
        let plain: Vec<f32> = (0..n * n).map(|c| 20.0 + 0.0005 * (c % n) as f32 * (width / n as f64) as f32).collect();
        let slope: Vec<f32> = (0..n * n).map(|c| 20.0 + 0.03 * (c % n) as f32 * (width / n as f64) as f32).collect();
        assert_eq!(lake_hollows(&plain, n, width, "s", 0.0), plain);
        let dug = |h: &[f32], e: f64| lake_hollows(h, n, width, "s", e).iter().zip(h).filter(|(a, b)| a < b).count();
        let (half, full) = (dug(&plain, 0.5), dug(&plain, 1.0));
        assert!(half > 0 && full > half, "more bowls with the setting: {half} then {full} cells");
        assert_eq!(dug(&slope, 1.0), 0, "no bowl on a 3 % slope");
        let out = lake_hollows(&plain, n, width, "s", 1.0);
        assert!(out.iter().zip(&plain).all(|(a, b)| a <= b), "hollows only");
        let filled = crate::priority_flood::flood_surface(&out, n, false).filled;
        let deepest = (0..n * n).map(|c| filled[c] as f64 - out[c] as f64).fold(0.0, f64::max);
        assert!(deepest > 2.0, "the bowls close: {deepest:.2} m of water at most");
    }
}
