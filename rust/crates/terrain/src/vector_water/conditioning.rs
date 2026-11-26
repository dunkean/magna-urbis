use super::{Heap, Hydrology, downsample, hydrology, neighbours, upsample_delta};
use serde::{Deserialize, Serialize};
#[derive(Clone, Default, Deserialize, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct Conditioning {
    pub mode: String,
    pub strength: f64,
    pub max_depth: f64,
    pub max_length: f64,
    /// Bank profile of a breach (the `condBanks` setting): `valley` (the default, also when absent) gives it gentle
    /// sides that reach as far as its depth needs; `step` keeps the bed and its short talus under the untouched relief.
    #[serde(default)]
    pub banks: String,
    /// Share of the closed depressions kept as lakes instead of being breached or filled, 0 (none) to 2 (every
    /// suitable one): larger and deeper basins first, then a stable draw per basin. From 2 to 4, more lakes: the
    /// suitable basins get smaller and shallower, the caps on their area wider, and bowls are dug where there are
    /// none (`undulation::lake_hollows`).
    #[serde(default)]
    pub lakes: f64,
    /// Smallest lake of the water budget downstream (ha and m; 0: 10 ha and 1 m): a kept basin exceeds them.
    #[serde(default)]
    pub lake_area: f64,
    #[serde(default)]
    pub lake_depth: f64,
    /// Largest combined area of the kept basins and largest single one, as fractions of the map (0: 5 % and 2 %).
    #[serde(default)]
    pub lake_coverage: f64,
    #[serde(default)]
    pub max_lake_area: f64,
    /// Strength of the hollows the water chain digs in the ground before the conditioning (`undulation.rs`), for the
    /// ponds of a marsh: 0 or absent, none (the default; the wetland zone sends 2).
    #[serde(default)]
    pub undulation: f64,
}
/// Cells of the closed depressions kept as lakes (1) and of their rim, two cells around (2), or nothing when none
/// is kept. `filled`: the flood of `height` (the first breaching pass has it: no flood of its own). A depression
/// is suitable when it exceeds the smallest lake of the water budget with a margin and is a basin rather than a
/// drowned channel (mean width of three cells, compactness of 0.12); its chance grows with its area and depth and
/// with the setting, and its draw only depends on its lowest cell, so raising the setting only adds lakes. A kept
/// basin deeper than real lakes of its size (relative depth over 10 %: deepest over 0.113 √area) is made shallower
/// below half that depth by a smooth monotone compression of the depth, so a noise pit becomes a tarn, not a well.
/// The compression keeps the order of the heights: every water level still meets the ground on a contour of the
/// relief, never on the edge of a flat floor made of whole cells (the staircase shores of the first version).
fn kept_lakes(height: &mut [f32], filled: &[f32], n: usize, width: f64, s: &Conditioning) -> Vec<u8> {
    if s.lakes <= 0.0 {
        return Vec::new();
    }
    let or = |v: f64, fallback: f64| if v > 0.0 { v } else { fallback };
    // Margins over the smallest lake of the water budget, both in proportion: half as large again, twice as deep
    // (2 m for the default 1 m, as before). A fixed metre of margin kept no pond of a marsh, whose hollows are
    // decimetres deep, whatever the share asked. A setting of 0 means the default (10 ha, 1 m).
    // Above 2 (`extra` from 0 to 1 at 4): basins half as large and half as deep qualify, the lakes may cover three
    // times the share of the map, and the largest one twice.
    let extra = ((s.lakes - 2.0) / 2.0).clamp(0.0, 1.0);
    let (min_area, min_depth) = (1.5 * or(s.lake_area, 10.0) * 1e4 * (1.0 - 0.5 * extra), 2.0 * or(s.lake_depth, 1.0) * (1.0 - 0.5 * extra));
    let (coverage, largest) = (or(s.lake_coverage, 0.05) * (1.0 + 2.0 * extra), or(s.max_lake_area, 0.02) * (1.0 + extra));
    let (total, cell_area) = (n * n, (width / n as f64).powi(2));
    let mut label = vec![-1_i32; total];
    // Per depression: draw over chance (lower is kept first), area (m2) and deepest water allowed (m).
    let mut basins: Vec<(f64, f64, f64)> = Vec::new();
    for start in 0..total {
        if label[start] >= 0 || filled[start] as f64 - height[start] as f64 <= 0.05 {
            continue;
        }
        let id = basins.len() as i32;
        let (mut cells, mut depth, mut bottom, mut shore) = (0_usize, 0.0_f64, start, 0_usize);
        let mut stack = vec![start];
        label[start] = id;
        while let Some(c) = stack.pop() {
            cells += 1;
            depth = depth.max(filled[c] as f64 - height[c] as f64);
            if height[c] < height[bottom] || (height[c] == height[bottom] && c < bottom) {
                bottom = c
            }
            // Shore length: sides of the cell that face the outside of the depression (or of the map).
            shore += 4;
            for (nb, d) in neighbours(c, n) {
                if filled[nb] == filled[c] && filled[nb] as f64 - height[nb] as f64 > 0.05 {
                    if d == 1.0 {
                        shore -= 1
                    }
                    if label[nb] < 0 {
                        label[nb] = id;
                        stack.push(nb)
                    }
                }
            }
        }
        let area = cells as f64 * cell_area;
        let limit = (0.113 * area.sqrt()).max(min_depth);
        let depth = depth.min(limit);
        let mut chance = 0.0;
        let basin = 2.0 * cells as f64 / shore.max(1) as f64 >= 3.0
            && 4.0 * std::f64::consts::PI * cells as f64 / (shore * shore).max(1) as f64 >= 0.12;
        if basin && area >= min_area && depth >= min_depth && area <= largest * total as f64 * cell_area {
            let ramp = |v: f64| {
                let t = v.clamp(0.0, 1.0);
                t * t * (3.0 - 2.0 * t)
            };
            let quality = ramp((area / min_area).log10()) * ramp((depth - min_depth) / 7.0);
            // Half of the setting keeps half of the best basins.
            let share = (s.lakes / 2.0).min(1.0).sqrt();
            chance = share * (quality + share * (1.0 - quality))
        }
        let mut hash = (bottom as u32).wrapping_mul(0x9E37_79B9) ^ 0x85EB_CA6B;
        hash = (hash ^ (hash >> 15)).wrapping_mul(0x2C1B_3C6D);
        let draw = ((hash ^ (hash >> 13)) >> 8) as f64 / 16_777_216.0;
        basins.push((if draw < chance { draw / chance } else { f64::INFINITY }, area, limit))
    }
    let mut order: Vec<usize> = (0..basins.len()).filter(|&b| basins[b].0.is_finite()).collect();
    order.sort_by(|&a, &b| basins[a].0.total_cmp(&basins[b].0).then(a.cmp(&b)));
    let mut keep = vec![false; basins.len()];
    let mut covered = 0.0;
    for b in order {
        if covered + basins[b].1 <= coverage * total as f64 * cell_area {
            covered += basins[b].1;
            keep[b] = true
        }
    }
    if !keep.contains(&true) {
        return Vec::new();
    }
    let mut kept: Vec<u8> = label.iter().map(|&id| (id >= 0 && keep[id as usize]) as u8).collect();
    for c in 0..total {
        if kept[c] == 1 {
            height[c] = (filled[c] as f64 - compressed_depth(filled[c] as f64 - height[c] as f64, basins[label[c] as usize].2)) as f32
        }
    }
    for c in 0..total {
        if kept[c] != 1 {
            continue;
        }
        let (x, y) = ((c % n) as isize, (c / n) as isize);
        for yy in (y - 2).max(0)..=(y + 2).min(n as isize - 1) {
            for xx in (x - 2).max(0)..=(x + 2).min(n as isize - 1) {
                let nb = yy as usize * n + xx as usize;
                if kept[nb] == 0 {
                    kept[nb] = 2
                }
            }
        }
    }
    kept
}
/// Depth of a kept basin made shallower than `limit`: unchanged up to half of it, then a tanh knee that is continuous
/// in value and slope there and tends to `limit`. Strictly increasing, so the contours of the basin are kept.
fn compressed_depth(depth: f64, limit: f64) -> f64 {
    let knee = 0.5 * limit;
    if depth <= knee || limit <= 0.0 {
        return depth;
    }
    knee + (limit - knee) * ((depth - knee) / (limit - knee)).tanh()
}
#[derive(Default, Serialize)]
pub struct Census {
    pub depressions: usize,
    pub volume: f64,
}
pub struct ConditioningResult {
    pub height: Vec<f32>,
    pub delta: Vec<f32>,
    pub before: Census,
    pub after: Census,
    pub breaches: usize,
    pub steps: u32,
    pub hydrology: Option<Hydrology>,
}
fn census(height: &[f32], filled: &[f32], n: usize, width: f64) -> Census {
    let cell_area = (width / n as f64).powi(2);
    let mut seen = vec![false; n * n];
    let mut count = 0;
    let mut volume = 0.0;
    for s in 0..n * n {
        let depth = filled[s] as f64 - height[s] as f64;
        volume += depth.max(0.0) * cell_area;
        if depth <= 0.01 || seen[s] {
            continue;
        }
        let mut deepest = 0.0_f64;
        let mut stack = vec![s];
        seen[s] = true;
        while let Some(c) = stack.pop() {
            deepest = deepest.max(filled[c] as f64 - height[c] as f64);
            for (nb, _) in neighbours(c, n) {
                if !seen[nb]
                    && filled[nb] as f64 - height[nb] as f64 > 0.01
                    && filled[nb] == filled[c]
                {
                    seen[nb] = true;
                    stack.push(nb)
                }
            }
        }
        if deepest > 1.0 {
            count += 1
        }
    }
    Census {
        depressions: count,
        volume,
    }
}
fn below(height: &[f32], c: usize, n: usize, z: f64, among: Option<&[u8]>) -> bool {
    (height[c] as f64) < z && among.map_or(true, |a| a[c] != 0)
        || neighbours(c, n)
            .any(|(nb, _)| (height[nb] as f64) < z && among.map_or(true, |a| a[nb] != 0))
}
fn drowned_routes(height: &[f32], filled: &[f32], receiver: &[i32], n: usize) -> Vec<i32> {
    let total = n * n;
    let mut next = receiver.to_vec();
    let mut label = vec![-1; total];
    let mut floor = Vec::new();
    for s in 0..total {
        if label[s] >= 0 || filled[s] <= height[s] {
            continue;
        }
        let id = floor.len() as i32;
        let mut low = height[s];
        let mut stack = vec![s];
        label[s] = id;
        while let Some(c) = stack.pop() {
            low = low.min(height[c]);
            for (nb, _) in neighbours(c, n) {
                if label[nb] < 0 && filled[nb] == filled[c] && filled[nb] > height[nb] {
                    label[nb] = id;
                    stack.push(nb)
                }
            }
        }
        floor.push(low)
    }
    let mut cost = vec![f64::INFINITY; total];
    let mut heap = Heap::new(false);
    for c in 0..total {
        if label[c] >= 0 && (receiver[c] < 0 || label[receiver[c] as usize] != label[c]) {
            cost[c] = 0.0;
            heap.push(c, 0.0)
        }
    }
    while let Some((c, g)) = heap.pop() {
        if g > cost[c] {
            continue;
        }
        let id = label[c] as usize;
        for (nb, d) in neighbours(c, n) {
            if label[nb] != label[c] {
                continue;
            }
            let step = d * (0.5 + height[nb] as f64 - floor[id] as f64);
            if g + step < cost[nb] {
                cost[nb] = g + step;
                next[nb] = c as i32;
                heap.push(nb, g + step)
            }
        }
    }
    next
}
/// Widest reach of a breach's bank beyond its bed, in cells.
const BANK_REACH: f64 = 12.0;
/// Share of a bank's reach where it follows its slope; over the rest it fades back to the relief.
const BANK_SLOPED: f64 = 0.6;
/// Height of a bank of unit slope `x` cells from the bed, in cells: its foot is rounded over one cell.
fn bank_rise(x: f64) -> f64 {
    if x < 1.0 { x * x / 2.0 } else { x - 0.5 }
}
/// The banks of a breach beyond its bed and talus: valley sides under grass, not walls. From the bed each side
/// rises at its own slope, 0.11 to 0.30 (a slow term over the map, one per side, moves it by more than a factor of
/// two within a few hundred metres), until it meets the relief before this pass (`original`): the reach follows the
/// height to take up, and where that relief is already near the bed nothing is cut. The slope is steeper only
/// where the ground beyond is itself steeper (a gorge) or the reach is at its limit. The rim is rounded and the cut
/// fades out before the end of the reach. `before`: the ground under the chain before its bed was cut; `xs`, `ys`:
/// the smoothed chain, in cells; `area`: upstream areas (m²).
#[allow(clippy::too_many_arguments)]
fn banks(height: &mut [f32], n: usize, cell: f64, chain: &[usize], levels: &[f64], before: &[f64], xs: &[f64], ys: &[f64], original: &[f32], area: &[f32], kept: &[u8]) {
    let m = chain.len();
    if m < 2 {
        return;
    }
    let ground_at = |x: f64, y: f64| {
        let edge = (n - 1) as f64;
        original[y.floor().clamp(0.0, edge) as usize * n + x.floor().clamp(0.0, edge) as usize] as f64
    };
    // Per chain cell: the unit normal towards side 1; per side: the height a bank takes up when the relief shows
    // no rim (m) and the slope of the ground beyond it.
    let (mut normal, mut rise, mut beyond, mut upstream) = (vec![(0.0, 0.0); m], vec![[0.0; 2]; m], vec![[0.0; 2]; m], vec![0.0; m]);
    let mut most = 0.0_f64;
    for k in 0..m {
        let here = before[k];
        let depth = (here - levels[k]).max(0.0);
        let (a, b) = (k.saturating_sub(1), (k + 1).min(m - 1));
        let (tx, ty) = (xs[b] - xs[a], ys[b] - ys[a]);
        let length = tx.hypot(ty);
        for side in 0..2 {
            rise[k][side] = depth;
            if length > 1e-9 {
                normal[k] = (-ty / length, tx / length);
                let sign = if side == 1 { 1.0 } else { -1.0 };
                let (nx, ny) = (normal[k].0 * sign, normal[k].1 * sign);
                let near = ground_at(xs[k] + nx * 2.5, ys[k] + ny * 2.5);
                // A narrow notch already under the chain (an eroded channel) belongs to the bank's height.
                rise[k][side] += (near - here).clamp(0.0, depth);
                beyond[k][side] = ((ground_at(xs[k] + nx * 4.5, ys[k] + ny * 4.5) - near) / (2.0 * cell)).max(0.0)
            }
        }
        most = most.max(area[chain[k]] as f64);
        upstream[k] = most
    }
    // Slow variation over the map (metres), one field per side: three crossed waves of 350 to 600 m.
    let wave = |x: f64, y: f64, side: usize| {
        let (turn, scale) = if side == 0 { (0.0, 1.0) } else { (2.1, 1.37) };
        let q = std::f64::consts::TAU / 450.0_f64.max(8.0 * cell) * scale;
        let along = |angle: f64| {
            let (s, c) = (angle + turn).sin_cos();
            (x * c + y * s) * q
        };
        ((along(0.4) + 1.3 + turn).sin() + (1.31 * along(2.5) + 4.1).sin() + (0.77 * along(4.6) + 2.2 + turn).sin()) / 3.0
    };
    // Widest reach of a bank (cells): the valley a course of this catchment wants (two channel widths of floor and
    // its valley depth at the mean valley side slope, as `incision`), in metres, with one cell as the floor of the
    // resolution and `BANK_REACH` cells at most. A brook of a 40 km map gets no groove hundreds of metres wide.
    let cap = |k: usize| {
        let a = upstream[k];
        ((2.0 * super::rivers::channel_width(a, 3.0) + super::incision::valley_depth(a) / 0.12) / cell).clamp(2.0, BANK_REACH)
    };
    // Per chain cell and side: slope of the bank and its reach beyond the bed (cells).
    let raw: Vec<[(f64, f64); 2]> = (0..m)
        .map(|k| {
            let w = 3.min(k).min(m - 1 - k);
            let most = cap(k);
            // Up to 20 % gentler from 0.3 to 30 km² of upstream area.
            let flow = 1.0 + 0.2 * ((upstream[k].max(1.0).log10() - 5.5) / 2.0).clamp(0.0, 1.0);
            std::array::from_fn(|side| {
                let mean = |v: &[[f64; 2]]| v[k - w..=k + w].iter().map(|p| p[side]).sum::<f64>() / (2 * w + 1) as f64;
                let ground = mean(&beyond);
                let e = ((ground - 0.05) / 0.25).clamp(0.0, 1.0);
                let vary = 2.0_f64.powf((1.4 * wave(xs[k] * cell, ys[k] * cell, side)).clamp(-0.35, 0.7));
                // Under the bare-rock slope (about 0.35), unless the ground beyond is steeper.
                let slope = ((0.21 + 0.025 * e * e * (3.0 - 2.0 * e)) / (vary * flow)).max(ground.min(1.0));
                // Where the sloped bank meets the relief, along the normal: the reach leaves it room before fading.
                let sign = if side == 1 { 1.0 } else { -1.0 };
                let (nx, ny) = (normal[k].0 * sign, normal[k].1 * sign);
                let meets = (2..=(2.0 * most) as usize).map(|i| i as f64 * 0.5).find(|&x| {
                    ground_at(xs[k] + nx * (0.75 + x), ys[k] + ny * (0.75 + x)) <= levels[k] + slope * cell * bank_rise(x) + 1.0
                });
                let limit = 0.85 * most;
                match meets {
                    Some(x) if x <= limit => (slope, (x / BANK_SLOPED).min(most)),
                    // A deep cut or a gorge: at the limit of the reach the bank steepens to meet the relief there.
                    _ if normal[k] != (0.0, 0.0) => {
                        let far = ground_at(xs[k] + nx * (0.75 + limit), ys[k] + ny * (0.75 + limit)) - levels[k];
                        (slope.max(far / (cell * bank_rise(limit))), most)
                    }
                    _ => {
                        let rise = mean(&rise);
                        (slope.max(rise / (limit * cell)), (rise / (slope * cell) / BANK_SLOPED).min(most))
                    }
                }
            })
        })
        .collect();
    let bank: Vec<[(f64, f64); 2]> = (0..m)
        .map(|k| {
            let w = 3.min(k).min(m - 1 - k);
            std::array::from_fn(|side| {
                let (slope, reach) = raw[k - w..=k + w].iter().fold((0.0, 0.0), |sum, p| (sum.0 + p[side].0, sum.1 + p[side].1));
                (slope / (2 * w + 1) as f64, reach / (2 * w + 1) as f64)
            })
        })
        .collect();
    for k in 0..m - 1 {
        let (ax, ay) = (xs[k], ys[k]);
        let (dx, dy) = (xs[k + 1] - ax, ys[k + 1] - ay);
        let l2 = dx * dx + dy * dy;
        let r = 0.75 + bank[k][0].1.max(bank[k][1].1).max(bank[k + 1][0].1).max(bank[k + 1][1].1);
        if r < 1.0 || l2 < 1e-12 {
            continue;
        }
        let low = |v: f64| (v - r).floor().max(0.0) as usize;
        let high = |v: f64| ((v + r).floor().max(0.0) as usize).min(n - 1);
        for yy in low(ay.min(ay + dy))..=high(ay.max(ay + dy)) {
            for xx in low(ax.min(ax + dx))..=high(ax.max(ax + dx)) {
                let (px, py) = (xx as f64 + 0.5 - ax, yy as f64 + 0.5 - ay);
                let t = ((px * dx + py * dy) / l2).clamp(0.0, 1.0);
                let d = (px - dx * t).hypot(py - dy * t);
                if d <= 0.75 {
                    continue;
                }
                let side = (dx * py - dy * px > 0.0) as usize;
                let ((s0, r0), (s1, r1)) = (bank[k][side], bank[k + 1][side]);
                let (slope, reach, x) = (s0 + (s1 - s0) * t, r0 + (r1 - r0) * t, d - 0.75);
                if x >= reach {
                    continue;
                }
                let c = yy * n + xx;
                if kept.get(c).is_some_and(|&k| k != 0) {
                    continue;
                }
                let (z, ground) = (levels[k] + (levels[k + 1] - levels[k]) * t, original[c] as f64);
                let rise = slope * cell * bank_rise(x);
                // Rounded meeting of the bank and the relief (a smooth minimum): no rim line.
                let round = 1.5 + 0.15 * rise;
                let mix = (0.5 + 0.5 * (ground - z - rise) / round).clamp(0.0, 1.0);
                let cut = (ground + (z + rise - ground) * mix - round * mix * (1.0 - mix)).max(z);
                // Over the end of the reach the cut fades back to the relief.
                let u = ((x / reach - BANK_SLOPED) / (1.0 - BANK_SLOPED)).clamp(0.0, 1.0);
                let floor = cut + (ground - cut).max(0.0) * u * u * (3.0 - 2.0 * u);
                if ground > z && floor < height[c] as f64 {
                    height[c] = floor as f32
                }
            }
        }
    }
}
/// Half window of the running mean that smooths a breach chain (cells).
const BREACH_SMOOTH: usize = 5;
/// Wavelengths and largest lateral offset in physical channel widths, independent of the source raster.
const BREACH_WAVES: [f64; 2] = [32.0, 14.0];
const BREACH_SWING: f64 = 4.0;
/// Bed and short talus together, measured from the centreline in cells.
const TALUS_RADIUS: f64 = 1.6;

