//! Gate budget and dead gates.
//!
//! A historical walled town opens few gates: about 2 to 4 main gates under 5 000 inhabitants, 5 at
//! 10 000, 6 to 8 for a large city, plus at most `POSTERNS` posterns (`gate_budget`), spaced along the
//! circuit. `limit_gates` keeps the most important crossings (regional roads, then main streets, then
//! the widest), and every other crossing closes (`close_crossings`): a street inside ends at the wall,
//! and a main road outside goes round the wall to the nearest kept gate along an extra-mural road
//! (`connector`). `drop_dead_gates`, last of the pipeline, closes every gate point that no street uses
//! any more, so the drawn curtain opens only at gates, water gates and water fronts.
use super::*;

/// Posterns a circuit keeps besides its main gates.
const POSTERNS: usize = 2;
/// Main gates for `pop` inhabitants: 2 + sqrt(pop / 1500), rounded, 2 to 8 (2 000 → 3, 5 000 → 4,
/// 10 000 → 5, 20 000 → 6, 40 000 → 7, 70 000 and more → 8). A castle or a citadel keeps two.
pub(super) fn gate_budget(pop: u32, purpose: &str) -> usize {
    if !purpose.is_empty() {
        return 2;
    }
    (2.0 + (f64::from(pop) / 1500.0).sqrt()).round().clamp(2.0, 8.0) as usize
}

struct Crossing {
    at: Point,
    arc: f64,
    /// 3 regional road, 2 main street (rank 0–1), 1 street, 0 lane.
    priority: u8,
    width: f64,
}

/// Arc position of `p` along the closed `path` (cumulated lengths `cum`).
fn arc_of(path: &[Point], cum: &[f64], p: Point) -> f64 {
    let k = path
        .windows(2)
        .enumerate()
        .min_by(|a, b| g::distance(p, a.1[0], a.1[1]).0.total_cmp(&g::distance(p, b.1[0], b.1[1]).0))
        .map_or(0, |(k, _)| k);
    cum[k] + dist(path[k], p).min(dist(path[k], path[k + 1]))
}

