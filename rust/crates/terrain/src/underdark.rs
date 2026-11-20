//! Underdark: turns any surface relief (procedural or neural) into a cave system.
//!
//! The relief is read as the floor of the underworld, not inverted. Its drainage network becomes
//! the tunnels (width grows with the upstream area, with irregular river rooms), its low basins and
//! plains become wide caverns with rock pillars, and a sparse worm network adds dry galleries.
//! Every opening is joined to the main network, so roads and rivers can reach every chamber.
//! Rock keeps the floor of its nearest opening plus a wall that rises with the distance to it, so
//! water falling on the rock drains into the nearest gallery. The ordinary hydrology then runs on
//! this surface: rivers follow the tunnels and lakes fill the closed caverns.
//!
//! A few natural tunnels (`UnderdarkOptions::natural_tunnels`) are narrow, purposeful passages through the
//! rock: river passages, where a river crosses a thick rock barrier in a slot instead of a wide cave, and
//! lava tubes, which join two chambers that face each other across a rock mass but are far apart through
//! the network. Both are open floor for everything downstream and are listed in `UnderdarkField::tunnels`. Each is a
//! gut a few metres wide: the carve opens a 4-connected chain of cells along it, and the soft wall field (`sdf`) puts
//! its walls at its real half width.

use crate::noise::Noise;
use crate::rng::Rng;
use std::cmp::Ordering;
use std::collections::BinaryHeap;

/// Carved surface (metres, strictly positive) and its rock mask (1 = solid rock, 0 = open floor).
pub struct UnderdarkField {
    pub height: Vec<f32>,
    pub rock: Vec<u8>,
    /// Signed distance to the cave wall, in cells (> 0 inside rock), smoothed so that its zero
    /// contour is a curve: interpolated, it draws walls without the grid's staircase. Its sign at each cell
    /// centre is the rock mask's; around a natural tunnel it is the distance to the tunnel's own walls.
    pub sdf: Vec<f32>,
    /// Natural tunnels carved into this field (empty when the amount is 0).
    pub tunnels: Vec<UnderdarkTunnel>,
}

const SQRT2: f32 = std::f32::consts::SQRT_2;

/// Chamfer max-plus propagation: `field[x] = max(field[x], field[y] - step * d(x, y))`.
fn propagate_max(field: &mut [f32], n: usize, step: f32) {
    let diag = step * SQRT2;
    for y in 0..n {
        for x in 0..n {
            let i = y * n + x;
            let mut v = field[i];
            if x > 0 { v = v.max(field[i - 1] - step); }
            if y > 0 {
                v = v.max(field[i - n] - step);
                if x > 0 { v = v.max(field[i - n - 1] - diag); }
                if x + 1 < n { v = v.max(field[i - n + 1] - diag); }
            }
            field[i] = v;
        }
    }
    for y in (0..n).rev() {
        for x in (0..n).rev() {
            let i = y * n + x;
            let mut v = field[i];
            if x + 1 < n { v = v.max(field[i + 1] - step); }
            if y + 1 < n {
                v = v.max(field[i + n] - step);
                if x + 1 < n { v = v.max(field[i + n + 1] - diag); }
                if x > 0 { v = v.max(field[i + n - 1] - diag); }
            }
            field[i] = v;
        }
    }
}

/// Distance (cells) to the nearest seed and that seed's index (chamfer 3-4 approximation).
fn nearest_seed(seed: &[bool], n: usize) -> (Vec<f32>, Vec<u32>) {
    let mut dist = vec![f32::INFINITY; n * n];
    let mut near = vec![u32::MAX; n * n];
    for i in 0..n * n {
        if seed[i] { dist[i] = 0.0; near[i] = i as u32; }
    }
    let pass = |dist: &mut Vec<f32>, near: &mut Vec<u32>, i: usize, j: usize, d: f32| {
        if dist[j] + d < dist[i] { dist[i] = dist[j] + d; near[i] = near[j]; }
    };
    for y in 0..n {
        for x in 0..n {
            let i = y * n + x;
            if x > 0 { pass(&mut dist, &mut near, i, i - 1, 1.0); }
            if y > 0 {
                pass(&mut dist, &mut near, i, i - n, 1.0);
                if x > 0 { pass(&mut dist, &mut near, i, i - n - 1, SQRT2); }
                if x + 1 < n { pass(&mut dist, &mut near, i, i - n + 1, SQRT2); }
            }
        }
    }
    for y in (0..n).rev() {
        for x in (0..n).rev() {
            let i = y * n + x;
            if x + 1 < n { pass(&mut dist, &mut near, i, i + 1, 1.0); }
            if y + 1 < n {
                pass(&mut dist, &mut near, i, i + n, 1.0);
                if x + 1 < n { pass(&mut dist, &mut near, i, i + n + 1, SQRT2); }
                if x > 0 { pass(&mut dist, &mut near, i, i + n - 1, SQRT2); }
            }
        }
    }
    (dist, near)
}

/// Separable box blur of radius `r` cells (clamped edges).
fn box_blur(src: &[f32], n: usize, r: usize) -> Vec<f32> {
    if r == 0 { return src.to_vec(); }
    let mut tmp = vec![0.0f32; n * n];
    let mut out = vec![0.0f32; n * n];
    let w = (2 * r + 1) as f32;
    for y in 0..n {
        let row = &src[y * n..(y + 1) * n];
        let mut sum = 0.0f32;
        for k in 0..=2 * r { sum += row[k.saturating_sub(r).min(n - 1)]; }
        for x in 0..n {
            tmp[y * n + x] = sum / w;
            let add = row[(x + r + 1).min(n - 1)];
            let sub = row[x.saturating_sub(r)];
            sum += add - sub;
        }
    }
    for x in 0..n {
        let mut sum = 0.0f32;
        for k in 0..=2 * r { sum += tmp[k.saturating_sub(r).min(n - 1) * n + x]; }
        for y in 0..n {
            out[y * n + x] = sum / w;
            let add = tmp[(y + r + 1).min(n - 1) * n + x];
            let sub = tmp[y.saturating_sub(r) * n + x];
            sum += add - sub;
        }
    }
    out
}

/// 8-connected component labels of the cells where `inside` is true; returns labels and sizes.
fn components(inside: &[bool], n: usize) -> (Vec<u32>, Vec<usize>) {
    let mut label = vec![u32::MAX; n * n];
    let mut sizes = Vec::new();
    let mut stack = Vec::new();
    for start in 0..n * n {
        if !inside[start] || label[start] != u32::MAX { continue; }
        let id = sizes.len() as u32;
        let mut size = 0;
        label[start] = id;
        stack.push(start);
        while let Some(i) = stack.pop() {
            size += 1;
            let (x, y) = ((i % n) as isize, (i / n) as isize);
            for dy in -1..=1 {
                for dx in -1..=1 {
                    let (nx, ny) = (x + dx, y + dy);
                    if nx < 0 || ny < 0 || nx >= n as isize || ny >= n as isize { continue; }
                    let j = ny as usize * n + nx as usize;
                    if inside[j] && label[j] == u32::MAX { label[j] = id; stack.push(j); }
                }
            }
        }
        sizes.push(size);
    }
    (label, sizes)
}

fn quantile(values: &[f32], q: f64) -> f32 {
    let step = (values.len() / 65536).max(1);
    let mut sample: Vec<f32> = values.iter().step_by(step).copied().filter(|v| v.is_finite()).collect();
    if sample.is_empty() { return 0.0; }
    sample.sort_by(|a, b| a.partial_cmp(b).unwrap_or(Ordering::Equal));
    sample[((sample.len() - 1) as f64 * q.clamp(0.0, 1.0)).round() as usize]
}

/// The carve as it was before tunnels, kept to prove that amount 0 is byte-identical (remove once checked).
#[cfg(test)]
#[path = "underdark_reference.rs"]
mod underdark_reference;

#[derive(PartialEq)]
struct Node(f32, u32);
impl Eq for Node {}
impl PartialOrd for Node { fn partial_cmp(&self, o: &Self) -> Option<Ordering> { Some(self.cmp(o)) } }
impl Ord for Node {
    fn cmp(&self, o: &Self) -> Ordering { o.0.partial_cmp(&self.0).unwrap_or(Ordering::Equal).then(o.1.cmp(&self.1)) }
}

