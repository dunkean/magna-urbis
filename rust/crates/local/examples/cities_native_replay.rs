//! Exact native V2 HTTP-body replay without HTTP, a listening port or terrain generation.
//! MANIFEST OUTPUT [REPEATS=1] [START_DELAY_SECONDS=0]. Prepare manifests with cities-native/prepare.py.
//! Replies are written as `<index>.json`; a parcels pack reply as `<index>.bin`, plus
//! `<index>.partitions.json` (`{"partitions": [...]}`, the unpacked pack) when `PACK_JSON=1`.
#[allow(dead_code)]
#[path = "../src/main.rs"]
mod engine;
use magna_urbis_core::urban::parcel_pack;
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
    let pack_json=std::env::var("PACK_JSON").is_ok_and(|v|v=="1");
    let calls:Vec<Call>=serde_json::from_slice(&std::fs::read(&manifest)?)?;
    let inputs:Vec<_>=calls.iter().map(|c|std::fs::read(root.join(&c.request))).collect::<Result<_,_>>()?;
    println!("pid {} ready; {} requests, {} repeats",std::process::id(),calls.len(),repeat);
    std::thread::sleep(Duration::from_secs(delay));
    let mut metrics=vec![];
    for iteration in 0..repeat {
        let sessions=Mutex::new(engine::Sessions::default());
        // A request that names a retained source carries the revisions minted by the engine of
        // the capture: it is replayed with the handle of this run's latest reply for its session.
        let mut handles=std::collections::HashMap::<String,serde_json::Value>::new();
        for (i,(call,input)) in calls.iter().zip(&inputs).enumerate() {
            let mut patched=None;
            if call.path=="/urban" && let Ok(mut request)=serde_json::from_slice::<serde_json::Value>(input)
                && let Some(handle)=request["source"]["session"].as_str().and_then(|s|handles.get(s)) {
                request["source"]=handle.clone();
                patched=Some(serde_json::to_vec(&request)?);
            }
            let input=patched.as_ref().unwrap_or(input);
            let started=Instant::now();
            let reply=engine::dispatch(&call.path,input,&sessions).map_err(|e|format!("{} {}: {}",call.city,call.stage,e))?;
            let ms=started.elapsed().as_secs_f64()*1000.;
            // Parcels, programme and built capacity reply with a `magna-city-parcels` pack whose
            // JSON header carries the envelope (`id`, `ms`, `urbanSource`).
            let pack_header=(call.path=="/urban" && reply.kind=="application/octet-stream")
                .then(|| parcel_pack::header(&reply.body).ok()).flatten()
                .filter(|header| header["format"]==parcel_pack::FORMAT);
            let json_envelope=(pack_header.is_none() && call.path=="/urban" && reply.body.first()==Some(&b'{'))
                .then(|| serde_json::from_slice::<serde_json::Value>(&reply.body).ok()).flatten();
            if let Some(value)=pack_header.as_ref().or(json_envelope.as_ref())
                && let Some(session)=value["urbanSource"]["session"].as_str() {
                handles.insert(session.to_owned(),value["urbanSource"].clone());
            }
            if iteration==0 {
                if pack_header.is_some() {
                    std::fs::write(out.join(format!("{i:04}.bin")),&reply.body)?;
                    // The comparison tools read partitions as JSON: write the unpacked pack beside it.
                    if pack_json {
                        let partitions=parcel_pack::unpack(&reply.body)?;
                        let mut text=b"{\"partitions\":".to_vec();
                        serde_json::to_writer(&mut text,&partitions)?;
                        text.push(b'}');
                        std::fs::write(out.join(format!("{i:04}.partitions.json")),&text)?;
                    }
                } else {
                    std::fs::write(out.join(format!("{i:04}.json")),&reply.body)?;
                }
            }
            metrics.push(serde_json::json!({"iteration":iteration,"i":i,"city":call.city,"stage":call.stage,"ms":ms}));
        }
    }
    std::fs::write(out.join("metrics.json"),serde_json::to_vec_pretty(&metrics)?)?;
    Ok(())
}
