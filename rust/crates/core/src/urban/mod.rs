//! The town engine: a settlement's quarters, streets, blocks and walls
//! (`generate_quarters`), then the lots of its blocks (`generate_parcels`).
//! Geometry, cultural parameters and deterministic partitioning run only in Rust.
//!
//! - `types`: the products (`Layout`, `Partition`) and the records they hold;
//! - `config`, `overrides`: the stage configurations and the user edits they carry;
//! - `surface`: the terrain a town is laid on;
//! - `morph`: the urban catalogue and a culture's resolved morphology;
//! - `pipeline`: the ordered stages of both calls;
//! - `profile`: the profiling laps (`URBAN_PROFILE`).
#[allow(dead_code)] // data for later phases, partly consumed
pub(crate) mod activities;
mod access;
pub mod building_sites;
mod house_mix;
pub mod display;
mod pack;
mod pipeline;
pub mod parcel_pack;
mod composition;
mod deep_blocks;
// Structural user edits (shape, delete, reroll): urban/edits.rs.
mod edits;
mod enclosure;
mod farmsteads;
pub use edits::quarter_removed;
pub mod culture;
pub mod programme;
pub use culture::{CultureMapping, UrbanAdmissibility};
pub use programme::{ProgrammeContext, UrbanProgramme};
mod footprint;
mod forms;
mod fortification;
mod fringe;
mod geography;
mod generation_limits;
mod springs;
mod shanty;
mod lagoon;
mod geometry;
mod growth;
pub use growth::grown_at;
mod harbour_furniture;
mod massing;
pub use geography::{Geography, VectorGeography};
mod influences;
pub mod kinds;
mod macroplan;
mod network;
pub(crate) mod par;
mod probe_cache;
mod parcels;
mod profiles;
mod quarters;
#[cfg(test)]
mod refonte_tests;
#[cfg(test)]
mod stilt_ground_tests;
#[cfg(test)]
mod small_settlement_tests;
#[cfg(test)]
mod village_chain_tests;
#[cfg(test)]
mod site_options_tests;
#[cfg(test)]
mod regression;
#[cfg(test)]
mod panic20k_tests;
#[cfg(test)]
mod reroll_panic_tests;
pub mod roles;
mod routing;
mod trim;
mod slopes;
mod street_graph;
mod widths;
pub(crate) mod warnings;
pub mod neighbours;
mod zone_blend;
mod config;
mod morph;
mod overrides;
mod profile;
mod surface;
mod types;

pub use config::{FootprintConfig, LayoutConfig, ParcelConfig, StyleSheet};
pub use magna_urbis_geom::{Point, Shape};
pub use morph::{culture_of_villages, culture_site_pref, culture_site_weight};
pub use overrides::{
    BlockEdits, BlockOrigin, BlockOverride, OriginalBlock, OriginalQuarter, ParcelOverride, ParcelOverrides, PhaseOverride,
    QuarterEdits, QuarterOverride, QuarterPart, UrbanOverrides,
};
pub use surface::{HeightInterpolation, Surface};
#[cfg(feature = "street-topology")]
pub use street_graph::{street_topology, StreetTopology};
pub use types::{
    Attached, Block, CapacityPlan, Enclosure, Gatehouse, GrowthPhase, Layout, MoatSpec, Parcel, ParcelAccess, ParcelContact, Partition,
    PartitionDiagnostics, PortDistrict, PreparedBlocks, Quarter, Site, Street, Tower, UrbanCenter, UrbanDistrict, UrbanEvent,
    UrbanMetrics, UrbanStructure, Work,
};
use morph::{Morph, catalogue, resolve, with_tissue};

/// Land (m²) the town plan budgets for a place of this culture and population (default layout
/// settings); `None` when the culture's morph does not resolve. Read by settlement placement.
pub fn planned_land(culture: &str, population: u32) -> Option<f64> {
    footprint::planned_land(culture, population)
}

/// The finished layout of each site, in input order, laid on `surface` along
/// the regional `roads`.
pub fn generate_quarters(
    seed: &str,
    sites: &[Site],
    config: &LayoutConfig,
    surface: Surface<'_>,
    roads: &[Street],
) -> Result<Vec<Layout>, String> {
    pipeline::validate(config, surface, roads, sites)?;
    // Repeated programme/cadastre probes share exact sub-results (`probe_cache`).
    let _probe_scope = probe_cache::Scope::open();
    let mut crossing_roads = roads.to_vec();
    network::bridge_water(&mut crossing_roads, surface, config.max_street_grade);
    let roads = crossing_roads.as_slice();
    // Sites are laid out independently (each from its own seeded streams), in
    // parallel, and returned in input order. As in a serial loop, the first
    // error in that order wins and an invalid site stops the sites after it.
    let valid = &sites[..pipeline::valid_sites(sites, surface)];
    let laid = par::map(valid, |_, site| pipeline::lay_out(seed, site, valid, config, surface, roads));
    let out = laid.into_iter().collect::<Result<Vec<_>, _>>()?;
    if valid.len() < sites.len() {
        return Err("Settlement urbain invalide".into());
    }
    Ok(out)
}

/// The partition of each layout into lots, with its programme allocated.
pub fn generate_parcels(seed: &str, layouts: &[Layout], config: &ParcelConfig) -> Result<Vec<Partition>, String> {
    pipeline::validate_parcels(config)?;
    // Layouts are cut independently, in parallel; the first error in input
    // order wins, as in a serial loop.
    par::map(layouts, |_, input| pipeline::cut_parcels(seed, input, config)).into_iter().collect()
}

/// The layout a partition's lots index: `layout` with the partition's prepared
/// blocks (structural block edits), as every later stage must read it.
pub fn partition_layout(layout: &Layout, partition: &Partition) -> Layout {
    let mut l = layout.clone();
    if let Some(p) = &partition.prepared {
        l.blocks = p.blocks.clone();
        if p.edits.is_some() || l.config.as_ref().is_some_and(|c| c.block_edits.is_some()) {
            l.config.get_or_insert_with(Default::default).block_edits = p.edits.clone();
        }
    }
    l
}
