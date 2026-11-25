use super::*;
#[test]
fn v7_grid_armature_follows_rotated_component() {
    let a = 0.37f64;
    let domain = Shape {outer:[(-180.,-110.),(180.,-110.),(180.,110.),(-180.,110.)].into_iter()
        .map(|(x,y)|Point{x:500.+x*a.cos()-y*a.sin(),y:500.+x*a.sin()+y*a.cos()}).collect(),holes:vec![]};
    let site = Site {key:"grid".into(),name:"Grid".into(),population:500,culture:"indus-planned".into(),center:Point{x:500.,y:500.},radius:200., neighbours: Vec::new()};
    let cfg = LayoutConfig {align_enclosed_grid:true,fortification:"wall".into(),tissue:"grid".into(),count:4,..Default::default()};
    let m = super::super::resolve("indus-planned","culture","core","core",1.,&serde_json::json!({"minWidth":10,"gridSpacing":[80,80]}),"quarters").unwrap();
    let height=vec![10.;32*32];let water=vec![0;32*32];
    let surface=Surface {geometry:None,width:1000.,n:32,height:&height,water:&water, interpolation: Default::default(),};
    let p=generate_oriented_domain("v7-grid",&site,&cfg,&m,surface,&[],200.,Some(&domain),None);
    let lines:Vec<_>=p.streets.iter().filter(|s|s.role=="street" && s.path.len()>=2 && dist(s.path[0],*s.path.last().unwrap())>20.).collect();
    assert!(!lines.is_empty(),"{} quarters, {:?}",p.quarters.len(),p.warnings);
    for s in lines {
        let end=s.path.last().unwrap();
        let angle=(end.y-s.path[0].y).atan2(end.x-s.path[0].x);
        assert!((2.*(angle-a)).sin().abs()<1e-5,"{angle} vs {a}");
    }
}
