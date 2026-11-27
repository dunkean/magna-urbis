//! Gate selection, diversions and closed crossings.

use crate::urban::{Enclosure, Layout, Point, Shape, Street, Surface, composition, geometry as g};
use super::super::dead_gates::drop_dead_gates;
use super::{Circuit, STRAIGHT, cumulated, decide, decide_reached, divert, gate_budget, reach_through, round_outside, segment_of, throat};
use super::super::geometry::{closed, cross, dir, dist, dot, normals, pt};

/// Walls review 17/11: the gate budget follows the population (2-4 under 5 000, 5 at 10 000,
/// 6-8 for large cities) and keeps two for a castle.
#[test]
fn walls17_gate_budget_follows_population() {
    assert_eq!([2_000, 5_000, 10_000, 20_000, 40_000, 200_000].map(|p| gate_budget(p, "")), [3, 4, 5, 6, 7, 8]);
    assert_eq!(gate_budget(50_000, "castle"), 2);
}

/// Walls review 17/11: a gate must lead somewhere. A street leaving through a gate and ending 20 m
/// outside closes its gate and ends at the wall; one going on into the country keeps its gate.
#[test]
fn walls17_a_gate_leading_nowhere_closes() {
    let path = closed(&g::rectangle(600.0, 600.0, 1400.0, 1400.0).outer);
    let street = |a: (f64, f64), b: (f64, f64)| Street { path: vec![pt(a.0, a.1), pt(b.0, b.1)], widths: vec![6.0; 2], rank: 1, role: "street".into() };
    let e = Enclosure { path, kind: "wall".into(), style: "curtain".into(), curtain_width_m: 3.0, gates: vec![pt(1000.0, 600.0), pt(1000.0, 1400.0)], ..Default::default() };
    let mut layout = Layout {
        config: None, programme: None, key: "gates".into(), culture: "european-organic".into(), center: pt(1000.0, 1000.0),
        quarters: vec![], streets: vec![street((1000.0, 1000.0), (1000.0, 580.0)), street((1000.0, 1000.0), (1000.0, 1900.0))],
        blocks: vec![], warnings: vec![], enclosures: vec![e], phases: vec![], archetype: String::new(), structure: None, claim: Default::default(),
    };
    drop_dead_gates(&mut layout);
    let e = &layout.enclosures[0];
    assert_eq!(e.gates.len(), 1, "the blind gate stays open");
    assert!(dist(e.gates[0], pt(1000.0, 1400.0)) < 1.0);
    let north = layout.streets.iter().flat_map(|s| s.path.iter()).map(|p| p.y).fold(f64::INFINITY, f64::min);
    assert!(north > 600.0, "the street still runs past the wall ({north:.0})");
    assert!(layout.streets.iter().any(|s| s.path.iter().any(|p| p.y > 1800.0)), "the road into the country was cut");
}

/// A closed gate leaves no trace: its gatehouse masses leave the reserve and the slot its street cut
/// through the curtain body is the curtain's again.
#[test]
fn a_closed_gate_leaves_a_whole_curtain() {
    use crate::urban::Gatehouse;
    let path = closed(&g::rectangle(600.0, 600.0, 1400.0, 1400.0).outer);
    let masses = vec![g::rectangle(990.0, 594.0, 996.5, 612.0), g::rectangle(1003.5, 594.0, 1010.0, 612.0)];
    let gatehouse = Gatehouse { gate: 0, kind: "tower".into(), shape: g::rectangle(990.0, 594.0, 1010.0, 612.0), masses: masses.clone(), passage: [pt(1000.0, 612.0), pt(1000.0, 594.0)], passage_width_m: 7.0, height_m: 10.0 };
    let e = Enclosure { path, kind: "wall".into(), style: "curtain".into(), curtain_width_m: 3.0, gates: vec![pt(1000.0, 600.0)], gatehouses: vec![gatehouse], reserve: masses, ..Default::default() };
    let street = Street { path: vec![pt(1000.0, 1000.0), pt(1000.0, 580.0)], widths: vec![6.0; 2], rank: 1, role: "street".into() };
    let mut layout = Layout {
        config: None, programme: None, key: "gates".into(), culture: "european-organic".into(), center: pt(1000.0, 1000.0),
        quarters: vec![], streets: vec![street], blocks: vec![], warnings: vec![], enclosures: vec![e], phases: vec![], archetype: String::new(), structure: None, claim: Default::default(),
    };
    drop_dead_gates(&mut layout);
    let e = &layout.enclosures[0];
    assert!(e.gates.is_empty() && e.gatehouses.is_empty());
    let held = |p: Point| e.reserve.iter().any(|s| g::contains(s, p));
    assert!(held(pt(1000.0, 600.0)), "the street slot in the curtain is filled");
    assert!(!held(pt(993.0, 608.0)), "the gatehouse mass is released");
}