/// Carve the underworld from a square surface of `heights` (metres) over `width` metres, default options.
pub fn carve(seed: &str, width: f64, heights: &[f32]) -> Result<UnderdarkField, String> {
    carve_with(seed, width, heights, &UnderdarkOptions::default())
}

/// Carve the underworld with explicit options.
pub fn carve_with(seed: &str, width: f64, heights: &[f32], options: &UnderdarkOptions) -> Result<UnderdarkField, String> {
    let (tubes, passages) = tunnel_counts(options.natural_tunnels, width as f32);
    carve_counts(seed, width, heights, tubes, passages)
}

fn carve_counts(seed: &str, width: f64, heights: &[f32], tube_count: usize, passage_count: usize) -> Result<UnderdarkField, String> {
    let n = (heights.len() as f64).sqrt() as usize;
    if n < 16 || n * n != heights.len() { return Err("Underdark: square surface of at least 16² required.".into()); }
    if !heights.iter().all(|h| h.is_finite()) { return Err("Underdark: non-finite surface.".into()); }
    let cell = (width / n as f64) as f32;
    let root = Rng::new(&format!("magna-urbis:{seed}")).fork("underdark");
    let noise = Noise::new(root.fork("walls"));
    let noise2 = Noise::new(root.fork("caverns"));
    let noise3 = Noise::new(root.fork("galleries"));
    let total = n * n;
    let w = width as f32;
    let world = |i: usize| (((i % n) as f64 + 0.5) * cell as f64, ((i / n) as f64 + 0.5) * cell as f64);

    // 1. Floor: the relief, lifted above zero, its range compressed above 600 m (monotonic: drainage holds).
    // Cave floors are gentler than the surface (silted, worn): the range is compressed above 250 m and the floor
    // lightly smoothed, which leaves shelves for towns and grades for roads; the walls carry the drama.
    let lo = heights.iter().copied().fold(f32::INFINITY, f32::min);
    let compressed: Vec<f32> = heights.iter().map(|&h| {
        let d = h - lo;
        4.0 + if d > 250.0 { 250.0 + (d - 250.0) * 0.25 } else { d }
    }).collect();
    let floor = box_blur(&compressed, n, ((40.0 / cell).round() as usize).clamp(1, 4));
    let range = floor.iter().copied().fold(0.0f32, f32::max).max(1.0);

    // 2. Drainage of a lightly smoothed floor: upstream area in m².
    let smooth = box_blur(&floor, n, ((60.0 / cell).round() as usize).clamp(0, 6));
    let grids = crate::priority_flood::flood_grids(&smooth, n, (cell * cell) as f64, None, None, None);
    let area = grids.accumulation;

    let a_min = (w * w * 0.0016).max(30.0 * cell * cell);
    let r0 = (w * 0.0032).max(2.2 * cell).min(90.0);
    let r_max = (w * 0.018).max(4.0 * cell);

    // 4. Caverns: basins and plains below their surroundings, shaped by a broad noise.
    let reach = ((w * 0.05 / cell).round() as usize).clamp(3, n / 4);
    let surroundings = box_blur(&floor, n, reach);
    let mut depth: Vec<f32> = (0..total).map(|i| surroundings[i] - floor[i]).collect();
    let spread = quantile(&depth.iter().map(|d| d.abs()).collect::<Vec<_>>(), 0.75).max(1.0);
    let mut slope = vec![0.0f32; total];
    for y in 0..n {
        for x in 0..n {
            let i = y * n + x;
            let gx = floor[y * n + (x + 1).min(n - 1)] - floor[y * n + x.saturating_sub(1)];
            let gy = floor[(y + 1).min(n - 1) * n + x] - floor[y.saturating_sub(1) * n + x];
            slope[i] = (gx * gx + gy * gy).sqrt() / (2.0 * cell);
        }
    }
    let flat_ref = quantile(&slope, 0.5).max(1e-4);
    crate::terrain_par::rows(&mut depth, n, |y, row| {
        for (x, d) in row.iter_mut().enumerate() {
            let i = y * n + x;
            let (px, py) = (((x as f64) + 0.5) * cell as f64, ((y as f64) + 0.5) * cell as f64);
            let shape = noise2.fbm(px / (w as f64 * 0.09) + 31.0, py / (w as f64 * 0.09) - 7.0, 4) as f32;
            let flat = (1.0 - slope[i] / (2.5 * flat_ref)).clamp(0.0, 1.0);
            *d = *d / spread + 0.8 * flat + 2.4 * shape;
        }
    });
    let cavern_cut = quantile(&depth, 0.80);
    let cavern: Vec<bool> = depth.iter().map(|&p| p > cavern_cut).collect();

    // 5. Dry galleries: zero crossings of a warped noise, a sparse labyrinth of narrow passages.
    let lambda = (w as f64 * 0.11).max(400.0);
    let mut gallery_value = vec![0.0f32; total];
    crate::terrain_par::rows(&mut gallery_value, n, |y, row| {
        for (x, v) in row.iter_mut().enumerate() {
            let (px, py) = (((x as f64) + 0.5) * cell as f64, ((y as f64) + 0.5) * cell as f64);
            let wx = px / lambda + 0.5 * noise3.fbm(px / lambda * 0.7 + 5.0, py / lambda * 0.7, 2);
            let wy = py / lambda + 0.5 * noise3.fbm(px / lambda * 0.7, py / lambda * 0.7 - 9.0, 2);
            let keep = noise3.fbm(px / (lambda * 1.8) - 40.0, py / (lambda * 1.8) + 12.0, 2);
            *v = if keep > -0.05 { noise3.fbm(wx, wy, 3).abs() as f32 } else { 1.0 };
        }
    });
    let gallery_half = (r0 * 0.7).max(1.8 * cell) / (lambda as f32 * 0.9);

    // 3. Corridors: river corridors whose radius grows with the upstream area, swelling into river rooms.
    // (Computed after the caverns and galleries, which do not depend on them: river passages need both.)
    let mut tunnel = vec![f32::NEG_INFINITY; total];
    for i in 0..total {
        if area[i] < a_min { continue; }
        let (x, y) = world(i);
        let rooms = 1.0 + 0.9 * (noise2.fbm(x / (w as f64 * 0.035), y / (w as f64 * 0.035), 2) as f32 * 2.2).clamp(-0.45, 1.0);
        tunnel[i] = (r0 * (area[i] / a_min).powf(0.33) * rooms).min(r_max) / cell;
    }
    // River passages: where a river crosses thick rock, its corridor narrows to a slot of near-constant width
    // that is neither warped nor roughened, so the river keeps its line and its downstream grade.
    let passages = if passage_count == 0 { Vec::new() } else {
        let other: Vec<bool> = (0..total).map(|i| cavern[i] || gallery_value[i] < gallery_half * 1.2).collect();
        river_passage_runs(&area, &grids.receiver, &tunnel, &other, n, cell, a_min, r0, w, passage_count)
    };
    // Per passage: its gut's half width (m, from a tenth of the corridor radius) and, per passage cell, (cell, corridor
    // radius before narrowing, carved slot radius) in cells. The slot opens the D8 chain itself (and the cells within
    // the half width when it exceeds a cell); the soft wall field draws the gut at its real width.
    let passages: Vec<(f32, Vec<(usize, f32, f32)>)> = passages.into_iter().map(|run| {
        let wide = run.iter().map(|&c| tunnel[c]).sum::<f32>() / run.len() as f32;
        let half = (0.1 * wide * cell).clamp(4.0, 9.0);
        let slot = (half / cell).max(0.5);
        (half, run.into_iter().map(|c| (c, tunnel[c], slot)).collect())
    }).collect();
    let mut guts = Guts::default();
    let mut slot_radius = vec![0.0f32; if passages.is_empty() { 0 } else { total }];
    for (_, run) in &passages { for &(c, _, s) in run { slot_radius[c] = s; tunnel[c] = s; } }
    propagate_max(&mut tunnel, n, 1.0);
    // Slot zone weight (1 in the slot, fading to 0 over the warp's reach): no warp and no wall noise there.
    let warp_amp = 1.3 * r0 / cell;
    let (to_slot, slot_near) = if passages.is_empty() { (Vec::new(), Vec::new()) } else {
        nearest_seed(&slot_radius.iter().map(|&s| s > 0.0).collect::<Vec<_>>(), n)
    };
    let calm = |i: usize| -> f32 {
        if to_slot.is_empty() || slot_near[i] == u32::MAX { return 0.0; }
        let d = to_slot[i] - (slot_radius[slot_near[i] as usize] + 1.5);
        if d <= 0.0 { return 1.0; }
        let t = (d / (2.0 * warp_amp + 2.0)).min(1.0);
        1.0 - t * t * (3.0 - 2.0 * t)
    };
    // Warp the corridors: D8 drainage draws straight diagonals; caves meander around them.
    let warp_len = r0 as f64 * 7.0;
    let mut warped = vec![f32::NEG_INFINITY; total];
    crate::terrain_par::rows(&mut warped, n, |y, row| {
        for (x, v) in row.iter_mut().enumerate() {
            let (px, py) = (((x as f64) + 0.5) * cell as f64, ((y as f64) + 0.5) * cell as f64);
            let mut dx = warp_amp * noise3.fbm(px / warp_len + 101.0, py / warp_len, 3) as f32 * 2.0;
            let mut dy = warp_amp * noise3.fbm(px / warp_len, py / warp_len - 57.0, 3) as f32 * 2.0;
            if !to_slot.is_empty() {
                let keep = 1.0 - calm(y * n + x);
                dx *= keep;
                dy *= keep;
            }
            let sx = (x as f32 + dx).round().clamp(0.0, (n - 1) as f32) as usize;
            let sy = (y as f32 + dy).round().clamp(0.0, (n - 1) as f32) as usize;
            *v = tunnel[sy * n + sx];
        }
    });
    let tunnel = warped;

    // 6. Wall noise, pillars and the union of the openings.
    let mut open = vec![false; total];
    for i in 0..total {
        let (x, y) = world(i);
        let wall = noise.fbm(x / (r0 as f64 * 5.0), y / (r0 as f64 * 5.0), 3) as f32;
        let rough = if to_slot.is_empty() { wall } else { wall * (1.0 - calm(i)) };
        let t = tunnel[i] + rough * (r0 / cell) * 0.9;
        let g = gallery_value[i] < gallery_half * (1.0 + 0.6 * wall);
        let pillar = cavern[i] && noise.noise(x / (r0 as f64 * 3.2) + 77.0, y / (r0 as f64 * 3.2) - 3.0) > 0.68;
        open[i] = (t > 0.0 || cavern[i] || g) && !pillar;
    }
    // A river passage's D8 chain steps diagonally: the lower corner of each diagonal step opens too, so the gut is
    // 4-connected (the bilinear wall field would pinch a diagonal-only link shut).
    for (_, run) in &passages {
        for pair in run.windows(2) {
            let (a, b) = (pair[0].0, pair[1].0);
            let (ax, ay, bx, by) = (a % n, a / n, b % n, b / n);
            if ax == bx || ay == by { continue; }
            let (k1, k2) = (ay * n + bx, by * n + ax);
            let k = if floor[k2] < floor[k1] { k2 } else { k1 };
            if !open[k] { open[k] = true; guts.cells.push((k, false)); }
        }
    }

    // 7. Clean specks: tiny openings close, tiny rock grains open (pillars keep a few cells).
    // Chambers smaller than a short tunnel reach close: they would only hang as stubs on the network.
    let min_open = ((std::f32::consts::PI * (2.2 * r0) * (2.2 * r0)) / (cell * cell)).max(12.0) as usize;
    let (labels, sizes) = components(&open, n);
    for i in 0..total { if open[i] && sizes[labels[i] as usize] < min_open { open[i] = false; } }
    let rock: Vec<bool> = open.iter().map(|o| !o).collect();
    let (labels, sizes) = components(&rock, n);
    let min_rock = ((r0 * r0) / (cell * cell)).max(4.0) as usize;
    for i in 0..total { if rock[i] && sizes[labels[i] as usize] < min_rock { open[i] = true; } }

    // 8. One network: every remaining chamber is joined to the largest by its cheapest passage.
    let (labels, sizes) = components(&open, n);
    if let Some(main) = (0..sizes.len()).max_by_key(|&k| sizes[k]) {
        let mut cost = vec![f32::INFINITY; total];
        let mut from = vec![u32::MAX; total];
        let mut heap = BinaryHeap::new();
        for i in 0..total {
            if open[i] && labels[i] as usize == main { cost[i] = 0.0; heap.push(Node(0.0, i as u32)); }
        }
        while let Some(Node(c, i)) = heap.pop() {
            let i = i as usize;
            if c > cost[i] { continue; }
            let (x, y) = ((i % n) as isize, (i / n) as isize);
            for dy in -1..=1isize {
                for dx in -1..=1isize {
                    if dx == 0 && dy == 0 { continue; }
                    let (nx, ny) = (x + dx, y + dy);
                    if nx < 0 || ny < 0 || nx >= n as isize || ny >= n as isize { continue; }
                    let j = ny as usize * n + nx as usize;
                    let step = if dx != 0 && dy != 0 { SQRT2 } else { 1.0 };
                    let (px, py) = world(j);
                    let rough = 1.0 + 0.8 * noise.noise(px / (r0 as f64 * 3.0) - 50.0, py / (r0 as f64 * 3.0)).abs() as f32;
                    let climb = (floor[j] - floor[i]).abs() / cell;
                    let c2 = c + step * if open[j] { 1.0 } else { 6.0 * rough + 4.0 * climb };
                    if c2 < cost[j] { cost[j] = c2; from[j] = i as u32; heap.push(Node(c2, j as u32)); }
                }
            }
        }
        // Cheapest cell of each detached chamber.
        let mut best = vec![(f32::INFINITY, u32::MAX); sizes.len()];
        for i in 0..total {
            if open[i] && labels[i] as usize != main {
                let b = &mut best[labels[i] as usize];
                if cost[i] < b.0 { *b = (cost[i], i as u32); }
            }
        }
        let radius = ((r0 * 0.8) / cell).max(1.5);
        let reach = radius.ceil() as isize;
        let mut passage = vec![false; total];
        for (k, &(c, start)) in best.iter().enumerate() {
            if k == main || !c.is_finite() || start == u32::MAX { continue; }
            let mut i = start as usize;
            while from[i] != u32::MAX && !(open[i] && labels[i] as usize == main) {
                passage[i] = true;
                i = from[i] as usize;
            }
        }
        let mut widened = open.clone();
        for i in 0..total {
            if !passage[i] { continue; }
            let (x, y) = ((i % n) as isize, (i / n) as isize);
            for dy in -reach..=reach {
                for dx in -reach..=reach {
                    if ((dx * dx + dy * dy) as f32).sqrt() > radius { continue; }
                    let (nx, ny) = (x + dx, y + dy);
                    if nx < 0 || ny < 0 || nx >= n as isize || ny >= n as isize { continue; }
                    widened[ny as usize * n + nx as usize] = true;
                }
            }
        }
        open = widened;
    }

    // 8b. Natural tunnels. A river passage's floor never rises downstream: each cross-section takes the lowest
    // floor of the corridor it replaces (running minimum downstream), so the slot never dams the river.
    let mut floor = floor;
    let mut tunnels: Vec<UnderdarkTunnel> = Vec::new();
    if !passages.is_empty() {
        let mut level = vec![f32::NAN; total];
        for (_, run) in &passages {
            let mut low = f32::INFINITY;
            for &(c, wide, _) in run {
                let reach = (wide * 0.8).max(1.0);
                let rr = reach.ceil() as isize;
                let (cx, cy) = ((c % n) as isize, (c / n) as isize);
                let mut lowest = floor[c];
                for dy in -rr..=rr {
                    for dx in -rr..=rr {
                        let (x, y) = (cx + dx, cy + dy);
                        if x < 0 || y < 0 || x >= n as isize || y >= n as isize || ((dx * dx + dy * dy) as f32) > reach * reach { continue; }
                        lowest = lowest.min(floor[y as usize * n + x as usize]);
                    }
                }
                low = low.min(lowest);
                level[c] = low;
            }
        }
        for i in 0..total {
            if !open[i] || slot_near[i] == u32::MAX { continue; }
            let c = slot_near[i] as usize;
            if level[c].is_nan() || to_slot[i] > slot_radius[c] + 1.5 { continue; }
            floor[i] = floor[i].min(level[c] + 0.05 * to_slot[i] * cell);
        }
        for (half, run) in &passages {
            let mut points: Vec<[f32; 2]> = run.iter().step_by(2).map(|&(c, _, _)| { let p = world(c); [p.0 as f32, p.1 as f32] }).collect();
            if run.len() % 2 == 0 { if let Some(&(c, _, _)) = run.last() { let p = world(c); points.push([p.0 as f32, p.1 as f32]); } }
            tunnels.push(UnderdarkTunnel { kind: TUNNEL_RIVER_PASSAGE, half_width: *half, points });
            guts.lines.push(run.iter().map(|&(c, _, _)| ((c % n) as f32 + 0.5, (c / n) as f32 + 0.5, half / cell)).collect());
        }
        // The slot's own cells: the chain and, where the half width exceeds a cell, the cells within it.
        for i in 0..total {
            if open[i] && slot_near[i] != u32::MAX && to_slot[i] <= slot_radius[slot_near[i] as usize] { guts.cells.push((i, slot_radius[i] > 0.0)); }
        }
    }
    if tube_count > 0 {
        tunnels.extend(lava_tubes(&mut open, &mut floor, &grids.filled, n, cell, w, tube_count, &root.fork("lava-tubes"), &mut guts));
    }

    // 9. Wall distance: smoothed, then held to the carved sign so narrow passages keep their connection.
    let (sdf, dist, near, to_rock) = wall_distance(&open, n);
    // The exported soft field draws each natural tunnel at its real width; the relief below keeps the plain distance.
    let soft = if guts.lines.is_empty() { None } else { Some(gut_soft_field(&sdf, &open, &guts, n)) };

    // Underground lakes: some caverns sink into a bowl, deepest far from the walls; the water budget fills it.
    let bowl_reach = (r0 * 3.0).max(4.0 * cell);
    // Lakes sit on the rivers (a bowl away from the drainage would stay dry in the water budget): a cavern
    // qualifies near a corridor that drains at least 20 tunnel heads.
    let mut river = vec![f32::NEG_INFINITY; total];
    for i in 0..total { if area[i] >= 20.0 * a_min { river[i] = 0.0; } }
    propagate_max(&mut river, n, 1.0);
    crate::terrain_par::rows(&mut floor, n, |y, row| {
        for (x, f) in row.iter_mut().enumerate() {
            let i = y * n + x;
            if !open[i] || !cavern[i] || -river[i] * cell > bowl_reach * 4.0 { continue; }
            let (px, py) = (((x as f64) + 0.5) * cell as f64, ((y as f64) + 0.5) * cell as f64);
            let lake = noise2.fbm(px / (w as f64 * 0.07) - 211.0, py / (w as f64 * 0.07) + 63.0, 2) as f32;
            if lake <= 0.0 { continue; }
            let t = (to_rock[i] * cell / bowl_reach).min(1.0);
            *f -= (8.0 + 40.0 * lake).min(18.0) * t * t * (3.0 - 2.0 * t) * (lake / 0.04).min(1.0);
        }
    });
    let lo = floor.iter().copied().fold(f32::INFINITY, f32::min);
    if lo < 2.0 { for f in &mut floor { *f += 2.0 - lo; } }

    // 10. Rock rises continuously from the floor of its nearest opening along the smoothed wall distance
    // (no step at the wall: the interpolated floor would shade a staircase); open floor keeps the relief.
    let wall = (60.0 + range * 0.12).min(260.0);
    let ramp = (r0 * 2.0).max(4.0 * cell);
    let mut height = vec![0.0f32; total];
    crate::terrain_par::rows(&mut height, n, |y, row| {
        for (x, h) in row.iter_mut().enumerate() {
            let i = y * n + x;
            if open[i] { *h = floor[i]; continue; }
            let base = if near[i] == u32::MAX { floor[i] } else { floor[near[i] as usize] };
            // The rise starts two cells inside the rock: the display's cubic spline does not spread it onto the floor.
            let t = ((sdf[i] - 2.0) * cell / ramp).clamp(0.0, 1.0);
            let rise = t * t * (3.0 - 2.0 * t);
            let (px, py) = (((x as f64) + 0.5) * cell as f64, ((y as f64) + 0.5) * cell as f64);
            let crag = noise.ridged(px / (ramp as f64 * 2.0), py / (ramp as f64 * 2.0), 3) as f32;
            *h = base + 0.5 + wall * rise + wall * 0.18 * crag * rise + dist[i] * cell * 0.02;
        }
    });
    // 11. Lakes and silt: a closed basin of middling size (0.04 % to 2 % of the map, at least 4 m deep) stays
    // closed, so the water budget fills it as an underground lake; every other basin fills with sediment
    // (small pits and the huge drowned valleys alike), which leaves flat cavern floors.
    let filled = crate::priority_flood::flood_surface(&height, n, false).filled;
    let pit: Vec<bool> = (0..total).map(|i| filled[i] - height[i] > 0.01).collect();
    let (labels, sizes) = components(&pit, n);
    let mut deepest = vec![0.0f32; sizes.len()];
    for i in 0..total { if pit[i] { let d = &mut deepest[labels[i] as usize]; *d = d.max(filled[i] - height[i]); } }
    let (lake_min, lake_max) = ((total as f32 * 0.0004) as usize, (total as f32 * 0.02) as usize);
    let keep: Vec<bool> = (0..sizes.len()).map(|k| deepest[k] >= 4.0 && (lake_min..=lake_max).contains(&sizes[k])).collect();
    for i in 0..total { if pit[i] && !keep[labels[i] as usize] { height[i] = filled[i]; } }
    Ok(UnderdarkField { height, rock: open.iter().map(|&o| u8::from(!o)).collect(), sdf: soft.unwrap_or(sdf), tunnels })
}

