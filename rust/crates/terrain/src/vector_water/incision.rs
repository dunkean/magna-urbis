//! River beds along the final courses. The vector rivers are traced on the conditioned relief, then meandered,
//! joined and relaxed: their final planform no longer lies on a thalweg of the grid, and on open ground there is
//! none. This pass cuts every course its own bed, so that
//! - the bed never rises downstream (running minimum along the course, down to the bed of what it joins);
//! - the bed lies below its banks by a depth that grows with the channel width (`bed_depth`);
//! - the water surface of the line never rises downstream and sits inside that bed, under the bank top.
//! - the ground along every course is lowered into a valley whose depth and width grow with its catchment, as far
//!   as the relief lacks one (`valley_depth`, `Section`).
//! Lakes, the sea and the planform are untouched; only land cells within the valley reach of a course are lowered.
use super::rivers::{Line, channel_width};
use super::{Settings, Water};

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
/// Mean side slope of a valley (rise over run); it varies by a quarter along the course.
const VALLEY_SIDE: f64 = 0.12;
/// Half width of the valley floor beyond the banks, in channel widths (the width of the river itself, without the
/// display scale of the drawn channel).
const VALLEY_FLOOR: f64 = 2.0;
/// Widest half width of a valley (m): the pass visits no cell farther from a course.
const VALLEY_REACH: f64 = 600.0;
/// Least fall of a bed towards the end of its course (rise over run) where a valley deepens it: the valley never
/// takes a bed under the line that keeps it descending to its outlet.
const VALLEY_GRADE: f64 = 0.0005;
/// Softness of the valley side where it meets the ground (m).
const VALLEY_BLEND: f64 = 0.6;

/// Smooth minimum of `a` and `b` over `k` (polynomial): equal to the minimum when they differ by more than `k`.
fn smooth_min(a: f64, b: f64, k: f64) -> f64 {
    let h = (k - (a - b).abs()).max(0.0);
    a.min(b) - h * h / (4.0 * k)
}

/// One cross-section, from the axis of a course outwards (`d`, m), as a height: the bed (`z`, flat over half the
/// channel), the banks rising by the bed depth to the valley floor, the floor, then the valley sides at `side`, with
/// a rounded foot.
struct Section {
    z: f64,
    depth: f64,
    inner: f64,
    bank: f64,
    floor: f64,
    side: f64,
}
impl Section {
    fn at(&self, d: f64) -> f64 {
        if d <= self.inner {
            return self.z;
        }
        let u = ((d - self.inner) / self.bank).min(1.0);
        let banks = self.z + self.depth * u * u * (3.0 - 2.0 * u);
        let e = d - self.inner - self.bank - self.floor;
        if e <= 0.0 {
            return banks;
        }
        let r = self.floor.max(1.0);
        banks + self.side * if e < r { e * e / (2.0 * r) } else { e - 0.5 * r }
    }
}

/// Cuts the beds and the valleys of `lines` into `height` and lowers their water surface into the beds. Returns the
/// cells lowered.
///
/// Invariants (per course): the bed never rises downstream (running minimum, except where it crosses ground higher
/// than `EXTRA_CUT` over its depth), the water surface never rises and lies in the bed under its banks, and every
/// cell takes the lower of its ground and one cross-section of the course: bed, banks, valley floor and sides. The
/// cross-section is a function of the distance to the course alone, so a diagonal bed is as smooth as a straight one.
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
        // Per vertex: the floor half width (bed, banks, floor), the valley depth still to cut and the side slope.
        let phase = (index as f64 * 2.399_963).rem_euclid(std::f64::consts::TAU);
        let mut extra = vec![0.0; m];
        let mut side = vec![VALLEY_SIDE; m];
        let mut reach = vec![0.0; m];
        for k in 0..m {
            let (inner, bank) = ((0.5 * wide[k]).max(0.75 * cell), wide[k].max(BANK_CELLS * cell));
            let floor = VALLEY_FLOOR * channel_width(line.area[k], 1.0);
            let wanted = valley_depth(line.area[k]);
            side[k] = VALLEY_SIDE * (1.0 + 0.25 * (0.6 * (arc[k] / 700.0 + phase).sin() + 0.4 * (arc[k] / 230.0 + 2.0 * phase).sin()));
            let half = (inner + bank + floor + wanted / side[k]).min(VALLEY_REACH).max(inner + bank);
            reach[k] = half;
            let (p0, p1) = (at(k.saturating_sub(2)), at((k + 2).min(m - 1)));
            let l = (p1.0 - p0.0).hypot(p1.1 - p0.1);
            if l < 1e-9 || wanted <= 0.0 {
                continue;
            }
            let (nx, ny) = (-(p1.1 - p0.1) / l, (p1.0 - p0.0) / l);
            let (x, y) = at(k);
            let sample = |s: f64| bilinear(height, n, cell, x + nx * s, y + ny * s);
            let (l1, r1) = (sample(half), sample(-half));
            let (l3, r3) = (sample(2.0 * half).max(sample(3.0 * half)), sample(-2.0 * half).max(sample(-3.0 * half)));
            let existing = (l1.min(r1) - ground[k]).max(0.0);
            // The relief the valley may cut into: the lower of the highest grounds within three half widths.
            let relief = (l1.max(l3).min(r1.max(r3)) - ground[k]).max(0.0);
            extra[k] = (wanted.min(VALLEY_RELIEF_SHARE * relief) - existing).max(0.0);
        }
        // The valley depth varies smoothly along the course (a running mean over about 12 cells).
        let span = ((4.0 * cell) / (arc[m - 1] / (m - 1) as f64).max(1e-6)).ceil() as usize;
        let mut sum = vec![0.0; m + 1];
        for k in 0..m {
            sum[k + 1] = sum[k] + extra[k]
        }
        let extra: Vec<f64> = (0..m).map(|k| {
            let (a, b) = (k.saturating_sub(span), (k + span).min(m - 1));
            (sum[b + 1] - sum[a]) / (b + 1 - a) as f64
        }).collect();
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
            let section = |t: f64| Section {
                z: bed[k] + (bed[j] - bed[k]) * t,
                depth: bed_depth(w),
                inner: (0.5 * w).max(0.75 * cell),
                bank: w.max(BANK_CELLS * cell),
                floor: VALLEY_FLOOR * channel_width(line.area[k].max(line.area[j]), 1.0),
                side: side[k],
            };
            let far = reach[k].max(reach[j]);
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
                    let here = height[c] as f64;
                    let s = section(t).at(d);
                    if s >= here + VALLEY_BLEND {
                        continue;
                    }
                    // The valley side blends into the ground, and fades out over the last fifth of the reach.
                    let u = ((d - 0.8 * far) / (0.2 * far)).clamp(0.0, 1.0);
                    let fade = 1.0 - u * u * (3.0 - 2.0 * u);
                    let ground = original[c] as f64;
                    let cut = here - smooth_min(here, s, VALLEY_BLEND);
                    // Near the sea the cut keeps half of the height over one metre: the smoothed delta of the
                    // display may not take low ground under the sea.
                    let target = (here - cut * fade).max(ground.min(1.0 + 0.5 * (ground - 1.0)));
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
            let reach = (inner + bank + VALLEY_FLOOR * channel_width(2.0e6, 1.0) + valley_depth(2.0e6) / (0.75 * VALLEY_SIDE)).min(VALLEY_REACH);
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
