//! Small contract and geometry regressions for the redesigned native pipeline.
use super::geometry as g;
use super::*;

fn morph() -> Morph {
    resolve(
        "european-organic",
        "culture",
        "core",
        "core",
        1.0,
        &json!({}),
        "quarters",
    )
    .unwrap()
}

#[test]
fn an_inherited_bent_crossroads_is_the_village_spine_without_a_parallel_cultural_cross() {
    let h = vec![20.0; 64 * 64];
    let w = vec![0; h.len()];
    let surface = Surface {
        geometry: None,
        width: 1600.0,
        n: 64,
        height: &h,
        water: &w,
    };
    let center = Point { x: 800.0, y: 800.0 };
    let roads: Vec<_> = [
        Point { x: 350.0, y: 800.0 },
        Point {
            x: 1250.0,
            y: 700.0,
        },
        Point {
            x: 800.0,
            y: 1250.0,
        },
    ]
    .iter()
    .map(|&end| Street {
        path: vec![center, end],
        widths: vec![2.52; 2],
        rank: 2,
        role: "regional".into(),
    })
    .collect();
    let site = Site {
        key: "inherited-village".into(),
        name: String::new(),
        population: 454,
        culture: "swahili-stone-town".into(),
        center,
        radius: 211.0,
    };
    let mut cfg = LayoutConfig {
        fortification: "none".into(),
        ..Default::default()
    };
    cfg.footprint.mechanism = "ribbon".into();
    cfg.footprint.family = "lobed".into();
    let layout = generate_quarters("inherited-cross", &[site], &cfg, surface, &roads)
        .unwrap()
        .remove(0);
    assert!(layout.streets.iter().any(|s| {
        s.role == "regional"
            && s.path
                .iter()
                .any(|p| (p.x - center.x).hypot(p.y - center.y) < 1e-5)
    }));
    for s in layout
        .streets
        .iter()
        .filter(|s| s.rank <= 1 && s.role != "regional")
    {
        for pair in s.path.windows(2) {
            if let Some((a, b)) = if (pair[0].x - center.x).hypot(pair[0].y - center.y) < 1e-5 {
                Some((pair[0], pair[1]))
            } else if (pair[1].x - center.x).hypot(pair[1].y - center.y) < 1e-5 {
                Some((pair[1], pair[0]))
            } else {
                None
            } {
                assert!(
                    (b.x - a.x).abs() < (b.y - a.y).abs(),
                    "redundant horizontal arm: {pair:?}"
                );
            }
        }
    }
}

#[test]
fn accessible_growth_approaches_a_dry_coast_without_spending_land_on_water() {
    let h = vec![20.0; 96 * 96];
    let dry = vec![0; h.len()];
    let water: Vec<_> = (0..h.len()).map(|i| u8::from(i / 96 < 24)).collect();
    let surface = Surface {
        geometry: None,
        width: 1400.0,
        n: 96,
        height: &h,
        water: &dry,
    };
    let site = Site {
        key: "shore-growth".into(),
        name: String::new(),
        population: 2000,
        culture: "swahili-stone-town".into(),
        center: Point { x: 700.0, y: 700.0 },
        radius: 200.0,
    };
    let mut cfg = LayoutConfig {
        fortification: "none".into(),
        // Isolate coastal growth from outer frontage added by the street fabric.
        exit_treatment: "closed".into(),
        peripheral_road: "none".into(),
        ..Default::default()
    };
    cfg.footprint.mechanism = "accessibility".into();
    cfg.footprint.family = "compact".into();
    cfg.footprint.budget = "radius".into();
    cfg.footprint.irregularity = 0.0;
    let centroid = |layout: &Layout| {
        let s = &layout.structure.as_ref().unwrap().allocated;
        s.iter().map(|p| g::centroid(p).y * g::area(p)).sum::<f64>()
            / s.iter().map(g::area).sum::<f64>()
    };
    let inland = generate_quarters(
        "shore-bias",
        std::slice::from_ref(&site),
        &cfg,
        surface,
        &[],
    )
    .unwrap()
    .remove(0);
    let coastal = generate_quarters(
        "shore-bias",
        &[site],
        &cfg,
        Surface {
            water: &water,
            ..surface
        },
        &[],
    )
    .unwrap()
    .remove(0);
    assert!(
        centroid(&coastal) < centroid(&inland) - 5.0,
        "coast {} versus inland {}",
        centroid(&coastal),
        centroid(&inland)
    );
    assert!(
        coastal
            .structure
            .as_ref()
            .unwrap()
            .allocated
            .iter()
            .flat_map(|s| &s.outer)
            .all(|p| p.y >= 350.0 - 1e-5)
    );
}

