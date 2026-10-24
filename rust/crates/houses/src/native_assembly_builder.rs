//! The pair probe's bounded physical construction, with a real internal link.
use super::*;
use crate::catalogue::Layout;

// Administrative request budgets, not geometric/source/physical minima.
// Match the existing bridge's 24 MiB minified input envelope. Reject whole
// input before to_geo/unions; never truncate a complete neighbor set.
pub const MAX_ASSEMBLY_INPUT_BYTES:usize=24*1024*1024;
pub const MAX_ASSEMBLY_PARTS:usize=4096;
pub const MAX_ASSEMBLY_VERTICES:usize=262144;
#[cfg(test)]
std::thread_local!{static OCCUPATION_UNIONS:std::cell::Cell<usize>=const{std::cell::Cell::new(0)};}
#[cfg(test)]
pub(super) struct OccupationUnionProbe(usize);
#[cfg(test)]
impl OccupationUnionProbe {
    pub(super) fn new()->Self{Self(OCCUPATION_UNIONS.with(|n|n.replace(0)))}
    pub(super) fn calls(&self)->usize{OCCUPATION_UNIONS.with(std::cell::Cell::get)}
}
#[cfg(test)]
impl Drop for OccupationUnionProbe{fn drop(&mut self){OCCUPATION_UNIONS.with(|n|n.set(self.0));}}
// Opt-in A/B control exists only in tests; ordinary candidate runtime enables
// the same bounded fallback. No global configuration/capability change.
#[cfg(test)]std::thread_local!{static OWNED_REPLAY:std::cell::Cell<bool>=const{std::cell::Cell::new(true)};}
#[cfg(test)]pub(super) struct OwnedReplayMode(bool);
#[cfg(test)]impl OwnedReplayMode{pub(super) fn new(value:bool)->Self{Self(OWNED_REPLAY.with(|s|s.replace(value)))}}
#[cfg(test)]impl Drop for OwnedReplayMode{fn drop(&mut self){OWNED_REPLAY.with(|s|s.set(self.0));}}
#[cfg(test)]fn owned_replay_enabled()->bool{OWNED_REPLAY.with(std::cell::Cell::get)}
#[cfg(not(test))]fn owned_replay_enabled()->bool{true}

