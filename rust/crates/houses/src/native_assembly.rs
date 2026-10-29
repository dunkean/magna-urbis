//! Explicit native group contract. No group is represented as a Single plan.
use super::*;
use crate::programme::ArchitectureProgramme;
use serde::{Deserialize, Serialize};

pub const ASSEMBLY_CAPABILITY: &str = "native-assembly-pair-1";

#[derive(Clone, Serialize, Deserialize)]
#[serde(deny_unknown_fields)]
pub struct AssemblePairRequest {
    pub site: PlacementRequest,
    pub occupied_parts: Vec<Surface>,
    pub occupied_roof_parts: Vec<Surface>,
    pub incumbent: PlanBuilding,
}

#[derive(Serialize)]
#[serde(tag = "outcome", rename_all = "snake_case")]
pub enum AssemblyDecision {
    Retained { building: PlanBuilding, report: AssemblyAttemptReport },
    Assembled { assembly: RetainedNativeAssembly, archive: NativeAssemblyArchive, report: AssemblyAttemptReport },
}

#[derive(Clone, Default, Serialize, Deserialize)]
pub struct AssemblyAttemptReport {
    pub reason: String,
    pub errors: Vec<String>,
    pub source_resolutions: usize,
    pub occupied_parts: usize,
    pub occupied_roof_parts: usize,
    pub occupation_union_ms: Option<f64>,
    pub necessary_checks: usize,
    pub necessary_terrain_checks: usize,
    pub new_body_rebuilds: usize,
    pub new_native_preparations: usize,
    pub new_admissions: usize,
    pub incumbent_preparations: usize,
    pub incumbent_admissions: usize,
    pub incumbent_connector_evaluations: usize,
    pub new_connector_evaluations: usize,
    pub necessary: Vec<NecessaryObservation>,
    pub selected_dimensions: Option<[f64; 2]>,
}
#[derive(Clone, Serialize, Deserialize)]
pub struct NecessaryObservation {
    pub dimension_slot: usize,
    pub axis_pose: usize,
    pub dimensions: [f64; 2],
    pub transform: Transform,
    pub failure: Option<String>,
}

/// Actual member geometry, never the aggregate silhouette. The assembly owns
/// external circulation and the one programme; neither is cloned here.
#[derive(Clone, Serialize, Deserialize)]
#[serde(deny_unknown_fields)]
pub struct NativeMemberPlan {
    pub id: String,
    pub parcel_id: String,
    pub function: ArchitectureFunction,
    pub culture: ArchitectureCulture,
    pub recipe_id: String,
    pub variant_id: String,
    pub transform: Transform,
    pub ground_z_m: f64,
    pub footprint: Surface,
    pub roof_footprint: Surface,
    pub courtyards: Surface,
    pub entrance: Point,
    pub volumes: Vec<ArchitectureVolume>,
    pub structural_features: Vec<Feature>,
    pub cartographic: CartographicRoof,
    pub diagnostics: Vec<String>,
    pub resolved: CompactArchitecture,
}
#[derive(Clone, Serialize, Deserialize)]
#[serde(deny_unknown_fields)]
pub struct NativeAssemblyMember { pub key: String, pub plan: NativeMemberPlan }

