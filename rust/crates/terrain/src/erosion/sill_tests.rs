//! Invariants of the sill carving (`carve_sills`).
use super::*;

#[test]
fn sill_winding_is_physical_and_only_uses_descending_receivers() {
    let n = 64;
    let grid = Grid::new(n);
    let mut bearings = Vec::new();
    for cell in [20.0_f32, 40.0] {
        let h: Vec<f32> = (0..n * n).map(|c| 200.0 - 0.001 * (c % n) as f32 * cell).collect();
        let mut fl = Flood::default();
        let mut flow = Vec::new();
        fl.compute(&h, &grid, Some(&mut flow));
        let c = 32 * n + 24;
        let mut sample = Vec::new();
        for arc in (0..2400).step_by(40) {
            let f = sill_flow(c, &fl, &grid, cell, flow[c], arc as f32, sill_phase(123));
            assert_ne!(f.first, NONE);
            assert!(fl.filled[f.first as usize] < fl.filled[c]);
            assert!(grid.neighbors(c).iter().enumerate().any(|(d, &q)| q == f.first as usize && fl.lower[c] & (1 << d) != 0));
            if f.second != NONE {
                assert!(fl.filled[f.second as usize] < fl.filled[c]);
                assert!(grid.neighbors(c).iter().enumerate().any(|(d, &q)| q == f.second as usize && fl.lower[c] & (1 << d) != 0));
            }
            let bearing = |q: u32| ((q as usize / n) as f32 - (c / n) as f32).atan2((q as usize % n) as f32 - (c % n) as f32);
            let angle = if f.second == NONE { bearing(f.first) } else {
                let a = bearing(f.first);
                let b = bearing(f.second);
                a + f.fraction * (b - a)
            };
            sample.push(angle);
        }
        assert!(sample.iter().copied().fold(f32::NEG_INFINITY, f32::max)
            - sample.iter().copied().fold(f32::INFINITY, f32::min) > 0.3, "an axis-aligned valley must turn");
        bearings.push(sample);
        // Steep terrain keeps its original pair, and a one-receiver confined channel cannot turn uphill.
        let steep: Vec<f32> = (0..n * n).map(|q| 200.0 - 0.02 * (q % n) as f32 * cell).collect();
        fl.compute(&steep, &grid, Some(&mut flow));
        let f = sill_flow(c, &fl, &grid, cell, flow[c], 200.0, sill_phase(123));
        assert_eq!((f.first, f.second, f.fraction), (flow[c].first, flow[c].second, flow[c].fraction));
        fl.lower[c] = 1; // east only
        let f = sill_flow(c, &fl, &grid, cell * 100.0, flow[c], 200.0, sill_phase(123));
        assert_eq!((f.first, f.second, f.fraction), (flow[c].first, flow[c].second, flow[c].fraction));
    }
    for (a, b) in bearings[0].iter().zip(&bearings[1]) {
        assert!((a - b).abs() < 0.001, "changing cell size changed the physical wave: {a} / {b}");
    }
}

/// A plain tilted obliquely to the grid, by 0.05 m and 0.02 m per cell (flatter than the 1 % of the carved reach on
/// 20 m cells), with a bowl 1.6 m deep in it: a closed basin about 1.2 m deep behind its downhill rim, far from the
/// border.
fn bowl(n: usize) -> Vec<f32> {
    (0..n * n)
        .map(|i| {
            let (x, y) = ((i % n) as f64, (i / n) as f64);
            let r2 = (x - 14.0).powi(2) + (y - 24.0).powi(2);
            (60.0 - 0.05 * x - 0.02 * y - 1.6 * (-r2 / 12.5).exp()) as f32
        })
        .collect()
}

