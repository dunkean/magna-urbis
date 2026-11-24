//! River beds along the final courses. The vector rivers are traced on the conditioned relief, then meandered,
//! joined and relaxed: their final planform no longer lies on a thalweg of the grid, and on open ground there is
//! none. This pass cuts every course its own bed, so that
//! - the bed never rises downstream (running minimum along the course, down to the bed of what it joins);
//! - the bed lies below its banks by a depth that grows with the channel width (`bed_depth`);
//! - the water surface of the line never rises downstream and sits inside that bed, under the bank top.
//! - the ground along every course is lowered into a valley whose depth and width grow with its catchment, as far
//!   as the relief lacks one (`valley_depth`, `Section`). The two sides of a valley differ (`Flank`): the course wanders
//!   between the sides of its floor, a steep cut bank stands outside its bends and a gentle slip-off slope inside, the
//!   floor widens and narrows, and hard and soft rock steepen or open the sides, with terraces in places.
//! Lakes, the sea and the planform are untouched; only land cells within the valley reach of a course are lowered.
use super::rivers::{Line, channel_width};
use super::{Settings, Water};
use crate::noise::Noise;
use crate::rng::Rng;

/// Depth of a bed below its banks (m) for a channel `width` metres wide.
pub fn bed_depth(width: f64) -> f64 {
    (0.45 + 0.05 * width).clamp(0.6, 2.2)
}
/// Deepest cut of a bed below `bed_depth` where its course crosses higher ground (m). Beyond it the bed follows the
/// ground: a course is never turned into a trench.
pub(super) const EXTRA_CUT: f64 = 4.0;
/// Narrowest bank of a bed, in cells: the resolution limit only; a bank is a channel width wide otherwise. The bed
/// keeps every cell within 0.75 cell of the course at the bed level (the cells of the course then never rise
/// downstream); beside it the cross-section rises smoothly with the distance to the course alone, so a bank of one
/// and a half cells shows no beads along a diagonal (the former cut followed the ground of each cell and needed 2.5).
const BANK_CELLS: f64 = 1.5;
/// Share of the bed depth filled with water.
const FILL: f64 = 0.6;

fn bilinear(z: &[f32], n: usize, cell: f64, x: f64, y: f64) -> f64 {
    let fx = (x / cell - 0.5).clamp(0.0, n as f64 - 1.000001);
    let fy = (y / cell - 0.5).clamp(0.0, n as f64 - 1.000001);
    let (i, j) = (fx as usize, fy as usize);
    let (u, v) = (fx - i as f64, fy - j as f64);
    let c = j * n + i;
    (z[c] as f64 * (1.0 - u) + z[c + 1] as f64 * u) * (1.0 - v) + (z[c + n] as f64 * (1.0 - u) + z[c + n + 1] as f64 * u) * v
}

/// Depth of the valley a course wants below its shoulders (m), for a catchment of `area` m²: a few metres for a
/// brook, tens of metres for the main stem of a 40 km map (1 km²: 2.5 m, 100 km²: 16 m, 1,000 km²: 40 m).
pub fn valley_depth(area: f64) -> f64 {
    (VALLEY_DEPTH * (area / 1e6).max(0.0).powf(0.4)).min(VALLEY_DEEPEST)
}
const VALLEY_DEPTH: f64 = 2.5;
const VALLEY_DEEPEST: f64 = 40.0;
/// Share of the local relief a valley may take: a plain has no shoulders to cut a valley under, hills have.
const VALLEY_RELIEF_SHARE: f64 = 0.8;
/// Mean side slope of a valley (rise over run): rock and bends move it between `SIDE_RANGE` (`flanks`).
const VALLEY_SIDE: f64 = 0.12;
const SIDE_RANGE: (f64, f64) = (0.045, 0.45);
/// Mean half width of the valley floor beyond the banks, in channel widths (the width of the river itself, without the
/// display scale of the drawn channel). The two half widths of a floor share an irregular total.
const VALLEY_FLOOR: f64 = 2.0;
/// Share of the floor by which its edge moves with the rock (`rough`), and of the side's own run.
const ROUGH_FLOOR: f64 = 0.4;
const ROUGH_SIDE: f64 = 0.2;
/// Wavelength (m) of the rock the valley sides are cut in, and of the spurs and hollows of their edge.
const ROCK_WAVE: f64 = 650.0;
const ROUGH_WAVE: f64 = 90.0;
/// Widest half width of a valley (m): the pass visits no cell farther from a course.
const VALLEY_REACH: f64 = 600.0;
/// Least fall of a bed towards the end of its course (rise over run) where a valley deepens it: the valley never
/// takes a bed under the line that keeps it descending to its outlet.
const VALLEY_GRADE: f64 = 0.0005;
/// Softness of the valley side where it meets the ground (m).
const VALLEY_BLEND: f64 = 0.6;

