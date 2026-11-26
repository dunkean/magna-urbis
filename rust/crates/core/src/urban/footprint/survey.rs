//! Coarse terrain sampling for epoch capacity and advance slope relaxation.
use super::epochs::{budget, enclosed, epoch_densities, epoch_fractions, epoch_zone};
use super::site::{buildable_grade, slope};
use super::{capacity, generate, growth::Taken, terrain};
use crate::urban::{
    LayoutConfig, Morph, Point, Shape, Site, Street, Surface, composition, culture, geography, profiles, programme,
    with_tissue,
};
use std::f64::consts::PI;

/// The land a footprint of `area` m² takes, as samples on a lattice of a
/// sixth of its radius: accessible growth never enters ground steeper than the
/// buildable grade and prices a cell by its distance times its terrain cost,
/// so of the dry, buildable samples within reach the cheapest ones, as many as
/// the footprint area holds, stand for it. Returns (cost, grade, centre) of
/// each sample, cheapest first, and the lattice step.
fn nominal_cells(site: &Site, cfg: &LayoutConfig, area: f64, surface: Surface<'_>) -> (Vec<(f64, f64, Point)>, f64) {
    let radius = (area / PI).sqrt();
    let step = radius / 6.0;
    let grade_limit = buildable_grade(site, cfg);
    let relief = 0.35 + cfg.footprint.anisotropy * 0.65;
    let wanted = (-6..=6_i32)
        .flat_map(|y| (-6..=6_i32).map(move |x| x * x + y * y))
        .filter(|&r| r <= 36)
        .count();
    let mut cells: Vec<(f64, f64, Point)> = (-11..=11_i32)
        .flat_map(|y| (-11..=11_i32).map(move |x| (x, y)))
        .filter(|(x, y)| x * x + y * y <= 121)
        .filter_map(|(x, y)| {
            let p = Point {
                x: site.center.x + f64::from(x) * step,
                y: site.center.y + f64::from(y) * step,
            };
            if surface.wet(p) {
                return None;
            }
            let (gx, gy) = slope(surface, p);
            let grade = gx.hypot(gy);
            (grade <= grade_limit).then(|| {
                let terrain = 1.0 + relief * (grade * 2.5 + (grade / grade_limit).powi(2) * 4.0);
                (f64::from(x).hypot(f64::from(y)) * terrain, grade, p)
            })
        })
        .collect();
    cells.sort_by(|a, b| a.0.total_cmp(&b.0));
    cells.truncate(wanted);
    (cells, step)
}
/// Housable shares of the nominal land of a town, measured with the house
/// slope gate at block scale (`terrain`). None without a gate or land.
fn terrain_survey(
    site: &Site,
    cfg: &LayoutConfig,
    morph: &Morph,
    cells: &[(f64, f64, Point)],
    step: f64,
    surface: Surface<'_>,
) -> Option<terrain::Survey> {
    let culture = if cfg.culture == "site" { &site.culture } else { &cfg.culture };
    let (zone, _) = epoch_zone(cfg, culture, site.population, 0);
    let [lo, hi] = morph.block_size(zone);
    let gate = terrain::Gate::new(site, cfg, 0.5 * (lo + hi))?;
    let centres: Vec<Point> = cells.iter().map(|c| c.2).collect();
    terrain::survey(surface, &centres, step * 0.5, gate)
}
/// Strict housable share above which a site is ordinary ground: on the coarse
/// survey its footprint is not drawn ahead, on the drawn land it keeps the
/// strict gates (`slope_relax_ahead`).
const AHEAD_SURVEY: f64 = 0.95;
/// Shortfall, as a share of the households required, within which a capacity
/// plan houses the town (the closed loop's and the capacity warning's bound,
/// `quarters::generate`).
const HOUSED_SHORTFALL: f64 = 0.05;

/// An advance setting, or a disputed strict forecast to check on the first
/// relaxed plan's real blocks before discarding the strict alternative.
pub(in crate::urban) enum SlopeStart {
    Level(f64),
    CheckFirstRung,
}

