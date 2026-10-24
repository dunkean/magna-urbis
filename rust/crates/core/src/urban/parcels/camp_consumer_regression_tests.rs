//! Captured SYNTHETIC full-layout contexts from the root V2b public chain.
//! Small assembly controls test geometry only, never claim an admitted house.
use super::*;
use super::super::super::geometry as g;

fn captured(raw: &[u8]) -> (Layout, Morph) {
    let v: serde_json::Value = serde_json::from_slice(raw).unwrap();
    (serde_json::from_value(v["layout"].clone()).unwrap(), Morph { value: v["case"]["morph"].clone() })
}
fn cells(layout: &Layout, m: &Morph, bi: usize) -> Vec<Parcel> {
    let b = &layout.blocks[bi];
    let index = super::super::FrontageIndex::new(layout);
    let mut fronts = super::super::frontages(&b.shape, layout, &index);
    lots(&b.shape, bi, b.axis, &mut fronts, m, layout)
}
fn exact_partition(block: &Shape, parcels: &[Parcel]) {
    let actual: f64 = parcels.iter().map(|p| area(&p.shape)).sum();
    assert!((actual-area(block)).abs()<0.01,"parcel sum {} expected {}",actual,area(block));
    for (i,p) in parcels.iter().enumerate() {
        let outside: f64 = g::difference(&p.shape,block).iter().map(area).sum();
        assert!(outside<0.01,"{} outside {outside}",p.id);
        for q in &parcels[..i] {
            if !boxes_overlap(bbox(&p.shape),bbox(&q.shape)) { continue; }
            let overlap: f64 = g::intersection(&p.shape,&q.shape).iter().map(area).sum();
            assert!(overlap<0.01,"{} / {} overlap {overlap}",p.id,q.id);
        }
    }
}

#[test]
fn captured_plains_centre_and_paths_form_a_disjoint_partition() {
    let (layout,m) = captured(include_bytes!("fixtures/camp-captured-plains-context.json"));
    assert_eq!(m.text("campCentreUse"),"place");
    assert_eq!(m.number("campLanes"),1.0);
    let mut centre = 0.;let mut paths = 0.;
    for (bi,b) in layout.blocks.iter().enumerate().filter(|(_,b)|b.kind=="block") {
        let p = cells(&layout,&m,bi);
        centre += p.iter().filter(|p|p.provenance.iter().any(|s|s=="camp-centre") && p.use_kind=="place").map(|p|area(&p.shape)).sum::<f64>();
        paths += p.iter().filter(|p|p.provenance.iter().any(|s|s=="camp-path")).map(|p|area(&p.shape)).sum::<f64>();
        exact_partition(&b.shape,&p);
    }
    assert!(centre>0. && paths>0.,"retain both central function and real footpath land");
}

#[test]
fn captured_pnw_tiles_keep_the_real_access_notches_in_their_block() {
    let (layout,m) = captured(include_bytes!("fixtures/camp-captured-pnw-context.json"));
    assert_eq!(m.text("campLayout"),"rows");
    assert!(layout.blocks.len()>1,"full context, not a cropped replacement block");
    let b = &layout.blocks[1];
    let p = cells(&layout,&m,1);
    assert!(p.iter().any(|p|p.provenance.iter().any(|s|s=="camp-dwelling")));
    exact_partition(&b.shape,&p);
}

fn assembly(block: &Shape, tile: Shape) -> Vec<Parcel> {
    let nominal=area(&tile);let mut fronts=vec![];
    assemble(block,0,Point{x:1.,y:0.},&mut fronts,&Morph{value:serde_json::json!({})},
        (vec![Tile{shape:tile,hold:Hold::Dwelling,nominal,cut:false}],vec![]))
}

#[test]
fn an_enclosed_hole_crossing_the_tile_cannot_pass_the_containment_shortcut() {
    let mut block = g::rectangle(-100.,-100.,100.,100.);
    block.holes.push(g::rectangle(-2.,-80.,2.,80.).outer.into_iter().rev().collect());
    let tile = g::rectangle(-10.,-10.,10.,10.);
    // Every tile vertex is on land; no block/hole vertex lies in this bbox.
    // The hole's long edges still cross it, leaving TWO real components.
    assert!(tile.outer.iter().all(|&p|g::contains(&block,p)));
    let p = assembly(&block,tile);
    assert_eq!(p.len(),2,"preserve both components, do not bridge the hole");
    assert!((p.iter().map(|p|area(&p.shape)).sum::<f64>()-320.).abs()<0.01);
    for p in p { assert!(g::difference(&p.shape,&block).iter().map(area).sum::<f64>()<0.01); }
}

#[test]
fn a_valid_inner_hole_stays_a_hole_and_a_whole_convex_tile_stays_exact() {
    let mut block = g::rectangle(-100.,-100.,100.,100.);
    block.holes.push(g::rectangle(-4.,-4.,4.,4.).outer.into_iter().rev().collect());
    let tile = g::rectangle(-20.,-20.,20.,20.);
    let p = assembly(&block,tile);
    assert_eq!(p.len(),1);assert_eq!(p[0].shape.holes.len(),1);
    assert!((area(&p[0].shape)-1536.).abs()<0.01);
    let block = g::rectangle(-100.,-100.,100.,100.);
    let tile = g::rectangle(-20.,-20.,20.,20.);
    let p = assembly(&block,tile.clone());
    assert_eq!(p.len(),1);assert_eq!(p[0].shape,tile,"do not reclip untouched convex interior");
}
