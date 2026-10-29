//! Opt-in two-phase city generation. Parent identities are never member counts.
use super::*;
use super::assembly::{AssemblyAttemptReport,AssemblyDecision,AssemblePairRequest,RetainedNativeAssembly};
use sha2::{Digest,Sha256};

pub const PARENT_BATCH_CAPABILITY:&str="houses.native-parent-batch-1";
pub const PARENT_BATCH_SCHEMA:&str="native-parent-batch-1";
pub const PARENT_BATCH_VERSION:&str="native-parent-batch-1/atomic-prefix64-context1-choice1";
pub const MAX_PARENT_BATCH:usize=64;
pub const MAX_PARENT_PARTS:usize=4096;
pub const MAX_PARENT_VERTICES:usize=262144;
pub const MAX_PARENT_INPUT_BYTES:usize=24*1024*1024;
#[derive(Clone,Serialize,Deserialize)]
#[serde(deny_unknown_fields)]
pub struct PriorOccupation {pub land_parts:Vec<Surface>,pub roof_parts:Vec<Surface>}
#[derive(Serialize,Deserialize)]
#[serde(deny_unknown_fields)]
pub struct ParentPlanBatchRequest {
    pub schema_version:String,
    pub batch:PlanBatchRequest,
    pub prior_occupation:PriorOccupation,
}
#[derive(Clone,Serialize,Deserialize)]
#[serde(tag="kind",rename_all="snake_case",deny_unknown_fields)]
pub enum NativeParentPlan {
    Single {programme:Option<crate::programme::ArchitectureProgramme>,building:PlanBuilding},
    Assembly {assembly:RetainedNativeAssembly},
}
impl NativeParentPlan {
    pub fn id(&self)->&str {match self{Self::Single{building,..}=>&building.id,Self::Assembly{assembly}=>&assembly.id}}
    pub fn physical_members(&self)->usize{match self{Self::Single{..}=>1,Self::Assembly{assembly}=>assembly.members.len()}}
    pub fn occupation_parts(&self)->(Vec<Surface>,Vec<Surface>){match self{
        Self::Single{building,..}=>(land_parts(building),vec![building.roof_footprint.clone()]),
        Self::Assembly{assembly}=>{
            let mut land=Vec::new();let mut roofs=Vec::new();
            for m in &assembly.members{
                land.extend([m.plan.footprint.clone(),m.plan.courtyards.clone()]);
                land.extend(m.plan.structural_features.iter().map(|f|f.surface.clone()));
                roofs.push(m.plan.roof_footprint.clone());
            }
            land.extend(assembly.circulation.branches.iter().flat_map(|b|[b.path.clone(),b.native_passage.clone()]));
            land.extend(assembly.shared_context.iter().map(|f|f.surface.clone()));
            (land,roofs)
        }
    }}
}
fn land_parts(b:&PlanBuilding)->Vec<Surface>{
    let mut p=vec![b.footprint.clone(),b.courtyards.clone(),b.circulation.clone()];
    p.extend(b.structural_features.iter().map(|f|f.surface.clone()));p
}
#[derive(Serialize)]
pub struct ParentRecord {pub plan:NativeParentPlan,pub archive:NativeParentArchive,pub attempt:Option<AssemblyAttemptReport>}
#[derive(Default,Serialize)]
pub struct ParentMemberCounts {pub admitted_parents:usize,pub single_parents:usize,pub assembly_parents:usize,pub physical_members:usize}
impl ParentMemberCounts {
    fn from_plans<'a>(plans:impl Iterator<Item=&'a NativeParentPlan>)->Self{
        let mut c=Self::default();for p in plans{c.admitted_parents+=1;c.physical_members+=p.physical_members();
            match p{NativeParentPlan::Single{..}=>c.single_parents+=1,NativeParentPlan::Assembly{..}=>c.assembly_parents+=1}}
        c
    }
}
#[derive(Serialize)]
pub struct ParentBatchCounts {pub requests:usize,#[serde(flatten)]pub admitted:ParentMemberCounts,pub refusals:usize,pub open_spaces:usize}
#[derive(Serialize)]
pub struct ParentPlanBatch {
    pub schema_version:String,pub generator_version:String,pub parents:Vec<ParentRecord>,
    pub refusals:Vec<PlacementRefusal>,pub open_spaces:Vec<OpenSpace>,pub materials:Vec<crate::catalogue::Material>,pub counts:ParentBatchCounts,
}

// Exact bounded authority for both world Single and group, not an admission or
// authorship token. Imports must unpack this rather than trust adjacent views.
#[derive(Clone,Serialize,Deserialize)]
#[serde(deny_unknown_fields)]
pub struct NativeParentArchive {pub format:String,pub sha256:String,pub payload:serde_json::Value}
fn digest(v:&serde_json::Value)->Result<String,String>{Ok(format!("{:x}",Sha256::digest(serde_json::to_vec(v).map_err(|e|e.to_string())?)))}
impl NativeParentArchive {
    pub fn pack(plan:&NativeParentPlan)->Result<Self,String>{
        encoded_budget(plan)?;validate_parent(plan)?;
        let mut payload=serde_json::to_value(plan).map_err(|e|e.to_string())?;
        crate::compact::encode_floats(&mut payload);
        Ok(Self{format:"native-parent-archive-1".into(),sha256:digest(&payload)?,payload})
    }
    pub fn unpack(&self)->Result<NativeParentPlan,String>{
        encoded_budget(self)?;
        if self.format!="native-parent-archive-1"||digest(&self.payload)?!=self.sha256{return Err("Invalid native parent archive version/checksum".into());}
        let mut v=self.payload.clone();crate::compact::decode_floats(&mut v)?;
        let p:NativeParentPlan=serde_json::from_value(v).map_err(|e|e.to_string())?;
        let canonical=Self::pack(&p)?;
        if canonical.payload!=self.payload{return Err("Parent archive is not canonical lossless native data".into());}Ok(p)
    }
}
fn validate_parent(p:&NativeParentPlan)->Result<(),String>{
    match p{
        NativeParentPlan::Single{programme,building}=>{
            validate_parts([&building.footprint,&building.roof_footprint,&building.courtyards,&building.circulation].into_iter()
                .chain(building.structural_features.iter().map(|f|&f.surface))
                .chain(building.volumes.iter().flat_map(|v|std::iter::once(&v.footprint).chain(v.levels.iter().map(|l|&l.footprint)))))?;
            let source=building.resolved.unpack()?;
            if source.recipe_id!=building.recipe_id||source.parameters.variant_id!=building.variant_id
                ||!plan_programme_outcome::housing_floor_outcome::retained_source_inventory_matches(building){
                return Err("Native Single parent inventory differs from exact retained source/pose".into());
            }
            if let Some(p)=programme {p.validate()?;}
            let measured=PlanProgrammeOutcome::from_programme(programme.as_ref(),building);
            if serde_json::to_vec(&Some(measured)).map_err(|e|e.to_string())?
                !=serde_json::to_vec(&building.programme_outcome).map_err(|e|e.to_string())?{
                return Err("Stale native Single parent programme outcome".into());
            }
            if let Some(entry)=&source.entrance{
                let (_,mid)=native_opening_world(entry.opening,&building.transform);
                if mid!=building.entrance{return Err("Native Single parent portal differs from retained source".into());}
            }
            if building.cartographic.validation=="plan_only" {
                let prepared=PreparedPlan::new(&source);
                let mut roof_parts=prepared.roofs().iter().map(|s|map_surface(s,&building.transform)).collect::<Vec<_>>();
                roof_parts.extend(source.plan.features.iter().filter_map(|f|f.roof.as_ref()).map(|r|map_surface(&r.domain,&building.transform)));
                if unite(&roof_parts)!=building.roof_footprint{return Err("Native Single parent roof differs from retained source".into());}
            }
            if building.id.is_empty()||building.parcel_id.is_empty()||!building.ground_z_m.is_finite()
                ||!building.transform.origin.x.is_finite()||!building.transform.origin.y.is_finite()||!building.transform.orientation_deg.is_finite(){return Err("Invalid native Single parent identity/pose".into());}
            let (land,roofs)=p.occupation_parts();validate_parts(land.iter().chain(&roofs))?;
        },
        NativeParentPlan::Assembly{assembly}=>{super::assembly::NativeAssemblyArchive::pack(assembly)?;},
    }Ok(())
}
pub(super) fn encoded_budget(v:&impl Serialize)->Result<(),String>{
    struct Count(usize);impl std::io::Write for Count{
        fn write(&mut self,b:&[u8])->std::io::Result<usize>{self.0=self.0.saturating_add(b.len());if self.0>24*1024*1024{return Err(std::io::Error::other("parent payload budget"));}Ok(b.len())}
        fn flush(&mut self)->std::io::Result<()>{Ok(())}
    }
    serde_json::to_writer(&mut Count(0),v).map_err(|e|format!("[parent_batch_budget] Complete payload exceeds24MiB or cannot be serialized: {e}"))
}
fn validate_parts<'a>(parts:impl Iterator<Item=&'a Surface>)->Result<usize,String>{
    let(mut n,mut polygons,mut vertices)=(0usize,0usize,0usize);
    for s in parts{n=n.saturating_add(1);polygons=polygons.saturating_add(s.len());
        for p in s{vertices=vertices.saturating_add(p.outer.len());for h in &p.holes{vertices=vertices.saturating_add(h.len());}}
        if n>MAX_PARENT_PARTS||polygons>MAX_PARENT_PARTS||vertices>MAX_PARENT_VERTICES{return Err("[parent_batch_budget] Complete context exceeds part/vertex budget; no truncation".into());}
    }Ok(vertices)
}
fn valid_geometry(parts:impl Iterator<Item=Surface>)->Result<(),String>{
    for s in parts{if !s.is_empty()&&(!valid_surface(&s)||!geo::algorithm::Validation::is_valid(&to_geo(&s))){return Err("Invalid native parent occupation geometry".into());}}Ok(())
}

