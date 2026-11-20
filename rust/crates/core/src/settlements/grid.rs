use super::{Point, Raster};
use std::cmp::Ordering;
use std::collections::BinaryHeap;

pub(super) const D8: [(isize, isize); 8] = [
    (-1, -1),
    (0, -1),
    (1, -1),
    (-1, 0),
    (1, 0),
    (-1, 1),
    (0, 1),
    (1, 1),
];
#[derive(Clone, Copy)]
pub(super) struct Entry(pub f64, pub usize);
impl PartialEq for Entry {
    fn eq(&self, b: &Self) -> bool {
        self.0 == b.0 && self.1 == b.1
    }
}
impl Eq for Entry {}
impl PartialOrd for Entry {
    fn partial_cmp(&self, b: &Self) -> Option<Ordering> {
        Some(self.cmp(b))
    }
}
impl Ord for Entry {
    fn cmp(&self, b: &Self) -> Ordering {
        b.0.total_cmp(&self.0).then_with(|| b.1.cmp(&self.1))
    }
}

pub(super) fn blur(values: &[f32], n: usize, radius: usize, rounds: usize) -> Vec<f32> {
    let mut a = values.to_vec();
    for _ in 0..rounds {
        for vertical in [false, true] {
            // Each line is an independent running sum; lines run in parallel, results land by index.
            let lines = crate::urban::par::range(n, |line| {
                let index = |p: usize| if vertical { p * n + line } else { line * n + p };
                let mut out = vec![0.0_f32; n];
                let mut sum = 0.0_f64;
                let mut left = 0;
                let mut right = 0;
                for (p, o) in out.iter_mut().enumerate() {
                    let end = (p + radius + 1).min(n);
                    while right < end {
                        sum += a[index(right)] as f64;
                        right += 1;
                    }
                    let begin = p.saturating_sub(radius);
                    while left < begin {
                        sum -= a[index(left)] as f64;
                        left += 1;
                    }
                    *o = (sum / (right - left) as f64) as f32;
                }
                out
            });
            let mut b = vec![0.0_f32; n * n];
            for (line, out) in lines.iter().enumerate() {
                for (p, &v) in out.iter().enumerate() {
                    b[if vertical { p * n + line } else { line * n + p }] = v;
                }
            }
            a = b;
        }
    }
    a
}

/// Owned copy of the adapted terrain, so a WASM handle can keep it between placement and routing.
pub(super) struct Land {
    pub width: f64,
    pub n: usize,
    pub height: Vec<f32>,
    pub water: Vec<u8>,
    pub water_level: Vec<f32>,
    pub river_width: Vec<f32>,
    pub river_ids: Vec<i32>,
}
impl Land {
    /// The raster pooled by `k` × `k` blocks (`n` a multiple of `k`): mean ground; a block is sea or
    /// lake/rock when at least half of it is, else river when any cell is (the widest one keeps its
    /// width and id, so narrow channels stay continuous), else dry. Water levels average the
    /// block's cells of the chosen class.
    pub fn pooled(&self, k: usize) -> Land {
        let (n, m) = (self.n, self.n / k);
        let mut out = Land {
            width: self.width * (m * k) as f64 / n as f64,
            n: m,
            height: vec![0.0; m * m],
            water: vec![0; m * m],
            water_level: vec![0.0; m * m],
            river_width: vec![0.0; m * m],
            river_ids: vec![-1; m * m],
        };
        let half = k * k;
        for y in 0..m {
            for x in 0..m {
                let cells = || {
                    (0..k).flat_map(move |dy| (0..k).map(move |dx| (y * k + dy) * n + x * k + dx))
                };
                let mut count = [0_usize; 4];
                let mut ground = 0.0_f64;
                let mut widest = None::<usize>;
                for i in cells() {
                    count[self.water[i] as usize] += 1;
                    ground += self.height[i] as f64;
                    if self.water[i] == 3
                        && widest.is_none_or(|w| self.river_width[i] > self.river_width[w])
                    {
                        widest = Some(i);
                    }
                }
                let class = if 2 * count[1] >= half {
                    1
                } else if 2 * count[2] >= half {
                    2
                } else if count[3] > 0 {
                    3
                } else {
                    0
                };
                let c = y * m + x;
                out.height[c] = (ground / half as f64) as f32;
                out.water[c] = class;
                out.water_level[c] = if class == 0 {
                    out.height[c]
                } else {
                    let (sum, k) = cells()
                        .filter(|&i| self.water[i] == class)
                        .fold((0.0_f64, 0_usize), |(s, k), i| {
                            (s + self.water_level[i] as f64, k + 1)
                        });
                    (sum / k as f64) as f32
                };
                if let (3, Some(w)) = (class, widest) {
                    out.river_width[c] = self.river_width[w];
                    out.river_ids[c] = self.river_ids[w];
                }
            }
        }
        out
    }
    /// Lake water (not cavern rock, which is also class 2): a surface above the ground.
    pub fn lake_depth(&self, i: usize) -> f64 {
        if self.water[i] == 2 {
            (self.water_level[i] - self.height[i]) as f64
        } else {
            0.0
        }
    }
}

