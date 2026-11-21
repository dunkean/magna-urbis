//! Integration fixtures and profiling probes for the quarter stage.

use super::{generate, service::touches, streets::len};
use crate::urban::{Layout, LayoutConfig, Point, Shape, Site, Street, Surface, footprint::capacity, geometry as g};
use std::f64::consts::PI;

/// Flat plain crossed by two regional roads; returns the full native quarter stage.
fn flat_city(
    culture: &str,
    population: u32,
    fortification: &str,
) -> (Layout, f64) {
    let n = 256;
    let width = (8.0 * (population as f64 * 10_000.0 / 60.0 / PI).sqrt()).max(3000.0);
    let heights = vec![10.0; n * n];
    let water = vec![0; n * n];
    let surface = Surface {
        geometry: None,
        width,
        n,
        height: &heights,
        water: &water,
        interpolation: Default::default(),
    };
    let road = |a: Point, b: Point| Street {
        path: (0..=24)
            .map(|i| Point {
                x: a.x + (b.x - a.x) * i as f64 / 24.0,
                y: a.y + (b.y - a.y) * i as f64 / 24.0,
            })
            .collect(),
        widths: vec![7.0; 25],
        rank: 0,
        role: "regional".into(),
    };
    let c = width * 0.5;
    let roads = vec![
        road(
            Point {
                x: 1.0,
                y: c - 40.0,
            },
            Point {
                x: width - 1.0,
                y: c + 60.0,
            },
        ),
        road(
            Point {
                x: c + 30.0,
                y: 1.0,
            },
            Point {
                x: c - 50.0,
                y: width - 1.0,
            },
        ),
    ];
    let site = Site {
        key: "probe".into(),
        name: "Probe".into(),
        population,
        culture: culture.into(),
        center: Point { x: c, y: c },
        radius: 300.0,
        neighbours: Vec::new(),
    };
    let cfg = LayoutConfig {
        fortification: fortification.into(),
        ..LayoutConfig::default()
    };
    let started = std::time::Instant::now();
    let layout = super::super::generate_quarters(
        "probe-city",
        std::slice::from_ref(&site),
        &cfg,
        surface,
        &roads,
    )
    .unwrap()
    .remove(0);
    (layout, started.elapsed().as_secs_f64())
}
#[test]
#[ignore]
fn probe_city_scale() {
    let mut cases = vec![
        ("european-organic".to_string(), 5_000, "culture"),
        ("european-organic".to_string(), 10_000, "culture"),
        ("medina".to_string(), 12_000, "culture"),
        ("european-organic".to_string(), 50_000, "culture"),
        ("european-organic".to_string(), 100_000, "culture"),
    ];
    if let Ok(only) = std::env::var("URBAN_PROBE") {
        let (culture, pop) = only.split_once(':').unwrap();
        cases = vec![(culture.to_string(), pop.parse().unwrap(), "culture")];
    }
    for (culture, pop, fort) in cases {
        let culture = culture.as_str();
        let (layout, seconds) = flat_city(culture, pop, fort);
        let area: f64 = layout.quarters.iter().map(|q| g::area(&q.shape)).sum();
        let mut ranks = [(0usize, 0.0f64); 5];
        for s in &layout.streets {
            ranks[s.rank.min(4)].0 += 1;
            ranks[s.rank.min(4)].1 += len(&s.path) / 1000.0;
        }
        let places = layout.blocks.iter().filter(|b| b.kind == "place").count();
        let towers: usize = layout.enclosures.iter().map(|e| e.towers.len()).sum();
        println!(
            "{culture} {pop}: {seconds:.2}s area {:.0} ha, quarters {}, blocks {}, places {places}, enclosures {} towers {towers}, ranks {:?}, vertices {}",
            area / 10_000.0,
            layout.quarters.len(),
            layout.blocks.len(),
            layout.enclosures.len(),
            ranks.map(|(n, km)| format!("{n}/{km:.1}km")),
            layout.streets.iter().map(|s| s.path.len()).sum::<usize>(),
        );
    }
}
/// Replays a City Bench request on its decor raster (fixture exported from
/// web/), with URBAN_PROFILE stage timings: URBAN_FIXTURE=path.json.
#[test]
#[ignore]
fn probe_fixture() {
    let Ok(path) = std::env::var("URBAN_FIXTURE") else {
        return;
    };
    let v: serde_json::Value =
        serde_json::from_str(&std::fs::read_to_string(path).unwrap()).unwrap();
    let n = v["n"].as_u64().unwrap() as usize;
    let width = v["width"].as_f64().unwrap();
    let height: Vec<f32> = serde_json::from_value(v["height"].clone()).unwrap();
    let water: Vec<u8> = serde_json::from_value(v["water"].clone()).unwrap();
    let geometry = (!v["geometry"].is_null() && std::env::var("URBAN_NO_GEOMETRY").is_err())
        .then(|| {
            super::super::Geography::new(
                serde_json::from_value(v["geometry"].clone()).unwrap(),
                width,
            )
            .unwrap()
        });
    let surface = Surface {
        geometry: geometry.as_ref(),
        width,
        n,
        height: &height,
        water: &water,
        interpolation: Default::default(),
    };
    let cfg: LayoutConfig = serde_json::from_value(v["layoutConfig"].clone()).unwrap();
    let sites: Vec<Site> = serde_json::from_value(v["sites"].clone()).unwrap();
    let roads: Vec<Street> = serde_json::from_value(v["roads"].clone()).unwrap();
    let started = std::time::Instant::now();
    let layout = super::super::generate_quarters(
        v["seed"].as_str().unwrap(),
        &sites,
        &cfg,
        surface,
        &roads,
    )
    .unwrap()
    .remove(0);
    println!(
        "fixture: {:.2}s, {} quarters, {} blocks, {} streets",
        started.elapsed().as_secs_f64(),
        layout.quarters.len(),
        layout.blocks.len(),
        layout.streets.len()
    );
}
/// Quarter service (feeders), cuts, ribbons, blocks, parcels and the
/// programme run per quarter / per block on any number of threads: one
/// thread and many give byte-identical layouts and partitions.
#[test]
fn parallel_quarter_stage_matches_serial() {
    let run = |threads| {
        super::super::par::with_threads(threads, || {
            let (layout, _) = flat_city("european-organic", 20_000, "culture");
            let partitions = super::super::generate_parcels(
                "probe-city",
                std::slice::from_ref(&layout),
                &super::super::ParcelConfig::default(),
            )
            .unwrap();
            serde_json::to_string(&layout).unwrap()
                + &serde_json::to_string(&partitions).unwrap()
        })
    };
    let serial = run(1);
    let parallel = run(8);
    assert!(
        serial.len() > 100_000,
        "town too small: {} bytes",
        serial.len()
    );
    assert!(
        serial == parallel,
        "parallel quarter stage differs from serial"
    );
}
/// A 50k walled european city: the armature scales with its land, main
/// streets are dense and wider than lanes, the old core is denser than the
/// periphery, the enceinte keeps faubourgs outside with towers on its curtain,
/// and the market square exists.
#[test]
fn city_scale_hierarchy_density_and_walls() {
    let (layout, _) = flat_city("european-organic", 50_000, "culture");
    let land: f64 = layout.quarters.iter().map(|q| g::area(&q.shape)).sum();
    assert!(
        layout.quarters.len() > 30,
        "{} quarters",
        layout.quarters.len()
    );
    let major: f64 = layout
        .streets
        .iter()
        .filter(|s| s.rank <= 1)
        .map(|s| len(&s.path))
        .sum();
    assert!(
        major / 1000.0 / (land / 1e6) >= 3.0,
        "{major} m of main streets"
    );
    let mean = |rank: usize| {
        let v: Vec<f64> = layout
            .streets
            .iter()
            .filter(|s| s.rank == rank && matches!(s.role.as_str(), "street" | "lane"))
            .flat_map(|s| s.widths.iter().copied())
            .collect();
        v.iter().sum::<f64>() / v.len().max(1) as f64
    };
    assert!(
        mean(1) > mean(2) && mean(2) > mean(3),
        "{} {} {}",
        mean(1),
        mean(2),
        mean(3)
    );
    let density = |p: &super::super::GrowthPhase| {
        p.population / p.shapes.iter().map(g::area).sum::<f64>().max(1.0)
    };
    assert!(density(&layout.phases[0]) > 1.5 * density(layout.phases.last().unwrap()));
    assert_eq!(layout.enclosures.len(), 1);
    let wall = &layout.enclosures[0];
    let inside = g::area(&g::normalized(Shape {
        outer: wall.path[..wall.path.len() - 1].to_vec(),
        holes: vec![],
    }));
    assert!(inside < 0.9 * land, "faubourgs stay outside the enceinte");
    // Flanked either by towers or, on a bastioned (Vauban) trace, by bastions.
    assert!(
        !wall.gates.is_empty() && wall.towers.len() + wall.bastions.len() >= 12,
        "{} towers, {} bastions ({})",
        wall.towers.len(),
        wall.bastions.len(),
        wall.style
    );
    for t in &wall.towers {
        let d = wall
            .path
            .windows(2)
            .map(|e| g::distance(*t, e[0], e[1]).0)
            .fold(f64::INFINITY, f64::min);
        assert!(d < 8.0, "tower {t:?} is {d} m from the curtain");
    }
    assert!(layout.blocks.iter().any(|b| b.kind == "place"));
}
#[test]
fn small_settlement_keeps_disjoint_quarters_and_dry_paths() {
    let heights = vec![0.0; 64 * 64];
    let mut water = vec![0; 64 * 64];
    for y in 0..64 {
        water[y * 64 + 32] = 3;
    }
    let surface = Surface {
        geometry: None,
        width: 512.0,
        n: 64,
        height: &heights,
        water: &water,
        interpolation: Default::default(),
    };
    let site = Site {
        key: "small".into(),
        name: "Small".into(),
        population: 80,
        culture: "european".into(),
        center: Point { x: 240.0, y: 256.0 },
        radius: 24.0,
        neighbours: Vec::new(),
    };
    let cfg = LayoutConfig {
        footprint: super::super::config::legacy_footprint(),
        access_mode: "cultural".into(),
        preset: "morph/european-organic".into(),
        ..LayoutConfig::default()
    };
    let m = super::super::resolve(
        &site.culture,
        &cfg.preset,
        &cfg.recipe,
        if cfg.zone == "auto" {
            "core"
        } else {
            &cfg.zone
        },
        cfg.density,
        &cfg.params,
        "quarters",
    )
    .unwrap();
    let a = generate("small-radius-regression", &site, &cfg, &m, surface, &[], false).unwrap();
    let b = generate("small-radius-regression", &site, &cfg, &m, surface, &[], false).unwrap();
    assert_eq!(
        serde_json::to_string(&a).unwrap(),
        serde_json::to_string(&b).unwrap()
    );
    assert!(!a.quarters.is_empty());
    for (i, q) in a.quarters.iter().enumerate() {
        for r in a.quarters.iter().skip(i + 1) {
            assert!(g::intersection(&q.shape, &r.shape).is_empty());
        }
    }
    for s in &a.streets {
        for p in s.path.windows(2) {
            assert!(!surface.wet(Point {
                x: (p[0].x + p[1].x) * 0.5,
                y: (p[0].y + p[1].y) * 0.5
            }));
        }
    }
    let tiny_cfg = LayoutConfig {
        placement: "rectangle".into(),
        count: 8,
        radius_scale: 0.1,
        ..cfg.clone()
    };
    let tiny_site = Site {
        radius: 80.0,
        ..site.clone()
    };
    let tiny = generate(
        "tiny-rectangle-regression",
        &tiny_site,
        &tiny_cfg,
        &m,
        surface,
        &[],
        false,
    )
    .unwrap();
    assert_eq!(tiny.quarters.len(), 8);
    for (i, q) in tiny.quarters.iter().enumerate() {
        for r in tiny.quarters.iter().skip(i + 1) {
            assert!(g::intersection(&q.shape, &r.shape).is_empty());
        }
    }
    let dense_cfg = LayoutConfig {
        count: 64,
        radius: 240.0,
        ..cfg
    };
    let dry_surface = Surface {
        water: &vec![0; 64 * 64],
        ..surface
    };
    let dense = generate(
        "dense-ring-regression",
        &site,
        &dense_cfg,
        &m,
        dry_surface,
        &[],
        false,
    )
    .unwrap();
    assert_eq!(dense.quarters.len(), 64);
    for (i, q) in dense.quarters.iter().enumerate() {
        let r = &dense.quarters[(i + 1) % dense.quarters.len()];
        assert!(g::intersection(&q.shape, &r.shape).is_empty());
    }
}

