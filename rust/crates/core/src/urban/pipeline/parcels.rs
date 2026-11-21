//! The parcel chain of one layout: the lots cut in its blocks, the programme
//! allocated to them, the yards consolidated, the user's lot edits applied,
//! the programme allocated again and the lots reconciled with it; then the
//! enclosures of the lots and the informal pockets of the shanty quarters.
//!
//! A layout with quarter edits keeps the lots of the unaffected blocks: its
//! baseline (the plan before the edits) is cut and allocated alongside, and the
//! lots both plans share keep the baseline's uses (`allocate_cadastre`).
//!
//! `probe_parcels` is the short chain the quarter stages read before the
//! layout is finished (`trim::unbuilt`, `kinds`).
use std::collections::BTreeSet;

use crate::urban::profile::Lap;
use crate::urban::{
    Layout, ParcelConfig, Partition, PreparedBlocks, edits, enclosure, parcels, programme, resolve, roles, shanty, warnings,
};

/// The parcel configuration of a parcel call, or its message.
pub(in crate::urban) fn validate_parcels(config: &ParcelConfig) -> Result<(), String> {
    const OPERATORS: [&str; 10] = [
        "culture",
        "strips",
        "oriented",
        "compact",
        "inherited",
        "courtyard",
        "frontage",
        "compound",
        "wholeBlock",
        "garden",
    ];
    if !OPERATORS.contains(&config.operator.as_str())
        || config
            .zone_operators
            .values()
            .any(|o| !OPERATORS.contains(&o.as_str()))
    {
        return Err("Opérateur de parcelles inconnu".into());
    }
    edits::validate_parcels(config)?;
    if !enclosure::valid(config) {
        return Err("Enceinte des parcelles invalide".into());
    }
    Ok(())
}

/// The cadastre a trim pass reads (`trim::unbuilt`), default parcel options:
/// the lots, one allocation and the yard consolidation. The parcel edits, the
/// second allocation and the final lot reconciliation of `cut_parcels` change
/// neither which blocks hold a building nor the yards they keep.
pub(in crate::urban) fn probe_parcels(seed: &str, layout: &Layout) -> Result<Partition, String> {
    let config = ParcelConfig::default();
    let formal = shanty::formal_layout(layout);
    let layout = formal.as_ref();
    let culture = if config.culture == "site" { &layout.culture } else { &config.culture };
    let morph = resolve(
        culture,
        &config.preset,
        &config.recipe,
        if config.zone == "auto" { "core" } else { &config.zone },
        config.density,
        &config.params,
        "parcels",
    )?;
    let key_seed = format!("{seed}\u{1}settlement:{}", layout.key);
    let mut laps = Lap::new("parcels.probe");
    let mut partition = parcels::generate_probe(&key_seed, layout, &config, &morph)?;
    laps.lap("generate");
    programme::allocate(layout, &mut partition);
    laps.lap("allocate");
    programme::camps::release_unbuilt(layout, &mut partition, false);
    programme::consolidate(&mut partition);
    roles::face_quays(layout, &mut partition);
    laps.lap("consolidate");
    Ok(partition)
}