pub(super) struct Fields {
    pub r: Land,
    pub cell: f64,
    pub slope: Vec<f32>,
    pub slope_s: Vec<f32>,
    pub hb: Vec<f32>,
    /// `1 - smooth(slope_s)`: how much meandering noise still applies on this cell.
    pub flat: Vec<f64>,
    pub route_height: Vec<f32>,
    pub dw: Vec<f64>,
    pub ds: Vec<f64>,
    pub db: Vec<f64>,
    pub hab: Vec<f64>,
    /// Distance to standing lake water (class 2 above the ground).
    pub dl: Vec<f64>,
    /// Dry land whose 4-connected component never reaches the map edge.
    pub island: Vec<bool>,
    /// Land masses: 4-connected components separated by sea and lakes (`u32::MAX` on either),
    /// and their dry areas (m²). Crossable rivers and streams, and cave rock, join surrounding land.
    pub land_part: Vec<u32>,
    pub land_area: Vec<f64>,
    pub sat: Vec<u32>,
    /// Terraced village land: up to a 45 degree hillside, with the same dry/flood rules.
    pub terrace_sat: Vec<u32>,
    /// Dry-land height range, for the elevation preference.
    pub dry_range: (f32, f32),
    /// Steepest grade along each long road move from each cell, computed by the first road
    /// search on this terrain and kept for later reroutes.
    pub long_grades: std::sync::OnceLock<Vec<f32>>,
    /// Allowed road moves per cell (bit per direction), without and with causeways; computed by
    /// the first road search on this terrain.
    /// The third variant is for the cultures that dig through cave rock (`roads::tunnelling`).
    pub move_masks: [std::sync::OnceLock<Vec<u32>>; 3],
    /// Underdark maps only (cave rock marked by the bridge, `CAVE_ROCK_MARK`): placement's view of water.
    pub cave: Option<Cave>,
}
/// Cave rock: water class 2 whose level lies more than this far (m) below the ground. The bridge
/// marks the Underdark cave mask so (`CAVE_ROCK_DEPTH`, 1000 m); no lake or sea sits there, so
/// surface water at ground level (a lagoon, a lake margin) is never taken for rock.
pub const CAVE_ROCK_MARK: f32 = 500.0;
/// Underdark: cave rock is class 2 far below its level (`CAVE_ROCK_MARK`). It is
/// neither a shore nor a flood line, so placement measures water and flood height against real
/// water only; `dw`/`hab` keep the raw meaning for the road search.
pub(super) struct Cave {
    /// Open-floor share of the map (dry cells over all cells).
    pub floor: f64,
    /// Distance to sea, lake or river water, the rock excluded.
    pub dw: Vec<f64>,
    /// Height above that water (99 when none is on the map).
    pub hab: Vec<f64>,
    /// Connected open ground (4-neighbours, everything but rock): the component of each cell
    /// (`u32::MAX` on rock) and the dry floor of each component (m²).
    pub component: Vec<u32>,
    pub component_floor: Vec<f64>,
}
impl Cave {
    /// Dry floor (m²) of the cave system around cell `i`: its whole connected component.
    pub fn reachable_floor(&self, i: usize) -> f64 {
        self.component_floor.get(self.component[i] as usize).copied().unwrap_or(0.0)
    }
}
impl Fields {
    /// Cave rock: class 2 with the bridge's rock mark (`CAVE_ROCK_MARK`).
    pub fn is_rock(&self, i: usize) -> bool {
        self.r.water[i] == 2 && self.r.water_level[i] < self.r.height[i] - CAVE_ROCK_MARK
    }
    /// Distance to water as placement reads it: real water only in the Underdark.
    pub fn place_dw(&self, i: usize) -> f64 {
        self.cave.as_ref().map_or(self.dw[i], |c| c.dw[i])
    }
    /// Height above water as placement reads it: real water only in the Underdark.
    pub fn place_hab(&self, i: usize) -> f64 {
        self.cave.as_ref().map_or(self.hab[i], |c| c.hab[i])
    }
    /// The cave rock as one even/odd ring group on the cell corners (rock masses with their
    /// chambers as holes), in metres, for the urban geometry: towns then clip to the open floor.
    /// A diagonal rock contact is closed first (its floor pair becomes rock: never more floor
    /// than the raster has), so every ring corner has a single way on.
    pub fn rock_rings(&self) -> Vec<Vec<[f64; 2]>> {
        let n = self.r.n;
        let base: Vec<bool> = (0..n * n).map(|i| self.is_rock(i)).collect();
        // One planning cell of margin: the drawn wall follows the finer cave field, up to half a
        // cell either side of a planning cell edge, so a town keeps one cell clear of the rock
        // and no house reaches into the drawn wall.
        let mut rock = base.clone();
        for y in 0..n {
            for x in 0..n {
                let i = y * n + x;
                if !base[i]
                    && ((x > 0 && base[i - 1])
                        || (x + 1 < n && base[i + 1])
                        || (y > 0 && base[i - n])
                        || (y + 1 < n && base[i + n]))
                {
                    rock[i] = true;
                }
            }
        }
        loop {
            let mut changed = false;
            for y in 0..n.saturating_sub(1) {
                for x in 0..n - 1 {
                    let (a, b, c, d) = (y * n + x, y * n + x + 1, (y + 1) * n + x, (y + 1) * n + x + 1);
                    if rock[a] == rock[d] && rock[b] == rock[c] && rock[a] != rock[b] {
                        if rock[a] {
                            rock[b] = true;
                            rock[c] = true;
                        } else {
                            rock[a] = true;
                            rock[d] = true;
                        }
                        changed = true;
                    }
                }
            }
            if !changed {
                break;
            }
        }
        let side = n + 1;
        let mut next = vec![usize::MAX; side * side];
        let mut starts = vec![];
        let at = |x: usize, y: usize| rock[y * n + x];
        for y in 0..n {
            for x in 0..n {
                if !at(x, y) {
                    continue;
                }
                let mut edge = |a: (usize, usize), b: (usize, usize)| {
                    next[a.1 * side + a.0] = b.1 * side + b.0;
                    starts.push(a.1 * side + a.0);
                };
                if y == 0 || !at(x, y - 1) {
                    edge((x, y), (x + 1, y));
                }
                if x + 1 == n || !at(x + 1, y) {
                    edge((x + 1, y), (x + 1, y + 1));
                }
                if y + 1 == n || !at(x, y + 1) {
                    edge((x + 1, y + 1), (x, y + 1));
                }
                if x == 0 || !at(x - 1, y) {
                    edge((x, y + 1), (x, y));
                }
            }
        }
        let mut used = vec![false; side * side];
        let mut rings = vec![];
        for &start in &starts {
            if used[start] {
                continue;
            }
            let mut corners = vec![];
            let mut c = start;
            while c != usize::MAX && !used[c] {
                used[c] = true;
                corners.push((c % side, c / side));
                c = next[c];
            }
            // Only the turns: a staircase keeps its corners, a straight wall its two ends.
            let k = corners.len();
            let ring: Vec<[f64; 2]> = (0..k)
                .filter(|&j| {
                    let (a, b, c) = (corners[(j + k - 1) % k], corners[j], corners[(j + 1) % k]);
                    (b.0 as i64 - a.0 as i64) * (c.1 as i64 - b.1 as i64)
                        != (b.1 as i64 - a.1 as i64) * (c.0 as i64 - b.0 as i64)
                })
                .map(|j| [corners[j].0 as f64 * self.cell, corners[j].1 as f64 * self.cell])
                .collect();
            if ring.len() >= 3 {
                rings.push(ring);
            }
        }
        rings
    }
    pub fn new(r: Raster<'_>) -> Self {
        let r = Land {
            width: r.width,
            n: r.n,
            height: r.height.to_vec(),
            water: r.water.to_vec(),
            water_level: r.water_level.to_vec(),
            river_width: r.river_width.to_vec(),
            river_ids: r.river_ids.to_vec(),
        };
        let n = r.n;
        let cell = r.width / n as f64;
        let mut slope = vec![0.0; n * n];
        for y in 0..n {
            for x in 0..n {
                let dx = (r.height[y * n + (x + 1).min(n - 1)]
                    - r.height[y * n + x.saturating_sub(1)]) as f64
                    / (if x == 0 || x == n - 1 {
                        cell
                    } else {
                        2.0 * cell
                    });
                let dy = (r.height[(y + 1).min(n - 1) * n + x]
                    - r.height[y.saturating_sub(1) * n + x]) as f64
                    / (if y == 0 || y == n - 1 {
                        cell
                    } else {
                        2.0 * cell
                    });
                slope[y * n + x] = dx.hypot(dy) as f32;
            }
        }
        let mut blurred = crate::urban::par::range(2, |k| {
            if k == 0 {
                blur(&slope, n, (100.0 / cell).round().max(1.0) as usize, 2)
            } else {
                blur(&r.height, n, (300.0 / cell).round().max(2.0) as usize, 2)
            }
        });
        let hb = blurred.pop().unwrap();
        let slope_s = blurred.pop().unwrap();
        let flat: Vec<f64> = slope_s
            .iter()
            .map(|&v| 1.0 - super::smooth(f64::from(v), 0.08, 0.3))
            .collect();
        let route_height = deck_height(&r);
        let dry_range = (0..n * n)
            .filter(|&i| r.water[i] == 0)
            .fold((f32::INFINITY, f32::NEG_INFINITY), |(lo, hi), i| {
                (lo.min(r.height[i]), hi.max(r.height[i]))
            });
        // Four independent distance fields.
        let mut fields = crate::urban::par::range(4, |k| match k {
            0 => distance(n, cell, |i| r.water[i] != 0),
            1 => distance(n, cell, |i| r.water[i] == 1),
            2 => distance(n, cell, |i| r.water[i] == 3 && r.river_width[i] >= 4.5),
            _ => distance(n, cell, |i| {
                r.water[i] == 2 && r.water_level[i] > r.height[i]
            }),
        });
        let dl = fields.pop().unwrap().0;
        let db = fields.pop().unwrap().0;
        let ds = fields.pop().unwrap().0;
        let (dw, nearest) = fields.pop().unwrap();
        let hab: Vec<_> = (0..n * n)
            .map(|i| {
                if nearest[i] == usize::MAX {
                    99.0
                } else {
                    r.height[i] as f64 - r.water_level[nearest[i]] as f64
                }
            })
            .collect();
        // Underdark (the cave rock the bridge marks, `CAVE_ROCK_MARK`): one more distance field,
        // to real water only. Ordinary maps have no rock and keep every field as it was.
        let is_rock = |i: usize| r.water[i] == 2 && r.water_level[i] < r.height[i] - CAVE_ROCK_MARK;
        let rock_cells = (0..n * n).filter(|&i| is_rock(i)).count();
        let cave = (rock_cells > 0).then(|| {
            let (dw, nearest) = distance(n, cell, |i| r.water[i] != 0 && !is_rock(i));
            let hab = (0..n * n)
                .map(|i| {
                    if nearest[i] == usize::MAX {
                        99.0
                    } else {
                        r.height[i] as f64 - r.water_level[nearest[i]] as f64
                    }
                })
                .collect();
            let floor = r.water.iter().filter(|&&w| w == 0).count() as f64 / (n * n) as f64;
            let mut component = vec![u32::MAX; n * n];
            let mut component_floor = vec![];
            let mut stack = vec![];
            for start in 0..n * n {
                if component[start] != u32::MAX || is_rock(start) {
                    continue;
                }
                let id = component_floor.len() as u32;
                let mut dry = 0usize;
                component[start] = id;
                stack.push(start);
                while let Some(i) = stack.pop() {
                    dry += usize::from(r.water[i] == 0);
                    let (x, y) = (i % n, i / n);
                    for j in [
                        (x > 0).then(|| i - 1),
                        (x + 1 < n).then(|| i + 1),
                        (y > 0).then(|| i - n),
                        (y + 1 < n).then(|| i + n),
                    ]
                    .into_iter()
                    .flatten()
                    {
                        if component[j] == u32::MAX && !is_rock(j) {
                            component[j] = id;
                            stack.push(j);
                        }
                    }
                }
                component_floor.push(dry as f64 * cell * cell);
            }
            Cave { floor, dw, hab, component, component_floor }
        });
        let buildable_hab = cave.as_ref().map_or(&hab, |c| &c.hab);
        let island = islands(n, &r.water);
        let mut land_part = vec![u32::MAX; n * n];
        let mut land_area = vec![];
        let mut stack = vec![];
        let separates_land = |i: usize| r.water[i] == 1 || (r.water[i] == 2 && !is_rock(i));
        for start in 0..n * n {
            if land_part[start] != u32::MAX || separates_land(start) {
                continue;
            }
            let id = land_area.len() as u32;
            let mut dry = 0usize;
            land_part[start] = id;
            stack.push(start);
            while let Some(i) = stack.pop() {
                dry += usize::from(r.water[i] == 0);
                let (x, y) = (i % n, i / n);
                for j in [
                    (x > 0).then(|| i - 1),
                    (x + 1 < n).then(|| i + 1),
                    (y > 0).then(|| i - n),
                    (y + 1 < n).then(|| i + n),
                ]
                .into_iter()
                .flatten()
                {
                    if land_part[j] == u32::MAX && !separates_land(j) {
                        land_part[j] = id;
                        stack.push(j);
                    }
                }
            }
            land_area.push(dry as f64 * cell * cell);
        }
        let mut sat = vec![0; (n + 1) * (n + 1)];
        let mut terrace_sat = vec![0; (n + 1) * (n + 1)];
        for y in 0..n {
            let mut row = 0;
            let mut terrace_row = 0;
            for x in 0..n {
                let i = y * n + x;
                row += u32::from(r.water[i] == 0 && slope[i] < 0.2 && buildable_hab[i] >= 1.0);
                terrace_row += u32::from(r.water[i] == 0 && slope[i] <= 1.0 && buildable_hab[i] >= 1.0);
                sat[(y + 1) * (n + 1) + x + 1] = sat[y * (n + 1) + x + 1] + row;
                terrace_sat[(y + 1) * (n + 1) + x + 1] = terrace_sat[y * (n + 1) + x + 1] + terrace_row;
            }
        }
        Self {
            r,
            cell,
            slope,
            slope_s,
            hb,
            flat,
            route_height,
            dw,
            ds,
            db,
            hab,
            dl,
            island,
            land_part,
            land_area,
            sat,
            terrace_sat,
            dry_range,
            long_grades: std::sync::OnceLock::new(),
            move_masks: Default::default(),
            cave,
        }
    }
    /// Bilinear road height (ground, bridge decks over rivers) at a point.
    pub fn height_at(&self, p: Point) -> f64 {
        let n = self.r.n;
        let gx = (p.x / self.cell - 0.5).clamp(0.0, (n - 1) as f64);
        let gy = (p.y / self.cell - 0.5).clamp(0.0, (n - 1) as f64);
        let (x0, y0) = (gx.floor() as usize, gy.floor() as usize);
        let (x1, y1) = ((x0 + 1).min(n - 1), (y0 + 1).min(n - 1));
        let (tx, ty) = (gx - x0 as f64, gy - y0 as f64);
        let h = |x: usize, y: usize| self.route_height[y * n + x] as f64;
        (h(x0, y0) * (1.0 - tx) + h(x1, y0) * tx) * (1.0 - ty)
            + (h(x0, y1) * (1.0 - tx) + h(x1, y1) * tx) * ty
    }
    /// 0 at the lowest dry ground, 1 at the highest.
    pub fn elevation(&self, i: usize) -> f64 {
        let (lo, hi) = self.dry_range;
        if hi > lo {
            ((self.r.height[i] - lo) / (hi - lo)).clamp(0.0, 1.0) as f64
        } else {
            0.5
        }
    }
    pub fn pos(&self, i: usize) -> Point {
        Point {
            x: (i % self.r.n) as f64 * self.cell + 0.5 * self.cell,
            y: (i / self.r.n) as f64 * self.cell + 0.5 * self.cell,
        }
    }
    pub fn index(&self, p: Point) -> usize {
        (p.y / self.cell).floor().clamp(0.0, (self.r.n - 1) as f64) as usize * self.r.n
            + (p.x / self.cell).floor().clamp(0.0, (self.r.n - 1) as f64) as usize
    }
    pub fn fraction(&self, p: Point, rad: f64) -> f64 {
        self.fraction_of(&self.sat, p, rad)
    }
    pub fn terrace_fraction(&self, p: Point, rad: f64) -> f64 {
        self.fraction_of(&self.terrace_sat, p, rad)
    }
    fn fraction_of(&self, sat: &[u32], p: Point, rad: f64) -> f64 {
        let n = self.r.n;
        let k = n + 1;
        let x0 = ((p.x - rad) / self.cell).floor().max(0.0) as usize;
        let x1 = ((p.x + rad) / self.cell).floor().min((n - 1) as f64) as usize;
        let y0 = ((p.y - rad) / self.cell).floor().max(0.0) as usize;
        let y1 = ((p.y + rad) / self.cell).floor().min((n - 1) as f64) as usize;
        let s = sat[(y1 + 1) * k + x1 + 1] as i64
            - sat[y0 * k + x1 + 1] as i64
            - sat[(y1 + 1) * k + x0] as i64
            + sat[y0 * k + x0] as i64;
        s as f64
            / (((x1 - x0 + 1) * (y1 - y0 + 1)) as f64).max(
                (2.0 * rad / self.cell)
                    .round()
                    .max(0.0)
                    .mul_add(1.0, 1.0)
                    .powi(2),
            )
    }
}
/// Road surface height: the ground on dry land (unblurred, as drawn); over rivers the level of
/// their banks, carried across wide beds, so a road bridges a gorge instead of climbing down into
/// it; the water level over lakes (causeways).
fn deck_height(r: &Land) -> Vec<f32> {
    let n = r.n;
    let mut h: Vec<Option<f32>> = (0..n * n)
        .map(|i| match r.water[i] {
            0 => Some(r.height[i]),
            2 if r.water_level[i] > r.height[i] => Some(r.water_level[i]),
            _ => None,
        })
        .collect();
    // Preserve the synchronous D8 propagation: a wave only reads heights committed by
    // earlier waves. Queue each unresolved cell once instead of cloning/scanning the
    // entire raster on every wave across a wide sea or cavern.
    let mut queued = vec![false; n * n];
    let mut frontier = Vec::new();
    for i in 0..n * n {
        if h[i].is_some() {
            continue;
        }
        let (x, y) = ((i % n) as isize, (i / n) as isize);
        if D8.iter().any(|&(dx, dy)| {
            let (xx, yy) = (x + dx, y + dy);
            xx >= 0 && yy >= 0 && xx < n as isize && yy < n as isize
                && h[yy as usize * n + xx as usize].is_some()
        }) {
            queued[i] = true;
            frontier.push(i);
        }
    }
    let mut values = Vec::new();
    let mut next = Vec::new();
    for _ in 0..n {
        if frontier.is_empty() {
            break;
        }
        values.clear();
        for &i in &frontier {
            let (x, y) = ((i % n) as isize, (i / n) as isize);
            let (mut sum, mut count) = (0.0, 0);
            // Same f32 accumulation order as the full-grid implementation.
            for (dx, dy) in D8 {
                let (xx, yy) = (x + dx, y + dy);
                if xx >= 0 && yy >= 0 && xx < n as isize && yy < n as isize
                    && let Some(v) = h[yy as usize * n + xx as usize]
                {
                    sum += v;
                    count += 1;
                }
            }
            debug_assert!(count > 0);
            values.push(sum / count as f32);
        }
        for (&i, &v) in frontier.iter().zip(&values) {
            h[i] = Some(v);
        }
        next.clear();
        for &i in &frontier {
            let (x, y) = ((i % n) as isize, (i / n) as isize);
            for (dx, dy) in D8 {
                let (xx, yy) = (x + dx, y + dy);
                if xx >= 0 && yy >= 0 && xx < n as isize && yy < n as isize {
                    let j = yy as usize * n + xx as usize;
                    if h[j].is_none() && !queued[j] {
                        queued[j] = true;
                        next.push(j);
                    }
                }
            }
        }
        std::mem::swap(&mut frontier, &mut next);
    }
    h.iter()
        .zip(&r.height)
        .map(|(v, &g)| v.unwrap_or(g))
        .collect()
}