#[test]
fn primary_regional_entry_rotates_the_foundation_over_culture_and_nearby_tracks() {
    let h = vec![20.0; 64 * 64];
    let water = vec![0; h.len()];
    let surface = Surface {
        geometry: None,
        width: 1600.0,
        n: 64,
        height: &h,
        water: &water,
    };
    let center = Point { x: 800.0, y: 800.0 };
    let angle = 27.0_f64.to_radians();
    let roads = vec![
        Street {
            path: [-600.0, 600.0]
                .map(|d| Point {
                    x: center.x + angle.cos() * d,
                    y: center.y + angle.sin() * d,
                })
                .to_vec(),
            widths: vec![7.0; 2],
            rank: 0,
            role: "regional".into(),
        },
        Street {
            path: vec![
                Point { x: 200.0, y: 800.0 },
                Point {
                    x: 1400.0,
                    y: 800.0,
                },
            ],
            widths: vec![2.0; 2],
            rank: 2,
            role: "regional".into(),
        },
    ];
    assert!((macroplan::regional_axis(center, 300.0, &roads).unwrap() - angle).abs() < 1e-10);
    let site = Site {
        key: "regional-alignment".into(),
        name: String::new(),
        population: 5000,
        culture: "chinese".into(),
        center,
        radius: 200.0,
    };
    let mut cfg = LayoutConfig {
        fortification: "none".into(),
        site_adaptation: 0.0,
        ..Default::default()
    };
    cfg.footprint.mechanism = "planned".into();
    cfg.footprint.family = "rectangle".into();
    cfg.footprint.aspect = 2.0;
    cfg.footprint.budget = "radius".into();
    cfg.footprint.irregularity = 0.0;
    let foundation_angle = |layout: &Layout| {
        let mut xx = 0.0;
        let mut yy = 0.0;
        let mut xy = 0.0;
        for p in &layout.structure.as_ref().unwrap().reserve[0].outer {
            let x = p.x - center.x;
            let y = p.y - center.y;
            xx += x * x;
            yy += y * y;
            xy += x * y;
        }
        0.5 * (2.0 * xy).atan2(xx - yy)
    };
    let layout = generate_quarters(
        "regional-axis",
        std::slice::from_ref(&site),
        &cfg,
        surface,
        &roads,
    )
    .unwrap()
    .remove(0);
    assert!((foundation_angle(&layout) - angle).abs() < 0.03);
    cfg.axis_alignment = "culture".into();
    let cultural = generate_quarters("regional-axis", &[site], &cfg, surface, &roads)
        .unwrap()
        .remove(0);
    assert!(foundation_angle(&cultural).abs() < 0.03);
}