/// The gate budget of every circuit: keeps the most important crossings, spaced, and sets `gates` to
/// them (water gates and passage ends stay). Returns the ribbons of the extra-mural roads it adds,
/// which the blocks give up like the fortification's reserve.
pub(super) fn limit_gates(layout: &mut super::super::Layout) -> Vec<Shape> {
    let pop = layout
        .structure
        .as_ref()
        .map_or_else(|| layout.phases.iter().map(|p| p.population).sum(), |s| s.metrics.planned_population)
        .max(500.0)
        .round() as u32;
    let mut connectors: Vec<Street> = vec![];
    for e in layout.enclosures.iter_mut().filter(|e| !e.style.is_empty() && e.path.len() >= 4) {
        let path = e.path.clone();
        let n_seg = path.len() - 1;
        let cum: Vec<f64> = std::iter::once(0.0)
            .chain((0..n_seg).scan(0.0, |acc, i| {
                *acc += dist(path[i], path[i + 1]);
                Some(*acc)
            }))
            .collect();
        let total = cum[n_seg].max(1.0);
        let passages: Vec<(Point, Point)> = e
            .gatehouses
            .iter()
            .filter(|gh| matches!(gh.kind.as_str(), "water" | "shore"))
            .map(|gh| (gh.passage[0], gh.passage[1]))
            .collect();
        let mut crossings: Vec<Crossing> = super::super::composition::gates(&path, &layout.streets)
            .into_iter()
            .filter(|&p| !passages.iter().any(|&(a, b)| g::distance(p, a, b).0 < 25.0))
            .map(|p| {
                let (mut priority, mut width) = (0u8, 0.0_f64);
                for st in layout.streets.iter().filter(|s| s.role != "wall-lane") {
                    for (i, w) in st.path.windows(2).enumerate() {
                        if g::distance(p, w[0], w[1]).0 < 1.0 {
                            let pr = if matches!(st.role.as_str(), "regional" | "approach") { 3 } else if st.rank <= 1 { 2 } else if st.rank == 2 { 1 } else { 0 };
                            let wd = st.widths.get(i).copied().unwrap_or(4.0);
                            if (pr, wd) > (priority, width) {
                                priority = pr;
                                width = wd;
                            }
                        }
                    }
                }
                Crossing { at: p, arc: arc_of(&path, &cum, p), priority, width }
            })
            .collect();
        // A walled village (under 2 000) keeps a gate on each of its few roads; a town has a budget.
        let budget = if pop < 2_000 { usize::MAX } else { gate_budget(pop, &e.purpose) };
        // Posterns are the minor gates the curtain was built with; a later minor street gets none.
        if crossings.iter().filter(|c| c.priority >= 2).count() <= budget {
            // Within the budget every main crossing is a gate; the other streets keep the gates they had.
            for c in crossings.iter().filter(|c| c.priority >= 2) {
                if e.gates.iter().all(|&q| dist(q, c.at) >= 8.0) {
                    e.gates.push(c.at);
                }
            }
            continue;
        }
        crossings.sort_by(|a, b| b.priority.cmp(&a.priority).then(b.width.total_cmp(&a.width)).then(a.arc.total_cmp(&b.arc)));
        // Spacing along the circuit: about a third of an even share.
        let spacing = (total / budget as f64 * 0.35).clamp(40.0, 250.0);
        let apart = |kept: &[&Crossing], c: &Crossing, s: f64| {
            kept.iter().all(|k| {
                let d = (k.arc - c.arc).rem_euclid(total);
                d.min(total - d) >= s
            })
        };
        let mut kept: Vec<&Crossing> = vec![];
        for c in crossings.iter().filter(|c| c.priority >= 2) {
            if kept.len() < budget && apart(&kept, c, spacing) {
                kept.push(c);
            }
        }
        let main = kept.len();
        for c in crossings.iter().filter(|c| c.priority < 2 && e.gates.iter().any(|&q| dist(q, c.at) < 8.0)) {
            if kept.len() < main + POSTERNS && !kept.iter().any(|k| std::ptr::eq(*k, c)) && apart(&kept, c, spacing * 0.5) {
                kept.push(c);
            }
        }
        if kept.is_empty() {
            continue;
        }
        let dropped: Vec<&Crossing> = crossings.iter().filter(|c| !kept.iter().any(|k| std::ptr::eq(*k, *c))).collect();
        // Gate points: the kept crossings, the water passage ends and the water and shore gates.
        let water: Vec<usize> = e.gatehouses.iter().filter(|gh| matches!(gh.kind.as_str(), "water" | "shore")).map(|gh| gh.gate).collect();
        let ends: Vec<Point> = passages.iter().flat_map(|&(a, b)| [a, b]).collect();
        let mut gates: Vec<Point> = vec![];
        let mut remap = vec![None; e.gates.len()];
        for (i, &q) in e.gates.iter().enumerate() {
            // A regional road ending on the curtain (its outer part is the regional network) keeps its gate.
            let access = layout.streets.iter().filter(|s| matches!(s.role.as_str(), "regional" | "approach") && s.path.len() >= 2).any(|s| {
                let hw = s.widths.iter().copied().fold(0.0, f64::max) * 0.5 + 2.0;
                dist(s.path[0], q) < hw || dist(s.path[s.path.len() - 1], q) < hw
            });
            let keep = water.contains(&i)
                || ends.iter().any(|&p| dist(p, q) < 1.0)
                || access
                || kept.iter().any(|k| dist(k.at, q) < 8.0);
            if keep {
                remap[i] = Some(gates.len());
                gates.push(q);
            }
        }
        for k in &kept {
            if gates.iter().all(|&q| dist(q, k.at) >= 8.0) {
                gates.push(k.at);
            }
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
        // A main road whose crossing closes goes round outside to the nearest kept gate.
        let off = e
            .ditch
            .iter()
            .flat_map(|d| d.shape.outer.iter())
            .map(|&p| path.windows(2).map(|w| g::distance(p, w[0], w[1]).0).fold(f64::INFINITY, f64::min))
            .fold(e.curtain_width_m + 4.0, f64::max)
            + 4.0;
        let ns = normals(&path);
        for c in dropped.iter().filter(|c| c.priority >= 2) {
            let Some(k) = kept.iter().filter(|k| k.priority >= 2).min_by(|a, b| {
                let d = |k: &&&Crossing| { let d = (k.arc - c.arc).rem_euclid(total); d.min(total - d) };
                d(a).total_cmp(&d(b))
            }) else {
                continue;
            };
            if let Some(road) = connector(&path, &cum, &ns, c.arc, k.arc, off) {
                connectors.push(road);
            }
        }
    }
    // The blocks give up the road and the strip between it and the moat (4 m + margin): no unbuildable
    // sliver is left against the reserve; the land beyond fronts the new road.
    let ribbons: Vec<Shape> = connectors.iter().flat_map(|s| g::ribbon(&s.path, &vec![s.widths[0] + 10.0; s.path.len()])).collect();
    layout.streets.extend(connectors);
    ribbons
}

/// Extra-mural road from arc `from` to arc `to` of the closed `path`, the shorter way round, `off`
/// metres outside the curtain (beyond its moat), or `None` when it would be long (over 600 m or half
/// the circuit).
fn connector(path: &[Point], cum: &[f64], ns: &[V], from: f64, to: f64, off: f64) -> Option<Street> {
    let n_seg = path.len() - 1;
    let total = cum[n_seg];
    let forward = (to - from).rem_euclid(total);
    let (len, sign) = if forward <= total - forward { (forward, 1.0) } else { (total - forward, -1.0) };
    if len > 600.0 || len >= total * 0.5 || len < 1.0 {
        return None;
    }
    let at = |s: f64| {
        let s = s.rem_euclid(total);
        let k = (0..n_seg).find(|&k| cum[k + 1] >= s).unwrap_or(n_seg - 1);
        let p = add(path[k], dir(path[k], path[k + 1]), s - cum[k]);
        add(p, ns[k], off)
    };
    let steps = (len / 12.0).ceil().max(1.0) as usize;
    let points: Vec<Point> = (0..=steps).map(|j| at(from + sign * len * j as f64 / steps as f64)).collect();
    let mut points = g::simplify(&points, 1.5, |_| false);
    points.dedup_by(|a, b| dist(*a, *b) < 0.5);
    (points.len() >= 2).then(|| Street { widths: vec![4.0; points.len()], path: points, rank: 2, role: "street".into() })
}

/// Below this length (m) of street outside a gate, with no regional road, bridge or other gate reached,
/// a gate leads nowhere.
const DEAD_END: f64 = 80.0;

/// Last of the pipeline. A gate must lead somewhere:
/// - a gate point no street crosses or reaches any more (the street was pruned, moved off the water,
///   trimmed) closes with its gatehouse;
/// - a gate whose street ends shortly outside (under `DEAD_END` m of street beyond the wall, reaching no
///   regional road, bridge, other gate or block it serves) closes too: its outer stub goes and the inner
///   street ends at the wall. A stub serving a block is a suburb street: its gate stays, so no block loses
///   its access this late.
///
/// Water gates, water fronts and regional roads entering from the network stay.
pub(in super::super) fn drop_dead_gates(layout: &mut super::super::Layout) {
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
        let crossings = super::super::composition::gates(&e.path, streets);
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

#[cfg(test)]
mod tests {
    use super::*;

    /// Walls review 17/11: the gate budget follows the population (2-4 under 5 000, 5 at 10 000,
    /// 6-8 for large cities) and keeps two for a castle.
    #[test]
    fn walls17_gate_budget_follows_population() {
        assert_eq!([2_000, 5_000, 10_000, 20_000, 40_000, 200_000].map(|p| gate_budget(p, "")), [3, 4, 5, 6, 7, 8]);
        assert_eq!(gate_budget(50_000, "castle"), 2);
    }

    /// Walls review 17/11: a gate must lead somewhere. A street leaving through a gate and ending 20 m
    /// outside closes its gate and ends at the wall; one going on into the country keeps its gate.
    #[test]
    fn walls17_a_gate_leading_nowhere_closes() {
        let path = closed(&g::rectangle(600.0, 600.0, 1400.0, 1400.0).outer);
        let street = |a: (f64, f64), b: (f64, f64)| Street { path: vec![pt(a.0, a.1), pt(b.0, b.1)], widths: vec![6.0; 2], rank: 1, role: "street".into() };
        let e = Enclosure { path, kind: "wall".into(), style: "curtain".into(), curtain_width_m: 3.0, gates: vec![pt(1000.0, 600.0), pt(1000.0, 1400.0)], ..Default::default() };
        let mut layout = super::super::super::Layout {
            config: None, programme: None, key: "gates".into(), culture: "european-organic".into(), center: pt(1000.0, 1000.0),
            quarters: vec![], streets: vec![street((1000.0, 1000.0), (1000.0, 580.0)), street((1000.0, 1000.0), (1000.0, 1900.0))],
            blocks: vec![], warnings: vec![], enclosures: vec![e], phases: vec![], archetype: String::new(), structure: None, claim: Default::default(),
        };
        drop_dead_gates(&mut layout);
        let e = &layout.enclosures[0];
        assert_eq!(e.gates.len(), 1, "the blind gate stays open");
        assert!(dist(e.gates[0], pt(1000.0, 1400.0)) < 1.0);
        let north = layout.streets.iter().flat_map(|s| s.path.iter()).map(|p| p.y).fold(f64::INFINITY, f64::min);
        assert!(north > 600.0, "the street still runs past the wall ({north:.0})");
        assert!(layout.streets.iter().any(|s| s.path.iter().any(|p| p.y > 1800.0)), "the road into the country was cut");
    }

    /// Walls review 17/11: an extra-mural road runs outside the curtain, the short way round.
    #[test]
    fn walls17_connector_goes_round_outside() {
        let path = closed(&g::rectangle(0.0, 0.0, 400.0, 400.0).outer);
        let cum: Vec<f64> = std::iter::once(0.0).chain(path.windows(2).scan(0.0, |a, w| { *a += dist(w[0], w[1]); Some(*a) })).collect();
        let ns = normals(&path);
        let road = connector(&path, &cum, &ns, 100.0, 300.0, 20.0).expect("a connector");
        let ring = g::normalized(Shape { outer: path[..4].to_vec(), holes: vec![] });
        assert!(road.path.iter().all(|&p| !g::contains(&ring, p)), "a connector inside the wall");
        let length: f64 = road.path.windows(2).map(|w| dist(w[0], w[1])).sum();
        assert!(length < 300.0, "the long way round: {length:.0} m");
        assert!(connector(&path, &cum, &ns, 0.0, 800.0, 20.0).is_none(), "half the circuit is no connector");
    }
}
