//! Lakes from the climate's water budget: Fill–Spill–Merge at equilibrium
//! (Barnes, Callaghan & Wickert 2021) on the routed drainage.
//!
//! Runoff r (precipitation minus Turc–Pike evapotranspiration) feeds every
//! depression from its catchment; open water evaporates e per unit area. A
//! depression whose inflow exceeds the evaporation of its full surface spills
//! at its sill and passes the excess on (open lake). Otherwise its lake rises
//! from the lowest floor until e·A balances the inflow, below the sill, and
//! closes its basin (closed lake). Depressions too shallow or too small to hold
//! a lake, and closed basins whose lake would be too small, are not lakes: the
//! caller breaches or fills them like any other depression.
//!
//! A lake is one connected set of cells under one level; that set is the single
//! definition used by routing, the river graph and the drawn shore.
use super::{Drainage, HeapCell, OUT, bspline_at_cell, flats::diagonal_open, neighbors};
use std::collections::BinaryHeap;

/// Mean annual temperature at sea level (°C, −6.5 °C/km above) and annual precipitation (mm).
#[derive(Clone, Copy, PartialEq)]
pub(super) struct Climate {
    pub temperature: f32,
    pub precipitation: f32,
}

impl Climate {
    /// Turc–Pike potential evaporation L(T) = 300 + 25 T + 0.05 T³, mm/yr; open water evaporates about L.
    pub fn evaporation(self, z: f32) -> f32 {
        let t = self.temperature - 0.0065 * z.max(0.0);
        (300.0 + 25.0 * t + 0.05 * t * t * t).max(60.0)
    }
    /// Runoff P − ET with ET = P / √(0.9 + P²/L²), mm/yr.
    pub fn runoff(self, z: f32) -> f32 {
        let p = self.precipitation;
        let l = self.evaporation(z);
        let et = p / (0.9 + (p * p) / (l * l)).sqrt();
        (p - et).max(0.02 * p).max(0.5)
    }
}

pub(super) struct BalancedLake {
    pub cells: Vec<usize>,
    pub level: f32,
    pub closed: bool,
    /// Lowest floor cell; the single sink of a closed lake.
    pub pit: usize,
    pub max_depth: f32,
    pub bounds: [usize; 4],
}

struct Depression {
    cells: Vec<usize>,
    level: f32,
    pit: usize,
}

pub(super) struct Options {
    pub climate: Climate,
    pub min_depth: f32,
    pub min_area: f32,
    pub bank_budget: f32,
}

