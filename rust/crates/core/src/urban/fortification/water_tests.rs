//! The wall and water invariant on a river, a wide river, a shore with a quay and an inlet.

use crate::rng::Rng;
use crate::urban::{Enclosure, LayoutConfig, Point, Shape, Surface, composition, geometry as g};
use super::super::build::build;
use super::super::geometry::{closed, pt};
use super::super::style::styled;
use super::super::test_fixtures::{N, W, predicted, river, surface};
use super::{STEP, WATER_GATE_SPAN, WaterAudit, audit, kept_fronts, water_fronts, wet_runs};

const FACE: f64 = 1.5;

fn town() -> Shape {
    g::rectangle(600.0, 600.0, 1400.0, 1400.0)
}

fn no_harbour() -> Vec<Shape> {
    vec![]
}

/// Every vertex of `ring` stands at least 4 m from the water.
fn stands_back(ring: &Shape, surface: Surface<'_>) -> bool {
    ring.outer.iter().all(|&p| [(4.0, 0.0), (-4.0, 0.0), (0.0, 4.0), (0.0, -4.0)].iter().all(|&(dx, dy)| !surface.wet(pt(p.x + dx, p.y + dy))))
}

fn built(ring: &[Point], surface: Surface<'_>, key: &str) -> Enclosure {
    let path = closed(ring);
    let banks = composition::water_gates(&path, surface);
    let mut e = Enclosure { path, kind: "wall".into(), ..Default::default() };
    let mut style = styled("curtain", "european-organic", 10_000);
    style.options(&LayoutConfig::default());
    build(&mut e, 0, &banks, &[], surface, &style, 10_000, &predicted(), &Rng::new(key));
    e
}

#[test]
fn a_narrow_river_is_crossed_on_two_water_gates_and_nowhere_else() {
    let (height, water) = (vec![10.0f32; N * N], river(1000.0, 1024.0));
    let s = surface(&height, &water);
    let banks = [g::rectangle(600.0, 600.0, 990.0, 1400.0), g::rectangle(1034.0, 600.0, 1400.0, 1400.0)];
    let rings = water_fronts(vec![town()], &banks, &no_harbour(), s, FACE);
    assert_eq!(rings.len(), 1, "one circuit round both banks");
    let runs = wet_runs(&closed(&rings[0].outer), s);
    assert_eq!(runs.len(), 2, "one crossing upstream, one downstream: {runs:?}");
    assert!(runs.iter().all(|run| run.length <= WATER_GATE_SPAN + STEP));
    let e = built(&rings[0].outer, s, "water-narrow");
    assert_eq!(e.gatehouses.iter().filter(|gh| gh.kind == "water").count(), 2);
    assert!(e.gatehouses.iter().all(|gh| gh.kind != "shore"));
    let found = audit(&e, &[], s);
    assert_eq!((found.gaps, found.wet_m), (0, 0.0), "{found:?}");
    // Its gates placed, the circuit is left alone by every later application of the rule.
    assert_eq!(kept_fronts(rings.clone(), &banks, &no_harbour(), s, FACE), rings);
}

#[test]
fn a_wide_river_leaves_each_bank_its_own_closed_dry_ring() {
    let (height, water) = (vec![10.0f32; N * N], river(1000.0, 1080.0));
    let s = surface(&height, &water);
    let banks = [g::rectangle(600.0, 600.0, 990.0, 1400.0), g::rectangle(1090.0, 600.0, 1400.0, 1400.0)];
    let rings = water_fronts(vec![town()], &banks, &no_harbour(), s, FACE);
    assert_eq!(rings.len(), 2, "one circuit per bank");
    for ring in &rings {
        assert!(wet_runs(&closed(&ring.outer), s).is_empty());
        assert!(stands_back(ring, s));
        let e = built(&ring.outer, s, "water-wide");
        assert_eq!(audit(&e, &[], s), WaterAudit::default());
    }
    // A trace left across the wide river opens no front: the curtain stays whole and the audit reports it.
    let across = built(&town().outer, s, "water-across");
    assert!(across.gatehouses.is_empty());
    let found = audit(&across, &[], s);
    assert!(found.gaps == 0 && found.wet_m > 150.0, "{found:?}");
}

