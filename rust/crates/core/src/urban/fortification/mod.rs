//! Fortification styles, curtain traces, defensive works and their fit to the town layout.

/// Refit and estate traces lack a growth-phase ordinal. Key their unedited source ring
/// independently of its starting vertex and the number of neighbouring circuits.
pub(super) fn trace_key(purpose: &str, path: &[super::Point]) -> String {
    let ring = if path.first() == path.last() && !path.is_empty() { &path[..path.len()-1] } else { path };
    // FNV-1a in ring order, starting at its lexicographically smallest point.
    let start = ring.iter().enumerate().min_by(|(_, a), (_, b)| a.x.total_cmp(&b.x).then(a.y.total_cmp(&b.y))).map_or(0, |(i, _)| i);
    let mut hash = 0xcbf29ce484222325u64;
    for p in ring[start..].iter().chain(&ring[..start]) {
        for coord in [p.x, p.y] {
            for byte in ((coord * 1000.0).round() as i64).to_le_bytes() {
                hash = (hash ^ u64::from(byte)).wrapping_mul(0x100000001b3);
            }
        }
    }
    format!("{purpose}-{hash:016x}")
}

mod build;
pub(super) mod canal_moat;
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
mod water;

pub(super) use build::build;
pub(super) use cave::cave_circuits;
pub(super) use crossings::enforce;
pub(super) use dead_gates::drop_dead_gates;
pub(super) use extension::{attach, dedupe_shared, drop_twins, inner_gates, lopsided, retained, shared_length, trim_shared};
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
pub(super) use water::{audit_layout as water_audit, kept_fronts, over_inlets, parted_by_water, walled_on_water, water_fronts};

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
