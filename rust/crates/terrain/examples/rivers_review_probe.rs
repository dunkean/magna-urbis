//! River planform and incision review, without a browser: the V2 vector water chain (conditioning + water budget +
//! vector rivers, V2 defaults) on procedural reference maps, measured per river reach and dumped for an image sheet.
//! usage: rivers_review_probe <out-dir> <label> [filter]
//!   out-dir: e.g. web/out/rivers-review; label: `before`, `after`...; filter: substring of the map name.
//! Environment: TIMES=n times each stage n times and keeps the fastest (default 2); OLD=1 uses the settings from
//! before the valley-bank commits (step banks, 30 m breaches, no kept lakes, no headwaters, 150 m courses);
//! MODE=none|erosion|breach|both overrides the conditioning mode (none: the rivers of the raw relief);
//! UNDULATION=x sets the strength of the marsh hollows on non-wetland maps (default 0: none);
//! LAKES=x sets the share of closed basins kept as lakes (default 0.5, the V2 `lakeAbundance`);
//! DESERT=1 runs every map under the desert climate (24 °C, 170 mm).
//! Besides the 16 reference maps: `flat-wetland-6km` and `flat-wetland-20km` (the V2 wetland defaults: every basin kept,
//! ponds from 0.2 m and 0.3 ha, undulations x3), `flat-temperate-6km` (the same plain, default zone) and
//! `hills-rivers-a-density04-10km` (river density 0.4, to compare with `hills-rivers-a-10km`).
//! Unless MODE is `none` (or NORELIEF is set), a second pass writes the same maps without conditioning under
//! `<label>-relief`: the thalwegs of the raw relief, measured by `rivers_review_relief.py` (ruled runs, notches).
//! Per map it writes `<label>/<map>.height.f32`, `.lake.u8`, `.json` (rivers, panels, metrics); `sheet.py` draws them.
//! Metrics, per slope class of the water surface (plain < 0.3 %, low < 1 %, mid < 4 %, steep, and canyon: banks more
//! than 5 m above the water 2.5 cells away): sinuosity of 400 m reaches, straight runs (vertices within
//! max(0.75 m, 0.15 width) of a chord), water surface rising downstream, bed rising downstream, and incision of the
//! bed and of the water surface below the lower bank.
use magna_urbis_terrain::vector_water::{Climate, Conditioning, Settings, condition_and_water_timed};
use magna_urbis_terrain::{GenerationNoisePlan, TerrainGenerator, TerrainPipeline};
use serde_json::json;
use std::time::Instant;

const CLASSES: [&str; 5] = ["plain", "low", "mid", "steep", "canyon"];
const REACH: f64 = 400.0;

/// Closed depressions of a relief (flood from the border and the sea): share of the cells under more than 1 m of
/// flood, the basins a lake could fill (1 m deep over 10 ha) and those the conditioning may keep (2 m over 15 ha),
/// and the deepest.
fn basin_stats(height: &[f32], n: usize, cell: f64) -> String {
    let g = magna_urbis_terrain::flood_grids(height, n, cell * cell, None, None, None);
    let total = n * n;
    let depth = |c: usize| g.filled[c] as f64 - height[c] as f64;
    let mut seen = vec![false; total];
    let (mut wet, mut lakes, mut keepable, mut deepest, mut lake_ha) = (0_usize, 0_usize, 0_usize, 0.0_f64, 0.0_f64);
    for start in 0..total {
        if seen[start] || depth(start) <= 0.05 {
            continue;
        }
        seen[start] = true;
        let (mut stack, mut cells, mut deep) = (vec![start], 0_usize, 0.0_f64);
        while let Some(c) = stack.pop() {
            cells += 1;
            deep = deep.max(depth(c));
            if depth(c) > 1.0 {
                wet += 1;
            }
            let (x, y) = ((c % n) as isize, (c / n) as isize);
            for dy in -1..=1_isize {
                for dx in -1..=1_isize {
                    let (xx, yy) = (x + dx, y + dy);
                    if xx >= 0 && yy >= 0 && xx < n as isize && yy < n as isize {
                        let q = yy as usize * n + xx as usize;
                        if !seen[q] && depth(q) > 0.05 && g.filled[q] == g.filled[c] {
                            seen[q] = true;
                            stack.push(q);
                        }
                    }
                }
            }
        }
        let ha = cells as f64 * cell * cell / 1e4;
        deepest = deepest.max(deep);
        if deep >= 1.0 && ha >= 10.0 {
            lakes += 1;
            lake_ha += ha;
        }
        if deep >= 2.0 && ha >= 15.0 {
            keepable += 1;
        }
    }
    format!("{:.1} % under more than 1 m | {lakes} basins of 1 m and 10 ha ({lake_ha:.0} ha), {keepable} of 2 m and 15 ha | deepest {deepest:.1} m",
        100.0 * wet as f64 / total as f64)
}

fn base_relief(relief: &str, width: f64, seed: &str, n: usize, coast: bool) -> Vec<f32> {
    // The retained procedural pipeline with the classic recipe (as valley_section_probe).
    let motif = 10_000.0_f64;
    if relief == "flat" {
        // Plains have no erosion pipeline: the analytic generator.
        return TerrainGenerator::new(seed, width, relief, 1.0, motif).unwrap().sample_region(0.0, 0.0, width, n).unwrap().height;
    }
    if let Some(family) = relief.strip_prefix("smooth-") {
        // A neural-like source: a smooth relief with broad basins and no erosion pipeline (the analytic generator).
        let mut generator = TerrainGenerator::new(seed, width, family, 1.0, motif).unwrap();
        if coast { generator.set_coast(16, "island").unwrap(); }
        return generator.sample_region(0.0, 0.0, width, n).unwrap().height;
    }
    let plan =GenerationNoisePlan::erosion(seed, width, relief, 1.0, motif, 0.5).unwrap();
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
        // DIAG=1: the closed basins after each stage of the relief pipeline (initialize, regional erosion, its final
        // passes, reconstruction, calibration, detail, surface erosion, normalisation).
        if std::env::var("DIAG").is_ok() {
            let h = pipeline.height();
            let m = (h.len() as f64).sqrt().round() as usize;
            let (lo, hi) = h.iter().fold((f32::MAX, f32::MIN), |(l, u), &v| (l.min(v), u.max(v)));
            println!("      stage {stage} ({m} x {m}, heights {lo:.0} to {hi:.0}): {}", basin_stats(&h, m, width / m as f64));
        }
    }
    let mut generator = TerrainGenerator::new_mixed_with_source(seed, width, relief, 1.0, motif, 0.5, pipeline.take_height(), None).unwrap();
    // `-coastS` maps: the V2 south coast (mask 16, island mode), as the local server calls it.
    if coast {
        generator.set_coast(16, "island").unwrap();
    }
    generator.sample_region(0.0, 0.0, width, n).unwrap().height
}

