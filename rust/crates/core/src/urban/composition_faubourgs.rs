//! Gate nuclei grow inside the inherited faubourgs; neither land nor gates move.
use super::*;
use super::super::{Block, Layout};
use std::f64::consts::{PI, TAU};

pub(in super::super) fn gate_strength(cfg: &LayoutConfig) -> f64 {
    cfg.gate_village.filter(|v| v.is_finite()).unwrap_or(f64::from(cfg.gate_villages)).clamp(0.0, 1.0)
}
fn dist(a: Point, b: Point) -> f64 { (a.x-b.x).hypot(a.y-b.y) }
fn at(path: &[Point], station: f64) -> (Point, (f64,f64)) {
    let mut left=station.max(0.0);
    for w in path.windows(2) {
        let run=dist(w[0],w[1]);
        if run<1e-8 {continue;}
        let u=((w[1].x-w[0].x)/run,(w[1].y-w[0].y)/run);
        if left<=run {return (shift(w[0],u,left),u);}
        left-=run;
    }
    (*path.last().unwrap(),(1.0,0.0))
}
fn shift(p:Point,u:(f64,f64),d:f64)->Point {Point {x:p.x+u.0*d,y:p.y+u.1*d}}
fn attach(p:Point,streets:&mut [Street])->Option<Point> {
    let (si,i,_,t,q)=streets.iter().enumerate().filter(|(_,s)|s.rank<=1)
        .flat_map(|(si,s)|s.path.windows(2).enumerate().map(move |(i,w)| {
            let (d,t,q)=g::distance(p,w[0],w[1]);(si,i,d,t,q)
        })).filter(|v|v.2<12.0).min_by(|a,b|a.2.total_cmp(&b.2))?;
    let s=&mut streets[si];
    if dist(q,s.path[i])<1e-6 {return Some(s.path[i]);}
    if dist(q,s.path[i+1])<1e-6 {return Some(s.path[i+1]);}
    if s.widths.len()==s.path.len() {s.widths.insert(i+1,s.widths[i]*(1.0-t)+s.widths[i+1]*t);}
    s.path.insert(i+1,q);Some(q)
}
fn outside(p:Point,walls:&[Shape])->bool {walls.iter().all(|w|!g::contains(w,p))}
fn centers(layout:&Layout)->Vec<Point> {
    if let Some(s)=&layout.structure {
        if !s.gate_village_lanes.is_empty() {return vec![];}
        if !s.gate_village_centers.is_empty() {return s.gate_village_centers.clone();}
    }
    layout.streets.iter().filter(|s|s.role=="gate-village").filter_map(|s|s.path.get(1).copied())
        .fold(vec![],|mut a,p| {if a.iter().all(|&q|dist(p,q)>20.0) {a.push(p);} a})
}
fn square(p:Point,strength:f64)->Shape {
    let mut rng=Rng::new(&format!("faubourg-square:{:.1}:{:.1}",p.x,p.y));
    let angle=rng.range(0.0,TAU);
    g::normalized(Shape {outer:(0..7).map(|i| {
        let a=angle+i as f64*TAU/7.0;
        // A gate square reads at the town overview: 50 m at 0.5, 70 m at 1.
        let r=(30.0+40.0*strength)*rng.range(0.82,1.12);
        shift(p,(a.cos(),a.sin()),r)
    }).collect(),holes:vec![]})
}

