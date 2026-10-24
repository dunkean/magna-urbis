use super::*;
fn real41() -> Shape { serde_json::from_str(include_str!("fixtures/foundation-medina-block41.json")).unwrap() }
fn real() -> Shape { serde_json::from_str(include_str!("fixtures/foundation-medina-block27.json")).unwrap() }
fn near(x:f64,up:bool) -> f64 {
    if x==0. { return if up {f64::from_bits(1)} else {-f64::from_bits(1)}; }
    let bits=x.to_bits(); f64::from_bits(if (x>0.)==up {bits+1} else {bits-1})
}
fn dense_rect(size:f64) -> Shape {
    let mut outer=Vec::new();
    for i in 0..16 { outer.push(Point{x:size*i as f64/16.,y:0.}); }
    for i in 0..16 { outer.push(Point{x:size,y:size*i as f64/16.}); }
    for i in 0..16 { outer.push(Point{x:size-size*i as f64/16.,y:size}); }
    for i in 0..16 { outer.push(Point{x:0.,y:size-size*i as f64/16.}); }
    Shape{outer,holes:vec![]}
}
#[test]
fn foundation_index_point_predicate_is_exact_on_the_real594_vertex_contour_and_boundaries() {
    let mut shapes=vec![real(),real41(),dense_rect(40.)];
    let mut holed=dense_rect(40.);holed.holes.push(vec![Point{x:10.,y:10.},Point{x:30.,y:10.},Point{x:30.,y:30.},Point{x:10.,y:30.}]);shapes.push(holed);
    for shape in &shapes {
        let index=foundation::PointIndex::new(shape).unwrap();let(x0,y0,x1,y1)=geometry::bbox(shape);
        let check=|p|assert_eq!(index.contains(p,&mut None),geometry::contains(shape,p),"point {p:?}");
        for i in -2..=82 {for j in -2..=82 {check(Point{x:x0+(x1-x0)*i as f64/80.,y:y0+(y1-y0)*j as f64/80.});}}
        // Exact ordinate-bin boundaries, including the final row and horizontal edges.
        for row in 0..=64 {let y=y0+(y1-y0)*row as f64/64.;for x in [x0,x1,(x0+x1)*0.5] {check(Point{x,y});}}
        for p in shape.outer.iter().chain(shape.holes.iter().flatten()) {
            check(*p);for up in [false,true] {check(Point{x:near(p.x,up),y:p.y});check(Point{x:p.x,y:near(p.y,up)});}
        }
        for p in [Point{x:f64::NAN,y:0.},Point{x:f64::INFINITY,y:0.},Point{x:f64::NEG_INFINITY,y:0.}] {check(p);}
    }
}
#[test]
fn foundation_index_rectangle_predicate_matches_the_original_edge_first_order_exactly() {
    for shape in [real(),real41()] {
    assert!([594,317].contains(&shape.outer.len()));let index=foundation::PointIndex::new(&shape).unwrap();
    let(x0,y0,x1,y1)=geometry::bbox(&shape);
    for u in [Point{x:1.,y:0.},Point{x:0.,y:1.},Point{x:0.6,y:0.8},Point{x:std::f64::consts::FRAC_1_SQRT_2,y:std::f64::consts::FRAC_1_SQRT_2}] {
        let v=Point{x:-u.y,y:u.x};
        for i in 0..=18 {for j in 0..=18 {
            let a=Point{x:x0+(x1-x0)*i as f64/18.,y:y0+(y1-y0)*j as f64/18.};
            for(width,depth)in[(4.,6.),(28.12000000476837,28.320000002384184)] {
                assert_eq!(rect_within_search(&shape,a,u,v,width,depth,Some(&index),&mut None),rect_within(&shape,a,u,v,width,depth));
            }
        }}
    }
    }
}
#[test]
fn foundation_index_preserves_bound_bits_grid_samples_and_local_geometry_lifetime() {
    let mut shape=dense_rect(40.);let mut hole=dense_rect(10.).outer;for p in &mut hole {p.x+=15.;p.y+=15.;}shape.holes.push(hole);
    let n=32;let water=vec![0;n*n];let flat=vec![0.;n*n];let hill:Vec<f32>=(0..n*n).map(|i|((i%n)as f32)*0.025).collect();
    let dirs=[Point{x:1.,y:0.},Point{x:0.6,y:0.8}];
    for height in [&flat,&hill] {
        let surface=Surface{geometry:None,width:100.,n,height,water:&water};
        for recipe in ["AF-MAG-B01","AF-MAG-B02"] {let w=recipe_sources(recipe)[0];
            for step in [0.5,1.] {for stop in [-1.,MAX_FOUNDATION_STEP+0.02] {
                let old=pose_lower_bound_step_mode(surface,&shape,&dirs,w,stop,step,false);
                let new=pose_lower_bound_step_mode(surface,&shape,&dirs,w,stop,step,true);
                assert_eq!(old.to_bits(),new.to_bits(),"{recipe}, step={step}, stop={stop}");
            }}
        }
    }
    // A subsequent query builds its own borrowed index from a different contour.
    let mut reduced=shape.clone();for p in &mut reduced.outer {p.x*=0.25;p.y*=0.25;}reduced.holes.clear();
    let index=foundation::PointIndex::new(&reduced).unwrap();let p=Point{x:20.,y:20.};
    assert_eq!(index.contains(p,&mut None),geometry::contains(&reduced,p));
    assert!(!index.contains(p,&mut None));
}

#[test]
fn foundation_index_center_is_only_necessary_and_never_admits_a_rectangle_crossing_a_hole_or_concavity() {
    let concave=Shape {outer:vec![Point{x:0.,y:0.},Point{x:10.,y:0.},Point{x:10.,y:10.},Point{x:6.,y:10.},Point{x:6.,y:4.},Point{x:4.,y:4.},Point{x:4.,y:10.},Point{x:0.,y:10.}],holes:vec![]};
    let mut holed=dense_rect(40.);holed.holes.push(vec![Point{x:10.,y:10.},Point{x:30.,y:10.},Point{x:30.,y:30.},Point{x:10.,y:30.}]);
    for(shape,a,width,depth)in[(&concave,Point{x:1.,y:1.},8.,4.),(&holed,Point{x:0.,y:0.},12.,12.)] {
        let u=Point{x:1.,y:0.};let v=Point{x:0.,y:1.};let index=foundation::PointIndex::new(shape).unwrap();
        assert!(index.contains(rect_center(a,u,v,width,depth),&mut None),"centre must pass the preliminary test");
        assert!(!rect_within_search(shape,a,u,v,width,depth,Some(&index),&mut None),"original exact edge test must still refuse");
        assert!(!rect_within(shape,a,u,v,width,depth));
    }
}
