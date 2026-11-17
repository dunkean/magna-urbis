//! Coarse landscape evolution ported from web/src/gen/terrain/erosion.ts.
//! Priority flood, D-infinity split drainage, implicit stream-power incision,
//! basin breaching, thermal relaxation, and bounded bicubic sampling.
use crate::{noise::Noise, smooth};
use std::f64::consts::{FRAC_PI_4, SQRT_2};
mod pipeline;
#[cfg(test)]
mod sill_tests;
pub use pipeline::TerrainPipeline;
pub use pipeline::cut_coast_field;

const D8: [(isize, isize); 8] = [
    (1, 0),
    (1, 1),
    (0, 1),
    (-1, 1),
    (-1, 0),
    (-1, -1),
    (0, -1),
    (1, -1),
];
const DIST: [f64; 8] = [1.0, SQRT_2, 1.0, SQRT_2, 1.0, SQRT_2, 1.0, SQRT_2];

// A gentle onset and a bounded endpoint, independent of map extent.
fn erosion_strength(erosion: f64) -> f64 {
    0.12 * erosion
}

/// Erosion settings a client may override; NaN keeps the relief default.
/// Multipliers default to 1. The same values reach the GPU erosion plan.
/// Basins fill with sediment (fill ×3) while their sills are carved (0.1 of
/// their depth per step): plains survive and drain, instead of staying closed
/// (38% of a mixed relief under water before) or being dissected.
pub const EROSION_TUNING: [&str; 17] = [
    "iterations",
    "incision",
    "incisionSlope",
    "fill",
    "carve",
    "finalCarve",
    "talus",
    "thermal",
    "diffusion",
    "detail",
    "warp",
    "surfaceIterations",
    "surfaceIncision",
    "surfaceCarve",
    "surfaceRouted",
    "surfaceThermal",
    "surfaceDiffusion",
];
pub(crate) const ITERATIONS: usize = 0;
pub(crate) const INCISION: usize = 1;
pub(crate) const INCISION_SLOPE: usize = 2;
pub(crate) const FILL: usize = 3;
pub(crate) const CARVE: usize = 4;
pub(crate) const FINAL_CARVE: usize = 5;
pub(crate) const TALUS: usize = 6;
pub(crate) const THERMAL: usize = 7;
pub(crate) const DIFFUSION: usize = 8;
pub(crate) const DETAIL: usize = 9;
pub(crate) const WARP: usize = 10;
pub(crate) const SURFACE_ITERATIONS: usize = 11;
pub(crate) const SURFACE_INCISION: usize = 12;
pub(crate) const SURFACE_CARVE: usize = 13;
pub(crate) const SURFACE_ROUTED: usize = 14;
pub(crate) const SURFACE_THERMAL: usize = 15;
pub(crate) const SURFACE_DIFFUSION: usize = 16;
/// Defaults of the settings shared by every relief (the others come from the relief).
pub(crate) const TUNING_DEFAULTS: [f64; 17] = [
    f64::NAN,
    1.0,
    0.2,
    3.0,
    0.1,
    1.0,
    f64::NAN,
    1.0,
    f64::NAN,
    f64::NAN,
    1.0,
    12.0,
    1.0,
    0.3,
    1.0,
    1.0,
    1.0,
];

thread_local! {
    static TUNING: std::cell::Cell<[f64; 17]> = const { std::cell::Cell::new([f64::NAN; 17]) };
}
/// Overrides for the generators built afterwards on this thread (a wasm worker).
pub fn set_erosion_tuning(values: &[f64]) {
    let mut tuning = [f64::NAN; 17];
    for (slot, &value) in tuning.iter_mut().zip(values) {
        *slot = if value.is_finite() { value } else { f64::NAN };
    }
    TUNING.with(|t| t.set(tuning));
}
/// The override of setting `i`, or `default`.
pub(crate) fn tuned(i: usize, default: f64) -> f64 {
    let value = TUNING.with(|t| t.get()[i]);
    if value.is_nan() { default } else { value }
}
/// The override of setting `i`, or its shared default.
pub(crate) fn tuning(i: usize) -> f64 {
    tuned(i, TUNING_DEFAULTS[i])
}

// Reuse the same D8 topology through every erosion iteration. Interior cells
// address their neighbours by constant offsets; only the rim checks bounds.
// Missing neighbours are `usize::MAX`, in the D8 visiting order.
struct Grid {
    n: usize,
    borders: Vec<bool>,
    offsets: [isize; 8],
}
impl Grid {
    fn new(n: usize) -> Self {
        let mut borders = vec![false; n * n];
        for y in 0..n {
            for x in 0..n {
                borders[y * n + x] = x == 0 || y == 0 || x == n - 1 || y == n - 1;
            }
        }
        Self {
            n,
            borders,
            offsets: D8.map(|(dx, dy)| dy * n as isize + dx),
        }
    }
    #[inline(always)]
    fn neighbors(&self, i: usize) -> [usize; 8] {
        if !self.borders[i] {
            return self.offsets.map(|o| i.wrapping_add_signed(o));
        }
        self.edge_neighbors(i)
    }
    #[inline(never)]
    fn edge_neighbors(&self, i: usize) -> [usize; 8] {
        let n = self.n as isize;
        let (x, y) = ((i % self.n) as isize, (i / self.n) as isize);
        D8.map(|(dx, dy)| {
            let (nx, ny) = (x + dx, y + dy);
            if nx >= 0 && ny >= 0 && nx < n && ny < n {
                (ny * n + nx) as usize
            } else {
                usize::MAX
            }
        })
    }
}

/// No receiver / no cell.
const NONE: u32 = u32::MAX;

/// Priority-flood result and its reusable work buffers.
#[derive(Default)]
struct Flood {
    filled: Vec<f32>,
    receiver: Vec<u32>,
    order: Vec<u32>,
    /// Position of each cell in `order` (strict-descent routing only).
    rank: Vec<u32>,
    /// Per cell, the directions (bit d) of the neighbours drained before it.
    lower: Vec<u8>,
    /// 0 unseen, 1 reached, 2 drained.
    state: Vec<u8>,
    sorted: Vec<u32>,
    keys: Vec<(u32, u32)>,
    spare: Vec<(u32, u32)>,
    queue: std::collections::VecDeque<u32>,
}

impl Flood {
    /// Priority flood from the border (Barnes et al. 2014) whose queue is the
    /// cells presorted by height: a reached cell drains when the ascending
    /// sweep meets it; a cell reached below the current level is a pit and
    /// drains first, breadth-first from its spill. Levels drain in ascending
    /// order; equal levels in height-then-index order, pits in BFS order.
    /// With `flow`, also the split D-infinity drainage of every cell.
    fn compute(&mut self, h: &[f32], grid: &Grid, flow: Option<&mut Vec<FlowCell>>) {
        let len = h.len();
        reset(&mut self.filled, len, 0.0);
        reset(&mut self.receiver, len, NONE);
        reset(&mut self.state, len, 0);
        reset(&mut self.lower, len, 0);
        self.order.clear();
        self.order.reserve(len);
        sort_by_height(h, &[], &mut self.sorted, &mut self.keys, &mut self.spare);
        let (filled, receiver, state, queue, order, lower) = (
            &mut self.filled,
            &mut self.receiver,
            &mut self.state,
            &mut self.queue,
            &mut self.order,
            &mut self.lower,
        );
        for i in 0..len {
            if grid.borders[i] {
                state[i] = 1;
                filled[i] = h[i];
            }
        }
        queue.clear();
        let mut drain =
            |c: usize, state: &mut [u8], queue: &mut std::collections::VecDeque<u32>| {
                order.push(c as u32);
                state[c] = 2;
                let level = filled[c];
                let mut drained = 0;
                for (d, r) in grid.neighbors(c).into_iter().enumerate() {
                    if r == usize::MAX {
                        continue;
                    }
                    if state[r] != 0 {
                        drained |= ((state[r] == 2) as u8) << d;
                        continue;
                    }
                    state[r] = 1;
                    receiver[r] = c as u32;
                    // Topological rank already orders flats. A fixed 1 cm rise per cell
                    // creates artificial planar drainage on low-amplitude terrain.
                    if h[r] > level {
                        filled[r] = h[r];
                    } else {
                        filled[r] = level;
                        queue.push_back(r as u32);
                    }
                }
                lower[c] = drained;
            };
        for &c in &self.sorted {
            if state[c as usize] != 1 {
                continue;
            }
            drain(c as usize, state, queue);
            while let Some(q) = queue.pop_front() {
                drain(q as usize, state, queue);
            }
        }
        let (filled, lower) = (&self.filled, &self.lower);
        // The steepest already drained neighbour receives (D8), then the facets.
        let steepest = |c: usize, receiver: &mut u32, neighbors: &[usize; 8], lower: u32| {
            if *receiver == NONE {
                return;
            }
            let mut gradient = 0.0;
            for d in Bits(lower) {
                let r = neighbors[d];
                let fall = filled[c] as f64 - filled[r] as f64;
                // Division by an orthogonal unit step is exact: skip it.
                let drop = if d & 1 == 0 { fall } else { fall / SQRT_2 };
                if drop > gradient {
                    gradient = drop;
                    *receiver = r as u32;
                }
            }
        };
        match flow {
            None => crate::terrain_par::cells(&mut self.receiver, |c, receiver| {
                steepest(c, receiver, &grid.neighbors(c), lower[c] as u32);
            }),
            Some(flow) => {
                reset(flow, len, FlowCell::NONE);
                crate::terrain_par::cells2(&mut self.receiver, flow, |c, receiver, out| {
                    let neighbors = grid.neighbors(c);
                    let lower = lower[c] as u32;
                    steepest(c, receiver, &neighbors, lower);
                    *out = flow_cell(c, *receiver, filled, &neighbors, lower, grid);
                });
            }
        }
    }

    fn rank_order(&mut self) {
        reset(&mut self.rank, self.filled.len(), 0);
        for (k, &c) in self.order.iter().enumerate() {
            self.rank[c as usize] = k as u32;
        }
    }
}

fn reset<T: Copy>(values: &mut Vec<T>, len: usize, value: T) {
    values.clear();
    values.resize(len, value);
}