/// Invariants of a carved sill, on a plain where the old reach (1 % down to 0.5 m, along the D8 receivers) cut a
/// ruled notch several metres deep to the border:
/// - the basin drains;
/// - no cell is cut by more than the depth of the basin, nor under its floor: the cut is what draining it needs;
/// - the cells lowered below the sill are not one row, one column or one diagonal of the grid.
#[test]
fn a_sill_is_cut_no_deeper_than_its_basin_and_not_along_one_grid_line() {
    let (n, cell) = (64_usize, 20.0_f64);
    let grid = Grid::new(n);
    let before = bowl(n);
    let mut h = before.clone();
    let mut flood = Flood::default();
    let mut basins = Basins::default();
    let mut flow: Vec<FlowCell> = Vec::new();
    flood.compute(&h, &grid, Some(&mut flow));
    let basin: Vec<usize> = (0..n * n).filter(|&c| flood.filled[c] - h[c] > 0.05).collect();
    let bottom = basin.iter().map(|&c| h[c] as f64).fold(f64::INFINITY, f64::min);
    let spill = basin.iter().map(|&c| flood.filled[c] as f64).fold(f64::NEG_INFINITY, f64::max);
    let depth = spill - bottom;
    assert!(basin.len() > 20 && depth > 0.8 && depth < 1.6, "a basin of {} cells, {depth} m deep", basin.len());
    // Half of the way at each pass: forty passes are far more than draining takes.
    for _ in 0..40 {
        flood.compute(&h, &grid, Some(&mut flow));
        carve_sills(&mut h, &flood, &grid, cell, 0.5, &mut basins, Some(flow.as_slice()));
    }
    flood.compute(&h, &grid, None);
    let pool = basin.iter().map(|&c| flood.filled[c] as f64 - h[c] as f64).fold(0.0_f64, f64::max);
    assert!(pool <= 0.12, "the basin drains: {pool} m of water left of {depth} m");
    let mut lowered: Vec<usize> = Vec::new();
    let mut deepest = 0.0_f64;
    for c in 0..n * n {
        let cut = before[c] as f64 - h[c] as f64;
        assert!(cut >= 0.0, "carving only lowers (cell {c})");
        assert!(cut <= depth + 0.02, "cell {c} is cut by {cut} m for a basin {depth} m deep");
        assert!(cut < 1e-6 || (h[c] as f64) >= bottom - 0.02, "cell {c} is cut under the floor of the basin");
        deepest = deepest.max(cut);
        if cut > 1e-3 && !basin.contains(&c) {
            lowered.push(c);
        }
    }
    eprintln!("sill: basin {} cells, {depth:.2} m deep; {pool:.3} m left; {} cells lowered below it, deepest cut {deepest:.2} m", basin.len(), lowered.len());
    assert!(lowered.len() >= 8, "{} cells lowered below the sill", lowered.len());
    let (x, y) = (|c: usize| (c % n) as isize, |c: usize| (c / n) as isize);
    let first = lowered[0];
    assert!(lowered.iter().any(|&c| y(c) != y(first)), "the cut is one row of the grid");
    assert!(lowered.iter().any(|&c| x(c) != x(first)), "the cut is one column of the grid");
    assert!(lowered.iter().any(|&c| x(c) - y(c) != x(first) - y(first)), "the cut is one diagonal of the grid");
    assert!(lowered.iter().any(|&c| x(c) + y(c) != x(first) + y(first)), "the cut is one diagonal of the grid");
}

/// A valley falling east by 1 m per 5 m cell, closed by a ridge 15 m high across it: a pond about 10.7 m deep
/// behind the ridge, which a cut of that depth through the crest drains.
fn dam(n: usize) -> Vec<f32> {
    (0..n * n)
        .map(|i| {
            let (x, y) = ((i % n) as f64, (i / n) as f64);
            (200.0 - x + 15.0 * (-((x - 30.0) / 2.0).powi(2)).exp() + 0.05 * (y - 32.0).powi(2)) as f32
        })
        .collect()
}