/// A least-cost route can hug either edge of a flat-bottomed channel. Across its D8 direction,
/// find the first shoulders within reach of the proposed winding bed. As for a headwater valley
/// cell, require a resolved rise (one metre and a 3% slope) on both sides. Centre on the
/// contiguous floor where the cross-slope is no steeper than the along-channel grade. This keeps
/// a sharp asymmetric V at its low point. An open floor or a single hillside leaves the meander free.
fn thalweg_offset(height: &[f32], n: usize, cell: f64, c: usize, to: usize, reach: f64) -> Option<(f64, f64)> {
    let (x, y) = ((c % n) as isize, (c / n) as isize);
    let (nx, ny) = (y - (to / n) as isize, (to % n) as isize - x);
    let step = (nx as f64).hypot(ny as f64);
    let along = (height[to] as f64 - height[c] as f64).abs();
    let floor_to_bank = |side: isize| {
        let mut floor = 0;
        for k in 1..=((reach / step) as isize).min(n as isize - 1) {
            let (xx, yy) = (x + side * k * nx, y + side * k * ny);
            if xx < 0 || yy < 0 || xx >= n as isize || yy >= n as isize {
                break;
            }
            let rise = height[yy as usize * n + xx as usize] as f64 - height[c] as f64;
            if rise >= (0.03 * k as f64 * step * cell).max(1.0) {
                return Some(floor);
            }
            if k == floor + 1 && rise.abs() <= k as f64 * along {
                floor = k;
            }
        }
        None
    };
    let mid = (floor_to_bank(1)? - floor_to_bank(-1)?) as f64 * 0.5;
    Some((mid * nx as f64, mid * ny as f64))
}

