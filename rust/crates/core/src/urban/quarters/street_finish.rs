//! Street grade checks, network cleanup, exits and hierarchy before block carving.

use super::stairs;
use crate::rng::Rng;
use crate::urban::{
    Enclosure, LayoutConfig, Morph, Point, Quarter, Site, Street, Surface, UrbanStructure,
    geometry as g, network, routing, widths,
};

#[allow(clippy::too_many_arguments)]
pub(super) fn finish_streets(
    streets: &mut Vec<Street>,
    quarters: &[Quarter],
    enclosures: &[Enclosure],
    structure: Option<&UrbanStructure>,
    warnings: &mut Vec<String>,
    open_edge: bool,
    site: &Site,
    cfg: &LayoutConfig,
    m: &Morph,
    surface: Surface<'_>,
    roads: &[Street],
    radius: f64,
    nucleus_radius: f64,
    rng: &Rng,
    lap: &impl Fn(&str),
) -> bool {
    let center = site.center;
    // Slits and snapped endpoints must obey the same physical rules as arterials.
    streets.retain_mut(|s| {
        if matches!(s.role.as_str(), "bridge" | "ford" | "causeway") {
            return true;
        }
        let limit = if s.rank >= 3 {
            cfg.max_lane_grade
        } else {
            cfg.max_street_grade
        };
        if routing::path_clear(surface, &s.path, limit) {
            return true;
        }
        if s.rank >= 3
            && cfg.allow_stairs
            && routing::path_clear(surface, &s.path, cfg.max_stair_grade)
        {
            // A steep link: `stairs::settle` decides its lanes and its stairs.
            s.role = "stairs".into();
            for w in &mut s.widths {
                *w = w.min(2.2);
            }
            return true;
        }
        false
    });
    lap("closes+retain");
    network::join_crossings(
        streets,
        surface,
        cfg.max_street_grade,
        nucleus_radius.clamp(60.0, 200.0),
    );
    lap("clean.join_crossings");
    network::enclosure_lanes(
        streets,
        enclosures,
        surface,
        cfg,
        &mut rng.fork("wall-lanes"),
    );
    let centers = structure
        .map_or_else(Vec::new, |s| s.centers.iter().map(|c| c.point).collect());
    warnings.extend(network::clean_options(streets, center, radius,
        !enclosures.is_empty() || cfg.exit_treatment != "legacy", &centers, cfg, surface));
    lap("clean.clean_1");
    // `roadNetworkPrune`: no diagonal shortcut triangles or doubled runs.
    if cfg.road_network_prune { network::junction_triangles(streets, m.text("streetOp") == "grid"); }
    network::narrow_options(streets, enclosures, radius, cfg, surface);
    lap("clean.triangles+narrow");
    // Camp entrances hand over to their native paths, never urban bypass feeders.
    let path_camp = cfg.settlement_form == "camp" || !m.text("campLayout").is_empty();
    if open_edge && cfg.exit_treatment != "legacy" && !path_camp {
        network::resolve_exits(
            streets,
            quarters,
            roads,
            enclosures,
            surface,
            cfg,
            &mut rng.fork("exit-destinations"),
        );
        lap("clean.resolve_exits");
        warnings.extend(network::clean_options(streets, center, radius, true, &centers, cfg, surface));
    }
    lap("clean+exits");
    routing::tally("clean+exits");
    {
        // Main centre first; every quarter routes to its nearest centre.
        let mut ordered: Vec<_> = structure.map_or_else(Vec::new, |s| {
            s.centers.iter().map(|c| (c.weight, c.point)).collect()
        });
        ordered.sort_by(|a, b| b.0.total_cmp(&a.0));
        let mut hubs: Vec<Point> = ordered.into_iter().map(|c| c.1).collect();
        if hubs.is_empty() {
            hubs.push(center);
        }
        let gates: Vec<Point> = enclosures.iter().flat_map(|e| e.gates.clone()).collect();
        let anchors: Vec<Point> = quarters
            .iter()
            .map(|q| g::interior_point(&q.shape))
            .collect();
        let base: [f64; 5] = std::array::from_fn(|r| {
            m.value["widthByRank"][r].as_f64().unwrap_or(3.0) * m.number_or("widthScale", 1.0)
        });
        let axis = m.value["streets"]
            .as_array()
            .is_some_and(|a| a.iter().any(|v| v.as_str() == Some("axis")));
        network::hierarchy(
            streets,
            &hubs,
            &gates,
            &anchors,
            site.population,
            base,
            axis,
            &quarters.iter().map(|q| q.shape.clone()).collect::<Vec<_>>(),
            cfg.road_width_by_size,
            // A camp entrance keeps its regional path width at the handover;
            // urban arterial sizing would turn a short curved trail into a road.
            cfg.town_main_road && !path_camp,
        );
    }
    lap("hierarchy");
    widths::harmonize(streets);
    lap("fringe.harmonize");
    network::cap_gate_passages(streets, enclosures);
    lap("fringe.gate_passages");
    // Invariant (the network that cuts the blocks is final): the width-bound
    // clean rules run again on the final widths, before the ribbons cut the
    // blocks. A main street widened by the hierarchy can now overlap a near
    // copy, or outgrow a stub; a later clean (access lanes) would drop them
    // after the cut, leaving their ribbons as land with neither block nor
    // street and lots shaped by a street that is gone.
    network::narrow_options(streets, enclosures, radius, cfg, surface);
    lap("fringe.narrow");
    warnings.extend(network::clean_options(streets, center, radius, true, &centers, cfg, surface));
    lap("fringe.clean");
    path_camp
}

#[allow(clippy::too_many_arguments)]
pub(super) fn finish_connections(
    streets: &mut Vec<Street>,
    enclosures: &[Enclosure],
    site: &Site,
    surface: Surface<'_>,
    cfg: &LayoutConfig,
    m: &Morph,
    path_camp: bool,
    lap: &impl Fn(&str),
) {
    if cfg.road_end_joins {
        network::weld_ends(streets, surface);
    }
    lap("harmonize+fringe");
    if path_camp {
        let width = m.number_or("campPath", m.number_or("footpathWidth", 2.5)).clamp(1.2, 3.0);
        for s in streets.iter_mut().filter(|s| s.rank > 0 && matches!(s.role.as_str(), "street" | "lane" | "gate-street" | "wall-lane")) {
            for w in &mut s.widths { *w = w.min(width); }
            // A public footpath keeps frontage; rank-4 field tracks do not.
            if s.role == "street" { s.role = "lane".into(); }
        }
    }
    let culture = if cfg.culture == "site" { &site.culture } else { &cfg.culture };
    stairs::settle(streets, enclosures, surface, cfg, culture);
    lap("stairs");
}
