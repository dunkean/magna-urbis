//! Opt-in wall morphology. Every disabled path returns before geometry or RNG work.
use super::*;
use super::super::{Layout, LayoutConfig, GrowthPhase};

#[cfg(test)]
#[path = "fortification_options_tests.rs"]
mod tests;

pub(in super::super) fn keeps_citadel(culture: &str) -> bool {
    culture_override(culture).iter().rev().find_map(|v| v["innerEnclosure"].as_str())
        .or_else(|| group(culture)["innerEnclosure"].as_str()) == Some("citadel")
}

/// Local angular trace: use nearby slope breaks, and the last dry bank position.
/// Existing cross-river curtains are left to the water-gate mechanism.
pub(in super::super) fn option_trace(shape: Shape, surface: Surface<'_>, cfg: &LayoutConfig, wall_width:f64) -> Shape {
    if !cfg.medieval_walls && !cfg.river_control { return shape; }
    let mut path = shape.outer.clone();
    path.push(path[0]);
    let ns = normals(&path);
    let mut points = vec![];
    for (i, w) in path.windows(2).enumerate() {
        let steps = (dist(w[0], w[1]) / 24.0).ceil().max(1.0) as usize;
        for k in 0..steps {
            let p = add(w[0], dir(w[0], w[1]), dist(w[0], w[1]) * k as f64 / steps as f64);
            let n = ns[i];
            let on_shore = cfg.river_control && surface.wet(p)
                && !surface.wet(add(p,n,-wall_width-4.0)) && surface.wet(add(p,n,wall_width+4.0));
            if surface.wet(p) && !on_shore { points.push(p); continue; }
            let mut best = if on_shore {add(p,n,-wall_width-2.0)} else {p};
            let mut score = 0.0;
            if cfg.medieval_walls {
                for off in [-12.0_f64, -6.0, 0.0, 6.0, 12.0] {
                    let q = add(p, n, off);
                    if surface.wet(q) || surface.wet(add(q, n, 4.0)) { continue; }
                    let h = surface.height_at(q);
                    let inside = surface.height_at(add(q, n, -12.0));
                    let outside = surface.height_at(add(q, n, 12.0));
                    let escarpment = (h - outside).max(0.0) / 12.0;
                    let slope_break = ((inside - h) - (h - outside)).abs() / 12.0;
                    let candidate = escarpment + slope_break - off.abs() * 0.004;
                    if candidate > score { score = candidate; best = q; }
                }
            }
            if cfg.river_control && !on_shore {
                // Stay on this bank; never jump to the opposite dry bank.
                if let Some(d) = (1..=40).map(|k| k as f64 * 2.0)
                    .find(|&d| surface.wet(add(p, n, d))) {
                    let candidate = add(p, n, d - wall_width - 2.0);
                    if !surface.wet(candidate) { best = candidate; }
                }
            }
            points.push(best);
        }
    }
    points.push(points[0]);
    let mut ring = g::simplify(&points, if cfg.medieval_walls { 4.0 } else { 1.5 }, |_| false);
    ring.pop();
    let trace = g::normalized(Shape { outer: ring, holes: shape.holes.clone() });
    if trace.outer.len() < 3 || !g::simple(&trace)
        || wet_length(&trace.outer, surface) > wet_length(&shape.outer, surface) + 2.0
        || area(&g::intersection(&trace, &shape)) < g::area(&shape) * 0.94 { shape } else { trace }
}

