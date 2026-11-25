use super::*;

#[test]
fn tessellated_shoreline_keeps_a_connected_dry_quay() {
    let n = 64;
    let height = vec![0.; n * n];
    let water: Vec<u8> = (0..n * n).map(|i| u8::from(i % n < 32)).collect();
    let surface = Surface {
        geometry: None,
        width: 256.,
        n,
        height: &height,
        water: &water,
        interpolation: Default::default(),
    };
    let shore = |x| {
        let mut outer = vec![
            Point { x, y: 20. },
            Point { x: 200., y: 20. },
            Point { x: 200., y: 220. },
        ];
        // The real coast is straight but its stored contour has 2 m edges.
        outer.extend((0..=100).map(|i| Point {
            x,
            y: 220. - 2. * i as f64,
        }));
        g::normalized(Shape {
            outer,
            holes: vec![],
        })
    };
    let road = Street {
        path: vec![Point { x: 160., y: 30. }, Point { x: 160., y: 210. }],
        widths: vec![5.; 2],
        rank: 1,
        role: "street".into(),
    };
    let cfg = LayoutConfig::default();
    let mut streets = vec![road.clone()];
    harbour::quays(
        &[shore(128.)],
        &mut streets,
        surface,
        &cfg,
        &port_site(),
        "european-organic",
        true,
    );
    let quays: Vec<_> = streets.iter().filter(|s| s.role == "quay").collect();
    assert_eq!(quays.len(), 1);
    // One straight quay despite the 2 m contour edges; its length is the
    // population budget (0.035 m per inhabitant), not the whole shore.
    let l: f64 = quays[0].path.windows(2).map(|w| dist(w[0], w[1])).sum();
    assert!(l >= 60. && dist(quays[0].path[0], *quays[0].path.last().unwrap()) > 0.95 * l, "quay {l} m");
    assert!(routing::path_clear(surface, &quays[0].path, 0.04));
    for ribbon in g::ribbon(&quays[0].path, &quays[0].widths) {
        assert!(
            g::area(&ribbon)
                - g::dry_clip(&surface, &ribbon)
                    .iter()
                    .map(g::area)
                    .sum::<f64>()
                <= 1e-4
        );
    }
    assert!(
        streets
            .iter()
            .any(|s| s.role == "street" && quays[0].path.contains(&s.path[0]))
    );
    let mut inland = vec![road];
    harbour::quays(
        &[shore(150.)],
        &mut inland,
        surface,
        &cfg,
        &port_site(),
        "european-organic",
        true,
    );
    assert!(!inland.iter().any(|s| s.role == "quay"));
}

#[test]
fn adjacent_shoreline_reaches_form_one_dry_platform() {
    let n = 256;
    let height = vec![0.; n * n];
    let water: Vec<u8> = (0..n * n)
        .map(|i| {
            let (x, y) = ((i % n) as f64 + 0.5, (i / n) as f64 + 0.5);
            u8::from(x < 128. + 12. * (1. - (y - 120.).abs() / 100.).max(0.))
        })
        .collect();
    let surface = Surface {
        geometry: None,
        width: 256.,
        n,
        height: &height,
        water: &water,
        interpolation: Default::default(),
    };
    let shore = g::normalized(Shape {
        outer: vec![
            Point { x: 128., y: 20. },
            Point { x: 200., y: 20. },
            Point { x: 200., y: 220. },
            Point { x: 128., y: 220. },
            Point { x: 140., y: 120. },
        ],
        holes: vec![],
    });
    let mut streets = vec![Street {
        path: vec![Point { x: 160., y: 30. }, Point { x: 160., y: 210. }],
        widths: vec![5.; 2],
        rank: 1,
        role: "street".into(),
    }];
    harbour::quays(
        &[shore],
        &mut streets,
        surface,
        &LayoutConfig::default(),
        &port_site(),
        "european-organic",
        true,
    );
    let quays: Vec<_> = streets.iter().filter(|s| s.role == "quay").collect();
    assert_eq!(quays.len(), 1);
    assert!(quays[0].path.len() >= 3);
    assert!(routing::path_clear(surface, &quays[0].path, 0.04));
    // One quay across the bend; its length is the population budget
    // (0.035 m per inhabitant), not the whole shore.
    let l: f64 = quays[0].path.windows(2).map(|w| dist(w[0], w[1])).sum();
    assert!(l >= 60., "quay {l} m");
}
fn port_site() -> Site {
    Site {
        key: "port".into(),
        name: String::new(),
        population: 2000,
        culture: "european-organic".into(),
        center: Point { x: 170.0, y: 120.0 },
        radius: 200.0,
        neighbours: Vec::new(),
    }
}

