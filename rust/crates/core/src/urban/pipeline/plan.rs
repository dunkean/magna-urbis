//! The formal plan of an attempt: the quarter pass, its trim and its circuits,
//! then the finish, within the quarter edits wrapper and the stilt balance.
use super::Town;
use super::finish::finish;
use crate::urban::kinds::{self, Kind};
use crate::urban::network;
use crate::urban::profile::Lap;
use crate::urban::{
    LayoutConfig, Layout, Morph, Point, Site, access, composition, edits, fortification, quarters, resolve, trim,
    with_tissue,
};

/// One rung of a ladder: the town at one configuration, with the kind that
/// configuration asks for and the street morphology it resolves.
pub(super) struct Attempt<'t, 'a> {
    pub town: &'t Town<'a>,
    pub config: &'t LayoutConfig,
    pub kind: Kind,
    morph: Morph,
}

/// The finished formal plan at `config` and, with structural quarter edits,
/// the baseline plan they were spliced from (`edits::with_quarter_edits`):
/// without edits this is the quarter pass then the finish.
pub(super) fn formal(town: &Town<'_>, config: &LayoutConfig) -> Result<(Layout, Option<Layout>), String> {
    // The kind the attempt asks for: `effective` wrote the resolved kind to
    // `settlement_form`; the household ladder may gather a hamlet or a string
    // that found no ground into a clustered plan.
    let kind = Kind::from_id(&config.settlement_form).unwrap_or(town.kind);
    // The tissue is resolved for each attempt: the capacity ladder starts with
    // the culture's normal streets and only later tries contour terraces.
    let zone = if config.zone == "auto" { "core" } else { &config.zone };
    let morph = resolve(town.culture, &config.preset, &config.recipe, zone, config.density, &config.params, "quarters")?;
    let at = Attempt { town, config, kind, morph: with_tissue(morph, &config.tissue) };
    edits::with_quarter_edits(config, |c| plan(&at, c), |l| finish(&at, l))
}

/// The quarter pass at `config` (the attempt's, or a quarter edits variant of
/// it); on stilt ground, balanced between land and water (`StiltGround::balance`).
fn plan(at: &Attempt<'_, '_>, config: &LayoutConfig) -> Result<Layout, String> {
    let town = at.town;
    let layout = quarter_pass(at, config, town.site)?;
    match town.stilt {
        Some(ground) if !at.kind.small() => {
            ground.balance(town.seed, layout, town.physical, |s| quarter_pass(at, config, s), |l| finish(at, l))
        }
        _ => Ok(layout),
    }
}

/// One quarter pass on `site` (the town's, or a site the stilt balance moved):
/// the quarters, their access, the trim of unbuilt blocks and the circuits
/// fitted to the lots built.
fn quarter_pass(at: &Attempt<'_, '_>, config: &LayoutConfig, site: &Site) -> Result<Layout, String> {
    let town = at.town;
    // One lap per call, each with its own duration (`URBAN_PROFILE`).
    let mut laps = Lap::new("tail");
    let mut layout = lay_quarters(at, config, site)?;
    laps.lap("quarters.generate");
    kinds::stamp(&mut layout, at.kind, town.original);
    trim::prepare(&mut layout);
    laps.lap("trim.prepare");
    access::refine(&mut layout, config, &at.morph, town.surface);
    laps.lap("access.refine");
    stop_streets_at_walls(&mut layout, config, town);
    laps.lap("fortification.enforce");
    // Blocks nobody builds on go back to the fields, with their streets.
    let trimmed = layout.structure.as_ref().is_some_and(|s| s.mechanism != "legacy");
    // The lots the trim's allocation built: town circuits are fitted to them.
    let mut built_lots = None;
    if trimmed {
        built_lots = Some(trim::run(town.seed, &mut layout, config, town.original, site.population, town.surface).1);
        laps.lap("trim.run.1");
    }
    // Fortifications follow the final streets and blocks.
    composition::fit_enclosures(&mut layout, site.population, town.surface, built_lots.as_deref());
    laps.lap("fit_enclosures.1");
    // A join that would stand on a neighbour's land is not made: the circuits stay as they were.
    let apart = town.neighbour_land.as_ref().map(|mask| (mask, layout.enclosures.clone()));
    composition::join_side_by_side(&mut layout, town.surface);
    if let Some((mask, apart)) = apart
        && layout.enclosures.iter().any(|e| mask.refuses(&e.path))
        && !apart.iter().any(|e| mask.refuses(&e.path))
    {
        layout.enclosures = apart;
    }
    laps.lap("join_side_by_side");
    // A circuit without works is a curtain the fit drew back or joined (or a forced
    // footprint): `settle` decides its gates and closes the streets it now crosses.
    let rebuilt = layout.enclosures.iter().any(|e| e.style.is_empty() && e.path.len() >= 4);
    fortification::settle(&mut layout, town.surface);
    laps.lap("fortification.settle.1");
    // The first trim read the plan with its gates decided: it runs again only when a
    // circuit was rebuilt after it, which cuts streets and can leave lots without access.
    if rebuilt && trimmed {
        retrim(&mut layout, config, site, town, &mut laps);
    }
    Ok(layout)
}

