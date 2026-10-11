//! Native neural relief tool (`neural` binary): weight export, generation, previews and reference checks.
//!
//! ```text
//! neural export   [--coarse coarse4.pt] [--base base.safetensors] [--decoder decoder.pt] [--out DIR]
//! neural generate [--weights DIR] [--seed 42] [--sketch plain|west-coast|ne-mountains|FAMILY]
//!                 [--coasts N,E] [--islands island] [--climate temperate] [--mix 0.5]
//!                 [--exact] [--origin CELLS] [--repeat N] [--out out/neural/x]
//! neural compare  --reference ref.npy --native out.native.f32
//! neural serve    [--weights DIR] [--address 127.0.0.1:8792] [--no-warmup]
//! ```
use crate::{
    Climate, Clock, Family, Networks, Regional, Request, Sketch, Validation, export, gpu::Gpu,
    weights::Bundle, world_seed,
};
use burn::tensor::{Device, DeviceKind};
use std::collections::HashMap;
use std::path::{Path, PathBuf};
use std::time::Instant;

struct Wall(Instant);
impl Clock for Wall {
    fn now_ms(&self) -> f64 {
        self.0.elapsed().as_secs_f64() * 1000.0
    }
}

fn args() -> (String, HashMap<String, String>) {
    let mut iter = std::env::args().skip(1);
    let command = iter.next().unwrap_or_default();
    let mut options = HashMap::new();
    let rest: Vec<String> = iter.collect();
    let mut i = 0;
    while i < rest.len() {
        let key = rest[i].trim_start_matches("--").to_owned();
        if i + 1 < rest.len() && !rest[i + 1].starts_with("--") {
            options.insert(key, rest[i + 1].clone());
            i += 2;
        } else {
            options.insert(key, String::new());
            i += 1;
        }
    }
    (command, options)
}

fn root() -> PathBuf {
    Path::new(env!("CARGO_MANIFEST_DIR")).join("../..")
}

fn default_weights() -> PathBuf {
    std::env::var_os("MAGNA_NEURAL_WEIGHTS")
        .map(PathBuf::from)
        .unwrap_or_else(|| root().join("pkg/neural-weights"))
}

fn load_networks(dir: &Path) -> Result<(Networks, f64), String> {
    let started = Instant::now();
    let read = |name: &str| -> Result<Bundle, String> {
        let path = dir.join(format!("{name}.safetensors"));
        Bundle::parse(
            &std::fs::read(&path)
                .map_err(|e| format!("{}: {e} (lancer d’abord `neural export`)", path.display()))?,
        )
    };
    let gpu = Gpu::new(Device::vulkan(DeviceKind::DiscreteGpu(0)));
    let networks = Networks::load(gpu, &read("coarse")?, &read("base")?, &read("decoder")?)?;
    Ok((networks, started.elapsed().as_secs_f64()))
}

/// Original base checkpoint in a Hugging Face cache (pinned revision first).
fn base_checkpoint() -> Option<PathBuf> {
    let home = std::env::var_os("USERPROFILE")
        .or_else(|| std::env::var_os("HOME"))
        .map(PathBuf::from);
    let roots = [
        std::env::var_os("HF_HUB_CACHE").map(PathBuf::from),
        std::env::var_os("HF_HOME").map(|h| PathBuf::from(h).join("hub")),
        home.map(|h| h.join(".cache/huggingface/hub")),
        Some(PathBuf::from("E:/TerrainDiffusionRuntime/huggingface/hub")),
    ];
    let model = "models--xandergos--terrain-diffusion-30m/snapshots";
    let file = "base_model/diffusion_pytorch_model.safetensors";
    roots.into_iter().flatten().find_map(|root| {
        let snapshots = root.join(model);
        let pinned = snapshots
            .join("9ef8030cb805b433b98ec25c5dddefbac07a9e26")
            .join(file);
        if pinned.exists() {
            return Some(pinned);
        }
        std::fs::read_dir(&snapshots)
            .ok()?
            .flatten()
            .map(|e| e.path().join(file))
            .find(|p| p.exists())
    })
}

fn sketch(options: &HashMap<String, String>, seed: u64) -> Result<Sketch, String> {
    let name = options.get("sketch").map(String::as_str).unwrap_or("plain");
    Ok(match name {
        "plain" => Sketch::Validation(Validation::Plain),
        "west-coast" => Sketch::Validation(Validation::WestCoast),
        "ne-mountains" => Sketch::Validation(Validation::NortheastMountains),
        family => {
            const DIRECTIONS: [&str; 8] = ["N", "NE", "E", "SE", "S", "SW", "W", "NW"];
            let mask = options
                .get("coasts")
                .map(|c| {
                    c.split(',')
                        .filter_map(|d| DIRECTIONS.iter().position(|x| x.eq_ignore_ascii_case(d)))
                        .fold(0u8, |m, i| m | (1 << i))
                })
                .unwrap_or(0);
            let climate = Climate::parse(
                options
                    .get("climate")
                    .map(String::as_str)
                    .unwrap_or("temperate"),
            )?;
            let mix = options
                .get("mix")
                .and_then(|m| m.parse().ok())
                .unwrap_or(0.5);
            let islands = options
                .get("islands")
                .map(String::as_str)
                .unwrap_or("island");
            Sketch::Regional(Box::new(Regional::new(
                seed,
                Family::parse(family)?,
                mix,
                mask,
                islands,
                climate,
                40000.0,
            )?))
        }
    })
}

