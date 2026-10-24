use super::*;
use super::super::super::{geometry as g,generate_parcels};

#[test]
fn no_rejected_path_cap_keeps_each_original_segment_cutter_exact() {
    let pieces=vec![g::rectangle(0.,0.,10.,3.),g::rectangle(10.,0.,20.,3.)];
    let before=serde_json::to_vec(&pieces).unwrap();
    let after:Vec<_>=retained_cutters(pieces,&[],&[]).into_iter().map(|(p,_)|p).collect();
    assert_eq!(before,serde_json::to_vec(&after).unwrap());
}

#[test]
fn rejected_cap_stays_in_its_original_cell_without_a_new_microparcel() {
    let cell=g::rectangle(0.,0.,10.,10.);
    let pieces=vec![g::rectangle(0.,0.,10.,3.)];
    let cap=g::rectangle(9.5,2.5,10.,3.);
    let retained=Shape{outer:vec![Point{x:0.,y:0.},Point{x:10.,y:0.},Point{x:10.,y:2.5},Point{x:9.5,y:2.5},Point{x:9.5,y:3.},Point{x:0.,y:3.}],holes:vec![]};
    let cutters=retained_cutters(pieces,&[retained],&[cap.clone()]);
    let kept=cut_out(cell,&cutters);
    assert_eq!(kept.len(),1,"restore the cap to the same connected cell");
    assert_eq!(area(&kept[0]),70.25);
    assert!(g::difference(&cap,&kept[0]).is_empty());
    assert!(cutters.iter().all(|(p,_)|g::intersection(p,&cap).is_empty()));
}

#[test]
fn a_rejected_fragment_outside_a_cutter_cannot_change_it() {
    let pieces=vec![g::rectangle(0.,0.,10.,3.)];let before=serde_json::to_vec(&pieces).unwrap();
    let after:Vec<_>=retained_cutters(pieces,&[],&[g::rectangle(100.,100.,100.5,100.5)]).into_iter().map(|(p,_)|p).collect();
    assert_eq!(before,serde_json::to_vec(&after).unwrap());
}

#[test]
fn rejected_overlap_never_reopens_land_owned_by_a_retained_path() {
    let raw=g::rectangle(0.,0.,10.,3.);let cap=g::rectangle(9.5,2.5,10.,3.);
    let retained=vec![g::rectangle(0.,0.,9.75,3.),g::rectangle(9.75,0.,10.,2.5)];
    let cutters=retained_cutters(vec![raw],&retained,&[cap]);
    let restored=cut_out(g::rectangle(0.,0.,10.,10.),&cutters);
    assert_eq!(restored.len(),1);assert_eq!(area(&restored[0]),70.125);
    for p in &retained {
        assert!(g::intersection(&restored[0],p).is_empty(),"a retained path is never reopened");
    }
}

#[test]
fn captured_inuit_public_parcel_chain_preserves_partition_paths_and_original_demands() {
    let fixture:serde_json::Value=serde_json::from_slice(include_bytes!("fixtures/organic-inuit-discarded-cap-context.json")).unwrap();
    let layout:Layout=serde_json::from_value(fixture["layout"].clone()).unwrap();
    let baseline:Partition=serde_json::from_value(fixture["baselinePartition"].clone()).unwrap();
    let expected_programme=serde_json::to_value(layout.programme.as_ref().unwrap()).unwrap();
    let result=generate_parcels("camp-consumer-synthetic-v2",std::slice::from_ref(&layout),&ParcelConfig::default()).unwrap();
    let result=&result[0];
    assert_eq!(result.parcels.len(),baseline.parcels.len(),"no extra property for the discarded cap");
    let paths=|p:&Partition|p.parcels.iter().filter(|p|p.use_kind=="court" && p.reason=="shared-footpath").count();
    assert_eq!(paths(result),paths(&baseline),"the retained route parcels are not removed or multiplied");
    for (bi,b) in layout.blocks.iter().enumerate() {
        let cells:Vec<_>=result.parcels.iter().filter(|p|p.block==bi).collect();
        let total:f64=cells.iter().map(|p|area(&p.shape)).sum();
        assert!((total-area(&b.shape)).abs()<0.01,"block{bi} lost {}",area(&b.shape)-total);
        for (i,p) in cells.iter().enumerate() {
            assert!(g::difference(&p.shape,&b.shape).iter().map(area).sum::<f64>()<0.01);
            for q in &cells[..i] {
                if boxes_overlap(bbox(&p.shape),bbox(&q.shape)) {
                    assert!(g::intersection(&p.shape,&q.shape).iter().map(area).sum::<f64>()<0.01);
                }
            }
        }
    }
    let actual_programme=serde_json::to_value(result.programme.as_ref().unwrap()).unwrap();
    assert_eq!(actual_programme["population"],expected_programme["population"]);
    let originals=expected_programme["demands"].as_array().unwrap();
    let baseline_programme=serde_json::to_value(baseline.programme.as_ref().unwrap()).unwrap();
    let baseline_demands=baseline_programme["demands"].as_array().unwrap();
    let after=actual_programme["demands"].as_array().unwrap();
    // Allocation already added the garden remainder BEFORE this geometry fix.
    // Compare the same phase, and retain every original request strictly.
    assert_eq!(originals.len(),6);assert_eq!(baseline_demands.len(),7);
    assert_eq!(after.len(),baseline_demands.len(),"no new or hidden demand");
    for a in originals {
        let b=after.iter().find(|b|b["id"]==a["id"]).expect("original demand retained");
        for key in ["id","function","role","unit","requested","targetArea","targetFrontage"] { assert_eq!(a[key],b[key],"{key}"); }
    }
    let derived_before:Vec<_>=baseline_demands.iter().filter(|d|!originals.iter().any(|a|a["id"]==d["id"])).collect();
    let derived_after:Vec<_>=after.iter().filter(|d|!originals.iter().any(|a|a["id"]==d["id"])).collect();
    assert_eq!(derived_before.len(),1);assert_eq!(derived_after.len(),1);
    let (old_garden,garden)=(derived_before[0],derived_after[0]);
    assert_eq!(garden["role"],"open.garden");
    for key in ["id","function","role","unit","targetFrontage","provenance"] { assert_eq!(old_garden[key],garden[key],"existing derived garden {key}"); }
    let allocations=actual_programme["allocations"].as_array().unwrap();
    let garden_area:f64=result.parcels.iter().filter(|p|allocations.iter().any(|a|a["demandId"]==garden["id"] && a["parcelId"]==p.id)).map(|p|area(&p.shape)).sum();
    assert_eq!(garden["requested"].as_f64().unwrap(),garden_area,"same programme::allocate sum of actual garden land");
    assert_eq!(garden["targetArea"],garden["requested"]);
    let restored_area=result.parcels.iter().map(|p|area(&p.shape)).sum::<f64>()-baseline.parcels.iter().map(|p|area(&p.shape)).sum::<f64>();
    let derived_growth=garden["requested"].as_f64().unwrap()-old_garden["requested"].as_f64().unwrap();
    assert!(derived_growth>0.,"restored land is accounted as derived garden, not housing");
    assert!((derived_growth-restored_area).abs()<0.01,"garden delta follows the actual restored land, same geometric conservation bound");
    for demand in after { assert_eq!(demand["builtCapacity"],serde_json::json!(0.0),"no built credit for original or derived land"); }
}
