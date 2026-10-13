//! Reruns road routing on a raster dumped from the terrain bench and reports the steepest
//! stretches with their surroundings.
//!
//! From web/: `DUMP=1 node scripts/terrain_roads_visual.mjs` writes out/terrain-roads/*-dump.json;
//! then `cargo run --release -p magna-urbis-core --example roads_inspect -- <dump.json> [seed] [roads JSON]`.
use magna_urbis_core::settlements::roads::{RoadConfig, RoadSite};
use magna_urbis_core::settlements::{Point, Raster, Terrain};

fn decode(text: &str) -> Vec<u8> {
    const TABLE: &[u8; 64] = b"ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/";
    let mut value = [255_u8; 256];
    for (i, &c) in TABLE.iter().enumerate() {
        value[c as usize] = i as u8;
    }
    let mut out = Vec::with_capacity(text.len() * 3 / 4);
    let (mut acc, mut bits) = (0_u32, 0);
    for &c in text.as_bytes() {
        let v = value[c as usize];
        if v == 255 {
            continue;
        }
        acc = (acc << 6) | v as u32;
        bits += 6;
        if bits >= 8 {
            bits -= 8;
            out.push((acc >> bits) as u8);
        }
    }
    out
}
fn floats(text: &str) -> Vec<f32> {
    decode(text)
        .as_chunks::<4>()
        .0
        .iter()
        .map(|b| f32::from_le_bytes(*b))
        .collect()
}
fn ints(text: &str) -> Vec<i32> {
    decode(text)
        .as_chunks::<4>()
        .0
        .iter()
        .map(|b| i32::from_le_bytes(*b))
        .collect()
}

