//! Port placement never changes the town centre or its service programme.
use super::*;

fn reach(site: &Site) -> f64 {
    (f64::from(site.population.max(1)).sqrt()*12.0).clamp(180.0,2400.0)
}
pub(in super::super::super) fn blocks(shape: &Shape) -> Vec<Shape> {
    let (x0,y0,x1,y1)=g::bbox(shape);
    let mut blocks=vec![];
    for x in (x0/80.0).floor() as i64..=(x1/80.0).floor() as i64 {
        for y in (y0/80.0).floor() as i64..=(y1/80.0).floor() as i64 {
            let cell=g::rectangle(x as f64*80.0,y as f64*80.0,(x+1) as f64*80.0,(y+1) as f64*80.0);
            blocks.extend(g::intersection(shape,&cell).into_iter().filter(|s|g::area(s)>1.0));
        }
    }
    blocks
}
fn gap(p: Point, shapes: &[Shape]) -> f64 {
    shapes.iter().map(|s| if g::contains(s,p) {0.0} else {
        (0..s.outer.len()).map(|i|g::distance(p,s.outer[i],s.outer[(i+1)%s.outer.len()]).0)
            .fold(f64::INFINITY,f64::min)
    }).fold(f64::INFINITY,f64::min)
}
// Streets separate quarters, while an outpost across open country stays separate.
fn fabric(regions: &[Shape], site: &Site) -> Vec<Shape> {
    let Some(main)=regions.iter().position(|s|g::contains(s,site.center)).or_else(||
        (0..regions.len()).max_by(|&a,&b|g::area(&regions[a]).total_cmp(&g::area(&regions[b])))) else {return vec![]};
    let mut selected=vec![main];
    loop {
        let extra:Vec<_>=(0..regions.len()).filter(|i|!selected.contains(i)).filter(|&i|
            selected.iter().any(|&j| regions[i].outer.iter().step_by(regions[i].outer.len().div_ceil(80).max(1))
                .any(|&p|gap(p,std::slice::from_ref(&regions[j]))<35.0))).collect();
        if extra.is_empty() {break;}
        selected.extend(extra);
    }
    selected.into_iter().map(|i|regions[i].clone()).collect()
}
fn score(path: &[Point], main: &[Shape], surface: Surface<'_>, site: &Site, cfg: &LayoutConfig) -> Option<f64> {
    if !shore_front(path,surface) {return None;}
    let water=shelter::water(surface,path)?;
    let p=*sub_path(path,0.0,length(path)*0.5).last()?;
    let distance=gap(p,main);
    if distance>35.0+reach(site) {return None;}
    let d=cfg.port_detachment;
    if distance>80.0+reach(site)*d {return None;}
    let sheltered=water.exposure-water.depth/600.0+if water.sheltered {0.0} else {0.8};
    Some((1.0-d)*(distance/reach(site)).powi(2)+d*(0.25+0.75*shelter_weight(cfg))*sheltered
        +1e-5*dist(p,site.center)/site.radius.max(100.0))
}

// Reuse a real approach before searching a new road. A large search lattice
// can miss a narrow pass that the existing road already traverses safely.
fn approach(p: Point, streets: &[Street], main: &[Shape], surface: Surface<'_>, grade: f64) -> Option<(Vec<Point>,usize)> {
    for (si,s) in streets.iter().enumerate().filter(|(_,s)|s.path.len()>2 && !matches!(s.role.as_str(),"quay"|"pier"|"mole"|"landing")) {
        if !s.path.iter().any(|&p|gap(p,main)<5.0) {continue;}
        let (segment,(_,_,q))=s.path.windows(2).enumerate().map(|(i,w)|(i,g::distance(p,w[0],w[1])))
            .min_by(|a,b|a.1.0.total_cmp(&b.1.0))?;
        if dist(p,q)>80.0 || !routing::segment_clear(surface,p,q,grade) {continue;}
        for forward in [true,false] {
            let mut path=vec![p,q];
            let indices:Vec<_>=if forward {(segment+1..s.path.len()).collect()} else {(0..=segment).rev().collect()};
            for i in indices {
                path.push(s.path[i]);
                if gap(s.path[i],main)<5.0 {
                    if routing::path_clear(surface,&path,grade) {return Some((path,si));}
                    break;
                }
            }
        }
    }
    None
}

