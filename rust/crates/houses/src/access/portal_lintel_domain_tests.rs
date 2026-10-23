//! Register as a cfg(test) child of access; no B06-specific gate or recipe.
use super::*;

fn fixture(walls: &[(f64, f64)], top: f64, shell: bool, solid: bool) -> (HouseUnit, String, String, [Point;2], Surface, Surface) {
    let mut unit=super::batches25_tests::lower_corridor();
    unit.bodies.clear(); unit.rooms.clear(); unit.walls.clear(); unit.features.clear();
    unit.access.nodes.clear(); unit.access.portals.clear();
    let gap=walls.iter().map(|(y,d)|y+d).fold(0_f64,f64::max);
    let a=rectangle(-2.,-1.,4.,1.);
    let b=rectangle(-2.,gap,4.,1.);
    let (opening,passage)=candidate(&a,&b,0.85,1.8,&[]).unwrap();
    let from=node(&mut unit,AccessKind::Exterior,a,0.);
    let to=node(&mut unit,AccessKind::Circulation,b,0.);
    unit.access.root=from.clone();
    for (i,(y,d)) in walls.iter().enumerate() {
        let footprint=rectangle(-2.,*y,4.,*d);
        unit.walls.push(Wall {
            id:format!("actual-wall-{i}"), kind:if shell {WallKind::Shell}else{WallKind::Enclosure},
            body_id:None,level:0,z_m:0.,height_m:top,
            solid:solid.then(||crate::wall_geometry::prism_solid(&footprint[0],0.,top).unwrap()),
            footprint,centerline:vec![point(-2.,y+d*0.5),point(2.,y+d*0.5)],
            material:"MAT-STONE-RUBBLE".into(),party:false,opening_ids:vec![],
            plan_section:None,shell_reference:shell,
        });
    }
    let actual=unite(&unit.walls.iter().map(|w|w.footprint.clone()).collect::<Vec<_>>());
    (unit,from,to,opening,passage,actual)
}

#[test]
fn plain_lintels_follow_actual_wall_sections_not_landings_or_between_wall_gaps() {
    for walls in [vec![(0.,0.426)],vec![(0.,0.18),(0.55,0.23)]] {
        let (mut unit,from,to,opening,passage,actual)=fixture(&walls,3.,false,false);
        let expected=intersection(&actual,&passage);
        let passage_bytes=serde_json::to_vec(&passage).unwrap();
        portal_with_profile(&mut unit,&from,&to,PortalKind::Door,opening,passage.clone(),0.85,vec![],None).unwrap();
        let lintels:Vec<_>=unit.features.iter().filter(|f|f.kind==FeatureKind::PortalLintel).collect();
        assert_eq!(lintels.len(),1,"one real feature retained, never omitted");
        let f=lintels[0];
        assert!(area(&difference(&f.surface,&expected))<0.000001);
        assert!(area(&difference(&expected,&f.surface))<0.000001);
        assert!(area(&difference(&passage,&expected))>0.3,"causal old landing/gap artefact");
        assert_eq!(f.height_m,0.25);
        assert_eq!(f.z_m,2.05);
        let p=unit.access.portals.last().unwrap();
        assert_eq!(serde_json::to_vec(&p.passage).unwrap(),passage_bytes);
        assert_eq!(p.opening,opening);
        let ground=unite(&unit.walls.iter().map(|w|wall_section(w,0.01)).collect::<Vec<_>>());
        assert!(area(&intersection(&ground,&passage))<0.000001);
        let upper=unite(&unit.walls.iter().map(|w|wall_section(w,f.z_m+f.height_m*0.5)).collect::<Vec<_>>());
        assert!(area(&difference(&f.surface,&upper))<0.000001);
    }
}

