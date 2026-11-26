//! The ladders of a settlement: the same pipeline run again with other
//! settings while a plan houses too few of its households. Each rung is a
//! formal plan (`plan::formal`) or a completed one (`complete::lay`); a rung
//! that errors is a rejected candidate.
use super::Town;
use super::complete::lay;
use super::plan::formal;
use super::probe_parcels;
use crate::urban::{
    LayoutConfig, Layout, Point, ProgrammeContext, access, culture, footprint, fortification, geometry, kinds,
    profiles, programme, roles, slopes, springs, trim, warnings,
};

/// The household invariant of the pipeline covers hamlets and villages: from
/// the hamlet floor (a farmstead is one reserved farm) to the town floor (a
/// town's plan is sized by `footprint::capacity`, and its probe costs seconds).
pub(in crate::urban) const HOUSED_FROM: u32 = 15;
const HOUSED_BELOW: u32 = 1000;

/// The plan the slope relaxation ladder chose, before its completion.
pub(super) struct Relaxed {
    pub layout: Layout,
    pub baseline: Option<Layout>,
    /// The configuration of the chosen rung.
    pub chosen: LayoutConfig,
    /// The configuration of the first rung (the relaxation read ahead).
    pub first: LayoutConfig,
    /// The relaxation read from the terrain before the first rung (0 = strict).
    pub ahead: f64,
}

/// A town whose strict house gates refuse most of its land (a user-placed
/// town on a mountain flank) relaxes its slope gates. The level is read from
/// the terrain before the first pass (`footprint::slope_relax_ahead`): the
/// lowest at which its houses may use half of the land it would take and that
/// land houses its households. Ordinary ground reads 0 and keeps the strict
/// pass, unchanged. A lone farm (or other isolated structure) relaxes the same
/// gates: on a hill flank its single block would otherwise be refused and the
/// place stand empty (`housable_share` reads its reservation).
///
/// The land gate reads only formal blocks, their environment and their
/// capacity: the ladder chooses that land before the completion sites
/// informal housing and the cadastre is measured. Each higher relaxation
/// (`profiles::SLOPE_RELAX_STEPS`) is tried while the housable share stays
/// under its goal, and kept when it leaves fewer households without a home.
pub(super) fn relax_slopes(town: &Town<'_>) -> Result<Relaxed, String> {
    let (site, config, kind) = (town.site, town.config, town.kind);
    let relaxable = config.programme.slope_relax == 0.0
        && (config.programme.intent == "settlement" || roles::is_isolated(&config.programme.intent))
        && site.population > 0;
    let mountain_village = (15..1000).contains(&site.population) && slopes::eligible(site, config, town.surface, kind);
    // The look-ahead reads the quarter grammar: a fixed single structure keeps its own plot (`plan::lay_quarters`).
    let start = if relaxable && (!kind.small() || (town.fixed && !town.single_structure()) || mountain_village) {
        footprint::slope_relax_ahead(&town.key_seed, site, config, town.surface, town.roads)
    } else {
        footprint::SlopeStart::Level(0.0)
    };
    // Keep the original setting for the household and slope-ward ladders.
    let ahead = match start {
        footprint::SlopeStart::Level(level) => level,
        footprint::SlopeStart::CheckFirstRung => 0.0,
    };
    #[cfg(not(target_arch = "wasm32"))]
    if ahead > 0.0 && std::env::var("URBAN_PROFILE").is_ok() {
        eprintln!("  slope_relax.ahead: {ahead}");
    }
    let mut first = config.clone();
    if ahead > 0.0 {
        first.programme.slope_relax = ahead;
    }
    let half = profiles::SLOPE_RELAX_STEPS[0];
    let mut trial = None;
    if matches!(start, footprint::SlopeStart::CheckFirstRung) {
        let mut candidate = config.clone();
        candidate.programme.slope_relax = half;
        let result = formal(town, &candidate);
        // Verify the forecast against the actual street-cut block and reserve
        // areas. With no missing households the candidate wins even a tie on
        // capacity when only its relaxed gate reaches the land goal.
        let verified = result.as_ref().is_ok_and(|(layout, _)| {
            if !footprint::capacity::of(layout).is_some_and(|p| p.shortfall == 0.0) { return false; }
            let [strict, relaxed] = housable_shares(layout, [0.0, half]);
            #[cfg(not(target_arch = "wasm32"))]
            if std::env::var("URBAN_PROFILE").is_ok() {
                eprintln!("  slope_relax.blocks: strict {strict:.3}, half {relaxed:.3}");
            }
            strict < profiles::SLOPE_RELAX_GOAL && relaxed >= profiles::SLOPE_RELAX_GOAL
        });
        if verified {
            let (mut layout, baseline) = result?;
            #[cfg(not(target_arch = "wasm32"))]
            if std::env::var("URBAN_PROFILE").is_ok() {
                eprintln!("  slope_relax.ahead: {half} (verified on blocks)");
            }
            layout.warnings.push(warnings::house_slope_relaxed(half * 100.0));
            return Ok(Relaxed { layout, baseline, chosen: candidate, first, ahead });
        }
        trial = Some(result);
    }
    let mut chosen = first.clone();
    let (mut layout, mut baseline) = formal(town, &first)?;
    if relaxable {
        let shortfall = |l: &Layout| footprint::capacity::of(l).map_or(0.0, |p| p.shortfall);
        let mut share = housable_share(&layout);
        let mut missing = shortfall(&layout);
        for relax in profiles::SLOPE_RELAX_STEPS.into_iter().filter(|&relax| relax > ahead) {
            if share >= profiles::SLOPE_RELAX_GOAL {
                break;
            }
            #[cfg(not(target_arch = "wasm32"))]
            if std::env::var("URBAN_PROFILE").is_ok() {
                eprintln!("  slope_relax.fallback: {relax} (housable share {share:.2}, households missing {missing:.0})");
            }
            let mut relaxed = config.clone();
            relaxed.programme.slope_relax = relax;
            let result = trial.take().unwrap_or_else(|| formal(town, &relaxed));
            let Ok((next, next_baseline)) = result else { continue };
            let (next_share, next_missing) = (housable_share(&next), shortfall(&next));
            if next_missing < missing || (next_missing == missing && next_share > share) {
                (layout, baseline, share, missing, chosen) = (next, next_baseline, next_share, next_missing, relaxed);
            }
        }
        if chosen.programme.slope_relax > 0.0 {
            layout.warnings.push(warnings::house_slope_relaxed(chosen.programme.slope_relax * 100.0));
        }
    }
    Ok(Relaxed { layout, baseline, chosen, first, ahead })
}

