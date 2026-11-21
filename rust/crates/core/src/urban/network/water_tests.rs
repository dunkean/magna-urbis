//! Bridge approaches, deck selection, and trimming streets at the bank.

use super::street;
use super::super::{Graph, WATER_ROLES, bridge_water, distance, dry_streets, join_crossings, key, select_bridges, width};
use crate::urban::Point;

#[test]
fn dropped_bridge_approaches_clear_the_river_and_banks_stay_connected() {
    use crate::urban::{Block, Layout, Surface, geometry as g};
    // A river at x in [980, 1020) and five crossings between two built
    // banks; a village keeps one deck, the other approaches end on the bank.
    let n = 200;
    let height = vec![20.0; n * n];
    let water: Vec<u8> = (0..n * n).map(|i| 3 * u8::from((98..102).contains(&(i % n)))).collect();
    let surface = Surface { geometry: None, width: 2000.0, n, height: &height, water: &water, interpolation: Default::default() };
    let ys = [200.0, 300.0, 400.0, 500.0, 600.0];
    let bank = |x: f64| street(&std::iter::once(100.0).chain(ys).chain([700.0]).map(|y| (x, y)).collect::<Vec<_>>(), "street");
    let mut streets = vec![bank(900.0), bank(1100.0)];
    for y in ys {
        streets.extend([
            street(&[(900.0, y), (980.0, y)], "approach"),
            street(&[(980.0, y), (1020.0, y)], "bridge"),
            street(&[(1020.0, y), (1100.0, y)], "gate-street"),
        ]);
    }
    let mut layout: Layout = serde_json::from_value(serde_json::json!({
        "key":"bank-ends", "culture":"bastide", "center":{"x":1000.0,"y":400.0},
        "streets":[], "quarters":[], "blocks":[], "warnings":[]
    })).unwrap();
    layout.streets = streets;
    layout.blocks = [(810.0, 100.0, 890.0, 700.0), (1110.0, 100.0, 1190.0, 700.0)].iter().map(|&(a, b, c, d)| Block {
        shape: g::rectangle(a, b, c, d), quarter: 0, kind: "block".into(),
        axis: Point { x: 1.0, y: 0.0 }, zone: "core".into(), phase: None,
    }).collect();
    select_bridges(&mut layout, 500, surface, &[]);
    let decks: Vec<_> = layout.streets.iter().filter(|s| s.role == "bridge").collect();
    assert!(!decks.is_empty() && decks.len() < ys.len(), "the quota drops some decks: {}", decks.len());
    let deck_ends: Vec<Point> = decks.iter().flat_map(|s| [s.path[0], *s.path.last().unwrap()]).collect();
    for s in layout.streets.iter().filter(|s| s.role != "bridge") {
        for (k, p) in [(0, s.path[0]), (s.path.len() - 1, *s.path.last().unwrap())] {
            if deck_ends.iter().any(|&e| distance(e, p) < 1e-6) { continue; }
            let clear = width(s, k) * 0.5 + 1.0;
            assert!(p.x <= 980.0 - clear || p.x >= 1020.0 + clear, "{} end {p:?} within {clear} m of the river", s.role);
        }
    }
    // A dropped deck's dead-end approaches may be trimmed or removed by bridge selection;
    // what matters is the end clearance above and the connectivity below.
    // Both banks, with their approaches, stay one network through the kept deck.
    let mut reached = vec![Point { x: 900.0, y: 100.0 }];
    loop {
        let before = reached.len();
        for s in &layout.streets {
            if s.path.iter().any(|p| reached.contains(p)) {
                for &p in &s.path { if !reached.contains(&p) { reached.push(p); } }
            }
        }
        if reached.len() == before { break; }
    }
    for x in [900.0, 1100.0] {
        for y in std::iter::once(100.0).chain(ys).chain([700.0]) {
            assert!(reached.contains(&Point { x, y }), "bank point ({x}, {y}) disconnected");
        }
    }
}