// A cliff ramp can run almost along the bank. The router's sixteen lattice
// headings cannot express these shallow switchbacks, even with fine cells.
fn bank_ramp(p: Point, q: Point, surface: Surface<'_>, grade: f64, range: f64) -> Option<Vec<Point>> {
    let t=left(unit(p,q));
    let mut found=vec![];
    for offset in [20.0,40.0,80.0,120.0,160.0,240.0,320.0,480.0,640.0] {
        if offset>range*0.5 {break;}
        for anchor in [p,q,super::super::point(p,q,0.5)] {
            for side in [-1.0,1.0] {
                let r=add(anchor,t,offset*side);
                if routing::segment_clear(surface,p,r,grade) && routing::segment_clear(surface,r,q,grade) {
                    found.push(vec![p,r,q]);
                }
            }
        }
    }
    found.into_iter().min_by(|a,b|length(a).total_cmp(&length(b)))
}

pub(super) fn select(pieces: &mut Vec<Piece>, regions: &[Shape], streets: &[Street], surface: Surface<'_>, site: &Site, cfg: &LayoutConfig) {
    // The global shore search already routed this front. Do not rescore its
    // added land as if it had belonged to the original town fabric.
    for road in streets.iter().rev().filter(|s|matches!(s.role.as_str(),"port-road"|"port-stairs"|"port-street")) {
        if let Some(index)=pieces.iter().rposition(|piece|road.path.first()
            .is_some_and(|p|piece.path.windows(2).any(|w|g::distance(*p,w[0],w[1]).0<0.01))) {
            let chosen=pieces.remove(index);pieces.clear();pieces.push(chosen);return;
        }
    }
    let main=fabric(regions,site);
    let span=(f64::from(site.population.max(1)).sqrt()*3.0).clamp(100.0,650.0);
    let mut candidates=vec![];
    for piece in pieces.iter() {
        let total=length(&piece.path);
        let stations=(total/80.0).ceil().clamp(1.0,40.0) as usize;
        for k in 0..stations {
            let from=(total*(k as f64+0.5)/stations as f64-span*0.5).clamp(0.0,(total-span).max(0.0));
            let mut path=sub_path(&piece.path,from,(from+span).min(total));
            let Some(value)=score(&path,&main,surface,site,cfg) else {continue;};
            if landing_streets(&mut path,streets,surface,cfg).is_none() {continue;}
            candidates.push((value,path,piece.river));
        }
    }
    candidates.sort_by(|a,b|a.0.total_cmp(&b.0));
    pieces.clear();
    if let Some((_,path,river))=candidates.into_iter().next() {
        let near=path.iter().map(|&p|dist(p,site.center)).fold(f64::INFINITY,f64::min);
        pieces.push(Piece{path,near,river});
    }
}