/// Invariants of a deep cut (deeper than a cell is wide): the pond drains within a few passes, the cut
/// is no deeper than the pond, and it is not a slot: the cells beside its deepest cell are cut too.
#[test]
fn a_deep_sill_cut_drains_the_pond_and_is_not_a_slot() {
    let (n, cell) = (64_usize, 5.0_f64);
    let grid = Grid::new(n);
    let before = dam(n);
    let mut h = before.clone();
    let mut flood = Flood::default();
    let mut basins = Basins::default();
    let mut flow: Vec<FlowCell> = Vec::new();
    flood.compute(&h, &grid, Some(&mut flow));
    let basin: Vec<usize> = (0..n * n).filter(|&c| flood.filled[c] - h[c] > 0.05).collect();
    let bottom = basin.iter().map(|&c| h[c] as f64).fold(f64::INFINITY, f64::min);
    let spill = basin.iter().map(|&c| flood.filled[c] as f64).fold(f64::NEG_INFINITY, f64::max);
    let depth = spill - bottom;
    assert!(basin.len() > 20 && depth > 8.0 && depth < 13.0, "a pond of {} cells, {depth} m deep", basin.len());
    assert!(depth > cell, "the cut is deeper than a cell is wide");
    // Half of the depth at each pass: twenty passes are far more than draining takes.
    for _ in 0..20 {
        flood.compute(&h, &grid, Some(&mut flow));
        carve_sills(&mut h, &flood, &grid, cell, 0.5, &mut basins, Some(flow.as_slice()));
    }
    flood.compute(&h, &grid, None);
    let pool = basin.iter().map(|&c| flood.filled[c] as f64 - h[c] as f64).fold(0.0_f64, f64::max);
    assert!(pool <= 0.12, "the pond drains: {pool} m of water left of {depth} m");
    let cut = |c: usize| before[c] as f64 - h[c] as f64;
    let mut deepest = 0_usize;
    for c in 0..n * n {
        assert!(cut(c) >= 0.0, "carving only lowers (cell {c})");
        assert!(cut(c) <= depth + 0.02, "cell {c} is cut by {} m for a pond {depth} m deep", cut(c));
        assert!(cut(c) < 1e-6 || (h[c] as f64) >= bottom - 0.02, "cell {c} is cut under the floor of the pond");
        if cut(c) > cut(deepest) {
            deepest = c;
        }
    }
    let beside = grid.neighbors(deepest).iter().filter(|&&q| q != usize::MAX && cut(q) > 0.15 * depth).count();
    eprintln!("deep sill: pond {depth:.2} m deep; {pool:.3} m left; deepest cut {:.2} m at cell {deepest}, {beside} of its neighbours cut by more than {:.2} m", cut(deepest), 0.15 * depth);
    assert!(cut(deepest) > 0.6 * depth, "the crest is cut through ({} m)", cut(deepest));
    assert!(beside >= 5, "the cut is a slot: only {beside} of the cells beside its deepest cell are cut");
}

