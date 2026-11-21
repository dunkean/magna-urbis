//! Close gates that no longer carry access to the town or suburbs.

use crate::urban::{Layout, Point, Shape, Street, composition, geometry as g};
use super::gate_budget::DEAD_END;
use super::geometry::{Box2, add, dir, dist, pt, ribbon_half};

/// Last of the pipeline. A gate must lead somewhere:
/// - a gate point no street crosses or reaches any more (the street was pruned, moved off the water,
///   trimmed) closes with its gatehouse;
/// - a gate whose street ends shortly outside (under `DEAD_END` m of street beyond the wall, reaching no
///   regional road, bridge, other gate or block it serves) closes too: its outer stub goes and the inner
///   street ends at the wall. A stub serving a block is a suburb street: its gate stays, so no block loses
///   its access this late.
///
/// Water gates, water fronts and regional roads entering from the network stay.
pub(in super::super) fn drop_dead_gates(layout: &mut Layout) {
    // Street segments on a grid, for the walks outside the gates.
    const CELL: f64 = 16.0;
    let mut grid: std::collections::HashMap<(i64, i64), Vec<(usize, usize)>> = Default::default();
    for (si, s) in layout.streets.iter().enumerate() {
        for k in 0..s.path.len().saturating_sub(1) {
            let (a, b) = (s.path[k], s.path[k + 1]);
            for x in ((a.x.min(b.x) - 1.0) / CELL).floor() as i64..=((a.x.max(b.x) + 1.0) / CELL).floor() as i64 {
                for y in ((a.y.min(b.y) - 1.0) / CELL).floor() as i64..=((a.y.max(b.y) + 1.0) / CELL).floor() as i64 {
                    grid.entry((x, y)).or_default().push((si, k));
                }
            }
        }
    }
    let touching = |streets: &[Street], p: Point, reach: f64| -> Vec<(usize, usize)> {
        let mut out: Vec<(usize, usize)> = grid
            .get(&((p.x / CELL).floor() as i64, (p.y / CELL).floor() as i64))
            .into_iter()
            .flatten()
            .copied()
            .filter(|&(si, k)| g::distance(p, streets[si].path[k], streets[si].path[k + 1]).0 < reach)
            .collect();
        out.sort_unstable();
        out.dedup();
        out
    };
    let network = |s: &Street| matches!(s.role.as_str(), "regional" | "approach" | "outbound" | "bridge" | "ford" | "causeway");
    // Built land: a road outside a gate that serves a block leads to a suburb (and its stub keeps the access).
    const SERVES: f64 = 12.0;
    let built: Vec<(Box2, &Shape)> = layout
        .blocks
        .iter()
        .filter(|b| matches!(b.kind.as_str(), "block" | "place" | "compound"))
        .map(|b| (g::bbox(&b.shape), &b.shape))
        .collect();
    // Segments to drop, and crossing segments to stop at the wall (street, segment, new end).
    let mut dropped: std::collections::HashSet<(usize, usize)> = Default::default();
    let mut stops: Vec<(usize, usize, Point, bool)> = vec![];
    for e in layout.enclosures.iter_mut().filter(|e| !e.style.is_empty() && e.path.len() >= 4) {
        let streets = &layout.streets;
        let ring = g::normalized(Shape { outer: e.path[..e.path.len() - 1].to_vec(), holes: vec![] });
        let inside = |p: Point| g::contains(&ring, p);
        let half = ribbon_half(&e.kind).max(e.curtain_width_m * 0.5);
        // Blocks outside this circuit (the town's own blocks inside do not make a gate lead anywhere).
        let outside: Vec<&(Box2, &Shape)> = built.iter().filter(|(_, s)| !inside(g::interior_point(s))).collect();
        let serves = |a: Point, b: Point| {
        let samples = [a, pt((a.x + b.x) * 0.5, (a.y + b.y) * 0.5), b];
        outside.iter().any(|(bb, s)| {
            a.x.min(b.x) - SERVES <= bb.2 && a.x.max(b.x) + SERVES >= bb.0 && a.y.min(b.y) - SERVES <= bb.3 && a.y.max(b.y) + SERVES >= bb.1
                && samples.iter().any(|&p| {
                    g::contains(s, p) || (0..s.outer.len()).any(|i| g::distance(p, s.outer[i], s.outer[(i + 1) % s.outer.len()]).0 < SERVES)
                })
        })
        };
        let crossings = composition::gates(&e.path, streets);
        let water: Vec<usize> = e.gatehouses.iter().filter(|gh| matches!(gh.kind.as_str(), "water" | "shore")).map(|gh| gh.gate).collect();
        let ends: Vec<Point> = e.gatehouses.iter().filter(|gh| matches!(gh.kind.as_str(), "water" | "shore")).flat_map(|gh| gh.passage).collect();
        let entering = |q: Point| {
            // A regional road ending on the curtain enters there (its outer part is the regional network);
            // any other street ending at the wall is a stub and opens nothing.
            streets.iter().filter(|s| matches!(s.role.as_str(), "regional" | "approach") && s.path.len() >= 2).any(|s| {
                let n = s.path.len();
                [(s.path[0], s.widths.first()), (s.path[n - 1], s.widths.last())]
                    .iter()
                    .any(|&(p, w)| dist(p, q) < w.copied().unwrap_or(4.0) * 0.5 + 2.0)
            })
        };
        let mut remap = vec![None; e.gates.len()];
        let mut gates = vec![];
        for (i, &q) in e.gates.iter().enumerate() {
            let kept = if water.contains(&i) || ends.iter().any(|&p| dist(p, q) < 1.0) || entering(q) {
                true
            } else if !crossings.iter().any(|&c| dist(c, q) < 8.0) {
                false
            } else {
                // Walk the streets outside from the gate: does the road lead somewhere?
                let start: Vec<(usize, usize)> = touching(streets, q, 8.0)
                    .into_iter()
                    .filter(|&(si, k)| inside(streets[si].path[k]) != inside(streets[si].path[k + 1]))
                    .collect();
                let mut seen: std::collections::HashSet<(usize, usize)> = start.iter().copied().collect();
                let mut stack: Vec<Point> = vec![];
                let (mut total, mut alive) = (0.0, start.is_empty() || start.iter().any(|&(si, _)| network(&streets[si])));
                for &(si, k) in &start {
                    let (a, b) = (streets[si].path[k], streets[si].path[k + 1]);
                    let o = if inside(a) { b } else { a };
                    total += dist(q, o);
                    alive |= serves(q, o);
                    stack.push(o);
                }
                while !alive {
                    let Some(p) = stack.pop() else { break };
                    for (si, k) in touching(streets, p, 1.0) {
                        if !seen.insert((si, k)) {
                            continue;
                        }
                        let (a, b) = (streets[si].path[k], streets[si].path[k + 1]);
                        // Back into the town through another gate, onto the regional network: it leads somewhere.
                        if network(&streets[si]) || inside(a) || inside(b) || serves(a, b) {
                            alive = true;
                            break;
                        }
                        total += dist(a, b);
                        stack.extend([a, b].into_iter().filter(|&o| dist(o, p) > 0.5));
                    }
                    alive |= total > DEAD_END;
                }
                if !alive {
                    for &(si, k) in &seen {
                        let s = &streets[si];
                        let (a, b) = (s.path[k], s.path[k + 1]);
                        if inside(a) == inside(b) {
                            dropped.insert((si, k));
                            continue;
                        }
                        // The crossing segment stops at the wall, inside.
                        let (inner, outer) = if inside(a) { (a, b) } else { (b, a) };
                        let Some(x) = e.path.windows(2).find_map(|c| g::segment_hit(inner, outer, c[0], c[1]).map(|h| h.1)) else {
                            dropped.insert((si, k));
                            continue;
                        };
                        let w = s.widths.get(k).copied().unwrap_or(4.0);
                        let back = (half + w * 0.5 + 0.5).min(dist(inner, x));
                        stops.push((si, k, add(x, dir(x, inner), back), inside(a)));
                    }
                }
                alive
            };
            if kept {
                remap[i] = Some(gates.len());
                gates.push(q);
            }
        }
        if gates.len() == e.gates.len() {
            continue;
        }
        e.gatehouses = std::mem::take(&mut e.gatehouses)
            .into_iter()
            .filter_map(|mut gh| {
                gh.gate = remap.get(gh.gate).copied().flatten()?;
                Some(gh)
            })
            .collect();
        e.inner_gates = e.inner_gates.iter().filter_map(|&i| remap.get(i).copied().flatten()).collect();
        e.gates = gates;
    }
    if dropped.is_empty() && stops.is_empty() {
        return;
    }
    // Rebuild the streets without the dropped segments, the crossings stopped at the wall.
    let mut out: Vec<Street> = Vec::with_capacity(layout.streets.len());
    for (si, s) in std::mem::take(&mut layout.streets).into_iter().enumerate() {
        let touched = (0..s.path.len().saturating_sub(1)).any(|k| dropped.contains(&(si, k)) || stops.iter().any(|t| t.0 == si && t.1 == k));
        if !touched {
            out.push(s);
            continue;
        }
        let w = |k: usize| s.widths.get(k).or(s.widths.last()).copied().unwrap_or(4.0);
        let (mut path, mut widths): (Vec<Point>, Vec<f64>) = (vec![], vec![]);
        let flush = |path: &mut Vec<Point>, widths: &mut Vec<f64>, out: &mut Vec<Street>| {
            if path.len() >= 2 {
                out.push(Street { path: std::mem::take(path), widths: std::mem::take(widths), rank: s.rank, role: s.role.clone() });
            } else {
                path.clear();
                widths.clear();
            }
        };
        for k in 0..s.path.len() - 1 {
            if dropped.contains(&(si, k)) {
                flush(&mut path, &mut widths, &mut out);
                continue;
            }
            if let Some(&(_, _, end, inner_first)) = stops.iter().find(|t| t.0 == si && t.1 == k) {
                // The inner part of the crossing segment keeps its run, up to the wall; the stretch past it goes.
                let (a, b) = (s.path[k], s.path[k + 1]);
                if inner_first {
                    if path.is_empty() {
                        path.push(a);
                        widths.push(w(k));
                    }
                    path.push(end);
                    widths.push(w(k));
                    flush(&mut path, &mut widths, &mut out);
                } else {
                    flush(&mut path, &mut widths, &mut out);
                    path.extend([end, b]);
                    widths.extend([w(k), w(k + 1)]);
                }
                continue;
            }
            if path.is_empty() {
                path.push(s.path[k]);
                widths.push(w(k));
            }
            path.push(s.path[k + 1]);
            widths.push(w(k + 1));
        }
        flush(&mut path, &mut widths, &mut out);
    }
    layout.streets = out;
}
