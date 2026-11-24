//! The small scale of the Underdark: narrow side tunnels through the rock masses (dead ends, tunnels to a blind
//! chamber, links between two galleries) and chambers sealed in the rock. Every size is drawn irregularly.
//!
//! Drainage: the floor of a side tunnel or chamber rises with the distance to its mouth, and a link has its crest inside
//! the rock, so each drains to the gallery it opens on and captures nothing. A sealed chamber drains through a fissure:
//! a narrow low line in the rock (`Fissure`), closed to people, so it is no closed basin and holds no water.

use super::{Guts, nearest_seed};
use crate::rng::Rng;

/// A sample of the centre line of a gut, in cells: position and radius; `h` its floor (m).
pub(super) struct GutPoint {
    pub x: f32,
    pub y: f32,
    pub r: f32,
    pub h: f32,
}

/// Opens a gut: the rock cells within its radius and the chain of cells under its centre line (a diagonal step also
/// opens the corner nearer the line, so the gut is 4-connected however narrow). The nearest sample sets the floor of a
/// cell; open cells keep theirs. `best`: scratch, infinite everywhere, and again on return. Adds the gut to `guts`.
pub(super) fn carve_gut(open: &mut [bool], floor: &mut [f32], best: &mut [f32], n: usize, points: &[GutPoint], guts: &mut Guts) {
    let mut carved: Vec<usize> = Vec::new();
    let mut chain: Vec<usize> = Vec::new();
    let mut last: Option<(isize, isize)> = None;
    for p in points {
        let mut take = |gx: isize, gy: isize| {
            if gx < 0 || gy < 0 || gx >= n as isize || gy >= n as isize { return; }
            let j = gy as usize * n + gx as usize;
            if open[j] { return; }
            let d = (gx as f32 + 0.5 - p.x).hypot(gy as f32 + 0.5 - p.y);
            if !best[j].is_finite() { carved.push(j); }
            if d < best[j] { best[j] = d; floor[j] = p.h; }
        };
        let reach = p.r.ceil() as isize;
        let (cx, cy) = (p.x.floor() as isize, p.y.floor() as isize);
        for dy in -reach..=reach {
            for dx in -reach..=reach {
                let (qx, qy) = ((cx + dx) as f32 + 0.5 - p.x, (cy + dy) as f32 + 0.5 - p.y);
                if qx * qx + qy * qy <= p.r * p.r { take(cx + dx, cy + dy); }
            }
        }
        take(cx, cy);
        if let Some((px, py)) = last {
            if px != cx && py != cy {
                let d1 = (cx as f32 + 0.5 - p.x).hypot(py as f32 + 0.5 - p.y);
                let d2 = (px as f32 + 0.5 - p.x).hypot(cy as f32 + 0.5 - p.y);
                if d1 <= d2 { take(cx, py); } else { take(px, cy); }
            }
        }
        if cx >= 0 && cy >= 0 && cx < n as isize && cy < n as isize { chain.push(cy as usize * n + cx as usize); }
        last = Some((cx, cy));
    }
    for &j in &carved { open[j] = true; best[j] = f32::INFINITY; }
    chain.sort_unstable();
    guts.lines.push(points.iter().map(|p| (p.x, p.y, p.r)).collect());
    guts.cells.extend(carved.iter().map(|&j| (j, chain.binary_search(&j).is_ok())));
}

/// A drain in the rock from a sealed chamber to its nearest gallery: samples of its line, half a cell apart at most.
pub(super) struct Fissure(Vec<GutPoint>);
impl Fissure {
    /// Lowers the rock along the line: level with it within a cell and a quarter, back to its own height at three cells.
    pub(super) fn cut(&self, height: &mut [f32], open: &[bool], n: usize) {
        const REACH: isize = 3;
        for p in &self.0 {
            let (cx, cy) = (p.x.floor() as isize, p.y.floor() as isize);
            for y in (cy - REACH).max(0)..=(cy + REACH).min(n as isize - 1) {
                for x in (cx - REACH).max(0)..=(cx + REACH).min(n as isize - 1) {
                    let j = y as usize * n + x as usize;
                    let low = p.h + 0.3;
                    if open[j] || height[j] <= low { continue; }
                    let d = (x as f32 + 0.5 - p.x).hypot(y as f32 + 0.5 - p.y);
                    let t = ((d - 1.25) / 1.75).clamp(0.0, 1.0);
                    height[j] = low + (height[j] - low) * t * t * (3.0 - 2.0 * t);
                }
            }
        }
    }
}

