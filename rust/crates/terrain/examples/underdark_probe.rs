//! Underdark probe: carve a procedural relief and write a shaded preview (PPM).
//! `cargo run -p magna-urbis-terrain --example underdark_probe -- <seed> <width_m> <relief> <n> <out.ppm>`
use magna_urbis_terrain::TerrainGenerator;
use std::io::Write;

fn main() -> Result<(), String> {
    let args: Vec<String> = std::env::args().collect();
    let seed = args.get(1).map_or("magna-urbis-v2", String::as_str);
    let width: f64 = args.get(2).and_then(|v| v.parse().ok()).unwrap_or(12000.0);
    let relief = args.get(3).map_or("mixed", String::as_str);
    let n: usize = args.get(4).and_then(|v| v.parse().ok()).unwrap_or(512);
    let out = args.get(5).map_or("underdark.ppm", String::as_str);
    let started = std::time::Instant::now();
    let generator = TerrainGenerator::new_mixed_with_noise_at_resolution(seed, width, relief, 1.0, 2400.0, 0.5, None, None, n)?;
    let field = generator.physical_height_field();
    let base_ms = started.elapsed().as_millis();
    let started = std::time::Instant::now();
    let carved = magna_urbis_terrain::underdark::carve(seed, width, &field)?;
    let carve_ms = started.elapsed().as_millis();
    let (lo, hi) = carved.height.iter().fold((f32::MAX, f32::MIN), |(a, b), &h| (a.min(h), b.max(h)));
    let open = carved.rock.iter().filter(|&&r| r == 0).count() as f64 / (n * n) as f64;
    println!("base {base_ms} ms, carve {carve_ms} ms, heights {lo:.1}..{hi:.1} m, open {:.1}%", open * 100.0);
    let cell = (width / n as f64) as f32;
    let mut file = std::fs::File::create(out).map_err(|e| e.to_string())?;
    write!(file, "P6\n{n} {n}\n255\n").map_err(|e| e.to_string())?;
    let mut bytes = Vec::with_capacity(n * n * 3);
    for y in 0..n {
        for x in 0..n {
            let i = y * n + x;
            let h = |xx: usize, yy: usize| carved.height[yy.min(n - 1) * n + xx.min(n - 1)];
            let gx = (h(x + 1, y) - h(x.saturating_sub(1), y)) / (2.0 * cell);
            let gy = (h(x, y + 1) - h(x, y.saturating_sub(1))) / (2.0 * cell);
            let shade = (0.75 - 0.9 * (gx * 0.7 + gy * 0.7)).clamp(0.2, 1.3);
            let t = (carved.height[i] - lo) / (hi - lo).max(1.0);
            let rgb = if carved.rock[i] == 1 {
                [40.0 * shade, 36.0 * shade, 44.0 * shade]
            } else {
                [(120.0 + 90.0 * t) * shade, (110.0 + 70.0 * t) * shade, (95.0 + 40.0 * t) * shade]
            };
            bytes.extend(rgb.iter().map(|v| v.clamp(0.0, 255.0) as u8));
        }
    }
    file.write_all(&bytes).map_err(|e| e.to_string())?;
    // Slope magnitude of a 96² crop around the map centre, ×4 (staircase check), with the rock outline in red.
    let (cx, cy, k, w) = (n / 2 - 48, n / 2 - 48, 4usize, 96usize);
    let mut crop = std::fs::File::create(format!("{out}.slope.ppm")).map_err(|e| e.to_string())?;
    write!(crop, "P6
{} {}
255
", w * k, w * k).map_err(|e| e.to_string())?;
    let mut px = Vec::with_capacity(w * w * k * k * 3);
    for yy in 0..w * k {
        for xx in 0..w * k {
            let (x, y) = (cx + xx / k, cy + yy / k);
            let h = |a: usize, b: usize| carved.height[b.min(n - 1) * n + a.min(n - 1)];
            let gx = (h(x + 1, y) - h(x - 1, y)) / (2.0 * cell);
            let gy = (h(x, y + 1) - h(x, y - 1)) / (2.0 * cell);
            let v = ((gx * gx + gy * gy).sqrt() * 400.0).min(255.0) as u8;
            let rock = carved.rock[y * n + x] == 1;
            px.extend([if rock { v.max(90) } else { v }, v, v]);
        }
    }
    crop.write_all(&px).map_err(|e| e.to_string())?;
    Ok(())
}