/// Dry cells of every land mass that does not touch the map border.
fn islands(n: usize, water: &[u8]) -> Vec<bool> {
    let mut island = vec![false; n * n];
    let mut seen = vec![false; n * n];
    for start in 0..n * n {
        if water[start] != 0 || seen[start] {
            continue;
        }
        let (mut stack, mut cells, mut edge) = (vec![start], vec![], false);
        seen[start] = true;
        while let Some(i) = stack.pop() {
            cells.push(i);
            let (x, y) = (i % n, i / n);
            edge |= x == 0 || y == 0 || x + 1 == n || y + 1 == n;
            let mut push = |j: usize| {
                if water[j] == 0 && !seen[j] {
                    seen[j] = true;
                    stack.push(j);
                }
            };
            if x > 0 {
                push(i - 1);
            }
            if x + 1 < n {
                push(i + 1);
            }
            if y > 0 {
                push(i - n);
            }
            if y + 1 < n {
                push(i + n);
            }
        }
        if !edge {
            for i in cells {
                island[i] = true;
            }
        }
    }
    island
}
fn distance(n: usize, cell: f64, mask: impl Fn(usize) -> bool) -> (Vec<f64>, Vec<usize>) {
    let mut d = vec![1e12; n * n];
    let mut source = vec![usize::MAX; n * n];
    let mut heap = BinaryHeap::new();
    for i in 0..n * n {
        if mask(i) {
            d[i] = 0.0;
            source[i] = i;
            heap.push(Entry(0.0, i));
        }
    }
    while let Some(Entry(cost, i)) = heap.pop() {
        if cost > d[i] {
            continue;
        }
        let x = (i % n) as isize;
        let y = (i / n) as isize;
        for (dx, dy) in D8 {
            let (xx, yy) = (x + dx, y + dy);
            if xx < 0 || yy < 0 || xx >= n as isize || yy >= n as isize {
                continue;
            }
            let j = yy as usize * n + xx as usize;
            let v = cost
                + cell
                    * if dx != 0 && dy != 0 {
                        std::f64::consts::SQRT_2
                    } else {
                        1.0
                    };
            if v < d[j] {
                d[j] = v;
                source[j] = source[i];
                heap.push(Entry(v, j));
            }
        }
    }
    (d, source)
}