/// Smooth minimum of `a` and `b` over `k` (polynomial): equal to the minimum when they differ by more than `k`.
fn smooth_min(a: f64, b: f64, k: f64) -> f64 {
    let k = k.max(1e-9);
    let h = (k - (a - b).abs()).max(0.0);
    a.min(b) - h * h / (4.0 * k)
}

fn smooth(t: f64) -> f64 {
    let t = t.clamp(0.0, 1.0);
    t * t * (3.0 - 2.0 * t)
}

/// One side of a valley at a vertex of its course: bank and floor widths (m), rise of the floor away from the banks
/// and slope of the valley side (rise over run), height and tread of its terrace (m, 0: none), and the distance to the
/// axis where the cut ends (m).
#[derive(Clone, Copy)]
struct Flank {
    bank: f64,
    floor: f64,
    tilt: f64,
    side: f64,
    step: f64,
    tread: f64,
    reach: f64,
}
impl Flank {
    fn mix(self, other: Self, t: f64) -> Self {
        let lerp = |a: f64, b: f64| a + (b - a) * t;
        Self {
            bank: lerp(self.bank, other.bank),
            floor: lerp(self.floor, other.floor),
            tilt: lerp(self.tilt, other.tilt),
            side: lerp(self.side, other.side),
            step: lerp(self.step, other.step),
            tread: lerp(self.tread, other.tread),
            reach: lerp(self.reach, other.reach),
        }
    }
}

/// Running mean of `values` over `span` entries on each side.
fn running_mean(values: &[f64], span: usize) -> Vec<f64> {
    let mut sum = vec![0.0; values.len() + 1];
    for (k, &v) in values.iter().enumerate() {
        sum[k + 1] = sum[k] + v
    }
    (0..values.len())
        .map(|k| {
            let (a, b) = (k.saturating_sub(span), (k + span).min(values.len() - 1));
            (sum[b + 1] - sum[a]) / (b + 1 - a) as f64
        })
        .collect()
}

