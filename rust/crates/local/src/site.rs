//! `/site/choose`: stateless main-town site choice (`magna_urbis_core::site`). Framed binary request and reply.
use super::{ApiResult, Reply};

pub(crate) fn handle(body: &[u8]) -> ApiResult<Reply> {
    Ok(Reply { kind: "application/octet-stream", body: magna_urbis_core::site::choose_site_framed(body)? })
}
