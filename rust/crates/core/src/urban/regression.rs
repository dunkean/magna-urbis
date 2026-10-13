//! Seeded end-to-end checks of retained streets, after infill and graph cleanup.
use super::{
    Block, Layout, LayoutConfig, ParcelConfig, Point, Shape, Site, Street, Surface,
    generate_parcels, generate_quarters, geometry as g,
};
use std::collections::{BTreeMap, BTreeSet};

fn site(culture: &str) -> Site {
    Site {
        key: "regression-town".into(),
        name: "Regression town".into(),
        population: 3500,
        culture: culture.into(),
        center: Point { x: 256.0, y: 256.0 },
        radius: 140.0,
    }
}

fn street(points: &[(f64, f64)], role: &str) -> Street {
    Street {
        path: points.iter().map(|&(x, y)| Point { x, y }).collect(),
        widths: vec![6.0; points.len()],
        rank: 1,
        role: role.into(),
    }
}

fn run(
    seed: &str,
    site: &Site,
    cfg: &LayoutConfig,
    surface: Surface<'_>,
    roads: &[Street],
) -> Layout {
    generate_quarters(seed, std::slice::from_ref(site), cfg, surface, roads)
        .unwrap()
        .pop()
        .unwrap()
}

#[test]
fn large_village_retains_a_nucleus_and_disjoint_served_faubourgs() {
    let height = vec![20.0; 64 * 64];
    let water = vec![0; 64 * 64];
    let surface = Surface {
        geometry: None,
        width: 1600.0,
        n: 64,
        height: &height,
        water: &water,
    };
    let mut village = site("european-organic");
    village.population = 900;
    village.center = Point { x: 800.0, y: 800.0 };
    village.radius = 260.0;
    let roads = vec![
        street(&[(100.0, 800.0), (1500.0, 800.0)], "regional"),
        street(&[(800.0, 100.0), (800.0, 800.0)], "regional"),
    ];
    let cfg = LayoutConfig {
        settlement_form: "nucleated".into(),
        suburbs: "few".into(),
        ..legacy_config()
    };
    let a = run("large-village-composition", &village, &cfg, surface, &roads);
    let b = run("large-village-composition", &village, &cfg, surface, &roads);
    assert_eq!(
        serde_json::to_string(&a).unwrap(),
        serde_json::to_string(&b).unwrap()
    );
    assert_eq!(a.archetype, "nucleated-village");
    assert_eq!(a.phases.len(), 2);
    assert_eq!(
        (&*a.phases[0].kind, &*a.phases[1].kind),
        ("village", "faubourg")
    );
    assert!(
        a.phases
            .iter()
            .all(|p| p.recipe == "village" && !p.shapes.is_empty())
    );
    assert!((a.phases.iter().map(|p| p.population).sum::<f64>() - 900.0).abs() < 1e-7);
    assert!(
        a.blocks
            .iter()
            .any(|b| a.quarters[b.quarter].phase == 1 && b.kind == "block")
    );
    for (i, q) in a.quarters.iter().enumerate() {
        for other in &a.quarters[i + 1..] {
            assert!(
                g::intersection(&q.shape, &other.shape)
                    .iter()
                    .map(g::area)
                    .sum::<f64>()
                    < 0.01
            );
        }
    }
    for block in &a.blocks {
        assert_eq!(block.zone, a.quarters[block.quarter].zone);
    }
    assert_connected(&a);
    assert_physical(&a, surface, &cfg);
    let parcels = generate_parcels(
        "large-village-parcels",
        std::slice::from_ref(&a),
        &ParcelConfig::default(),
    )
    .unwrap();
    assert!(!parcels[0].parcels.is_empty());
    assert_eq!(
        serde_json::to_string(&a).unwrap(),
        serde_json::to_string(&b).unwrap()
    );
    let without = run(
        "large-village-composition",
        &village,
        &LayoutConfig {
            suburbs: "none".into(),
            ..cfg
        },
        surface,
        &roads,
    );
    assert_eq!(without.phases.len(), 1);
    assert_eq!(without.phases[0].population, 900.0);
}

