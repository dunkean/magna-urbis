//! Canal networks of the canal cultures (`cultures.<c>.render.canals`).
//!
//! Rules, the same for every town; the cultures differ by data only:
//! - A canal town is a target share of its street length turned to water (`share`; `lagoonCanals`
//!   overrides it). The network grows to that share from the water inward, in order of hierarchy:
//!   one or two main canals along the widest streets (from the water to the centre, the second from
//!   another water front), then secondary canals, then rii.
//! - A canal takes the carriageway of a wide street and keeps a quay (`quayM`) on each side. A rio
//!   (cultures with `rii`) is a lane of at least `rioMinM` turned to water over its whole width, houses
//!   rising from the water. Narrow ways of any culture may serve as connectors to the water (at most
//!   `connectorM` along a path), never as a network of their own. Nothing crosses a block or a lot.
//! - Land access by rule: after conversion every block keeps a land frontage and the land streets keep
//!   the town in one piece; a rio that would cut them stays a street (latest grown first). Every culture
//!   here keeps land access (the Venetian lagoon too: its houses front a rio and a calle).
//! - Reaches are level: the ground of a reach stays within `riseM` of its base; water stands
//!   `freeboardM` below its lowest bank. Lock cultures step `lockStepM` up or down (at most `maxLocks`
//!   from the water) and draw the lock gate.
//! - Feeding: where natural water touches the town, canals open onto it through mouths of at most
//!   `mouthM` (through the town wall as a water gate); else a culture with `feederM` digs at most two
//!   straight level feeders; else a culture with `basin` digs a basin at the junction nearest the centre
//!   with a smaller internal network, and the others dig nothing. Nothing is drawn across the countryside.
//!   Every water piece is connected to a mouth, a feeder or a basin.
//! - Dead ends shorter than 40 m from a junction are pruned; longer ones end in a pool.
//! - Junctions get a round pool of the widest incident channel. Bridges stand where streets meet the
//!   water and where an opening crosses a street, merged within 8 m: always over water.
//!
//! Cost: one pass over the street segments and their blocks (a 64 m bucket grid), a shore search from
//! candidate nodes bounded by `max(mouthM, feederM)`, one Dijkstra over the candidate graph, a sort, and
//! union-find repairs: linear or n log n in the street segments, a few ms for a 20 000-inhabitant town.
use crate::urban::warnings;
use super::{Layout,LayoutConfig,Point,Shape,Surface,geometry as g};
use serde::{Serialize,Deserialize};
use std::cmp::Reverse;
use std::collections::{BTreeMap,BTreeSet,BinaryHeap};

#[derive(Clone,Debug,Serialize,Deserialize)]
#[serde(rename_all="camelCase")]
pub struct Waterway {
    pub shape:Shape,
    /// Water surface (m): one level per reach between locks.
    pub level_m:f64,
    /// Bridge decks over this piece of water.
    pub crossings:Vec<Shape>,
    /// `canal`, `rio`, `pool` (junction or end), `mouth` (opening onto natural water), `feeder` or `basin`.
    #[serde(default="canal_kind")]
    pub kind:String,
    /// 0 main canal, 1 secondary canal, 2 rio.
    #[serde(default)]
    pub rank:u8,
    /// Centre line (two points for a canal, rio, mouth or feeder; the centre for a pool or basin).
    #[serde(default,skip_serializing_if="Vec::is_empty")]
    pub path:Vec<Point>,
    /// Channel width (m); the diameter for a pool or basin.
    #[serde(default)]
    pub width_m:f64,
    /// Lowest ground along this piece (m): the 3D view, whose ground is not dug, lays the water just above it.
    #[serde(default)]
    pub bank_m:f64,
    /// Lock gates across the channel (lock cultures).
    #[serde(default,skip_serializing_if="Vec::is_empty")]
    pub locks:Vec<Shape>,
}
fn canal_kind()->String {"canal".into()}

/// Narrowest channel with quays (m).
const MIN_WIDTH:f64=2.2;
/// Narrowest way usable as a connector to the water (m).
const MIN_CONNECTOR:f64=2.0;
/// Streets whose carriageway may become a canal with quays.
const CANAL_ROLES:&[&str]=&["street","lane","major","minor","radial","ring","market","gate-street","port-street","close","wall-lane","faubourg-lane"];
/// Ways that are not town streets: never water, and outside the share.
const NOT_TOWN:&[&str]=&["regional","outbound","road","track","path","bridge","approach","pier","boardwalk","mole","causeway","landing","port-road","isolated-farm","isolated-mill","stairs","port-stairs"];
/// Bridge deck width and its landing on each side (m); bridges closer than BRIDGE_MERGE merge.
const DECK:f64=2.2;
const LANDING:f64=1.3;
const BRIDGE_MERGE:f64=8.;
/// Dead ends shorter than this from their junction are pruned (m).
const DEAD_END:f64=40.;
/// Block lookup buckets (m).
const CELL:f64=64.;

#[derive(Clone,Copy,Debug)]
struct Params { share:f64, quay:f64, width:f64, main_width:f64, mouth:f64, feeder:f64, rise:f64, freeboard:f64,
    locks:bool, lock_step:f64, max_locks:usize, basin:bool, spacing:f64, rii:bool, rio_min:f64, connector:f64, mains:usize }

fn params(culture:&str,cfg:&LayoutConfig)->Option<Params> {
    let c=&super::catalogue()["cultures"][culture]["render"]["canals"];
    let declared=c.is_object();
    let share=cfg.lagoon_canals.unwrap_or(if declared {c["share"].as_f64().unwrap_or(0.1)} else {0.}).clamp(0.,1.);
    if share<=0. {return None;}
    let f=|k:&str,d:f64|c[k].as_f64().unwrap_or(d);
    Some(Params{
        share, quay:f("quayM",1.4).max(0.), width:f("widthM",4.).max(MIN_WIDTH), main_width:f("mainWidthM",8.).max(MIN_WIDTH),
        mouth:f("mouthM",30.).max(4.), feeder:f("feederM",0.).max(0.), rise:f("riseM",1.5).max(0.2), freeboard:f("freeboardM",0.6).max(0.1),
        locks:c["locks"].as_bool()==Some(true), lock_step:f("lockStepM",2.).max(0.5), max_locks:f("maxLocks",0.).max(0.) as usize,
        basin:c["basin"].as_bool()==Some(true), spacing:f("outletSpacingM",60.).max(10.),
        rii:c["rii"].as_bool()==Some(true), rio_min:f("rioMinM",2.4).max(MIN_CONNECTOR), connector:f("connectorM",150.).max(0.),
        mains:f("mains",2.).clamp(0.,2.) as usize,
    })
}

/// The culture digs canals at this configuration: its water is part of its street network.
pub(super) fn canal_town(culture:&str,cfg:&LayoutConfig)->bool {params(culture,cfg).is_some()}

pub(super) fn apply(layout:&mut Layout,cfg:&LayoutConfig,surface:Surface<'_>) {
    if layout.structure.is_none() {return;}
    let mut stats=Stats::default();
    let water=match params(&layout.culture,cfg) {Some(p)=>plan(layout,p,surface,&mut stats),None=>vec![]};
    // Keep one canal summary per town and log the lengths for tuning.
    layout.warnings.retain(|w|!w.starts_with(warnings::CANALS_PREFIX));
    if stats.town>0. {
        let s=&stats;
        layout.warnings.push(warnings::canals(s.fin, s.locks));
        warnings::log_warning_detail(format_args!(
            "Canals: streets {:.0} m; candidates {:.0} m main, {:.0} m canal, {:.0} m rio, {:.0} m connector; \
             {} openings; reachable {:.0} m; laid {:.0} m, given back {:.0} m, pruned {:.0} m, cut off {:.0} m; \
             final {:.0} m; {} water levels, {} locks.",
            s.town, s.candidates[0], s.candidates[1], s.candidates[2], s.candidates[3], s.openings,
            s.reachable, s.laid, s.given_back, s.pruned, s.cut_off, s.fin, s.levels, s.locks,
        ));
    }
    layout.structure.as_mut().unwrap().waterways=water;
}