/// Walls review 17/11: an extra-mural road runs outside the curtain, the short way round.
#[test]
fn walls17_connector_goes_round_outside() {
    let path = closed(&g::rectangle(0.0, 0.0, 400.0, 400.0).outer);
    let cum = cumulated(&path);
    let ns = normals(&path);
    let road = round_outside(&path, &cum, &ns, 100.0, 300.0, 20.0).expect("a connector");
    let ring = g::normalized(Shape { outer: path[..4].to_vec(), holes: vec![] });
    assert!(road.iter().all(|&p| !g::contains(&ring, p)), "a connector inside the wall");
    let length: f64 = road.windows(2).map(|w| dist(w[0], w[1])).sum();
    assert!(length < 300.0, "the long way round: {length:.0} m");
    assert!(round_outside(&path, &cum, &ns, 0.0, 800.0, 20.0).is_none(), "half the circuit is no connector");
}

static FLAT: [f32; 256] = [0.0; 256];
static DRY: [u8; 256] = [0; 256];
fn flat() -> Surface<'static> {
    Surface { geometry: None, width: 2048.0, n: 16, height: &FLAT, water: &DRY, interpolation: Default::default() }
}
fn road(points: &[(f64, f64)], rank: usize, role: &str) -> Street {
    Street { path: points.iter().map(|&(x, y)| pt(x, y)).collect(), widths: vec![6.0; points.len()], rank, role: role.into() }
}
fn circuit(squared: bool, improvisation: f64) -> Circuit<'static> {
    Circuit { pop: 10_000, gates: None, purpose: "", kind: "wall", curtain_width: 3.0, moat: 0.0, grade: 0.12, squared, streets_turn: true, key: "gates", improvisation }
}
/// The town of the tests: a square circuit of 800 m centred on (1000, 1000).
fn town() -> Shape {
    g::rectangle(600.0, 600.0, 1400.0, 1400.0)
}
fn crossing_points(wall: &Shape, streets: &[Street]) -> Vec<Point> {
    composition::gates(&closed(&wall.outer), streets)
}

/// The budget binds whatever the role: of six main roads into a town of 10 000 (five gates), the
/// regional road and the bridge ramp of a street keep a gate and one main street is shut out; the
/// ramp of a lane counts as a lane; every crossing without a gate ends at the wall on both sides.
#[test]
fn gates_are_kept_by_the_budget_and_the_other_crossings_close() {
    let mut streets = vec![
        road(&[(650.0, 1000.0), (650.0, 300.0)], 1, "street"),
        road(&[(1000.0, 1000.0), (1000.0, 300.0)], 2, "regional"),
        road(&[(1350.0, 1000.0), (1350.0, 300.0)], 1, "street"),
        road(&[(1000.0, 800.0), (1700.0, 800.0)], 1, "street"),
        road(&[(1000.0, 1200.0), (1700.0, 1200.0)], 1, "street"),
        road(&[(1000.0, 1000.0), (1000.0, 1700.0)], 2, "approach"),
        road(&[(1000.0, 900.0), (300.0, 900.0)], 3, "lane"),
        road(&[(1000.0, 1100.0), (300.0, 1100.0)], 3, "approach"),
    ];
    streets[5].widths = vec![8.0; 2];
    let (wall, kept, shut) = decide(&town(), &mut streets, &circuit(false, 0.0), flat());
    assert_eq!(wall.outer, town().outer, "a circuit that is not squared moved");
    assert_eq!(kept.iter().filter(|p| p.priority >= 2).count(), 5, "{kept:?}");
    assert!(kept.iter().any(|p| p.priority == 3 && dist(p.at, pt(1000.0, 600.0)) < 1.0), "the regional road lost its gate");
    assert!(kept.iter().any(|p| dist(p.at, pt(1000.0, 1400.0)) < 1.0), "the ramp of a street is no main road");
    assert_eq!(kept.iter().filter(|p| p.priority < 2).count(), 2, "the two lesser streets are posterns");
    assert_eq!(shut.len(), 1, "main roads shut out: {shut:?}");
    let gates = crossing_points(&wall, &streets);
    assert_eq!(gates.len(), kept.len(), "a street still crosses away from a gate: {gates:?}");
    for a in &kept {
        for b in &kept {
            assert!(std::ptr::eq(a, b) || dist(a.at, b.at) >= 40.0, "gates {:?} and {:?} are too close", a.at, b.at);
        }
    }
}