pub(in super::super) fn grow_gate_villages(plan:&mut macroplan::Plan,cfg:&LayoutConfig,surface:Surface<'_>)->(Vec<Point>,Vec<Street>) {
    let strength=gate_strength(cfg);
    if strength<=0.0 || cfg.suburbs=="none" {return (vec![],vec![]);}
    let walls:Vec<_>=plan.enclosures.iter().filter(|e|e.purpose.is_empty())
        .map(|e|Shape {outer:e.path.clone(),holes:vec![]}).collect();
    if walls.is_empty() {return (vec![],vec![]);}
    let land=union(&plan.quarters.iter().map(|q|q.shape.clone()).collect::<Vec<_>>());
    let in_land=|p|land.iter().any(|s|g::contains(s,p));
    let reserves:Vec<_>=plan.enclosures.iter().flat_map(|e|&e.reserve).collect();
    let clear=|p|in_land(p) && outside(p,&walls) && !surface.wet(p)
        && reserves.iter().all(|s|!g::contains(s,p));
    let approaches=plan.streets.clone();
    let mut occupied=vec![];
    let mut lanes=vec![];
    for gate in plan.enclosures.iter().filter(|e|e.purpose.is_empty()).flat_map(|e|&e.gates) {
        if occupied.iter().any(|&p|dist(p,*gate)<100.0) {continue;}
        // Project onto the existing approach and preserve every bend outward.
        let mut candidates=vec![];
        for road in approaches.iter().filter(|s|s.rank<=1 && !matches!(s.role.as_str(),"ring"|"boundary"|"bridge"|"ford")) {
            for (i,w) in road.path.windows(2).enumerate() {
                let (d,t,_)=g::distance(*gate,w[0],w[1]);
                if d>4.0 {continue;}
                let p=Point {x:w[0].x+(w[1].x-w[0].x)*t,y:w[0].y+(w[1].y-w[0].y)*t};
                for path in [std::iter::once(p).chain(road.path[i+1..].iter().copied()).collect::<Vec<_>>(),
                    std::iter::once(p).chain(road.path[..=i].iter().rev().copied()).collect::<Vec<_>>()] {
                    if length(&path)>30.0 && outside(at(&path,12.0).0,&walls) {candidates.push((road.rank,path));}
                }
            }
        }
        candidates.sort_by_key(|(rank,_)|*rank);
        let mut nucleus=None;
        for (_,path) in candidates {
            let max=length(&path).min(180.0);
            for step in 3..=(max/6.0) as usize {
                let station=step as f64*6.0;
                let (p,_)=at(&path,station);
                let sh=square(p,0.35);
                let covered:f64=land.iter().flat_map(|s|g::intersection(s,&sh)).map(|s|g::area(&s)).sum();
                if clear(p) && sh.outer.iter().all(|&p|outside(p,&walls) && !surface.wet(p)
                    && reserves.iter().all(|s|!g::contains(s,p))) && covered>g::area(&sh)*0.7 {
                    nucleus=Some((p,station,path));break;
                }
            }
            if nucleus.is_some() {break;}
        }
        let Some((center,station,path))=nucleus else {continue;};
        // Widen the approach locally into a market. Its second point records
        // the nucleus; no new radial or transverse spine is invented.
        let (a,_)=at(&path,(station-16.0).max(0.0));
        let (b,_)=at(&path,(station+18.0).min(length(&path)));
        if !routing::path_clear(surface,&[a,center,b],cfg.max_street_grade) {continue;}
        occupied.push(center);
        lanes.push(Street {path:vec![a,center,b],widths:vec![3.5,4.0+6.0*strength,3.2],rank:2,role:"gate-village".into()});
        let mut rng=Rng::new(&format!("faubourg-lanes:{:.1}:{:.1}",gate.x,gate.y));
        let side=if rng.chance(0.5) {1.0} else {-1.0};
        let first=lanes.len();
        for branch in 0..(6.0*strength).ceil() as usize {
            // Opposite sides leave at different stations: staggered junctions.
            let start=station+14.0*strength+(branch/2) as f64*rng.range(55.0,95.0)+(branch%2) as f64*rng.range(14.0,35.0);
            let run=((80.0+120.0*strength)*rng.range(0.6,1.15)).min(length(&path)-start-3.0);
            let reach=(18.0+60.0*strength)*rng.range(0.55,1.25);
            if run<45.0 {continue;}
            let lateral=side*if branch%2==0 {1.0} else {-1.0};
            for fit in [1.0,0.75,0.5,0.35] {
                let mut lane=vec![];
                for j in 0..=12 {
                    let t=j as f64/12.0;
                    let (p,u)=at(&path,start+run*t);
                    // Skewed bulge: lanes peel off and rejoin at different angles, never a mirrored lens.
                    let skew=t.powf(rng.range(0.6,1.6));
                    let off=lateral*reach*fit*(PI*skew).sin().powf(0.9+0.25*(branch%3) as f64);
                    let n=(-u.1,u.0);
                    // Small downhill/contour preference, bounded by the old land.
                    let h=surface.height_at(shift(p,n,off));
                    let bend=(surface.height_at(shift(p,n,off+4.0))-h).clamp(-1.0,1.0);
                    lane.push(shift(p,n,off-bend*3.0*(PI*t).sin()));
                }
                if lane.iter().any(|&p|!clear(p)) || !routing::path_clear(surface,&lane,cfg.max_lane_grade) {continue;}
                // Do not lay a second street over an existing side lane.
                if lane[3..10].iter().all(|&p|approaches.iter()
                    .any(|s|s.path.windows(2).any(|w|g::distance(p,w[0],w[1]).0<7.0))) {continue;}
                // Nor over (or along) a lane of this same faubourg.
                if lane[4..9].iter().any(|&p|lanes[first..].iter()
                    .any(|s:&Street|s.path.windows(2).any(|w|g::distance(p,w[0],w[1]).0<16.0))) {continue;}
                let width=rng.range(2.8,3.8);
                lanes.push(Street {widths:(0..lane.len()).map(|i|width*(1.0-0.18*i as f64/12.0)
                    *rng.range(0.92,1.08)).collect(),path:lane,rank:3,role:"faubourg-lane".into()});
                break;
            }
        }
    }
    (occupied,lanes)
}