/// The two sides of the valley along a course (`[0]` on its right, `[1]` on the side of the normal (-dy, dx)).
/// The floor has an irregular total width, which the course shares unequally: it wanders from one side to the other
/// and leans on the outside of its bends. The sides are steeper in hard rock and over a cut bank, gentler on a slip-off
/// slope. Near both ends of the course the two sides become equal: the cut closes round them without a step.
fn flanks(line: &Line, arc: &[f64], width_scale: f64, cell: f64, index: usize, noise: &Noise) -> Vec<[Flank; 2]> {
    let m = line.points.len() / 2;
    let at = |k: usize| (line.points[2 * k], line.points[2 * k + 1]);
    let total = arc[m - 1];
    let spacing = (total / (m - 1) as f64).max(1e-6);
    let window = |k: usize| (((4.0 * cell).max(6.0 * channel_width(line.area[k], 1.0)) / spacing).ceil() as usize).max(1);
    // Turn of the course about a vertex, 1 for a full bend towards side 1.
    let turn: Vec<f64> = (0..m)
        .map(|k| {
            let q = window(k).min(k).min(m - 1 - k);
            let ((ax, ay), (x, y), (bx, by)) = (at(k - q), at(k), at(k + q));
            let (ux, uy, vx, vy) = (x - ax, y - ay, bx - x, by - y);
            ((ux * vy - uy * vx).atan2(ux * vx + uy * vy) / 0.8).clamp(-1.0, 1.0)
        })
        .collect();
    let turn = running_mean(&turn, window(m / 2) / 2);
    let lane = index as f64 * 17.31;
    (0..m)
        .map(|k| {
            let (own, wide) = (channel_width(line.area[k], 1.0), channel_width(line.area[k], width_scale));
            let wanted = valley_depth(line.area[k]);
            let inner = (0.5 * wide).max(0.75 * cell);
            let wave = (14.0 * own).max(260.0);
            let along = |wave: f64, row: f64| noise.noise(arc[k] / wave, lane + row);
            let wander = (1.5 * along(wave, 3.0) + 0.6 * along(0.31 * wave, 5.0)).clamp(-1.0, 1.0);
            let breadth = 2.0_f64.powf(1.1 * along(1.3 * wave, 7.0) + 0.6 * along(0.4 * wave, 11.0)).clamp(0.4, 2.0);
            // A bend holds the course against its outside; the course wanders with the room the bend leaves it.
            let lean = turn[k] + (1.0 - turn[k].abs()) * wander;
            let (p0, p1) = (at(k.saturating_sub(2)), at((k + 2).min(m - 1)));
            let l = (p1.0 - p0.0).hypot(p1.1 - p0.1).max(1e-9);
            let (nx, ny) = (-(p1.1 - p0.1) / l, (p1.0 - p0.0) / l);
            let (x, y) = at(k);
            let sides: [Flank; 2] = std::array::from_fn(|side| {
                let sign: f64 = if side == 1 { 1.0 } else { -1.0 };
                // Inside of a bend (slip-off slope) and outside of it (cut bank).
                let (slip, cut) = ((sign * turn[k]).max(0.0), (-sign * turn[k]).max(0.0));
                let off = sign * (inner + wide + 2.0 * VALLEY_FLOOR * own + 60.0);
                let (rx, ry) = ((x + nx * off) / ROCK_WAVE, (y + ny * off) / ROCK_WAVE);
                let rock = (1.3 * noise.noise(rx, ry) + 0.6 * noise.noise(3.7 * rx + 21.0, 3.7 * ry - 8.0)).clamp(-1.0, 1.0);
                let bank = (wide * (1.0 + 0.8 * slip - 0.45 * cut)).max(BANK_CELLS * cell);
                let floor = 2.0 * VALLEY_FLOOR * own * breadth * (0.5 + 0.44 * sign * lean) * (-0.45 * rock).exp();
                let slope = (VALLEY_SIDE * (0.55 * rock).exp() * (1.0 + 1.6 * cut) * (1.0 - 0.45 * slip)).clamp(SIDE_RANGE.0, SIDE_RANGE.1);
                // Terraces: in places, where the valley is deep enough to hold one.
                let terrace = smooth(2.0 * along(0.8 * wave, 13.0 + 4.0 * side as f64) + 0.4 * slip - cut) * smooth((wanted - 2.5) / 4.0);
                let step = terrace * wanted * (0.3 + 0.25 * breadth.min(1.0));
                let tread = terrace * (1.5 * VALLEY_FLOOR * own + 6.0).min(70.0);
                let reach = (inner + bank + (1.0 + ROUGH_FLOOR) * floor + tread + wanted / (slope * (1.0 - ROUGH_SIDE))).min(VALLEY_REACH).max(inner + bank);
                Flank { bank, floor, tilt: 0.004 + 0.03 * slip, side: slope, step, tread, reach }
            });
            let own_sides = smooth(arc[k].min(total - arc[k]) / wave);
            let mean = sides[0].mix(sides[1], 0.5);
            sides.map(|flank| mean.mix(flank, own_sides))
        })
        .collect()
}

/// One cross-section, from the axis of a course outwards (`d`, m), as a height: the bed (`z`, flat over half the
/// channel), the banks rising by the bed depth to the valley floor, the floor, then the valley side with a rounded foot
/// and its terrace. `rough` (-1 to 1) moves the edge of the floor and the run of the side: spurs and hollows.
struct Section {
    z: f64,
    depth: f64,
    inner: f64,
    flank: Flank,
}
impl Section {
    fn at(&self, d: f64, rough: f64) -> f64 {
        if d <= self.inner {
            return self.z;
        }
        let f = &self.flank;
        let x = d - self.inner - f.bank;
        let banks = self.z + self.depth * smooth((d - self.inner) / f.bank);
        if x <= 0.0 {
            return banks;
        }
        let edge = f.floor * (1.0 + ROUGH_FLOOR * rough);
        let floor = banks + f.tilt * x.min(edge);
        let e = (x - edge) * (1.0 - ROUGH_SIDE * rough);
        if e <= 0.0 {
            return floor;
        }
        let r = f.floor.max(1.0);
        let run = f.step / f.side;
        let start = if run < 0.5 * r { (2.0 * r * run).sqrt() } else { run + 0.5 * r };
        let on_tread = (e - start).clamp(0.0, f.tread);
        let e = e - on_tread;
        let rise = if e < r { e * e / (2.0 * r) } else { e - 0.5 * r };
        floor + f.side * rise + 0.02 * on_tread
    }
}

