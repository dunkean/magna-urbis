//! Stateless stage: u32 LE JSON length, padded JSON, raw LE planes in both directions.
use crate::{ApiResult, Reply};
pub(crate) fn handle(body: &[u8]) -> ApiResult<Reply> {
    let len = u32::from_le_bytes(
        body.get(..4)
            .ok_or("Incomplete landuse request")?
            .try_into()
            .map_err(|_| "Incomplete landuse request")?,
    ) as usize;
    let end = 4_usize.checked_add(len).ok_or("Landuse header overflow")?;
    let header = std::str::from_utf8(body.get(4..end).ok_or("Incomplete landuse header")?)
        .map_err(|e| e.to_string())?;
    let result = magna_urbis_core::landuse::wire::execute(
        header,
        body.get(end..).ok_or("Incomplete landuse planes")?,
    )?;
    Ok(Reply {
        kind: "application/octet-stream",
        body: result,
    })
}