/// Signed wall distance of an open mask in cells (> 0 in rock), smoothed, then held to the carved sign so narrow
/// passages keep their connection; with the distance to (and index of) each cell's nearest opening and its distance
/// to the nearest rock.
fn wall_distance(open: &[bool], n: usize) -> (Vec<f32>, Vec<f32>, Vec<u32>, Vec<f32>) {
    let total = n * n;
    let (dist, near) = nearest_seed(open, n);
    let rock: Vec<bool> = open.iter().map(|o| !o).collect();
    let (to_rock, _) = nearest_seed(&rock, n);
    let raw: Vec<f32> = (0..total).map(|i| if open[i] { 0.5 - to_rock[i] } else { dist[i] - 0.5 }).collect();
    // Only cells whose smoothed sign contradicts the carve (thin necks and spurs) are pinned, well clear of the
    // wall value so that no plateau sits on the wall line (it drew flat cell-sized ledges).
    let sdf: Vec<f32> = box_blur(&box_blur(&raw, n, 1), n, 1).iter().zip(open)
        .map(|(&d, &o)| if o && d > -0.05 { -0.6 } else if !o && d < 0.05 { 0.6 } else { d }).collect();
    (sdf, dist, near, to_rock)
}

/// The guts of the natural tunnels, for the soft wall field: centre lines in cells (x, y, half width; cell centres at
/// i + 0.5) and the open cells that only the tunnels carved (true on the centre line).
#[derive(Default)]
struct Guts {
    lines: Vec<Vec<(f32, f32, f32)>>,
    cells: Vec<(usize, bool)>,
}

