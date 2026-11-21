//! Fringe routes, regional access, and streets alongside or through walls.

use super::street;
use super::super::{Curtains, Graph, cap_gate_passages, clear_spurs, distance, ensure_regional_access, lerp, planarize, resolve_exits};
use crate::urban::{Point, Street};

#[test]
fn fringe_exits_form_connected_peripheral_sections_or_reclaimed_caps() {
    let h = vec![20.0; 64 * 64];
    let water = vec![0; h.len()];
    let surface = crate::urban::Surface {
        geometry: None,
        width: 400.0,
        n: 64,
        height: &h,
        water: &water,
        interpolation: Default::default(),
    };
    let quarter = crate::urban::Quarter {
        shape: crate::urban::geometry::rectangle(80.0, 80.0, 320.0, 320.0),
        phase: 0,
        zone: "core".into(),
    };
    let initial = vec![
        street(&[(80.0, 200.0), (200.0, 200.0), (320.0, 200.0)], "street"),
        street(&[(200.0, 80.0), (200.0, 200.0), (200.0, 320.0)], "street"),
    ];
    let cfg = crate::urban::LayoutConfig {
        peripheral_road: "full".into(),
        ..Default::default()
    };
    let mut streets = initial.clone();
    resolve_exits(
        &mut streets,
        std::slice::from_ref(&quarter),
        &[],
        &[],
        surface,
        &cfg,
        &mut crate::rng::Rng::new("exits"),
    );
    planarize(&mut streets, 120.0);
    let graph = Graph::new(&streets);
    assert!(streets.iter().any(|s| s.role == "peripheral"));
    assert!(graph.degrees.vals.iter().all(|&n| n >= 2));
    assert!(streets.iter().all(|s| crate::urban::routing::path_clear(
        surface,
        &s.path,
        cfg.max_street_grade
    )));
    let mut streets = initial;
    let cfg = crate::urban::LayoutConfig {
        exit_treatment: "closed".into(),
        ..cfg
    };
    resolve_exits(
        &mut streets,
        &[quarter],
        &[],
        &[],
        surface,
        &cfg,
        &mut crate::rng::Rng::new("exits"),
    );
    for s in &streets {
        for p in [s.path[0], *s.path.last().unwrap()] {
            assert!(
                p.x >= 94.0 && p.x <= 306.0 && p.y >= 94.0 && p.y <= 306.0,
                "{p:?}"
            );
        }
    }
}

/// Peripheral sections, feeders and rural paths never cross a curtain nor
/// ride along it, and the streets inside a circuit keep their wall ends.
#[test]
fn open_edge_roads_never_cross_a_curtain() {
    use crate::urban::{Enclosure, LayoutConfig, Quarter, Surface, geometry as g};
    let height = vec![20.0; 64 * 64];
    let water = vec![0; height.len()];
    let surface = Surface {
        geometry: None,
        width: 1000.0,
        n: 64,
        height: &height,
        water: &water,
        interpolation: Default::default(),
    };
    // Walled town (x < 400) and an open faubourg against its east side.
    let quarters = [
        Quarter {
            shape: g::rectangle(200.0, 200.0, 400.0, 600.0),
            phase: 0,
            zone: "core".into(),
        },
        Quarter {
            shape: g::rectangle(400.0, 200.0, 640.0, 600.0),
            phase: 1,
            zone: "edge".into(),
        },
    ];
    let wall: Vec<Point> = [
        (195.0, 195.0),
        (400.0, 195.0),
        (400.0, 605.0),
        (195.0, 605.0),
    ]
    .iter()
    .chain(std::iter::once(&(195.0, 195.0)))
    .map(|&(x, y)| Point { x, y })
    .collect();
    let enclosure = Enclosure {
        path: wall.clone(),
        kind: "palisade".into(),
        gates: vec![Point { x: 400.0, y: 400.0 }],
        ..Default::default()
    };
    let initial = vec![
        street(&[(300.0, 400.0), (400.0, 400.0), (520.0, 400.0)], "street"),
        street(&[(300.0, 200.0), (300.0, 400.0), (300.0, 600.0)], "street"),
        street(&[(520.0, 200.0), (520.0, 400.0), (520.0, 600.0)], "street"),
    ];
    // A regional road west of the town: reaching it means crossing the wall.
    let roads = vec![street(&[(120.0, 0.0), (120.0, 1000.0)], "regional")];
    let crosses = |s: &Street| {
        s.path.windows(2).any(|a| {
            wall.windows(2)
                .any(|b| g::segment_hit(a[0], a[1], b[0], b[1]).is_some())
        })
    };
    for road in ["full", "auto"] {
        let cfg = LayoutConfig {
            peripheral_road: road.into(),
            ..Default::default()
        };
        let mut streets = initial.clone();
        resolve_exits(
            &mut streets,
            &quarters,
            &roads,
            std::slice::from_ref(&enclosure),
            surface,
            &cfg,
            &mut crate::rng::Rng::new("curtain-exits"),
        );
        for s in &streets[initial.len()..] {
            assert!(!crosses(s), "{} crosses the curtain: {:?}", s.role, s.path);
            let near = crate::urban::fortification::Near::new(&wall, 12.0);
            if s.role == "peripheral" {
                assert!(s.path.windows(2).all(|w| near.distance(w[0], w[1]) > 5.0));
            }
        }
        // The walled street stops where it was, but for its ends: those
        // are carried on to the wall-lane line, never across the curtain.
        assert!(
            initial[1].path[1..2]
                .iter()
                .all(|v| streets[1].path.contains(v))
        );
        assert!(!crosses(&streets[1]));
        if road == "full" {
            assert!(streets.iter().any(|s| s.role == "peripheral"));
        }
    }
}

