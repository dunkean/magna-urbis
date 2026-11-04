//! Magna Urbis generation core. Terrain, erosion and hydrology live in `magna-urbis-terrain`
//! (re-exported here, so `magna_urbis_core::TerrainGenerator` etc. keep working);
//! resources, settlements and urban stay in this crate.
mod rng;
pub mod resources;
pub mod settlements;
pub mod urban;

pub use magna_urbis_terrain::*;
