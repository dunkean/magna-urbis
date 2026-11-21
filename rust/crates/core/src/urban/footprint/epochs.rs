//! Growth epoch tissues, gross densities and land budgets.
use crate::urban::{LayoutConfig, Morph, Point, Site, composition, forms, profiles, with_tissue};
use std::f64::consts::PI;

/// A walled, palisaded or hedged settlement. A wall is paid for by its
/// perimeter, so what stands inside is packed: the enclosed land uses the
/// culture's compact (core) tissue, never the open-village one.
pub(in crate::urban) fn enclosed(cfg: &LayoutConfig, culture: &str, population: u32) -> bool {
    let profile = profiles::settlement_profile(culture, population, cfg.footprint.epochs);
    matches!(
        profiles::fortification(profile, &cfg.fortification, population),
        "wall" | "palisade" | "hedge"
    )
}
/// Zone and recipe of one growth epoch: the founding core, its first extension,
/// then the periphery. Open villages keep a single village tissue; an enclosed
/// one is built as the culture's compact core inside its wall. A style with a
/// suburb ring (`forms::kit` `suburb_ring`, the modern towns) builds its
/// outermost epoch with its faubourg tissue in the `edge` zone: detached
/// houses on small lots around the denser core.
pub(in crate::urban) fn epoch_zone<'a>(
    cfg: &'a LayoutConfig,
    culture: &str,
    population: u32,
    epoch: usize,
) -> (&'a str, &'static str) {
    let small = crate::settlements::demographics::below(population, "town");
    let suburb = !small
        && cfg.zone == "auto"
        && epoch > 0
        && epoch + 1 >= cfg.footprint.epochs.max(2)
        && forms::kit::traits(culture).suburb_ring;
    let zone = if cfg.zone != "auto" {
        cfg.zone.as_str()
    } else if small && enclosed(cfg, culture, population) {
        "core"
    } else if small {
        "village"
    } else if suburb {
        "edge"
    } else {
        ["core", "middle", "edge"][epoch.min(2)]
    };
    let recipe = if small {
        "village"
    } else if epoch == 0 {
        "core"
    } else if suburb {
        "faubourg"
    } else {
        "ring"
    };
    (zone, recipe)
}
/// Gross inhabitants/hectare of each growth epoch, streets and reservations
/// included. Each epoch reads its own catalogue density (core > middle > edge),
/// so the old centre packs more people on less land than the periphery. Larger
/// cities densify their historic core further (Paris 1300, Fez, Chang'an), up to
/// a bounded 1.5x. An explicit gross density stays uniform, as before.
pub(in crate::urban) fn epoch_densities(site: &Site, cfg: &LayoutConfig, morph: &Morph) -> Vec<f64> {
    let epochs = cfg.footprint.epochs.max(1);
    if cfg.footprint.gross_density > 0.0 {
        return vec![cfg.footprint.gross_density; epochs];
    }
    let culture = if cfg.culture == "site" {
        &site.culture
    } else {
        &cfg.culture
    };
    let boost = (1.0 + 0.25 * (site.population as f64 / 5000.0).max(1.0).log10()).min(1.5);
    let inside_wall = crate::settlements::demographics::below(site.population, "town") && enclosed(cfg, culture, site.population);
    (0..epochs)
        .map(|epoch| {
            let (zone, name) = epoch_zone(cfg, culture, site.population, epoch);
            let recipe = composition::recipe(culture, site.population, name);
            let local = composition::phase_morph(
                culture,
                &recipe,
                zone,
                &cfg.preset,
                &cfg.recipe,
                cfg.density,
                &cfg.params,
                "quarters",
            )
            .unwrap_or_else(|_| morph.clone());
            let base = local.value["density"][zone]
                .as_f64()
                .or_else(|| morph.value["density"][zone].as_f64())
                .unwrap_or(60.0);
            let lift = match epoch {
                0 => boost,
                1 => 1.0 + (boost - 1.0) * 0.5,
                _ => 1.0,
            };
            let density = (base * cfg.density * lift).clamp(5.0, 600.0);
            if inside_wall {
                density.max(ENCLOSED_DENSITY)
            } else {
                density.max(open_village_floor(site.population))
            }
        })
        .collect()
}
/// Cumulative land fractions of the epochs. Every epoch houses an equal share of
/// the population, so a denser epoch receives proportionally less land.
pub(super) fn epoch_fractions(densities: &[f64]) -> Vec<f64> {
    let total: f64 = densities.iter().map(|d| 1.0 / d.max(0.001)).sum();
    let mut cumulative = 0.0;
    densities
        .iter()
        .map(|d| {
            cumulative += 1.0 / d.max(0.001) / total;
            cumulative.min(1.0)
        })
        .collect()
}

