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
    // Last: the gates follow the final network once more (the late stages moved streets off the water,
    // laid decks and informal housing): the streets obey the works, a bridge head opens its gate, a gate
    // whose street cannot cross its ditch closes; then a gate no street uses any more closes.
    fortification::sync_gates(&mut layout, town.surface);
    fortification::drop_dead_gates(&mut layout);
    laps.lap("drop_dead_gates");
    // The street ends at the walls on the final network: no stub beside a gate, no road in a moat.
    fortification::trace_gates("drop_dead_gates", &layout);
    fortification::tidy_wall_ends(&mut layout, town.surface);
    laps.lap("tidy_wall_ends");
    // The moats follow the final gates and streets: a closed gate leaves no crossing record.
    fortification::resolve_moats(&mut layout, town.surface);
    laps.lap("resolve_moats");
    // The wall and water rule on the finished town (`URBAN_PROFILE`): only a gate interrupts a
    // curtain and none stands in water. Every line should read "gaps 0 (0 m), wet curtain 0 m".
    if std::env::var("URBAN_PROFILE").is_ok() {
        for (i, found) in fortification::water_audit(&layout, town.surface).iter().enumerate() {
            eprintln!("  wall water audit: {} circuit {i}: gaps {} ({:.0} m), wet curtain {:.0} m", town.site.key, found.gaps, found.gap_m, found.wet_m);
        }
        for (i, e) in layout.enclosures.iter().enumerate().filter(|(_, e)| e.moat.is_some()) {
            let m = crate::urban::moat_audit(e, &layout.enclosures, &layout.streets, town.surface);
            let blank = crate::urban::roads_without_gate(e, town.roads);
            eprintln!(
                "  moat audit: {} enclosure {i}: runs {} ({:.0} of {:.0} m), dry curtain {:.0} m covered {:.0} m ({} gaps), gates {} crossed {}, other crossings {}, along {:.0} m, wet {} pool {} unsourced {}, dams {}, invalid {}, roads without gate {}",
                town.site.key, m.runs, m.run_m, m.ring_m, m.curtain_m, m.covered_m, m.uncovered.len(), m.gates, m.gate_crossings, m.other_crossings, m.streets_along_m, m.wet_reaches, m.pool_reaches, m.wet_without_source, m.dams, m.invalid, blank.len()
            );
        }
    }
    if let Some(mut baseline) = baseline {
        network::clear_water(&mut baseline, population, town.physical, reclaimed, config.max_street_grade);
        network::uncross_decks(&mut baseline, town.physical, config);
        harbour_furniture::furnish(&town.key_seed, &mut baseline, population, config, town.physical);
        fortification::sync_gates(&mut baseline, town.surface);
        fortification::drop_dead_gates(&mut baseline);
        fortification::tidy_wall_ends(&mut baseline, town.surface);
        fortification::resolve_moats(&mut baseline, town.surface);
        edits::quarter_baseline::retain(&mut layout, baseline);
    }
    layout
}
