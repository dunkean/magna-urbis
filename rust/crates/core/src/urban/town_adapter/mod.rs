//! Adapts growth engine inputs and outputs to the core urban stages.

mod capacity;
mod layout;
pub(super) mod specs;
mod tail;

#[cfg(test)]
mod tests;

use magna_urbis_town::growth::{self, Verdict};
use magna_urbis_town::{TownPlan, TownRequest, TownSite, charter::PlannedSetting};

use super::{Layout, LayoutConfig, ParcelConfig, Site, Street, Surface, kinds};

/// Return a growth layout when the requested site can be handled by the growth engine.
pub(super) fn generate(
    seed: &str,
    site: &Site,
    config: &LayoutConfig,
    surface: Surface<'_>,
    regional_roads: &[Street],
) -> Option<Layout> {
    let site_config;
    let config = if let Some(archetype) = config.site_archetypes.get(&site.key) {
        site_config = LayoutConfig {
            site_archetype: archetype.clone(),
            site_archetypes: Default::default(),
            ..config.clone()
        };
        &site_config
    } else {
        config
    };
    let culture = if config.culture == "site" {
        &site.culture
    } else {
        &config.culture
    };
    let specs = specs::build(culture, config).ok()?;
    let roads: Vec<_> = regional_roads.iter().map(|s| s.path.clone()).collect();
    let neighbour_claims: Vec<_> = site
        .neighbours
        .iter()
        .flat_map(|c| c.land.iter().cloned())
        .collect();
    let key_seed = format!("{seed}\u{1}settlement:{}", site.key);
    let radius = if config.radius > 0.0 {
        Some(config.radius)
    } else if config.footprint.budget == "radius" {
        Some(site.radius * config.radius_scale)
    } else {
        None
    };
    let request = TownRequest {
        site: TownSite {
            center: site.center,
            pinned: config.fixed_sites.contains(&site.key),
            radius,
            population: site.population,
            culture: culture.clone(),
            archetype: (!config.site_archetype.is_empty()).then(|| config.site_archetype.clone()),
        },
        specs: &specs,
        terrain: &surface,
        regional_roads: &roads,
        neighbour_claims: &neighbour_claims,
        seed: &key_seed,
        planned: PlannedSetting::Auto,
    };
    let capacity = capacity::QuarterCapacity {
        seed: &key_seed,
        site_key: &site.key,
        culture,
        config,
        surface,
    };
    let kind = kinds::resolve(site, config, regional_roads);
    let finish = |plan: &TownPlan| -> Option<Layout> {
        let mut layout = layout::build(plan, site, config, culture).ok()?;
        tail::finish(seed, &key_seed, &mut layout, site, config, kind, surface).ok()?;
        layout.warnings.extend(plan.warnings.iter().cloned());
        Some(layout)
    };
    let plan = growth::generate(&request, &capacity).ok()?;
    let mut layout = finish(&plan)?;
    // The final allocation on the real cut decides (design 3.3): a town housing at least 90 % of
    // its households is kept, with a warning when short; below that growth reopens once at its
    // cursor, for the households missing scaled by how far the birth counts were off.
    let wanted = growth::target_households(&request);
    let mut housed = housed_by_lots(seed, &layout);
    if let Verdict::Reopen { .. } = growth::verdict(housed, wanted, false) {
        let counted = plan.stop.target.households().max(1.0);
        let ratio = (wanted / housed.max(1.0)).min(REOPEN_RATIO);
        if let Ok(more) = growth::reopen(&request, &capacity, &plan, counted * (ratio - 1.0))
            && let Some(next) = finish(&more)
        {
            let homes = housed_by_lots(seed, &next);
            if homes > housed {
                (layout, housed) = (next, homes);
            }
        }
    }
    if let Verdict::Short(line) = growth::verdict(housed, wanted, true) {
        layout.warnings.push(line);
    }
    Some(layout)
}

/// Households the town's lot stage houses: the published cut and its allocations, as the
/// parcels stage runs them on this layout.
fn housed_by_lots(seed: &str, layout: &Layout) -> f64 {
    super::generate_parcels(seed, std::slice::from_ref(layout), &ParcelConfig::default())
        .map_or(0.0, |parts| {
            parts
                .iter()
                .filter_map(|p| p.programme.as_ref())
                .flat_map(|p| &p.allocations)
                .map(|a| a.households)
                .sum()
        })
}

/// The most a reopening multiplies a town's count by.
const REOPEN_RATIO: f64 = 3.0;