/// The soft wall field with each natural tunnel drawn at its real width. Within reach of a gut, the wall distance is
/// the smaller of the distance to the other openings and the distance to the gut's centre line minus its half width,
/// so the field's zero contour sits at the half width however narrow the gut. It stays held to the carve: the gut's
/// cells stay open (a centre-line cell at least its half width deep), rock stays rock, so the sign at every cell
/// centre, which the planning mask reads, is unchanged. The planning raster keeps whole open cells along the gut.
fn gut_soft_field(sdf: &[f32], open: &[bool], guts: &Guts, n: usize) -> Vec<f32> {
    const REACH: f32 = 2.5;
    let total = n * n;
    // 0 not a gut's, 1 carved by a gut, 2 under its centre line.
    let mut own = vec![0u8; total];
    for &(c, on_line) in &guts.cells { if open[c] { own[c] = own[c].max(1 + u8::from(on_line)); } }
    let rest: Vec<bool> = (0..total).map(|i| open[i] && own[i] == 0).collect();
    let other = wall_distance(&rest, n).0;
    let mut gut = vec![f32::INFINITY; total];
    let mut half = vec![0.0f32; total];
    for line in &guts.lines {
        for (k, &a) in line.iter().enumerate() {
            let b = line[(k + 1).min(line.len() - 1)];
            let reach = a.2.max(b.2) + REACH;
            let span = |lo: f32, hi: f32| ((lo - reach).floor().max(0.0) as usize, ((hi + reach).ceil().max(0.0) as usize).min(n - 1));
            let ((x0, x1), (y0, y1)) = (span(a.0.min(b.0), a.0.max(b.0)), span(a.1.min(b.1), a.1.max(b.1)));
            let (dx, dy) = (b.0 - a.0, b.1 - a.1);
            let l2 = dx * dx + dy * dy;
            for y in y0..=y1 {
                for x in x0..=x1 {
                    let (px, py) = (x as f32 + 0.5, y as f32 + 0.5);
                    let t = if l2 > 0.0 { (((px - a.0) * dx + (py - a.1) * dy) / l2).clamp(0.0, 1.0) } else { 0.0 };
                    let r = a.2 + (b.2 - a.2) * t;
                    let v = (px - a.0 - t * dx).hypot(py - a.1 - t * dy) - r;
                    let i = y * n + x;
                    if v < gut[i] { gut[i] = v; half[i] = r; }
                }
            }
        }
    }
    let mut out = sdf.to_vec();
    for i in 0..total {
        if !gut[i].is_finite() { continue; }
        let s = other[i].min(gut[i]);
        out[i] = match own[i] {
            2 => s.min(-half[i].max(0.05)),
            _ if open[i] => s.min(-0.05),
            _ => s.max(0.05),
        };
    }
    out
}

