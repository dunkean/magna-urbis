//! Rock barriers, cave circuits and passages.

use crate::rng::Rng;
use crate::urban::{
    Enclosure, Geography, LayoutConfig, Shape, Street, Surface, VectorGeography,
    composition, geometry as g,
};
use super::super::build::build;
use super::cave_circuits;
use super::super::geometry::{add, closed, dir, disc, dist, pt};
use super::super::street_clearance::Predicted;
use super::super::style::styled;

const W: f64 = 2048.0;
const N: usize = 256;

fn rect(x0: f64, y0: f64, x1: f64, y1: f64) -> Shape {
    g::rectangle(x0, y0, x1, y1)
}
/// A cave: rock everywhere but a chamber (disc of 260 m round the centre) and three passages to the
/// edge of the map (east, north, south-west), 30 m wide.
fn cave() -> Geography {
    let chamber = g::normalized(disc(pt(1024.0, 1024.0), 260.0, 48, 0.0));
    let east = rect(1200.0, 1009.0, 2047.0, 1039.0);
    let north = rect(1009.0, 1.0, 1039.0, 850.0);
    let sw = g::normalized(Shape { outer: vec![pt(870.0, 1170.0), pt(1.0, 2000.0), pt(25.0, 2025.0), pt(892.0, 1192.0)], holes: vec![] });
    let floor = g::union(&[chamber, east, north, sw]);
    assert_eq!(floor.len(), 1, "one floor");
    let square = vec![pt(0.0, 0.0), pt(W, 0.0), pt(W, W), pt(0.0, W)];
    let rock = vec![square.clone(), floor[0].outer.clone()];
    Geography::with_solid(VectorGeography { land: vec![square], ..Default::default() }, rock, W).unwrap()
}
fn surface<'a>(geometry: Option<&'a Geography>, height: &'a [f32], water: &'a [u8]) -> Surface<'a> {
    Surface { geometry, width: W, n: N, height, water, interpolation: Default::default() }
}
fn road(points: &[(f64, f64)]) -> Street {
    Street { path: points.iter().map(|&(x, y)| pt(x, y)).collect(), widths: vec![6.0; points.len()], rank: 1, role: "regional".into() }
}

/// Walls review 16/11 (Underdark): a town in a chamber with three entrances is closed by three
/// barrier walls anchored on the rock, with a gate on each road entrance and no ring wall.
#[test]
fn walls16_cave_town_closes_its_three_passages() {
    let geo = cave();
    let (height, water) = (vec![10.0f32; N * N], vec![0u8; N * N]);
    let s = surface(Some(&geo), &height, &water);
    let town = g::normalized(disc(pt(1024.0, 1024.0), 200.0, 32, 0.0));
    let (circuits, cave) = cave_circuits(vec![town.clone()], s);
    assert!(cave && circuits.len() == 1, "no cave circuit");
    let path = closed(&circuits[0].outer);
    let streets = vec![road(&[(2040.0, 1024.0), (1024.0, 1024.0)]), road(&[(1024.0, 10.0), (1024.0, 1024.0)]), road(&[(13.0, 2012.0), (881.0, 1181.0), (1024.0, 1024.0)])];
    let mut gates = composition::gates(&path, &streets);
    let land = gates.len();
    assert_eq!(land, 3, "one gate per road entrance");
    let banks = composition::water_gates(&path, s);
    for &(p, _) in &banks {
        if gates.iter().all(|&q| dist(p, q) >= 8.0) {
            gates.push(p);
        }
    }
    let mut e = Enclosure { path: path.clone(), kind: "wall".into(), gates, ..Default::default() };
    let mut style = styled("flanked", "duergar-hold", 6_000);
    style.options(&LayoutConfig::default());
    style.cave = true;
    let predicted = Predicted { widths: [9.0, 8.0, 5.0, 3.5, 3.0], arterial: 1, dwelling: [5.0, 5.0] };
    build(&mut e, land, &banks, &streets, s, &style, 6_000, &predicted, &Rng::new("cave-walls"));
    // The built curtain: the dry runs of the circuit outside its rock (shore) passages.
    let dry: Vec<f64> = {
        let mut runs = vec![];
        let mut run = 0.0;
        for w in path.windows(2) {
            let k = (dist(w[0], w[1]) / 2.0).ceil().max(1.0) as usize;
            for j in 0..k {
                let p = add(w[0], dir(w[0], w[1]), dist(w[0], w[1]) * (j as f64 + 0.5) / k as f64);
                if s.wet(p) {
                    if run > 0.0 { runs.push(run); }
                    run = 0.0;
                } else {
                    run += dist(w[0], w[1]) / k as f64;
                }
            }
        }
        if run > 0.0 { runs.push(run); }
        runs
    };
    assert_eq!(dry.len(), 3, "three barriers: {dry:?}");
    assert!(dry.iter().all(|&l| l < 60.0), "a barrier wider than its passage (a ring wall?): {dry:?}");
    let gatehouses = e.gatehouses.iter().filter(|gh| !matches!(gh.kind.as_str(), "water" | "shore")).count();
    assert_eq!(gatehouses, 3, "a gatehouse on each road entrance");
    assert!(e.ditch.iter().all(|d| d.kind != "wet"), "no wet moat in a cave");
    assert!(e.towers_detail.iter().all(|t| !s.solid(t.center)), "a tower on the rock");
}

/// A surface town keeps its circuit unchanged.
#[test]
fn walls16_surface_town_keeps_its_circuit() {
    let (height, water) = (vec![10.0f32; N * N], vec![0u8; N * N]);
    let s = surface(None, &height, &water);
    let town = g::normalized(disc(pt(1024.0, 1024.0), 200.0, 32, 0.0));
    let (circuits, cave) = cave_circuits(vec![town.clone()], s);
    assert!(!cave);
    assert_eq!(circuits.len(), 1);
    assert_eq!(circuits[0].outer, town.outer);
}
