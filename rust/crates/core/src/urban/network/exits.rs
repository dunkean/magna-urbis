//! Fringe street terminations, peripheral roads, and links to regional roads.

use super::analysis::Graph;
use super::curtains::{Curtains, inner_ring};
use super::spatial::{BoxGrid, EPS, distance, key, lerp, segment_box};
use super::street::{private, protected, width};
use crate::urban::{Enclosure, Layout, LayoutConfig, Point, Quarter, Street, Surface, warnings};
use std::collections::BTreeSet;

/// Resolve real outer leaves before carving blocks: joins, rural paths or closed
/// access ends. Enclosed towns retain their wall/gate termination semantics:
/// leaves inside a circuit are left to it, and the open-edge roads never cross
/// a curtain (`Curtains`), so the regional roads alone enter through the gates.
#[allow(clippy::too_many_arguments)]
pub(in crate::urban) fn resolve_exits(
    streets: &mut Vec<Street>,
    quarters: &[Quarter],
    roads: &[Street],
    enclosures: &[Enclosure],
    surface: Surface<'_>,
    cfg: &LayoutConfig,
    rng: &mut crate::rng::Rng,
) {
    use crate::urban::{geometry as g, routing};
    let curtains = Curtains::new(enclosures);
    let legacy_routes = std::env::var("URBAN_WALL_ROUTES").is_ok_and(|v| v == "legacy");
    let domains = g::union(&quarters.iter().map(|q| q.shape.clone()).collect::<Vec<_>>());
    let graph = Graph::new(streets);
    // The domain edges by box: "the nearest edge is closer than `reach`" tests
    // only the edges whose box meets the reach.
    let domain_edges: Vec<(Point, Point)> = domains
        .iter()
        .flat_map(|s| std::iter::once(&s.outer).chain(s.holes.iter()))
        .flat_map(|ring| {
            ring.iter()
                .zip(ring.iter().cycle().skip(1))
                .take(ring.len())
                .map(|(&a, &b)| (a, b))
        })
        .collect();
    let edge_grid = BoxGrid::new(&domain_edges.iter().map(|&(a, b)| segment_box(a, b, 0.0)).collect::<Vec<_>>(), 32.0);
    let near_boundary = |p: Point, reach: f64| {
        edge_grid
            .query(p.x - reach, p.y - reach, p.x + reach, p.y + reach)
            .into_iter()
            .any(|k| g::distance(p, domain_edges[k].0, domain_edges[k].1).0 < reach)
    };
    let domain_index: Vec<g::ContainmentIndex> = domains.iter().map(g::ContainmentIndex::new).collect();
    let in_domains = |p: Point| domain_index.iter().any(|c| c.contains(p));
    let mut leaves = vec![];
    let mut inner_ends = vec![];
    for (i, s) in streets.iter().enumerate() {
        if private(s) || matches!(s.role.as_str(), "quay" | "bridge" | "ford" | "causeway") {
            continue;
        }
        for end in [false, true] {
            let j = if end { s.path.len() - 1 } else { 0 };
            let p = s.path[j];
            if graph.degree(p) != 1 || !near_boundary(p, width(s, j).max(10.0)) {
                continue;
            }
            // A lane ending beside an outer lean-to (off the curtain) serves
            // it: no open edge.
            if !curtains.inside(p)
                && (curtains.hugs(p, p) || !curtains.serves_lean_to(p, width(s, j) + 2.0))
            {
                leaves.push((i, end, p));
            }
            // A street stopping at a curtain from inside: the wall-lane's.
            if curtains.inside(p)
                && !matches!(
                    s.role.as_str(),
                    "regional" | "approach" | "outbound" | "peripheral"
                )
            {
                inner_ends.push((i, end));
            }
        }
    }
    // `URBAN_WALL_ROUTES=legacy|outer` (A/B measurement only): no inner ring.
    if cfg.exit_treatment != "closed"
        && cfg.peripheral_road != "none"
        && !inner_ends.is_empty()
        && !std::env::var("URBAN_WALL_ROUTES").is_ok_and(|v| v == "legacy" || v == "outer")
    {
        let (kept, dropped) = inner_ring(streets, &curtains, &inner_ends, surface, cfg);
        if std::env::var("URBAN_RING_DEBUG").is_ok() {
            eprintln!(
                "INNER_RING ends={} kept={kept:.0} dropped={dropped:.0}",
                inner_ends.len()
            );
        }
    }
    let mut served = BTreeSet::new();
    let mut feeders = 0;
    let make = |path: Vec<Point>, w: f64, role: &str| Street {
        widths: vec![w; path.len()],
        path,
        rank: 2,
        role: role.into(),
    };
    // Circumferential sections connect pairs of actual streets. No ornamental
    // circle and no arc can be left attached at only one end.
    if cfg.exit_treatment != "closed" && cfg.peripheral_road != "none" {
        // Segments a section vertex may move onto (a close parallel corridor):
        // the streets as they stand before any section is laid, by box grown
        // by the farthest reach (half their width, the widest ring half width
        // of 4 m and 2 m), then the sections laid so far; in street order.
        let corridor = |s: &Street| !private(s) && s.role != "stairs";
        let fixed: Vec<(usize, usize)> = streets
            .iter()
            .enumerate()
            .filter(|(_, s)| corridor(s))
            .flat_map(|(i, s)| (0..s.path.len().saturating_sub(1)).map(move |k| (i, k)))
            .collect();
        let fixed_grid = BoxGrid::new(
            &fixed
                .iter()
                .map(|&(i, k)| {
                    let s = &streets[i];
                    segment_box(s.path[k], s.path[k + 1], width(s, k) * 0.5 + 4.0 + 2.0)
                })
                .collect::<Vec<_>>(),
            32.0,
        );
        let first_section = streets.len();
        for domain in &domains {
            // The centreline follows the actual land boundary. Its inner half
            // is carved from the blocks, so frontage touches the road exactly.
            for ring in std::iter::once(&domain.outer) {
                let mut stations = vec![0.0];
                for j in 0..ring.len() {
                    stations.push(stations[j] + distance(ring[j], ring[(j + 1) % ring.len()]));
                }
                // Ring edges by box: a leaf anchors on its nearest edge (the
                // first on a tie) only within 30 m.
                let ring_grid = BoxGrid::new(
                    &(0..ring.len())
                        .map(|j| segment_box(ring[j], ring[(j + 1) % ring.len()], 0.0))
                        .collect::<Vec<_>>(),
                    32.0,
                );
                let mut anchors: Vec<_> = leaves
                    .iter()
                    .enumerate()
                    .filter_map(|(id, &(_, _, p))| {
                        let (j, (d, t, q)) = ring_grid
                            .query(p.x - 30.0, p.y - 30.0, p.x + 30.0, p.y + 30.0)
                            .into_iter()
                            .map(|j| (j, g::distance(p, ring[j], ring[(j + 1) % ring.len()])))
                            .min_by(|a, b| a.1.0.total_cmp(&b.1.0))?;
                        (d < 30.0).then_some((
                            stations[j] + t * distance(ring[j], ring[(j + 1) % ring.len()]),
                            j,
                            q,
                            id,
                            p,
                        ))
                    })
                    .collect();
                anchors.sort_by(|a, b| a.0.total_cmp(&b.0));
                if anchors.len() < 2 {
                    continue;
                }
                let mut ring_widths: Vec<_> = anchors
                    .iter()
                    .map(|a| {
                        let (i, end, _) = leaves[a.3];
                        width(&streets[i], if end { streets[i].path.len() - 1 } else { 0 })
                    })
                    .collect();
                ring_widths.sort_by(f64::total_cmp);
                let ring_width = ring_widths[ring_widths.len() / 2].clamp(3.0, 8.0);
                let full = cfg.peripheral_road == "full";
                for k in 0..anchors.len() {
                    if !full
                        && (k == anchors.len() - 1
                            || cfg.peripheral_road == "auto" && !rng.chance(0.35))
                    {
                        continue;
                    }
                    let a = anchors[k];
                    let b = anchors[(k + 1) % anchors.len()];
                    // A street end at the curtain (on it or within its
                    // clearance) is the town's: it anchors no section.
                    if curtains.hugs(a.4, a.4) || curtains.hugs(b.4, b.4) {
                        continue;
                    }
                    let mut path = vec![a.4, a.2];
                    let mut j = (a.1 + 1) % ring.len();
                    while j != (b.1 + 1) % ring.len() {
                        path.push(ring[j]);
                        j = (j + 1) % ring.len();
                    }
                    path.extend([b.2, b.4]);
                    // Reuse a close parallel corridor rather than laying a
                    // second ribbon beside it. Original junctions stay fixed.
                    if path.len() > 3 {
                        for j in 1..path.len() - 1 {
                            let dx = path[j + 1].x - path[j - 1].x;
                            let dy = path[j + 1].y - path[j - 1].y;
                            let run = dx.hypot(dy).max(1e-6);
                            let p = path[j];
                            let laid = (first_section..streets.len()).flat_map(|i| {
                                (0..streets[i].path.len().saturating_sub(1)).map(move |k| (i, k))
                            });
                            let closest = fixed_grid
                                .query(p.x, p.y, p.x, p.y)
                                .into_iter()
                                .map(|n| fixed[n])
                                .chain(laid)
                                .filter_map(|(si, i)| {
                                    let s = &streets[si];
                                    let pair = [s.path[i], s.path[i + 1]];
                                    let sx = pair[1].x - pair[0].x;
                                    let sy = pair[1].y - pair[0].y;
                                    let length = sx.hypot(sy);
                                    if length < EPS
                                        || ((dx * sx + dy * sy) / (run * length)).abs() < 0.94
                                    {
                                        return None;
                                    }
                                    let (d, _, q) = g::distance(p, pair[0], pair[1]);
                                    (d < (width(s, i) + ring_width) * 0.5 + 2.0)
                                        .then_some((d, q))
                                })
                                .min_by(|a, b| a.0.total_cmp(&b.0));
                            if let Some((_, q)) = closest {
                                path[j] = q;
                            }
                        }
                    }
                    path.dedup_by(|a, b| distance(*a, *b) < 1e-6);
                    // A section along a circuit would ride its curtain and
                    // weave through it, or run in the ditch or on the glacis:
                    // it is moved off them, outside the reserve (or along the
                    // outer face where no ditch runs). The ditch is
                    // continuous and only gate streets cross it: no section
                    // crosses a moat lip (`Curtains::crosses`); one with no
                    // clear route left leaves the fringe there open.
                    let clear = path
                        .windows(2)
                        .all(|w| curtains.segment_clear(w[0], w[1], ring_width * 0.5));
                    // `URBAN_WALL_ROUTES=legacy` (A/B measurement only): drop
                    // the section instead, as Round 6 did.
                    let path = if clear {
                        Some(path)
                    } else if legacy_routes {
                        (!path.windows(2).any(|w| curtains.hugs(w[0], w[1]))).then_some(path)
                    } else {
                        curtains.keep_off(&path, ring_width * 0.5)
                    };
                    if let Some(path) = path
                        && routing::path_clear(surface, &path, cfg.max_street_grade)
                        && !path.windows(2).any(|w| curtains.crosses(w[0], w[1]))
                    {
                        streets.push(make(path, ring_width, "peripheral"));
                        served.extend([a.3, b.3]);
                    }
                }
            }
        }
    }
    // Regional road segments by box, for the feeder targets.
    let road_segments: Vec<(Point, Point, f64, f64)> = roads
        .iter()
        .flat_map(|s| {
            s.path
                .windows(2)
                .enumerate()
                .map(move |(i, seg)| (seg[0], seg[1], width(s, i), width(s, i + 1)))
        })
        .collect();
    let road_grid = BoxGrid::new(&road_segments.iter().map(|&(a, b, _, _)| segment_box(a, b, 0.0)).collect::<Vec<_>>(), 64.0);
    for (id, &(i, end, p)) in leaves.iter().enumerate() {
        let ring_served = served.contains(&id);
        let s = &streets[i];
        if s.path.len() < 2 {
            continue;
        }
        let adjacent = s.path[if end { s.path.len() - 2 } else { 1 }];
        let run = distance(adjacent, p).max(1e-6);
        let direction = Point {
            x: (p.x - adjacent.x) / run,
            y: (p.y - adjacent.y) / run,
        };
        // Local feeders can reach a regional axis beyond the immediate urban edge.
        let reach = 360.0;
        let mut joined = false;
        if cfg.exit_treatment != "closed" && feeders < 3 {
            let mut targets: Vec<_> = road_grid
                .query(p.x - reach, p.y - reach, p.x + reach, p.y + reach)
                .into_iter()
                .map(|k| road_segments[k])
                .filter_map(|(a, b, wa, wb)| {
                    let (d, t, q) = g::distance(p, a, b);
                    (d > 1.0
                        && d < reach
                        && !in_domains(q)
                        && !curtains.inside(q)
                        && (q.x - p.x) * direction.x + (q.y - p.y) * direction.y > -5.0)
                        .then_some((d, q, wa * (1.0 - t) + wb * t))
                })
                .collect();
            targets.sort_by(|a, b| a.0.total_cmp(&b.0));
            let mut planner = routing::RoutePlanner::new(
                surface,
                (p.x - reach, p.y - reach, p.x + reach, p.y + reach),
            );
            for &(_, target, target_width) in targets.iter().take(4) {
                if let Some(path) = planner.route(p, target, cfg.max_lane_grade)
                    && !path.windows(2).any(|w| curtains.crosses(w[0], w[1]))
                {
                    let source_width =
                        width(&streets[i], if end { streets[i].path.len() - 1 } else { 0 });
                    let mut connection = make(path, source_width, "outbound");
                    if connection
                        .path
                        .windows(2)
                        .map(|w| distance(w[0], w[1]))
                        .sum::<f64>()
                        > 60.0
                    {
                        // Keep the urban junction width, then narrow into a small connector.
                        connection.widths.fill(2.5);
                        connection.path.reverse();
                        connection.widths.reverse();
                        crate::urban::widths::taper_end(&mut connection, source_width);
                        connection.path.reverse();
                        connection.widths.reverse();
                        connection.rank = 3;
                    }
                    crate::urban::widths::taper_end(&mut connection, target_width);
                    streets.push(connection);
                    feeders += 1;
                    joined = true;
                    break;
                }
            }
            // A minority become genuine narrow rural paths into the landscape.
            if !joined && !ring_served && !protected(&streets[i]) && rng.chance(0.18) {
                let target = Point {
                    x: p.x + direction.x * 80.0,
                    y: p.y + direction.y * 80.0,
                };
                if !in_domains(target)
                    && let Some(path) = planner.route(p, target, cfg.max_lane_grade)
                    && !path.windows(2).any(|w| curtains.crosses(w[0], w[1]))
                {
                    let mut st = make(path, 2.0, "outbound");
                    st.rank = 3;
                    let last = st.widths.len() - 1;
                    st.widths[last] = 1.0;
                    streets.push(st);
                    joined = true;
                }
            }
        }
        if joined || ring_served || protected(&streets[i]) {
            continue;
        }
        // Retract the terminal corridor into its land cell. Its reclaimed ribbon
        // belongs to the block/parcel partition, closing the end with backland.
        let s = &mut streets[i];
        if !end {
            s.path.reverse();
            s.widths.reverse();
        }
        let mut retract = 14.0;
        while s.path.len() >= 2 {
            let last = s.path.len() - 1;
            let length = distance(s.path[last - 1], s.path[last]);
            if length > retract {
                s.path[last] = lerp(s.path[last], s.path[last - 1], retract / length);
                break;
            }
            let junction = graph.degree(s.path[last - 1]) >= 3;
            retract -= length;
            s.path.pop();
            s.widths.pop();
            if junction {
                break;
            }
        }
        if !end {
            s.path.reverse();
            s.widths.reverse();
        }
    }
    streets.retain(|s| s.path.len() >= 2);
}
/// A moved footprint must still reach the regional graph. Run only when its
/// largest local component has no contact with any imported road.
pub(in crate::urban) fn ensure_regional_access(layout: &mut Layout, roads: &[Street], surface: Surface<'_>, cfg: &LayoutConfig) {
    use crate::urban::{geometry as g, routing};
    if roads.is_empty() || cfg.scope != "settlement" || cfg.exit_treatment == "closed"
        || !cfg.isolated_access && layout.programme.as_ref().is_some_and(|p|crate::urban::roles::is_isolated(&p.context.intent)) { return; }
    let graph = Graph::new(&layout.streets);
    let Some(component) = (0..graph.length.len()).max_by(|&a,&b|graph.length[a].total_cmp(&graph.length[b])) else {return};
    let segments: Vec<_> = roads.iter().filter(|s|s.role == "regional").flat_map(|s|s.path.windows(2)).collect();
    if segments.is_empty() {return;}
    let local: Vec<_> = layout.streets.iter().filter(|s|s.path.first().is_some_and(|p|graph.component.get(&key(*p)) == Some(&component))).collect();
    // Existing contact anywhere on a retained trajectory is sufficient.
    let segment_grid = BoxGrid::new(&segments.iter().map(|w| segment_box(w[0], w[1], 0.0)).collect::<Vec<_>>(), 64.0);
    if local.iter().flat_map(|s|&s.path).any(|&p|segment_grid.query(p.x - 3.0, p.y - 3.0, p.x + 3.0, p.y + 3.0).into_iter().any(|k|g::distance(p,segments[k][0],segments[k][1]).0 < 3.0)) {return;}
    let curtains = Curtains::new(&layout.enclosures);
    let mut candidates = vec![];
    let mut seen = BTreeSet::new();
    for s in local {
        for &p in [s.path.first().unwrap(),s.path.last().unwrap()] {
            if private(s) || surface.wet(p) || !seen.insert(key(p)) {continue;}
            if let Some((d,q)) = segments.iter().map(|w| {let (d,_,q)=g::distance(p,w[0],w[1]);(d,q)})
                .min_by(|a,b|a.0.total_cmp(&b.0)) && d < 1500.0 {
                candidates.push((d,p,q));
            }
        }
    }
    candidates.sort_by(|a,b|a.0.total_cmp(&b.0));
    for (_,p,q) in candidates.into_iter().take(4) {
        let pad = 120.0;
        let mut planner = routing::RoutePlanner::new(surface,(p.x.min(q.x)-pad,p.y.min(q.y)-pad,p.x.max(q.x)+pad,p.y.max(q.y)+pad));
        if let Some(path) = planner.route(p,q,cfg.max_lane_grade)
            && !path.windows(2).any(|w|curtains.crosses(w[0],w[1])) {
            layout.streets.push(Street {widths:vec![2.5;path.len()],path,rank:3,role:"outbound".into()});
            layout.warnings.push(warnings::regional_access_restored());
            return;
        }
    }
}