/// Add only the selected dry waterfront quarter. Its roads are ordinary urban
/// streets, routed over actual land; the usual block/parcel cuts do the rest.
pub(in super::super::super) fn extend(regions: &[Shape], streets: &mut Vec<Street>, surface: Surface<'_>, site: &Site, cfg: &LayoutConfig, culture: &str) -> Vec<Shape> {
    if !parameterized(cfg) || !port_town(cfg) || surface.n<2 || site.population<800 {return vec![];}
    let main=fabric(regions,site);
    let range=reach(site);
    let cell=surface.width/surface.n as f64;
    let half=(f64::from(site.population).sqrt()*0.85).clamp(45.0,180.0);
    let width=params(culture).quay_width;
    let setback=width*0.5+cell*0.6+0.5;
    let search=(range+site.radius).min(surface.width);
    let at=|v:f64|(v/cell).floor() as i64;
    let n=surface.n as i64;
    let mut banks=vec![];
    for y in at(site.center.y-search).max(1)..=at(site.center.y+search).min(n-2) {
        for x in at(site.center.x-search).max(1)..=at(site.center.x+search).min(n-2) {
            if surface.water[(y*n+x) as usize]!=0 {continue;}
            if ![(1,0),(-1,0),(0,1),(0,-1)].into_iter().any(|(dx,dy)|surface.water[((y+dy)*n+x+dx) as usize]!=0) {continue;}
            let p=Point{x:(x as f64+0.5)*cell,y:(y as f64+0.5)*cell};
            if gap(p,&main)>35.0+range {continue;}
            if banks.iter().any(|&q|dist(p,q)<half*0.8) {continue;}
            banks.push(p);
        }
    }
    let bank_count=banks.len();
    let mut candidates=vec![];
    for bank in banks {
        let rect=g::rectangle(bank.x-half,bank.y-half,bank.x+half,bank.y+half);
        for region in g::dry_clip(&surface,&rect) {
            for run in shore_runs(&region.outer,g::signed(&region.outer)>0.0,surface,(cell*2.0).clamp(6.0,10.0),setback) {
              // A rough stretch must not discard every gentle berth beside it.
              let mut fronts=vec![];let mut front=vec![];
              for w in run.windows(2) {
                if routing::segment_clear(surface,w[0],w[1],cfg.max_street_grade.min(0.05)) {
                    if front.is_empty() {front.push(w[0]);}front.push(w[1]);
                } else if !front.is_empty() {fronts.push(std::mem::take(&mut front));}
              }
              fronts.push(front);
              for path in fronts {
                if length(&path)<40.0 {continue;}
                let Some(value)=score(&path,&main,surface,site,cfg) else {continue;};
                candidates.push((value,path,region.clone()));
              }
            }
        }
    }
    {
        for quay in streets.iter().filter(|s|s.role=="quay") {
            let p=*sub_path(&quay.path,0.0,length(&quay.path)*0.5).last().unwrap();
            let region=regions.iter().min_by(|a,b|gap(p,std::slice::from_ref(*a)).total_cmp(&gap(p,std::slice::from_ref(*b))));
            if let (Some(value),Some(region))=(score(&quay.path,&main,surface,site,cfg),region) {
                candidates.push((value-1e-6,quay.path.clone(),region.clone()));
            }
        }
    }
    candidates.sort_by(|a,b|a.0.total_cmp(&b.0));
    let current=streets.iter().filter(|s|s.role=="quay").filter_map(|s|score(&s.path,&main,surface,site,cfg)).fold(f64::INFINITY,f64::min);
    if std::env::var_os("URBAN_PROFILE").is_some() {
        eprintln!("port extension banks={bank_count} candidates={} current={current:.6}",candidates.len());
        for (value,path,_) in &candidates {let p=*sub_path(path,0.0,length(path)*0.5).last().unwrap();eprintln!("port candidate score={value:.6} gap={:.1} at={p:?}",gap(p,&main));}
    }
    for (value,path,region) in candidates.into_iter() {
        if value>=current {break;}
        let p=*sub_path(&path,0.0,length(&path)*0.5).last().unwrap();
        let town:Vec<_>=streets.iter().filter(|s|!matches!(s.role.as_str(),"quay"|"pier"|"mole"|"landing"))
            .flat_map(|s|main.iter().flat_map(|shape|super::super::clip(s,shape)).collect::<Vec<_>>()).collect();
        let Some((_,q,_))=super::super::nearest(p,&town) else {continue;};
        let connected=approach(p,streets,&main,surface,cfg.max_street_grade);
        let (road,existing)=if let Some((road,si))=connected {(road,Some(si))} else {
            let bounds=(p.x.min(q.x)-160.0,p.y.min(q.y)-160.0,p.x.max(q.x)+160.0,p.y.max(q.y)+160.0);
            let mut targets:Vec<_>=town.iter().flat_map(|s|s.path.windows(2).map(|w|g::distance(p,w[0],w[1]))) .collect();
            targets.sort_by(|a,b|a.0.total_cmp(&b.0));
            let mut planner=routing::RoutePlanner::bank(surface,bounds);
            let mut tried=vec![];
            let targets:Vec<_>=targets.into_iter().filter_map(|(_,_,q)| {
                if tried.iter().any(|&old|dist(old,q)<20.0) {return None;}tried.push(q);
                Some(q)
            }).take(12).collect();
            let road=targets.iter().find_map(|&q|planner.route(p,q,cfg.max_street_grade))
                .or_else(||(gap(p,&main)<=80.0).then(||targets.iter().find_map(|&q|bank_ramp(p,q,surface,cfg.max_street_grade,range))).flatten())
                .or_else(|| {
                // An attached waterfront may descend its bank by the same
                // lanes and stairs as the town. Detached quarters need a road.
                if cfg.port_detachment==1.0 || gap(p,&main)>80.0 {return None;}
                [cfg.max_lane_grade,cfg.max_stair_grade].into_iter()
                    .filter(|&grade|grade<=cfg.max_lane_grade || cfg.allow_stairs)
                    .find_map(|grade|targets.iter().find_map(|&q|planner.route(p,q,grade)
                        .or_else(||bank_ramp(p,q,surface,grade,range))))
            });
            let Some(road)=road else {continue;};
            (road,None)
        };
        // A separate harbour supplies its own landside street and storage
        // frontage; an attached landing shares more of the town's fabric.
        let t=unit(path[0],*path.last().unwrap());
        let depth=(f64::from(site.population).sqrt()*(0.2+0.6*cfg.port_detachment)).clamp(20.0,150.0);
        let row=[left(t),Point{x:t.y,y:-t.x}].into_iter().find_map(|n| {
            [0.0,-8.0,8.0].into_iter().find_map(|offset| {
                let middle=add(p,n,depth+offset);
                let half=(length(&path)*0.5).max(30.0);
                let row=vec![add(middle,t,-half),middle,add(middle,t,half)];
                if !routing::path_clear(surface,&row,cfg.max_street_grade) {return None;}
                let bounds=(p.x.min(middle.x)-160.0,p.y.min(middle.y)-160.0,p.x.max(middle.x)+160.0,p.y.max(middle.y)+160.0);
                let mut planner=routing::RoutePlanner::bank(surface,bounds);
                let link=planner.route(p,middle,cfg.max_street_grade)
                    .or_else(||bank_ramp(p,middle,surface,cfg.max_street_grade,range))?;
                Some((row,link))
            })
        }).or_else(|| {
            // On a narrow bank the approach itself is the storage street.
            let link=sub_path(&road,0.0,depth.min(length(&road)));
            (length(&link)>=20.0 && routing::path_clear(surface,&link,cfg.max_street_grade))
                .then_some((vec![],link))
        });
        let mut shapes=vec![region];
        if let Some((row,link))=&row {
            shapes.extend(g::ribbon(row,&[48.0]).into_iter().chain(g::ribbon(link,&[30.0]))
                .flat_map(|s|g::dry_clip(&surface,&s)));
            shapes=g::union(&shapes);
        }
        if cfg.port_detachment<1.0 {
            let width=60.0*(1.0-cfg.port_detachment);
            shapes.extend(g::ribbon(&road,&[width]).into_iter().flat_map(|s|g::dry_clip(&surface,&s)));
            shapes=g::union(&shapes);
        }
        for old in regions {shapes=shapes.into_iter().flat_map(|s|g::difference(&s,old)).collect();}
        shapes.retain(|s|g::area(s)>500.0);
        if let Some(si)=existing {streets[si].role="port-road".into();}
        streets.retain(|s|s.role!="quay");
        streets.push(Street{widths:vec![width;path.len()],path:path.clone(),rank:1,role:"quay".into()});
        let road=if existing.is_some() {road[..2].to_vec()} else {road};
        if length(&road)>1.0 {
            let steep=road.windows(2).map(|w|routing::segment_grade(surface,w[0],w[1])).fold(0.0,f64::max);
            let stairs=steep>cfg.max_lane_grade;
            streets.push(Street{widths:vec![if stairs {3.0} else {5.0};road.len()],path:road,rank:if stairs {3} else {1},role:if stairs {"port-stairs"} else {"port-road"}.into()});
        }
        if let Some((row,link))=row {
            streets.push(Street{widths:vec![5.0;link.len()],path:link,rank:2,role:"port-street".into()});
            if row.len()>=3 {
                for path in [vec![row[1],row[0]],vec![row[1],row[2]]] {
                    streets.push(Street{widths:vec![4.0;2],path,rank:2,role:"port-street".into()});
                }
            }
        }
        if std::env::var_os("URBAN_PROFILE").is_some() {eprintln!("port chosen score={value:.6} gap={:.1} at={p:?} additions={}",gap(p,&main),shapes.len());}
        return shapes;
    }
    vec![]
}