/// A peripheral section along a circuit is moved off it, not dropped:
/// beside a palisade without ditch it runs along the outer face, beside a
/// ditch along its edge; its ribbon keeps off the curtain (clearance) and
/// the reserve, and it never crosses the curtain.
#[test]
fn a_peripheral_section_along_the_wall_is_rerouted_off_the_reserve() {
    use crate::urban::{Enclosure, LayoutConfig, Quarter, Surface, geometry as g};
    let height = vec![20.0; 64 * 64];
    let water = vec![0; height.len()];
    let surface = Surface {
        geometry: None,
        width: 1000.0,
        n: 64,
        height: &height,
        water: &water,
        interpolation: Default::default(),
    };
    let wall: Vec<Point> = [
        (195.0, 195.0),
        (400.0, 195.0),
        (400.0, 605.0),
        (195.0, 605.0),
        (195.0, 195.0),
    ]
    .iter()
    .map(|&(x, y)| Point { x, y })
    .collect();
    // Curtain body all along the east face, a ditch on its north half.
    let reserve = vec![
        g::rectangle(400.0, 195.0, 401.5, 605.0),
        g::rectangle(401.5, 195.0, 414.0, 400.0),
    ];
    let enclosure = Enclosure {
        path: wall.clone(),
        kind: "palisade".into(),
        gates: vec![],
        reserve: reserve.clone(),
        ..Default::default()
    };
    // The faubourg gave the reserve up: its west edge is the reserve edge.
    let faubourg = g::rectangle(400.0, 200.0, 640.0, 600.0);
    let shape = reserve
        .iter()
        .fold(vec![faubourg], |acc, r| {
            acc.iter().flat_map(|p| g::difference(p, r)).collect()
        })
        .remove(0);
    let quarters = [Quarter {
        shape,
        phase: 1,
        zone: "edge".into(),
    }];
    let initial = vec![
        street(&[(430.0, 200.0), (430.0, 400.0), (430.0, 600.0)], "street"),
        street(&[(600.0, 200.0), (600.0, 400.0), (600.0, 600.0)], "street"),
    ];
    let cfg = LayoutConfig {
        peripheral_road: "full".into(),
        ..Default::default()
    };
    let mut streets = initial.clone();
    resolve_exits(
        &mut streets,
        &quarters,
        &[],
        std::slice::from_ref(&enclosure),
        surface,
        &cfg,
        &mut crate::rng::Rng::new("curtain-exits"),
    );
    let curtains = Curtains::new(std::slice::from_ref(&enclosure));
    let west: Vec<&Street> = streets
        .iter()
        .filter(|s| s.role == "peripheral" && s.path.iter().any(|p| p.x < 420.0))
        .collect();
    assert!(!west.is_empty(), "the section along the wall is kept");
    for s in west {
        let hw = s.widths[0] * 0.5;
        for w in s.path.windows(2) {
            assert!(!curtains.crosses(w[0], w[1]));
        }
        // Interior segments: the street ends stay where they are.
        for w in s.path[1..s.path.len() - 1].windows(2) {
            assert!(curtains.segment_clear(w[0], w[1], hw), "{:?}", s.path);
        }
        let x: Vec<f64> = s.path.iter().map(|p| p.x).collect();
        assert!(
            x.iter().any(|&x| x < 412.0),
            "along the outer face south: {x:?}"
        );
    }
}

