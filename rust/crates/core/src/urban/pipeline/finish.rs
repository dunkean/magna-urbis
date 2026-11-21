//! The finish of a formal plan: the regional spans and the water crossings,
//! the street ends, the access summary, the programme and the circuit options,
//! the final trim, the bridges and banks, the harbour and lagoon works, and
//! the water sources.
use super::Town;
use super::plan::Attempt;
use crate::urban::network::{self, Lap};
use crate::urban::{
    Layout, Point, Shape, access, composition, deep_blocks, fortification, kinds, lagoon, macroplan, neighbours, programme, springs,
    trim,
};

/// Finish the layout of a quarter pass in place, for the attempt's configuration.
pub(super) fn finish(at: &Attempt<'_, '_>, layout: &mut Layout) -> Result<(), String> {
    let (town, config) = (at.town, at.config);
    let (site, surface, physical) = (town.site, town.surface, town.physical);
    // One lap per call, each with its own duration (`URBAN_PROFILE`).
    let mut laps = Lap::new("tail");
    if let Some(mask) = &town.neighbour_land {
        neighbours::enforce(layout, mask, true);
    }
    keep_regional_spans(layout, town);
    if let Some(ground) = town.stilt {
        ground.walkways(&mut layout.streets, physical);
    }
    network::bridge_water_on_ground(&mut layout.streets, surface, physical, config.max_street_grade);
    laps.lap("bridge_water_on_ground");
    let gates: Vec<Point> = layout.enclosures.iter().flat_map(|e| e.gates.iter().copied()).collect();
    if config.polish_road_ends {
        network::polish_ends(&mut layout.streets, &gates, config.road_remnants);
    }
    laps.lap("polish_ends");
    if config.road_mouths {
        network::seat_mouths(&mut layout.streets);
    }
    laps.lap("seat_mouths");
    if config.deep_block_lanes {
        deep_blocks::run(layout);
    }
    laps.lap("deep_blocks");
    access::summarize(layout, config);
    laps.lap("access.summarize");
    fortification::prepare_options(layout, config, surface);
    laps.lap("prepare_options");
    programme::prepare(layout, site.population, &config.programme, surface)?;
    laps.lap("programme.prepare.1");
    fortification::finish_options(layout, config, surface);
    laps.lap("finish_options");
    kinds::finish(layout, at.kind, town.original);
    laps.lap("kinds.finish");
    if layout.structure.as_ref().is_some_and(|s| s.mechanism != "legacy") {
        let built = trim::finish(town.seed, layout, physical);
        laps.lap("trim.finish");
        if !built.is_empty() && layout.enclosures.iter().any(|e| e.purpose.is_empty()) {
            refit_built_circuits(at, layout, &built)?;
            laps.lap("fit_enclosures.final");
        }
    }
    laps.lap("trim.finish");
    if config.street_frontage {
        network::join_bank_networks(layout, physical);
    }
    laps.lap("join_bank_networks");
    if config.village_bridge_budget && network::village_crossings(site.population) {
        network::tie_banks_to_road(layout, town.roads, physical, config);
    }
    laps.lap("tie_banks_to_road");
    network::select_bridges_graded(layout, site.population, physical, town.roads, config.max_street_grade);
    laps.lap("select_bridges_graded");
    if needs_bridgeheads(at, layout) {
        let reserved = network::reserved_streets(layout);
        trim::bridgeheads(town.seed, layout, physical, town.roads);
        network::remap_reservations(layout, &reserved);
    }
    laps.lap("trim.bridgeheads");
    if macroplan::harbour::port_town(config) {
        macroplan::harbour::protect_navigation(layout, physical, town.roads);
    }
    laps.lap("protect_navigation");
    fortification::sync_gates(layout, surface);
    laps.lap("sync_gates");
    network::ensure_regional_access(layout, town.roads, physical, config);
    laps.lap("ensure_regional_access");
    trim::footprint(layout);
    laps.lap("trim.footprint");
    if let Some(ground) = town.stilt {
        ground.land_links(&mut layout.streets, physical);
    }
    macroplan::harbour::platforms(layout, physical);
    laps.lap("platforms");
    lagoon::apply(layout, config, physical);
    laps.lap("lagoon.apply");
    // Reserve against the final network, after trim and water works.
    // Recompute block indices/environments after the source-site cuts.
    let reserved_sources = springs::reserve(layout, site, physical, config);
    laps.lap("springs.reserve");
    if reserved_sources {
        programme::prepare(layout, site.population, &config.programme, surface)?;
        laps.lap("programme.prepare.2");
    }
    Ok(())
}

/// Regional spans just outside the built land still belong to the visible
/// transport network: the layout keeps their corrected decks and ramps.
fn keep_regional_spans(layout: &mut Layout, town: &Town<'_>) {
    let site = town.site;
    layout.streets.extend(
        town.roads
            .iter()
            .filter(|s| {
                matches!(s.role.as_str(), "bridge" | "causeway" | "approach")
                    && s.path.first().zip(s.path.last()).is_some_and(|(&a, &b)| {
                        ((a.x + b.x) * 0.5 - site.center.x).hypot((a.y + b.y) * 0.5 - site.center.y) <= site.radius * 1.6
                    })
            })
            .cloned(),
    );
}

/// The lots that show a building are known on the final cadastre: a circuit
/// that still holds a big empty piece (houses the slope refused, lanes pruned
/// with them) gives it back and is rebuilt; the services are sited again on
/// the blocks the works left.
fn refit_built_circuits(at: &Attempt<'_, '_>, layout: &mut Layout, built: &[Shape]) -> Result<(), String> {
    let (town, config) = (at.town, at.config);
    let before: Vec<_> = layout.enclosures.iter().map(|e| e.path.clone()).collect();
    composition::fit_built_circuits(layout, town.site.population, town.surface, built);
    if layout.enclosures.iter().map(|e| &e.path).ne(before.iter()) {
        fortification::settle(layout, town.surface);
        access::summarize(layout, config);
        programme::prepare(layout, town.site.population, &config.programme, town.surface)?;
    }
    Ok(())
}

/// `roadNetworkPrune`: a village whose bank crossings were budgeted, or any
/// place whose bank keeps a loose street end, cuts its bridgeheads.
fn needs_bridgeheads(at: &Attempt<'_, '_>, layout: &Layout) -> bool {
    let (config, physical) = (at.config, at.town.physical);
    (config.village_bridge_budget
        && network::village_crossings(at.town.site.population)
        && layout.streets.iter().any(|s| matches!(s.role.as_str(), "bridge" | "approach"))
        || config.road_network_prune && network::bank_dead_ends(&layout.streets, physical))
        && layout.structure.as_ref().is_some_and(|s| s.mechanism != "legacy")
}
