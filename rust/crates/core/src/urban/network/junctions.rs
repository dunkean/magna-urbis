//! Planarize street junctions, then clean up connections, components, and stubs.

use super::analysis::Graph;
use super::parallel::shadowed_copies;
use super::site_options::different_level;
use super::spatial::{EPS, Key, Segment, candidates, crossings, distance, key, lerp};
use super::street::{private, protected, width};
use crate::urban::{Point, Street, Surface, profile::Lap, warnings};

pub(super) fn planarize(streets: &mut Vec<Street>, radius: f64) {
    streets.retain(|s| s.path.len() >= 2);
    let segments: Vec<_> = streets
        .iter()
        .enumerate()
        .flat_map(|(street, s)| {
            s.path
                .windows(2)
                .enumerate()
                .filter_map(move |(offset, p)| {
                    (distance(p[0], p[1]) > EPS).then_some(Segment {
                        street,
                        offset,
                        a: p[0],
                        b: p[1],
                    })
                })
        })
        .collect();
    let mut cuts: Vec<Vec<(f64, Point)>> = segments
        .iter()
        .map(|s| vec![(0.0, s.a), (1.0, s.b)])
        .collect();
    for (i, j) in candidates(&segments, (radius / 8.0).clamp(12.0, 60.0)) {
        for (t, u, p) in crossings(segments[i], segments[j]) {
            cuts[i].push((t, p));
            cuts[j].push((u, p));
        }
    }
    let mut paths = vec![Vec::new(); streets.len()];
    let mut values: Vec<Vec<f64>> = vec![vec![]; streets.len()];
    for (segment, cut) in segments.iter().zip(&mut cuts) {
        cut.sort_by(|a, b| a.0.total_cmp(&b.0));
        cut.dedup_by(|a, b| (a.0 - b.0).abs() < 1e-9);
        let s = &streets[segment.street];
        let wa = width(s, segment.offset);
        let wb = width(s, segment.offset + 1);
        for &(t, p) in cut.iter() {
            if paths[segment.street]
                .last()
                .is_some_and(|&q| key(q) == key(p))
            {
                continue;
            }
            paths[segment.street].push(p);
            values[segment.street].push(wa + (wb - wa) * t);
        }
    }
    for ((s, path), widths) in streets.iter_mut().zip(paths).zip(values) {
        s.path = path;
        s.widths = widths;
    }
    // Water supports keep their roles, then a regional axis wins over a
    // generated copy. Every ownership decision is stable in input order.
    let mut order: Vec<_> = (0..streets.len()).collect();
    order.sort_by_key(|&i| {
        let s = &streets[i];
        let support = match s.role.as_str() { "bridge" => 0, "quay" => 1, "ford" | "causeway" => 2, _ if protected(s) => 3, _ => 4 };
        (support, s.rank, i)
    });
    let mut used: std::collections::HashSet<(Key, Key)> = Default::default();
    let mut unique = vec![];
    for i in order {
        let s = &streets[i];
        let mut path = vec![];
        let mut widths = vec![];
        for (j, p) in s.path.windows(2).enumerate() {
            let a = key(p[0]);
            let b = key(p[1]);
            let edge = if a < b { (a, b) } else { (b, a) };
            if a != b && used.insert(edge) {
                if path.is_empty() {
                    path.push(p[0]);
                    widths.push(width(s, j));
                }
                path.push(p[1]);
                widths.push(width(s, j + 1));
            } else if path.len() >= 2 {
                unique.push(Street {
                    path: std::mem::take(&mut path),
                    widths: std::mem::take(&mut widths),
                    rank: s.rank,
                    role: s.role.clone(),
                });
            }
        }
        if path.len() >= 2 {
            unique.push(Street {
                path,
                widths,
                rank: s.rank,
                role: s.role.clone(),
            });
        }
    }
    *streets = unique;
}

/// Invariant (no stub): a loose spur shorter than its own width serves no
/// lot; it is removed, repeatedly (a spur left on a removed spur). Protected
/// roads (regional, crossings) and private access ways stay. Dead-end hooks
/// are kept: a loose tail touching the quarter edge still bounds the blocks.
fn drop_stubs(streets: &mut Vec<Street>) {
    for _ in 0..4 {
        let graph = Graph::new(streets);
        let before = streets.len();
        streets.retain(|s| {
            let n = s.path.len();
            let length: f64 = s.path.windows(2).map(|p| distance(p[0], p[1])).sum();
            protected(s)
                || private(s) && n >= 2
                || n >= 2
                    && !(length < width(s, 0)
                        && (graph.degree(s.path[0]) == 1 || graph.degree(s.path[n - 1]) == 1))
        });
        if streets.len() == before {
            break;
        }
    }
}