#[test]
fn mixed_influences_share_land_exactly_and_reach_parcels() {
    let h = vec![20.0; 64 * 64];
    let water = vec![0; h.len()];
    let surface = Surface {
        geometry: None,
        width: 1600.0,
        n: 64,
        height: &h,
        water: &water,
    };
    let site = Site {
        key: "mixed".into(),
        name: String::new(),
        population: 6000,
        culture: "european-organic".into(),
        center: Point { x: 800.0, y: 800.0 },
        radius: 200.0,
    };
    for mode in ["phases", "sectors"] {
        let cfg = LayoutConfig {
            mix_culture: "roman-core".into(),
            mix_mode: mode.into(),
            mix_share: 0.4,
            fortification: "none".into(),
            ..LayoutConfig::default()
        };
        let layout = generate_quarters(
            "mix-regression",
            std::slice::from_ref(&site),
            &cfg,
            surface,
            &[],
        )
        .unwrap()
        .remove(0);
        let area: f64 = layout
            .phases
            .iter()
            .flat_map(|p| &p.shapes)
            .map(g::area)
            .sum();
        let secondary: f64 = layout
            .phases
            .iter()
            .filter(|p| p.culture == "roman-core")
            .flat_map(|p| &p.shapes)
            .map(g::area)
            .sum();
        assert!(
            (secondary / area - 0.4).abs() < 1e-5,
            "{mode}: {secondary}/{area}"
        );
        assert!((layout.phases.iter().map(|p| p.population).sum::<f64>() - 6000.0).abs() < 0.01);
        assert!(layout.blocks.iter().any(|b| {
            b.phase
                .is_some_and(|i| layout.phases[i].culture == "roman-core")
        }));
        for (i, a) in layout.phases.iter().enumerate() {
            for b in &layout.phases[i + 1..] {
                let overlap: f64 = a
                    .shapes
                    .iter()
                    .flat_map(|s| b.shapes.iter().flat_map(move |t| g::intersection(s, t)))
                    .map(|s| g::area(&s))
                    .sum();
                assert!(overlap < 0.01);
            }
        }
        let partition = generate_parcels(
            "mixed-plots",
            std::slice::from_ref(&layout),
            &ParcelConfig::default(),
        )
        .unwrap();
        assert!(!partition[0].parcels.is_empty());
        let replay = generate_quarters(
            "mix-regression",
            std::slice::from_ref(&site),
            &cfg,
            surface,
            &[],
        )
        .unwrap()
        .remove(0);
        assert_eq!(
            serde_json::to_value(&layout).unwrap(),
            serde_json::to_value(&replay).unwrap()
        );
    }
}
fn deep_layout() -> Layout {
    let shape = g::rectangle(600.0, 600.0, 840.0, 900.0);
    Layout {
        config: None,
        programme: None,
        key: "deep".into(),
        culture: "european-organic".into(),
        center: Point { x: 720.0, y: 750.0 },
        quarters: vec![Quarter {
            shape: shape.clone(),
            phase: 0,
            zone: "core".into(),
        }],
        blocks: vec![Block {
            phase: Some(0),
            shape,
            quarter: 0,
            kind: "block".into(),
            axis: Point { x: 1.0, y: 0.0 },
            zone: "core".into(),
        }],
        streets: vec![Street {
            path: vec![Point { x: 600.0, y: 597.0 }, Point { x: 840.0, y: 597.0 }],
            widths: vec![6.0; 2],
            rank: 1,
            role: "regional".into(),
        }],
        warnings: vec![],
        enclosures: vec![],
        phases: vec![],
        archetype: "district".into(),
        structure: Some(UrbanStructure {
            version: 1,
            centers: vec![UrbanCenter {
                id: 0,
                point: Point { x: 720.0, y: 700.0 },
                weight: 1.0,
            }],
            ..UrbanStructure::default()
        }),
    }
}

#[test]
fn old_inputs_select_legacy_but_new_defaults_enable_the_refonte() {
    let old: LayoutConfig = serde_json::from_value(json!({"count":4})).unwrap();
    assert_eq!(old.footprint.mechanism, "legacy");
    assert_eq!(old.access_mode, "cultural");
    assert_eq!(LayoutConfig::default().footprint.mechanism, "auto");
    assert!(serde_json::from_value::<LayoutConfig>(json!({"footprint":{"typo":1}})).is_err());
}

