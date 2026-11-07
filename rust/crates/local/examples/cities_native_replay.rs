//! Exact native V2 HTTP-body replay without HTTP, a listening port or terrain generation.
//! MANIFEST OUTPUT [REPEATS=1] [START_DELAY_SECONDS=0]. Prepare manifests with cities-native/prepare.py.
#[allow(dead_code)]
#[path = "../src/main.rs"]
mod engine;
use serde::Deserialize;
use std::{path::PathBuf, sync::Mutex, time::{Duration, Instant}};
#[derive(Deserialize)]
struct Call { path: String, request: String, stage: String, city: String }
fn main() -> Result<(), Box<dyn std::error::Error>> {
    let a: Vec<_> = std::env::args().collect();
    let manifest=PathBuf::from(a.get(1).ok_or("MANIFEST OUTPUT [REPEATS] [START_DELAY_SECONDS]")?);
    let root=manifest.parent().unwrap();
    let out=PathBuf::from(a.get(2).ok_or("Missing OUTPUT")?); std::fs::create_dir_all(&out)?;
    let repeat:usize=a.get(3).map(|s|s.parse()).transpose()?.unwrap_or(1);
    let delay:u64=a.get(4).map(|s|s.parse()).transpose()?.unwrap_or(0);
    let calls:Vec<Call>=serde_json::from_slice(&std::fs::read(&manifest)?)?;
    let inputs:Vec<_>=calls.iter().map(|c|std::fs::read(root.join(&c.request))).collect::<Result<_,_>>()?;
    println!("pid {} ready; {} requests, {} repeats",std::process::id(),calls.len(),repeat);
    std::thread::sleep(Duration::from_secs(delay));
    let mut metrics=vec![];
    for iteration in 0..repeat {
        let sessions=Mutex::new(engine::Sessions::default());
        for (i,(call,input)) in calls.iter().zip(&inputs).enumerate() {
            let started=Instant::now();
            let reply=engine::dispatch(&call.path,input,&sessions).map_err(|e|format!("{} {}: {}",call.city,call.stage,e))?;
            let ms=started.elapsed().as_secs_f64()*1000.;
            if iteration==0 {std::fs::write(out.join(format!("{i:04}.json")),&reply.body)?;}
            metrics.push(serde_json::json!({"iteration":iteration,"i":i,"city":call.city,"stage":call.stage,"ms":ms}));
        }
    }
    std::fs::write(out.join("metrics.json"),serde_json::to_vec_pretty(&metrics)?)?;
    Ok(())
}
