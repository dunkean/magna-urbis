//! Desktop uses the same direct GPU engine and NF4 B75 weights as browser V2.
pub use neural_runtime::{Clock, Family, Regional, Request, Sketch, Validation, plan, weights, sketch};
#[path = "../../neural/src/export.rs"]
#[allow(dead_code)]
mod export;
#[path = "../../neural/src/server.rs"]
mod server;
#[path = "../../neural/src/zones.rs"]
mod zones;
use std::path::PathBuf;

const MODEL_PROFILE: &str = "coarse4-nf4-b75-t2-decoder";
struct Networks(neural_runtime::Networks);
impl Networks {
    async fn generate(&self, request: &Request, clock: &dyn Clock) -> Result<neural_runtime::pipeline::Output, String> {
        self.0.clear_cache();
        self.0.generate(request, clock).await
    }
}

fn run() -> Result<(), String> {
    let args: Vec<_> = std::env::args().skip(1).collect();
    let option = |name: &str| args.windows(2).find(|pair| pair[0] == name).map(|pair| pair[1].clone());
    match args.first().map(String::as_str) {
        Some("prepare-models") => export::students(
            &PathBuf::from(option("--coarse").ok_or("Missing --coarse")?),
            &PathBuf::from(option("--decoder").ok_or("Missing --decoder")?),
            &PathBuf::from(option("--output").ok_or("Missing --output")?),
        ),
        Some("serve") => {
            let weights = PathBuf::from(option("--weights").ok_or("Missing --weights")?);
            let address = option("--address").unwrap_or_else(|| "127.0.0.1:0".into());
            server::serve(&address, move || {
                let read = |file| std::fs::read(weights.join(file)).map_err(|e| format!("{file}: {e}"));
                let networks = pollster::block_on(neural_runtime::load_networks(
                    read("coarse.safetensors")?, read("base.nf4")?, read("decoder.safetensors")?,
                ))?;
                Ok((Networks(networks), MODEL_PROFILE.into()))
            }, false)
        }
        _ => Err("Usage: magna-urbis-neural serve --weights DIR [--address 127.0.0.1:PORT] | prepare-models --coarse FILE --decoder FILE --output DIR".into()),
    }
}
fn main() {
    if let Err(error) = run() { eprintln!("{error}"); std::process::exit(1); }
}
