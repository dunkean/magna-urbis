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
    let mut b = vec![0.0; n * n];
    for _ in 0..rounds {
        for vertical in [false, true] {
            for line in 0..n {
                let index = |p: usize| if vertical { p * n + line } else { line * n + p };
                let mut sum = 0.0_f64;
                let mut left = 0;
                let mut right = 0;
                for p in 0..n {
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
                    b[index(p)] = (sum / (right - left) as f64) as f32;
                }
            }
            std::mem::swap(&mut a, &mut b);
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
    pub route_height: Vec<f32>,
    pub dw: Vec<f64>,
    pub ds: Vec<f64>,
    pub db: Vec<f64>,
    pub hab: Vec<f64>,
    /// Distance to standing lake water (class 2 above the ground).
    pub dl: Vec<f64>,
    /// Dry land whose 4-connected component never reaches the map edge.
    pub island: Vec<bool>,
    pub sat: Vec<u32>,
    /// Dry-land height range, for the elevation preference.
    pub dry_range: (f32, f32),
    /// Steepest grade along each long road move from each cell, computed by the first road
    /// search on this terrain and kept for later reroutes.
    pub long_grades: std::sync::OnceLock<Vec<f32>>,
}
impl Fields {
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
        let slope_s = blur(&slope, n, (100.0 / cell).round().max(1.0) as usize, 2);
        let hb = blur(&r.height, n, (300.0 / cell).round().max(2.0) as usize, 2);
        let route_height = deck_height(&r);
        let dry_range = (0..n * n)
            .filter(|&i| r.water[i] == 0)
            .fold((f32::INFINITY, f32::NEG_INFINITY), |(lo, hi), i| {
                (lo.min(r.height[i]), hi.max(r.height[i]))
            });
        let (dw, nearest) = distance(n, cell, |i| r.water[i] != 0);
        let ds = distance(n, cell, |i| r.water[i] == 1).0;
        let db = distance(n, cell, |i| r.water[i] == 3 && r.river_width[i] >= 4.5).0;
        let hab: Vec<_> = (0..n * n)
            .map(|i| {
                if nearest[i] == usize::MAX {
                    99.0
                } else {
                    r.height[i] as f64 - r.water_level[nearest[i]] as f64
                }
            })
            .collect();
        let dl = distance(n, cell, |i| {
            r.water[i] == 2 && r.water_level[i] > r.height[i]
        })
        .0;
        let island = islands(n, &r.water);
        let mut sat = vec![0; (n + 1) * (n + 1)];
        for y in 0..n {
            let mut row = 0;
            for x in 0..n {
                let i = y * n + x;
                row += u32::from(r.water[i] == 0 && slope[i] < 0.2 && hab[i] >= 1.0);
                sat[(y + 1) * (n + 1) + x + 1] = sat[y * (n + 1) + x + 1] + row;
            }
        }
        Self {
            r,
            cell,
            slope,
            slope_s,
            hb,
            route_height,
            dw,
            ds,
            db,
            hab,
            dl,
            island,
            sat,
            dry_range,
            long_grades: std::sync::OnceLock::new(),
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
        let n = self.r.n;
        let k = n + 1;
        let x0 = ((p.x - rad) / self.cell).floor().max(0.0) as usize;
        let x1 = ((p.x + rad) / self.cell).floor().min((n - 1) as f64) as usize;
        let y0 = ((p.y - rad) / self.cell).floor().max(0.0) as usize;
        let y1 = ((p.y + rad) / self.cell).floor().min((n - 1) as f64) as usize;
        let s = self.sat[(y1 + 1) * k + x1 + 1] as i64
            - self.sat[y0 * k + x1 + 1] as i64
            - self.sat[(y1 + 1) * k + x0] as i64
            + self.sat[y0 * k + x0] as i64;
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