/// Natural tunnel kinds, also their wire codes in [`tunnels_wire`]. Code 3 is reserved for dug road tunnels.
pub const TUNNEL_LAVA_TUBE: u8 = 1;
pub const TUNNEL_RIVER_PASSAGE: u8 = 2;

/// A natural tunnel: a narrow passage of near-constant width through a rock mass, with two mouths.
#[derive(Clone, Debug, PartialEq)]
pub struct UnderdarkTunnel {
    pub kind: u8,
    /// Half width of the gut in metres, also where the soft wall field draws its walls, however narrow. The planning
    /// raster keeps a 4-connected chain of whole open cells under the centre line; on a coarse grid the drawn gut
    /// follows that chain (within half a cell of the line) and reads about 0.7 cell wide on diagonal reaches.
    pub half_width: f32,
    /// Centre line in metres, mouth to mouth: a lava tube runs downhill, a river passage downstream.
    pub points: Vec<[f32; 2]>,
}

/// Carve options carried by the recipe (`TerrainSettings.underdarkTunnels`).
#[derive(Clone, Copy, Debug)]
pub struct UnderdarkOptions {
    /// Natural tunnels amount: 0 none (the carve is then unchanged), 1 a few (default), up to 3.
    pub natural_tunnels: f32,
}

impl Default for UnderdarkOptions {
    fn default() -> Self { Self { natural_tunnels: 1.0 } }
}

/// Flattened wire form: per tunnel `[kind, half_width, count, x0, y0, x1, y1, …]` (metres).
pub fn tunnels_wire(tunnels: &[UnderdarkTunnel]) -> Vec<f32> {
    let mut out = Vec::new();
    for t in tunnels {
        out.extend([t.kind as f32, t.half_width, t.points.len() as f32]);
        for p in &t.points { out.extend(p); }
    }
    out
}

/// Tunnel counts for an amount: about 4 lava tubes and 2 river passages on a 10 km map at amount 1,
/// 6 and 3 on a 40 km map; amount 0 gives none.
fn tunnel_counts(amount: f32, w: f32) -> (usize, usize) {
    let amount = if amount.is_finite() { amount.clamp(0.0, 3.0) } else { 0.0 };
    let scale = (w / 10_000.0).sqrt().clamp(0.5, 3.0);
    ((amount * (2.0 + 2.0 * scale)).round() as usize, (amount * (1.0 + scale)).round() as usize)
}

/// River passages: reaches of a river corridor that cross thick rock, far from any cavern, gallery or
/// side corridor, with no confluence. Returns each chosen reach as its D8 chain, upstream first.
#[allow(clippy::too_many_arguments)]
fn river_passage_runs(area: &[f32], receiver: &[i32], radius: &[f32], other: &[bool], n: usize, cell: f32,
    a_min: f32, r0: f32, w: f32, count: usize) -> Vec<Vec<usize>> {
    let total = n * n;
    let (to_other, _) = nearest_seed(other, n);
    let river_area = 8.0 * a_min;
    // A corridor-bearing tributary ends a reach: a passage is one river through one barrier.
    let mut branches = vec![0u8; total];
    for i in 0..total {
        if area[i] >= a_min && receiver[i] >= 0 { let r = receiver[i] as usize; branches[r] = branches[r].saturating_add(1); }
    }
    let margin = 2.0 + r0 / cell;
    let barrier: Vec<bool> = (0..total).map(|i| {
        let (x, y) = (i % n, i / n);
        area[i] >= river_area && receiver[i] >= 0 && branches[i] <= 1 && radius[i].is_finite()
            && x >= 4 && y >= 4 && x + 4 < n && y + 4 < n && to_other[i] >= radius[i] + margin
    }).collect();
    let mut fed = vec![false; total];
    for i in 0..total { if barrier[i] { fed[receiver[i] as usize] = true; } }
    let min_len = 200.0f32.max(6.0 * cell);
    let mut runs: Vec<(f32, Vec<usize>)> = Vec::new();
    for start in 0..total {
        if !barrier[start] || fed[start] { continue; }
        let (mut run, mut len, mut wide, mut i) = (vec![start], 0.0f32, radius[start], start);
        while receiver[i] >= 0 {
            let j = receiver[i] as usize;
            if !barrier[j] { break; }
            let (dx, dy) = ((j % n) as f32 - (i % n) as f32, (j / n) as f32 - (i / n) as f32);
            len += (dx * dx + dy * dy).sqrt() * cell;
            wide = wide.max(radius[j]);
            run.push(j);
            i = j;
        }
        // The wide corridor flares into both ends over its own radius: the slot must outlast both flares.
        if len >= min_len.max(3.0 * wide * cell) { runs.push((len, run)); }
    }
    runs.sort_by(|a, b| b.0.partial_cmp(&a.0).unwrap_or(Ordering::Equal).then(a.1[0].cmp(&b.1[0])));
    let spread = w * 0.08 / cell;
    let mut chosen: Vec<Vec<usize>> = Vec::new();
    let mut mids: Vec<(f32, f32)> = Vec::new();
    for (_, run) in runs {
        if chosen.len() >= count { break; }
        let m = run[run.len() / 2];
        let mid = ((m % n) as f32, (m / n) as f32);
        if mids.iter().any(|o| (o.0 - mid.0).hypot(o.1 - mid.1) < spread) { continue; }
        mids.push(mid);
        chosen.push(run);
    }
    chosen
}

