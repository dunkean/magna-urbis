//! Optional harbour siting. All water remains the input water: moles enclose
//! an offshore basin, never excavate a fictitious shore beneath the town.
use super::*;

#[derive(Clone, Copy, Debug)]
pub(super) struct Water {
    pub(super) exposure: f64,
    pub(super) depth: f64,
    pub(super) sheltered: bool,
}

fn wet(surface: Surface<'_>, p: Point) -> bool {
    p.x >= 0.0 && p.y >= 0.0 && p.x < surface.width && p.y < surface.width
        && surface.water[(p.y / surface.width * surface.n as f64) as usize * surface.n
            + (p.x / surface.width * surface.n as f64) as usize] != 0
        && surface.wet(p)
}

// Clearance is a depth proxy, not a claim to bathymetry. Wide water away
// from a bank gets a better score than a shallow margin or a narrow stream.
pub(super) fn water(surface: Surface<'_>, path: &[Point]) -> Option<Water> {
    let total=length(path);
    let samples:Vec<_>=[0.25,0.5,0.75].into_iter().map(|f| {
        sample_water(surface,&sub_path(path,total*(f-0.08),total*(f+0.08)))
    }).collect::<Option<_>>()?;
    Some(Water {exposure:samples.iter().map(|w|w.exposure).fold(0.0,f64::max),
        depth:samples.iter().map(|w|w.depth).fold(60.0,f64::min),sheltered:samples.iter().all(|w|w.sheltered)})
}

fn sample_water(surface: Surface<'_>, path: &[Point]) -> Option<Water> {
    if channel_width(surface, path) < NAVIGABLE { return None; }
    let at = sub_path(path, 0.0, length(path) * 0.5);
    let (&p, &prev) = (at.last()?, at.get(at.len().checked_sub(2)?)?);
    let t = unit(prev, p);
    let reach = 20.0 + 2.0 * surface.width / surface.n as f64;
    let q = [left(t), Point { x: t.y, y: -t.x }].into_iter().find_map(|n| {
        let first = (1..=reach.ceil() as usize).map(|k| k as f64).find(|&d|wet(surface,add(p,n,d)))?;
        [16.0, 12.0, 8.0, 4.0].into_iter().map(|d|add(p,n,first+d))
            .find(|&q|wet(surface,q) && (0..8).all(|k| {
                let a=k as f64*std::f64::consts::FRAC_PI_4;
                wet(surface,add(q,Point{x:a.cos(),y:a.sin()},4.0))
            }))
    })?;
    let limit = 600.0;
    let mut fetch = vec![];
    for k in 0..32 {
        let a = k as f64 * std::f64::consts::TAU / 32.0;
        let n = Point{x:a.cos(),y:a.sin()};
        let mut d = 0.0;
        while d < limit {
            let p=add(q,n,d+4.0);
            // The edge of a cropped decor is open fetch, not a headland.
            if p.x<0.0 || p.y<0.0 || p.x>=surface.width || p.y>=surface.width {d=limit;break;}
            if !wet(surface,p) {break;}
            d+=4.0;
        }
        fetch.push(d);
    }
    // A port needs a connected approach, not a pond with a port label. Rays
    // suffice in open water; a coarse flood also follows winding estuaries.
    if fetch.iter().copied().fold(0.0,f64::max) < 220.0 && !approach(surface,q) {return None;}
    let exposure = fetch.iter().sum::<f64>() / (32.0 * limit);
    let open = fetch.iter().filter(|&&d|d>=limit-4.0).count();
    let depth = fetch.iter().copied().fold(60.0,f64::min);
    Some(Water {exposure,depth,sheltered:open<=7 && exposure<0.36})
}

fn approach(surface: Surface<'_>, from: Point) -> bool {
    let step=(surface.width/surface.n as f64).max(6.0);
    let radius=(240.0/step).ceil() as i32;
    let mut seen=std::collections::BTreeSet::from([(0i32,0i32)]);
    let mut queue=std::collections::VecDeque::from([(0i32,0i32)]);
    while let Some((x,y))=queue.pop_front() {
        if ((x*x+y*y) as f64).sqrt()*step>=220.0 {return true;}
        for (dx,dy) in [(1,0),(-1,0),(0,1),(0,-1)] {
            let next=(x+dx,y+dy);
            if next.0.abs()>radius || next.1.abs()>radius || seen.contains(&next) {continue;}
            let p=Point{x:from.x+next.0 as f64*step,y:from.y+next.1 as f64*step};
            let previous=Point{x:from.x+x as f64*step,y:from.y+y as f64*step};
            if wet(surface,p) && clear(surface,previous,p) {seen.insert(next);queue.push_back(next);}
        }
    }
    false
}

