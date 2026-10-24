//! Bounded constructive recovery: grow the actual admitted whole rectangle at
//! its retained access-side anchor, before ONE native preparation/admission.
//! No source query, new draw, orientation search, dimension retry or door sweep.
use super::*;
use std::cell::{Cell, RefCell};

std::thread_local! {
    #[cfg(test)]
    static ENABLED: Cell<bool> = const { Cell::new(false) };
    static ACTIVE: Cell<bool> = const { Cell::new(false) };
    static REPORT: RefCell<Option<Report>> = const { RefCell::new(None) };
}
#[derive(Clone, Default, Serialize)]
pub(super) struct Report {
    pub eligible: bool, pub replaced: bool, pub reason: String,
    pub old_area_m2: f64, pub new_area_m2: f64, pub target_m2: Option<f64>,
    pub old_native_entry: bool, pub new_native_entry: bool,
    pub source_resolutions: usize, pub dimension_checks: usize, pub terrain_evaluations: usize,
    pub body_plan_constructions: usize, pub native_preparations: usize, pub admissions: usize,
    pub orientation_deg: f64, pub anchor_edge: Option<usize>, pub proposed_dimensions: Option<[f64;2]>,
    pub incumbent_step_m: Option<f64>,
    pub proposed_area_m2: Option<f64>, pub proposed_native_entry: Option<bool>,
    pub last_necessary_refusal: Option<String>,
}
#[cfg(test)]
pub(super) struct Mode(bool);
#[cfg(test)]
impl Mode { pub(super) fn new(enabled: bool) -> Self { Self(ENABLED.with(|s|s.replace(enabled))) } }
#[cfg(test)]
impl Drop for Mode { fn drop(&mut self) { ENABLED.with(|s|s.set(self.0)); } }
struct Active(bool);
impl Active { fn new() -> Self { Self(ACTIVE.with(|s|s.replace(true))) } }
impl Drop for Active { fn drop(&mut self) { ACTIVE.with(|s|s.set(self.0)); } }
// Normal library/CLI use is enabled. Tests retain an explicit legacy A/B switch;
// default-false avoids changing unrelated historical unit-test baselines.
#[cfg(not(test))]
pub(super) fn enabled() -> bool { true }
#[cfg(test)]
pub(super) fn enabled() -> bool { ENABLED.with(Cell::get) }
pub(super) fn last_report() -> Option<Report> { REPORT.with(|s|s.borrow().clone()) }
fn update(f: impl FnOnce(&mut Report)) { REPORT.with(|s| {if let Some(r)=s.borrow_mut().as_mut(){f(r)}}); }
#[cfg(test)]
pub(super) fn record_preparation() { if ACTIVE.with(Cell::get) {update(|r|r.native_preparations+=1);} }
#[cfg(test)]
pub(super) fn record_admission() { if ACTIVE.with(Cell::get) {update(|r|r.admissions+=1);} }
fn keep(old: PlanBuilding, reason: impl Into<String>) -> PlanBuilding {update(|r|r.reason=reason.into());old}

pub(super) fn enabled_for(r: &PlacementRequest, target: Option<&Surface>, exact: bool) -> bool {
    !exact && target.is_none() && r.native_minimum_candidates.is_empty()
        && native_ground_preparation_allowed(r,true) && r.parcel_fit!=Some(false)
        && r.culture.borrowing.as_deref().is_none_or(|s|s.trim().is_empty())
        && r.config.as_ref().is_none_or(|c|c.size==1. && c.orientation_deg==0.)
        && r.programme.as_ref().is_some_and(|p|p.built_area_m2.is_some_and(|v|v.is_finite()&&v>0.)
            && p.composition!=Some(crate::programme::ProgrammeComposition::Row)
            && !p.frontage_continuity.is_some_and(|v|v>=0.75))
}

