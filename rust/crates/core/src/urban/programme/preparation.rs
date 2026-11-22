//! Town programme preparation before cadastral subdivision.

use crate::urban::{Layout, Surface, culture::mapping, geometry::area, roles, warnings};
use std::collections::BTreeSet;

use super::{ProgrammeContext, UrbanProgramme, demand::initial_demands, environment::measure,
    reservations::reserve_blocks};

pub fn prepare(layout: &mut Layout, population: u32, context: &ProgrammeContext, surface: Surface<'_>) -> Result<(), String> {
    prepare_inner(layout, population, context, surface, true)
}

fn prepare_inner(
    layout: &mut Layout,
    population: u32,
    context: &ProgrammeContext,
    surface: Surface<'_>,
    reconcile_walls: bool,
) -> Result<(), String> {
    if !(context.intent == "settlement" || roles::is_isolated(&context.intent))
        || roles::state(&context.state).is_none()
        || context.functions.is_some_and(|f| !f.valid())
        || context
            .decay
            .is_some_and(|d| !d.is_finite() || !(0.0..=1.0).contains(&d))
        || !(0.0..=1.0).contains(&context.slope_relax)
        || !["strict", "inspired", "fantasy"].contains(&context.mode.as_str())
        || context.resources.len() > 64
        || context.lore.len() > 32
        || context.period.len() > 64
        || !["suggest", "force"].contains(&context.count_mode.as_str())
        || context.counts.len() > 256
        || context.counts.values().any(|&n| n > roles::MAX_ROLE_COUNT)
    {
        return Err("Invalid urban programme context".into());
    }
    let base = mapping(&layout.culture).ok_or("Unknown urban cultural mapping")?;
    // The reservations are drawn again from scratch: a block an earlier
    // preparation held for an institution is an ordinary block again. Left
    // marked, it would be neither reserved nor housed (a dead block in town).
    for b in &mut layout.blocks {
        if b.kind == "reserve:programme" {
            b.kind = "block".into();
        }
    }
    let cultural_functions = base.functional_profile.as_str();
    let mut ids = vec![layout.culture.clone()];
    for phase in &layout.phases {
        if !phase.culture.is_empty() && !ids.contains(&phase.culture) {
            mapping(&phase.culture).ok_or("Unknown phase cultural mapping")?;
            ids.push(phase.culture.clone());
        }
    }
    // Cultures the style sheet brings for the singular and utility buildings.
    for (culture, _) in crate::urban::forms::sheet::monuments(layout).unwrap_or_default() {
        if !ids.iter().any(|id| id == culture) {
            ids.push(culture.to_owned());
        }
    }
    let mut warnings = vec![];
    let cultures = ids
        .iter()
        .filter_map(|id| {
            let selected = crate::urban::culture::isolated_mapping(id, &context.period, &context.intent);
            if selected.is_none() {
                warnings.push(warnings::missing_native_recipe(id, &context.period));
            }
            selected
        })
        .collect::<Vec<_>>();

    let (mut demands, functions, isolated, counts) =
        initial_demands(layout, population, context, cultural_functions, &cultures, &mut warnings);
    #[cfg(not(target_arch = "wasm32"))]
    let tick = std::time::Instant::now();
    #[cfg(target_arch = "wasm32")]
    let lap = |_: &str| {};
    #[cfg(not(target_arch = "wasm32"))]
    let lap = |label: &str| {
        if std::env::var("URBAN_PROFILE").is_ok() {
            eprintln!(
                "  programme.{label}: {:.0} ms",
                tick.elapsed().as_secs_f64() * 1000.0
            );
        }
    };
    let (block_contacts, mut environment) = measure(layout, surface, &lap);
    // District roles read the same environment the services are sited with.
    // A sea or lake shore is a harbour; a river carries boats past a town.
    // Measured fact, never the declared label: a quay on a channel at least
    // NAVIGABLE wide. Port storage is allocated only against it.
    let navigable = crate::urban::macroplan::harbour::navigable(layout, surface);
    if !navigable && functions.port > 0.0 && !isolated {
        warnings.push(warnings::port_storage_deficit());
    }
    if !navigable {
        for d in demands.iter_mut().filter(|d| d.site == "quay") {
            d.reasons.push("No explicit navigable harbour frontage: no port may be inferred from a label or water proximity".into());
        }
    }
    lap("environment");
    let block_district = roles::assign(layout, population, navigable, &environment);
    // Exact port quarters now exist; rebuild environment/reservations once if
    // their enclosure changes the block reserve. No stale block indices survive.
    if reconcile_walls && let Some(cfg) = layout.config.clone()
        && crate::urban::fortification::port_walls(layout, &cfg, surface) {
        return prepare_inner(layout, population, context, surface, false);
    }
    lap("districts");
    for (e, d) in environment.iter_mut().zip(block_district) {
        e.district = d;
    }
    // Water-bound trades (mills, boat sheds) only exist where there is water.
    if !environment.iter().any(|e| e.waterfront) {
        let dropped: BTreeSet<String> = demands.iter().filter(|d| d.requires.iter().any(|r| r == "waterfront")).map(|d| d.role.clone()).collect();
        if !dropped.is_empty() {
            warnings.push(warnings::waterfront_uses_removed(&dropped));
        }
        demands.retain(|d| !d.requires.iter().any(|r| r == "waterfront"));
    }

    let reservations = reserve_blocks(
        layout,
        population,
        context,
        surface,
        &environment,
        &block_contacts,
        &mut demands,
        &mut warnings,
        isolated,
        navigable,
    );
    lap("reservations");
    if let Some(structure) = &mut layout.structure {
        structure.metrics.reserved_area = layout
            .blocks
            .iter()
            .filter(|b| b.kind != "block")
            .map(|b| area(&b.shape))
            .sum();
    }
    layout.programme = Some(UrbanProgramme {
        version: 1,
        population,
        context: context.clone(),
        cultures,
        demands,
        reservations,
        allocations: vec![],
        adjacency: vec![],
        environment,
        reconciliation_passes: 0,
        warnings,
        housing_capacity: 0.0,
        navigable_frontage: navigable,
        counts,
    });
    Ok(())
}
