//! Symbolic relief probe: soft-brush and straight-edged paintings -> generated relief.
//! Writes one PPM sheet (rows = maps; columns = painted map, seed 1, seed 2) and prints
//! per-zone elevation statistics and timings.
//! usage: zones_probe [tag] [out dir] [captured /terrain body.json ...]
//! Without bodies: the synthetic set plus the two captured V2 symbolic requests.
use magna_urbis_terrain::{
    EROSION_TUNING, TerrainGenerator, TerrainZones, ZONE_CHANNELS, set_erosion_tuning,
};
use std::time::Instant;

const R: usize = 128; // painted canvas resolution
const WIDTH: f64 = 20000.0;
const MOTIF: f64 = 10000.0;
const SOURCE_N: usize = 512;
const TILE: usize = 512;
const SEEDS: [&str; 2] = ["symbolic-a", "symbolic-b"];
// Match effectiveTerrainSettings: hills carrier, flat environment, no mountain mix.
const BASE_RELIEF: &str = "hills";
const NAMES: [&str; 6] = ["auto", "sea", "plain", "hills", "mountains", "high"];
const SEA: usize = 0;
const PLAIN: usize = 1;
const HILLS: usize = 2;
const MOUNT: usize = 3;
const HIGH: usize = 4;

/// Float canvas: per cell five channel weights in 0..1, sum <= 1.
struct Canvas(Vec<[f64; ZONE_CHANNELS]>);

fn hash(i: i64, salt: u64) -> f64 {
    let mut h = (i as u64).wrapping_mul(0x9E3779B97F4A7C15) ^ salt.wrapping_mul(0xC2B2AE3D27D4EB4F);
    h ^= h >> 29;
    h = h.wrapping_mul(0xBF58476D1CE4E5B9);
    h ^= h >> 32;
    (h >> 11) as f64 / (1u64 << 53) as f64
}
/// Smooth 1-D value noise in -1..1, used to wobble the brush like a hand would.
fn wobble(t: f64, salt: u64) -> f64 {
    let i = t.floor();
    let f = t - i;
    let s = f * f * (3.0 - 2.0 * f);
    let a = hash(i as i64, salt);
    let b = hash(i as i64 + 1, salt);
    (a + (b - a) * s) * 2.0 - 1.0
}

impl Canvas {
    fn new() -> Self {
        Self(vec![[0.0; ZONE_CHANNELS]; R * R])
    }
    fn fill(&mut self, ch: usize) {
        for c in &mut self.0 {
            *c = [0.0; ZONE_CHANNELS];
            c[ch] = 1.0;
        }
    }
    /// One soft round dab. `ch = None` erases (plain at the execution boundary).
    fn dab(&mut self, ch: Option<usize>, cx: f64, cy: f64, radius: f64, flow: f64) {
        let r = radius * R as f64;
        let (x0, x1) = (((cx * R as f64) - r).floor().max(0.0) as usize, ((cx * R as f64) + r).ceil().min(R as f64 - 1.0) as usize);
        let (y0, y1) = (((cy * R as f64) - r).floor().max(0.0) as usize, ((cy * R as f64) + r).ceil().min(R as f64 - 1.0) as usize);
        for y in y0..=y1 {
            for x in x0..=x1 {
                let d = ((x as f64 + 0.5 - cx * R as f64).powi(2) + (y as f64 + 0.5 - cy * R as f64).powi(2)).sqrt() / r;
                if d >= 1.0 {
                    continue;
                }
                let t = 1.0 - d;
                let a = flow * t * t * (3.0 - 2.0 * t);
                let cell = &mut self.0[y * R + x];
                for v in cell.iter_mut() {
                    *v *= 1.0 - a;
                }
                if let Some(ch) = ch {
                    cell[ch] += a;
                }
            }
        }
    }
    /// A hand stroke along a polyline: radius and path wobble, dabs every radius/4.
    fn stroke(&mut self, ch: Option<usize>, pts: &[(f64, f64)], radius: f64, flow: f64, salt: u64) {
        let mut along = 0.0;
        for seg in pts.windows(2) {
            let ((ax, ay), (bx, by)) = (seg[0], seg[1]);
            let len = ((bx - ax).powi(2) + (by - ay).powi(2)).sqrt();
            let steps = (len / (radius * 0.25)).ceil().max(1.0) as usize;
            let (nx, ny) = (-(by - ay) / len, (bx - ax) / len);
            for s in 0..steps {
                let t = s as f64 / steps as f64;
                let u = along + t * len;
                let r = radius * (1.0 + 0.25 * wobble(u / (radius * 2.0), salt));
                let off = radius * 0.3 * wobble(u / (radius * 3.0), salt + 7);
                self.dab(ch, ax + (bx - ax) * t + nx * off, ay + (by - ay) * t + ny * off, r, flow);
            }
            along += len;
        }
    }
    fn zones(&self) -> TerrainZones {
        let mut weights = Vec::with_capacity(R * R * ZONE_CHANNELS);
        for c in &self.0 {
            let sum: f64 = c.iter().sum();
            let k = if sum > 1.0 { 1.0 / sum } else { 1.0 };
            let mut q: Vec<u8> = c.iter().map(|v| (v * k * 255.0).floor() as u8).collect();
            while q.iter().map(|&v| v as u32).sum::<u32>() > 255 {
                let m = (0..ZONE_CHANNELS).max_by_key(|&i| q[i]).unwrap();
                q[m] -= 1;
            }
            weights.extend(q);
        }
        TerrainZones { version: 1, resolution: R, weights }
    }
}

