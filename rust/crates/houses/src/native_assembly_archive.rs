//! Native authority for saved groups. Decimal transport views are not archives.
use super::*;
use sha2::{Digest,Sha256};

const FORMAT:&str="native-assembly-archive-1";
#[derive(Clone, Serialize, Deserialize)]
#[serde(deny_unknown_fields)]
pub struct NativeAssemblyArchive {
    pub format:String,
    pub sha256:String,
    pub payload:serde_json::Value,
}
fn digest(value:&serde_json::Value)->Result<String,String>{
    Ok(format!("{:x}",Sha256::digest(serde_json::to_vec(value).map_err(|e|e.to_string())?)))
}
impl NativeAssemblyArchive {
    pub fn pack(value:&RetainedNativeAssembly)->Result<Self,String>{
        super::builder::encoded_input_budget(value)?;
        super::assembly_resource_preflight(value)?;
        validate_assembly(value)?;
        let mut payload=serde_json::to_value(value).map_err(|e|e.to_string())?;
        crate::compact::encode_floats(&mut payload);
        Ok(Self{format:FORMAT.into(),sha256:digest(&payload)?,payload})
    }
    pub fn unpack(&self)->Result<RetainedNativeAssembly,String>{
        super::builder::encoded_input_budget(self)?;
        if self.format!=FORMAT||self.sha256!=digest(&self.payload)?{
            return Err("Invalid native assembly archive version or payload checksum".into());
        }
        // Require the lossless spelling for EVERY floating field. Accepting a
        // decimal transport view here could silently round a world-space bit.
        let mut payload=self.payload.clone();
        crate::compact::decode_floats(&mut payload)?;
        let value:RetainedNativeAssembly=serde_json::from_value(payload).map_err(|e|e.to_string())?;
        super::assembly_resource_preflight(&value)?;
        validate_assembly(&value)?;
        let again=Self::pack(&value)?;
        if again.payload!=self.payload{return Err("Assembly archive is not canonical lossless native data".into());}
        Ok(value)
    }
}

#[derive(Deserialize)]
#[serde(deny_unknown_fields)]
pub struct RealizeAssemblyRequest {pub assembly:NativeAssemblyArchive,#[serde(default)]pub interiors:bool}

#[derive(Serialize)]
pub struct RealizedAssemblyMember {
    pub key:String,
    pub member_id:String,
    pub ground_z_m:f64,
    pub architecture:HouseBatch,
}
#[derive(Serialize)]
pub struct RealizedNativeAssembly {
    pub capability:String,
    pub id:String,
    pub parcel_id:String,
    pub programme:ArchitectureProgramme,
    pub outcome:AssemblyProgrammeOutcome,
    pub members:Vec<RealizedAssemblyMember>,
    pub circulation:AssemblyCirculation,
    pub shared_context:Vec<Feature>,
}

pub fn unpack_assembly(input:NativeAssemblyArchive)->Result<RetainedNativeAssembly,String>{input.unpack()}

pub fn realize_assembly(input:RealizeAssemblyRequest)->Result<RealizedNativeAssembly,String>{
    let a=input.assembly.unpack()?;
    let mut members=Vec::with_capacity(2);
    for (member,branch) in a.members.iter().zip(&a.circulation.branches){
        // Existing retained native constructor, not resolve/generate_batch.
        // All members are completed before an atomic response is published.
        let architecture=super::super::realize_plan(RealizePlanRequest {
            building:member.plan.building(branch),interiors:input.interiors,
        }).map_err(|e|format!("Native assembly member {} realization refused: {e}",member.key))?;
        members.push(RealizedAssemblyMember{key:member.key.clone(),member_id:member.plan.id.clone(),
            ground_z_m:member.plan.ground_z_m,architecture});
    }
    Ok(RealizedNativeAssembly{capability:ASSEMBLY_CAPABILITY.into(),id:a.id,parcel_id:a.parcel_id,
        programme:a.programme,outcome:a.outcome,members,circulation:a.circulation,shared_context:a.shared_context})
}
