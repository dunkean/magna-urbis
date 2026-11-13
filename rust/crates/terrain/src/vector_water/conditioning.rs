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
    /// suitable one): larger and deeper basins first, then a stable draw per basin.
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
}
/// Cells of the closed depressions kept as lakes (1) and of their rim, two cells around (2), or nothing when none
/// is kept. `filled`: the flood of `height` (the first breaching pass has it: no flood of its own). A depression
/// is suitable when it exceeds the smallest lake of the water budget with a margin and is a basin rather than a
/// drowned channel (mean width of three cells, compactness of 0.12); its chance grows with its area and depth and
/// with the setting, and its draw only depends on its lowest cell, so raising the setting only adds lakes. A kept
/// basin deeper than real lakes of its size (relative depth over 10 %: deepest over 0.113 √area) has its floor
/// raised to that depth: a noise pit becomes a tarn, not a well.
fn kept_lakes(height: &mut [f32], filled: &[f32], n: usize, width: f64, s: &Conditioning) -> Vec<u8> {
    if s.lakes <= 0.0 {
        return Vec::new();
    }
    let or = |v: f64, fallback: f64| if v > 0.0 { v } else { fallback };
    let (min_area, min_depth) = (1.5 * or(s.lake_area, 10.0) * 1e4, or(s.lake_depth, 1.0) + 1.0);
    let (coverage, largest) = (or(s.lake_coverage, 0.05), or(s.max_lake_area, 0.02));
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
            let floor = filled[c] as f64 - basins[label[c] as usize].2;
            if (height[c] as f64) < floor {
                height[c] = floor as f32
            }
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
        most = most.max(area.get(chain[k]).map_or(0.0, |&v| v as f64));
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
    // Per chain cell and side: slope of the bank and its reach beyond the bed (cells).
    let raw: Vec<[(f64, f64); 2]> = (0..m)
        .map(|k| {
            let w = 3.min(k).min(m - 1 - k);
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
                let meets = (2..=(2.0 * BANK_REACH) as usize).map(|i| i as f64 * 0.5).find(|&x| {
                    ground_at(xs[k] + nx * (0.75 + x), ys[k] + ny * (0.75 + x)) <= levels[k] + slope * cell * bank_rise(x) + 1.0
                });
                let limit = 0.85 * BANK_REACH;
                match meets {
                    Some(x) if x <= limit => (slope, (x / BANK_SLOPED).min(BANK_REACH)),
                    // A deep cut or a gorge: at the limit of the reach the bank steepens to meet the relief there.
                    _ if normal[k] != (0.0, 0.0) => {
                        let far = ground_at(xs[k] + nx * (0.75 + limit), ys[k] + ny * (0.75 + limit)) - levels[k];
                        (slope.max(far / (cell * bank_rise(limit))), BANK_REACH)
                    }
                    _ => {
                        let rise = mean(&rise);
                        (slope.max(rise / (limit * cell)), (rise / (slope * cell) / BANK_SLOPED).min(BANK_REACH))
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
/// `original`: the relief before this breaching pass, for valley banks (empty: the short talus only); `area`: its
/// upstream areas (m²); `kept`: the lakes kept and their rim, which no cut touches.
#[allow(clippy::too_many_arguments)]
fn carve(
    height: &mut [f32],
    n: usize,
    cell: f64,
    chain: &[usize],
    levels: &[f64],
    drained: &mut [u8],
    original: &[f32],
    area: &[f32],
    kept: &[u8],
) {
    let m = chain.len();
    // Ground under the chain before its bed is cut.
    let before: Vec<f64> = chain.iter().map(|&c| height[c] as f64).collect();
    let mut xs = vec![0.0; m];
    let mut ys = xs.clone();
    for k in 0..m {
        let w = 3.min(k).min(m - 1 - k);
        let (mut sx, mut sy) = (0.0, 0.0);
        for j in k - w..=k + w {
            sx += (chain[j] % n) as f64;
            sy += (chain[j] / n) as f64
        }
        xs[k] = sx / (2 * w + 1) as f64 + 0.5;
        ys[k] = sy / (2 * w + 1) as f64 + 0.5
    }
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
                    if d > 1.6 {
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
    let h = if valley {
        crate::priority_flood::flood_areas(height, n, cell * cell)
    } else {
        crate::priority_flood::flood_surface(height, n, true)
    };
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
                carve(height, n, cell, &chain, &levels, &mut drained, &original, &h.accumulation, kept);
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
fn settle(height: &mut [f32], filled: &[f32], original: &[f32], n: usize, width: f64, slope: f64, kept: &[u8]) {
    let cell = width / n as f64;
    let diagonal = cell * std::f64::consts::SQRT_2;
    let mut d: Vec<f32> = (0..n * n)
        .map(|c| {
            if filled[c] > height[c] {
                f32::INFINITY
            } else {
                0.0
            }
        })
        .collect();
    for y in 0..n {
        for x in 0..n {
            let c = y * n + x;
            if d[c] == 0.0 {
                continue;
            }
            let mut v = d[c] as f64;
            if x > 0 {
                v = v.min(d[c - 1] as f64 + cell)
            }
            if y > 0 {
                v = v.min(d[c - n] as f64 + cell);
                if x > 0 {
                    v = v.min(d[c - n - 1] as f64 + diagonal)
                }
                if x < n - 1 {
                    v = v.min(d[c - n + 1] as f64 + diagonal)
                }
            }
            d[c] = v as f32
        }
    }
    for y in (0..n).rev() {
        for x in (0..n).rev() {
            let c = y * n + x;
            if d[c] == 0.0 {
                continue;
            }
            let mut v = d[c] as f64;
            if x < n - 1 {
                v = v.min(d[c + 1] as f64 + cell)
            }
            if y < n - 1 {
                v = v.min(d[c + n] as f64 + cell);
                if x < n - 1 {
                    v = v.min(d[c + n + 1] as f64 + diagonal)
                }
                if x > 0 {
                    v = v.min(d[c + n - 1] as f64 + diagonal)
                }
            }
            d[c] = v as f32;
            if original[c] > 0.0 && kept.get(c).is_none_or(|&k| k != 1) {
                height[c] = (height[c] as f64).max(filled[c] as f64 - slope * v) as f32
            }
        }
    }
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
    let settles = both && steps > 0;
    let mut h = (stats || settles || drainage).then(|| {
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
    if settles {
        settle(
            &mut result,
            &h.as_ref().unwrap().grids.filled,
            height,
            n,
            width,
            0.048 / steps as f64,
            &kept,
        )
    }
    // Drainage was computed before settling, exactly as TS; its height points
    // at the now-settled physical floor while filled/routing stay unchanged.
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