// This is eligibility to replay the EXACT already-owned native descriptor at
// another pose, not permission to resize a source below its nominal ranges.
// The nominal sizing ranges below are never altered by this helper.
fn owned_replay_dimensions(r:&PlacementRequest,owned:&ResolvedArchitecture,source:&crate::catalogue::Parameters,
    aspect:&source_aspect_budget::SourceAspectBudget)->Option<[f64;2]>{
    if !owned_replay_enabled()||owned.entrance.is_none()||owned.plan.bodies.len()!=1
        ||owned.plan.bodies[0].levels.len()!=1||!owned.plan.context.is_empty(){return None;}
    let body=&owned.plan.bodies[0];
    if body.parameters.support.kind!=SupportKind::Ground||body.parameters.support.height_m!=[0.;2]
        ||body.z!=0.||!body.cells.is_empty()||!crate::engine::single_native_entry_parameters(&owned.parameters){return None;}
    let b=bounds(&body.footprint);let dims=[b[2]-b[0],b[3]-b[1]];
    let physical=crate::morphology::constrained_minimum_domain(&body.parameters);
    let limits=[[physical[0],source.width_m[1]*owned.config.size*2.],[physical[1],source.depth_m[1]*owned.config.size*2.]];
    if !aspect.contains(dims,limits)||r.parcel_fit==Some(false){return None;}
    Some(dims)
}
#[cfg(test)]pub(super) fn owned_replay_dimensions_for_test(r:&PlacementRequest,owned:&ResolvedArchitecture)->Option<[f64;2]>{
    let catalog=catalogue().ok()?;let recipe=catalog.recipes.iter().find(|v|v.id==owned.recipe_id)?;
    let source=recipe.variants.iter().find(|v|v.parameters.variant_id==owned.parameters.variant_id).map_or(&recipe.parameters,|v|&v.parameters);
    let mut descriptor=owned.clone();descriptor.entrance=None;
    let aspect=source_aspect_budget::SourceAspectBudget::for_candidate(r,&descriptor,source)?;
    owned_replay_dimensions(r,owned,source,&aspect)
}
fn owned_replay_pose(old:&PlanBuilding,dims:[f64;2],gap:f64,axis:usize)->Transform{
    // Translate only the pose: do not normalize/rebuild any local coordinate.
    let offset=match axis{0=>point(-dims[0]-gap,0.),1=>point(dims[0]+gap,0.),2=>point(0.,-dims[1]-gap),_=>point(0.,dims[1]+gap)};
    Transform{origin:transform_point(offset,&old.transform),orientation_deg:old.transform.orientation_deg}
}
struct CountBytes{bytes:usize}
impl std::io::Write for CountBytes {
    fn write(&mut self,b:&[u8])->std::io::Result<usize>{
        self.bytes=self.bytes.saturating_add(b.len());
        if self.bytes>MAX_ASSEMBLY_INPUT_BYTES{return Err(std::io::Error::other("assembly input byte budget"));}
        Ok(b.len())
    }
    fn flush(&mut self)->std::io::Result<()>{Ok(())}
}
pub(super) fn encoded_input_budget(value:&impl Serialize)->Result<(),String>{
    serde_json::to_writer(&mut CountBytes{bytes:0},value)
        .map_err(|e|format!("[assembly_budget] Complete native payload exceeds 24 MiB or cannot be serialized: {e}"))
}
fn resource_preflight(input:&AssemblePairRequest)->Result<(),String>{
    let r=&input.site;let b=&input.incumbent;
    let surfaces=input.occupied_parts.iter().chain(&input.occupied_roof_parts)
        .chain([&r.cadastral,&r.buildable,&r.reserves]).chain(r.roof_domain.iter()).chain(r.placement_hint.iter())
        .chain(r.neighbors.iter().map(|n|&n.footprint))
        .chain([&b.footprint,&b.roof_footprint,&b.courtyards,&b.circulation])
        .chain(b.structural_features.iter().map(|f|&f.surface))
        .chain(b.volumes.iter().flat_map(|v|std::iter::once(&v.footprint).chain(v.levels.iter().map(|l|&l.footprint))));
    let mut parts=0usize;let mut surface_count=0usize;let mut vertices=0usize;
    for surface in surfaces{
        surface_count=surface_count.saturating_add(1);
        parts=parts.saturating_add(surface.len());
        for p in surface {vertices=vertices.saturating_add(p.outer.len());for h in &p.holes{vertices=vertices.saturating_add(h.len());}}
        if surface_count>MAX_ASSEMBLY_PARTS||parts>MAX_ASSEMBLY_PARTS||vertices>MAX_ASSEMBLY_VERTICES{return Err("[assembly_budget] Complete input exceeds part/vertex budget; no native geometry attempted".into());}
    }
    // Includes the opaque archive/config/terrain and strings too, without a
    // second full serialized request Vec. Compact serialization still has its
    // own bounded transient representation; this is not a heap measurement.
    encoded_input_budget(input)
}


// Only test code can disable this scoped source/segment correction for A/B.
#[cfg(test)]std::thread_local!{static FRONTAGE_SELECTION:std::cell::Cell<bool>=const{std::cell::Cell::new(true)};}
#[cfg(test)]pub(super) struct FrontageSelectionMode(bool);
#[cfg(test)]impl FrontageSelectionMode{pub(super) fn new(value:bool)->Self{Self(FRONTAGE_SELECTION.with(|s|s.replace(value)))}}
#[cfg(test)]impl Drop for FrontageSelectionMode{fn drop(&mut self){FRONTAGE_SELECTION.with(|s|s.set(self.0));}}
#[cfg(test)]fn frontage_selection_enabled()->bool{FRONTAGE_SELECTION.with(std::cell::Cell::get)}
#[cfg(not(test))]fn frontage_selection_enabled()->bool{true}

// A Single has no stored public-contact certificate. This contact is freshly
// calculated by the SAME existing native connector at the retained pose. Never
// infer the street segment from access_id, nor try admissions for each segment.
pub(super) fn retained_public_front<'a>(r:&'a PlacementRequest,old:&PlanBuilding,first:&'a ArchitectureAccess,
    portal:Point,id:&str,path:&Surface,contact:Point)->Result<&'a ArchitectureAccess,String>{
    if id!=old.access_id||!same_surface(path,&old.circulation){
        return Err("incumbent public connector is not the retained branch".into());
    }
    // Existing correct first-segment behavior and its old set-equivalence guard
    // stay intact. Only selecting a DIFFERENT segment requires the stricter
    // ordered path and portal-bit evidence below.
    if contact_on_front(id,contact,first){return Ok(first);}
    if path!=&old.circulation||portal.x.to_bits()!=old.entrance.x.to_bits()
        ||portal.y.to_bits()!=old.entrance.y.to_bits(){
        return Err("retained frontage selection lacks exact path/portal evidence; original kept".into());
    }
    let mut matches=r.accesses.iter().filter(|a|a.kind=="public"&&contact_on_front(id,contact,a));
    let selected=matches.next().ok_or("retained native contact has no declared public segment; original kept")?;
    if matches.next().is_some(){return Err("retained native contact has ambiguous public segments; original kept".into());}
    Ok(selected)
}

