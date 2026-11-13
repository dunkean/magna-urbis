//! Cross-sections of river valleys at each stage of the display relief chain, without a browser:
//! procedural relief -> hydrology grid -> pre-hydrology conditioning -> hydrology surface -> displayed height.
//! usage: valley_section_probe [relief=high-mountains] [width=12000] [seed=earth-alpine] [mode=both] [depth=8]
//!        [banks=valley|step] [lakes=0.5] [headwaters=1] [grid]
//! Environment: TABLE=1 times the V2 chain request (median of 3) and prints one line; LAKESTATS=1 stops after the
//! river and lake statistics; SECTIONS="x,y;x,y" replays given cross-sections.
//! The displayed height is `relief + B-spline(conditioning delta) + B-spline(hydrology surface - conditioned)`,
//! as `applyDelta` and `applyHydrologySurface` build it (river beds and spill notches excluded: bounded, local).
use magna_urbis_terrain::vector_water::{Conditioning, condition_relief};
use magna_urbis_terrain::{GenerationNoisePlan, HydrologyConfig, HydrologyEngine, TerrainGenerator, TerrainPipeline};

/// Cubic B-spline of a cell-centred grid at a world point (the kernel of `interpolate_delta`).
fn spline(grid: &[f32], n: usize, cell: f64, x: f64, y: f64) -> f64 {
    let w = |t: f64| {
        [
            (1.0 - t).powi(3) / 6.0,
            (3.0 * t.powi(3) - 6.0 * t * t + 4.0) / 6.0,
            (-3.0 * t.powi(3) + 3.0 * t * t + 3.0 * t + 1.0) / 6.0,
            t.powi(3) / 6.0,
        ]
    };
    let axis = |p: f64| {
        let g = (p / cell - 0.5).clamp(0.0, (n - 1) as f64);
        let i = g.floor() as isize;
        ([i - 1, i, i + 1, i + 2].map(|k| k.clamp(0, n as isize - 1) as usize), w(g - i as f64))
    };
    let ((xi, xw), (yi, yw)) = (axis(x), axis(y));
    let mut v = 0.0;
    for a in 0..4 {
        for b in 0..4 {
            v += grid[yi[a] * n + xi[b]] as f64 * yw[a] * xw[b];
        }
    }
    v
}

fn bilinear(grid: &[f32], n: usize, cell: f64, x: f64, y: f64) -> f64 {
    let (gx, gy) = ((x / cell - 0.5).clamp(0.0, (n - 1) as f64), (y / cell - 0.5).clamp(0.0, (n - 1) as f64));
    let (i, j) = ((gx.floor() as usize).min(n - 2), (gy.floor() as usize).min(n - 2));
    let (tx, ty) = (gx - i as f64, gy - j as f64);
    let at = |a: usize, b: usize| grid[b * n + a] as f64;
    (at(i, j) * (1.0 - tx) + at(i + 1, j) * tx) * (1.0 - ty) + (at(i, j + 1) * (1.0 - tx) + at(i + 1, j + 1) * tx) * ty
}

fn quantile(values: &mut [f64], q: f64) -> f64 {
    if values.is_empty() {
        return f64::NAN;
    }
    values.sort_by(f64::total_cmp);
    values[((values.len() - 1) as f64 * q).round() as usize]
}

