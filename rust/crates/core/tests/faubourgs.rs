//! Public-pipeline regression: gate strength preserves the old endpoint and demand.
use magna_urbis_core::urban::{LayoutConfig,Site,Street,Surface,generate_quarters};
use geo::{Area,BooleanOps,LineString,Polygon};
fn land(quarters:&[magna_urbis_core::urban::Quarter])->geo::MultiPolygon<f64> {
    let ring=|points:&Vec<magna_urbis_core::urban::Point>| {
        let mut p:Vec<_>=points.iter().map(|p|(p.x,p.y)).collect();if let Some(a)=p.first().copied() {p.push(a);}
        LineString::from(p)
    };
    let polygons:Vec<_>=quarters.iter().map(|q|Polygon::new(ring(&q.shape.outer),q.shape.holes.iter().map(ring).collect())).collect();
    geo::algorithm::bool_ops::unary_union(&polygons)
}
#[test]
fn gate_strength_preserves_zero_endpoint_and_population_budget() {
    let n=128;let height=vec![10.0;n*n];let water=vec![0;n*n];
    let surface=Surface {width:2048.0,n,height:&height,water:&water,geometry:None};
    let site:Site=serde_json::from_value(serde_json::json!({"key":"faubourgs","name":"faubourgs",
        "culture":"european-organic","population":10000,"center":{"x":1000,"y":1000},"radius":320})).unwrap();
    let roads:Vec<Street>=serde_json::from_value(serde_json::json!([
        {"path":[{"x":200,"y":1000},{"x":1800,"y":1000}],"rank":1,"widths":[6,6],"role":"regional"},
        {"path":[{"x":1000,"y":200},{"x":1000,"y":1800}],"rank":1,"widths":[6,6],"role":"regional"}])).unwrap();
    let base=LayoutConfig {fortification:"wall".into(),..Default::default()};
    let old=generate_quarters("faubourgs",&[site.clone()],&base,surface,&roads).unwrap();
    let mut previous=vec![];
    for strength in [0.0,0.5,1.0] {
        let cfg=LayoutConfig {gate_village:Some(strength),..base.clone()};
        let layouts=generate_quarters("faubourgs",&[site.clone()],&cfg,surface,&roads).unwrap();
        let l=&layouts[0];
        // Facility carving can re-express polygon boundaries at sub-mm precision.
        let changed=land(&l.quarters).xor(&land(&old[0].quarters)).unsigned_area();
        assert!(changed<1.0,"moved inherited land by {changed} m2 at {strength}");
        if strength==0.0 {
            for key in ["quarters","blocks","streets","enclosures","phases"] {
                assert_eq!(serde_json::to_value(l).unwrap()[key],serde_json::to_value(&old[0]).unwrap()[key],"zero changed {key}");
            }
        } else {
            assert!(l.structure.as_ref().is_some_and(|s|!s.gate_village_centers.is_empty()),"missing gate nucleus at {strength}");
            assert!(l.blocks.iter().any(|b|b.kind=="place" && b.zone=="faubourg"));
            for lane in l.streets.iter().filter(|s|s.role=="faubourg-lane") {
                for p in [lane.path[0],*lane.path.last().unwrap()] {
                    assert!(l.streets.iter().filter(|s|s.rank<=1).any(|s|s.path.contains(&p)),"unconnected faubourg lane");
                }
            }
        }
        let population=l.phases.iter().map(|p|p.population).sum::<f64>();
        assert!((population-10000.0).abs()<0.01,"lost population at {strength}");
        let land=serde_json::to_value(&l.phases).unwrap();
        if !previous.is_empty() {assert_eq!(land,previous[0],"strength changed inherited growth land");}
        previous=vec![land];
    }
}