fn max_coordinate_ulp(a:&Surface,b:&Surface)->Option<u64>{
    if a.len()!=b.len()||a.iter().zip(b).any(|(a,b)|a.outer.len()!=b.outer.len()||a.holes.len()!=b.holes.len()
        ||a.holes.iter().zip(&b.holes).any(|(a,b)|a.len()!=b.len())){return None;}
    let coordinates=|s:&Surface|s.iter().flat_map(|p|std::iter::once(&p.outer).chain(&p.holes))
        .flat_map(|r|r.iter().flat_map(|p|[p.x,p.y])).collect::<Vec<_>>();
    let ordered=|v:f64|{let bits=v.to_bits();if bits>>63==0{bits|(1<<63)}else{!bits}};
    Some(coordinates(a).into_iter().zip(coordinates(b)).map(|(a,b)|ordered(a).abs_diff(ordered(b))).max().unwrap_or(0))
}
fn nondim(p:&crate::catalogue::Parameters)->serde_json::Value{
    let mut v=serde_json::to_value(p).expect("finite native parameters");
    for key in ["width_m","depth_m"]{v.as_object_mut().unwrap().remove(key);}v
}
fn pose(old:&PlanBuilding,b:[f64;4],dims:[f64;2],gap:f64,axis:usize)->Transform{
    let [w,d]=dims;let x=(b[0]+b[2]-w)*0.5;let y=(b[1]+b[3]-d)*0.5;
    let local=match axis{0=>point(b[0]-gap-w,y),1=>point(b[2]+gap,y),2=>point(x,b[1]-gap-d),_=>point(x,b[3]+gap)};
    Transform{origin:transform_point(local,&old.transform),orientation_deg:old.transform.orientation_deg}
}

pub fn assemble_pair(input:AssemblePairRequest)->Result<AssemblyDecision,String>{
    resource_preflight(&input)?;
    validate_request(&input.site)?;
    for part in input.occupied_parts.iter().chain(&input.occupied_roof_parts){
        if !part.is_empty()&&(!valid_surface(part)||!geo::algorithm::Validation::is_valid(&to_geo(part))){
            return Err("Invalid complete native occupation input part".into());
        }
    }
    let mut report=AssemblyAttemptReport{occupied_parts:input.occupied_parts.len(),occupied_roof_parts:input.occupied_roof_parts.len(),
        ..Default::default()};
    match build(&input.site,&input.occupied_parts,&input.occupied_roof_parts,&input.incumbent,&mut report){
        Ok(assembly)=>{
            // Archive construction is part of success, not a frontend task.
            match NativeAssemblyArchive::pack(&assembly){
                Ok(archive)=>{
                    report.reason="two native members with a typed internal-to-public connection; functional and household capacity unknown".into();
                    Ok(AssemblyDecision::Assembled{assembly,archive,report})
                },
                Err(error)=>{
                    report.reason=format!("native assembly archive commit refused: {error}; original whole plan retained");
                    Ok(AssemblyDecision::Retained{building:input.incumbent,report})
                },
            }
        },
        Err(reason)=>{
            report.reason=reason;
            Ok(AssemblyDecision::Retained{building:input.incumbent,report})
        },
    }
}