/// A copy of the reach of `carve_sills` for the diagnosis below. `through_water`: the reach goes on under the water of
/// the basins below it and only stops where the water surface (the flood level) is under its profile; otherwise it
/// stops, as the library did, at the first ground under its profile. Returns one line per basin, with its size.
#[allow(clippy::too_many_arguments)]
fn carve_variant(h: &mut [f32], fl: &Flood, grid: &Grid, cell: f64, carve: f64, basins: &mut Basins, flow: &[FlowCell], through_water: bool, side_slope: f64) -> Vec<(usize, String)> {
    let mut lines = Vec::new();
    reset(&mut basins.component, h.len(), NONE);
    let mut target = vec![f32::INFINITY; h.len()];
    for start in 0..h.len() {
        if !basins.collect(start, h, fl, grid) {
            continue;
        }
        let cells = basins.cells.len();
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
        target[pour] = target[pour].min(level as f32);
        let mut r = fl.receiver[pour];
        let (mut turn, mut steps, mut cut, mut reason) = (0.0_f32, 0_usize, 0_usize, "the 400 cells of a reach");
        for _ in 0..400 {
            if r == NONE {
                reason = "the border";
                break;
            }
            level = (level - 0.01 * cell).max(floor);
            let old = h[r as usize] as f64;
            let surface = fl.filled[r as usize] as f64;
            if through_water {
                if surface <= level {
                    reason = "a water surface under its profile";
                    break;
                }
            } else if old <= level {
                reason = if surface > level { "ground under its profile, itself under the water of a basin that stays above the profile" } else { "free ground under its profile" };
                break;
            }
            if old > level {
                target[r as usize] = target[r as usize].min(level as f32);
                cut += 1;
                for (d, &q) in grid.neighbors(r as usize).iter().enumerate() {
                    if q != usize::MAX {
                        let side = (level + side_slope * cell * DIST[d]) as f32;
                        if side < target[q] {
                            target[q] = side;
                        }
                    }
                }
            }
            steps += 1;
            let f = flow[r as usize];
            r = if f.second != NONE {
                turn += f.fraction;
                if turn >= 0.5 {
                    turn -= 1.0;
                    f.second
                } else {
                    f.first
                }
            } else {
                fl.receiver[r as usize]
            };
        }
        lines.push((cells, format!("basin of {:.0} ha, {:.1} m deep, spill {spill:.1} m, outlet at cell ({}, {}): reach of {steps} cells, {cut} cut, stopped by {reason}",
            cells as f64 * cell * cell / 1e4, spill - bottom, pour % grid.n, pour / grid.n)));
    }
    for (value, &t) in h.iter_mut().zip(&target) {
        *value = value.min(t);
    }
    lines.sort_by(|a, b| b.0.cmp(&a.0));
    lines
}

/// Diagnosis, not a check (`--ignored --nocapture`): on the hills 40 km relief of the review probe, after its regional
/// erosion and final passes, what full-rate passes of the sill reach do to the basins that stay closed, with the reach
/// of the library and with a reach that goes on under the water of the basins below.
#[test]
#[ignore]
fn diagnose_closed_basins_of_a_hills_relief() {
    let (seed, width, relief) = ("rivers-a", 40_000.0_f64, "hills");
    let plan = crate::GenerationNoisePlan::erosion(seed, width, relief, 1.0, 10_000.0, 0.5).unwrap();
    let mut p = plan.parameters.clone();
    let mut s: Vec<f32> = p[24..32].to_vec();
    let old_cell = p[4];
    p[4] = (width * 1.44 / p[2] as f64) as f32;
    p[22] *= p[4] / old_cell;
    let (sn, old_sc) = (s[0] - 24.0, s[1]);
    s[1] = (width / sn as f64) as f32;
    s[2] = -12.0 * s[1];
    s[6] *= s[1] / old_sc;
    let flags: Vec<u32> = vec![0, 1, 1, 1, 1, 1, 1, 1, 1, 0, 0];
    let mut pipeline = TerrainPipeline::new(seed, &p, &s, &flags).unwrap();
    for stage in 0..3 {
        pipeline.advance(stage).unwrap();
    }
    let field = pipeline.height();
    let n = (field.len() as f64).sqrt().round() as usize;
    let cell = width / n as f64;
    let grid = Grid::new(n);
    eprintln!("regional grid cell {:.0} m, field {n} x {n} of {cell:.1} m, carve {} and final carve {}", p[4], p[34], p[35]);
    for through_water in [false, true] {
        let mut h = field.clone();
        let mut flood = Flood::default();
        let mut basins = Basins::default();
        let mut flow: Vec<FlowCell> = Vec::new();
        eprintln!("{}", if through_water { "REACH UNDER THE WATER OF THE BASINS BELOW" } else { "REACH OF THE LIBRARY" });
        for pass in 0..6 {
            flood.compute(&h, &grid, Some(&mut flow));
            let wet = (0..n * n).filter(|&c| flood.filled[c] - h[c] > 1.0).count();
            let lines = carve_variant(&mut h, &flood, &grid, cell, 1.0, &mut basins, &flow, through_water, 0.0);
            eprintln!("  pass {pass}: {:.2} % of the cells under more than 1 m, {} basins", 100.0 * wet as f64 / (n * n) as f64, lines.len());
            for (_, line) in lines.iter().take(if pass < 2 { 4 } else { 1 }) {
                eprintln!("     {line}");
            }
        }
        flood.compute(&h, &grid, None);
        let wet = (0..n * n).filter(|&c| flood.filled[c] - h[c] > 1.0).count();
        let lowered = (0..n * n).map(|c| (field[c] - h[c]) as f64).fold(0.0, f64::max);
        eprintln!("  after six passes: {:.2} % of the cells under more than 1 m; deepest cut {lowered:.1} m", 100.0 * wet as f64 / (n * n) as f64);
    }
}

