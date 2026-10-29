//! Compare whole admitted parents before reserving a proposed change. This is
//! selection, never a substitute for admission in the current physical context.
use super::*;

fn programme(p:&NativeParentPlan)->Option<&crate::programme::ArchitectureProgramme>{match p{
    NativeParentPlan::Single{programme,..}=>programme.as_ref(),NativeParentPlan::Assembly{assembly}=>Some(&assembly.programme),
}}
fn inventory(p:&NativeParentPlan)->Result<(f64,f64),String>{match p{
    NativeParentPlan::Single{building,..}=>Ok((area(&building.footprint),
        plan_programme_outcome::housing_floor_outcome::gross_floor_inventory(building)?)),
    NativeParentPlan::Assembly{assembly}=>Ok((assembly.outcome.body_footprint.actual_m2,
        assembly.outcome.gross_floor_m2.ok_or("unknown whole-parent gross inventory")?)),
}}
fn exact(a:&impl Serialize,b:&impl Serialize)->Result<bool,String>{
    Ok(serde_json::to_vec(a).map_err(|e|e.to_string())?==serde_json::to_vec(b).map_err(|e|e.to_string())?)
}
fn extends(old:&NativeParentPlan,new:&NativeParentPlan)->Result<bool,String>{
    let NativeParentPlan::Assembly{assembly:new}=new else{return Ok(false)};
    match old{
        NativeParentPlan::Single{building,..}=>{
            let retained=super::super::assembly::NativeMemberPlan::retain(building);
            for(m,b)in new.members.iter().zip(&new.circulation.branches){
                if exact(&retained,&m.plan)?&&b.path==building.circulation
                    &&matches!(&b.target,super::super::assembly::AssemblyBranchTarget::PublicAccess{access_id} if access_id==&building.access_id){return Ok(true);}
            }Ok(false)
        },
        NativeParentPlan::Assembly{assembly:old}=>Ok(exact(&old.members,&new.members)?
            &&exact(&old.circulation,&new.circulation)?&&exact(&old.shared_context,&new.shared_context)?),
    }
}

// An extension preserves every admitted physical member and may explicitly
// prioritize the necessary useful bound over a mass wish. Local replacement
// must dominate on BOTH ledgers. Unknown/incomparable/tied results keep old.
pub(super) fn accepts(old:&NativeParentPlan,new:&NativeParentPlan)->Result<(),String>{
    if old.id()!=new.id(){return Err("parent identity changed".into());}
    validate_parent(old)?;validate_parent(new)?;
    let p=programme(old).ok_or("missing original programme")?;
    if serde_json::to_vec(&Some(p)).map_err(|e|e.to_string())?
        !=serde_json::to_vec(&programme(new)).map_err(|e|e.to_string())?{return Err("parent programme or need changed".into());}
    let need=p.housing_floor_need.as_ref().ok_or("unknown necessary useful bound")?.requested_m2;
    let mass=p.built_area_m2.ok_or("unknown original mass wish")?;
    let(a,g)=inventory(old)?;let(b,h)=inventory(new)?;
    if ![need,mass,a,g,b,h].iter().all(|v|v.is_finite())||mass<=0.{return Err("unmeasurable whole parent".into());}
    let debt=(need-g).max(0.);let next_debt=(need-h).max(0.);
    if h<=g||next_debt>debt{return Err("proposal does not improve whole-parent gross without increasing necessary debt".into());}
    if extends(old,new)?&&next_debt<debt{return Ok(());}
    if (b-mass).abs()>(a-mass).abs(){return Err("local replacement worsens whole-parent mass distance; admitted parent retained".into());}
    Ok(())
}