/// Lava tubes: where two chambers face each other across a rock mass but are far apart through the network,
/// a smooth, gently sinuous tube of near-constant width joins them in a gentle monotonic grade. Its floor
/// stays above the water level near both mouths (`water`: a filled surface), so it drains to the lower
/// mouth and captures no river. `open` and `floor` are updated, each tube's gut is added to `guts`; the tubes are
/// returned high mouth first.
#[allow(clippy::too_many_arguments)]
fn lava_tubes(open: &mut [bool], floor: &mut [f32], water: &[f32], n: usize, cell: f32, w: f32, count: usize,
    rng: &Rng, guts: &mut Guts) -> Vec<UnderdarkTunnel> {
    let total = n * n;
    if count == 0 { return Vec::new(); }
    let rock: Vec<bool> = open.iter().map(|o| !o).collect();
    let (to_rock, _) = nearest_seed(&rock, n);
    // Hubs: the widest points of the chambers, spread over the map.
    let sep = (w * 0.035 / cell).max(6.0);
    let stride = (n / 96).max(2);
    let min_clear = (30.0 / cell).max(2.0);
    let mut cand: Vec<(f32, usize)> = Vec::new();
    for y in (stride / 2..n).step_by(stride) {
        for x in (stride / 2..n).step_by(stride) {
            let i = y * n + x;
            if open[i] && to_rock[i] >= min_clear && x >= 4 && y >= 4 && x + 4 < n && y + 4 < n { cand.push((to_rock[i], i)); }
        }
    }
    cand.sort_by(|a, b| b.0.partial_cmp(&a.0).unwrap_or(Ordering::Equal).then(a.1.cmp(&b.1)));
    let at = |i: usize| ((i % n) as f32 + 0.5, (i / n) as f32 + 0.5);
    let mut hubs: Vec<usize> = Vec::new();
    for &(_, i) in &cand {
        if hubs.len() >= 48 { break; }
        let (x, y) = at(i);
        if hubs.iter().all(|&h| { let (hx, hy) = at(h); (hx - x).hypot(hy - y) >= sep }) { hubs.push(i); }
    }
    if hubs.len() < 2 { return Vec::new(); }

    // Network distance between hubs on a coarse grid: a block is open when any of its cells is, so the
    // distance is a lower bound and the detour ratio errs on the side of fewer tubes.
    let c = (n / 128).max(1);
    let m = n.div_ceil(c);
    let coarse = |i: usize| (i / n / c) * m + (i % n) / c;
    let mut copen = vec![false; m * m];
    for i in 0..total { if open[i] { copen[coarse(i)] = true; } }
    let step = c as f32 * cell;
    let l_min = 300.0f32.max(8.0 * cell);
    let l_max = (w * 0.2).min(4000.0).max(l_min * 1.5);
    let cap = l_max * 8.0;
    let k = hubs.len();
    // One coarse network-distance field per hub.
    let mut fields = vec![f32::INFINITY; k * m * m];
    let mut heap = BinaryHeap::new();
    for (a, &ha) in hubs.iter().enumerate() {
        let dist = &mut fields[a * m * m..(a + 1) * m * m];
        heap.clear();
        let s = coarse(ha);
        dist[s] = 0.0;
        heap.push(Node(0.0, s as u32));
        while let Some(Node(d, b)) = heap.pop() {
            let b = b as usize;
            if d > dist[b] { continue; }
            if d > cap { break; }
            let (bx, by) = ((b % m) as isize, (b / m) as isize);
            for dy in -1..=1isize {
                for dx in -1..=1isize {
                    if dx == 0 && dy == 0 { continue; }
                    let (nx, ny) = (bx + dx, by + dy);
                    if nx < 0 || ny < 0 || nx >= m as isize || ny >= m as isize { continue; }
                    let j = ny as usize * m + nx as usize;
                    if !copen[j] { continue; }
                    let d2 = d + step * if dx != 0 && dy != 0 { SQRT2 } else { 1.0 };
                    if d2 < dist[j] { dist[j] = d2; heap.push(Node(d2, j as u32)); }
                }
            }
        }
    }

    // Candidates: every rock run that the line between two hubs crosses, from the open floor before it to the
    // open floor after it (in a labyrinth such a line crosses several passages). The way round between the two
    // mouths is bounded below by each hub's network distance (triangle inequality): the detour errs low.
    let r_min = 200.0f32.max(4.0 * cell);
    let reach = (w * 0.3).min(6000.0);
    let open_at = |open: &[bool], p: (f32, f32)| {
        let (cx, cy) = ((p.0.floor() as isize).clamp(0, n as isize - 1) as usize, (p.1.floor() as isize).clamp(0, n as isize - 1) as usize);
        open[cy * n + cx]
    };
    let index = |p: (f32, f32)| (p.1.floor().clamp(0.0, (n - 1) as f32) as usize) * n + p.0.floor().clamp(0.0, (n - 1) as f32) as usize;
    struct Cand { score: f32, ma: (f32, f32), mb: (f32, f32), key: (usize, usize) }
    let mut cands: Vec<Cand> = Vec::new();
    for a in 0..k {
        for b in a + 1..k {
            let (pa, pb) = (at(hubs[a]), at(hubs[b]));
            let d_cells = (pb.0 - pa.0).hypot(pb.1 - pa.1);
            if d_cells * cell > reach { continue; }
            let samples = (d_cells / 0.5).ceil().max(2.0) as usize;
            let point = |s: usize| { let t = s as f32 / samples as f32; (pa.0 + (pb.0 - pa.0) * t, pa.1 + (pb.1 - pa.1) * t) };
            let mut s = 0;
            while s <= samples {
                if open_at(&*open, point(s)) { s += 1; continue; }
                let first = s;
                while s <= samples && !open_at(&*open, point(s)) { s += 1; }
                if first == 0 || s > samples { continue; }
                let (ma, mb) = (point(first - 1), point(s));
                let run = (mb.0 - ma.0).hypot(mb.1 - ma.1) * cell;
                if run < r_min || run > l_max { continue; }
                let (ia, ib) = (index(ma), index(mb));
                let (ca, cb) = (coarse(ia), coarse(ib));
                let mut bound = 0.0f32;
                for h in [a, b] {
                    let (x, y) = (fields[h * m * m + ca], fields[h * m * m + cb]);
                    bound = bound.max(match (x.is_finite(), y.is_finite()) { (true, true) => (x - y).abs(), (false, false) => 0.0, _ => cap });
                }
                if bound.min(cap) < 2.5 * run { continue; }
                cands.push(Cand { score: bound.min(cap) - run, ma, mb, key: (ia.min(ib), ia.max(ib)) });
            }
        }
    }
    cands.sort_by(|x, y| y.score.partial_cmp(&x.score).unwrap_or(Ordering::Equal).then(x.key.cmp(&y.key)));

    // Water level near a mouth: the highest filled level of the open floor within four cells.
    let level = |open: &[bool], floor: &[f32], p: (f32, f32)| {
        let (px, py) = (p.0.floor() as isize, p.1.floor() as isize);
        let mut top = f32::NEG_INFINITY;
        for dy in -4..=4isize {
            for dx in -4..=4isize {
                let (x, y) = (px + dx, py + dy);
                if x < 0 || y < 0 || x >= n as isize || y >= n as isize || dx * dx + dy * dy > 16 { continue; }
                let j = y as usize * n + x as usize;
                if open[j] { top = top.max(floor[j].max(water[j])); }
            }
        }
        top
    };
    let mut mids: Vec<(f32, f32)> = Vec::new();
    let mut tube_dist = vec![f32::INFINITY; total];
    let mut tunnels = Vec::new();
    for cand in cands {
        if tunnels.len() >= count { break; }
        let mid = ((cand.ma.0 + cand.mb.0) * 0.5, (cand.ma.1 + cand.mb.1) * 0.5);
        if mids.iter().any(|o| (o.0 - mid.0).hypot(o.1 - mid.1) < 2.0 * sep) { continue; }
        let (ha, hb) = (level(&*open, &*floor, cand.ma), level(&*open, &*floor, cand.mb));
        let len = (cand.mb.0 - cand.ma.0).hypot(cand.mb.1 - cand.ma.1);
        if !ha.is_finite() || !hb.is_finite() || len < 1.0 { continue; }
        // A gentle grade: at most 15 % from mouth to mouth.
        if (ha - hb).abs() > 0.15 * len * cell { continue; }
        let (ha, hb) = (ha + 2.0, hb + 2.0);
        let mut r = rng.fork(&format!("tube:{}:{}", cand.key.0, cand.key.1));
        let half_width = r.range(3.0, 7.5) as f32;
        // `rc` sizes the clearance and the skylight rooms (never under 0.9 cell); `rt` is the gut's real radius.
        let (rc, rt) = ((half_width / cell).max(0.9), half_width / cell);
        let (ux, uy) = ((cand.mb.0 - cand.ma.0) / len, (cand.mb.1 - cand.ma.1) / len);
        let ext = 1.5f32;
        let start = (cand.ma.0 - ux * ext, cand.ma.1 - uy * ext);
        let full = len + 2.0 * ext;
        let amp = (0.04 * len).min(120.0 / cell);
        let (k1, k2) = (r.range(1.0, 2.0) as f32, r.range(2.5, 4.0) as f32);
        let (f1, f2) = (r.range(0.0, std::f64::consts::TAU) as f32, r.range(0.0, std::f64::consts::TAU) as f32);
        // Skylight rooms: short widenings where the roof collapsed.
        let tries = if len * cell > 600.0 { 2 } else { 1 };
        let lights: Vec<f32> = (0..tries)
            .filter_map(|_| if r.chance(0.6) { Some(r.range(0.25, 0.75) as f32) } else { None }).collect();
        let samples = (full / 0.4).ceil() as usize;
        let tau = std::f32::consts::TAU;
        // Per sample: x, y, t, clearance radius, gut radius (cells).
        let pts: Vec<(f32, f32, f32, f32, f32)> = (0..=samples).map(|s| {
            let t = s as f32 / samples as f32;
            let e = (std::f32::consts::PI * t).sin();
            let off = amp * e * (0.7 * (tau * k1 * t + f1).sin() + 0.3 * (tau * k2 * t + f2).sin());
            let (bx, by) = (start.0 + ux * full * t, start.1 + uy * full * t);
            let span = 3.0 * rc.max(1.5) / full;
            let bump = lights.iter().map(|&l| {
                let b = (1.0 - (t - l).abs() / span).clamp(0.0, 1.0);
                b * b * (3.0 - 2.0 * b)
            }).fold(0.0f32, f32::max);
            let room = bump * (2.0 * rc).max(1.5);
            (bx - uy * off, by + ux * off, t, rc + room, rt + room)
        }).collect();
        // The tube runs through solid rock only: away from its mouths no opening or earlier tube is near.
        let clear = pts.iter().all(|&(x, y, t, rad, _)| {
            if (t * full).min((1.0 - t) * full) < rad + 2.0 * ext { return true; }
            let reach = rad + 1.0;
            let rr = reach.ceil() as isize;
            let (cx, cy) = (x.floor() as isize, y.floor() as isize);
            for dy in -rr..=rr {
                for dx in -rr..=rr {
                    let (gx, gy) = (cx + dx, cy + dy);
                    if gx < 0 || gy < 0 || gx >= n as isize || gy >= n as isize { return false; }
                    let (qx, qy) = (gx as f32 + 0.5 - x, gy as f32 + 0.5 - y);
                    if qx * qx + qy * qy > reach * reach { continue; }
                    let j = gy as usize * n + gx as usize;
                    if open[j] || tube_dist[j].is_finite() { return false; }
                }
            }
            true
        });
        if !clear { continue; }
        // Carve: the rock cells within the gut's radius open, and so does the chain of cells under the centre line (a
        // diagonal step also opens the corner nearer the line), so the tube is 4-connected however narrow; the nearest
        // sample sets the floor on the mouth-to-mouth grade. The soft wall field draws the gut at its real width.
        let mut carved: Vec<usize> = Vec::new();
        let mut chain: Vec<usize> = Vec::new();
        let mut last: Option<(isize, isize)> = None;
        for &(x, y, t, _, rad) in &pts {
            let tm = ((t * full - ext) / len).clamp(0.0, 1.0);
            let h = ha + (hb - ha) * tm;
            let mut take = |gx: isize, gy: isize| {
                if gx < 0 || gy < 0 || gx >= n as isize || gy >= n as isize { return; }
                let dd = (gx as f32 + 0.5 - x).hypot(gy as f32 + 0.5 - y);
                let j = gy as usize * n + gx as usize;
                if open[j] && !tube_dist[j].is_finite() { return; }
                if !tube_dist[j].is_finite() { carved.push(j); }
                if dd < tube_dist[j] { tube_dist[j] = dd; floor[j] = h; }
            };
            let rr = rad.ceil() as isize;
            let (cx, cy) = (x.floor() as isize, y.floor() as isize);
            for dy in -rr..=rr {
                for dx in -rr..=rr {
                    let (qx, qy) = ((cx + dx) as f32 + 0.5 - x, (cy + dy) as f32 + 0.5 - y);
                    if qx * qx + qy * qy <= rad * rad { take(cx + dx, cy + dy); }
                }
            }
            take(cx, cy);
            if let Some((px, py)) = last {
                if px != cx && py != cy {
                    let d1 = (cx as f32 + 0.5 - x).hypot(py as f32 + 0.5 - y);
                    let d2 = (px as f32 + 0.5 - x).hypot(cy as f32 + 0.5 - y);
                    if d1 <= d2 { take(cx, py); } else { take(px, cy); }
                }
            }
            if cx >= 0 && cy >= 0 && cx < n as isize && cy < n as isize { chain.push(cy as usize * n + cx as usize); }
            last = Some((cx, cy));
        }
        for &j in &carved { open[j] = true; }
        chain.sort_unstable();
        guts.lines.push(pts.iter().map(|&(x, y, _, _, g)| (x, y, g)).collect());
        guts.cells.extend(carved.iter().map(|&j| (j, chain.binary_search(&j).is_ok())));
        let mut points: Vec<[f32; 2]> = pts.iter().step_by(5).map(|&(x, y, _, _, _)| [x * cell, y * cell]).collect();
        if let Some(&(x, y, _, _, _)) = pts.last() { if samples % 5 != 0 { points.push([x * cell, y * cell]); } }
        if hb > ha { points.reverse(); }
        tunnels.push(UnderdarkTunnel { kind: TUNNEL_LAVA_TUBE, half_width, points });
        mids.push(mid);
    }
    tunnels
}

