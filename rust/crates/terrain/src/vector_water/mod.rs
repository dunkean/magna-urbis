//! V2 vector water. Arithmetic is f64 between f32 raster stores, as in JS.
//! Separate from the procedural engine's hydrology.
mod balance;
mod conditioning;
mod lake;
mod metrics;
mod rivers;
#[cfg(test)]
mod tests;
mod wire;
use crate::priority_flood::{FloodGrids, flood_grids};
pub use conditioning::{Conditioning, ConditioningResult, condition_relief};
pub use lake::{LakeField, lake_field};
use serde::{Deserialize, Serialize};
pub use wire::{request, request_with_clock};

pub(super) const DX: [isize; 8] = [-1, 0, 1, -1, 1, -1, 0, 1];
pub(super) const DY: [isize; 8] = [-1, -1, -1, 0, 0, 1, 1, 1];
pub(super) fn neighbours(c: usize, n: usize) -> impl Iterator<Item = (usize, f64)> {
    let (x, y) = ((c % n) as isize, (c / n) as isize);
    (0..8).filter_map(move |k| {
        let (xx, yy) = (x + DX[k], y + DY[k]);
        (xx >= 0 && yy >= 0 && xx < n as isize && yy < n as isize).then(|| {
            (
                (yy as usize) * n + xx as usize,
                if DX[k] != 0 && DY[k] != 0 {
                    std::f64::consts::SQRT_2
                } else {
                    1.0
                },
            )
        })
    })
}
pub struct Hydrology {
    pub n: usize,
    pub width: f64,
    pub height: Vec<f32>,
    pub grids: FloodGrids,
}
impl Hydrology {
    pub fn cell_area(&self) -> f64 {
        (self.width / self.n as f64).powi(2)
    }
}
pub fn hydrology(height: &[f32], n: usize, width: f64) -> Hydrology {
    hydro_options(height, n, width, None, None, None)
}
fn hydro_options(
    height: &[f32],
    n: usize,
    width: f64,
    weight: Option<&[f32]>,
    outlet: Option<&[u8]>,
    loss: Option<&[f32]>,
) -> Hydrology {
    Hydrology {
        n,
        width,
        height: height.to_vec(),
        grids: flood_grids(height, n, (width / n as f64).powi(2), weight, outlet, loss),
    }
}
#[derive(Clone, Deserialize, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct Settings {
    pub river_area: f64,
    pub lake_depth: f64,
    pub lake_area: f64,
    pub river_mode: String,
    pub flat_slope: f64,
    pub sinuosity: f64,
    pub width_scale: f64,
    pub balance: bool,
    pub braiding: f64,
    pub anabranching: bool,
    pub terrain_influence: bool,
    pub avulsions: bool,
    pub confluence: String,
    pub deltas: bool,
    /// Headwaters, 0 (a river starts where its catchment reaches `river_area`) to 1: rivers continue up their
    /// talweg, and take the side valleys they pass, down to a tenth of that catchment, as long as the relief
    /// shows a valley or a cut channel.
    #[serde(default)]
    pub headwaters: f64,
}
/// Share of the river catchment a headwater keeps at `headwaters` 1.
pub const HEADWATER_SHARE: f64 = 0.1;
/// A talweg cell: across its flow direction the ground rises on both sides within two cells, by 3 % at least (a
/// valley or a cut channel, not an open slope).
pub fn valley_cell(height: &[f32], receiver: &[i32], n: usize, cell: f64, c: usize) -> bool {
    let r = receiver[c];
    if r < 0 {
        return false;
    }
    let (x, y) = ((c % n) as isize, (c / n) as isize);
    let (dx, dy) = ((r as usize % n) as isize - x, (r as usize / n) as isize - y);
    let side = |k: isize| {
        let (xx, yy) = (x - dy * k, y + dx * k);
        (xx >= 0 && yy >= 0 && xx < n as isize && yy < n as isize).then(|| height[yy as usize * n + xx as usize] as f64)
    };
    let rise = (0.06 * cell).max(1.0);
    matches!((side(2), side(-2)), (Some(a), Some(b)) if a.min(b) - height[c] as f64 >= rise)
}
#[derive(Clone, Copy, Deserialize, Serialize)]
pub struct Climate {
    pub temperature: f64,
    pub precipitation: f64,
}
#[derive(Serialize)]
pub struct Runoff {
    pub r0: f64,
    pub e0: f64,
    pub aridity: f64,
}
impl Climate {
    fn potential(self, z: f64) -> f64 {
        let t = self.temperature - 0.0065 * z.max(0.0);
        (300.0 + 25.0 * t + 0.05 * t * t * t).max(60.0)
    }
    fn runoff_at(self, z: f64) -> f64 {
        let p = self.precipitation;
        let l = self.potential(z);
        (0.02 * p)
            .max(p - p / (0.9 + p * p / (l * l)).sqrt())
            .max(0.5)
    }
    fn runoff(self) -> Runoff {
        Runoff {
            r0: self.runoff_at(0.0),
            e0: self.potential(0.0),
            aridity: self.precipitation / self.potential(0.0),
        }
    }
}
pub struct Water {
    pub hydro: Hydrology,
    pub lake: Vec<u8>,
    pub lake_level: Option<Vec<f32>>,
    pub lake_kind: Option<Vec<u8>>,
    pub lakes: usize,
    pub closed_lakes: usize,
    pub lake_area_km2: f64,
    pub river_cells: usize,
    pub rivers: Option<rivers::Network>,
    pub metrics: metrics::Metrics,
    pub runoff: Runoff,
    pub confluence_angle: Option<f64>,
    pub field: LakeField,
    pub hydrology_ms: f64,
    pub balance_ms: f64,
}
pub fn compute_water(
    height: &[f32],
    n: usize,
    width: f64,
    s: &Settings,
    climate: Climate,
    seed: &str,
    drainage: Option<Hydrology>,
) -> Water {
    compute_water_timed(height, n, width, s, climate, seed, drainage, &|| 0.0)
}
fn compute_water_timed(
    height: &[f32],
    n: usize,
    width: f64,
    s: &Settings,
    climate: Climate,
    seed: &str,
    drainage: Option<Hydrology>,
    now: &dyn Fn() -> f64,
) -> Water {
    let started = now();
    let mut balance_ms = 0.0;
    let runoff = climate.runoff();
    let mut h = drainage.unwrap_or_else(|| if s.balance {
        Hydrology { n, width, height: Vec::new(), grids: crate::priority_flood::routing_grids(height, n) }
    } else { hydrology(height, n, width) });
    let total = n * n;
    let (mut lake, mut lakes, mut closed_lakes, mut lake_area_km2);
    let (mut lake_level, mut lake_kind) = (None, None);
    if s.balance {
        let balance_started = now();
        let b = balance::water_balance(
            height,
            n,
            width,
            &h.grids.sea,
            climate,
            s.lake_depth,
            s.lake_area * 1e4,
            Some(&h),
        );
        balance_ms = now() - balance_started;
        let mut components = vec![-1_i32; total];
        let mut sinks = Vec::new();
        let mut outlet = vec![0; total];
        for c in 0..total {
            if b.closed[c] == 0 || components[c] >= 0 {
                continue;
            }
            let id = sinks.len() as i32;
            let body = b.lake_of[c];
            let mut queue = vec![c];
            components[c] = id;
            let mut bottom = c;
            let mut head = 0;
            while head < queue.len() {
                let at = queue[head];
                head += 1;
                if height[at] < height[bottom] {
                    bottom = at
                }
                // Includes the centre in TS; it is already labelled.
                for (nb, _) in neighbours(at, n) {
                    if components[nb] < 0 && b.closed[nb] != 0 && b.lake_of[nb] == body {
                        components[nb] = id;
                        queue.push(nb)
                    }
                }
            }
            sinks.push(bottom);
            outlet[bottom] = 1;
        }
        h = hydro_options(
            &b.routing_height,
            n,
            width,
            Some(&b.weight),
            Some(&outlet),
            Some(&b.loss),
        );
        h.height = height.to_vec();
        for c in 0..total {
            if b.closed[c] != 0 {
                h.grids.filled[c] = b.level[c]
            }
        }
        (lake, lakes, closed_lakes, lake_area_km2) =
            balance::balanced_bodies(&b, height, n, h.cell_area(), s.lake_depth, s.lake_area);
        let mut upstream = vec![0; total];
        let mut drawn = vec![0; sinks.len()];
        let mut terminal = vec![0; sinks.len()];
        for &cc in h.grids.order.iter().rev() {
            let c = cc as usize;
            let r = h.grids.receiver[c];
            if h.grids.accumulation[c] as f64 >= s.river_area * 1e6 {
                upstream[c] = 1
            }
            if r >= 0 && upstream[c] != 0 {
                upstream[r as usize] = 1
            }
            if lake[c] != 0 && components[c] >= 0 {
                drawn[components[c] as usize] = 1
            }
        }
        for (id, &c) in sinks.iter().enumerate() {
            if drawn[id] == 0 && upstream[c] != 0 && b.level[c] as f64 - height[c] as f64 > 0.1 {
                terminal[id] = 1;
                lakes += 1;
                closed_lakes += 1
            }
        }
        for c in 0..total {
            let id = components[c];
            if id >= 0
                && terminal[id as usize] != 0
                && b.level[c] as f64 - height[c] as f64 > 0.1
                && lake[c] == 0
            {
                lake[c] = 1;
                lake_area_km2 += h.cell_area() / 1e6
            }
        }
        capture_lake_shores(&mut h, &lake, Some(&b.weight), Some(&b.loss), s.river_area * 1e6);
        let mut kind = vec![0; total];
        for c in 0..total {
            if b.lake_of[c] >= 0 {
                kind[c] = if b.closed[c] != 0 { 2 } else { 1 }
            }
        }
        lake_level = Some(b.level);
        lake_kind = Some(kind);
    } else {
        (lake, lakes, lake_area_km2) = water_bodies(&h, s);
        capture_lake_shores(&mut h, &lake, None, None, s.river_area * 1e6);
        closed_lakes = 0;
    }
    let river_cells = (0..total)
        .filter(|&c| {
            h.grids.sea[c] == 0
                && lake[c] == 0
                && h.grids.accumulation[c] as f64 >= s.river_area * 1e6
        })
        .count();
    let confluence_angle = (s.confluence == "climate")
        .then(|| 45.0 + 27.0 * ((runoff.aridity - 0.2) / 0.8).clamp(0.0, 1.0));
    let hydrology_ms = now() - started - balance_ms;
    let field = {
        let level = lake_level.as_deref().unwrap_or(&h.grids.filled[..]);
        lake::lake_field_with_shore(
            &lake,
            n,
            Some(lake::Shore {
                level,
                height,
                depth: if s.balance { balance::SHORE_DEPTH } else { s.lake_depth },
            }),
        )
    };
    let rivers = (s.river_mode == "vector").then(|| {
        let river_started = now();
        let mut network = rivers::vector_rivers(
            &h,
            &lake,
            &field,
            s,
            seed,
            runoff.aridity,
            if s.balance { runoff.r0 / 300.0 } else { 1.0 },
            confluence_angle,
        );
        network.ms = now() - river_started;
        network
    });
    let metrics = metrics::river_metrics(&h, &lake, rivers.as_ref(), s.river_area, s.width_scale);
    Water {
        hydro: h,
        lake,
        lake_level,
        lake_kind,
        lakes,
        closed_lakes,
        lake_area_km2,
        river_cells,
        rivers,
        metrics,
        runoff,
        confluence_angle,
        field,
        hydrology_ms,
        balance_ms,
    }
}
/// Invariant: a river that reaches a lake shore drains into the lake. D8 on
/// the filled surface may let a river skirt a lake, along its shallow margin
/// or a lower neighbour, a cell away from the water. A river cell beside a lake
/// cell whose surface is not above its own is routed into the lake instead.
/// The lake must precede the cell in flood order, so receivers still point
/// strictly backwards in `order` (no cycle, `order` stays topological), and the
/// lake's own outlet, flooded through the spill cell, is never captured.
/// Upstream areas are then summed again with the same weights and losses.
pub(super) fn capture_lake_shores(
    h: &mut Hydrology,
    lake: &[u8],
    weight: Option<&[f32]>,
    loss: Option<&[f32]>,
    river_area: f64,
) -> usize {
    let n = h.n;
    let total = n * n;
    let cell_area = h.cell_area();
    let g = &mut h.grids;
    if g.order.len() != total || g.accumulation.len() != total {
        return 0;
    }
    let mut rank = vec![u32::MAX; total];
    for (i, &c) in g.order.iter().enumerate() {
        rank[c as usize] = i as u32;
    }
    let mut captured = 0;
    for c in 0..total {
        if lake[c] != 0 || g.sea[c] != 0 || (g.accumulation[c] as f64) < river_area {
            continue;
        }
        let r = g.receiver[c];
        if r >= 0 && lake[r as usize] != 0 {
            continue;
        }
        let mut best: Option<usize> = None;
        for (nb, _) in neighbours(c, n) {
            if lake[nb] != 0
                && g.sea[nb] == 0
                && rank[nb] < rank[c]
                && g.filled[nb] <= g.filled[c]
                && best.map_or(true, |b| g.filled[nb] < g.filled[b])
            {
                best = Some(nb);
            }
        }
        if let Some(l) = best {
            g.receiver[c] = l as i32;
            captured += 1;
        }
    }
    if captured == 0 {
        return 0;
    }
    for c in 0..total {
        g.accumulation[c] = if g.sea[c] == 0 {
            (cell_area * weight.map_or(1.0, |w| w[c] as f64)) as f32
        } else {
            0.0
        };
    }
    for &cc in g.order.iter().rev() {
        let c = cc as usize;
        if let Some(l) = loss {
            let v = l[c];
            if v != 0.0 && !v.is_nan() {
                g.accumulation[c] = (g.accumulation[c] as f64 - v as f64).max(0.0) as f32;
            }
        }
        let r = g.receiver[c];
        if r >= 0 {
            let up = g.accumulation[c] as f64;
            g.accumulation[r as usize] = (g.accumulation[r as usize] as f64 + up) as f32;
        }
    }
    if g.basin.len() == total {
        // Roots keep their labels; captured cells join their lake's basin.
        for &cc in g.order.iter() {
            let r = g.receiver[cc as usize];
            if r >= 0 {
                g.basin[cc as usize] = g.basin[r as usize];
            }
        }
    }
    captured
}
fn water_bodies(h: &Hydrology, s: &Settings) -> (Vec<u8>, usize, f64) {
    let n = h.n;
    let total = n * n;
    let g = &h.grids;
    let deep: Vec<bool> = (0..total)
        .map(|c| {
            g.sea[c] == 0
                && g.filled[c] > 0.0
                && g.filled[c] as f64 - h.height[c] as f64 >= s.lake_depth
        })
        .collect();
    let mut lake = vec![0; total];
    let mut seen = vec![false; total];
    let mut lakes = 0;
    let mut cells = 0;
    for start in 0..total {
        if !deep[start] || seen[start] {
            continue;
        }
        let mut component = vec![start];
        seen[start] = true;
        let mut i = 0;
        while i < component.len() {
            let c = component[i];
            i += 1;
            for (nb, _) in neighbours(c, n) {
                if deep[nb] && !seen[nb] && g.filled[nb] == g.filled[c] {
                    seen[nb] = true;
                    component.push(nb)
                }
            }
        }
        if (component.len() as f64) < s.lake_area * 1e4 / h.cell_area() {
            continue;
        }
        lakes += 1;
        cells += component.len();
        for c in component {
            lake[c] = 1
        }
    }
    (lake, lakes, cells as f64 * h.cell_area() / 1e6)
}

