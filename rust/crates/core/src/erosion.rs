//! Coarse landscape evolution ported from web/src/gen/terrain/erosion.ts.
//! Priority flood, D-infinity split drainage, implicit stream-power incision,
//! basin breaching, thermal relaxation, and bounded bicubic sampling.
use crate::{noise::Noise, smooth};
use std::f64::consts::{FRAC_PI_4, SQRT_2};
mod pipeline;
pub use pipeline::TerrainPipeline;

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
        sort_by_height(h, &mut self.sorted, &mut self.keys, &mut self.spare);
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
        reset(&mut self.rank, self.order.len(), 0);
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
    order: &mut Vec<u32>,
    keys: &mut Vec<(u32, u32)>,
    spare: &mut Vec<(u32, u32)>,
) {
    reset(keys, h.len(), (0, 0));
    crate::terrain_par::cells(keys, |i, entry| {
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
    reset(order, h.len(), 0);
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
fn continuous_flow(fl: &Flood, grid: &Grid, flow: &mut Vec<FlowCell>) {
    let (filled, rank, receiver) = (&fl.filled, &fl.rank, &fl.receiver);
    reset(flow, filled.len(), FlowCell::NONE);
    crate::terrain_par::cells(flow, |c, out| {
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

// Sill carving (Lindsay 2016, bounded): each depression's outlet sill and the
// reach below it are lowered towards a level `carve` of the way from the spill
// to the depression floor. The lake floor itself is never trenched; repeated
// over the evolution, incision, relaxation and diffusion widen the cut into a
// valley. Mirrors the GPU `breach` kernel.
fn carve_sills(
    h: &mut [f32],
    fl: &Flood,
    grid: &Grid,
    cell: f64,
    carve: f64,
    basins: &mut Basins,
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
        let mut level = (h[pour] as f64).min(spill - carve * (spill - bottom));
        target[pour] = target[pour].min((h[pour] as f64 + carve * (level - h[pour] as f64)) as f32);
        let mut r = fl.receiver[pour];
        for _ in 0..400 {
            if r == NONE {
                break;
            }
            level = (level - 0.01 * cell).max(0.5);
            let old = h[r as usize] as f64;
            if old <= level {
                break;
            }
            target[r as usize] = target[r as usize].min((old + carve * (level - old)) as f32);
            r = fl.receiver[r as usize];
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
        return thermal_scatter(h, grid, cell, talus, passes, rate, &mut work.delta);
    }
    let len = h.len();
    for _ in 0..passes {
        reset(&mut work.donors, len, (0.0, 0.0));
        let heights: &[f32] = h;
        crate::terrain_par::cells(&mut work.donors, |i, donor| {
            if grid.borders[i] {
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
    delta: &mut Vec<f64>,
) {
    for _ in 0..passes {
        reset(delta, h.len(), 0.0);
        for i in 0..h.len() {
            if grid.borders[i] {
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
    let previous = &work.next;
    crate::terrain_par::rows(h, n, |y, row| {
        if y == 0 || y == n - 1 {
            return;
        }
        for x in 1..n - 1 {
            let i = y * n + x;
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
    let local = |x: f64, y: f64| -> (f64, f64, f64, f64) {
        if let (Some((zones, _)), Some(profiles)) = (cfg.zoning, &profiles) {
            let weights = zones.sample(x / cfg.width, y / cfg.width);
            let mut out = (0.0, 0.0, 0.0, 0.0);
            for (i, w) in weights.into_iter().enumerate() {
                out.0 += w * profiles[i].0;
                out.1 += w * profiles[i].1;
                out.2 += w * profiles[i].2;
                out.3 += w * profiles[i].3;
            }
            out
        } else {
            (1.0, cfg.mountain_mix, cfg.crest, cfg.detail)
        }
    };
    let n = cfg.n;
    let nc = cfg.coarse;
    let count = nc * nc;
    let grid = Grid::new(nc);
    let extent = cfg.width * 1.44;
    let cc = extent / nc as f64;
    let cell = cfg.width / n as f64;
    let x0 = -cfg.width * 0.22;
    let mut uplift = vec![0.0_f32; count];
    let mut h = vec![0.0_f32; count];
    for y in 0..nc {
        for x in 0..nc {
            let px = x0 + (x as f64 + 0.5) * cc;
            let py = x0 + (y as f64 + 0.5) * cc;
            let (amplitude, mix, crest, _) = local(px, py);
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
            let mountains = smooth((distribution + (mix - 0.5) * 1.4 + 0.28) / 0.56);
            let regional_amp = 0.20 + 0.80 * mountains;
            let ridge = if crest > 0.0 {
                coarse_noise.map_or_else(
                    || {
                        cfg.noise2
                            .ridged(px / env_wavelength + 5.7, py / env_wavelength - 3.2, 3)
                    },
                    |v| v.coarse[(y * nc + x) * 4 + 3] as f64,
                )
            } else {
                0.0
            };
            // Ridge skeleton belongs to the main uplift, not a texture painted
            // after erosion. Hills and canyon uplands keep their smoother forms.
            let skeleton = 1.0 + crest * mountains * ((0.24 + 1.8 * ridge * ridge) - 1.0);
            let u = (0.7 + 0.5 * env - 0.25 * q).max(0.12) * regional_amp * skeleton * amplitude;
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
                        * coarse_noise.map_or_else(
                            || {
                                cfg.noise2
                                    .fbm(px / initial_wavelength, py / initial_wavelength, 3)
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
            carve_sills(&mut h, &work.flood, &grid, cc, carve, &mut work.basins);
            accumulate_f64(&mut acc, &work.flood.order, &work.flow);
            let acc = &acc;
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
                    (incision * (acc[c] as f64).sqrt().min(catchment_cap) * response / distance)
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
            work.flood.compute(&h, &grid, None);
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
            let warp = tuning(WARP) * (16.0 * cfg.k).min(cc * 0.9);
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
                    .0,
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
    let slopes = output.clone();
    let wavelength = (cell * 6.0).max(260.0 * cfg.k);
    let octaves = (wavelength / (cell * 4.0)).log2().round().clamp(1.0, 6.0) as usize;
    for y in 0..n {
        for x in 0..n {
            let i = y * n + x;
            let gx = slopes[y * n + (x + 1).min(n - 1)] as f64
                - slopes[y * n + x.saturating_sub(1)] as f64;
            let gy = slopes[(y + 1).min(n - 1) * n + x] as f64
                - slopes[y.saturating_sub(1) * n + x] as f64;
            let slope = gx.hypot(gy) * scale / (2.0 * cell);
            let factor = smooth((slope - 0.015) / 0.3) * drainage_weight[i];
            let px = (x as f64 + 0.5) * cell;
            let py = (y as f64 + 0.5) * cell;
            let detail = (cfg.generation_noise.map_or_else(
                || cfg.noise2.ridged(px / wavelength, py / wavelength, octaves),
                |v| v.fine[i * 4 + 2] as f64,
            ) - 0.5)
                * {
                    let (amplitude, _, _, detail_strength) = local(px, py);
                    detail_strength * amplitude
                }
                * worn_amplitude
                * factor;
            output[i] = (output[i] as f64 * scale + detail).max(0.3) as f32;
        }
    }
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
            coarse: 320,
            iterations: tuning(SURFACE_ITERATIONS).max(0.0) as usize,
            canyon_amplitude: None,
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
            coarse: surface_resolution(cell * n as f64, motif),
            iterations: tuning(SURFACE_ITERATIONS).max(0.0) as usize,
            canyon_amplitude: Some(amplitude),
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
            coarse: surface_resolution(cell * n as f64, motif),
            iterations: tuning(SURFACE_ITERATIONS).max(0.0) as usize,
            canyon_amplitude: None,
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
    for _ in 0..shape.iterations {
        let fl = &mut work.flood;
        // Strict physical descent: closed bowls stay closed instead of acquiring
        // artificial breach trenches on hills. The same D-infinity split is used on GPU.
        // Routed: water crosses depressions to their spill, whose sill is carved.
        if shape.routed {
            fl.compute(h, &grid, Some(&mut work.flow));
            carve_sills(h, fl, &grid, cell, carve, &mut work.basins);
        } else {
            sort_by_height(h, &mut fl.order, &mut keys, &mut spare);
            fl.filled.clear();
            fl.filled.extend_from_slice(h);
            reset(&mut fl.receiver, h.len(), NONE);
            let heights: &[f32] = h;
            crate::terrain_par::cells(&mut fl.receiver, |c, receiver| {
                if grid.borders[c] {
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
            continuous_flow(fl, &grid, &mut work.flow);
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

fn surface_resolution(width: f64, motif: f64) -> usize {
    ((width / motif * 96.0).ceil() as usize).clamp(640, 1024)
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