fn dist(a:Point,b:Point)->f64 {(a.x-b.x).hypot(a.y-b.y)}
fn lerp(a:Point,b:Point,t:f64)->Point {Point{x:a.x+(b.x-a.x)*t,y:a.y+(b.y-a.y)*t}}
fn unit(a:Point,b:Point)->Point {let d=dist(a,b).max(1e-9);Point{x:(b.x-a.x)/d,y:(b.y-a.y)/d}}
fn add(a:Point,t:Point,k:f64)->Point {Point{x:a.x+t.x*k,y:a.y+t.y*k}}
fn left(t:Point)->Point {Point{x:-t.y,y:t.x}}
fn ribbon(a:Point,b:Point,width:f64)->Shape {
    let d=dist(a,b).max(1e-9); let (x,y)=(-(b.y-a.y)/d*width/2.,(b.x-a.x)/d*width/2.);
    Shape{outer:vec![Point{x:a.x+x,y:a.y+y},Point{x:b.x+x,y:b.y+y},Point{x:b.x-x,y:b.y-y},Point{x:a.x-x,y:a.y-y}],holes:vec![]}
}
/// Polygon circumscribing a circle of `radius`, so ribbon corners on the circle stay covered.
fn disc(c:Point,radius:f64)->Shape {
    let sides:i32=16; let r=radius/(std::f64::consts::PI/f64::from(sides)).cos();
    Shape{outer:(0..sides).map(|k|{let a=f64::from(k)*std::f64::consts::TAU/f64::from(sides);Point{x:c.x+r*a.cos(),y:c.y+r*a.sin()}}).collect(),holes:vec![]}
}
/// A deck across a channel of direction `t` at `c`.
fn deck(c:Point,t:Point,half_span:f64,width:f64)->Shape {let n=left(t);ribbon(add(c,n,-half_span),add(c,n,half_span),width)}
fn cell(q:Point)->(i64,i64) {((q.x*10.).round() as i64,(q.y*10.).round() as i64)}
fn pair(a:usize,b:usize)->(usize,usize) {(a.min(b),a.max(b))}
fn find(parent:&mut [usize],mut i:usize)->usize {
    while parent[i]!=i {parent[i]=parent[parent[i]];i=parent[i];}
    i
}
fn union(parent:&mut [usize],a:usize,b:usize)->bool {
    let (x,y)=(find(parent,a),find(parent,b));
    if x==y {return false;}
    parent[x]=y; true
}

/// Street graph of a layout: shared nodes (0.1 m) and every street segment (nodes, width, length, town street).
struct Streets { points:Vec<Point>, ids:BTreeMap<(i64,i64),usize>, segs:Vec<(usize,usize,f64,f64,bool)> }
fn streets(layout:&Layout)->Streets {
    let mut ids:BTreeMap<(i64,i64),usize>=BTreeMap::new(); let mut points:Vec<Point>=vec![]; let mut segs=vec![];
    for s in &layout.streets {
        let town=!NOT_TOWN.contains(&s.role.as_str());
        for (i,w) in s.path.windows(2).enumerate() {
            let len=dist(w[0],w[1]); if len<0.5 {continue;}
            let width=s.widths.get(i).or(s.widths.first()).copied().unwrap_or(3.);
            let mut node=|q:Point|->usize {
                let k=cell(q); if let Some(&i)=ids.get(&k) {return i;}
                let i=points.len(); ids.insert(k,i); points.push(q); i
            };
            let (a,b)=(node(w[0]),node(w[1]));
            if a!=b {segs.push((a,b,width,len,town));}
        }
    }
    Streets{points,ids,segs}
}
/// Street segments each block fronts (blocks of kind `block`): probes 1.2 m beyond each side of the street.
fn block_frontage(layout:&Layout,st:&Streets)->Vec<Vec<usize>> {
    let blocks:Vec<(usize,g::ContainmentIndex)>=layout.blocks.iter().enumerate().filter(|(_,b)|b.kind=="block").map(|(i,b)|(i,g::ContainmentIndex::new(&b.shape))).collect();
    let mut grid:BTreeMap<(i64,i64),Vec<usize>>=BTreeMap::new();
    for (k,(i,_)) in blocks.iter().enumerate() {
        let (x0,y0,x1,y1)=g::bbox(&layout.blocks[*i].shape);
        if !(x0.is_finite() && y1.is_finite()) || x1-x0>4000. || y1-y0>4000. {continue;}
        for gx in (x0/CELL).floor() as i64..=(x1/CELL).floor() as i64 {
            for gy in (y0/CELL).floor() as i64..=(y1/CELL).floor() as i64 {grid.entry((gx,gy)).or_default().push(k);}
        }
    }
    let mut out:Vec<Vec<usize>>=vec![vec![];layout.blocks.len()];
    for (si,&(a,b,w,len,_)) in st.segs.iter().enumerate() {
        let (pa,pb)=(st.points[a],st.points[b]); let n=left(unit(pa,pb));
        let ts:&[f64]=if len>24. {&[0.25,0.5,0.75]} else {&[0.5]};
        for &t in ts {
            for side in [-1.,1.] {
                let q=add(lerp(pa,pb,t),n,side*(w/2.+1.2));
                let Some(list)=grid.get(&((q.x/CELL).floor() as i64,(q.y/CELL).floor() as i64)) else {continue};
                if let Some(&k)=list.iter().find(|&&k|blocks[k].1.contains(q)) {
                    let bi=blocks[k].0;
                    if !out[bi].contains(&si) {out[bi].push(si);}
                }
            }
        }
    }
    out
}

/// Candidate water segment. `class`: 0 main-canal street, 1 canal street, 2 rio, 3 connector only.
struct Seg { a:usize, b:usize, width:f64, room:f64, class:u8, len:f64, mid_h:f64 }
#[derive(Clone,Copy)]
struct Reach { base:f64, locks:usize }
struct Outlet { node:usize, to:Point, feeder:bool }
fn weight(class:u8)->f64 {match class {0=>1.,1=>1.3,2=>2.,_=>6.}}

/// Shortest weighted paths from the water over the candidates not kept as streets, with level reaches and locks.
struct Tree { reaches:Vec<Reach>, reach_of:Vec<usize>, cost:Vec<f64>, prev:Vec<Option<(usize,usize)>>, root_of:Vec<usize>, child:Vec<usize> }
#[allow(clippy::too_many_arguments)]
fn tree(segs:&[Seg],adj:&[Vec<(usize,usize)>],h:&[f64],p:&Params,roots:&[usize],limit:f64,basin:bool,pinned:&[bool])->Tree {
    let n=adj.len();
    let mut t=Tree{reaches:vec![],reach_of:vec![usize::MAX;n],cost:vec![f64::INFINITY;n],prev:vec![None;n],root_of:vec![usize::MAX;n],child:vec![usize::MAX;segs.len()]};
    let mut conn=vec![0f64;n]; let mut heap=BinaryHeap::new();
    for &r in roots {
        if t.cost[r]==0. {continue;}
        t.reaches.push(Reach{base:h[r],locks:0}); t.reach_of[r]=t.reaches.len()-1; t.cost[r]=0.; t.root_of[r]=r;
        heap.push(Reverse((0f64.to_bits(),r)));
    }
    while let Some(Reverse((bits,i)))=heap.pop() {
        let c=f64::from_bits(bits); if c>t.cost[i] {continue;}
        let r=t.reaches[t.reach_of[i]];
        for &(j,e) in &adj[i] {
            let s=&segs[e];
            if pinned[e] || (s.class==3 && basin) {continue;}
            let next=c+s.len*weight(s.class);
            if next>=t.cost[j] || next>limit {continue;}
            let run=conn[i]+if s.class==3 {s.len} else {0.};
            if run>p.connector {continue;}
            let hi=h[i].max(h[j]).max(s.mid_h); let lo=h[i].min(h[j]).min(s.mid_h);
            let target=if hi-r.base<=p.rise && r.base-lo<=p.rise {Some(t.reach_of[i])}
                else if p.locks && r.locks<p.max_locks {
                    // A lock: the far node opens the next reach up or down, the near one stays in this reach.
                    let b=r.base+p.lock_step*(h[j]-r.base).signum();
                    if (h[j]-b).abs()<=p.rise && s.mid_h<=r.base.max(b)+p.rise && s.mid_h>=r.base.min(b)-p.rise {
                        t.reaches.push(Reach{base:b,locks:r.locks+1}); Some(t.reaches.len()-1)
                    } else {None}
                } else {None};
            let Some(k)=target else {continue};
            t.cost[j]=next; t.prev[j]=Some((i,e)); t.reach_of[j]=k; t.root_of[j]=t.root_of[i]; conn[j]=run;
            heap.push(Reverse((next.to_bits(),j)));
        }
    }
    for j in 0..n {if let Some((_,e))=t.prev[j] {t.child[e]=j;}}
    t
}
/// Whether the ground of segment `e` lies within the level band of reach `r`.
fn fits(t:&Tree,segs:&[Seg],h:&[f64],p:&Params,e:usize,r:usize)->bool {
    let s=&segs[e]; let hi=h[s.a].max(h[s.b]).max(s.mid_h); let lo=h[s.a].min(h[s.b]).min(s.mid_h);
    hi-t.reaches[r].base<=p.rise && t.reaches[r].base-lo<=p.rise
}
/// Adds an edge with its path to the water; refused when that path crosses a street kept for land access.
#[allow(clippy::too_many_arguments)]
fn add_path(t:&Tree,segs:&[Seg],e:usize,in_w:&mut [bool],pinned:&[bool],grown:&mut [usize],step:&mut usize,length:&mut f64)->bool {
    if in_w[e] {return true;}
    if pinned[e] {return false;}
    let s=&segs[e]; let near=if t.cost[s.a]<=t.cost[s.b] {s.a} else {s.b};
    let mut path=vec![e]; let mut j=near;
    while let Some((k,te))=t.prev[j] {if in_w[te] {break;} if pinned[te] {return false;} path.push(te); j=k;}
    for &te in path.iter().rev() {in_w[te]=true; grown[te]=*step; *step+=1; *length+=segs[te].len;}
    true
}
/// Removes the water not joined to a root (mouth, feeder or basin); returns the length removed.
fn drop_unfed(segs:&[Seg],roots:&[usize],in_w:&mut [bool])->f64 {
    let n=segs.iter().map(|s|s.a.max(s.b)+1).chain(roots.iter().map(|&r|r+1)).max().unwrap_or(0);
    let mut wet:Vec<usize>=(0..n).collect();
    for (e,s) in segs.iter().enumerate() {if in_w[e] {union(&mut wet,s.a,s.b);}}
    let fed:BTreeSet<usize>=roots.iter().map(|&r|find(&mut wet,r)).collect();
    let mut removed=0.;
    for (e,s) in segs.iter().enumerate() {
        if in_w[e] && !fed.contains(&find(&mut wet,s.a)) {in_w[e]=false; removed+=s.len;}
    }
    removed
}