/// JS heap tie policies matter for least-cost routes: stable for Heap,
/// key-only for CellHeap/floorPath (left child wins ties).
#[derive(Default)]
pub(super) struct Heap {
    entries: Vec<(usize, f64, u64)>,
    count: u64,
    stable: bool,
}
impl Heap {
    fn new(stable: bool) -> Self {
        Self {
            stable,
            ..Self::default()
        }
    }
    fn less(&self, a: (usize, f64, u64), b: (usize, f64, u64)) -> bool {
        a.1 < b.1 || (self.stable && a.1 == b.1 && a.2 < b.2)
    }
    fn push(&mut self, c: usize, key: f64) {
        let entry = (c, key, self.count);
        self.count += 1;
        let mut i = self.entries.len();
        self.entries.push(entry);
        while i > 0 {
            let p = (i - 1) / 2;
            if !self.less(entry, self.entries[p]) {
                break;
            }
            self.entries[i] = self.entries[p];
            i = p;
        }
        self.entries[i] = entry;
    }
    fn pop(&mut self) -> Option<(usize, f64)> {
        if self.entries.is_empty() {
            return None;
        }
        let top = self.entries[0];
        let e = self.entries.pop().unwrap();
        let mut i = 0;
        while 2 * i + 1 < self.entries.len() {
            let mut m = 2 * i + 1;
            if m + 1 < self.entries.len() && self.less(self.entries[m + 1], self.entries[m]) {
                m += 1
            }
            if !self.less(self.entries[m], e) {
                break;
            }
            self.entries[i] = self.entries[m];
            i = m;
        }
        if !self.entries.is_empty() {
            self.entries[i] = e
        }
        Some((top.0, top.1))
    }
}
pub fn downsample(height: &[f32], n: usize, m: usize) -> Vec<f32> {
    if n == m {
        return height.to_vec();
    }
    let f = n as f64 / m as f64;
    let mut out = vec![0.0; m * m];
    if f.fract() == 0.0 {
        let q = f as usize;
        for y in 0..m {
            for x in 0..m {
                let mut sum = 0.0;
                for dy in 0..q {
                    for dx in 0..q {
                        sum += height[(y * q + dy) * n + x * q + dx] as f64
                    }
                }
                out[y * m + x] = (sum / (f * f)) as f32
            }
        }
        return out;
    }
    let axes: Vec<Vec<(usize, f64)>> = (0..m)
        .map(|k| {
            let a = k as f64 * f;
            let b = a + f;
            (a.floor() as usize..n.min(b.ceil() as usize))
                .filter_map(|i| {
                    let w = b.min((i + 1) as f64) - a.max(i as f64);
                    (w > 0.0).then_some((i, w))
                })
                .collect()
        })
        .collect();
    for y in 0..m {
        for x in 0..m {
            let mut sum = 0.0;
            for &(row, wy) in &axes[y] {
                let mut line = 0.0;
                for &(col, wx) in &axes[x] {
                    line += height[row * n + col] as f64 * wx
                }
                sum += line * wy
            }
            out[y * m + x] = (sum / (f * f)) as f32
        }
    }
    out
}
pub(super) fn weights(t: f64) -> [f64; 4] {
    [
        (1.0 - t).powi(3) / 6.0,
        (3.0 * t.powi(3) - 6.0 * t * t + 4.0) / 6.0,
        (-3.0 * t.powi(3) + 3.0 * t * t + 3.0 * t + 1.0) / 6.0,
        t.powi(3) / 6.0,
    ]
}
pub fn interpolate_delta(
    delta: &[f32],
    m: usize,
    n: usize,
    x: f64,
    y: f64,
    width: f64,
    map_width: f64,
) -> Vec<f32> {
    let cell = width / n as f64;
    let dc = map_width / m as f64;
    let axis = |origin: f64| -> Vec<([usize; 4], [f64; 4])> {
        (0..n)
            .map(|k| {
                let g = ((origin + (k as f64 + 0.5) * cell) / dc - 0.5).clamp(0.0, (m - 1) as f64);
                let i = g.floor() as isize;
                (
                    [
                        (i - 1).clamp(0, m as isize - 1) as usize,
                        i as usize,
                        (i + 1).min(m as isize - 1) as usize,
                        (i + 2).min(m as isize - 1) as usize,
                    ],
                    weights(g - i as f64),
                )
            })
            .collect()
    };
    let (xs, ys) = (axis(x), axis(y));
    let mut out = vec![0.0; n * n];
    crate::terrain_par::rows(&mut out, n, |y, row| {
        for x in 0..n {
            let mut v = 0.0;
            for a in 0..4 {
                for b in 0..4 {
                    v += delta[ys[y].0[a] * m + xs[x].0[b]] as f64 * ys[y].1[a] * xs[x].1[b]
                }
            }
            row[x] = v as f32
        }
    });
    out
}
pub fn upsample_delta(delta: &[f32], m: usize, n: usize) -> Vec<f32> {
    if m == n {
        delta.to_vec()
    } else {
        interpolate_delta(delta, m, n, 0.0, 0.0, n as f64, n as f64)
    }
}