pub(in super::super) fn prepare_gate_villages(layout:&mut Layout,cfg:&LayoutConfig,surface:Surface<'_>) {
    let strength=gate_strength(cfg);
    if strength<=0.0 {return;}
    let pending=layout.structure.as_mut().map(|s|std::mem::take(&mut s.gate_village_lanes)).unwrap_or_default();
    // Keep the old street solution and its access decisions. The local lanes
    // carve only the already retained outside blocks, before parcel cutting.
    for mut lane in pending {
        let last=lane.path.len()-1;
        let Some(a)=attach(lane.path[0],&mut layout.streets) else {continue;};
        let Some(b)=attach(lane.path[last],&mut layout.streets) else {continue;};
        lane.path[0]=a;lane.path[last]=b;
        if !routing::path_clear(surface,&lane.path,cfg.max_lane_grade) {continue;}
        let ribbons=g::ribbon(&lane.path,&lane.widths);
        let overlap:f64=layout.blocks.iter().flat_map(|b|ribbons.iter().flat_map(|r|g::intersection(&b.shape,r)))
            .map(|s|g::area(&s)).sum();
        if overlap<10.0 {continue;}
        for ribbon in ribbons {
            layout.blocks=std::mem::take(&mut layout.blocks).into_iter().flat_map(|b|
                g::difference(&b.shape,&ribbon).into_iter().filter(|s|g::area(s)>1.0)
                    .map(move |shape|Block {shape,..b.clone()})).collect();
        }
        layout.streets.push(lane);
    }
    let mut retained=vec![];
    for p in centers(layout) {
        let mut raw=vec![square(p,strength)];
        for wall in &layout.enclosures {
            let shape=Shape {outer:wall.path.clone(),holes:vec![]};
            if wall.purpose.is_empty() {raw=raw.iter().flat_map(|s|g::difference(s,&shape)).collect();}
            for reserve in &wall.reserve {raw=raw.iter().flat_map(|s|g::difference(s,reserve)).collect();}
        }
        let land=union(&layout.quarters.iter().map(|q|q.shape.clone()).collect::<Vec<_>>());
        let Some(square)=land.iter().flat_map(|s|raw.iter().flat_map(move |r|g::intersection(s,r)))
            .filter(|s|g::contains(s,p)).max_by(|a,b|g::area(a).total_cmp(&g::area(b))) else {continue;};
        if square.outer.iter().any(|&p|surface.wet(p)) {continue;}
        let Some(qi)=layout.quarters.iter().position(|q|g::contains(&q.shape,p))
            .or_else(||layout.quarters.iter().enumerate().min_by(|(_,a),(_,b)|
                dist(g::centroid(&a.shape),p).total_cmp(&dist(g::centroid(&b.shape),p))).map(|(i,_)|i)) else {continue;};
        // Trim may have removed an unbuildable nucleus. Never make a detached square.
        let overlap:f64=layout.blocks.iter().flat_map(|b|g::intersection(&b.shape,&square)).map(|s|g::area(&s)).sum();
        if overlap<50.0 || g::area(&square)<500.0*strength*strength {continue;}
        layout.blocks=std::mem::take(&mut layout.blocks).into_iter().flat_map(|b|
            g::difference(&b.shape,&square).into_iter().map(move |shape|Block {shape,..b.clone()})).collect();
        layout.blocks.push(Block {shape:square.clone(),quarter:qi,kind:"place".into(),axis:Point {x:1.0,y:0.0},
            zone:"faubourg".into(),phase:Some(layout.quarters[qi].phase)});
        let mut path=square.outer;path.push(path[0]);
        layout.streets.push(Street {widths:vec![2.5+strength;path.len()],path,rank:3,role:"market".into()});
        retained.push(p);
    }
    // Trim ran with the legacy streets. New lanes can now serve vacant land
    // within those same quarters; leave distant strips and wall reserves alone.
    for b in &mut layout.blocks {
        let p=g::interior_point(&b.shape);
        if b.kind=="reserve" && retained.iter().any(|&q|dist(p,q)<80.0+180.0*strength)
            && !surface.wet(p) && b.shape.outer.iter().all(|&p|!surface.wet(p))
            && layout.enclosures.iter().all(|e|!g::contains(&Shape {outer:e.path.clone(),holes:vec![]},p)
                && e.reserve.iter().all(|s|g::intersection(&b.shape,s).iter().map(g::area).sum::<f64>()<0.01)) {
            b.kind="block".into();
        }
    }
    if let Some(s)=&mut layout.structure {s.gate_village_centers=retained;}
}