#[derive(Clone, Serialize, Deserialize)]
#[serde(tag = "kind", rename_all = "snake_case", deny_unknown_fields)]
pub enum AssemblyBranchTarget {
    PublicAccess { access_id: String },
    MemberBranchCap { branch_id: String, segment: [Point; 2] },
}
#[derive(Clone, Serialize, Deserialize)]
#[serde(deny_unknown_fields)]
pub struct AssemblyBranch {
    pub id: String,
    pub member_key: String,
    pub path: Surface,
    pub native_passage: Surface,
    pub contact: Point,
    pub target: AssemblyBranchTarget,
    /// Physical member foundation, not an invented flat path elevation.
    pub entry_ground_z_m: f64,
}
#[derive(Clone, Serialize, Deserialize)]
#[serde(deny_unknown_fields)]
pub struct AssemblyCirculation {
    pub public_access: ArchitectureAccess,
    pub branches: [AssemblyBranch; 2],
    pub construction_status: String,
}
#[derive(Clone, Serialize, Deserialize)]
pub struct AssemblyLevelPlane {
    pub elevation_m: f64,
    pub footprint: Surface,
    pub area_m2: f64,
}
#[derive(Clone, Serialize, Deserialize)]
pub struct AssemblyProgrammeOutcome {
    pub body_footprint: BodyFootprintOutcome,
    pub gross_floor_m2: Option<f64>,
    pub inventory_limitation: Option<String>,
    pub planes: Vec<AssemblyLevelPlane>,
    pub requested_useful_m2: Option<f64>,
    pub useful_shortfall_lower_bound_m2: Option<f64>,
    pub necessary_area_status: NecessaryHousingAreaStatus,
    pub housed_households: Option<f64>,
    pub actual_useful_m2: Option<f64>,
    pub functional_certification: String,
}
#[derive(Clone, Serialize, Deserialize)]
#[serde(deny_unknown_fields)]
pub struct RetainedNativeAssembly {
    pub capability: String,
    pub id: String,
    pub parcel_id: String,
    pub programme: ArchitectureProgramme,
    pub members: [NativeAssemblyMember; 2],
    pub circulation: AssemblyCirculation,
    pub shared_context: Vec<Feature>,
    pub outcome: AssemblyProgrammeOutcome,
}

impl NativeMemberPlan {
    pub(super) fn retain(b: &PlanBuilding) -> Self {
        Self { id:b.id.clone(), parcel_id:b.parcel_id.clone(), function:b.function,
            culture:b.culture.clone(), recipe_id:b.recipe_id.clone(), variant_id:b.variant_id.clone(),
            transform:b.transform.clone(), ground_z_m:b.ground_z_m, footprint:b.footprint.clone(),
            roof_footprint:b.roof_footprint.clone(), courtyards:b.courtyards.clone(), entrance:b.entrance,
            volumes:b.volumes.clone(), structural_features:b.structural_features.clone(),
            cartographic:b.cartographic.clone(), diagnostics:b.diagnostics.clone(), resolved:b.resolved.clone() }
    }
    fn building(&self, branch: &AssemblyBranch) -> PlanBuilding {
        PlanBuilding { id:self.id.clone(), parcel_id:self.parcel_id.clone(), function:self.function,
            culture:self.culture.clone(), recipe_id:self.recipe_id.clone(), variant_id:self.variant_id.clone(),
            transform:self.transform.clone(), ground_z_m:self.ground_z_m, footprint:self.footprint.clone(),
            roof_footprint:self.roof_footprint.clone(), courtyards:self.courtyards.clone(), entrance:self.entrance,
            volumes:self.volumes.clone(), structural_features:self.structural_features.clone(),
            cartographic:self.cartographic.clone(), diagnostics:self.diagnostics.clone(), resolved:self.resolved.clone(),
            circulation:branch.path.clone(), access_id:match &branch.target {
                AssemblyBranchTarget::PublicAccess{access_id}=>access_id.clone(),
                AssemblyBranchTarget::MemberBranchCap{branch_id,..}=>branch_id.clone(),
            }, useful_area_m2:0., domestic_units:0, programme_outcome:None,
            simplification:"architectural_plan".into() }
    }
}

fn land(b: &PlanBuilding) -> Surface {
    let mut parts=vec![b.footprint.clone(),b.courtyards.clone(),b.circulation.clone()];
    parts.extend(b.structural_features.iter().map(|f|f.surface.clone())); unite(&parts)
}
fn distance(a: Point,b: Point)->f64 { libm::hypot(a.x-b.x,a.y-b.y) }
fn same_surface(a:&Surface,b:&Surface)->bool {
    area(&difference(a,b))+area(&difference(b,a))<=0.0001
}

pub(super) struct InternalAccessTarget<'a> {
    branch_id: &'a str,
    path: &'a Surface,
    occupied: &'a Surface,
    support_roof_world: &'a Surface,
    observed: std::cell::RefCell<Option<(String,Point)>>,
    evaluations: std::cell::Cell<usize>,
}

fn branch_caps(branch_id:&str,path:&Surface)->Vec<NativeConnectionTarget> {
    // Actual boundary edges only, stable retained order; no sampled elbows,
    // replacement public access, shortened cap or fabricated surface.
    path.iter().flat_map(|p|p.outer.iter().copied().zip(p.outer.iter().copied().cycle().skip(1)).take(p.outer.len()))
        .enumerate().filter(|(_, (a,b))|distance(*a,*b)>=0.8)
        .take(64).map(|(i,(a,b))|NativeConnectionTarget{id:format!("{branch_id}/cap/{i}"),segment:[a,b],width_m:0.8}).collect()
}

