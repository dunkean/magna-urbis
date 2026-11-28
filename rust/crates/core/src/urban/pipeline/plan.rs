//! The formal plan of an attempt: the quarter pass, its trim and its circuits,
//! then the finish, within the quarter edits wrapper and the stilt balance.
use super::Town;
use std::sync::{Arc, Mutex, Weak};
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
    // The source identity ties equal recalibrated layouts to equal drawing
    // inputs. In the plain workflow only the internal capacity floor and
    // yield can differ between the attempts that arrive at the same drawing.
    if town.stilt.is_none() && config.overrides.quarters.is_empty()
        && config.quarter_edits.is_none() && crate::urban::probe_cache::enabled()
    {
        edits::validate_quarters(config)?;
        return finish_plain(at).map(|layout| (layout, None));
    }
    edits::with_quarter_edits(config, |c| plan(&at, c), |l| finish(&at, l))
}

/// The formal continuation of one retained drawing, in the same town.
#[derive(Default)]
pub(super) struct FinishedRetry(Mutex<Option<(Weak<Layout>, Arc<Layout>)>>);

fn finish_plain(at: Attempt<'_, '_>) -> Result<Layout, String> {
    let town = at.town;
    let mut laps = Lap::new("tail");
    let quarters::Drawing { layout, retry_source } = lay_quarters(&at, at.config, town.site)?;
    laps.lap("quarters.generate");
    let Some(source) = retry_source else {
        let mut layout = finish_quarter_pass(&at, at.config, town.site, layout, laps);
        finish(&at, &mut layout)?;
        return Ok(layout);
    };
    let identity = Arc::downgrade(&source);
    let previous = town.finished_retry.0.lock().unwrap_or_else(|e| e.into_inner())
        .as_ref().filter(|(old, _)| old.ptr_eq(&identity)).map(|(_, result)| Arc::clone(result));
    let verify = std::env::var_os("URBAN_VERIFY_MEMO").is_some_and(|v| v == "1");
    if let Some(previous) = previous.as_ref() {
        #[cfg(not(target_arch = "wasm32"))]
        if std::env::var_os("URBAN_PROFILE").is_some() {
            eprintln!("  quarters.formal_retry.hit");
        }
        if !verify {
            return Ok((**previous).clone());
        }
    }
    // Capacity controls are inputs to drawing. The continuation takes its
    // stable inputs explicitly once the drawing has been chosen.
    let config = LayoutConfig { capacity_floor: 0.0, capacity_yield: 0.0, ..at.config.clone() };
    let at = Attempt { config: &config, ..at };
    let mut layout = finish_quarter_pass(&at, at.config, town.site, layout, laps);
    finish(&at, &mut layout)?;
    if let Some(previous) = previous.as_ref() {
        assert!(
            serde_json::to_vec(previous.as_ref()).expect("serialisable retained layout")
                == serde_json::to_vec(&layout).expect("serialisable recalculated layout"),
            "formal continuation of the same drawing must be identical",
        );
    }
    if layout.blocks.len() <= 1500 && layout.streets.len() <= 4000 {
        let saved = Arc::new(layout.clone());
        *town.finished_retry.0.lock().unwrap_or_else(|e| e.into_inner()) = Some((identity, saved));
    }
    Ok(layout)
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
    let mut laps = Lap::new("tail");
    let layout = lay_quarters(at, config, site)?.layout;
    laps.lap("quarters.generate");
    Ok(finish_quarter_pass(at, config, site, layout, laps))
}

fn finish_quarter_pass(
    at: &Attempt<'_, '_>,
    config: &LayoutConfig,
    site: &Site,
    mut layout: Layout,
    mut laps: Lap,
) -> Layout {
    let town = at.town;
    kinds::stamp(&mut layout, at.kind, town.original);
    trim::prepare(&mut layout);
    laps.lap("trim.prepare");
    access::refine(&mut layout, config, &at.morph, town.surface);
    laps.lap("access.refine");
    fortification::trace_gates("access.refine", &layout);
    stop_streets_at_walls(&mut layout, config, town);
    laps.lap("fortification.enforce");
    fortification::trace_gates("fortification.enforce", &layout);
    // Blocks nobody builds on go back to the fields, with their streets.
    let trimmed = layout.structure.as_ref().is_some_and(|s| s.mechanism != "legacy");
    // The lots the trim's allocation built: town circuits are fitted to them.
    let mut built_lots = None;
    if trimmed {
        built_lots = Some(trim::run(town.seed, &mut layout, config, town.original, site.population, town.surface).1);
        laps.lap("trim.run.1");
        fortification::trace_gates("trim.run.1", &layout);
    }
    // Fortifications follow the final streets and blocks.
    composition::fit_enclosures(&mut layout, site.population, town.surface, built_lots.as_deref());
    laps.lap("fit_enclosures.1");
    fortification::trace_gates("fit_enclosures.1", &layout);
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
    fortification::trace_gates("join_side_by_side", &layout);
    // A circuit without works is a curtain the fit drew back or joined (or a forced
    // footprint): `settle` decides its gates and closes the streets it now crosses.
    let rebuilt = layout.enclosures.iter().any(|e| e.style.is_empty() && e.path.len() >= 4);
    fortification::settle(&mut layout, town.surface);
    laps.lap("fortification.settle.1");
    fortification::trace_gates("fortification.settle.1", &layout);
    // The first trim read the plan with its gates decided: it runs again only when a
    // circuit was rebuilt after it, which cuts streets and can leave lots without access.
    if rebuilt && trimmed {
        retrim(&mut layout, config, site, town, &mut laps);
    }
    layout
}

/// The quarters of the pass: a small kind's own plan (`kinds::lay_out`), else
/// the quarter grammar (`quarters::generate`). A user-fixed site takes the quarter
/// grammar, which keeps its exact centre, except where the small plan is the place
/// itself: a camp laid round its centre, and a single structure
/// (`Town::single_structure`); under the quarter grammar an activity reserves no
/// block and an isolated building no plot of its own, and both stand empty.
fn lay_quarters(at: &Attempt<'_, '_>, config: &LayoutConfig, site: &Site) -> Result<quarters::Drawing, String> {
    let town = at.town;
    let own_plan = !town.fixed || at.kind.centred() || town.single_structure();
    let small = (at.kind.small() && own_plan && config.footprint.mechanism != "legacy")
        .then(|| kinds::lay_out(&town.key_seed, site, config, at.kind, &at.morph, town.surface, town.roads))
        .flatten();
    match small {
        Some(layout) => Ok(layout.into()),
        None => {
            let shoreline = town.raster_shoreline.get_or_init(|| super::geography::raster_shoreline(&town.surface));
            let surface = shoreline.as_ref().map_or(town.surface, |s| s.surface(town.surface));
            let retry = std::ptr::eq(site, town.site).then_some(&town.quarter_retry);
            quarters::generate(&town.key_seed, site, config, &at.morph, surface, town.roads, town.stilt.is_some(), retry)
        },
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
    fortification::trace_gates("trim.run.2", &layout);
    if released == 0 {
        return;
    }
    let before: Vec<_> = layout.enclosures.iter().map(|e| e.path.clone()).collect();
    composition::fit_enclosures(layout, site.population, town.surface, Some(&built_lots));
    laps.lap("fit_enclosures.2");
    fortification::trace_gates("fit_enclosures.2", &layout);
    if layout.enclosures.iter().map(|e| &e.path).ne(before.iter()) {
        fortification::settle(layout, town.surface);
        laps.lap("fortification.settle.2");
        fortification::trace_gates("fortification.settle.2", &layout);
    }
}