/// An enceinte encloses at least a handful of the culture's own blocks (a few
/// blocks, within 2.5x the density budget) and, for a planned grid, enough land
/// to lay the grid at all: below that the streets and blocks cannot be drawn.
/// The wall's cost comes from its perimeter, so the budget stays the target;
/// the floor only guards degenerate sizes.
const ENCLOSED_BLOCKS: f64 = 4.0;
/// Gross inhabitants/hectare an enceinte is sized for at village scale: a wall
/// is paid per metre, so it never encloses open land.
const ENCLOSED_DENSITY: f64 = 150.0;
/// m2 of walled land per inhabitant a planned grid needs to be drawn at all (scaled with the
/// population, never a flat minimum that would inflate a small village's wall).
const ENCLOSED_GRID_PER_INHABITANT: f64 = 70.0;
/// Gross inhabitants/hectare below which a small open village is not spread:
/// the catalogue's 25-40 hab./ha scatters a few hundred people over 15-25 ha of
/// large lots, a string of farms rather than a village. The floor holds up to
/// 600 inhabitants and fades out by 1200, where the catalogue's town tissue
/// takes over; denser cultures keep their own density.
const OPEN_VILLAGE_DENSITY: f64 = 70.0;
fn open_village_floor(population: u32) -> f64 {
    OPEN_VILLAGE_DENSITY * ((1200.0 - population as f64) / 600.0).clamp(0.0, 1.0)
}
fn enclosed_floor(site: &Site, cfg: &LayoutConfig, morph: &Morph, target: f64) -> f64 {
    let culture = if cfg.culture == "site" {
        &site.culture
    } else {
        &cfg.culture
    };
    if cfg.footprint.budget == "radius"
        || !crate::settlements::demographics::below(site.population, "town")
        || !enclosed(cfg, culture, site.population)
    {
        return target;
    }
    let (zone, _) = epoch_zone(cfg, culture, site.population, 0);
    let pattern = profiles::settlement_profile(culture, site.population, cfg.footprint.epochs).pattern;
    // Rings of compounds (kraal, longhouse villages) have no street blocks.
    let blocks = if matches!(pattern, "radial" | "linear" | "dispersed") {
        0.0
    } else {
        // A grid's ward lines and blocks scale down with its land (macroplan), so only a
        // few blocks are required, never the culture's full-size module.
        if pattern == "grid" {
            (3.0 * morph.range("blockSize", zone)[1]).min(1.3 * target)
        } else {
            (ENCLOSED_BLOCKS * morph.range("blockSize", zone)[1]).min(1.6 * target)
        }
    };
    let grid = if pattern == "grid" {
        ENCLOSED_GRID_PER_INHABITANT * site.population as f64
    } else {
        0.0
    };
    target.max(blocks).max(grid)
}
pub(super) fn budget(site: &Site, cfg: &LayoutConfig, morph: &Morph, radius: f64) -> (f64, f64) {
    // Equal population per epoch: the overall gross density is their harmonic mean.
    let densities = epoch_densities(site, cfg, morph);
    let density = (densities.len() as f64
        / densities.iter().map(|d| 1.0 / d.max(0.001)).sum::<f64>())
    .max(0.001);
    let target = if cfg.footprint.budget == "radius" {
        PI * radius * radius
    } else {
        site.population as f64 / density * 10_000.0
    };
    let target = enclosed_floor(site, cfg, morph, target);
    let target = target.max(1.0);
    let density = if cfg.footprint.budget == "radius" {
        site.population as f64 * 10_000.0 / target
    } else {
        density
    };
    (target, density)
}
/// The land (m²) the town plan budgets for `population` people of `culture` under the default
/// layout settings: `budget` with the founding morph, as `slope_relax_ahead` sizes it. `None`
/// when the culture's morph does not resolve. Placement reads it to refuse a site too small.
pub(in crate::urban) fn planned_land(culture: &str, population: u32) -> Option<f64> {
    let cfg = LayoutConfig { culture: "site".into(), ..LayoutConfig::default() };
    let site = Site {
        key: String::new(),
        name: String::new(),
        population,
        culture: culture.into(),
        center: Point { x: 0.0, y: 0.0 },
        radius: crate::settlements::extent_radius(population),
        neighbours: Vec::new(),
    };
    let small = crate::settlements::demographics::below(population, "town");
    let recipe = composition::recipe(culture, population, if small { "village" } else { "core" });
    let zone = if small && !enclosed(&cfg, culture, population) { "village" } else { "core" };
    let morph = composition::phase_morph(
        culture, &recipe, zone, &cfg.preset, &cfg.recipe, cfg.density, &cfg.params, "quarters",
    )
    .ok()?;
    let morph = with_tissue(morph, &cfg.tissue);
    Some(budget(&site, &cfg, &morph, site.radius).0)
}