#[cfg(test)]
#[test]
fn asymmetric_drowned_banks_keep_the_low_point() {
    let n = 9;
    let c = 4 * n + 4;
    let mut heights = vec![10.0; n * n];
    heights[c - n] = 14.0; // One bank alone leaves an open floor.
    assert_eq!(thalweg_offset(&heights, n, 20.0, c, c + 1, 4.0), None);
    heights[c + 3 * n] = 14.0;
    assert_eq!(thalweg_offset(&heights, n, 20.0, c, c + 1, 4.0), Some((0.0, 1.0)));
    heights[c + n] = 10.5; // The same shoulders now enclose a V with its low point at c.
    heights[c + 2 * n] = 11.0;
    assert_eq!(thalweg_offset(&heights, n, 20.0, c, c + 1, 4.0), Some((0.0, 0.0)));
}

/// Invariant: a breach is not a ruled line. Its chain follows the grid (least-cost steps between drowned floors,
/// then the receivers of the flood), straight along one of the eight directions for kilometres on even ground; the
/// smoothed centreline (`xs`, `ys`, in cells) is moved sideways by two seeded waves of some tens of channel widths,
/// up to `BREACH_SWING` widths, tapered to nothing at the ends and where existing banks confine the bed. The trench
/// descends along that centreline with the levels of the chain; the pockets it leaves beside it are silted (`silt`).
/// `seed`: the first cell of the chain.
fn wind(xs: &mut [f64], ys: &mut [f64], seed: usize, cell: f64, channel: f64, confined: &[usize]) {
    let m = xs.len();
    if m < 4 {
        return;
    }
    let mut arc = vec![0.0; m];
    for k in 1..m {
        arc[k] = arc[k - 1] + cell * (xs[k] - xs[k - 1]).hypot(ys[k] - ys[k - 1])
    }
    let mut fixed = confined.iter().copied();
    let mut start = 0;
    let mut end = fixed.next().unwrap_or(m - 1);
    let mut hash = (seed as u64).wrapping_mul(0x9E37_79B9_7F4A_7C15);
    let mut draw = || {
        hash ^= hash >> 29;
        hash = hash.wrapping_mul(0xBF58_476D_1CE4_E5B9);
        (hash >> 11) as f64 / (1u64 << 53) as f64
    };
    let phases = [draw() * std::f64::consts::TAU, draw() * std::f64::consts::TAU];
    let (ox, oy) = (xs.to_vec(), ys.to_vec());
    for k in 1..m - 1 {
        if k == end {
            start = end;
            end = fixed.next().unwrap_or(m - 1);
            continue;
        }
        let (a, b) = (k.saturating_sub(2), (k + 2).min(m - 1));
        let (tx, ty) = (ox[b] - ox[a], oy[b] - oy[a]);
        let l = tx.hypot(ty);
        if l < 1e-9 {
            continue;
        }
        let taper = {
            let free = (arc[k] - arc[start]).min(arc[end] - arc[k]);
            let t = (free / (0.5 * BREACH_WAVES[0] * channel)).min(1.0);
            t * t * (3.0 - 2.0 * t)
        };
        let s = arc[k] * std::f64::consts::TAU;
        let offset = BREACH_SWING * channel / cell * taper
            * (0.7 * (s / (BREACH_WAVES[0] * channel) + phases[0]).sin()
                + 0.3 * (s / (BREACH_WAVES[1] * channel) + phases[1]).sin());
        xs[k] = ox[k] - ty / l * offset;
        ys[k] = oy[k] + tx / l * offset
    }
}
#[cfg(test)]
#[test]
fn breach_winding_has_the_same_physical_scale_on_fine_and_coarse_grids() {
    let run = |cell: f64| {
        let count = (4000.0 / cell) as usize;
        let mut xs: Vec<f64> = (0..=count).map(|k| 100.0 / cell + k as f64).collect();
        let mut ys = vec![1000.0 / cell; count + 1];
        wind(&mut xs, &mut ys, 123, cell, 12.0, &[]);
        xs.into_iter().zip(ys).map(|(x, y)| (x * cell, y * cell)).collect::<Vec<_>>()
    };
    let (fine, coarse) = (run(20.0), run(40.0));
    assert_eq!(coarse[0], (100.0, 1000.0));
    assert_eq!(*coarse.last().unwrap(), (4100.0, 1000.0));
    assert!(coarse.iter().any(|p| (p.1 - 1000.0).abs() > 25.0));
    for (k, &(x, y)) in coarse.iter().enumerate() {
        assert!((x - fine[2 * k].0).abs() < 1e-8 && (y - fine[2 * k].1).abs() < 1e-8);
    }
}

