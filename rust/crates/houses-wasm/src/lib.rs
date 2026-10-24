//! Coarse JSON boundary; all architectural decisions belong to the native crate.
use magna_urbis_houses::{catalogue, model::HouseConfig};
use serde::Serialize;
use wasm_bindgen::prelude::*;

const MAX_JSON_BYTES: usize = 64 * 1024 * 1024;

#[derive(Serialize)]
struct ApiError<'a> {
    code: &'a str,
    field: Option<&'a str>,
    message: &'a str,
}

#[derive(Serialize)]
struct Success<T> {
    ok: bool,
    data: T,
}

#[derive(Serialize)]
struct CatalogueBundle<'a> {
    catalogue: &'a catalogue::Catalogue,
    inventory: &'a catalogue::SourceInventory,
}

fn failure(code: &str, field: Option<&str>, message: &str) -> String {
    // These fields cannot fail JSON serialization; no geometry is included.
    serde_json::json!({"ok": false, "error": ApiError { code, field, message }}).to_string()
}

fn success<T: Serialize>(data: T) -> String {
    match serde_json::to_string(&Success { ok: true, data }) {
        Ok(json) if json.len() <= MAX_JSON_BYTES => json,
        Ok(_) => failure(
            "output_budget",
            None,
            "La rÃƒÂ©ponse dÃƒÂ©passe le plafond de 64 Mio.",
        ),
        Err(error) => failure("serialization_failed", None, &error.to_string()),
    }
}

fn config(input: &str) -> Result<HouseConfig, String> {
    if input.len() > 32 * 1024 {
        return Err(failure(
            "input_budget",
            None,
            "Configuration JSON trop volumineuse.",
        ));
    }
    serde_json::from_str(input).map_err(|error| failure("invalid_json", None, &error.to_string()))
}

#[wasm_bindgen]
pub fn catalogue_json() -> String {
    match (catalogue::catalogue(), catalogue::source_inventory()) {
        (Ok(catalogue), Ok(inventory)) => success(CatalogueBundle {
            catalogue,
            inventory,
        }),
        (Err(error), _) | (_, Err(error)) => failure("catalogue_failed", None, &error),
    }
}

#[wasm_bindgen]
pub fn preflight_json(input: &str) -> String {
    let config = match config(input) {
        Ok(config) => config,
        Err(error) => return error,
    };
    match magna_urbis_houses::preflight(config) {
        Ok(preflight) => success(preflight),
        Err(error) => failure("invalid_config", Some("config"), &error),
    }
}

#[wasm_bindgen]
pub fn generate_houses_json(input: &str) -> String {
    let config = match config(input) {
        Ok(config) => config,
        Err(error) => return error,
    };
    if let Err(error) = magna_urbis_houses::preflight(config.clone()) {
        return failure("invalid_config", Some("config"), &error);
    }
    match magna_urbis_houses::generate_batch(config) {
        Ok(batch) => success(batch),
        Err(error) => failure("generation_failed", None, &error),
    }
}

#[wasm_bindgen]
pub fn architecture_profiles_json() -> String {
    match magna_urbis_houses::placement::admissibility_profiles() {
        Ok(profiles) => success(profiles),
        Err(error) => failure("architecture_profiles", None, &error),
    }
}

#[wasm_bindgen]
pub fn architecture_capabilities_json() -> String {
    success(&[
        "houses.placement",
        "houses.profiles",
        "houses.enrich",
        "houses.config-template",
        "houses.workshop-template",
        "houses.parcel-fit",
        "houses.compact-plans",
        "houses.style-index",
        "houses.native-minimum-candidates-v1",
        "houses.functional-choices-v1",
        "houses.native-assembly-pair-1",
        "houses.native-assembly-std-json-v1",
        "houses.native-parent-batch-1",
        "houses.native-parent-session-1",
    ])
}

#[wasm_bindgen]
pub fn place_buildings_json(input: &str) -> String {
    if input.len() > 32 * 1024 * 1024 {
        return failure("input_budget", None, "Placement input exceeds 32 MiB.");
    }
    let request = match serde_json::from_str(input) {
        Ok(request) => request,
        Err(error) => return failure("invalid_json", None, &error.to_string()),
    };
    match magna_urbis_houses::placement::place_batch(request) {
        Ok(batch) => success(batch),
        Err(error) => failure("placement_failed", None, &error),
    }
}