/// Invariant (inner ring roads): two street ends stopping at the curtain
/// from inside are joined by a wall-lane section along the inner face; the
/// ends stop on it, it never crosses the curtain, never enters the
/// reserve (here a tower inside the lane line, which it goes round) and
/// never lies in a gate passage.
#[test]
fn inner_street_ends_at_the_wall_are_joined_by_the_wall_lane() {
    use crate::urban::{Enclosure, Gatehouse, LayoutConfig, Quarter, Surface, geometry as g};
    let height = vec![20.0; 64 * 64];
    let water = vec![0; height.len()];
    let surface = Surface {
        geometry: None,
        width: 1000.0,
        n: 64,
        height: &height,
        water: &water,
        interpolation: Default::default(),
    };
    let wall: Vec<Point> = [
        (195.0, 195.0),
        (400.0, 195.0),
        (400.0, 605.0),
        (195.0, 605.0),
        (195.0, 195.0),
    ]
    .iter()
    .map(|&(x, y)| Point { x, y })
    .collect();
    // Curtain body on the east face, a tower reaching 10 m inside it, and
    // a gatehouse on the south end of the east face.
    let reserve = vec![
        g::rectangle(400.0, 195.0, 401.5, 605.0),
        g::rectangle(390.0, 395.0, 400.0, 405.0),
    ];
    let gatehouse = Gatehouse {
        gate: 0,
        kind: "tower".into(),
        shape: g::rectangle(390.0, 560.0, 410.0, 580.0),
        masses: vec![],
        passage: [Point { x: 400.0, y: 570.0 }, Point { x: 410.0, y: 570.0 }],
        passage_width_m: 5.0,
        height_m: 8.0,
    };
    let enclosure = Enclosure {
        path: wall,
        kind: "palisade".into(),
        gates: vec![Point { x: 400.0, y: 570.0 }],
        reserve,
        gatehouses: vec![gatehouse.clone()],
        ..Default::default()
    };
    let quarters = [Quarter {
        shape: g::rectangle(195.0, 195.0, 400.0, 605.0),
        phase: 1,
        zone: "core".into(),
    }];
    // Two streets end on the east curtain, north and south of the tower;
    // a spine joins them.
    let mut streets = vec![
        street(&[(300.0, 260.0), (399.9, 260.0)], "street"),
        street(&[(300.0, 520.0), (399.9, 520.0)], "street"),
        street(&[(300.0, 260.0), (300.0, 520.0)], "street"),
    ];
    let cfg = LayoutConfig {
        peripheral_road: "full".into(),
        ..Default::default()
    };
    resolve_exits(
        &mut streets,
        &quarters,
        &[],
        std::slice::from_ref(&enclosure),
        surface,
        &cfg,
        &mut crate::rng::Rng::new("inner-ring"),
    );
    let curtains = Curtains::new(std::slice::from_ref(&enclosure));
    let lanes: Vec<&Street> = streets.iter().filter(|s| s.role == "wall-lane").collect();
    assert!(!lanes.is_empty(), "the inner ring road is laid");
    let hw = lanes[0].widths[0] * 0.5;
    let on_lane = |p: Point| {
        lanes.iter().any(|l| {
            l.path
                .windows(2)
                .any(|w| g::distance(p, w[0], w[1]).0 < 0.05)
        })
    };
    // The street ends stop on the lane, short of the curtain ribbon.
    for s in &streets[..2] {
        let end = *s.path.last().unwrap();
        assert!(on_lane(end), "{end:?} stops on the lane");
        assert!(end.x < 399.0);
    }
    for l in &lanes {
        for w in l.path.windows(2) {
            let steps = (distance(w[0], w[1]) / 0.5).ceil().max(1.0) as usize;
            assert!(!curtains.crosses(w[0], w[1]));
            for k in 0..=steps {
                let p = lerp(w[0], w[1], k as f64 / steps as f64);
                assert!(curtains.lane_clear_at(p, hw), "{p:?} keeps off the reserve");
                assert!(!g::contains(&gatehouse.shape, p));
            }
        }
    }
    // The lane goes round the tower, inside it.
    assert!(
        lanes
            .iter()
            .flat_map(|l| l.path.iter())
            .any(|p| (395.0..=405.0).contains(&p.y) && p.x < 388.0)
    );
}