#[cfg(test)]
fn deck_height_legacy(r: &Land) -> Vec<f32> {
    let n = r.n;
    let mut h: Vec<Option<f32>> = (0..n * n)
        .map(|i| match r.water[i] {
            0 => Some(r.height[i]),
            2 if r.water_level[i] > r.height[i] => Some(r.water_level[i]),
            _ => None,
        })
        .collect();
    for _ in 0..n {
        let mut next = h.clone();
        let mut open = false;
        for i in 0..n * n {
            if h[i].is_some() {
                continue;
            }
            let (x, y) = ((i % n) as isize, (i / n) as isize);
            let (mut sum, mut count) = (0.0, 0);
            for (dx, dy) in D8 {
                let (xx, yy) = (x + dx, y + dy);
                if xx >= 0
                    && yy >= 0
                    && xx < n as isize
                    && yy < n as isize
                    && let Some(v) = h[yy as usize * n + xx as usize]
                {
                    sum += v;
                    count += 1;
                }
            }
            if count > 0 {
                next[i] = Some(sum / count as f32);
            } else {
                open = true;
            }
        }
        h = next;
        if !open {
            break;
        }
    }
    h.iter()
        .zip(&r.height)
        .map(|(v, &g)| v.unwrap_or(g))
        .collect()
}