/// Group the land growth actually reached into typical block widths. Give each
/// block the area of its selected growth cells, including those on the bank.
/// The programme admits or refuses the whole block. Sample its rim at the
/// terrain resolution so a short steep or flooded stretch counts too.
fn block_shares(taken: &Taken, gate: terrain::Gate, surface: Surface<'_>) -> [f64; 2] {
    let grid = &taken.grid;
    let span = (gate.block_side() / grid.step).round().clamp(1.0, grid.nx.max(grid.ny) as f64) as usize;
    let columns = grid.nx.div_ceil(span);
    let mut areas = vec![0usize; columns * grid.ny.div_ceil(span)];
    for &cell in &taken.cells {
        areas[(cell / grid.nx / span) * columns + cell % grid.nx / span] += 1;
    }
    let side = span as f64 * grid.step;
    let raster_cell = surface.width / surface.height_resolution().max(surface.n) as f64;
    let segments = (side / raster_cell).ceil().max(1.0) as usize;
    let mut rim = Vec::with_capacity(4 * segments);
    for (dx, dy, sx, sy) in [(0., 0., 1., 0.), (1., 0., 0., 1.), (1., 1., -1., 0.), (0., 1., 0., -1.)] {
        for j in 0..segments {
            let t = j as f64 / segments as f64;
            rim.push((dx + sx * t, dy + sy * t));
        }
    }
    let mut shape = Shape { outer: Vec::with_capacity(rim.len()), holes: vec![] };
    let half_limit = gate.at(terrain::LEVELS[1]);
    let mut admitted = [0usize; 2];
    for (i, area) in areas.into_iter().enumerate().filter(|(_, area)| *area > 0) {
        let col = i % columns * span;
        let row = i / columns * span;
        let x = grid.x0 + col as f64 * grid.step;
        let y = grid.y0 + row as f64 * grid.step;
        let width = ((grid.nx - col).min(span) as f64 * grid.step).min(surface.width - x);
        let height = ((grid.ny - row).min(span) as f64 * grid.step).min(surface.width - y);
        let center = Point { x: x + width * 0.5, y: y + height * 0.5 };
        shape.outer.clear();
        shape.outer.extend(rim.iter().map(|&(u, v)| Point { x: x + u * width, y: y + v * height }));
        let slope = programme::block_slope(surface, &shape, center, surface.height_at(center));
        if slope <= half_limit && !programme::block_is_wet(surface, &shape, center) {
            admitted[0] += usize::from(slope <= gate.strict) * area;
            admitted[1] += area;
        }
    }
    admitted.map(|area| area as f64 / taken.cells.len() as f64)
}
/// Relaxation of the house slope gates a town needs, read from the terrain
/// before the first pass. A coarse survey of its nominal land first: where
/// the strict gates admit nearly all of it (all ordinary ground) the answer is
/// 0 at once. Otherwise the strict footprint is drawn, as the first pass will
/// draw it (the land a flank town reaches is set by street access, not by
/// distance), and its land is measured. Ground the strict gates admit nearly
/// whole keeps them; elsewhere the level is the higher of the lowest at which
/// its houses may use `profiles::SLOPE_RELAX_GOAL` of the land
/// (`terrain::Survey::relaxation`) and the lowest at which that land houses
/// the town (`housing_relaxation`).
pub(in crate::urban) fn slope_relax_ahead(seed: &str, site: &Site, cfg: &LayoutConfig, surface: Surface<'_>, roads: &[Street]) -> SlopeStart {
    let culture = if cfg.culture == "site" { &site.culture } else { &cfg.culture };
    let small = crate::settlements::demographics::below(site.population, "town");
    // The morph the footprint is sized with (`composition`): the founding recipe.
    let recipe = composition::recipe(culture, site.population, if small { "village" } else { "core" });
    let zone = if cfg.zone != "auto" {
        cfg.zone.as_str()
    } else if small && enclosed(cfg, culture, site.population) {
        "core"
    } else if small {
        "village"
    } else {
        "core"
    };
    let Ok(morph) = composition::phase_morph(
        culture, &recipe, zone, &cfg.preset, &cfg.recipe, cfg.density, &cfg.params, "quarters",
    ) else {
        return SlopeStart::Level(0.0);
    };
    let morph = with_tissue(morph, &cfg.tissue);
    let radius = if cfg.radius > 0.0 { cfg.radius } else { site.radius * cfg.radius_scale };
    let (nominal, _) = budget(site, cfg, &morph, radius);
    let (cells, step) = nominal_cells(site, cfg, nominal, surface);
    let Some(coarse) = terrain_survey(site, cfg, &morph, &cells, step, surface) else { return SlopeStart::Level(0.0) };
    if coarse.levels[0] >= AHEAD_SURVEY || cfg.footprint.mechanism == "legacy" {
        return SlopeStart::Level(0.0);
    }
    // The first pass's inputs (`quarters::generate_once`): stairs as the
    // culture allows them, water at its raster shoreline.
    let first = LayoutConfig { allow_stairs: profiles::stairs_allowed(cfg, culture), ..cfg.clone() };
    let shoreline = geography::raster_shoreline(&surface);
    let drawn_surface = shoreline.as_ref().map_or(surface, |s| s.surface(surface));
    let footprint = generate(seed, site, &first, &morph, drawn_surface, roads, radius);
    #[cfg(not(target_arch = "wasm32"))]
    if std::env::var("URBAN_PROFILE").is_ok() {
        eprintln!("  terrain.ahead: coarse {:?} land {:?}", coarse.levels, footprint.land.as_ref().map(|(s, _)| s.levels));
    }
    let Some((land, taken)) = footprint.land else { return SlopeStart::Level(0.0) };
    if land.levels[0] >= AHEAD_SURVEY {
        return SlopeStart::Level(0.0);
    }
    let allocated = footprint.structure.metrics.allocated_area;
    let cells = if shoreline.is_some() { nominal_cells(site, &first, nominal, drawn_surface).0 } else { cells };
    let mut epochs = capacity_epochs(site, &first, &morph, nominal, &cells);
    let shortfall = |share: f64| {
        for e in &mut epochs {
            e.steep = 1.0 - share;
        }
        capacity::plan(site, &first, &epochs, nominal, Some(allocated))
            .map(|p| (p.shortfall - HOUSED_SHORTFALL * p.required).max(0.0))
    };
    let level = land.relaxation().max(housing_relaxation(&land.levels, shortfall));
    if level == 0.0 && coarse.refused() && cfg.programme.intent == "settlement" {
        let [strict, half] = block_shares(&taken, land.gate, surface);
        #[cfg(not(target_arch = "wasm32"))]
        if std::env::var("URBAN_PROFILE").is_ok() {
            eprintln!("  terrain.ahead.blocks: strict {strict:.3}, half {half:.3}");
        }
        if strict < profiles::SLOPE_RELAX_GOAL && half > strict {
            return SlopeStart::CheckFirstRung;
        }
    }
    SlopeStart::Level(level)
}
/// Lowest of `terrain::LEVELS` at which the land of a town houses it:
/// `shortfall` gives the households a capacity plan of that land still misses
/// with the given housable share, densified to the culture's bounds (0 once it
/// houses them). 0 when the strict gates house the town or no plan exists;
/// when no level houses it, the first level that misses the fewest.
fn housing_relaxation(levels: &[f64; 4], mut shortfall: impl FnMut(f64) -> Option<f64>) -> f64 {
    let Some(strict) = shortfall(levels[0]) else { return 0.0 };
    let mut best = (terrain::LEVELS[0], strict);
    for (&level, &share) in terrain::LEVELS.iter().zip(levels).skip(1) {
        if best.1 <= 0.0 {
            break;
        }
        if let Some(missing) = shortfall(share)
            && missing < best.1
        {
            best = (level, missing);
        }
    }
    best.0
}