/// Diagnosis, not a check (`--ignored --nocapture`): the final passes of the pipeline (`finish`: fill then full-rate
/// carve, twice) replayed with the library functions on the field left by the regional erosion, and repeated.
#[test]
#[ignore]
fn diagnose_final_passes_of_a_hills_relief() {
    let (seed, width, relief) = ("rivers-a", 40_000.0_f64, "hills");
    let plan = crate::GenerationNoisePlan::erosion(seed, width, relief, 1.0, 10_000.0, 0.5).unwrap();
    let mut p = plan.parameters.clone();
    let mut s: Vec<f32> = p[24..32].to_vec();
    let old_cell = p[4];
    p[4] = (width * 1.44 / p[2] as f64) as f32;
    p[22] *= p[4] / old_cell;
    let (sn, old_sc) = (s[0] - 24.0, s[1]);
    s[1] = (width / sn as f64) as f32;
    s[2] = -12.0 * s[1];
    s[6] *= s[1] / old_sc;
    let flags: Vec<u32> = vec![0, 1, 1, 1, 1, 1, 1, 1, 1, 0, 0];
    let mut pipeline = TerrainPipeline::new(seed, &p, &s, &flags).unwrap();
    for stage in 0..2 {
        pipeline.advance(stage).unwrap();
    }
    let field = pipeline.height();
    let n = (field.len() as f64).sqrt().round() as usize;
    let cell = width / n as f64;
    let grid = Grid::new(n);
    let fill = (p[33] * p[18] * 0.5) as f64;
    eprintln!("regional grid {} cells of {:.0} m, {} iterations, strength {}, fill {} (final fill {fill:.2}), carve {}, final carve {}; field {n} x {n} of {cell:.1} m",
        p[2], p[4], p[13], p[18], p[33], p[34], p[35]);
    let share = |h: &[f32], flood: &Flood| 100.0 * (0..n * n).filter(|&c| flood.filled[c] - h[c] > 1.0).count() as f64 / (n * n) as f64;
    for with_fill in [true, false] {
        let mut h = field.clone();
        let mut flood = Flood::default();
        let mut basins = Basins::default();
        let mut flow: Vec<FlowCell> = Vec::new();
        eprintln!("{}", if with_fill { "FILL THEN CARVE (as `finish`)" } else { "CARVE ONLY" });
        for pass in 0..8 {
            flood.compute(&h, &grid, Some(&mut flow));
            let before = share(&h, &flood);
            let pits = if with_fill { resolve_pits(&mut h, &flood, &grid, fill, &mut basins) } else { 1 };
            let carved = carve_sills(&mut h, &flood, &grid, cell, p[35] as f64, &mut basins, Some(flow.as_slice()));
            eprintln!("  pass {pass}: {before:.2} % of the cells under more than 1 m; {pits} basins filled, {carved} sills carved");
        }
        flood.compute(&h, &grid, None);
        eprintln!("  after eight passes: {:.2} %", share(&h, &flood));
    }
}