/// Two main roads through one stretch of wall keep one gate: the road shut out within `GATE_GAP` of
/// the kept gate keeps no gate of its own, even with no way round (here it runs into a street inside
/// the reach of the moat). Medina 10k: two gates 22 m apart.
#[test]
fn a_main_road_with_no_way_round_keeps_no_gate_beside_another() {
    let mut streets = vec![
        road(&[(1000.0, 1000.0), (1000.0, 200.0)], 1, "regional"),
        road(&[(1000.0, 1000.0), (1024.0, 590.0)], 2, "regional"),
        road(&[(1024.0, 590.0), (1300.0, 590.0)], 2, "street"),
    ];
    streets[0].widths = vec![8.0; 2];
    let (wall, kept, shut) = decide(&town(), &mut streets, &circuit(false, 0.0), flat());
    assert_eq!((kept.len(), shut.len()), (1, 1), "{kept:?}");
    assert!(dist(kept[0].at, pt(1000.0, 600.0)) < 1.0, "{kept:?}");
    assert_eq!(crossing_points(&wall, &streets).len(), 1, "the shut road still crosses the wall");
}

#[test]
fn a_shore_opening_keeps_its_access_and_a_cut_ramp_keeps_its_deck_end() {
    let water: Vec<u8> = (0..256).map(|i| u8::from(i % 16 == 8)).collect();
    let surface = Surface { water: &water, ..flat() };
    let bank = (1020.0, 550.0);
    let access = road(&[bank, (1020.0, 750.0)], 2, "street");
    let mut streets = vec![
        road(&[(950.0, 500.0), (950.0, 750.0)], 1, "regional"),
        access.clone(),
        road(&[bank, (930.0, 750.0)], 3, "approach"),
        road(&[bank, (1156.0, 550.0)], 3, "bridge"),
    ];
    let (_, gates, _) = decide(&town(), &mut streets, &circuit(false, 0.0), surface);
    assert_eq!(gates.len(), 1);
    assert!(streets.iter().any(|s| s.path == access.path));
    let mut ramps = streets.iter().filter(|s| s.role == "approach");
    assert_eq!(ramps.next().unwrap().path[0], pt(bank.0, bank.1));
    assert!(ramps.next().is_none());
    assert!(streets.iter().any(|s| s.role == "lane" && s.path.last() == Some(&pt(930.0, 750.0))));
}

