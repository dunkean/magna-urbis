//! Source-bound civic sites. Culture and scale choices live in spring_water.json;
//! this module only enforces proximity, dry footing, reservations and access.
use super::{activities as act, geometry as g, *};
use serde::{Deserialize, Serialize};
use serde_json::{Value, json};
use std::{collections::BTreeMap, sync::{OnceLock, atomic::{AtomicUsize, Ordering::Relaxed}}};

#[derive(Deserialize)]
struct WaterType { label: String, min_population: u32 }
#[derive(Deserialize)]
struct Rules {
    radius_multiple: f64,
    minimum_reach_m: f64,
    max_sites: usize,
    max_offset_m: f64,
    path_width_m: f64,
    default: Vec<String>,
    families: BTreeMap<String, Vec<String>>,
    types: BTreeMap<String, WaterType>,
}
fn rules() -> &'static Rules {
    static DATA: OnceLock<Rules> = OnceLock::new();
    DATA.get_or_init(|| serde_json::from_str(include_str!("spring_water.json")).expect("spring_water.json"))
}

#[derive(Clone, Debug, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct SpringSite {
    pub id: String,
    pub source: Point,
    pub archetype: String,
    pub label: String,
    pub shape: Shape,
    pub front: [Point; 2],
    pub path: Vec<Point>,
}