#[test]
fn a_shore_gets_a_curtain_on_land_behind_the_quay() {
    let height = vec![10.0f32; N * N];
    let cell = W / N as f64;
    let water: Vec<u8> = (0..N * N).map(|i| u8::from((i / N) as f64 * cell >= 1200.0)).collect();
    let s = surface(&height, &water);
    let harbour = g::ribbon(&[pt(800.0, 1196.0), pt(1200.0, 1196.0)], &[36.0, 36.0]);
    let rings = water_fronts(vec![g::rectangle(600.0, 600.0, 1400.0, 1260.0)], &[g::rectangle(600.0, 600.0, 1400.0, 1190.0)], &harbour, s, FACE);
    assert_eq!(rings.len(), 1);
    let ring = &rings[0];
    assert!(wet_runs(&closed(&ring.outer), s).is_empty());
    assert!(stands_back(ring, s));
    // Along the open shore the curtain leaves the beach bare; at the harbour it passes behind the service strip.
    assert!(g::contains(ring, pt(700.0, 1170.0)) && !g::contains(ring, pt(700.0, 1180.0)));
    assert!(g::contains(ring, pt(1000.0, 1170.0)) && !g::contains(ring, pt(1000.0, 1185.0)));
    assert_eq!(kept_fronts(rings.clone(), &rings, &harbour, s, FACE), rings, "a ring behind its beach is left as it is");
    let e = built(&ring.outer, s, "water-shore");
    assert_eq!(audit(&e, &[], s), WaterAudit::default());
}

#[test]
fn an_inlet_is_closed_by_one_water_gate() {
    let height = vec![10.0f32; N * N];
    let cell = W / N as f64;
    let water: Vec<u8> = (0..N * N)
        .map(|i| {
            let (x, y) = (((i % N) as f64 + 0.5) * cell, ((i / N) as f64 + 0.5) * cell);
            u8::from(y >= 1400.0 || y >= 1000.0 && (1000.0..1024.0).contains(&x))
        })
        .collect();
    let s = surface(&height, &water);
    let land = g::rectangle(600.0, 600.0, 1400.0, 1390.0);
    let rings = water_fronts(vec![land.clone()], &[land], &no_harbour(), s, FACE);
    assert_eq!(rings.len(), 1);
    let runs = wet_runs(&closed(&rings[0].outer), s);
    assert_eq!(runs.len(), 1, "{runs:?}");
    assert!(runs[0].length <= WATER_GATE_SPAN + STEP);
    let e = built(&rings[0].outer, s, "water-inlet");
    assert_eq!(e.gatehouses.iter().filter(|gh| gh.kind == "water").count(), 1);
    let found = audit(&e, &[], s);
    assert_eq!((found.gaps, found.wet_m), (0, 0.0), "{found:?}");
}

/// A creek between two quarters, its outline set back from both banks, is crossed at its mouth: no
/// wall runs up one bank and down the other (review 25/11, vietnamese-citadel 10k).
#[test]
fn a_creek_is_crossed_at_its_mouth_and_its_banks_are_not_walled() {
    let height = vec![10.0f32; N * N];
    let cell = W / N as f64;
    let water: Vec<u8> = (0..N * N)
        .map(|i| {
            let (x, y) = (((i % N) as f64 + 0.5) * cell, ((i / N) as f64 + 0.5) * cell);
            u8::from(y >= 1400.0 || y >= 1000.0 && (1000.0..1008.0).contains(&x))
        })
        .collect();
    let s = surface(&height, &water);
    let land = g::normalized(Shape {
        outer: [(600.0, 600.0), (1400.0, 600.0), (1400.0, 1390.0), (1020.0, 1390.0), (1020.0, 1000.0), (988.0, 1000.0), (988.0, 1390.0), (600.0, 1390.0)].map(|(x, y)| pt(x, y)).to_vec(),
        holes: vec![],
    });
    let rings = water_fronts(vec![land.clone()], &[land], &no_harbour(), s, FACE);
    assert_eq!(rings.len(), 1);
    let path = closed(&rings[0].outer);
    let around: f64 = path.windows(2).map(|w| super::dist(w[0], w[1])).sum();
    assert!(around < 3_250.0, "no wall up the creek: {around:.0} m");
    let runs = wet_runs(&path, s);
    assert_eq!(runs.len(), 1, "{runs:?}");
    assert!(runs[0].length <= WATER_GATE_SPAN + STEP);
    let e = built(&rings[0].outer, s, "water-creek");
    assert_eq!(e.gatehouses.iter().filter(|gh| gh.kind == "water").count(), 1);
    let found = audit(&e, &[], s);
    assert_eq!((found.gaps, found.wet_m), (0, 0.0), "{found:?}");
    assert_eq!(kept_fronts(rings.clone(), &rings, &no_harbour(), s, FACE), rings);
}

