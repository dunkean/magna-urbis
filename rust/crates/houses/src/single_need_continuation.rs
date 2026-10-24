//! Indicative-need continuation, never a compound: grow the actual admitted whole rectangle at
//! its retained access-side anchor, before ONE native preparation/admission.
//! No source query, new draw, orientation search, dimension retry or door sweep.
use super::*;
use std::cell::{Cell, RefCell};

std::thread_local! {
    #[cfg(test)]
    static ENABLED: Cell<bool> = const { Cell::new(false) };
    static CAPTURE: RefCell<Option<Vec<serde_json::Value>>> = const { RefCell::new(None) };
    static ACTIVE: Cell<bool> = const { Cell::new(false) };
    static REPORT: RefCell<Option<Report>> = const { RefCell::new(None) };
}
#[derive(Clone, Default, Serialize)]
pub(super) struct Report {
    pub eligible: bool, pub replaced: bool, pub reason: String,
    pub old_area_m2: f64, pub new_area_m2: f64, pub target_m2: Option<f64>,
    pub requested_useful_m2: Option<f64>, pub old_gross_m2: Option<f64>, pub new_gross_m2: Option<f64>,
    pub original_mass_excess_m2: Option<f64>, pub new_mass_excess_m2: Option<f64>,
    pub proposed_gross_m2: Option<f64>, pub proposed_mass_excess_m2: Option<f64>,
    pub old_native_entry: bool, pub new_native_entry: bool,
    pub source_resolutions: usize, pub dimension_checks: usize, pub terrain_evaluations: usize,
    pub body_plan_constructions: usize, pub native_preparations: usize, pub admissions: usize,
    pub orientation_deg: f64, pub anchor_edge: Option<usize>, pub proposed_dimensions: Option<[f64;2]>,
    pub incumbent_step_m: Option<f64>,
    pub proposed_area_m2: Option<f64>, pub proposed_native_entry: Option<bool>,
    pub last_necessary_refusal: Option<String>,
}
struct Active(bool);
impl Active { fn new() -> Self { Self(ACTIVE.with(|s|s.replace(true))) } }
impl Drop for Active { fn drop(&mut self) { ACTIVE.with(|s|s.set(self.0)); } }
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
    if (old_area-target_area).abs()>target_area*0.1 {return keep(old,"outside original mass +/-10 percent; no need continuation");}
    let programme=r.programme.as_ref().unwrap();
    if programme.composition!=Some(crate::programme::ProgrammeComposition::Compound) {return keep(old,"not a compound wish; zero probe");}
    let Some(need)=programme.housing_floor_need.as_ref() else{return keep(old,"missing indicative useful need");};
    if need.validate(programme.households).is_err(){return keep(old,"invalid indicative useful need");}
    let old_outcome=PlanProgrammeOutcome::from_final_plan(r,&old);
    let Some(housing)=old_outcome.housing_floor.as_ref() else{return keep(old,"missing final need outcome");};
    let Some(old_gross)=housing.gross_floor_m2 else{return keep(old,"unknown final gross inventory; zero probe");};
    if old_gross>=need.requested_m2{return keep(old,"gross does not disprove useful need; zero probe");}
    if !old.resolved.has_retained_entrance(){return keep(old,"no retained native entry; zero probe");}
    let need_area=old_area*(need.requested_m2/old_gross);
    update(|report|{report.requested_useful_m2=Some(need.requested_m2);report.old_gross_m2=Some(old_gross);
        report.original_mass_excess_m2=Some((old_area-target_area).max(0.));
        report.new_gross_m2=Some(old_gross);report.new_mass_excess_m2=report.original_mass_excess_m2;});
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
    // Invalidate ONLY a separate proposal descriptor. The exact old archive,
    // entrance certificate and request are retained for every failure branch.
    let mut descriptor=resolved.clone();descriptor.entrance=None;
    let size=resolved.config.size;
    let nominal=[source.width_m[0]*size,source.depth_m[0]*size];
    let current_bounds=bounds(&resolved.plan.bodies[0].footprint);
    let current=[snap(current_bounds[2]-current_bounds[0]),snap(current_bounds[3]-current_bounds[1])];
    let minimum=match adapted_single_budget::adapted_axis_minima(r,&descriptor,source,nominal) {
        Some(v)=>v,
        None if current[0]>=nominal[0] && current[1]>=nominal[1]=>nominal,
        None=>return keep(old,"no existing source-axis or adapted physical bounds"),
    };
    let Some(aspect)=source_aspect_budget::SourceAspectBudget::for_candidate(r,&descriptor,source)
        else{return keep(old,"source aspect unsupported")};
    let body=&resolved.plan.bodies[0];
    if body.levels.len()!=1 || !body.cells.is_empty() || body.parameters.support.kind!=SupportKind::Ground || body.z!=0.
        || !matches!(body.parameters.roof_system.as_str(),"RF-GABLE"|"RF-HIP") {
        return keep(old,"body/roof needs another native descriptor");
    }
    let b=bounds(&body.footprint);let initial=[snap(b[2]-b[0]),snap(b[3]-b[1])];
    let allowed=[[minimum[0],source.width_m[1]*size*2.],[minimum[1],source.depth_m[1]*size*2.]];
    if !aspect.contains(initial,allowed) {return keep(old,"actual rectangle outside existing source aspect/physical bounds");}
    let Some(edge)=anchor(&old,b,body.parameters.wall_thickness_m[0]) else{return keep(old,"retained entrance does not identify a body side")};
    let upper=(need_area/(initial[0]*initial[1])).sqrt()
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
    let final_outcome=PlanProgrammeOutcome::from_final_plan(r,&proposed);
    let Some(new_gross)=final_outcome.housing_floor.as_ref().and_then(|h|h.gross_floor_m2) else {
        return keep(old,"new admitted final gross inventory unknown; old plan retained");
    };
    update(|report|{report.proposed_gross_m2=Some(new_gross);report.proposed_mass_excess_m2=Some((actual-target_area).max(0.));});
    let new_resolved=match proposed.resolved.unpack(){Ok(v)=>v,Err(_)=>return keep(old,"new archive cannot be inspected")};
    if !native || actual<=old_area+1e-6 || new_gross<=old_gross
        || new_resolved.parameters.layout!=crate::catalogue::Layout::Single
        || new_resolved.plan.bodies.len()!=1 || new_resolved.plan.bodies[0].levels.len()!=1 {
        return keep(old,"admitted proposal fails strict gross/native entry/Single comparison");
    }
    proposed.programme_outcome=Some(final_outcome);
    for diagnostic in &mut proposed.diagnostics {
        if diagnostic.starts_with("Native ground-strip foundation:") {
            *diagnostic="Native ground-single foundation: the whole retained body determines the footing; complete native passage and public connector passed unchanged cadastral, reserve, neighbour, support, roof, foundation-step and slope guards. Household capacity remains unknown.".into();
        }
    }
    // New admission already describes its actual new geometry. Do not copy
    // old incumbent size/failed-entry diagnostics onto a different-sized body.
    proposed.diagnostics.push(format!(
        "Indicative-need Single continuation: initial={old_area:.6}m2 actual={actual:.6}m2 original mass target={target_area:.6}m2 unchanged, indicative useful need={}, old gross={old_gross:.6}m2, new gross={new_gross:.6}m2; same source, draws, floors, orientation and retained access-side anchor; at most8 necessary checks, one existing whole-body construction, one native preparation and one native admission. Prior final plan preserved on every failure; no target/population reduction or household credit. Partial mass does not provide a compound programme; any excess over the unchanged original mass target is explicit.",need.requested_m2
    ));
    update(|report|{report.replaced=true;report.new_area_m2=actual;report.new_native_entry=native;
        report.new_gross_m2=Some(new_gross);report.new_mass_excess_m2=Some((actual-target_area).max(0.));
        report.reason="strict gross improvement only; Single, same source, retained portal; original mass excess reported".into();});
    proposed
}