fn distance(a: Point, b: Point) -> f64 { (a.x-b.x).hypot(a.y-b.y) }
fn rectangle(c: Point, u: Point, w: f64, d: f64) -> Shape {
    Shape { outer: [(-w/2.,-d/2.),(w/2.,-d/2.),(w/2.,d/2.),(-w/2.,d/2.)]
        .map(|(s,t)| Point{x:c.x+u.x*s-u.y*t,y:c.y+u.y*s+u.x*t}).to_vec(), holes:vec![] }
}
fn sites(layout: &Layout) -> &[SpringSite] {
    layout.structure.as_ref().map_or(&[], |s| &s.spring_sites)
}
pub(super) fn site<'a>(layout: &'a Layout, id: &str) -> Option<&'a SpringSite> {
    sites(layout).iter().find(|s| s.id == id)
}
/// The (up to) 12 nearest distinct points of the given street segments to `p`, nearest first.
fn nearest(segs: &[(Point, Point)], p: Point) -> Vec<(f64, Point)> {
    let mut out = segs.iter().map(|&(a,b)| {
        let (dx,dy)=(b.x-a.x,b.y-a.y);
        let t=(((p.x-a.x)*dx+(p.y-a.y)*dy)/(dx*dx+dy*dy).max(1e-9)).clamp(0.,1.);
        let q=Point{x:a.x+t*dx,y:a.y+t*dy};
        (distance(q,p),q)
    }).collect::<Vec<_>>();
    out.sort_by(|a,b| a.0.total_cmp(&b.0));
    out.dedup_by(|a,b| distance(a.1,b.1)<0.1);
    out.truncate(12);
    out
}
/// The street segments (bridges, piers and moles apart) near a source, for the
/// nearest-street search of its candidate sites: those whose box meets the square
/// of half-side `radius` round the source, in street order. A segment left out
/// is farther than `radius` from the source, so a candidate `d` from the source
/// whose 12th nearest point is within `radius - d` has them all: the answer is
/// exactly the one over every street; otherwise the square doubles.
struct Near<'a> { layout: &'a Layout, source: Point, radius: f64, segs: Vec<(Point, Point)>, complete: bool }
impl<'a> Near<'a> {
    fn new(layout: &'a Layout, source: Point) -> Self { Self::scan(layout, source, 256.) }
    fn scan(layout: &'a Layout, source: Point, radius: f64) -> Self {
        let (mut segs, mut total) = (vec![], 0usize);
        for s in layout.streets.iter().filter(|s| !matches!(s.role.as_str(), "bridge" | "pier" | "mole")) {
            for ab in s.path.windows(2) {
                total += 1;
                let (a,b)=(ab[0],ab[1]);
                if a.x.min(b.x)<=source.x+radius && a.x.max(b.x)>=source.x-radius
                    && a.y.min(b.y)<=source.y+radius && a.y.max(b.y)>=source.y-radius { segs.push((a,b)); }
            }
        }
        let complete = segs.len()==total || radius>1e9;
        Self { layout, source, radius, segs, complete }
    }
    fn targets(&mut self, p: Point) -> Vec<Point> {
        loop {
            let out = nearest(&self.segs, p);
            if self.complete || (out.len()==12 && out[11].0 <= self.radius-distance(p,self.source)) {
                return out.into_iter().map(|(_,q)|q).collect();
            }
            *self = Self::scan(self.layout, self.source, self.radius*2.);
        }
    }
}
#[cfg(test)]
fn targets(layout: &Layout, p: Point) -> Vec<Point> { Near::new(layout, p).targets(p) }
/// The ribbons of a street path where it comes within `pad` of a zone (a box):
/// the runs of segments that meet a zone, with the segment on each side so that
/// the joins are the ones of the whole ribbon.
fn local_ribbons(path: &[Point], widths: &[f64], zones: &[(f64, f64, f64, f64)]) -> Vec<Shape> {
    let pad=widths.iter().copied().fold(4.0_f64,f64::max)*0.5+1.;
    let near: Vec<bool> = path.windows(2).map(|w| {
        let b=(w[0].x.min(w[1].x)-pad,w[0].y.min(w[1].y)-pad,w[0].x.max(w[1].x)+pad,w[0].y.max(w[1].y)+pad);
        zones.iter().any(|&z|g::boxes_meet(b,z))
    }).collect();
    let keep=|i: usize| near[i] || (i>0 && near[i-1]) || near.get(i+1).copied().unwrap_or(false);
    let (mut out, mut i)=(vec![],0);
    while i<near.len() {
        if !keep(i) {i+=1; continue;}
        let from=i;
        while i<near.len() && keep(i) {i+=1;}
        // Segments from..i run over points from..=i.
        let w: Vec<f64> = (from..=i).map(|k| widths.get(k).or(widths.first()).copied().unwrap_or(4.0)).collect();
        out.extend(g::ribbon(&path[from..=i],&w));
    }
    out
}
fn dry(surface: Surface<'_>, shape: &Shape) -> bool {
    // Test the interior as well as edges: a narrow channel can cross a lot
    // without wetting its corners. Physical vector water remains authoritative.
    let c=g::centroid(shape);
    if surface.wet(c) { return false; }
    shape.outer.iter().zip(shape.outer.iter().cycle().skip(1)).take(shape.outer.len())
        .all(|(&a,&b)| routing::segment_clear(surface,a,b,0.4)
            && routing::segment_clear(surface,a,c,0.4))
        && {
            let (x0,y0,x1,y1)=g::bbox(shape);
            let mut y=y0;
            let mut ok=true;
            while y<=y1 { let mut x=x0; while x<=x1 {
                let p=Point{x,y};
                if g::contains(shape,p) && surface.wet(p) {ok=false;}
                x+=1.0;
            } y+=1.0; }
            ok
        }
}
fn overlaps(a: &Shape, b: &Shape) -> bool {
    let (x0,y0,x1,y1)=g::bbox(a); let (u0,v0,u1,v1)=g::bbox(b);
    x0<u1 && x1>u0 && y0<v1 && y1>v0
        && g::intersection(a,b).iter().map(g::area).sum::<f64>()>0.05
}
/// Route searches allowed per source, shared by every archetype tried there. Placement candidates
/// are cheap; a full route is not, and an unreachable source (steep bank, across a river) would
/// otherwise route every offset x angle x street x archetype, minutes per town.
const ROUTE_BUDGET: usize = 16;
/// Trials routed together at most: each search holds its own lattice (up to 60 MB for a source
/// far from the streets), and a browser never gives that memory back.
const ROUND: usize = if cfg!(target_arch = "wasm32") { 2 } else { 8 };
/// A dry, free placement waiting for its route from the door to a street, on its own lattice.
struct Trial { shape: Shape, front: [Point; 2], door: Point, goal: Point, bounds: (f64, f64, f64, f64) }
/// The first trial, in their order, whose route exists and passes through no enclosure wall or
/// other source building, with that route: the answer of routing them one after the other.
/// They are routed together, each on its own lattice as before; a trial placed after an accepted
/// one gives up (`RoutePlanner::stop_when`), since its answer is not read. A source a kilometre
/// from the streets otherwise routes its whole budget, one full lattice at a time.
fn first_routed(layout: &Layout, surface: Surface<'_>, grade: f64, trials: &[Trial]) -> Option<(usize, Vec<Point>)> {
    let accepted=AtomicUsize::new(usize::MAX);
    let routes=super::par::map(trials,|i,trial| -> Option<Vec<Point>> {
        if accepted.load(Relaxed)<i {return None;}
        let mut planner=routing::RoutePlanner::bank(surface,trial.bounds);
        planner.stop_when(&accepted,i);
        let path=planner.route(trial.door,trial.goal,grade)?;
        // No paths through an enclosure wall or another source building.
        let mut obstacles=layout.enclosures.iter().flat_map(|e|&e.reserve)
            .chain(sites(layout).iter().map(|s|&s.shape));
        let corridor=g::ribbon(&path,&[rules().path_width_m]);
        if obstacles.any(|s|corridor.iter().any(|p|overlaps(p,s))) {return None;}
        accepted.fetch_min(i,Relaxed);
        Some(path)
    });
    routes.into_iter().enumerate().find_map(|(i,path)|path.map(|path|(i,path)))
}
/// `forbidden`: what a site may not overlap near the sources (street ribbons,
/// enclosure reserves, the sites already placed); `reserve` keeps it.
fn find(layout: &Layout, forbidden: &[Shape], near: &mut Near<'_>, source: Point, archetype: &str, surface: Surface<'_>, cfg: &LayoutConfig, budget: &mut usize) -> Option<SpringSite> {
    let a=act::archetype(archetype)?;
    let look=act::data().looks.get(a.look.as_deref()?)?;
    let (w,d)=(look.footprint.w[0],look.footprint.d[0]);
    let grade=if cfg.allow_stairs {cfg.max_stair_grade} else {cfg.max_lane_grade};
    let site=|trial: Trial, path: Vec<Point>| -> Option<SpringSite> {
        Some(SpringSite {id:String::new(),source,archetype:archetype.into(),
            label:rules().types.get(archetype)?.label.clone(),shape:trial.shape,front:trial.front,path})
    };
    // Placements are routed in rounds, in their order: the first alone (most sources take it),
    // then as many together as there are threads, `ROUND` at most. Each one in a round has
    // spent its search.
    let mut round: Vec<Trial>=vec![];
    let mut width=1;
    'placements: for step in 0..=(rules().max_offset_m/4.).floor() as usize {
        let count=if step==0 {1} else {16};
        for i in 0..count {
            let angle=i as f64*std::f64::consts::TAU/count as f64;
            let c=Point{x:source.x+4.*step as f64*angle.cos(),y:source.y+4.*step as f64*angle.sin()};
            for goal in near.targets(c) {
                let angle=(goal.y-c.y).atan2(goal.x-c.x)-std::f64::consts::FRAC_PI_2;
                let u=Point{x:angle.cos(),y:angle.sin()};
                let shape=rectangle(c,u,w,d);
                let reserve=rectangle(c,u,w+2.,d+2.);
                if !dry(surface,&reserve) || forbidden.iter().any(|s|overlaps(&reserve,s)) {continue;}
                let front=[shape.outer[2],shape.outer[3]];
                let door=Point{x:(front[0].x+front[1].x)/2.,y:(front[0].y+front[1].y)/2.};
                let pad=distance(door,goal).max(20.)*0.3+12.;
                let bounds=(door.x.min(goal.x)-pad,door.y.min(goal.y)-pad,door.x.max(goal.x)+pad,door.y.max(goal.y)+pad);
                // No search left for this placement: the round in hand holds the last ones.
                if *budget==0 {break 'placements;}
                *budget-=1;
                round.push(Trial{shape,front,door,goal,bounds});
                if round.len()<width {continue;}
                if let Some((k,path))=first_routed(layout,surface,grade,&round) {
                    *budget+=round.len()-1-k;
                    return site(round.swap_remove(k),path);
                }
                round.clear();
                width=super::par::threads().min(ROUND);
            }
        }
    }
    let (k,path)=first_routed(layout,surface,grade,&round)?;
    *budget+=round.len()-1-k;
    site(round.swap_remove(k),path)
}

/// Run after street trimming, before the authoritative programme is refreshed.
/// All spring/path ground is removed before cadastral subdivision.
pub(super) fn reserve(layout: &mut Layout, town: &Site, surface: Surface<'_>, cfg: &LayoutConfig) -> bool {
    if town.population==0 || cfg.programme.intent=="activity" || !sites(layout).is_empty() {return false;}
    let Some(geography)=surface.geometry else {return false;};
    let r=rules();
    let radius=layout.quarters.iter().flat_map(|q|&q.shape.outer)
        .map(|&p|distance(p,town.center)).fold(town.radius,f64::max);
    let reach=(radius*r.radius_multiple).max(r.minimum_reach_m);
    let quarter_boxes=layout.quarters.iter().map(|q|g::bbox(&q.shape)).collect::<Vec<_>>();
    let mut sources=geography.springs.iter().copied().filter(|&p|distance(p,town.center)<=reach
        || layout.quarters.iter().zip(&quarter_boxes).any(|(q,&b)|g::boxes_meet(b,(p.x,p.y,p.x,p.y)) && g::contains(&q.shape,p))).collect::<Vec<_>>();
    sources.sort_by(|&a,&b|distance(a,town.center).total_cmp(&distance(b,town.center))
        .then(a.x.total_cmp(&b.x)).then(a.y.total_cmp(&b.y)));
    // Only the first `max_sites` distinct sources are ever used.
    let mut unique=vec![];
    for source in sources {
        if unique.len()>=r.max_sites {break;}
        if !unique.iter().any(|&p|distance(source,p)<1.) {unique.push(source);}
    }
    let family=act::family_of(&layout.culture).map(|(f,_)|f).unwrap_or("");
    let preferences=r.families.get(family).unwrap_or(&r.default).iter().chain(&r.default)
        .filter(|id|r.types.get(*id).is_some_and(|t|town.population>=t.min_population)
            && (act::family_of(&layout.culture).is_none() || act::allowed(&layout.culture,id)))
        .cloned().collect::<Vec<_>>();
    let mut masks=vec![];
    // A site is tried within `max_offset_m` of its source: only the ground near the sources can
    // be overlapped. The list is built at the first attempt (street ribbons and enclosure
    // reserves that meet a source zone) and extended with each site and path added below.
    let extent=preferences.iter().filter_map(|id|{
        let look=act::data().looks.get(act::archetype(id)?.look.as_deref()?)?;
        Some((look.footprint.w[0]+2.).hypot(look.footprint.d[0]+2.))
    }).fold(0.,f64::max);
    let zones=unique.iter().map(|s|{let m=r.max_offset_m+extent+1.;(s.x-m,s.y-m,s.x+m,s.y+m)}).collect::<Vec<_>>();
    let mut ground:Option<Vec<Shape>>=None;
    for (i,source) in unique.into_iter().enumerate() {
        let mut budget=ROUTE_BUDGET;
        let found=if preferences.is_empty() {None} else {
            let forbidden:&[Shape]=ground.get_or_insert_with(||layout.enclosures.iter().flat_map(|e|&e.reserve)
                .filter(|s|{let b=g::bbox(s);zones.iter().any(|&z|g::boxes_meet(b,z))}).cloned()
                .chain(layout.streets.iter().flat_map(|s|local_ribbons(&s.path,&s.widths,&zones))).collect());
            let mut near=Near::new(layout,source);
            preferences.iter().find_map(|id|find(layout,forbidden,&mut near,source,id,surface,cfg,&mut budget))
        };
        let Some(mut water)=found else {
            layout.warnings.push(warnings::spring_site_missing(source.x, source.y, r.max_offset_m));
            continue;
        };
        water.id=format!("{}/spring/{i}",layout.key);
        // A metre of public ground around the building, plus its physical path.
        let c=g::centroid(&water.shape);
        let u=Point{x:water.shape.outer[1].x-water.shape.outer[0].x,y:water.shape.outer[1].y-water.shape.outer[0].y};
        let w=u.x.hypot(u.y); let u=Point{x:u.x/w,y:u.y/w};
        masks.push(rectangle(c,u,w+2.,distance(water.shape.outer[1],water.shape.outer[2])+2.));
        let ribbon=g::ribbon(&water.path,&[r.path_width_m]);
        masks.extend(ribbon.iter().cloned());
        if let Some(ground)=ground.as_mut() {ground.push(water.shape.clone()); ground.extend(ribbon);}
        layout.streets.push(Street{path:water.path.clone(),widths:vec![r.path_width_m],rank:3,role:"path".into()});
        layout.structure.get_or_insert_with(UrbanStructure::default).spring_sites.push(water);
    }
    routing::tally("springs");
    if masks.is_empty() {return false;}
    // Re-indexing is intentional; programme::prepare follows this operation.
    // The overlay grid depends only on the bounds of its operands, and a mask whose box misses
    // the block cuts nothing: against its bounding rectangle (4 vertices) the block comes out
    // as the same reduced ring the overlay against the mask itself gives.
    let cuts=masks.iter().map(|m|{let b=g::bbox(m);(b,g::rectangle(b.0,b.1,b.2,b.3))}).collect::<Vec<_>>();
    layout.blocks=super::par::map(&layout.blocks,|_,block| {
        let bb=g::bbox(&block.shape);
        let mut pieces=vec![block.shape.clone()];
        for (mask,(mb,rect)) in masks.iter().zip(&cuts) {
            let cut=if g::boxes_meet(*mb,bb) {mask} else {rect};
            pieces=pieces.iter().flat_map(|p|g::difference(p,cut)).collect();
        }
        pieces.into_iter().filter(|s|g::area(s)>=4.).map(|shape|Block{shape,..block.clone()}).collect::<Vec<_>>()
    }).into_iter().flatten().collect();
    true
}

/// Fixed civic parcels survive service-budget allocation and lot consolidation.
pub(super) fn allocate(layout: &Layout, partition: &mut Partition) {
    let Some(pr)=partition.programme.as_mut() else {return;};
    for water in sites(layout) {
        if !pr.cultures.iter().any(|c|c.culture==layout.culture) {
            let Some(c)=culture::mapping_for(&layout.culture,&pr.context.period) else {continue;};
            pr.cultures.push(c);
        }
        if !partition.parcels.iter().any(|p|p.id==water.id) {
            let block=layout.blocks.iter().enumerate().min_by(|(_,a),(_,b)|
                distance(g::centroid(&a.shape),water.source).total_cmp(&distance(g::centroid(&b.shape),water.source)))
                .map_or(0,|(i,_)|i);
            let axis=Point{x:water.front[1].x-water.front[0].x,y:water.front[1].y-water.front[0].y};
            let length=axis.x.hypot(axis.y);
            partition.parcels.push(Parcel {id:water.id.clone(),shape:water.shape.clone(),block,
                pressure:0.,envelope:Some(water.shape.clone()),parent_ids:vec![],provenance:vec!["spring-water".into()],
                family:"activity".into(),reason:"spring-water".into(),contacts:vec![],use_kind:"reserve".into(),
                front:Some(water.front),axis:Point{x:axis.x/length,y:axis.y/length},rank:3,
                access:Some(ParcelAccess{kind:"public".into(),street:None,front_length:length})});
        }
        pr.allocations.retain(|a|a.parcel_id!=water.id);
        // Keep the source obligation addressable by programme reconciliation.
        // Ordinary service allocation never spends this independent demand.
        let area=g::area(&water.shape);
        pr.demands.retain(|d|d.id!=water.id);
        pr.demands.push(programme::Demand {id:water.id.clone(),function:"collective".into(),unit:"usefulArea".into(),
            requested:area,target_area:area,target_frontage:0.,provenance:vec!["spring-water".into()],requires:vec!["water".into()],
            parcel_capacity:area,built_capacity:0.,open_capacity:0.,deficit:area,reasons:vec!["Dedicated source building".into()],
            role:"civic.bathhouse".into(),sites:1,site:"waterfront".into(),landmark:true,district:"civic".into(),placement:"parcel".into(),explicit:false});
        pr.allocations.push(programme::Allocation {parcel_id:water.id.clone(),demand_id:water.id.clone(),
            function:"collective".into(),culture:layout.culture.clone(),
            architecture_pack:pr.cultures.iter().find(|c|c.culture==layout.culture).unwrap().architecture_pack.clone(),
            capacity:area,unit:"usefulArea".into(),score:1.,reasons:vec!["spring-water".into()],role:"civic.bathhouse".into(),
            label:water.label.clone(),landmark:true,households:0.,residents:Some(0.),housing_floor_need:None,district_role:"civic".into(),wealth:0.4});
    }
}

/// Export the exact activity footprint and its existing activity-look massing.
/// Native house admission must not replace a small well-head with a dwelling.
pub(super) fn request(water: &SpringSite, layout: &Layout, surface: Surface<'_>, seed: &str) -> Value {
    let c=g::centroid(&water.shape);
    let pack=culture::architecture_pack(&layout.culture).unwrap_or("");
    let massing=act::building_massing(&water.archetype,&layout.culture,&water.shape.outer,seed);
    json!({"id":format!("{}/building",water.id),"parcel_id":water.id,"seed":seed,
        "cadastral":[water.shape],"buildable":[water.shape],"roof_domain":[water.shape],"reserves":[],
        "preview":[water.shape],"preview_parts":["building"],"placement_hint":[water.shape],
        "accesses":[{"id":format!("{}/path",water.id),"segment":water.front,"kind":"public","width_m":distance(water.front[0],water.front[1])}],
        "party_boundaries":[],"neighbors":[],"function":"collective",
        "culture":{"culture":layout.culture,"pack":pack,"mode":culture::houses_mode(&layout.programme.as_ref().map_or("inspired",|p|p.context.mode.as_str())),"borrowing":null},
        "terrain":{"origin":c,"ground_z_m":surface.height_at(c),"gradient":[0,0],"water_z_m":null,"max_foundation_step_m":0.75},
        "programme":{"role":"civic.bathhouse","label":water.label,"landmark":true,"archetype":water.archetype,
            "spring":water.source,"composition":"civic","households":0,"wealth":0.4,"floors":[1,1],
            "built_area_m2":g::area(&water.shape),"party_walls":false,"massing":massing}})
}

#[cfg(test)]
mod tests {
    use super::*;