/// Walls and moats first (Chinese 10k, review 27/11): a main road that stops 20 m short of the curtain
/// runs on through it before the gates are decided, out beyond the moat, and gets its gate; a lane
/// stopping short keeps its end.
#[test]
fn a_main_road_short_of_the_wall_reaches_through_and_gets_its_gate() {
    let mut streets = vec![road(&[(1000.0, 1000.0), (1000.0, 620.0)], 1, "regional"), road(&[(1000.0, 1000.0), (1380.0, 1000.0)], 3, "lane")];
    let reached = reach_through(&town(), &mut streets, 60.0, &[], &[], None, flat());
    let (wall, kept, shut) = decide_reached(&town(), &mut streets, &circuit(false, 0.0), &reached, flat());
    assert!(kept.len() == 1 && shut.is_empty() && dist(kept[0].at, pt(1000.0, 600.0)) < 1.0, "{kept:?}");
    let end = *streets[0].path.last().unwrap();
    assert!(dist(end, pt(1000.0, 540.0)) < 1e-6, "the road ends at {end:?}, not 60 m beyond the wall");
    assert_eq!(streets[0].widths.len(), streets[0].path.len());
    assert_eq!(crossing_points(&wall, &streets).len(), 1);
    assert!(streets[1].path.last() == Some(&pt(1380.0, 1000.0)), "a lane reached through");
}

#[test]
fn a_regional_road_clipped_on_the_wall_goes_round_to_the_existing_gate() {
    let mut streets = vec![road(&[(1000.0, 1000.0), (1000.0, 200.0)], 1, "regional"),
        road(&[(940.0, 1000.0), (940.0, 600.000001)], 1, "regional")];
    let outside = road(&[(940.0, 1000.0), (940.0, 600.0), (940.0, 200.0)], 1, "regional");
    let reached = reach_through(&town(), &mut streets, 70.0, &[], &[outside], None, flat());
    let (wall, kept, shut) = decide_reached(&town(), &mut streets, &circuit(false, 0.0), &reached, flat());
    assert_eq!((kept.len(), shut.len()), (1, 1));
    assert!(dist(kept[0].at, pt(1000.0, 600.0)) < 1.0);
    let e = Enclosure { path: closed(&wall.outer), curtain_width_m: 3.0, gates: vec![kept[0].at], ..Default::default() };
    divert(&e, &kept, &shut, &mut streets, flat(), 0.12, &[]);
    let join = streets.iter().find(|s| s.role == "approach").unwrap();
    assert!(join.path.iter().all(|p| p.y < 600.0));
    assert!(streets[0].path.contains(join.path.last().unwrap()));
}

#[test]
fn a_requested_postern_can_use_a_lesser_street_short_of_the_wall() {
    let mut streets = vec![road(&[(1000.0, 1000.0), (1000.0, 300.0)], 1, "regional"),
        road(&[(1200.0, 1000.0), (1200.0, 620.0)], 2, "street")];
    let c = Circuit { gates: Some(2), ..circuit(false, 0.0) };
    let reached = reach_through(&town(), &mut streets, 75.0, &[], &[], c.gates, flat());
    let (_, kept, _) = decide_reached(&town(), &mut streets, &c, &reached, flat());
    assert_eq!(kept.len(), 2);
    assert!(kept.iter().any(|p| dist(p.at, pt(1200.0, 600.0)) < 1.0));
}

#[test]
fn a_rebuilt_front_keeps_its_one_sided_regional_gate() {
    let gate = pt(900.0, 600.0);
    let mut streets = vec![road(&[(900.0, 300.0), (900.0, 600.0)], 1, "regional")];
    let before = streets[0].path.clone();
    let c = Circuit { streets_turn: false, ..circuit(false, 0.0) };
    let (_, kept, _) = super::decide_with_gates(&town(), &mut streets, &c, &[gate], &[], flat());
    assert_eq!(kept.len(), 1);
    assert!(dist(kept[0].at, gate) < 0.01);
    assert_eq!(streets[0].path, before);
}

/// Sharpest turn (degrees) of the closed `path` within `STRAIGHT` m of `gate`, along it.
fn sharpest(path: &[Point], gate: Point) -> f64 {
    let n = path.len() - 1;
    let cum = cumulated(path);
    let s = { let k = segment_of(path, gate); cum[k] + dist(path[k], gate) };
    (0..n)
        .filter(|&j| { let d = (cum[j] - s).rem_euclid(cum[n]); d.min(cum[n] - d) < STRAIGHT })
        .map(|j| { let (u, v) = (dir(path[(j + n - 1) % n], path[j]), dir(path[j], path[j + 1])); cross(u, v).atan2(dot(u, v)).abs().to_degrees() })
        .fold(0.0, f64::max)
}