/// Mountain bay: a 250 m coastal shelf under a 0.35 slope cut
/// by ravines, sea to the east, one coastal road. Roman tissue, no stairs.
fn bay_city(cfg: &LayoutConfig) -> Layout {
    let (n, width) = (256, 4000.0);
    let c = width * 0.5;
    let mut heights = vec![0.0f32; n * n];
    let mut water = vec![0u8; n * n];
    for y in 0..n {
        for x in 0..n {
            let (px, py) = (
                (x as f64 + 0.5) * width / n as f64,
                (y as f64 + 0.5) * width / n as f64,
            );
            let climb = (c + 150.0 - px).max(0.0);
            let ravines = (py / 180.0).sin().abs() * climb * 0.12;
            heights[y * n + x] = (5.0 + climb * 0.35 + ravines) as f32;
            water[y * n + x] = u8::from(px > c + 330.0);
        }
    }
    let surface = Surface {
        geometry: None,
        width,
        n,
        height: &heights,
        water: &water,
        interpolation: Default::default(),
    };
    let road = Street {
        path: (0..=40)
            .map(|i| Point {
                x: c + 200.0,
                y: 1.0 + (width - 2.0) * i as f64 / 40.0,
            })
            .collect(),
        widths: vec![7.0; 41],
        rank: 0,
        role: "regional".into(),
    };
    let site = Site {
        key: "bay".into(),
        name: "Bay".into(),
        population: 5000,
        culture: "roman-core".into(),
        center: Point { x: c + 150.0, y: c },
        radius: 300.0,
        neighbours: Vec::new(),
    };
    super::super::generate_quarters("bay", &[site], cfg, surface, &[road])
        .unwrap()
        .remove(0)
}
#[test]
fn steep_bay_quarters_are_served_and_overrides_stay_local() {
    let cfg = LayoutConfig::default();
    let base = bay_city(&cfg);
    assert!(!base.quarters.is_empty());
    let lattice = |r: &[Point]| {
        r.iter()
            .zip(r.iter().cycle().skip(1))
            .all(|(a, b)| (a.x - b.x).abs() < 1e-6 || (a.y - b.y).abs() < 1e-6)
    };
    // A gate tower standing on a straight (axis-parallel) road is a built
    // hole, not a growth-lattice one.
    let tower = |r: &[Point]| {
        let bb = g::bbox(&Shape {
            outer: r.to_vec(),
            holes: vec![],
        });
        base.enclosures
            .iter()
            .flat_map(|e| &e.gatehouses)
            .flat_map(|h| &h.masses)
            .any(|m| {
                let mb = g::bbox(m);
                (mb.0 - bb.0).abs().max((mb.1 - bb.1).abs()) < 0.01
                    && (mb.2 - bb.2).abs().max((mb.3 - bb.3).abs()) < 0.01
            })
    };
    // Written before the assertions, so a failing layout can be inspected.
    if let Ok(path) = std::env::var("BAY_DUMP") {
        std::fs::write(path, serde_json::to_string(&base).unwrap()).unwrap();
    }
    for (i, q) in base.quarters.iter().enumerate() {
        let bb = g::bbox(&q.shape);
        assert!(
            base.streets
                .iter()
                .any(|st| st.role != "stairs" && touches(&q.shape, bb, st)),
            "quarter {i} has no street"
        );
        assert!(
            !q.shape.holes.iter().any(|h| lattice(h) && !tower(h)),
            "lattice hole in {i}"
        );
    }
    // No stairs in a culture that does not build them.
    assert!(base.streets.iter().all(|s| s.role != "stairs"));
    // Every ordinary block fronts a street (within its half-width).
    let unserved = base
        .blocks
        .iter()
        .filter(|b| b.kind == "block")
        .filter(|b| {
            !base.streets.iter().any(|st| {
                st.path.windows(2).zip(&st.widths).any(|(w, width)| {
                    b.shape
                        .outer
                        .iter()
                        .any(|&p| g::distance(p, w[0], w[1]).0 <= width * 0.5 + 2.0)
                })
            })
        })
        .count();
    assert_eq!(unserved, 0, "blocks without street frontage");
    // Editing one quarter changes its blocks only.
    let k = (0..base.quarters.len())
        .max_by(|&a, &b| {
            g::area(&base.quarters[a].shape).total_cmp(&g::area(&base.quarters[b].shape))
        })
        .unwrap();
    let mut edited_cfg = cfg.clone();
    edited_cfg.overrides.quarters.insert(
        k.to_string(),
        super::super::QuarterOverride {
            culture: Some("medina".into()),
            tissue: Some("organic".into()),
            density: Some(1.6),
            ..Default::default()
        },
    );
    let edited = bay_city(&edited_cfg);
    // Composition quarters keep their index and shape; only the peripheral
    // frontage strips appended last follow the edited streets.
    let same = base
        .quarters
        .iter()
        .zip(&edited.quarters)
        .take_while(|(a, b)| (g::area(&a.shape) - g::area(&b.shape)).abs() < 1e-6)
        .count();
    eprintln!(
        "bay: stable prefix {same} of {} / {} quarters, edited {k}",
        base.quarters.len(),
        edited.quarters.len()
    );
    assert!(same > k);
    let blocks = |l: &Layout, q: usize| {
        let mut v: Vec<i64> = l
            .blocks
            .iter()
            .filter(|b| b.quarter == q)
            .map(|b| g::area(&b.shape).round() as i64)
            .collect();
        v.sort();
        v
    };
    assert_ne!(blocks(&base, k), blocks(&edited, k));
    let culture = |l: &Layout, q: usize| {
        l.blocks
            .iter()
            .find(|b| b.quarter == q)
            .and_then(|b| b.phase)
            .and_then(|p| l.phases.get(p))
            .map(|p| p.culture.clone())
    };
    assert_eq!(culture(&edited, k).as_deref(), Some("medina"));
    // Street widths are re-ranked city-wide, so compare each other
    // quarter's block structure (count), not exact areas.
    let count = |l: &Layout, q: usize| l.blocks.iter().filter(|b| b.quarter == q).count();
    let changed = (0..same)
        .filter(|&q| q != k && count(&base, q) != count(&edited, q))
        .count();
    eprintln!(
        "bay: {} quarters, {} blocks, {} other quarters changed by the edit",
        base.quarters.len(),
        base.blocks.len(),
        changed
    );
    assert!(changed * 4 <= same, "edit leaked into {changed} quarters");
}
/// Invariant (adaptive capacity): a sparse culture on flat open ground
/// houses its population by construction, and every threshold the plan
/// crosses (densify, extend, borrow) is stated in the parcel warnings.
#[test]
fn a_sparse_culture_houses_its_population_and_states_its_thresholds() {
    let (layout, _) = flat_city("halfling", 20_000, "culture");
    let parts = super::super::generate_parcels(
        "probe-city",
        std::slice::from_ref(&layout),
        &super::super::ParcelConfig::default(),
    )
    .unwrap();
    let pr = parts[0].programme.as_ref().unwrap();
    let (wanted, housed) = pr
        .demands
        .iter()
        .filter(|d| d.function == "domestic")
        .fold((0.0, 0.0), |(w, h), d| {
            (w + d.requested, h + d.parcel_capacity.min(d.requested))
        });
    let plan = capacity::of(&layout).expect("automatic budget carries a plan");
    let warning = parts[0].warnings.iter().find(|w| w.starts_with("Lot capacity "));
    eprintln!(
        "halfling 20k: {housed:.0}/{wanted:.0} households, densify {:.2}, extension {:.2}, donor {:?} {:.2}, vacancy {:.2}; {warning:?}",
        plan.densify, plan.extension, plan.donor, plan.borrowed_share, plan.vacancy
    );
    assert!(
        housed >= 0.95 * wanted,
        "{housed:.0} of {wanted:.0} households housed"
    );
    if plan.densify > 0.0 || plan.extension > 1.001 || plan.borrowed_share > 0.0 {
        assert!(warning.is_some(), "an adjusted plan reports its estimated lot capacity");
    }
}