/// Lengths (m) at each stage of canal growth, logged for profiling.
#[derive(Default)]
struct Stats { town:f64, candidates:[f64;4], openings:usize, reachable:f64, laid:f64, given_back:f64, pruned:f64, cut_off:f64, fin:f64, levels:usize, locks:usize }

fn plan(layout:&Layout,p:Params,surface:Surface<'_>,stats:&mut Stats)->Vec<Waterway> {
    let st=streets(layout);
    let points=&st.points; let n=points.len();
    let town:f64=st.segs.iter().filter(|s|s.4).map(|s|s.3).sum();
    let quarters:Vec<g::ContainmentIndex>=layout.quarters.iter().map(|q|g::ContainmentIndex::new(&q.shape)).collect();
    let inside=|q:Point|quarters.is_empty() || quarters.iter().any(|c|c.contains(q));
    let blocks:Vec<g::ContainmentIndex>=layout.blocks.iter().filter(|b|!matches!(b.kind.as_str(),"place"|"water"|"quay")).map(|b|g::ContainmentIndex::new(&b.shape)).collect();
    let private=|q:Point|blocks.iter().any(|b|b.contains(q));
    let mut degree=vec![0usize;n]; let mut street_w=vec![0f64;n];
    for s in &st.segs {degree[s.0]+=1;degree[s.1]+=1;street_w[s.0]=street_w[s.0].max(s.2);street_w[s.1]=street_w[s.1].max(s.2);}

    // Candidates: town streets inside the quarters, off the water and not along a shore.
    let mut segs:Vec<Seg>=vec![]; let mut seen=BTreeSet::new();
    let mut street_of:BTreeMap<(usize,usize),usize>=BTreeMap::new();
    for s in &layout.streets {
        if s.rank>4 || !CANAL_ROLES.contains(&s.role.as_str()) {continue;}
        for (i,w) in s.path.windows(2).enumerate() {
            let (a,b)=(w[0],w[1]); let len=dist(a,b); if len<1. {continue;}
            let width=s.widths.get(i).or(s.widths.first()).copied().unwrap_or(3.);
            let (Some(&ia),Some(&ib))=(st.ids.get(&cell(a)),st.ids.get(&cell(b))) else {continue};
            if ia==ib || !seen.insert(pair(ia,ib)) {continue;}
            let room=width-2.*p.quay;
            let class:u8=if room>=MIN_WIDTH {if s.rank<=1 || room>=p.main_width {0} else {1}}
                else if p.rii && width>=p.rio_min {2} else if width>=MIN_CONNECTOR {3} else {continue};
            let mid=lerp(a,b,0.5); let nrm=left(unit(a,b)); let side=width/2.+4.;
            if surface.wet(a) || surface.wet(b) || surface.wet(mid) || !inside(mid) {continue;}
            // A street along a shore already has its water: no canal beside the river or the sea.
            if surface.wet(add(mid,nrm,side)) || surface.wet(add(mid,nrm,-side)) {continue;}
            street_of.insert(pair(ia,ib),segs.len());
            segs.push(Seg{a:ia,b:ib,width,room,class,len,mid_h:surface.height_at(mid)});
        }
    }
    stats.town=town;
    for s in &segs {stats.candidates[usize::from(s.class.min(3))]+=s.len;}
    if segs.is_empty() || town<=0. {return vec![];}
    let mut adj:Vec<Vec<(usize,usize)>>=vec![vec![];n];
    for (e,s) in segs.iter().enumerate() {adj[s.a].push((s.b,e));adj[s.b].push((s.a,e));}
    let h:Vec<f64>=points.iter().map(|&q|surface.height_at(q)).collect();
    let mut comp:Vec<usize>=(0..n).collect();
    for s in &segs {union(&mut comp,s.a,s.b);}
    let comp_of:Vec<usize>=(0..n).map(|i|find(&mut comp,i)).collect();

    // Feeding: mouths where water touches the town (a wall is passed by a water gate), else feeders, else a basin.
    let walls:Vec<(Point,Point)>=layout.enclosures.iter().flat_map(|e|e.path.windows(2).map(|w|(w[0],w[1])).collect::<Vec<_>>()).collect();
    let on_map=|q:Point|q.x>=0. && q.y>=0. && q.x<surface.width && q.y<surface.width;
    let reach=p.mouth.max(p.feeder);
    let link_ok=|i:usize,q:Point,d:f64|->bool {
        let o=points[i]; let steps=(d/2.).ceil().max(1.) as usize;
        for k in 1..steps {
            let s=lerp(o,q,k as f64/steps as f64);
            if surface.wet(s) {break;}
            let hs=surface.height_at(s);
            if hs-h[i]>p.rise || (!p.locks && h[i]-hs>p.rise+p.freeboard+1.5) || private(s) {return false;}
        }
        d<=p.mouth || !walls.iter().any(|&(a,b)|g::segment_hit(o,q,a,b).is_some())
    };
    // Raster prefilter: only nodes with a water cell within reach (plus two cells for vector shores) search rays.
    let cell_m=surface.width/surface.n.max(1) as f64; let m=surface.n as i64; let k=(reach/cell_m).ceil() as i64+2;
    let near_water=|q:Point|->bool {
        let (cx,cy)=((q.x/cell_m).floor() as i64,(q.y/cell_m).floor() as i64);
        if cx-k<0 || cy-k<0 || cx+k>=m || cy+k>=m {return true;}
        ((cy-k)..=(cy+k)).any(|y|((cx-k)..=(cx+k)).any(|x|surface.water[(y*m+x) as usize]!=0))
    };
    let mut found:Vec<(f64,Outlet)>=vec![];
    for i in 0..n {
        if adj[i].is_empty() || !near_water(points[i]) {continue;}
        let o=points[i]; let mut candidates=vec![];
        for k in 0..24_i32 {
            let a=f64::from(k)*std::f64::consts::TAU/24.;
            for d in [4.,6.,8.,12.,16.,20.,25.,30.,40.,50.,60.,75.,90.,110.,130.] {
                if d>reach {break;}
                let q=Point{x:o.x+d*a.cos(),y:o.y+d*a.sin()};
                if !on_map(q) {break;}
                if surface.wet(q) {candidates.push((d,q));break;}
            }
        }
        candidates.sort_by(|a,b|a.0.total_cmp(&b.0));
        if let Some(&(d,q))=candidates.iter().take(6).find(|&&(d,q)|link_ok(i,q,d)) {
            found.push((d,Outlet{node:i,to:q,feeder:d>p.mouth}));
        }
    }
    found.sort_by(|a,b|a.0.total_cmp(&b.0));
    let mouths=found.iter().any(|(_,o)|!o.feeder);
    let mut outlets:Vec<Outlet>=vec![];
    for (_,o) in found {
        if o.feeder==mouths || (o.feeder && outlets.len()>=2) {continue;}
        // Spacing within one connected street network: a separate network keeps its own mouth.
        if outlets.iter().any(|k|comp_of[k.node]==comp_of[o.node] && (dist(points[k.node],points[o.node])<p.spacing || dist(k.to,o.to)<p.spacing)) {continue;}
        outlets.push(o);
    }

    let mut limit=f64::INFINITY; let mut share=p.share; let mut basin=None;
    let mut roots:Vec<usize>=outlets.iter().map(|o|o.node).collect();
    if roots.is_empty() {
        if !p.basin {return vec![];}
        // A basin fed by a spring or a cistern at the junction nearest the centre, with a smaller network.
        let c=layout.center;
        let Some(root)=(0..n).filter(|&i|adj[i].iter().filter(|&&(_,e)|segs[e].class<=2).count()>=2)
            .min_by(|&a,&b|dist(points[a],c).total_cmp(&dist(points[b],c))) else {return vec![];};
        let radius:f64=layout.quarters.iter().flat_map(|q|q.shape.outer.iter()).map(|&q|dist(q,c)).fold(0.,f64::max);
        limit=if radius>0. {(0.6*radius).max(80.)} else {200.};
        share*=0.6; basin=Some(root); roots.push(root);
    }
    let roots_set:BTreeSet<usize>=roots.iter().copied().collect();
    let target=share*town;
    let mut in_w=vec![false;segs.len()]; let mut pinned=vec![false;segs.len()];
    let mut grown=vec![usize::MAX;segs.len()]; let mut step=0usize; let mut length=0f64;
    let mut main_edge=vec![false;segs.len()];
    let mut t=tree(&segs,&adj,&h,&p,&roots,limit,basin.is_some(),&pinned);
    stats.openings=outlets.len();
    stats.reachable=segs.iter().filter(|s|s.class<=2 && t.cost[s.a].is_finite() && t.cost[s.b].is_finite()).map(|s|s.len).sum();

    // Main canals first: from the water to the canal junction nearest the centre, the second from another water front.
    let canal_node=|t:&Tree,i:usize|t.cost[i].is_finite() && adj[i].iter().any(|&(_,e)|segs[e].class<=1);
    let c=layout.center;
    let by_centre=|a:&usize,b:&usize|dist(points[*a],c).total_cmp(&dist(points[*b],c));
    let mut mains:Vec<usize>=vec![];
    if p.mains>=1 && let Some(m1)=(0..n).filter(|&i|canal_node(&t,i)).min_by(by_centre) {
        mains.push(m1);
        if p.mains>=2 && let Some(m2)=(0..n).filter(|&i|canal_node(&t,i) && t.root_of[i]!=t.root_of[m1]).min_by(by_centre) {mains.push(m2);}
    }
    for &m in &mains {
        let mut j=m;
        while let Some((k,e))=t.prev[j] {if segs[e].class<=1 {main_edge[e]=true;} j=k;}
        if let Some((_,e))=t.prev[m] {let before=length; add_path(&t,&segs,e,&mut in_w,&pinned,&mut grown,&mut step,&mut length); stats.laid+=length-before;}
    }
    let frontage=block_frontage(layout,&st);
    // Lanes: the chains of candidate pieces between two street junctions. A rio is a whole lane or none: conversion,
    // give-back and reconnection act on lanes, so no stub of street or of water is left inside a lane.
    let junction:Vec<bool>=(0..n).map(|i|degree[i]!=2 || adj[i].len()!=2 || roots_set.contains(&i)).collect();
    let mut lane_of=vec![usize::MAX;segs.len()]; let mut lanes:Vec<Vec<usize>>=vec![];
    for e0 in 0..segs.len() {
        if lane_of[e0]!=usize::MAX {continue;}
        let id=lanes.len(); let mut chain=vec![e0]; lane_of[e0]=id;
        for start in [segs[e0].a,segs[e0].b] {
            let (mut from,mut j)=(e0,start);
            while !junction[j] {
                let Some(&(k,e))=adj[j].iter().find(|&&(_,e)|e!=from) else {break};
                if lane_of[e]!=usize::MAX {break;}
                lane_of[e]=id; chain.push(e); from=e; j=k;
            }
        }
        lanes.push(chain);
    }
    // The two end nodes of a lane (none for a closed loop).
    let lane_ends=|lane:&[usize]|->Option<(usize,usize)> {
        let mut seen_ends=BTreeMap::<usize,usize>::new();
        for &e in lane {for v in [segs[e].a,segs[e].b] {*seen_ends.entry(v).or_insert(0)+=1;}}
        let ends:Vec<usize>=seen_ends.into_iter().filter(|&(_,c)|c%2==1).map(|(v,_)|v).collect();
        (ends.len()==2).then(||(ends[0],ends[1]))
    };
    let rio_lane=|id:usize|lanes[id].iter().any(|&e|segs[e].class>=2);
    // Street pieces meeting at each node (every street, for the junction rule).
    let mut at:Vec<Vec<usize>>=vec![vec![];n];
    for (si,s) in st.segs.iter().enumerate() {at[s.0].push(si); at[s.1].push(si);}
    // A rio lane left partly water is completed when all of it is free and reached, else given back to the street.
    let settle=|in_w:&mut [bool],pinned:&[bool],grown:&mut [usize],step:&mut usize,t:&Tree,complete:bool|->(f64,f64) {
        let (mut added,mut removed)=(0f64,0f64);
        for (id,lane) in lanes.iter().enumerate() {
            if !rio_lane(id) {continue;}
            let wet=lane.iter().filter(|&&e|in_w[e]).count();
            if wet==0 || wet==lane.len() {continue;}
            let free=complete && lane.iter().all(|&e|!pinned[e] && t.reach_of[segs[e].a]!=usize::MAX && t.reach_of[segs[e].b]!=usize::MAX);
            for &e in lane {
                if free && !in_w[e] {in_w[e]=true; grown[e]=*step; *step+=1; added+=segs[e].len;}
                else if !free && in_w[e] {in_w[e]=false; removed+=segs[e].len;}
            }
        }
        (added,removed)
    };
    // Rounds: grow to the share, give rii back for land access, drop water cut off from its feed. A later round
    // routes around the streets kept for land access (a new tree without them).
    for round in 0..3 {
        if round>0 {t=tree(&segs,&adj,&h,&p,&roots,limit,basin.is_some(),&pinned);}
        let mut order:Vec<(f64,usize)>=segs.iter().enumerate()
            .filter(|&(e,s)|t.cost[s.a].is_finite() && t.cost[s.b].is_finite() && s.class!=3 && (s.class!=2 || p.rii) && !pinned[e]
                && (t.child[e]!=usize::MAX || fits(&t,&segs,&h,&p,e,t.reach_of[s.a]) && fits(&t,&segs,&h,&p,e,t.reach_of[s.b])))
            .map(|(e,s)|(t.cost[s.a].min(t.cost[s.b])+s.len*weight(s.class)/2.,e)).collect();
        order.sort_by(|a,b|a.0.total_cmp(&b.0));
        for &(_,e) in &order {
            if length>=target {break;}
            let before=length; add_path(&t,&segs,e,&mut in_w,&pinned,&mut grown,&mut step,&mut length); stats.laid+=length-before;
        }
        let (added,removed)=settle(&mut in_w,&pinned,&mut grown,&mut step,&t,true);
        length+=added-removed; stats.laid+=added; stats.given_back+=removed;
        // Land access: rii cut their street; every block keeps a land frontage, the land streets one network.
        let cut=|si:usize,in_w:&[bool]|->Option<usize> {
            let s=&st.segs[si];
            street_of.get(&pair(s.0,s.1)).copied().filter(|&e|in_w[e] && segs[e].class>=2)
        };
        // Every junction of three or more streets keeps a land street: the latest grown rio lane there goes back,
        // so every lane ends on land and the reconnection below can rejoin any district by single lanes.
        for i in 0..n {
            if degree[i]<3 || at[i].iter().any(|&si|cut(si,&in_w).is_none()) {continue;}
            let latest=at[i].iter().filter_map(|&si|cut(si,&in_w)).max_by_key(|&e|grown[e]);
            if let Some(e)=latest {
                for &x in &lanes[lane_of[e]] {if in_w[x] {in_w[x]=false; length-=segs[x].len; stats.given_back+=segs[x].len;} pinned[x]=true;}
            }
        }
        for f in &frontage {
            if f.is_empty() || f.iter().any(|&si|cut(si,&in_w).is_none()) {continue;}
            let latest=f.iter().filter_map(|&si|cut(si,&in_w)).max_by_key(|&e|grown[e]);
            // The whole lane goes back to the street, not one piece of it.
            if let Some(e)=latest {
                for &x in &lanes[lane_of[e]] {if in_w[x] {in_w[x]=false; length-=segs[x].len; stats.given_back+=segs[x].len;} pinned[x]=true;}
            }
        }
        let mut land:Vec<usize>=(0..n).collect(); let mut land_deg=vec![0usize;n];
        for si in 0..st.segs.len() {
            if cut(si,&in_w).is_none() {let s=&st.segs[si]; union(&mut land,s.0,s.1); land_deg[s.0]+=1; land_deg[s.1]+=1;}
        }
        // Reconnection by whole lanes, latest grown first: a lane goes back when its two ends lie in separate land networks.
        let mut wet_lanes:Vec<usize>=(0..lanes.len()).filter(|&id|rio_lane(id) && lanes[id].iter().all(|&e|in_w[e])).collect();
        wet_lanes.sort_by_key(|&id|Reverse(lanes[id].iter().map(|&e|grown[e]).max().unwrap_or(0)));
        for id in wet_lanes {
            let Some((a,b))=lane_ends(&lanes[id]) else {continue};
            if land_deg[a]>0 && land_deg[b]>0 && find(&mut land,a)!=find(&mut land,b) {
                union(&mut land,a,b);
                for &e in &lanes[id] {in_w[e]=false; pinned[e]=true; length-=segs[e].len; stats.given_back+=segs[e].len;}
            }
        }
        let dropped=drop_unfed(&segs,&roots,&mut in_w); length-=dropped; stats.cut_off+=dropped;
        if length>=target*0.98 {break;}
    }
    // Dead ends, once grown: a branch shorter than DEAD_END from its junction goes back to the street.
    for _ in 0..4 {
        let mut wdeg=vec![0usize;n];
        for (e,s) in segs.iter().enumerate() {if in_w[e] {wdeg[s.a]+=1;wdeg[s.b]+=1;}}
        let mut changed=false;
        for leaf in 0..n {
            if wdeg[leaf]!=1 || roots_set.contains(&leaf) {continue;}
            let (mut j,mut from,mut acc,mut chain)=(leaf,usize::MAX,0f64,Vec::<usize>::new());
            loop {
                let Some(&(k,e))=adj[j].iter().find(|&&(_,e)|in_w[e] && e!=from) else {break};
                acc+=segs[e].len; chain.push(e); from=e; j=k;
                if wdeg[j]!=2 || roots_set.contains(&j) || acc>=DEAD_END {break;}
            }
            if acc<DEAD_END && wdeg[j]>=3 {
                for e in chain {in_w[e]=false; changed=true; stats.pruned+=segs[e].len;}
            }
        }
        if !changed {break;}
    }
    stats.cut_off+=drop_unfed(&segs,&roots,&mut in_w);
    // Water whose ends the last tree does not reach has no level: it goes back to the street.
    for (e,s) in segs.iter().enumerate() {if in_w[e] && (t.reach_of[s.a]==usize::MAX || t.reach_of[s.b]==usize::MAX) {in_w[e]=false; stats.cut_off+=s.len;}}
    let (_,removed)=settle(&mut in_w,&pinned,&mut grown,&mut step,&t,false); stats.cut_off+=removed;
    stats.cut_off+=drop_unfed(&segs,&roots,&mut in_w);
    let Tree{reaches,reach_of,child,..}=t;
    let chosen:Vec<usize>=(0..segs.len()).filter(|&e|in_w[e]).collect();
    if chosen.is_empty() {return vec![];}

    // Reaches joined by loops share one level; a lock is a tree edge between two reaches.
    let mut parent:Vec<usize>=(0..reaches.len()).collect();
    for &e in &chosen {
        if child[e]==usize::MAX {let s=&segs[e]; union(&mut parent,reach_of[s.a],reach_of[s.b]);}
    }
    let near_of=|e:usize|if segs[e].a==child[e] {segs[e].b} else {segs[e].a};
    let mut lock=vec![false;segs.len()];
    for &e in &chosen {
        if child[e]!=usize::MAX {lock[e]=find(&mut parent,reach_of[near_of(e)])!=find(&mut parent,reach_of[child[e]]);}
    }
    let edge_reach=|e:usize,parent:&mut Vec<usize>|->usize {
        let end=if child[e]!=usize::MAX {child[e]} else {segs[e].a};
        find(parent,reach_of[end])
    };
    let mut wdeg=vec![0usize;n];
    for &e in &chosen {wdeg[segs[e].a]+=1;wdeg[segs[e].b]+=1;}
    let mut low=vec![f64::INFINITY;reaches.len()];
    for i in 0..n {if wdeg[i]>0 {let r=find(&mut parent,reach_of[i]);low[r]=low[r].min(h[i]);}}
    for &e in &chosen {if !lock[e] {let r=edge_reach(e,&mut parent);low[r]=low[r].min(segs[e].mid_h);}}
    let level=|r:usize|low[r]-p.freeboard;
    stats.fin=chosen.iter().map(|&e|segs[e].len).sum();
    stats.locks=chosen.iter().filter(|&&e|lock[e]).count();
    stats.levels=chosen.iter().map(|&e|edge_reach(e,&mut parent)).collect::<BTreeSet<usize>>().len();

    let mut width=vec![0f64;segs.len()]; let mut wmax=vec![0f64;n];
    for &e in &chosen {
        let s=&segs[e];
        width[e]=if s.class>=2 {s.width.max(MIN_CONNECTOR)} else {s.room.min(if main_edge[e] {p.main_width} else {p.width}).max(MIN_WIDTH)};
        for end in [s.a,s.b] {wmax[end]=wmax[end].max(width[e]);}
    }
    let outlet_at:BTreeMap<usize,&Outlet>=outlets.iter().filter(|o|wdeg[o.node]>0).map(|o|(o.node,o)).collect();
    let mut water:Vec<Waterway>=vec![]; let mut index_of=vec![usize::MAX;segs.len()];
    let mut decks:Vec<Point>=vec![];
    let mut bridge=|water:&mut Vec<Waterway>,piece:usize,at:Point,shape:Shape| {
        if piece==usize::MAX || decks.iter().any(|&d|dist(d,at)<BRIDGE_MERGE) {return;}
        decks.push(at); water[piece].crossings.push(shape);
    };
    for &e in &chosen {
        let s=&segs[e]; let (a,b)=(points[s.a],points[s.b]); let w=width[e];
        let r=edge_reach(e,&mut parent); let bank=h[s.a].min(h[s.b]).min(s.mid_h);
        let (kind,rank):(String,u8)=if s.class>=2 {("rio".into(),2)} else {(canal_kind(),u8::from(!main_edge[e]))};
        let (mut from,mut to)=(a,b); let mut locks=vec![];
        if lock[e] {
            let near=near_of(e); let (pn,pf)=(points[near],points[child[e]]); let gap=wmax[near]/2.;
            from=pn; to=pf;
            if s.len>2.*gap+2. {from=add(pn,unit(pn,pf),gap); locks.push(deck(from,unit(pn,pf),w/2.+0.6,0.8));}
        }
        water.push(Waterway{shape:ribbon(from,to,w),level_m:level(r),crossings:vec![],kind,rank,path:vec![from,to],width_m:w,bank_m:bank,locks});
        index_of[e]=water.len()-1;
    }
    // Pools at junctions and dead ends, the basin, mouths and feeders.
    let main_centre=mains.first().copied().filter(|&m|wdeg[m]>0);
    for i in 0..n {
        if wdeg[i]==0 {continue;}
        let r=find(&mut parent,reach_of[i]); let c=points[i];
        let outlet=outlet_at.get(&i);
        let wide=street_w[i].max(wmax[i]);
        // A straight run of one width needs no pool: only bends, junctions, ends and openings get one.
        let through=wdeg[i]==2 && outlet.is_none() && {
            let e2:Vec<usize>=adj[i].iter().map(|&(_,e)|e).filter(|&e|in_w[e]).collect();
            let o2=|e:usize|if segs[e].a==i {points[segs[e].b]} else {points[segs[e].a]};
            let (d1,d2)=(unit(c,o2(e2[0])),unit(c,o2(e2[1])));
            d1.x*d2.x+d1.y*d2.y < -0.985 && (width[e2[0]]-width[e2[1]]).abs()<0.05
        };
        if Some(i)==basin || p.basin && Some(i)==main_centre {
            water.push(Waterway{shape:disc(c,wide/2.),level_m:level(r),crossings:vec![],kind:"basin".into(),rank:0,path:vec![c],width_m:wide,bank_m:h[i],locks:vec![]});
        } else if !through {
            water.push(Waterway{shape:disc(c,wmax[i]/2.),level_m:level(r),crossings:vec![],kind:"pool".into(),rank:1,path:vec![c],width_m:wmax[i],bank_m:h[i],locks:vec![]});
        }
        if let Some(o)=outlet {
            let t=unit(c,o.to); let end=add(o.to,t,3.); let len=dist(c,end);
            let w=if o.feeder {wmax[i].min(p.width)} else {wmax[i]};
            water.push(Waterway{shape:ribbon(c,end,w),level_m:level(r),crossings:vec![],kind:(if o.feeder {"feeder"} else {"mouth"}).into(),rank:0,path:vec![c,end],width_m:w,
                bank_m:h[i].min(surface.height_at(lerp(c,o.to,0.5))),locks:vec![]});
            let piece=water.len()-1;
            // Streets crossed by the opening keep their way over a bridge.
            for &(a,b,sw,_,_) in &st.segs {
                if a==i || b==i {continue;}
                let (pa,pb)=(points[a],points[b]);
                let Some((u,q))=g::segment_hit(c,end,pa,pb) else {continue};
                if u*len<1. || (dist(q,o.to)<1. && surface.wet(q)) {continue;}
                let along=unit(pa,pb); let sin=(t.x*along.y-t.y*along.x).abs().max(0.35);
                bridge(&mut water,piece,q,ribbon(add(q,along,-(w/2.+LANDING)/sin),add(q,along,(w/2.+LANDING)/sin),sw.clamp(DECK,4.)));
            }
        }
    }
    // Bridges where streets meet the water: one across a through channel, else one on each channel leaving a junction.
    for i in 0..n {
        if wdeg[i]==0 {continue;}
        let mouth=usize::from(outlet_at.contains_key(&i));
        let dry=degree[i].saturating_sub(wdeg[i]);
        if wdeg[i]+mouth<2 || (dry==0 && wdeg[i]<3) {continue;}
        let c=points[i];
        let edges:Vec<usize>=adj[i].iter().map(|&(_,e)|e).filter(|&e|in_w[e]).collect();
        let other=|e:usize|if segs[e].a==i {points[segs[e].b]} else {points[segs[e].a]};
        if edges.len()==2 && mouth==0 {
            let (d1,d2)=(unit(c,other(edges[0])),unit(c,other(edges[1])));
            let t=Point{x:d1.x-d2.x,y:d1.y-d2.y}; let l=t.x.hypot(t.y);
            if l<0.4 {continue;}
            // Across the bisector: a bend widens the crossing by 1 / cos of its half angle.
            let t=Point{x:t.x/l,y:t.y/l}; let cos=(t.x*d1.x+t.y*d1.y).abs().max(0.5);
            bridge(&mut water,index_of[edges[0]],c,deck(c,t,wmax[i]/2./cos+LANDING,DECK));
            continue;
        }
        for &e in &edges {
            let t=unit(c,other(e)); let off=wmax[i]/2.*1.03+DECK/2.+0.4;
            let at=if segs[e].len>2.*off+2. {add(c,t,off)} else {lerp(c,other(e),0.5)};
            bridge(&mut water,index_of[e],at,deck(at,t,width[e]/2.+LANDING,DECK));
        }
    }
    water
}

