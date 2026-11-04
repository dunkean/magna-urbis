//! Resource fields (R0–R2) on a terrain-bench raster dump: timing, rock shares against the
//! prior, and three PNG views (bedrock classes, soil depth, moisture) over a hillshade.
//!
//! `cargo run --release -p magna-urbis-core --example resources_probe -- [dump.json] [out dir] [seed] [biome]`
//! (dump from `DUMP=1 node scripts/terrain_roads_visual.mjs`; default: the mountains-7 dump).
use magna_urbis_core::resources::{RegionInput, ResourceFields, ROCKS};
use magna_urbis_core::settlements::{Raster, Terrain};
use std::time::Instant;

fn decode(text: &str) -> Vec<u8> {
    const TABLE: &[u8; 64] = b"ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/";
    let mut value = [255_u8; 256];
    for (i, &c) in TABLE.iter().enumerate() {
        value[c as usize] = i as u8;
    }
    let (mut out, mut acc, mut bits) = (Vec::new(), 0_u32, 0);
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
fn words<T>(text: &str, f: fn([u8; 4]) -> T) -> Vec<T> {
    decode(text).as_chunks::<4>().0.iter().map(|b| f(*b)).collect()
}

/// Minimal PNG (RGB, stored deflate blocks).
fn png(path: &std::path::Path, w: usize, h: usize, rgb: &[u8]) {
    fn crc(data: &[u8]) -> u32 {
        let mut c = !0u32;
        for &b in data {
            c ^= b as u32;
            for _ in 0..8 {
                c = if c & 1 != 0 { 0xedb88320 ^ (c >> 1) } else { c >> 1 };
            }
        }
        !c
    }
    let mut raw = Vec::with_capacity(h * (3 * w + 1));
    for y in 0..h {
        raw.push(0);
        raw.extend_from_slice(&rgb[y * 3 * w..(y + 1) * 3 * w]);
    }
    let mut z = vec![0x78, 0x01];
    for (i, chunk) in raw.chunks(65535).enumerate() {
        z.push(u8::from((i + 1) * 65535 >= raw.len()));
        z.extend_from_slice(&(chunk.len() as u16).to_le_bytes());
        z.extend_from_slice(&(!(chunk.len() as u16)).to_le_bytes());
        z.extend_from_slice(chunk);
    }
    let (mut a, mut b) = (1u32, 0u32);
    for &v in &raw {
        a = (a + v as u32) % 65521;
        b = (b + a) % 65521;
    }
    z.extend_from_slice(&((b << 16) | a).to_be_bytes());
    let mut out = b"\x89PNG\r\n\x1a\n".to_vec();
    let mut chunk = |kind: &[u8], data: &[u8]| {
        out.extend_from_slice(&(data.len() as u32).to_be_bytes());
        let body: Vec<u8> = kind.iter().chain(data).copied().collect();
        out.extend_from_slice(&body);
        out.extend_from_slice(&crc(&body).to_be_bytes());
    };
    let mut head = (w as u32).to_be_bytes().to_vec();
    head.extend_from_slice(&(h as u32).to_be_bytes());
    head.extend_from_slice(&[8, 2, 0, 0, 0]);
    chunk(b"IHDR", &head);
    chunk(b"IDAT", &z);
    chunk(b"IEND", &[]);
    std::fs::write(path, out).unwrap();
}

const ROCK_COLORS: [[u8; 3]; 8] = [
    [226, 120, 140], // granite
    [120, 170, 230], // limestone
    [240, 200, 90],  // sandstone
    [150, 120, 80],  // marl
    [70, 70, 80],    // basalt
    [150, 90, 200],  // metamorphic
    [40, 150, 90],   // ultrabasic
    [250, 250, 250], // evaporite
];

fn ramp(t: f32, a: [u8; 3], b: [u8; 3]) -> [u8; 3] {
    let t = t.clamp(0.0, 1.0);
    std::array::from_fn(|k| (a[k] as f32 * (1.0 - t) + b[k] as f32 * t) as u8)
}

fn view(r: &ResourceFields, shade: &[f32], color: impl Fn(usize) -> [u8; 3]) -> Vec<u8> {
    let mut rgb = Vec::with_capacity(r.nx * r.ny * 3);
    for k in 0..r.nx * r.ny {
        let c = match r.water[k] {
            1 => [40, 70, 130],
            2 => [60, 110, 170],
            3 => [80, 140, 220],
            _ => color(k).map(|v| (v as f32 * shade[k]).min(255.0) as u8),
        };
        rgb.extend_from_slice(&c);
    }
    rgb
}

fn main() {
    let args: Vec<String> = std::env::args().collect();
    let default = concat!(env!("CARGO_MANIFEST_DIR"), "/../../../web/out/terrain-roads/mountains-7-dump.json");
    let path = args.get(1).filter(|s| !s.is_empty()).map_or(default, String::as_str);
    let out = std::path::PathBuf::from(args.get(2).cloned().unwrap_or_else(|| {
        std::env::temp_dir().join("magna-urbis-resources-probe").to_string_lossy().into()
    }));
    std::fs::create_dir_all(&out).unwrap();
    let seed = args.get(3).map_or("7", String::as_str);
    let biome = args.get(4).map_or("temperate", String::as_str);
    let dump: serde_json::Value = serde_json::from_str(&std::fs::read_to_string(path).expect("dump file")).unwrap();
    let width = dump["width"].as_f64().unwrap();
    let n = dump["n"].as_u64().unwrap() as usize;
    let height = words(dump["height"].as_str().unwrap(), f32::from_le_bytes);
    let water = decode(dump["water"].as_str().unwrap());
    let level = words(dump["waterLevel"].as_str().unwrap(), f32::from_le_bytes);
    let widths = words(dump["riverWidth"].as_str().unwrap(), f32::from_le_bytes);
    let ids = words(dump["riverIds"].as_str().unwrap(), i32::from_le_bytes);
    let raster = || Raster { width, n, height: &height, water: &water, water_level: &level, river_width: &widths, river_ids: &ids };
    let region = RegionInput { seed: seed.into(), biome: biome.into(), ..Default::default() };
    drop(Terrain::new(raster()).unwrap()); // warm the thread pool
    let mut terrain = Terrain::new(raster()).unwrap();
    terrain.set_region(region.clone());
    let t = Instant::now();
    let r = terrain.resources();
    println!(
        "{path}\n{:.0} m map, DEM {n}², blocks {}x{} of {} m (LOD {}): {:.1} ms",
        width, r.nx, r.ny, r.cell, r.lod, t.elapsed().as_secs_f64() * 1e3
    );
    println!("prior: {} ({}, {} °C, {} mm)", r.prior.context, r.prior.biome, r.prior.temperature, r.prior.precipitation);
    let shares = r.rock_shares();
    for k in 0..8 {
        println!("  {:<12} prior {:>5.1} %  realised {:>5.1} %", ROCKS[k], 100.0 * r.prior.rock_shares[k], 100.0 * shares[k]);
    }
    let land: Vec<usize> = (0..r.nx * r.ny).filter(|&k| r.water[k] == 0).collect();
    let mean = |f: &[f32]| land.iter().map(|&k| f[k] as f64).sum::<f64>() / land.len().max(1) as f64;
    println!(
        "land means: soil {:.2} m, stoniness {:.2}, moisture {:.2}, clay {:.2}, sand {:.2}, hand {:.1} m, twi {:.1}, alluvial {:.2}, colluvial {:.3}",
        mean(&r.soil_depth), mean(&r.stoniness), mean(&r.moisture), mean(&r.clay), mean(&r.sand),
        mean(&r.hand), mean(&r.twi), mean(&r.alluvial), mean(&r.colluvial)
    );
    // Hillshade from the block grid itself (DEM sampled at block centres).
    let (nx, ny) = (r.nx, r.ny);
    let dem = width / n as f64;
    let hgt = |i: isize, j: isize| {
        let x = (r.x0 + (i.clamp(0, nx as isize - 1) as f64 + 0.5) * r.cell) / dem;
        let y = (r.y0 + (j.clamp(0, ny as isize - 1) as f64 + 0.5) * r.cell) / dem;
        height[(y.clamp(0.0, (n - 1) as f64) as usize) * n + x.clamp(0.0, (n - 1) as f64) as usize]
    };
    let shade: Vec<f32> = (0..nx * ny)
        .map(|k| {
            let (i, j) = ((k % nx) as isize, (k / nx) as isize);
            let gx = (hgt(i + 1, j) - hgt(i - 1, j)) / (2.0 * r.cell as f32);
            let gy = (hgt(i, j + 1) - hgt(i, j - 1)) / (2.0 * r.cell as f32);
            (0.85 + 1.6 * (-gx - gy) / (1.0 + gx * gx + gy * gy).sqrt()).clamp(0.45, 1.25)
        })
        .collect();
    let files = [
        ("bedrock.png", view(r, &shade, |k| ROCK_COLORS[r.bedrock[k] as usize])),
        ("soil_depth.png", view(r, &shade, |k| ramp(r.soil_depth[k] / 2.0, [235, 225, 200], [90, 50, 20]))),
        ("moisture.png", view(r, &shade, |k| ramp(r.moisture[k], [230, 200, 140], [30, 90, 160]))),
    ];
    for (name, rgb) in files {
        png(&out.join(name), nx, ny, &rgb);
    }
    // R3 potentials: per-id statistics over all blocks and four views.
    println!("potentials (all blocks): mean / max / share > 0.1");
    for (id, mean, max, share) in r.potentials.stats() {
        println!("  {id:<15} {mean:>6.3} {max:>6.3} {:>5.1} %", 100.0 * share);
    }
    let p = |id: &str| r.potentials.get(id);
    let (arable, wood, ashlar, power) = (p("arable"), p("wood"), p("stone_ashlar"), p("water_power"));
    let mut water_power = view(r, &shade, |k| ramp(power[k], [60, 60, 60], [255, 220, 60]));
    for k in (0..nx * ny).filter(|&k| power[k] > 0.0) {
        let c = ramp(power[k].sqrt(), [255, 190, 90], [255, 0, 0]);
        let (x, y) = ((k % nx) as isize, (k / nx) as isize);
        for (dx, dy) in [(0, 0), (1, 0), (-1, 0), (0, 1), (0, -1)] {
            let (xx, yy) = (x + dx, y + dy);
            if xx >= 0 && yy >= 0 && xx < nx as isize && yy < ny as isize {
                water_power[(yy as usize * nx + xx as usize) * 3..][..3].copy_from_slice(&c);
            }
        }
    }
    let files = [
        ("arable.png", view(r, &shade, |k| ramp(arable[k], [235, 225, 200], [40, 140, 40]))),
        ("wood.png", view(r, &shade, |k| ramp(wood[k], [235, 230, 200], [10, 80, 30]))),
        ("stone_ashlar.png", view(r, &shade, |k| ramp(ashlar[k] / 0.6, [70, 70, 70], [255, 240, 190]))),
        ("water_power.png", water_power),
    ];
    for (name, rgb) in files {
        png(&out.join(name), nx, ny, &rgb);
    }
    // R4 deposits and R5 anchors: counts, then dots over the arable view.
    let mut counts: std::collections::BTreeMap<String, (usize, f64)> = Default::default();
    for d in &r.deposits {
        let e = counts.entry(format!("deposit {}", d.family)).or_default();
        e.0 += 1;
        e.1 += d.recoverable_t;
    }
    for a in &r.anchors {
        let e = counts.entry(format!("anchor {} ({})", a.kind, a.resource)).or_default();
        e.0 += 1;
        e.1 += a.annual_t as f64;
    }
    println!("deposits {} / anchors {} (count, sum recoverable t or annual t)", r.deposits.len(), r.anchors.len());
    for (name, (n, t)) in &counts {
        println!("  {name:<40} {n:>3} {t:>12.0}");
    }
    let mut sites = view(r, &shade, |k| ramp(arable[k], [235, 225, 200], [40, 140, 40]));
    let mut dot = |x: f64, y: f64, rad: isize, c: [u8; 3]| {
        let (i, j) = (((x - r.x0) / r.cell) as isize, ((y - r.y0) / r.cell) as isize);
        for dy in -rad..=rad {
            for dx in -rad..=rad {
                let (xx, yy) = (i + dx, j + dy);
                let edge = dx.abs() == rad || dy.abs() == rad;
                if xx >= 0 && yy >= 0 && xx < nx as isize && yy < ny as isize && dx * dx + dy * dy <= rad * rad + 1 {
                    sites[(yy as usize * nx + xx as usize) * 3..][..3].copy_from_slice(if edge { &[0, 0, 0] } else { &c });
                }
            }
        }
    };
    let kind_color = |k: &str| match k {
        "quarry" => [200, 200, 200],
        "clay_pit" => [190, 110, 60],
        "peat_cut" => [90, 60, 30],
        "salt_pan" | "salt_boiling" => [255, 255, 255],
        "mill_seat" => [0, 160, 255],
        "wind_knoll" => [180, 230, 255],
        "fishing_landing" => [0, 60, 200],
        "logging" | "charcoal" => [20, 70, 20],
        "pasture" | "upland_pasture" => [240, 230, 80],
        "hunting" => [230, 120, 20],
        _ => [255, 0, 255],
    };
    for a in &r.anchors {
        dot(a.x, a.y, 2, kind_color(a.kind));
    }
    for d in &r.deposits {
        dot(d.x, d.y, 3, if d.recoverable_t > 0.0 { [230, 0, 0] } else { [120, 0, 0] });
    }
    png(&out.join("sites.png"), nx, ny, &sites);
    println!("images: {}", out.display());
    // Timing on a synthetic 40 km map at the two raster sizes the pipeline uses.
    for n in [512usize, 1024] {
        let cell = 40000.0 / n as f64;
        let h: Vec<f32> = (0..n * n)
            .map(|i| {
                let (x, y) = (((i % n) as f64 + 0.5) * cell, ((i / n) as f64 + 0.5) * cell);
                (120.0 + 80.0 * (x / 3100.0).sin() * (y / 4300.0).cos() + 25.0 * (x / 900.0 + y / 1300.0).sin()) as f32
            })
            .collect();
        let w = vec![0u8; n * n];
        let f = vec![0f32; n * n];
        let id = vec![-1i32; n * n];
        let mut t40 = Terrain::new(Raster { width: 40000.0, n, height: &h, water: &w, water_level: &h, river_width: &f, river_ids: &id }).unwrap();
        t40.set_region(region.clone());
        let t = Instant::now();
        let r = t40.resources();
        println!("synthetic 40 km, DEM {n}²: {}x{} blocks of {} m in {:.1} ms", r.nx, r.ny, r.cell, t.elapsed().as_secs_f64() * 1e3);
    }
}