struct Ground<'a> {
    h: &'a [f32],
    n: usize,
    cell: f64,
}
impl Ground<'_> {
    fn at(&self, x: f64, y: f64) -> f64 {
        let n = self.n;
        let fx = (x / self.cell - 0.5).clamp(0.0, n as f64 - 1.000001);
        let fy = (y / self.cell - 0.5).clamp(0.0, n as f64 - 1.000001);
        let (i, j) = (fx as usize, fy as usize);
        let (u, v) = (fx - i as f64, fy - j as f64);
        let z = |a: usize, b: usize| self.h[b * n + a] as f64;
        (z(i, j) * (1.0 - u) + z(i + 1, j) * u) * (1.0 - v) + (z(i, j + 1) * (1.0 - u) + z(i + 1, j + 1) * u) * v
    }
}

fn quantile(values: &mut [f64], q: f64) -> f64 {
    if values.is_empty() {
        return f64::NAN;
    }
    values.sort_by(f64::total_cmp);
    values[((values.len() - 1) as f64 * q).round() as usize]
}

#[derive(Default, Clone)]
struct ClassStats {
    length: f64,
    chord: f64,
    meandered: f64,
    sinuosity: Vec<f64>,
    straight_longest: f64,
    straight_over_150: f64,
    straight_runs: usize,
    bed_incision: Vec<f64>,
    water_incision: Vec<f64>,
    depth: Vec<f64>,
    adverse: f64,
}

fn class_of(slope: f64, canyon: bool) -> usize {
    if canyon {
        4
    } else if slope < 0.003 {
        0
    } else if slope < 0.01 {
        1
    } else if slope < 0.04 {
        2
    } else {
        3
    }
}

fn main() {
    let a: Vec<String> = std::env::args().collect();
    let out = a.get(1).cloned().unwrap_or_else(|| "web/out/rivers-review".into());
    let label = a.get(2).cloned().unwrap_or_else(|| "before".into());
    let filter = a.get(3).cloned().unwrap_or_default();
    let times: usize = std::env::var("TIMES").ok().and_then(|v| v.parse().ok()).unwrap_or(2);
    let mode = std::env::var("MODE").unwrap_or_else(|_| "both".into());
    run(&out, &label, &filter, times, &mode);
    // The raw relief, first class: the same maps without conditioning, under `<label>-relief`. Its thalwegs are the
    // valleys of the relief itself; `rivers_review_relief.py` measures their ruled runs and their notches.
    if mode != "none" && std::env::var("NORELIEF").is_err() {
        run(&out, &format!("{label}-relief"), &filter, 1, "none");
    }
}