#[cfg(test)]
mod tests {
    use super::*;
    const N:usize=100;
    /// A 6 x 6 grid town (60 m blocks, 8 m streets) between x, y = 300 and 600 on a 1 km map.
    fn town(culture:&str)->Layout {
        let xs:Vec<f64>=(0..6).map(|k|300.+60.*k as f64).collect();
        let widths:Vec<f64>=vec![8.;6];
        let mut streets:Vec<serde_json::Value>=vec![];
        for &v in &xs {
            let row:Vec<serde_json::Value>=xs.iter().map(|&u|serde_json::json!({"x":u,"y":v})).collect();
            let column:Vec<serde_json::Value>=xs.iter().map(|&u|serde_json::json!({"x":v,"y":u})).collect();
            streets.push(serde_json::json!({"path":row,"widths":widths,"rank":2,"role":"street"}));
            streets.push(serde_json::json!({"path":column,"widths":widths,"rank":2,"role":"street"}));
        }
        let square=|x0:f64,y0:f64,x1:f64,y1:f64|serde_json::json!({"outer":[{"x":x0,"y":y0},{"x":x1,"y":y0},{"x":x1,"y":y1},{"x":x0,"y":y1}],"holes":[]});
        let mut blocks=vec![];
        for i in 0..5 {for j in 0..5 {
            let (x,y)=(xs[i],xs[j]);
            blocks.push(serde_json::json!({"shape":square(x+5.,y+5.,x+55.,y+55.),"quarter":0,"kind":"block","axis":{"x":1.,"y":0.}}));
        }}
        serde_json::from_value(serde_json::json!({"key":"canals","culture":culture,"center":{"x":450.,"y":450.},
            "quarters":[{"shape":square(290.,290.,610.,610.),"phase":0}],"blocks":blocks,"streets":streets,"warnings":[],"structure":{}})).unwrap()
    }
    fn surface<'a>(height:&'a [f32],water:&'a [u8])->Surface<'a> {
        Surface{geometry:None,width:1000.,n:N,height,water,interpolation:Default::default()}
    }
    fn full()->LayoutConfig {LayoutConfig{lagoon_canals:Some(1.),..Default::default()}}
    fn ways(layout:&Layout)->&[Waterway] {&layout.structure.as_ref().unwrap().waterways}
    /// Water east of x = 610 m: the town's east street runs 10 m from the shore.
    fn east_water()->Vec<u8> {(0..N*N).map(|i|u8::from(i%N>60)).collect()}