#[test]
fn complete_town_inherits_phase_recipes_and_keeps_faubourgs_outside_its_wall() {
    let height = vec![20.0; 64 * 64];
    let water = vec![0; 64 * 64];
    let surface = Surface {
        geometry: None,
        width: 1800.0,
        n: 64,
        height: &height,
        water: &water,
    };
    let mut town = site("chinese");
    town.center = Point { x: 900.0, y: 900.0 };
    town.radius = 280.0;
    let roads = vec![street(&[(100.0, 900.0), (1700.0, 900.0)], "regional")];
    let cfg = LayoutConfig {
        suburbs: "many".into(),
        phases: 3,
        ..legacy_config()
    };
    let layout = run("town-composition", &town, &cfg, surface, &roads);
    assert_eq!(layout.phases.len(), 4);
    assert_eq!(
        layout
            .phases
            .iter()
            .map(|p| p.recipe.as_str())
            .collect::<Vec<_>>(),
        ["core", "ring", "ring", "faubourg"]
    );
    assert!(
        (layout.phases.iter().map(|p| p.population).sum::<f64>() - town.population as f64).abs()
            < 1e-7
    );
    assert!(!layout.enclosures.is_empty());
    let wall = Shape {
        outer: layout.enclosures[0].path.clone(),
        holes: vec![],
    };
    for shape in &layout.phases.last().unwrap().shapes {
        assert!(
            g::intersection(shape, &wall)
                .iter()
                .map(g::area)
                .sum::<f64>()
                < 0.01
        );
    }
    assert!(
        layout
            .blocks
            .iter()
            .any(|b| b.zone == "faubourg" && b.kind == "block")
    );
    assert_connected(&layout);
    assert_physical(&layout, surface, &cfg);
    let snapshot = serde_json::to_string(&layout).unwrap();
    let auto = generate_parcels(
        "phase-parcels",
        std::slice::from_ref(&layout),
        &ParcelConfig::default(),
    )
    .unwrap();
    let core = generate_parcels(
        "phase-parcels",
        std::slice::from_ref(&layout),
        &ParcelConfig {
            recipe: "core".into(),
            ..ParcelConfig::default()
        },
    )
    .unwrap();
    assert_ne!(
        serde_json::to_string(&auto).unwrap(),
        serde_json::to_string(&core).unwrap()
    );
    assert_eq!(snapshot, serde_json::to_string(&layout).unwrap());
}

#[test]
fn isolated_scene_and_village_ribbon_remain_separate_from_full_town_composition() {
    let height = vec![20.0; 64 * 64];
    let water = vec![0; 64 * 64];
    let surface = Surface {
        geometry: None,
        width: 1200.0,
        n: 64,
        height: &height,
        water: &water,
    };
    let mut village = site("european-organic");
    village.population = 600;
    village.center = Point { x: 600.0, y: 600.0 };
    village.radius = 220.0;
    let roads = vec![street(&[(100.0, 600.0), (1100.0, 600.0)], "regional")];
    let ribbon = run(
        "ribbon-composition",
        &village,
        &LayoutConfig {
            settlement_form: "ribbon".into(),
            ..legacy_config()
        },
        surface,
        &roads,
    );
    assert_eq!(ribbon.archetype, "street-village");
    assert_eq!(ribbon.phases.len(), 1);
    assert_eq!(ribbon.phases[0].recipe, "village");
    assert_connected(&ribbon);
    let isolated = run(
        "isolated-composition",
        &village,
        &LayoutConfig {
            composition: "district".into(),
            placement: "rectangle".into(),
            ..legacy_config()
        },
        surface,
        &roads,
    );
    assert_eq!(isolated.archetype, "district");
    assert!(isolated.phases.is_empty());
    village.population = 3500;
    village.culture = "kraal".into();
    let grown = run(
        "grown-composition",
        &village,
        &legacy_config(),
        surface,
        &roads,
    );
    assert_eq!(grown.archetype, "town");
    assert!(grown.phases.iter().all(|p| p.recipe.starts_with("grown-")));
}