/// A relaxed footprint can meet the land goal and still lack homes: an
/// eligible slope town counts its formal parcel allocations and adds slope
/// wards (`slopes::complete`). Informal pockets can cover a remaining deficit
/// on the household ladder.
pub(super) fn slope_wards(town: &Town<'_>, layout: Layout, chosen: &LayoutConfig, ahead: f64) -> Layout {
    let (site, config) = (town.site, town.config);
    if !(slopes::eligible(site, config, town.surface, town.kind)
        && (slopes::short(&layout)
            || site.population < 1000
            || chosen.programme.slope_relax > ahead
                && housed_households(town.seed, &layout) < footprint::capacity::households(town.culture, site.population)))
    {
        return layout;
    }
    // After a ward is added to a finished layout: access and programme for
    // each trial; the rest of the finish once, on the adopted layout (`last`).
    // `trim::finish` is not rerun: its door-based pass releases the new fringe
    // wards to the fields.
    let retail = |layout: &mut Layout, context: &ProgrammeContext, last: bool| -> Result<(), String> {
        if !last {
            access::summarize(layout, config);
            return programme::prepare(layout, site.population, context, town.surface);
        }
        fortification::sync_gates(layout, town.surface);
        trim::footprint(layout);
        if springs::reserve(layout, site, town.physical, config) {
            programme::prepare(layout, site.population, context, town.surface)?;
        }
        Ok(())
    };
    let others: Vec<Point> = town.sites.iter().filter(|s| s.key != site.key).map(|s| s.center).collect();
    match slopes::complete(town.seed, site, chosen, town.surface, town.roads, &others, layout, |c| lay(town, c), retail) {
        Ok(done) | Err(done) => done,
    }
}