    #[test]
    fn canals_open_onto_adjacent_water_and_form_one_connected_network() {
        let height=vec![1.;N*N]; let water=east_water();
        let mut layout=town("venetian-lagoon");
        let streets=serde_json::to_value(&layout.streets).unwrap();
        apply(&mut layout,&full(),surface(&height,&water));
        let w=ways(&layout);
        assert!(w.iter().filter(|x|x.kind=="canal").count()>10,"a canal town reads as one");
        assert!(w.iter().any(|x|x.kind=="mouth"));
        assert!(!w.iter().any(|x|x.kind=="feeder" || x.kind=="basin"),"adjacent water needs no feeder");
        assert_eq!(serde_json::to_value(&layout.streets).unwrap(),streets,"canals keep street access");
        // Nothing beyond the town and its mouths: no stroke across the countryside.
        for x in w {for q in &x.shape.outer {assert!(q.x>280. && q.x<650. && q.y>280. && q.y<620.,"{} at {:?}",x.kind,q);}}
        // Every canal joins a mouth through other canals.
        let pieces:Vec<&Waterway>=w.iter().filter(|x|matches!(x.kind.as_str(),"canal"|"mouth")).collect();
        let mut parent:Vec<usize>=(0..pieces.len()).collect();
        for a in 0..pieces.len() {for b in 0..a {
            if pieces[a].path.iter().any(|p|pieces[b].path.iter().any(|q|dist(*p,*q)<0.5)) {let (x,y)=(find(&mut parent,a),find(&mut parent,b));parent[x]=y;}
        }}
        for a in 0..pieces.len() {
            let root=find(&mut parent,a);
            assert!((0..pieces.len()).any(|b|pieces[b].kind=="mouth" && find(&mut parent,b)==root),"canal {a} is not fed");
        }
        // Main canals are wider than secondary ones, and every width fits the street minus its quays.
        for x in w.iter().filter(|x|x.kind=="canal") {assert!(x.width_m>=MIN_WIDTH && x.width_m<=8.);}
    }