/// Every wall-lane section is laid, also with the "auto" peripheral
/// setting: ten street ends along a curtain face leave no stretch of wall
/// foot between them without the lane.
#[test]
fn auto_wall_lane_leaves_no_stretch_between_street_ends() {
    use crate::urban::{Enclosure, LayoutConfig, Quarter, Surface, geometry as g};
    let height = vec![20.0; 64 * 64];
    let water = vec![0; height.len()];
    let surface = Surface {
        geometry: None,
        width: 1000.0,
        n: 64,
        height: &height,
        water: &water,
        interpolation: Default::default(),
    };
    let wall: Vec<Point> = [
        (195.0, 195.0),
        (400.0, 195.0),
        (400.0, 605.0),
        (195.0, 605.0),
        (195.0, 195.0),
    ]
    .iter()
    .map(|&(x, y)| Point { x, y })
    .collect();
    let enclosure = Enclosure {
        path: wall,
        kind: "palisade".into(),
        reserve: vec![g::rectangle(400.0, 195.0, 401.5, 605.0)],
        ..Default::default()
    };
    let quarters = [Quarter {
        shape: g::rectangle(195.0, 195.0, 400.0, 605.0),
        phase: 1,
        zone: "core".into(),
    }];
    let ys: Vec<f64> = (0..10).map(|k| 240.0 + 35.0 * k as f64).collect();
    let mut streets: Vec<Street> = ys
        .iter()
        .map(|&y| street(&[(300.0, y), (399.9, y)], "street"))
        .collect();
    streets.push(street(&[(300.0, 240.0), (300.0, 555.0)], "street"));
    let cfg = LayoutConfig {
        peripheral_road: "auto".into(),
        ..Default::default()
    };
    resolve_exits(
        &mut streets,
        &quarters,
        &[],
        std::slice::from_ref(&enclosure),
        surface,
        &cfg,
        &mut crate::rng::Rng::new("inner-ring-auto"),
    );
    let lanes: Vec<&Street> = streets.iter().filter(|s| s.role == "wall-lane").collect();
    let mut y = 245.0;
    while y < 550.0 {
        let p = Point { x: 400.0, y };
        assert!(
            lanes.iter().any(|l| l
                .path
                .windows(2)
                .any(|w| g::distance(p, w[0], w[1]).0 < 10.0)),
            "wall foot at y = {y} without its lane"
        );
        y += 5.0;
    }
}

/// Invariant (gate passages): inside a land gatehouse a street is at most
/// the passage width less one metre; away from the gate it keeps its width.
#[test]
fn a_street_in_a_gate_passage_is_capped_to_the_passage() {
    use crate::urban::{Enclosure, Gatehouse, geometry as g};
    let wall: Vec<Point> = [
        (195.0, 195.0),
        (400.0, 195.0),
        (400.0, 605.0),
        (195.0, 605.0),
        (195.0, 195.0),
    ]
    .iter()
    .map(|&(x, y)| Point { x, y })
    .collect();
    let enclosure = Enclosure {
        path: wall,
        kind: "wall".into(),
        gates: vec![Point { x: 400.0, y: 400.0 }],
        gatehouses: vec![Gatehouse {
            gate: 0,
            kind: "tower".into(),
            shape: g::rectangle(398.0, 392.0, 410.0, 408.0),
            masses: vec![],
            passage: [Point { x: 398.0, y: 400.0 }, Point { x: 410.0, y: 400.0 }],
            passage_width_m: 6.0,
            height_m: 10.0,
        }],
        ..Default::default()
    };
    let mut streets = vec![Street {
        path: vec![Point { x: 300.0, y: 400.0 }, Point { x: 520.0, y: 400.0 }],
        widths: vec![9.0, 9.0],
        rank: 0,
        role: "gate-street".into(),
    }];
    cap_gate_passages(&mut streets, std::slice::from_ref(&enclosure));
    let s = &streets[0];
    assert_eq!(s.path.len(), s.widths.len());
    for (p, w) in s.path.iter().zip(&s.widths) {
        if (396.0..=412.0).contains(&p.x) {
            assert!(*w <= 5.0 + 1e-9, "{w} m at {p:?}");
        }
    }
    assert!(s.path.iter().any(|p| (p.x - 400.0).abs() < 1e-6));
    assert_eq!((s.widths[0], *s.widths.last().unwrap()), (9.0, 9.0));
}