fn map_a(erase_third: bool) -> Canvas {
    let mut c = Canvas::new();
    c.fill(PLAIN);
    // Hills on the north-east flank of the range.
    c.stroke(Some(HILLS), &[(0.30, -0.05), (0.62, 0.25), (0.92, 0.55), (1.08, 0.70)], 0.17, 0.35, 11);
    c.stroke(Some(HILLS), &[(0.45, 0.05), (0.80, 0.30), (1.05, 0.45)], 0.12, 0.3, 12);
    // The diagonal range.
    c.stroke(Some(MOUNT), &[(0.05, 0.12), (0.30, 0.36), (0.52, 0.50), (0.75, 0.70), (0.95, 0.93)], 0.10, 0.45, 13);
    c.stroke(Some(MOUNT), &[(0.18, 0.20), (0.50, 0.46), (0.82, 0.80)], 0.07, 0.35, 14);
    // High-mountain core.
    c.stroke(Some(HIGH), &[(0.36, 0.38), (0.50, 0.49), (0.64, 0.60)], 0.055, 0.5, 15);
    if erase_third {
        c.stroke(None, &[(0.10, -0.05), (0.12, 0.40), (0.09, 1.05)], 0.22, 0.6, 16);
        c.stroke(None, &[(0.02, -0.05), (0.03, 1.05)], 0.18, 0.8, 17);
    }
    c
}

fn map_b() -> Canvas {
    let mut c = Canvas::new();
    c.fill(PLAIN);
    // Hill belt between the two massifs.
    c.stroke(Some(HILLS), &[(0.22, 0.25), (0.42, 0.42), (0.58, 0.58), (0.78, 0.74)], 0.15, 0.35, 21);
    // Two separate mountain blobs, scribbled in place.
    c.stroke(Some(MOUNT), &[(0.20, 0.22), (0.32, 0.18), (0.36, 0.32), (0.24, 0.36), (0.22, 0.26)], 0.08, 0.4, 22);
    c.stroke(Some(MOUNT), &[(0.70, 0.64), (0.84, 0.66), (0.82, 0.80), (0.70, 0.78)], 0.08, 0.4, 23);
    // A sea along the west edge, to exercise the traced coast operation.
    c.stroke(Some(SEA), &[(-0.02, 0.45), (0.02, 0.75), (0.0, 1.05)], 0.12, 0.7, 24);
    c
}

fn map_c() -> Canvas {
    let mut c = Canvas::new();
    c.fill(HILLS);
    c.stroke(Some(PLAIN), &[(0.22, 0.55), (0.40, 0.66), (0.48, 0.58), (0.34, 0.50), (0.28, 0.62)], 0.13, 0.4, 31);
    c.stroke(Some(HIGH), &[(0.72, 0.22), (0.80, 0.27), (0.76, 0.31)], 0.06, 0.45, 32);
    c
}