    #[test]
    fn canals_stay_on_level_ground() {
        // The ground falls 4.8 m per block toward the water: only the shore street is level enough.
        let height:Vec<f32>=(0..N*N).map(|i|((600.-(i%N) as f64*10.-5.).max(0.)*0.08) as f32).collect();
        let water=east_water();
        let mut layout=town("venetian-lagoon");
        apply(&mut layout,&full(),surface(&height,&water));
        let s=surface(&height,&water);
        let rise=params("venetian-lagoon",&full()).unwrap().rise;
        for x in ways(&layout).iter().filter(|x|x.kind=="canal") {
            let (a,b)=(x.path[0],x.path[1]);
            assert!((s.height_at(a)-s.height_at(b)).abs()<=2.*rise+1e-6,"canal climbs from {a:?} to {b:?}");
            for k in 0..=10 {let q=lerp(a,b,k as f64/10.);assert!(s.height_at(q)>=x.level_m-1e-6,"canal above its bank at {q:?}");}
        }
    }

    #[test]
    fn canals_never_cross_blocks_and_bridges_stand_over_water() {
        let height=vec![1.;N*N]; let water=east_water();
        let mut layout=town("venetian-lagoon");
        apply(&mut layout,&full(),surface(&height,&water));
        let w=ways(&layout);
        let blocks:Vec<g::ContainmentIndex>=layout.blocks.iter().map(|b|g::ContainmentIndex::new(&b.shape)).collect();
        for x in w.iter().filter(|x|x.path.len()==2) {
            for k in 0..=40 {let q=lerp(x.path[0],x.path[1],k as f64/40.);assert!(!blocks.iter().any(|b|b.contains(q)),"{} crosses a block at {q:?}",x.kind);}
        }
        let wet:Vec<g::ContainmentIndex>=w.iter().map(|x|g::ContainmentIndex::new(&x.shape)).collect();
        let decks:Vec<&Shape>=w.iter().flat_map(|x|x.crossings.iter()).collect();
        assert!(!decks.is_empty());
        for d in &decks {assert!(wet.iter().any(|x|x.contains(g::centroid(d))) || water[((g::centroid(d).y/10.) as usize)*N+(g::centroid(d).x/10.) as usize]!=0,"a bridge without water");}
        // Every junction where a dry street meets a through canal has a bridge.
        let ends:Vec<Point>=w.iter().filter(|x|x.kind=="canal").flat_map(|x|x.path.clone()).collect();
        for &q in &ends {
            // Here every street is a canal: the quays need bridges where three or more canals meet.
            let canals=ends.iter().filter(|&&e|dist(e,q)<0.5).count();
            if canals<3 {continue;}
            assert!(decks.iter().any(|d|dist(g::centroid(d),q)<14.),"no bridge at the canal junction {q:?}");
        }
    }

