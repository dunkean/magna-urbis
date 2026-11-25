use super::*;
#[test]
fn camp_destination_paths_keep_their_bends_and_widths_but_real_through_routes_survive() {
    let envelope = g::rectangle(0., 0., 200., 200.);
    let road = Street { path: vec![Point{x:0.,y:100.},Point{x:200.,y:100.}], widths:vec![6.,8.],rank:0,role:"regional".into() };
    let mut streets = vec![road.clone()];
    camp_approaches(&mut streets, &envelope, 3., true);
    assert_eq!(serde_json::to_vec(&streets).unwrap(), serde_json::to_vec(&vec![road]).unwrap());
    let inbound = Street { path: vec![Point{x:0.,y:100.},Point{x:8.,y:102.},Point{x:16.,y:100.},Point{x:100.,y:100.}],
        widths: vec![2.1;4], rank:2, role:"regional".into() };
    streets = vec![inbound.clone()];
    camp_approaches(&mut streets, &envelope, 3., true);
    // Repeat the post-routing pass: clipping is stable, the bends are not replaced.
    camp_approaches(&mut streets, &envelope, 3., true);
    assert_eq!(streets.len(), 1);
    assert_eq!(&streets[0].path[..3], &inbound.path[..3]);
    assert!(streets[0].path.last().unwrap().x <= 24.01);
    assert!(streets[0].widths.iter().all(|&w| (w - 2.1).abs() < 1e-9));
}
#[test]
fn an_existing_crossing_and_wholly_internal_access_are_never_dropped() {
    let envelope = g::rectangle(0., 0., 200., 200.);
    let make=|role:&str,path:Vec<Point>|Street{widths:vec![6.;path.len()],path,rank:0,role:role.into()};
    let original=vec![make("bridge",vec![Point{x:0.,y:100.},Point{x:200.,y:100.}]),make("regional",vec![Point{x:80.,y:100.},Point{x:120.,y:100.}])];
    let mut streets=original.clone();camp_approaches(&mut streets,&envelope,3.,true);
    assert_eq!(serde_json::to_vec(&streets).unwrap(),serde_json::to_vec(&original).unwrap());
}
#[test]
fn a_generated_camp_entrance_keeps_the_relay_to_its_inner_paths() {
    let envelope=g::rectangle(0.,0.,200.,200.);let c=Point{x:100.,y:100.};
    let guide=Street{path:vec![Point{x:0.,y:100.},c],widths:vec![5.;2],rank:1,role:"street".into()};
    let mut streets=vec![guide];
    assert!(camp_entrance(&mut streets,&envelope,c,100.,&[]));
    assert_eq!(streets.len(),1);
    assert!(dist(*streets[0].path.last().unwrap(),c)<50.01);
    let mut regional=streets.clone();regional[0].role="regional".into();
    assert!(!camp_entrance(&mut regional,&envelope,c,100.,&[]));
}
#[test]
fn a_steep_discarded_drive_does_not_disqualify_two_dry_entrances() {
    let envelope=g::rectangle(100.,100.,300.,300.);
    let height=(0..64*64).map(|i|if (30..34).contains(&(i%64)){1000.}else{10.}).collect::<Vec<f32>>();
    let water=vec![0;64*64];let surface=Surface{geometry:None,width:400.,n:64,height:&height,water:&water, interpolation: Default::default(),};
    let road=Street{path:vec![Point{x:100.,y:200.},Point{x:300.,y:200.}],widths:vec![6.;2],rank:0,role:"regional".into()};
    assert!(!routing::path_clear(surface,&road.path,0.12));
    let mut entrances=vec![Street {path:vec![road.path[0],Point{x:200.,y:200.}],..road.clone()},
        Street {path:vec![Point{x:200.,y:200.},road.path[1]],..road}];
    camp_approaches(&mut entrances,&envelope,3.,true);
    assert_eq!(entrances.len(),2);
    assert!(entrances.iter().all(|s|routing::path_clear(surface,&s.path,0.12)));
}
#[test]
fn regional_role_preserves_every_real_entrance_independently_of_rank() {
    let envelope=g::rectangle(0.,0.,200.,200.);let c=Point{x:100.,y:100.};
    let make=|a,b,rank|Street{path:vec![a,b],widths:vec![6.;2],rank,role:"regional".into()};
    let mut roads=vec![make(Point{x:0.,y:100.},c,1),make(Point{x:100.,y:0.},c,2),make(c,Point{x:200.,y:100.},0)];
    let original=serde_json::to_vec(&roads).unwrap();
    camp_entrance(&mut roads,&envelope,c,100.,&[]);
    assert_eq!(serde_json::to_vec(&roads).unwrap(),original,"A regional role is not a generated footprint guide");
    camp_approaches(&mut roads,&envelope,3.,true);assert_eq!(roads.len(),3);
}