/// `order` = cells by ascending height (total order), ties by index: the order of
/// `sort_unstable_by(h total_cmp, then index)`, by a stable LSD radix sort.
fn sort_by_height(
    h: &[f32],
    only: &[u32],
    order: &mut Vec<u32>,
    keys: &mut Vec<(u32, u32)>,
    spare: &mut Vec<(u32, u32)>,
) {
    reset(keys, if only.is_empty() { h.len() } else { only.len() }, (0, 0));
    crate::terrain_par::cells(keys, |k, entry| {
        let i = if only.is_empty() { k } else { only[k] as usize };
        let bits = h[i].to_bits();
        let key = if bits & 0x8000_0000 != 0 {
            !bits
        } else {
            bits | 0x8000_0000
        };
        *entry = (key, i as u32);
    });
    crate::terrain_par::radix_sort(keys, spare);
    let sorted: &[(u32, u32)] = keys;
    reset(order, sorted.len(), 0);
    crate::terrain_par::cells(order, |k, cell| *cell = sorted[k].1);
}

#[derive(Clone, Copy)]
struct FlowCell {
    first: u32,
    second: u32,
    fraction: f32,
    distance: f32,
}

impl FlowCell {
    const NONE: Self = Self {
        first: NONE,
        second: NONE,
        fraction: 0.0,
        distance: 1.0,
    };
}

/// Ascending set bits of a direction mask.
struct Bits(u32);
impl Iterator for Bits {
    type Item = usize;
    #[inline(always)]
    fn next(&mut self) -> Option<usize> {
        (self.0 != 0).then(|| {
            let d = self.0.trailing_zeros() as usize;
            self.0 &= self.0 - 1;
            d
        })
    }
}

/// Directions (bit `d`) of the neighbours drained before `c`.
#[inline(always)]
fn drained_before(c: usize, neighbors: &[usize; 8], rank: &[u32]) -> u32 {
    let k = rank[c];
    let mut lower = 0;
    for (d, &r) in neighbors.iter().enumerate() {
        if r != usize::MAX && rank[r] < k {
            lower |= 1 << d;
        }
    }
    lower
}

// D8 steps as f64 (the facet algebra multiplies by them exactly as before).
const DX: [f64; 8] = [1.0, 1.0, 0.0, -1.0, -1.0, -1.0, 0.0, 1.0];
const DY: [f64; 8] = [0.0, 1.0, 1.0, 1.0, 0.0, -1.0, -1.0, -1.0];

/// D-infinity split of cell `c` towards the neighbours drained before it
/// (`lower`): the steepest facet, else the D8 receiver `r`.
#[inline]
fn flow_cell(
    c: usize,
    r: u32,
    filled: &[f32],
    neighbors: &[usize; 8],
    lower: u32,
    grid: &Grid,
) -> FlowCell {
    let mut out = FlowCell::NONE;
    out.first = r;
    if r == NONE {
        return out;
    }
    // Receivers are D8 neighbours: a diagonal one is neither ±1 nor ±n away.
    let step = c.abs_diff(r as usize);
    let distance = if step != 1 && step != grid.n {
        SQRT_2
    } else {
        1.0
    };
    let level = filled[c] as f64;
    let mut best = (level - filled[r as usize] as f64) / distance;
    out.distance = distance as f32;
    let mut pick = None;
    // `best` is exact (`hypot`) unless `rough` holds the facet whose
    // `sqrt(gx² + gy²)` estimate (≤ 2 ulp from `hypot`) it is.
    let mut rough: Option<(f64, f64)> = None;
    // Facet d spans directions d and d + 1, both drained before `c`.
    for d in Bits(lower & (lower >> 1 | lower << 7)) {
        let e = (d + 1) & 7;
        let (a, b) = (neighbors[d], neighbors[e]);
        let (ux, uy, vx, vy) = (DX[d], DY[d], DX[e], DY[e]);
        let da = level - filled[a] as f64;
        let db = level - filled[b] as f64;
        // Consecutive D8 steps span a unit determinant: no division needed.
        let gx = da * vy - db * uy;
        let gy = db * ux - da * vx;
        let ca = ux * gy - uy * gx;
        let cb = gx * vy - gy * vx;
        if ca < 0.0 || cb < 0.0 {
            continue;
        }
        // `hypot` is costly; its order against `best` is decided by the
        // estimate unless both lie within a relative 1e-12.
        let estimate = (gx * gx + gy * gy).sqrt();
        let (slope, exact) = if (estimate - best).abs() > 1e-12 * (estimate + best.abs()) {
            (estimate, false)
        } else {
            if let Some((bx, by)) = rough.take() {
                best = bx.hypot(by);
            }
            (gx.hypot(gy), true)
        };
        if slope <= best {
            continue;
        }
        best = slope;
        rough = (!exact).then_some((gx, gy));
        pick = Some((d, a, b, ca, ux * gx + uy * gy));
    }
    // Only the steepest facet's split angle is needed.
    if let Some((d, a, b, ca, along)) = pick {
        let t = (ca.atan2(along) / FRAC_PI_4).clamp(0.0, 1.0);
        out.first = a as u32;
        out.second = b as u32;
        out.fraction = t as f32;
        out.distance = ((1.0 - t) * DIST[d] + t * DIST[(d + 1) & 7]) as f32;
    }
    out
}

/// Split drainage of a flood whose receivers are already final.
fn continuous_flow(fl: &Flood, grid: &Grid, lively: &[bool], flow: &mut Vec<FlowCell>) {
    let (filled, rank, receiver) = (&fl.filled, &fl.rank, &fl.receiver);
    reset(flow, filled.len(), FlowCell::NONE);
    crate::terrain_par::cells(flow, |c, out| {
        if !is_lively(lively, c) {
            return;
        }
        let neighbors = grid.neighbors(c);
        let lower = drained_before(c, &neighbors, rank);
        *out = flow_cell(c, receiver[c], filled, &neighbors, lower, grid);
    });
}

/// Work buffers of the depression passes.
#[derive(Default)]
struct Basins {
    component: Vec<u32>,
    stack: Vec<u32>,
    cells: Vec<u32>,
    target: Vec<f32>,
}

impl Basins {
    /// Collects into `cells` (depth-first) the depression of `start`, when `start`
    /// is a still unvisited cell more than 5 cm under the flood level.
    fn collect(&mut self, start: usize, h: &[f32], fl: &Flood, grid: &Grid) -> bool {
        if self.component[start] != NONE || fl.filled[start] - h[start] <= 0.05 {
            return false;
        }
        let (component, stack, cells) = (&mut self.component, &mut self.stack, &mut self.cells);
        let id = start as u32;
        cells.clear();
        component[start] = id;
        stack.push(id);
        while let Some(c) = stack.pop() {
            cells.push(c);
            for r in grid.neighbors(c as usize) {
                if r != usize::MAX && component[r] == NONE && fl.filled[r] - h[r] > 0.05 {
                    component[r] = id;
                    stack.push(r as u32);
                }
            }
        }
        true
    }

    /// The collected cell draining out of depression `start` at the lowest level.
    fn pour(&self, start: usize, fl: &Flood) -> usize {
        let mut pour = usize::MAX;
        for &c in &self.cells {
            let c = c as usize;
            let r = fl.receiver[c];
            if r != NONE
                && self.component[r as usize] != start as u32
                && (pour == usize::MAX || fl.filled[c] < fl.filled[pour])
            {
                pour = c;
            }
        }
        pour
    }
}

fn resolve_pits(h: &mut [f32], fl: &Flood, grid: &Grid, frac: f64, basins: &mut Basins) -> usize {
    reset(&mut basins.component, h.len(), NONE);
    let mut resolved = 0;
    for start in 0..h.len() {
        if !basins.collect(start, h, fl, grid) {
            continue;
        }
        let pour = basins.pour(start, fl);
        if pour == usize::MAX {
            continue;
        }
        let spill = fl.filled[pour] as f64;
        for &c in &basins.cells {
            let c = c as usize;
            if (h[c] as f64) < spill {
                h[c] = (h[c] as f64 + frac * (spill - h[c] as f64)) as f32;
            }
        }
        // Sediment may fill a basin; never carve an arbitrary D8 chain through
        // its outlet. Physical surface erosion handles downhill incision later.
        resolved += 1;
    }
    resolved
}

/// Reproducible outlet phase, shared with WGSL. Only the phase depends on the grid; wavelengths are metres.
fn sill_phase(pour: u32) -> f32 {
    let hash = pour.wrapping_mul(747_796_405).wrapping_add(2_891_336_453);
    ((hash ^ (hash >> 16)) & 65_535) as f32 * (std::f32::consts::TAU / 65_536.0)
}

/// On gentle ground, D-infinity's constant fractional bearing still carves a ruled valley. Bend that bearing
/// over 1,000 / 430 metres (at most 36 degrees), choosing only already drained neighbours. Flat basin routing
/// and slopes >= 1 % keep their original pair. A rejected turn also keeps the pair: never climb a valley side
/// or introduce a routing cycle. Keep `sillFlow` in terrainErosion.wgsl identical.
fn sill_flow(c: usize, fl: &Flood, grid: &Grid, cell: f32, f: FlowCell, arc: f32, phase: f32) -> FlowCell {
    if f.first == NONE { return f; }
    let neighbors = grid.neighbors(c);
    let d = neighbors.iter().position(|&q| q == f.first as usize).unwrap();
    let slope = (fl.filled[c] - fl.filled[f.first as usize]) / (cell * DIST[d] as f32);
    if slope <= 0.0 || slope >= 0.01 { return f; }
    let wave = 0.7 * (std::f32::consts::TAU * arc / 1000.0 + phase).sin()
        + 0.3 * (std::f32::consts::TAU * arc / 430.0 + 2.0 * phase).sin();
    let bearing = (d as f32 + if f.second == NONE { 0.0 } else { f.fraction }
        + 0.8 * (1.0 - slope / 0.01) * wave).rem_euclid(8.0).min(7.999_999);
    let a = bearing.floor() as usize;
    let b = (a + 1) & 7;
    let mask = (1_u32 << a) | (1_u32 << b);
    if fl.lower[c] as u32 & mask != mask { return f; }
    let fraction = bearing - a as f32;
    FlowCell {
        first: neighbors[a] as u32, second: neighbors[b] as u32, fraction,
        distance: (1.0 - fraction) * DIST[a] as f32 + fraction * DIST[b] as f32,
    }
}

