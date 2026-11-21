//! Adapts growth engine inputs and outputs to the core urban stages.

mod capacity;
mod layout;
pub(super) mod specs;
mod tail;

#[cfg(test)]
mod tests;

use magna_urbis_town::growth::{self, Verdict};
use magna_urbis_town::{RegionalRoad, RoadSource, TownPlan, TownRequest, TownSite, charter::PlannedSetting};

use super::{Layout, LayoutConfig, ParcelConfig, Site, Street, Surface, footprint, kinds};

/// Return a growth layout when the requested site can be handled by the growth engine.
pub(super) fn generate(
    seed: &str,
    site: &Site,
    config: &LayoutConfig,
    surface: Surface<'_>,
    regional_roads: &[Street],
    road_sources: &[Option<RoadSource>],
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
    // The households the programme will ask for: the culture's household size at this
    // population (4.5 persons in a European town of 20,000, 3.7 in a village). Growth counts
    // in households of its own size, so it is asked for the population that makes the same
    // number of households, and its clock stops where the programme's demand is met.
    let wanted = footprint::capacity::households(culture, site.population);
    let population = (wanted * specs.growth.household_size).round().min(f64::from(u32::MAX)) as u32;
    let mut roads: Vec<RegionalRoad> = Vec::new();
    for (index, street) in regional_roads.iter().enumerate() {
        if street.path.len() < 2 {
            continue;
        }
        let rank = street.rank.min(usize::from(u8::MAX)) as u8;
        let Some(source) = road_sources.get(index).and_then(Option::as_ref) else {
            roads.push(RegionalRoad::from_polyline(format!("street:{index}"), street.path.clone(), rank));
            continue;
        };
        // The bridge splits a source segment at crossing spans for Classic. Rejoin its
        // contiguous runs so Growth imports it as one chain.
        if let Some(previous) = roads.last_mut()
            && previous.id == source.id
            && previous.rank == rank
            && previous.stations.last() == source.stations.first()
            && previous.points.last() == street.path.first()
        {
            previous.points.extend_from_slice(&street.path[1..]);
            previous.stations.extend_from_slice(&source.stations[1..]);
        } else {
            roads.push(RegionalRoad {
                id: source.id.clone(),
                points: street.path.clone(),
                stations: source.stations.clone(),
                rank,
            });
        }
    }
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
            population,
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
    let mut housed = housed_by_lots(seed, &layout);
    if std::env::var_os("URBAN_PROFILE").is_some() {
        eprintln!("  growth.housed first={housed:.0} wanted={wanted:.0} clock={:.0}", plan.clock.households());
    }
    if let Verdict::Reopen { .. } = growth::verdict(housed, wanted, false) {
        let counted = plan.stop.target.households().max(1.0);
        let ratio = (wanted / housed.max(1.0)).min(REOPEN_RATIO);
        if let Ok(more) = growth::reopen(&request, &capacity, &plan, counted * (ratio - 1.0))
            && let Some(next) = finish(&more)
        {
            let homes = housed_by_lots(seed, &next);
            if std::env::var_os("URBAN_PROFILE").is_some() {
                eprintln!("  growth.housed reopened={homes:.0} clock={:.0}", more.clock.households());
            }
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

/// Households the town houses at the end of the chain: the parcels stage's cut and allocation,
/// then the programme stage's reallocation of those lots, on the layout as the engine hands it
/// on (serialised and read back, which rounds its coordinates as the parcels stage sees them).
fn housed_by_lots(seed: &str, layout: &Layout) -> f64 {
    let Some(layouts) = serde_json::to_vec(std::slice::from_ref(layout))
        .ok()
        .and_then(|text| serde_json::from_slice::<Vec<Layout>>(&text).ok())
    else {
        return 0.0;
    };
    super::generate_parcels(seed, &layouts, &ParcelConfig::default())
        .and_then(|parts| super::programme::reallocate(&layouts, &parts))
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