/// A spit too narrow for two beaches keeps the plain setback; its wide foot gets the beach.
#[test]
fn a_narrow_spit_keeps_its_setback_and_the_wide_shore_its_beach() {
    let height = vec![10.0f32; N * N];
    let cell = W / N as f64;
    let water: Vec<u8> = (0..N * N)
        .map(|i| {
            let (x, y) = (((i % N) as f64 + 0.5) * cell, ((i / N) as f64 + 0.5) * cell);
            u8::from(y >= 1200.0 && !((960.0..1040.0).contains(&x) && y < 1600.0))
        })
        .collect();
    let s = surface(&height, &water);
    let land = g::union(&[g::rectangle(600.0, 600.0, 1400.0, 1200.0), g::rectangle(960.0, 1190.0, 1040.0, 1500.0)]).remove(0);
    let rings = water_fronts(vec![land.clone()], &[land], &no_harbour(), s, FACE);
    assert_eq!(rings.len(), 1);
    assert!(wet_runs(&closed(&rings[0].outer), s).is_empty() && stands_back(&rings[0], s));
    assert!(g::contains(&rings[0], pt(1000.0, 1450.0)), "the spit stays walled");
    assert!(!g::contains(&rings[0], pt(700.0, 1180.0)), "the beach of the wide shore is bare");
}

/// A ring that jogs along a bank before it crosses comes straight to the water instead: no corner by the
/// water gate is sharper than 120°, at the first trace and on a ring already placed.
#[test]
fn a_crossing_is_straight_to_its_banks() {
    let (height, water) = (vec![10.0f32; N * N], river(1000.0, 1016.0));
    let s = surface(&height, &water);
    // West of the river the north front runs 30 m lower than east of it, up to the bank.
    let jog = Shape { outer: [(600.0, 600.0), (990.0, 600.0), (990.0, 630.0), (1400.0, 630.0), (1400.0, 1400.0), (600.0, 1400.0)].map(|(x, y)| pt(x, y)).to_vec(), holes: vec![] };
    let banks = [g::rectangle(600.0, 640.0, 980.0, 1400.0), g::rectangle(1030.0, 640.0, 1400.0, 1400.0)];
    let sharp = |ring: &Shape| {
        let path = closed(&ring.outer);
        let n = path.len() - 1;
        let gates: Vec<_> = wet_runs(&path, s).iter().map(|run| run.middle).collect();
        (0..n)
            .filter(|&k| gates.iter().any(|&q| super::dist(q, path[k]) < 8.0 + 24.0))
            .map(|k| { let (u, v) = (super::dir(path[(k + n - 1) % n], path[k]), super::dir(path[k], path[k + 1])); super::cross(u, v).atan2(super::dot(u, v)).abs().to_degrees() })
            .fold(0.0, f64::max)
    };
    for rings in [water_fronts(vec![jog.clone()], &banks, &no_harbour(), s, FACE), kept_fronts(vec![jog.clone()], &banks, &no_harbour(), s, FACE)] {
        assert_eq!(rings.len(), 1);
        assert_eq!(wet_runs(&closed(&rings[0].outer), s).len(), 2);
        assert!(sharp(&jog) > 80.0 && sharp(&rings[0]) <= 60.5, "a corner of {:.0}° by a water gate", sharp(&rings[0]));
        assert_eq!(kept_fronts(rings.clone(), &banks, &no_harbour(), s, FACE), rings, "a straight crossing moved again");
    }
}

#[test]
fn a_pond_on_the_trace_is_gone_round_without_a_gate() {
    let height = vec![10.0f32; N * N];
    let cell = W / N as f64;
    let water: Vec<u8> = (0..N * N)
        .map(|i| {
            let (x, y) = (((i % N) as f64 + 0.5) * cell, ((i / N) as f64 + 0.5) * cell);
            u8::from((984.0..1008.0).contains(&x) && (1328.0..1420.0).contains(&y))
        })
        .collect();
    let s = surface(&height, &water);
    let rings = water_fronts(vec![town()], &[town()], &no_harbour(), s, FACE);
    assert_eq!(rings.len(), 1);
    assert!(wet_runs(&closed(&rings[0].outer), s).is_empty());
    assert!(stands_back(&rings[0], s));
    let e = built(&rings[0].outer, s, "water-pond");
    assert!(e.gatehouses.is_empty());
    assert_eq!(audit(&e, &[], s), WaterAudit::default());
    // The rule holds on a ring that already obeys it: nothing moves.
    assert_eq!(water_fronts(rings.clone(), &[town()], &no_harbour(), s, FACE), rings);
}