/// Supply must be local and downhill from a nearby water level. A low wet
/// plain has several nearby wet samples; high terraces cannot acquire a moat.
pub(super) fn ditch_kind(shape: &Shape, surface: Surface<'_>, rng: &Rng) -> &'static str {
    let p = g::interior_point(shape);
    let h = surface.height_at(p);
    let mut supply = false;
    let mut wet_plain = 0;
    let mut relief = 0.0_f64;
    for k in 0..16 {
        let a = k as f64 * std::f64::consts::TAU / 16.0;
        let n = (a.cos(), a.sin());
        relief = relief.max((surface.height_at(add(p, n, 20.0)) - h).abs());
        for d in [12.0, 24.0, 48.0, 72.0] {
            let q = add(p, n, d);
            if surface.wet(q) {
                let wh = surface.height_at(q);
                supply |= h <= wh + 2.0;
                if d <= 24.0 && h <= wh + 1.0 { wet_plain += 1; }
                break;
            }
        }
    }
    let probability = if wet_plain >= 4 { 0.5 } else { 0.25 };
    let key = format!("ditch-supply:{:.0}:{:.0}", (p.x / 48.0).floor(), (p.y / 48.0).floor());
    if supply && relief < 1.5 && rng.fork(&key).chance(probability) { "wet" } else { "dry" }
}

/// Legacy internal entry point; composition now enriches the inherited land.
pub(in super::super) fn gate_villages(plan: &mut super::super::macroplan::Plan,
    _phases: &mut [GrowthPhase], _walls: &[Shape], surface: Surface<'_>) {
    super::super::composition::grow_gate_villages(plan,
        &LayoutConfig {gate_village:Some(1.0),..Default::default()}, surface);
}

/// An actual gate square is public land; service selection then locates inns
/// and a suburb church around these same nuclei, using existing cultural demand.
pub(in super::super) fn prepare_options(layout: &mut Layout, cfg: &LayoutConfig, surface: Surface<'_>) {
    super::super::composition::prepare_gate_villages(layout, cfg, surface);
    if super::parameters::river_mode(cfg) == "bank-walls-chain" { river_works(layout,surface); }
}

pub(in super::super) fn service_cost(layout:&Layout,d:&super::super::programme::Demand,p:Point)->f64 {
    super::super::composition::gate_service_cost(layout, d, p)
}

pub(super) fn river_works(layout:&mut Layout,surface:Surface<'_>) {
    if layout.enclosures.is_empty() {return;}
    let streets:Vec<Shape>=layout.streets.iter().flat_map(|s|g::ribbon(&s.path,
        &s.widths.iter().map(|w|w+2.0).collect::<Vec<_>>())).collect();
    let clear=Cut::new(streets);
    let mut works=vec![];
    let mut spans:Vec<(Point,Point,V,f64,bool)>=vec![];
    // Sample complete streets, including bridge paths with an intermediate wet vertex.
    for st in layout.streets.iter().filter(|s|matches!(s.role.as_str(),"bridge"|"causeway")) {
        let mut entry=None; let mut previous=None;
        for w in st.path.windows(2) {
            let t=dir(w[0],w[1]);let steps=(dist(w[0],w[1])/2.0).ceil().max(1.0) as usize;
            for k in 0..=steps {
                let p=add(w[0],t,dist(w[0],w[1])*k as f64/steps as f64);
                if surface.wet(p) {if entry.is_none() {entry=previous;}}
                else if let Some(a)=entry.take() {
                    let width=st.widths.first().copied().unwrap_or(6.0);
                    if dist(a,p)>8.0 && spans.iter().all(|(b,c,_,_,_)|
                        dist(pt((a.x+p.x)*0.5,(a.y+p.y)*0.5),pt((b.x+c.x)*0.5,(b.y+c.y)*0.5))>40.0)
                        && layout.enclosures.iter().any(|e|e.path.windows(2).any(|w|
                            g::distance(a,w[0],w[1]).0<160.0 || g::distance(p,w[0],w[1]).0<160.0)) {
                        spans.push((a,p,dir(a,p),width,true));
                    }
                }
                previous=Some(p);
            }
        }
    }
    for gate in layout.enclosures.iter().flat_map(|e|&e.gatehouses).filter(|g|g.kind=="water") {
        let [a,b]=gate.passage;
        if dist(a,b)>8.0 && surface.wet(pt((a.x+b.x)*0.5,(a.y+b.y)*0.5)) && spans.iter().all(|(c,d,_,_,_)|
            dist(pt((a.x+b.x)*0.5,(a.y+b.y)*0.5),pt((c.x+d.x)*0.5,(c.y+d.y)*0.5))>40.0) {
            spans.push((a,b,dir(a,b),0.0,false));
        }
    }
    let mut occupied=Cut::new(layout.enclosures.iter().flat_map(|e|e.towers_detail.iter().map(|t|t.footprint.clone())
        .chain(e.gatehouses.iter().flat_map(|g|g.masses.clone())).chain(e.bastions.iter().map(|w|w.shape.clone()))).collect());
    let spec=&data()["riverWorks"];
    let r=num(&spec["bridge-tower"],"radiusM",4.0);
    let tower_pose=|bank:Point,inland:V,n:V,width:f64,occupied:&Cut| {
        for off in [r+3.0,r+7.0,r+12.0] {
            let center=add(add(bank,inland,off),n,width*0.5+r+2.0);
            let tower=disc(center,r,12,0.0);
            if tower.outer.iter().any(|&q|surface.wet(q)) || surface.wet(center)
                || clear.hits(&tower)>0.01 || occupied.hits(&tower)>0.01 {continue;}
            return Some((center,tower));
        }
        None
    };
    // A bank town can control the channel without having a bridge: choose
    // one reachable narrow reach, and build only facing towers and a chain.
    if spans.is_empty() {
        let mut reaches=vec![];
        for e in &layout.enclosures {
            let ns=normals(&e.path);
            for (i,w) in e.path.windows(2).enumerate() {
                let a=pt((w[0].x+w[1].x)*0.5,(w[0].y+w[1].y)*0.5);
                let n=ns[i];
                let Some(start)=(1..=40).map(|k|k as f64*2.0).find(|&d|surface.wet(add(a,n,d))) else {continue;};
                let Some(end)=(1..=150).map(|k|start+k as f64*2.0).find(|&d|!surface.wet(add(a,n,d))) else {continue;};
                if end-start<12.0 {continue;}
                reaches.push((end-start,add(a,n,start-2.0),add(a,n,end),n));
            }
        }
        if let Some((_,a,b,n))=reaches.into_iter().filter(|(_,a,b,t)| {
            let n=(-t.1,t.0);
            tower_pose(*a,(-t.0,-t.1),n,0.0,&occupied).is_some()
                && tower_pose(*b,*t,n,0.0,&occupied).is_some()
        }).min_by(|a,b|a.0.total_cmp(&b.0)) {
            spans.push((a,b,n,0.0,false));
        }
    }
    for (a,b,t,width,bridge) in spans {
        let n=(-t.1,t.0);
        let mut pair=vec![];
        for (bank,inland) in [(a,(-t.0,-t.1)),(b,t)] {
            if let Some((center,tower))=tower_pose(bank,inland,n,width,&occupied) {
                occupied.add(tower.clone());
                works.push(Work {kind:if bridge && pair.is_empty(){"bridge-tower"}else{"facing-tower"}.into(),
                    shape:tower,height_m:num(&spec["bridge-tower"],"heightM",12.0),passage:None});
                pair.push(center);
            }
            if !bridge {continue;}
            // A walled horseshoe on the bank, with the approach left as an open passage.
            let radius=num(&spec["bridgehead"],"radiusM",20.0);
            let center=add(bank,inland,radius*0.6);
            let outer=disc(center,radius,12,0.0);
            let inner=disc(center,radius-num(&spec["bridgehead"],"wallWidthM",2.0),12,0.0);
            for shape in occupied.from(clear.from(g::difference(&outer,&inner))).into_iter()
                .flat_map(|s|g::dry_clip(&surface,&s)).flat_map(|s|buffer(&s,-0.4))
                .filter(|s|g::area(s)>8.0 && s.outer.iter().all(|&p|!surface.wet(p))) {
                works.push(Work {kind:"bridgehead".into(),shape,height_m:6.0,passage:None});
            }
            let depth=num(&spec["bridge-gatehouse"],"depthM",8.0);
            for side in [-1.0,1.0] {
                    let lateral=[side*(width*0.5+2.0),side*(width*0.5+6.0)];
                    let gate=quad(add(bank,inland,depth),inland,n,[-depth*0.5,depth*0.5],
                        [lateral[0].min(lateral[1]),lateral[0].max(lateral[1])]);
                for shape in occupied.from(clear.from(g::dry_clip(&surface,&gate))) {
                    if g::area(&shape)>8.0 {works.push(Work {kind:"bridge-gatehouse".into(),shape,
                        height_m:10.0,passage:Some([bank,add(bank,inland,depth*2.0)])});}
                }
            }
        }
        if pair.len()==2 {
            let width=num(&spec["river-chain"],"widthM",1.2);
            for shape in g::ribbon(&pair,&[width]) {works.push(Work {kind:"river-chain".into(),
                shape,height_m:0.3,passage:Some([pair[0],pair[1]])});}
        }
    }
    if !works.is_empty() {
        layout.enclosures[0].reserve.extend(works.iter().filter(|w|w.kind!="river-chain").map(|w|w.shape.clone()));
        layout.enclosures[0].outworks.extend(works);
        super::settle(layout,surface);
    }
}

/// Facility circuits are within their reserved estates, with the existing
/// street passage; their interiors remain available to buildings and courtyards.
pub(in super::super) fn finish_options(layout:&mut Layout,cfg:&LayoutConfig,surface:Surface<'_>) {
    // The castle's bailey is the lord's garrison district, whatever the options.
    let castles:Vec<_>=layout.enclosures.iter().filter(|e|e.purpose=="castle")
        .map(|e|Shape {outer:e.path.clone(),holes:vec![]}).collect();
    if let Some(s)=&mut layout.structure {for d in &mut s.districts {
        if !d.quarters.is_empty() && d.quarters.iter().all(|&qi|layout.quarters.get(qi).is_some_and(|q|
            castles.iter().any(|c|g::contains(c,g::centroid(&q.shape))))) {
            d.role="garrison".into();d.label="Château".into();d.wealth=d.wealth.max(0.8);
        }
    }}
    if !cfg.old_enclosure_citadel {return;}
    let Some(pr)=&layout.programme else {return;};
    let estates:Vec<_>=pr.reservations.iter().filter_map(|r| {
        let d=pr.demands.iter().find(|d|d.id==r.demand_id)?;
        let purpose=match d.role.as_str() {"worship.cathedral"=>"cathedral-close",
            "defence.castle"|"defence.keep"|"defence.kasbah"=>"urban-castle",_=>return None};
        Some((r.shape.clone(),purpose,r.street))
    }).collect();
    for (shape,purpose,street) in estates {
        if g::area(&shape)<500.0 {continue;}
        let Some(inner)=buffer(&shape,-2.0).into_iter().max_by(|a,b|g::area(a).total_cmp(&g::area(b))) else {continue;};
        let mut path=inner.outer.clone();path.push(path[0]);
        let gate=layout.streets.get(street).and_then(|s|path.windows(2)
            .filter(|w|dist(w[0],w[1])>6.0).map(|w|pt((w[0].x+w[1].x)*0.5,(w[0].y+w[1].y)*0.5))
            .min_by(|&a,&b| {
            let distance=|p|s.path.windows(2).map(|w|g::distance(p,w[0],w[1]).0).fold(f64::INFINITY,f64::min);
            distance(a).total_cmp(&distance(b))
        }));
        if path.iter().any(|&p|surface.wet(p)) {continue;}
        layout.enclosures.push(Enclosure {path,kind:"wall".into(),style:"curtain".into(),purpose:purpose.into(),
            material:"stone".into(),curtain_width_m:1.2,height_m:5.0,gates:gate.into_iter().collect(),..Default::default()});
    }
    // The retained circuit is an inhabited elite enclosure, not an opaque castle lot.
    let citadels:Vec<_>=layout.enclosures.iter().filter(|e|e.purpose=="citadel")
        .map(|e|Shape {outer:e.path.clone(),holes:vec![]}).collect();
    if let Some(s)=&mut layout.structure {for d in &mut s.districts {
        if d.quarters.iter().any(|&qi|layout.quarters.get(qi).is_some_and(|q|
            citadels.iter().any(|c|g::contains(c,g::centroid(&q.shape))))) {
            d.role="elite".into();d.label="Citadelle · quartier fermé".into();d.wealth=d.wealth.max(0.85);
        }
    }}
}
