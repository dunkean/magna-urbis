//! Budgeted town footprints built from planned outlines, ribbons or accessible growth.

mod archetypes;
pub(in crate::urban) mod capacity;
mod contours;
pub(super) mod crossings;
mod epochs;
mod generate;
mod geometry;
mod growth;
mod lattice;
mod ribbon;
mod site;
mod sparse;
mod survey;
mod terrain;

pub(super) use epochs::{enclosed, epoch_densities, epoch_zone, planned_land};
pub(super) use generate::generate;
pub(super) use geometry::union;
pub(super) use site::orientation;
pub(super) use survey::slope_relax_ahead;

use crate::urban::{Shape, Street, UrbanStructure};

pub(super) struct Footprint {
    pub structure: UrbanStructure,
    /// Chronological, disjoint attributed land. Earlier boundaries survive.
    pub phases: Vec<Vec<Shape>>,
    pub radius: f64,
    pub warnings: Vec<String>,
    /// Intended corridors are routed by the armature stage before acceptance.
    pub guides: Vec<Street>,
    /// Validated access through open land; never counted as an occupied ribbon.
    pub links: Vec<Street>,
    /// Housable shares of the land the accessible growth first took, before
    /// any terrain correction (`terrain`); None for other mechanisms.
    pub land: Option<terrain::Survey>,
}

#[cfg(test)]
mod contour_tests;
#[cfg(test)]
mod generation_tests;
#[cfg(test)]
#[path = "../pnw_resolved_ribbon_tests.rs"]
mod pnw_resolved_ribbon_tests;
