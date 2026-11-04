//! Water occupies existing public ribbons; lots and street connectivity survive.
use super::{Layout,LayoutConfig,Point,Shape,Surface,geometry as g};
use serde::{Serialize,Deserialize};
use std::collections::{BTreeMap,BinaryHeap};

#[derive(Clone,Debug,Serialize,Deserialize)]
#[serde(rename_all="camelCase")]
pub struct Waterway { pub shape:Shape, pub level_m:f64, pub crossings:Vec<Shape> }
fn dist(a:Point,b:Point)->f64 {(a.x-b.x).hypot(a.y-b.y)}
fn ribbon(a:Point,b:Point,width:f64)->Shape {
    let d=dist(a,b).max(1e-9); let (x,y)=(-(b.y-a.y)/d*width/2.,(b.x-a.x)/d*width/2.);
    Shape{outer:vec![Point{x:a.x+x,y:a.y+y},Point{x:b.x+x,y:b.y+y},Point{x:b.x-x,y:b.y-y},Point{x:a.x-x,y:a.y-y}],holes:vec![]}
}
pub(super) fn apply(layout:&mut Layout,cfg:&LayoutConfig,surface:Surface<'_>) {
    let declared=super::catalogue()["cultures"][&layout.culture]["render"]["lagoon"].as_bool()==Some(true);
    let share=cfg.lagoon_canals.unwrap_or(if declared {1.} else {0.}).clamp(0.,1.);
    if share==0. || layout.structure.is_none() {return;}
    // Culture data: water (sea, lake or river) must lie this close to the streets, else no canals.
    let reach=super::catalogue()["cultures"][&layout.culture]["render"]["canalWaterReachM"].as_f64().unwrap_or(120.);
    let key=|p:Point|((p.x*10.).round() as i64,(p.y*10.).round() as i64);
    let mut nodes=BTreeMap::new(); let mut points=vec![];
    let mut edges:Vec<Vec<(usize,usize,f64)>>=vec![]; let mut segments=vec![];
    for s in &layout.streets {
        if s.rank>2 || !matches!(s.role.as_str(),"street"|"lane"|"major"|"minor"|"radial"|"ring"|"quay"|"port-street") {continue;}
        for (i,w) in s.path.windows(2).enumerate() {
            let width=s.widths.get(i).or(s.widths.first()).copied().unwrap_or(3.);
            if width<5. || dist(w[0],w[1])<2. {continue;}
            let mut ids=[0;2];
            for j in 0..2 {ids[j]=*nodes.entry(key(w[j])).or_insert_with(||{let id=points.len();points.push(w[j]);edges.push(vec![]);id});}
            let id=segments.len();segments.push((w[0],w[1],(width-2.8).clamp(2.2,6.),s.rank));
            let d=dist(w[0],w[1]); edges[ids[0]].push((ids[1],id,d));edges[ids[1]].push((ids[0],id,d));
        }
    }
    let mut costs=vec![f64::INFINITY;points.len()]; let mut previous=vec![None;points.len()];
    let mut queue=BinaryHeap::new();let mut outlets=vec![];let mut outlet_candidates=vec![];
    let blocks:Vec<_>=layout.blocks.iter().filter(|b|b.kind=="block").map(|b|g::ContainmentIndex::new(&b.shape)).collect();
    for (i,&p) in points.iter().enumerate() {
        let mut candidates=vec![];
        for k in 0..24 {let a=k as f64*std::f64::consts::TAU/24.;for d in [4.,8.,12.,20.,30.,40.,60.,90.,120.,160.].into_iter().filter(|&d|d<=reach) {
            let q=Point{x:p.x+d*a.cos(),y:p.y+d*a.sin()};
            if !surface.wet(q) {continue;}
            candidates.push((d,q));break;
        }}
        candidates.sort_by(|a,b|a.0.total_cmp(&b.0));
        // Test the nearest clear outlet once, using cached private-ground indices.
        let best=candidates.into_iter().find(|&(d,q)| {
            let steps=(d/2.).ceil() as usize;
            (1..steps).all(|k|{let t=k as f64/steps as f64;let p=Point{x:p.x+(q.x-p.x)*t,y:p.y+(q.y-p.y)*t};!blocks.iter().any(|b|b.contains(p))})
        });
        if let Some((d,q))=best {outlet_candidates.push((d,i,p,q));}
    }
    outlet_candidates.sort_by(|a,b|a.0.total_cmp(&b.0));
    for (d,i,p,q) in outlet_candidates {
        if outlets.iter().any(|&(_,_,b)|dist(b,q)<100.) {continue;}
        costs[i]=d;queue.push(std::cmp::Reverse((d.to_bits(),i)));outlets.push((i,p,q));
    }
    while let Some(std::cmp::Reverse((bits,i)))=queue.pop() {
        let cost=f64::from_bits(bits);if cost>costs[i] {continue;}
        for &(j,edge,d) in &edges[i] {
            let next=cost+d;
            if next<costs[j] && (surface.height_at(points[j])-surface.height_at(points[i])).abs()<1.5 {
                costs[j]=next;previous[j]=Some((i,edge));queue.push(std::cmp::Reverse((next.to_bits(),j)));
            }
        }
    }
    let mut selected=std::collections::BTreeSet::new();let mut roots=std::collections::BTreeSet::new();
    for (i,links) in edges.iter().enumerate() {
        if !costs[i].is_finite() {continue;}
        if !links.iter().any(|&(_,e,_)|segments[e].3==2 && segments[e].2>=3.) {continue;}
        if ((i as u64).wrapping_mul(2654435761)%1000) as f64 >= share*1000. {continue;}
        let mut j=i;while let Some((k,e))=previous[j] {selected.insert(e);j=k;} roots.insert(j);
    }
    let mut water=vec![];let mut crossed=std::collections::BTreeSet::new();
    for e in selected {
        let (a,b,width,_)=segments[e];let d=dist(a,b);let t=Point{x:(b.x-a.x)/d,y:(b.y-a.y)/d};
        let crossings=[a,b].into_iter().filter(|&p|edges[nodes[&key(p)]].len()>2 && crossed.insert(key(p))).map(|p|ribbon(Point{x:p.x-t.y*(width/2.+1.3),y:p.y+t.x*(width/2.+1.3)},Point{x:p.x+t.y*(width/2.+1.3),y:p.y-t.x*(width/2.+1.3)},2.2)).collect();
        water.push(Waterway{shape:ribbon(a,b,width),level_m:surface.height_at(a).min(surface.height_at(b))+0.04,crossings});
    }
    if !water.is_empty() {for (i,a,b) in outlets {if roots.contains(&i) {water.push(Waterway{shape:ribbon(a,b,2.2),level_m:surface.height_at(a)+0.04,crossings:vec![]});}}}
    layout.structure.as_mut().unwrap().waterways=water;
}