/// Lakes of the routed surface `drainage` over the physical `height`.
pub(super) fn lakes(
    height: &[f32],
    drainage: &Drainage,
    sea: &[bool],
    n: usize,
    cell: f32,
    options: &Options,
) -> Vec<BalancedLake> {
    let len = height.len();
    let cell_area = cell * cell;
    let filled = &drainage.filled;
    // Depressions: connected cells below one filled level (nested pits share it).
    let mut owner = vec![u32::MAX; len];
    let mut depressions: Vec<Depression> = Vec::new();
    for start in 0..len {
        if owner[start] != u32::MAX || sea[start] || filled[start] - height[start] <= 0.0 {
            continue;
        }
        let id = depressions.len() as u32;
        let level = filled[start];
        let mut cells = vec![start];
        owner[start] = id;
        let mut pit = start;
        let mut k = 0;
        while k < cells.len() {
            let i = cells[k];
            k += 1;
            if height[i] < height[pit] {
                pit = i;
            }
            for j in neighbors(i, n).into_iter().flatten() {
                if owner[j] == u32::MAX
                    && !sea[j]
                    && filled[j] - height[j] > 0.0
                    && (filled[j] - level).abs() < 0.005
                    && diagonal_open(i, j, filled, n, options.bank_budget)
                {
                    owner[j] = id;
                    cells.push(j);
                }
            }
        }
        depressions.push(Depression { cells, level, pit });
    }
    // Only basins that can hold a lake take part in the budget; the others pass
    // their water on, as they will once breached or filled. Depth is measured
    // on the ground as drawn: a lake exists where it shows.
    let drawn_depth = |level: f32, cells: &[usize]| {
        cells
            .iter()
            .map(|&i| level - bspline_at_cell(height, n, i))
            .fold(f32::NEG_INFINITY, f32::max)
    };
    let mut candidate: Vec<bool> = depressions
        .iter()
        .map(|d| {
            drawn_depth(d.level, &d.cells) >= options.min_depth
                && d.cells.len() as f32 * cell_area >= options.min_area
                && has_core(&d.cells, n)
        })
        .collect();
    let climate = options.climate;
    let weight: Vec<f64> = (0..len)
        .map(|i| {
            if sea[i] {
                0.0
            } else {
                f64::from(climate.runoff(height[i]) * cell_area)
            }
        })
        .collect();
    let mut closed: Vec<Option<(f32, Vec<usize>)>> = vec![None; depressions.len()];
    let mut inflow = vec![0.0_f64; depressions.len()];
    let mut pass = vec![1.0_f64; depressions.len()];
    let mut acc = vec![0.0_f64; len];
    // A basin found too dry for a lake passes its water on; that can close
    // basins downstream, so the budget is settled again (a few rounds).
    for _ in 0..4 {
        settle(
            drainage,
            &owner,
            &candidate,
            &weight,
            &depressions,
            climate,
            cell_area,
            &mut pass,
            &mut inflow,
            &mut acc,
        );
        let mut dry = false;
        for (d, depression) in depressions.iter().enumerate() {
            closed[d] = None;
            if !candidate[d] || pass[d] > 0.0 {
                continue;
            }
            let (level, cells) = closed_level(
                depression, inflow[d], height, &owner, d as u32, n, climate, cell_area,
            );
            if drawn_depth(level, &cells) < options.min_depth
                || cells.len() as f32 * cell_area < options.min_area
                || !has_core(&cells, n)
            {
                candidate[d] = false;
                dry = true;
            } else {
                closed[d] = Some((level, cells));
            }
        }
        if !dry {
            break;
        }
    }
    let mut lakes = Vec::new();
    for (d, depression) in depressions.into_iter().enumerate() {
        if !candidate[d] {
            continue;
        }
        let (level, cells, is_closed) = match closed[d].take() {
            Some((level, cells)) => (level, cells, true),
            None => (depression.level, depression.cells, false),
        };
        let mut bounds = [n, n, 0, 0];
        let mut pit = cells[0];
        for &i in &cells {
            bounds = [
                bounds[0].min(i % n),
                bounds[1].min(i / n),
                bounds[2].max(i % n),
                bounds[3].max(i / n),
            ];
            if height[i] < height[pit] {
                pit = i;
            }
        }
        lakes.push(BalancedLake {
            max_depth: level - height[pit],
            cells,
            level,
            closed: is_closed,
            pit,
            bounds,
        });
    }
    lakes
}

/// Half-width, in cells, of the open water a lake must hold: a flooded valley
/// floor one or two cells wide is a plain the river crosses, not a lake.
const LAKE_CORE: usize = 2;

/// Whether the cells keep a core after `LAKE_CORE` layers are peeled from their edge.
fn has_core(cells: &[usize], n: usize) -> bool {
    let (mut x0, mut y0, mut x1, mut y1) = (n, n, 0, 0);
    for &i in cells {
        x0 = x0.min(i % n);
        y0 = y0.min(i / n);
        x1 = x1.max(i % n);
        y1 = y1.max(i / n);
    }
    if x1 - x0 < 2 * LAKE_CORE || y1 - y0 < 2 * LAKE_CORE {
        return false;
    }
    let w = x1 - x0 + 3;
    let local = |i: usize| (i / n - y0 + 1) * w + i % n - x0 + 1;
    let mut inside = vec![false; w * (y1 - y0 + 3)];
    for &i in cells {
        inside[local(i)] = true;
    }
    let mut remaining: Vec<usize> = cells.iter().map(|&i| local(i)).collect();
    for _ in 0..LAKE_CORE {
        let edge: Vec<usize> = remaining
            .iter()
            .copied()
            .filter(|&k| {
                [
                    k - 1,
                    k + 1,
                    k - w,
                    k + w,
                    k - w - 1,
                    k - w + 1,
                    k + w - 1,
                    k + w + 1,
                ]
                .iter()
                .any(|&j| !inside[j])
            })
            .collect();
        for &k in &edge {
            inside[k] = false;
        }
        remaining.retain(|&k| inside[k]);
        if remaining.is_empty() {
            return false;
        }
    }
    true
}