/// A flat town whose regional roads end at its centre, arriving on the
/// given bearings (degrees), as the regional graph delivers them.
fn flat_town(culture: &str, population: u32, bearings: &[f64]) -> Layout {
    let n = 256;
    let width = 3000.0;
    let heights = vec![10.0; n * n];
    let water = vec![0; n * n];
    let surface = Surface {
        geometry: None,
        width,
        n,
        height: &heights,
        water: &water,
        interpolation: Default::default(),
    };
    let c = width * 0.5;
    let roads: Vec<Street> = bearings
        .iter()
        .map(|b| {
            let (dx, dy) = (b.to_radians().cos(), b.to_radians().sin());
            Street {
                path: (0..=24)
                    .map(|i| Point {
                        x: c + dx * 1400.0 * (1.0 - i as f64 / 24.0),
                        y: c + dy * 1400.0 * (1.0 - i as f64 / 24.0),
                    })
                    .collect(),
                widths: vec![7.0; 25],
                rank: 0,
                role: "regional".into(),
            }
        })
        .collect();
    let site = Site {
        key: "probe".into(),
        name: "Probe".into(),
        population,
        culture: culture.into(),
        center: Point { x: c, y: c },
        radius: 300.0,
        neighbours: Vec::new(),
    };
    super::super::generate_quarters(
        "probe-town",
        std::slice::from_ref(&site),
        &LayoutConfig::default(),
        surface,
        &roads,
    )
    .unwrap()
    .remove(0)
}
/// Street land of the core: the share of its quarters left out of blocks.
fn core_street_share(layout: &Layout) -> f64 {
    // A composition quarter can straddle epochs; its actual core blocks
    // identify the quarters whose street share is measured.
    let core: std::collections::BTreeSet<usize> = layout.blocks.iter()
        .filter(|b| b.zone == "core").map(|b| b.quarter)
        .collect();
    let land: f64 = core
        .iter()
        .map(|&i| g::area(&layout.quarters[i].shape))
        .sum();
    let built: f64 = layout
        .blocks
        .iter()
        .filter(|b| core.contains(&b.quarter))
        .map(|b| g::area(&b.shape))
        .sum();
    1.0 - built / land.max(1.0)
}
fn core_blocks(layout: &Layout) -> Vec<&super::super::Block> {
    layout
        .blocks
        .iter()
        .filter(|b| b.zone == "core" && b.kind == "block")
        .collect()
}
/// Invariant (medina core): a few through streets and a tree of derbs
/// serve large inward-looking blocks; streets stay a small share of the
/// core and every lot is still served (street, derb or shared access).
#[test]
fn medina_core_is_large_blocks_served_by_derbs() {
    let layout = flat_town("medina", 5000, &[20.0, 140.0, 255.0]);
    let share = core_street_share(&layout);
    let blocks = core_blocks(&layout);
    let mean =
        blocks.iter().map(|b| g::area(&b.shape)).sum::<f64>() / blocks.len().max(1) as f64;
    let derbs = layout.streets.iter().filter(|s| s.role == "close").count();
    eprintln!(
        "medina core: street share {share:.3}, {} blocks of {mean:.0} m², {derbs} derbs",
        blocks.len()
    );
    assert!(share < 0.22, "core street share {share:.3}");
    assert!(mean > 2000.0, "core blocks of {mean:.0} m²");
    assert!(derbs > 0, "no derb serves the deep blocks");
    let parts = super::super::generate_parcels(
        "probe-town",
        std::slice::from_ref(&layout),
        &super::super::ParcelConfig::default(),
    )
    .unwrap();
    let unserved: Vec<_> = parts[0]
        .parcels
        .iter()
        .filter(|p| p.use_kind == "plot" && layout.blocks[p.block].zone == "core")
        .filter(|p| p.access.as_ref().is_none_or(|a| a.kind == "unserved"))
        .map(|p| p.id.clone())
        .collect();
    assert!(
        unserved.is_empty(),
        "core lots without access: {unserved:?}"
    );
}
/// Invariant (Chinese walled city): the lattice runs to the compass, and
/// regional roads arriving on any bearing reach the centre along its axes
/// instead of cutting the wards diagonally; hutong lanes leave large blocks.
#[test]
fn chinese_core_runs_to_the_compass_and_roads_take_its_axes() {
    let layout = flat_town("chinese", 5000, &[25.0, 118.0, 248.0]);
    let core: Vec<&Shape> = layout
        .quarters
        .iter()
        .filter(|q| q.zone == "core")
        .map(|q| &q.shape)
        .collect();
    let inside = |p: Point| core.iter().any(|q| g::contains(q, p));
    // Length on and off the compass axes, for the segments inside the core.
    let off_axis = |filter: &dyn Fn(&Street) -> bool| {
        let (mut on, mut off) = (0.0, 0.0);
        for s in layout.streets.iter().filter(|s| filter(s)) {
            for w in s.path.windows(2) {
                let l = (w[1].x - w[0].x).hypot(w[1].y - w[0].y);
                let mid = Point {
                    x: (w[0].x + w[1].x) * 0.5,
                    y: (w[0].y + w[1].y) * 0.5,
                };
                if l < 1.0 || !inside(mid) {
                    continue;
                }
                let a = (w[1].y - w[0].y).atan2(w[1].x - w[0].x);
                if (2.0 * a).sin().abs() < 0.07 {
                    on += l
                } else {
                    off += l
                }
            }
        }
        off / (on + off).max(1.0)
    };
    let regional = off_axis(&|s: &Street| s.role == "regional");
    // Wall walks follow the independently parameterized curtain; the
    // compass invariant concerns the internal lattice and its approaches.
    let lanes = off_axis(&|s: &Street| s.rank >= 2 && !matches!(s.role.as_str(), "close" | "wall-lane"));
    let share = core_street_share(&layout);
    let blocks = core_blocks(&layout);
    let mean =
        blocks.iter().map(|b| g::area(&b.shape)).sum::<f64>() / blocks.len().max(1) as f64;
    eprintln!(
        "chinese core: regional off-axis {regional:.2}, lanes off-axis {lanes:.2}, street share {share:.3}, {} blocks of {mean:.0} m²",
        blocks.len()
    );
    assert!(
        regional < 0.05,
        "regional roads off the axes: {regional:.2}"
    );
    assert!(lanes < 0.15, "lanes off the axes: {lanes:.2}");
    assert!(mean > 2500.0, "core blocks of {mean:.0} m²");
}