fn site(culture: &str, population: u32) -> Site {
    Site {
        key: "plan".into(),
        name: String::new(),
        population,
        culture: culture.into(),
        center: Point { x: 256.0, y: 256.0 },
        radius: 120.0,
        neighbours: Vec::new(),
    }
}
fn morph(culture: &str) -> Morph {
    super::super::resolve(
        culture,
        "culture",
        "core",
        "core",
        1.0,
        &serde_json::json!({}),
        "quarters",
    )
    .unwrap()
}
#[test]
fn regional_branches_partition_at_their_shared_nucleus() {
    let mut regions = vec![g::rectangle(0.0, 0.0, 100.0, 100.0)];
    let road = |a: Point| Street {
        path: vec![a, Point { x: 50.0, y: 50.0 }],
        widths: vec![6.0; 2],
        rank: 0,
        role: "road".into(),
    };
    split_joined_roads(
        &mut regions,
        &[
            road(Point { x: 0.0, y: 50.0 }),
            road(Point { x: 100.0, y: 50.0 }),
            road(Point { x: 50.0, y: 100.0 }),
        ],
    );
    assert_eq!(regions.len(), 3);
    assert!((regions.iter().map(g::area).sum::<f64>() - 10000.0).abs() < 0.001);
}
#[test]
fn cultural_walls_radials_and_rings_keep_exact_dry_partition() {
    let heights = vec![0.0; 64 * 64];
    let water = vec![0; 64 * 64];
    let surface = Surface {
        geometry: None,
        width: 512.0,
        n: 64,
        height: &heights,
        water: &water,
        interpolation: Default::default(),
    };
    let cfg = LayoutConfig {
        rings: 2,
        ..LayoutConfig::default()
    };
    let m = morph("european-organic");
    let a = generate(
        "radials",
        &site("european-organic", 3000),
        &cfg,
        &m,
        surface,
        &[],
        120.0,
    );
    let b = generate(
        "radials",
        &site("european-organic", 3000),
        &cfg,
        &m,
        surface,
        &[],
        120.0,
    );
    assert_eq!(
        serde_json::to_string(&a.streets).unwrap(),
        serde_json::to_string(&b.streets).unwrap()
    );
    assert_eq!(a.enclosures[0].kind, "wall");
    assert!(
        !a.streets
            .iter()
            .any(|s| matches!(s.role.as_str(), "radial" | "ring"))
    );
    let radial = generate(
        "radials",
        &site("wizard-city", 3000),
        &cfg,
        &morph("wizard-city"),
        surface,
        &[],
        120.0,
    );
    assert!(radial.streets.iter().any(|s| s.role == "radial"));
    assert!(radial.streets.iter().any(|s| s.role == "ring"));
    let envelope = Shape {
        outer: a.enclosures[0].path.clone(),
        holes: vec![],
    };
    assert!(
        (a.quarters.iter().map(|q| g::area(&q.shape)).sum::<f64>() - g::area(&envelope)).abs()
            < 0.01
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
    let small = generate(
        "small",
        &site("norse-ringfort", 300),
        &LayoutConfig::default(),
        &morph("norse-ringfort"),
        surface,
        &[],
        120.0,
    );
    assert_eq!(small.enclosures[0].kind, "palisade");
}
#[test]
fn waterfront_orientation_follows_the_local_bank() {
    let heights = vec![0.0; 64 * 64];
    let mut water = vec![0; 64 * 64];
    for y in 0..64 {
        for x in 40..64 {
            water[y * 64 + x] = 1;
        }
    }
    let surface = Surface {
        geometry: None,
        width: 512.0,
        n: 64,
        height: &heights,
        water: &water,
        interpolation: Default::default(),
    };
    let angle = water_angle(surface, Point { x: 250.0, y: 260.0 }, 120.0).unwrap();
    assert!(angle.cos().abs() < 0.01);
}

fn way(points: &[(f64, f64)], rank: usize, role: &str) -> Street {
    Street {
        path: points.iter().map(|&(x, y)| Point { x, y }).collect(),
        widths: vec![5.0; points.len()],
        rank,
        role: role.into(),
    }
}

/// Invariant: a growth guide never ends in the open land. A branch tip
/// short of the edge is cut back to its junction, a twig on nothing or a
/// guide only crossing one street is dropped, a guide from the edge to a
/// street keeps that course.
#[test]
fn growth_guides_stop_at_a_junction_or_the_land_edge() {
    let envelope = g::rectangle(0.0, 0.0, 200.0, 200.0);
    let mut streets = vec![
        way(&[(0.0, 100.0), (200.0, 100.0)], 0, "regional"),
        // Edge to tip: crosses the regional road at (60, 100).
        way(&[(60.0, 0.0), (60.0, 150.0)], 1, "street"),
        // A hairpin twig hanging in the land, touching nothing.
        way(
            &[(120.0, 140.0), (150.0, 160.0), (130.0, 175.0)],
            1,
            "street",
        ),
        // Tip to tip, only crossing the regional road at (100, 100).
        way(&[(100.0, 70.0), (100.0, 130.0)], 1, "street"),
    ];
    trim_guide_tips(&mut streets, &envelope);
    assert_eq!(
        streets.len(),
        2,
        "the loose twig and the touching guide are dropped"
    );
    let edge_guide = &streets[1];
    assert_eq!(edge_guide.path[0], Point { x: 60.0, y: 0.0 });
    assert!(
        dist(
            *edge_guide.path.last().unwrap(),
            Point { x: 60.0, y: 100.0 }
        ) < 1.0
    );
    assert_eq!(streets[0].path.len(), 2, "the regional road is untouched");
}

/// Invariant: an imported road reaching a crossing stays joined to it.
/// Its last metres in the water become part of the crossing, and the
/// crossing beyond the land's edge comes in whole.
#[test]
fn a_road_reaching_a_bridge_stays_joined_to_it() {
    let n = 64;
    let height = vec![1.0; n * n];
    // A 10 m stream: x in [300, 310).
    let water: Vec<u8> = (0..n * n).map(|i| if i % n == 30 { 3 } else { 0 }).collect();
    let surface = Surface {
        geometry: None,
        width: 640.0,
        n,
        height: &height,
        water: &water,
        interpolation: Default::default(),
    };
    let bridge = way(&[(303.0, 300.0), (315.0, 300.0)], 0, "bridge");
    let road = way(&[(100.0, 300.0), (295.0, 300.0), (302.0, 300.0)], 0, "regional");
    let mut streets = vec![road.clone()];
    join_crossing_approaches(&mut streets, &[road, bridge.clone()], surface, 0.12);
    let road = &streets[0];
    assert!(routing::path_clear(surface, &road.path, 0.12), "{:?}", road.path);
    let end = *road.path.last().unwrap();
    assert!((end.x - 300.0).abs() < 0.6, "{end:?}");
    assert!(
        streets.iter().any(|s| s.path == bridge.path),
        "the bridge comes in whole"
    );
    let joint = streets
        .iter()
        .find(|s| s.role == "bridge" && *s.path.last().unwrap() == end)
        .expect("the wet run joins the bridge");
    assert_eq!(joint.path[0], bridge.path[0]);
    assert_eq!(*joint.path.last().unwrap(), end);
}

/// Invariant: a camp keeps no street armature. Crossed by a regional
/// road it keeps only that road; else one guide enters from the fence
/// nearest the regional network and stops at the edge of its heart.
#[test]
fn a_camp_is_entered_not_crossed_by_its_guides() {
    let envelope = g::rectangle(0.0, 0.0, 200.0, 200.0);
    let c = Point { x: 100.0, y: 100.0 };
    let guides = vec![
        way(&[(0.0, 100.0), (200.0, 100.0)], 1, "street"),
        way(&[(100.0, 0.0), (100.0, 200.0)], 1, "street"),
    ];
    let mut crossed = guides.clone();
    crossed.push(way(&[(0.0, 50.0), (200.0, 60.0)], 0, "regional"));
    camp_entrance(&mut crossed, &envelope, c, 100.0, &[]);
    assert_eq!(crossed.len(), 1);
    assert_eq!(crossed[0].role, "regional");
    // The regional network passes east of the camp: one entrance, from
    // the east fence to 50 m from the centre.
    let network = [way(&[(400.0, 0.0), (400.0, 200.0)], 0, "regional")];
    let mut entered = guides;
    camp_entrance(&mut entered, &envelope, c, 100.0, &network);
    assert_eq!(entered.len(), 1);
    let path = &entered[0].path;
    assert_eq!(path[0], Point { x: 200.0, y: 100.0 });
    assert!(
        (dist(*path.last().unwrap(), c) - 50.0).abs() < 0.01,
        "{path:?}"
    );
}