/// Page-style hard shapes, with an unpainted gap that must remain plain.
fn map_straight() -> Canvas {
    let mut c = Canvas::new();
    for y in 0..R {
        for x in 0..R {
            let u = (x as f64 + 0.5) / R as f64;
            let channel = if u < 0.18 { Some(SEA) }
                else if u < 0.40 { Some(PLAIN) }
                else if (0.52..0.67).contains(&u) { Some(MOUNT) }
                else if u >= 0.67 { Some(HILLS) }
                else { None };
            if let Some(ch) = channel {
                c.0[y * R + x][ch] = 1.0;
            }
        }
    }
    c
}

/// Mirror filledSymbolicZones: keep the stored painting separate from engine input.
fn filled_zones(raw: &TerrainZones) -> TerrainZones {
    let mut zones = raw.clone();
    for cell in zones.weights.chunks_exact_mut(ZONE_CHANNELS) {
        let total: u32 = cell.iter().map(|&v| v as u32).sum();
        cell[PLAIN] += (255 - total) as u8;
    }
    zones
}

fn traced_mode(zones: &TerrainZones) -> Option<String> {
    let n: usize = 96;
    let mut bytes = vec![0u8; (n * n).div_ceil(8)];
    let mut any = false;
    for y in 0..n {
        for x in 0..n {
            let (u, v) = ((x as f64 + 0.5) / n as f64, (y as f64 + 0.5) / n as f64);
            // Same cell-centred bilinear sea threshold as seaCoastInputs in V2.
            if zones.sample(u, v)[1] * 255.0 >= 128.0 {
                let i = y * n + x;
                bytes[i >> 3] |= 1 << (i & 7);
                any = true;
            }
        }
    }
    any.then(|| format!("traced:{n}:{}", bytes.iter().map(|b| format!("{b:02x}")).collect::<String>()))
}

fn ramp(h: f64) -> [f64; 3] {
    if h <= 0.0 {
        let d = (-h / 300.0).min(1.0);
        return [70.0 - 30.0 * d, 120.0 - 40.0 * d, 170.0 - 30.0 * d];
    }
    let stops: [(f64, [f64; 3]); 7] = [
        (0.0, [96.0, 140.0, 84.0]),
        (150.0, [136.0, 166.0, 96.0]),
        (450.0, [196.0, 190.0, 120.0]),
        (900.0, [176.0, 140.0, 96.0]),
        (1600.0, [140.0, 110.0, 90.0]),
        (2600.0, [170.0, 165.0, 160.0]),
        (3600.0, [245.0, 245.0, 245.0]),
    ];
    for w in stops.windows(2) {
        if h <= w[1].0 {
            let t = (h - w[0].0) / (w[1].0 - w[0].0);
            return std::array::from_fn(|k| w[0].1[k] + (w[1].1[k] - w[0].1[k]) * t);
        }
    }
    stops[6].1
}

fn relief_tile(h: &[f32], n: usize, cell: f64) -> Vec<[u8; 3]> {
    let (lx, ly, lz) = (-0.5_f64, -0.5_f64, 0.7071_f64);
    let at = |x: isize, y: isize| h[(y.clamp(0, n as isize - 1) as usize) * n + x.clamp(0, n as isize - 1) as usize] as f64;
    let mut out = Vec::with_capacity(n * n);
    for y in 0..n as isize {
        for x in 0..n as isize {
            let gx = (at(x + 1, y) - at(x - 1, y)) / (2.0 * cell) * 2.0;
            let gy = (at(x, y + 1) - at(x, y - 1)) / (2.0 * cell) * 2.0;
            let len = (gx * gx + gy * gy + 1.0).sqrt();
            let shade = ((-gx * lx - gy * ly + lz) / len).max(0.0);
            let col = ramp(at(x, y));
            let k = if at(x, y) <= 0.0 { 0.85 + 0.15 * shade } else { 0.3 + 0.85 * shade };
            out.push(std::array::from_fn(|i| (col[i] * k).clamp(0.0, 255.0) as u8));
        }
    }
    out
}

fn painted_tile(zones: &TerrainZones) -> Vec<[u8; 3]> {
    let colors = [
        [110.0, 110.0, 110.0], // unpainted
        [60.0, 110.0, 200.0],
        [170.0, 215.0, 130.0],
        [225.0, 200.0, 100.0],
        [160.0, 100.0, 60.0],
        [250.0, 250.0, 250.0],
    ];
    let mut out = Vec::with_capacity(TILE * TILE);
    for y in 0..TILE {
        for x in 0..TILE {
            let w = zones.sample((x as f64 + 0.5) / TILE as f64, (y as f64 + 0.5) / TILE as f64);
            let c: [f64; 3] = std::array::from_fn(|k| (0..6).map(|i| w[i] * colors[i][k]).sum());
            out.push(c.map(|v| v.clamp(0.0, 255.0) as u8));
        }
    }
    out
}