/// At a kept passage the curtain keeps its trace and the street turns square to it over its last
/// metres; its far ends keep their place. With every tidying left as drawn (`improvisation` 1) the
/// street keeps its line. A street 50° off square folded its curtain (review 25/11).
#[test]
fn gates_stand_square_to_their_street_and_never_fold_their_curtain() {
    for (skew, most) in [([(800.0, 1000.0), (1200.0, 300.0)], 1.0), ([(762.0, 800.0), (1238.0, 400.0)], 15.5)] {
        let drawn = || vec![road(&skew, 1, "street"), road(&[(1000.0, 1000.0), (1700.0, 1000.0)], 1, "street")];
        let mut streets = drawn();
        let (wall, kept, _) = decide(&town(), &mut streets, &circuit(true, 0.0), flat());
        assert_eq!(wall.outer, town().outer, "the curtain left its trace");
        let before = drawn();
        assert!(streets[0].path.len() > 2 && streets[0].path.first() == before[0].path.first() && streets[0].path.last() == before[0].path.last(), "the ends moved");
        assert_eq!(streets[0].widths.len(), streets[0].path.len());
        let path = closed(&wall.outer);
        assert_eq!(kept.len(), 2);
        for p in &kept {
            let k = segment_of(&path, p.at);
            let s = streets.iter().find(|s| s.path.windows(2).any(|w| g::distance(p.at, w[0], w[1]).0 < 0.1)).expect("no street at the gate");
            let w = s.path.windows(2).find(|w| g::distance(p.at, w[0], w[1]).0 < 0.1).unwrap();
            let off = cross(dir(w[0], w[1]), dir(path[k], path[k + 1])).abs().acos().to_degrees();
            assert!(off < most, "the street at {:?} is {off:.0}° off square", p.at);
            assert!(sharpest(&path, p.at) <= 60.0);
        }
        assert_eq!(crossing_points(&wall, &streets).len(), kept.len(), "the street crosses the wall once");
        let mut streets = drawn();
        let (wall, _, _) = decide(&town(), &mut streets, &circuit(true, 1.0), flat());
        assert!(wall.outer == town().outer && streets.iter().map(|s| &s.path).eq(drawn().iter().map(|s| &s.path)), "a gate left as drawn moved");
    }
}

/// A gate by a corner of the town: across a corner that juts out it stands on a straight front, by an
/// inward corner it moves to a straight stretch its street can follow. No corner within 25 m of the
/// gate is sharper than 120°. In a village the street keeps its line all the same.
#[test]
fn a_gate_by_a_corner_stands_on_a_front_across_it_or_leaves_it() {
    let inward = Shape { outer: [(600.0, 600.0), (1000.0, 600.0), (1000.0, 1000.0), (1400.0, 1000.0), (1400.0, 1400.0), (600.0, 1400.0)].map(|(x, y)| pt(x, y)).to_vec(), holes: vec![] };
    let outward = [(1003.0, 1000.0), (1803.0, 200.0)];
    // (trace, street, population, streets may turn, the curtain is cut, the street turns)
    let cases = [
        (town(), outward, 10_000, true, true, false),
        (town(), outward, 10_000, false, true, false),
        (town(), outward, 500, true, true, false),
        (inward.clone(), [(700.0, 985.0), (1300.0, 985.0)], 10_000, true, false, true),
        (inward, [(700.0, 985.0), (1300.0, 985.0)], 10_000, false, true, false),
    ];
    for (i, (trace, street, pop, streets_turn, cut, turned)) in cases.into_iter().enumerate() {
        let mut streets = vec![road(&street, 1, "street")];
        let (wall, kept, _) = decide(&trace, &mut streets, &Circuit { pop, streets_turn, ..circuit(true, 0.0) }, flat());
        assert_eq!(kept.len(), 1, "case {i}");
        assert!(g::simple(&wall), "case {i}");
        let path = closed(&wall.outer);
        let turn = sharpest(&path, kept[0].at);
        assert!(turn <= 60.0, "case {i}: a corner of {turn:.0}° by the gate {:?}", kept[0].at);
        assert!(!path.iter().any(|&q| dist(q, kept[0].at) < 10.0), "case {i}: no room for the gatehouse");
        assert_eq!((wall.outer != trace.outer, streets[0].path.len() > 2), (cut, turned), "case {i}");
        let gates = crossing_points(&wall, &streets);
        assert!(gates.len() == 1 && dist(gates[0], kept[0].at) < 1.0, "case {i}: {gates:?}");
    }
}

