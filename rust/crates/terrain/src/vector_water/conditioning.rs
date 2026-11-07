use super::{Heap, Hydrology, downsample, hydrology, neighbours, upsample_delta};
use serde::{Deserialize, Serialize};
#[derive(Clone, Deserialize, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct Conditioning {
    pub mode: String,
    pub strength: f64,
    pub max_depth: f64,
    pub max_length: f64,
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
fn carve(
    height: &mut [f32],
    n: usize,
    cell: f64,
    chain: &[usize],
    levels: &[f64],
    drained: &mut [u8],
) {
    let m = chain.len();
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
}
fn breach(height: &mut [f32], n: usize, width: f64, max_depth: f64, max_length: f64) -> usize {
    let cell = width / n as f64;
    let h = crate::priority_flood::flood_surface(height, n, true);
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
                carve(height, n, cell, &chain, &levels, &mut drained);
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
fn settle(height: &mut [f32], filled: &[f32], original: &[f32], n: usize, width: f64, slope: f64) {
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
            if original[c] > 0.0 {
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
    if s.mode == "breach" || both {
        for _ in 0..2 {
            let opened = breach(
                &mut result,
                n,
                width,
                s.max_depth.max(0.0),
                s.max_length.max(0.0),
            );
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
