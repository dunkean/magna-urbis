//! One source-owned native front choice for the actually selected final Single.
//! No source, dimensions, door choice, mirror or admission/pose-result sweep.
use super::*;

#[cfg(test)] std::thread_local!{static ENABLED:std::cell::Cell<bool>=const{std::cell::Cell::new(true)};}
#[cfg(test)] pub(super) struct Mode(bool);
#[cfg(test)] impl Mode{pub(super) fn new(v:bool)->Self{Self(ENABLED.with(|s|s.replace(v)))}}
#[cfg(test)] impl Drop for Mode{fn drop(&mut self){ENABLED.with(|s|s.set(self.0));}}
#[cfg(test)] fn enabled()->bool{ENABLED.with(std::cell::Cell::get)}
#[cfg(not(test))] fn enabled()->bool{true}

fn side_y(p:Point,b:[f64;4])->Option<bool>{
    let mut d=[((p.y-b[1]).abs(),false),((p.y-b[3]).abs(),true)];
    d.sort_by(|a,b|a.0.total_cmp(&b.0));
    (d[0].0.is_finite()&&d[0].0<d[1].0).then_some(d[0].1)
}
fn request_allowed(r:&PlacementRequest)->bool{
    enabled()&&r.native_minimum_candidates.is_empty()&&r.typology.is_none()
        &&r.parcel_fit!=Some(false)&&native_ground_preparation_allowed(r,true)
        &&r.culture.borrowing.as_deref().is_none_or(|v|v.trim().is_empty())
        &&r.config.as_ref().is_none_or(|c|c.size==1.&&c.orientation_deg==0.&&c.count==1&&c.mode==r.culture.mode&&c.pack==r.culture.pack)
        &&r.programme.as_ref().is_some_and(|p|p.composition==Some(crate::programme::ProgrammeComposition::Compound)
            &&p.housing_floor_need.is_some()&&!p.party_walls.unwrap_or(false))
}

pub(super) fn choose<'a>(r:&'a PlacementRequest,previous:&PlanBuilding,prepared:&PreparedPlan<'_>,occupied:&Surface)
    ->Option<(Transform,&'a ArchitectureAccess)>{
    if !request_allowed(r){return None;}
    let resolved=prepared.resolved;
    if resolved.entrance.is_some()||resolved.parameters.layout!=crate::catalogue::Layout::Single
        ||resolved.plan.bodies.len()!=1||!resolved.plan.context.is_empty()||!resolved.plan.courts.is_empty()
        ||!resolved.plan.paths.is_empty()||!resolved.plan.features.is_empty(){return None;}
    let body=&resolved.plan.bodies[0];
    if body.levels.len()!=1||body.z!=0.||!body.cells.is_empty()||body.footprint.len()!=1
        ||!body.footprint[0].holes.is_empty()||body.footprint[0].outer.len()!=4{return None;}
    let b=bounds(&body.footprint);
    if !body.footprint[0].outer.iter().all(|p|(p.x==b[0]||p.x==b[2])&&(p.y==b[1]||p.y==b[3])){return None;}
    // Only READ the preparation already performed by the existing finalizer.
    let Ok(crate::engine::FoundationPreparation::Supported(physical))=prepared.foundation.get()? else{return None;};
    if !physical.native_features.is_empty(){return None;}
    let entry=physical.entry.as_ref()?;
    if !crate::access::plan_entry::same_entrance(&entry.body_entry,&entry.site_entry)
        ||entry.body_entry.opening[0].y!=entry.body_entry.opening[1].y{return None;}
    let opening=entry.body_entry.opening;
    let native_side=side_y(Point{x:(opening[0].x+opening[1].x)*0.5,y:opening[0].y},b)?;
    let legacy=transform_point(previous.entrance,&inverse(&previous.transform));
    let legacy_side=side_y(legacy,b)?;
    let distance=if legacy_side{(legacy.y-b[3]).abs()}else{(legacy.y-b[1]).abs()};
    // GRID_M classifies the existing proxy side only; no physical guard changes.
    if native_side==legacy_side||distance>GRID_M||legacy.x<b[0]||legacy.x>b[2]{return None;}
    let domain=difference(&difference(&r.buildable,&r.reserves),occupied);
    let poses=frontage_poses_prepared_with_flip(r,prepared,&domain,Some(native_side));
    #[cfg(test)] diagnostics::pose_generated(poses.len());
    // ONE first existing canonical pose, fixed BEFORE any admission outcome.
    // Never try another front/anchor after it fails. The full front is guarded.
    let first=poses.into_iter().next()?;
    if first.1.kind!="public"||first.1.id!=previous.access_id{return None;}
    #[cfg(test)] diagnostics::selected(&first.0,first.1,native_side);
    Some(first)
}

