use super::*;
use super::super::super::{geometry as g, generate_parcels};

#[test]
fn a_cap_can_only_extend_existing_contiguous_open_ground() {
    let open=g::rectangle(0.,0.,10.,10.);let dwelling=g::rectangle(20.,0.,30.,10.);
    let original_dwelling=dwelling.clone();
    let mut cells=vec![(open,Hold::Open,0.),(dwelling,Hold::Dwelling,100.)];
    let count=cells.len();
    let unassigned=assign_open_ground_caps(&g::rectangle(-1.,-1.,31.,11.),&mut cells,&[g::rectangle(10.,0.,10.5,0.5)]);
    assert_eq!(unassigned,0);assert_eq!(cells.len(),count);
    assert_eq!(cells[0].1,Hold::Open);assert_eq!(cells[0].2,0.);
    assert_eq!(area(&cells[0].0),100.25);
    assert_eq!(cells[1].0,original_dwelling);assert_eq!(cells[1].1,Hold::Dwelling);
}

#[test]
fn an_unattachable_cap_cannot_be_bridged_or_become_a_new_property() {
    let mut cells=vec![(g::rectangle(0.,0.,1.,1.),Hold::Open,0.)];let before=cells[0].0.clone();
    let unassigned=assign_open_ground_caps(&g::rectangle(-1.,-1.,4.,4.),&mut cells,&[g::rectangle(1.02,0.,1.52,0.5)]);
    assert_eq!(unassigned,1);assert_eq!(cells.len(),1);assert_eq!(cells[0].0,before);
    // The former1m²/nominal100 tile already failed the old admission gate.
    // This negative is a REAL admissible dwelling, with a cap outside it.
    let mut dwelling_only=vec![(g::rectangle(0.,0.,10.,10.),Hold::Dwelling,100.)];let before=dwelling_only[0].0.clone();
    assert_eq!(assign_open_ground_caps(&g::rectangle(-1.,-1.,12.,12.),&mut dwelling_only,&[g::rectangle(10.,0.,10.5,0.5)]),1);
    assert_eq!(dwelling_only.len(),1);assert_eq!(dwelling_only[0].0,before);
}

#[test]
fn already_owned_cap_land_is_never_reassigned_from_a_dwelling() {
    let mut cells=vec![(g::rectangle(0.,0.,10.,10.),Hold::Dwelling,100.),(g::rectangle(20.,0.,30.,10.),Hold::Open,0.)];
    let before:Vec<_>=cells.iter().map(|c|c.0.clone()).collect();
    assign_open_ground_caps(&g::rectangle(-1.,-1.,31.,11.),&mut cells,&[g::rectangle(2.,2.,2.5,2.5)]);
    assert_eq!(before,cells.iter().map(|c|c.0.clone()).collect::<Vec<_>>());
}

#[test]
fn a_contiguous_cap_does_not_fill_a_valid_existing_hole() {
    let mut open=g::rectangle(0.,0.,10.,10.);
    open.holes.push(g::rectangle(3.,3.,4.,4.).outer.into_iter().rev().collect());
    let mut cells=vec![(open,Hold::Open,0.)];
    assert_eq!(assign_open_ground_caps(&g::rectangle(-1.,-1.,12.,12.),&mut cells,&[g::rectangle(10.,0.,10.5,0.5)]),0);
    assert_eq!(cells[0].0.holes.len(),1);
    assert!(!g::contains(&cells[0].0,Point{x:3.5,y:3.5}));
    assert_eq!(area(&cells[0].0),99.25);
}