/// Blend occupation toward the gate, falling back to garden plots outwards.
/// Demand remains unchanged: only its distribution over existing land changes.
pub(in super::super) fn gate_pressures(layout:&Layout,mut pressures:Vec<f64>)->Vec<f64> {
    let strength=layout.config.as_ref().map_or(0.0,gate_strength);
    if strength<=0.0 {return pressures;}
    let nuclei=centers(layout);
    if nuclei.is_empty() {return pressures;}
    let walls:Vec<_>=layout.enclosures.iter().filter(|e|e.purpose.is_empty())
        .map(|e|Shape {outer:e.path.clone(),holes:vec![]}).collect();
    for (block,pressure) in layout.blocks.iter().zip(&mut pressures) {
        let phase=block.phase.or_else(||layout.quarters.get(block.quarter).map(|q|q.phase));
        if block.zone!="faubourg" && !phase.and_then(|i|layout.phases.get(i)).is_some_and(|p|p.kind=="faubourg") {continue;}
        let p=g::interior_point(&block.shape);
        if !outside(p,&walls) {continue;}
        let distance=nuclei.iter().map(|&q|dist(p,q)).fold(f64::INFINITY,f64::min);
        let local=0.03+0.97*(-(distance-45.0).max(0.0)/95.0).exp();
        *pressure=*pressure*(1.0-strength)+local*strength;
    }
    pressures
}

