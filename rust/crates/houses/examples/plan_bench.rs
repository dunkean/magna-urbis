//! Reproducible native plan throughput/transport benchmark, no renderer or population proxy.
use magna_urbis_houses::{
    geometry::rectangle,
    plans::{PlanBatchRequest, plan_batch},
};
use serde_json::json;
use std::{collections::BTreeMap, time::Instant};
fn main() {
    let count: usize = std::env::args()
        .nth(1)
        .unwrap_or("1000".into())
        .parse()
        .expect("building count");
    let start = Instant::now();
    let mut accepted = 0;
    let mut refused = 0;
    let mut bytes = 0;
    let mut max_bytes = 0;
    // Chunks retain no detailed geometry. Sites are disjoint, so no cross-chunk neighbour is needed.
    for offset in (0..count).step_by(64) {
        let requests=(offset..count.min(offset+64)).map(|i| {
            let x=(i%100) as f64*32.;let y=(i/100) as f64*40.;
            serde_json::from_value(json!({"id":format!("house-{i}"),"parcel_id":format!("plot-{i}"),"cadastral":rectangle(x,y,30.,38.),"buildable":rectangle(x,y,30.,38.),"reserves":[],
                "accesses":[{"id":"front","segment":[{"x":x,"y":y+38.},{"x":x+30.,"y":y+38.}],"kind":"public","width_m":2.}],"party_boundaries":[],"neighbors":[],
                "culture":{"culture":"european-organic","pack":"EUR-MED","mode":"historical_inspired","borrowing":null},"function":"domestic","seed":format!("plan-scale:{i}"),
                "terrain":{"origin":{"x":x,"y":y},"ground_z_m":10.,"gradient":[0.,0.],"water_z_m":null,"max_foundation_step_m":1.},"config":{"recipe":"EUR-MED-B02"}})).unwrap()
        }).collect();
        let batch = plan_batch(PlanBatchRequest {
            schema_version: "1".into(),
            requests,
            settings: None,
            footprints: BTreeMap::new(),
        })
        .expect("plan batch");
        accepted += batch.buildings.len();
        refused += batch.refusals.len();
        for building in &batch.buildings {
            let n = serde_json::to_vec(building).unwrap().len();
            bytes += n;
            max_bytes = max_bytes.max(n);
        }
    }
    println!(
        "{}",
        json!({"requested":count,"accepted":accepted,"refused":refused,"elapsed_ms":start.elapsed().as_secs_f64()*1000.,"serialized_building_bytes":bytes,"mean_bytes":bytes/accepted.max(1),"max_bytes":max_bytes,"roof_mesh_faces":0,"fixture":"EUR-MED-B02 / disjoint 30x38m planar sites / deterministic distinct seeds"})
    );
}