/// An irregular disc: centre and mean radius in cells, three lobes (waves round it, amplitude, phase).
struct Room {
    x: f32,
    y: f32,
    r: f32,
    lobes: [(f32, f32, f32); 3],
}
impl Room {
    /// Largest radius of any such room over its mean radius.
    const WIDEST: f32 = 1.58;

    fn new(x: f32, y: f32, r: f32, rng: &mut Rng) -> Self {
        let lobes = [(2.0, 0.28), (3.0, 0.2), (5.0, 0.1)].map(|(waves, most): (f32, f64)| (waves, rng.range(0.0, most) as f32, rng.range(0.0, std::f64::consts::TAU) as f32));
        Self { x, y, r, lobes }
    }
    fn cells(&self, n: usize) -> Vec<usize> {
        let reach = (self.r * Self::WIDEST).ceil() as isize + 1;
        let (cx, cy) = (self.x.floor() as isize, self.y.floor() as isize);
        let mut out = Vec::new();
        for y in (cy - reach).max(0)..=(cy + reach).min(n as isize - 1) {
            for x in (cx - reach).max(0)..=(cx + reach).min(n as isize - 1) {
                let (dx, dy) = (x as f32 + 0.5 - self.x, y as f32 + 0.5 - self.y);
                let angle = dy.atan2(dx);
                let edge = self.r * (1.0 + self.lobes.iter().map(|&(k, a, f)| a * (k * angle + f).sin()).sum::<f32>());
                if dx.hypot(dy) <= edge.max(0.8) { out.push(y as usize * n + x as usize); }
            }
        }
        out
    }
}