#[cfg(test)]
mod deck_frontier_tests {
    use super::*;
    use crate::settlements::{Config, SettlementSpec};

    fn fixture(n: usize, kind: usize) -> Land {
        let mut r = Land {
            width: n as f64 * 40.0,
            n,
            height: (0..n*n).map(|i| 5.0 + ((i * 37 + i / n * 11) % 173) as f32 / 13.0).collect(),
            water: vec![0; n*n],
            water_level: vec![24.125; n*n],
            river_width: vec![0.0; n*n],
            river_ids: vec![-1; n*n],
        };
        for y in 0..n {
            for x in 0..n {
                let i = y*n+x;
                r.water[i] = match kind {
                    0 => 0, // all dry
                    1 => 1, // no height sources; preserve original ground fallback
                    2 => if x < (n/8).max(1) { 0 } else { 1 },
                    3 => if x == 0 || y == 0 || x+1 == n || y+1 == n { 0 } else { 3 },
                    4 => if (x == n/2 && y == n/2) || (x+y)%17 == 0 { 0 } else { 1 },
                    5 => 2, // lake decks are sources
                    6 => { r.water_level[i] = -30.0; 2 }, // cavern rock is not a source
                    _ => ((i*19+x*3+y*7)%4) as u8,
                };
                if r.water[i] == 3 {
                    r.river_width[i] = 12.5;
                    r.river_ids[i] = (x % 3) as i32;
                }
            }
        }
        r
    }
    fn raster(r: &Land) -> Raster<'_> {
        Raster { width: r.width, n: r.n, height: &r.height, water: &r.water,
            water_level: &r.water_level, river_width: &r.river_width, river_ids: &r.river_ids }
    }
    fn assert_bits(r: &Land) {
        let before = deck_height_legacy(r);
        let after = deck_height(r);
        assert_eq!(before.len(), after.len());
        for (i, (a, b)) in before.iter().zip(&after).enumerate() {
            assert_eq!(a.to_bits(), b.to_bits(), "cell {i}, n {}", r.n);
        }
    }

    #[test]
    fn settlement_deck_frontier_matches_legacy_bits_all_water_classes_and_converging_waves() {
        for n in [1, 2, 3, 7, 16, 31, 64] {
            for kind in 0..8 { assert_bits(&fixture(n, kind)); }
        }
    }

    #[test]
    fn settlement_deck_frontier_matches_legacy_bits_wide_sea_islands_and_rock() {
        for kind in [2, 3, 4, 6] { assert_bits(&fixture(128, kind)); }
    }

    #[test]
    fn settlement_deck_frontier_preserves_placement_scores_seed_and_explicit_position() {
        let r = fixture(64, 2);
        let fast = Fields::new(raster(&r));
        let mut reference = Fields::new(raster(&r));
        reference.route_height = deck_height_legacy(&reference.r);
        assert_eq!(fast.route_height.iter().map(|x|x.to_bits()).collect::<Vec<_>>(),
            reference.route_height.iter().map(|x|x.to_bits()).collect::<Vec<_>>());
        let position = Point { x: 100.25, y: 1200.75 };
        let mut cfg = Config { mode: "list".into(), list: vec![
            SettlementSpec { key: "pinned".into(), population: 300, position: Some(position), ..Default::default() },
            SettlementSpec { key: "auto".into(), population: 150, site_type: "bridge".into(), ..Default::default() },
        ], ..Default::default() };
        for seed in ["placement-frontier-a", "placement-frontier-b"] {
            for manual in [true, false] {
                cfg.list[0].position = manual.then_some(position);
                let a = crate::settlements::placement::place(seed, &reference, &cfg);
                let b = crate::settlements::placement::place(seed, &fast, &cfg);
                assert_eq!(serde_json::to_vec(&a).unwrap(), serde_json::to_vec(&b).unwrap());
                if manual {
                    let pinned = b.settlements.iter().find(|s| s.spec.key == "pinned").unwrap();
                    assert_eq!(pinned.center, position);
                    assert!(pinned.scores.manual);
                }
            }
        }
    }

    /// Short algorithm-only A/B, not a whole-placement CPU or UI latency claim.
    #[test]
    #[ignore = "root-only short deck propagation A/B"]
    fn settlement_deck_frontier_short_benchmark() {
        use std::{hint::black_box, time::Instant};
        let mut rows = Vec::new();
        for n in [128, 256] {
            let r = fixture(n, 2);
            assert_bits(&r);
            for round in 0..3 {
                for fast_first in [false, true] {
                    let order = if fast_first { [true, false] } else { [false, true] };
                    for frontier in order {
                        let begin = Instant::now();
                        let values = if frontier { deck_height(black_box(&r)) } else { deck_height_legacy(black_box(&r)) };
                        black_box(&values);
                        rows.push(serde_json::json!({"n":n,"round":round,"frontier":frontier,
                            "elapsed_ms":begin.elapsed().as_secs_f64()*1000.0,"cells":values.len()}));
                    }
                }
            }
        }
        let result = serde_json::json!({"scope":"deck_height only; same raster and f32 bits; not whole placement or browser latency", "rows":rows});
        let out = std::env::var("SETTLEMENT_DECK_PROOF_OUT").expect("SETTLEMENT_DECK_PROOF_OUT JSON path");
        assert!(!std::path::Path::new(&out).exists(), "fresh proof output required");
        std::fs::write(out, serde_json::to_vec_pretty(&result).unwrap()).unwrap();
        println!("{result}");
    }
}