fn cap_landings(contact:Point,segment:[Point;2])->Option<[Surface;2]> {
    let length=distance(segment[0],segment[1]);
    if !length.is_finite()||length<0.8{return None;}
    let axis=[(segment[1].x-segment[0].x)/length,(segment[1].y-segment[0].y)/length];
    let along=(contact.x-segment[0].x)*axis[0]+(contact.y-segment[0].y)*axis[1];
    if along<0.4||length-along<0.4||distance(contact,nearest(contact,segment[0],segment[1]))>0.001{return None;}
    let a=Point{x:contact.x-axis[0]*0.4,y:contact.y-axis[1]*0.4};
    let b=Point{x:contact.x+axis[0]*0.4,y:contact.y+axis[1]*0.4};
    let half=|sign:f64|vec![Polygon{outer:vec![a,b,
        Point{x:b.x-axis[1]*0.4*sign,y:b.y+axis[0]*0.4*sign},
        Point{x:a.x-axis[1]*0.4*sign,y:a.y+axis[0]*0.4*sign}],holes:vec![]}];
    Some([half(1.),half(-1.)])
}
fn full_width_join(path:&Surface,target:&Surface,contact:Point,segment:[Point;2])->bool {
    cap_landings(contact,segment).is_some_and(|[a,b]|
        contains(path,&a)&&contains(target,&b)||contains(path,&b)&&contains(target,&a))
}

fn assembly_resource_preflight(a:&RetainedNativeAssembly)->Result<(),String>{
    let mut parts=0usize;let mut surface_count=0usize;let mut vertices=0usize;
    for surface in a.members.iter().flat_map(|m|{
        let p=&m.plan;
        [&p.footprint,&p.roof_footprint,&p.courtyards].into_iter()
            .chain(p.structural_features.iter().map(|f|&f.surface))
            .chain(p.volumes.iter().flat_map(|v|std::iter::once(&v.footprint).chain(v.levels.iter().map(|l|&l.footprint))))
    }).chain(a.circulation.branches.iter().flat_map(|b|[&b.path,&b.native_passage]))
        .chain(a.shared_context.iter().map(|f|&f.surface)){
        surface_count=surface_count.saturating_add(1);
        parts=parts.saturating_add(surface.len());
        for p in surface{vertices=vertices.saturating_add(p.outer.len());for h in &p.holes{vertices=vertices.saturating_add(h.len());}}
        if surface_count>MAX_ASSEMBLY_PARTS||parts>MAX_ASSEMBLY_PARTS||vertices>MAX_ASSEMBLY_VERTICES{return Err("[assembly_budget] Retained group exceeds complete part/vertex budget".into());}
    }
    Ok(())
}

pub(super) fn connect_internal(r:&PlacementRequest,native:&crate::access::StructuralEntrance,
    solids:&Surface,transform:&Transform,footprint:&Surface,
    context:native_one_bend_access::OneBendContext<'_>,target:&InternalAccessTarget<'_>)
    ->Result<(Point,String,Surface,Point),String>{
    target.evaluations.set(target.evaluations.get()+1);
    let targets=branch_caps(target.branch_id,target.path);
    let result=proposed_native_access_to_targets(r,native,solids,transform,footprint,target.occupied,Some(context),&targets,Some(target.support_roof_world))?;
    let cap=targets.iter().find(|t|t.id==result.1).ok_or("Internal connection target lost")?;
    if !full_width_join(&result.2,target.path,result.3,cap.segment){
        return Err("Internal branch lacks complete native-width landings at its true target".into());
    }
    *target.observed.borrow_mut()=Some((result.1.clone(),result.3));
    Ok(result)
}

