//! Native city run: exact 2D prefix, one durable-ACK-gated pending batch.
//! This module is opt-in; stateless parent and historical Single APIs survive.
use super::*;
use super::parent_batch::{ParentPlanBatch,ParentPlanBatchRequest,PriorOccupation};
#[cfg(test)]
use super::parent_batch::NativeParentPlan;
use serde::{Serialize,Deserialize};
use std::sync::Arc;

pub const PARENT_SESSION_CAPABILITY:&str="houses.native-parent-session-1";
pub const PARENT_SESSION_SCHEMA:&str="native-parent-session-1";
pub const PARENT_SESSION_GENERATOR:&str="native-parent-session-1/exact-leaf-prefix64";
pub const PARENT_SESSION_PARTITION:&str="prefix64-input24MiB-std-v1";
#[derive(Clone,Debug,Serialize,Deserialize,PartialEq,Eq)]
#[serde(deny_unknown_fields)]
pub struct ParentSessionSource {pub fingerprint:String,pub revision:String,pub coordinate_space:String}
#[derive(Clone,Serialize,Deserialize)]
#[serde(deny_unknown_fields)]
pub struct BeginParentSessionRequest {
    pub schema_version:String,pub run_id:String,pub source:ParentSessionSource,
    pub total_requests:usize,pub settings:Option<PlacementBatchSettings>,
}
#[derive(Clone,Serialize)]
pub struct ParentSessionLimits {
    pub max_parents_per_batch:usize,pub max_input_bytes:usize,pub max_raw_bytes:usize,
    pub max_std_rewritten_bytes:usize,pub max_std_float_slots:usize,pub max_output_bytes:usize,
    pub max_hit_parts:usize,pub max_hit_vertices:usize,pub max_runs:usize,pub max_total_requests:usize,
    pub max_retained_vertices:usize,pub max_index_references:usize,pub max_retained_index_bytes:usize,
    pub max_identity_bytes:usize,pub ack_history_entries:usize,pub idle_timeout_ms:u64,
}
#[derive(Serialize)]
pub struct BeginParentSessionReply {
    pub schema_version:String,pub session_id:String,pub source:ParentSessionSource,
    pub generator_version:String,pub batch_schema_version:String,pub partition:String,
    pub offset:usize,pub total_requests:usize,pub state:String,pub limits:ParentSessionLimits,
}
#[derive(Clone,Serialize,Deserialize)]
#[serde(deny_unknown_fields)]
pub struct PlanParentSessionRequest {
    pub schema_version:String,pub session_id:String,pub source_fingerprint:String,pub revision:String,
    pub expected_offset:usize,pub key:String,pub requests:Vec<PlacementRequest>,
    #[serde(default)]pub footprints:BTreeMap<String,Surface>,
}
#[derive(Clone,Debug,Serialize,Deserialize,PartialEq,Eq)]
#[serde(deny_unknown_fields)]
pub struct ParentSessionReceipt {
    pub session_id:String,pub source_fingerprint:String,pub revision:String,pub key:String,
    pub offset:usize,pub completed:usize,pub total:usize,pub request_sha256:String,pub batch_sha256:String,
}
#[derive(Serialize,Deserialize)]
#[serde(deny_unknown_fields)]
pub struct AckParentSessionRequest {pub schema_version:String,pub receipt:ParentSessionReceipt}
#[derive(Clone,Default,Debug,Serialize)]
pub struct ParentPrefixCounts {
    pub parents:usize,pub members:usize,pub leaves:usize,pub vertices:usize,
    pub index_references:usize,pub retained_index_bytes:usize,
}
#[derive(Serialize)]
pub struct AckParentSessionReply {
    pub session_id:String,pub source_fingerprint:String,pub revision:String,
    pub completed:usize,pub total:usize,pub state:String,pub prefix:ParentPrefixCounts,
}
#[derive(Clone,Serialize,Deserialize)]
#[serde(deny_unknown_fields)]
pub struct CloseParentSessionRequest {
    pub schema_version:String,pub session_id:String,pub source_fingerprint:String,pub revision:String,
}
#[derive(Serialize)]
pub struct CloseParentSessionReply {pub session_id:String,pub state:String}
#[derive(Clone,Default,Debug,Serialize)]
pub struct ParentIndexQueryReport {
    pub queries:usize,pub land_queries:usize,pub roof_queries:usize,pub leaf_hits:usize,pub union_calls:usize,
    pub max_query_parts:usize,pub max_query_vertices:usize,
}
// Plan raw success body is {ok:true,data:{receipt,batch_json,context_report}}.
// The native serialized bytes are cached; no Value/JS reserialization on retry.

#[path="native_parent_leaf_index.rs"]
mod leaf_index;
#[path="native_parent_prefix_scope.rs"]
mod prefix_scope;
#[path="native_parent_session_registry.rs"]
mod registry;
pub use registry::{ParentSessionRuntime,ParentSessionOperation};
pub(crate) use prefix_scope::{guard_building,land_clear,necessary_clear,register_member,candidate_land};

#[cfg(test)]
#[path="native_parent_session_tests.rs"]
mod tests;

#[cfg(not(target_arch="wasm32"))]
pub fn host_clock_ms()->u64{
    static START:std::sync::OnceLock<std::time::Instant>=std::sync::OnceLock::new();
    START.get_or_init(std::time::Instant::now).elapsed().as_millis().min(u64::MAX as u128) as u64
}
#[cfg(not(target_arch="wasm32"))]
pub fn host_runtime()->&'static ParentSessionRuntime{
    use std::hash::{BuildHasher,Hasher};
    static RUNTIME:std::sync::OnceLock<ParentSessionRuntime>=std::sync::OnceLock::new();
    RUNTIME.get_or_init(||{
        // Administrative engine incarnation only: no architecture RNG/source draw.
        let mut nonce=std::collections::hash_map::RandomState::new().build_hasher();
        nonce.write_u32(std::process::id());
        let now=std::time::SystemTime::now().duration_since(std::time::UNIX_EPOCH).unwrap_or_default().as_nanos();
        nonce.write(&now.to_le_bytes());
        ParentSessionRuntime::new(format!("native-{:032x}-{:016x}",now,nonce.finish())).expect("bounded native administrative nonce")
    })
}