    /// Trials routed together answer as trials routed one after the other: the first, in their
    /// order, whose route exists and crosses no source building, with the route its own planner
    /// gives; and a planner stopped by an earlier place gives up its search.
    #[test]
    fn trials_routed_together_take_the_first_free_route_in_order() {
        let n=48;
        let height=vec![0.0_f32;n*n];
        // A channel open at the south end (rows 34 on): crossing it takes a lattice search.
        let water:Vec<u8>=(0..n*n).map(|i|u8::from((22..26).contains(&(i%n)) && i/n<34)).collect();
        let surface=Surface{geometry:None,width:96.,n,height:&height,water:&water,interpolation:Default::default()};
        let mut layout:Layout=serde_json::from_value(json!({"key":"springs","culture":"european-organic",
            "center":{"x":48.0,"y":48.0},"quarters":[],"streets":[],"blocks":[],"warnings":[]})).unwrap();
        // A source building already placed on the straight line of the first trial.
        let placed=g::rectangle(24.,82.,28.,90.);
        layout.structure=Some(UrbanStructure{spring_sites:vec![SpringSite{id:"placed".into(),source:Point{x:26.,y:86.},
            archetype:String::new(),label:String::new(),shape:placed.clone(),front:[placed.outer[0],placed.outer[1]],path:vec![]}],
            ..Default::default()});
        let bounds=(8.,8.,88.,88.);
        let trial=|door:Point,goal:Point| Trial{shape:rectangle(door,Point{x:1.,y:0.},2.,2.),front:[door,door],door,goal,bounds};
        let blocked=(Point{x:12.,y:86.},Point{x:40.,y:86.});
        let (a,b)=(Point{x:24.,y:48.},Point{x:68.,y:48.});
        let open=(Point{x:12.,y:20.},Point{x:40.,y:20.});
        let grade=0.12;
        let own=routing::RoutePlanner::bank(surface,bounds).route(a,b,grade).expect("a route round the channel");
        assert!(own.len()>2,"the second trial takes a lattice search");
        let trials=[trial(blocked.0,blocked.1),trial(a,b),trial(open.0,open.1),trial(a,b)];
        assert_eq!(first_routed(&layout,surface,grade,&trials),Some((1,own.clone())));
        assert_eq!(first_routed(&layout,surface,grade,&trials[..1]),None);
        assert_eq!(first_routed(&layout,surface,grade,&trials[2..]).map(|(k,_)|k),Some(0));
        // An earlier place accepted: the search gives up; none accepted below it: it runs to its end.
        let first=AtomicUsize::new(0);
        let mut stopped=routing::RoutePlanner::bank(surface,bounds);
        stopped.stop_when(&first,1);
        assert_eq!(stopped.route(a,b,grade),None);
        let first=AtomicUsize::new(1);
        let mut running=routing::RoutePlanner::bank(surface,bounds);
        running.stop_when(&first,1);
        assert_eq!(running.route(a,b,grade),Some(own));
    }