#[cfg(test)]
#[test]
fn step_beds_on_even_drowned_ground_wind_with_their_catchment() {
    let (n, cell) = (256, 20.0);
    let chain: Vec<usize> = (20..236).map(|x| 128 * n + x).collect();
    let levels: Vec<f64> = (0..chain.len()).map(|k| 18.0 - 0.001 * k as f64 * cell).collect();
    let swing = |area| {
        let mut height = vec![20.0; n * n];
        let flood = crate::priority_flood::FloodGrids {
            filled: vec![25.0; n * n], accumulation: vec![area; n * n], ..Default::default()
        };
        let mut drained = vec![0; n * n];
        carve(&mut height, n, cell, &chain, &levels, &mut drained, &[], &flood, &[]);
        let lateral = drained.iter().enumerate().filter(|(_, bed)| **bed != 0)
            .map(|(c, _)| (c / n).abs_diff(128)).max().unwrap();
        lateral as f64 * cell
    };
    let small = swing(1e6); // Subject to the 12 m minimum channel width.
    let large = swing(4e8);
    assert!(small > cell);
    assert!(large > BREACH_SWING * 12.0 + cell, "large catchment exceeds the small channel's swing");
    assert!(large > small);
}
/// `original`: the relief before this breaching pass, for valley banks (empty: the short talus only);
/// `flood`: spill levels and upstream areas (m²) for both profiles; `kept`: protected lakes and their rims.
#[allow(clippy::too_many_arguments)]
fn carve(
    height: &mut [f32],
    n: usize,
    cell: f64,
    chain: &[usize],
    levels: &[f64],
    drained: &mut [u8],
    original: &[f32],
    flood: &crate::priority_flood::FloodGrids,
    kept: &[u8],
) {
    let m = chain.len();
    // Ground under the chain before its bed is cut.
    let before: Vec<f64> = chain.iter().map(|&c| height[c] as f64).collect();
    let area = &flood.accumulation;
    let channel = super::rivers::channel_width(area[chain[m / 2]] as f64, 1.0).max(12.0);
    let reach = BREACH_SWING * channel / cell + TALUS_RADIUS;
    let mut confined = Vec::new();
    let mut bed = Vec::with_capacity(m);
    for (k, &c) in chain.iter().enumerate() {
        let (mut x, mut y) = ((c % n) as f64, (c / n) as f64);
        if k > 0 && k + 1 < m && flood.filled[c] > height[c]
            && let Some((dx, dy)) = thalweg_offset(height, n, cell, c, chain[k + 1], reach)
        {
            x += dx;
            y += dy;
            confined.push(k);
        }
        bed.push((x, y));
    }
    let mut xs = vec![0.0; m];
    let mut ys = xs.clone();
    for k in 0..m {
        let w = BREACH_SMOOTH.min(k).min(m - 1 - k);
        let (mut sx, mut sy) = (0.0, 0.0);
        for &(x, y) in &bed[k - w..=k + w] {
            sx += x;
            sy += y
        }
        xs[k] = sx / (2 * w + 1) as f64 + 0.5;
        ys[k] = sy / (2 * w + 1) as f64 + 0.5
    }
    wind(&mut xs, &mut ys, chain[0], cell, channel, &confined);
    for k in 0..m {
        let last = k == m - 1;
        let samples = if last {
            1
        } else {
            (4.0 * (xs[k + 1] - xs[k]).hypot(ys[k + 1] - ys[k]))
                .ceil()
                .max(1.0) as usize
        };
        for s in 0..samples {
            let t = s as f64 / samples as f64;
            let (px, py, z) = if last {
                (xs[k], ys[k], levels[k])
            } else {
                (
                    xs[k] + (xs[k + 1] - xs[k]) * t,
                    ys[k] + (ys[k + 1] - ys[k]) * t,
                    levels[k] + (levels[k + 1] - levels[k]) * t,
                )
            };
            let (gx, gy) = (px.floor() as isize, py.floor() as isize);
            for yy in gy - 2..=gy + 2 {
                for xx in gx - 2..=gx + 2 {
                    if xx < 0 || yy < 0 || xx >= n as isize || yy >= n as isize {
                        continue;
                    }
                    let d = (xx as f64 + 0.5 - px).hypot(yy as f64 + 0.5 - py);
                    if d > TALUS_RADIUS {
                        continue;
                    }
                    let c = yy as usize * n + xx as usize;
                    if kept.get(c).is_some_and(|&k| k != 0) {
                        continue;
                    }
                    let bed = d <= 0.75;
                    let floor = if bed { z } else { z + 0.3 * (d - 0.75) * cell };
                    if height[c] as f64 > floor {
                        height[c] = floor as f32
                    }
                    if bed {
                        drained[c] = 1
                    }
                }
            }
        }
    }
    if !original.is_empty() {
        banks(height, n, cell, chain, levels, &before, &xs, &ys, original, area, kept)
    }
}
/// `kept`: cells of the depressions kept as lakes and of their rim (empty: none), chosen on the flood of the first
/// pass. They are not breached, and a breach reaching one ends there: the lake is its outlet.
fn breach(height: &mut [f32], n: usize, width: f64, s: &Conditioning, pass: usize, kept: &mut Vec<u8>) -> usize {
    let cell = width / n as f64;
    let (max_depth, max_length, valley) = (s.max_depth.max(0.0), s.max_length.max(0.0), s.banks != "step");
    // Catchment sizes the winding bed in both modes. Only valley mode grades its banks.
    let h = crate::priority_flood::flood_areas(height, n, cell * cell);
    if pass == 0 {
        *kept = kept_lakes(height, &h.filled, n, width, s)
    }
    let kept: &[u8] = kept;
    let original = if valley { height.to_vec() } else { Vec::new() };
    let filled = &h.filled;
    let mut pits: Vec<usize> = (0..n * n)
        .filter(|&c| {
            filled[c] as f64 - height[c] as f64 > 0.05
                && !below(height, c, n, height[c] as f64, None)
        })
        .collect();
    pits.sort_by(|&a, &b| height[a].total_cmp(&height[b]));
    let next = drowned_routes(height, filled, &h.receiver, n);
    let mut drained = vec![0; n * n];
    let mut breaches = 0;
    for bottom in pits {
        if drained[bottom] != 0 || below(height, bottom, n, height[bottom] as f64, Some(&drained)) {
            continue;
        }
        if kept.get(bottom).is_some_and(|&k| k != 0) {
            continue;
        }
        let spill = filled[bottom] as f64;
        let lowest = (height[bottom] as f64).max(spill - max_depth);
        let step_z = 0.5_f64.max((spill - lowest) / 8.0);
        let mut level = lowest;
        while level < spill - 0.05 {
            let mut chain = vec![bottom];
            let mut levels = vec![level];
            let (mut z, mut ok, mut cut) = (level, true, 0);
            let mut previous = bottom;
            let mut c = next[bottom];
            while c >= 0 {
                let at = c as usize;
                if (height[at] as f64) < z && (drained[at] != 0 || filled[at] < filled[bottom]) {
                    break;
                }
                if kept.get(at).is_some_and(|&k| k != 0) {
                    break;
                }
                z -= 0.001
                    * if at % n != previous % n && at / n != previous / n {
                        std::f64::consts::SQRT_2
                    } else {
                        1.0
                    }
                    * cell;
                chain.push(at);
                levels.push(z);
                if height[at] as f64 > z {
                    cut += 1;
                    if cut as f64 * cell > max_length {
                        ok = false;
                        break;
                    }
                }
                previous = at;
                c = next[at]
            }
            if !ok {
                level += step_z;
                continue;
            }
            if cut > 0 {
                carve(height, n, cell, &chain, &levels, &mut drained, &original, &h, kept);
                breaches += 1
            }
            if level == height[bottom] as f64 {
                drained[bottom] = 1
            }
            break;
        }
    }
    breaches
}
/// Rise of a silted basin floor from its outlet, as a slope (rise over run): 5 cm per km. The silt of a wide plain
/// rises over tens of kilometres and may raise the outlet of a kept lake below it: at 0.2 m/km the kept lakes of a
/// flat 40 km map stood several metres higher.
const SILT_SLOPE: f64 = 5e-5;
/// Variation of that rise from cell to cell (share), over a few hundred metres: a silted floor is not a plane, whose
/// steepest descent, straight to the outlet, would rule the courses across it.
const SILT_ROUGHNESS: f64 = 0.9;
/// Ordered key of the silting flood: lowest height first, then lowest cell (deterministic ties).
#[derive(PartialEq)]
struct Lowest(f64, usize);
impl Eq for Lowest {}
impl PartialOrd for Lowest {
    fn partial_cmp(&self, other: &Self) -> Option<std::cmp::Ordering> {
        Some(self.cmp(other))
    }
}
impl Ord for Lowest {
    fn cmp(&self, other: &Self) -> std::cmp::Ordering {
        other.0.total_cmp(&self.0).then(other.1.cmp(&self.1))
    }
}
/// Invariant: after the conditioning, no closed depression is left but the lakes kept (`kept`: lake 1, rim 2, both
/// left as they are; silting the rim raised the outlets of the marsh ponds, 3.7 m deep at the median instead of 1 m).
/// What the breaches did not drain is silted up: filled to its spill with a floor that rises from the outlet by
/// `SILT_SLOPE` (priority flood with a slope; Barnes et al. 2014, with a FIFO for the raised cells), so it drains and
/// holds no standing water. The old pass (`settle`) raised a basin towards its spill with a floor sloping down to its
/// middle: a closed bowl that the water budget filled again (18–20 % of a flat 40 km map under water).
/// Outlets: the map border and the ground at or under the sea level. Returns the number of cells raised.
fn silt(height: &mut [f32], n: usize, width: f64, kept: &[u8]) -> usize {
    let cell = width / n as f64;
    let total = n * n;
    let mut done = vec![false; total];
    let mut open = std::collections::BinaryHeap::new();
    let mut pit = std::collections::VecDeque::new();
    for c in 0..total {
        let (x, y) = (c % n, c / n);
        if x == 0 || y == 0 || x == n - 1 || y == n - 1 || height[c] <= 0.0 {
            done[c] = true;
            open.push(Lowest(height[c] as f64, c));
        }
    }
    let noise = crate::noise::Noise::new(crate::rng::Rng::new("silt"));
    let scale = 1.0 / (8.0 * cell).max(250.0);
    let mut raised = 0;
    loop {
        let c = match pit.pop_front() {
            Some(c) => c,
            None => match open.pop() {
                Some(Lowest(_, c)) => c,
                None => break,
            },
        };
        let z = height[c];
        for (nb, d) in neighbours(c, n) {
            if done[nb] {
                continue;
            }
            done[nb] = true;
            if height[nb] <= z && kept.get(nb).is_none_or(|&k| k == 0) {
                let (x, y) = (((nb % n) as f64 + 0.5) * cell * scale, ((nb / n) as f64 + 0.5) * cell * scale);
                let rough = 1.0 + SILT_ROUGHNESS * noise.noise(x, y).clamp(-1.0, 1.0);
                let mut up = (z as f64 + SILT_SLOPE * rough * d * cell) as f32;
                if up <= z {
                    // Under a metre-scale slope a raised cell is at least one step above its outlet (z > 0 here:
                    // ground at or under the sea is an outlet itself).
                    up = f32::from_bits(z.to_bits() + 1);
                }
                height[nb] = up;
                raised += 1;
                pit.push_back(nb);
            } else {
                open.push(Lowest(height[nb] as f64, nb));
            }
        }
    }
    raised
}
pub fn condition_relief(
    height: &[f32],
    n: usize,
    width: f64,
    s: &Conditioning,
    stats: bool,
) -> ConditioningResult {
    condition_options(height, n, width, s, stats, stats, true)
}
pub(super) fn condition_options(
    height: &[f32], n: usize, width: f64, s: &Conditioning,
    stats: bool, drainage: bool, accumulate: bool,
) -> ConditioningResult {
    let before = if stats {
        census(
            height,
            &crate::priority_flood::flood_surface(height, n, false).filled,
            n,
            width,
        )
    } else {
        Census::default()
    };
    let mut result = height.to_vec();
    let both = s.mode == "both";
    let (mut steps, mut breaches) = (0, 0);
    if s.mode == "erosion" || both {
        steps = (12.0 * s.strength.clamp(0.0, 3.0) + 0.5).floor() as u32;
        let deposit = if both { 0.0 } else { 0.12 };
        if n <= 512 {
            crate::priority_flood::erode_grid(
                &mut result,
                n,
                (width / n as f64).powi(2),
                steps,
                deposit,
            )
        } else {
            let m = 512;
            let small = downsample(height, n, m);
            let mut eroded = small.clone();
            crate::priority_flood::erode_grid(
                &mut eroded,
                m,
                (width / m as f64).powi(2),
                steps,
                deposit,
            );
            for c in 0..m * m {
                eroded[c] = (eroded[c] as f64 - small[c] as f64) as f32
            }
            let change = upsample_delta(&eroded, m, n);
            for c in 0..n * n {
                if height[c] > 0.0 {
                    result[c] = (height[c] as f64)
                        .min(0.1)
                        .max(height[c] as f64 + change[c] as f64)
                        as f32
                }
            }
        }
    }
    let mut kept = Vec::new();
    if s.mode == "breach" || both {
        for pass in 0..2 {
            let opened = breach(&mut result, n, width, s, pass, &mut kept);
            breaches += opened;
            if opened == 0 {
                break;
            }
        }
    }
    for c in 0..n * n {
        if height[c] <= 0.0 {
            result[c] = height[c]
        } else if result[c] < 0.1 {
            result[c] = (height[c] as f64).min(0.1) as f32
        }
    }
    // What the breaches left closed and no kept lake holds is silted up before the drainage is computed.
    if s.mode == "breach" || both {
        silt(&mut result, n, width, &kept);
    }
    let mut h = (stats || drainage).then(|| {
        if drainage && accumulate {
            hydrology(&result, n, width)
        } else {
            Hydrology { n, width, height: Vec::new(), grids: if drainage {
                crate::priority_flood::routing_grids(&result, n)
            } else {
                crate::priority_flood::flood_surface(&result, n, false)
            }}
        }
    });
    if let Some(ref mut hydro) = h {
        hydro.height = result.clone()
    }
    let delta = result
        .iter()
        .zip(height)
        .map(|(&a, &b)| (a as f64 - b as f64) as f32)
        .collect();
    let after = if stats {
        census(&result, &h.as_ref().unwrap().grids.filled, n, width)
    } else {
        Census::default()
    };
    ConditioningResult {
        height: result,
        delta,
        before,
        after,
        breaches,
        steps,
        hydrology: if drainage { h } else { None },
    }
}