// Sill carving (Lindsay 2016, bounded): each depression's outlet sill and the
// reach below it are lowered towards a level `carve` of the way from the spill
// to the depression floor. The lake floor itself is never trenched; repeated
// over the evolution, incision, relaxation and diffusion widen the cut into a
// valley. Mirrors the GPU `breach` kernel.
// The reach descends at 1 % from that level but never under the depression's own
// floor (nor under 0.5 m): draining a basin needs no ground lower than its bed. A
// profile that kept descending cut, below every sill of a plain flatter than 1 %,
// a one-cell notch down to the sea, deepened at each iteration.
// Below the sill the reach follows the D-infinity pair with gentle winding (`sill_flow`):
// the second receiver's share accumulates and takes the step when it reaches a half.
// Without `flow`, or where a cell has no pair, the D8 receiver.
// The reach is three cells wide: the eight neighbours of each reach cell are lowered
// by its cut, down to its level at most. The erosion grid is resampled to the finer source grid afterwards; a cut
// one cell wide (with sides rising half a cell per cell) is filtered shallower than
// its sill there, and the basin closes again (hills 40 km: 0.05 % of the map under
// more than 1 m on the erosion grid, 4.95 % once resampled; 0.05 % for a cut three
// cells wide). The cut stays bounded by the depth of its basin.
fn carve_sills(
    h: &mut [f32],
    fl: &Flood,
    grid: &Grid,
    cell: f64,
    carve: f64,
    basins: &mut Basins,
    flow: Option<&[FlowCell]>,
) -> usize {
    if carve <= 0.0 {
        return 0;
    }
    reset(&mut basins.component, h.len(), NONE);
    let mut target = std::mem::take(&mut basins.target);
    reset(&mut target, h.len(), f32::INFINITY);
    let mut carved = 0;
    for start in 0..h.len() {
        if !basins.collect(start, h, fl, grid) {
            continue;
        }
        let mut bottom = f64::INFINITY;
        for &c in &basins.cells {
            bottom = bottom.min(h[c as usize] as f64);
        }
        let pour = basins.pour(start, fl);
        if pour == usize::MAX {
            continue;
        }
        let spill = fl.filled[pour] as f64;
        let floor = bottom.max(0.5);
        let mut level = (h[pour] as f64).min(spill - carve * (spill - bottom));
        // The outlet and the reach are cut to the profile itself: the spill then falls by `carve` of the basin
        // depth at each pass and the basin drains within the run. (A share of the gap to a profile that is itself a
        // share of the depth left the basins closed: about 1 % a pass.)
        target[pour] = target[pour].min(level as f32);
        let mut r = fl.receiver[pour];
        let mut turn = 0.0_f32;
        let mut arc = 0.0_f32;
        let phase = sill_phase(pour as u32);
        for _ in 0..400 {
            if r == NONE {
                break;
            }
            level = (level - 0.01 * cell).max(floor);
            let old = h[r as usize] as f64;
            if old <= level {
                break;
            }
            target[r as usize] = target[r as usize].min(level as f32);
            // Three cells wide: each of the eight neighbours is lowered by the cut of the reach cell, never under
            // its level, so no cell is cut deeper than the basin is deep and a hillside beside it keeps its shape.
            for &q in grid.neighbors(r as usize).iter() {
                if q != usize::MAX {
                    let side = (level.max(h[q] as f64 - (old - level))) as f32;
                    if side < target[q] {
                        target[q] = side;
                    }
                }
            }
            let from = r as usize;
            let pair = flow.map(|flow| sill_flow(from, fl, grid, cell as f32, flow[from], arc, phase));
            r = match pair {
                Some(f) if f.second != NONE => {
                    turn += f.fraction;
                    if turn >= 0.5 {
                        turn -= 1.0;
                        f.second
                    } else {
                        f.first
                    }
                }
                _ => fl.receiver[r as usize],
            };
            if r != NONE {
                let diagonal = from % grid.n != r as usize % grid.n && from / grid.n != r as usize / grid.n;
                arc += cell as f32 * if diagonal { std::f32::consts::SQRT_2 } else { 1.0 };
            }
        }
        carved += 1;
    }
    for (value, &t) in h.iter_mut().zip(&target) {
        *value = value.min(t);
    }
    basins.target = target;
    carved
}

/// Reusable buffers of the thermal and diffusion passes.
#[derive(Default)]
struct Relax {
    /// Per donor: (movement, total excess); total 0 when the cell gives nothing.
    donors: Vec<(f64, f64)>,
    next: Vec<f32>,
    delta: Vec<f64>,
    /// Cells the passes may change; empty means all (see [`lively_cells`]).
    lively: Vec<bool>,
}

#[inline(always)]
fn is_lively(lively: &[bool], c: usize) -> bool {
    lively.is_empty() || lively[c]
}

/// Strict descent leaves a uniform plateau untouched until a change reaches it: no
/// receiver, no thermal excess, and diffusion rounds back to the same float32. Each
/// iteration moves that front at most four cells (incision one, thermal two, diffusion
/// one). So cells more than `reach` from any relief never change, and sit outside the
/// routing of those that do: the open sea floor drops out of the kernels, with an
/// identical result. `None` when too little would drop out.
fn lively_cells(h: &[f32], grid: &Grid, reach: usize) -> Option<(Vec<bool>, Vec<u32>)> {
    const NEGATIVE_ZERO: u32 = 0x8000_0000;
    let (n, len) = (grid.n, h.len());
    let mut seeds = vec![false; len];
    let mut relief = 0;
    for (c, seed) in seeds.iter_mut().enumerate() {
        let bits = h[c].to_bits();
        // Thermal rewrites a negative zero as a zero: it is not inert.
        *seed = bits == NEGATIVE_ZERO
            || grid.neighbors(c).iter().any(|&r| r != usize::MAX && h[r].to_bits() != bits);
        relief += usize::from(*seed);
    }
    if relief * 4 > len * 3 {
        return None;
    }
    // Chebyshev dilation, rows then columns, in both directions.
    let mut near = vec![false; len];
    for row in 0..n {
        let line = row * n..(row + 1) * n;
        let mut gap = reach + 1;
        for c in line.clone() {
            gap = if seeds[c] { 0 } else { gap + 1 };
            near[c] = gap <= reach;
        }
        gap = reach + 1;
        for c in line.rev() {
            gap = if seeds[c] { 0 } else { gap + 1 };
            near[c] |= gap <= reach;
        }
    }
    let mut lively = vec![false; len];
    let mut gaps = vec![reach + 1; n];
    for c in 0..len {
        let gap = &mut gaps[c % n];
        *gap = if near[c] { 0 } else { *gap + 1 };
        lively[c] = *gap <= reach;
    }
    gaps.fill(reach + 1);
    for c in (0..len).rev() {
        let gap = &mut gaps[c % n];
        *gap = if near[c] { 0 } else { *gap + 1 };
        lively[c] |= *gap <= reach;
    }
    let cells: Vec<u32> = (0..len as u32).filter(|&c| lively[c as usize]).collect();
    (cells.len() * 4 <= len * 3).then_some((lively, cells))
}

// D8 directions by increasing neighbour index (-n-1, -n, -n+1, -1, +1, n-1, n, n+1),
// split around the cell itself: the order in which a serial scatter over donors
// in index order accumulates a cell's change.
const BEFORE: [usize; 4] = [5, 6, 7, 4];
const AFTER: [usize; 4] = [0, 3, 2, 1];

fn thermal(
    h: &mut [f32],
    grid: &Grid,
    cell: f64,
    talus: f64,
    passes: usize,
    rate: f64,
    work: &mut Relax,
) {
    if !crate::terrain_par::threaded() {
        return thermal_scatter(h, grid, cell, talus, passes, rate, &work.lively, &mut work.delta);
    }
    let len = h.len();
    for _ in 0..passes {
        reset(&mut work.donors, len, (0.0, 0.0));
        let heights: &[f32] = h;
        let lively: &[bool] = &work.lively;
        crate::terrain_par::cells(&mut work.donors, |i, donor| {
            if grid.borders[i] || !is_lively(lively, i) {
                return;
            }
            let neighbors = grid.neighbors(i);
            let (mut total, mut maximum) = (0.0_f64, 0.0_f64);
            for (d, &step) in DIST.iter().enumerate() {
                let drop = heights[i] as f64 - heights[neighbors[d]] as f64;
                let ds = cell * step;
                let excess = (drop - talus * ds).max(0.0);
                total += excess;
                maximum = maximum.max(excess);
            }
            if total > 0.0 {
                // Eight donors can meet at one cell; this bound avoids overshoot
                // and the new pits produced by a steepest-neighbor transfer.
                *donor = (rate * 0.125 * maximum, total);
            }
        });
        // Gather each cell's change in the serial scatter order (bit-identical sums).
        reset(&mut work.next, len, 0.0);
        let donors = &work.donors;
        crate::terrain_par::cells(&mut work.next, |i, out| {
            if !is_lively(lively, i) {
                *out = heights[i];
                return;
            }
            let neighbors = grid.neighbors(i);
            let mut delta = 0.0_f64;
            let gather = |delta: &mut f64, d: usize| {
                let j = neighbors[d];
                if j == usize::MAX {
                    return;
                }
                let (movement, total) = donors[j];
                if total > 0.0 {
                    let drop = heights[j] as f64 - heights[i] as f64;
                    let ds = cell * DIST[d];
                    let weight = (drop - talus * ds).max(0.0);
                    if weight > 0.0 {
                        *delta += movement * weight / total;
                    }
                }
            };
            for d in BEFORE {
                gather(&mut delta, d);
            }
            if donors[i].1 > 0.0 {
                delta -= donors[i].0;
            }
            for d in AFTER {
                gather(&mut delta, d);
            }
            *out = (heights[i] as f64 + delta) as f32;
        });
        h.copy_from_slice(&work.next);
    }
}

/// Serial formulation of [`thermal`]: each donor scatters its share in index order.
fn thermal_scatter(
    h: &mut [f32],
    grid: &Grid,
    cell: f64,
    talus: f64,
    passes: usize,
    rate: f64,
    lively: &[bool],
    delta: &mut Vec<f64>,
) {
    for _ in 0..passes {
        reset(delta, h.len(), 0.0);
        for i in 0..h.len() {
            if grid.borders[i] || !is_lively(lively, i) {
                continue;
            }
            let neighbors = grid.neighbors(i);
            let mut excess = [0.0_f64; 8];
            let (mut total, mut maximum) = (0.0_f64, 0.0_f64);
            for (d, &step) in DIST.iter().enumerate() {
                let drop = h[i] as f64 - h[neighbors[d]] as f64;
                let ds = cell * step;
                excess[d] = (drop - talus * ds).max(0.0);
                total += excess[d];
                maximum = maximum.max(excess[d]);
            }
            if total > 0.0 {
                let movement = rate * 0.125 * maximum;
                delta[i] -= movement;
                for (d, &weight) in excess.iter().enumerate() {
                    if weight > 0.0 {
                        delta[neighbors[d]] += movement * weight / total;
                    }
                }
            }
        }
        for (value, change) in h.iter_mut().zip(delta.iter()) {
            *value = (*value as f64 + change) as f32;
        }
    }
}