#[test]
fn a_street_stopping_beside_a_bridge_is_carried_to_its_abutment() {
    // The 01-l north tributary: the lattice street stops 8 m short of the
    // bridge's south abutment; a street on the far bank stays there.
    let (n, width) = (64, 640.0);
    let height = vec![10.0_f32; n * n];
    let water = vec![0_u8; n * n];
    let surface = crate::urban::Surface {
        geometry: None,
        width,
        n,
        height: &height,
        water: &water,
        interpolation: Default::default(),
    };
    let mut streets = vec![
        street(&[(300.0, 300.0), (300.0, 330.0)], "bridge"),
        street(&[(200.0, 200.0), (295.0, 294.0)], "street"),
        street(&[(300.0, 330.0), (300.0, 420.0)], "street"),
        // Nearer the far abutment than the near one: never pulled across.
        street(&[(380.0, 335.0), (306.0, 334.0)], "street"),
    ];
    join_crossings(&mut streets, surface, 0.12, 40.0);
    assert_eq!(
        key(*streets[1].path.last().unwrap()),
        key(Point { x: 300.0, y: 300.0 })
    );
    assert_ne!(
        key(*streets[3].path.last().unwrap()),
        key(Point { x: 300.0, y: 300.0 })
    );
    let graph = Graph::new(&streets);
    assert_eq!(graph.degree(Point { x: 300.0, y: 300.0 }), 2);
}

/// Invariant: two streets ending face to face across a brook get one
/// footbridge; a pair 20 m from it shares that crossing, and ends that
/// do not head for each other stay dead ends.
#[test]
fn facing_dead_ends_across_a_brook_get_one_footbridge() {
    let (n, width) = (64, 640.0);
    let height = vec![10.0_f32; n * n];
    // A 10 m brook: x in [300, 310).
    let water: Vec<u8> = (0..n * n).map(|i| if i % n == 30 { 3 } else { 0 }).collect();
    let surface = crate::urban::Surface {
        geometry: None,
        width,
        n,
        height: &height,
        water: &water,
        interpolation: Default::default(),
    };
    let mut streets = vec![
        street(&[(250.0, 300.0), (298.0, 300.0)], "street"),
        street(&[(360.0, 300.0), (313.0, 300.0)], "street"),
        street(&[(250.0, 320.0), (298.0, 320.0)], "street"),
        street(&[(360.0, 320.0), (313.0, 320.0)], "street"),
        street(&[(250.0, 400.0), (298.0, 400.0)], "street"),
        street(&[(313.0, 450.0), (313.0, 402.0)], "street"),
    ];
    join_crossings(&mut streets, surface, 0.12, 40.0);
    let bridges: Vec<_> = streets.iter().filter(|s| s.role == "bridge").collect();
    assert_eq!(bridges.len(), 1, "{bridges:?}");
    assert!(distance(bridges[0].path[0], Point { x: 298.0, y: 300.0 }) < 0.01);
    assert!(distance(*bridges[0].path.last().unwrap(), Point { x: 313.0, y: 300.0 }) < 0.01);
}