/// Diagnosis, not a check (`--ignored --nocapture`): does a drained basin stay drained when the erosion grid is
/// resampled to the finer source grid? The field left by the regional erosion is averaged to half its resolution,
/// drained there by six full-rate passes, then resampled back (bilinear, as `sample_height`); the share of cells
/// under water on both grids, for a reach one cell wide (sides at half a cell per cell) and a reach three cells wide (its
/// eight neighbours at its own level).
#[test]
#[ignore]
fn diagnose_drained_basins_after_resampling() {
    let (seed, width, relief) = ("rivers-a", 40_000.0_f64, "hills");
    let plan = crate::GenerationNoisePlan::erosion(seed, width, relief, 1.0, 10_000.0, 0.5).unwrap();
    let mut p = plan.parameters.clone();
    let mut s: Vec<f32> = p[24..32].to_vec();
    let old_cell = p[4];
    p[4] = (width * 1.44 / p[2] as f64) as f32;
    p[22] *= p[4] / old_cell;
    let (sn, old_sc) = (s[0] - 24.0, s[1]);
    s[1] = (width / sn as f64) as f32;
    s[2] = -12.0 * s[1];
    s[6] *= s[1] / old_sc;
    let flags: Vec<u32> = vec![0, 1, 1, 1, 1, 1, 1, 1, 1, 0, 0];
    let mut pipeline = TerrainPipeline::new(seed, &p, &s, &flags).unwrap();
    for stage in 0..2 {
        pipeline.advance(stage).unwrap();
    }
    let field = pipeline.height();
    let n = (field.len() as f64).sqrt().round() as usize;
    let m = n / 2;
    let coarse: Vec<f32> = (0..m * m)
        .map(|i| {
            let (x, y) = (2 * (i % m), 2 * (i / m));
            (field[y * n + x] + field[y * n + x + 1] + field[(y + 1) * n + x] + field[(y + 1) * n + x + 1]) / 4.0
        })
        .collect();
    let (fine_grid, coarse_grid) = (Grid::new(n), Grid::new(m));
    let wet = |h: &[f32], grid: &Grid| {
        let mut flood = Flood::default();
        flood.compute(h, grid, None);
        100.0 * (0..h.len()).filter(|&c| flood.filled[c] - h[c] > 1.0).count() as f64 / h.len() as f64
    };
    eprintln!("coarse grid {m} x {m} of {:.0} m: {:.2} % under more than 1 m before draining", width / m as f64, wet(&coarse, &coarse_grid));
    for (through_water, side_slope) in [(false, 0.5), (true, 0.5), (false, 0.0), (true, 0.0)] {
        let mut h = coarse.clone();
        let mut flood = Flood::default();
        let mut basins = Basins::default();
        let mut flow: Vec<FlowCell> = Vec::new();
        for _ in 0..6 {
            flood.compute(&h, &coarse_grid, Some(&mut flow));
            carve_variant(&mut h, &flood, &coarse_grid, width / m as f64, 1.0, &mut basins, &flow, through_water, side_slope);
        }
        let fine: Vec<f32> = (0..n * n)
            .map(|i| {
                let fx = (((i % n) as f64 + 0.5) / 2.0 - 0.5).clamp(0.0, m as f64 - 1.000001);
                let fy = (((i / n) as f64 + 0.5) / 2.0 - 0.5).clamp(0.0, m as f64 - 1.000001);
                let (x, y) = (fx as usize, fy as usize);
                let (u, v) = (fx - x as f64, fy - y as f64);
                let z = |a: usize, b: usize| h[b * m + a] as f64;
                ((z(x, y) * (1.0 - u) + z(x + 1, y) * u) * (1.0 - v) + (z(x, y + 1) * (1.0 - u) + z(x + 1, y + 1) * u) * v) as f32
            })
            .collect();
        let lowered = (0..m * m).filter(|&c| h[c] < coarse[c]).count();
        eprintln!("  reach {} wide, {}: {:.2} % under more than 1 m on the coarse grid, {:.2} % once resampled to the fine grid; {:.2} % of the cells lowered",
            if side_slope == 0.0 { "three cells" } else { "one cell" }, if through_water { "going on under the water below" } else { "stopping at the first lower ground" },
            wet(&h, &coarse_grid), wet(&fine, &fine_grid), 100.0 * lowered as f64 / (m * m) as f64);
    }
}
