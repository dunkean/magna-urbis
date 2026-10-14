//! Network invariants of the hydrology on generated maps and climates. They
//! hold by construction; a failure is a defect of the method, not of a map.
//! `cargo test -p magna-urbis-core --release hydrology_invariants -- --nocapture`
use super::*;
use crate::TerrainGenerator;

struct Map {
    label: String,
    out: HydrologyOutput,
}

fn generate(seed: &str, relief: &str, temperature: f32, precipitation: f32) -> Map {
    let width = 40_000.0;
    let n = 256;
    let mut terrain = TerrainGenerator::new(seed, width, relief, 1.0, 8000.0).unwrap();
    terrain.set_coast(4, "island").unwrap();
    let height = terrain.sample_region(0.0, 0.0, width, n).unwrap().height;
    let engine = HydrologyEngine::new(seed, width, n, &height, true).unwrap();
    let cfg = HydrologyConfig {
        temperature,
        precipitation,
        ..HydrologyConfig::default()
    };
    let label = format!("{seed}/{relief}/{temperature}°C {precipitation} mm");
    let out = engine
        .generate(&cfg)
        .unwrap_or_else(|e| panic!("{label}: generation failed: {e}"));
    Map { label, out }
}

fn maps() -> Vec<Map> {
    let mut maps = Vec::new();
    for seed in ["a", "b", "c"] {
        for relief in ["hills", "mixed"] {
            for (t, p) in [(18.0, 1000.0), (23.0, 150.0)] {
                maps.push(generate(seed, relief, t, p));
            }
        }
    }
    maps
}

#[test]
fn flat_coast_seed_42_has_planar_downhill_drainage() {
    let width = 16_000.0;
    let n = 256;
    let mut terrain = TerrainGenerator::new("42", width, "flat", 1.0, 3000.0).unwrap();
    terrain.set_coast(16, "island").unwrap();
    let height = terrain.sample_region(0.0, 0.0, width, n).unwrap().height;
    let engine = HydrologyEngine::new("42", width, n, &height, true).unwrap();
    let cfg = HydrologyConfig::default();
    let budget = channel_bank_clearance(0.0, &cfg);
    let mut routed = flats::condition(
        engine.drainage.clone(),
        &height,
        &engine.sea,
        n,
        width as f32,
        "42",
        budget,
    );
    flats::resolve(
        &routed.filled,
        &height,
        &engine.sea,
        n,
        width as f32 / n as f32,
        &mut routed.receivers,
        budget,
    )
    .unwrap();
    for (i, &j) in routed.receivers.iter().enumerate() {
        if j == OUT {
            continue;
        }
        let j = j as usize;
        assert!(
            routed.filled[j] <= routed.filled[i],
            "uphill receiver {i} -> {j}"
        );
        if i % n != j % n && i / n != j / n {
            let a = i / n * n + j % n;
            let b = j / n * n + i % n;
            assert!(
                routed.receivers[a] != b as u32 && routed.receivers[b] != a as u32,
                "crossing receivers at {i} -> {j}"
            );
        }
    }
    rebuild_drainage(&mut routed, &engine.sea, width as f32 / n as f32).unwrap();
    engine.generate(&cfg).unwrap();
}

#[test]
fn channel_profile_saturated_station_uses_local_repair() {
    let cfg = HydrologyConfig {
        incision: 0.0,
        ..HydrologyConfig::default()
    };
    let mut ground = [1.0; 16];
    // This sub-millimetre rounding strip passes the crest tolerance, but the
    // downstream bound still requires an infinite upstream level.
    ground[1] = 1.0 + channel_bank_clearance(1.0, &cfg) + 0.00075;
    let context = RiverPatchContext {
        ground: &ground,
        lakes: &[0; 16],
        sea: &[false; 16],
        n: 4,
        cell: 1.0,
        cfg: &cfg,
    };
    let mut points: Vec<_> = (0..3)
        .map(|i| {
            (
                RiverPoint {
                    x: i as f32 + 0.5,
                    y: 0.5,
                    width: 1.0,
                    z: 1.0,
                },
                i as f32,
            )
        })
        .collect();
    let (required, crest) = profile_requirement(points[0].0, points[1].0, &context);
    assert!(required.is_infinite() && crest <= 1.001);
    assert_eq!(
        fit_channel_profile(&mut points, &[0.0, 2.0], &context),
        Err(0.0)
    );
    assert!(points.iter().all(|p| p.0.z == 1.0));
}

/// A course's segment: its river and both ends.
type Segment = (usize, (f32, f32), (f32, f32));