/// Carves the side tunnels and sealed chambers (`amount`: 0 none, 1 the default, up to 3) into `open` and `floor`. They
/// sit on a jittered lattice over the rock masses, each in the rock around its own site: the circle to the nearest
/// opening is solid, and the checks below keep them off one another. `water`: a filled surface. Returns the fissures of
/// the sealed chambers, to cut into the rock's height.
#[allow(clippy::too_many_arguments)]
pub(super) fn side_network(open: &mut [bool], floor: &mut [f32], water: &[f32], n: usize, cell: f32, w: f32, amount: f32,
    rng: &Rng, guts: &mut Guts) -> Vec<Fissure> {
    let mut fissures = Vec::new();
    if amount <= 0.0 { return fissures; }
    let tau = std::f32::consts::TAU;
    let (clearance, near) = nearest_seed(&*open, n);
    let mut best = vec![f32::INFINITY; n * n];
    let pitch = (w * 0.03 / cell).max(14.0);
    let sites = (n as f32 / pitch).floor() as usize;
    let centre = |c: usize| ((c % n) as f32 + 0.5, (c / n) as f32 + 0.5);
    let at = |x: f32, y: f32| -> Option<usize> {
        let inside = x >= 3.0 && y >= 3.0 && x < n as f32 - 3.0 && y < n as f32 - 3.0;
        inside.then(|| (y as usize) * n + x as usize)
    };
    // No opening within `r` cells of a point.
    let solid = |open: &[bool], x: f32, y: f32, r: f32| -> bool {
        let reach = r.ceil() as isize;
        let (cx, cy) = (x.floor() as isize, y.floor() as isize);
        for gy in cy - reach..=cy + reach {
            for gx in cx - reach..=cx + reach {
                if gx < 0 || gy < 0 || gx >= n as isize || gy >= n as isize { return false; }
                let (qx, qy) = (gx as f32 + 0.5 - x, gy as f32 + 0.5 - y);
                if qx * qx + qy * qy <= r * r && open[gy as usize * n + gx as usize] { return false; }
            }
        }
        true
    };
    for gy in 0..sites {
        for gx in 0..sites {
            let mut r = rng.fork(&format!("{gx}:{gy}"));
            let x = (gx as f32 + r.range(0.1, 0.9) as f32) * pitch;
            let y = (gy as f32 + r.range(0.1, 0.9) as f32) * pitch;
            if !r.chance((0.3 * amount as f64).min(0.95)) { continue; }
            let Some(site) = at(x, y) else { continue };
            let d = clearance[site];
            if open[site] || near[site] == u32::MAX || d < 4.0 || d * cell < 45.0 || !solid(&*open, x, y, 2.0) { continue; }
            let mouth = near[site] as usize;
            let (mx, my) = centre(mouth);
            let base = floor[mouth].max(water[mouth]) + 0.5;
            let grade = r.range(0.015, 0.05) as f32;
            // The floor of everything this site opens on its own mouth: higher with the distance to it.
            let level = |px: f32, py: f32| base + grade * cell * (px - mx).hypot(py - my);
            let kind = r.float();
            // Many small rooms, a few large ones, always off the other openings.
            let size = ((14.0 + 70.0 * r.float().powi(2)) as f32 / cell).max(1.3).min(0.3 * d);
            let (ux, uy) = ((x - mx) / d, (y - my) / d);
            let half = r.range(1.6, 5.0) as f32 / cell;
            let (k1, k2) = (r.range(0.8, 1.7) as f32, r.range(2.2, 4.0) as f32);
            let (f1, f2) = (r.range(0.0, std::f64::consts::TAU) as f32, r.range(0.0, std::f64::consts::TAU) as f32);
            let swell = r.range(0.2, 0.6) as f32;
            // A winding leg (x, y, half width, in cells) from (ax, ay) to (bx, by), at most `free` cells off its chord.
            let leg = |ax: f32, ay: f32, bx: f32, by: f32, free: f32| -> Vec<(f32, f32, f32)> {
                let (dx, dy) = (bx - ax, by - ay);
                let len = dx.hypot(dy).max(1e-3);
                let steps = (len / 0.4).ceil().max(2.0) as usize;
                (0..=steps).map(|s| {
                    let t = s as f32 / steps as f32;
                    let off = free * 4.0 * t * (1.0 - t) * (0.7 * (tau * k1 * t + f1).sin() + 0.3 * (tau * k2 * t + f2).sin());
                    let width = half * (1.0 + swell * (0.6 * (tau * k2 * t + f1).sin() + 0.4 * (2.7 * tau * k2 * t + f2).sin()));
                    (ax + dx * t - dy / len * off, ay + dy * t + dx / len * off, width.max(1.2 / cell))
                }).collect()
            };
            // Whether a leg runs in solid rock once clear of an end at (ox, oy).
            let runs_solid = |open: &[bool], points: &[(f32, f32, f32)], ox: f32, oy: f32| -> bool {
                points.iter().all(|&(px, py, pr)| (px - ox).hypot(py - oy) < pr + 3.5 || solid(open, px, py, pr + 1.5))
            };
            let gut = |points: &[(f32, f32, f32)]| -> Vec<GutPoint> {
                points.iter().map(|&(px, py, pr)| GutPoint { x: px, y: py, r: pr, h: level(px, py) }).collect()
            };
            if kind >= 0.8 {
                // Sealed chambers: one, sometimes two joined by a crawl way.
                let mut rooms = vec![Room::new(x, y, size, &mut r)];
                if r.chance(0.35) {
                    let angle = r.range(0.0, std::f64::consts::TAU) as f32;
                    let second = (0.5 * size).max(1.2).min(0.2 * d);
                    rooms.push(Room::new(x + 0.5 * d * angle.cos(), y + 0.5 * d * angle.sin(), second, &mut r));
                }
                if !rooms.iter().all(|room| at(room.x, room.y).is_some() && solid(&*open, room.x, room.y, room.r * Room::WIDEST + 2.5)) { continue; }
                for j in rooms.iter().flat_map(|room| room.cells(n)) {
                    let (px, py) = centre(j);
                    open[j] = true;
                    floor[j] = level(px, py);
                }
                if let Some(second) = rooms.get(1) {
                    carve_gut(open, floor, &mut best, n, &gut(&leg(x, y, second.x, second.y, 0.06 * d)), guts);
                }
                fissures.push(Fissure(gut(&leg(mx, my, x, y, 0.1 * d))));
                continue;
            }
            let main = leg(mx, my, x, y, 0.22 * d);
            if !runs_solid(&*open, &main, mx, my) { continue; }
            if kind < 0.3 {
                // A dead end, turning once inside the rock; now and then it forks.
                carve_gut(open, floor, &mut best, n, &gut(&main), guts);
                let first: f32 = if r.chance(0.5) { 1.0 } else { -1.0 };
                let ends = if r.chance(0.3) { 2 } else { 1 };
                for k in 0..ends {
                    let turn: f32 = r.range(0.35, 1.1) as f32 * if k == 0 { first } else { -first };
                    let (tx, ty) = (ux * turn.cos() - uy * turn.sin(), ux * turn.sin() + uy * turn.cos());
                    let reach = r.range(0.3, 0.6) as f32 * d;
                    let mut points = leg(x, y, x + tx * reach, y + ty * reach, 0.08 * d);
                    // The far end pinches out.
                    let count = points.len() as f32;
                    for (s, p) in points.iter_mut().enumerate() { p.2 *= 1.0 - 0.6 * s as f32 / count; }
                    if at(x + tx * reach, y + ty * reach).is_some() && runs_solid(&*open, &points, x, y) {
                        carve_gut(open, floor, &mut best, n, &gut(&points), guts);
                    }
                }
            } else if kind < 0.62 {
                // A tunnel to a blind chamber.
                let room = Room::new(x, y, size, &mut r);
                if !solid(&*open, x, y, room.r * Room::WIDEST + 2.0) { continue; }
                for j in room.cells(n) {
                    let (px, py) = centre(j);
                    open[j] = true;
                    floor[j] = level(px, py);
                }
                carve_gut(open, floor, &mut best, n, &gut(&main), guts);
            } else {
                // A link: on beyond the site to the first opening ahead, with its crest at the site; a dead end at the
                // site when nothing is near ahead, or the way there is steep or not solid.
                let turn = r.range(-0.6, 0.6) as f32;
                let (tx, ty) = (ux * turn.cos() - uy * turn.sin(), ux * turn.sin() + uy * turn.cos());
                let mut far = None;
                let mut s = 0.6 * d;
                while s < 3.5 * d + 8.0 {
                    let Some(c) = at(x + tx * s, y + ty * s) else { break };
                    if open[c] {
                        far = Some((c, s));
                        break;
                    }
                    s += 0.5;
                }
                let linked = far.and_then(|(end, length)| {
                    let other = floor[end].max(water[end]) + 0.5;
                    let crest = level(x, y).max(other + grade * cell * length);
                    let steep = (crest - base) / (d * cell) > 0.2 || (crest - other) / (length * cell) > 0.2;
                    let (ex, ey) = centre(end);
                    let second = leg(x, y, ex, ey, 0.05 * length);
                    if steep || !runs_solid(&*open, &second, ex, ey) { return None; }
                    let first = main.len() - 1;
                    let count = first + second.len() - 1;
                    Some(main.iter().chain(second.iter().skip(1)).enumerate().map(|(s, &(px, py, pr))| {
                        let h = if s <= first { base + (crest - base) * s as f32 / first as f32 } else { crest + (other - crest) * (s - first) as f32 / (count - first) as f32 };
                        GutPoint { x: px, y: py, r: pr, h }
                    }).collect::<Vec<_>>())
                });
                carve_gut(open, floor, &mut best, n, &linked.unwrap_or_else(|| gut(&main)), guts);
            }
        }
    }
    fissures
}