#[cfg(test)]
mod tests {
    use super::*;
    #[test]
    fn defaults_and_legacy_alias_have_explicit_endpoints() {
        let mut cfg=LayoutConfig::default();
        assert_eq!(cfg.port_detachment,1.0);assert!(!parameterized(&cfg));
        cfg.sheltered_harbour=true;assert_eq!(shelter_weight(&cfg),1.0);
        cfg.port_shelter=Some(0.0);assert!(!parameterized(&cfg));
        cfg.port_detachment=0.5;assert!(parameterized(&cfg));
        for value in [0.0,0.5,1.0] {
            cfg.port_detachment=value;cfg.port_shelter=Some(value);
            let json=serde_json::to_vec(&cfg).unwrap();
            let restored:LayoutConfig=serde_json::from_slice(&json).unwrap();
            assert_eq!(restored.port_detachment,value);assert_eq!(shelter_weight(&restored),value);
        }
    }
    #[test]
    fn detached_quarter_is_outside_the_main_fabric() {
        let site=Site{key:"port".into(),name:String::new(),culture:"hanseatic".into(),population:10000,
            center:Point{x:800.0,y:900.0},radius:500.0};
        let regions=vec![g::rectangle(700.0,800.0,990.0,1100.0),g::rectangle(700.0,1120.0,990.0,1300.0),g::rectangle(700.0,1500.0,990.0,1600.0)];
        assert_eq!(fabric(&regions,&site).len(),2);
        let (n,width)=(200,2000.0);let height=vec![0.0;n*n];
        let water:Vec<u8>=(0..n*n).map(|i|u8::from(i%n>=100)).collect();
        let surface=Surface{geometry:None,n,width,height:&height,water:&water};
        let main=fabric(&regions,&site);
        let path=vec![Point{x:990.0,y:1500.0},Point{x:990.0,y:1600.0}];
        let mut cfg=LayoutConfig{port_detachment:0.0,..LayoutConfig::default()};
        assert!(score(&path,&main,surface,&site,&cfg).is_none(),"zero forbids a distant front");
        cfg.port_detachment=0.5;assert!(score(&path,&main,surface,&site,&cfg).unwrap().is_finite());
        assert!(reach(&Site{population:1000,..site.clone()})<reach(&site));
    }
    #[test]
    fn attached_score_ignores_shelter_and_detached_score_ignores_fabric_distance() {
        let (n,width)=(200,2000.0);let height=vec![0.0;n*n];
        let water:Vec<u8>=(0..n*n).map(|i|u8::from(i%n>=140 || (i%n>=100 && (80..=120).contains(&(i/n))))).collect();
        let surface=Surface{geometry:None,n,width,height:&height,water:&water};
        let site=Site{key:"blend".into(),name:String::new(),culture:"hanseatic".into(),population:10000,
            center:Point{x:1300.0,y:300.0},radius:500.0};
        let main=vec![g::rectangle(1100.0,200.0,1390.0,400.0)];
        let attached=vec![Point{x:1390.0,y:250.0},Point{x:1390.0,y:350.0}];
        let detached=vec![Point{x:990.0,y:900.0},Point{x:990.0,y:1100.0}];
        for shelter in [0.0,0.5,1.0] {
            let mut cfg=LayoutConfig{port_detachment:0.0,port_shelter:Some(shelter),..LayoutConfig::default()};
            let a0=score(&attached,&main,surface,&site,&cfg).unwrap();
            assert!(score(&detached,&main,surface,&site,&cfg).is_none());
            cfg.port_detachment=1.0;
            let a1=score(&attached,&main,surface,&site,&cfg).unwrap();
            let b1=score(&detached,&main,surface,&site,&cfg).unwrap();assert!(b1<a1);
            cfg.port_detachment=0.5;
            assert!((score(&attached,&main,surface,&site,&cfg).unwrap()-(a0+a1)*0.5).abs()<1e-9);
            assert!(score(&detached,&main,surface,&site,&cfg).is_some());
        }
    }
    #[test]
    fn both_port_looks_are_reachable_on_the_same_coast() {
        let (n,width)=(200,2000.0);let height=vec![0.0;n*n];
        let water:Vec<u8>=(0..n*n).map(|i|u8::from(i%n>=140 || (i%n>=100 && (80..=120).contains(&(i/n))))).collect();
        let surface=Surface{geometry:None,n,width,height:&height,water:&water};
        let site=Site{key:"coast".into(),name:String::new(),culture:"hanseatic".into(),population:10000,
            center:Point{x:1300.0,y:300.0},radius:500.0};
        let regions=vec![g::rectangle(1100.0,200.0,1398.0,400.0)];
        let road=Street{path:vec![Point{x:1200.0,y:220.0},Point{x:1300.0,y:380.0}],widths:vec![5.0;2],rank:1,role:"street".into()};
        for d in [0.0,1.0] {
            let cfg=LayoutConfig{site_archetype:"harbor".into(),port_detachment:d,port_shelter:Some(0.75),..LayoutConfig::default()};
            let mut streets=vec![road.clone()];
            let added=extend(&regions,&mut streets,surface,&site,&cfg,"hanseatic");
            let quay=streets.iter().find(|s|s.role=="quay").expect("chosen navigable shore");
            let p=*sub_path(&quay.path,0.0,length(&quay.path)*0.5).last().unwrap();
            if d==0.0 {assert!(gap(p,&regions)<10.0,"attached front {p:?}");}
            else {assert!(gap(p,&regions)>300.0,"detached front {p:?}");assert!(!added.is_empty());}
            assert!(streets.iter().any(|s|s.role=="port-road"));
            assert!(streets.iter().all(|s|routing::path_clear(surface,&s.path,cfg.max_street_grade)));
            let mut final_regions=regions.clone();final_regions.extend(added);
            let before=quay.path.clone();
            quays(&final_regions,&mut streets,surface,&cfg,&site,"hanseatic",true);
            assert!(streets.iter().any(|s|s.role=="quay" && (length(&s.path)-length(&before)).abs()<0.01
                && s.path.iter().all(|&p|before.windows(2).any(|w|g::distance(p,w[0],w[1]).0<0.01))),"final pass keeps the routed front");
        }
    }
    #[test]
    fn attached_bank_switchbacks_respect_real_land_and_grade() {
        let (n,width)=(200,2000.0);
        let height:Vec<f32>=(0..n*n).map(|i|((1000.0-((i%n) as f64+0.5)*10.0).clamp(0.0,30.0)*1.6) as f32).collect();
        let water:Vec<u8>=(0..n*n).map(|i|u8::from(i%n>=100)).collect();
        let surface=Surface{geometry:None,n,width,height:&height,water:&water};
        let (p,q)=(Point{x:990.0,y:1000.0},Point{x:950.0,y:1000.0});
        assert!(!routing::segment_clear(surface,p,q,0.65));
        let ramp=bank_ramp(p,q,surface,0.65,1200.0).expect("switchback along the bank");
        assert!(routing::path_clear(surface,&ramp,0.65));
        assert_eq!(ramp.first(),Some(&p));assert_eq!(ramp.last(),Some(&q));
    }
    #[test]
    fn port_controls_reject_nonfinite_and_out_of_range_values() {
        let height=vec![0.0;4];let water=vec![0;4];
        let surface=Surface{geometry:None,n:2,width:100.0,height:&height,water:&water};
        for value in [-0.1,1.1,f64::NAN,f64::INFINITY] {
            for cfg in [LayoutConfig{port_detachment:value,..LayoutConfig::default()},LayoutConfig{port_shelter:Some(value),..LayoutConfig::default()}] {
                assert!(super::super::super::super::generate_quarters("port-params",&[],&cfg,surface,&[]).is_err());
            }
        }
    }
}