fn diffuse(h: &mut [f32], n: usize, channels: &[bool], strength: f64, work: &mut Relax) {
    work.next.clear();
    work.next.extend_from_slice(h);
    let (previous, lively) = (&work.next, &work.lively);
    crate::terrain_par::rows(h, n, |y, row| {
        if y == 0 || y == n - 1 {
            return;
        }
        for x in 1..n - 1 {
            let i = y * n + x;
            if !is_lively(lively, i) {
                continue;
            }
            let weight = strength
                * if channels.get(i).copied().unwrap_or(false) {
                    0.75
                } else {
                    1.0
                };
            let average = (previous[i - 1] as f64
                + previous[i + 1] as f64
                + previous[i - n] as f64
                + previous[i + n] as f64)
                * 0.2
                + (previous[i - n - 1] as f64
                    + previous[i - n + 1] as f64
                    + previous[i + n - 1] as f64
                    + previous[i + n + 1] as f64)
                    * 0.05;
            row[x] = ((1.0 - weight) * previous[i] as f64 + weight * average) as f32;
        }
    });
}

fn sample(h: &[f32], n: usize, fx: f64, fy: f64, cubic: bool) -> f64 {
    let x = fx.floor() as isize;
    let y = fy.floor() as isize;
    let tx = fx - x as f64;
    let ty = fy - y as f64;
    let last = n as isize - 1;
    let col = |dx: isize| (x + dx).clamp(0, last) as usize;
    let row = |dy: isize| (y + dy).clamp(0, last) as usize * n;
    if !cubic {
        let (r0, r1, c0, c1) = (row(0), row(1), col(0), col(1));
        return (h[r0 + c0] as f64 * (1.0 - tx) + h[r0 + c1] as f64 * tx) * (1.0 - ty)
            + (h[r1 + c0] as f64 * (1.0 - tx) + h[r1 + c1] as f64 * tx) * ty;
    }
    let interpolate = |a: f64, b: f64, c: f64, d: f64, t: f64| {
        b + 0.5 * t * (c - a + t * (2.0 * a - 5.0 * b + 4.0 * c - d + t * (3.0 * (b - c) + d - a)))
    };
    let cols = [col(-1), col(0), col(1), col(2)];
    let mut rows = [0.0; 4];
    let (mut lo, mut hi) = (f64::INFINITY, f64::NEG_INFINITY);
    for (k, dy) in (-1..=2).enumerate() {
        let base = row(dy);
        let v = cols.map(|c| h[base + c] as f64);
        rows[k] = interpolate(v[0], v[1], v[2], v[3], tx);
        for value in v {
            lo = lo.min(value);
            hi = hi.max(value);
        }
    }
    interpolate(rows[0], rows[1], rows[2], rows[3], ty).clamp(lo, hi)
}

/// Reusable buffers of one erosion run.
#[derive(Default)]
struct Work {
    flood: Flood,
    flow: Vec<FlowCell>,
    basins: Basins,
    relax: Relax,
    baseline: Vec<f32>,
}

/// Split drainage area, downstream from the highest cell (f64 sums).
fn accumulate_f64(acc: &mut [f32], order: &[u32], flow: &[FlowCell]) {
    acc.fill(1.0);
    for &c in order.iter().rev() {
        let f = flow[c as usize];
        let t = f.fraction as f64;
        let value = acc[c as usize] as f64;
        if f.first != NONE {
            let r = f.first as usize;
            acc[r] = (acc[r] as f64 + value * (1.0 - t)) as f32;
        }
        if f.second != NONE {
            let s = f.second as usize;
            acc[s] = (acc[s] as f64 + value * t) as f32;
        }
    }
}

/// Split drainage area, downstream from the highest cell (f32 sums).
fn accumulate_f32(acc: &mut [f32], order: &[u32], flow: &[FlowCell]) {
    acc.fill(1.0);
    for &c in order.iter().rev() {
        let f = flow[c as usize];
        let value = acc[c as usize];
        if f.first != NONE {
            acc[f.first as usize] += value * (1.0 - f.fraction);
        }
        if f.second != NONE {
            acc[f.second as usize] += value * f.fraction;
        }
    }
}

/// Implicit stream-power step along `order` (receivers first). The slope comes
/// from the heights before the pass; `factor(cell, slope, distance)` is the
/// relief's incision response.
fn incise(
    h: &mut [f32],
    order: &[u32],
    flow: &[FlowCell],
    baseline: &mut Vec<f32>,
    borders: Option<&[bool]>,
    cell: f64,
    factor: impl Fn(usize, f64, f64) -> f64,
) {
    baseline.clear();
    baseline.extend_from_slice(h);
    for &c in order {
        let c = c as usize;
        let f = flow[c];
        if f.first == NONE || borders.is_some_and(|b| b[c]) {
            continue;
        }
        let (r, t) = (f.first as usize, f.fraction as f64);
        let (lower, original_lower) = if f.second == NONE {
            (h[r] as f64, baseline[r] as f64)
        } else {
            let s = f.second as usize;
            (
                (1.0 - t) * h[r] as f64 + t * h[s] as f64,
                (1.0 - t) * baseline[r] as f64 + t * baseline[s] as f64,
            )
        };
        let distance = f.distance as f64;
        let slope = ((baseline[c] as f64 - original_lower) / (cell * distance)).max(0.0);
        let factor = factor(c, slope, distance);
        h[c] = (h[c] as f64).min((h[c] as f64 + factor * lower) / (1.0 + factor)) as f32;
    }
}

pub(crate) struct MountainCfg<'a> {
    pub zoning: Option<(&'a crate::TerrainZones, crate::Relief)>,
    pub n: usize,
    pub width: f64,
    pub amp: f64,
    pub generation_noise: Option<&'a crate::GenerationNoise<'a>>,
    pub noise: &'a Noise,
    pub noise2: &'a Noise,
    pub down: (f64, f64),
    pub k: f64,
    pub iterations: usize,
    pub coarse: usize,
    pub mountain_mix: f64,
    pub talus: f64,
    pub detail: f64,
    pub diffusion: f64,
    pub crest: f64,
    pub valley: Option<(f64, f64, f64)>,
    pub erosion: f64,
}

/// Zone-derived parameters at one position of the zoned generator.
#[derive(Clone, Copy)]
struct ZoneLocal {
    amplitude: f64,
    mix: f64,
    crest: f64,
    detail: f64,
    /// Painted (non-automatic) share.
    painted: f64,
    /// Local relief scale over the motif, in (0, 1]: below 1 near narrow massifs.
    kratio: f64,
    /// Amplitude factor of the painted massif shares (local size and dome).
    massif_form: f64,
    /// Amplitude factor of the hill share (core size of the neighbouring massif).
    hill_form: f64,
    /// Weight of the narrow-massif rules, 0 when the local scale is at least
    /// `NARROW_FROM` of the motif (wide massifs and plain relief keep their rules).
    narrow: f64,
}

/// Local scale ratio under which a painted massif counts as narrow.
const NARROW_FROM: f64 = 0.45;
/// Final-units flank bound of narrow painted massifs (tan 38 degrees): the raw talus
/// acts before the zone scaling, so it cannot bound the final flank of a narrow band.
const NARROW_TALUS: f64 = 0.78;
const NARROW_PASSES: usize = 64;

/// Mass-conserving talus relaxation in final metres, weighted per cell (0 = untouched).
pub(crate) fn limit_slopes(h: &mut [f32], n: usize, cell: f64, weight: &[f32]) {
    if n < 3 || weight.iter().all(|&w| w <= 0.0) {
        return;
    }
    // Only the broad flank is bounded: spurs and ravines (the detail under a
    // two-pass box blur of radius 3 cells) ride on it unchanged.
    let low = box_blur(&box_blur(h, n, 3), n, 3);
    let mut relaxed = low.clone();
    relax_slopes(&mut relaxed, n, cell, weight);
    for ((value, &before), &after) in h.iter_mut().zip(&low).zip(&relaxed) {
        *value = (*value as f64 + after as f64 - before as f64) as f32;
    }
}

/// Separable box blur with clamped edges.
fn box_blur(h: &[f32], n: usize, radius: usize) -> Vec<f32> {
    let r = radius as isize;
    let last = n as isize - 1;
    let mut rows = vec![0.0_f32; n * n];
    for y in 0..n {
        for x in 0..n {
            let sum: f64 = (-r..=r)
                .map(|d| h[y * n + (x as isize + d).clamp(0, last) as usize] as f64)
                .sum();
            rows[y * n + x] = (sum / (2 * r + 1) as f64) as f32;
        }
    }
    let mut out = vec![0.0_f32; n * n];
    for y in 0..n {
        for x in 0..n {
            let sum: f64 = (-r..=r)
                .map(|d| rows[(y as isize + d).clamp(0, last) as usize * n + x] as f64)
                .sum();
            out[y * n + x] = (sum / (2 * r + 1) as f64) as f32;
        }
    }
    out
}