fn validate_assembly(a:&RetainedNativeAssembly)->Result<(),String> {
    if a.capability!=ASSEMBLY_CAPABILITY||a.id.is_empty()||a.parcel_id.is_empty()
        ||a.members[0].key==a.members[1].key||a.members[0].plan.id==a.members[1].plan.id
        ||a.circulation.branches[0].id==a.circulation.branches[1].id||!a.shared_context.is_empty()
        ||a.circulation.construction_status!="native_planning_ground_path_reservation" {
        return Err("Unsupported assembly capability, ownership or context".into());
    }
    if let Some(n)=&a.programme.housing_floor_need {n.validate(a.programme.households)?;}
    let access=&a.circulation.public_access;
    if access.kind!="public"||access.width_m<0.8||!access.width_m.is_finite(){return Err("Assembly has no real public access".into());}
    for (i,(member,branch)) in a.members.iter().zip(&a.circulation.branches).enumerate(){
        let p=&member.plan;
        if member.key.is_empty()||branch.member_key!=member.key||p.parcel_id!=a.parcel_id
            ||branch.entry_ground_z_m.to_bits()!=p.ground_z_m.to_bits()
            ||!p.ground_z_m.is_finite()||!p.transform.origin.x.is_finite()||!p.transform.origin.y.is_finite()
            ||!p.transform.orientation_deg.is_finite()||!branch.contact.x.is_finite()||!branch.contact.y.is_finite(){
            return Err("Invalid native assembly member/branch identity or world pose".into());
        }
        for s in [&p.footprint,&p.roof_footprint,&branch.path,&branch.native_passage]{
            if !valid_surface(s)||!geo::algorithm::Validation::is_valid(&to_geo(s)){return Err("Invalid assembly retained surface".into());}
        }
        let native=p.resolved.unpack()?;
        if native.recipe_id!=p.recipe_id||native.parameters.variant_id!=p.variant_id{return Err("Assembly member archive identity mismatch".into());}
        let entry=native.entrance.as_ref().ok_or("Assembly member lacks native portal")?;
        let (_,mid)=native_opening_world(entry.opening,&p.transform);
        let passage_identity=branch.native_passage==map_surface(&entry.passage,&p.transform);
        let passage_contained=contains(&branch.path,&branch.native_passage);
        let components=unite(&[branch.path.clone()]).len();
        if p.entrance!=mid||!passage_identity||!passage_contained||components!=1{
            return Err(format!("Assembly branch {i} does not preserve its native portal and connected passage: point_equal={} passage_equal={passage_identity} contained={passage_contained} components={components}; point_bits={:016x}/{:016x}, expected={:016x}/{:016x}; outside_passage_m2={}",
                p.entrance==mid,p.entrance.x.to_bits(),p.entrance.y.to_bits(),mid.x.to_bits(),mid.y.to_bits(),area(&difference(&branch.native_passage,&branch.path))));
        }
        let b=p.building(branch);
        if !super::plan_programme_outcome::housing_floor_outcome::retained_source_inventory_matches(&b){
            return Err("Assembly member inventory differs from the lossless retained native source".into());
        }
        if i==0 {
            if !matches!(&branch.target,AssemblyBranchTarget::PublicAccess{access_id} if access_id==&access.id)
                ||cap_landings(branch.contact,access.segment).is_none(){return Err("First branch does not reach the declared public access".into());}
        }else{
            let AssemblyBranchTarget::MemberBranchCap{branch_id,segment}=&branch.target else{return Err("Second member is not internally connected".into());};
            let first=&a.circulation.branches[0];
            let caps=branch_caps(&first.id,&first.path);
            if branch_id!=&first.id||!caps.iter().any(|c|c.segment==*segment)
                ||!full_width_join(&branch.path,&first.path,branch.contact,*segment){return Err("Invalid internal-to-public branch link".into());}
        }
    }
    let x=a.members[0].plan.building(&a.circulation.branches[0]);
    let y=a.members[1].plan.building(&a.circulation.branches[1]);
    // Branches are allowed to join one another, never to penetrate another
    // member's body/roof or its actual structural native passage.
    let solids=|b:&PlanBuilding|{let mut p=vec![b.footprint.clone(),b.courtyards.clone()];p.extend(b.structural_features.iter().map(|f|f.surface.clone()));unite(&p)};
    for (left,right) in [(&x,&y),(&y,&x)]{
        if area(&intersection(&solids(left),&solids(right)))>0.0001
            ||area(&intersection(&left.roof_footprint,&solids(right)))>0.0001
            ||area(&intersection(&left.circulation,&solids(right)))>0.0001{
            return Err("Assembly obstructs another member's body/roof/support".into());
        }
    }
    if area(&intersection(&a.circulation.branches[1].path,&a.circulation.branches[0].native_passage))>0.0001{
        return Err("Internal branch obstructs the protected incumbent native passage".into());
    }
    let measured=measure(&a.programme,&a.members,&a.circulation);
    if serde_json::to_vec(&measured).map_err(|e|e.to_string())?!=serde_json::to_vec(&a.outcome).map_err(|e|e.to_string())?{
        return Err("Stale or unmeasured assembly programme outcome".into());
    }
    Ok(())
}