#[cfg(test)]
mod tests {
    use super::*;
    #[test]
    fn coast_review_lagoon_water_needs_an_outlet_and_respects_the_cultural_parameter() {
        let n=100;let height=vec![0.;n*n];let water=(0..n*n).map(|i|u8::from(i%n>70)).collect::<Vec<_>>();
        let surface=Surface{geometry:None,width:1000.,n,height:&height,water:&water};
        let mut layout:Layout=serde_json::from_value(serde_json::json!({"key":"lagoon","culture":"venetian-lagoon","center":{"x":500.,"y":500.},"quarters":[],"blocks":[],"streets":[{"path":[{"x":400.,"y":500.},{"x":550.,"y":500.},{"x":690.,"y":500.}],"widths":[9.,9.,9.],"rank":2,"role":"street"}],"warnings":[],"structure":{}})).unwrap();
        let original=serde_json::to_value(&layout.streets).unwrap();
        apply(&mut layout,&LayoutConfig::default(),surface);
        assert!(!layout.structure.as_ref().unwrap().waterways.is_empty());
        assert_eq!(serde_json::to_value(&layout.streets).unwrap(),original,"canals cannot remove street access");
        apply(&mut layout,&LayoutConfig{lagoon_canals:Some(0.),..Default::default()},surface);
        // A fresh generation at zero keeps the public ribbons dry.
        layout.structure.as_mut().unwrap().waterways.clear();
        apply(&mut layout,&LayoutConfig{lagoon_canals:Some(0.),..Default::default()},surface);
        assert!(layout.structure.as_ref().unwrap().waterways.is_empty());
        let dry=vec![0;n*n];apply(&mut layout,&LayoutConfig::default(),Surface{water:&dry,..surface});
        assert!(layout.structure.as_ref().unwrap().waterways.is_empty());
        // Water beyond `canalWaterReachM` of every street is not "near": no canal network.
        let far=(0..n*n).map(|i|u8::from(i%n>83)).collect::<Vec<_>>();
        apply(&mut layout,&LayoutConfig::default(),Surface{water:&far,..surface});
        assert!(layout.structure.as_ref().unwrap().waterways.is_empty(),"a town away from water digs no canals");
    }
}
