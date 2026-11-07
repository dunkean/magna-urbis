//! Replay the exact /terrain/water handler input without running an engine.
use magna_urbis_terrain::vector_water::request_with_clock;
use serde_json::Value;
use std::{path::PathBuf, time::Instant};

fn zero_times(v: &mut Value) {
    match v {
        Value::Object(m) => {
            for (k, v) in m {
                if k == "ms" || k.ends_with("Ms") {
                    *v = Value::from(0);
                } else {
                    zero_times(v);
                }
            }
        }
        Value::Array(a) => {
            for v in a {
                zero_times(v);
            }
        }
        _ => {}
    }
}
fn main() {
    let args: Vec<_> = std::env::args().skip(1).collect();
    let capture = PathBuf::from(
        args.first()
            .expect("water_replay CAPTURE_DIR [SAVE_DIR|--loop]"),
    );
    let requests: Vec<_> = [1, 6, 7, 8, 10]
        .into_iter()
        .map(|id| {
            let name = format!("terrain_water-{id}");
            let body = std::fs::read(capture.join(format!("{name}.bin"))).unwrap();
            (name, body)
        })
        .collect();
    let looping = args.get(1).is_some_and(|s| s == "--loop");
    if let Some(dir) = args.get(1).filter(|_| !looping) {
        std::fs::create_dir_all(dir).unwrap();
    }
    loop {
        let mut total = 0.0;
        for (name, body) in &requests {
            let start = Instant::now();
            let reply =
                request_with_clock(body, &|| start.elapsed().as_secs_f64() * 1000.0).unwrap();
            let ms = start.elapsed().as_secs_f64() * 1000.0;
            total += ms;
            if looping {
                continue;
            }
            let len = u32::from_le_bytes(reply[..4].try_into().unwrap()) as usize;
            let mut meta: Value = serde_json::from_slice(&reply[4..4 + len]).unwrap();
            let phases = [
                "conditioning.ms",
                "water.hydrologyMs",
                "water.balanceMs",
                "water.rivers.ms",
            ]
            .map(|path| {
                let mut v = &meta;
                for k in path.split('.') {
                    v = &v[k];
                }
                format!("{path}={v}")
            })
            .join(" ");
            zero_times(&mut meta);
            let canonical = serde_json::to_vec(&meta).unwrap();
            let hash = canonical
                .iter()
                .chain(&reply[4 + len..])
                .fold(0xcbf29ce484222325_u64, |h, b| {
                    (h ^ *b as u64).wrapping_mul(0x100000001b3)
                });
            println!(
                "{name}: {ms:.3} ms, {} bytes, fnv={hash:016x}, {phases}",
                reply.len()
            );
            if let Some(dir) = args.get(1) {
                std::fs::write(PathBuf::from(dir).join(format!("{name}.bin")), &reply).unwrap();
            }
        }
        if !looping {
            println!("total: {total:.3} ms");
            break;
        }
    }
}