#[test]
fn captured_ordu_public_parcel_chain_has_no_lost_cap_or_micro_property() {
    // This is the composed phase: Nav is already present on BOTH sides.
    // Earlier Cap-only counts/allocations are archival, not this baseline.
    let fixture:serde_json::Value=serde_json::from_slice(include_bytes!("fixtures/camp-ordu-discarded-cap-context.json")).unwrap();
    let layout:Layout=serde_json::from_value(fixture["layout"].clone()).unwrap();
    let reference=&fixture["composedCapNav"];
    assert_eq!(reference["captureComplete"],true);
    assert_eq!(serde_json::to_vec(&layout).unwrap(),reference["layoutTransport"].as_str().unwrap().as_bytes(),"EXACT same parsed layout as the measured Nav predecessor");
    assert_eq!(serde_json::to_vec(&ParcelConfig::default()).unwrap(),reference["configTransport"].as_str().unwrap().as_bytes());
    let nav_transport=reference["navTransport"].as_str().unwrap();
    let combined_transport=reference["combinedTransport"].as_str().unwrap();
    let nav:Partition=serde_json::from_str(nav_transport).unwrap();
    let output=generate_parcels("camp-consumer-synthetic-v2",std::slice::from_ref(&layout),&ParcelConfig::default()).unwrap();
    let result=&output[0];
    let actual_transport=serde_json::to_vec(result).unwrap();
    // Full lexical identity also covers every report and all geometric/access
    // coordinates. No epsilon, report masking or float roundtrip comparison.
    assert!(actual_transport.as_slice()==combined_transport.as_bytes(),"whole measured combined transport differs at byte {:?}; all reports/coordinates are retained",actual_transport.iter().zip(combined_transport.as_bytes()).position(|(a,b)|a!=b));
    // Both Values below pass through the SAME transport decoder. Never compare
    // a freshly constructed in-memory Value with a decoded numeric fixture.
    let before:serde_json::Value=serde_json::from_str(nav_transport).unwrap();
    let after:serde_json::Value=serde_json::from_slice(&actual_transport).unwrap();
    let original:serde_json::Value=serde_json::from_slice(&serde_json::to_vec(layout.programme.as_ref().unwrap()).unwrap()).unwrap();
    let old_rows=before["parcels"].as_array().unwrap();
    let rows=after["parcels"].as_array().unwrap();
    assert_eq!(old_rows.len(),rows.len(),"Cap does not add a cadastral property");
    for kind in ["plot","garden","court"] {
        assert_eq!(old_rows.iter().filter(|p|p["use"]==kind).count(),rows.iter().filter(|p|p["use"]==kind).count(),"preserve real Nav-phase {kind} count");
    }
    let missing:Vec<_>=old_rows.iter().filter(|p|!rows.iter().any(|q|q["id"]==p["id"])).collect();
    let added:Vec<_>=rows.iter().filter(|p|!old_rows.iter().any(|q|q["id"]==p["id"])).collect();
    assert_eq!(missing.len(),1);assert_eq!(added.len(),1);
    let (old_land,new_land)=(missing[0],added[0]);
    for p in old_rows {if let Some(q)=rows.iter().find(|q|q["id"]==p["id"]) {assert_eq!(p,q,"every common parcel, its geometry AND metadata");}}
    for key in ["use","reason","family","provenance","parentIds","block","pressure","axis","rank"] {assert_eq!(old_land[key],new_land[key],"restored nonbuilt garden {key}");}
    assert_eq!(new_land["use"],"garden");assert_eq!(new_land["reason"],"camp-open");
    for key in ["kind","street"] {assert_eq!(old_land["access"][key],new_land["access"][key],"existing true public source is preserved");}
    let old=nav.parcels.iter().find(|p|p.id==old_land["id"].as_str().unwrap()).unwrap();
    let new=result.parcels.iter().find(|p|p.id==new_land["id"].as_str().unwrap()).unwrap();
    assert!(g::difference(&old.shape,&new.shape).is_empty(),"all old garden land retained, unchanged strict subset guard");
    let growth=area(&new.shape)-area(&old.shape);
    let restored=result.parcels.iter().map(|p|area(&p.shape)).sum::<f64>()-nav.parcels.iter().map(|p|area(&p.shape)).sum::<f64>();
    assert!(growth>0.01,"the real lost cap is restored");
    assert!((growth-restored).abs()<0.01,"all restored area belongs to this existing nonbuilt garden");
    for (bi,b) in layout.blocks.iter().enumerate() {
        let cells:Vec<_>=result.parcels.iter().filter(|p|p.block==bi).collect();
        let total:f64=cells.iter().map(|p|area(&p.shape)).sum();
        assert!((total-area(&b.shape)).abs()<0.01,"block{bi}: {}",total-area(&b.shape));
        for (i,p) in cells.iter().enumerate() {
            assert!(g::difference(&p.shape,&b.shape).iter().map(area).sum::<f64>()<0.01);
            for q in &cells[..i] {if boxes_overlap(bbox(&p.shape),bbox(&q.shape)) {assert!(g::intersection(&p.shape,&q.shape).iter().map(area).sum::<f64>()<0.01);}}
        }
    }
    let (bp,ap)=(&before["programme"],&after["programme"]);
    for (key,value) in bp.as_object().unwrap() {if !["demands","allocations","adjacency"].contains(&key.as_str()) {assert_eq!(value,&ap[key],"programme {key} stays exact");}}
    assert_eq!(ap["population"],original["population"]);
    let original_demands=original["demands"].as_array().unwrap();assert_eq!(original_demands.len(),8);
    for demand in original_demands {
        let actual=ap["demands"].as_array().unwrap().iter().find(|d|d["id"]==demand["id"]).unwrap();
        for key in ["id","function","role","unit","requested","targetArea","targetFrontage"] {assert_eq!(actual[key],demand[key],"original need {key}");}
    }
    let (ba,aa)=(bp["allocations"].as_array().unwrap(),ap["allocations"].as_array().unwrap());
    assert_eq!(ba.len(),aa.len());
    let mut changed_allocations=0;let mut common_id=None;
    for (old,new) in ba.iter().zip(aa) {
        if old["parcelId"]==old_land["id"] {
            changed_allocations+=1;common_id=Some(old["demandId"].clone());
            assert_eq!(new["parcelId"],new_land["id"]);
            for (key,value) in old.as_object().unwrap() {if !["parcelId","capacity"].contains(&key.as_str()) {assert_eq!(value,&new[key],"existing open.common allocation {key}");}}
            assert_eq!(new["function"],"common");assert_eq!(new["role"],"open.common");assert_eq!(new["households"].as_f64().unwrap(),0.);
            assert!((new["capacity"].as_f64().unwrap()-old["capacity"].as_f64().unwrap()-growth).abs()<0.01,"only real open ground capacity grows, not built storage/housing");
        } else {assert_eq!(old,new,"every other allocation stays exact");}
    }
    assert_eq!(changed_allocations,1);let common_id=common_id.unwrap();
    let (bd,ad)=(bp["demands"].as_array().unwrap(),ap["demands"].as_array().unwrap());assert_eq!(bd.len(),ad.len());
    for (old,new) in bd.iter().zip(ad) {
        if old["id"]==common_id {
            for (key,value) in old.as_object().unwrap() {if key!="parcelCapacity" {assert_eq!(value,&new[key],"open.common demand {key} unchanged");}}
            assert!((new["parcelCapacity"].as_f64().unwrap()-old["parcelCapacity"].as_f64().unwrap()-growth).abs()<0.01);
        } else {assert_eq!(old,new,"all other demands incl. Nav-derived private garden stay exact");}
        assert_eq!(new["builtCapacity"].as_f64().unwrap(),0.);assert_eq!(new["openCapacity"].as_f64().unwrap(),0.);
    }
    // The restored garden's incident contacts may legitimately grow. Every
    // other adjacency must be preserved; no invented/lost neighbor is allowed.
    let normalized_edges=|value:&serde_json::Value,old_id:&str,new_id:&str| {
        let mut edges=std::collections::BTreeMap::new();
        for edge in value.as_array().unwrap() {
            let a=edge["a"].as_str().unwrap();let b=edge["b"].as_str().unwrap();
            let a=if a==old_id {new_id} else {a};let b=if b==old_id {new_id} else {b};
            assert!(edges.insert((a.to_owned(),b.to_owned()),edge.clone()).is_none());
        }edges
    };
    let old_id=old_land["id"].as_str().unwrap();let new_id=new_land["id"].as_str().unwrap();
    let be=normalized_edges(&bp["adjacency"],old_id,new_id);let ae=normalized_edges(&ap["adjacency"],new_id,new_id);
    assert_eq!(be.keys().collect::<Vec<_>>(),ae.keys().collect::<Vec<_>>());
    for (ids,edge) in &be {if ids.0!=new_id&&ids.1!=new_id {assert_eq!(edge,&ae[ids]);}}
    // This small residual already exists in the REAL Nav predecessor. It is
    // not a new plot, and restoring a distant cap neither removes nor admits it.
    let residual_id=reference["navResidualId"].as_str().unwrap();
    let residual=rows.iter().find(|p|p["id"]==residual_id).unwrap();
    assert_eq!(residual,old_rows.iter().find(|p|p["id"]==residual_id).unwrap());
    assert_eq!(residual["use"],"garden");assert!(residual["envelope"].is_null());assert!(residual["front"].is_null());assert_eq!(residual["access"]["kind"],"unserved");
    assert!(!aa.iter().any(|a|a["parcelId"]==residual_id),"residual has no allocation or households");
    let residual_native=result.parcels.iter().find(|p|p.id==residual_id).unwrap();assert!(area(&residual_native.shape)>0.5&&area(&residual_native.shape)<1.);
    let sites=super::super::super::building_sites::BuildingSiteIndex::prepare(std::slice::from_ref(&layout),std::slice::from_ref(result),&[0]).unwrap();
    assert_eq!(sites.total() as u64,reference["navBuildingSiteIndexTotal"].as_u64().unwrap(),"cap adds no building-site request");
}


