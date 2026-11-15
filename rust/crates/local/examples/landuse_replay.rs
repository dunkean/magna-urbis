//! Replay captured `/landuse` bodies through the engine's dispatch, without HTTP or a running engine.
//! landuse_replay REQUEST [REFERENCE_REPLY] [REPEATS=1] [OUT_REPLY]
//! Prints the wall time of each repeat and a canonical hash of the reply: its JSON header without the
//! `ms.*` timing stats, then the raw coordinate planes. With a reference reply (captured from the
//! running engine), prints whether both canonical forms are identical. URBAN_PROFILE=1 prints laps.
#[allow(dead_code)]
#[path = "../src/main.rs"]
mod engine;
use std::{sync::Mutex, time::Instant};

/// Header (without `ms.*` stats) and planes of a framed land-use reply.
fn canonical(body: &[u8]) -> Result<Vec<u8>, String> {
    let n = u32::from_le_bytes(body.get(..4).ok_or("short reply")?.try_into().unwrap()) as usize;
    let header = body.get(4..4 + n).ok_or("short reply header")?;
    let mut v: serde_json::Value = serde_json::from_slice(header).map_err(|e| e.to_string())?;
    if let Some(stats) = v.get_mut("stats").and_then(|s| s.as_object_mut()) {
        stats.retain(|k, _| !k.starts_with("ms"));
    }
    let mut out = serde_json::to_vec(&v).map_err(|e| e.to_string())?;
    out.extend_from_slice(&body[4 + n..]);
    Ok(out)
}
fn fnv(bytes: &[u8]) -> u64 {
    bytes.iter().fold(0xcbf29ce484222325, |h, &b| (h ^ b as u64).wrapping_mul(0x100000001b3))
}
fn main() -> Result<(), Box<dyn std::error::Error>> {
    eprintln!("{}", magna_urbis_core::threads::configure(2));
    let a: Vec<_> = std::env::args().collect();
    let request = std::fs::read(a.get(1).ok_or("REQUEST [REFERENCE_REPLY] [REPEATS] [OUT_REPLY]")?)?;
    let reference = a.get(2).filter(|s| !s.is_empty() && *s != "-").map(std::fs::read).transpose()?;
    let repeats: usize = a.get(3).map(|s| s.parse()).transpose()?.unwrap_or(1);
    let sessions = Mutex::new(engine::Sessions::default());
    let mut last = None;
    for r in 0..repeats {
        let started = Instant::now();
        let reply = engine::dispatch("/landuse", &request, &sessions).map_err(|e| format!("{e:?}"))?;
        println!("repeat {r}: {:.0} ms, reply {} bytes", started.elapsed().as_secs_f64() * 1000.0, reply.body.len());
        last = Some(reply.body);
    }
    let body = last.ok_or("no repeat")?;
    let ours = canonical(&body)?;
    println!("canonical {:016x} ({} bytes)", fnv(&ours), ours.len());
    if let Some(reference) = reference {
        let theirs = canonical(&reference)?;
        println!("reference {:016x} ({} bytes): {}", fnv(&theirs), theirs.len(), if ours == theirs { "IDENTICAL" } else { "DIFFERENT" });
    }
    if let Some(path) = a.get(4) {
        std::fs::write(path, &body)?;
    }
    Ok(())
}