fn course(out: &HydrologyOutput, river: usize) -> &[f32] {
    &out.river_points
        [out.river_offsets[river] as usize * 4..out.river_offsets[river + 1] as usize * 4]
}

fn segment_distance(p: (f32, f32), a: (f32, f32), b: (f32, f32)) -> f32 {
    let (dx, dy) = (b.0 - a.0, b.1 - a.1);
    let t = (((p.0 - a.0) * dx + (p.1 - a.1) * dy) / (dx * dx + dy * dy).max(1e-9)).clamp(0.0, 1.0);
    (p.0 - a.0 - dx * t).hypot(p.1 - a.1 - dy * t)
}

/// Inside lake `id` (rings and their island holes, even–odd).
fn in_lake(out: &HydrologyOutput, id: u32, p: (f32, f32)) -> bool {
    let mut odd = false;
    for ring in 0..out.lake_offsets.len() - 1 {
        if out.lake_ring_meta[ring * 2] != id {
            continue;
        }
        let points: Vec<(f32, f32)> = (out.lake_offsets[ring]..out.lake_offsets[ring + 1])
            .map(|k| {
                (
                    out.lake_points[k as usize * 2],
                    out.lake_points[k as usize * 2 + 1],
                )
            })
            .collect();
        odd ^= inside(p, &points);
    }
    odd
}

fn node_kind(out: &HydrologyOutput, node: u32) -> u32 {
    out.node_meta[node as usize * 3 + 2]
}
fn node_lake(out: &HydrologyOutput, node: u32) -> u32 {
    out.node_meta[node as usize * 3 + 1]
}

