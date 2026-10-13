//! Reproducible native corpus for footprints, shared street fabrics and parcels.
//! Run: cargo run --release -p magna-urbis-core --example urban_refonte -- --out out/urban-refonte.json
//! Optional: --case rectangle --population 30000 --seed urban-refonte-v1 --repeat
//! --geometry out/urban-geometry.json exports complete native inputs and geometry.
use magna_urbis_core::urban::{
    FootprintConfig, LayoutConfig, ParcelConfig, Point, Site, Street, Surface, generate_parcels,
    generate_quarters,
};
use serde_json::{Value, json};
use std::time::Instant;

struct Case {
    family: &'static str,
    tissue: &'static str,
    terrain: &'static str,
    population: u32,
}
const CASES: [Case; 12] = [
    Case {
        family: "circle",
        tissue: "radial",
        terrain: "flat",
        population: 2500,
    },
    Case {
        family: "rectangle",
        tissue: "grid",
        terrain: "flat",
        population: 2500,
    },
    Case {
        family: "polygon",
        tissue: "grid",
        terrain: "flat",
        population: 2500,
    },
    Case {
        family: "compact",
        tissue: "organic",
        terrain: "crossroads",
        population: 2500,
    },
    Case {
        family: "elongated",
        tissue: "terraces",
        terrain: "valley",
        population: 2500,
    },
    Case {
        family: "linear",
        tissue: "organic",
        terrain: "curved-road",
        population: 600,
    },
    Case {
        family: "fan",
        tissue: "organic",
        terrain: "peninsula",
        population: 1600,
    },
    Case {
        family: "fingers",
        tissue: "radial",
        terrain: "crossroads",
        population: 2500,
    },
    Case {
        family: "dendritic",
        tissue: "dendritic",
        terrain: "valley",
        population: 1500,
    },
    Case {
        family: "lobed",
        tissue: "organic",
        terrain: "flat",
        population: 2500,
    },
    Case {
        family: "archipelago",
        tissue: "clusters",
        terrain: "river",
        population: 2500,
    },
    Case {
        family: "composite",
        tissue: "culture",
        terrain: "flat",
        population: 2500,
    },
];

fn terrain(kind: &str, width: f64, n: usize) -> (Vec<f32>, Vec<u8>, Vec<Street>) {
    let mut heights = vec![0.0; n * n];
    let mut water = vec![0; n * n];
    for y in 0..n {
        for x in 0..n {
            let px = (x as f64 + 0.5) / n as f64 * width;
            let py = (y as f64 + 0.5) / n as f64 * width;
            if kind == "valley" {
                heights[y * n + x] = (12.0 + ((py - width * 0.5) / 120.0).powi(2)) as f32;
            }
            if kind == "river" && (px - width * 0.49 - 35.0 * (py / 500.0).sin()).abs() < 35.0 {
                water[y * n + x] = 3;
            }
            if kind == "peninsula" && px < width * 0.47 && (py - width * 0.5).abs() > 170.0 {
                water[y * n + x] = 1;
            }
        }
    }
    let road = |path: Vec<Point>| Street {
        widths: vec![6.0; path.len()],
        path,
        rank: 1,
        role: "road".into(),
    };
    let mut roads = vec![];
    if matches!(kind, "crossroads" | "valley" | "curved-road") {
        roads.push(road(
            (0..=40)
                .map(|i| {
                    let x = i as f64 / 40.0 * width;
                    Point {
                        x,
                        y: width * 0.5
                            + if kind == "curved-road" {
                                (x / 350.0).sin() * 55.0
                            } else {
                                0.0
                            },
                    }
                })
                .collect(),
        ));
    }
    if kind == "crossroads" {
        roads.push(road(vec![
            Point {
                x: width * 0.5,
                y: 0.0,
            },
            Point {
                x: width * 0.5,
                y: width,
            },
        ]));
    }
    if kind == "river" {
        roads.push(Street {
            path: vec![
                Point {
                    x: width * 0.3,
                    y: width * 0.5,
                },
                Point {
                    x: width * 0.7,
                    y: width * 0.5,
                },
            ],
            widths: vec![7.0; 2],
            rank: 0,
            role: "bridge".into(),
        });
    }
    (heights, water, roads)
}