#[test]
fn plain_lintel_height_ends_at_actual_top_and_low_gates_remain_open() {
    let (mut unit,from,to,opening,passage,_)=fixture(&[(0.,0.426)],2.08,false,false);
    portal_with_profile(&mut unit,&from,&to,PortalKind::Door,opening,passage,0.85,vec![],None).unwrap();
    let f=unit.features.iter().find(|f|f.kind==FeatureKind::PortalLintel).unwrap();
    assert!((f.height_m-0.03).abs()<1e-12);
    assert!(f.z_m+f.height_m<=2.08);
    for top in [1.4,2.,2.04,2.05,2.0505] {
        let (mut unit,from,to,opening,passage,_)=fixture(&[(0.,0.426)],top,false,false);
        portal_with_profile(&mut unit,&from,&to,PortalKind::Gate,opening,passage.clone(),0.85,vec![],None).unwrap();
        assert_eq!(unit.access.portals.len(),1,"a low gate needs no invented overhead beam");
        assert!(!unit.features.iter().any(|f|f.kind==FeatureKind::PortalLintel));
        let ground=unite(&unit.walls.iter().map(|w|wall_section(w,0.01)).collect::<Vec<_>>());
        assert!(area(&intersection(&ground,&passage))<0.000001);
    }
    for top in [2.0511,2.0516] {
        let (mut unit,from,to,opening,passage,_)=fixture(&[(0.,0.426)],top,false,false);
        portal_with_profile(&mut unit,&from,&to,PortalKind::Door,opening,passage,0.85,vec![],None).unwrap();
        let f=unit.features.iter().find(|f|f.kind==FeatureKind::PortalLintel).unwrap();
        assert!(f.height_m>0. && f.height_m<=top-f.z_m);
        assert!(f.z_m+f.height_m<=top);
        let upper=unite(&unit.walls.iter().map(|w|wall_section(w,f.z_m+f.height_m*0.5)).collect::<Vec<_>>());
        assert!(area(&difference(&f.surface,&upper))<0.000001);
    }

    let (mut unit,from,to,opening,passage,_)=fixture(&[(0.,0.18),(0.55,0.23)],3.,false,false);
    unit.walls[0].height_m=1.4;
    let upper_expected=intersection(&unit.walls[1].footprint,&passage);
    portal_with_profile(&mut unit,&from,&to,PortalKind::Gate,opening,passage,0.85,vec![],None).unwrap();
    assert_eq!(unit.access.portals.len(),1);
    let f=unit.features.iter().find(|f|f.kind==FeatureKind::PortalLintel).unwrap();
    assert!(area(&difference(&f.surface,&upper_expected))<0.000001);
    assert!(area(&difference(&upper_expected,&f.surface))<0.000001);
    assert_eq!(f.height_m,0.25,"a low fence does not remove another wall's real lintel");
}

#[test]
fn shell_reference_profile_and_solid_paths_remain_separate() {
    let (mut unit,from,to,opening,passage,_)=fixture(&[(0.,0.426)],3.,true,false);
    portal_with_profile(&mut unit,&from,&to,PortalKind::Door,opening,passage.clone(),0.85,vec![],None).unwrap();
    let f=unit.features.iter().find(|f|f.kind==FeatureKind::PortalLintel).unwrap();
    assert_eq!(f.surface,passage,"shell's separate support model is outside this correction");
    assert_eq!(f.height_m,0.25);
    for solid in [false,true] {
        let (mut unit,from,to,opening,passage,_)=fixture(&[(0.,0.426)],3.,false,solid);
        let profile=crate::catalogue::PortalSpec {
            id:"profile-stays-physical".into(),shape:crate::catalogue::PortalShape::Rect,
            width_m:0.85,top_width_m:0.85,head_m:2.05,sill_m:0.,min_clear_height_m:1.8,
        };
        portal_with_profile(&mut unit,&from,&to,PortalKind::Door,opening,passage.clone(),0.85,vec![],
            if solid {None}else{Some(&profile)}).unwrap();
        assert!(!unit.features.iter().any(|f|f.kind==FeatureKind::PortalLintel));
        assert!(unit.walls.iter().any(|w|w.solid.is_some()));
        let ground=unite(&unit.walls.iter().map(|w|wall_section(w,0.01)).collect::<Vec<_>>());
        assert!(area(&intersection(&ground,&passage))<0.000001);
    }
}