/// Capacity inputs for each growth epoch and the coarse survey of the same land.
/// The gate on the survey measures the land that growth takes.
pub(super) fn capacity_epochs_surveyed(
    site: &Site,
    cfg: &LayoutConfig,
    morph: &Morph,
    area: f64,
    surface: Surface<'_>,
) -> (Vec<capacity::Epoch>, Option<terrain::Survey>) {
    let (cells, step) = nominal_cells(site, cfg, area, surface);
    (capacity_epochs(site, cfg, morph, area, &cells), terrain_survey(site, cfg, morph, &cells, step, surface))
}

fn capacity_epochs(site: &Site, cfg: &LayoutConfig, morph: &Morph, area: f64, cells: &[(f64, f64, Point)]) -> Vec<capacity::Epoch> {
    let culture = if cfg.culture == "site" {
        &site.culture
    } else {
        &cfg.culture
    };
    let fractions = epoch_fractions(&epoch_densities(site, cfg, morph));
    // A block's slope is its steepest rim over its centroid: about 1.3 times
    // the ground gradient. Blocks steeper than the houses admit hold none.
    let slopes: Vec<f64> = {
        let mut v: Vec<f64> = cells.iter().map(|c| 1.3 * c.1).collect();
        v.sort_by(f64::total_cmp);
        v
    };
    // Blocks on a slope have less access pressure (`programme::prepare`
    // divides it by 1 + 3 × slope): the median slope of that land.
    let median = slopes.get(slopes.len() / 2).copied().unwrap_or(0.0);
    let max_slope = culture::mapping_for(culture, &cfg.programme.period)
        .map_or(0.15, |m| profiles::house_slope(culture, m.admissibility.max_slope, cfg.programme.slope_relax));
    let steep =
        slopes.iter().filter(|&&s| s > max_slope).count() as f64 / slopes.len().max(1) as f64;
    let access: Vec<(f64, f64)> = capacity::epoch_access(&fractions, area)
        .into_iter()
        .map(|(p, r)| (p / (1.0 + 3.0 * median), r))
        .collect();
    let mut previous = 0.0;
    fractions
        .iter()
        .zip(access)
        .enumerate()
        .map(|(epoch, (&f, (pressure, offset)))| {
            let (zone, name) = epoch_zone(cfg, culture, site.population, epoch);
            let share = f - previous;
            previous = f;
            capacity::Epoch {
                zone: zone.to_owned(),
                recipe: composition::recipe(culture, site.population, name),
                share,
                pressure,
                offset,
                steep,
                fields: if cfg.placement == "center" {
                    capacity::fringe_fields(previous - share, previous)
                } else {
                    0.0
                },
            }
        })
        .collect()
}

#[cfg(test)]
#[path = "capacity_tests.rs"]
mod capacity_tests;