fn run(out: &str, label: &str, filter: &str, times: usize, mode: &str) {
    let old = std::env::var("OLD").is_ok();
    let dir = format!("{out}/{label}");
    std::fs::create_dir_all(&dir).unwrap();
    std::fs::create_dir_all(format!("{out}/panels")).unwrap();
    let mut total = vec![ClassStats::default(); 5];
    let (mut uphill_total, mut segments_total) = (0_usize, 0_usize);
    let (mut cond_total, mut water_total) = (0.0, 0.0);
    let mut rows = Vec::new();
    // Map, relief, seed, width (m), climate zone and river density (the V2 `Rivers` setting).
    let mut cases: Vec<(String, &str, &str, f64, &str, f64)> = Vec::new();
    for relief in ["flat", "hills", "mountains", "mixed"] {
        for seed in ["rivers-a", "rivers-b"] {
            for width in [10_000.0_f64, 40_000.0] {
                cases.push((format!("{relief}-{seed}-{}km", (width / 1000.0) as u32), relief, seed, width, "temperate", 1.0));
            }
        }
    }
    // A marsh at two sizes (the V2 wetland defaults) beside the same plain in the temperate zone, and one map at a low
    // river density, to compare with its row at the default density.
    cases.push(("flat-wetland-6km".into(), "flat", "rivers-a", 6_000.0, "wetland", 1.0));
    cases.push(("flat-wetland-20km".into(), "flat", "rivers-a", 20_000.0, "wetland", 1.0));
    cases.push(("flat-temperate-6km".into(), "flat", "rivers-a", 6_000.0, "temperate", 1.0));
    cases.push(("hills-rivers-a-density04-10km".into(), "hills", "rivers-a", 10_000.0, "temperate", 0.4));
    // The size and seed of the V2 default map (hills), for the cut-off loops drawn beside the rivers.
    cases.push(("hills-magna-urbis-6km".into(), "hills", "magna-urbis", 6_000.0, "temperate", 1.0));
    // Neural-like sources: smooth hills without the erosion pipeline.
    cases.push(("smooth-hills-rivers-a-10km".into(), "smooth-hills", "rivers-a", 10_000.0, "temperate", 1.0));
    cases.push(("smooth-hills-rivers-a-40km".into(), "smooth-hills", "rivers-a", 40_000.0, "temperate", 1.0));
    // Earlier hills example with the south coast.
    cases.push(("hills-magna-urbis-coastS-6km".into(), "hills", "magna-urbis", 6_000.0, "temperate", 1.0));
    // Decoded staircase code: the compact header overrides saved 6 km / hills with 10 km / mixed. The coast
    // remains south and the climate Nordic. Analytic proxy only: reproducing neural pixels needs its source DEM.
    cases.push(("smooth-mixed-magna-urbis-staircase-coastS-10km".into(), "smooth-mixed", "magna-urbis", 10_000.0, "nordic", 1.0));
    for (name, relief, seed, width, zone, density) in cases {
        {
            {
                let wet = zone == "wetland";
                if !name.contains(filter) {
                    continue;
                }
                let n = ((width / 30.0).log2().ceil().exp2() as usize).clamp(256, 1024);
                let cell = width / n as f64;
                let base = base_relief(relief, width, seed, n, name.contains("coastS"));
                let undulation: f64 = std::env::var("UNDULATION").ok().and_then(|v| v.parse().ok()).unwrap_or(0.0);
                // Share of the closed basins kept as lakes: the V2 default (`lakeAbundance`).
                let lake_share: f64 = std::env::var("LAKES").ok().and_then(|v| v.parse().ok()).unwrap_or(0.5);
                let mode = mode.to_string();
                let conditioning = if old {
                    Conditioning { mode: mode.clone(), strength: 2.0, max_depth: 30.0, max_length: 3000.0, banks: "step".into(), undulation, ..Conditioning::default() }
                } else {
                    Conditioning { mode: mode.clone(), strength: 2.0, max_depth: 8.0, max_length: 3000.0, banks: "valley".into(),
                        // The wetland zone as `effectiveTerrainSettings` and the bridge send it (`WETLAND_HYDROLOGY`).
                        lakes: if wet { 2.0 } else { lake_share }, lake_area: if wet { 0.3 } else { 10.0 }, lake_depth: if wet { 0.2 } else { 1.0 },
                        lake_coverage: if wet { 0.08 } else { 0.05 }, max_lake_area: if wet { 0.01 } else { 0.02 },
                        undulation: if wet { 2.0 } else { undulation }, ..Conditioning::default() }
                };
                let settings = Settings {
                    river_area: (0.003 * (width / 1000.0).powi(2)).max(0.02), lake_depth: if wet { 0.2 } else { 1.0 }, lake_area: if wet { 0.3 } else { 10.0 },
                    river_mode: "vector".into(), density: if density < 1.0 { density } else { 0.0 },
                    // Oxbow lakes: none, an occasional one in a marsh (as the bridge sends); OXBOWS=x overrides.
                    oxbows: std::env::var("OXBOWS").ok().and_then(|v| v.parse().ok()).unwrap_or(if wet { 0.35 } else { 0.0 }),
                    flat_slope: 1.0, sinuosity: 1.8, width_scale: 3.0, balance: true, braiding: 1.0, anabranching: true, terrain_influence: true,
                    avulsions: true, confluence: "climate".into(), deltas: true, headwaters: if old { 0.0 } else { 1.0 },
                    min_river_length: if old { 0.0 } else { 400.0 },
                };
                // DESERT=1: the V2 desert climate (closed basins dry up; courses must still reach an end).
                let climate = if std::env::var("DESERT").is_ok() { Climate { temperature: 24.0, precipitation: 170.0 } }
                    else if wet { Climate { temperature: 10.5, precipitation: 750.0 } }
                    else if zone == "nordic" { Climate { temperature: 4.5, precipitation: 850.0 } }
                    else { Climate { temperature: 10.0, precipitation: 1000.0 } };
                let (mut cond_ms, mut water_ms) = (f64::INFINITY, f64::INFINITY);
                let mut result = None;
                for _ in 0..times.max(1) {
                    // The V2 chain request: undulations, conditioning, water, beds of the final courses.
                    let t = Instant::now();
                    let clock = || t.elapsed().as_secs_f64() * 1e3;
                    let (conditioned, water, ms) = condition_and_water_timed(&base, n, width, &conditioning, &settings, climate, seed, true, &clock);
                    let all = clock();
                    cond_ms = cond_ms.min(ms);
                    water_ms = water_ms.min(all - ms);
                    let height = conditioned.height;
                    result = Some((height, water));
                }
                let (height, water) = result.unwrap();
                cond_total += cond_ms;
                water_total += water_ms;
                let ground = Ground { h: &height, n, cell };
                let network = water.rivers.as_ref().unwrap();
                let mut stats = vec![ClassStats::default(); 5];
                let (mut uphill, mut segments) = (0_usize, 0_usize);
                // Panel candidates: the longest straight run on a low slope, and the deepest canyon vertex.
                let (mut plain_at, mut canyon_at) = ((0.0, 0.0, 0.0), (0.0, 0.0, 0.0));
                // The longest straight run left on a plain or low slope, for the extra panel of this run.
                let mut worst_at = (0.0, 0.0, 0.0);
                let mut lines = Vec::new();
                let mut river_lengths: Vec<f64> = Vec::new();
                for line in &network.rivers {
                    let m = line.points.len() / 2;
                    if m < 3 {
                        continue;
                    }
                    let pt = |k: usize| (line.points[2 * k], line.points[2 * k + 1]);
                    let wide: Vec<f64> = line.area.iter().map(|&v| settings.width_scale * 3.0 * (v / 1e6).powf(0.45)).collect();
                    let mut arc = vec![0.0; m];
                    for k in 1..m {
                        arc[k] = arc[k - 1] + (pt(k).0 - pt(k - 1).0).hypot(pt(k).1 - pt(k - 1).1);
                    }
                    river_lengths.push(arc[m - 1]);
                    let bed: Vec<f64> = (0..m).map(|k| ground.at(pt(k).0, pt(k).1)).collect();
                    // Per vertex: lower bank beside the channel, and the lower valley side 2.5 cells away.
                    let (mut bank, mut side) = (vec![0.0; m], vec![0.0; m]);
                    for k in 0..m {
                        let (p0, p1) = (pt(k.saturating_sub(2)), pt((k + 2).min(m - 1)));
                        let l = (p1.0 - p0.0).hypot(p1.1 - p0.1).max(1e-9);
                        let (nx, ny) = (-(p1.1 - p0.1) / l, (p1.0 - p0.0) / l);
                        let (x, y) = pt(k);
                        let at = |d: f64| ground.at(x + nx * d, y + ny * d).min(ground.at(x - nx * d, y - ny * d));
                        // The bank top: the edge of the cut bed (`incision.rs`: bed, then a bank of the channel width,
                        // 2.5 cells at least). Before this batch the bank was one cell and sampled at half a width + a cell.
                        bank[k] = at((0.5 * wide[k]).max(0.75 * cell) + wide[k].max(2.5 * cell));
                        side[k] = at(2.5 * cell);
                    }
                    for k in 0..m - 1 {
                        segments += 1;
                        uphill += (line.level[k + 1] > line.level[k] + 1e-4) as usize;
                    }
                    // Reaches of 400 m.
                    let mut i = 0;
                    while i < m - 1 {
                        let mut j = i + 1;
                        while j < m - 1 && arc[j] - arc[i] < REACH {
                            j += 1;
                        }
                        if arc[m - 1] - arc[j] < REACH / 2.0 {
                            j = m - 1;
                        }
                        let path = arc[j] - arc[i];
                        if path < 100.0 {
                            break;
                        }
                        let chord = (pt(j).0 - pt(i).0).hypot(pt(j).1 - pt(i).1).max(1e-6);
                        let slope = ((line.level[i] - line.level[j]) / path).max(0.0);
                        let mut walls: Vec<f64> = (i..=j).map(|k| side[k] - line.level[k]).collect();
                        let canyon = quantile(&mut walls, 0.5) > 5.0;
                        let s = &mut stats[class_of(slope, canyon)];
                        s.length += path;
                        s.chord += chord;
                        s.sinuosity.push(path / chord);
                        for k in i..j {
                            let step = arc[k + 1] - arc[k];
                            if line.kind[k + 1] == 1.0 {
                                s.meandered += step;
                            }
                            s.bed_incision.push(bank[k] - bed[k]);
                            s.water_incision.push(bank[k] - line.level[k]);
                            s.depth.push(line.level[k] - bed[k]);
                            // Bed rising downstream: over three cells of course, by more than 0.25 m.
                            let mut q = k;
                            while q < m - 1 && arc[q] - arc[k] < 3.0 * cell {
                                q += 1;
                            }
                            if bed[q] > bed[k] + 0.25 {
                                s.adverse += step;
                            }
                            if side[k] - line.level[k] > canyon_at.2 && pt(k).0 > 0.1 * width && pt(k).0 < 0.9 * width && pt(k).1 > 0.1 * width && pt(k).1 < 0.9 * width {
                                canyon_at = (pt(k).0, pt(k).1, side[k] - line.level[k]);
                            }
                        }
                        i = j;
                    }
                    // Straight runs (greedy, maximal).
                    let mut i = 0;
                    while i < m - 1 {
                        let mut j = i + 1;
                        loop {
                            if j + 1 >= m {
                                break;
                            }
                            let (ax, ay) = pt(i);
                            let (bx, by) = pt(j + 1);
                            let l = (bx - ax).hypot(by - ay).max(1e-9);
                            let tol = (0.15 * wide[i]).max(0.75);
                            let ok = (i + 1..=j).all(|k| (((pt(k).0 - ax) * (by - ay) - (pt(k).1 - ay) * (bx - ax)) / l).abs() <= tol);
                            if !ok {
                                break;
                            }
                            j += 1;
                        }
                        let run = (pt(j).0 - pt(i).0).hypot(pt(j).1 - pt(i).1);
                        if run >= 100.0 {
                            let slope = ((line.level[i] - line.level[j]) / run).max(0.0);
                            let mid = (i + j) / 2;
                            let class = class_of(slope, side[mid] - line.level[mid] > 5.0);
                            let s = &mut stats[class];
                            s.straight_runs += 1;
                            s.straight_longest = s.straight_longest.max(run);
                            if run >= 150.0 {
                                s.straight_over_150 += run;
                            }
                            let inner = |p: (f64, f64)| p.0 > 0.1 * width && p.0 < 0.9 * width && p.1 > 0.1 * width && p.1 < 0.9 * width;
                            if class <= 1 && run > worst_at.2 && inner(pt(mid)) {
                                worst_at = (pt(mid).0, pt(mid).1, run);
                            }
                            if class <= 1 && run * wide[mid].max(3.0).sqrt() > plain_at.2 && inner(pt(mid)) {
                                plain_at = (pt(mid).0, pt(mid).1, run * wide[mid].max(3.0).sqrt());
                            }
                        }
                        i = j;
                    }
                    lines.push(json!({
                        "points": line.points.iter().map(|v| (v * 10.0).round() / 10.0).collect::<Vec<_>>(),
                        "width": wide.iter().map(|v| (v * 10.0).round() / 10.0).collect::<Vec<_>>(),
                        "kind": line.kind,
                    }));
                }
                // Panels are chosen once (the first run of a map) and reused, so before and after show the same places.
                let panel_file = format!("{out}/panels/{name}.json");
                let panels: serde_json::Value = match std::fs::read(&panel_file) {
                    Ok(bytes) => serde_json::from_slice(&bytes).unwrap(),
                    Err(_) => {
                        let v = json!({"plain": [plain_at.0, plain_at.1], "canyon": [canyon_at.0, canyon_at.1]});
                        std::fs::write(&panel_file, serde_json::to_vec(&v).unwrap()).unwrap();
                        v
                    }
                };
                let mut classes = serde_json::Map::new();
                println!("== {name} grid {n} ({cell:.1} m) | conditioning {cond_ms:.0} ms | water {water_ms:.0} ms | lines {} | {:.1} km, meandered {:.1} km in {} runs | lakes {} | water surface rising on {uphill} of {segments} segments",
                    network.rivers.len(), network.length_km, network.meander_km, network.meander_runs, water.lakes);
                for (c, s) in stats.iter().enumerate() {
                    if s.length <= 0.0 {
                        continue;
                    }
                    let row = class_row(s);
                    println!("   {:<7} {}", CLASSES[c], row.1);
                    classes.insert(CLASSES[c].into(), row.0);
                    merge(&mut total[c], s);
                }
                uphill_total += uphill;
                segments_total += segments;
                let lake_share_of_map = 100.0 * water.lake.iter().filter(|&&v| v != 0).count() as f64 / (n * n) as f64;
                // Per lake (8-connected lake cells): its size (ha) and its deepest water (m).
                let (mut lake_ha, mut lake_deep): (Vec<f64>, Vec<f64>) = (Vec::new(), Vec::new());
                {
                    let level: &[f32] = water.lake_level.as_deref().unwrap_or(&water.hydro.grids.filled[..]);
                    let mut seen = vec![false; n * n];
                    for start in 0..n * n {
                        if water.lake[start] == 0 || seen[start] {
                            continue;
                        }
                        seen[start] = true;
                        let (mut stack, mut cells, mut deep) = (vec![start], 0_usize, 0.0_f64);
                        while let Some(c) = stack.pop() {
                            cells += 1;
                            if level[c].is_finite() {
                                deep = deep.max(level[c] as f64 - height[c] as f64);
                            }
                            let (x, y) = ((c % n) as isize, (c / n) as isize);
                            for dy in -1..=1_isize {
                                for dx in -1..=1_isize {
                                    let (xx, yy) = (x + dx, y + dy);
                                    if xx >= 0 && yy >= 0 && xx < n as isize && yy < n as isize {
                                        let q = yy as usize * n + xx as usize;
                                        if water.lake[q] != 0 && !seen[q] {
                                            seen[q] = true;
                                            stack.push(q);
                                        }
                                    }
                                }
                            }
                        }
                        lake_ha.push(cells as f64 * cell * cell / 1e4);
                        lake_deep.push(deep);
                    }
                }
                let quant = |v: &Vec<f64>, p: f64| quantile(&mut v.clone(), p);
                println!("   lakes   {} drawn ({} in the water budget), {:.2} km2, {lake_share_of_map:.2} % of the map | size p10 {:.2} p50 {:.2} p90 {:.2} max {:.2} ha | deepest water p10 {:.2} p50 {:.2} p90 {:.2} max {:.2} m",
                    lake_ha.len(), water.lakes, water.lake_area_km2, quant(&lake_ha, 0.1), quant(&lake_ha, 0.5), quant(&lake_ha, 0.9), quant(&lake_ha, 1.0),
                    quant(&lake_deep, 0.1), quant(&lake_deep, 0.5), quant(&lake_deep, 0.9), quant(&lake_deep, 1.0));
                // Oxbows (cut-off loops kept as water beside a course): their lines, and the place of the longest one.
                let mut oxbow_lines = Vec::new();
                let (mut oxbow_at, mut oxbow_km) = ((0.0_f64, 0.0_f64, 0.0_f64), 0.0_f64);
                for line in &network.oxbows {
                    let m = line.points.len() / 2;
                    if m < 2 {
                        continue;
                    }
                    let mut length = 0.0;
                    for k in 1..m {
                        length += (line.points[2 * k] - line.points[2 * k - 2]).hypot(line.points[2 * k + 1] - line.points[2 * k - 1]);
                    }
                    oxbow_km += length / 1000.0;
                    if length > oxbow_at.2 {
                        oxbow_at = (line.points[2 * (m / 2)], line.points[2 * (m / 2) + 1], length);
                    }
                    let wide = settings.width_scale * 3.0 * (line.area[0] / 1e6).powf(0.45);
                    oxbow_lines.push(json!({
                        "points": line.points.iter().map(|v| (v * 10.0).round() / 10.0).collect::<Vec<_>>(),
                        "width": vec![(wide * 10.0).round() / 10.0; m],
                        "kind": vec![9.0; m],
                    }));
                }
                println!("   oxbows  {} ({oxbow_km:.2} km), braids {}, distributaries {}; the longest oxbow, {:.0} m, at ({:.0}, {:.0})",
                    network.oxbows.len(), network.braids.len(), network.distributaries.len(), oxbow_at.2, oxbow_at.0, oxbow_at.1);
                println!("   basins  raw relief: {}", basin_stats(&base, n, cell));
                println!("   basins  after the chain: {}", basin_stats(&height, n, cell));
                // Loose or short pieces of water: every piece shorter than the shortest river kept, and every piece whose
                // downstream end reaches no river, lake, sea or map edge.
                let shortest = if settings.min_river_length > 0.0 { settings.min_river_length } else { 150.0 };
                let mut vertices: Vec<(f64, f64)> = Vec::new();
                for line in &network.rivers {
                    for k in 0..line.points.len() / 2 {
                        vertices.push((line.points[2 * k], line.points[2 * k + 1]));
                    }
                }
                let mut loose: Vec<String> = Vec::new();
                let (mut short_count, mut loose_count) = (0_usize, 0_usize);
                // Ends of the river courses by kind (the downstream end): "nothing" must be 0.
                let mut ends: std::collections::BTreeMap<&'static str, usize> = std::collections::BTreeMap::new();
                {
                    let mut piece = |group: &str, points: &[f64], kind: &[f64], joins: Option<i32>| {
                        let m = points.len() / 2;
                        if m < 2 {
                            return;
                        }
                        let mut length = 0.0;
                        for k in 1..m {
                            length += (points[2 * k] - points[2 * k - 2]).hypot(points[2 * k + 1] - points[2 * k - 1]);
                        }
                        let (sx, sy, ex, ey) = (points[0], points[1], points[2 * m - 2], points[2 * m - 1]);
                        let wet_near = |x: f64, y: f64| {
                            let (cx, cy) = ((x / cell) as isize, (y / cell) as isize);
                            (-1..=1_isize).any(|dy| {
                                (-1..=1_isize).any(|dx| {
                                    let (xx, yy) = (cx + dx, cy + dy);
                                    xx >= 0 && yy >= 0 && xx < n as isize && yy < n as isize && {
                                        let q = yy as usize * n + xx as usize;
                                        water.lake[q] != 0 || water.hydro.grids.sea[q] != 0 || height[q] <= 0.0
                                    }
                                })
                            })
                        };
                        let edge = |x: f64, y: f64| x <= cell || y <= cell || x >= width - cell || y >= width - cell;
                        // Another river within a cell and a half (not counting the piece's own vertices for a river).
                        let near_river = |x: f64, y: f64| vertices.iter().any(|&(vx, vy)| (vx - x).hypot(vy - y) <= 1.5 * cell);
                        let down = if joins.unwrap_or(-1) >= 0 {
                            "a river"
                        } else if wet_near(ex, ey) {
                            "a lake or the sea"
                        } else if edge(ex, ey) {
                            "the map edge"
                        } else if group != "river" && near_river(ex, ey) {
                            "a river"
                        } else {
                            "nothing"
                        };
                        let up = if wet_near(sx, sy) {
                            "a lake or the sea"
                        } else if edge(sx, sy) {
                            "the map edge"
                        } else if group != "river" && near_river(sx, sy) {
                            "a river"
                        } else {
                            "open ground"
                        };
                        if group == "river" {
                            *ends.entry(down).or_default() += 1;
                        }
                        if length < shortest {
                            short_count += 1;
                        }
                        if down == "nothing" {
                            loose_count += 1;
                        }
                        if length < shortest || down == "nothing" {
                            loose.push(format!("{group}, {length:.0} m, kind {:.0}, from ({sx:.0}, {sy:.0}) on {up} to ({ex:.0}, {ey:.0}) on {down}",
                                kind.get(m / 2).copied().unwrap_or(-1.0)));
                        }
                    };
                    for line in &network.rivers {
                        piece("river", &line.points, &line.kind, line.joins);
                    }
                    for line in &network.braids {
                        piece("braid", &line.points, &line.kind, line.joins);
                    }
                    for line in &network.distributaries {
                        piece("distributary", &line.points, &line.kind, line.joins);
                    }
                    for line in &network.lake_links {
                        piece("lake link", &line.points, &line.kind, line.joins);
                    }
                    for line in &network.oxbows {
                        piece("oxbow", &line.points, &line.kind, line.joins);
                    }
                }
                println!("   ends    {}", ends.iter().map(|(k, v)| format!("{k}: {v}")).collect::<Vec<_>>().join(", "));
                println!("   pieces  {short_count} shorter than {shortest:.0} m, {loose_count} ending on nothing (rivers {}, braids {}, distributaries {}, lake links {}, oxbows {})",
                    network.rivers.len(), network.braids.len(), network.distributaries.len(), network.lake_links.len(), network.oxbows.len());
                for entry in loose.iter().take(if std::env::var("PIECES").is_ok() { 400 } else { 12 }) {
                    println!("           {entry}");
                }
                // Straight valleys of the final relief, drawn or not: the D8 thalwegs (catchment over a quarter of the
                // river threshold) that lie in a valley (ground 1 m higher 3 cells away on both sides), measured as
                // runs whose cell centres stay within 0.75 cell of their chord.
                {
                    let g = magna_urbis_terrain::flood_grids(&height, n, cell * cell, None, None, None);
                    let threshold = 0.25 * settings.river_area * 1e6;
                    let valley = |c: usize| {
                        let (x, y) = ((c % n) as isize, (c / n) as isize);
                        let z = height[c];
                        let up = |dx: isize, dy: isize| {
                            let (xx, yy) = (x + dx, y + dy);
                            xx >= 0 && yy >= 0 && xx < n as isize && yy < n as isize && height[yy as usize * n + xx as usize] > z + 1.0
                        };
                        (up(3, 0) && up(-3, 0)) || (up(0, 3) && up(0, -3)) || (up(2, 2) && up(-2, -2)) || (up(2, -2) && up(-2, 2))
                    };
                    let head: Vec<bool> = {
                        let mut fed = vec![false; n * n];
                        for c in 0..n * n {
                            let r = g.receiver[c];
                            if r >= 0 && g.accumulation[c] as f64 >= threshold {
                                fed[r as usize] = true;
                            }
                        }
                        (0..n * n).map(|c| g.accumulation[c] as f64 >= threshold && !fed[c]).collect()
                    };
                    let (mut ruled, mut total, mut longest, mut at) = (0.0_f64, 0.0_f64, 0.0_f64, (0.0, 0.0));
                    let mut seen = vec![false; n * n];
                    for start in 0..n * n {
                        if !head[start] {
                            continue;
                        }
                        let mut chain = vec![start];
                        let mut c = start;
                        while g.receiver[c] >= 0 && !seen[g.receiver[c] as usize] && height[g.receiver[c] as usize] > 0.0 {
                            c = g.receiver[c] as usize;
                            seen[c] = true;
                            chain.push(c);
                        }
                        let pt = |c: usize| (((c % n) as f64 + 0.5) * cell, ((c / n) as f64 + 0.5) * cell);
                        let mut i = 0;
                        while i + 1 < chain.len() {
                            let mut j = i + 1;
                            while j + 1 < chain.len() {
                                let ((ax, ay), (bx, by)) = (pt(chain[i]), pt(chain[j + 1]));
                                let l = (bx - ax).hypot(by - ay).max(1e-9);
                                if !(i + 1..=j).all(|k| { let (px, py) = pt(chain[k]); (((px - ax) * (by - ay) - (py - ay) * (bx - ax)) / l).abs() <= 0.75 * cell }) {
                                    break;
                                }
                                j += 1;
                            }
                            let ((ax, ay), (bx, by)) = (pt(chain[i]), pt(chain[j]));
                            let run = (bx - ax).hypot(by - ay);
                            let deep = chain[i..=j].iter().filter(|&&c| valley(c)).count() * 2 > j - i + 1;
                            if deep {
                                total += run;
                                if run >= 300.0 {
                                    ruled += run;
                                }
                                if run > longest {
                                    longest = run;
                                    at = ((ax + bx) / 2.0, (ay + by) / 2.0);
                                }
                            }
                            i = j;
                        }
                    }
                    println!("   valleys {:.1} km of thalweg in valleys, {:.1} % in straight runs >= 300 m, longest {longest:.0} m at ({:.0}, {:.0})",
                        total / 1000.0, 100.0 * ruled / total.max(1.0), at.0, at.1);
                }
                // Short river courses that no other course joins (leaves): what a post-tracing length rule would drop.
                {
                    let joined: std::collections::HashSet<i32> = network.rivers.iter().filter_map(|l| l.joins).filter(|&j| j >= 0).collect();
                    let len_of = |p: &[f64]| (1..p.len() / 2).map(|k| (p[2 * k] - p[2 * k - 2]).hypot(p[2 * k + 1] - p[2 * k - 1])).sum::<f64>();
                    let (mut leaves, mut leaf_km, mut stems) = (0_usize, 0.0_f64, 0_usize);
                    for line in &network.rivers {
                        let l = len_of(&line.points);
                        if l < shortest {
                            if line.id.is_some_and(|id| joined.contains(&(id as i32))) {
                                stems += 1;
                            } else {
                                leaves += 1;
                                leaf_km += l / 1000.0;
                            }
                        }
                    }
                    println!("   short   {leaves} short leaf courses ({leaf_km:.2} km), {stems} short courses that others join");
                }
                // Braid threads: arc length L, channel width W of the river (thread area x 3), and the peak offset P of
                // the thread from its river. A "U": L < 4 P (a bump, not an elongated island), or L < 12 W.
                {
                    let mut ratios: Vec<f64> = Vec::new();
                    let mut widths: Vec<f64> = Vec::new();
                    let (mut bumps, mut short_w) = (0_usize, 0_usize);
                    let mut listed: Vec<String> = Vec::new();
                    for thread in &network.braids {
                        let m = thread.points.len() / 2;
                        if m < 2 {
                            continue;
                        }
                        let owner = network.rivers.iter().find(|l| l.id == thread.id);
                        let l: f64 = (1..m).map(|k| (thread.points[2 * k] - thread.points[2 * k - 2]).hypot(thread.points[2 * k + 1] - thread.points[2 * k - 1])).sum();
                        let w = settings.width_scale * 3.0 * (3.0 * thread.area[m / 2] / 1e6).powf(0.45);
                        let mut peak = 0.0_f64;
                        if let Some(owner) = owner {
                            for k in 0..m {
                                let (x, y) = (thread.points[2 * k], thread.points[2 * k + 1]);
                                let d = (0..owner.points.len() / 2)
                                    .map(|q| (owner.points[2 * q] - x).hypot(owner.points[2 * q + 1] - y))
                                    .fold(f64::INFINITY, f64::min);
                                peak = peak.max(d);
                            }
                        }
                        ratios.push(l / peak.max(1e-6));
                        widths.push(l / w);
                        let bump = l < 4.0 * peak;
                        bumps += bump as usize;
                        short_w += (l < 12.0 * w) as usize;
                        if (bump || l < 12.0 * w) && listed.len() < 8 {
                            listed.push(format!("braid {l:.0} m, width {w:.1} m, peak {peak:.0} m, at ({:.0}, {:.0})", thread.points[m], thread.points[m + 1]));
                        }
                    }
                    let quant = |v: &Vec<f64>, p: f64| quantile(&mut v.clone(), p);
                    println!("   braids  {} threads | L/P p10 {:.1} p50 {:.1} | L/W p10 {:.1} p50 {:.1} | {bumps} bumps (L < 4 P), {short_w} short (L < 12 W)",
                        ratios.len(), quant(&ratios, 0.1), quant(&ratios, 0.5), quant(&widths, 0.1), quant(&widths, 0.5));
                    for entry in &listed {
                        println!("           {entry}");
                    }
                }
                // Pieces near the places reported on the user's map (coast S): the U piece and the 70 m river.
                if name.contains("magna-urbis") {
                    for (px, py) in [(1200.0_f64, 3881.0_f64), (1383.0, 3634.0)] {
                        for (group, lines) in [("river", &network.rivers), ("braid", &network.braids), ("lake link", &network.lake_links)] {
                            for line in lines.iter() {
                                let m = line.points.len() / 2;
                                let near = (0..m).map(|k| (line.points[2 * k] - px).hypot(line.points[2 * k + 1] - py)).fold(f64::INFINITY, f64::min);
                                if near < 250.0 {
                                    let l: f64 = (1..m).map(|k| (line.points[2 * k] - line.points[2 * k - 2]).hypot(line.points[2 * k + 1] - line.points[2 * k - 1])).sum();
                                    println!("   near ({px:.0}, {py:.0}): {group} id {:?} joins {:?}, {l:.0} m, {near:.0} m away, from ({:.0}, {:.0}) to ({:.0}, {:.0}), kind at mid {}",
                                        line.id, line.joins, line.points[0], line.points[1], line.points[2 * m - 2], line.points[2 * m - 1], line.kind[m / 2]);
                                }
                            }
                        }
                    }
                }
                println!("   rivers  {} courses (density {density}) | length p10 {:.0} p50 {:.0} p90 {:.0} max {:.0} m, {:.1} km in all",
                    river_lengths.len(), quant(&river_lengths, 0.1), quant(&river_lengths, 0.5), quant(&river_lengths, 0.9), quant(&river_lengths, 1.0),
                    river_lengths.iter().sum::<f64>() / 1000.0);
                rows.push(json!({"map": name, "conditioningMs": cond_ms, "waterMs": water_ms, "classes": classes,
                    "lakes": lake_ha.len(), "budgetLakes": water.lakes, "lakeAreaKm2": water.lake_area_km2, "lakePct": lake_share_of_map,
                    "lakeHaP50": quant(&lake_ha, 0.5), "lakeHaP90": quant(&lake_ha, 0.9), "lakeDeepP50": quant(&lake_deep, 0.5),
                    "lakeDeepP90": quant(&lake_deep, 0.9), "zone": zone, "density": density, "rivers": river_lengths.len(),
                    "riverLengthP50": quant(&river_lengths, 0.5), "riverLengthP90": quant(&river_lengths, 0.9),
                    "riverKm": river_lengths.iter().sum::<f64>() / 1000.0}));
                let bytes: Vec<u8> = height.iter().flat_map(|v| v.to_le_bytes()).collect();
                std::fs::write(format!("{dir}/{name}.height.f32"), bytes).unwrap();
                std::fs::write(format!("{dir}/{name}.lake.u8"), &water.lake).unwrap();
                std::fs::write(
                    format!("{dir}/{name}.json"),
                    serde_json::to_vec(&json!({"name": name, "n": n, "width": width, "lines": lines, "panels": panels, "worst": [worst_at.0, worst_at.1, worst_at.2],
                        "oxbows": oxbow_lines, "oxbowAt": [oxbow_at.0, oxbow_at.1, oxbow_at.2],
                        "conditioningMs": cond_ms, "waterMs": water_ms, "classes": classes})).unwrap(),
                )
                .unwrap();
            }
        }
    }
    println!("== ALL MAPS ({label}) | conditioning {cond_total:.0} ms | water {water_total:.0} ms | water surface rising on {uphill_total} of {segments_total} segments");
    let mut classes = serde_json::Map::new();
    for (c, s) in total.iter().enumerate() {
        if s.length > 0.0 {
            let row = class_row(s);
            println!("   {:<7} {}", CLASSES[c], row.1);
            classes.insert(CLASSES[c].into(), row.0);
        }
    }
    std::fs::write(
        format!("{dir}/metrics.json"),
        serde_json::to_vec_pretty(&json!({"label": label, "conditioningMs": cond_total, "waterMs": water_total,
            "uphillSegments": uphill_total, "segments": segments_total, "classes": classes, "maps": rows})).unwrap(),
    )
    .unwrap();
}