/// One probe row: the zones the engine receives, the painting shown, and the request.
struct Case {
    name: String,
    painted: TerrainZones,
    zones: TerrainZones,
    width: f64,
    relief: String,
    environment: Option<String>,
    mix: f64,
    erosion: f64,
    motif: f64,
    source_n: usize,
    mode: Option<String>,
    tuning: Vec<f64>,
    seeds: Vec<String>,
}

fn synthetic(name: &str, canvas: Canvas) -> Case {
    let painted = canvas.zones();
    painted.validate().unwrap();
    let zones = filled_zones(&painted);
    zones.validate().unwrap();
    Case {
        name: name.into(),
        mode: traced_mode(&zones),
        painted,
        zones,
        width: WIDTH,
        relief: BASE_RELIEF.into(),
        environment: Some("flat".into()),
        // local/src/main.rs passes 0.5 unless the relief is "mixed".
        mix: 0.5,
        erosion: 1.0,
        motif: MOTIF,
        source_n: SOURCE_N,
        tuning: vec![f64::NAN; EROSION_TUNING.len()],
        seeds: SEEDS.iter().map(|s| s.to_string()).collect(),
    }
}

/// Replay a captured `/terrain` request body exactly as local/src/main.rs runs it.
fn captured(name: &str, path: &str) -> Option<Case> {
    let text = std::fs::read_to_string(path).map_err(|e| eprintln!("skip {path}: {e}")).ok()?;
    let body: serde_json::Value = serde_json::from_str(&text).unwrap();
    let s = &body["settings"];
    let zones: TerrainZones = serde_json::from_value(s["zones"].clone()).unwrap();
    zones.validate().unwrap();
    let width = s["width"].as_f64().unwrap();
    let relief = s["relief"].as_str().unwrap().to_string();
    let spacing = s["sampleSpacing"].as_f64().unwrap_or(30.0);
    let mix = if relief == "mixed" { s["mountainMix"].as_f64().unwrap_or(0.5) } else { 0.5 };
    let tuning = EROSION_TUNING
        .iter()
        .map(|k| s["erosionTuning"][*k].as_f64().unwrap_or(f64::NAN))
        .collect();
    let mode = if s["coastMask"].as_u64().unwrap_or(0) != 0 {
        s["islandMode"].as_str().map(str::to_string)
    } else {
        None
    };
    Some(Case {
        name: name.into(),
        painted: zones.clone(),
        zones,
        width,
        environment: s["environment"].as_str().map(str::to_string),
        mix,
        erosion: s["erosion"].as_f64().unwrap_or(1.0),
        motif: s["motifSize"].as_f64().unwrap_or(10000.0),
        source_n: (width / spacing).ceil() as usize,
        mode,
        tuning,
        seeds: vec![s["seed"].as_str().unwrap_or("magna-urbis").to_string(), SEEDS[1].to_string()],
        relief,
    })
}