/// Weighted talus relaxation of `h` in final metres (mass-conserving).
fn relax_slopes(h: &mut [f32], n: usize, cell: f64, weight: &[f32]) {
    const STEPS: [(isize, isize, f64); 8] = [
        (-1, -1, SQRT_2),
        (0, -1, 1.0),
        (1, -1, SQRT_2),
        (-1, 0, 1.0),
        (1, 0, 1.0),
        (-1, 1, SQRT_2),
        (0, 1, 1.0),
        (1, 1, SQRT_2),
    ];
    let mut delta = vec![0.0_f64; n * n];
    for _ in 0..NARROW_PASSES {
        delta.iter_mut().for_each(|d| *d = 0.0);
        let mut moved_any = false;
        for y in 1..n - 1 {
            for x in 1..n - 1 {
                let i = y * n + x;
                let w = weight[i] as f64;
                if w <= 0.0 {
                    continue;
                }
                let mut excess = [0.0_f64; 8];
                let (mut total, mut maximum) = (0.0_f64, 0.0_f64);
                for (d, &(dx, dy, dist)) in STEPS.iter().enumerate() {
                    let j = (y as isize + dy) as usize * n + (x as isize + dx) as usize;
                    let e = (h[i] as f64 - h[j] as f64 - NARROW_TALUS * cell * dist).max(0.0);
                    excess[d] = e;
                    total += e;
                    maximum = maximum.max(e);
                }
                if total <= 0.0 {
                    continue;
                }
                // Eight donors can meet at one cell: an eighth of the largest excess.
                let moved = w * 0.125 * maximum;
                delta[i] -= moved;
                for (d, &(dx, dy, _)) in STEPS.iter().enumerate() {
                    if excess[d] > 0.0 {
                        let j = (y as isize + dy) as usize * n + (x as isize + dx) as usize;
                        delta[j] += moved * excess[d] / total;
                    }
                }
                moved_any = true;
            }
        }
        if !moved_any {
            break;
        }
        for (value, change) in h.iter_mut().zip(&delta) {
            *value = (*value as f64 + change) as f32;
        }
    }
}

impl ZoneLocal {
    /// Amplitude factor of zone channel `k` (partition index, 0 = automatic).
    fn form(&self, k: usize) -> f64 {
        match k {
            3 => self.hill_form,
            4 | 5 => self.massif_form,
            _ => 1.0,
        }
    }
}

/// Noise at `wavelength * ratio` without the stretching of `noise(p / wavelength(p))`:
/// the two octave-spaced wavelengths that bracket it are blended. `ratio >= 1` is the
/// plain evaluation, so unscaled relief is unchanged.
fn octave_blend(ratio: f64, wavelength: f64, eval: impl Fn(f64) -> f64) -> f64 {
    if ratio >= 0.999 {
        return eval(wavelength);
    }
    let j = -ratio.max(1e-3).log2();
    let j0 = j.floor();
    let t = j - j0;
    let a = eval(wavelength * 0.5_f64.powf(j0));
    if t < 1e-3 {
        return a;
    }
    a * (1.0 - t) + eval(wavelength * 0.5_f64.powf(j0 + 1.0)) * t
}

