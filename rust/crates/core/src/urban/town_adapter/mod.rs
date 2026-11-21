//! Adapts growth engine inputs and outputs to the core urban stages.

mod capacity;
mod layout;
pub(super) mod specs;
mod tail;

#[cfg(test)]
mod tests;

use magna_urbis_town::{TownRequest, TownSite, charter::PlannedSetting};

use super::{Layout, LayoutConfig, Site, Street, Surface, kinds};

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
    let plan = magna_urbis_town::generate(request, &capacity).ok()?;
    let mut layout = layout::build(&plan, site, config, culture).ok()?;
    let kind = kinds::resolve(site, config, regional_roads);
    tail::finish(seed, &key_seed, &mut layout, site, config, kind, surface).ok()?;
    layout.warnings.extend(plan.warnings);
    Some(layout)
}