fn main() {
    let args: Vec<String> = std::env::args().collect();
    let dump: serde_json::Value =
        serde_json::from_str(&std::fs::read_to_string(&args[1]).expect("dump file")).unwrap();
    let seed = args.get(2).map_or("7", String::as_str);
    let cfg: RoadConfig = args
        .get(3)
        .map_or_else(RoadConfig::default, |s| serde_json::from_str(s).unwrap());
    let width = dump["width"].as_f64().unwrap();
    let n = dump["n"].as_u64().unwrap() as usize;
    let height = floats(dump["height"].as_str().unwrap());
    let water = decode(dump["water"].as_str().unwrap());
    let level = floats(dump["waterLevel"].as_str().unwrap());
    let widths = floats(dump["riverWidth"].as_str().unwrap());
    let ids = ints(dump["riverIds"].as_str().unwrap());
    let sites: Vec<RoadSite> = serde_json::from_value(dump["sites"].clone()).unwrap();
    let terrain = Terrain::new(Raster {
        width,
        n,
        height: &height,
        water: &water,
        water_level: &level,
        river_width: &widths,
        river_ids: &ids,
    })
    .unwrap();
    let start = std::time::Instant::now();
    let out = terrain.roads(seed, &sites, &cfg).unwrap();
    println!(
        "{} sites, {} routes, {} segments, {:.1} km in {:?}",
        sites.len(),
        out.routes,
        out.segments.len(),
        out.segments.iter().map(|s| s.length).sum::<f64>() / 1000.0,
        start.elapsed()
    );
    let again = std::time::Instant::now();
    terrain.roads(seed, &sites, &cfg).unwrap();
    println!("reroute on the same terrain: {:?}", again.elapsed());
    let cell = width / n as f64;
    let index =
        |p: Point| ((p.y / cell) as usize).min(n - 1) * n + ((p.x / cell) as usize).min(n - 1);
    // Ground as the renderer interpolates it.
    let bilinear = |p: Point| {
        let gx = (p.x / cell - 0.5).clamp(0.0, (n - 1) as f64);
        let gy = (p.y / cell - 0.5).clamp(0.0, (n - 1) as f64);
        let (x0, y0) = (gx.floor() as usize, gy.floor() as usize);
        let (x1, y1) = ((x0 + 1).min(n - 1), (y0 + 1).min(n - 1));
        let (tx, ty) = (gx - x0 as f64, gy - y0 as f64);
        let h = |x: usize, y: usize| height[y * n + x] as f64;
        (h(x0, y0) * (1.0 - tx) + h(x1, y0) * tx) * (1.0 - ty)
            + (h(x0, y1) * (1.0 - tx) + h(x1, y1) * tx) * ty
    };
    // Share of the network length per grade band (raw height, one-cell steps, dry ground).
    let mut bands = [0.0_f64; 4];
    for s in &out.segments {
        for w in s.path.windows(2) {
            let l = (w[1].x - w[0].x).hypot(w[1].y - w[0].y);
            let k = (l / (0.5 * cell)).ceil().max(1.0) as usize;
            for q in 0..k {
                let t0 = q as f64 / k as f64;
                let t1 = (q + 1) as f64 / k as f64;
                let a = Point {
                    x: w[0].x + (w[1].x - w[0].x) * t0,
                    y: w[0].y + (w[1].y - w[0].y) * t0,
                };
                let b = Point {
                    x: w[0].x + (w[1].x - w[0].x) * t1,
                    y: w[0].y + (w[1].y - w[0].y) * t1,
                };
                let (i, j) = (index(a), index(b));
                if water[i] != 0 || water[j] != 0 || l < 1e-6 {
                    continue;
                }
                let g = (bilinear(a) - bilinear(b)).abs() / (l / k as f64);
                let band = if g <= 0.12 {
                    0
                } else if g <= 0.18 {
                    1
                } else if g <= 0.3 {
                    2
                } else {
                    3
                };
                bands[band] += l / k as f64;
            }
        }
    }
    let total: f64 = bands.iter().sum();
    println!(
        "grade bands (half-cell steps, bilinear ground): <=12% {:.1}% · 12-18% {:.1}% · 18-30% {:.1}% · >30% {:.1}%",
        100.0 * bands[0] / total,
        100.0 * bands[1] / total,
        100.0 * bands[2] / total,
        100.0 * bands[3] / total
    );
    // Doubled roads: length of a segment within `gap` of another one, away from junctions.
    let seg_dist = |p: Point, a: Point, b: Point| {
        let (dx, dy) = (b.x - a.x, b.y - a.y);
        let den = dx * dx + dy * dy;
        let t = if den > 0.0 {
            (((p.x - a.x) * dx + (p.y - a.y) * dy) / den).clamp(0.0, 1.0)
        } else {
            0.0
        };
        (p.x - a.x - t * dx).hypot(p.y - a.y - t * dy)
    };
    for gap in [1.0, 2.0] {
        let mut doubled = 0.0;
        let mut total = 0.0;
        for (i, s) in out.segments.iter().enumerate() {
            for w in s.path.windows(2) {
                let l = (w[1].x - w[0].x).hypot(w[1].y - w[0].y);
                let m = Point {
                    x: 0.5 * (w[0].x + w[1].x),
                    y: 0.5 * (w[0].y + w[1].y),
                };
                total += l;
                if out
                    .junctions
                    .iter()
                    .any(|j| (j.point.x - m.x).hypot(j.point.y - m.y) < 3.0 * cell)
                {
                    continue;
                }
                if out.segments.iter().enumerate().any(|(k, o)| {
                    k != i
                        && o.path
                            .windows(2)
                            .any(|v| seg_dist(m, v[0], v[1]) < gap * cell)
                }) {
                    doubled += l;
                }
            }
        }
        println!(
            "alongside another road within {gap} cell: {:.2}% of length",
            100.0 * doubled / total
        );
    }
    switchbacks(&out, cell);
    let mut segments: Vec<_> = out.segments.iter().collect();
    segments.sort_by(|a, b| b.grade.total_cmp(&a.grade));
    for s in segments.iter().take(4) {
        let ends = (&out.junctions[s.a], &out.junctions[s.b]);
        println!(
            "\n{} {} {} grade {:.3} length {:.0} m, ends {:?} / {:?}",
            s.class, s.surface, s.profile, s.grade, s.length, ends.0.site, ends.1.site
        );
        // Steepest one-cell step along the path, with its surroundings.
        let total = s.length;
        let steps = (total / cell).ceil() as usize;
        let at = |d: f64| {
            let mut along = 0.0;
            for w in s.path.windows(2) {
                let l = w[0].x.hypot(w[0].y) * 0.0 + (w[1].x - w[0].x).hypot(w[1].y - w[0].y);
                if along + l >= d {
                    let t = ((d - along) / l.max(1e-9)).clamp(0.0, 1.0);
                    return Point {
                        x: w[0].x + (w[1].x - w[0].x) * t,
                        y: w[0].y + (w[1].y - w[0].y) * t,
                    };
                }
                along += l;
            }
            *s.path.last().unwrap()
        };
        let mut worst = (0.0, 0.0);
        for k in 1..=steps {
            let (a, b) = (
                at((k - 1) as f64 * total / steps as f64),
                at(k as f64 * total / steps as f64),
            );
            let (i, j) = (index(a), index(b));
            if water[i] != 0 || water[j] != 0 {
                continue;
            }
            let g = (height[i] - height[j]).abs() as f64 / (total / steps as f64);
            if g > worst.0 {
                worst = (g, k as f64 * total / steps as f64);
            }
        }
        let p = at(worst.1);
        let nearest = sites
            .iter()
            .map(|t| ((t.center.x - p.x).hypot(t.center.y - p.y), &t.key))
            .min_by(|a, b| a.0.total_cmp(&b.0))
            .unwrap();
        println!(
            "  steepest raw step {:.3} at ({:.0}, {:.0}), {:.0} m along; nearest site {} at {:.0} m",
            worst.0, p.x, p.y, worst.1, nearest.1, nearest.0
        );
        let (cx, cy) = ((p.x / cell) as isize, (p.y / cell) as isize);
        for dy in -3..=3_isize {
            let row: Vec<String> = (-3..=3_isize)
                .map(|dx| {
                    let (x, y) = (
                        (cx + dx).clamp(0, n as isize - 1),
                        (cy + dy).clamp(0, n as isize - 1),
                    );
                    let i = y as usize * n + x as usize;
                    format!(
                        "{:6.1}{}",
                        height[i],
                        [' ', 's', 'l', 'r'][water[i] as usize]
                    )
                })
                .collect();
            println!("  {}", row.join(" "));
        }
    }
}

