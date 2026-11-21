//! Fortification styles, curtain traces, defensive works and their fit to the town layout.

mod build;
mod cave;
mod crossings;
mod dead_gates;
mod extension;
mod faubourg;
mod gate_budget;
mod gate_works;
mod geometry;
mod heights;
mod moat;
mod options;
mod outworks;
mod parameters;
mod pockets;
mod reconcile;
mod reserve;
mod settle;
mod shore;
mod street_clearance;
mod style;
mod towers;
mod trace;

pub(super) use build::build;
pub(super) use cave::cave_circuits;
pub(super) use crossings::enforce;
pub(super) use dead_gates::drop_dead_gates;
pub(super) use extension::{attach, dedupe_shared, inner_gates, lopsided, shared_length, trim_shared};
pub(super) use gate_budget::{Circuit, decide as decide_gates, divert};
pub(super) use geometry::{ribbon_half, terrain};
pub(super) use heights::{heights_castle, wrap_castle};
pub(super) use options::{finish_options, keeps_citadel, prepare_options, service_cost};
pub(super) use parameters::{parameter_trace, port_walls, valid_parameters, wall_extension};
pub(super) use pockets::straight_across;
pub(super) use reserve::yield_reserve;
pub(super) use settle::{settle, sync_gates};
pub(super) use street_clearance::{Near, Predicted};
pub(super) use style::{Inputs, STYLES, family, resolve};
pub(super) use trace::{
    bastioned_trace, curtain_trace, hill_trace, square_trace, trace_enclosures, village_trace,
};

#[cfg(test)]
mod reserve_tests;
#[cfg(test)]
mod settle_tests;
#[cfg(test)]
mod style_tests;
#[cfg(test)]
mod test_fixtures;
#[cfg(test)]
mod trace_tests;
#[cfg(test)]
mod works_tests;