#[cfg(test)]
mod tests {
    use super::super::components;
    use super::*;

    /// A map of rock with a wide gallery across its middle: side features open in both rock masses; those with a mouth
    /// join the gallery, the sealed chambers stay apart and small, and with the fissures cut every opening drains.
    #[test]
    fn side_tunnels_join_the_gallery_and_sealed_chambers_drain() {
        let (n, cell) = (256_usize, 20.0_f32);
        let mut open: Vec<bool> = (0..n * n).map(|i| (118..138).contains(&(i / n))).collect();
        let mut floor: Vec<f32> = (0..n * n).map(|i| 100.0 - 0.02 * (i % n) as f32).collect();
        let before = open.clone();
        let water = floor.clone();
        let mut guts = Guts::default();
        let fissures = side_network(&mut open, &mut floor, &water, n, cell, n as f32 * cell, 1.0, &Rng::new("sides"), &mut guts);
        let added: Vec<usize> = (0..n * n).filter(|&i| open[i] && !before[i]).collect();
        assert!(added.len() > 60, "{} cells opened", added.len());
        assert!((added.len() as f32) < 0.1 * (n * n) as f32, "narrow: {} cells", added.len());
        assert!(!guts.lines.is_empty() && !fissures.is_empty());
        let (labels, sizes) = components(&open, n);
        let main = labels[128 * n + 10] as usize;
        let limit = (2.0 * std::f32::consts::PI * (90.0 * Room::WIDEST / cell).powi(2)) as usize;
        for (k, &size) in sizes.iter().enumerate() {
            assert!(k == main || size <= limit, "sealed chamber of {size} cells");
        }
        assert!(sizes.len() > 1 && sizes.len() - 1 <= fissures.len(), "{} pieces for {} fissures", sizes.len(), fissures.len());
        let mut height: Vec<f32> = (0..n * n).map(|i| if open[i] { floor[i] } else { 200.0 }).collect();
        for fissure in &fissures {
            fissure.cut(&mut height, &open, n);
        }
        let filled = crate::priority_flood::flood_surface(&height, n, false).filled;
        for &i in &added {
            assert!(filled[i] - height[i] < 6.0, "cell {i} holds {} m", filled[i] - height[i]);
        }
    }
}