/// Switchback shape: hairpins (a heading reversal within a few cells), their leg spacing,
/// and self-crossings. Hatching shows as many hairpins with legs about one cell apart.
fn switchbacks(out: &magna_urbis_core::settlements::roads::RoadOutput, cell: f64) {
    let (mut hairpins, mut crossings, mut tight, mut length) = (0, 0, 0.0, 0.0);
    let mut legs = vec![];
    let mut spacings = vec![];
    for s in &out.segments {
        // Resample every half cell.
        let step = 0.5 * cell;
        let mut pts = vec![s.path[0]];
        let mut carry = 0.0;
        for w in s.path.windows(2) {
            let l = (w[1].x - w[0].x).hypot(w[1].y - w[0].y);
            let mut d = step - carry;
            while d <= l {
                let t = d / l;
                pts.push(Point {
                    x: w[0].x + (w[1].x - w[0].x) * t,
                    y: w[0].y + (w[1].y - w[0].y) * t,
                });
                d += step;
            }
            carry = l - (d - step);
        }
        length += s.length;
        let heading: Vec<f64> = pts
            .windows(2)
            .map(|w| (w[1].y - w[0].y).atan2(w[1].x - w[0].x))
            .collect();
        // A hairpin: headings 3 cells apart differ by more than 135 degrees.
        let k = 6;
        let mut last_turn: Option<usize> = None;
        let mut i = k;
        while i + k < heading.len() {
            let mut a = heading[i + k] - heading[i - k];
            while a > std::f64::consts::PI {
                a -= 2.0 * std::f64::consts::PI;
            }
            while a < -std::f64::consts::PI {
                a += 2.0 * std::f64::consts::PI;
            }
            if a.abs() > 0.75 * std::f64::consts::PI {
                hairpins += 1;
                if let Some(t) = last_turn {
                    legs.push((i - t) as f64 * step);
                }
                last_turn = Some(i);
                // Leg spacing: points 4 cells before and after the apex.
                let (p, q) = (pts[i.saturating_sub(8)], pts[(i + 8).min(pts.len() - 1)]);
                spacings.push((p.x - q.x).hypot(p.y - q.y));
                i += 2 * k;
                continue;
            }
            i += 1;
        }
        // Hatching: points with another part of the same road (6+ cells along) within 1.5 cells.
        for (a, p) in pts.iter().enumerate() {
            if pts
                .iter()
                .enumerate()
                .any(|(b, q)| a.abs_diff(b) > 12 && (p.x - q.x).hypot(p.y - q.y) < 1.5 * cell)
            {
                tight += step;
            }
        }
        for a in 0..s.path.len().saturating_sub(1) {
            for b in a + 2..s.path.len().saturating_sub(1) {
                let (p, q, r, t) = (s.path[a], s.path[a + 1], s.path[b], s.path[b + 1]);
                let d = (q.x - p.x) * (t.y - r.y) - (q.y - p.y) * (t.x - r.x);
                if d.abs() < 1e-12 {
                    continue;
                }
                let u = ((r.x - p.x) * (t.y - r.y) - (r.y - p.y) * (t.x - r.x)) / d;
                let v = ((r.x - p.x) * (q.y - p.y) - (r.y - p.y) * (q.x - p.x)) / d;
                if u > 1e-9 && u < 1.0 - 1e-9 && v > 1e-9 && v < 1.0 - 1e-9 {
                    crossings += 1;
                }
            }
        }
    }
    legs.sort_by(f64::total_cmp);
    spacings.sort_by(f64::total_cmp);
    let median = |v: &[f64]| if v.is_empty() { 0.0 } else { v[v.len() / 2] };
    println!(
        "switchbacks: {hairpins} hairpins ({:.1}/km) · median leg {:.0} m · median leg spacing {:.0} m (min {:.0}) · self-crossings {crossings} · hatched {:.1}% of length",
        hairpins as f64 / (length / 1000.0),
        median(&legs),
        median(&spacings),
        spacings.first().copied().unwrap_or(0.0),
        100.0 * tight / length
    );
}
