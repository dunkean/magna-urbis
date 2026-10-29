use super::*;
use super::super::Street;
use serde::Deserialize;

#[derive(Deserialize)]
#[serde(rename_all="camelCase")]
struct Witness { layout: Layout, programme: super::super::programme::UrbanProgramme, port_parcels: Vec<super::super::Parcel> }

#[test]
fn port_stairs_serve_stores_above_the_bank_only_when_joined_to_a_quay() {
    let mut layout:Layout=serde_json::from_value(serde_json::json!({
        "key":"bank","culture":"swahili-stone-town","center":{"x":900.0,"y":1000.0},
        "quarters":[],"streets":[],"warnings":[],"blocks":[
            {"shape":g::rectangle(930.0,1002.0,975.0,1060.0),"quarter":0,"kind":"block","axis":{"x":1.0,"y":0.0}},
            {"shape":g::rectangle(900.0,1002.0,925.0,1060.0),"quarter":0,"kind":"block","axis":{"x":1.0,"y":0.0}}
        ]
    })).unwrap();
    let quay=Street{path:vec![Point{x:995.0,y:950.0},Point{x:995.0,y:1050.0}],widths:vec![6.0;2],rank:1,role:"quay".into()};
    layout.streets.push(quay);
    assert_eq!(quay_contacts(&layout),vec![0.0,0.0]);
    layout.streets.push(Street{path:vec![Point{x:995.0,y:1000.0},Point{x:950.0,y:1000.0}],widths:vec![3.0;2],rank:3,role:"port-stairs".into()});
    assert!(quay_contacts(&layout)[0]>=QUAY_FRONT,"working dock access serves the upper store");
    assert_eq!(quay_contacts(&layout)[1],0.0);
    layout.streets.push(Street{path:vec![Point{x:950.0,y:1000.0},Point{x:900.0,y:1000.0}],widths:vec![4.0;2],rank:2,role:"port-street".into()});
    assert!(quay_contacts(&layout)[1]>=QUAY_FRONT,"the dock's own street serves its inland store");
    layout.streets[1].path[0].x=985.0;
    assert_eq!(quay_contacts(&layout),vec![0.0,0.0],"an orphan stair is not quay frontage");
}

#[test]
fn exact_p33_p14_nucleus_port_preserves_physical_sites_and_programme() {
    for bytes in [include_bytes!("fixtures/port5-nucleus-P33.json").as_slice(),include_bytes!("fixtures/port5-nucleus-P14.json").as_slice()] {
        let mut w: Witness=serde_json::from_slice(bytes).unwrap();
        let population=w.programme.population;
        let env=w.programme.environment.clone();
        w.layout.programme=Some(w.programme);
        let before=w.layout.clone();
        let nucleus=before.quarters.iter().position(|q|g::contains(&q.shape,before.center)).unwrap();
        let contact=quay_contacts(&before);
        assert!(before.blocks.iter().enumerate().any(|(bi,b)|b.quarter==nucleus && contact[bi]>=QUAY_FRONT));
        let assigned=assign(&mut w.layout,population,true,&env);
        let after=&w.layout;
        let masks=&after.structure.as_ref().unwrap().port_districts;
        assert!(!masks.is_empty());
        for mask in masks {
            assert_eq!(mask.role,"port");
            assert_eq!(mask.shapes.len(),mask.quarters.len());
            for (&qi,shape) in mask.quarters.iter().zip(&mask.shapes) {
                assert_eq!(serde_json::to_value(shape).unwrap(),serde_json::to_value(&after.quarters[qi].shape).unwrap());
                assert!(!g::contains(shape,after.center),"port masks must spare the nucleus");
            }
        }
        assert!(after.quarters.len()>before.quarters.len());
        assert!(g::contains(&after.quarters[nucleus].shape,after.center));
        assert!(g::area(&after.quarters[nucleus].shape)<g::area(&before.quarters[nucleus].shape));
        assert_eq!(serde_json::to_value(&after.programme).unwrap(),serde_json::to_value(&before.programme).unwrap(),"needs, deficits, allocations and reservations unchanged");
        assert_eq!(serde_json::to_value(&after.streets).unwrap(),serde_json::to_value(&before.streets).unwrap());
        for (a,b) in before.blocks.iter().zip(&after.blocks) {
            let borrowed=|l:&Layout,q|l.structure.as_ref().and_then(|s|s.metrics.capacity.as_ref()).is_some_and(|p|p.borrowed_quarters.contains(&q));
            assert_eq!(borrowed(&before,a.quarter),borrowed(after,b.quarter),"donor tissue follows every whole block");
            let mut a=a.clone(); a.quarter=b.quarter;
            assert_eq!(serde_json::to_value(a).unwrap(),serde_json::to_value(b).unwrap(),"whole blocks, IDs and footprints retained");
        }
        let union=g::union(&after.quarters.iter().map(|q|q.shape.clone()).collect::<Vec<_>>());
        let old=g::union(&before.quarters.iter().map(|q|q.shape.clone()).collect::<Vec<_>>());
        assert!((union.iter().map(g::area).sum::<f64>()-old.iter().map(g::area).sum::<f64>()).abs()<0.1);
        for (from,to) in [(&old,&union),(&union,&old)] {
            let mut remainder=from.clone();
            for shape in to {remainder=remainder.into_iter().flat_map(|s|g::difference(&s,shape)).collect();}
            assert!(remainder.iter().map(g::area).sum::<f64>()<0.1,"same physical domain in both directions");
        }
        assert!((after.quarters.iter().map(|q|g::area(&q.shape)).sum::<f64>()-union.iter().map(g::area).sum::<f64>()).abs()<0.1,"no overlapping child quarters");
        let pr=after.programme.as_ref().unwrap();
        let mut tested=0;
        for a in pr.allocations.iter().filter(|a|pr.demands.iter().any(|d|d.id==a.demand_id && d.site=="quay")) {
            let p=w.port_parcels.iter().find(|p|p.id==a.parcel_id).unwrap();
            assert!(g::area(&p.shape)>1.0);
            assert!(matches!(a.function.as_str(),"warehouse"|"market"|"workshop"|"collective"));
            assert!(contact[p.block]>=QUAY_FRONT,"{} must retain physical quay frontage",a.role);
            assert_eq!(after.structure.as_ref().unwrap().districts[assigned[p.block].unwrap()].role,"port","{} footprint outside port",a.role);
            tested+=1;
        }
        assert!(tested>=2);
        let serialized=serde_json::to_value(&after.quarters).unwrap();
        let mut again=after.clone(); assign(&mut again,population,true,&env);
        assert_eq!(serialized,serde_json::to_value(&again.quarters).unwrap(),"refinement is idempotent");
        let mut pinned=before.clone();
        pinned.config.get_or_insert_with(Default::default).overrides.quarters.insert(nucleus.to_string(),QuarterOverride { role:Some("civic".into()),..Default::default() });
        assign(&mut pinned,population,true,&env);
        assert_eq!(serde_json::to_value(&pinned.quarters[nucleus]).unwrap(),serde_json::to_value(&before.quarters[nucleus]).unwrap(),"user-pinned nucleus retained");
    }
}
