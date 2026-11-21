//! The ground and enclosure of a heights castle.

use crate::rng::Rng;
use crate::urban::{LayoutConfig, Shape, Street, Surface, geometry as g};
use super::super::geometry::pt;
use super::{heights_castle, wrap_castle};

#[test]
fn a_knoll_at_the_rim_carries_a_castle_the_town_wall_runs_round() {
    let n = 128;
    let width = 1280.0;
    let knoll = pt(850.0, 640.0);
    let height: Vec<f32> = (0..n * n).map(|i| {
        let p = pt((i % n) as f64 * 10.0 + 5.0, (i / n) as f64 * 10.0 + 5.0);
        let d = (p.x - knoll.x).hypot(p.y - knoll.y);
        (30.0 * (-(d * d) / (2.0 * 110.0 * 110.0)).exp()) as f32
    }).collect();
    let flat = vec![0.0_f32; n * n];
    let water = vec![0_u8; n * n];
    let town = Shape { outer: vec![pt(400.0, 400.0), pt(880.0, 400.0), pt(880.0, 880.0), pt(400.0, 880.0)], holes: vec![] };
    let cfg = LayoutConfig { heights_castle: "force".into(), ..Default::default() };
    let street = [Street { path: vec![pt(500.0, 640.0), knoll], widths: vec![6.0; 2], rank: 1, role: "street".into() }];
    let surface = Surface { geometry: None, width, n, height: &height, water: &water, interpolation: Default::default(),};
    let castle = heights_castle(std::slice::from_ref(&town), std::slice::from_ref(&town), &street, surface, &cfg, "european-organic", 5000, &Rng::new("castle"))
        .expect("a castle on the knoll");
    assert!(g::contains(&castle, knoll), "the castle crowns the knoll");
    let wrapped = wrap_castle(vec![town.clone()], &castle);
    assert!(g::area(&wrapped[0]) > g::area(&town) + 500.0, "the town wall runs round the castle astride it");
    let auto = LayoutConfig::default();
    let level = Surface { geometry: None, width, n, height: &flat, water: &water, interpolation: Default::default(),};
    assert!(heights_castle(std::slice::from_ref(&town), std::slice::from_ref(&town), &street, level, &auto, "european-organic", 5000, &Rng::new("castle")).is_none(),
        "no knoll, no castle");
}
