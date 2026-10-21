//! Architectural recipes and local building generation. Coordinates are meters.
//! Independent of terrain, browser bindings and rendering.
mod access;
pub mod admission;
pub mod catalogue;
mod engine;
mod features;
pub mod geometry;
mod layouts;
pub mod model;
pub mod placement;
pub mod roofs;
pub mod validation;
mod vertical_footprint;
pub mod wall_geometry;
pub mod workshop;
pub use engine::{
    ResolvedArchitecture, enrich_architecture, generate_batch, preflight, resolve_architecture,
};

pub const SCHEMA_VERSION: &str = "2";
pub const GENERATOR_VERSION: &str = "houses-2";

mod gallery_components;