#[wasm_bindgen]
pub fn enrich_placement_json(input: &str) -> String {
    if input.len() > 32 * 1024 * 1024 {
        return failure(
            "input_budget",
            None,
            "Retained architecture exceeds 32 MiB.",
        );
    }
    let building = match serde_json::from_str(input) {
        Ok(building) => building,
        Err(error) => return failure("invalid_json", None, &error.to_string()),
    };
    match magna_urbis_houses::placement::enrich_placement(building) {
        Ok(batch) => success(batch),
        Err(error) => failure("enrichment_refused", None, &error),
    }
}

#[wasm_bindgen]
pub fn architecture_style_index_json() -> String {
    match magna_urbis_houses::style_index::style_index() {
        Ok(index) => success(index),
        Err(error) => failure("style_index", None, &error),
    }
}

#[wasm_bindgen]
pub fn plan_buildings_json(input: &str) -> String {
    if input.len() > 32 * 1024 * 1024 { return failure("input_budget", None, "Plan input exceeds 32 MiB."); }
    let request = match serde_json::from_str(input) {
        Ok(request) => request, Err(error) => return failure("invalid_json", None, &error.to_string()),
    };
    match magna_urbis_houses::plans::plan_batch(request) {
        Ok(batch) => success(batch), Err(error) => failure("plan_generation", None, &error),
    }
}

#[wasm_bindgen]
pub fn realize_plan_json(input: &str) -> String {
    if input.len() > 32 * 1024 * 1024 { return failure("input_budget", None, "Retained plan exceeds 32 MiB."); }
    let request = match serde_json::from_str(input) {
        Ok(request) => request, Err(error) => return failure("invalid_json", None, &error.to_string()),
    };
    match magna_urbis_houses::plans::realize_plan(request) {
        Ok(batch) => success(batch), Err(error) => failure("realization_refused", None, &error),
    }
}


#[cfg(target_arch="wasm32")]
#[wasm_bindgen]
extern "C" {
    #[wasm_bindgen(js_namespace=crypto,js_name=randomUUID,catch)]
    fn parent_session_admin_nonce()->Result<String,JsValue>;
    #[wasm_bindgen(js_namespace=performance,js_name=now)]
    fn parent_session_monotonic_ms()->f64;
}
fn parent_session_runtime()->Result<&'static magna_urbis_houses::plans::parent_session::ParentSessionRuntime,String>{
    #[cfg(not(target_arch="wasm32"))]
    {Ok(magna_urbis_houses::plans::parent_session::host_runtime())}
    #[cfg(target_arch="wasm32")]
    {
        static RUNTIME:std::sync::OnceLock<Result<magna_urbis_houses::plans::parent_session::ParentSessionRuntime,String>>=std::sync::OnceLock::new();
        RUNTIME.get_or_init(||{
            let nonce=parent_session_admin_nonce().map_err(|_|"A fresh crypto engine incarnation is required for native sessions".to_string())?;
            magna_urbis_houses::plans::parent_session::ParentSessionRuntime::new(format!("wasm-{nonce}"))
        }).as_ref().map_err(Clone::clone)
    }
}
fn parent_session_json(op:magna_urbis_houses::plans::parent_session::ParentSessionOperation,input:&str)->String{
    if input.len()>32*1024*1024{return failure("input_budget",None,"Native session input exceeds32MiB");}
    let runtime=match parent_session_runtime(){Ok(r)=>r,Err(e)=>return failure("parent_session_unavailable",None,&e)};
    #[cfg(not(target_arch="wasm32"))]
    let now=magna_urbis_houses::plans::parent_session::host_clock_ms();
    #[cfg(target_arch="wasm32")]
    let now={let v=parent_session_monotonic_ms();if !v.is_finite()||v<0.{return failure("parent_session_clock",None,"Monotonic session clock unavailable");}v as u64};
    let raw=runtime.json(op,input.as_bytes(),now);
    // UTF8 was produced by native serde; no Value decode/reserialization.
    String::from_utf8((*raw).clone()).expect("native JSON UTF8")
}