#[cfg(not(test))]
pub(super) fn enabled()->bool {true}
#[cfg(test)]
pub(super) fn enabled()->bool {ENABLED.with(Cell::get)}
#[cfg(test)]
pub(super) struct Mode(bool);
#[cfg(test)]
impl Mode {pub(super) fn new(enabled:bool)->Self {Self(ENABLED.with(|s|s.replace(enabled)))}}
#[cfg(test)]
impl Drop for Mode {fn drop(&mut self){ENABLED.with(|s|s.set(self.0));}}
#[cfg(test)]
pub(super) struct Capture(Option<Vec<serde_json::Value>>);
#[cfg(test)]
impl Capture {
    pub(super) fn new()->Self {Self(CAPTURE.with(|s|s.replace(Some(Vec::new()))))}
    pub(super) fn take(&mut self)->Vec<serde_json::Value> {CAPTURE.with(|s|s.borrow_mut().as_mut().unwrap().drain(..).collect())}
}
#[cfg(test)]
impl Drop for Capture {fn drop(&mut self){CAPTURE.with(|s|*s.borrow_mut()=self.0.take());}}
#[cfg(test)]
pub(super) fn capture_finished(r:&PlacementRequest,old:&PlanBuilding,new:&PlanBuilding) {
    use serde_json::json;
    use sha2::{Digest,Sha256};
    if let Some(report)=last_report(){
        let old_bytes=serde_json::to_vec(old).unwrap();let new_bytes=serde_json::to_vec(new).unwrap();
        let a=old.resolved.unpack().unwrap();let b=new.resolved.unpack().unwrap();
        let mut ap=serde_json::to_value(&a.parameters).unwrap();let mut bp=serde_json::to_value(&b.parameters).unwrap();
        for key in ["width_m","depth_m"] {ap.as_object_mut().unwrap().remove(key);bp.as_object_mut().unwrap().remove(key);}
        let row=json!({"id":r.id,"old_final_sha256":format!("{:x}",Sha256::digest(&old_bytes)),
            "retained_final_sha256":format!("{:x}",Sha256::digest(&new_bytes)),"route":report,
            "checks":{"exact_old_on_failure":report.replaced||old_bytes==new_bytes,
                "same_source_variant":old.recipe_id==new.recipe_id&&old.variant_id==new.variant_id,
                "same_config_seed":serde_json::to_value(&a.config).unwrap()==serde_json::to_value(&b.config).unwrap(),
                "same_non_dimension_parameters":ap==bp,
                "same_orientation":old.transform.orientation_deg.to_bits()==new.transform.orientation_deg.to_bits(),
                "same_bodies_levels":a.plan.bodies.len()==b.plan.bodies.len()&&a.plan.bodies.iter().zip(&b.plan.bodies).all(|(a,b)|a.levels.len()==b.levels.len()),
                "no_native_entry_loss":!old.resolved.has_retained_entrance()||new.resolved.has_retained_entrance(),
                "original_mass_target":report.target_m2==r.programme.as_ref().and_then(|p|p.built_area_m2),
                "strict_gross_gain_if_replaced":!report.replaced||report.new_gross_m2>report.old_gross_m2,
                "within_budget":report.source_resolutions==0&&report.dimension_checks<=8&&report.terrain_evaluations<=8
                    &&report.body_plan_constructions<=1&&report.native_preparations<=1&&report.admissions<=1},
            "households_requested":r.programme.as_ref().and_then(|p|p.households),"housed_households":null});
        CAPTURE.with(|s|{if let Some(rows)=s.borrow_mut().as_mut(){rows.push(row);}});
    }
}


