//! Independent wall controls; absent controls retain the historical draw.
use super::*;
use super::super::{Layout, LayoutConfig};
use super::super::routing::{self, RoutePlanner};

pub(super) fn river_mode(cfg: &LayoutConfig) -> &str {
    if cfg.river_control_mode.is_empty() { if cfg.river_control { "bank-walls-chain" } else { "none" } }
    else { &cfg.river_control_mode }
}
fn stiffness(cfg: &LayoutConfig) -> f64 { cfg.wall_stiffness.unwrap_or(f64::from(cfg.medieval_walls)) }
/// Default stiffness of a culture's curtain (fortifications.json `groups.*.wallStiffness`);
/// the old medieval toggle still means 1, an explicit value always wins.
fn culture_stiffness(cfg: &LayoutConfig, culture: &str) -> f64 {
    let base=num(group(culture),"wallStiffness",num(&data()["groups"]["default"],"wallStiffness",0.0));
    cfg.wall_stiffness.unwrap_or(if cfg.medieval_walls {1.0} else {num(&data()["wallStiffness"],culture,base)})
}
/// Height a straight run may rise above its ends: `wallRelief` 0 → 2 m (round every
/// knoll), 1 → no limit; absent → the data's maxCrestM.
fn crest_limit(cfg: &LayoutConfig) -> f64 {
    match cfg.wall_relief { Some(r) if r>=1.0 => f64::INFINITY, Some(r) => 2.0+38.0*r.max(0.0), None => num(&data()["trace"],"maxCrestM",12.0) }
}
/// How a second enclosure relates to the first: the parameter, else the culture's default.
pub(in super::super) fn wall_extension(cfg: &LayoutConfig, culture: &str) -> String {
    if !cfg.wall_extension.is_empty() { return cfg.wall_extension.clone(); }
    text(group(culture),"wallExtension",&text(&data()["groups"]["default"],"wallExtension","concentric"))
}
fn adherence(cfg: &LayoutConfig) -> f64 { cfg.wall_terrain.unwrap_or(f64::from(cfg.medieval_walls)) }
fn grade() -> f64 { num(&data()["trace"],"maxGrade",0.9) }
pub(in super::super) fn valid_parameters(cfg: &LayoutConfig) -> bool {
    [cfg.wall_stiffness,cfg.wall_terrain,cfg.ditch_wetness].iter().flatten()
        .all(|v|v.is_finite() && (0.0..=1.0).contains(v))
        && cfg.wall_tower_spacing.is_none_or(|v|v.is_finite() && (v==0.0 || (5.0..=250.0).contains(&v)))
        && ["","none","bank-walls","bank-walls-chain"].contains(&cfg.river_control_mode.as_str())
        && ["","auto","inside","separate","outside"].contains(&cfg.port_enclosure.as_str())
        && ["","auto","concentric","attached"].contains(&cfg.wall_extension.as_str())
}