    #[test]
    fn village_spring_has_a_cultural_water_building_and_public_path() {
        let source=Point{x:2020.,y:2000.};
        let geography=Geography::new(VectorGeography {
            land:vec![g::rectangle(0.,0.,4000.,4000.).outer],
            water:vec![vec![g::rectangle(2019.,2000.,2021.,2300.).outer]],
            // Repeated sources collapse; an unrelated far source is ignored.
            springs:vec![source,source,Point{x:200.,y:200.}],
        },4000.).unwrap();
        let h=vec![10.0_f32;64*64]; let w=vec![0_u8;64*64]; let levels=h.clone();
        let surface=Surface{geometry:Some(&geography),width:4000.,n:64,height:&h,water:&w,interpolation:Default::default()};
        let town=Site{key:"spring-village".into(),name:String::new(),population:500,
            culture:"european-organic".into(),center:Point{x:2000.,y:2000.},radius:150.,
            neighbours: Vec::new(),};
        let mut cfg:LayoutConfig=serde_json::from_str(include_str!("fixtures/small-layout-config.json")).unwrap();
        cfg.fortification="none".into();
        let parcel_cfg=serde_json::from_str(include_str!("fixtures/small-parcel-config.json")).unwrap();
        let layouts=generate_quarters("spring-test",&[town],&cfg,surface,&[]).unwrap();
        let retained:Vec<Layout>=serde_json::from_slice(&serde_json::to_vec(&layouts).unwrap()).unwrap();
        assert_eq!(sites(&retained[0]).len(),1,"{:?}",retained[0].warnings);
        let water=&sites(&retained[0])[0];
        assert_eq!(water.archetype,"public_washhouse");
        assert!(distance(g::centroid(&water.shape),source)<=rules().max_offset_m);
        assert!(dry(surface,&water.shape));
        assert!(retained[0].streets.iter().any(|s|s.role=="path" && s.path==water.path));
        let goal=*water.path.last().unwrap();
        let mut network=retained[0].clone();
        network.streets.retain(|s|s.path!=water.path);
        assert!(targets(&network,goal).iter().any(|&p|distance(p,goal)<0.01),"path does not join an existing street");
        let parts=generate_parcels("spring-test",&retained,&parcel_cfg).unwrap();
        assert!(parts[0].programme.as_ref().unwrap().allocations.iter().any(|a|a.households>0.),"spring reservation left an empty town");
        let rebuilt=programme::reallocate(&retained,&parts).unwrap();
        assert_eq!(rebuilt[0].parcels.iter().filter(|p|p.reason=="spring-water").count(),1);
        let requests=building_sites::requests("spring-test",&retained,&rebuilt,surface,&levels,None).unwrap();
        let request=requests.iter().find(|r|r["parcel_id"]==water.id).expect("spring request");
        assert_eq!(request["programme"]["role"],"civic.bathhouse");
        assert_eq!(request["programme"]["archetype"],"public_washhouse");
        assert!(request["programme"]["landmark"].as_bool().unwrap());
        assert!(!request["programme"]["label"].as_str().unwrap().is_empty());
        assert_eq!(request["preview"].as_array().unwrap().len(),1);
        assert_eq!(request["programme"]["massing"].as_array().unwrap().len(),1);
        let profile = json!({"houses":{"massing":{format!("b:{}",request["id"].as_str().unwrap()):{
            "overrides":{"roof":"RF-FLAT","floors":2}
        }}}}).to_string();
        let edited = building_sites::requests("spring-test",&retained,&rebuilt,surface,&levels,Some(&profile)).unwrap();
        let edited = edited.iter().find(|r|r["id"]==request["id"]).unwrap();
        assert_eq!(edited["preview"],request["preview"],"civic roof edits retain the exact existing footprint");
        assert_eq!(edited["programme"]["massing"][0]["roof"],"flat");
        assert_eq!(edited["programme"]["massing"][0]["floors"],2);
        assert!(!request["accesses"].as_array().unwrap().is_empty());
        let programme=rebuilt[0].programme.as_ref().unwrap();
        assert!(programme.demands.iter().any(|d|d.id==water.id && d.role=="civic.bathhouse"));
        let well=act::building_massing("stone_wellhead","nomad-camp",&g::rectangle(0.,0.,3.,2.).outer,"stone-well");
        assert_eq!(well[0]["roof"],"flat");
        assert_eq!(well[0]["wall"],"stone");
        assert!(well[0]["eave_m"].as_f64().unwrap()<1.2);
        for p in &rebuilt[0].parcels {
            if p.id!=water.id {assert!(!overlaps(&water.shape,&p.shape),"{} overlaps source building",p.id);}
        }
        // The same generic rule has a valid declared choice in every family.
        for (family,ids) in &rules().families {
            let culture=&act::data().cultures.families[family].cultures[0];
            assert!(ids.iter().any(|id|rules().types[id].min_population==0 && act::allowed(culture,id)),"{family}");
            for id in ids {assert!(act::archetype(id).is_some(),"missing {id}");}
        }
    }
}