#[cfg(test)]
mod kept_lake_tests {
    use super::*;
    /// Invariant: keeping a basin as a lake never flattens its floor. A pit far deeper than a lake of its size is made
    /// shallower, but the heights keep their order, so the shore at any water level is a contour of the relief.
    #[test]
    fn kept_basin_keeps_its_contours() {
        let (n, width) = (64_usize, 6400.0);
        let mut height = vec![300.0_f32; n * n];
        for y in 0..n {
            for x in 0..n {
                let r = ((x as f64 - 31.5).powi(2) + (y as f64 - 30.7).powi(2)).sqrt();
                if r < 4.6 {
                    height[y * n + x] = (300.0 - 220.0 * (1.0 - r / 4.6)) as f32
                }
            }
        }
        let original = height.clone();
        let filled = crate::priority_flood::flood_surface(&height, n, true).filled;
        let s = Conditioning { lakes: 2.0, ..Default::default() };
        let kept = kept_lakes(&mut height, &filled, n, width, &s);
        let wet: Vec<usize> = (0..n * n).filter(|&c| kept.get(c) == Some(&1)).collect();
        assert!(wet.len() > 20, "the pit is kept as a lake");
        assert!(wet.iter().any(|&c| height[c] > original[c]), "the too-deep pit is made shallower");
        let deepest = wet.iter().map(|&c| filled[c] as f64 - height[c] as f64).fold(0.0, f64::max);
        let area = wet.len() as f64 * (width / n as f64).powi(2);
        assert!(deepest <= (0.113 * area.sqrt()).max(2.0) + 1e-3, "depth {deepest} within the lake limit");
        for &a in &wet {
            for &b in &wet {
                if original[a] < original[b] {
                    assert!(height[a] < height[b], "order kept: no flat floor");
                }
            }
        }
    }
}