/// Simplification is metric; steep shortcuts are never accepted. Endpoints of
/// river spans remain on the founding trace for the water-gate builder.
pub(in super::super) fn parameter_trace(shape: Shape, surface: Surface<'_>, cfg: &LayoutConfig, culture: &str, width: f64) -> Shape {
    let stiff=culture_stiffness(cfg,culture); let terrain=adherence(cfg); let limit=crest_limit(cfg);
    if stiff==0.0 && terrain==0.0 && river_mode(cfg)=="none" { return shape; }
    let mut path=shape.outer.clone(); if path.len()<3 {return shape;} path.push(path[0]);
    let ns=normals(&path); let mut points=vec![];
    for (i,w) in path.windows(2).enumerate() {
        let steps=(dist(w[0],w[1])/16.0).ceil().max(1.0) as usize;
        for k in 0..steps {
            let p=add(w[0],dir(w[0],w[1]),dist(w[0],w[1])*k as f64/steps as f64);
            if surface.wet(p) {points.push(p);continue;}
            let n=ns[i]; let mut best=p; let mut score=0.0;
            let reach=num(&data()["trace"],"terrainReachM",32.0)*terrain;
            if reach>0.0 {for j in 0..=4 {
                let off=reach*j as f64/4.0; let q=add(p,n,off);
                if !routing::segment_clear(surface,p,q,grade()) || surface.wet(add(q,n,width+2.0)) {continue;}
                let h=surface.height_at(q); let inside=surface.height_at(add(q,n,-12.0));
                let outside=surface.height_at(add(q,n,12.0));
                let merit=terrain*((h-outside).max(0.0)+(inside-2.0*h+outside).abs())/12.0-off.abs()*0.004;
                if merit>score {score=merit;best=q;}
            }}
            if river_mode(cfg)!="none" {
                if let Some(d)=(1..=40).map(|k|k as f64*2.0).find(|&d|surface.wet(add(p,n,d))) {
                    let q=add(p,n,(d-width-2.0).max(0.0));
                    if routing::segment_clear(surface,p,q,grade()) {best=q;}
                }
            }
            points.push(best);
        }
    }
    points.push(points[0]);
    let tolerance=1.5+num(&data()["trace"],"stiffDeviationM",36.0)*stiff.powi(2);
    let mut epsilon=tolerance;
    // A straight run never crosses a crest: the founding points under such a
    // run are kept, so the trace stays stiff elsewhere and follows the town
    // only there. (Routed ridge detours folded circuits into slivers.)
    let n=points.len()-1;
    while epsilon>=0.1 {
        let mut kept=vec![false;n];
        for _ in 0..16 {
            let keep=|p:Point| points[..n].iter().position(|q|q.x==p.x && q.y==p.y).is_some_and(|i|kept[i]);
            let mut outer=g::simplify(&points,epsilon,keep);outer.pop();
            let candidate=g::normalized(Shape {outer,holes:shape.holes.clone()});
            if !(candidate.outer.len()>=3 && g::simple(&candidate)
                && area(&g::intersection(&candidate,&shape))>=g::area(&shape)*(0.99-0.14*stiff)) {break;}
            let index=|p:Point| points[..n].iter().position(|q|q.x==p.x && q.y==p.y);
            // Water too is judged per run: a straight run may not cross more water
            // than the founding path between its two ends (river crossings stay).
            let wet=|a:Point,b:Point| wet_length(&[a,b],surface)*0.5;
            // The founding arc a run replaces: the shorter way round (the
            // candidate ring may be reoriented by normalization).
            let arc=|i:usize,j:usize| if (j+n-i)%n<=(i+n-j)%n {(i,j)} else {(j,i)};
            let wetter=|a:Point,b:Point| match (index(a),index(b)) {
                (Some(i),Some(j)) => { let (mut k,j)=arc(i,j); let mut w=0.0; while k!=j { w+=wet(points[k],points[(k+1)%n]); k=(k+1)%n; } wet(a,b)>w+4.0 }
                _ => false };
            let mut ring=candidate.outer.clone();ring.push(ring[0]);
            // A run already made of founding points is the founding trace itself.
            let founding=|a:Point,b:Point| match (index(a),index(b)) {
                (Some(i),Some(j)) => {
                    if (i+1)%n==j || (j+1)%n==i {return true;}
                    let (mut k,j)=arc(i,j); let mut all=kept[j];
                    while k!=j {all&=kept[k];k=(k+1)%n;}
                    all
                }
                _ => true };
            let bad:Vec<_>=ring.windows(2).filter(|w|(!clear_within(surface,w[0],w[1],limit) || wetter(w[0],w[1])) && !founding(w[0],w[1])).map(|w|(w[0],w[1])).collect();
            if bad.is_empty() {
                // An explicit relief limit also holds for the founding trace: where it
                // runs over a knoll above the limit, the curtain is routed round it.
                if cfg.wall_relief.is_some() && (ring.windows(2).any(|w|!clear_within(surface,w[0],w[1],limit))
                    || knolls(&ring,surface,limit).1.iter().any(|&k|k)) {
                    if let Some(round)=safe_trace_within(&candidate,surface,limit,true) {return round;}
                }
                return candidate;
            }
            let before=kept.iter().filter(|&&k|k).count();
            for (a,b) in bad {
                let (Some(i),Some(j))=(index(a),index(b)) else {continue;};
                let (mut k,j)=arc(i,j); while k!=j {kept[k]=true;k=(k+1)%n;} kept[j]=true;
            }
            if kept.iter().filter(|&&k|k).count()==before {break;}
        }
        epsilon*=0.5;
    }
    shape
}