fn assert_connected(layout: &Layout) {
    let key = |p: Point| {
        (
            (p.x * 10000.0).round() as i64,
            (p.y * 10000.0).round() as i64,
        )
    };
    let mut graph: BTreeMap<_, BTreeSet<_>> = BTreeMap::new();
    for street in &layout.streets {
        assert_eq!(street.path.len(), street.widths.len());
        for p in street.path.windows(2) {
            let a = key(p[0]);
            let b = key(p[1]);
            graph.entry(a).or_default().insert(b);
            graph.entry(b).or_default().insert(a);
        }
    }
    assert!(!graph.is_empty(), "the seed must retain a real network");
    let mut queue = vec![*graph.first_key_value().unwrap().0];
    let mut visited = BTreeSet::new();
    while let Some(p) = queue.pop() {
        if visited.insert(p) {
            queue.extend(graph[&p].iter().copied());
        }
    }
    assert_eq!(
        visited.len(),
        graph.len(),
        "disconnected retained street component"
    );
}

/// Independent metre sampling of the exported geometry, including clipped and
/// snapped endpoints. Unit tests separately check exact bilinear peak detection.
fn assert_physical(layout: &Layout, surface: Surface<'_>, cfg: &LayoutConfig) {
    for street in &layout.streets {
        if matches!(street.role.as_str(), "bridge" | "ford" | "causeway") {
            continue;
        }
        let limit = if street.role == "stairs" {
            assert!(
                cfg.allow_stairs,
                "stairs were retained with allowStairs=false"
            );
            assert!(street.widths.iter().all(|&w| w <= 2.2));
            cfg.max_stair_grade
        } else if street.rank >= 3 {
            cfg.max_lane_grade
        } else {
            cfg.max_street_grade
        };
        for p in street.path.windows(2) {
            let length = (p[1].x - p[0].x).hypot(p[1].y - p[0].y);
            let steps = length.ceil().max(1.0) as usize;
            let at = |t: f64| Point {
                x: p[0].x + (p[1].x - p[0].x) * t,
                y: p[0].y + (p[1].y - p[0].y) * t,
            };
            let mut previous = surface.height_at(p[0]);
            for k in 1..=steps {
                assert!(
                    !surface.wet(at((k as f64 - 0.5) / steps as f64)),
                    "ordinary street entered water"
                );
                let h = surface.height_at(at(k as f64 / steps as f64));
                let grade = (h - previous).abs() / (length / steps as f64).max(1e-8);
                assert!(
                    grade <= limit + 1e-4,
                    "{} rank {}: {:.4} > {:.4}",
                    street.role,
                    street.rank,
                    grade,
                    limit
                );
                previous = h;
            }
        }
    }
}

/// Diagnostic only: an edge needs at least three metres of contact, not just a
/// nearby corner, to count as genuine frontage after pruning peripheral streets.
fn has_frontage(block: &Block, streets: &[Street]) -> bool {
    block
        .shape
        .outer
        .iter()
        .zip(block.shape.outer.iter().cycle().skip(1))
        .take(block.shape.outer.len())
        .any(|(&a, &b)| {
            if (b.x - a.x).hypot(b.y - a.y) < 3.0 {
                return false;
            }
            streets.iter().any(|street| {
                street.path.windows(2).enumerate().any(|(i, p)| {
                    [0.25, 0.5, 0.75].into_iter().all(|t| {
                        let sample = Point {
                            x: a.x + (b.x - a.x) * t,
                            y: a.y + (b.y - a.y) * t,
                        };
                        let (distance, along, _) = g::distance(sample, p[0], p[1]);
                        let half_width =
                            (street.widths[i] * (1.0 - along) + street.widths[i + 1] * along) * 0.5;
                        (distance - half_width).abs() < 0.8
                    })
                })
            })
        })
}

