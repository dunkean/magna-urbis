//! cargo run -p magna-urbis-houses --example admission -- crates/houses/data/urban-admission.json
//! --functional-choices-only [path] exports just that registry without any
//! native minimum/feasibility generation. Merge only that field in an existing
//! admission artifact after checking its source hash and catalogue version.
use sha2::{Digest, Sha256};
fn main() {
    let args: Vec<_> = std::env::args().skip(1).collect();
    if args
        .first()
        .is_some_and(|s| s == "--functional-choices-only")
    {
        assert!(args.len() <= 2, "Use --functional-choices-only [path]");
        let registry = magna_urbis_houses::functional_choices::registry()
            .expect("declared inspired functional choices");
        let output = serde_json::to_string_pretty(registry).unwrap();
        if let Some(path) = args.get(1) {
            std::fs::write(path, output).unwrap();
        } else {
            println!("{output}");
        }
        return;
    }
    assert!(
        args.len() <= 1 && args.first().is_none_or(|s| !s.starts_with("--")),
        "Use [output_path] or --functional-choices-only [output_path]"
    );
    let profiles =
        magna_urbis_houses::admission::minimum_admission_profiles().unwrap_or_else(|e| {
            eprintln!("{e}");
            std::process::exit(1)
        });
    let table = serde_json::json!({"schema_version":1,"generator_version":magna_urbis_houses::GENERATOR_VERSION,
        "source_sha256":format!("{:x}",Sha256::digest(include_bytes!("../data/recipes.json"))),"profiles":profiles,
        "functional_programmes":magna_urbis_houses::functional_programmes::registry().expect("declared functional programmes"),
        "functional_choices":magna_urbis_houses::functional_choices::registry().expect("declared inspired functional choices"),
        "feasibility":{"version":magna_urbis_houses::feasibility::FEASIBILITY_SCHEMA_VERSION,
            "profiles":magna_urbis_houses::feasibility::feasibility_profiles().expect("native recipe feasibility")},
        "cultural_palettes":{"version":magna_urbis_houses::cultural_palettes::CULTURAL_PALETTE_VERSION,
            "mappings":magna_urbis_houses::cultural_palettes::registry()}});
    let output = serde_json::to_string_pretty(&table).unwrap();
    if let Some(path) = args.first() {
        std::fs::write(path, &output).unwrap();
    } else {
        println!("{output}");
    }
}