/// Invariant (no empty settlement): a hamlet or a village whose finished plan
/// houses less than half of its households on the real cut (a camp lattice on
/// the wedges between the roads of a junction, a string with no ground) is
/// laid out again from the first rung's configuration: a directly laid kind
/// gathers into the clustered plan, then the same grammar takes more land
/// (half, a quarter, an eighth of its gross density). The first plan housing
/// its households is kept, else the one that houses the most; a place still
/// without a home keeps the cadastre's notice.
pub(super) fn house_households(town: &Town<'_>, mut layout: Layout, first: &LayoutConfig) -> Layout {
    let (site, config) = (town.site, town.config);
    if !(config.programme.intent == "settlement"
        && config.scope == "settlement"
        && config.footprint.mechanism != "legacy"
        && config.footprint.budget == "population"
        && !matches!(config.programme.state.as_str(), "abandoned" | "ruined")
        && (HOUSED_FROM..HOUSED_BELOW).contains(&site.population))
    {
        return layout;
    }
    let need = footprint::capacity::households(town.culture, site.population);
    let mut homes = housed_households(town.seed, &layout);
    if homes >= 0.5 * need {
        return layout;
    }
    let density_of = |l: &Layout| l.structure.as_ref().map_or(0.0, |s| s.metrics.gross_density);
    let direct = layout.structure.as_ref().is_some_and(|s| s.mechanism == "kind");
    let mut density = if direct { 0.0 } else { density_of(&layout) };
    let mut attempt = first.clone();
    let mut steps = vec![];
    if direct && config.footprint.gross_density <= 0.0 {
        steps.push(None);
    }
    steps.extend([Some(0.5), Some(0.25), Some(0.125)]);
    let (was, mut gathered, mut land) = (homes, false, 1.0);
    for step in steps {
        match step {
            None => attempt.settlement_form = kinds::Kind::NucleatedVillage.id().into(),
            Some(share) if density > 0.0 => attempt.footprint.gross_density = density * share,
            Some(_) => break,
        }
        let Ok(next) = lay(town, &attempt) else { continue };
        if step.is_none() {
            density = density_of(&next);
        }
        let next_homes = housed_households(town.seed, &next);
        if next_homes > homes {
            (layout, homes) = (next, next_homes);
            gathered = attempt.settlement_form == kinds::Kind::NucleatedVillage.id() && direct;
            land = step.map_or(1.0, |share| 1.0 / share);
        }
        if homes >= 0.95 * need {
            break;
        }
    }
    if homes > was && gathered {
        layout.warnings.push(warnings::farms_clustered(was, need, homes));
    }
    if homes > was && land > 1.0 {
        layout.warnings.push(warnings::footprint_expanded(was, need, land, homes));
    }
    layout
}

/// Households a finished layout houses on its real cut: the trim's probe cadastre
/// (`probe_parcels`) and its allocation, the lots the published parcels give.
fn housed_households(seed: &str, layout: &Layout) -> f64 {
    probe_parcels(seed, layout).map_or(0.0, |part| part.programme.iter().flat_map(|p| &p.allocations).map(|a| a.households).sum())
}

/// Share of a town's land (its ordinary blocks and the blocks released to the
/// fields) that its houses may use: dry blocks within the house slope gate of
/// the layout's programme, relaxation included. 1 for a layout without land.
pub(in crate::urban) fn housable_share(layout: &Layout) -> f64 {
    housable_shares(layout, [layout.programme.as_ref().map_or(0.0, |pr| pr.context.slope_relax)])[0]
}

fn housable_shares<const N: usize>(layout: &Layout, levels: [f64; N]) -> [f64; N] {
    let Some(pr) = &layout.programme else { return [0.0; N] };
    // An isolated site is one structure on one reserved block: housable once
    // that block is reserved (its own isolated admission, not the town's).
    if roles::is_isolated(&pr.context.intent) {
        return [if pr.reservations.is_empty() { 0.0 } else { 1.0 }; N];
    }
    let max_slope = culture::mapping_for(&layout.culture, &pr.context.period)
        .map_or([f64::INFINITY; N], |m| levels.map(|r| profiles::house_slope(&layout.culture, m.admissibility.max_slope, r)));
    let mut environment = vec![None; layout.blocks.len()];
    for e in &pr.environment {
        if let Some(slot) = environment.get_mut(e.block) {
            *slot = Some(e);
        }
    }
    let (mut total, mut housable) = (0.0, [0.0; N]);
    for (b, e) in layout.blocks.iter().zip(&environment) {
        if !matches!(b.kind.as_str(), "block" | "reserve") {
            continue;
        }
        let area = geometry::area(&b.shape);
        total += area;
        if let Some(e) = e.filter(|e| !e.wet) {
            for (sum, limit) in housable.iter_mut().zip(max_slope) {
                if e.slope <= limit { *sum += area; }
            }
        }
    }
    housable.map(|a| if total <= 0.0 { 1.0 } else { a / total })
}