fn report_frontage(label: &str, layout: &Layout) {
    let total = layout.blocks.iter().filter(|b| b.kind == "block").count();
    let orphan: Vec<_> = layout
        .blocks
        .iter()
        .enumerate()
        .filter(|(_, b)| b.kind == "block" && !has_frontage(b, &layout.streets))
        .collect();
    eprintln!(
        "{label}: {} streets, {} blocks, {}/{} blocks without measured frontage",
        layout.streets.len(),
        layout.blocks.len(),
        orphan.len(),
        total
    );
    for (i, block) in orphan.iter().take(5) {
        eprintln!(
            "  block {i}, area {:.1}, center {:?}",
            g::area(&block.shape),
            g::centroid(&block.shape)
        );
    }
    let partitions = generate_parcels(
        "urban-access-regression",
        std::slice::from_ref(layout),
        &ParcelConfig::default(),
    )
    .unwrap();
    for parcel in &partitions[0].parcels {
        assert!(
            parcel.use_kind != "plot" || parcel.front.is_some(),
            "{label}: inaccessible plot in block {}",
            parcel.block
        );
    }
}

#[test]
fn seeded_hillside_enforces_street_lane_and_optional_stair_grades() {
    let n = 64;
    let height: Vec<_> = (0..n * n).map(|i| (i % n) as f32 * 8.0 * 0.28).collect();
    let water = vec![0; n * n];
    let surface = Surface {
        geometry: None,
        width: 512.0,
        n,
        height: &height,
        water: &water,
    };
    let site = site("himalayan-terraces");
    let roads = [street(&[(256.0, 40.0), (256.0, 470.0)], "regional")];
    let mut cfg = LayoutConfig {
        fortification: "none".into(),
        ..legacy_config()
    };
    let with = run("urban-slope-stairs-20261013", &site, &cfg, surface, &roads);
    assert_connected(&with);
    assert_physical(&with, surface, &cfg);
    report_frontage("hillside/stairs", &with);
    assert!(
        with.streets.iter().any(|s| s.role == "stairs"),
        "the regression must exercise stair generation"
    );
    cfg.allow_stairs = false;
    let without = run("urban-slope-stairs-20261013", &site, &cfg, surface, &roads);
    assert_connected(&without);
    assert_physical(&without, surface, &cfg);
    report_frontage("hillside/no-stairs", &without);
    assert!(without.streets.iter().all(|s| s.role != "stairs"));
}

#[test]
fn seeded_river_town_preserves_the_only_bridge_and_connected_banks() {
    let n = 64;
    let mut height = vec![5.0; n * n];
    let mut water = vec![0; n * n];
    for y in 0..n {
        for x in 32..34 {
            water[y * n + x] = 3;
            height[y * n + x] = -5.0;
        }
    }
    let surface = Surface {
        geometry: None,
        width: 512.0,
        n,
        height: &height,
        water: &water,
    };
    let mut site = site("hanseatic");
    site.center.x = 232.0;
    let cfg = LayoutConfig {
        fortification: "none".into(),
        ..legacy_config()
    };
    let roads = [
        street(&[(30.0, 256.0), (248.0, 256.0)], "regional"),
        street(&[(248.0, 256.0), (280.0, 256.0)], "bridge"),
        street(&[(280.0, 256.0), (480.0, 256.0)], "regional"),
    ];
    let layout = run(
        "urban-connected-bridge-20261013",
        &site,
        &cfg,
        surface,
        &roads,
    );
    assert_connected(&layout);
    assert_physical(&layout, surface, &cfg);
    let bridge = layout
        .streets
        .iter()
        .find(|s| s.role == "bridge")
        .expect("regional bridge must survive");
    assert!((bridge.path.first().unwrap().x - 248.0).abs() < 1e-6);
    assert!((bridge.path.last().unwrap().x - 280.0).abs() < 1e-6);
    assert!(
        layout
            .blocks
            .iter()
            .any(|b| g::centroid(&b.shape).x < 256.0)
    );
    assert!(
        layout
            .blocks
            .iter()
            .any(|b| g::centroid(&b.shape).x > 272.0)
    );
    let river = g::rectangle(256.0, 0.0, 272.0, 512.0);
    for block in &layout.blocks {
        assert!(
            g::intersection(&block.shape, &river)
                .iter()
                .map(g::area)
                .sum::<f64>()
                < 0.01
        );
    }
    report_frontage("river/bridge", &layout);
}