pub(crate) fn mountain(cfg: &MountainCfg<'_>) -> Vec<f32> {
    let profiles = cfg.zoning.map(|(_, fallback)| {
        [
            fallback,
            crate::Relief::Flat,
            crate::Relief::Flat,
            crate::Relief::Hills,
            crate::Relief::Mountains,
            crate::Relief::HighMountains,
        ]
        .map(|kind| {
            let p = crate::mountain_parameters(kind, cfg.width, cfg.k * 2400.0, cfg.mountain_mix);
            (
                p.amp / cfg.amp,
                if kind == crate::Relief::Flat {
                    0.0
                } else {
                    p.mountain_mix
                },
                p.crest,
                p.detail,
            )
        })
    });
    let n = cfg.n;
    let nc = cfg.coarse;
    let count = nc * nc;
    let grid = Grid::new(nc);
    let extent = cfg.width * 1.44;
    let cc = extent / nc as f64;
    let cell = cfg.width / n as f64;
    let x0 = -cfg.width * 0.22;
    let motif = cfg.k * 2400.0;
    // Painted massifs get a relief sized to what was painted: a dome across their
    // width (highest inside, draining outward) and, when narrow, a smaller local
    // scale (amplitude, ridge and valley spacing, incision). The finest scale keeps
    // the initial relief wavelength (415 m per 2400 m of motif) above four cells.
    let shape = cfg.zoning.map(|(zones, _)| {
        crate::terrain_zones::ReliefShape::new(zones, cfg.width, motif, cc * 4.0 * 2400.0 / 415.0)
    });
    // `(dx, dy)` shifts the dome sampling only (a wandering crest); the zone shares
    // and scales stay where they were painted.
    let local_shifted = |x: f64, y: f64, dx: f64, dy: f64| -> ZoneLocal {
        if let (Some((zones, _)), Some(profiles), Some(shape)) = (cfg.zoning, &profiles, &shape) {
            let weights = zones.sample(x / cfg.width, y / cfg.width);
            let kratio = (shape.at(x, y).2 / motif).clamp(1e-3, 1.0);
            let core = (shape.core_scale(x, y) / motif).clamp(1e-3, 1.0);
            // Narrow is a property of the whole massif, not of the local width at its tips.
            let whole = (shape.wide_scale(x, y) / motif).clamp(1e-3, 1.0);
            let narrow = smooth((NARROW_FROM - whole) / 0.25);
            // Amplitude falls slower than the wavelength (square root of the scale
            // ratio): a narrow painted band stays a mountain. On narrow massifs the
            // exponent rises to 0.65 so that its flanks stay mountain flanks.
            let mut out = ZoneLocal {
                amplitude: 0.0,
                mix: 0.0,
                crest: 0.0,
                detail: 0.0,
                painted: 1.0 - weights[0],
                kratio,
                massif_form: kratio.powf(0.5 + 0.15 * narrow) * shape.dome(x + dx, y + dy),
                hill_form: core.sqrt(),
                narrow,
            };
            for (i, w) in weights.into_iter().enumerate() {
                let form = out.form(i);
                out.amplitude += w * profiles[i].0 * form;
                out.mix += w * profiles[i].1;
                out.crest += w * profiles[i].2;
                out.detail += w * profiles[i].3;
            }
            out
        } else {
            ZoneLocal {
                amplitude: 1.0,
                mix: cfg.mountain_mix,
                crest: cfg.crest,
                detail: cfg.detail,
                painted: 0.0,
                kratio: 1.0,
                massif_form: 1.0,
                hill_form: 1.0,
                narrow: 0.0,
            }
        }
    };
    let local = |x: f64, y: f64| local_shifted(x, y, 0.0, 0.0);
    // Incision scale per coarse cell: 1 / kratio on wide massifs (the motif law),
    // 1 / sqrt(kratio) on narrow ones (a full 1 / kratio cut one parallel ravine per cell).
    let mut incision_ratio = vec![1.0_f32; count];
    let mut uplift = vec![0.0_f32; count];
    let mut h = vec![0.0_f32; count];
    for y in 0..nc {
        for x in 0..nc {
            let px = x0 + (x as f64 + 0.5) * cc;
            let py = x0 + (y as f64 + 0.5) * cc;
            let first = local(px, py);
            // A narrow massif's crest wanders (about +-90 m on an 800 m band) inside the
            // painted band: only its dome is shifted, at the feature's own scale.
            let zone = if first.narrow > 0.0 {
                let reach = 0.15 * first.narrow * first.kratio * motif;
                let base = 0.8 * motif;
                let dx = reach
                    * octave_blend(first.kratio, base, |w| cfg.noise.fbm(px / w + 13.1, py / w - 7.7, 2));
                let dy = reach
                    * octave_blend(first.kratio, base, |w| cfg.noise.fbm(px / w - 2.3, py / w + 9.4, 2));
                local_shifted(px, py, dx, dy)
            } else {
                first
            };
            let (amplitude, mix, crest, painted) = (zone.amplitude, zone.mix, zone.crest, zone.painted);
            let narrow = zone.narrow;
            incision_ratio[y * nc + x] = zone.kratio.powf(1.0 - 0.5 * narrow) as f32;
            let env_wavelength = (1900.0 * cfg.k).max(cc * 4.0);
            let initial_wavelength = (415.0 * cfg.k).max(cc * 4.0);
            let coarse_noise = cfg.generation_noise.filter(|v| !v.coarse.is_empty());
            let env = coarse_noise.map_or_else(
                || {
                    cfg.noise
                        .fbm(px / env_wavelength + 3.1, py / env_wavelength - 1.7, 3)
                },
                |v| v.coarse[(y * nc + x) * 4] as f64,
            );
            let q = ((px - cfg.width * 0.5) * cfg.down.0 + (py - cfg.width * 0.5) * cfg.down.1)
                / cfg.width;
            let edge = x.min(y).min(nc - 1 - x).min(nc - 1 - y) as f64 / (0.1 * nc as f64);
            // Broad regions vary uplift continuously between hills and mountain ranges.
            let distribution = coarse_noise.map_or_else(
                || {
                    cfg.noise2
                        .fbm(px / (2700.0 * cfg.k) + 8.4, py / (2700.0 * cfg.k), 3)
                },
                |v| v.coarse[(y * nc + x) * 4 + 1] as f64,
            );
            // Map- and motif-scale terms (regional distribution, envelope, tilt) fade
            // out on narrow massifs: their cross-profile is the symmetric dome only.
            let mountains = smooth((distribution + (mix - 0.5) * 1.4 + 0.28) / 0.56);
            let mountains = mountains + (1.0 - mountains) * narrow;
            // A painted zone asks for its relief everywhere it was painted: regional
            // noise only modulates it, it must not sink part of a range to a plain.
            let regional_amp =
                (0.20 + 0.80 * mountains) * (1.0 - painted) + (0.72 + 0.28 * mountains) * painted;
            let ridge = if crest > 0.0 {
                coarse_noise.map_or_else(
                    || {
                        octave_blend(
                            (env_wavelength * zone.kratio).max(cc * 4.0) / env_wavelength,
                            env_wavelength,
                            |w| cfg.noise2.ridged(px / w + 5.7, py / w - 3.2, 3),
                        )
                    },
                    |v| v.coarse[(y * nc + x) * 4 + 3] as f64,
                )
            } else {
                0.0
            };
            // Ridge skeleton belongs to the main uplift, not a texture painted
            // after erosion. Hills and canyon uplands keep their smoother forms.
            let skeleton = 1.0 + crest * mountains * ((0.24 + 1.8 * ridge * ridge) - 1.0);
            let base_uplift = if narrow > 0.0 {
                (0.7 + (0.5 * env - 0.25 * q) * (1.0 - narrow)).max(0.12)
            } else {
                // Unchanged expression: wide massifs and unpainted relief stay bit-identical.
                (0.7 + 0.5 * env - 0.25 * q).max(0.12)
            };
            let u = base_uplift
                * regional_amp
                * skeleton
                * amplitude;
            // Stronger initial relief on narrow massifs: spurs and side valleys a few
            // hundred metres apart organise the drainage instead of parallel gullies.
            let spurs = 1.0 + narrow * ((1.0 / zone.kratio.sqrt()).min(2.0) - 1.0);
            let mut corridor = 1.0;
            if let Some((width, offset, noise_offset)) = cfg.valley.filter(|_| cfg.zoning.is_none())
            {
                let along = q * cfg.width;
                let across =
                    -(px - cfg.width * 0.5) * cfg.down.1 + (py - cfg.width * 0.5) * cfg.down.0;
                let meander = 320.0
                    * cfg.k
                    * cfg
                        .noise
                        .fbm((along + noise_offset) / (2600.0 * cfg.k), 0.37, 2)
                    + 120.0
                        * cfg.k
                        * cfg
                            .noise
                            .fbm((along + noise_offset) / (900.0 * cfg.k), 5.1, 2);
                let floor = width * (0.8 + 0.4 * cfg.noise2.fbm(along / (1500.0 * cfg.k), 3.3, 2));
                let wall = smooth(((across - offset + meander).abs() - floor) / (cfg.width * 0.42));
                corridor = 0.055 + 0.945 * wall.powf(1.25);
            }
            uplift[y * nc + x] = (u * corridor * (0.25 + 0.75 * smooth(edge))) as f32;
            h[y * nc + x] = (corridor
                * (2.5 * u
                    + 0.6
                        * amplitude
                        * spurs
                        * coarse_noise.map_or_else(
                            || {
                                octave_blend(
                                    (initial_wavelength * zone.kratio).max(cc * 4.0)
                                        / initial_wavelength,
                                    initial_wavelength,
                                    |w| cfg.noise2.fbm(px / w, py / w, 3),
                                )
                            },
                            |v| v.coarse[(y * nc + x) * 4 + 2] as f64,
                        ))) as f32;
        }
    }
    for (i, value) in h.iter_mut().enumerate() {
        if grid.borders[i] {
            *value = 0.0;
        }
    }
    let uplift_step = cfg.amp * 1.25 / cfg.iterations as f64;
    let strength = erosion_strength(cfg.erosion);
    let incision = tuning(INCISION) * strength * cc / (0.004_f64.sqrt() * cfg.k * 2400.0);
    let threshold = tuning(INCISION_SLOPE).powi(2);
    let thermal_rate = tuning(THERMAL) * strength * 0.8;
    let catchment_cap = 4.0 * 0.004_f64.sqrt() * cfg.k * 2400.0 / cc;
    let mut acc = vec![1.0_f32; count];
    let mut channels = vec![false; count];
    let fill = (tuning(FILL) * strength * 0.6).min(0.6);
    let (carve, final_fill, final_carve) = (
        tuning(CARVE),
        tuning(FILL) * strength * 0.5,
        tuning(FINAL_CARVE),
    );
    let mut work = Work::default();
    for _ in 0..cfg.iterations {
        for i in 0..count {
            if !grid.borders[i] {
                h[i] = (h[i] as f64 + uplift[i] as f64 * uplift_step) as f32;
            }
        }
        if cfg.erosion > 0.0 {
            work.flood.compute(&h, &grid, Some(&mut work.flow));
            resolve_pits(&mut h, &work.flood, &grid, fill, &mut work.basins);
            carve_sills(&mut h, &work.flood, &grid, cc, carve, &mut work.basins, Some(work.flow.as_slice()));
            accumulate_f64(&mut acc, &work.flood.order, &work.flow);
            let acc = &acc;
            let incision_ratio = &incision_ratio;
            incise(
                &mut h,
                &work.flood.order,
                &work.flow,
                &mut work.baseline,
                None,
                cc,
                |c, slope, distance| {
                    // A flood potential routes water across sinks; it must not cut a
                    // physical channel across a flat or uphill saddle in that potential.
                    let response = slope * slope / (slope * slope + threshold);
                    // Incision and catchment cap follow the local relief scale, as they
                    // follow the motif (both are 1 outside painted massifs).
                    let r = incision_ratio[c] as f64;
                    (incision / r * (acc[c] as f64).sqrt().min(catchment_cap * r) * response
                        / distance)
                        .min(6.0)
                },
            );
            thermal(
                &mut h,
                &grid,
                cc,
                cfg.talus,
                3,
                thermal_rate,
                &mut work.relax,
            );
            for i in 0..count {
                channels[i] = acc[i] as f64 >= count as f64 * 0.001;
            }
            let diffusion = cfg.diffusion * 3.0 * strength;
            for _ in 0..diffusion.floor() as usize {
                diffuse(&mut h, nc, &channels, 0.5, &mut work.relax);
            }
            if diffusion.fract() > 0.0 {
                diffuse(
                    &mut h,
                    nc,
                    &channels,
                    0.5 * diffusion.fract(),
                    &mut work.relax,
                );
            }
        }
        for (i, value) in h.iter_mut().enumerate() {
            if grid.borders[i] {
                *value = 0.0;
            }
        }
    }
    for value in &mut h {
        *value = value.max(0.0);
    }
    if cfg.erosion > 0.0 {
        thermal(
            &mut h,
            &grid,
            cc,
            cfg.talus * 0.95,
            4,
            thermal_rate,
            &mut work.relax,
        );
        for _ in 0..2 {
            // With the split drainage: the sill reach follows it (`carve_sills`).
            work.flood.compute(&h, &grid, Some(&mut work.flow));
            if resolve_pits(&mut h, &work.flood, &grid, final_fill, &mut work.basins) == 0 {
                break;
            }
            carve_sills(
                &mut h,
                &work.flood,
                &grid,
                cc,
                final_carve,
                &mut work.basins,
                Some(work.flow.as_slice()),
            );
        }
        diffuse(&mut h, nc, &channels, strength * 0.5, &mut work.relax);
    }
    let mut output = vec![0.0_f32; n * n];
    let mut drainage_weight = vec![0.0_f64; n * n];
    let mut samples = Vec::with_capacity(n * n / 16 + 1);
    for y in 0..n {
        for x in 0..n {
            let px = (x as f64 + 0.5) * cell;
            let py = (y as f64 + 0.5) * cell;
            let drainage = sample(&acc, nc, (px - x0) / cc - 0.5, (py - x0) / cc - 0.5, false);
            let local_ratio = shape
                .as_ref()
                .map_or(1.0, |s| (s.at(px, py).2 / motif).clamp(1e-3, 1.0));
            let warp = tuning(WARP) * (16.0 * cfg.k * local_ratio).min(cc * 0.9);
            let warp_wavelength = (110.0 * cfg.k).max(cc * 4.0);
            let wx = px
                + warp
                    * cfg.generation_noise.map_or_else(
                        || {
                            cfg.noise2
                                .fbm(px / warp_wavelength + 11.3, py / warp_wavelength, 2)
                        },
                        |v| v.fine[(y * n + x) * 4] as f64,
                    );
            let wy = py
                + warp
                    * cfg.generation_noise.map_or_else(
                        || {
                            cfg.noise2.fbm(
                                px / warp_wavelength - 4.7,
                                py / warp_wavelength + 2.9,
                                2,
                            )
                        },
                        |v| v.fine[(y * n + x) * 4 + 1] as f64,
                    );
            let i = y * n + x;
            drainage_weight[i] = 1.0
                - 0.85
                    * strength
                    * smooth((drainage - 4.0) / (count as f64 * 0.001 - 4.0).max(12.0));
            output[i] = sample(&h, nc, (wx - x0) / cc - 0.5, (wy - x0) / cc - 0.5, true) as f32;
            if (x + y * 7) & 15 == 0 {
                samples.push(output[i]);
            }
        }
    }
    // Normalize within the strongest occupied regime. A tiny mountain mask must
    // not be amplified against the 99th percentile of a mostly flat map.
    let mut occupied_amplitude = 1.0_f64;
    if cfg.zoning.is_some() {
        let candidates: Vec<(f32, f64)> = output
            .iter()
            .enumerate()
            .filter(|(i, _)| (i % n + i / n * 7) & 15 == 0)
            .map(|(i, &h)| {
                (
                    h,
                    local(
                        (i % n) as f64 * cell + cell * 0.5,
                        (i / n) as f64 * cell + cell * 0.5,
                    )
                    .amplitude,
                )
            })
            .collect();
        occupied_amplitude = candidates
            .iter()
            .map(|v| v.1)
            .fold(0.0_f64, f64::max)
            .max(1e-6);
        samples = candidates
            .into_iter()
            .filter(|v| v.1 >= occupied_amplitude * 0.5)
            .map(|v| v.0)
            .collect();
    }
    samples.sort_unstable_by(f32::total_cmp);
    let p99 = samples[(samples.len() as f64 * 0.99).floor() as usize].max(0.0001) as f64;
    // Keep a legible relief at the endpoint instead of erasing it with runaway incision.
    let worn_amplitude = cfg.amp * occupied_amplitude * (1.0 - 0.2 * strength);
    let scale = worn_amplitude / p99;
    // Each painted zone reaches its own relief family's amplitude: erosion saturates
    // strong uplift (talus), so one global scale left hills and plains far too low or
    // too rough next to a painted massif. The scale varies with the smooth zone
    // shares, so it adds no step at a border.
    // The target is the zone's own expected amplitude: its family scaled by its own
    // form (painted size, dome), never the neighbouring shares mixed into the cell.
    let zone_scale: Option<[f64; 6]> = cfg.zoning.zip(profiles.as_ref()).map(|((zones, _), profiles)| {
        let mut buckets: [Vec<f32>; 6] = Default::default();
        let mut expected: [Vec<f64>; 6] = Default::default();
        for (i, &h) in output.iter().enumerate().filter(|(i, _)| (i % n + i / n * 7) & 7 == 0) {
            let (px, py) = (((i % n) as f64 + 0.5) * cell, ((i / n) as f64 + 0.5) * cell);
            let w = zones.sample(px / cfg.width, py / cfg.width);
            let zone = local(px, py);
            for k in 0..6 {
                if w[k] >= 0.6 {
                    buckets[k].push(h);
                    expected[k].push(profiles[k].0 * zone.form(k));
                }
            }
        }
        let wear = 1.0 - 0.2 * strength;
        std::array::from_fn(|k| {
            let b = &mut buckets[k];
            if b.len() < 24 {
                return scale;
            }
            b.sort_unstable_by(f32::total_cmp);
            expected[k].sort_unstable_by(f64::total_cmp);
            let p = b[((b.len() - 1) as f64 * 0.99) as usize].max(0.0001) as f64;
            let target = expected[k][((expected[k].len() - 1) as f64 * 0.99) as usize];
            (cfg.amp * target * wear / p).clamp(scale * 0.2, scale * 4.0)
        })
    });
    let scale_at = |x: usize, y: usize| -> f64 {
        match (zone_scale, cfg.zoning) {
            (Some(z), Some((zones, _))) => {
                let w = zones.sample((x as f64 + 0.5) / n as f64, (y as f64 + 0.5) / n as f64);
                (0..6).map(|k| w[k] * z[k]).sum()
            }
            _ => scale,
        }
    };
    let slopes = output.clone();
    let mut narrow_weight = vec![0.0_f32; n * n];
    let wavelength = (cell * 6.0).max(260.0 * cfg.k);
    let octaves = (wavelength / (cell * 4.0)).log2().round().clamp(1.0, 6.0) as usize;
    for y in 0..n {
        for x in 0..n {
            let i = y * n + x;
            let scale = scale_at(x, y);
            let gx = slopes[y * n + (x + 1).min(n - 1)] as f64
                - slopes[y * n + x.saturating_sub(1)] as f64;
            let gy = slopes[(y + 1).min(n - 1) * n + x] as f64
                - slopes[y.saturating_sub(1) * n + x] as f64;
            let slope = gx.hypot(gy) * scale / (2.0 * cell);
            let factor = smooth((slope - 0.015) / 0.3) * drainage_weight[i];
            let px = (x as f64 + 0.5) * cell;
            let py = (y as f64 + 0.5) * cell;
            let zone = local(px, py);
            let detail = cfg.generation_noise.map_or_else(
                || {
                    let ratio = (260.0 * cfg.k * zone.kratio).max(cell * 6.0) / wavelength;
                    octave_blend(ratio, wavelength, |w| {
                        let octaves = if ratio >= 0.999 {
                            octaves
                        } else {
                            (w / (cell * 4.0)).log2().round().clamp(1.0, 6.0) as usize
                        };
                        cfg.noise2.ridged(px / w, py / w, octaves) - 0.5
                    })
                },
                |v| v.fine[i * 4 + 2] as f64 - 0.5,
            ) * zone.detail
                * zone.amplitude
                * worn_amplitude
                * factor;
            output[i] = (output[i] as f64 * scale + detail).max(0.3) as f32;
            narrow_weight[i] = zone.narrow as f32;
        }
    }
    limit_slopes(&mut output, n, cell, &narrow_weight);
    output
}

