//! Shared curtains and gates in attached enclosures.

use crate::urban::{Enclosure, Point, Shape, Tower, geometry as g};
use super::{attach, dedupe_shared, inner_gates, lopsided, shared_length};
use super::super::geometry::{disc, pt};

#[test]
fn an_attached_extension_shares_a_stretch_of_the_old_wall_and_the_union_stays_closed() {
    let old = g::rectangle(0.0, 0.0, 400.0, 400.0);
    // Every epoch's circuit hugs the old one at a few metres and runs on to the east.
    let full = g::rectangle(-4.0, -4.0, 800.0, 404.0);
    assert!(lopsided(&old, &full) && attach(&old, &full).is_some(), "lopsided growth attaches by itself");
    let balanced = g::rectangle(-200.0, -200.0, 600.0, 600.0);
    assert!(!lopsided(&old, &balanced), "balanced growth stays concentric");
    let ext = attach(&old, &full).expect("an extension");
    assert!(shared_length(&old, &ext) > 300.0, "shared stretch {}", shared_length(&old, &ext));
    assert!(g::intersection(&old, &ext).iter().map(g::area).sum::<f64>() < 1.0, "no overlap");
    let union = g::union(&[old.clone(), ext.clone()]);
    assert!(matches!(union.as_slice(), [one] if one.holes.is_empty() && g::simple(one)), "closed, simple outline");
    assert!(g::simple(&ext));
    // A round old town (contour or bastioned trace) with its growth to one side.
    let round = disc(pt(300.0, 300.0), 250.0, 48, 0.0);
    let grown = g::union(&[round.clone(), disc(pt(620.0, 300.0), 260.0, 48, 0.3)]).remove(0);
    assert!(lopsided(&round, &grown));
    let ext = attach(&round, &grown).expect("a round extension");
    assert!(shared_length(&round, &ext) > 100.0);
    assert!(matches!(g::union(&[round.clone(), ext.clone()]).as_slice(), [one] if one.holes.is_empty() && g::simple(one)));
    // Gates and towers on the shared stretch are drawn once and are inner gates of the old wall.
    let ring = |s: &Shape| { let mut p = s.outer.clone(); p.push(p[0]); p };
    let (on_stretch, outside) = (pt(400.0, 200.0), pt(0.0, 200.0));
    let tower = |p: Point| Tower { anchor: p, center: p, shape: "round".into(), radius_m: 5.0, depth_m: 0.0, angle: 0.0, height_m: 9.0, kind: "flank".into(), footprint: old.clone() };
    let mut o = Enclosure { path: ring(&old), gates: vec![on_stretch, outside], ..Default::default() };
    let mut e = Enclosure { path: ring(&ext), gates: vec![on_stretch], towers: vec![on_stretch], towers_detail: vec![tower(on_stretch)], ..Default::default() };
    let ext = attach(&old, &full).unwrap();
    dedupe_shared(&mut e, &old);
    inner_gates(&mut o, &ext);
    assert!(e.gates.is_empty() && e.towers_detail.is_empty() && e.towers.is_empty());
    assert_eq!(o.inner_gates, vec![0]);
}