#[test]
fn hydrology_invariants() {
    let mut failures = Vec::new();
    for map in maps() {
        let out = &map.out;
        let cell = out.width / out.resolution as f32;
        let rivers = out.river_offsets.len() - 1;
        let lakes = out.lake_meta.len() / 6;
        let mut fail = |what: String| failures.push(format!("{}: {what}", map.label));
        let mut outlets = vec![0; lakes + 1];
        for r in 0..rivers {
            let p = course(out, r);
            let m = p.len() / 4;
            if m < 2 {
                fail(format!("river {r} has {m} point"));
                continue;
            }
            let first = (p[0], p[1]);
            let last = (p[(m - 1) * 4], p[(m - 1) * 4 + 1]);
            let (from, to, host) = (
                out.river_meta[r * 6 + 1],
                out.river_meta[r * 6 + 2],
                out.river_meta[r * 6 + 3],
            );
            match node_kind(out, to) {
                // Lake inlet: the course ends in its lake's water.
                4 => {
                    let lake = node_lake(out, to);
                    if !in_lake(out, lake, last) {
                        let c = out.node_meta[to as usize * 3] as usize;
                        let centre = point(c, out.resolution, cell);
                        fail(format!(
                            "river {r} ends outside its lake {lake}: shore field {:.2} at its end, {:.2} at its node cell {:.0} m away",
                            bspline_sample(&out.water_field, out.resolution, cell, last.0, last.1),
                            bspline_at_cell(&out.water_field, out.resolution, c),
                            (last.0 - centre.0).hypot(last.1 - centre.1),
                        ));
                    }
                }
                1 | 0 => {
                    // A tributary ends on its downstream course.
                    if host == 0 {
                        fail(format!(
                            "river {r} ends at a node with no downstream course"
                        ));
                    } else {
                        let q = course(out, host as usize - 1);
                        let gap = (1..q.len() / 4)
                            .map(|k| {
                                segment_distance(
                                    last,
                                    (q[k * 4 - 4], q[k * 4 - 3]),
                                    (q[k * 4], q[k * 4 + 1]),
                                ) - 0.5 * q[k * 4 + 2].max(q[k * 4 - 2])
                            })
                            .fold(f32::INFINITY, f32::min);
                        if gap > 0.5 * cell {
                            fail(format!(
                                "river {r} ends {gap:.0} m from its downstream course {}",
                                host - 1
                            ));
                        }
                    }
                }
                2 => {
                    // A mouth ends where the sea is drawn.
                    let z =
                        bspline_sample(&out.surface_height, out.resolution, cell, last.0, last.1);
                    if z > 0.5 {
                        let c = out.node_meta[to as usize * 3] as usize;
                        let centre = point(c, out.resolution, cell);
                        fail(format!(
                            "river {r} reaches the sea {z:.1} m above the drawn coast ({} points, node cell drawn at {:.1} m, {:.0} m away, flags {})",
                            m,
                            bspline_at_cell(&out.surface_height, out.resolution, c),
                            (last.0 - centre.0).hypot(last.1 - centre.1),
                            out.river_meta[r * 6 + 4]
                        ));
                    }
                }
                3 => {
                    let border = last
                        .0
                        .min(last.1)
                        .min(out.width - last.0)
                        .min(out.width - last.1);
                    if border > 1.5 * cell {
                        fail(format!(
                            "river {r} ends at a map edge node {border:.0} m inside the map"
                        ));
                    }
                }
                _ => {}
            }
            // An outlet leaves from its lake's spill node; the reach from the
            // lake's open water to that node stays inside the lake.
            let (from_lake, to_lake) = (node_lake(out, from), node_lake(out, to));
            if node_kind(out, from) == 5 && to_lake != from_lake {
                outlets[from_lake as usize] += 1;
            }
            if node_kind(out, from) == 5
                && node_kind(out, to) == 5
                && to_lake == from_lake
                && !in_lake(out, from_lake, first)
            {
                fail(format!(
                    "river {r} leaves lake {from_lake} from outside its water"
                ));
            }
            // No course across a lake: a course meets only the lakes of its own nodes.
            for k in 0..m {
                let v = (p[k * 4], p[k * 4 + 1]);
                if let Some(lake) = (1..=lakes as u32)
                    .find(|&id| id != from_lake && id != to_lake && in_lake(out, id, v))
                {
                    fail(format!(
                        "river {r} crosses lake {lake} at ({:.0}, {:.0})",
                        v.0, v.1
                    ));
                    break;
                }
            }
        }
        for (id, &count) in outlets.iter().enumerate().skip(1) {
            let closed = out.lake_closed[id - 1] == 1;
            if !(out.lake_ring_meta.chunks(2).any(|m| m[0] == id as u32)) {
                fail(format!("lake {id} has no shore"));
            }
            let (ox, oy) = (
                out.lake_meta[(id - 1) * 6 + 4],
                out.lake_meta[(id - 1) * 6 + 5],
            );
            let at_edge = ox.min(oy).min(out.width - ox).min(out.width - oy) < cell;
            if closed && count != 0 {
                fail(format!("closed lake {id} has {count} outlets"));
            }
            if !closed && !at_edge && count != 1 {
                fail(format!("open lake {id} has {count} outlets"));
            }
        }
        // Courses never cross: two axes meet only at a shared node.
        let nodes: Vec<(f32, f32)> = out.node_points.chunks(2).map(|p| (p[0], p[1])).collect();
        let bin = 4.0 * cell;
        let mut bins: HashMap<(i32, i32), Vec<Segment>> = HashMap::default();
        for r in 0..rivers {
            let p = course(out, r);
            for k in 1..p.len() / 4 {
                let a = (p[k * 4 - 4], p[k * 4 - 3]);
                let b = (p[k * 4], p[k * 4 + 1]);
                let key = (
                    ((a.0 + b.0) * 0.5 / bin) as i32,
                    ((a.1 + b.1) * 0.5 / bin) as i32,
                );
                bins.entry(key).or_default().push((r, a, b));
            }
        }
        let mut crossings = 0;
        for (&(bx, by), list) in &bins {
            for dy in -1..=1 {
                for dx in -1..=1 {
                    let Some(other) = bins.get(&(bx + dx, by + dy)) else {
                        continue;
                    };
                    for &(r, a, b) in list {
                        for &(s, c, d) in other {
                            if s <= r || !segments_cross(a, b, c, d) {
                                continue;
                            }
                            let near_node = nodes
                                .iter()
                                .any(|&q| segment_distance(q, a, b) < 2.0 * cell);
                            if !near_node {
                                crossings += 1;
                            }
                        }
                    }
                }
            }
        }
        if crossings > 0 {
            fail(format!("{crossings} river crossings away from any node"));
        }
    }
    if !failures.is_empty() {
        panic!("{} violations:\n{}", failures.len(), failures.join("\n"));
    }
}

fn segments_cross(a: (f32, f32), b: (f32, f32), c: (f32, f32), d: (f32, f32)) -> bool {
    let orient = |p: (f32, f32), q: (f32, f32), r: (f32, f32)| {
        (q.0 - p.0) * (r.1 - p.1) - (q.1 - p.1) * (r.0 - p.0)
    };
    let (o1, o2, o3, o4) = (
        orient(a, b, c),
        orient(a, b, d),
        orient(c, d, a),
        orient(c, d, b),
    );
    o1 * o2 < 0.0 && o3 * o4 < 0.0
}