fn merge(into: &mut ClassStats, s: &ClassStats) {
    into.length += s.length;
    into.chord += s.chord;
    into.meandered += s.meandered;
    into.sinuosity.extend_from_slice(&s.sinuosity);
    into.straight_longest = into.straight_longest.max(s.straight_longest);
    into.straight_over_150 += s.straight_over_150;
    into.straight_runs += s.straight_runs;
    into.bed_incision.extend_from_slice(&s.bed_incision);
    into.water_incision.extend_from_slice(&s.water_incision);
    into.depth.extend_from_slice(&s.depth);
    into.adverse += s.adverse;
}

fn class_row(s: &ClassStats) -> (serde_json::Value, String) {
    let share = |v: &[f64], f: &dyn Fn(f64) -> bool| 100.0 * v.iter().filter(|&&x| f(x)).count() as f64 / v.len().max(1) as f64;
    let sinuosity = s.length / s.chord.max(1e-9);
    let (p50, p10) = (quantile(&mut s.sinuosity.clone(), 0.5), quantile(&mut s.sinuosity.clone(), 0.1));
    let nearly_straight = share(&s.sinuosity, &|v| v < 1.02);
    let bed = quantile(&mut s.bed_incision.clone(), 0.5);
    let bed_low = share(&s.bed_incision, &|v| v < 0.3);
    let surface = quantile(&mut s.water_incision.clone(), 0.5);
    let surface_low = share(&s.water_incision, &|v| v < 0.1);
    let depth = quantile(&mut s.depth.clone(), 0.5);
    let perched = share(&s.depth, &|v| v > 1.0);
    let value = json!({
        "km": s.length / 1000.0, "sinuosity": sinuosity, "sinuosityP50": p50, "sinuosityP10": p10, "reachesUnder1_02Pct": nearly_straight,
        "meanderedPct": 100.0 * s.meandered / s.length, "straightLongestM": s.straight_longest, "straightOver150Pct": 100.0 * s.straight_over_150 / s.length,
        "straightRuns": s.straight_runs, "bedIncisionP50": bed, "bedIncisionUnder0_3Pct": bed_low, "surfaceBelowBankP50": surface,
        "surfaceBelowBankUnder0_1Pct": surface_low, "waterOverGroundP50": depth, "waterOverGroundAbove1Pct": perched, "adverseBedPct": 100.0 * s.adverse / s.length,
    });
    let text = format!(
        "{:7.1} km | sinuosity {:.3} (p10 {:.3} p50 {:.3}, reaches < 1.02: {:4.1} %) meandered {:4.1} % | straight: longest {:5.0} m, {:4.1} % of length in runs >= 150 m ({} runs >= 100 m) | bed below bank p50 {:5.2} m, < 0.3 m: {:4.1} % | surface below bank p50 {:5.2} m, < 0.1 m: {:4.1} % | water over ground p50 {:5.2} m, > 1 m: {:4.1} % | bed rising {:4.1} %",
        s.length / 1000.0, sinuosity, p10, p50, nearly_straight, 100.0 * s.meandered / s.length, s.straight_longest, 100.0 * s.straight_over_150 / s.length,
        s.straight_runs, bed, bed_low, surface, surface_low, depth, perched, 100.0 * s.adverse / s.length
    );
    (value, text)
}
