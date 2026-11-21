//! The completion every laid plan receives, the layout and the baseline of its
//! quarter edits alike: dry streets, informal housing, harbour furniture and
//! the closing of unused gates.
use super::Town;
use super::plan::formal;
use crate::urban::kinds::Kind;
use crate::urban::network::{self, Lap};
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
    shanty::extend(town.seed, &mut layout, town.site, config, kind, town.physical, town.roads);
    laps.lap("shanty.extend");
    // Last: boats, jetties, cranes and the other harbour furniture join the finished waterfront
    // (the town's own seed, as for its quarters: the planner drew the same harbour type).
    harbour_furniture::furnish(&town.key_seed, &mut layout, population, config, town.physical);
    laps.lap("harbour.furnish");
    // Last: a gate no street uses any more closes (the curtain opens only where a street passes).
    fortification::drop_dead_gates(&mut layout);
    laps.lap("drop_dead_gates");
    if let Some(mut baseline) = baseline {
        network::clear_water(&mut baseline, population, town.physical, reclaimed, config.max_street_grade);
        harbour_furniture::furnish(&town.key_seed, &mut baseline, population, config, town.physical);
        fortification::drop_dead_gates(&mut baseline);
        edits::quarter_baseline::retain(&mut layout, baseline);
    }
    layout
}
