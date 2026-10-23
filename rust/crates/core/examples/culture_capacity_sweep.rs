//! Residential capacity of every catalogue culture on one real terrain.
//! Args: fixture.json output.json [populations, e.g. 5000,50000] [culture filter substring]
//! The fixture is the same as `urban_case_replay` (raster, vector geography,
//! sites, roads, configs); each run replaces the first site's culture and
//! population. For each run it reports housing demand vs parcel capacity, the
//! deficit, plots/gardens/residual shares and stage times, so a culture whose
//! lot sizes and household caps cannot house its population is caught early.
use magna_urbis_core::urban::{
    Geography, LayoutConfig, ParcelConfig, Site, Street, Surface, VectorGeography,
    generate_parcels, generate_quarters,
};
use serde::Deserialize;
use serde_json::{Value, json};
use std::time::Instant;

#[derive(Deserialize)]
#[serde(rename_all = "camelCase")]
struct Fixture {
    seed: String,
    n: usize,
    width: f64,
    height: Vec<f32>,
    water: Vec<u8>,
    #[allow(dead_code)]
    water_level: Vec<f32>,
    geometry: Option<VectorGeography>,
    sites: Vec<Site>,
    roads: Vec<Street>,
    layout_config: LayoutConfig,
    #[serde(default)]
    parcel_config: ParcelConfig,
}

fn main() -> Result<(), Box<dyn std::error::Error>> {
    let args: Vec<_> = std::env::args().collect();
    if args.len() < 3 {
        return Err("Expected fixture.json output.json [populations] [culture filter]".into());
    }
    let f: Fixture = serde_json::from_slice(&std::fs::read(&args[1])?)?;
    let populations: Vec<u32> = args
        .get(3)
        .map_or("5000,50000", |s| s.as_str())
        .split(',')
        .filter_map(|p| p.trim().parse().ok())
        .collect();
    let filter = args.get(4).cloned().unwrap_or_default();
    let catalogue: Value = serde_json::from_str(include_str!("../src/urban/catalogue.json"))?;
    let cultures: Vec<String> = catalogue["cultures"]
        .as_object()
        .ok_or("catalogue without cultures")?
        .keys()
        .filter(|c| c.contains(&filter))
        .cloned()
        .collect();
    let geography = f.geometry.map(|g| Geography::new(g, f.width)).transpose()?;
    let surface = Surface { geometry: geography.as_ref(), width: f.width, n: f.n, height: &f.height, water: &f.water };
    let mut rows = vec![];
    for culture in &cultures {
        for &population in &populations {
            let mut site = f.sites.first().cloned().ok_or("fixture without site")?;
            site.culture = culture.clone();
            site.population = population;
            site.radius = 300.0 * (population as f64 / 5000.0).sqrt();
            let cfg = LayoutConfig { culture: "site".into(), ..f.layout_config.clone() };
            let start = Instant::now();
            // A panic in one culture (e.g. a polygon boolean) is recorded, not fatal.
            let result = std::panic::catch_unwind(std::panic::AssertUnwindSafe(|| {
                generate_quarters(&f.seed, &[site], &cfg, surface, &f.roads).and_then(|layouts| {
                    let quarters_ms = start.elapsed().as_secs_f64() * 1000.0;
                    let start = Instant::now();
                    generate_parcels(&f.seed, &layouts, &f.parcel_config)
                        .map(|p| (layouts, p, quarters_ms, start.elapsed().as_secs_f64() * 1000.0))
                })
            }))
            .unwrap_or_else(|panic| {
                let message = panic.downcast_ref::<String>().cloned()
                    .or_else(|| panic.downcast_ref::<&str>().map(|s| s.to_string()))
                    .unwrap_or_else(|| "panic".into());
                Err(format!("PANIC: {message}"))
            });
            let row = match result {
                Err(error) => json!({"culture": culture, "population": population, "error": error}),
                Ok((layouts, partitions, quarters_ms, parcels_ms)) => {
                    // Same reference on both sides: domestic demand vs households
                    // allocated to domestic demands; all-function households apart.
                    let (mut requested, mut capacity, mut placed, mut placed_all) = (0.0, 0.0, 0.0, 0.0);
                    let (mut plots, mut gardens, mut residual, mut lots) = (0.0, 0.0, 0.0, 0usize);
                    for p in &partitions {
                        lots += p.parcels.len();
                        for parcel in &p.parcels {
                            let a = parcel_area(&parcel.shape);
                            match parcel.use_kind.as_str() {
                                "plot" | "court" | "compound" => plots += a,
                                "garden" => gardens += a,
                                "residual" => residual += a,
                                _ => {}
                            }
                        }
                        if let Some(pr) = &p.programme {
                            for d in pr.demands.iter().filter(|d| d.function == "domestic") {
                                requested += d.requested;
                                capacity += d.parcel_capacity;
                            }
                            placed += pr.allocations.iter().filter(|a| a.function == "domestic").map(|a| a.households).sum::<f64>();
                            placed_all += pr.allocations.iter().map(|a| a.households).sum::<f64>();
                        }
                    }
                    let total = (plots + gardens + residual).max(1.0);
                    let warnings: Vec<&String> = layouts.iter().flat_map(|l| &l.warnings).chain(partitions.iter().flat_map(|p| &p.warnings)).collect();
                    json!({"culture": culture, "population": population,
                        "households_requested": requested.round(), "households_placed": placed.round(), "households_all_functions": placed_all.round(),
                        "parcel_capacity": capacity.round(),
                        "deficit_pct": if requested > 0.0 { ((requested - placed).max(0.0) / requested * 1000.0).round() / 10.0 } else { 0.0 },
                        "lots": lots, "blocks": layouts.iter().map(|l| l.blocks.len()).sum::<usize>(),
                        "plot_share": (plots / total * 1000.0).round() / 10.0, "garden_share": (gardens / total * 1000.0).round() / 10.0,
                        "residual_share": (residual / total * 1000.0).round() / 10.0,
                        "quarters_ms": quarters_ms.round(), "parcels_ms": parcels_ms.round(), "warnings": warnings.len()})
                }
            };
            println!("{row}");
            rows.push(row);
        }
    }
    std::fs::write(&args[2], serde_json::to_vec_pretty(&rows)?)?;
    let failing = rows.iter().filter(|r| r["deficit_pct"].as_f64().unwrap_or(100.0) > 5.0 || r.get("error").is_some()).count();
    println!("{} runs, {failing} with a housing deficit above 5 % or an error", rows.len());
    Ok(())
}

fn parcel_area(s: &magna_urbis_core::urban::Shape) -> f64 {
    let ring = |r: &[magna_urbis_core::urban::Point]| {
        r.iter().zip(r.iter().cycle().skip(1)).map(|(a, b)| a.x * b.y - b.x * a.y).sum::<f64>().abs() / 2.0
    };
    ring(&s.outer) - s.holes.iter().map(|h| ring(h)).sum::<f64>()
}
