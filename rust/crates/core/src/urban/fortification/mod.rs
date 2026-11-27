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
mod moat_audit;
mod moat_line;
mod obey;
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

pub(super) use build::{build, build_beside};
pub(super) use cave::cave_circuits;
pub(super) use crossings::{enforce, tidy_wall_ends};

/// Walls first: the ground between the curtain of `e` and a road laid round it (`approach`, the
/// diversion of a road shut at the wall) is the wall's cleared ground, not a block. Each stretch of
/// such a road within `APPROACH_STRIP` m of the curtain reserves the strip down to the wall.
pub(super) fn reserve_approaches(e: &mut crate::urban::Enclosure, laid: &[crate::urban::Street]) {
    use crate::urban::geometry as g;
    const APPROACH_STRIP: f64 = 45.0;
    let foot = |p: crate::urban::Point| e.path.windows(2).map(|w| g::distance(p, w[0], w[1])).min_by(|a, b| a.0.total_cmp(&b.0)).filter(|f| f.0 < APPROACH_STRIP).map(|f| f.2);
    let mut strips = vec![];
    for s in laid.iter().filter(|s| s.role == "approach") {
        for w in s.path.windows(2) {
            if let (Some(a), Some(b)) = (foot(w[0]), foot(w[1])) {
                let strip = g::normalized(crate::urban::Shape { outer: vec![w[0], w[1], b, a], holes: vec![] });
                if g::area(&strip) > 1.0 {
                    strips.push(strip);
                }
            }
        }
    }
    e.reserve.extend(strips);
}

/// The moat bands of the circuits: per run, the land inside its outer lip and, for a closed run, the
/// town inside the curtain to leave out. Water standing there is the moat's (a stream it takes in): a
/// street crossing it is a moat crossing, not a street on natural water.
pub(super) fn moat_bands(enclosures: &[crate::urban::Enclosure]) -> Vec<(crate::urban::Shape, Option<crate::urban::Shape>)> {
    enclosures
        .iter()
        .flat_map(|e| {
            let town = (e.path.len() >= 4).then(|| crate::urban::geometry::normalized(crate::urban::Shape { outer: e.path[..e.path.len() - 1].to_vec(), holes: vec![] }));
            e.moat.iter().flat_map(|m| m.runs.iter()).map(move |r| (moat_line::outer_fill(r), r.closed.then(|| town.clone()).flatten())).collect::<Vec<_>>()
        })
        .collect()
}

/// `URBAN_PROFILE` trace of the gates of every circuit after a stage that may open or close some.
pub(super) fn trace_gates(stage: &str, layout: &crate::urban::Layout) {
    if std::env::var("URBAN_PROFILE").is_err() {
        return;
    }
    for e in layout.enclosures.iter().filter(|e| !e.style.is_empty()) {
        // `!`: no street crosses the curtain within 2 m of the gate point any more.
        let crossings = crate::urban::composition::gates(&e.path, &layout.streets);
        let gates: Vec<String> = e.gates.iter().enumerate().map(|(i, g)| format!("({:.0},{:.0}){}{}", g.x, g.y, e.gatehouses.iter().find(|gh| gh.gate == i).map_or("-".into(), |gh| format!(":{}", gh.kind)), if crossings.iter().any(|&c| geometry::dist(c, *g) < 2.0) { "" } else { "!" })).collect();
        eprintln!("  gates[{stage}] {} {}: {}", e.edit_key, e.gates.len(), gates.join(" "));
    }
}
pub(super) use dead_gates::drop_dead_gates;
pub(super) use extension::{attach, dedupe_shared, drop_twins, inner_gates, lopsided, retained, shared_length, trim_shared};
pub(super) use gate_budget::{Circuit, GATE_GAP, VILLAGE, decide_with_gates, old_gates, decide_reached, divert, reach_through};
pub(super) use geometry::{ribbon_half, terrain};
pub(super) use heights::{heights_castle, wrap_castle};
pub(super) use moat_line::add_regional_spans;
pub(super) use options::{finish_options, keeps_citadel, prepare_options, service_cost};
pub(super) use parameters::{parameter_trace, port_walls, valid_parameters, wall_extension};
pub(super) use pockets::straight_across;
pub(super) use reserve::{circuit_ground, yield_reserve};
pub(super) use settle::{resolve_moats, settle, sync_gates};
pub use moat_audit::{MoatAudit, Uncovered, moat_audit, roads_without_gate};
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
