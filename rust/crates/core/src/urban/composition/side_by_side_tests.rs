use super::*;
static FLAT: [f32; 256] = [0.0; 256];
static DRY: [u8; 256] = [0; 256];
fn surface() -> Surface<'static> { Surface { geometry: None, width: 2048., n: 16, height: &FLAT, water: &DRY, interpolation: Default::default(),} }
fn layout(rings: &[Shape]) -> crate::urban::Layout {
    let mut l: crate::urban::Layout = serde_json::from_value(serde_json::json!({
        "key":"side-by-side","culture":"dwarven","center":{"x":0.,"y":0.},"quarters":[],"streets":[],"warnings":[],"blocks":[],"enclosures":[]
    })).unwrap();
    l.enclosures = rings.iter().map(|r| Enclosure { path: closed(&r.outer), kind: "wall".into(), ..Default::default() }).collect();
    l
}
/// Review 03/11 (dwarven town): two circuits running side by side are
/// joined into one; distant, nested and attached circuits stay apart.
#[test]
fn review11_side_by_side_circuits_become_one() {
    let (town, annex) = (g::rectangle(0., 0., 400., 400.), g::rectangle(430., 60., 600., 300.));
    let mut l = layout(&[town.clone(), annex.clone()]);
    join_side_by_side(&mut l, surface());
    assert_eq!(l.enclosures.len(), 1);
    let one = closed_shape(&l.enclosures[0]);
    for p in [Point { x: 200., y: 200. }, Point { x: 515., y: 180. }, Point { x: 415., y: 180. }] {
        assert!(g::contains(&one, p), "{p:?} outside the joined circuit");
    }
    assert!(l.enclosures[0].style.is_empty(), "the joined circuit is rebuilt by settle");
    // The joined circuit runs straight across a bend that turned into the town.
    let dented = Shape { outer: vec![Point { x: 0., y: 0. }, Point { x: 400., y: 0. }, Point { x: 400., y: 400. }, Point { x: 250., y: 400. },
        Point { x: 200., y: 330. }, Point { x: 150., y: 400. }, Point { x: 0., y: 400. }], holes: vec![] };
    let mut l = layout(&[dented, annex.clone()]);
    join_side_by_side(&mut l, surface());
    assert_eq!(l.enclosures.len(), 1);
    assert!(g::contains(&closed_shape(&l.enclosures[0]), Point { x: 200., y: 380. }), "inward bend kept");
    // Two traces touching at a corner (a few metres of overlap) are side by side too.
    let mut l = layout(&[town.clone(), g::rectangle(395., 60., 600., 300.)]);
    join_side_by_side(&mut l, surface());
    assert_eq!(l.enclosures.len(), 1);
    let far = g::rectangle(700., 60., 900., 300.);
    let inner = g::rectangle(100., 100., 300., 300.);
    let attached = g::rectangle(400., 0., 600., 400.);
    for rings in [vec![town.clone(), far], vec![town.clone(), inner], vec![town.clone(), attached]] {
        let mut l = layout(&rings);
        join_side_by_side(&mut l, surface());
        assert_eq!(l.enclosures.len(), 2);
    }
}
