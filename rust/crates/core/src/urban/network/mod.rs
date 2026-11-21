//! Street network construction and cleanup between the town layout stages.

mod analysis;
mod banks;
mod bridge_construction;
mod bridge_selection;
mod crossing_approaches;
mod curtains;
mod ends;
mod exits;
mod hierarchy;
mod junctions;
mod parallel;
mod reservations;
mod spatial;
mod street;
mod wall_streets;
mod water_clearance;
#[path = "../network_policy.rs"]
mod policy;
#[path = "../network_site_options.rs"]
mod site_options;
#[cfg(test)]
mod tests;

pub(super) use analysis::dead_ends;
pub(super) use banks::{join_bank_networks, tie_banks_to_road};
pub(super) use bridge_construction::{bridge_water, bridge_water_on_ground};
#[cfg(test)]
pub(super) use bridge_selection::select_bridges;
pub(super) use bridge_selection::{select_bridges_graded, village_crossings};
pub(super) use crossing_approaches::join_crossings;
pub(super) use ends::{polish_ends, seat_mouths, square_ends, weld_ends};
pub(super) use exits::{ensure_regional_access, resolve_exits};
pub(super) use hierarchy::{hierarchy, rank_widths, town_roads, town_table};
#[cfg(test)]
pub(super) use junctions::clean_with_centers;
pub(super) use junctions::join_waterfront;
pub(super) use parallel::MIN_LAND;
pub(super) use policy::{bank_dead_ends, junction_triangles};
pub(super) use reservations::{remap_reservations, reserved_streets};
pub(super) use site_options::{clean_options, narrow_options};
pub(super) use spatial::{EPS, Key, Segment, candidates, crossings, key};
pub(super) use street::{downgrade_path, private, protected, width};
pub(super) use wall_streets::{cap_gate_passages, enclosure_lanes};
pub(super) use water_clearance::clear_water;