#[cfg(test)]
mod tests {
    use super::*;

    fn relief(n: usize) -> Vec<f32> {
        let noise = Noise::new(Rng::new("underdark-test"));
        (0..n * n).map(|i| {
            let (x, y) = ((i % n) as f64 / n as f64, (i / n) as f64 / n as f64);
            (300.0 * (noise.fbm(x * 3.0, y * 3.0, 5) + 1.0) + 200.0 * x) as f32
        }).collect()
    }

    #[test]
    fn carves_one_connected_network_with_walls() {
        let n = 256;
        let field = carve("seed", 8000.0, &relief(n)).unwrap();
        let open: Vec<bool> = field.rock.iter().map(|&r| r == 0).collect();
        let share = open.iter().filter(|&&o| o).count() as f64 / (n * n) as f64;
        assert!((0.2..0.7).contains(&share), "open share {share}");
        let (_, sizes) = components(&open, n);
        assert_eq!(sizes.len(), 1, "one network, got {sizes:?}");
        assert!(field.height.iter().all(|h| h.is_finite() && *h > 0.0));
        // Rock rises well above the floor a few cells inside the wall.
        let deep: Vec<usize> = (0..n * n).filter(|&i| field.sdf[i] > 6.0).collect();
        let floor_mean = field.height.iter().zip(&field.rock).filter(|(_, r)| **r == 0).map(|(h, _)| *h as f64).sum::<f64>()
            / open.iter().filter(|&&o| o).count() as f64;
        let rock_mean = deep.iter().map(|&i| field.height[i] as f64).sum::<f64>() / deep.len().max(1) as f64;
        assert!(rock_mean > floor_mean + 40.0, "rock {rock_mean} floor {floor_mean}");
    }