// Smooth positive cubic B-spline weights keep the erosion delta continuous,
// including its derivatives. Clamped interpolating cubics can ring on flat terrain.
fn sample_delta(h: &[f32], n: usize, fx: f64, fy: f64) -> f64 {
    let (cols, wx) = bspline_axis(fx, n);
    let (rows, wy) = bspline_axis(fy, n);
    sample_delta_at(h, n, &cols, &wx, &rows, &wy)
}

/// Clamped taps and cubic B-spline weights of one axis at coordinate `f`.
#[inline]
fn bspline_axis(f: f64, n: usize) -> ([usize; 4], [f64; 4]) {
    let x = f.floor() as isize;
    let t = f - x as f64;
    let last = n as isize - 1;
    (
        std::array::from_fn(|i| (x + i as isize - 1).clamp(0, last) as usize),
        [
            (1.0 - t).powi(3) / 6.0,
            (3.0 * t.powi(3) - 6.0 * t * t + 4.0) / 6.0,
            (-3.0 * t.powi(3) + 3.0 * t * t + 3.0 * t + 1.0) / 6.0,
            t.powi(3) / 6.0,
        ],
    )
}

#[inline]
fn sample_delta_at(
    h: &[f32],
    n: usize,
    cols: &[usize; 4],
    wx: &[f64; 4],
    rows: &[usize; 4],
    wy: &[f64; 4],
) -> f64 {
    let mut result = 0.0;
    for (&row, &weight_y) in rows.iter().zip(wy) {
        let row = row * n;
        for (&col, &weight_x) in cols.iter().zip(wx) {
            result += h[row + col] as f64 * weight_x * weight_y;
        }
    }
    result
}

fn sample_extended(h: &[f32], n: usize, fx: f64, fy: f64) -> f64 {
    let x = fx.clamp(0.0, (n - 1) as f64);
    let y = fy.clamp(0.0, (n - 1) as f64);
    let mut value = sample(h, n, x, y, false);
    if fx != x {
        let xa = (x - 1.0).max(0.0);
        let xb = (x + 1.0).min((n - 1) as f64);
        value += (fx - x) * (sample(h, n, xb, y, false) - sample(h, n, xa, y, false)) / (xb - xa);
    }
    if fy != y {
        let ya = (y - 1.0).max(0.0);
        let yb = (y + 1.0).min((n - 1) as f64);
        value += (fy - y) * (sample(h, n, x, yb, false) - sample(h, n, x, ya, false)) / (yb - ya);
    }
    value
}

/// Incise pre-shaped canyon/plateau/volcano without regional uplift or p99 rescaling.
pub(crate) fn erode_shape(h: &mut [f32], n: usize, cell: f64, erosion: f64, talus: f64) {
    erode_with(
        h,
        n,
        cell,
        erosion,
        talus,
        &ShapeErosion {
            gain: tuning(SURFACE_INCISION),
            routed: tuning(SURFACE_ROUTED) > 0.5,
            motif: cell * n as f64,
            coarse: physical_erosion_resolution(n, 320),
            iterations: tuning(SURFACE_ITERATIONS).max(0.0) as usize,
            canyon_amplitude: None,
            freeze_plateaus: true,
        },
    );
}

/// Catchment-driven canyon incision; no prescribed channel geometry.
pub(crate) fn erode_canyon(
    h: &mut [f32],
    n: usize,
    cell: f64,
    erosion: f64,
    talus: f64,
    motif: f64,
    amplitude: f64,
) {
    erode_with(
        h,
        n,
        cell,
        erosion,
        talus,
        &ShapeErosion {
            gain: tuning(SURFACE_INCISION),
            routed: tuning(SURFACE_ROUTED) > 0.5,
            motif,
            coarse: physical_erosion_resolution(n, surface_resolution(cell * n as f64, motif)),
            iterations: tuning(SURFACE_ITERATIONS).max(0.0) as usize,
            canyon_amplitude: Some(amplitude),
            freeze_plateaus: true,
        },
    );
}

/// Shared erosion of physical surface detail after regional reconstruction.
/// Coasts keep strict descent: the sea floor holds no sill to carve.
pub(crate) fn erode_surface(
    h: &mut [f32],
    n: usize,
    cell: f64,
    erosion: f64,
    talus: f64,
    motif: f64,
    coast: bool,
) {
    erode_with(
        h,
        n,
        cell,
        erosion,
        talus,
        &ShapeErosion {
            gain: tuning(SURFACE_INCISION),
            routed: !coast && tuning(SURFACE_ROUTED) > 0.5,
            motif,
            coarse: physical_erosion_resolution(n, surface_resolution(cell * n as f64, motif)),
            iterations: tuning(SURFACE_ITERATIONS).max(0.0) as usize,
            canyon_amplitude: None,
            freeze_plateaus: true,
        },
    );
}

struct ShapeErosion {
    gain: f64,
    /// Water crosses depressions and carves their sills (else strict descent).
    routed: bool,
    motif: f64,
    coarse: usize,
    iterations: usize,
    canyon_amplitude: Option<f64>,
    /// Keep inert plateaus out of strict descent (see [`lively_cells`]).
    freeze_plateaus: bool,
}

// Deep trunk-river erosion is deliberately separate from ordinary hillside
// erosion. Accumulation selects the rivers; Euclidean bank profiles enlarge
// their incision without reproducing grid-aligned basin-breach trenches.
fn canyon_cut(
    h: &mut [f32],
    n: usize,
    cell: f64,
    erosion: f64,
    motif: f64,
    amplitude: f64,
    work: &mut Work,
) {
    #[derive(Clone, Copy, Default)]
    struct Bank {
        peak: f64,
        width: f64,
        x: u32,
        y: u32,
        river: bool,
    }
    let grid = Grid::new(n);
    work.flood.compute(h, &grid, Some(&mut work.flow));
    let mut acc = vec![1.0_f32; h.len()];
    accumulate_f32(&mut acc, &work.flood.order, &work.flow);
    // Each river cell's bank profile: its peak depth and half width.
    let mut banks = vec![Bank::default(); h.len()];
    crate::terrain_par::cells(&mut banks, |c, bank| {
        let importance =
            smooth(((acc[c] as f64 * cell * cell / (motif * motif)).sqrt() - 0.10) / 0.30);
        *bank = Bank {
            peak: amplitude * 0.90 * erosion * importance,
            width: motif * (0.008 + 0.065 * importance.sqrt()) * erosion.sqrt(),
            x: (c % n) as u32,
            y: (c / n) as u32,
            river: importance > 0.0,
        };
    });
    let mut seeds: Vec<u32> = banks
        .iter()
        .enumerate()
        .map(|(i, bank)| if bank.river { i as u32 } else { NONE })
        .collect();
    let mut next = seeds.clone();
    let score = |x: usize, y: usize, seed: u32| -> f64 {
        if seed == NONE {
            return 0.0;
        }
        let bank = banks[seed as usize];
        let distance =
            ((x as u32).abs_diff(bank.x) as f64).hypot((y as u32).abs_diff(bank.y) as f64) * cell;
        bank.peak * (1.0 - smooth(distance / bank.width))
    };
    // Jump flooding propagates the strongest physical river-bank profile.
    // The same bounded schedule and Euclidean distance are used on the GPU.
    let mut jump = n.next_power_of_two() / 2;
    let mut steps = Vec::new();
    while jump > 0 {
        steps.push(jump);
        jump /= 2;
    }
    steps.extend([1, 1]);
    for jump in steps {
        let current = &seeds;
        crate::terrain_par::rows(&mut next, n, |y, row| {
            for (x, out) in row.iter_mut().enumerate() {
                let mut best = current[y * n + x];
                let mut value = score(x, y, best);
                for &(dx, dy) in &D8 {
                    let sx = x as isize + dx * jump as isize;
                    let sy = y as isize + dy * jump as isize;
                    if sx < 0 || sy < 0 || sx >= n as isize || sy >= n as isize {
                        continue;
                    }
                    let seed = current[sy as usize * n + sx as usize];
                    // The current seed scores the same again; no seed scores 0,
                    // never above a (non-negative) profile and last in ties.
                    if seed == best || seed == NONE {
                        continue;
                    }
                    let candidate = score(x, y, seed);
                    if candidate > value || (candidate == value && seed < best) {
                        value = candidate;
                        best = seed;
                    }
                }
                *out = best;
            }
        });
        std::mem::swap(&mut seeds, &mut next);
    }
    crate::terrain_par::rows(h, n, |y, row| {
        for (x, value) in row.iter_mut().enumerate() {
            *value -= score(x, y, seeds[y * n + x]) as f32;
        }
    });
}

