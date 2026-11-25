//! The completion every laid plan receives, the layout and the baseline of its
//! quarter edits alike: dry streets, informal housing, harbour furniture and
//! the closing of unused gates.
use super::Town;
use super::plan::formal;
use crate::urban::kinds::Kind;
use crate::urban::network;
use crate::urban::profile::Lap;
use crate::urban::{LayoutConfig, Layout, edits, fortification, harbour_furniture, shanty};

/// A formal plan at `config`, completed: one rung of the later ladders.
pub(super) fn lay(town: &Town<'_>, config: &LayoutConfig) -> Result<Layout, String> {
    formal(town, config).map(|(layout, baseline)| complete(town, layout, baseline, config))
}

/// Complete a formal plan made at `config`, and the baseline its quarter edits keep.
pub(super) fn complete(town: &Town<'_>, mut layout: Layout, baseline: Option<Layout>, config: &LayoutConfig) -> Layout {
    let kind = Kind::from_id(&config.settlement_form).unwrap_or(town.kind);
    let population = town.site.population;
    // A wet run on the stilt planning ground is a boardwalk, not a street to cut.
    let reclaimed = town.stilt.map(|_| town.surface);
    // Invariant (no earth street on water), on the physical surface: after the last
    // stage that adds or moves formal streets, before the shanty records their count
    // (its own ways are laid dry). Slope wards reuse streets of such a layout.
    let mut laps = Lap::new("tail");
    network::clear_water(&mut layout, population, town.physical, reclaimed, config.max_street_grade);
    laps.lap("clear_water");
    // Every deck is known: no two of them cross or overlap.
    network::uncross_decks(&mut layout, town.physical, config);
    laps.lap("uncross_decks");
    shanty::extend(town.seed, &mut layout, town.site, config, kind, town.physical, town.roads);
    laps.lap("shanty.extend");
    // Last: boats, jetties, cranes and the other harbour furniture join the finished waterfront
    // (the town's own seed, as for its quarters: the planner drew the same harbour type).
    harbour_furniture::furnish(&town.key_seed, &mut layout, population, config, town.physical);
    laps.lap("harbour.furnish");
    // Last: a gate no street uses any more closes (the curtain opens only where a street passes).
    fortification::drop_dead_gates(&mut layout);
    laps.lap("drop_dead_gates");
    // The wall and water rule on the finished town (`URBAN_PROFILE`): only a gate interrupts a
    // curtain and none stands in water. Every line should read "gaps 0 (0 m), wet curtain 0 m".
    if std::env::var("URBAN_PROFILE").is_ok() {
        for (i, found) in fortification::water_audit(&layout, town.surface).iter().enumerate() {
            eprintln!("  wall water audit: {} circuit {i}: gaps {} ({:.0} m), wet curtain {:.0} m", town.site.key, found.gaps, found.gap_m, found.wet_m);
        }
    }
    if let Some(mut baseline) = baseline {
        network::clear_water(&mut baseline, population, town.physical, reclaimed, config.max_street_grade);
        network::uncross_decks(&mut baseline, town.physical, config);
        harbour_furniture::furnish(&town.key_seed, &mut baseline, population, config, town.physical);
        fortification::drop_dead_gates(&mut baseline);
        edits::quarter_baseline::retain(&mut layout, baseline);
    }
    layout
}
