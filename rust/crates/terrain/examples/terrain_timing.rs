//! Stage timings and output hashes of the CPU terrain paths (native `/terrain/stage`
//! pipeline, `/terrain` generator, hydrology). `RAYON_NUM_THREADS` sets the kernel threads.
//! usage: terrain_timing [n] [width] [motif] [relief] [reps] [coast mask]
use magna_urbis_terrain::{GenerationNoisePlan, HydrologyConfig, HydrologyEngine, TerrainGenerator, TerrainPipeline};
use std::time::Instant;

fn hash(values: &[f32]) -> u64 {
    values.iter().fold(0xcbf29ce484222325, |h: u64, v| {
        (h ^ u64::from(v.to_bits())).wrapping_mul(0x100000001b3)
    })
}
fn ms(t: Instant) -> f64 {
    t.elapsed().as_secs_f64() * 1e3
}

fn main() {
    let a: Vec<String> = std::env::args().collect();
    let arg = |i: usize, d: f64| a.get(i).and_then(|v| v.parse().ok()).unwrap_or(d);
    let n = arg(1, 2000.) as usize;
    let width = arg(2, 50000.);
    let motif = arg(3, 10000.);
    let relief = a.get(4).map_or("mountains", String::as_str);
    let reps = arg(5, 1.) as usize;
    let coast = arg(6, 0.) as u32;
    let seed = "bench";
    let plan = GenerationNoisePlan::erosion_at_resolution(seed, width, relief, 1., motif, 0.5, n).unwrap();
    let p = plan.parameters.clone();
    let mut s = p[24..32].to_vec();
    // finalizePhysicalSurfacePlan
    let baseline = s[0] - 24.;
    let wanted = if n > 1024 { baseline.max((n as f32 * 0.6).ceil()).min(2048.) } else { baseline };
    let surface_n = wanted.min(n as f32);
    let old = s[1];
    s[0] = surface_n + 24.;
    s[1] = (width / surface_n as f64) as f32;
    s[2] = -12. * s[1];
    s[6] *= s[1] / old;
    let flags = vec![0, 1, 1, 1, 1, 1, 1, 1, 1, 0, 0];
    println!("n={n} width={width} motif={motif} regional={} surface={} iters={} surface_iters={}", p[2], s[0], p[13], s[3]);
    let names = ["init", "regional", "finish", "reconstruct", "calibrate", "detail", "surface", "normalize"];
    let mut last = Vec::new();
    for rep in 0..reps {
        let total = Instant::now();
        let mut pipeline = TerrainPipeline::new(seed, &p, &s, &flags).unwrap();
        let mut line = String::new();
        let mut hashes = String::new();
        for (k, name) in names.iter().enumerate() {
            let t = Instant::now();
            pipeline.advance(k as u32).unwrap();
            if k == 0 && coast != 0 {
                pipeline.cut_coast(coast, "island").unwrap();
            }
            line += &format!("{name} {:.0} · ", ms(t));
            if rep == 0 {
                hashes += &format!(" {:016x}", hash(&pipeline.height()));
            }
        }
        println!("pipeline: {line}total {:.0} ms", ms(total));
        if rep == 0 {
            println!("pipeline stage hashes:{hashes}");
        }
        last = pipeline.take_height();
    }
    println!("pipeline final hash {:016x}", hash(&last));
    if coast != 0 {
        // The V2 CPU path: the pipeline's field retained by the engine, then the late coast.
        let t = Instant::now();
        let mut generator = TerrainGenerator::new_mixed_with_source_at_resolution(seed, width, relief, 1., motif, 0.5, last.clone(), None, n).unwrap();
        let retained = ms(t);
        let t = Instant::now();
        generator.set_coast(coast, "island").unwrap();
        let coasted = ms(t);
        let field = generator.sampling_base_field();
        let sea = field.iter().filter(|&&h| h <= 0.).count() as f64 / field.len() as f64;
        let deepest = field.iter().copied().fold(f32::MAX, f32::min);
        let open = field.iter().filter(|&&h| h == deepest).count() as f64 / field.len() as f64;
        println!("island: retain {retained:.0} · set_coast {coasted:.0} ms · sea {:.1}% · at floor {:.1}% ({deepest} m) · hash {:016x}", sea * 100., open * 100., hash(&field));
        if let Ok(path) = std::env::var("DUMP") {
            let m = std::env::var("DUMP_N").map_or(512, |v| v.parse().unwrap());
            let grid = generator.sample_region(0., 0., width, m).unwrap();
            let bytes: Vec<u8> = grid.height.iter().flat_map(|v| v.to_le_bytes()).collect();
            std::fs::write(&path, bytes).unwrap();
        }
        return;
    }
    for _ in 0..reps {
        let t = Instant::now();
        let mut generator = TerrainGenerator::new_mixed_with_noise_at_resolution(seed, width, relief, 1., motif, 0.5, None, None, n).unwrap();
        let built = ms(t);
        let t = Instant::now();
        generator.set_coast(coast, "island").unwrap();
        let coasted = ms(t);
        let t = Instant::now();
        let field = generator.sampling_base_field();
        let copied = ms(t);
        let t = Instant::now();
        let region = generator.sample_region(0., 0., width, 512).unwrap();
        let sampled = ms(t);
        if let Ok(path) = std::env::var("DUMP") {
            // Hydrology grid of the V2 region: the whole map sampled at DUMP_N².
            let m = std::env::var("DUMP_N").map_or(512, |v| v.parse().unwrap());
            let grid = generator.sample_region(0., 0., width, m).unwrap();
            let bytes: Vec<u8> = grid.height.iter().flat_map(|v| v.to_le_bytes()).collect();
            std::fs::write(&path, bytes).unwrap();
            println!("dumped {m}² to {path}");
        }
        let t = Instant::now();
        let physical = generator.physical_height_field();
        println!("generator: new {built:.0} · coast {coasted:.0} · base field {copied:.0} · sample512 {sampled:.0} · physical {:.0} ms", ms(t));
        println!(
            "generator hashes: field {:016x} physical {:016x} region {:016x} {:016x} {:016x} {:016x}",
            hash(&field), hash(&physical), hash(&region.height), hash(&region.normal_x), hash(&region.normal_y), hash(&region.normal_z)
        );
    }
    let t = Instant::now();
    let engine = HydrologyEngine::new(seed, width, n, &last, last.iter().any(|&h| h <= 0.)).unwrap();
    println!("hydrology: new {:.0} ms", ms(t));
    let t = Instant::now();
    let mut previous = Instant::now();
    let mut stages = String::new();
    let output = engine.generate_profiled(&HydrologyConfig::default(), &mut |label| {
        stages += &format!("{label} {:.0} · ", ms(previous));
        previous = Instant::now();
    });
    println!("hydrology: generate {:.0} ms: {stages}", ms(t));
    if let Ok(output) = output {
        println!("hydrology hash {:016x} {:016x} {:016x}", hash(&output.river_points), hash(&output.lake_points), hash(&output.adjusted_height));
    }
}
