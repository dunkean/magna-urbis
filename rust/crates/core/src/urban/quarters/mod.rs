//! Draw and refine the quarters, streets and blocks of one settlement.

mod blocks;
mod capacity;
mod closes;
mod cut;
mod field;
mod frames;
mod frontage;
mod initial_plan;
mod pass;
mod service;
mod speculative;
mod squares;
mod hairpins;
mod stairs;
mod street_finish;
mod street_index;
mod streets;
mod subdivision;
mod tissue;
mod vacancy;

#[cfg(test)]
mod stage_tests;

pub(super) use capacity::{generate, probe_quarter};
pub(super) use frames::outline_frame;
#[cfg(test)]
pub(super) use frames::enclosure_frame;