#[test]
fn seeded_flat_town_keeps_real_junctions_and_replays_exactly() {
    let n = 64;
    let height = vec![5.0; n * n];
    let water = vec![0; n * n];
    let surface = Surface {
        geometry: None,
        width: 512.0,
        n,
        height: &height,
        water: &water,
    };
    let site = site("european-organic");
    let cfg = LayoutConfig {
        fortification: "none".into(),
        ..legacy_config()
    };
    let roads = [street(&[(20.0, 220.0), (490.0, 290.0)], "regional")];
    let first = run(
        "urban-open-junctions-20261013",
        &site,
        &cfg,
        surface,
        &roads,
    );
    let replay = run(
        "urban-open-junctions-20261013",
        &site,
        &cfg,
        surface,
        &roads,
    );
    assert!(first.streets.len() > 4);
    assert_connected(&first);
    assert_physical(&first, surface, &cfg);
    assert_eq!(
        serde_json::to_string(&first).unwrap(),
        serde_json::to_string(&replay).unwrap()
    );
    report_frontage("flat/open", &first);
}

#[test]
fn seeded_open_fringe_leaves_reserves_while_wall_town_keeps_a_defined_edge() {
    let n = 64;
    let height = vec![5.0; n * n];
    let water = vec![0; n * n];
    let surface = Surface {
        geometry: None,
        width: 512.0,
        n,
        height: &height,
        water: &water,
    };
    let site = site("european-organic");
    let roads = [street(&[(20.0, 220.0), (490.0, 290.0)], "regional")];
    let mut cfg = LayoutConfig {
        // This seed pins the original single-envelope edge treatment.
        composition: "district".into(),
        fortification: "none".into(),
        ..legacy_config()
    };
    let seed = "urban-fringe-3";
    let open = run(seed, &site, &cfg, surface, &roads);
    assert!(open.enclosures.is_empty());
    assert!(
        open.blocks.iter().any(|b| b.kind == "reserve"),
        "the open seed must exercise peripheral vacancy"
    );
    cfg.fortification = "wall".into();
    let walled = run(seed, &site, &cfg, surface, &roads);
    assert_connected(&walled);
    assert_physical(&walled, surface, &cfg);
    assert!(!walled.enclosures.is_empty());
    assert!(
        walled
            .enclosures
            .iter()
            .all(|e| e.kind == "wall" && !e.gates.is_empty())
    );
    assert!(!walled.blocks.iter().any(|b| b.kind == "reserve"));
    for enclosure in &walled.enclosures {
        for &gate in &enclosure.gates {
            assert!(
                enclosure
                    .path
                    .windows(2)
                    .any(|e| g::distance(gate, e[0], e[1]).0 < 0.1)
            );
            assert!(walled.streets.iter().any(|s| {
                s.path
                    .windows(2)
                    .any(|e| g::distance(gate, e[0], e[1]).0 < 0.1)
            }));
        }
    }
    report_frontage("flat/walled", &walled);
}

fn legacy_config() -> LayoutConfig {
    LayoutConfig {
        footprint: super::legacy_footprint(),
        access_mode: "cultural".into(),
        ..LayoutConfig::default()
    }
}