fn main() {
    let a: Vec<String> = std::env::args().collect();
    let relief = a.get(1).map_or("high-mountains", String::as_str);
    let width: f64 = a.get(2).and_then(|v| v.parse().ok()).unwrap_or(12_000.0);
    let seed = a.get(3).map_or("earth-alpine", String::as_str);
    let mode = a.get(4).map_or("both", String::as_str);
    // Breach depth cap (the `condDepth` setting, m).
    let depth: f64 = a.get(5).and_then(|v| v.parse().ok()).unwrap_or(8.0);
    // Bank profile of the breaches (the `condBanks` setting): `valley` or `step`.
    let banks = a.get(6).cloned().unwrap_or_else(|| "valley".into());
    // Share of the closed depressions kept as lakes (the `lakeAbundance` setting), 0 to 2.
    let lakes: f64 = a.get(7).and_then(|v| v.parse().ok()).unwrap_or(0.5);
    // Headwaters setting of the vector rivers, 0 (off) to 1.
    let headwaters: f64 = a.get(8).and_then(|v| v.parse().ok()).unwrap_or(1.0);
    // The V2 vector water grid: the smallest power of two holding the 30 m source, 256 to 1024.
    let n: usize = a.get(9).and_then(|v| v.parse().ok()).unwrap_or_else(|| ((width / 30.0).log2().ceil().exp2() as usize).clamp(256, 1024));
    let motif = 10_000.0_f64;
    // River catchment threshold as the V2 sends it: from the map size, divided by the squared tributary density.
    let density: f64 = std::env::var("DENSITY").ok().and_then(|v| v.parse().ok()).unwrap_or(1.0);
    let river_area = (0.003 * (width / 1000.0).powi(2)).max(0.02) / density.max(0.05).powi(2);
    let cell = width / n as f64;

    // Relief: the retained procedural pipeline with the classic recipe (as terrain_stage_bench).
    let plan = GenerationNoisePlan::erosion(seed, width, relief, 1.0, motif, 0.5).unwrap();
    let mut p = plan.parameters.clone();
    let mut s: Vec<f32> = p[24..32].to_vec();
    let old_cell = p[4];
    p[4] = (width * 1.44 / p[2] as f64) as f32;
    p[22] *= p[4] / old_cell;
    let (sn, old_sc) = (s[0] - 24.0, s[1]);
    s[1] = (width / sn as f64) as f32;
    s[2] = -12.0 * s[1];
    s[6] *= s[1] / old_sc;
    let flags: Vec<u32> = vec![0, 1, 1, 1, 1, 1, 1, 1, 1, 0, (relief == "canyon") as u32];
    let mut pipeline = TerrainPipeline::new(seed, &p, &s, &flags).unwrap();
    for stage in 0..8 {
        pipeline.advance(stage).unwrap();
    }
    let generator = TerrainGenerator::new_mixed_with_source(seed, width, relief, 1.0, motif, 0.5, pipeline.take_height(), None).unwrap();
    let base = generator.sample_region(0.0, 0.0, width, n).unwrap().height;

    // Pre-hydrology conditioning (V2 defaults), then the Rust hydrology on the conditioned grid.
    let conditioning = Conditioning { mode: mode.into(), strength: 2.0, max_depth: depth, max_length: 3000.0, banks: banks.clone(), lakes, ..Conditioning::default() };
    if std::env::var("TABLE").is_ok() {
        // One line per case: the V2 chain request (conditioning + vector water) timed three times, then the cut.
        let header = serde_json::json!({"operation": "chain", "n": n, "width": width, "stats": false, "seed": seed,
            "conditioning": {"mode": mode, "strength": 2.0, "maxDepth": depth, "maxLength": 3000.0, "banks": banks, "lakes": lakes},
            "settings": {"riverArea": river_area, "lakeDepth": 1.0, "lakeArea": 10.0, "riverMode": "vector", "flatSlope": 1.0,
                "sinuosity": 1.8, "widthScale": 3.0, "balance": true, "braiding": 1.0, "anabranching": true, "terrainInfluence": true, "avulsions": true,
                "confluence": "climate", "deltas": true, "headwaters": headwaters},
            "climate": {"temperature": 9.0, "precipitation": 1500.0}});
        let mut json = serde_json::to_vec(&header).unwrap();
        json.resize(json.len().next_multiple_of(4), b' ');
        let mut body = (json.len() as u32).to_le_bytes().to_vec();
        body.extend_from_slice(&json);
        for v in &base {
            body.extend_from_slice(&v.to_le_bytes());
        }
        let (mut chain, mut cond, mut meta) = (Vec::new(), Vec::new(), serde_json::Value::Null);
        let (mut drainage, mut budget, mut traced) = (Vec::new(), Vec::new(), Vec::new());
        for _ in 0..3 {
            let t = std::time::Instant::now();
            let reply = magna_urbis_terrain::vector_water::request_with_clock(&body, &|| t.elapsed().as_secs_f64() * 1e3).unwrap();
            chain.push(t.elapsed().as_secs_f64() * 1e3);
            let len = u32::from_le_bytes(reply[..4].try_into().unwrap()) as usize;
            meta = serde_json::from_slice(&reply[4..4 + len]).unwrap();
            cond.push(meta["conditioning"]["ms"].as_f64().unwrap_or(f64::NAN));
            drainage.push(meta["water"]["hydrologyMs"].as_f64().unwrap_or(f64::NAN));
            budget.push(meta["water"]["balanceMs"].as_f64().unwrap_or(f64::NAN));
            traced.push(meta["water"]["rivers"]["ms"].as_f64().unwrap_or(f64::NAN));
        }
        println!("STAGES lakes={lakes} width={width} | conditioning {:.0} | drainage {:.0} | water budget {:.0} | rivers {:.0} | chain {:.0} ms",
            quantile(&mut cond.clone(), 0.5), quantile(&mut drainage, 0.5), quantile(&mut budget, 0.5), quantile(&mut traced, 0.5), quantile(&mut chain.clone(), 0.5));
        let result = condition_relief(&base, n, width, &conditioning, false);
        let display: Vec<f32> = (0..n * n).map(|i| (base[i] as f64 + spline(&result.delta, n, cell, ((i % n) as f64 + 0.5) * cell, ((i / n) as f64 + 0.5) * cell)) as f32).collect();
        let slope = |h: &[f32], i: usize| ((h[i + 1] - h[i - 1]) as f64).hypot((h[i + n] - h[i - n]) as f64) / (2.0 * cell);
        let inner = |i: usize| i % n > 0 && i % n < n - 1 && i / n > 0 && i / n < n - 1;
        let open: Vec<usize> = (0..n * n).filter(|&i| inner(i) && result.delta[i] <= -1.0 && slope(&base, i) < 0.2).collect();
        let steep = open.iter().filter(|&&i| slope(&display, i) > 0.35).count();
        let lowered = result.delta.iter().filter(|&&d| d <= -1.0).count();
        let cut: f64 = result.delta.iter().filter(|&&d| d < 0.0).map(|&d| -d as f64).sum::<f64>() * cell * cell / 1e6;
        println!("TABLE banks={} depth={depth} width={width} grid={n} | conditioning {:.0} ms | chain {:.0} ms | lowered>=1m {:.1} % | cut {:.0} hm3 | breaches {} | rivers {} | lakes {} ({:.2} km2) LAKES={lakes} HEADS={headwaters} DENSITY={density} | open-ground bank cells {} of which >0.35: {} ({:.1} %)",
            banks, quantile(&mut cond, 0.5), quantile(&mut chain, 0.5), 100.0 * lowered as f64 / (n * n) as f64, cut,
            result.breaches, meta["water"]["rivers"]["groups"][0], meta["water"]["lakes"], meta["water"]["lakeAreaKm2"].as_f64().unwrap_or(0.0),
            open.len(), steep, 100.0 * steep as f64 / open.len().max(1) as f64);
        return;
    }
    let started = std::time::Instant::now();
    let conditioned = condition_relief(&base, n, width, &conditioning, false);
    let conditioning_ms = started.elapsed().as_secs_f64() * 1e3;
    // The V2 water chain (vector water with the water budget) on the same conditioning: lakes and fills are what a
    // depression costs when it is not breached.
    {
        use magna_urbis_terrain::vector_water::{Climate, Settings, compute_water};
        let again = condition_relief(&base, n, width, &conditioning, true);
        let settings = Settings {
            river_area, lake_depth: 1.0, lake_area: 10.0, river_mode: "vector".into(),
            flat_slope: 1.0, sinuosity: 1.8, width_scale: 3.0, balance: true, braiding: 1.0, anabranching: true,
            terrain_influence: true, avulsions: true, confluence: "climate".into(), deltas: true, headwaters,
        };
        let water = compute_water(&again.height, n, width, &settings, Climate { temperature: 9.0, precipitation: 1500.0 }, seed, again.hydrology);
        let cell_km2 = cell * cell / 1e6;
        let raised = again.delta.iter().filter(|&&d| d > 0.5).count();
        let fill: f64 = again.delta.iter().filter(|&&d| d > 0.0).map(|&d| d as f64).sum::<f64>() * cell * cell;
        let lowered: f64 = again.delta.iter().filter(|&&d| d < 0.0).map(|&d| -d as f64).sum::<f64>() * cell * cell;
        println!("banks {banks} depth {depth} lakes {lakes} headwaters {headwaters} | breaches {} | depressions over 1 m: {} before, {} after ({:.2} -> {:.2} hm3 below their spill)",
            again.breaches, again.before.depressions, again.after.depressions, again.before.volume / 1e6, again.after.volume / 1e6);
        println!("vector water: lakes {} ({} closed), lake area {:.3} km2 ({} cells) | ground raised by fill over 0.5 m: {:.3} km2, fill {:.2} hm3, cut {:.2} hm3",
            water.lakes, water.closed_lakes, water.lake_area_km2, water.lake.iter().filter(|&&v| v != 0).count(), raised as f64 * cell_km2, fill / 1e6, lowered / 1e6);
        // River lengths, and how far the valley goes on above each source (same test as the headwaters).
        {
            use magna_urbis_terrain::vector_water::{HEADWATER_SHARE, valley_cell};
            let g = &water.hydro.grids;
            let mut donor = vec![usize::MAX; n * n];
            for c in 0..n * n {
                let r = g.receiver[c];
                if r >= 0 && (donor[r as usize] == usize::MAX || g.accumulation[c] > g.accumulation[donor[r as usize]]) {
                    donor[r as usize] = c;
                }
            }
            let low = settings.river_area * 1e6 * HEADWATER_SHARE;
            let (mut lengths, mut gaps) = (Vec::new(), Vec::new());
            for line in water.rivers.iter().flat_map(|r| &r.rivers) {
                let p = &line.points;
                lengths.push((1..p.len() / 2).map(|k| (p[2 * k] - p[2 * k - 2]).hypot(p[2 * k + 1] - p[2 * k - 1])).sum::<f64>());
                // Sources only: a line that starts at a lake outlet or a fork is not a head.
                let mut c = ((p[1] / cell) as usize).min(n - 1) * n + ((p[0] / cell) as usize).min(n - 1);
                if water.lake[c] != 0 {
                    continue;
                }
                let mut gap = 0.0;
                while donor[c] != usize::MAX && g.accumulation[donor[c]] as f64 >= low && valley_cell(&water.hydro.height, &g.receiver, n, cell, donor[c]) && gap < 5000.0 {
                    gap += cell * if donor[c] % n != c % n && donor[c] / n != c / n { std::f64::consts::SQRT_2 } else { 1.0 };
                    c = donor[c];
                }
                gaps.push(gap);
            }
            let short = lengths.iter().filter(|&&l| l < 500.0).count();
            let headless = gaps.iter().filter(|&&g| g > 2.0 * cell).count();
            println!("river lengths: {} lines, under 500 m {}, p10 {:.0} p25 {:.0} p50 {:.0} p75 {:.0} p90 {:.0} m, total {:.1} km | valley above the source: {} sources, over two cells for {}, p50 {:.0} p75 {:.0} p90 {:.0} max {:.0} m",
                lengths.len(), short, quantile(&mut lengths.clone(), 0.1), quantile(&mut lengths.clone(), 0.25), quantile(&mut lengths.clone(), 0.5), quantile(&mut lengths.clone(), 0.75),
                quantile(&mut lengths.clone(), 0.9), lengths.iter().sum::<f64>() / 1000.0, gaps.len(), headless, quantile(&mut gaps.clone(), 0.5), quantile(&mut gaps.clone(), 0.75),
                quantile(&mut gaps.clone(), 0.9), quantile(&mut gaps, 1.0));
        }
        // Lakes of the water budget, one record per connected lake: are they basins, flat, closed, with one outlet?
        {
            let (lake, height, g) = (&water.lake, &water.hydro.height, &water.hydro.grids);
            let level: &[f32] = water.lake_level.as_deref().unwrap_or(&g.filled);
            let mut id = vec![-1_i32; n * n];
            // area (ha), mean depth, deepest, compactness, mean width (m), level range, outlets
            let mut records: Vec<(f64, f64, f64, f64, f64, f64, usize)> = Vec::new();
            let (mut open, mut lowered) = (0_usize, 0_usize);
            for start in 0..n * n {
                if lake[start] == 0 || id[start] >= 0 {
                    continue;
                }
                let k = records.len() as i32;
                let mut stack = vec![start];
                id[start] = k;
                let (mut cells, mut depth, mut deepest, mut shore, mut lo, mut hi) = (0_usize, 0.0_f64, 0.0_f64, 0_usize, f64::MAX, f64::MIN);
                let mut outlets = std::collections::BTreeSet::new();
                while let Some(c) = stack.pop() {
                    cells += 1;
                    let d = level[c] as f64 - height[c] as f64;
                    depth += d;
                    deepest = deepest.max(d);
                    lo = lo.min(level[c] as f64);
                    hi = hi.max(level[c] as f64);
                    lowered += (again.delta[c] < -0.05) as usize;
                    for (dx, dy) in [(-1_i32, 0_i32), (1, 0), (0, -1), (0, 1), (-1, -1), (1, -1), (-1, 1), (1, 1)] {
                        let (xx, yy, side) = ((c % n) as i32 + dx, (c / n) as i32 + dy, dx == 0 || dy == 0);
                        if xx < 0 || yy < 0 || xx >= n as i32 || yy >= n as i32 {
                            shore += side as usize;
                            continue;
                        }
                        let nb = yy as usize * n + xx as usize;
                        if lake[nb] != 0 {
                            if id[nb] < 0 {
                                id[nb] = k;
                                stack.push(nb);
                            }
                        } else if side {
                            shore += 1;
                            // Dry ground well under the lake surface next to it: the shore would not close there.
                            open += ((height[nb] as f64) < level[c] as f64 - settings.lake_depth - 0.5) as usize;
                        }
                    }
                    // Where the water of this cell leaves the basin: the first cell under the lake level downstream.
                    let mut r = g.receiver[c];
                    if r >= 0 && lake[r as usize] == 0 {
                        for _ in 0..64 {
                            if r < 0 || (g.filled[r as usize] as f64) < level[c] as f64 - 0.01 {
                                break;
                            }
                            r = g.receiver[r as usize];
                        }
                        if r >= 0 && lake[r as usize] == 0 {
                            outlets.insert(r);
                        }
                    }
                }
                records.push((cells as f64 * cell * cell / 1e4, depth / cells as f64, deepest, 4.0 * std::f64::consts::PI * cells as f64 / (shore * shore) as f64,
                    2.0 * cells as f64 / shore as f64 * cell, hi - lo, outlets.len()));
            }
            let inside: usize = water.rivers.iter().flat_map(|r| &r.rivers).map(|line| {
                let m = line.points.len() / 2;
                (2..m.saturating_sub(2)).filter(|&k| lake[((line.points[2 * k + 1] / cell) as usize).min(n - 1) * n + ((line.points[2 * k] / cell) as usize).min(n - 1)] != 0).count()
            }).sum();
            let column = |f: &dyn Fn(&(f64, f64, f64, f64, f64, f64, usize)) -> f64| -> Vec<f64> { records.iter().map(f).collect() };
            let (mut area, mut depth, mut compact, mut wide) = (column(&|r| r.0), column(&|r| r.1), column(&|r| r.3), column(&|r| r.4));
            println!("lakes: {} | area p10 {:.1} p50 {:.1} p90 {:.1} max {:.1} ha | mean depth p10 {:.1} p50 {:.1} p90 {:.1} m, deepest {:.1} m | compactness min {:.2} p50 {:.2} | mean width min {:.0} m | level range max {:.2} m | shore open on {} cell sides | outlets 0/1/more: {}/{}/{} | river vertices inside a lake {} | lake cells lowered by the conditioning {}",
                records.len(), quantile(&mut area.clone(), 0.1), quantile(&mut area.clone(), 0.5), quantile(&mut area.clone(), 0.9), quantile(&mut area, 1.0),
                quantile(&mut depth.clone(), 0.1), quantile(&mut depth.clone(), 0.5), quantile(&mut depth, 0.9), records.iter().map(|r| r.2).fold(0.0, f64::max),
                quantile(&mut compact.clone(), 0.0), quantile(&mut compact, 0.5), quantile(&mut wide, 0.0), records.iter().map(|r| r.5).fold(0.0, f64::max), open,
                records.iter().filter(|r| r.6 == 0).count(), records.iter().filter(|r| r.6 == 1).count(), records.iter().filter(|r| r.6 > 1).count(), inside, lowered);
        }
        if std::env::var("LAKESTATS").is_ok() {
            return;
        }
    }
    let cfg = HydrologyConfig { temperature: 9.0, precipitation: 1500.0, ..HydrologyConfig::default() };
    let engine = HydrologyEngine::new(seed, width, n, &conditioned.height, false).unwrap();
    let hydro = engine.generate(&cfg).unwrap();
    let surface_delta: Vec<f32> = hydro.surface_height.iter().zip(&conditioned.height).map(|(a, b)| a - b).collect();
    let total_delta: Vec<f32> = conditioned.delta.iter().zip(&surface_delta).map(|(a, b)| a + b).collect();

    let (lo, hi) = base.iter().fold((f32::MAX, f32::MIN), |(l, h), &v| (l.min(v), h.max(v)));
    let rivers = hydro.river_offsets.len() - 1;
    println!("relief {relief} seed {seed} width {width} m, grid {n} ({cell:.2} m), heights {lo:.0}..{hi:.0} m, conditioning {mode}: {} steps, {} breaches, rivers {rivers}",
        conditioned.steps, conditioned.breaches);

    // Displayed height on the hydrology grid (B-spline at the cell centres) and its slopes.
    let display: Vec<f32> = (0..n * n)
        .map(|i| {
            let (x, y) = (((i % n) as f64 + 0.5) * cell, ((i / n) as f64 + 0.5) * cell);
            (base[i] as f64 + spline(&total_delta, n, cell, x, y)) as f32
        })
        .collect();
    let mut near = vec![false; n * n];
    for k in 0..hydro.river_points.len() / 4 {
        let (cx, cy) = ((hydro.river_points[k * 4] as f64 / cell) as isize, (hydro.river_points[k * 4 + 1] as f64 / cell) as isize);
        for y in (cy - 4).max(1)..=(cy + 4).min(n as isize - 2) {
            for x in (cx - 4).max(1)..=(cx + 4).min(n as isize - 2) {
                near[y as usize * n + x as usize] = true;
            }
        }
    }
    let slope = |h: &[f32], i: usize| ((h[i + 1] - h[i - 1]) as f64).hypot((h[i + n] - h[i - n]) as f64) / (2.0 * cell);
    println!("conditioning {conditioning_ms:.0} ms");
    // Bare rock is painted above a slope of about 0.35: share of such cells near the rivers and on the cut banks.
    let mut wide = vec![false; n * n];
    for k in 0..hydro.river_points.len() / 4 {
        let (cx, cy) = ((hydro.river_points[k * 4] as f64 / cell) as isize, (hydro.river_points[k * 4 + 1] as f64 / cell) as isize);
        for y in (cy - 10).max(1)..=(cy + 10).min(n as isize - 2) {
            for x in (cx - 10).max(1)..=(cx + 10).min(n as isize - 2) {
                wide[y as usize * n + x as usize] = true;
            }
        }
    }
    let inner = |i: usize| i % n > 0 && i % n < n - 1 && i / n > 0 && i / n < n - 1;
    let rock = |field: &[f32], keep: &dyn Fn(usize) -> bool| {
        let cells: Vec<usize> = (0..n * n).filter(|&i| inner(i) && keep(i)).collect();
        let steep = cells.iter().filter(|&&i| slope(field, i) > 0.35).count();
        (cells.len(), steep, 100.0 * steep as f64 / cells.len().max(1) as f64)
    };
    let sets: [(&str, &dyn Fn(usize) -> bool); 4] = [
        ("within 4 cells of a river", &|i: usize| near[i]),
        ("within 10 cells of a river", &|i: usize| wide[i]),
        ("bank cells (cut of 1 m or more)", &|i: usize| total_delta[i] <= -1.0),
        ("bank cells on open ground (relief slope under 0.2)", &|i: usize| total_delta[i] <= -1.0 && slope(&base, i) < 0.2),
    ];
    let mut open: Vec<f64> = (0..n * n).filter(|&i| inner(i) && total_delta[i] <= -1.0 && slope(&base, i) < 0.2).map(|i| slope(&display, i)).collect();
    println!("displayed slope of bank cells on open ground: p25 {:.2} p50 {:.2} p75 {:.2} p90 {:.2} p95 {:.2}, above 0.5: {}",
        quantile(&mut open.clone(), 0.25), quantile(&mut open.clone(), 0.5), quantile(&mut open.clone(), 0.75), quantile(&mut open.clone(), 0.9), quantile(&mut open.clone(), 0.95),
        open.iter().filter(|&&v| v > 0.5).count());
    open.clear();
    for (label, keep) in sets {
        let (before, after) = (rock(&base, keep), rock(&display, keep));
        println!("slope > 0.35, {label}: {} cells, relief {} ({:.1} %), displayed {} ({:.1} %)", before.0, before.1, before.2, after.1, after.2);
    }
    for (label, field) in [("relief", &base), ("displayed", &display)] {
        let (mut all, mut corridor) = (Vec::new(), Vec::new());
        for y in 1..n - 1 {
            for x in 1..n - 1 {
                let i = y * n + x;
                all.push(slope(field, i));
                if near[i] {
                    corridor.push(slope(field, i));
                }
            }
        }
        println!("slope {label:<9}: map max {:.2} p99 {:.2} | river corridors (4 cells) max {:.2} p90 {:.2} p50 {:.2}",
            quantile(&mut all.clone(), 1.0), quantile(&mut all, 0.99), quantile(&mut corridor.clone(), 1.0), quantile(&mut corridor.clone(), 0.9), quantile(&mut corridor, 0.5));
    }

    // Trench statistics over every river: depth of the change at the axis and width where it has halved.
    let delta_at = |x: f64, y: f64| spline(&total_delta, n, cell, x, y);
    let point = |k: usize| (hydro.river_points[k * 4] as f64, hydro.river_points[k * 4 + 1] as f64, hydro.river_points[k * 4 + 2] as f64);
    let frame = |k: usize, start: usize, end: usize| {
        let (a, b) = (point(k.saturating_sub(2).max(start)), point((k + 2).min(end - 1)));
        let l = (b.0 - a.0).hypot(b.1 - a.1).max(1e-6);
        ((b.0 - a.0) / l, (b.1 - a.1) / l)
    };
    let mut classes: Vec<(f64, f64, f64, f64)> = Vec::new(); // river width, axis depth, left reach, right reach
    let mut places: Vec<(f64, f64, usize, usize)> = Vec::new(); // river width, axis depth, river, point
    for r in 0..rivers {
        let (start, end) = (hydro.river_offsets[r] as usize, hydro.river_offsets[r + 1] as usize);
        for k in (start + 2..end.saturating_sub(2)).step_by(6) {
            let (x, y, w) = point(k);
            let (tx, ty) = frame(k, start, end);
            let depth = -(-30..=30).map(|o| delta_at(x - ty * o as f64, y + tx * o as f64)).fold(f64::MAX, f64::min);
            if depth < 2.0 || x < 300.0 || y < 300.0 || x > width - 300.0 || y > width - 300.0 {
                continue;
            }
            let reach = |sign: f64| (0..60).map(|o| o as f64 * 5.0).find(|&o| -delta_at(x - ty * o * sign, y + tx * o * sign) < depth * 0.25).unwrap_or(300.0);
            classes.push((w, depth, reach(-1.0), reach(1.0)));
            if x > 700.0 && y > 700.0 && x < width - 700.0 && y < width - 700.0 {
                places.push((w, depth, r, k));
            }
        }
    }
    classes.sort_by(|a, b| a.0.total_cmp(&b.0));
    println!("trench of the height change along rivers (reach = distance from the axis where the cut falls under 25% of its axis depth):");
    for (label, part) in [("small streams", &classes[..classes.len() / 3]), ("middle", &classes[classes.len() / 3..classes.len() * 2 / 3]), ("trunks", &classes[classes.len() * 2 / 3..])] {
        let mut depth: Vec<f64> = part.iter().map(|c| c.1).collect();
        let mut reach: Vec<f64> = part.iter().flat_map(|c| [c.2, c.3]).collect();
        let mut twin: Vec<f64> = part.iter().map(|c| (c.2 - c.3).abs()).collect();
        let mut river: Vec<f64> = part.iter().map(|c| c.0).collect();
        let deep = 100.0 * depth.iter().filter(|&&d| d > 15.0).count() as f64 / depth.len().max(1) as f64;
        println!("  {label:<13} n {:4} river width p50 {:5.1} m | axis cut p10 {:5.1} p50 {:5.1} p90 {:5.1} m, over 15 m {deep:2.0} % | reach p10 {:5.1} p50 {:5.1} p90 {:5.1} m | left-right difference p50 {:4.1} m",
            part.len(), quantile(&mut river, 0.5), quantile(&mut depth.clone(), 0.1), quantile(&mut depth.clone(), 0.5), quantile(&mut depth, 0.9),
            quantile(&mut reach.clone(), 0.1), quantile(&mut reach.clone(), 0.5), quantile(&mut reach, 0.9), quantile(&mut twin, 0.5));
    }

    // Two cross-sections: the widest river and a small one, at fixed places (stable under a profile change).
    // SECTIONS="x,y;x,y" replays given places (the nearest river point), to compare two builds at the same spots.
    let river_of = |k: usize| (0..rivers).find(|&r| k < hydro.river_offsets[r + 1] as usize).unwrap();
    let picks: Vec<(&str, usize, usize)> = match std::env::var("SECTIONS") {
        Ok(list) => list
            .split(';')
            .zip(["trunk", "tributary", "extra", "extra"])
            .map(|(place, label)| {
                let at: Vec<f64> = place.split(',').map(|v| v.trim().parse().unwrap()).collect();
                let k = (0..hydro.river_points.len() / 4)
                    .min_by(|&a, &b| (point(a).0 - at[0]).hypot(point(a).1 - at[1]).total_cmp(&(point(b).0 - at[0]).hypot(point(b).1 - at[1])))
                    .unwrap();
                (label, river_of(k), k)
            })
            .collect(),
        Err(_) => {
            // The widest river where the cut is deep, and a small stream with a middling cut.
            let trunk = places.iter().filter(|p| p.1 >= 20.0).max_by(|a, b| a.0.total_cmp(&b.0)).unwrap();
            let small: Vec<_> = { let mut v = places.clone(); v.sort_by(|a, b| a.0.total_cmp(&b.0)); v.truncate(places.len() / 3); v };
            let stream = small.iter().min_by(|a, b| (a.1 - 20.0).abs().total_cmp(&(b.1 - 20.0).abs())).unwrap();
            vec![("trunk", trunk.2, trunk.3), ("tributary", stream.2, stream.3)]
        }
    };
    for (label, r, k) in picks {
        let (start, end) = (hydro.river_offsets[r] as usize, hydro.river_offsets[r + 1] as usize);
        let (x, y, w) = point(k);
        let (tx, ty) = frame(k, start, end);
        let half = 260.0;
        let (ox, oy) = ((x - half).clamp(0.0, width - 2.0 * half), (y - half).clamp(0.0, width - 2.0 * half));
        let fine = generator.sample_region(ox, oy, 2.0 * half, 260).unwrap().height;
        println!("section {label}: river {r} at ({x:.1}, {y:.1}), water width {w:.1} m, water level {:.1} m", hydro.river_points[k * 4 + 3]);
        println!("  offset  relief  +conditioning  +hydrology  displayed | grid: base conditioned surface adjusted");
        for o in (-195..=195).step_by(15) {
            let (px, py) = (x - ty * o as f64, y + tx * o as f64);
            let ground = bilinear(&fine, 260, 2.0, px - ox, py - oy);
            let (c, h) = (spline(&conditioned.delta, n, cell, px, py), spline(&surface_delta, n, cell, px, py));
            println!("  {o:6} {ground:7.1} {c:14.1} {h:11.1} {:10.1} | {:10.1} {:11.1} {:7.1} {:8.1}", ground + c + h,
                bilinear(&base, n, cell, px, py), bilinear(&conditioned.height, n, cell, px, py),
                bilinear(&hydro.surface_height, n, cell, px, py), bilinear(&hydro.adjusted_height, n, cell, px, py));
        }
    }
}