/// Runs only AFTER the complete unchanged legacy/OLD-growth/need pipeline.
/// Its discarded PreparedPlans cannot be borrowed here; this prototype pays
/// at most ONE explicitly additional preparation/admission for the final source.
fn finish(r:&PlacementRequest,occupied:&Surface,old:PlanBuilding)->(PlanBuilding,bool){
    if !request_allowed(r)||old.resolved.has_retained_entrance(){return(old,false);}
    let Ok(resolved)=old.resolved.unpack()else{return(old,false)};
    if resolved.parameters.layout!=crate::catalogue::Layout::Single||resolved.plan.bodies.len()!=1
        ||!resolved.plan.context.is_empty()||!resolved.plan.courts.is_empty()||!resolved.plan.paths.is_empty()
        ||!resolved.plan.features.is_empty()||resolved.plan.bodies[0].levels.len()!=1{return(old,false);}
    #[cfg(test)] let _counts=diagnostics::Scope::enter(r);
    let prepared=PreparedPlan::with_native_entry(&resolved);
    match prepared.foundation(){
        Ok(crate::engine::FoundationPreparation::Supported(p))if p.entry.is_some()=>{},
        _=>{#[cfg(test)]diagnostics::result("unsupported final native preparation; whole old Single retained");return(old,false);}
    }
    let neighbors=unite(&r.neighbors.iter().map(|n|n.footprint.clone()).chain(std::iter::once(occupied.clone())).collect::<Vec<_>>());
    let Some((pose,front))=choose(r,&old,&prepared,&neighbors)else{
        #[cfg(test)]diagnostics::result("no eligible preselected native front; whole old Single retained");return(old,false);
    };
    let mut new=match visual_with_front_access_prepared(r,&prepared,pose,&neighbors,true,false,Some(front),true){
        Ok(v)=>v,
        Err(reason)=>{#[cfg(test)]diagnostics::result(&reason);return(old,false);}
    };
    let source_exact=new.resolved.unpack().and_then(|mut actual|{
        actual.entrance=None;
        Ok(serde_json::to_vec(&actual).map_err(|e|e.to_string())?==serde_json::to_vec(&resolved).map_err(|e|e.to_string())?)
    }).unwrap_or(false);
    if !source_exact{#[cfg(test)]diagnostics::result("native admission changed final source; whole old Single retained");return(old,false);}
    new=finish_native_entry_upgrade(&old,new,"Native Single prepose after the complete old pipeline: the real final source, dimensions, floors, seed and door were retained; one existing canonical frontage pose selected before one additional native admission. No mirror, source draw, resize or pose-result sweep. Useful/housed capacity unknown.".into());
    new.diagnostics.retain(|d|!d.starts_with("Native planning entrance deferred:"));
    new.programme_outcome=Some(PlanProgrammeOutcome::from_final_plan(r,&new));
    #[cfg(test)]diagnostics::result("admitted native final source at the one preselected canonical pose");
    (new,true)
}

pub(super) fn after_complete_batch(input:&PlanBatchRequest,result:&mut PlanBatch)->Result<(),String>{
    if !enabled()||input.requests.len()>64||input.settings.as_ref().is_some_and(|s|s.typology.is_some()||s.house_config.is_some()||s.floors.is_some()){return Ok(());}
    let land=|b:&PlanBuilding|{let mut p=vec![b.footprint.clone(),b.courtyards.clone(),b.circulation.clone()];p.extend(b.structural_features.iter().map(|f|f.surface.clone()));unite(&p)};
    let mut lands=result.buildings.iter().map(land).collect::<Vec<_>>();
    let mut roofs=result.buildings.iter().map(|b|b.roof_footprint.clone()).collect::<Vec<_>>();
    for i in 0..result.buildings.len(){
        let old=&result.buildings[i];
        if old.resolved.has_retained_entrance()||input.footprints.contains_key(&old.id){continue;}
        let mut r=input.requests.iter().find(|r|r.id==old.id).ok_or("Missing final native prepose request")?.clone();
        if let Some(fit)=input.settings.as_ref().and_then(|s|s.parcel_fit){r.parcel_fit=Some(fit);}
        if !request_allowed(&r){continue;}
        // Complete CURRENT other incumbents, not a cadastral/viewport shortlist.
        // <=64 parents only; prefix 2D geometry remains in the native session.
        let occupied=unite(&lands.iter().enumerate().filter(|(j,_)|*j!=i).map(|(_,s)|s.clone())
            .chain(std::iter::once(parent_batch::prior_land())).collect::<Vec<_>>());
        let (proposed,replaced)=finish(&r,&occupied,old.clone());
        if !replaced{continue;}
        let proposed_land=land(&proposed);
        if (0..lands.len()).filter(|j|*j!=i).any(|j|
            area(&intersection(&proposed.roof_footprint,&lands[j]))>0.0001
                ||area(&intersection(&roofs[j],&proposed_land))>0.0001){
            #[cfg(test)]diagnostics::qualified(&r.id,false);continue;
        }
        parent_batch::record_finalized(&proposed)?;
        #[cfg(test)]diagnostics::qualified(&r.id,true);
        lands[i]=proposed_land;roofs[i]=proposed.roof_footprint.clone();result.buildings[i]=proposed;
    }Ok(())
}

#[cfg(test)] pub(in crate::plans) mod diagnostics{
    use super::*;
    use std::cell::RefCell;
    #[derive(Clone,Default,Serialize)]pub(in crate::plans) struct Report{
        pub id:String,pub preparations:usize,pub admissions:usize,pub pose_generations:usize,pub generated_poses:usize,
        pub selected:bool,pub transform:Option<Transform>,pub front:Option<ArchitectureAccess>,pub native_high_y:Option<bool>,pub result:Option<String>,pub batch_qualified:Option<bool>,
    }
    #[derive(Default)]struct State{capturing:bool,current:Option<usize>,rows:Vec<Report>}
    std::thread_local!{static STATE:RefCell<State>=RefCell::new(State::default());}
    pub(in crate::plans) struct Capture;
    impl Capture{
        pub(in crate::plans) fn begin()->Self{STATE.with(|s|{assert!(!s.borrow().capturing);*s.borrow_mut()=State{capturing:true,..Default::default()};});Self}
        pub(in crate::plans) fn reports(&self)->Vec<Report>{STATE.with(|s|s.borrow().rows.clone())}
    }
    impl Drop for Capture{fn drop(&mut self){STATE.with(|s|*s.borrow_mut()=State::default());}}
    pub(in crate::plans) struct Scope{previous:Option<usize>,active:bool}
    impl Scope{pub(in crate::plans) fn enter(r:&PlacementRequest)->Self{STATE.with(|s|{let mut s=s.borrow_mut();if !s.capturing||!request_allowed(r){return Self{previous:None,active:false};}
        assert!(s.rows.len()<128);let old=s.current;let i=s.rows.len();s.rows.push(Report{id:r.id.clone(),..Default::default()});s.current=Some(i);Self{previous:old,active:true}
    })}}
    impl Drop for Scope{fn drop(&mut self){if self.active{STATE.with(|s|s.borrow_mut().current=self.previous);}}}
    fn update(f:impl FnOnce(&mut Report)){STATE.with(|s|{let mut s=s.borrow_mut();if let Some(i)=s.current{f(&mut s.rows[i]);}});}
    pub(in crate::plans) fn preparation(){update(|r|r.preparations+=1);}
    pub(in crate::plans) fn admission(){update(|r|r.admissions+=1);}
    pub(in crate::plans) fn pose_generated(n:usize){update(|r|{r.pose_generations+=1;r.generated_poses=n;});}
    pub(in crate::plans) fn selected(t:&Transform,a:&ArchitectureAccess,high:bool){update(|r|{r.selected=true;r.transform=Some(t.clone());r.front=Some(a.clone());r.native_high_y=Some(high);});}
    pub(in crate::plans) fn result(value:&str){update(|r|r.result=Some(value.into()));}
    pub(in crate::plans) fn qualified(id:&str,value:bool){STATE.with(|s|{if let Some(r)=s.borrow_mut().rows.iter_mut().rev().find(|r|r.id==id){r.batch_qualified=Some(value);}});}
}

#[cfg(test)]
#[path="single_native_prepose_tests.rs"]
mod tests;
