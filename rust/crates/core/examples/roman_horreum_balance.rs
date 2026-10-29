//! Reconcile every retained full-batch outcome; never regenerate geometry.
use magna_urbis_core::urban::{Partition,programme::{BuiltScene,carry_open_deficits,reconcile_built}};
use std::path::PathBuf;
fn main()->Result<(),Box<dyn std::error::Error>>{
 let args:Vec<_>=std::env::args().collect();let city=PathBuf::from(&args[1]);let houses=PathBuf::from(&args[2]);
 // Mirror the native API's Value dispatch before typed deserialization.
 let partitions:Vec<Partition>=serde_json::from_value(serde_json::from_slice(&std::fs::read(city.join("partitions.json"))?)?)?;
 let requests:Vec<serde_json::Value>=serde_json::from_slice(&std::fs::read(city.join("requests.json"))?)?;
 let completion:serde_json::Value=serde_json::from_slice(&std::fs::read(houses.join("completion.json"))?)?;
 if completion["status"]!="complete" || completion["chunks"]!=completion["nativeAttempts"] {return Err("Requires a complete no-retry full-batch proof".into());}
 let mut scene=BuiltScene{buildings:vec![],refusals:vec![],open_spaces:vec![]};
 for ordinal in 0..completion["chunks"].as_u64().ok_or("chunks missing")? {
  let batch:BuiltScene=serde_json::from_value(serde_json::from_slice(&std::fs::read(houses.join(format!("attempt-{ordinal:02}-output.json")))?)?)?;
  scene.buildings.extend(batch.buildings);scene.refusals.extend(batch.refusals);scene.open_spaces.extend(batch.open_spaces);
 }
 let carried=carry_open_deficits(&partitions,&scene,&requests)?;
 let reconciled=reconcile_built(&partitions,&carried)?;
 let mut trace=vec![];
 for partition in &reconciled {for demand in &partition.programme.as_ref().ok_or("programme missing")?.demands {
  if demand.role=="storage.horreum" {trace.push(demand);}
 }}
 let report=serde_json::json!({"horreum":trace,"buildings":scene.buildings.len(),"refusals":scene.refusals.len(),"open":scene.open_spaces.len(),"scope":"All retained native outcomes, actual carry_open_deficits and reconcile_built. Indicative model areas, no historical capacity claim."});
 std::fs::write(&args[3],serde_json::to_vec_pretty(&report)?)?;
 println!("{report}");Ok(())
}