fn build(r:&PlacementRequest,occupied_parts:&[Surface],occupied_roof_parts:&[Surface],old:&PlanBuilding,report:&mut AssemblyAttemptReport)
    ->Result<RetainedNativeAssembly,String>{
    if !r.native_minimum_candidates.is_empty()||!native_ground_preparation_allowed(r,true)
        ||r.parcel_fit==Some(false)||r.typology.is_some()
        ||r.culture.borrowing.as_deref().is_some_and(|s|!s.trim().is_empty())
        ||r.config.as_ref().is_some_and(|c|c.size!=1.||c.orientation_deg!=0.){
        return Err("outside unpinned automatic native assembly scope".into());
    }
    if old.id!=r.id||old.parcel_id!=r.parcel_id||old.function!=r.function
        ||old.culture.culture!=r.culture.culture||old.culture.pack!=r.culture.pack{
        return Err("incumbent identity differs from parent site".into());
    }
    let p=r.programme.as_ref().ok_or("missing parent programme")?;
    if p.composition!=Some(crate::programme::ProgrammeComposition::Compound){return Err("parent did not request compound".into());}
    let need=p.housing_floor_need.as_ref().ok_or("missing parent indicative useful model")?;
    need.validate(p.households)?;
    let old_gross=super::super::plan_programme_outcome::housing_floor_outcome::gross_floor_inventory(old)?;
    let missing=(need.requested_m2-old_gross).max(0.);
    if missing<=0.{return Err("known gross already meets necessary model bound; zero construction".into());}
    if !old.resolved.has_retained_entrance()||old.volumes.len()!=1||old.volumes[0].levels.len()!=1{
        return Err("incumbent is not one native-portal body with one level".into());
    }
    let retained=old.resolved.unpack()?;
    if old.culture.mode!=r.culture.mode||old.culture.borrowing!=r.culture.borrowing
        ||retained.recipe_id!=old.recipe_id||retained.parameters.variant_id!=old.variant_id {
        return Err("incumbent culture/source identity differs from parent site".into());
    }
    let mut expected=r.config.clone().unwrap_or_default();
    if expected.recipe.is_some()||expected.workshop.is_some()||expected.overrides!=Overrides::default()
        ||r.config.as_ref().is_some_and(|c|c.mode!=r.culture.mode||c.pack!=r.culture.pack)
        ||expected.size!=1.||expected.orientation_deg!=0. {
        return Err("manual config cannot use automatic native assembly".into());
    }
    expected.pack=r.culture.pack.clone();expected.mode=r.culture.mode;expected.seed=r.seed.clone();
    expected.count=1;expected.orientation_deg=0.;
    let query=StyleQuery{pack_id:Some(expected.pack.clone()),
        tradition_id:crate::cultural_palettes::automatic_tradition(&r.culture,&expected,false).map(str::to_owned),
        recipe_id:Some(old.recipe_id.clone()),variant_id:Some(old.variant_id.clone()),mode:expected.mode,
        era:expected.era.clone(),allow_late:expected.allow_late,..Default::default()};
    let entries=style_index()?.find(&query);
    let entry=entries.first().ok_or("incumbent source is outside the site's actual culture/era palette")?;
    expected.recipe=Some(old.recipe_id.clone());expected.overrides.variant=Some(old.variant_id.clone());
    if let Some(floor)=p.preferred_floor(entry,&expected,&r.seed){expected.overrides.floors=Some(floor);}
    catalogue()?.validate_config(&expected)?;
    if expected!=retained.config{return Err("incumbent retained config/seed/era differs from the effective parent site config".into());}
    let mut source_member=retained.clone();source_member.entrance=None;
    if source_member.parameters.layout!=Layout::Single
        ||!crate::engine::single_native_entry_parameters(&source_member.parameters)
        ||!source_member.plan.context.is_empty(){return Err("unsupported retained Single descriptor/context".into());}
    let shape=crate::morphology::domestic_budget_shape(&source_member.parameters,&source_member.plan).map_err(str::to_owned)?;
    if shape.passage_m!=0.||shape.court_fraction!=0.||source_member.plan.bodies[0].levels.len()!=1
        ||source_member.plan.bodies[0].z!=0.||source_member.plan.bodies[0].parameters.support.kind!=SupportKind::Ground{
        return Err("another native assembly/level/support descriptor is required".into());
    }
    let data=catalogue()?;let recipe=data.recipes.iter().find(|p|p.id==retained.recipe_id).ok_or("retained recipe absent")?;
    let source=recipe.variants.iter().find(|v|v.parameters.variant_id==retained.parameters.variant_id).map_or(&recipe.parameters,|v|&v.parameters);
    let aspect=source_aspect_budget::SourceAspectBudget::for_candidate(r,&source_member,source).ok_or("unsupported source aspect capability")?;
    let size=retained.config.size;
    let allowed=[[shape.minimum_body[0].max(source.width_m[0]*size),source.width_m[1]*size*2.],
                 [shape.minimum_body[1].max(source.depth_m[0]*size),source.depth_m[1]*size*2.]];
    let b=bounds(&source_member.plan.bodies[0].footprint);
    let ratio=(b[2]-b[0])/(b[3]-b[1]);
    let minimum_area=allowed[0][0]*allowed[1][0];let maximum_area=allowed[0][1]*allowed[1][1];
    if !ratio.is_finite()||ratio<=0.||minimum_area>maximum_area{return Err("invalid retained/source dimension bounds".into());}
    let mut dimension_slots=vec![];
    for a in [missing.clamp(minimum_area,maximum_area),minimum_area]{
        let w=libm::sqrt(a*ratio);
        if let Some(dims)=aspect.project([w,a/w],allowed){if !dimension_slots.contains(&dims){dimension_slots.push(dims);}}
    }
    if dimension_slots.is_empty(){return Err("no source-bounded nominal new member dimensions".into());}
    // Freeze this owned option before nominal outcomes; no result-based source
    // or geometry selection. It is used only if four existing slots remain.
    let owned_copy_dimensions=owned_replay_dimensions(r,&retained,source,&aspect);
    let mut aimed=r.accesses.iter().find(|a|a.id==old.access_id&&a.kind=="public").ok_or("retained portal has no matching declared public access")?;
    // All original complete-input validation ran before build(). These unions
    // are first needed here; earlier gates depend only on the same site/source
    // and incumbent. Keep their order and every part, never filter neighbors.
    #[cfg(not(target_arch="wasm32"))]
    let union_started=std::time::Instant::now();
    #[cfg(test)]
    OCCUPATION_UNIONS.with(|n|n.set(n.get()+1));
    let occupied=unite(occupied_parts);
    #[cfg(test)]
    OCCUPATION_UNIONS.with(|n|n.set(n.get()+1));
    let occupied_roofs=unite(occupied_roof_parts);
    #[cfg(not(target_arch="wasm32"))]
    {report.occupation_union_ms=Some(union_started.elapsed().as_secs_f64()*1000.);}
    let external=unite(&r.neighbors.iter().map(|n|n.footprint.clone()).chain([occupied.clone()]).collect::<Vec<_>>());
    // Revalidate the PUBLIC input separately; never treat its JSON as an
    // admission token. Cached old source is not redrawn or replaced.
    report.incumbent_preparations+=1;
    let old_prepared=PreparedPlan::with_native_entry(&retained);
    let old_physical=match old_prepared.foundation()?{
        crate::engine::FoundationPreparation::Supported(value) if value.entry.is_some()=>value,
        _=>return Err("incumbent native preparation is unsupported".into()),
    };
    let physical_entry=old_physical.entry.as_ref().unwrap();
    let mut cached_public_contact=None;
    if frontage_selection_enabled()&&r.accesses.iter().filter(|a|a.kind=="public"&&a.id==old.access_id).count()>1{
        // The original connector's complete native candidate base, installed
        // before path choice. The ordinary readmission repeats its own guards.
        // This scope retains no city graph and changes no query/collision caps.
        let _prefix_candidate=super::super::parent_session::candidate_land(&r.id,||{
            let mut parts=vec![map_surface(&old_prepared.plan_local,&old.transform)];
            parts.extend(old_physical.occupation_parts.iter().map(|s|map_surface(s,&old.transform)));
            parts.extend(physical_entry.retained_passages.iter().map(|s|map_surface(s,&old.transform)));
            unite(&parts)
        })?;
        // Move/cache the SECOND existing connector evaluation; do not add one.
        // No pose, segment admission, source resolution or RNG draw occurs.
        report.incumbent_connector_evaluations+=1;
        let observed=proposed_native_access_with_entry(r,&physical_entry.site_entry,
            &physical_entry.site_solids,&old.transform,&old.footprint,&external,
            Some(native_one_bend_access::OneBendContext{body_entry:&physical_entry.body_entry,body_local:&old_prepared.body_local}))?;
        aimed=retained_public_front(r,old,aimed,observed.0,&observed.1,&observed.2,observed.3)?;
        cached_public_contact=Some(observed);
    }
    report.incumbent_admissions+=1;
    report.incumbent_connector_evaluations+=1;
    let checked=visual_with_front_access_prepared(r,&old_prepared,old.transform.clone(),&external,true,false,Some(aimed),true)
        .map_err(|e|format!("incumbent revalidation refused: {e}"))?;
    if checked.footprint!=old.footprint||checked.roof_footprint!=old.roof_footprint
        ||checked.ground_z_m.to_bits()!=old.ground_z_m.to_bits()||checked.entrance!=old.entrance
        ||!same_surface(&checked.circulation,&old.circulation){
        report.errors.push(format!("Incumbent world readmission identity: body_exact={} roof_exact={} ground_bits_exact={} entry_exact={} circulation_set_equivalent={}; body_max_coordinate_ulp={:?} roof_max_coordinate_ulp={:?}; no geometry/pose normalization applied",
            checked.footprint==old.footprint,checked.roof_footprint==old.roof_footprint,checked.ground_z_m.to_bits()==old.ground_z_m.to_bits(),checked.entrance==old.entrance,
            same_surface(&checked.circulation,&old.circulation),max_coordinate_ulp(&checked.footprint,&old.footprint),max_coordinate_ulp(&checked.roof_footprint,&old.roof_footprint)));
        return Err("incumbent revalidation changed retained geometry/access; original kept".into());
    }
    let (_,_,checked_path,public_contact)=match cached_public_contact{
        Some(observed)=>observed,
        None=>{
            report.incumbent_connector_evaluations+=1;
            proposed_native_access_with_entry(r,&physical_entry.site_entry,
                &physical_entry.site_solids,&old.transform,&old.footprint,&external,
                Some(native_one_bend_access::OneBendContext{body_entry:&physical_entry.body_entry,body_local:&old_prepared.body_local}))?
        }
    };
    if !same_surface(&checked_path,&old.circulation){return Err("incumbent public connector is not the retained branch".into());}
    let old_passage=map_surface(&retained.entrance.as_ref().ok_or("old native portal missing")?.passage,&old.transform);
    let first=AssemblyBranch{id:format!("{}/circulation/0",r.id),member_key:"incumbent".into(),path:old.circulation.clone(),
        native_passage:old_passage,target:AssemblyBranchTarget::PublicAccess{access_id:aimed.id.clone()},contact:public_contact,entry_ground_z_m:old.ground_z_m};
    let old_land=land(old);
    let obstacles=unite(&[external.clone(),old_land.clone()]);
    let mut route_parts=vec![external,old.footprint.clone(),old.courtyards.clone(),old.roof_footprint.clone()];
    route_parts.extend(old.structural_features.iter().map(|f|f.surface.clone()));
    let route_occupied=unite(&route_parts);
    let body_rights=difference(&r.buildable,&r.reserves);let land_rights=difference(&r.cadastral,&r.reserves);
    let roof_rights=difference(r.roof_domain.as_ref().unwrap_or(&r.cadastral),&r.reserves);
    let eave=source_member.plan.bodies[0].parameters.overhang_m[0]+GRID_M;
    if !eave.is_finite()||eave<0.{return Err("invalid retained eave".into());}
    let mut feasible=vec![];
    for (slot,&dims) in dimension_slots.iter().enumerate(){for axis in 0..4{
        report.necessary_checks+=1;
        let transform=pose(old,b,dims,2.*eave,axis);
        let body=map_surface(&rectangle(0.,0.,dims[0],dims[1]),&transform);
        let roof=map_surface(&rectangle(-eave,-eave,dims[0]+2.*eave,dims[1]+2.*eave),&transform);
        let failure=if !contains(&body_rights,&body)||!contains(&land_rights,&body)||!contains(&roof_rights,&roof)
            ||area(&intersection(&body,&obstacles))>0.0001||area(&intersection(&roof,&obstacles))>0.0001
            ||area(&intersection(&old.roof_footprint,&body))>0.0001||area(&intersection(&occupied_roofs,&body))>0.0001||super::super::parent_session::necessary_clear(&r.id,&body,&roof).is_err(){
            Some("necessary real rights/old portal/occupation/roof guard".into())
        }else{
            report.necessary_terrain_checks+=1;
            match r.terrain.foundation_bounds(&body){
                Ok((low,high,slope)) if slope<=MAX_LEVEL_FOUNDATION_SLOPE_DEG&&high-low<=r.terrain.max_foundation_step_m
                    &&r.terrain.water_z_m.is_none_or(|w|low>=w)=>None,
                Ok((low,high,slope))=>Some(format!("necessary terrain step={} limit={} slope={} low={} water={:?}",high-low,r.terrain.max_foundation_step_m,slope,low,r.terrain.water_z_m)),
                Err(e)=>Some(format!("necessary terrain query error: {e}")),
            }
        };
        report.necessary.push(NecessaryObservation{dimension_slot:slot,axis_pose:axis,dimensions:dims,transform:transform.clone(),failure:failure.clone()});
        if failure.is_none(){feasible.push((slot,axis,dims,transform));}
    }}
    // A nominal winner is NEVER displaced. One collapsed nominal dimension
    // has used four of the existing eight checks and no new-member work.
    let mut owned_copy_slot=None;
    if feasible.is_empty()&&dimension_slots.len()==1&&report.necessary_checks==4
        &&report.new_body_rebuilds==0&&report.new_native_preparations==0&&report.new_admissions==0{
        if let Some(dims)=owned_copy_dimensions{
            let slot=dimension_slots.len();owned_copy_slot=Some(slot);
            let entry=old_physical.entry.as_ref().ok_or("owned native portal missing")?;
            for axis in 0..4{
                report.necessary_checks+=1;
                let transform=owned_replay_pose(old,dims,2.*eave,axis);
                let body=map_surface(&old_prepared.body_local,&transform);
                let mut parts=old_physical.occupation_parts.iter().map(|p|map_surface(p,&transform)).collect::<Vec<_>>();
                parts.extend(entry.retained_passages.iter().map(|p|map_surface(p,&transform)));
                let occupation=unite(&parts);
                let roof=unite(&old_prepared.roofs().iter().map(|p|map_surface(p,&transform)).collect::<Vec<_>>());
                let failure=if !contains(&body_rights,&body)||!contains(&land_rights,&occupation)||!contains(&roof_rights,&roof)
                    ||area(&intersection(&occupation,&obstacles))>0.0001||area(&intersection(&roof,&obstacles))>0.0001
                    ||area(&intersection(&old.roof_footprint,&occupation))>0.0001||area(&intersection(&occupied_roofs,&occupation))>0.0001
                    ||super::super::parent_session::necessary_clear(&r.id,&occupation,&roof).is_err(){
                    Some("owned native descriptor real rights/old portal/occupation/roof guard".into())
                }else{
                    report.necessary_terrain_checks+=1;
                    let bearing=unite(&old_physical.bearing_parts.iter().map(|p|map_surface(p,&transform)).collect::<Vec<_>>());
                    match r.terrain.foundation_bounds(&bearing){
                        Ok((low,high,slope))if slope<=MAX_LEVEL_FOUNDATION_SLOPE_DEG&&high-low<=r.terrain.max_foundation_step_m
                            &&r.terrain.water_z_m.is_none_or(|w|low>=w)=>None,
                        Ok((low,high,slope))=>Some(format!("owned native descriptor terrain step={} limit={} slope={} low={} water={:?}",high-low,r.terrain.max_foundation_step_m,slope,low,r.terrain.water_z_m)),
                        Err(error)=>Some(format!("owned native descriptor terrain query error: {error}")),
                    }
                };
                report.necessary.push(NecessaryObservation{dimension_slot:slot,axis_pose:axis,dimensions:dims,transform:transform.clone(),failure:failure.clone()});
                if failure.is_none(){feasible.push((slot,axis,dims,transform));}
            }
        }
    }
    feasible.sort_by(|a,b|{
        let score=|dims:[f64;2]|((missing-dims[0]*dims[1]).max(0.),(dims[0]*dims[1]-missing).max(0.));
        let x=score(a.2);let y=score(b.2);x.0.total_cmp(&y.0).then(x.1.total_cmp(&y.1)).then(a.0.cmp(&b.0)).then(a.1.cmp(&b.1))
    });
    let &(slot,_,dims,_)=feasible.first().ok_or("no independent source member certified by necessary checks")?;
    report.selected_dimensions=Some(dims);
    let mut poses:Vec<_>=feasible.into_iter().filter(|p|p.0==slot).collect();poses.sort_by_key(|p|p.1);
    let replay_owned=owned_copy_slot==Some(slot);
    if replay_owned{
        // Exact owned plan, parameters, native portal and config: zero body
        // resizing/construction here. Its new pose still needs native prep
        // and full ordinary admission below. No old admission token reused.
        source_member=retained.clone();
    }else{
        report.new_body_rebuilds+=1;
        source_member.plan=crate::morphology::domestic_budget_plan(&source_member.parameters,&source_member.plan,&shape,dims[0],dims[1]).map_err(str::to_owned)?;
        source_member.parameters.width_m=[dims[0];2];source_member.parameters.depth_m=[dims[1];2];
    }
    if nondim(&retained.parameters)!=nondim(&source_member.parameters)||retained.config!=source_member.config
        ||nondim(&retained.plan.bodies[0].parameters)!=nondim(&source_member.plan.bodies[0].parameters){return Err("non-dimensional source/config changed".into());}
    report.new_native_preparations+=1;
    let prepared=PreparedPlan::with_native_entry(&source_member);
    match prepared.foundation()?{
        crate::engine::FoundationPreparation::Supported(p) if p.entry.is_some()=>{},
        crate::engine::FoundationPreparation::Unsupported(reason)=>return Err(format!("native member preparation unsupported: {reason}")),
        _=>return Err("native member preparation has no structural portal".into()),
    }
    let internal=InternalAccessTarget{branch_id:&first.id,path:&first.path,occupied:&route_occupied,support_roof_world:&old.roof_footprint,
        observed:std::cell::RefCell::new(None),evaluations:std::cell::Cell::new(0)};
    let mut child=r.clone();child.id=format!("{}/native-member/1",r.id);
    super::super::parent_session::register_member(&r.id,&child.id)?;
    let mut added=None;
    for (_,axis,_,transform) in poses.into_iter().take(4){
        report.new_admissions+=1;
        *internal.observed.borrow_mut()=None;
        match visual_with_connection_prepared_reported(&child,&prepared,transform,&obstacles,true,false,None,true,None,Some(&internal)){
            Ok(member)=>{added=Some(member);break;},
            Err(e)=>report.errors.push(format!("native internal fixed pose {axis}: {e}")),
        }
    }
    report.new_connector_evaluations=internal.evaluations.get();
    let mut added=added.ok_or("all fixed native internal member poses refused; original plan retained")?;
    if replay_owned{
        let actual=added.resolved.unpack()?;
        if serde_json::to_vec(&actual).map_err(|e|e.to_string())?!=serde_json::to_vec(&retained).map_err(|e|e.to_string())?{
            return Err("re-admitted owned member changed its exact native source/plan/portal descriptor".into());
        }
        added.diagnostics.push("Owned native pavilion replay: the exact retained source/variant/seed/plan/portal was re-admitted at a new rigid pose with a separate native foundation and real internal-to-public path; nominal source sizing ranges unchanged, no body resizing or household credit.".into());
    }
    let caps=branch_caps(&first.id,&first.path);
    let cap=caps.iter().find(|c|c.id==added.access_id).ok_or("missing actual selected internal cap")?;
    let source=added.resolved.unpack()?;
    let native=source.entrance.as_ref().ok_or("new member native portal missing")?;
    let entry_point=map_surface(&native.passage,&added.transform);
    let (target_id,contact)=internal.observed.borrow().clone().ok_or("Native internal contact observation missing")?;
    if target_id!=added.access_id{return Err("Native internal target identity changed".into());}
    let second=AssemblyBranch{id:format!("{}/circulation/1",r.id),member_key:"added".into(),path:added.circulation.clone(),
        native_passage:entry_point,contact,target:AssemblyBranchTarget::MemberBranchCap{branch_id:first.id.clone(),segment:cap.segment},entry_ground_z_m:added.ground_z_m};
    if area(&intersection(&added.roof_footprint,&old_land))>0.0001||area(&intersection(&old.roof_footprint,&land(&added)))>0.0001
        ||area(&intersection(&occupied_roofs,&land(&added)))>0.0001{
        return Err("assembly directional roof occupation guard refused".into());
    }
    let members=[NativeAssemblyMember{key:"incumbent".into(),plan:NativeMemberPlan::retain(old)},NativeAssemblyMember{key:"added".into(),plan:NativeMemberPlan::retain(&added)}];
    let circulation=AssemblyCirculation{public_access:aimed.clone(),branches:[first,second],construction_status:"native_planning_ground_path_reservation".into()};
    let outcome=measure(p,&members,&circulation);
    if outcome.useful_shortfall_lower_bound_m2.is_none_or(|g|g>=missing){return Err("final measured group inventory does not reduce necessary shortfall".into());}
    let assembly=RetainedNativeAssembly{capability:ASSEMBLY_CAPABILITY.into(),id:r.id.clone(),parcel_id:r.parcel_id.clone(),programme:p.clone(),members,circulation,shared_context:vec![],outcome};
    if let Err(error)=validate_assembly(&assembly){
        return Err(error);
    }
    Ok(assembly)
}
