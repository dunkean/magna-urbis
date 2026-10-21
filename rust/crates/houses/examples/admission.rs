//! cargo run -p magna-urbis-houses --example admission -- crates/houses/data/urban-admission.json
use sha2::{Digest, Sha256};
fn main() {
    let profiles =
        magna_urbis_houses::admission::minimum_admission_profiles().unwrap_or_else(|e| {
            eprintln!("{e}");
            std::process::exit(1)
        });
    let table = serde_json::json!({"schema_version":1,"generator_version":magna_urbis_houses::GENERATOR_VERSION,
        "source_sha256":format!("{:x}",Sha256::digest(include_bytes!("../data/recipes.json"))),"profiles":profiles});
    let output = serde_json::to_string_pretty(&table).unwrap();
    if let Some(path) = std::env::args().nth(1) {
        std::fs::write(path, &output).unwrap();
    } else {
        println!("{output}");
    }
}