    #[test]
    fn without_water_a_lagoon_town_digs_nothing_and_an_engineered_town_digs_a_basin() {
        let height=vec![1.;N*N]; let dry=vec![0;N*N];
        let mut lagoon=town("venetian-lagoon");
        apply(&mut lagoon,&LayoutConfig::default(),surface(&height,&dry));
        assert!(ways(&lagoon).is_empty(),"a lagoon town away from water digs no canals");
        let mut gnomes=town("gnomish");
        apply(&mut gnomes,&full(),surface(&height,&dry));
        let w=ways(&gnomes);
        assert_eq!(w.iter().filter(|x|x.kind=="basin").count(),1);
        assert!(w.iter().any(|x|x.kind=="canal"));
        assert!(!w.iter().any(|x|matches!(x.kind.as_str(),"mouth"|"feeder")));
        for x in w {for q in &x.shape.outer {assert!(q.x>280. && q.x<620. && q.y>280. && q.y<620.);}}
        // The density parameter at zero keeps every street dry.
        apply(&mut gnomes,&LayoutConfig{lagoon_canals:Some(0.),..Default::default()},surface(&height,&east_water()));
        assert!(ways(&gnomes).is_empty());
    }

    #[test]
    fn near_water_an_engineered_town_digs_a_short_feeder_not_a_stroke() {
        // Water 60 m east of the town edge: no mouth fits, a gnomish feeder does.
        let height=vec![1.;N*N]; let water:Vec<u8>=(0..N*N).map(|i|u8::from(i%N>65)).collect();
        let mut gnomes=town("gnomish");
        apply(&mut gnomes,&full(),surface(&height,&water));
        let feeders:Vec<&Waterway>=ways(&gnomes).iter().filter(|x|x.kind=="feeder").collect();
        assert!(!feeders.is_empty() && feeders.len()<=2);
        let p=params("gnomish",&full()).unwrap();
        for f in feeders {assert!(dist(f.path[0],f.path[1])<=p.feeder+3.5 && f.width_m>=MIN_WIDTH);}
        let mut lagoon=town("venetian-lagoon");
        apply(&mut lagoon,&full(),surface(&height,&water));
        assert!(!ways(&lagoon).iter().any(|x|x.kind=="feeder"),"a lagoon town does not dig feeders");
    }

    /// Town street length, water length (canals and rii) and blocks that lost their land access to a rio.
    fn audit(layout:&Layout)->(f64,f64,usize) {
        let w=ways(layout); let st=streets(layout);
        let town:f64=st.segs.iter().filter(|s|s.4).map(|s|s.3).sum();
        let water:f64=w.iter().filter(|x|matches!(x.kind.as_str(),"canal"|"rio")).map(|x|dist(x.path[0],x.path[1])).sum();
        let rio:BTreeSet<(usize,usize)>=w.iter().filter(|x|x.kind=="rio")
            .filter_map(|x|Some(pair(*st.ids.get(&cell(x.path[0]))?,*st.ids.get(&cell(x.path[1]))?))).collect();
        let frontage=block_frontage(layout,&st);
        let served=|cut:&BTreeSet<(usize,usize)>|->Vec<bool> {
            let mut land:Vec<usize>=(0..st.points.len()).collect(); let mut size=vec![0f64;st.points.len()];
            for s in &st.segs {if !cut.contains(&pair(s.0,s.1)) {union(&mut land,s.0,s.1);}}
            for s in &st.segs {if !cut.contains(&pair(s.0,s.1)) {let r=find(&mut land,s.0); size[r]+=s.3;}}
            let core=(0..size.len()).max_by(|&a,&b|size[a].total_cmp(&size[b])).unwrap_or(0);
            frontage.iter().map(|f|f.iter().any(|&si|{let s=&st.segs[si]; !cut.contains(&pair(s.0,s.1)) && find(&mut land,s.0)==core})).collect()
        };
        let before=served(&BTreeSet::new()); let after=served(&rio);
        (town,water,before.iter().zip(&after).filter(|(b,a)|**b && !**a).count())
    }
    /// Water pieces joined to no mouth, feeder or basin through shared ends.
    fn unfed(w:&[Waterway])->usize {
        let mut parent:Vec<usize>=(0..w.len()).collect(); let mut at:BTreeMap<(i64,i64),usize>=BTreeMap::new();
        for (i,x) in w.iter().enumerate() {
            for &q in &x.path {let k=cell(q); if let Some(&j)=at.get(&k) {union(&mut parent,i,j);} else {at.insert(k,i);}}
        }
        let fed:BTreeSet<usize>=(0..w.len()).filter(|&i|matches!(w[i].kind.as_str(),"mouth"|"feeder"|"basin")).map(|i|find(&mut parent,i)).collect();
        (0..w.len()).filter(|&i|!fed.contains(&find(&mut parent,i))).count()
    }
    /// A generated port town on flat ground whose east side runs into the sea (16 m cells, as a V2 town's raster).
    fn by_water(culture:&str,population:u32)->Layout {
        let (n,width)=(256usize,4000.);
        let center=Point{x:2000.,y:2000.}; let radius=crate::settlements::extent_radius(population);
        let shore=center.x+0.5*radius;
        let height=vec![10f32;n*n];
        let water:Vec<u8>=(0..n*n).map(|i|u8::from(((i%n) as f64+0.5)*width/n as f64>shore)).collect();
        let surface=Surface{geometry:None,width,n,height:&height,water:&water,interpolation:Default::default()};
        let site=super::super::Site{key:"canal-town".into(),name:String::new(),population,culture:culture.into(),center,radius,neighbours:Vec::new()};
        // A canal town by the water is a port: its quays line the shore (as the V2 places it, archetype `harbor`).
        let mut cfg:LayoutConfig=serde_json::from_str(include_str!("fixtures/small-layout-config.json")).unwrap();
        cfg.site_archetype="harbor".into(); cfg.programme.navigable_access=true;
        super::super::generate_quarters("canal-town",&[site],&cfg,surface,&[]).unwrap().remove(0)
    }

