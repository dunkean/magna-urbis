use super::*;
pub(super) struct Balance {
    pub routing_height: Vec<f32>,
    pub weight: Vec<f32>,
    pub lake_of: Vec<i32>,
    pub level: Vec<f32>,
    pub closed: Vec<u8>,
    pub loss: Vec<f32>,
    pub lakes: usize,
    pub closed_lakes: usize,
    pub lake_area: f64,
}
fn fill_noise(
    height: &[f32],
    n: usize,
    width: f64,
    min_depth: f64,
    min_area: f64,
    drainage: Option<&Hydrology>,
) -> Vec<f32> {
    let owned;
    let h = if let Some(h) = drainage {
        h
    } else {
        owned = hydrology(height, n, width);
        &owned
    };
    let total = n * n;
    let mut out = height.to_vec();
    let mut seen = vec![false; total];
    let mut noise = vec![false; total];
    let filled = &h.grids.filled;
    for s in 0..total {
        if seen[s] || filled[s] as f64 - height[s] as f64 <= 0.0 {
            continue;
        }
        let mut comp = vec![s];
        seen[s] = true;
        let (mut deepest, mut i) = (0.0_f64, 0);
        while i < comp.len() {
            let c = comp[i];
            i += 1;
            deepest = deepest.max(filled[c] as f64 - height[c] as f64);
            for (nb, _) in neighbours(c, n) {
                if !seen[nb]
                    && filled[nb] as f64 - height[nb] as f64 > 0.0
                    && filled[nb] == filled[c]
                {
                    seen[nb] = true;
                    comp.push(nb)
                }
            }
        }
        if deepest < min_depth || (comp.len() as f64) * h.cell_area() < min_area {
            for c in comp {
                noise[c] = true
            }
        }
    }
    for &cc in &h.grids.order {
        let c = cc as usize;
        let r = h.grids.receiver[c];
        if noise[c] && r >= 0 {
            out[c] = (filled[c] as f64).max(out[r as usize] as f64 + 1e-3) as f32
        }
    }
    out
}
pub(super) fn water_balance(
    source: &[f32],
    n: usize,
    width: f64,
    sea: &[u8],
    climate: Climate,
    min_depth: f64,
    min_area: f64,
    drainage: Option<&Hydrology>,
) -> Balance {
    let total = n * n;
    let cell_area = (width / n as f64).powi(2);
    let height = fill_noise(source, n, width, min_depth, min_area, drainage);
    let runoff = climate.runoff();
    let mut weight = vec![0.0; total];
    crate::terrain_par::cells(&mut weight, |c, value| {
        *value = if sea[c] != 0 {
            0.0
        } else {
            (climate.runoff_at(height[c] as f64) / runoff.r0) as f32
        };
    });
    let evap = |z: f64| climate.potential(z) / runoff.r0;
    let routing = crate::priority_flood::routing_grids(&height, n);
    let g = &routing;
    let mut depression = vec![-1; total];
    let mut cells: Vec<Vec<usize>> = Vec::new();
    let mut spill = Vec::new();
    for s in 0..total {
        if depression[s] >= 0 || sea[s] != 0 || g.filled[s] as f64 - height[s] as f64 <= 0.0 {
            continue;
        }
        let id = cells.len() as i32;
        let mut list = vec![s];
        depression[s] = id;
        let mut i = 0;
        while i < list.len() {
            let c = list[i];
            i += 1;
            for (nb, _) in neighbours(c, n) {
                if depression[nb] < 0
                    && sea[nb] == 0
                    && g.filled[nb] as f64 - height[nb] as f64 > 0.0
                    && g.filled[nb] == g.filled[c]
                {
                    depression[nb] = id;
                    list.push(nb)
                }
            }
        }
        cells.push(list);
        spill.push(g.filled[s] as f64)
    }
    let count = cells.len();
    let full: Vec<f64> = cells
        .iter()
        .enumerate()
        .map(|(d, list)| list.len() as f64 * cell_area * evap(spill[d]))
        .collect();
    let mut pass = vec![1.0; count];
    let mut inflow = vec![0.0; count];
    let mut outflow = vec![0.0; total];
    let mut acc = vec![0.0; total];
    for _ in 0..6 {
        for c in 0..total {
            acc[c] = weight[c] as f64 * cell_area
        }
        inflow.fill(0.0);
        outflow.fill(0.0);
        for &cc in g.order.iter().rev() {
            let c = cc as usize;
            let r = g.receiver[c];
            if r < 0 {
                continue;
            }
            let r = r as usize;
            let d = depression[c];
            if d >= 0 && depression[r] != d {
                inflow[d as usize] += acc[c];
                outflow[c] = acc[c];
                acc[r] += acc[c] * pass[d as usize]
            } else {
                acc[r] += acc[c]
            }
        }
        let mut changed = false;
        for d in 0..count {
            let share = if inflow[d] > full[d] {
                1.0 - full[d] / inflow[d]
            } else {
                0.0
            };
            if (share - pass[d]).abs() > 1e-3 {
                changed = true
            }
            pass[d] = share
        }
        if !changed {
            break;
        }
    }
    let mut lake_of = vec![-1; total];
    let mut level = vec![f32::NAN; total];
    let mut closed = vec![0; total];
    let mut loss = vec![0.0; total];
    for d in 0..count {
        let mut wet = cells[d].clone();
        let mut surface = spill[d];
        if pass[d] == 0.0 {
            wet.sort_by(|&a, &b| height[a].total_cmp(&height[b]));
            let mut area = 0.0;
            let mut k = 0;
            while k < wet.len() {
                area += cell_area;
                if area * evap(height[wet[k]] as f64) >= inflow[d] {
                    break;
                }
                k += 1
            }
            surface = height[wet[k.min(wet.len() - 1)]] as f64;
            wet.truncate((k + 1).min(wet.len()))
        } else {
            for &c in &cells[d] {
                if outflow[c] > 0.0 {
                    loss[c] = (outflow[c] * (1.0 - pass[d])) as f32
                }
            }
        }
        for c in wet {
            lake_of[c] = d as i32;
            level[c] = surface as f32;
            if pass[d] == 0.0 {
                closed[c] = 1
            }
        }
    }
    let lake_area = lake_of.iter().filter(|&&id| id >= 0).count() as f64 * cell_area;
    Balance {
        routing_height: height,
        weight,
        lake_of,
        level,
        closed,
        loss,
        lakes: count,
        closed_lakes: pass.iter().filter(|&&p| p == 0.0).count(),
        lake_area,
    }
}
/// Water depth of a balanced lake's shore: the drawn lake and its sub-cell
/// shoreline both stop where the water gets shallower than this.
pub(super) const SHORE_DEPTH: f64 = 0.1;
pub(super) fn balanced_bodies(
    b: &Balance,
    height: &[f32],
    n: usize,
    cell_area: f64,
    depth: f64,
    min_area: f64,
) -> (Vec<u8>, usize, usize, f64) {
    let total = n * n;
    let mut area = vec![0.0; b.lakes];
    let mut closed = vec![0; b.lakes];
    for c in 0..total {
        let k = b.lake_of[c];
        if k < 0 || b.level[c] as f64 - (height[c] as f64) < depth {
            continue;
        }
        area[k as usize] += cell_area;
        if b.closed[c] != 0 {
            closed[k as usize] = 1
        }
    }
    let kept: Vec<bool> = area
        .iter()
        .map(|&a| a >= min_area * 1e4 && a > 0.0)
        .collect();
    let deep: Vec<bool> = (0..total)
        .map(|c| {
            b.lake_of[c] >= 0
                && kept[b.lake_of[c] as usize]
                && b.level[c] as f64 - height[c] as f64 >= depth
        })
        .collect();
    let mut lake = vec![0; total];
    let mut cells = 0;
    for c in 0..total {
        // A kept lake covers its whole flooded extent: a shallow margin left
        // dry let rivers skirt the water inside the basin, or stop short of it.
        let drawn = deep[c]
            || (b.lake_of[c] >= 0
                && kept[b.lake_of[c] as usize]
                && b.level[c] as f64 - height[c] as f64 > SHORE_DEPTH);
        if drawn {
            lake[c] = 1;
            cells += 1
        }
    }
    (
        lake,
        kept.iter().filter(|&&v| v).count(),
        (0..b.lakes).filter(|&k| kept[k] && closed[k] != 0).count(),
        cells as f64 * cell_area / 1e6,
    )
}