/// Nearest retained body side to the *existing* entrance, chosen before any
/// proposal. Index0/1=lower/upper y,2/3=lower/upper x; stable ties keep this order.
fn anchor(old: &PlanBuilding, b: [f64;4], wall: f64) -> Option<usize> {
    let e=transform_point(old.entrance,&inverse(&old.transform));
    let mut choices=[((e.y-b[1]).abs(),0),((e.y-b[3]).abs(),1),((e.x-b[0]).abs(),2),((e.x-b[2]).abs(),3)];
    choices.sort_by(|a,b|a.0.total_cmp(&b.0).then(a.1.cmp(&b.1)));
    let (distance,edge)=choices[0];
    (distance.is_finite() && distance<=wall+GRID_M
        && e.x>=b[0]-wall-GRID_M && e.x<=b[2]+wall+GRID_M
        && e.y>=b[1]-wall-GRID_M && e.y<=b[3]+wall+GRID_M).then_some(edge)
}
fn pose(old: &PlanBuilding, b:[f64;4], [w,d]:[f64;2], edge:usize)->Transform {
    let x=(b[0]+b[2]-w)*0.5;let y=(b[1]+b[3]-d)*0.5;
    let origin=match edge {0=>Point{x,y:b[1]},1=>Point{x,y:b[3]-d},2=>Point{x:b[0],y},_=>Point{x:b[2]-w,y}};
    Transform {origin:transform_point(origin,&old.transform),orientation_deg:old.transform.orientation_deg}
}