/// Invariant (planned walled culture): the walled city is the plan's
/// rectangle, every epoch inside, and the older circuit is a rectangle too;
/// the generic smoothed curtain never rounds it inside the town.
#[test]
fn a_chinese_city_is_walled_by_rectangles_around_the_whole_town() {
    use geo::MinimumRotatedRect;
    let layout = flat_town("chinese", 20_000, &[25.0, 118.0, 248.0]);
    let ring = |e: &super::super::Enclosure| Shape { outer: e.path.clone(), holes: vec![] };
    let squareness = |s: &Shape| g::area(s) / g::polygon(s).minimum_rotated_rect()
        .map_or(f64::INFINITY, |r| g::area(&g::shapes(geo::MultiPolygon(vec![r]))[0]));
    let walls: Vec<_> = layout.enclosures.iter().filter(|e| e.kind == "wall").map(ring).collect();
    assert!(walls.len() >= 2, "{} circuits", walls.len());
    for (i, w) in walls.iter().enumerate() {
        assert!(squareness(w) > 0.97, "circuit {i}: {:.3} of its rectangle", squareness(w));
    }
    let outer = walls.iter().max_by(|a, b| g::area(a).total_cmp(&g::area(b))).unwrap();
    let built: f64 = layout.blocks.iter().filter(|b| b.kind == "block").map(|b| g::area(&b.shape)).sum();
    let inside: f64 = layout.blocks.iter().filter(|b| b.kind == "block")
        .map(|b| g::intersection(&b.shape, outer).iter().map(g::area).sum::<f64>()).sum();
    assert!(inside >= 0.95 * built, "{:.0} % of the blocks inside the wall", 100.0 * inside / built);
}