#[test]
fn a_clipped_dwelling_already_below_the_native_size_gate_is_effective_open_ground() {
    let mut cells=vec![(g::rectangle(0.,0.,10.,5.),Hold::Dwelling,120.75)];
    let count=cells.len();
    assert_eq!(assign_open_ground_caps(&g::rectangle(-1.,-1.,12.,12.),&mut cells,&[g::rectangle(10.,0.,10.5,0.5)]),0);
    assert_eq!(cells.len(),count);assert_eq!(cells[0].1,Hold::Open);assert_eq!(area(&cells[0].0),50.25);
    assert_eq!(cells[0].2,120.75,"original nominal programme is not rewritten");
}
#[test]
fn a_clipped_head_tile_can_only_remain_nonbuilt_after_cap_assignment() {
    let mut cells=vec![(g::rectangle(0.,0.,10.,8.),Hold::Head,241.5)];
    assert_eq!(assign_open_ground_caps(&g::rectangle(-1.,-1.,12.,12.),&mut cells,&[g::rectangle(10.,0.,10.5,0.5)]),0);
    assert_eq!(cells[0].1,Hold::Open);assert_eq!(area(&cells[0].0),80.25);assert_eq!(cells[0].2,241.5);
}
#[test]
fn restored_ground_crossing_the_old_size_threshold_never_creates_a_dwelling() {
    let mut cells=vec![(g::rectangle(0.,0.,10.,5.42),Hold::Dwelling,120.75)];
    assert!(area(&cells[0].0)<54.3375);
    assert_eq!(assign_open_ground_caps(&g::rectangle(-1.,-1.,12.,12.),&mut cells,&[g::rectangle(10.,0.,10.5,0.5)]),0);
    assert!(area(&cells[0].0)>54.3375);
    assert_eq!(cells[0].1,Hold::Open,"the restored path cap supplies zero new building credit");
}
#[test]
fn an_admissible_dwelling_or_cultural_centre_never_becomes_a_cap_owner() {
    for hold in [Hold::Dwelling,Hold::Head,Hold::Centre] {
        let mut cells=vec![(g::rectangle(0.,0.,10.,10.),hold,120.75)];let before=cells[0].0.clone();
        assert_eq!(assign_open_ground_caps(&g::rectangle(-1.,-1.,12.,12.),&mut cells,&[g::rectangle(10.,0.,10.5,0.5)]),1);
        assert_eq!(cells[0].0,before);assert_eq!(cells[0].1,hold);assert_eq!(cells.len(),1);
    }
}
#[test]
fn no_cap_or_a_real_gap_keeps_effective_open_geometry_holds_and_nominal_exact() {
    let mut cells=vec![(g::rectangle(0.,0.,10.,5.),Hold::Dwelling,120.75)];let before=cells[0].0.clone();
    let snapshot=serde_json::to_vec(&(cells[0].0.clone(),format!("{:?}",cells[0].1),cells[0].2)).unwrap();
    assert_eq!(assign_open_ground_caps(&g::rectangle(-1.,-1.,12.,12.),&mut cells,&[]),0);
    assert_eq!(snapshot,serde_json::to_vec(&(cells[0].0.clone(),format!("{:?}",cells[0].1),cells[0].2)).unwrap());
    assert_eq!(assign_open_ground_caps(&g::rectangle(-1.,-1.,12.,12.),&mut cells,&[g::rectangle(10.02,0.,10.52,0.5)]),1);
    assert_eq!(cells[0].0,before);assert_eq!(cells[0].1,Hold::Dwelling);assert_eq!(cells.len(),1);
    assert_eq!(snapshot,serde_json::to_vec(&(cells[0].0.clone(),format!("{:?}",cells[0].1),cells[0].2)).unwrap());
}
