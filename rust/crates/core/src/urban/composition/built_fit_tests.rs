use super::*;
/// Review 03/11 (indus 10k river): a town circuit gives back the empty
/// slope beside its town; a circuit whose land is built stays as it is.
#[test]
fn review11_town_circuit_gives_back_its_empty_side() {
    let layout = |blocks: serde_json::Value| -> crate::urban::Layout { serde_json::from_value(serde_json::json!({
        "key":"built-fit","culture":"indus-planned","center":{"x":300.,"y":200.},"quarters":[],"streets":[],"warnings":[],
        "blocks":blocks,
        "enclosures":[{"kind":"wall","path":[{"x":0.,"y":0.},{"x":600.,"y":0.},{"x":600.,"y":400.},{"x":0.,"y":400.},{"x":0.,"y":0.}],"gates":[],"towers":[],"style":"flanked"}]
    })).unwrap() };
    let block = |x0: f64, x1: f64, kind: &str| serde_json::json!({"shape":g::rectangle(x0,10.,x1,390.),"quarter":0,"kind":kind,"axis":{"x":1.,"y":0.}});
    let (h, w) = (vec![0.; 16 * 16], vec![0; 16 * 16]);
    let surface = Surface { geometry: None, width: 1024., n: 16, height: &h, water: &w, interpolation: Default::default(),};
    // Built east half, trimmed (reserve) west half: the curtain moves to the town.
    let mut l = layout(serde_json::json!([block(310.,590.,"block"), block(10.,300.,"reserve")]));
    fit_enclosures(&mut l, 10000, surface, None);
    assert_eq!(l.enclosures.len(), 1);
    let fitted = Shape { outer: l.enclosures[0].path.clone(), holes: vec![] };
    assert!(g::contains(&fitted, Point { x: 450., y: 200. }) && !g::contains(&fitted, Point { x: 100., y: 200. }));
    assert!(g::area(&fitted) < 0.65 * 240_000.0, "{}", g::area(&fitted));
    assert!(l.enclosures[0].style.is_empty(), "the refitted circuit is rebuilt by settle");
    // Built everywhere (a place counts): the circuit is untouched.
    let mut l = layout(serde_json::json!([block(310.,590.,"block"), block(10.,300.,"place")]));
    let before = l.enclosures[0].path.clone();
    fit_enclosures(&mut l, 10000, surface, None);
    assert_eq!(l.enclosures.len(), 1);
    assert_eq!(l.enclosures[0].path, before);
}

