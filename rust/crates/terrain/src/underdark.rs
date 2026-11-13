//! Underdark: turns any surface relief (procedural or neural) into a cave system.
//!
//! The relief is read as the floor of the underworld, not inverted. Its drainage network becomes
//! the tunnels (width grows with the upstream area, with irregular river rooms), its low basins and
//! plains become wide caverns with rock pillars, and a sparse worm network adds dry galleries.
//! Every opening is joined to the main network, so roads and rivers can reach every chamber.
//! Rock keeps the floor of its nearest opening plus a wall that rises with the distance to it, so
//! water falling on the rock drains into the nearest gallery. The ordinary hydrology then runs on
//! this surface: rivers follow the tunnels and lakes fill the closed caverns.

use crate::noise::Noise;
use crate::rng::Rng;
use std::cmp::Ordering;
use std::collections::BinaryHeap;

/// Carved surface (metres, strictly positive) and its rock mask (1 = solid rock, 0 = open floor).
pub struct UnderdarkField {
    pub height: Vec<f32>,
    pub rock: Vec<u8>,
    /// Signed distance to the cave wall, in cells (> 0 inside rock), smoothed so that its zero
    /// contour is a curve: interpolated, it draws walls without the grid's staircase.
    pub sdf: Vec<f32>,
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

#[derive(PartialEq)]
struct Node(f32, u32);
impl Eq for Node {}
impl PartialOrd for Node { fn partial_cmp(&self, o: &Self) -> Option<Ordering> { Some(self.cmp(o)) } }
impl Ord for Node {
    fn cmp(&self, o: &Self) -> Ordering { o.0.partial_cmp(&self.0).unwrap_or(Ordering::Equal).then(o.1.cmp(&self.1)) }
}

/// Carve the underworld from a square surface of `heights` (metres) over `width` metres.
pub fn carve(seed: &str, width: f64, heights: &[f32]) -> Result<UnderdarkField, String> {
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

    // 3. Tunnels: river corridors whose radius grows with the upstream area, swelling into river rooms.
    let a_min = (w * w * 0.0016).max(30.0 * cell * cell);
    let r0 = (w * 0.0032).max(2.2 * cell).min(90.0);
    let r_max = (w * 0.018).max(4.0 * cell);
    let mut tunnel = vec![f32::NEG_INFINITY; total];
    for i in 0..total {
        if area[i] < a_min { continue; }
        let (x, y) = world(i);
        let rooms = 1.0 + 0.9 * (noise2.fbm(x / (w as f64 * 0.035), y / (w as f64 * 0.035), 2) as f32 * 2.2).clamp(-0.45, 1.0);
        tunnel[i] = (r0 * (area[i] / a_min).powf(0.33) * rooms).min(r_max) / cell;
    }
    propagate_max(&mut tunnel, n, 1.0);
    // Warp the corridors: D8 drainage draws straight diagonals; caves meander around them.
    let warp_amp = 1.3 * r0 / cell;
    let warp_len = r0 as f64 * 7.0;
    let mut warped = vec![f32::NEG_INFINITY; total];
    crate::terrain_par::rows(&mut warped, n, |y, row| {
        for (x, v) in row.iter_mut().enumerate() {
            let (px, py) = (((x as f64) + 0.5) * cell as f64, ((y as f64) + 0.5) * cell as f64);
            let dx = warp_amp * noise3.fbm(px / warp_len + 101.0, py / warp_len, 3) as f32 * 2.0;
            let dy = warp_amp * noise3.fbm(px / warp_len, py / warp_len - 57.0, 3) as f32 * 2.0;
            let sx = (x as f32 + dx).round().clamp(0.0, (n - 1) as f32) as usize;
            let sy = (y as f32 + dy).round().clamp(0.0, (n - 1) as f32) as usize;
            *v = tunnel[sy * n + sx];
        }
    });
    let tunnel = warped;

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

    // 6. Wall noise, pillars and the union of the openings.
    let mut open = vec![false; total];
    for i in 0..total {
        let (x, y) = world(i);
        let wall = noise.fbm(x / (r0 as f64 * 5.0), y / (r0 as f64 * 5.0), 3) as f32;
        let t = tunnel[i] + wall * (r0 / cell) * 0.9;
        let g = gallery_value[i] < gallery_half * (1.0 + 0.6 * wall);
        let pillar = cavern[i] && noise.noise(x / (r0 as f64 * 3.2) + 77.0, y / (r0 as f64 * 3.2) - 3.0) > 0.68;
        open[i] = (t > 0.0 || cavern[i] || g) && !pillar;
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

    // 9. Wall distance: smoothed, then held to the carved sign so narrow passages keep their connection.
    let (dist, near) = nearest_seed(&open, n);
    let rock: Vec<bool> = open.iter().map(|o| !o).collect();
    let (to_rock, _) = nearest_seed(&rock, n);
    let raw: Vec<f32> = (0..total).map(|i| if open[i] { 0.5 - to_rock[i] } else { dist[i] - 0.5 }).collect();
    // Only cells whose smoothed sign contradicts the carve (thin necks and spurs) are pinned, well clear of the
    // wall value so that no plateau sits on the wall line (it drew flat cell-sized ledges).
    let sdf: Vec<f32> = box_blur(&box_blur(&raw, n, 1), n, 1).iter().zip(&open)
        .map(|(&d, &o)| if o && d > -0.05 { -0.6 } else if !o && d < 0.05 { 0.6 } else { d }).collect();

    // Underground lakes: some caverns sink into a bowl, deepest far from the walls; the water budget fills it.
    let mut floor = floor;
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
    Ok(UnderdarkField { height, rock: open.iter().map(|&o| u8::from(!o)).collect(), sdf })
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
}
