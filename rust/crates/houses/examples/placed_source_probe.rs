//! Fixed-request source diagnostic; no city or server.
use magna_urbis_houses::plans::{PlanBatchRequest,plan_batch};
fn main()->Result<(),Box<dyn std::error::Error>> {
    let r:magna_urbis_houses::placement::PlacementRequest=serde_json::from_str(include_str!("../tests/fixtures/placed-budget-a702.json"))?;
    let out=plan_batch(PlanBatchRequest{schema_version:"1".into(),requests:vec![r],settings:None,footprints:Default::default()})?;
    for b in out.buildings {println!("source={} area={}",b.recipe_id,magna_urbis_houses::geometry::area(&b.footprint));for d in b.diagnostics.iter().filter(|d|d.starts_with("Placed source")){println!("{d}");}}
    Ok(())
}
