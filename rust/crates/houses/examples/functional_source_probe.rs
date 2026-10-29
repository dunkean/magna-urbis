//! Resolve one explicit functional source from a captured native batch; no server.
use magna_urbis_houses::{plans::PlanBatchRequest,functional_programmes::{resolve_functional_architecture,FunctionalSite}};
fn main()->Result<(),Box<dyn std::error::Error>>{
 let args:Vec<_>=std::env::args().collect();
 if args.get(1).is_some_and(|a|a=="--retained") {
  let building:magna_urbis_houses::plans::PlanBuilding=serde_json::from_slice(&std::fs::read(&args[2])?)?;
  let exterior=magna_urbis_houses::plans::realize_plan(magna_urbis_houses::plans::RealizePlanRequest{building,interiors:false})?;
  std::fs::write(&args[3],serde_json::to_vec_pretty(&exterior)?)?;
  return Ok(());
 }
 let input:PlanBatchRequest=serde_json::from_slice(&std::fs::read(&args[1])?)?;
 let r=input.requests.iter().find(|r|r.programme.as_ref().is_some_and(|p|p.role.as_deref()==Some("storage.horreum"))).ok_or("horreum missing")?;
 let resolved=resolve_functional_architecture(r.config.clone().ok_or("config missing")?,r.programme.as_ref().unwrap(),r.function,FunctionalSite{body_span_m:[100.,100.]})?;
 std::fs::write(&args[2],serde_json::to_vec_pretty(&resolved)?)?;
 Ok(())
}