pub fn unpack_parent(a:NativeParentArchive)->Result<NativeParentPlan,String>{a.unpack()}
#[derive(Serialize,Deserialize)]
#[serde(deny_unknown_fields)]
pub struct UnpackParentBatchRequest {pub schema_version:String,pub archives:Vec<NativeParentArchive>}
#[derive(Serialize)]
pub struct UnpackedParentBatch {pub schema_version:String,pub plans:Vec<NativeParentPlan>,pub counts:ParentMemberCounts}
pub fn unpack_parent_batch(input:UnpackParentBatchRequest)->Result<UnpackedParentBatch,String>{
    if input.schema_version!=PARENT_BATCH_SCHEMA||input.archives.len()>MAX_PARENT_BATCH{return Err("Invalid parent archive batch version/count".into());}
    encoded_budget(&input)?;
    let plans:Vec<_>=input.archives.iter().map(NativeParentArchive::unpack).collect::<Result<_,_>>()?;
    let counts=ParentMemberCounts::from_plans(plans.iter());Ok(UnpackedParentBatch{schema_version:PARENT_BATCH_SCHEMA.into(),plans,counts})
}
#[derive(Serialize,Deserialize)]
#[serde(deny_unknown_fields)]
pub struct RealizeParentRequest {pub parent:NativeParentArchive,#[serde(default)]pub interiors:bool}
#[derive(Serialize)]
#[serde(tag="kind",rename_all="snake_case")]
pub enum RealizedParent {
    Single {building_id:String,ground_z_m:f64,architecture:HouseBatch},
    Assembly {assembly:super::assembly::RealizedNativeAssembly},
}
pub fn realize_parent(input:RealizeParentRequest)->Result<RealizedParent,String>{match input.parent.unpack()?{
    NativeParentPlan::Single{building,..}=>{
        let building_id=building.id.clone();let ground_z_m=building.ground_z_m;
        let architecture=realize_plan(RealizePlanRequest{building,interiors:input.interiors})?;
        Ok(RealizedParent::Single{building_id,ground_z_m,architecture})
    },
    NativeParentPlan::Assembly{assembly}=>{
        let archive=super::assembly::NativeAssemblyArchive::pack(&assembly)?;
        Ok(RealizedParent::Assembly{assembly:super::assembly::realize_assembly(super::assembly::RealizeAssemblyRequest{assembly:archive,interiors:input.interiors})?})
    }
}}

#[path="native_parent_context.rs"]
mod context;
pub(crate) use context::{admission_guard,record_finalized};
pub(super) use context::prior_land;

#[path="native_parent_choice.rs"]
mod choice;

fn effective_request(r:&PlacementRequest,settings:Option<&PlacementBatchSettings>)->PlacementRequest{
    let mut r=r.clone();if let Some(s)=settings{
        if let Some(fit)=s.parcel_fit{r.parcel_fit=Some(fit);}if let Some(t)=s.typology{r.typology=Some(t);}
        if let Some(c)=&s.house_config{if matches!(r.function,ArchitectureFunction::Domestic|ArchitectureFunction::Mixed){r.config=Some(c.clone());}}
        if let Some(f)=s.floors{r.config.get_or_insert_with(HouseConfig::default).overrides.floors=Some(f);}
    }r
}
pub fn plan_parent_batch(input:ParentPlanBatchRequest)->Result<ParentPlanBatch,String>{plan_parent_batch_impl(input,true)}
fn plan_parent_batch_impl(input:ParentPlanBatchRequest,attempt_compounds:bool)->Result<ParentPlanBatch,String>{
    if input.schema_version!=PARENT_BATCH_SCHEMA||input.batch.schema_version!="1"{return Err("Unsupported native parent batch schema".into());}
    if input.batch.requests.len()>MAX_PARENT_BATCH{return Err("[parent_batch_budget] More than64 parents; complete batch refused".into());}
    encoded_budget(&input)?;
    let surface_vertices=validate_parts(input.prior_occupation.land_parts.iter().chain(&input.prior_occupation.roof_parts)
        .chain(input.batch.requests.iter().flat_map(|r|[&r.cadastral,&r.buildable,&r.reserves].into_iter().chain(r.roof_domain.iter()).chain(r.placement_hint.iter()).chain(r.neighbors.iter().map(|n|&n.footprint))))
        .chain(input.batch.footprints.values()))?;
    let access_vertices=input.batch.requests.iter().map(|r|r.accesses.len().saturating_mul(2)+r.party_boundaries.len().saturating_mul(2)+r.native_minimum_candidates.len().saturating_mul(2)).sum::<usize>();
    if surface_vertices.saturating_add(access_vertices)>MAX_PARENT_VERTICES{return Err("[parent_batch_budget] Access vertex budget exceeded".into());}
    valid_geometry(input.prior_occupation.land_parts.iter().chain(&input.prior_occupation.roof_parts).cloned())?;
    let requests=input.batch.requests.iter().map(|r|effective_request(r,input.batch.settings.as_ref())).collect::<Vec<_>>();
    let settings=input.batch.settings.clone();let imposed=input.batch.footprints.keys().cloned().collect::<BTreeSet<_>>();
    let mut old={
        let _scope=context::Scope::enter(&input.prior_occupation,&input.batch.requests)?;
        plan_batch(input.batch)?
    };
    let mut plans=old.buildings.drain(..).map(|building|{
        let programme=requests.iter().find(|r|r.id==building.id).and_then(|r|r.programme.clone());
        NativeParentPlan::Single{programme,building}
    }).collect::<Vec<_>>();
    let mut attempts=Vec::with_capacity(plans.len());
    for i in 0..plans.len(){
        let NativeParentPlan::Single{building,..}=&plans[i] else{unreachable!()};
        let site=requests.iter().find(|r|r.id==building.id).ok_or("Missing normalized native parent request")?;
        // Explicit models and imposed footprints keep their ordinary Single.
        let explicit=imposed.contains(&site.id)||settings.as_ref().is_some_and(|s|s.house_config.is_some()||s.floors.is_some()||s.typology.is_some());
        if !attempt_compounds||site.programme.as_ref().is_none_or(|p|p.composition!=Some(crate::programme::ProgrammeComposition::Compound)){
            attempts.push(None);continue;
        }
        if explicit {
            attempts.push(Some(AssemblyAttemptReport{reason:if imposed.contains(&site.id){
                "Imposed footprint retained whole; automatic assembly not attempted".into()
            }else{"Explicit batch model/floors/typology retained whole; automatic assembly not attempted".into()},..Default::default()}));continue;
        }
        let mut land=input.prior_occupation.land_parts.clone();let mut roofs=input.prior_occupation.roof_parts.clone();
        for(j,p)in plans.iter().enumerate(){if j!=i{let(l,r)=p.occupation_parts();land.extend(l);roofs.extend(r);}}
        let attempt=super::assembly::assemble_pair(AssemblePairRequest{site:site.clone(),incumbent:building.clone(),occupied_parts:land,occupied_roof_parts:roofs});
        match attempt{
            Ok(AssemblyDecision::Assembled{assembly,mut report,..})=>{
                let candidate=NativeParentPlan::Assembly{assembly};
                match choice::accepts(&plans[i],&candidate){
                    Ok(())=>plans[i]=candidate,
                    Err(reason)=>{report.reason=format!("Whole admitted parent retained: {reason}");report.errors.push(reason);},
                }
                attempts.push(Some(report));
            },
            Ok(AssemblyDecision::Retained{building:retained,report})=>{
                if serde_json::to_vec(&retained).map_err(|e|e.to_string())?!=serde_json::to_vec(building).map_err(|e|e.to_string())?{return Err("Assembly fallback did not preserve whole finalized Single".into());}
                attempts.push(Some(report));
            },
            Err(error)=>{attempts.push(Some(AssemblyAttemptReport{reason:format!("Complete assembly attempt refused; finalized Single retained: {error}"),errors:vec![error],..Default::default()}));},
        }
    }
    let counts=ParentBatchCounts{requests:requests.len(),admitted:ParentMemberCounts::from_plans(plans.iter()),refusals:old.refusals.len(),open_spaces:old.open_spaces.len()};
    if counts.admitted.admitted_parents+counts.refusals+counts.open_spaces!=counts.requests{return Err("Native parent/request accounting mismatch".into());}
    let parents=plans.into_iter().zip(attempts).map(|(plan,attempt)|{
        let archive=NativeParentArchive::pack(&plan)?;Ok(ParentRecord{plan,archive,attempt})
    }).collect::<Result<Vec<_>,String>>()?;
    Ok(ParentPlanBatch{schema_version:PARENT_BATCH_SCHEMA.into(),generator_version:PARENT_BATCH_VERSION.into(),parents,
        refusals:old.refusals,open_spaces:old.open_spaces,materials:old.materials,counts})
}

#[cfg(test)]
#[path="native_parent_batch_tests.rs"]
mod tests;
