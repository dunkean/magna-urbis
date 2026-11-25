use super::*;
#[test]
fn terrace_perimeter_keeps_occupied_blocks_and_releases_empty_slope() {
    let mut l: crate::urban::Layout = serde_json::from_value(serde_json::json!({
        "key":"terrace-perimeter","culture":"dwarven","center":{"x":50.,"y":50.},"quarters":[],"streets":[],"warnings":[],
        "blocks":[{"shape":g::rectangle(10.,10.,90.,90.),"quarter":0,"kind":"block","axis":{"x":1.,"y":0.}},
            {"shape":g::rectangle(100.,0.,500.,500.),"quarter":0,"kind":"reserve","axis":{"x":1.,"y":0.}}],
        "enclosures":[{"kind":"wall","path":[{"x":0.,"y":0.},{"x":500.,"y":0.},{"x":500.,"y":500.},{"x":0.,"y":500.},{"x":0.,"y":0.}],"gates":[],"towers":[]}]
    })).unwrap();
    let h = vec![0.;16*16];let w = vec![0;16*16];
    fit_enclosures(&mut l,10000,Surface {geometry:None,width:512.,n:16,height:&h,water:&w, interpolation: Default::default(),}, None);
    assert_eq!(l.enclosures.len(),1);
    let sh = Shape {outer:l.enclosures[0].path.clone(),holes:vec![]};
    assert!(g::contains(&sh,Point {x:50.,y:50.}));
    assert!(g::area(&sh)<25_000.);
}