/// A gate nucleus is a secondary centre for the existing housing budget.
pub(in super::super) fn gate_activity(layout:&Layout,p:Point)->f64 {
    let strength=layout.config.as_ref().map_or(0.0,gate_strength);
    if strength<=0.0 || layout.enclosures.iter().any(|e|e.purpose.is_empty()
        && g::contains(&Shape {outer:e.path.clone(),holes:vec![]},p)) {return 0.0;}
    let distance=centers(layout).iter().map(|&q|dist(p,q)).fold(f64::INFINITY,f64::min);
    strength*(-(distance-38.0).max(0.0)/(65.0+35.0*strength)).exp()
}

/// Local parcel cutting follows the new lanes even in a gridded parent town.
pub(in super::super) fn gate_morph(layout:&Layout,bi:usize,morph:&mut Morph) {
    let strength=layout.config.as_ref().map_or(0.0,gate_strength);
    if strength<=0.0 {return;}
    let b=&layout.blocks[bi];let p=g::interior_point(&b.shape);
    if !centers(layout).iter().any(|&q|dist(p,q)<80.0+180.0*strength)
        || layout.enclosures.iter().any(|e|e.purpose.is_empty() && g::contains(&Shape {outer:e.path.clone(),holes:vec![]},p)) {return;}
    morph.value["streetOp"]=serde_json::json!("organic");
    if !matches!(morph.text("plotOp"),"garden"|"wholeBlock"|"compound"|"courtyard"|"siheyuan"|"machiya") {
        morph.value["plotOp"]=serde_json::json!("inherited");
    }
}

pub(in super::super) fn gate_service_cost(layout:&Layout,d:&super::super::programme::Demand,p:Point)->f64 {
    let strength=layout.config.as_ref().map_or(0.0,gate_strength);
    if strength<=0.0 {return 0.0;}
    let weight=match d.role.as_str() {
        "commerce.inn"|"commerce.caravanserai"|"commerce.funduq"|"commerce.market.gate"=>strength,
        "worship.parish"|"worship.masjid"=>((strength-0.65)/0.35).max(0.0),
        _=>return 0.0,
    };
    let centers=centers(layout);
    if centers.is_empty() {return 0.0;}
    let assigned=d.id.rsplit_once("/gate-village/").and_then(|(_,i)|i.parse::<usize>().ok())
        .and_then(|i|centers.get(i)).copied();
    let nearest=assigned.map_or_else(||centers.iter().map(|&q|dist(p,q)).fold(f64::INFINITY,f64::min),|q|dist(p,q));
    let inside=layout.enclosures.iter().any(|e|e.purpose.is_empty() && g::contains(&Shape {outer:e.path.clone(),holes:vec![]},p));
    weight*if inside {24.0} else {(nearest/20.0).min(30.0)-12.0}
}

/// Distribute existing cultural services across nuclei before the town sites.
/// Service and population demand stay unchanged.
pub(in super::super) fn gate_demands(layout:&Layout,demands:&mut Vec<super::super::programme::Demand>) {
    let strength=layout.config.as_ref().map_or(0.0,gate_strength);
    if strength<=0.0 {return;}
    let count=centers(layout).len();
    if count==0 {return;}
    let mut split=vec![];
    for d in demands.iter_mut() {
        let applies=match d.role.as_str() {
            "commerce.inn"|"commerce.caravanserai"|"commerce.funduq"=>true,
            "worship.parish"|"worship.masjid"=>strength>0.65,
            _=>false,
        };
        if !applies || d.sites==0 || d.id.contains("/gate-village/") {continue;}
        let take=count.min(d.sites);
        let amount=d.requested/d.sites as f64;
        for i in 0..take {
            let mut site=d.clone();site.id=format!("{}/gate-village/{i}",d.id);
            site.sites=1;site.requested=amount;site.deficit=amount;
            site.provenance.push("Existing service assigned to inherited gate faubourg".into());
            split.push(site);
        }
        d.sites-=take;d.requested-=amount*take as f64;d.deficit=d.requested;
    }
    demands.retain(|d|d.requested>1e-8);
    demands.extend(split);
}

#[cfg(test)]
#[path = "composition_faubourgs_tests.rs"]
mod tests;