fn crest(surface:Surface<'_>,a:Point,b:Point)->bool { crest_above(surface,a,b,num(&data()["trace"],"maxCrestM",12.0)) }
fn crest_above(surface:Surface<'_>,a:Point,b:Point,limit:f64)->bool {
    if !limit.is_finite() {return false;}
    let n=(dist(a,b)/8.0).ceil().max(1.0) as usize;
    let high=surface.height_at(a).max(surface.height_at(b))+limit;
    (1..n).any(|k|surface.height_at(add(a,dir(a,b),dist(a,b)*k as f64/n as f64))>high)
}
fn clear_within(surface:Surface<'_>,a:Point,b:Point,limit:f64)->bool {
    (!crest_above(surface,a,b,limit) && routing::segment_clear(surface,a,b,grade()))
        || !routing::water_intervals(surface,a,b).is_empty()
}
fn clear_segment(surface:Surface<'_>,a:Point,b:Point)->bool {
    (!crest(surface,a,b) && routing::segment_clear(surface,a,b,grade()))
        || !routing::water_intervals(surface,a,b).is_empty()
}
/// Repair a dry curtain around a ridge. No route means no usable circuit;
/// callers must keep the port outside or give it a separate circuit.
fn safe_trace(shape:&Shape,surface:Surface<'_>)->Option<Shape> {
    safe_trace_within(shape,surface,num(&data()["trace"],"maxCrestM",12.0),false)
}
/// Samples of a closed ring every ~8 m, and the samples lying on a knoll: higher
/// than both ends of a ±64 m window by more than `limit`. A densified straight
/// run over a hill is a knoll even though no single piece rises above its ends.
fn knolls(ring:&[Point],surface:Surface<'_>,limit:f64)->(Vec<Point>,Vec<bool>) { let (p,f,_)=knoll_tops(ring,surface,limit); (p,f) }
/// `knolls` plus the summit samples (highest of their window).
fn knoll_tops(ring:&[Point],surface:Surface<'_>,limit:f64)->(Vec<Point>,Vec<bool>,Vec<Point>) {
    let mut points=vec![];
    for w in ring.windows(2) {
        let count=(dist(w[0],w[1])/8.0).ceil().max(1.0) as usize;
        for k in 0..count {points.push(add(w[0],dir(w[0],w[1]),dist(w[0],w[1])*k as f64/count as f64));}
    }
    let n=points.len();let hs:Vec<f64>=points.iter().map(|&p|surface.height_at(p)).collect();
    let mut flag=vec![false;n];let mut tops=vec![];
    if !limit.is_finite() || n<20 {return (points,flag,tops);}
    let w=8;
    for i in 0..n {
        let (a,b)=((i+n-w)%n,(i+w)%n);
        if surface.wet(points[i]) || hs[i]-hs[a].max(hs[b])<=limit {continue;}
        for k in 0..=2*w {flag[(i+n-w+k)%n]=true;}
        if (0..=2*w).all(|k|hs[(i+n-w+k)%n]<=hs[i]) {tops.push(points[i]);}
    }
    (points,flag,tops)
}
fn safe_trace_within(shape:&Shape,surface:Surface<'_>,limit:f64,knoll:bool)->Option<Shape> {
    let mut path=shape.outer.clone();path.push(path[0]);
    let clear=|a,b|clear_within(surface,a,b,limit);
    let (_,on_knoll,tops)=if knoll {knoll_tops(&path,surface,limit)} else {(vec![],vec![],vec![])};
    if path.windows(2).all(|w|clear(w[0],w[1])) && !on_knoll.iter().any(|&k|k) {return Some(shape.clone());}
    // Place anchors beyond the steep run, rather than on the cliff face.
    let mut points=vec![];let mut bad=vec![];
    for w in path.windows(2) {
        let count=(dist(w[0],w[1])/8.0).ceil().max(1.0) as usize;
        let ridge=crest_above(surface,w[0],w[1],limit) && routing::water_intervals(surface,w[0],w[1]).is_empty();
        for k in 0..count {
            let a=add(w[0],dir(w[0],w[1]),dist(w[0],w[1])*k as f64/count as f64);
            let b=add(w[0],dir(w[0],w[1]),dist(w[0],w[1])*(k+1) as f64/count as f64);
            points.push(a);bad.push(ridge || !clear(a,b));
        }
    }
    // The same 8 m samples as `knolls`: a knoll marks its whole window.
    if knoll && on_knoll.len()==points.len() {
        for (b,&k) in bad.iter_mut().zip(&on_knoll) {*b|=k;}
    }
    let n=points.len();
    let outer=buffer(shape,360.0);
    let mut corridors:Vec<_>=outer.iter().flat_map(|s|g::difference(s,shape)).collect();
    if knoll && !tops.is_empty() {
        // Round a knoll on either side, never over its summit: outside the town
        // (the hill walled in) or inside it (the hill left out of the walls).
        let hills:Vec<Shape>=tops.iter().map(|&t|disc(t,45.0,16,0.0)).collect();
        let mut open:Vec<Shape>=corridors.drain(..).chain(std::iter::once(shape.clone())).collect();
        for hill in &hills {open=open.iter().flat_map(|c|g::difference(c,hill)).collect();}
        corridors=open;
    }
    for dilation in [2_usize,4,8,16,32] {
        let blocked:Vec<_>=(0..n).map(|i|(0..=dilation*2).any(|j|bad[(i+n+j%n-dilation.min(n-1))%n])).collect();
        let Some(start)=(0..n).find(|&i|!blocked[i] && !blocked[(i+n-1)%n]) else {continue;};
        let mut ring=vec![];let mut k=0;let mut failed=false;
        while k<n {
            let i=(start+k)%n;
            if !blocked[i] {ring.push(points[i]);k+=1;continue;}
            let begin=k;while k<n && blocked[(start+k)%n] {k+=1;}
            let (a,b)=(points[(start+begin)%n],points[(start+k)%n]);
            let pad=360.0;
            let bounds=(a.x.min(b.x)-pad,a.y.min(b.y)-pad,a.x.max(b.x)+pad,a.y.max(b.y)+pad);
            let mut route=RoutePlanner::new(surface,bounds);route.set_adaptation(1.0);
            let routed=corridors.iter().find_map(|corridor|route.route_within(a,b,grade(),corridor));
            let routed=routed.or_else(|| {
                let mut fine=RoutePlanner::bank(surface,bounds);fine.set_adaptation(1.0);
                corridors.iter().find_map(|corridor|fine.route_within(a,b,grade(),corridor))
            });
            let Some(routed)=routed else {
                // A knoll that cannot be rounded keeps its founding line; other
                // unclear runs still fail the repair as before.
                if knoll {for j in begin..k {ring.push(points[(start+j)%n]);} continue;}
                failed=true;break;
            };
            ring.extend(routed[..routed.len()-1].iter().copied());
        }
        if failed {continue;}
        let candidate=g::normalized(Shape {outer:ring,holes:shape.holes.clone()});
        // A repaired circuit keeps the land it encloses (no folded sliver).
        if candidate.outer.len()>=3 && g::simple(&candidate)
            && area(&g::intersection(&candidate,shape))>=0.9*g::area(shape) {return Some(candidate);}
    }
    None
}

pub(super) fn ditch_kind(shape:&Shape,surface:Surface<'_>,rng:&Rng,wetness:f64)->&'static str {
    if wetness<=0.0 {return "dry";}
    let p=g::interior_point(shape);let h=surface.height_at(p);
    let mut supply=false;let mut relief=0.0_f64;
    for k in 0..16 {
        let a=k as f64*std::f64::consts::TAU/16.0;let n=(a.cos(),a.sin());
        relief=relief.max((surface.height_at(add(p,n,20.0))-h).abs());
        for d in [12.0,24.0,48.0,72.0] {
            let q=add(p,n,d);
            if surface.wet(q) {supply|=h<=surface.height_at(q)+2.0;break;}
        }
    }
    let key=format!("ditch-wetness:{:.0}:{:.0}",(p.x/24.0).floor(),(p.y/24.0).floor());
    if supply && relief<1.5 && rng.fork(&key).chance(wetness) {"wet"} else {"dry"}
}

fn wall_shape(e:&Enclosure)->Shape {
    let mut outer=e.path.clone();if outer.first()==outer.last() {outer.pop();}
    g::normalized(Shape {outer,holes:vec![]})
}
fn share(walls:&[Shape],shape:&Shape)->f64 {
    let pieces:Vec<_>=walls.iter().flat_map(|w|g::intersection(w,shape)).collect();
    let covered=if pieces.len()>1 {area(&g::union(&pieces))} else {area(&pieces)};
    covered/g::area(shape).max(1.0)
}
fn cuts(walls:&[Shape],shape:&Shape)->bool {
    let a=share(walls,shape);let full=g::area(shape);
    // Boolean/raster seams of a few square metres are not a divided quarter.
    a>0.0001 && a<0.9999 && (a*full).min((1.0-a)*full)>5.0
}
fn inside(walls:&[Shape],shape:&Shape)->bool {let a=share(walls,shape);a>=0.9999 || (1.0-a)*g::area(shape)<=5.0}
fn port_quarters(layout:&Layout)->Vec<usize> {
    let exact:Vec<_>=layout.structure.iter().flat_map(|s|&s.port_districts).flat_map(|d|d.quarters.iter().copied()).collect();
    if !exact.is_empty() {return exact;}
    let mut port:Vec<_>=layout.structure.iter().flat_map(|s|&s.districts)
        .filter(|d|d.role=="port").flat_map(|d|d.quarters.iter().copied()).collect();
    if port.is_empty() {
        // The port role is assigned during programme preparation. Before it,
        // use entire quay-front quarters, never a radius around the town.
        for b in &layout.blocks {
            if layout.streets.iter().filter(|s|s.role=="quay").any(|s|s.path.windows(2).any(|w|
                b.shape.outer.iter().any(|&p|g::distance(p,w[0],w[1]).0<20.0))) {port.push(b.quarter);}
        }
    }
    port.sort_unstable();port.dedup();port.retain(|&q|q<layout.quarters.len());port
}
fn whole_quarters(mut walls:Vec<Shape>,layout:&Layout,port:&[usize],outside:bool)->Vec<Shape> {
    for (qi,q) in layout.quarters.iter().enumerate() {
        if port.contains(&qi) && outside {
            walls=walls.iter().flat_map(|w|g::difference(w,&q.shape)).collect();
        } else if cuts(&walls,&q.shape) || (port.contains(&qi) && !outside) {
            walls.push(q.shape.clone());walls=g::union(&walls);
        }
    }
    walls
}

pub(in super::super) fn port_walls(layout:&mut Layout,cfg:&LayoutConfig,surface:Surface<'_>)->bool {
    let mode=if cfg.port_enclosure.is_empty() {"auto"} else {cfg.port_enclosure.as_str()};
    // The accepted smooth default is an unchanged foundation. Safety checks
    // constrain every new trace and every requested enclosure decision.
    // Stiffness and terrain adherence act on the trace in the quarter stage
    // (parameter_trace). Re-tracing walls here, after parcels, emptied stiff
    // towns: only an explicit port or river decision reworks the circuits.
    if river_mode(cfg)=="none" && mode=="auto" {return false;}
    let _profile=routing::Profile::new("wall.port-enclosures");
    let old:Vec<_>=layout.enclosures.iter().filter(|e|e.purpose.is_empty() && e.path.len()>=4).cloned().collect();
    if old.is_empty() {return false;}
    let port=port_quarters(layout);
    let baseline:Vec<_>=old.iter().map(wall_shape).collect();
    let unsafe_wall=old.iter().any(|e|e.path.windows(2).any(|w|!clear_segment(surface,w[0],w[1])));
    let partial=port.iter().any(|&qi|cuts(&baseline,&layout.quarters[qi].shape));
    if mode=="auto" && !unsafe_wall && !partial {return false;}
    if !unsafe_wall && !partial {
        if port.is_empty() {return false;}
        let own:Vec<_>=layout.enclosures.iter().filter(|e|e.purpose=="port").map(wall_shape).collect();
        if mode=="inside" {
            let mut all=baseline.clone();all.extend(own.iter().cloned());
            if port.iter().all(|&qi|inside(&all,&layout.quarters[qi].shape)) {return false;}
        }
        if mode=="separate" && port.iter().all(|&qi|inside(&own,&layout.quarters[qi].shape)) {return false;}
        if mode=="outside" && port.iter().all(|&qi|share(&baseline,&layout.quarters[qi].shape)*g::area(&layout.quarters[qi].shape)<=5.0)
            && layout.enclosures.iter().any(|e|e.gatehouses.iter().any(|g|g.kind=="water")) {return false;}
    }
    let mut main=baseline.clone();
    let mut own=vec![];
    if !port.is_empty() && (mode!="auto" || partial) {
        let shores:Vec<_>=port.iter().map(|&i|layout.quarters[i].shape.clone()).collect();
        let close=shores.iter().all(|s|s.outer.iter().any(|&p|baseline.iter().any(|w|
            w.outer.iter().any(|&q|dist(p,q)<num(&data()["trace"],"portJoinM",80.0)))));
        let chosen=if mode=="auto" {if close && !unsafe_wall {"inside"} else {"separate"}} else {mode};
        let outside=chosen!="inside";
        if outside {
            for sh in &shores {main=main.iter().flat_map(|w|g::difference(w,sh)).collect();}
            if chosen=="separate" {own=g::union(&shores);}
        } else {
            // A detached quarter joins by a dry terrain route, never by a hull
            // chord through a ridge or channel.
            for shore in &shores {
                if share(&main,shore)>=0.9999 {continue;}
                let pair=main.iter().flat_map(|s|&s.outer).flat_map(|&a|shore.outer.iter().map(move |&b|(a,b)))
                    .min_by(|(a,b),(c,d)|dist(*a,*b).total_cmp(&dist(*c,*d)));
                if let Some((a,b))=pair {
                    let pad=320.0;
                    let mut route=RoutePlanner::new(surface,(a.x.min(b.x)-pad,a.y.min(b.y)-pad,a.x.max(b.x)+pad,a.y.max(b.y)+pad));
                    if let Some(path)=route.route(a,b,grade()) {main.extend(g::ribbon(&path,&[24.0]));}
                }
                main.push(shore.clone());main=g::union(&main);
            }
            if main.len()>baseline.len() {layout.warnings.push("Enceinte du port : liaison impraticable, circuit séparé conservé.".into());}
        }
        main=whole_quarters(main,layout,&port,outside);
    }
    let mut traced=vec![];
    for sh in main {
        if g::area(&sh)<100.0 {continue;}
        // A circuit the ridge repair cannot improve keeps its traced line: the
        // default draw keeps it too, so a stiffness change never drops a wall.
        let sh=safe_trace(&sh,surface).unwrap_or(sh);
        let mut pieces=vec![sh];
        for _ in 0..4 {
            let additions:Vec<_>=layout.quarters.iter().enumerate().filter(|(qi,q)|
                !(port.contains(qi) && (mode=="outside" || mode=="separate")) && cuts(&pieces,&q.shape))
                .map(|(_,q)|q.shape.clone()).collect();
            if additions.is_empty() {break;}
            pieces.extend(additions);pieces=g::union(&pieces);
            pieces=pieces.iter().map(|s|safe_trace(s,surface).unwrap_or_else(|| s.clone())).collect();
        }
        for sh in pieces {
            if !layout.quarters.iter().any(|q|cuts(std::slice::from_ref(&sh),&q.shape)) {
                traced.push((sh,""));
            }
        }
    }
    // A failed port extension must not erase a sound founding circuit.
    // Keep it and protect the remaining shore quarters with their own walls.
    for base in &baseline {
        if inside(&traced.iter().map(|(s,_)|s.clone()).collect::<Vec<_>>(),base) {continue;}
        if mode=="outside" && port.iter().any(|&qi|share(std::slice::from_ref(base),&layout.quarters[qi].shape)*g::area(&layout.quarters[qi].shape)>5.0) {continue;}
        if !base.outer.iter().zip(base.outer.iter().cycle().skip(1)).take(base.outer.len()).all(|(&a,&b)|clear_segment(surface,a,b)) {continue;}
        let occupied_cut=layout.quarters.iter().enumerate().any(|(qi,q)| {
            if !cuts(std::slice::from_ref(base),&q.shape) {return false;}
            let mut total=0.0;let mut enclosed=0.0;
            for b in layout.blocks.iter().filter(|b|b.quarter==qi) {let a=g::area(&b.shape);total+=a;enclosed+=share(std::slice::from_ref(base),&b.shape)*a;}
            enclosed.min(total-enclosed)>20.0
        });
        if !occupied_cut {traced.push((base.clone(),""));}
    }
    if mode=="inside" {
        let covered:Vec<_>=traced.iter().map(|(s,_)|s.clone()).collect();
        let missing:Vec<_>=port.iter().filter(|&&qi|!inside(&covered,&layout.quarters[qi].shape)).map(|&qi|layout.quarters[qi].shape.clone()).collect();
        if !missing.is_empty() {
            layout.warnings.push("Enceinte du port : raccordement contraint, quartiers protégés par leur propre circuit.".into());
            own.extend(g::union(&missing));
        }
    }
    for sh in own {
        let accepted=safe_trace(&sh,surface).filter(|s|!layout.quarters.iter().any(|q|cuts(std::slice::from_ref(s),&q.shape)));
        if let Some(sh)=accepted {traced.push((sh,"port"));continue;}
        // A complex waterfront can have disconnected terraces. Keep whole
        // quarter circuits rather than dropping an entire port cluster.
        for &qi in &port {
            let shore=&layout.quarters[qi].shape;
            if share(std::slice::from_ref(&sh),shore)<0.9999 {continue;}
            let mut accepted=None;
            for pad in [0.0,4.0,12.0,24.0] {
                let candidates=if pad==0.0 {vec![shore.clone()]} else {buffer(shore,pad)};
                accepted=candidates.iter().filter_map(|candidate|safe_trace(candidate,surface)).find(|candidate|
                    share(std::slice::from_ref(candidate),shore)>=0.9999
                    && !layout.quarters.iter().any(|q|cuts(std::slice::from_ref(candidate),&q.shape)));
                if accepted.is_some() {break;}
            }
            if let Some(sh)=accepted {traced.push((sh,"port"));}
            else {layout.warnings.push("Enceinte portuaire : rive impraticable, quartier conservé hors les murs.".into());}
        }
    }
    let template=&old[0];
    let pop=layout.phases.iter().map(|p|p.population).sum::<f64>().max(1000.0) as u32;
    let mut style=styled(&template.style,&layout.culture,pop);style.options(cfg);
    let predicted=Predicted {widths:[12.0,9.0,6.0,4.0,3.0],arterial:1,dwelling:[5.0,5.0]};
    layout.enclosures.retain(|e|!e.purpose.is_empty() && e.purpose!="port");
    for (i,(shape,purpose)) in traced.into_iter().enumerate() {
        let mut path=shape.outer;path.push(path[0]);
        let mut gates=super::super::composition::gates(&path,&layout.streets);let land=gates.len();
        let banks=super::super::composition::water_gates(&path,surface);
        for &(p,_) in &banks {if !gates.iter().any(|&q|dist(p,q)<8.0) {gates.push(p);}}
        let mut e=Enclosure {path,kind:template.kind.clone(),purpose:purpose.into(),gates,..Default::default()};
        build(&mut e,land,&banks,&layout.streets,surface,&style,pop,&predicted,&Rng::new(&format!("{}:port-wall:{i}",layout.key)));
        if mode=="outside" && purpose.is_empty() {
            // A real port approach opens the town curtain. It remains a port
            // gate even when the quay is too far away for a channel span.
            let approach=e.gates.iter().enumerate().filter(|(_,p)|layout.streets.iter().any(|st|
                st.path.windows(2).any(|w|g::distance(**p,w[0],w[1]).0<2.0)))
                .min_by(|(_,a),(_,b)| {
                    let distance=|p:Point|port.iter().map(|&qi|dist(p,g::interior_point(&layout.quarters[qi].shape))).fold(f64::INFINITY,f64::min);
                    distance(**a).total_cmp(&distance(**b))
                }).map(|(i,&p)|(i,p));
            if let Some((gate,p))=approach {
                if let Some(gh)=e.gatehouses.iter_mut().find(|gh|gh.gate==gate) {gh.kind="water".into();}
                else if let Some(st)=layout.streets.iter().find(|st|st.path.windows(2).any(|w|g::distance(p,w[0],w[1]).0<2.0)) {
                    let w=st.path.windows(2).min_by(|a,b|g::distance(p,a[0],a[1]).0.total_cmp(&g::distance(p,b[0],b[1]).0)).unwrap();
                    let along=dir(w[0],w[1]);let across=(-along.1,along.0);let width=st.widths.first().copied().unwrap_or(6.0);
                    e.gatehouses.push(Gatehouse {gate,kind:"water".into(),shape:quad(p,along,across,[-4.0,4.0],[-width*0.5,width*0.5]),
                        masses:vec![],passage:[add(p,along,-4.0),add(p,along,4.0)],passage_width_m:width,height_m:e.height_m});
                }
            }
        }
        layout.enclosures.push(e);
    }
    super::settle(layout,surface);
    if river_mode(cfg)=="bank-walls-chain" {super::options::river_works(layout,surface);}
    true
}

#[cfg(test)]
#[path = "fortification_params_tests.rs"]
mod tests;