fn measure(programme:&ArchitectureProgramme, members:&[NativeAssemblyMember;2], circulation:&AssemblyCirculation)->AssemblyProgrammeOutcome {
    let body=unite(&members.iter().map(|m|m.plan.footprint.clone()).collect::<Vec<_>>());
    let actual=area(&body); let target=programme.built_area_m2;
    let body_footprint=BodyFootprintOutcome {requested_m2:target,actual_m2:actual,tolerance_fraction:0.1,
        attainment:target.map_or(BodyFootprintAttainment::NotRequested,|t|if (actual-t).abs()<=t*0.1 {
            BodyFootprintAttainment::WithinTolerance }else if actual<t {BodyFootprintAttainment::Deficit}else{BodyFootprintAttainment::Excess}),
        deficit_m2:target.map(|t|(t-actual).max(0.)),excess_m2:target.map(|t|(actual-t).max(0.))};
    let mut all:BTreeMap<u64,Vec<Surface>>=BTreeMap::new(); let mut limitation=None;
    for (m,branch) in members.iter().zip(&circulation.branches) {
        let b=m.plan.building(branch);
        match super::plan_programme_outcome::housing_floor_outcome::gross_floor_inventory(&b) {
            Err(e)=>{limitation=Some(e.to_owned());break;}, Ok(_)=>{},
        }
        for volume in &b.volumes {for level in &volume.levels {
            let z=if level.z_m==0.{0.}else{level.z_m};
            all.entry(z.to_bits()).or_default().push(level.footprint.clone());
        }}
    }
    let mut planes=vec![];
    if limitation.is_none(){for (bits,parts) in all {
        let footprint=if parts.len()==1{parts[0].clone()}else{unite(&parts)};
        let a=area(&footprint);if !a.is_finite()||a<=0.{limitation=Some("Unmeasurable group level union".into());break;}
        planes.push(AssemblyLevelPlane{elevation_m:f64::from_bits(bits),footprint,area_m2:a});
    }}
    if limitation.is_some(){planes.clear();}
    let gross=limitation.is_none().then(||planes.iter().map(|p|p.area_m2).sum::<f64>());
    let need=programme.housing_floor_need.as_ref().map(|n|n.requested_m2);
    let gap=need.zip(gross).map(|(n,g)|(n-g).max(0.));
    AssemblyProgrammeOutcome {body_footprint,gross_floor_m2:gross,inventory_limitation:limitation,planes,
        requested_useful_m2:need,useful_shortfall_lower_bound_m2:gap,
        necessary_area_status:gap.map_or(NecessaryHousingAreaStatus::Unknown,|g|if g>0.{NecessaryHousingAreaStatus::InsufficientGross}else{NecessaryHousingAreaStatus::NotDisprovedByGross}),
        housed_households:None,actual_useful_m2:None,functional_certification:"unknown".into()}
}

#[path = "native_assembly_archive.rs"]
mod archive;
pub use archive::{NativeAssemblyArchive, RealizeAssemblyRequest, RealizedNativeAssembly,
    RealizedAssemblyMember, realize_assembly, unpack_assembly};

#[path = "native_assembly_builder.rs"]
mod builder;
pub use builder::{assemble_pair,MAX_ASSEMBLY_INPUT_BYTES,MAX_ASSEMBLY_PARTS,MAX_ASSEMBLY_VERTICES};

#[cfg(test)]
pub(super) fn with_street_context<R>(enabled:bool,f:impl FnOnce()->R)->R{
    let _mode=builder::StreetContextMode::new(enabled);f()
}

#[cfg(test)]
#[path = "native_assembly_tests.rs"]
mod tests;

#[path = "native_assembly_std_transport.rs"]
pub mod transport;