#[test]
fn local_feeder_reaches_a_regional_axis_beyond_the_immediate_fringe() {
    use crate::urban::{LayoutConfig, Quarter, Surface, geometry as g};
    let height = vec![20.0; 64 * 64];
    let water = vec![0; height.len()];
    let surface = Surface {
        geometry: None,
        width: 1000.0,
        n: 64,
        height: &height,
        water: &water,
        interpolation: Default::default(),
    };
    let quarter = Quarter {
        shape: g::rectangle(200.0, 200.0, 400.0, 400.0),
        phase: 0,
        zone: "core".into(),
    };
    let mut streets = vec![street(
        &[(200.0, 300.0), (300.0, 300.0), (400.0, 300.0)],
        "street",
    )];
    let roads = vec![street(&[(650.0, 100.0), (650.0, 900.0)], "regional")];
    let cfg = LayoutConfig {
        peripheral_road: "none".into(),
        ..Default::default()
    };
    resolve_exits(
        &mut streets,
        &[quarter],
        &roads,
        &[],
        surface,
        &cfg,
        &mut crate::rng::Rng::new("feeder"),
    );
    let feeder = streets
        .iter()
        .find(|s| s.role == "outbound" && (s.path.last().unwrap().x - 650.0).abs() < 0.001)
        .unwrap();
    assert_eq!(feeder.path[0], Point { x: 400.0, y: 300.0 });
    assert_eq!(feeder.rank, 3);
    assert!(feeder.widths.iter().any(|w| *w <= 2.5));
    assert!((feeder.widths[0] - 5.0).abs() < 0.001);
    assert!((feeder.widths.last().unwrap() - 5.0).abs() < 0.001);
    assert!(crate::urban::routing::path_clear(
        surface,
        &feeder.path,
        cfg.max_lane_grade
    ));
}

/// A wall-lane section blocked by water on the way still runs from each
/// end up to the water: two dead ends, each clear of it.
#[test]
fn blocked_wall_lane_runs_up_to_the_water() {
    let h = vec![20.0; 64 * 64];
    let mut water = vec![0u8; 64 * 64];
    // A river over x in [187.5, 212.5) (cells 30..34, 6.25 m each).
    for y in 0..64 {
        for x in 30..34 {
            water[y * 64 + x] = 1;
        }
    }
    let surface = crate::urban::Surface {
        geometry: None,
        width: 400.0,
        n: 64,
        height: &h,
        water: &water,
        interpolation: Default::default(),
    };
    let path: Vec<Point> = (0..=40)
        .map(|k| Point {
            x: 100.0 + 5.0 * k as f64,
            y: 100.0,
        })
        .collect();
    let [head, tail] = clear_spurs(&path, surface, 0.1);
    let (head, tail) = (
        head.expect("lane from the start"),
        tail.expect("lane to the end"),
    );
    assert_eq!(head[0], path[0]);
    assert_eq!(*tail.last().unwrap(), *path.last().unwrap());
    assert!(crate::urban::routing::path_clear(surface, &head, 0.1));
    assert!(crate::urban::routing::path_clear(surface, &tail, 0.1));
    assert!(head.last().unwrap().x <= 187.5 && tail[0].x >= 212.5);
    assert!(head.last().unwrap().x >= 180.0 && tail[0].x <= 220.0);
}

#[test]
fn v7_moved_settlement_reconnects_once_on_dry_ground() {
    let mut layout: crate::urban::Layout = serde_json::from_value(serde_json::json!({
        "key":"access", "culture":"sahel", "center":{"x":600.,"y":500.}, "quarters":[], "blocks":[], "warnings":[],
        "streets":[{"path":[{"x":600.,"y":400.},{"x":600.,"y":600.}],"widths":[4.],"rank":2,"role":"street"}]
    })).unwrap();
    let original = serde_json::to_value(&layout.streets[0]).unwrap();
    let roads = [Street {path:vec![Point{x:100.,y:1.},Point{x:100.,y:999.}],widths:vec![6.],rank:1,role:"regional".into()}];
    let height = vec![10.;32*32];let water = vec![0;32*32];
    let surface = crate::urban::Surface {geometry:None,width:1000.,n:32,height:&height,water:&water, interpolation: Default::default(),};
    ensure_regional_access(&mut layout,&roads,surface,&Default::default());
    assert_eq!(layout.streets.len(),2);
    assert_eq!(serde_json::to_value(&layout.streets[0]).unwrap(),original);
    let added = layout.streets.last().unwrap();
    assert_eq!(added.role,"outbound");
    assert!((added.path.last().unwrap().x-100.).abs()<1e-6);
    assert!(crate::urban::routing::path_clear(surface,&added.path,0.18));
    ensure_regional_access(&mut layout,&roads,surface,&Default::default());
    assert_eq!(layout.streets.len(),2);
}
