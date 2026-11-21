use super::super::super::geometry::rectangle;
use super::super::super::{Layout, Parcel, Partition, Surface};
use super::super::{ProgrammeContext, allocate, prepare};
use super::{storey_raise, vacant};
use serde_json::json;

/// One 200 x 30 m block on a main street, cut into ten 20 m lots: the first
/// four are entered from a passage behind the street wall, the last six open
/// on the street. Twelve households are asked, more than the lots hold.
fn case() -> (Layout, Partition) {
    let mut l: Layout = serde_json::from_value(json!({"key":"staged","culture":"european-organic",
        "center":{"x":100.0,"y":125.0},"quarters":[],
        "blocks":[{"shape":rectangle(0.0,110.0,200.0,140.0),"quarter":0,"kind":"block","axis":{"x":1.0,"y":0.0}}],
        "streets":[{"path":[{"x":-10.0,"y":105.0},{"x":210.0,"y":105.0}],"widths":[8.0,8.0],"rank":1,"role":"street"}],
        "warnings":[]}))
    .unwrap();
    let (height, water) = (vec![0.0; 32 * 32], vec![0; 32 * 32]);
    let surface = Surface { geometry: None, width: 1000.0, n: 32, height: &height, water: &water, interpolation: Default::default() };
    prepare(&mut l, 18, &ProgrammeContext::default(), surface).unwrap();
    let pr = l.programme.as_mut().unwrap();
    pr.reservations.clear();
    pr.demands.retain(|d| d.function == "domestic");
    pr.demands[0].requested = 12.0;
    let parcels: Vec<_> = (0..10)
        .map(|i| {
            let x = 20.0 * i as f64;
            let street = i >= 4;
            json!({"id":format!("lot/{i}"),"shape":rectangle(x,110.0,x+20.0,140.0),"block":0,"use":"plot",
                "front":[{"x":x,"y":110.0},{"x":x+20.0,"y":110.0}],"axis":{"x":1.0,"y":0.0},"rank":if street {1} else {2},
                "access":{"kind":if street {"public"} else {"collective"},"street":0,"frontLength":20.0}})
        })
        .collect();
    let p: Partition = serde_json::from_value(json!({"key":l.key,"warnings":[],"parcels":parcels})).unwrap();
    (l, p)
}

fn homes(p: &Partition) -> Vec<String> {
    let mut ids: Vec<String> = p.programme.as_ref().unwrap().allocations.iter().filter(|a| a.unit == "domesticUnits").map(|a| a.parcel_id.clone()).collect();
    ids.sort();
    ids
}

#[test]
fn a_block_at_sixty_percent_occupies_its_six_street_lots() {
    let (mut l, mut p) = case();
    l.blocks[0].fill = Some(0.6);
    allocate(&l, &mut p);
    let street: Vec<String> = (4..10).map(|i| format!("lot/{i}")).collect();
    assert_eq!(homes(&p), street);
}

#[test]
fn street_lots_come_first_then_back_lots_then_subdivisions() {
    let (mut l, mut p) = case();
    p.parcels[9].provenance.push("inherited-subdivision".into());
    let parcels: &[Parcel] = &p.parcels;
    let left = |l: &Layout| -> Vec<usize> {
        let out = vacant(l, parcels, |_| false);
        (0..out.len()).filter(|&i| out[i]).collect()
    };
    l.blocks[0].fill = Some(0.6);
    assert_eq!(left(&l), vec![0, 1, 2, 3]);
    l.blocks[0].fill = Some(0.5);
    assert_eq!(left(&l), vec![0, 1, 2, 3, 9], "a subdivided street lot waits for the cut's first street lots");
    // A reserved block is never thinned; no fill share leaves every lot to demand.
    assert!(!vacant(&l, parcels, |_| true).contains(&true));
    l.blocks[0].fill = None;
    assert!(left(&l).is_empty());
}

#[test]
fn no_fill_share_keeps_the_classic_allocation() {
    let (l, p) = case();
    let block = serde_json::to_value(&l.blocks[0]).unwrap();
    assert!(block.get("fill").is_none(), "classic blocks serialise as before: {block}");
    let mut classic = p.clone();
    allocate(&l, &mut classic);
    // Every lot occupied is the same allocation as no fill share at all.
    let mut full_layout = l.clone();
    full_layout.blocks[0].fill = Some(1.0);
    let mut full = p.clone();
    allocate(&full_layout, &mut full);
    assert_eq!(serde_json::to_value(&full).unwrap(), serde_json::to_value(&classic).unwrap());
    assert!(!homes(&classic).is_empty());
}

#[test]
fn fill_past_every_lot_raises_storeys_up_to_the_limit() {
    assert_eq!(storey_raise(0.2, None), 0.2);
    assert_eq!(storey_raise(0.2, Some(0.6)), 0.2);
    assert_eq!(storey_raise(0.0, Some(1.5)), 0.5);
    assert_eq!(storey_raise(0.0, Some(3.0)), 1.0);
    assert_eq!(storey_raise(0.7, Some(1.5)), 0.7);
}