#[test]
fn retained_stage_inputs_reach_building_occupation_without_reverting_to_density_one() {
    let mut layout = deep_layout();
    layout.config = Some(LayoutConfig {
        density: 2.,
        params: json!({"fieldNoise":0.4}),
        ..LayoutConfig::default()
    });
    let (_, dense) = super::culture::block_morph(&layout, "european-organic", 0).unwrap();
    assert!(dense.range("frontage", "core")[0] < morph().range("frontage", "core")[0]);
    let partition: Partition = serde_json::from_value(json!({"key":"deep","parcels":[],"warnings":[],
        "config":{"density":1.6,"zone":"core","recipe":"core","params":{"coverage":{"core":[0.82,0.88]}}}})).unwrap();
    let (_, applied) =
        super::culture::parcel_morph(&layout, &partition, "european-organic", 0).unwrap();
    assert_eq!(applied.range("coverage", "core"), [0.82, 0.88]);
    let restored: Partition =
        serde_json::from_str(&serde_json::to_string(&partition).unwrap()).unwrap();
    let (_, replay) =
        super::culture::parcel_morph(&layout, &restored, "european-organic", 0).unwrap();
    assert_eq!(applied.value, replay.value);
}

#[test]
fn indexed_phase_containment_matches_direct_containment() {
    let mut shape = g::normalized(Shape {
        outer: vec![
            Point { x: 0.0, y: 0.0 },
            Point { x: 100.0, y: 0.0 },
            Point { x: 80.0, y: 70.0 },
            Point { x: 50.0, y: 20.0 },
            Point { x: 20.0, y: 80.0 },
            Point { x: 0.0, y: 100.0 },
        ],
        holes: vec![],
    });
    shape.holes.push(
        g::rectangle(5.0, 5.0, 15.0, 15.0)
            .outer
            .into_iter()
            .rev()
            .collect(),
    );
    let index = g::ContainmentIndex::new(&shape);
    for y in -10..=110 {
        for x in -10..=110 {
            let p = Point {
                x: x as f64,
                y: y as f64,
            };
            assert_eq!(index.contains(p), g::contains(&shape, p), "{p:?}");
        }
    }
}

#[test]
fn adaptive_access_is_connected_and_the_partition_remains_covered() {
    let height = vec![20.0; 64 * 64];
    let water = vec![0; 64 * 64];
    let surface = Surface {
        geometry: None,
        width: 1600.0,
        n: 64,
        height: &height,
        water: &water,
    };
    let cfg = LayoutConfig {
        access_depth: 30.0,
        ..LayoutConfig::default()
    };
    let mut layout = deep_layout();
    let original = layout.clone();
    access::refine(&mut layout, &cfg, &morph(), surface);
    assert!(layout.structure.as_ref().unwrap().metrics.access_added > 0);
    for street in &layout.streets {
        assert!(routing::path_clear(
            surface,
            &street.path,
            cfg.max_lane_grade
        ));
    }
    let corridors = g::union(
        &layout
            .streets
            .iter()
            .flat_map(|s| g::ribbon(&s.path, &s.widths))
            .collect::<Vec<_>>(),
    );
    let mut covered = layout
        .blocks
        .iter()
        .map(|b| b.shape.clone())
        .collect::<Vec<_>>();
    covered.extend(
        corridors
            .iter()
            .flat_map(|r| g::intersection(r, &original.blocks[0].shape)),
    );
    assert!(
        (g::union(&covered).iter().map(g::area).sum::<f64>() - g::area(&original.blocks[0].shape))
            .abs()
            < 0.02
    );
    for op in ["strips", "oriented", "frontage", "compound"] {
        let cfg = ParcelConfig {
            operator: op.into(),
            ..ParcelConfig::default()
        };
        let before = serde_json::to_string(&layout).unwrap();
        let p = generate_parcels("deep", std::slice::from_ref(&layout), &cfg).unwrap();
        assert_eq!(serde_json::to_string(&layout).unwrap(), before);
        let d = p[0].diagnostics.as_ref().unwrap();
        assert!(d.residual_area < 0.1 && d.overlap_area < 0.1, "{op}: {d:?}");
        assert!(
            p[0].parcels
                .iter()
                .any(|p| p.access.as_ref().is_some_and(|a| a.kind == "collective")),
            "{op}: adaptive shared street contacts were lost"
        );
    }
}

