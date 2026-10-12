//! Native replay/contract fixture and honest source-coverage audit.
use magna_urbis_houses::{catalogue::catalogue, generate_batch, model::HouseConfig};
use std::{env, fs, process};

fn main() {
    let args: Vec<_> = env::args().skip(1).collect();
    if args
        .first()
        .is_some_and(|s| s == "--audit" || s == "--audit-variants" || s == "--audit-batches")
    {
        let variants = args[0] == "--audit-variants";
        let batches = args[0] == "--audit-batches";
        let data = catalogue().expect("valid embedded catalogue");
        let mut success = 0;
        let mut total = 0;
        let mut failures = vec![];
        for recipe in &data.recipes {
            let choices: Vec<_> = if variants {
                recipe.variants.iter().map(|v| Some(v.id.clone())).collect()
            } else {
                vec![None]
            };
            for variant in choices {
                total += 1;
                eprintln!(
                    "Audit {} {:?}, count={}",
                    recipe.id,
                    variant,
                    if batches { 10 } else { 1 }
                );
                let config = HouseConfig {
                    pack: recipe.pack_id.clone(),
                    recipe: Some(recipe.id.clone()),
                    count: if batches { 10 } else { 1 },
                    allow_late: recipe.temporal.late_only,
                    variation: if batches { 0.65 } else { 0.0 },
                    overrides: magna_urbis_houses::model::Overrides {
                        variant: variant.clone(),
                        ..Default::default()
                    },
                    ..HouseConfig::default()
                };
                match generate_batch(config) {
                    Ok(_) => success += 1,
                    Err(error) => failures
                        .push(serde_json::json!({"id":recipe.id,"variant":variant,"error":error})),
                }
            }
        }
        println!(
            "{}",
            serde_json::json!({"generated":success,"total":total,"failures":failures})
        );
        if !failures.is_empty() {
            process::exit(1);
        }
        return;
    }
    let config = if args.first().is_some_and(|s| s == "--input") {
        serde_json::from_str(
            &fs::read_to_string(args.get(1).expect("--input file")).expect("read config"),
        )
        .expect("config JSON")
    } else {
        HouseConfig {
            pack: args
                .first()
                .and_then(|id| {
                    catalogue()
                        .ok()?
                        .recipes
                        .iter()
                        .find(|r| &r.id == id)
                        .map(|r| r.pack_id.clone())
                })
                .unwrap_or_else(|| HouseConfig::default().pack),
            recipe: args.first().cloned(),
            count: 1,
            variation: 0.0,
            ..HouseConfig::default()
        }
    };
    match generate_batch(config) {
        Ok(batch) => println!("{}", serde_json::to_string(&batch).expect("finite scene")),
        Err(error) => {
            eprintln!("{error}");
            process::exit(1);
        }
    }
}
