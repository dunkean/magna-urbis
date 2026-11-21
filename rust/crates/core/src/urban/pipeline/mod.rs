//! The quarter pipeline of one settlement: the ordered stages that turn a site
//! into a finished `Layout`, and the ladders that run them again with other
//! settings when a plan houses too few of its households.
//!
//! `lay_out` runs, for one site:
//! 1. the preparation of the town (`Town`): neighbour cores, relocation, the
//!    roads joined to the neighbours, the site archetype, the kind grammar and
//!    the stilt ground;
//! 2. the slope relaxation ladder (`ladders::relax_slopes`), whose rungs are
//!    formal plans (`plan::formal`): the quarter edits wrapper around the
//!    quarter pass (`plan`, with the stilt balance) and its finish (`finish`);
//! 3. the completion of the chosen plan (`complete::complete`);
//! 4. the slope wards ladder (`ladders::slope_wards`);
//! 5. the household ladder (`ladders::house_households`);
//! 6. the settlement against the neighbours' land (`settle_neighbours`).
//!
//! Every stage reads the town context and mutates the layout in place; the
//! profiling laps (`URBAN_PROFILE`) keep one label per stage.
mod complete;
mod finish;
mod ladders;
mod plan;
mod validate;

pub(super) use ladders::{HOUSED_FROM, housable_share};
pub(super) use validate::{valid_sites, validate};

use super::geography::StiltGround;
use super::kinds::{self, Kind};
use super::{LayoutConfig, Layout, ParcelConfig, Site, Street, Surface, edits, geography, neighbours};

/// One settlement as the pipeline plans it, fixed for every stage and every
/// rung of the ladders.
pub(super) struct Town<'a> {
    pub seed: &'a str,
    /// The town's own seed stream (`{seed}\u{1}settlement:{key}`).
    pub key_seed: String,
    /// The site as planned: cored by its neighbours, relocated, and moved
    /// onto its stilt ground when it has one.
    pub site: &'a Site,
    /// Every valid site of the call, for the slope wards' neighbour test.
    pub sites: &'a [Site],
    /// A user-fixed site keeps its centre and its small kind's full plan.
    pub fixed: bool,
    /// The user's configuration with the site archetype applied: the kind
    /// stamps and finishes read it (`kinds::stamp`, `kinds::finish`).
    pub original: &'a LayoutConfig,
    /// The configuration the settlement kind resolved (`kinds::effective`).
    pub config: &'a LayoutConfig,
    pub kind: Kind,
    pub culture: &'a str,
    /// The planning ground: the stilt platform's surface when there is one.
    pub surface: Surface<'a>,
    /// The physical terrain.
    pub physical: Surface<'a>,
    /// The regional roads, bridged over water and joined to the neighbours.
    pub roads: &'a [Street],
    pub stilt: Option<&'a StiltGround>,
    pub neighbour_land: Option<neighbours::Mask>,
}

/// The finished layout of one site; `sites` are every valid site of the call.
pub(super) fn lay_out(
    seed: &str,
    site: &Site,
    sites: &[Site],
    config: &LayoutConfig,
    surface: Surface<'_>,
    roads: &[Street],
) -> Result<Layout, String> {
    // A town with neighbours starts from free ground, and its roads stop at
    // their land and lead on into their edge streets (`neighbours`). Later
    // places it reserves become cores of land it flows around.
    let cored = neighbours::reserve_cores(seed, site, config, surface, roads);
    let site = cored.as_ref().unwrap_or(site);
    let fixed = config.fixed_sites.contains(&site.key);
    let relocated = if fixed { None } else { neighbours::relocate(site, surface) };
    let site = relocated.as_ref().unwrap_or(site);
    let joined_roads = neighbours::roads(site, roads);
    let roads = joined_roads.as_deref().unwrap_or(roads);
    let site_config;
    let original = if let Some(archetype) = config.site_archetypes.get(&site.key) {
        let mut c = config.clone();
        c.site_archetype = archetype.clone();
        c.site_archetypes.clear();
        site_config = c;
        &site_config
    } else {
        config
    };
    // The settlement kind sets the macro grammar; the layout keeps the
    // user's configuration (`kinds::finish`).
    let (effective, kind) = kinds::effective(site, original, roads);
    let culture = if effective.culture == "site" { &site.culture } else { &effective.culture };
    // Resolve the effective shore once for every plan/finish path, including
    // small kinds and quarter edits. The programme must see the same ground.
    let stilt = geography::stilt_ground(site, culture, surface).map(|mut ground| {
        if fixed {
            ground.site.center = site.center;
        }
        ground
    });
    let (planned, planning) = stilt.as_ref().map_or((site, surface), |ground| (&ground.site, ground.surface(surface)));
    let town = Town {
        seed,
        key_seed: format!("{seed}\u{1}settlement:{}", planned.key),
        site: planned,
        sites,
        fixed,
        original,
        config: &effective,
        kind,
        culture,
        surface: planning,
        physical: surface,
        roads,
        stilt: stilt.as_ref(),
        neighbour_land: neighbours::Mask::of(planned),
    };
    let relaxed = ladders::relax_slopes(&town)?;
    let layout = complete::complete(&town, relaxed.layout, relaxed.baseline, &relaxed.chosen);
    let layout = ladders::slope_wards(&town, layout, &relaxed.chosen, relaxed.ahead);
    let layout = ladders::house_households(&town, layout, &relaxed.first);
    Ok(settle_neighbours(&town, layout))
}

/// The town's lots against its neighbours' land (`neighbours::settle`), on the
/// layout and on the baseline its quarter edits keep, then its land claim.
fn settle_neighbours(town: &Town<'_>, mut layout: Layout) -> Layout {
    let baseline = if !town.site.neighbours.is_empty() {
        edits::quarter_baseline::restore(&layout, &ParcelConfig::default()).map(|(layout, _)| layout)
    } else {
        None
    };
    neighbours::settle(town.seed, &mut layout, town.site, town.surface);
    if let Some(mut baseline) = baseline {
        neighbours::settle(town.seed, &mut baseline, town.site, town.surface);
        edits::quarter_baseline::retain(&mut layout, baseline);
    }
    layout.claim = neighbours::claim(&layout);
    layout
}
