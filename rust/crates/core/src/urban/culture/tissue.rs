//! Contextual tissue and architecture selection for blocks and parcels.

use super::*;

pub(in super::super) fn block_mapping(
    layout: &super::super::Layout,
    culture: &str,
    block: usize,
    function: &str,
    period: &str,
) -> Option<CultureMapping> {
    let (zone, morph) = block_morph(layout, culture, block)?;
    contextual_mapping(culture, period, zone, morph.text("plotOp"), function)
}
pub(in super::super) fn block_morph<'a>(
    layout: &'a super::super::Layout,
    culture: &str,
    block: usize,
) -> Option<(&'a str, super::super::Morph)> {
    let b = layout.blocks.get(block)?;
    let phase = b
        .phase
        .or_else(|| layout.quarters.get(b.quarter).map(|q| q.phase))
        .and_then(|i| layout.phases.get(i));
    let recipe = phase.map_or("auto", |p| p.recipe.as_str());
    let cfg = layout.config.clone().unwrap_or_default();
    let chosen = super::super::composition::zone_chosen(&cfg.phase_overrides, &b.zone);
    let zone = if cfg.zone == "auto" || chosen {
        &b.zone
    } else {
        &cfg.zone
    };
    let params = cfg
        .params
        .as_object()?
        .iter()
        .filter(|(key, _)| {
            super::super::catalogue()["fields"]["parcels"]
                .as_array()
                .is_some_and(|fields| {
                    fields
                        .iter()
                        .any(|field| field.as_str() == Some(key.as_str()))
                })
        })
        .map(|(key, value)| (key.clone(), value.clone()))
        .collect::<serde_json::Map<_, _>>();
    let params = serde_json::Value::Object(params);
    let (preset, selected) = super::super::composition::globals(chosen, &cfg.preset, &cfg.recipe);
    let morph = super::super::composition::phase_morph(
        culture,
        recipe,
        zone,
        preset,
        selected,
        cfg.density,
        &params,
        "parcels",
    )
    .ok()?;
    let morph = capacity_tissue(layout, None, b, recipe, zone, morph);
    let tissue = layout
        .structure
        .as_ref()
        .and_then(|s| s.districts.iter().find(|d| d.quarters.contains(&b.quarter)))
        .map_or("culture", |d| d.tissue.as_str());
    let mut morph = super::super::with_tissue(morph, tissue);
    if cfg.old_enclosure_citadel { morph.value["_innerWalls"] = serde_json::json!(true); }
    super::super::zone_blend::blend_block(layout, super::super::zone_blend::block(layout, block), block, zone, &mut morph, |_, p, z| {
        let other = super::super::composition::phase_morph(
            if p.culture.is_empty() { culture } else { &p.culture },
            &p.recipe, z, preset, selected, cfg.density, &params, "parcels",
        ).ok()?;
        Some(super::super::with_tissue(capacity_tissue(layout, None, b, &p.recipe, z, other), tissue))
    });
    Some((&b.zone, morph))
}
/// The adaptive-capacity tissue of a block (`footprint::capacity`): densified,
/// and the donor's lot cutting in a borrowed quarter, as the cut used it.
fn capacity_tissue(
    layout: &super::super::Layout,
    parcels: Option<&super::super::ParcelConfig>,
    b: &super::super::Block,
    recipe: &str,
    zone: &str,
    morph: super::super::Morph,
) -> super::super::Morph {
    let capacity = super::super::footprint::capacity::of(layout)
        .filter(|_| parcels.is_none_or(super::super::footprint::capacity::parcels_enabled));
    let population = layout.programme.as_ref().map_or_else(
        || {
            layout
                .structure
                .as_ref()
                .map_or(0, |s| s.metrics.planned_population.round() as u32)
        },
        |p| p.population,
    );
    let density = parcels.map_or_else(
        || layout.config.as_ref().map_or(1.0, |c| c.density),
        |c| c.density,
    );
    super::super::footprint::capacity::adapt(
        morph,
        capacity,
        Some(b.quarter),
        recipe,
        zone,
        population,
        density,
        "parcels",
    )
}
/// Resolve the actual parcel-stage inputs, never an implicit density-one default.
pub(in super::super) fn parcel_morph<'a>(
    layout: &'a super::super::Layout,
    partition: &'a super::super::Partition,
    culture: &str,
    block: usize,
) -> Option<(&'a str, super::super::Morph)> {
    tissue_of(layout, partition, culture, block, false)
}
fn tissue_of<'a>(
    layout: &'a super::super::Layout,
    partition: &'a super::super::Partition,
    culture: &str,
    block: usize,
    flip: bool,
) -> Option<(&'a str, super::super::Morph)> {
    let Some(cfg) = &partition.config else {
        return block_morph(layout, culture, block);
    };
    let b = layout.blocks.get(block)?;
    let phase = b
        .phase
        .or_else(|| layout.quarters.get(b.quarter).map(|q| q.phase))
        .and_then(|i| layout.phases.get(i));
    let chosen = layout
        .config
        .as_ref()
        .is_some_and(|c| super::super::composition::zone_chosen(&c.phase_overrides, &b.zone));
    let zone = if cfg.zone == "auto" || chosen {
        b.zone.as_str()
    } else {
        cfg.zone.as_str()
    };
    let recipe = phase.map_or("auto", |p| p.recipe.as_str());
    let (preset, selected) = super::super::composition::globals(chosen, &cfg.preset, &cfg.recipe);
    let morph = super::super::composition::phase_morph(
        culture,
        recipe,
        zone,
        preset,
        selected,
        cfg.density,
        &cfg.params,
        "parcels",
    )
    .ok()?;
    let morph = capacity_tissue(layout, Some(cfg), b, recipe, zone, morph);
    let tissue = layout
        .structure
        .as_ref()
        .and_then(|s| s.districts.iter().find(|d| d.quarters.contains(&b.quarter)))
        .map_or("culture", |d| d.tissue.as_str());
    let mut morph = super::super::with_tissue(morph, tissue);
    let other = |p: &super::super::GrowthPhase, z: &str| {
        let other = super::super::composition::phase_morph(
            if p.culture.is_empty() { culture } else { &p.culture },
            &p.recipe, z, preset, selected, cfg.density, &cfg.params, "parcels",
        ).ok()?;
        Some(super::super::with_tissue(capacity_tissue(layout, Some(cfg), b, &p.recipe, z, other), tissue))
    };
    let blend = super::super::zone_blend::block(layout, block);
    // A lot dithered to the neighbouring zone reads the neighbour's tissue,
    // blended toward this block's from the other side of the boundary.
    if flip && let Some((nb, phase, z)) = super::super::zone_blend::neighbour(layout, blend, block, zone) {
        let mut flipped = other(phase, z)?;
        super::super::zone_blend::blend(&mut flipped, z, &morph, zone, nb.weight);
        return Some((z, flipped));
    }
    super::super::zone_blend::blend_block(layout, blend, block, zone, &mut morph, |_, p, z| other(p, z));
    Some((zone, morph))
}
/// The tissue of one lot: its block's (`parcel_morph`), or the neighbouring
/// zone's for a lot dithered across a phase boundary (`zone_blend::lot_zone`).
pub(in super::super) fn lot_morph<'a>(
    layout: &'a super::super::Layout,
    partition: &'a super::super::Partition,
    culture: &str,
    parcel: &super::super::Parcel,
) -> Option<(&'a str, super::super::Morph)> {
    if super::super::zone_blend::lot_zone(layout, parcel).is_none() {
        return parcel_morph(layout, partition, culture, parcel.block);
    }
    tissue_of(layout, partition, culture, parcel.block, true)
}
pub(in super::super) fn parcel_mapping(
    layout: &super::super::Layout,
    p: &super::super::Parcel,
    culture: &str,
    function: &str,
) -> Option<CultureMapping> {
    let period = layout
        .programme
        .as_ref()
        .map_or("any", |p| p.context.period.as_str());
    if layout
        .programme
        .as_ref()
        .is_some_and(|pr| super::super::roles::is_isolated(&pr.context.intent))
    {
        return isolated_mapping(culture, period, &layout.programme.as_ref()?.context.intent);
    }
    if p.family == "reserve" {
        return block_mapping(layout, culture, p.block, function, period);
    }
    // An explicitly forced court keeps its complete native court profile.
    if matches!(p.family.as_str(), "courtyard" | "compound") {
        let mut m = mapping_for(culture, period)?;
        // Lots admitted only by the pack's compact house ask for that recipe,
        // also when the lot carries no stored witness (repaired or merged
        // lots): a main-street lot too small for the full court house gets
        // the small house instead of standing empty.
        if let Some(small) =
            super::super::parcels::compact_fallback(&m.architecture_pack, period, &m.admissibility)
        {
            let stored = |a: &UrbanAdmissibility| {
                p.envelope
                    .as_ref()
                    .is_some_and(|e| super::super::parcels::witnessed_by(e, a))
            };
            let full = &m.admissibility;
            let fits_full = stored(full)
                || super::super::parcels::parcel_envelope(
                    p,
                    full.min_frontage,
                    full.min_depth,
                    full.min_access_width,
                )
                .is_some();
            if stored(&small) || !fits_full {
                m.admissibility = small;
            }
        }
        return Some(m);
    }
    let zone = layout
        .blocks
        .get(p.block)
        .map_or("core", |b| b.zone.as_str());
    let zone = super::super::zone_blend::lot_zone(layout, p).unwrap_or(zone);
    contextual_mapping(culture, period, zone, &p.family, function)
}
pub(in super::super) fn isolated_mapping(culture: &str, period: &str, role: &str) -> Option<CultureMapping> {
    // An isolated dwelling (farm) uses the village frontage house profile.
    if super::super::roles::isolated(role).is_some_and(|r| r.function == "domestic") {
        contextual_mapping(culture, period, "village", "frontage", "domestic")
    } else {
        mapping_for(culture, period)
    }
}