#[wasm_bindgen]
pub fn begin_parent_session_json(input:&str)->String{parent_session_json(magna_urbis_houses::plans::parent_session::ParentSessionOperation::Begin,input)}

#[wasm_bindgen]
pub fn plan_parent_session_json(input:&str)->String{parent_session_json(magna_urbis_houses::plans::parent_session::ParentSessionOperation::Plan,input)}

#[wasm_bindgen]
pub fn ack_parent_session_json(input:&str)->String{parent_session_json(magna_urbis_houses::plans::parent_session::ParentSessionOperation::Ack,input)}

#[wasm_bindgen]
pub fn abort_parent_session_json(input:&str)->String{parent_session_json(magna_urbis_houses::plans::parent_session::ParentSessionOperation::Abort,input)}

#[wasm_bindgen]
pub fn release_parent_session_json(input:&str)->String{parent_session_json(magna_urbis_houses::plans::parent_session::ParentSessionOperation::Release,input)}

#[wasm_bindgen]
pub fn plan_parent_batch_json(input:&str)->String {
    if input.len()>32*1024*1024{return failure("input_budget",None,"Native parent input exceeds32MiB");}
    let request=match magna_urbis_houses::plans::assembly::transport::parse_parent_batch_request(input.as_bytes()){Ok(v)=>v,Err(e)=>return failure("invalid_json",None,&e)};
    match magna_urbis_houses::plans::parent_batch::plan_parent_batch(request){Ok(v)=>success(v),Err(e)=>failure("native_parent_refused",None,&e)}
}

#[wasm_bindgen]
pub fn unpack_parent_json(input:&str)->String {
    if input.len()>32*1024*1024{return failure("input_budget",None,"Native parent input exceeds32MiB");}
    let request=match magna_urbis_houses::plans::assembly::transport::parse_parent_archive(input.as_bytes()){Ok(v)=>v,Err(e)=>return failure("invalid_json",None,&e)};
    match magna_urbis_houses::plans::parent_batch::unpack_parent(request){Ok(v)=>success(v),Err(e)=>failure("native_parent_refused",None,&e)}
}

#[wasm_bindgen]
pub fn realize_parent_json(input:&str)->String {
    if input.len()>32*1024*1024{return failure("input_budget",None,"Native parent input exceeds32MiB");}
    let request=match magna_urbis_houses::plans::assembly::transport::parse_parent_realize_request(input.as_bytes()){Ok(v)=>v,Err(e)=>return failure("invalid_json",None,&e)};
    match magna_urbis_houses::plans::parent_batch::realize_parent(request){Ok(v)=>success(v),Err(e)=>failure("native_parent_refused",None,&e)}
}

#[wasm_bindgen]
pub fn unpack_parent_batch_json(input:&str)->String {
    if input.len()>32*1024*1024{return failure("input_budget",None,"Native parent input exceeds32MiB");}
    let request=match magna_urbis_houses::plans::assembly::transport::parse_parent_unpack_batch_request(input.as_bytes()){Ok(v)=>v,Err(e)=>return failure("invalid_json",None,&e)};
    match magna_urbis_houses::plans::parent_batch::unpack_parent_batch(request){Ok(v)=>success(v),Err(e)=>failure("native_parent_refused",None,&e)}
}

