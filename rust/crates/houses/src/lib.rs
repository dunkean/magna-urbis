//! Architectural recipes and local building generation. Coordinates are meters.
//! Independent of terrain, browser bindings and rendering.
mod access;
pub mod admission;
pub mod admission_witness;
pub mod catalogue;
pub mod compact;
pub mod cultural_palettes;
// Experimental geometry kernel; no production admission uses its continuous
// rectangle certificate until native construction and terrain are integrated.
#[cfg(test)]
mod direct_convex_fit;
mod engine;
pub mod feasibility;
mod features;
pub mod functional_choices;
pub mod functional_programmes;
mod frontage_contact;
pub mod geometry;
mod layouts;
pub mod model;
mod morphology;
pub mod native_candidate;
#[cfg(test)]
mod native_single_fit;
pub mod placement;
pub mod plans;
pub mod programme;
pub mod roofs;
mod rigid_translation_fit;
mod strip_programme_budget;
pub mod style_index;
pub mod validation;
mod vertical_footprint;
pub mod wall_geometry;
pub mod workshop;
pub use engine::{
    ResolvedArchitecture, enrich_architecture, generate_batch, preflight, resolve_architecture,
};

pub const SCHEMA_VERSION: &str = "2";
// Native portal axes now require opposed walk landings. Old compact plans and
// minimum-witness identities must not silently reuse the former access graph.
pub const GENERATOR_VERSION: &str = "houses-3";

mod gallery_components;