#[test]
fn cluster_tissue_creates_a_real_common_and_keeps_it_during_parcelling() {
    let height = vec![20.0; 64 * 64];
    let water = vec![0; 64 * 64];
    let surface = Surface {
        geometry: None,
        width: 1600.0,
        n: 64,
        height: &height,
        water: &water,
    };
    let mut layout = deep_layout();
    let cfg = LayoutConfig {
        tissue: "clusters".into(),
        ..LayoutConfig::default()
    };
    access::refine(&mut layout, &cfg, &morph(), surface);
    assert!(layout.blocks.iter().any(|b| b.kind == "common"));
    let p = generate_parcels("cluster", &[layout], &ParcelConfig::default()).unwrap();
    assert!(p[0].parcels.iter().any(|p| p.use_kind == "common"));
}

#[test]
fn final_network_retains_every_explicit_nucleus() {
    let mut streets = (0..3)
        .map(|i| {
            let x = 100.0 + i as f64 * 300.0;
            Street {
                path: vec![
                    Point { x, y: 100.0 },
                    Point {
                        x: x + 70.0,
                        y: 100.0,
                    },
                ],
                widths: vec![5.0; 2],
                rank: 1,
                role: "street".into(),
            }
        })
        .collect::<Vec<_>>();
    let centers = streets.iter().map(|s| s.path[0]).collect::<Vec<_>>();
    network::clean_with_centers(&mut streets, centers[0], 80.0, true, &centers);
    assert_eq!(streets.len(), 3);
}

#[test]
fn spatial_phase_recipes_do_not_create_artificial_sector_boundaries() {
    let height = vec![20.0; 64 * 64];
    let water = vec![0; 64 * 64];
    let surface = Surface {
        geometry: None,
        width: 1600.0,
        n: 64,
        height: &height,
        water: &water,
    };
    let site = Site {
        key: "history".into(),
        name: String::new(),
        population: 4000,
        culture: "european-organic".into(),
        center: Point { x: 800.0, y: 800.0 },
        radius: 350.0,
    };
    let config = LayoutConfig {
        tissue: "grid".into(),
        fortification: "none".into(),
        peripheral_road: "none".into(),
        footprint: FootprintConfig {
            family: "rectangle".into(),
            gross_density: 100.0,
            ..FootprintConfig::default()
        },
        ..LayoutConfig::default()
    };
    let l = generate_quarters(
        "history",
        std::slice::from_ref(&site),
        &config,
        surface,
        &[],
    )
    .unwrap();
    let ages = l[0]
        .blocks
        .iter()
        .filter_map(|b| b.phase)
        .collect::<BTreeSet<_>>();
    assert_eq!(ages.len(), 3);
    assert_eq!(
        l[0].quarters.len(),
        4,
        "age domains must not multiply calculation sectors"
    );
    let repeated = generate_quarters("history", &[site], &config, surface, &[]).unwrap();
    assert_eq!(
        serde_json::to_string(&l).unwrap(),
        serde_json::to_string(&repeated).unwrap()
    );
    let p = generate_parcels("history", &l, &ParcelConfig::default()).unwrap();
    let actual_unserved = p[0]
        .parcels
        .iter()
        .filter(|p| p.access.as_ref().is_some_and(|a| a.kind == "unserved"))
        .map(|p| g::area(&p.shape))
        .sum::<f64>();
    assert!((actual_unserved - p[0].diagnostics.as_ref().unwrap().unserved_area).abs() < 0.01);
}