/// Cuts the beds and the valleys of `lines` into `height` and lowers their water surface into the beds. Returns the
/// cells lowered.
///
/// Invariants (per course): the bed never rises downstream (running minimum, except where it crosses ground higher
/// than `EXTRA_CUT` over its depth), the water surface never rises and lies in the bed under its banks, and every
/// cell takes the lower of its ground and one cross-section of the course: bed, banks, valley floor and sides. The bed
/// and its banks are a function of the distance to the course and of its side alone, so a diagonal bed is as smooth as
/// a straight one; only the valley floor's edge and sides take the roughness of the rock at each cell.
/// The valley only cuts what the relief lacks: its depth is the wanted depth (`valley_depth`, at most half the local
/// relief) less the depth of the valley the relief already has, so the valleys of mountains are not cut twice and
/// plains get little more than their beds. The largest courses are cut first and the others sample the cut ground,
/// so a tributary valley meets its main valley at grade.
pub(super) fn incise_lines(height: &mut [f32], n: usize, width: f64, lines: &mut [Line], lake: &[u8], sea: &[u8], width_scale: f64) -> usize {
    if n < 2 || height.len() != n * n {
        return 0;
    }
    let cell = width / n as f64;
    let original = height.to_vec();
    let noise = Noise::new(Rng::new("valley-sides"));
    let rough_scale = 1.0 / ROUGH_WAVE.max(6.0 * cell);
    // Roughness of the rock at a cell, drawn the first time a valley side reaches it.
    let mut rough = vec![f32::NAN; n * n];
    let mut order: Vec<usize> = (0..lines.len()).collect();
    order.sort_by(|&a, &b| {
        let area = |i: usize| lines[i].area.last().copied().unwrap_or(0.0);
        area(b).total_cmp(&area(a)).then(a.cmp(&b))
    });
    for index in order {
        let line = &mut lines[index];
        let m = line.points.len() / 2;
        if m < 2 || line.area.len() != m || line.level.len() != m {
            continue;
        }
        let at = |k: usize| (line.points[2 * k], line.points[2 * k + 1]);
        let wide: Vec<f64> = line.area.iter().map(|&a| channel_width(a, width_scale)).collect();
        let ground: Vec<f64> = (0..m).map(|k| bilinear(height, n, cell, at(k).0, at(k).1)).collect();
        let mut arc = vec![0.0; m];
        for k in 1..m {
            arc[k] = arc[k - 1] + (at(k).0 - at(k - 1).0).hypot(at(k).1 - at(k - 1).1)
        }
        // Per vertex: the two sides of the valley and the valley depth still to cut.
        let flank = flanks(line, &arc, width_scale, cell, index, &noise);
        let mut extra = vec![0.0; m];
        for k in 0..m {
            let wanted = valley_depth(line.area[k]);
            let (p0, p1) = (at(k.saturating_sub(2)), at((k + 2).min(m - 1)));
            let l = (p1.0 - p0.0).hypot(p1.1 - p0.1);
            if l < 1e-9 || wanted <= 0.0 {
                continue;
            }
            let (nx, ny) = (-(p1.1 - p0.1) / l, (p1.0 - p0.0) / l);
            let (x, y) = at(k);
            let sample = |s: f64| bilinear(height, n, cell, x + nx * s, y + ny * s);
            let (left, right) = (flank[k][1].reach, -flank[k][0].reach);
            let (l1, r1) = (sample(left), sample(right));
            let (l3, r3) = (sample(2.0 * left).max(sample(3.0 * left)), sample(2.0 * right).max(sample(3.0 * right)));
            let existing = (l1.min(r1) - ground[k]).max(0.0);
            // The relief the valley may cut into: the lower of the highest grounds within three half widths.
            let relief = (l1.max(l3).min(r1.max(r3)) - ground[k]).max(0.0);
            extra[k] = (wanted.min(VALLEY_RELIEF_SHARE * relief) - existing).max(0.0);
        }
        // The valley depth varies smoothly along the course (a running mean over about 12 cells).
        let span = ((4.0 * cell) / (arc[m - 1] / (m - 1) as f64).max(1e-6)).ceil() as usize;
        let extra = running_mean(&extra, span);
        // The bed: a running minimum of the ground less the bed and valley depths, never under the bed this course
        // ends on (that of the course it joins, at grade), and the valley never under the line falling by
        // `VALLEY_GRADE` to that end.
        let joined = line.joins.is_some_and(|j| j >= 0);
        let end = if joined { ground[m - 1] } else { ground[m - 1] - bed_depth(wide[m - 1]) };
        let mut bed = vec![0.0; m];
        let mut previous = f64::INFINITY;
        for k in 0..m {
            let d = bed_depth(wide[k]);
            let grade = end + VALLEY_GRADE * (arc[m - 1] - arc[k]);
            let natural = ground[k] - d;
            let wanted = (natural - extra[k]).max(natural.min(grade));
            let mut z = previous.min(wanted).max(end);
            if natural - z > EXTRA_CUT + extra[k] {
                z = natural - EXTRA_CUT - extra[k]
            }
            bed[k] = z;
            previous = z
        }
        // The water surface: inside the bed, under the bank top, never rising, down to the level the course ends at.
        let floor = line.level[m - 1];
        let mut surface = f64::INFINITY;
        for k in 0..m {
            let d = bed_depth(wide[k]);
            surface = surface.min(line.level[k]).min(bed[k] + FILL * d).max(floor);
            line.level[k] = surface
        }
        // The cut: every cell near a stretch takes the lower of its ground and the cross-section at its distance.
        let mut k = 0;
        while k + 1 < m {
            let (ax, ay) = at(k);
            let mut j = k + 1;
            while j + 1 < m && (at(j).0 - ax).hypot(at(j).1 - ay) < 0.75 * cell {
                j += 1
            }
            let (bx, by) = at(j);
            let (dx, dy) = (bx - ax, by - ay);
            let l2 = (dx * dx + dy * dy).max(1e-12);
            let w = wide[k].max(wide[j]);
            let (depth, inner) = (bed_depth(w), (0.5 * w).max(0.75 * cell));
            let far = flank[k].iter().chain(&flank[j]).fold(0.0_f64, |far, f| far.max(f.reach));
            let low = |v: f64| ((v - far) / cell).floor().max(0.0) as usize;
            let high = |v: f64| (((v + far) / cell).floor().max(0.0) as usize).min(n - 1);
            for yy in low(ay.min(by))..=high(ay.max(by)) {
                for xx in low(ax.min(bx))..=high(ax.max(bx)) {
                    let c = yy * n + xx;
                    if original[c] <= 0.0 || lake.get(c).is_some_and(|&v| v != 0) || sea.get(c).is_some_and(|&v| v != 0) {
                        continue;
                    }
                    let (px, py) = ((xx as f64 + 0.5) * cell - ax, (yy as f64 + 0.5) * cell - ay);
                    let t = ((px * dx + py * dy) / l2).clamp(0.0, 1.0);
                    let d = (px - dx * t).hypot(py - dy * t);
                    if d >= far {
                        continue;
                    }
                    let side = usize::from(dx * py - dy * px > 0.0);
                    let flank = flank[k][side].mix(flank[j][side], t);
                    if d >= flank.reach {
                        continue;
                    }
                    let here = height[c] as f64;
                    let section = Section { z: bed[k] + (bed[j] - bed[k]) * t, depth, inner, flank };
                    // The roughest ground is the lowest section: no cell it leaves uncut needs its rock drawn.
                    if section.at(d, 1.0) >= here + 2.0 * VALLEY_BLEND {
                        continue;
                    }
                    if rough[c].is_nan() {
                        let (x, y) = ((xx as f64 + 0.5) * cell * rough_scale, (yy as f64 + 0.5) * cell * rough_scale);
                        rough[c] = (1.4 * noise.fbm(x, y, 2)).clamp(-1.0, 1.0) as f32
                    }
                    let s = section.at(d, rough[c] as f64);
                    if s >= here + VALLEY_BLEND {
                        continue;
                    }
                    // The valley side blends into the ground, and fades out over the last fifth of the reach.
                    let fade = 1.0 - smooth((d - 0.8 * flank.reach) / (0.2 * flank.reach));
                    // Invariant: a cell is the lowest of the cuts of the stretches near it, each made in the original
                    // ground, and the bed is never blended. A blend into the ground already cut lowered a cell again
                    // at every stretch that reached it: the bed rose where fewer reached it, at the end of the course.
                    let ground = original[c] as f64;
                    let cut = ground - smooth_min(ground, s, VALLEY_BLEND * smooth((d - inner) / flank.bank));
                    // Near the sea the cut keeps half of the height over one metre: the smoothed delta of the
                    // display may not take low ground under the sea.
                    let target = (ground - cut * fade).max(ground.min(1.0 + 0.5 * (ground - 1.0)));
                    if target < here {
                        height[c] = target as f32
                    }
                }
            }
            k = j
        }
    }
    height.iter().zip(&original).filter(|(a, b)| a < b).count()
}

