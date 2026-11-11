//! Stateless V2 water endpoint; the same framed request serves native and WASM.
use super::{ApiResult, Reply};
pub(crate) fn handle(body: &[u8]) -> ApiResult<Reply> {
    let started = std::time::Instant::now();
    Ok(Reply {
        kind: "application/octet-stream",
        body: magna_urbis_core::vector_water::request_with_clock(body, &|| {
            started.elapsed().as_secs_f64() * 1000.0
        })?,
    })
}