pub(super) fn rank_banks(banks:&mut Vec<(f64,Point,Point)>, surface:Surface<'_>, site:&Site) {
    let mut sampled:Vec<(f64,Point,Point)>=vec![];
    for &bank in banks.iter() {
        if sampled.iter().any(|b|dist(b.1,bank.1)<60.0) {continue;}
        sampled.push(bank);
    }
    let mut scored:Vec<_>=sampled.into_iter().filter_map(|b| {
        let t=left(unit(b.1,b.2));
        let w=water(surface,&[add(b.2,t,-30.0),add(b.2,t,30.0)])?;
        Some((!w.sheltered,w.exposure-w.depth/600.0+b.0/site.radius.max(100.0)*0.03,b))
    }).collect();
    scored.sort_by(|a,b|a.0.cmp(&b.0).then(a.1.total_cmp(&b.1)));
    *banks=scored.into_iter().map(|b|b.2).collect();
}

fn clear(surface: Surface<'_>, a: Point, b: Point) -> bool {
    let count=(dist(a,b)/2.0).ceil().max(1.0) as usize;
    (0..=count).all(|i|wet(surface,super::super::point(a,b,i as f64/count as f64)))
}

// Population sizes the protected water, not just the width of a decorative
// jetty. The basin has a navigation mouth, and every interior sample is wet.
fn basin(surface: Surface<'_>, path: &[Point], population:u32) -> Option<Vec<Street>> {
    let total=length(path);
    let beam=(f64::from(population.max(1)).sqrt()*1.3).clamp(36.0,260.0).min(total);
    if beam<30.0 {return None;}
    for f in [0.5,0.35,0.65] {
        let start=(total*f-beam*0.5).clamp(0.0,total-beam);
        let a=*sub_path(path,0.0,start).last()?;
        let b=*sub_path(path,0.0,start+beam).last()?;
        if dist(a,b)<beam*0.8 {continue;}
        let t=unit(a,b);
        for n in [left(t),Point{x:t.y,y:-t.x}] {
            let reach=20.0+2.0*surface.width/surface.n as f64;
            let root=|p| (1..=reach.ceil() as usize).map(|i|i as f64).find(|&d|wet(surface,add(p,n,d)));
            let (Some(da),Some(db))=(root(a),root(b)) else {continue;};
            let offset=da.max(db)+4.0;
            let depth=(f64::from(population.max(1)).sqrt()*0.75).clamp(24.0,150.0);
            let (a0,b0)=(add(a,n,offset),add(b,n,offset));
            let (a1,b1)=(add(a0,n,depth),add(b0,n,depth));
            let mouth=(beam*0.24).max(20.0);
            let arm=(dist(a,b)-mouth)*0.5;
            let (a2,b2)=(add(a1,t,arm),add(b1,t,-arm));
            let interior=(0..=10).all(|i|(0..=6).all(|j| {
                let p=super::super::point(a0,b0,i as f64/10.0);
                wet(surface,add(p,n,depth*j as f64/6.0))
            }));
            if !interior || ![(a0,a1),(a1,a2),(b0,b1),(b1,b2)].into_iter().all(|(p,q)|clear(surface,p,q)) {continue;}
            // The mouth opens onto more navigable water, never another bank.
            let mid=super::super::point(a2,b2,0.5);
            if !clear(surface,mid,add(mid,n,NAVIGABLE*2.0)) {continue;}
            return Some([vec![a,a1,a2],vec![b,b1,b2]].into_iter().map(|path|Street {
                widths:vec![(f64::from(population).sqrt()*0.06).clamp(3.0,10.0);path.len()],
                path,rank:2,role:"mole".into(),
            }).collect());
        }
    }
    None
}

fn safe_basin(surface:Surface<'_>, path:&[Point], population:u32, streets:&[Street])->Option<Vec<Street>> {
    let moles=basin(surface,path,population)?;
    let obstructed=moles.iter().flat_map(|s|s.path.windows(2)).any(|w| {
        streets.iter().filter(|s|matches!(s.role.as_str(),"bridge"|"causeway"|"pier"|"mole"|"landing"))
            .flat_map(|s|s.path.windows(2)).any(|v|g::segment_hit(w[0],w[1],v[0],v[1]).is_some_and(|(t,_)|t>0.05))
    });
    (!obstructed).then_some(moles)
}