/// Review 14/11 (roman, medina, barbarian 10k): blocks that hold a house
/// or two and empty housing plots do not hold the curtain out. Fitted to
/// the built lots of the allocation, the circuit gives back the empty
/// west half; the same blocks counted whole keep it.
#[test]
fn review1114_circuit_follows_built_lots_not_whole_blocks() {
    let wall = |blocks: serde_json::Value| -> crate::urban::Layout { serde_json::from_value(serde_json::json!({
        "key":"built-lots","culture":"indus-planned","center":{"x":300.,"y":200.},"quarters":[],"streets":[],"warnings":[],
        "blocks":blocks,
        "enclosures":[{"kind":"wall","path":[{"x":0.,"y":0.},{"x":600.,"y":0.},{"x":600.,"y":400.},{"x":0.,"y":400.},{"x":0.,"y":0.}],"gates":[],"towers":[],"style":"flanked"}]
    })).unwrap() };
    let block = |x0: f64, x1: f64| serde_json::json!({"shape":g::rectangle(x0,10.,x1,390.),"quarter":0,"kind":"block","axis":{"x":1.,"y":0.}});
    let (h, w) = (vec![0.; 16 * 16], vec![0; 16 * 16]);
    let surface = Surface { geometry: None, width: 1024., n: 16, height: &h, water: &w, interpolation: Default::default(),};
    // East half built lot by lot; the west block keeps one house in its middle
    // and a row of houses along the south wall walk.
    let east: Vec<Shape> = (0..14).flat_map(|i| (0..7).map(move |j| {
        let (x, y) = (312. + 20. * f64::from(i), 14. + 54. * f64::from(j));
        g::rectangle(x, y, x + 16., y + 50.)
    })).collect();
    let mut built = east.clone();
    built.push(g::rectangle(150., 180., 166., 210.));
    built.extend((0..14).map(|i| { let x = 20. + 20. * f64::from(i); g::rectangle(x, 14., x + 16., 44.) }));
    let blocks = serde_json::json!([block(310., 590.), block(10., 300.)]);
    let mut l = wall(blocks.clone());
    fit_enclosures(&mut l, 10000, surface, Some(&built));
    assert_eq!(l.enclosures.len(), 1);
    let fitted = Shape { outer: l.enclosures[0].path.clone(), holes: vec![] };
    assert!(g::contains(&fitted, Point { x: 450., y: 200. }), "the built half stays walled");
    assert!(!g::contains(&fitted, Point { x: 80., y: 300. }), "the empty west plots are given back");
    assert!(!g::contains(&fitted, Point { x: 158., y: 195. }), "a lone house does not hold the curtain");
    assert!(!g::contains(&fitted, Point { x: 150., y: 30. }), "nor does a row of houses along the wall walk");
    assert!(g::area(&fitted) < 0.6 * 240_000.0, "{}", g::area(&fitted));
    // A built end of the town as narrow as that row, with no empty land beside it, stays walled.
    let mut narrow = wall(blocks.clone());
    narrow.enclosures[0].path = [(0., 0.), (600., 0.), (600., 400.), (300., 400.), (300., 60.), (0., 60.), (0., 0.)]
        .iter().map(|&(x, y)| Point { x, y }).collect();
    let before = narrow.enclosures[0].path.clone();
    let row: Vec<Shape> = east.iter().cloned()
        .chain((0..14).map(|i| { let x = 20. + 20. * f64::from(i); g::rectangle(x, 14., x + 16., 44.) })).collect();
    fit_enclosures(&mut narrow, 10000, surface, Some(&row));
    assert_eq!(narrow.enclosures[0].path, before);
    // The same blocks without the allocation: both count whole, the circuit stays.
    let mut l = wall(blocks);
    let before = l.enclosures[0].path.clone();
    fit_enclosures(&mut l, 10000, surface, None);
    assert_eq!(l.enclosures[0].path, before);
}

/// The raster bound of the empty land: a circuit built lot by lot holds
/// no empty piece; a square of lots taken out leaves a piece of about
/// 2.7 ha beyond the margin, which the bound may not deny, but which is
/// smaller than the floor of a large circuit.
#[test]
fn void_bound_proves_full_circuits_and_never_denies_a_void() {
    let old = g::rectangle(0., 0., 600., 400.);
    let lots: Vec<Shape> = (0..30).flat_map(|i| (0..20).map(move |j| {
        let (x, y) = (2. + 20. * f64::from(i), 2. + 20. * f64::from(j));
        g::rectangle(x, y, x + 16., y + 16.)
    })).collect();
    let all: Vec<&Shape> = lots.iter().collect();
    assert!(!may_hold_void(&old, &all, VOID_MIN));
    let gap = |s: &&Shape| { let (x0, y0, ..) = g::bbox(s); !(160.0..380.0).contains(&x0) || !(100.0..320.0).contains(&y0) };
    let holed: Vec<&Shape> = lots.iter().filter(gap).collect();
    assert!(may_hold_void(&old, &holed, VOID_MIN));
    assert!(!may_hold_void(&old, &holed, 60_000.0));
    // Nothing built: the whole circuit is one empty piece.
    assert!(may_hold_void(&old, &[], VOID_MIN));
}

/// The open land of a circuit comes from the culture data: gardens and a
/// small share by default, the common of an oppidum and a larger share.
#[test]
fn enclosed_open_land_is_read_from_the_culture() {
    assert_eq!(enclosed_open("roman-core", 10_000), ("open.garden", VOID_SHARE));
    assert_eq!(enclosed_open("celtic-oppidum", 10_000), ("open.common", 0.1));
    assert_eq!(enclosed_open("celtic-oppidum", 30_000), ("open.common", 0.1));
}
