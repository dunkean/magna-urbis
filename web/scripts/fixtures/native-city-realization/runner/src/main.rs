use std::io::{self, BufRead, Write};

// Identical pure engine entry used by houses-wasm::realize_plan_json.
// JSONL transport only; no generation, replacement seed, footprint or fallback.
fn main() -> Result<(), Box<dyn std::error::Error>> {
    let planning = std::env::args().any(|arg| arg == "--plan");
    let stdin = io::stdin();
    let mut output = io::BufWriter::new(io::stdout().lock());
    for input in stdin.lock().lines() {
        let input = input?;
        if input.len() > 32 * 1024 * 1024 {
            writeln!(output, "{}", serde_json::json!({"ok":false,"error":{"code":"input_budget","message":"Retained plan exceeds 32 MiB."}}))?;
            output.flush()?;
            continue;
        }
        let result = if planning {
            match serde_json::from_str::<magna_urbis_houses::plans::PlanBatchRequest>(&input) {
                Ok(request) => match magna_urbis_houses::plans::plan_batch(request) {
                    Ok(batch) => serde_json::json!({"ok":true,"data":batch}),
                    Err(error) => serde_json::json!({"ok":false,"error":{"code":"plan_generation","message":error}}),
                },
                Err(error) => serde_json::json!({"ok":false,"error":{"code":"invalid_json","message":error.to_string()}}),
            }
        } else { match serde_json::from_str::<magna_urbis_houses::plans::RealizePlanRequest>(&input) {
            Ok(request) => match magna_urbis_houses::plans::realize_plan(request) {
                Ok(batch) => serde_json::json!({"ok":true,"data":batch}),
                Err(error) => serde_json::json!({"ok":false,"error":{"code":"realization_refused","message":error}}),
            },
            Err(error) => serde_json::json!({"ok":false,"error":{"code":"invalid_json","message":error.to_string()}}),
        }};
        serde_json::to_writer(&mut output, &result)?;
        writeln!(output)?;
        output.flush()?;
    }
    Ok(())
}