/// The beds of the vector rivers of `water`, cut into `height` (the relief the water was computed on). The drainage
/// grids keep their levels; the relief of the hydrology follows the cut.
pub fn incise_rivers(height: &mut [f32], n: usize, width: f64, water: &mut Water, s: &Settings) -> usize {
    let Some(network) = water.rivers.as_mut() else { return 0 };
    let lowered = incise_lines(height, n, width, &mut network.rivers, &water.lake, &water.hydro.grids.sea, s.width_scale);
    if lowered > 0 && water.hydro.height.len() == height.len() {
        water.hydro.height.copy_from_slice(height)
    }
    lowered
}

#[cfg(test)]
mod tests {
    use super::*;

    /// A winding course over a gentle slope with a 1.5 m swell across it and a hollow before it.
    fn case() -> (Vec<f32>, usize, f64, Vec<Line>) {
        let (n, width) = (96_usize, 1920.0);
        let cell = width / n as f64;
        let mut height = vec![0.0_f32; n * n];
        for y in 0..n {
            for x in 0..n {
                let (wx, wy) = ((x as f64 + 0.5) * cell, (y as f64 + 0.5) * cell);
                let swell = 1.5 * (-((wx - 1000.0) / 120.0).powi(2)).exp() - 0.8 * (-((wx - 600.0) / 90.0).powi(2)).exp();
                height[y * n + x] = (40.0 - 0.004 * wx + 0.002 * (wy - 960.0).abs() + swell) as f32
            }
        }
        let mut line = Line::default();
        let mut x = 100.0_f64;
        while x <= 1800.0 {
            let y = 960.0 + 90.0 * (x / 170.0).sin() + 35.0 * (x / 61.0).sin();
            line.points.extend([x, y]);
            line.area.push(2.0e6);
            line.kind.push(1.0);
            // The water level as traced: the ground, swell included (it rises downstream there).
            line.level.push(bilinear(&height, n, cell, x, y));
            x += cell / 3.0
        }
        (height, n, width, vec![line])
    }