fn write_f32(path: &Path, values: &[f32]) -> Result<(), String> {
    std::fs::write(
        path,
        values
            .iter()
            .flat_map(|v| v.to_le_bytes())
            .collect::<Vec<u8>>(),
    )
    .map_err(|e| e.to_string())
}

/// Hillshaded hypsometric preview, sea in blue.
fn write_png(path: &Path, heights: &[f32], n: usize, cell: f32) -> Result<(), String> {
    let mut rgb = Vec::with_capacity(n * n * 3);
    let at = |x: usize, y: usize| heights[y.min(n - 1) * n + x.min(n - 1)];
    let stops = [
        (0.0, [70, 120, 60]),
        (300.0, [130, 160, 90]),
        (900.0, [190, 175, 120]),
        (1800.0, [150, 115, 90]),
        (3000.0, [235, 235, 235]),
    ];
    for y in 0..n {
        for x in 0..n {
            let h = at(x, y);
            let gx = (at(x + 1, y) - at(x.saturating_sub(1), y)) / (2.0 * cell);
            let gy = (at(x, y + 1) - at(x, y.saturating_sub(1))) / (2.0 * cell);
            let light = (0.72 - 0.55 * gx - 0.5 * gy).clamp(0.2, 1.1);
            let color = if h <= 0.0 {
                let d = (-h / 400.0).clamp(0.0, 1.0);
                [
                    (60.0 - 30.0 * d) as u8,
                    (110.0 - 40.0 * d) as u8,
                    (160.0 - 30.0 * d) as u8,
                ]
            } else {
                let mut c = stops[stops.len() - 1].1;
                for w in stops.windows(2) {
                    if h < w[1].0 {
                        let t = (h - w[0].0) / (w[1].0 - w[0].0);
                        c = std::array::from_fn(|i| {
                            (w[0].1[i] as f32 * (1.0 - t) + w[1].1[i] as f32 * t) as u8
                        });
                        break;
                    }
                }
                c.map(|v| (v as f32 * light).clamp(0.0, 255.0) as u8)
            };
            rgb.extend(color);
        }
    }
    let file = std::fs::File::create(path).map_err(|e| e.to_string())?;
    let mut encoder = png::Encoder::new(std::io::BufWriter::new(file), n as u32, n as u32);
    encoder.set_color(png::ColorType::Rgb);
    encoder
        .write_header()
        .map_err(|e| e.to_string())?
        .write_image_data(&rgb)
        .map_err(|e| e.to_string())
}

fn read_npy(path: &Path) -> Result<(Vec<f32>, Vec<usize>), String> {
    let bytes = std::fs::read(path).map_err(|e| format!("{}: {e}", path.display()))?;
    let len = u16::from_le_bytes([bytes[8], bytes[9]]) as usize;
    let header = String::from_utf8_lossy(&bytes[10..10 + len]);
    if !header.contains("'<f4'") || header.contains("'fortran_order': True") {
        return Err("Tableau .npy float32 C attendu.".into());
    }
    let shape: Vec<usize> = header
        .split("'shape': (")
        .nth(1)
        .and_then(|s| s.split(')').next())
        .unwrap_or_default()
        .split(',')
        .filter_map(|v| v.trim().parse().ok())
        .collect();
    let values = bytes[10 + len..]
        .as_chunks::<4>()
        .0
        .iter()
        .map(|&b| f32::from_le_bytes(b))
        .collect();
    Ok((values, shape))
}

fn stats(label: &str, a: &[f32], b: &[f32]) {
    let n = a.len() as f64;
    let mean_abs = a
        .iter()
        .zip(b)
        .map(|(x, y)| (x - y).abs() as f64)
        .sum::<f64>()
        / n;
    let max_abs = a
        .iter()
        .zip(b)
        .map(|(x, y)| (x - y).abs())
        .fold(0.0f32, f32::max);
    let (ma, mb) = (
        a.iter().map(|&x| x as f64).sum::<f64>() / n,
        b.iter().map(|&x| x as f64).sum::<f64>() / n,
    );
    let cov = a
        .iter()
        .zip(b)
        .map(|(&x, &y)| (x as f64 - ma) * (y as f64 - mb))
        .sum::<f64>();
    let va = a.iter().map(|&x| (x as f64 - ma).powi(2)).sum::<f64>();
    let vb = b.iter().map(|&y| (y as f64 - mb).powi(2)).sum::<f64>();
    println!(
        "{label}: écart moyen {mean_abs:.2} m · max {max_abs:.1} m · corrélation {:.5} · moyennes {ma:.1} / {mb:.1} m",
        cov / (va * vb).sqrt()
    );
}