/// Shares of each candidate's inflow passed on at its sill, settled over a few passes.
#[allow(clippy::too_many_arguments)]
fn settle(
    drainage: &Drainage,
    owner: &[u32],
    candidate: &[bool],
    weight: &[f64],
    depressions: &[Depression],
    climate: Climate,
    cell_area: f32,
    pass: &mut [f64],
    inflow: &mut [f64],
    acc: &mut [f64],
) {
    let full: Vec<f64> = depressions
        .iter()
        .map(|d| f64::from(d.cells.len() as f32 * cell_area * climate.evaporation(d.level)))
        .collect();
    for p in pass.iter_mut() {
        *p = 1.0;
    }
    for _ in 0..8 {
        acc.copy_from_slice(weight);
        inflow.fill(0.0);
        // Upstream first: `order` lists receivers before their donors.
        for &i in drainage.order.iter().rev() {
            let j = drainage.receivers[i];
            if j == OUT {
                continue;
            }
            let j = j as usize;
            let d = owner[i];
            if d != u32::MAX && candidate[d as usize] && owner[j] != d {
                inflow[d as usize] += acc[i];
                acc[j] += acc[i] * pass[d as usize];
            } else {
                acc[j] += acc[i];
            }
        }
        let mut changed = false;
        for d in 0..depressions.len() {
            let share = if !candidate[d] {
                1.0
            } else if inflow[d] > full[d] {
                1.0 - full[d] / inflow[d]
            } else {
                0.0
            };
            changed |= (share - pass[d]).abs() > 1e-3;
            pass[d] = share;
        }
        if !changed {
            break;
        }
    }
}

/// A closed lake rises from its lowest floor, flooding the lowest neighbouring
/// ground first, until its evaporation balances the inflow. One connected body.
#[allow(clippy::too_many_arguments)]
fn closed_level(
    depression: &Depression,
    inflow: f64,
    height: &[f32],
    owner: &[u32],
    id: u32,
    n: usize,
    climate: Climate,
    cell_area: f32,
) -> (f32, Vec<usize>) {
    let mut seen = std::collections::HashSet::new();
    let mut heap = BinaryHeap::new();
    heap.push(HeapCell::new(height[depression.pit], 0, depression.pit));
    seen.insert(depression.pit);
    let mut cells = Vec::new();
    // Highest floor flooded so far: past an inner sill, lower pockets fill to it first.
    let mut top_floor = f32::NEG_INFINITY;
    while let Some(next) = heap.pop() {
        let i = next.cell;
        let z = height[i];
        if z >= top_floor
            && !cells.is_empty()
            && f64::from(cells.len() as f32 * cell_area * climate.evaporation(top_floor)) >= inflow
        {
            // The surface settles between the highest flooded floor and the next one.
            return (0.5 * (top_floor + z), cells);
        }
        top_floor = top_floor.max(z);
        cells.push(i);
        // Cardinal steps: a diagonal between two dry corners is no water connection.
        for j in neighbors(i, n).into_iter().step_by(2).flatten() {
            if owner[j] == id && seen.insert(j) {
                heap.push(HeapCell::new(height[j], 0, j));
            }
        }
    }
    (depression.level, cells)
}