/// Shorten a loose outer end to a useful 16 m access spur after its last real
/// junction. The retained spur narrows gradually, with a modest flat end cap.
fn trim_end(s: &mut Street, graph: &Graph, center: Point, radius: f64) {
    let Some(&end) = s.path.last() else { return };
    if graph.degree(end) != 1 || distance(end, center) <= radius * 0.7 {
        return;
    }
    let Some(junction) = (0..s.path.len() - 1)
        .rev()
        .find(|&i| graph.degree(s.path[i]) >= 3)
    else {
        return;
    };
    let length: f64 = s.path[junction..]
        .windows(2)
        .map(|p| distance(p[0], p[1]))
        .sum();
    let keep = 16.0_f64.min(radius * 0.15).max(6.0);
    if length <= keep + 4.0 {
        return;
    }
    let mut remaining = keep;
    for i in junction..s.path.len() - 1 {
        let run = distance(s.path[i], s.path[i + 1]);
        if remaining < run {
            let t = remaining / run;
            s.path[i + 1] = lerp(s.path[i], s.path[i + 1], t);
            let w = width(s, i) + (width(s, i + 1) - width(s, i)) * t;
            s.path.truncate(i + 2);
            s.widths.truncate(i + 1);
            s.widths.push(w);
            break;
        }
        remaining -= run;
    }
    let base = width(s, junction);
    let mut along = 0.0;
    for i in junction + 1..s.path.len() {
        along += distance(s.path[i - 1], s.path[i]);
        s.widths[i] = width(s, i).min(base * (1.0 - 0.45 * (along / keep).clamp(0.0, 1.0)));
    }
}

/// Landing streets and piers added after the main cleanup need actual graph junctions.
pub(in crate::urban) fn join_waterfront(streets: &mut Vec<Street>, radius: f64) {
    planarize(streets, radius);
}

#[cfg(test)]
pub(super) fn clean(
    streets: &mut Vec<Street>,
    center: Point,
    radius: f64,
    fortified: bool,
) -> Vec<String> {
    clean_with_centers(streets, center, radius, fortified, &[])
}

#[cfg(test)]
pub(in crate::urban) fn clean_with_centers(
    streets: &mut Vec<Street>,
    center: Point,
    radius: f64,
    fortified: bool,
    centers: &[Point],
) -> Vec<String> {
    clean_terrain(streets, center, radius, fortified, centers, None)
}

pub(super) fn clean_terrain(
    streets: &mut Vec<Street>, center: Point, radius: f64, fortified: bool,
    centers: &[Point], surface: Option<Surface<'_>>,
) -> Vec<String> {
    let mut laps = Lap::new("clean");
    // One graph load nodes the crossings; the copies found on its streets go,
    // and the loose ends are seated on their hosts in the graph itself, so the
    // exported network needs no second planarization.
    let mut net = crate::urban::street_graph::StreetGraph::load(streets, radius);
    *streets = net.export();
    laps.lap("graph_load");
    let copies = shadowed_copies(streets, 0.0, &[], surface);
    laps.lap("shadowed");
    let seats = net.seat(&copies, &|a, b| !surface.is_some_and(|s| different_level(s, a, b)));
    *streets = net.export();
    drop(net);
    laps.lap("graph_seat");
    #[cfg(not(target_arch = "wasm32"))]
    if std::env::var_os("URBAN_PROFILE").is_some() {
        eprintln!("  clean.seats: {seats:?}");
    }
    #[cfg(target_arch = "wasm32")]
    let _ = seats;
    let mut graph = Graph::new(streets);
    for &p in centers {
        if let Some((d, s)) = streets
            .iter()
            .map(|s| {
                let d = s
                    .path
                    .windows(2)
                    .map(|w| crate::urban::geometry::distance(p, w[0], w[1]).0)
                    .fold(f64::INFINITY, f64::min);
                (d, s)
            })
            .min_by(|a, b| a.0.total_cmp(&b.0))
            && d < radius.max(30.0)
        {
            graph.anchored[graph.component[&key(s.path[0])]] = true;
        }
    }
    let has_anchor = graph.anchored.iter().any(|&v| v);
    let largest = graph
        .length
        .iter()
        .enumerate()
        .max_by(|a, b| a.1.total_cmp(b.1).then_with(|| b.0.cmp(&a.0)))
        .map(|(i, _)| i);
    let before = streets.len();
    streets.retain(|s| {
        let c = graph.component[&key(s.path[0])];
        if has_anchor {
            graph.anchored[c]
        } else {
            Some(c) == largest
        }
    });
    laps.lap("components");
    drop_stubs(streets);
    laps.lap("stubs");
    if !fortified {
        let graph = Graph::new(streets);
        for s in streets
            .iter_mut()
            .filter(|s| !protected(s) && !private(s) && s.role != "quay")
        {
            let local_center = centers
                .iter()
                .copied()
                .min_by(|a, b| distance(*a, s.path[0]).total_cmp(&distance(*b, s.path[0])))
                .unwrap_or(center);
            trim_end(s, &graph, local_center, radius);
            s.path.reverse();
            s.widths.reverse();
            trim_end(s, &graph, local_center, radius);
            s.path.reverse();
            s.widths.reverse();
        }
    }
    if streets.len() < before {
        vec![warnings::isolated_streets_removed(before - streets.len())]
    } else {
        vec![]
    }
}