pub(super) fn select(pieces:&mut Vec<Piece>, streets:&[Street], surface:Surface<'_>, site:&Site, cfg:&LayoutConfig) {
    let span=(f64::from(site.population.max(1)).sqrt()*3.0).clamp(100.0,650.0);
    let mut candidates=vec![];
    for piece in pieces.iter() {
        let total=length(&piece.path);
        let stations=(total/80.0).ceil().clamp(1.0,40.0) as usize;
        for k in 0..stations {
            let at=total*(k as f64+0.5)/stations as f64;
            let from=(at-span*0.5).clamp(0.0,(total-span).max(0.0));
            let mut path=sub_path(&piece.path,from,(from+span).min(total));
            let Some(w)=water(surface,&path) else {continue;};
            let artificial=!w.sheltered;
            if artificial {
                let protected=(f64::from(site.population.max(1)).sqrt()*1.3).clamp(36.0,260.0);
                path=centred(&path,site.center,protected);
            }
            if artificial && safe_basin(surface,&path,site.population,streets).is_none() {continue;}
            if landing_streets(&mut path,streets,surface,cfg).is_none() {continue;}
            let score=w.exposure-w.depth/600.0+piece.near/site.radius.max(100.0)*0.03;
            candidates.push((artificial,score,path,piece.river));
        }
    }
    candidates.sort_by(|a,b|a.0.cmp(&b.0).then(a.1.total_cmp(&b.1)));
    pieces.clear();
    if let Some((_,_,path,river))=candidates.into_iter().next() {
        let near=path.iter().map(|&p|dist(p,site.center)).fold(f64::INFINITY,f64::min);
        pieces.push(Piece{path,near,river});
    }
}

pub(super) fn works(streets:&[Street], surface:Surface<'_>, site:&Site, culture:&str)->Vec<Street> {
    let streets:Vec<_>=streets.iter().filter(|s|s.role!="quay"||shore_front(&s.path,surface)).cloned().collect();
    let fronts:Vec<_>=streets.iter().filter(|s|s.role=="quay"&&s.path.len()>=2).collect();
    let mut out=vec![];
    for q in &fronts {
        let Some(w)=water(surface,&q.path) else {continue;};
        if !w.sheltered {
            if let Some(moles)=safe_basin(surface,&q.path,site.population,&streets) {out.extend(moles);}
        }
    }
    let mut protected=streets.to_vec();protected.extend(out.iter().cloned());
    // Existing works avoid the moles and keep the navigation channel open.
    out.extend(super::works_with_minimum(&protected,surface,site,culture,20.0).into_iter().filter(|s|s.role!="mole"));
    out
}

