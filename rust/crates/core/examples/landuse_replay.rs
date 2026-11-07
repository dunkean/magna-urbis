//! Captured /landuse requests, without an HTTP server. Run from the repository root.
use magna_urbis_core::landuse::{self, Window};
use serde_json::Value;
use std::{fs, time::Instant};
fn hash(bytes: &[u8]) -> u64 {
    bytes.iter().fold(0xcbf29ce484222325, |h, &b| {
        (h ^ b as u64).wrapping_mul(0x100000001b3)
    })
}
fn zero_times(v: &mut Value) {
    match v {
        Value::Object(o) => {
            for (k, v) in o {
                if k.starts_with("ms.") {
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
        _ => (),
    }
}
fn main() {
    let args: Vec<_> = std::env::args().collect();
    let count: usize = std::env::var("LANDUSE_REPLAY_COUNT")
        .ok()
        .and_then(|s| s.parse().ok())
        .or_else(|| args.get(1).and_then(|s| s.parse().ok()))
        .unwrap_or(3);
    let default_dest = std::env::var("LANDUSE_REPLAY_OUT")
        .unwrap_or_else(|_| "web/out/perf-2026-11-07/port/fix-landuse/after".into());
    let dest = if args.get(1).is_some_and(|s| s.parse::<usize>().is_ok()) {
        args.get(2).map(String::as_str).unwrap_or(&default_dest)
    } else {
        &default_dest
    };
    fs::create_dir_all(dest).unwrap();
    let requests: Vec<_> = [12, 20]
        .into_iter()
        .map(|id| {
            let custom = std::env::var("LANDUSE_REPLAY_INPUT").ok();
            let folder = if let Some(ref folder) = custom { folder.as_str() } else if std::env::var_os("LANDUSE_BINARY_INPUT").is_some() {
                "web/out/perf-2026-11-07/port/fix-landuse/packed"
            } else {
                "web/out/perf-2026-11-07/port/capture"
            };
            let b = fs::read(format!("{folder}/landuse-{id}.bin")).unwrap();
            let n = u32::from_le_bytes(b[..4].try_into().unwrap()) as usize;
            (
                id,
                String::from_utf8(b[4..4 + n].to_vec()).unwrap(),
                b[4 + n..].to_vec(),
            )
        })
        .collect();
    let header: Value = serde_json::from_str(&requests[0].1).unwrap();
    let plane = header["planes"]
        .as_array()
        .unwrap()
        .iter()
        .find(|p| p["name"] == "naturalForest")
        .unwrap();
    let offset = plane["offset"].as_u64().unwrap() as usize;
    let len = plane["length"].as_u64().unwrap() as usize;
    let forest: Vec<f32> = requests[0].2[offset..offset + len * 4]
        .chunks_exact(4)
        .map(|b| {
            if f32::from_le_bytes(b.try_into().unwrap()) >= 0.22 {
                1.0
            } else {
                0.0
            }
        })
        .collect();
    let w = header["w"].as_u64().unwrap() as usize;
    let h = header["h"].as_u64().unwrap() as usize;
    for iteration in 0..count {
        for (id, header, planes) in &requests {
            let start = Instant::now();
            let result = landuse::wire::execute(header, planes).unwrap();
            let ms = start.elapsed().as_secs_f64() * 1000.0;
            let decoded = landuse::wire::decode_reply(&result).unwrap();
            // Match the baseline's JSON number parsing when hashing. The TS replay
            // separately compares the direct binary decode with the old wire reply.
            let mut value: Value =
                serde_json::from_slice(&serde_json::to_vec(&decoded).unwrap()).unwrap();
            println!(
                "iteration={iteration} request={id} total_ms={ms:.3} bytes={} stats={}",
                result.len(),
                value["stats"]
            );
            zero_times(&mut value);
            let canonical = serde_json::to_vec(&value).unwrap();
            println!("request={id} fnv={:016x}", hash(&canonical));
            if iteration == 0 {
                let expected = fs::read(format!(
                    "web/out/perf-2026-11-07/port/fix-landuse/baseline/landuse-{id}.json"
                ))
                .unwrap();
                println!(
                    "request={id} baseline_match={}",
                    hash(&canonical) == hash(&expected)
                );
                fs::write(format!("{dest}/landuse-{id}.json"), canonical).unwrap();
                fs::write(format!("{dest}/landuse-{id}.bin"), &result).unwrap();
            }
        }
        let start = Instant::now();
        let regions = landuse::vectorize(
            &forest,
            w,
            h,
            78.125,
            0.0,
            Window {
                x0: 0,
                y0: 0,
                x1: w as isize - 1,
                y1: h as isize - 1,
            },
        );
        let ms = start.elapsed().as_secs_f64() * 1000.0;
        let bytes = serde_json::to_vec(&regions).unwrap();
        println!(
            "iteration={iteration} vector_ms={ms:.3} regions={} fnv={:016x}",
            regions.len(),
            hash(&bytes)
        );
        if iteration == 0 {
            let expected =
                fs::read("web/out/perf-2026-11-07/port/fix-landuse/baseline/vector.json").unwrap();
            assert_eq!(hash(&bytes), hash(&expected), "vectorizer differs");
            fs::write(format!("{dest}/vector.json"), bytes).unwrap();
        }
    }
}

#[test]
fn landuse_capture_replay() {
    main();
}