/// The finished partition of one layout of a parcel call (`validate_parcels`
/// passed).
pub(in crate::urban) fn cut_parcels(seed: &str, input: &Layout, config: &ParcelConfig) -> Result<Partition, String> {
    let source_config = config;
    // Structural block edits reshape the actual blocks once, before the cut;
    // the settings are then keyed by prepared index.
    let prepared = edits::blocks::prepare(input, config);
    let config = prepared.config.as_ref();
    // Cut the formal cadastre first; informal pockets use its remaining budget.
    let full_layout = prepared.layout.as_ref();
    let formal = shanty::formal_layout(full_layout);
    let layout = formal.as_ref();
    let culture = if config.culture == "site" {
        &layout.culture
    } else {
        &config.culture
    };
    let morph = resolve(
        culture,
        &config.preset,
        &config.recipe,
        if config.zone == "auto" {
            "core"
        } else {
            &config.zone
        },
        config.density,
        &config.params,
        "parcels",
    )?;
    let key_seed = format!("{seed}\u{1}settlement:{}", layout.key);
    // One lap per call, each with its own duration (`URBAN_PROFILE`).
    let mut laps = Lap::new("parcels");
    let mut baseline = None;
    if input.structure.as_ref().is_some_and(|s| s.quarter_baseline.is_some())
        && let Some((original, original_cfg)) = edits::quarter_baseline::restore(input, source_config)
    {
        let prepared = edits::blocks::prepare(&original, &original_cfg);
        let original = prepared.layout.into_owned();
        let lots = parcels::generate(&key_seed, &original, &prepared.config, &morph)?;
        baseline = Some((original, lots));
    }
    let mut partition = parcels::generate(&key_seed, layout, config, &morph)?;
    laps.lap("generate");
    let kept = allocate_cadastre(layout, &mut partition, baseline.as_mut());
    laps.lap("allocate.1");
    programme::camps::release_unbuilt(layout, &mut partition, false);
    laps.lap("release_unbuilt.1");
    programme::consolidate_cadastre(&mut partition, &kept);
    laps.lap("consolidate");
    // Edits address the occupied properties, including their merged yards.
    edits::apply_parcel_edits(layout, &mut partition);
    laps.lap("apply_parcel_edits");
    if let Some((original_layout, original)) = &mut baseline {
        programme::camps::release_unbuilt(original_layout, original, false);
        programme::consolidate(original);
        edits::apply_parcel_edits(original_layout, original);
    }
    let kept = allocate_cadastre(layout, &mut partition, baseline.as_mut());
    laps.lap("allocate.2");
    programme::camps::release_unbuilt(layout, &mut partition, true);
    laps.lap("release_unbuilt.2");
    programme::finish_cadastre(layout, &mut partition, &kept);
    laps.lap("finish_lots");
    roles::face_quays(layout, &mut partition);
    laps.lap("face_quays");
    // A populated place never ends without a dwelling silently. A dwelling is a house lot,
    // or a household housed on reserved land: an isolated farm stands on its whole reserved
    // block (use `reserve`, role `dwelling.farm`) and is no empty place.
    let housed = partition.programme.as_ref().is_some_and(|p| p.allocations.iter().any(|a| a.households > 0.0));
    if layout.programme.as_ref().is_some_and(|p| p.population > 0) && !housed
        && !partition.parcels.iter().any(|p| matches!(p.use_kind.as_str(), "plot" | "compound")) {
        partition.warnings.push(warnings::no_housing());
    }
    partition.enclosure = Some(enclosure::resolve(culture, layout.programme.as_ref().map(|p| p.population), config));
    shanty::allocate(full_layout, &mut partition);
    laps.lap("enclosure+shanty");
    if let std::borrow::Cow::Owned(l) = &prepared.layout {
        partition.prepared = Some(PreparedBlocks {
            blocks: l.blocks.clone(),
            edits: l.config.as_ref().and_then(|c| c.block_edits.clone()),
        });
    }
    partition.warnings.extend(prepared.warnings.iter().cloned());
    Ok(partition)
}

/// The programme allocated to the lots; with a quarter-edit baseline, the
/// baseline is allocated too and the lots both plans share keep its uses.
/// Returns the ids of those kept lots.
fn allocate_cadastre(
    layout: &Layout,
    partition: &mut Partition,
    baseline: Option<&mut (Layout, Partition)>,
) -> BTreeSet<String> {
    let Some((original_layout, original)) = baseline else {
        programme::allocate(layout, partition);
        return BTreeSet::new();
    };
    let keep = edits::quarter_baseline::retained_lots(layout, &partition.parcels, original_layout, original);
    programme::allocate(original_layout, original);
    let reference = original.programme.as_ref().map(|pr| (pr, &keep));
    programme::allocate_from_reference(layout, partition, reference);
    if !keep.is_empty() {
        // The allocator itself can release unbuilt village land to gardens.
        let previous: std::collections::BTreeMap<_, _> = original.parcels.iter()
            .map(|p| (p.id.as_str(), (&p.use_kind, &p.reason))).collect();
        for p in &mut partition.parcels {
            if keep.contains(&p.id) && let Some(&(use_kind, reason)) = previous.get(p.id.as_str()) {
                p.use_kind.clone_from(use_kind);
                p.reason.clone_from(reason);
            }
        }
    }
    keep
}