    #[test]
    fn a_venetian_town_by_the_water_reads_as_a_canal_town_and_keeps_its_land_access() {
        for population in [4000,20000] {
            let layout=by_water("venetian-lagoon",population);
            let (town,water,lost)=audit(&layout);
            let w=ways(&layout);
            assert!(water>=0.15*town,"{population}: {water:.0} m of water for {town:.0} m of streets");
            assert!(w.iter().any(|x|x.kind=="rio"),"{population}: no rio");
            assert!(w.iter().any(|x|x.kind=="mouth"),"{population}: no mouth");
            assert_eq!(unfed(w),0,"{population}: water cut off from the sea");
            assert_eq!(lost,0,"{population}: blocks without land access");
        }
    }

    #[test]
    fn a_gnomish_town_by_the_water_reaches_its_canal_share() {
        let layout=by_water("gnomish",6000);
        let (town,water,lost)=audit(&layout);
        let w=ways(&layout);
        assert!(water>=0.09*town,"{water:.0} m of water for {town:.0} m of streets");
        assert!(w.iter().any(|x|x.kind=="basin"),"the engineered town has its basin");
        assert_eq!(unfed(w),0);
        assert_eq!(lost,0);
    }

    /// A 4 x 4 grid town of 80 m cells (8 m streets) with a 2.6 m lane down the middle of each cell, drawn in 4 m pieces.
    fn town_with_lanes(culture:&str)->Layout {
        let lines:Vec<f64>=(0..5).map(|k|300.+80.*k as f64).collect();
        let fine:Vec<f64>=(0..9).map(|k|300.+40.*k as f64).collect();
        let pt=|x:f64,y:f64|serde_json::json!({"x":x,"y":y});
        let square=|x0:f64,y0:f64,x1:f64,y1:f64|serde_json::json!({"outer":[{"x":x0,"y":y0},{"x":x1,"y":y0},{"x":x1,"y":y1},{"x":x0,"y":y1}],"holes":[]});
        let mut streets:Vec<serde_json::Value>=vec![];
        for &v in &lines {
            let row:Vec<serde_json::Value>=fine.iter().map(|&u|pt(u,v)).collect();
            let column:Vec<serde_json::Value>=lines.iter().map(|&u|pt(v,u)).collect();
            let (wr,wc):(Vec<f64>,Vec<f64>)=(vec![8.;row.len()],vec![8.;column.len()]);
            streets.push(serde_json::json!({"path":row,"widths":wr,"rank":2,"role":"street"}));
            streets.push(serde_json::json!({"path":column,"widths":wc,"rank":2,"role":"street"}));
        }
        let mut blocks:Vec<serde_json::Value>=vec![];
        for i in 0..4 {for j in 0..4 {
            let (x0,y0,x1,y1)=(lines[i],lines[j],lines[i+1],lines[j+1]); let xm=x0+40.;
            let path:Vec<serde_json::Value>=(0..=20).map(|k|pt(xm,y0+4.*k as f64)).collect();
            let w:Vec<f64>=vec![2.6;path.len()];
            streets.push(serde_json::json!({"path":path,"widths":w,"rank":3,"role":"lane"}));
            blocks.push(serde_json::json!({"shape":square(x0+5.,y0+5.,xm-2.,y1-5.),"quarter":0,"kind":"block","axis":{"x":1.,"y":0.}}));
            blocks.push(serde_json::json!({"shape":square(xm+2.,y0+5.,x1-5.,y1-5.),"quarter":0,"kind":"block","axis":{"x":1.,"y":0.}}));
        }}
        serde_json::from_value(serde_json::json!({"key":"lanes","culture":culture,"center":{"x":460.,"y":460.},
            "quarters":[{"shape":square(290.,290.,630.,630.),"phase":0}],"blocks":blocks,"streets":streets,"warnings":[],"structure":{}})).unwrap()
    }

    #[test]
    fn rii_are_whole_lanes_and_every_block_keeps_its_land_access() {
        // Water east of x = 630 m, 10 m beyond the town's east street.
        let height=vec![1.;N*N]; let water:Vec<u8>=(0..N*N).map(|i|u8::from(i%N>62)).collect();
        let mut layout=town_with_lanes("venetian-lagoon");
        apply(&mut layout,&full(),surface(&height,&water));
        let (_,_,lost)=audit(&layout);
        assert_eq!(lost,0,"a block lost its land access");
        let w=ways(&layout);
        let rii:Vec<&Waterway>=w.iter().filter(|x|x.kind=="rio").collect();
        assert!(!rii.is_empty(),"lanes turn to rii");
        // Each lane between two streets is all water or all street: no stub of either.
        for i in 0..4 {for j in 0..4 {
            let (x,y0)=(340.+80.*i as f64,300.+80.*j as f64);
            let pieces=rii.iter().filter(|r|r.path.iter().all(|q|(q.x-x).abs()<0.01 && q.y>=y0-0.01 && q.y<=y0+80.01)).count();
            assert!(pieces==0 || pieces==20,"lane at x {x}, y {y0}: {pieces} of its 20 pieces are water");
        }}
    }

    /// A square ring street (8 m) around four 2.6 m lanes meeting at its centre, drawn in 4 m pieces, four blocks between.
    fn lanes_meeting(culture:&str)->Layout {
        let pt=|x:f64,y:f64|serde_json::json!({"x":x,"y":y});
        let square=|x0:f64,y0:f64,x1:f64,y1:f64|serde_json::json!({"outer":[{"x":x0,"y":y0},{"x":x1,"y":y0},{"x":x1,"y":y1},{"x":x0,"y":y1}],"holes":[]});
        let ring:Vec<serde_json::Value>=[(400.,400.),(500.,400.),(600.,400.),(600.,500.),(600.,600.),(500.,600.),(400.,600.),(400.,500.),(400.,400.)].iter().map(|&(x,y)|pt(x,y)).collect();
        let rw:Vec<f64>=vec![8.;ring.len()];
        let mut streets=vec![serde_json::json!({"path":ring,"widths":rw,"rank":2,"role":"street"})];
        for (dx,dy) in [(0.,-1.),(1.,0.),(0.,1.),(-1.,0.)] {
            let path:Vec<serde_json::Value>=(0..=25).map(|k|pt(500.+dx*4.*k as f64,500.+dy*4.*k as f64)).collect();
            let w:Vec<f64>=vec![2.6;path.len()];
            streets.push(serde_json::json!({"path":path,"widths":w,"rank":3,"role":"lane"}));
        }
        let blocks:Vec<serde_json::Value>=[(405.,405.,498.,498.),(502.,405.,595.,498.),(405.,502.,498.,595.),(502.,502.,595.,595.)].iter()
            .map(|&(a,b,c,d)|serde_json::json!({"shape":square(a,b,c,d),"quarter":0,"kind":"block","axis":{"x":1.,"y":0.}})).collect();
        serde_json::from_value(serde_json::json!({"key":"junction","culture":culture,"center":{"x":500.,"y":500.},
            "quarters":[{"shape":square(390.,390.,610.,610.),"phase":0}],"blocks":blocks,"streets":streets,"warnings":[],"structure":{}})).unwrap()
    }

    #[test]
    fn a_junction_of_lanes_keeps_a_land_street_and_its_blocks_their_access() {
        // Water east of x = 620 m, 20 m beyond the ring's east side.
        let height=vec![1.;N*N]; let water:Vec<u8>=(0..N*N).map(|i|u8::from(i%N>61)).collect();
        let mut layout=lanes_meeting("venetian-lagoon");
        apply(&mut layout,&full(),surface(&height,&water));
        let (_,_,lost)=audit(&layout);
        assert_eq!(lost,0,"a block lost its land access");
        let w=ways(&layout);
        let rio=|dx:f64,dy:f64|w.iter().filter(|x|x.kind=="rio" && x.path.iter().all(|q|{
            let (u,v)=(q.x-500.,q.y-500.);
            (u*dy-v*dx).abs()<0.01 && u*dx+v*dy>=-0.01 && u*dx+v*dy<=100.01})).count();
        let pieces:Vec<usize>=[(0.,-1.),(1.,0.),(0.,1.),(-1.,0.)].iter().map(|&(dx,dy)|rio(dx,dy)).collect();
        // Every lane is all water or all street, and the junction keeps at least one land street.
        assert!(pieces.iter().all(|&k|k==0 || k==25),"lanes cut into pieces: {pieces:?}");
        assert!(pieces.contains(&0),"the junction of four lanes is all water: {pieces:?}");
    }
}