/// Old pipeline finalizes EVERY request first. Actual batch
/// incumbents (not a historical snapshot) reserve all other occupied surfaces.
pub(super) fn after_complete_batch(input:&PlanBatchRequest,result:&mut PlanBatch)->Result<(),String>{
    if input.settings.as_ref().is_some_and(|s|s.typology.is_some()||s.house_config.is_some()||s.floors.is_some()){
        return Err("Deferred proof supports only the actual parcel_fit header; explicit header overrides are outside this experiment".into());
    }
    let request_map:BTreeMap<_,_>=input.requests.iter().map(|r|{
        let mut r=r.clone();if let Some(fit)=input.settings.as_ref().and_then(|s|s.parcel_fit){r.parcel_fit=Some(fit);}(r.id.clone(),r)
    }).collect();
    let occupied_land=|b:&PlanBuilding|{
        let mut parts=vec![b.footprint.clone(),b.courtyards.clone(),b.circulation.clone()];
        parts.extend(b.structural_features.iter().map(|f|f.surface.clone()));unite(&parts)
    };
    let mut occupation=BatchOccupation::new(result.buildings.iter().map(occupied_land).collect());
    let mut roofs:Vec<_>=result.buildings.iter().map(|b|b.roof_footprint.clone()).collect();
    let batch_initial:Vec<_>=result.buildings.iter().map(|b|(b.id.clone(),area(&b.footprint),b.resolved.has_retained_entrance())).collect();
    for i in 0..result.buildings.len(){
        let r=&request_map[&result.buildings[i].id];let old=result.buildings[i].clone();
        let local=occupation.local_excluding(i,&r.cadastral);
        let prior=parent_batch::prior_land();
        let occupied=if prior.is_empty(){local}else{unite(&[local,prior])};
        let mut proposed=finish(r,&occupied,old.clone(),input.footprints.get(&r.id),false);
        let finish_attempt=last_report().unwrap();let mut rejected=false;let mut pair_checks=0;
        let(mut roof_vs_other_land,mut other_roof_vs_land)=(0_f64,0_f64);
        if finish_attempt.replaced {
            let land=occupied_land(&proposed);
            // Qualification of ONE already admitted object, no new dimension,
            // source, preparation, portal or native-admission trial. Both
            // directions use the existing global/native occupation threshold.
            for j in 0..occupation.surfaces.len(){if j==i{continue;}pair_checks+=1;
                roof_vs_other_land=roof_vs_other_land.max(area(&intersection(&proposed.roof_footprint,&occupation.surfaces[j])));
                other_roof_vs_land=other_roof_vs_land.max(area(&intersection(&roofs[j],&land)));
            }
            if roof_vs_other_land>0.0001||other_roof_vs_land>0.0001 {
                rejected=true;proposed=old.clone();
                update(|report|{report.replaced=false;report.new_area_m2=report.old_area_m2;
                    report.new_native_entry=report.old_native_entry;report.new_gross_m2=report.old_gross_m2;
                    report.new_mass_excess_m2=report.original_mass_excess_m2;
                    report.reason="batch reservation rejected admitted proposal: roof/land intersects another finalized incumbent; exact previous final retained".into();});
            }
        }
        capture_finished(r,&old,&proposed);
        CAPTURE.with(|capture|{if let Some(rows)=capture.borrow_mut().as_mut(){if let Some(last)=rows.last_mut(){
            last["phase"]=serde_json::json!("after_complete_legacy_batch");
            last["native_finish_attempt"]=serde_json::json!(finish_attempt);
            last["batch_reservation"]=serde_json::json!({"other_incumbents":occupation.surfaces.len().saturating_sub(1),"pair_qualification_checks":pair_checks,
                "max_proposed_roof_vs_other_land_m2":roof_vs_other_land,"max_other_roof_vs_proposed_land_m2":other_roof_vs_land,
                "rejected_after_one_native_admission":rejected,"snapshot_oracle_used":false});
        }}});
        parent_batch::record_finalized(&proposed)?;
        // A refused/unchanged proposal is the whole old object, whose land and
        // roof are already retained. Update geometry only for an actual winner.
        if !occupation.reuses_geometry()||finish_attempt.replaced&&!rejected{
            occupation.replace(i,occupied_land(&proposed));roofs[i]=proposed.roof_footprint.clone();
        }
        result.buildings[i]=proposed;
    }
    // Batch-internal monotonicity relative to the ACTUAL just-finalized old
    // pipeline, not to a stored baseline or another source/context.
    for(id,area_before,entry_before)in batch_initial{
        let b=result.buildings.iter().find(|b|b.id==id).unwrap();
        if area(&b.footprint)+1e-7<area_before||entry_before&&!b.resolved.has_retained_entrance(){
            return Err("Deferred continuation violated actual finalized batch incumbent invariants".into());
        }
    }
    Ok(())
}

