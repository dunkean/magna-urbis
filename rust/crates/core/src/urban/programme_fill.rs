//! Staged occupation of a block's fixed lots (growth engine, design 3.3). A
//! block with a fill share occupies its lots street first, up to that share of
//! its lot count; the lots past it stay open land. Above full occupation the
//! share raises storeys instead. Blocks without one (classic) are untouched.

use super::super::{Layout, Parcel};
use std::collections::BTreeMap;

/// Provenance marks of lots carved by a later subdivision of a first lot: the
/// heirs' strips of an inherited domain (`families::inherited`) and the
/// courtyard houses cut from the land behind a souk's shops (`parcels.rs`).
const SUBDIVISIONS: &[&str] = &["inherited-subdivision", "souk-courtyard-house"];

/// Lots left vacant by their block's fill share, by parcel index. All `false`
/// when no block has a fill share. A `reserved` block (an institution's own
/// land) is never thinned.
pub(super) fn vacant(layout: &Layout, parcels: &[Parcel], reserved: impl Fn(usize) -> bool) -> Vec<bool> {
    let mut out = vec![false; parcels.len()];
    if layout.blocks.iter().all(|b| b.fill.is_none()) {
        return out;
    }
    let mut lots: BTreeMap<usize, Vec<usize>> = BTreeMap::new();
    for (pi, p) in parcels.iter().enumerate() {
        let filled = layout.blocks.get(p.block).is_some_and(|b| b.fill.is_some());
        if filled && matches!(p.use_kind.as_str(), "plot" | "compound") && !reserved(p.block) {
            lots.entry(p.block).or_default().push(pi);
        }
    }
    for (block, mut members) in lots {
        let share = layout.blocks[block].fill.unwrap_or(1.0).clamp(0.0, 1.0);
        let occupied = ((share * members.len() as f64).round() as usize).min(members.len());
        members.sort_by_key(|&pi| (priority(&parcels[pi]), pi));
        for &pi in &members[occupied..] {
            out[pi] = true;
        }
    }
    out
}

/// Order in which a block's lots are occupied: lots on a street, then lots
/// entered from a passage, court or gate, then the rest; within each, the
/// cut's first lots before those a subdivision carved, main streets first.
/// Ties keep the cut's own order (the parcel index).
fn priority(p: &Parcel) -> (u8, bool, usize) {
    let tier = match p.access.as_ref().map(|a| a.kind.as_str()) {
        Some("public") => 0,
        Some("collective" | "private") => 1,
        _ => 2,
    };
    let subdivided = p.provenance.iter().any(|s| SUBDIVISIONS.contains(&s.as_str()));
    (tier, subdivided, p.rank)
}

/// Share of the way from a lot's drawn storeys to the culture's limit: the
/// tissue's own densification, or past the occupation of every lot the
/// block's fill excess (a share of 1.5 goes half way), whichever is higher.
pub(super) fn storey_raise(densify: f64, fill: Option<f64>) -> f64 {
    match fill {
        Some(share) => densify.max((share - 1.0).clamp(0.0, 1.0)),
        None => densify,
    }
}

#[cfg(test)]
#[path = "programme_fill_tests.rs"]
mod tests;