    /// Invariants of a course after the cut: the water surface never rises downstream, the bed never rises
    /// downstream, and the surface lies under both banks.
    #[test]
    fn beds_are_incised_and_never_rise() {
        let (mut height, n, width, mut lines) = case();
        let cell = width / n as f64;
        let before = height.clone();
        let rising = lines[0].level.windows(2).filter(|w| w[1] > w[0] + 1e-9).count();
        assert!(rising > 10, "the traced level rises over the swell");
        let floor = *lines[0].level.last().unwrap();
        let lowered = incise_lines(&mut height, n, width, &mut lines, &[], &[], 3.0);
        assert!(lowered > 0);
        let line = &lines[0];
        let m = line.level.len();
        assert!(line.level.windows(2).all(|w| w[1] <= w[0] + 1e-9), "water surface never rises downstream");
        let w = channel_width(2.0e6, 3.0);
        let (inner, bank) = ((0.5 * w).max(0.75 * cell), w.max(BANK_CELLS * cell));
        let mut shallow = 0;
        for k in 6..m - 6 {
            let (x, y) = (line.points[2 * k], line.points[2 * k + 1]);
            let bed = bilinear(&height, n, cell, x, y);
            let ahead = bilinear(&height, n, cell, line.points[2 * k + 12], line.points[2 * k + 13]);
            assert!(ahead <= bed + 0.3, "bed rises downstream at {k}: {bed} -> {ahead}");
            // The bank top is the ground before the cut: the surface lies under it and over the bed.
            let top = bilinear(&before, n, cell, x, y);
            // Except on the last stretch, held at the level the course ends on.
            assert!(top - line.level[k] >= 0.3 || line.level[k] <= floor + 1e-9, "water surface under the bank top at {k}: {top} vs {}", line.level[k]);
            if line.level[k] - bed < 0.2 {
                shallow += 1
            }
            assert!(top - bed <= bed_depth(w) + EXTRA_CUT + valley_depth(2.0e6) + 0.5, "bounded cut");
            // The cut fades out within the valley reach: the ground beyond it is untouched.
            let (tx, ty) = (line.points[2 * k + 4] - line.points[2 * k - 4], line.points[2 * k + 5] - line.points[2 * k - 3]);
            let floor = 2.0 * VALLEY_FLOOR * channel_width(2.0e6, 1.0) * 2.0 * 0.94 * 0.45_f64.exp();
            let reach = (inner + 1.8 * bank + (1.0 + ROUGH_FLOOR) * floor + 70.0 + valley_depth(2.0e6) / (SIDE_RANGE.0 * (1.0 - ROUGH_SIDE))).min(VALLEY_REACH);
            let (l, far) = (tx.hypot(ty), reach + 1.5 * cell);
            let (fx, fy) = (x - ty / l * far, y + tx / l * far);
            if (0..line.level.len()).all(|j| (line.points[2 * j] - fx).hypot(line.points[2 * j + 1] - fy) >= far - 1e-6) {
                assert_eq!(bilinear(&height, n, cell, fx, fy), bilinear(&before, n, cell, fx, fy), "untouched beyond the bank");
            }
        }
        assert!(shallow * 20 <= m, "the bed holds water ({shallow} of {m} vertices are nearly dry)");
    }