#[wasm_bindgen]
pub fn native_assembly_capability_json()->String {
    success(magna_urbis_houses::plans::assembly::ASSEMBLY_CAPABILITY)
}
#[wasm_bindgen]
pub fn assemble_pair_json(input:&str)->String {
    if input.len()>32*1024*1024{return failure("input_budget",None,"Native assembly input exceeds 32 MiB");}
    let request=match magna_urbis_houses::plans::assembly::transport::parse_pair_request(input.as_bytes()){Ok(v)=>v,Err(e)=>return failure("invalid_json",None,&e.to_string())};
    match magna_urbis_houses::plans::assembly::assemble_pair(request){Ok(v)=>success(v),Err(e)=>failure("assembly_refused",None,&e)}
}
#[wasm_bindgen]
pub fn unpack_assembly_json(input:&str)->String {
    if input.len()>32*1024*1024{return failure("input_budget",None,"Native assembly archive exceeds 32 MiB");}
    let request=match magna_urbis_houses::plans::assembly::transport::parse_archive(input.as_bytes()){Ok(v)=>v,Err(e)=>return failure("invalid_json",None,&e.to_string())};
    match magna_urbis_houses::plans::assembly::unpack_assembly(request){Ok(v)=>success(v),Err(e)=>failure("assembly_archive_refused",None,&e)}
}
#[wasm_bindgen]
pub fn realize_assembly_json(input:&str)->String {
    if input.len()>32*1024*1024{return failure("input_budget",None,"Native assembly archive exceeds 32 MiB");}
    let request=match magna_urbis_houses::plans::assembly::transport::parse_realize_request(input.as_bytes()){Ok(v)=>v,Err(e)=>return failure("invalid_json",None,&e.to_string())};
    match magna_urbis_houses::plans::assembly::realize_assembly(request){Ok(v)=>success(v),Err(e)=>failure("assembly_realization_refused",None,&e)}
}

#[cfg(test)]
mod native_assembly_boundary_tests {
    use super::*;
    #[test]
    fn native_assembly_wasm_capability_and_archive_gate_are_explicit(){
        let capability:serde_json::Value=serde_json::from_str(&native_assembly_capability_json()).unwrap();
        assert_eq!(capability["data"],"native-assembly-pair-1");
        let all:serde_json::Value=serde_json::from_str(&architecture_capabilities_json()).unwrap();
        assert!(all["data"].as_array().unwrap().iter().any(|v|v.as_str()==Some("houses.native-assembly-pair-1")));
        assert!(all["data"].as_array().unwrap().iter().any(|v|v.as_str()==Some("houses.native-assembly-std-json-v1")));
        let bad=unpack_assembly_json(r#"{"format":"old-single","sha256":"no","payload":null}"#);
        let result:serde_json::Value=serde_json::from_str(&bad).unwrap();
        assert_eq!(result["ok"],false);assert!(result["data"].is_null());
    }
    #[test]
    fn native_assembly_wasm_public_std_positive_is_standalone(){
        // Actual exported wrapper body on the native test target. Guest WASM
        // execution is separate root evidence, not inferred from this test.
        let capabilities:serde_json::Value=serde_json::from_str(&architecture_capabilities_json()).unwrap();
        for cap in ["houses.native-assembly-pair-1","houses.native-assembly-std-json-v1"]{
            assert!(capabilities["data"].as_array().unwrap().iter().any(|v|v.as_str()==Some(cap)));
        }
        let result:serde_json::Value=serde_json::from_str(&assemble_pair_json(include_str!("../../houses/tests/fixtures/native-assembly-public-input.json"))).unwrap();
        assert_eq!(result["ok"],true);assert_eq!(result["data"]["outcome"],"assembled");
        let archive=result["data"]["archive"].clone();
        let expected:serde_json::Value=serde_json::from_str(include_str!("../../houses/tests/fixtures/native-assembly-public-archive.json")).unwrap();
        assert_eq!(archive,expected);
        let unpack:serde_json::Value=serde_json::from_str(&unpack_assembly_json(&serde_json::to_string(&archive).unwrap())).unwrap();
        assert_eq!(unpack["ok"],true);assert_eq!(unpack["data"]["members"].as_array().unwrap().len(),2);
        let detail=realize_assembly_json(&serde_json::json!({"assembly":archive,"interiors":true}).to_string());
        let detail:serde_json::Value=serde_json::from_str(&detail).unwrap();assert_eq!(detail["ok"],true,"{detail}");
        assert_eq!(detail["data"]["members"].as_array().unwrap().len(),2);
        assert!(detail["data"]["outcome"]["housed_households"].is_null());
        assert!(detail["data"]["outcome"]["actual_useful_m2"].is_null());
        for member in detail["data"]["members"].as_array().unwrap(){
            let units=member["architecture"]["units"].as_array().unwrap();assert_eq!(units.len(),1);
            assert!(!units[0]["access"]["portals"].as_array().unwrap().is_empty());
        }
    }

}