fn run() -> Result<(), String> {
    let (command, options) = args();
    match command.as_str() {
        "export" => {
            let infinite = root().join("../../infinite_map");
            let base = std::env::var_os("MAGNA_NEURAL_BASE")
                .map(PathBuf::from)
                .or_else(base_checkpoint)
                .unwrap_or_default();
            let path = |key: &str, default: PathBuf| {
                options.get(key).map(PathBuf::from).unwrap_or(default)
            };
            export::export(
                export::Sources {
                    coarse: &path("coarse", infinite.join("distill/weights/coarse4.pt")),
                    base: &path("base", base),
                    decoder: &path("decoder", infinite.join("distill/weights/decoder.pt")),
                },
                &path("out", default_weights()),
            )
        }
        "generate" => {
            let weights = options
                .get("weights")
                .map(PathBuf::from)
                .unwrap_or_else(default_weights);
            let (networks, load_s) = load_networks(&weights)?;
            println!("Poids chargés en {load_s:.2} s");
            let seed = world_seed(options.get("seed").map(String::as_str).unwrap_or("42"));
            let mut request = Request::new(seed, sketch(&options, seed)?);
            request.exact = options.contains_key("exact");
            request.keep_stages = options.contains_key("stages");
            request.origin = options.get("origin").and_then(|o| o.parse().ok());
            if let Some(noise) = options.get("noise").and_then(|v| v.parse().ok()) {
                request.height_noise = noise;
            }
            let repeat: usize = options
                .get("repeat")
                .and_then(|r| r.parse().ok())
                .unwrap_or(1);
            let clock = Wall(Instant::now());
            let mut output = None;
            for run in 0..repeat {
                let started = clock.now_ms();
                let result = pollster::block_on(networks.generate(&request, &clock))?;
                let t = &result.timings;
                println!(
                    "passe {run}: {:.0} ms · coarse {:.0} · base {:.0} · decoder {:.0} · reconstruction {:.0} · évaluations {:?}",
                    clock.now_ms() - started,
                    t.coarse_ms,
                    t.base_ms,
                    t.decoder_ms,
                    t.reconstruction_ms,
                    result.evaluations
                );
                output = Some(result);
            }
            let output = output.unwrap();
            let (min, max) = output
                .heights
                .iter()
                .fold((f32::MAX, f32::MIN), |(a, b), &h| (a.min(h), b.max(h)));
            let land = output.heights.iter().filter(|&&h| h > 0.0).count() as f64
                / output.heights.len() as f64;
            println!(
                "altitudes {min:.0} … {max:.0} m · terres {:.1} %",
                land * 100.0
            );
            let out = PathBuf::from(
                options
                    .get("out")
                    .cloned()
                    .unwrap_or_else(|| "out/neural/map".into()),
            );
            if let Some(parent) = out.parent() {
                std::fs::create_dir_all(parent).map_err(|e| e.to_string())?;
            }
            write_f32(&out.with_extension("native.f32"), &output.native)?;
            if let Some(stages) = &output.stages {
                write_f32(&out.with_extension("coarse.f32"), &stages.coarse)?;
                write_f32(&out.with_extension("latent.f32"), &stages.latent)?;
                write_f32(&out.with_extension("residual.f32"), &stages.residual)?;
            }
            write_f32(&out.with_extension("f32"), &output.heights)?;
            write_png(
                &out.with_extension("png"),
                &output.heights,
                output.resolution,
                40000.0 / output.resolution as f32,
            )?;
            println!("{}", out.with_extension("png").display());
            Ok(())
        }
        "compare" => {
            let (reference, shape) = read_npy(Path::new(
                options.get("reference").ok_or("--reference requis")?,
            ))?;
            let native: Vec<f32> = std::fs::read(options.get("native").ok_or("--native requis")?)
                .map_err(|e| e.to_string())?
                .as_chunks::<4>()
                .0
                .iter()
                .map(|&b| f32::from_le_bytes(b))
                .collect();
            if native.len() != reference.len() {
                return Err(format!(
                    "Tailles différentes : {} / {:?}",
                    native.len(),
                    shape
                ));
            }
            stats("natif", &native, &reference);
            let n = shape[0];
            let interior: (Vec<f32>, Vec<f32>) = (64..n - 64)
                .flat_map(|y| (64..n - 64).map(move |x| y * n + x))
                .map(|i| (native[i], reference[i]))
                .unzip();
            stats("intérieur", &interior.0, &interior.1);
            Ok(())
        }
        "serve" => {
            let weights = options
                .get("weights")
                .map(PathBuf::from)
                .unwrap_or_else(default_weights);
            let address = options
                .get("address")
                .cloned()
                .unwrap_or_else(|| "127.0.0.1:8792".into());
            crate::server::serve(
                &address,
                move || {
                    let (networks, seconds) = load_networks(&weights)?;
                    Ok((
                        networks,
                        format!("Poids chargés en {seconds:.1} s ({})", weights.display()),
                    ))
                },
                !options.contains_key("no-warmup"),
            )
        }
        _ => Err("Usage : neural export|generate|compare|serve [options]".into()),
    }
}

pub fn main() {
    env_logger::init();
    if let Err(error) = run() {
        eprintln!("{error}");
        std::process::exit(1);
    }
}