#[test]
fn natural_auto_respects_geography_and_explicit_foundations_remain_available() {
    let width = 4000.0;
    let n = 160;
    let mut valley = vec![0.0; n * n];
    for y in 0..n {
        for x in 0..n {
            let px = (x as f64 + 0.5) / n as f64 * width;
            let py = (y as f64 + 0.5) / n as f64 * width;
            let center = 2000.0 + 300.0 * ((py - 2000.0) / 800.0).sin();
            valley[y * n + x] =
                (50.0 + 0.0008 * (px - center).powi(2) + 0.01 * (py - 2000.0)) as f32;
        }
    }
    let flat = vec![50.0; n * n];
    let water = vec![0; n * n];
    let mut site = Site {
        key: "natural".into(),
        name: String::new(),
        population: 3000,
        culture: "european-organic".into(),
        center: Point {
            x: 2000.0,
            y: 2000.0,
        },
        radius: 310.0,
    };
    let mut cfg = LayoutConfig {
        fortification: "none".into(),
        footprint: FootprintConfig {
            gross_density: 100.0,
            epochs: 1,
            ..FootprintConfig::default()
        },
        ..LayoutConfig::default()
    };
    let surface = |height| Surface {
        geometry: None,
        width,
        n,
        height,
        water: &water,
    };
    let organic = footprint::generate(
        "natural",
        &site,
        &cfg,
        &morph(),
        surface(&valley),
        &[],
        310.0,
    );
    assert_eq!(organic.structure.mechanism, "accessibility");
    assert!(
        organic.structure.metrics.allocated_area >= organic.structure.metrics.target_area * 0.97
    );
    for y in 0..n {
        for x in 0..n {
            let p = Point {
                x: (x as f64 + 0.5) / n as f64 * width,
                y: (y as f64 + 0.5) / n as f64 * width,
            };
            if organic
                .structure
                .allocated
                .iter()
                .any(|s| g::contains(s, p))
            {
                let d = width / n as f64 * 0.45;
                let gx = (surface(&valley).height_at(Point { x: p.x + d, y: p.y })
                    - surface(&valley).height_at(Point { x: p.x - d, y: p.y }))
                    / (2.0 * d);
                let gy = (surface(&valley).height_at(Point { x: p.x, y: p.y + d })
                    - surface(&valley).height_at(Point { x: p.x, y: p.y - d }))
                    / (2.0 * d);
                assert!(
                    gx.hypot(gy) < 0.38,
                    "footprint climbed a nonconstructible slope"
                );
            }
        }
    }
    site.culture = "chinese".into();
    let chinese_open =
        footprint::generate("natural", &site, &cfg, &morph(), surface(&flat), &[], 310.0);
    assert_eq!(chinese_open.structure.mechanism, "accessibility");
    cfg.fortification = "wall".into();
    let chinese_flat =
        footprint::generate("natural", &site, &cfg, &morph(), surface(&flat), &[], 310.0);
    assert_eq!(
        (
            chinese_flat.structure.mechanism.as_str(),
            chinese_flat.structure.family.as_str()
        ),
        ("planned", "rectangle")
    );
    let chinese_valley = footprint::generate(
        "natural",
        &site,
        &cfg,
        &morph(),
        surface(&valley),
        &[],
        310.0,
    );
    assert_eq!(chinese_valley.structure.mechanism, "planned");
    assert_eq!(chinese_valley.structure.family, "rectangle");
    assert_eq!(chinese_valley.structure.allocated[0].outer.len(), 4);
    let bb = g::bbox(&chinese_flat.structure.allocated[0]);
    assert!(((bb.2 - bb.0) / (bb.3 - bb.1) - 1.0).abs() < 0.01);
    cfg.footprint.mechanism = "planned".into();
    let forced = footprint::generate(
        "natural",
        &site,
        &cfg,
        &morph(),
        surface(&valley),
        &[],
        310.0,
    );
    assert_eq!(
        (
            forced.structure.mechanism.as_str(),
            forced.structure.family.as_str()
        ),
        ("planned", "rectangle")
    );
    cfg.footprint.family = "circle".into();
    let forced_circle = footprint::generate(
        "natural",
        &site,
        &cfg,
        &morph(),
        surface(&valley),
        &[],
        310.0,
    );
    assert_eq!(
        (
            forced_circle.structure.mechanism.as_str(),
            forced_circle.structure.family.as_str()
        ),
        ("planned", "circle")
    );
}