fn main() {
    let args: Vec<String> = std::env::args().collect();
    let tag = args.get(1).map_or("probe", String::as_str);
    let dir = args.get(2).map_or("../web/out/symbolic-relief", String::as_str);
    std::fs::create_dir_all(dir).unwrap();
    // Extra arguments: captured request bodies replayed instead of the default set.
    let captures = concat!(env!("CARGO_MANIFEST_DIR"), "/../../../web/out/relief-sources-check");
    let mut cases: Vec<Case> = Vec::new();
    if args.len() > 3 {
        for (i, path) in args[3..].iter().enumerate() {
            cases.extend(captured(&format!("capture-{i}"), path));
        }
    } else {
        cases.push(synthetic("a-range", map_a(false)));
        cases.push(synthetic("b-blobs-sea", map_b()));
        cases.push(synthetic("c-hills-basin", map_c()));
        cases.push(synthetic("d-range-third-plain", map_a(true)));
        cases.push(synthetic("e-straight-sea-range", map_straight()));
        cases.extend(captured(
            "p5-band-6km",
            &format!("{captures}/native-symbolic-request/01_terrain.body.json"),
        ));
        cases.extend(captured(
            "p5-irregular-20km",
            &format!("{captures}/native-symbolic-request-irregular/01_terrain.body.json"),
        ));
    }
    // Columns: painted, naturalized zones, each seed, first seed without erosion.
    let cols = 3 + SEEDS.len();
    let (sw, sh) = (cols * TILE, cases.len() * TILE);
    let mut sheet = vec![[0u8; 3]; sw * sh];
    let mut blit = |tile: &[[u8; 3]], row: usize, col: usize| {
        for y in 0..TILE {
            let dst = (row * TILE + y) * sw + col * TILE;
            sheet[dst..dst + TILE].copy_from_slice(&tile[y * TILE..(y + 1) * TILE]);
        }
    };
    let mut total_ms = 0.0;
    let mut runs = 0;
    for (row, case) in cases.iter().enumerate() {
        blit(&painted_tile(&case.painted), row, 0);
        blit(&painted_tile(&case.zones.naturalized(&case.seeds[0], case.width, case.motif)), row, 1);
        set_erosion_tuning(&case.tuning);
        let zones = &case.zones;
        let name = &case.name;
        let runs_of_case: Vec<(&String, f64)> = case
            .seeds
            .iter()
            .map(|seed| (seed, case.erosion))
            .chain(std::iter::once((&case.seeds[0], 0.0)))
            .collect();
        for (s, (seed, erosion)) in runs_of_case.into_iter().enumerate() {
            let t = Instant::now();
            let mut generator = TerrainGenerator::with_zones_at_resolution(
                seed,
                case.width,
                &case.relief,
                erosion,
                case.motif,
                case.mix,
                case.environment.as_deref(),
                zones,
                case.source_n,
            )
            .unwrap();
            let gen_ms = t.elapsed().as_secs_f64() * 1e3;
            total_ms += gen_ms;
            runs += 1;
            if let Some(mode) = &case.mode {
                generator.set_coast(255, mode).unwrap();
            }
            let region = generator.sample_region(0.0, 0.0, case.width, TILE).unwrap();
            let cell = case.width / TILE as f64;
            blit(&relief_tile(&region.height, TILE, cell), row, 2 + s);
            // Per-zone statistics on cells whose dominant share is >= 0.6.
            let mut buckets: Vec<Vec<f32>> = vec![Vec::new(); 6];
            let mut slopes = [0.0_f64; 6];
            for y in 1..TILE - 1 {
                for x in 1..TILE - 1 {
                    let w = zones.sample((x as f64 + 0.5) / TILE as f64, (y as f64 + 0.5) / TILE as f64);
                    let (k, &share) = w.iter().enumerate().max_by(|a, b| a.1.total_cmp(b.1)).unwrap();
                    if share < 0.6 {
                        continue;
                    }
                    let h = &region.height;
                    let gx = (h[y * TILE + x + 1] - h[y * TILE + x - 1]) as f64 / (2.0 * cell);
                    let gy = (h[(y + 1) * TILE + x] - h[(y - 1) * TILE + x]) as f64 / (2.0 * cell);
                    slopes[k] += gx.hypot(gy).atan().to_degrees();
                    buckets[k].push(h[y * TILE + x]);
                }
            }
            let mut line = format!(
                "{tag} {name:<20} {seed:<11} e{erosion} n {:>4} gen {gen_ms:>6.0} ms |",
                case.source_n
            );
            for (k, b) in buckets.iter_mut().enumerate() {
                if b.len() < 50 {
                    continue;
                }
                b.sort_unstable_by(f32::total_cmp);
                let p = |q: f64| b[((b.len() - 1) as f64 * q) as usize];
                line += &format!(
                    " {}: {:.0}/{:.0}/{:.0} m slope {:.1}° |",
                    NAMES[k],
                    p(0.0),
                    p(0.5),
                    p(1.0),
                    slopes[k] / b.len() as f64
                );
            }
            println!("{line}");
        }
    }
    set_erosion_tuning(&[]);
    println!("{tag} mean generation time {:.0} ms over {runs} runs", total_ms / runs as f64);
    let path = format!("{dir}/{tag}.ppm");
    let mut bytes = format!("P6\n{sw} {sh}\n255\n").into_bytes();
    bytes.extend(sheet.iter().flatten());
    std::fs::write(&path, bytes).unwrap();
    println!("wrote {path}");
}