fn run(
    case: &Case,
    seed: &str,
    repeat: bool,
    population: Option<u32>,
    geometry: bool,
) -> Result<(Value, Option<Value>), String> {
    let population = population.unwrap_or(case.population);
    let width =
        (6.0 * (population as f64 * 10_000.0 / 70.0 / std::f64::consts::PI).sqrt()).max(3000.0);
    let n = 128;
    let (heights, water, roads) = terrain(case.terrain, width, n);
    let surface = Surface {
        geometry: None,
        width,
        n,
        height: &heights,
        water: &water,
    };
    let site = Site {
        key: case.family.into(),
        name: case.family.into(),
        population,
        culture: "european-organic".into(),
        center: Point {
            x: width * 0.5,
            y: width * 0.5,
        },
        radius: 250.0,
    };
    let cfg = LayoutConfig {
        tissue: case.tissue.into(),
        fortification: "none".into(),
        count: 4,
        footprint: FootprintConfig {
            family: case.family.into(),
            gross_density: 70.0,
            separation: if case.family == "archipelago" {
                2.1
            } else {
                1.3
            },
            ..FootprintConfig::default()
        },
        ..LayoutConfig::default()
    };
    let parcel_cfg = ParcelConfig::default();
    let started = Instant::now();
    let layouts = generate_quarters(seed, std::slice::from_ref(&site), &cfg, surface, &roads)?;
    let quarters_ms = started.elapsed().as_secs_f64() * 1000.0;
    let started = Instant::now();
    let partitions = generate_parcels(seed, &layouts, &parcel_cfg)?;
    let parcels_ms = started.elapsed().as_secs_f64() * 1000.0;
    let layout = &layouts[0];
    let partition = &partitions[0];
    let reproducible = if repeat {
        let repeated = generate_quarters(seed, std::slice::from_ref(&site), &cfg, surface, &roads)?;
        let repeated_parcels = generate_parcels(seed, &repeated, &parcel_cfg)?;
        Some(
            serde_json::to_string(&(layouts.clone(), partitions.clone())).unwrap()
                == serde_json::to_string(&(repeated, repeated_parcels)).unwrap(),
        )
    } else {
        None
    };
    let report = json!({ "family": case.family, "terrain": case.terrain, "seed": seed, "population": population, "mapWidth": width,
        "quartersMs": quarters_ms, "parcelsMs": parcels_ms, "reproducible": reproducible,
        "quarters": layout.quarters.len(), "streets": layout.streets.len(), "blocks": layout.blocks.len(),
        "parcels": partition.parcels.len(), "metrics": layout.structure.as_ref().map(|s| &s.metrics),
        "history": layout.structure.as_ref().map(|s| &s.history),
        "partition": partition.diagnostics, "layoutWarnings": layout.warnings,
        "parcelWarnings": partition.warnings,
    });
    let geometry = geometry.then(|| {
        json!({ "family": case.family, "seed": seed,
        "site": { "key": site.key, "name": site.name, "population": site.population,
            "culture": site.culture, "center": site.center, "radius": site.radius },
        "layoutConfig": cfg, "parcelConfig": parcel_cfg,
        "surface": { "width": width, "n": n, "height": heights, "water": water },
        "roads": roads, "layouts": layouts, "partitions": partitions })
    });
    Ok((report, geometry))
}

fn main() {
    let args: Vec<String> = std::env::args().skip(1).collect();
    let option = |name: &str| {
        args.iter()
            .position(|a| a == name)
            .and_then(|i| args.get(i + 1))
            .cloned()
    };
    let chosen = option("--case");
    let seed = option("--seed").unwrap_or_else(|| "urban-refonte-v1".into());
    let repeat = args.iter().any(|a| a == "--repeat");
    let population = option("--population").map(|p| {
        p.parse::<u32>()
            .expect("--population is a positive integer")
    });
    let geometry_path = option("--geometry");
    let mut cases = vec![];
    let mut geometries = vec![];
    for case in CASES
        .iter()
        .filter(|c| chosen.as_ref().is_none_or(|id| id == c.family))
    {
        match run(case, &seed, repeat, population, geometry_path.is_some()) {
            Ok((result, geometry)) => {
                cases.push(result);
                if let Some(geometry) = geometry {
                    geometries.push(geometry);
                }
            }
            Err(error) => cases.push(json!({ "family": case.family, "error": error })),
        }
    }
    if cases.is_empty() {
        eprintln!("Unknown case; expected one of the 12 footprint families.");
        std::process::exit(2);
    }
    let output =
        serde_json::to_string_pretty(&json!({ "version": 1, "units": "metres", "cases": cases }))
            .unwrap();
    if let Some(path) = option("--out") {
        let path = std::path::Path::new(&path);
        if let Some(parent) = path.parent() {
            std::fs::create_dir_all(parent).unwrap();
        }
        std::fs::write(path, &output).unwrap();
    }
    if let Some(path) = geometry_path {
        let path = std::path::Path::new(&path);
        if let Some(parent) = path.parent() {
            std::fs::create_dir_all(parent).unwrap();
        }
        std::fs::write(
            path,
            serde_json::to_string(&json!({ "version": 1, "cases": geometries })).unwrap(),
        )
        .unwrap();
    }
    println!("{output}");
}
