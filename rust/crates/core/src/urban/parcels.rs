//! Street-fronting cadastral partitions, in metres. Every cut retains the
//! parent's frame and every unclaimed piece remains explicit back land.
//!
//! Town-wide preparation feeds independent block cuts and their probe memo.
//! Cutters share the same contact, clipping and lot identity primitives.

use super::{Layout, Morph, ParcelConfig, Partition};
use crate::rng::Rng;
use block_cut::cut_block;
use block_preparation::Preparation;
use wall_lots::lean_to_lots;

mod admission;
mod bisect;
mod block_cut;
mod block_preparation;
#[cfg(test)]
mod cadastral_tests;
mod cadastre;
mod camp;
mod consolidation;
mod contacts;
mod court_pairs;
mod courts;
mod cut_geometry;
#[cfg(test)]
mod cutting_tests;
mod depth;
mod families;
mod fields;
mod identity;
mod landmark;
mod lot_envelopes;
mod monuments;
mod neighbour_repair;
mod occupation;
mod organic;
mod oriented;
mod pressure;
mod qualification;
pub(super) mod ruins;
mod seams;
#[cfg(test)]
mod shared_predicate_tests;
#[cfg(test)]
mod stage_tests;
pub(super) mod standalone;
mod strip_layout;
mod strip_placement;
mod tidy;
mod wall_lots;
pub(super) use admission::{compact_fallback, witnessed_by};
pub(super) use contacts::{
    Front, FrontageIndex, access_fronts, block_contacts, block_contacts_indexed,
    continuous_frontage, network_contacts,
};
pub(super) use lot_envelopes::{
    EnvelopeMemo, contact_envelope, envelope_fronts, envelope_memo, parcel_envelope,
    parcel_envelope_with,
};
pub(super) use pressure::occupation_pressures;

/// Monument family of an architecture pack (`landmark::family`).
pub(super) fn monument_family(pack: &str) -> &'static str {
    landmark::family(pack)
}
pub(super) use occupation::{
    Kind as OccupationKind, Occupancy, empty_reason as occupation_empty_reason, kind as occupation_kind,
    preview_parts as occupation_preview, preview_parts_resolved as occupation_preview_resolved,
};
#[cfg(test)]
pub(super) use occupation::prayer_space as occupation_prayer_space;

pub(super) fn generate(
    seed: &str,
    layout: &Layout,
    cfg: &ParcelConfig,
    morph: &Morph,
) -> Result<Partition, String> {
    generate_cut(seed, layout, cfg, morph, true)
}
/// `generate` without the coverage accounts of the cut blocks (`Coverage`):
/// the same lots and the same warnings but the residual-coverage one, and
/// diagnostics without covered, residual and overlap areas. For probes that
/// read only the lots and their allocation.
pub(super) fn generate_probe(
    seed: &str,
    layout: &Layout,
    cfg: &ParcelConfig,
    morph: &Morph,
) -> Result<Partition, String> {
    generate_cut(seed, layout, cfg, morph, false)
}
fn generate_cut(
    seed: &str,
    layout: &Layout,
    cfg: &ParcelConfig,
    morph: &Morph,
    covered: bool,
) -> Result<Partition, String> {
    let mut result = Partition {
        config: Some(cfg.clone()),
        programme: None,
        key: layout.key.clone(),
        parcels: Vec::new(),
        warnings: Vec::new(),
        diagnostics: None,
        enclosure: None,
        prepared: None,
    };
    let mut diagnostics = super::PartitionDiagnostics::default();
    let root = Rng::new(seed).fork(&format!("parcels:{}", layout.key));
    let mut laps = super::profile::Lap::new("parcels.cut");
    let index = FrontageIndex::new(layout);
    laps.lap("frontage-index");
    let preparation = Preparation::new(layout, cfg, morph)?;
    laps.lap("prepare");
    // Each block forks from its geometric identity. Merge the cuts in block order.
    let blocks = super::par::map(&layout.blocks, |bi, block| {
        cut_block(seed, &preparation, &index, &root, bi, block, covered)
    });
    laps.lap("blocks");
    if std::env::var("URBAN_PROFILE").is_ok() {
        cadastre::profile_memo();
        cut_geometry::profile_half();
    }
    for cut in blocks {
        result.parcels.extend(cut.parcels);
        result.warnings.extend(cut.warnings);
        diagnostics.covered_area += cut.diagnostics.covered_area;
        diagnostics.residual_area += cut.diagnostics.residual_area;
        diagnostics.overlap_area += cut.diagnostics.overlap_area;
        diagnostics.unserved_area += cut.diagnostics.unserved_area;
    }
    laps.lap("merge");
    result.parcels.extend(lean_to_lots(layout));
    laps.lap("lean-to");
    result.diagnostics = Some(diagnostics);
    Ok(result)
}

pub(super) fn clear_probe_cache() {
    cadastre::clear_block_cache();
    camp::clear_probe_cache();
    lot_envelopes::clear_probe_cache();
    pressure::clear_probe_cache();
}