fn erode_with(h: &mut [f32], n: usize, cell: f64, erosion: f64, talus: f64, shape: &ShapeErosion) {
    if erosion == 0.0 {
        return;
    }
    // Move the fixed simulation border outside the displayed map. Extrapolate its
    // slope rather than adding a raised/lowered rim that would divert drainage.
    let coarse_n = n.min(shape.coarse);
    let padding = 12;
    let padded_n = coarse_n + padding * 2;
    let ratio = n as f64 / coarse_n as f64;
    let mut coarse = vec![0.0_f32; padded_n * padded_n];
    let source: &[f32] = h;
    crate::terrain_par::rows(&mut coarse, padded_n, |y, row| {
        for (x, value) in row.iter_mut().enumerate() {
            *value = sample_extended(
                source,
                n,
                (x as f64 - padding as f64 + 0.5) * ratio - 0.5,
                (y as f64 - padding as f64 + 0.5) * ratio - 0.5,
            ) as f32;
        }
    });
    let original = coarse.clone();
    let mut work = Work::default();
    if let Some(amplitude) = shape.canyon_amplitude {
        canyon_cut(
            &mut coarse,
            padded_n,
            cell * ratio,
            erosion,
            shape.motif,
            amplitude,
            &mut work,
        );
    }
    erode_shape_coarse(
        &mut coarse,
        padded_n,
        cell * ratio,
        erosion,
        talus,
        shape,
        &mut work,
    );
    for (value, baseline) in coarse.iter_mut().zip(original) {
        *value -= baseline;
    }
    let coarse = &coarse;
    // The separable taps depend on the column or the row alone.
    let axis: Vec<_> = (0..n)
        .map(|x| bspline_axis((x as f64 + 0.5) / ratio - 0.5 + padding as f64, padded_n))
        .collect();
    crate::terrain_par::rows(h, n, |y, row| {
        let (rows, wy) = &axis[y];
        for (value, (cols, wx)) in row.iter_mut().zip(&axis) {
            let change = sample_delta_at(coarse, padded_n, cols, wx, rows, wy);
            *value = (*value as f64 + change) as f32;
        }
    });
}

fn erode_shape_coarse(
    h: &mut [f32],
    n: usize,
    cell: f64,
    erosion: f64,
    talus: f64,
    shape: &ShapeErosion,
    work: &mut Work,
) {
    let grid = Grid::new(n);
    let strength = erosion * shape.gain;
    let carve = tuning(SURFACE_CARVE);
    let thermal_rate = (tuning(SURFACE_THERMAL) * erosion * 0.09).min(0.3);
    let diffusion = (tuning(SURFACE_DIFFUSION) * erosion * 0.025).min(0.1);
    // Catchment is physical and slope response follows the relief's talus.
    // Gentle hills keep legible gullies without forced flat-basin trenches.
    let threshold = talus * 0.10;
    let channel_area = (n * n) as f32 * 0.001;
    let (mut keys, mut spare) = (Vec::new(), Vec::new());
    let mut acc = vec![1.0_f32; h.len()];
    let mut channels = vec![false; h.len()];
    // Routed water crosses flats: only strict descent leaves them alone.
    let lively = (!shape.routed && shape.freeze_plateaus)
        .then(|| lively_cells(h, &grid, 4 * shape.iterations + 2))
        .flatten();
    let (lively, only) = lively.unwrap_or_default();
    work.relax.lively = lively;
    for _ in 0..shape.iterations {
        let fl = &mut work.flood;
        // Strict physical descent: closed bowls stay closed instead of acquiring
        // artificial breach trenches on hills. The same D-infinity split is used on GPU.
        // Routed: water crosses depressions to their spill, whose sill is carved.
        if shape.routed {
            fl.compute(h, &grid, Some(&mut work.flow));
            carve_sills(h, fl, &grid, cell, carve, &mut work.basins, Some(work.flow.as_slice()));
        } else {
            sort_by_height(h, &only, &mut fl.order, &mut keys, &mut spare);
            fl.filled.clear();
            fl.filled.extend_from_slice(h);
            reset(&mut fl.receiver, h.len(), NONE);
            let heights: &[f32] = h;
            let lively: &[bool] = &work.relax.lively;
            crate::terrain_par::cells(&mut fl.receiver, |c, receiver| {
                if grid.borders[c] || !is_lively(lively, c) {
                    return;
                }
                let neighbors = grid.neighbors(c);
                let mut best = 0.0;
                for (d, &distance) in DIST.iter().enumerate() {
                    let slope = (heights[c] as f64 - heights[neighbors[d]] as f64) / distance;
                    if slope > best {
                        best = slope;
                        *receiver = neighbors[d] as u32;
                    }
                }
            });
            fl.rank_order();
            continuous_flow(fl, &grid, &work.relax.lively, &mut work.flow);
        }
        let fl = &work.flood;
        accumulate_f32(&mut acc, &fl.order, &work.flow);
        let area = &acc;
        incise(
            h,
            &fl.order,
            &work.flow,
            &mut work.baseline,
            Some(&grid.borders),
            cell,
            |c, slope, distance| {
                let response =
                    0.08 + 0.92 * slope * slope / (slope * slope + threshold * threshold);
                (strength
                    * 0.40
                    * (area[c] as f64 * cell * cell / (0.004 * shape.motif * shape.motif))
                        .sqrt()
                        .min(4.0)
                    * response
                    / distance)
                    .min(4.0)
            },
        );
        thermal(h, &grid, cell, talus, 1, thermal_rate, &mut work.relax);
        for (channel, &a) in channels.iter_mut().zip(&acc) {
            *channel = a > channel_area;
        }
        diffuse(h, n, &channels, diffusion, &mut work.relax);
    }
    work.relax.lively = Vec::new();
}

/// The `k`-th smallest value in `f32::total_cmp` order (what
/// `select_nth_unstable_by(k, f32::total_cmp)` yields), by a two-pass radix
/// selection that leaves `values` untouched.
pub(crate) fn nth_smallest(values: &[f32], k: usize) -> f32 {
    let key = |v: f32| {
        let bits = v.to_bits();
        if bits & 0x8000_0000 != 0 {
            !bits
        } else {
            bits | 0x8000_0000
        }
    };
    let select = |count: &[usize], k: &mut usize| {
        for (bucket, &c) in count.iter().enumerate() {
            if *k < c {
                return bucket as u32;
            }
            *k -= c;
        }
        unreachable!("rank beyond the values")
    };
    let mut k = k;
    let mut count = vec![0usize; 1 << 16];
    for &v in values {
        count[(key(v) >> 16) as usize] += 1;
    }
    let high = select(&count, &mut k);
    count.fill(0);
    for &v in values {
        let kv = key(v);
        if kv >> 16 == high {
            count[(kv & 0xFFFF) as usize] += 1;
        }
    }
    let kv = high << 16 | select(&count, &mut k);
    f32::from_bits(if kv & 0x8000_0000 != 0 {
        kv & 0x7FFF_FFFF
    } else {
        !kv
    })
}

pub(crate) fn surface_resolution(width: f64, motif: f64) -> usize {
    ((width / motif * 96.0).ceil() as usize).clamp(640, 1024)
}

pub(crate) fn physical_erosion_resolution(n: usize, baseline: usize) -> usize {
    if n <= 1024 { baseline.min(n) } else { baseline.max(((n as f64) * 0.6).ceil() as usize).min(2048).min(n) }
}

/// Scalar schedule shared with the browser GPU adapter. Cell size is physical;
/// the padded border does not impose a flat/zero rim on the visible region.
pub(crate) fn surface_parameters(width: f64, motif: f64, erosion: f64, talus: f64) -> [f32; 8] {
    let coarse = surface_resolution(width, motif);
    let n = coarse + 24;
    let cell = width / coarse as f64;
    [
        n as f32,
        cell as f32,
        (-12.0 * cell) as f32,
        tuning(SURFACE_ITERATIONS).max(0.0).floor() as f32,
        talus as f32,
        (tuning(SURFACE_THERMAL) * erosion * 0.1125) as f32,
        (tuning(SURFACE_INCISION) * erosion * 0.40 * cell / (0.004_f64.sqrt() * motif)) as f32,
        (tuning(SURFACE_DIFFUSION) * erosion * 0.025).min(0.1) as f32,
    ]
}

#[cfg(test)]
mod plateau_tests {
    use super::*;

    #[test]
    fn strict_descent_on_a_flat_sea_floor_ignores_the_frozen_cells() {
        let n = 200;
        let h: Vec<f32> = (0..n * n)
            .map(|i| {
                let (x, y) = ((i % n) as f32, (i / n) as f32);
                if x > 55.0 { -250.0 } else { (55.0 - x) * 4.0 - 250.0 + (x * 0.7).sin() * (y * 0.4).cos() * 9.0 }
            })
            .collect();
        let shape = |freeze_plateaus| ShapeErosion {
            gain: 1.0,
            routed: false,
            motif: 3000.0,
            coarse: n,
            iterations: 12,
            canyon_amplitude: None,
            freeze_plateaus,
        };
        let (mut full, mut frozen) = (h.clone(), h.clone());
        erode_with(&mut full, n, 30.0, 1.0, 0.5, &shape(false));
        erode_with(&mut frozen, n, 30.0, 1.0, 0.5, &shape(true));
        let padded = n + 24;
        let grid = Grid::new(padded);
        let coarse: Vec<f32> = (0..padded * padded).map(|i| h[(i / padded).clamp(12, n + 11).abs_diff(12) * n + (i % padded).clamp(12, n + 11).abs_diff(12)]).collect();
        assert!(lively_cells(&coarse, &grid, 50).is_some(), "the plateau must drop out");
        assert!(full != h, "the erosion must act");
        assert!(full.iter().map(|v| v.to_bits()).eq(frozen.iter().map(|v| v.to_bits())));
    }
}