pub(super) fn finish(r:&PlacementRequest,occupied:&Surface,old:PlanBuilding,target:Option<&Surface>,exact:bool)->PlanBuilding {
    let old_area=area(&old.footprint);let target_area=r.programme.as_ref().and_then(|p|p.built_area_m2);
    REPORT.with(|s|*s.borrow_mut()=Some(Report{old_area_m2:old_area,new_area_m2:old_area,target_m2:target_area,
        old_native_entry:old.resolved.has_retained_entrance(),new_native_entry:old.resolved.has_retained_entrance(),
        orientation_deg:old.transform.orientation_deg,..Default::default()}));
    if !enabled_for(r,target,exact) {return keep(old,"request outside automatic growth scope");}
    let target_area=target_area.unwrap();
    if old_area>=target_area*0.9 {return keep(old,"old mass already within/beyond lower tolerance; no probe");}
    let resolved=match old.resolved.unpack(){Ok(v)=>v,Err(e)=>return keep(old,format!("retained archive error: {e}"))};
    if resolved.parameters.layout!=crate::catalogue::Layout::Single
        || !crate::engine::single_native_entry_parameters(&resolved.parameters) {
        return keep(old,"not a native-entry-supported Single");
    }
    let shape=match crate::morphology::domestic_budget_shape(&resolved.parameters,&resolved.plan){
        Ok(v) if v.passage_m==0. && v.court_fraction==0.=>v,
        _=>return keep(old,"retained topology has no existing whole Single budget operator"),
    };
    let catalog=match catalogue(){Ok(v)=>v,Err(e)=>return keep(old,format!("catalogue error: {e}"))};
    let Some(recipe)=catalog.recipes.iter().find(|c|c.id==resolved.recipe_id) else{return keep(old,"retained recipe absent")};
    let source=recipe.variants.iter().find(|v|v.parameters.variant_id==resolved.parameters.variant_id)
        .map_or(&recipe.parameters,|v|&v.parameters);
    let size=resolved.config.size;
    let nominal=[source.width_m[0]*size,source.depth_m[0]*size];
    let Some(minimum)=adapted_single_budget::adapted_axis_minima(r,&resolved,source,nominal)
        else{return keep(old,"no existing admitted sub-nominal axis capability")};
    let Some(aspect)=source_aspect_budget::SourceAspectBudget::for_candidate(r,&resolved,source)
        else{return keep(old,"source aspect unsupported")};
    let body=&resolved.plan.bodies[0];
    if !body.cells.is_empty() || body.parameters.support.kind!=SupportKind::Ground || body.z!=0.
        || !matches!(body.parameters.roof_system.as_str(),"RF-GABLE"|"RF-HIP") {
        return keep(old,"body/roof needs another native descriptor");
    }
    let b=bounds(&body.footprint);let initial=[snap(b[2]-b[0]),snap(b[3]-b[1])];
    let allowed=[[minimum[0],source.width_m[1]*size*2.],[minimum[1],source.depth_m[1]*size*2.]];
    if !aspect.contains(initial,allowed) {return keep(old,"actual rectangle outside existing source aspect/physical bounds");}
    let Some(edge)=anchor(&old,b,body.parameters.wall_thickness_m[0]) else{return keep(old,"retained entrance does not identify a body side")};
    let upper=(target_area/(initial[0]*initial[1])).sqrt()
        .min(allowed[0][1]/initial[0]).min(allowed[1][1]/initial[1]);
    if !upper.is_finite() || upper<=1. {return keep(old,"no source-bounded growth interval");}
    update(|report|{report.eligible=true;report.anchor_edge=Some(edge);});
    let neighbors=unite(&r.neighbors.iter().map(|n|n.footprint.clone()).chain(std::iter::once(occupied.clone())).collect::<Vec<_>>());
    let land=difference(&r.cadastral,&r.reserves);let allowed_body=difference(&r.buildable,&r.reserves);
    let roof_rights=difference(r.roof_domain.as_ref().unwrap_or(&r.cadastral),&r.reserves);
    let eave=body.parameters.overhang_m[0]+GRID_M;
    if !eave.is_finite() || eave<0. {return keep(old,"invalid retained eave");}
    let check=|scale:f64|->Option<([f64;2],Transform)> {
        update(|report|report.dimension_checks+=1);
        let dims=[0,1].map(|axis|snap((libm::floor(initial[axis]*scale/GRID_M)*GRID_M).max(minimum[axis])));
        if !aspect.contains(dims,allowed) {return None;}
        let transform=pose(&old,b,dims,edge);
        let body=map_surface(&rectangle(0.,0.,dims[0],dims[1]),&transform);
        let roof=map_surface(&rectangle(-eave,-eave,dims[0]+2.*eave,dims[1]+2.*eave),&transform);
        if !contains(&allowed_body,&body)||!contains(&land,&body)||!contains(&roof_rights,&roof)
            ||area(&intersection(&body,&neighbors))>0.0001||area(&intersection(&roof,&neighbors))>0.0001||parent_session::necessary_clear(&r.id,&body,&roof).is_err() {
            update(|report|report.last_necessary_refusal=Some("necessary cadastral/buildable/roof/occupation guard".into()));return None;
        }
        update(|report|report.terrain_evaluations+=1);
        let (low,high,slope)=match r.terrain.foundation_bounds(&body){Ok(v)=>v,Err(e)=>{
            update(|report|report.last_necessary_refusal=Some(format!("necessary terrain query error: {e}")));return None;
        }};
        if scale==1. {update(|report|report.incumbent_step_m=Some(high-low));}
        // Necessary cheap checks are deliberately no looser than admission.
        if slope>crate::placement::MAX_LEVEL_FOUNDATION_SLOPE_DEG || high-low>r.terrain.max_foundation_step_m
            || r.terrain.water_z_m.is_some_and(|water|low<water) {
            update(|report|report.last_necessary_refusal=Some(format!("necessary terrain: step={} allowed={}; slope={} allowed={}; low={} water={:?}",
                high-low,r.terrain.max_foundation_step_m,slope,crate::placement::MAX_LEVEL_FOUNDATION_SLOPE_DEG,low,r.terrain.water_z_m)));return None;
        }
        Some((dims,transform))
    };
    if check(1.).is_none(){return keep(old,"conservative necessary checks do not certify incumbent anchor; no construction");}
    let mut found=check(upper);let(mut low,mut high)=(1.,upper);
    if found.is_none(){
        // A range ratio is only a priority for one scalar point, not a terrain
        // proof: bilinear height range need not scale linearly. Recheck it.
        let step=last_report().and_then(|report|report.incumbent_step_m).unwrap_or(0.);
        let hint=if step>0. {(r.terrain.max_foundation_step_m/step).clamp(low,high)} else {(low+high)*0.5};
        let hint=if hint<=low||hint>=high {(low+high)*0.5} else {hint};
        match check(hint){Some(v)=>{low=hint;found=Some(v);},None=>high=hint}
        for _ in 0..5 {let mid=(low+high)*0.5;match check(mid){Some(v)=>{low=mid;found=Some(v);},None=>high=mid}}
    }
    let Some((dims,transform))=found else{return keep(old,"no larger tested whole rectangle at this anchor")};
    if dims[0]*dims[1]<=old_area+1e-6 {return keep(old,"no strict area improvement; no construction");}
    update(|report|report.proposed_dimensions=Some(dims));
    let _active=Active::new();
    update(|report|report.body_plan_constructions+=1);
    let plan=match crate::morphology::domestic_budget_plan(&resolved.parameters,&resolved.plan,&shape,dims[0],dims[1]){
        Ok(v)=>v,Err(e)=>return keep(old,format!("one body-plan construction refused: {e}")),
    };
    let mut candidate=resolved.clone();candidate.parameters.width_m=[dims[0];2];candidate.parameters.depth_m=[dims[1];2];
    candidate.plan=plan;candidate.entrance=None;
    let prepared=PreparedPlan::with_native_entry(&candidate);
    match prepared.foundation(){
        Ok(crate::engine::FoundationPreparation::Supported(physical)) if physical.entry.is_some()=>{
            let width=physical.entry.as_ref().unwrap().body_entry.width_m;
            if resolved.entrance.as_ref().is_some_and(|previous|width<previous.width_m) {
                return keep(old,"one native preparation would narrow the previously certified entrance");
            }
        },
        Ok(crate::engine::FoundationPreparation::Unsupported(reason))=>return keep(old,format!("one native preparation unsupported: {reason}")),
        Ok(_)=>return keep(old,"one native preparation has no supported entrance"),
        Err(e)=>return keep(old,format!("one native preparation refused: {e}")),
    }
    let mut proposed=match visual_with_front_access_prepared(r,&prepared,transform,&neighbors,true,false,None,true){
        Ok(v)=>v,Err(e)=>return keep(old,format!("one native admission refused: {e}")),
    };
    let actual=area(&proposed.footprint);let native=proposed.resolved.has_retained_entrance();
    update(|report|{report.proposed_area_m2=Some(actual);report.proposed_native_entry=Some(native);});
    if !native || actual<=old_area+1e-6 || (actual/target_area-1.).abs()>=(old_area/target_area-1.).abs() {
        return keep(old,"admitted proposal fails strict area/retained-native-entry comparison");
    }
    for diagnostic in &mut proposed.diagnostics {
        if diagnostic.starts_with("Native ground-strip foundation:") {
            *diagnostic="Native ground-single foundation: the whole retained body determines the footing; complete native passage and public connector passed unchanged cadastral, reserve, neighbour, support, roof, foundation-step and slope guards. Household capacity remains unknown.".into();
        }
    }
    // New admission already describes its actual new geometry. Do not copy
    // old incumbent size/failed-entry diagnostics onto a different-sized body.
    proposed.diagnostics.push(format!(
        "Incumbent-anchored Single growth pilot: initial={old_area:.6}m2 actual={actual:.6}m2 target={target_area:.6}m2; same source, draws, floors, orientation and retained access-side anchor; at most8 necessary checks, one existing whole-body construction, one native preparation and one native admission. Prior final plan preserved on every failure; no target/population reduction or household credit. Partial mass does not provide a compound programme."
    ));
    update(|report|{report.replaced=true;report.new_area_m2=actual;report.new_native_entry=native;
        report.reason="strict native area improvement, same source, retained portal certificate".into();});
    proposed
}

#[cfg(test)]
#[path="single_incumbent_growth_tests.rs"]
mod tests;