// Capture is proof-only; product never serializes/hashes every old/new archive.
#[cfg(not(test))]
pub(super) fn capture_finished(_: &PlacementRequest, _: &PlanBuilding, _: &PlanBuilding) {}

/// Conservative compatibility boundary for the validated automatic pathway.
/// Explicit controls/pins preserve the previous WHOLE batch, including errors.
/// Programme wealth/seed are preserved; no requested household or target is changed.
pub(super) fn supported_batch(input: &PlanBatchRequest) -> bool {
    if input.schema_version != "1" || !input.footprints.is_empty()
        || input.settings.as_ref().is_some_and(|s| s.typology.is_some()
            || s.house_config.is_some() || s.floors.is_some() || s.parcel_fit == Some(false)) {
        return false;
    }
    let automatic_variation = HouseConfig::default().variation;
    if !input.requests.iter().all(|r| {
        // Functional sources cannot enter finish: preserve their exact final
        // plans as reserved incumbents without vetoing automatic homes.
        if !matches!(r.function, ArchitectureFunction::Domestic | ArchitectureFunction::Mixed) {
            return true;
        }
        r.typology.is_none() && r.native_minimum_candidates.is_empty()
            && r.culture.mode == HistoricalMode::HistoricalInspired
            && r.culture.borrowing.as_deref().is_none_or(|s| s.trim().is_empty())
            && r.config.as_ref().is_none_or(|c| {
                c.schema_version == crate::SCHEMA_VERSION && c.count == 1
                    && c.pack == r.culture.pack && c.mode == r.culture.mode
                    && c.era == "any" && !c.allow_late
                    && c.recipe.is_none() && c.workshop.is_none()
                    && c.overrides == Overrides::default()
                    && c.size == 1. && c.orientation_deg == 0.
                    && c.variation == automatic_variation
                    && c.wealth.is_finite() && (0. ..=1.).contains(&c.wealth)
            })
    }) { return false; }
    input.requests.iter().any(|r| {
        r.parcel_fit != Some(false)
            && matches!(r.function, ArchitectureFunction::Domestic | ArchitectureFunction::Mixed)
            && r.programme.as_ref().is_some_and(|p| {
                p.composition == Some(crate::programme::ProgrammeComposition::Compound)
                    && p.built_area_m2.is_some_and(|v| v.is_finite() && v > 0.)
                    && p.housing_floor_need.as_ref().is_some_and(|n| n.validate(p.households).is_ok())
            })
    })
}
#[cfg(test)]
#[path = "single_need_continuation_tests.rs"]
mod tests;