#[test]
fn open_peripheral_frontage_has_parcels_on_both_sides_without_extra_outer_roads() {
    let height = vec![20.0; 64 * 64];
    let water = vec![0; height.len()];
    let surface = Surface {
        geometry: None,
        width: 1600.0,
        n: 64,
        height: &height,
        water: &water,
    };
    let site = Site {
        key: "peripheral".into(),
        name: String::new(),
        population: 3000,
        culture: "european-organic".into(),
        center: Point { x: 800.0, y: 800.0 },
        radius: 310.0,
    };
    let cfg = LayoutConfig {
        fortification: "none".into(),
        peripheral_road: "full".into(),
        footprint: FootprintConfig {
            family: "rectangle".into(),
            gross_density: 100.0,
            epochs: 1,
            ..Default::default()
        },
        ..Default::default()
    };
    let layouts = generate_quarters("peripheral", &[site], &cfg, surface, &[]).unwrap();
    let layout = &layouts[0];
    assert!(layout.streets.iter().any(|s| s.role == "peripheral"));
    assert!(layout.quarters.len() > cfg.count);
    let core = g::union(
        &layout.quarters[..cfg.count]
            .iter()
            .map(|q| q.shape.clone())
            .collect::<Vec<_>>(),
    );
    let outer = &layout.quarters[cfg.count..];
    assert!(outer.iter().all(|q| core.iter().all(|s| {
        g::intersection(&q.shape, s)
            .iter()
            .map(g::area)
            .sum::<f64>()
            < 0.01
    })));
    for street in layout.streets.iter().filter(|s| s.role != "peripheral") {
        assert!(
            outer
                .iter()
                .all(|q| street.path.windows(2).all(|p| !g::contains(
                    &q.shape,
                    Point {
                        x: (p[0].x + p[1].x) * 0.5,
                        y: (p[0].y + p[1].y) * 0.5
                    }
                )))
        );
    }
    let parcels = generate_parcels("peripheral", &layouts, &ParcelConfig::default()).unwrap();
    assert!(
        parcels[0]
            .parcels
            .iter()
            .any(|p| layout.blocks[p.block].quarter >= cfg.count
                && p.access.as_ref().is_some_and(|a| a.kind != "unserved")
                && p.front.is_some())
    );
}

#[test]
fn unbuildable_terrain_leaves_an_explicit_budget_deficit_and_no_phantom_center() {
    let width = 3000.0;
    let n = 96;
    let steep = (0..n * n)
        .map(|i| ((i % n) as f64 / n as f64 * width * 0.8) as f32)
        .collect::<Vec<_>>();
    let water = vec![0; n * n];
    let surface = Surface {
        geometry: None,
        width,
        n,
        height: &steep,
        water: &water,
    };
    let site = Site {
        key: "steep".into(),
        name: String::new(),
        population: 3000,
        culture: "russian-kremlin".into(),
        center: Point {
            x: 1500.0,
            y: 1500.0,
        },
        radius: 310.0,
    };
    let cfg = LayoutConfig {
        footprint: FootprintConfig {
            gross_density: 100.0,
            ..FootprintConfig::default()
        },
        ..LayoutConfig::default()
    };
    let output = footprint::generate("steep", &site, &cfg, &morph(), surface, &[], 310.0);
    assert_eq!(output.structure.mechanism, "accessibility");
    assert!(output.structure.allocated.is_empty());
    assert!(output.structure.centers.is_empty());
    assert!(output.structure.metrics.shortfall_area >= output.structure.metrics.target_area * 0.99);
    assert!(!output.warnings.is_empty());
}