#[cfg(test)]
mod tests {
    use super::*;
    #[test]
    fn short_sheltered_front_has_a_landing_only_when_enabled() {
        let (n,width)=(200,2000.0);let height=vec![0.0;n*n];
        let water:Vec<u8>=(0..n*n).map(|i|if (100..104).contains(&(i%n)) {3} else {0}).collect();
        let surface=Surface{geometry:None,n,width,height:&height,water:&water};
        let quay=Street {path:vec![Point{x:990.0,y:980.0},Point{x:990.0,y:1018.0}],widths:vec![5.0;2],rank:1,role:"quay".into()};
        let site=Site{key:"short".into(),name:String::new(),culture:"venetian-lagoon".into(),population:10000,center:Point{x:900.0,y:1000.0},radius:400.0};
        assert!(super::super::works(std::slice::from_ref(&quay),surface,&site,&site.culture).is_empty());
        let on=works(&[quay],surface,&site,&site.culture);
        assert_eq!(on.len(),1);assert_eq!(on[0].role,"landing");
    }
    #[test]
    fn absent_and_disabled_preserve_config_and_generated_bytes() {
        let cfg=LayoutConfig::default();
        let encoded=serde_json::to_value(&cfg).unwrap();
        assert!(encoded.get("shelteredHarbour").is_none());
        let mut explicit=encoded.clone();explicit["shelteredHarbour"]=serde_json::json!(false);
        let disabled:LayoutConfig=serde_json::from_value(explicit).unwrap();
        assert_eq!(serde_json::to_vec(&cfg).unwrap(),serde_json::to_vec(&disabled).unwrap());
        let (n,width)=(64,1600.0);let height=vec![5.0;n*n];
        let water:Vec<u8>=(0..n*n).map(|i|u8::from(i%n>=40)).collect();
        let surface=Surface{geometry:None,n,width,height:&height,water:&water};
        let site=Site{key:"off".into(),name:String::new(),culture:"hanseatic".into(),population:1000,center:Point{x:900.0,y:800.0},radius:180.0};
        let a=super::super::super::super::generate_quarters("off",std::slice::from_ref(&site),&cfg,surface,&[]).unwrap();
        let b=super::super::super::super::generate_quarters("off",std::slice::from_ref(&site),&disabled,surface,&[]).unwrap();
        assert_eq!(serde_json::to_vec(&a).unwrap(),serde_json::to_vec(&b).unwrap());
        let direct=super::super::works(&a[0].streets,surface,&site,"hanseatic");
        let configured=super::super::configured_works(&a[0].streets,surface,&site,"hanseatic",&disabled);
        assert_eq!(serde_json::to_vec(&direct).unwrap(),serde_json::to_vec(&configured).unwrap());
    }
    #[test]
    fn cove_beats_open_coast_and_a_pond_is_not_a_harbour() {
        let (n,width)=(200,2000.0);
        let height=vec![0.0;n*n];
        let open:Vec<u8>=(0..n*n).map(|i|u8::from(i%n>=100)).collect();
        let surface=Surface{geometry:None,n,width,height:&height,water:&open};
        let path=vec![Point{x:990.0,y:800.0},Point{x:990.0,y:1200.0}];
        let exposed=water(surface,&path).unwrap();assert!(!exposed.sheltered,"{exposed:?}");
        let cove:Vec<u8>=(0..n*n).map(|i|u8::from(i%n>=100 && (i%n>=140 || (80..=120).contains(&(i/n))))).collect();
        let surface=Surface{water:&cove,..surface};
        let sheltered=water(surface,&path).unwrap();assert!(sheltered.sheltered,"{sheltered:?}");
        assert!(sheltered.exposure<exposed.exposure);
        let pond:Vec<u8>=(0..n*n).map(|i|u8::from((100..=106).contains(&(i%n)) && (96..=104).contains(&(i/n)))).collect();
        assert!(water(Surface{water:&pond,..surface},&path).is_none());
    }
    #[test]
    fn exposed_coast_gets_population_sized_moles_on_existing_water() {
        let (n,width)=(200,2000.0);let height=vec![0.0;n*n];
        let water:Vec<u8>=(0..n*n).map(|i|u8::from(i%n>=100)).collect();
        let surface=Surface{geometry:None,n,width,height:&height,water:&water};
        let path=vec![Point{x:990.0,y:700.0},Point{x:990.0,y:1300.0}];
        let a=basin(surface,&path,1000).unwrap();let b=basin(surface,&path,10000).unwrap();
        assert_eq!(b.len(),2);assert!(length(&b[0].path)>length(&a[0].path));
        for mole in b {for w in mole.path.windows(2).skip(1) {assert!(clear(surface,w[0],w[1]));}}
    }
    #[test]
    fn floating_front_cannot_supply_a_parameterized_basin() {
        let (n,width)=(200,2000.0);let height=vec![0.0;n*n];
        let water:Vec<u8>=(0..n*n).map(|i|u8::from(i%n>=100)).collect();
        let surface=Surface{geometry:None,n,width,height:&height,water:&water};
        let site=Site{key:"shore".into(),name:String::new(),culture:"swahili-stone-town".into(),population:10000,center:Point{x:900.0,y:1000.0},radius:400.0};
        let front=|x|Street{path:vec![Point{x,y:800.0},Point{x,y:1200.0}],widths:vec![6.0;2],rank:1,role:"quay".into()};
        assert!(works(&[front(1010.0)],surface,&site,&site.culture).is_empty());
        let attached=works(&[front(990.0)],surface,&site,&site.culture);
        assert!(attached.iter().any(|s|s.role=="mole"));
        assert!(attached.iter().all(|s|!surface.wet(s.path[0])&&s.path.iter().any(|&p|surface.wet(p))));
    }
}