    /// Invariants of the valleys. Between two ridges 30 m high a course runs down a slope with no valley under it; a
    /// tributary joins it from a side. After the cut: the main course lies in a valley several metres below its
    /// shoulders, cut by the pass (the relief had none); its bed and its water never rise; the bed of the tributary
    /// ends on the bed of the main course (at grade); along a diagonal stretch the bed and its banks never rise from
    /// one cell to the next (no sawtooth).
    #[test]
    fn courses_get_valleys_at_grade_and_smooth_beds() {
        let (n, width) = (160_usize, 3200.0);
        let cell = width / n as f64;
        let mut height = vec![0.0_f32; n * n];
        for y in 0..n {
            for x in 0..n {
                let (wx, wy) = ((x as f64 + 0.5) * cell, (y as f64 + 0.5) * cell);
                // A diagonal axis falling south-east by 0.5 %, ridges rising 30 m over 800 m on both sides.
                let along = (wx + wy) / 2.0_f64.sqrt();
                let across = ((wx - wy) / 2.0_f64.sqrt()).abs();
                height[y * n + x] = (60.0 - 0.005 * along + 30.0 * (across / 800.0).min(1.0).powi(2)) as f32
            }
        }
        let before = height.clone();
        let course = |from: (f64, f64), to: (f64, f64), area: f64, joins: i32| {
            let mut line = Line::default();
            let steps = ((to.0 - from.0).hypot(to.1 - from.1) / (cell / 3.0)).ceil() as usize;
            for k in 0..=steps {
                let t = k as f64 / steps as f64;
                let (x, y) = (from.0 + (to.0 - from.0) * t, from.1 + (to.1 - from.1) * t);
                line.points.extend([x, y]);
                line.area.push(area);
                line.kind.push(1.0);
                line.level.push(bilinear(&height, n, cell, x, y));
            }
            line.joins = Some(joins);
            line
        };
        // Main course along the diagonal; a tributary from the north-east side joins it at (1600, 1600).
        let main = course((300.0, 300.0), (2900.0, 2900.0), 200.0e6, -1);
        let tributary = course((2300.0, 900.0), (1600.0, 1600.0), 5.0e6, 0);
        let mut lines = vec![main, tributary];
        incise_lines(&mut height, n, width, &mut lines, &[], &[], 3.0);
        for line in &lines {
            assert!(line.level.windows(2).all(|w| w[1] <= w[0] + 1e-9), "water never rises downstream");
        }
        let at = |h: &[f32], x: f64, y: f64| bilinear(h, n, cell, x, y);
        let (x, y) = (1300.0, 1300.0);
        let (nx, ny) = (std::f64::consts::FRAC_1_SQRT_2, -std::f64::consts::FRAC_1_SQRT_2);
        let shoulders = at(&height, x + 400.0 * nx, y + 400.0 * ny).min(at(&height, x - 400.0 * nx, y - 400.0 * ny));
        let axis = at(&height, x, y);
        let carved = at(&before, x, y) - axis;
        eprintln!("valley: {:.1} m below the shoulders at 400 m, axis cut by {carved:.1} m", shoulders - axis);
        assert!(shoulders - axis > 10.0, "a valley under the shoulders ({:.1} m)", shoulders - axis);
        assert!(carved > 5.0, "the valley is cut ({carved:.1} m)");
        let main = &lines[0];
        let m = main.points.len() / 2;
        let bed: Vec<f64> = (0..m).map(|k| at(&height, main.points[2 * k], main.points[2 * k + 1])).collect();
        // Away from the confluence, where the end of the tributary bed may stamp its level a few centimetres
        // upstream on the main bed.
        for k in 3..m - 3 {
            let near = (main.points[2 * k] - 1600.0).hypot(main.points[2 * k + 1] - 1600.0) < 120.0;
            assert!(near || bed[k + 3] <= bed[k] + 0.05, "bed rises at {k}: {} -> {}", bed[k], bed[k + 3]);
        }
        // No sawtooth: along the diagonal of the bed and the two diagonals beside it, away from the confluence (cell
        // 80), the ground never rises downstream by more than 2 cm from one cell to the next.
        let (mut tooth, mut worst) = (0.0_f64, (0, 0));
        for offset in 0..3 {
            for c in (n / 4)..(3 * n / 4) {
                if c.abs_diff(80) < 25 {
                    continue;
                }
                let rise = height[(c + 1) * n + c + 1 + offset] as f64 - height[c * n + c + offset] as f64;
                if rise > tooth {
                    (tooth, worst) = (rise, (c, offset));
                }
            }
        }
        eprintln!("sawtooth along the diagonal bed: largest rise {tooth:.3} m at cell {} (offset {})", worst.0, worst.1);
        assert!(tooth <= 0.02, "the bed rises by {tooth:.3} m from one diagonal cell to the next");
        let t = &lines[1];
        let last = t.points.len() / 2 - 1;
        let (ex, ey) = (t.points[2 * last], t.points[2 * last + 1]);
        let step = at(&height, t.points[2 * last - 6], t.points[2 * last - 5]) - at(&height, ex, ey);
        eprintln!("tributary: last metres fall {step:.2} m onto the main bed");
        assert!((-0.1..=1.0).contains(&step), "the tributary meets the main bed at grade ({step:.2} m)");
    }

