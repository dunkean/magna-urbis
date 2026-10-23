//! Display buffers of a saved plan: cargo run --release -p magna-urbis-core --example city_display -- <layout.json> <partition.json> <out.bin>
use magna_urbis_core::urban::{Layout, Partition, display::display_buffers};
use std::time::Instant;
fn main() {
    let args: Vec<String> = std::env::args().collect();
    let layout: Layout = serde_json::from_slice(&std::fs::read(&args[1]).unwrap()).unwrap();
    let partition: Partition = serde_json::from_slice(&std::fs::read(&args[2]).unwrap()).unwrap();
    let t = Instant::now();
    let blob = display_buffers(&[layout], &[partition], false);
    let ms = t.elapsed().as_secs_f64() * 1000.0;
    std::fs::write(&args[3], &blob).unwrap();
    println!("display buffers: {} bytes in {ms:.1} ms", blob.len());
}