    #[test]
    fn zero_tunnels_is_byte_identical_to_the_carve_before_tunnels() {
        let n = 192;
        let surface = relief(n);
        let now = carve_with("seed", 8000.0, &surface, &UnderdarkOptions { natural_tunnels: 0.0 }).unwrap();
        let before = super::underdark_reference::carve("seed", 8000.0, &surface).unwrap();
        assert!(now.tunnels.is_empty());
        assert_eq!(now.rock, before.rock);
        assert!(now.height.iter().zip(&before.height).all(|(a, b)| a.to_bits() == b.to_bits()), "height differs");
        assert!(now.sdf.iter().zip(&before.sdf).all(|(a, b)| a.to_bits() == b.to_bits()), "sdf differs");
    }

    /// Two rooms 12 cells apart across rock, joined only by a long corridor round the top.
    fn two_rooms(n: usize) -> (Vec<bool>, Vec<f32>) {
        let mut open = vec![false; n * n];
        let mut set = |x0: usize, x1: usize, y0: usize, y1: usize| {
            for y in y0..y1 { for x in x0..x1 { open[y * n + x] = true; } }
        };
        set(30, 42, 60, 80);
        set(54, 66, 60, 80);
        set(32, 36, 10, 60);
        set(32, 64, 10, 14);
        set(60, 64, 10, 60);
        // Room B drains out of the map's east edge; room A holds a pond against its east wall.
        set(66, n, 70, 74);
        let floor = (0..n * n).map(|i| 100.0 - 0.3 * (i % n) as f32).collect();
        (open, floor)
    }

    fn surface_of(open: &[bool], floor: &[f32]) -> Vec<f32> {
        open.iter().zip(floor).map(|(&o, &f)| if o { f } else { f + 100.0 }).collect()
    }

    #[test]
    fn lava_tube_joins_two_chambers_on_a_monotonic_grade_without_capture() {
        let (n, cell) = (128usize, 25.0f32);
        let (mut open, mut floor) = two_rooms(n);
        let before = open.clone();
        let water = crate::priority_flood::flood_surface(&surface_of(&open, &floor), n, false).filled;
        let tubes = lava_tubes(&mut open, &mut floor, &water, n, cell, n as f32 * cell, 1, &Rng::new("tube-test"), &mut Guts::default());
        assert_eq!(tubes.len(), 1, "one tube");
        let tube = &tubes[0];
        assert_eq!(tube.kind, TUNNEL_LAVA_TUBE);
        assert!((3.0..=7.5).contains(&tube.half_width));
        // Two mouths: the ends lie in the two rooms' open floor (the path runs 1.5 cells into each).
        let cell_of = |p: [f32; 2]| (p[1] / cell) as usize * n + (p[0] / cell) as usize;
        let (a, b) = (cell_of(tube.points[0]), cell_of(*tube.points.last().unwrap()));
        assert!(before[a] && before[b], "mouths on open floor");
        assert!(((a % n) < 48) != ((b % n) < 48), "one mouth in each room");
        // Length bound: the line is at most l_max (here 640 m) plus the mouth extensions and the sinuosity.
        let length: f32 = tube.points.windows(2).map(|w| (w[1][0] - w[0][0]).hypot(w[1][1] - w[0][1])).sum();
        assert!(length <= 640.0 * 1.1 + 3.0 * cell, "length {length}");
        // Still one network.
        let (_, sizes) = components(&open, n);
        assert_eq!(sizes.len(), 1);
        // Monotonic grade from the high mouth, on the carved cells under the centre line.
        let carved: Vec<f32> = tube.points.iter().map(|&p| cell_of(p)).filter(|&i| !before[i]).map(|i| floor[i]).collect();
        assert!(carved.len() >= 4);
        assert!(carved.windows(2).all(|w| w[1] <= w[0] + 1e-3), "grade {carved:?}");
        // No capture: no cell of the original floor drains into the tube.
        let grids = crate::priority_flood::flood_surface(&surface_of(&open, &floor), n, true);
        for i in 0..n * n {
            let r = grids.receiver[i];
            if before[i] && r >= 0 { assert!(before[r as usize] || !open[r as usize], "cell {i} drains into the tube"); }
        }
    }

    #[test]
    fn tunnel_counts_and_lengths_are_bounded() {
        let n = 256;
        let (w, amount) = (8000.0f32, 3.0f32);
        let field = carve_with("seed", w as f64, &relief(n), &UnderdarkOptions { natural_tunnels: amount }).unwrap();
        let (tubes, passages) = tunnel_counts(amount, w);
        let count = |k: u8| field.tunnels.iter().filter(|t| t.kind == k).count();
        assert!(count(TUNNEL_LAVA_TUBE) <= tubes && count(TUNNEL_RIVER_PASSAGE) <= passages);
        let l_max = (w * 0.2).min(4000.0);
        for t in field.tunnels.iter().filter(|t| t.kind == TUNNEL_LAVA_TUBE) {
            let length: f32 = t.points.windows(2).map(|p| (p[1][0] - p[0][0]).hypot(p[1][1] - p[0][1])).sum();
            assert!(length <= l_max * 1.1 + 3.0 * w / n as f32, "tube length {length}");
        }
        let open: Vec<bool> = field.rock.iter().map(|&r| r == 0).collect();
        assert_eq!(components(&open, n).1.len(), 1, "one network with tunnels");
        // The planning mask reads the soft field's sign at the cell centres: it is the carve's, cell for cell.
        assert!(field.sdf.iter().zip(&open).all(|(&d, &o)| (d < 0.0) == o), "soft field sign differs from the carve");
        assert_eq!(tunnel_counts(0.0, w), (0, 0));
        assert_eq!(tunnel_counts(1.0, 10_000.0), (4, 2));
        assert_eq!(tunnel_counts(1.0, 40_000.0), (6, 3));
    }

    #[test]
    fn a_gut_is_drawn_at_its_half_width_and_held_to_the_carve() {
        let n = 32;
        // A chamber on the left and a one-cell chain running right from it through the rock.
        let mut open = vec![false; n * n];
        for y in 8..24 { for x in 2..10 { open[y * n + x] = true; } }
        let mut guts = Guts::default();
        for x in 10..28 { open[16 * n + x] = true; guts.cells.push((16 * n + x, true)); }
        let r = 0.2;
        guts.lines.push((8..28).map(|x| (x as f32 + 0.5, 16.5, r)).collect());
        let (sdf, ..) = wall_distance(&open, n);
        let soft = gut_soft_field(&sdf, &open, &guts, n);
        // Same sign as the carve at every cell centre: the planning mask does not change.
        assert!(soft.iter().zip(&open).all(|(&d, &o)| (d < 0.0) == o));
        // Across the gut, the zero contour stands at its half width on both sides.
        for x in 13..26 {
            let c = soft[16 * n + x];
            for side in [soft[15 * n + x], soft[17 * n + x]] {
                let cross = c / (c - side);
                assert!((cross - r).abs() < 0.05, "x {x}: wall at {cross} cell, not {r}");
            }
        }
    }

    #[test]
    fn river_passages_never_raise_the_water() {
        let n = 256;
        let surface = relief(n);
        let without = carve_counts("seed", 8000.0, &surface, 0, 0).unwrap();
        let with = carve_counts("seed", 8000.0, &surface, 0, 4).unwrap();
        let a = crate::priority_flood::flood_surface(&without.height, n, false).filled;
        let b = crate::priority_flood::flood_surface(&with.height, n, false).filled;
        for i in 0..n * n {
            // Standing water (a lake) on a floor open in both carves never stands higher with the passages.
            if with.rock[i] == 0 && without.rock[i] == 0 && b[i] - with.height[i] > 0.01 {
                assert!(b[i] <= a[i] + 0.05, "cell {i}: water {} > {}", b[i], a[i]);
            }
        }
        for t in &with.tunnels {
            assert_eq!(t.kind, TUNNEL_RIVER_PASSAGE);
            assert!(t.points.len() >= 2);
            // Downstream grade: the floor under the centre line never rises.
            let floor: Vec<f32> = t.points.iter().map(|p| with.height[(p[1] / (8000.0 / n as f32)) as usize * n + (p[0] / (8000.0 / n as f32)) as usize]).collect();
            assert!(floor.windows(2).all(|w| w[1] <= w[0] + 0.05), "passage grade {floor:?}");
        }
    }
}