#[test]
fn final_streets_stop_at_the_bank_or_cross_on_a_deck() {
    // Sea east of x = 300; a 12.5 m channel along y in [187.5, 200) west of it.
    let h = vec![20.0; 64 * 64];
    let mut water = vec![0; h.len()];
    for j in 0..64 {
        for i in 0..64 {
            if i >= 48 { water[j * 64 + i] = 1; } else if j == 30 || j == 31 { water[j * 64 + i] = 3; }
        }
    }
    let surface = crate::urban::Surface { geometry: None, width: 400.0, n: 64, height: &h, water: &water, interpolation: Default::default() };
    let mut streets = vec![
        street(&[(100.0, 100.0), (350.0, 100.0)], "street"),
        street(&[(100.0, 100.0), (100.0, 300.0)], "street"),
        street(&[(280.0, 150.0), (320.0, 150.0)], "quay"),
    ];
    let quay = streets[2].path.clone();
    let first = dry_streets(&mut streets, "european-organic", 2500, surface, None, 0.12).expect("wet streets are settled");
    assert_eq!(first, vec![Some(0), Some(1), Some(4)]);
    assert_eq!(streets.len(), 5);
    // The street running into the sea stops short of the bank; its junction end is exact.
    let sea = &streets[0];
    assert_eq!((sea.role.as_str(), sea.path[0]), ("street", Point { x: 100.0, y: 100.0 }));
    let end = sea.path.last().unwrap().x;
    assert!(end > 290.0 && end <= 297.5, "sea street ends at x = {end}");
    // The street crossing the channel keeps its line: dry street, deck, dry street.
    assert_eq!(streets[1..4].iter().map(|s| s.role.as_str()).collect::<Vec<_>>(), ["street", "bridge", "street"]);
    let deck = &streets[2];
    assert!(deck.path[0].y < 187.5 && deck.path[1].y > 200.0 && !surface.wet(deck.path[0]) && !surface.wet(deck.path[1]));
    assert_eq!(streets[1].path.last(), Some(&deck.path[0]));
    assert_eq!(streets[3].path[0], deck.path[1]);
    // No earth street holds a wet metre, widths follow paths, and the quay stays as it was.
    for s in streets.iter().filter(|s| !WATER_ROLES.contains(&s.role.as_str())) {
        assert_eq!(s.widths.len(), s.path.len());
        assert!(s.path.windows(2).all(|w| crate::urban::routing::water_intervals(surface, w[0], w[1]).is_empty()), "wet {} street", s.role);
    }
    assert_eq!((streets[4].role.as_str(), &streets[4].path), ("quay", &quay));
    // A second pass has nothing left to settle.
    assert!(dry_streets(&mut streets, "european-organic", 2500, surface, None, 0.12).is_none());
}

/// Invariant (a town deck spans running water only): two streets crossing
/// a lake between built shores stop at its banks, with no deck or wet metre
/// over the lake; the same water coded as a river gets its bridges, each
/// short across the channel.
#[test]
fn a_lake_between_built_shores_gets_no_deck_and_a_river_keeps_its_bridge() {
    let h = vec![20.0; 64 * 64];
    // A 25 m water body along y in [187.5, 212.5): regional code 2 = lake, 3 = river.
    let run = |code: u8| -> (Vec<f64>, bool) {
        let water: Vec<u8> = (0..64 * 64).map(|i| if (30..34).contains(&(i / 64)) { code } else { 0 }).collect();
        let surface = crate::urban::Surface { geometry: None, width: 400.0, n: 64, height: &h, water: &water, interpolation: Default::default() };
        let mut streets = vec![
            street(&[(100.0, 100.0), (100.0, 300.0)], "street"),
            street(&[(250.0, 100.0), (250.0, 300.0)], "street"),
            street(&[(60.0, 140.0), (340.0, 140.0)], "street"),
            street(&[(60.0, 260.0), (340.0, 260.0)], "street"),
        ];
        bridge_water(&mut streets, surface, 0.12);
        let decks = streets.iter().filter(|s| matches!(s.role.as_str(), "bridge" | "causeway"))
            .map(|s| distance(s.path[0], *s.path.last().unwrap())).collect();
        let wet_earth = streets.iter().filter(|s| !matches!(s.role.as_str(), "bridge" | "causeway")).any(|s|
            s.path.windows(2).any(|w| !crate::urban::routing::water_intervals(surface, w[0], w[1]).is_empty()));
        (decks, wet_earth)
    };
    let (decks, wet) = run(2);
    assert!(decks.is_empty() && !wet, "lake: decks {decks:?}, wet street {wet}");
    let (decks, wet) = run(3);
    assert!(!decks.is_empty() && !wet, "river: decks {decks:?}, wet street {wet}");
    assert!(decks.iter().all(|&l| l <= 2.5 * 25.0 + 2.0 * 20.0), "river decks {decks:?}");
}
