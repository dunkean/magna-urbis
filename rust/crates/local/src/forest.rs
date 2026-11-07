//! `/terrain/forest`: the V2 forest control field (`magna_urbis_terrain::forest_request`).
//! Stateless; binary request and reply (u32 LE header length, JSON header, planes).

use crate::{ApiResult, Reply};

pub(crate) fn handle(body: &[u8]) -> ApiResult<Reply> {
    let body = magna_urbis_core::forest_request(body)?;
    Ok(Reply { kind: "application/octet-stream", body })
}