/// A line that is not to be touched (a planned rectangle) keeps its corner: the gate moves along it.
#[test]
fn a_gate_by_the_corner_of_a_planned_rectangle_moves_along_it() {
    let mut streets = vec![road(&[(1000.0, 790.0), (1390.0, 790.0), (1390.0, 300.0)], 1, "street")];
    let (wall, kept, _) = decide(&town(), &mut streets, &circuit(false, 0.0), flat());
    assert_eq!(wall.outer, town().outer, "a planned rectangle moved");
    assert!(kept.len() == 1 && sharpest(&closed(&wall.outer), kept[0].at) <= 60.0, "{kept:?}");
    let gates = crossing_points(&wall, &streets);
    assert!(gates.len() == 1 && dist(gates[0], kept[0].at) < 1.0, "{gates:?}");
}

/// A main road shut out by the budget goes round outside to the nearest kept gate: a through road
/// with a real vertex at each end, the far one on the gate road beyond the gate throat, as wide as
/// the road it carries and of a role no trim prunes. A road the outside streets already lead to the
/// gate gets none.
#[test]
fn a_main_road_shut_out_is_diverted_to_a_kept_gate() {
    let streets = || vec![road(&[(1000.0, 1000.0), (1000.0, 200.0)], 2, "regional"), road(&[(940.0, 1000.0), (940.0, 200.0)], 1, "street")];
    let mut laid = streets();
    let (wall, kept, shut) = decide(&town(), &mut laid, &circuit(false, 0.0), flat());
    assert_eq!((kept.len(), shut.len()), (1, 1));
    let e = Enclosure { path: closed(&wall.outer), kind: "wall".into(), style: "curtain".into(), curtain_width_m: 3.0, gates: vec![kept[0].at], ..Default::default() };
    divert(&e, &kept, &shut, &mut laid, flat(), 0.12, &[]);
    let diversion = laid.iter().find(|s| s.role == "approach").expect("no diversion");
    let (a, b) = (diversion.path[0], diversion.path[diversion.path.len() - 1]);
    let vertex = |p: Point| laid.iter().filter(|s| !std::ptr::eq(*s, diversion)).any(|s| s.path.iter().any(|&q| dist(p, q) < 1e-6));
    assert!(vertex(a) && vertex(b), "a loose diversion end: {a:?} {b:?}");
    assert!((b.x - 1000.0).abs() < 1e-6 && 600.0 - b.y >= throat(6.0), "joined off the gate road or inside its throat: {b:?}");
    assert!(diversion.path.iter().all(|p| p.y < 600.0), "a diversion inside the wall");
    assert!(diversion.widths.iter().all(|&w| w >= 6.0) && diversion.rank == 1);
    let outer = laid.iter().find(|s| s.role == "street" && s.path.iter().all(|p| p.y < 600.0)).expect("the road outside");
    assert!(outer.path.iter().any(|&q| dist(q, a) < 1e-6) && outer.path.iter().all(|p| p.y <= a.y + 1e-6), "the shut-out road still runs on to the wall");
    // Joined outside already (a street between the two roads, 40 m out): no diversion.
    let mut laid = streets();
    laid.push(road(&[(940.0, 560.0), (1000.0, 560.0)], 2, "street"));
    let (_, kept, shut) = decide(&town(), &mut laid, &circuit(false, 0.0), flat());
    divert(&e, &kept, &shut, &mut laid, flat(), 0.12, &[]);
    assert!(laid.iter().all(|s| s.role != "approach"), "a redundant diversion");
}
