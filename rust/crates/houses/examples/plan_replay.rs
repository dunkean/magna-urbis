//! Replay a captured compact request with the current library, without a server.
use magna_urbis_houses::placement::ArchitectureFunction;
use magna_urbis_houses::plans::{PlanBatchRequest, RealizePlanRequest, plan_batch, realize_plan};
use std::collections::BTreeMap;

fn main() -> Result<(), Box<dyn std::error::Error>> {
    let args: Vec<_> = std::env::args().collect();
    if args.len() != 3 && !(args.len() == 5 && args[3] == "--details") {
        return Err("Usage: plan_replay INPUT OUTPUT [--details REPORT]; detail checks are limited to 16 requests.".into());
    }
    let input: PlanBatchRequest = serde_json::from_slice(&std::fs::read(&args[1])?)?;
    if args.len() == 5 && input.requests.len() > 16 {
        return Err("Detail proof accepts at most 16 explicit requests; it must not realize a whole city.".into());
    }
    let started = std::time::Instant::now();
    let output = plan_batch(input)?;
    let mut reasons = BTreeMap::new();
    for refusal in &output.refusals {
        *reasons.entry(&refusal.message).or_insert(0u32) += 1;
    }
    println!("{}", serde_json::json!({"accepted":output.buildings.len(), "refused":output.refusals.len(), "open":output.open_spaces.len(), "ms":started.elapsed().as_millis(), "reasons":reasons}));
    std::fs::write(&args[2], serde_json::to_vec(&output)?)?;
    if args.len() == 5 {
        let mut reports = Vec::new();
        for building in &output.buildings {
            for interiors in [false, true] {
                // Non-domestic programmes deliberately have no certified rooms.
                if interiors && !matches!(building.function, ArchitectureFunction::Domestic | ArchitectureFunction::Mixed) {
                    continue;
                }
                let detail_start = std::time::Instant::now();
                let detail = realize_plan(RealizePlanRequest { building: building.clone(), interiors });
                reports.push(serde_json::json!({
                    "id": building.id, "recipe": building.recipe_id, "variant": building.variant_id,
                    "interiors": interiors, "ok": detail.is_ok(), "error": detail.err(),
                    "ms": detail_start.elapsed().as_secs_f64() * 1000.,
                }));
            }
        }
        std::fs::write(&args[4], serde_json::to_vec_pretty(&serde_json::json!({
            "schema_version": "targeted-native-detail-proof-1", "input": args[1],
            "accepted_plans": output.buildings.len(), "refused_plans": output.refusals.len(),
            "details": reports,
            "scope": "Explicit small witness set. This is not a city acceptance rate or certified population capacity."
        }))?)?;
    }
    Ok(())
}