/// The quarters of the pass: a small kind's own plan (`kinds::lay_out`), else
/// the quarter grammar (`quarters::generate`). A user-fixed site takes the quarter
/// grammar, which keeps its exact centre, except where the small plan is the place
/// itself: a camp laid round its centre, and a single structure
/// (`Town::single_structure`); under the quarter grammar an activity reserves no
/// block and an isolated building no plot of its own, and both stand empty.
fn lay_quarters(at: &Attempt<'_, '_>, config: &LayoutConfig, site: &Site) -> Result<Layout, String> {
    let town = at.town;
    let own_plan = !town.fixed || at.kind.centred() || town.single_structure();
    let small = (at.kind.small() && own_plan && config.footprint.mechanism != "legacy")
        .then(|| kinds::lay_out(&town.key_seed, site, config, at.kind, &at.morph, town.surface, town.roads))
        .flatten();
    match small {
        Some(layout) => Ok(layout),
        None => quarters::generate(&town.key_seed, site, config, &at.morph, town.surface, town.roads, town.stilt.is_some()),
    }
}

/// The gates were decided with the circuits: a street the quarters drew across a
/// curtain elsewhere ends at the wall, before the allocation reads the plan.
fn stop_streets_at_walls(layout: &mut Layout, config: &LayoutConfig, town: &Town<'_>) {
    fortification::enforce(layout, town.surface);
    // The loose nubs left past a junction (a gate street that stops a few metres
    // beyond the wall, a street cut at a curtain) go now, as the finish would take
    // them: the trim must not count a lot as served by a stub that a later pass removes.
    if config.polish_road_ends && !layout.enclosures.is_empty() {
        let gates: Vec<Point> = layout.enclosures.iter().flat_map(|e| e.gates.iter().copied()).collect();
        network::polish_ends(&mut layout.streets, &gates, config.road_remnants);
    }
}

/// The second trim, after a circuit was rebuilt. The trim gave land back with
/// its streets: a circuit that still holds a big piece of that land gives it
/// back, and is rebuilt.
fn retrim(layout: &mut Layout, config: &LayoutConfig, site: &Site, town: &Town<'_>, laps: &mut Lap) {
    let (released, built_lots) = trim::run(town.seed, layout, config, town.original, site.population, town.surface);
    laps.lap("trim.run.2");
    if released == 0 {
        return;
    }
    let before: Vec<_> = layout.enclosures.iter().map(|e| e.path.clone()).collect();
    composition::fit_enclosures(layout, site.population, town.surface, Some(&built_lots));
    laps.lap("fit_enclosures.2");
    if layout.enclosures.iter().map(|e| &e.path).ne(before.iter()) {
        fortification::settle(layout, town.surface);
        laps.lap("fortification.settle.2");
    }
}