    /// The two sides of a valley: over a winding course the outside of the bends has the narrower floor and the steeper
    /// side, the floor widens and narrows along the course, and at both ends the sides are equal.
    #[test]
    fn valley_sides_lean_with_the_bends_and_vary_along_the_course() {
        let mut line = Line::default();
        for k in 0..1200 {
            let x = 5.0 * k as f64;
            line.points.extend([x, 3000.0 + 160.0 * (x / 130.0).sin()]);
            line.area.push(60.0e6);
        }
        let m = line.points.len() / 2;
        let mut arc = vec![0.0; m];
        for k in 1..m {
            arc[k] = arc[k - 1] + (line.points[2 * k] - line.points[2 * k - 2]).hypot(line.points[2 * k + 1] - line.points[2 * k - 1])
        }
        let sides = flanks(&line, &arc, 3.0, 10.0, 0, &Noise::new(Rng::new("valley-sides")));
        for k in [0, m - 1] {
            assert!((sides[k][0].floor - sides[k][1].floor).abs() < 1e-9 && (sides[k][0].side - sides[k][1].side).abs() < 1e-9);
        }
        // Crests of the sine turn towards falling y (side 0 is inside: the course runs along x), troughs the other way.
        let (mut inside, mut outside, mut totals) = ((0.0, 0.0), (0.0, 0.0), Vec::new());
        for k in 200..m - 200 {
            let wave = (line.points[2 * k] / 130.0).sin();
            totals.push(sides[k][0].floor + sides[k][1].floor);
            if wave.abs() < 0.9 {
                continue;
            }
            let inner = usize::from(wave < 0.0);
            inside = (inside.0 + sides[k][inner].floor, inside.1 + sides[k][inner].side);
            outside = (outside.0 + sides[k][1 - inner].floor, outside.1 + sides[k][1 - inner].side);
        }
        assert!(inside.0 > 1.5 * outside.0, "floor inside {} and outside {}", inside.0, outside.0);
        assert!(outside.1 > 1.5 * inside.1, "side outside {} and inside {}", outside.1, inside.1);
        let (low, high) = totals.iter().fold((f64::INFINITY, 0.0_f64), |(lo, hi), &v| (lo.min(v), hi.max(v)));
        assert!(high > 1.8 * low, "floor width from {low:.0} to {high:.0} m");
    }

    /// Lakes and the sea are not cut, and the surface does not go under the level the course ends at.
    #[test]
    fn standing_water_is_left_alone() {
        let (mut height, n, width, mut lines) = case();
        let before = height.clone();
        let lake: Vec<u8> = (0..n * n).map(|c| u8::from(c % n >= 70)).collect();
        let floor = *lines[0].level.last().unwrap();
        incise_lines(&mut height, n, width, &mut lines, &lake, &[], 3.0);
        assert!((0..n * n).filter(|&c| lake[c] != 0).all(|c| height[c] == before[c]));
        assert!(lines[0].level.iter().all(|&z| z >= floor - 1e-9));
    }
}
