//! Bounded profiling of exact captured city requests. No server lifecycle changes.
//! cargo run --release -p magna-urbis-houses --example city_plan_profile -- <requests.json> [count] [report.json]
use magna_urbis_houses::{
    catalogue::catalogue,
    model::HouseConfig,
    placement::{ArchitectureFunction, PlacementRequest},
    plans::{PlanBatchRequest, plan_batch},
    style_index::{StyleQuery, style_index},
};
use serde_json::json;
use sha2::{Digest, Sha256};
use std::{collections::BTreeMap, hint::black_box, time::Instant};

fn main() {
    let args: Vec<_> = std::env::args().collect();
    let mut requests: Vec<PlacementRequest> =
        serde_json::from_slice(&std::fs::read(&args[1]).unwrap()).unwrap();
    requests.truncate(args.get(2).and_then(|n| n.parse().ok()).unwrap_or(64));
    let input = PlanBatchRequest {
        schema_version: "1".into(),
        requests,
        settings: None,
        footprints: BTreeMap::new(),
    };
    let index = style_index().unwrap();
    let data = catalogue().unwrap();
    let mut shortlist_us = 0.;
    let mut validation_us = 0.;
    let mut shortlist_ids = Vec::new();
    for r in &input.requests {
        if r.function == ArchitectureFunction::OpenSpace {
            continue;
        }
        let mut config: HouseConfig = r.config.clone().unwrap_or_default();
        config.pack = r.culture.pack.clone();
        config.mode = r.culture.mode;
        config.seed = r.seed.clone();
        config.count = 1;
        config.orientation_deg = 0.;
        let query = StyleQuery {
            pack_id: Some(config.pack.clone()),
            recipe_id: config.recipe.clone(),
            variant_id: config.overrides.variant.clone(),
            mode: config.mode,
            era: config.era.clone(),
            allow_late: config.allow_late,
            typology: r.typology,
            include_variants: config.variation > 0. || config.overrides.variant.is_some(),
            ..Default::default()
        };
        let begin = Instant::now();
        for _ in 0..10 {
            black_box(data.validate_config(&config)).unwrap();
        }
        validation_us += begin.elapsed().as_secs_f64() * 100_000.;
        let begin = Instant::now();
        for _ in 0..10 {
            black_box(index.candidate_styles_for_config(&query, &config, &r.seed, 4)).unwrap();
        }
        shortlist_us += begin.elapsed().as_secs_f64() * 100_000.;
        shortlist_ids.push(
            index
                .candidate_styles_for_config(&query, &config, &r.seed, 4)
                .unwrap()
                .iter()
                .map(|e| e.id.clone())
                .collect::<Vec<_>>(),
        );
    }
    let begin = Instant::now();
    let result = plan_batch(input.clone()).unwrap();
    let total_ms = begin.elapsed().as_secs_f64() * 1000.;
    let begin = Instant::now();
    let bytes = serde_json::to_vec(&result).unwrap();
    let serialization_ms = begin.elapsed().as_secs_f64() * 1000.;
    let mut individuals = Vec::new();
    for r in &input.requests {
        let begin = Instant::now();
        let result = plan_batch(PlanBatchRequest {
            schema_version: "1".into(),
            requests: vec![r.clone()],
            settings: None,
            footprints: BTreeMap::new(),
        })
        .unwrap();
        individuals.push(json!({ "id": r.id, "ms": begin.elapsed().as_secs_f64()*1000.,
            "winner": result.buildings.first().map(|b| format!("{}::{}", b.recipe_id, b.variant_id)),
            "refusal": result.refusals.first().map(|r| &r.message) }));
    }
    individuals.sort_by(|a, b| {
        b["ms"]
            .as_f64()
            .unwrap()
            .total_cmp(&a["ms"].as_f64().unwrap())
    });
    let report = json!({ "requests":input.requests.len(), "accepted":result.buildings.len(), "refused": result.refusals.len(), "open": result.open_spaces.len(),
        "plan_ms":total_ms, "serialization_ms":serialization_ms, "shortlist_ms":shortlist_us/1000., "validation_ms":validation_us/1000.,
        "sha256": format!("{:x}",Sha256::digest(&bytes)), "shortlists":shortlist_ids, "individuals":individuals });
    if let Some(path) = args.get(3) {
        std::fs::write(path, serde_json::to_vec_pretty(&report).unwrap()).unwrap();
    }
    println!(
        "{}",
        json!({"requests":report["requests"], "accepted":report["accepted"], "refused":report["refused"],
        "plan_ms":total_ms, "serialization_ms":serialization_ms, "shortlist_ms":shortlist_us/1000., "validation_ms":validation_us/1000.,
        "sha256":report["sha256"], "slowest":&report["individuals"].as_array().unwrap()[..5.min(input.requests.len())] })
    );
}
