//! Gate selection, diversions and closed crossings.

use super::*;

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
    let mut layout = super::super::super::Layout {
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
    Circuit { pop: 10_000, purpose: "", kind: "wall", curtain_width: 3.0, moat: 0.0, grade: 0.12, squared, key: "gates", improvisation }
}
/// The town of the tests: a square circuit of 800 m centred on (1000, 1000).
fn town() -> Shape {
    g::rectangle(600.0, 600.0, 1400.0, 1400.0)
}
fn crossing_points(wall: &Shape, streets: &[Street]) -> Vec<Point> {
    super::super::super::composition::gates(&closed(&wall.outer), streets)
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

/// At a kept passage the curtain turns square to its street, through the same gate point; the street
/// keeps its line. With every tidying left as drawn (`improvisation` 1) the curtain keeps its trace.
#[test]
fn gates_stand_square_to_their_street() {
    let skew = || vec![road(&[(800.0, 1000.0), (1200.0, 300.0)], 1, "street"), road(&[(1000.0, 1000.0), (1700.0, 1000.0)], 1, "street")];
    let mut streets = skew();
    let (wall, kept, _) = decide(&town(), &mut streets, &circuit(true, 0.0), flat());
    assert!(streets.iter().map(|s| &s.path).eq(skew().iter().map(|s| &s.path)), "a gate street moved");
    assert!(g::simple(&wall), "the squared circuit crosses itself");
    let path = closed(&wall.outer);
    for p in &kept {
        let k = segment_of(&path, p.at);
        assert!(g::distance(p.at, path[k], path[k + 1]).0 < 1e-6, "the curtain left the gate {:?}", p.at);
        let off = cross(p.along, dir(path[k], path[k + 1])).abs().acos().to_degrees();
        assert!(off < 1.0, "the gate at {:?} is {off:.0}° off square", p.at);
        assert!(dist(path[k], path[k + 1]) >= 2.0 * FRONT, "a gate front too short for its gatehouse");
    }
    // The east gate was square already: its front is the old curtain.
    assert!(wall.outer.iter().any(|&q| dist(q, pt(1400.0, 1400.0)) < 1e-6) && wall.outer.len() == town().outer.len() + 4);
    let (wall, _, _) = decide(&town(), &mut skew(), &circuit(true, 1.0), flat());
    assert_eq!(wall.outer, town().outer, "a gate left as drawn moved its curtain");
}

/// A main road shut out by the budget goes round outside to the nearest kept gate: a through road
/// with a real vertex at each end, the far one on the gate road beyond the gate throat, as wide as
/// the road it carries and of a role no trim prunes. A road the outside streets already lead to the
/// gate gets none.
#[test]
fn a_main_road_shut_out_is_diverted_to_a_kept_gate() {
    let streets = || vec![road(&[(1000.0, 1000.0), (1000.0, 200.0)], 2, "regional"), road(&[(900.0, 1000.0), (900.0, 200.0)], 1, "street")];
    let mut laid = streets();
    let (wall, kept, shut) = decide(&town(), &mut laid, &circuit(false, 0.0), flat());
    assert_eq!((kept.len(), shut.len()), (1, 1));
    let e = Enclosure { path: closed(&wall.outer), kind: "wall".into(), style: "curtain".into(), curtain_width_m: 3.0, gates: vec![kept[0].at], ..Default::default() };
    divert(&e, &kept, &shut, &mut laid, flat(), 0.12);
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
    laid.push(road(&[(900.0, 560.0), (1000.0, 560.0)], 2, "street"));
    let (_, kept, shut) = decide(&town(), &mut laid, &circuit(false, 0.0), flat());
    divert(&e, &kept, &shut, &mut laid, flat(), 0.12);
    assert!(laid.iter().all(|s| s.role != "approach"), "a redundant diversion");
}
