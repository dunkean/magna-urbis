//! Seeded end-to-end checks of retained streets, after infill and graph cleanup.
use super::{
    Block, Layout, LayoutConfig, ParcelConfig, Point, Site, Street, Surface, generate_parcels,
    generate_quarters, geometry as g,
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
        width: 512.0,
        n,
        height: &height,
        water: &water,
    };
    let site = site("himalayan-terraces");
    let roads = [street(&[(256.0, 40.0), (256.0, 470.0)], "regional")];
    let mut cfg = LayoutConfig {
        fortification: "none".into(),
        ..LayoutConfig::default()
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
        width: 512.0,
        n,
        height: &height,
        water: &water,
    };
    let mut site = site("hanseatic");
    site.center.x = 232.0;
    let cfg = LayoutConfig {
        fortification: "none".into(),
        ..LayoutConfig::default()
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
        width: 512.0,
        n,
        height: &height,
        water: &water,
    };
    let site = site("european-organic");
    let cfg = LayoutConfig {
        fortification: "none".into(),
        ..LayoutConfig::default()
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
        width: 512.0,
        n,
        height: &height,
        water: &water,
    };
    let site = site("european-organic");
    let roads = [street(&[(20.0, 220.0), (490.0, 290.0)], "regional")];
    let mut cfg = LayoutConfig {
        fortification: "none".into(),
        ..LayoutConfig::default()
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
