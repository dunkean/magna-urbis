//! Trim and square street ends, and seat or weld them onto adjoining streets.

use super::analysis::Graph;
use super::site_options::different_level;
use super::spatial::{BoxGrid, EPS, Key, PointGrid, distance, key, lerp, segment_box};
use super::street::{CROSSINGS, private, protected, width};
use crate::urban::{Point, Shape, Street, Surface};
use std::collections::{BTreeMap, BTreeSet};

/// Invariant (square dead end): a dead-end street's land stops on the line
/// square to its last segment through its end. The round joint of the
/// vertex before a short last segment would otherwise bulge past the end
/// and bite a round notch into the block it points at.
pub(in crate::urban) fn square_ends(
    pieces: Vec<Shape>,
    path: &[Point],
    widths: &[f64],
    dead: [bool; 2],
) -> Vec<Shape> {
    use crate::urban::geometry as g;
    let n = path.len();
    if n < 3 {
        return pieces;
    }
    let reach = 2.0 * widths.iter().copied().fold(1.0, f64::max);
    let mut beyond = vec![];
    for (on, end, prev) in [
        (dead[0], path[0], path[1]),
        (dead[1], path[n - 1], path[n - 2]),
    ] {
        let l = distance(prev, end);
        if !on || l < EPS {
            continue;
        }
        let (dx, dy) = ((end.x - prev.x) / l, (end.y - prev.y) / l);
        let at = |a: f64, b: f64| Point {
            x: end.x + dx * a - dy * b,
            y: end.y + dy * a + dx * b,
        };
        beyond.push(g::normalized(Shape {
            outer: vec![
                at(0.0, -reach),
                at(reach, -reach),
                at(reach, reach),
                at(0.0, reach),
            ],
            holes: vec![],
        }));
    }
    if beyond.is_empty() {
        return pieces;
    }
    pieces
        .into_iter()
        .flat_map(|p| {
            beyond.iter().fold(vec![p], |acc, b| {
                acc.iter().flat_map(|p| g::difference(p, b)).collect()
            })
        })
        .filter(|p| g::area(p) > 1e-3)
        .collect()
}

/// Invariant (clean ends), asserted on the final network once every stage that
/// adds or trims streets (access lanes, trim, walls, regional spans) has run.
/// It only shortens or removes (the blocks are cut): a loose tail running past its last junction by no
/// more than it takes to leave that junction's widest road (half its width,
/// half its own, 1.5 m) is cut back to the junction; a spur that never leaves
/// its host road that way is removed. Protected roads, crossings, private
/// access ways and gate passages (`keep`) keep their ends. Returns whether
/// anything changed.
pub(in crate::urban) fn polish_ends(streets: &mut Vec<Street>, keep: &[Point], remnants: bool) -> bool {
    let mut changed = false;
    let keep_grid = PointGrid::new(keep.to_vec(), 4.0);
    let kept = |p: Point| keep_grid.any_within(p, 1.0);
    // Ends left loose by a removed crossing stub: what led to it goes too (`remnants`).
    let mut orphaned: BTreeSet<Key> = BTreeSet::new();
    for _ in 0..if remnants { 6 } else { 3 } {
        let graph = Graph::new(streets);
        let mut wide: std::collections::HashMap<Key, f64> = Default::default();
        for s in streets.iter() {
            for (i, &p) in s.path.iter().enumerate() {
                let w = wide.entry(key(p)).or_insert(0.0);
                *w = w.max(width(s, i));
            }
        }
        let mut pass = false;
        // A bridge approach is protected, but one left with a loose end is the
        // remnant of a deck moved to its abutments (`snap_to_abutments`).
        let fixed = |s: &Street| (protected(s) && s.role != "approach") || private(s) || CROSSINGS.contains(&s.role.as_str()) || s.path.len() < 2;
        for s in streets.iter_mut().filter(|s| !fixed(s)) {
            for last in [false, true] {
                if last {
                    s.path.reverse();
                    s.widths.reverse();
                }
                // From the loose end (index 0) to the first junction.
                if graph.degree(s.path[0]) == 1
                    && !kept(s.path[0])
                    && let Some(j) = (1..s.path.len()).find(|&i| graph.degree(s.path[i]) >= 3)
                    && j + 1 < s.path.len()
                {
                    let tail: f64 = s.path[..=j].windows(2).map(|p| distance(p[0], p[1])).sum();
                    if tail <= 0.5 * wide[&key(s.path[j])] + 0.5 * width(s, j) + 1.5 {
                        s.path.drain(..j);
                        let n = s.widths.len().min(j);
                        s.widths.drain(..n);
                        pass = true;
                    }
                }
                if last {
                    s.path.reverse();
                    s.widths.reverse();
                }
            }
        }
        let graph = Graph::new(streets);
        let before = streets.len();
        // A spur lying within another street's ribbon all along (the remnant of a
        // moved crossing beside the road) adds no access.
        let bbox = |s: &Street, pad: f64| s.path.iter().fold((f64::MAX, f64::MAX, f64::MIN, f64::MIN), |b, p|
            (b.0.min(p.x - pad), b.1.min(p.y - pad), b.2.max(p.x + pad), b.3.max(p.y + pad)));
        // The hosts' grown boxes; only those meeting the spur's box can hold it.
        let host_boxes: Vec<_> = streets.iter().map(|h| bbox(h, 15.0)).collect();
        let host_grid = BoxGrid::new(&host_boxes, 64.0);
        let shadowed = |index: usize, s: &Street| {
            let samples: Vec<(Point, f64)> = s.path.windows(2).enumerate().flat_map(|(k, w)| {
                let n = (distance(w[0], w[1]) / 2.0).ceil().max(1.0) as usize;
                (0..=n).map(move |t| (lerp(w[0], w[1], t as f64 / n as f64), k))
            }).map(|(p, k)| (p, width(s, k))).collect();
            let own = bbox(s, 0.0);
            host_grid.query(own.0, own.1, own.2, own.3).into_iter()
                .filter(|&j| j != index && !private(&streets[j]) && streets[j].path.len() >= 2).filter(|&j| {
                // The host's box must hold the whole spur (its ribbon reaches at most ~15 m).
                let b = host_boxes[j];
                b.0 <= own.0 && b.1 <= own.1 && b.2 >= own.2 && b.3 >= own.3
            }).map(|j| &streets[j]).any(|h| {
                samples.iter().all(|&(p, own)| h.path.windows(2).enumerate().any(|(k, w)| {
                    let (d, t, _) = crate::urban::geometry::distance(p, w[0], w[1]);
                    d <= 0.5 * (width(h, k) + (width(h, k + 1) - width(h, k)) * t) + 0.5 * own + 0.5
                }))
            })
        };
        // Two short streets joining the same two points: the less important goes.
        let ends = |s: &Street| { let (a, b) = (key(s.path[0]), key(s.path[s.path.len() - 1])); if a <= b { (a, b) } else { (b, a) } };
        let doubled: BTreeSet<usize> = {
            let mut by: BTreeMap<(Key, Key), Vec<usize>> = BTreeMap::new();
            for (i, s) in streets.iter().enumerate().filter(|(_, s)| s.path.len() >= 2 && key(s.path[0]) != key(s.path[s.path.len() - 1])
                && s.path.windows(2).map(|p| distance(p[0], p[1])).sum::<f64>() < 12.0) {
                by.entry(ends(s)).or_default().push(i);
            }
            by.values().filter(|v| v.len() >= 2).flat_map(|v| {
                let best = *v.iter().min_by_key(|&&i| (streets[i].rank, i)).unwrap();
                v.iter().copied().filter(move |&i| i != best).collect::<Vec<_>>()
            }).collect()
        };
        let keep: Vec<bool> = streets.iter().enumerate().map(|(index, s)| {
            if remnants && doubled.contains(&index) && !s.path.iter().any(|&p| kept(p)) {
                return false;
            }
            let n = s.path.len();
            let loose = n >= 2 && (graph.degree(s.path[0]) == 1 || graph.degree(s.path[n - 1]) == 1);
            if s.path.iter().any(|&p| kept(p)) {
                return true;
            }
            // A ford or causeway stub shorter than its width with a loose end crosses nothing.
            if remnants && matches!(s.role.as_str(), "ford" | "causeway") && loose
                && s.path.windows(2).map(|p| distance(p[0], p[1])).sum::<f64>() < width(s, 0) {
                return false;
            }
            if fixed(s) {
                return true;
            }
            // An approach whose loose end reaches no crossing (the crossing moved) leads nowhere.
            if remnants && loose && s.path.iter().any(|&p| orphaned.contains(&key(p)))
                && s.path.windows(2).map(|p| distance(p[0], p[1])).sum::<f64>() < 30.0 {
                return false;
            }
            if remnants && loose && !(graph.degree(s.path[0]) == 1 && graph.degree(s.path[n - 1]) == 1) && shadowed(index, s) {
                return false;
            }
            let length: f64 = s.path.windows(2).map(|p| distance(p[0], p[1])).sum();
            let (a, b) = (graph.degree(s.path[0]), graph.degree(s.path[n - 1]));
            let host = match (a, b) {
                (1, 1) => return length >= width(s, 0),
                (1, _) => wide.get(&key(s.path[n - 1])).copied().unwrap_or(0.0),
                (_, 1) => wide.get(&key(s.path[0])).copied().unwrap_or(0.0),
                _ => return true,
            };
            length > 0.5 * host + 0.5 * width(s, 0) + 1.5 && !(s.role == "approach" && length < 8.0)
        }).collect();
        // A removed street's ends become orphaned (only remnants follow them).
        for (index, (s, &k)) in streets.iter().zip(&keep).enumerate() {
            if !k && remnants && s.path.len() >= 2 && (matches!(s.role.as_str(), "ford" | "causeway") || doubled.contains(&index)
                || s.path.iter().any(|&p| orphaned.contains(&key(p)))) {
                orphaned.extend(s.path.iter().map(|&p| key(p)));
            }
        }
        let mut keep = keep.into_iter();
        streets.retain(|_| keep.next().unwrap_or(true));
        pass |= streets.len() != before;
        changed |= pass;
        if !pass {
            break;
        }
    }
    changed
}

/// Invariant (seated mouths): an access way (close, derb, hutong…) whose loose
/// end lies inside a street's ribbon starts on that street's axis, so the two
/// meet at a junction instead of a cap floating in the road. Only the access
/// way's own end vertex moves, within the street's land (the blocks are cut);
/// a way that then does not leave its street by its own width is removed.
/// Returns how many mouths were seated.
pub(in crate::urban) fn seat_mouths(streets: &mut Vec<Street>) -> usize {
    use crate::urban::geometry as g;
    // Ends shared only by access ways (several derbs from one root) still float.
    let public: Vec<Street> = streets.iter().filter(|s| !private(s)).cloned().collect();
    let graph = Graph::new(&public);
    let mut seated = 0;
    for i in 0..streets.len() {
        if !private(&streets[i]) || streets[i].path.len() < 2 {
            continue;
        }
        for last in [false, true] {
            let mut s = streets[i].clone();
            if last {
                s.path.reverse();
                s.widths.reverse();
            }
            let p = s.path[0];
            if graph.degree(p) != 0 {
                continue;
            }
            // The nearest street segment whose ribbon holds the end.
            // In the ribbon, or past its edge by at most half the way's width (0.75 m).
            let reach = (0.5 * width(&s, 0)).min(0.75);
            let inside = |q: Point, h: &Street, k: usize| {
                let (d, t, _) = g::distance(q, h.path[k], h.path[k + 1]);
                d <= 0.5 * (width(h, k) + (width(h, k + 1) - width(h, k)) * t) + reach
            };
            let Some((_, hi, k)) = streets.iter().enumerate()
                .filter(|&(j, h)| j != i && !private(h) && h.path.len() >= 2 && !CROSSINGS.contains(&h.role.as_str()))
                .flat_map(|(j, h)| (0..h.path.len() - 1).map(move |k| (j, h, k)))
                .filter(|&(_, h, k)| inside(p, h, k))
                .map(|(j, h, k)| (g::distance(p, h.path[k], h.path[k + 1]).0, j, k))
                .min_by(|a, b| a.0.total_cmp(&b.0))
            else {
                continue;
            };
            let h = &streets[hi];
            let (a, b) = (h.path[k], h.path[k + 1]);
            // Crossing the axis from inside the ribbon: the part past the axis goes.
            let crossing = (0..s.path.len() - 1)
                .take_while(|&j| inside(s.path[j], h, k))
                .find_map(|j| g::segment_hit(s.path[j], s.path[j + 1], a, b).map(|(_, x)| (j, x)));
            let (_, _, q) = g::distance(p, a, b);
            let inner = s.path[1];
            if let Some((j, x)) = crossing {
                if distance(x, s.path[j + 1]) < 0.05 {
                    s.path.drain(..=j);
                    s.widths.drain(..(j + 1).min(s.widths.len()));
                    s.path[0] = x;
                } else {
                    s.path.drain(..j);
                    s.widths.drain(..j.min(s.widths.len()));
                    s.path[0] = x;
                }
            } else if distance(p, q) > 1e-6 && (inner.x - q.x) * (inner.x - p.x) + (inner.y - q.y) * (inner.y - p.y) > 0.0 {
                s.path[0] = q;
            } else {
                continue;
            }
            if s.path.len() < 2 || s.path.windows(2).map(|w| distance(w[0], w[1])).sum::<f64>() < 1.0 {
                continue;
            }
            // The street takes the mouth as a vertex: a junction, not a touch.
            let mouth = s.path[0];
            if last {
                s.path.reverse();
                s.widths.reverse();
            }
            streets[i] = s;
            let h = &mut streets[hi];
            if distance(h.path[k], mouth) > 0.05 && distance(h.path[k + 1], mouth) > 0.05 && g::distance(mouth, h.path[k], h.path[k + 1]).0 < 0.05 {
                let w = 0.5 * (width(h, k) + width(h, k + 1));
                h.path.insert(k + 1, mouth);
                if h.widths.len() > k + 1 { h.widths.insert(k + 1, w); }
            }
            seated += 1;
        }
    }
    // A seated way that does not leave its street by its own width is a nub.
    streets.retain(|s| {
        if !private(s) || s.path.len() < 2 {
            return true;
        }
        let length: f64 = s.path.windows(2).map(|w| distance(w[0], w[1])).sum();
        let host = [s.path[0], s.path[s.path.len() - 1]].into_iter().filter_map(|p| public.iter()
            .flat_map(|h| (0..h.path.len().saturating_sub(1)).map(move |k| (h, k)))
            .filter(|&(h, k)| g::distance(p, h.path[k], h.path[k + 1]).0 < 0.05)
            .map(|(h, k)| width(h, k))
            .reduce(f64::max)).reduce(f64::max);
        host.is_none_or(|w| length > 0.5 * w + width(s, 0) + 0.5)
    });
    seated
}

/// Invariant (joined ends), behind `roadEndJoins`: a loose street end whose
/// ribbon reaches another street (its axis within both half widths and 1 m)
/// is carried onto that axis, which takes the junction as a vertex. Run before
/// the blocks are cut, so they follow. Regional roads, crossings and access
/// ways keep their ends; one join per street. Returns how many ends joined.
pub(in crate::urban) fn weld_ends(streets: &mut Vec<Street>, surface: Surface<'_>) -> usize {
    let mut total = node_ends(streets);
    // A street moves or hosts once per round; a few rounds join the rest.
    for _ in 0..4 {
        let joined = weld_round(streets, surface);
        total += joined;
        if joined == 0 {
            break;
        }
    }
    total
}
/// Street ends lying on another street's segment (a T without a shared
/// vertex): that street takes them as vertices, so the junction is one.
fn node_ends(streets: &mut [Street]) -> usize {
    use crate::urban::geometry as g;
    const CELL: f64 = 16.0;
    let cell = |p: Point| ((p.x / CELL).floor() as i64, (p.y / CELL).floor() as i64);
    let mut grid: BTreeMap<(i64, i64), Vec<(usize, usize)>> = BTreeMap::new();
    for (j, h) in streets.iter().enumerate().filter(|(_, h)| !private(h)) {
        for (k, w) in h.path.windows(2).enumerate() {
            let (a, b) = (cell(Point { x: w[0].x.min(w[1].x), y: w[0].y.min(w[1].y) }), cell(Point { x: w[0].x.max(w[1].x), y: w[0].y.max(w[1].y) }));
            for x in a.0..=b.0 { for y in a.1..=b.1 { grid.entry((x, y)).or_default().push((j, k)); } }
        }
    }
    // (host, segment, point), inserted back to front per host.
    let mut cuts: Vec<(usize, usize, Point)> = vec![];
    // The cut points already taken by each host.
    let mut taken: BTreeMap<usize, Vec<Point>> = BTreeMap::new();
    for (i, s) in streets.iter().enumerate().filter(|(_, s)| !private(s) && s.path.len() >= 2) {
        for p in [s.path[0], s.path[s.path.len() - 1]] {
            for &(j, k) in grid.get(&cell(p)).into_iter().flatten() {
                let h = &streets[j];
                if j == i || CROSSINGS.contains(&h.role.as_str()) && h.role != "wall-lane" {
                    continue;
                }
                let (a, b) = (h.path[k], h.path[k + 1]);
                if g::distance(p, a, b).0 <= 0.05 && distance(p, a) > 0.05 && distance(p, b) > 0.05
                    && !taken.get(&j).is_some_and(|v| v.iter().any(|&q| distance(q, p) <= 0.05)) {
                    cuts.push((j, k, p));
                    taken.entry(j).or_default().push(p);
                }
            }
        }
    }
    cuts.sort_by(|a, b| b.0.cmp(&a.0).then(b.1.cmp(&a.1)).then_with(|| {
        // Within one segment, farther from its start first.
        let (s, k) = (&streets[a.0], a.1);
        distance(b.2, s.path[k]).total_cmp(&distance(a.2, s.path[k]))
    }));
    for &(j, k, p) in &cuts {
        let h = &mut streets[j];
        let w = 0.5 * (width(h, k) + width(h, k + 1));
        h.path.insert(k + 1, p);
        if h.widths.len() > k + 1 { h.widths.insert(k + 1, w); }
    }
    cuts.len()
}
fn weld_round(streets: &mut [Street], surface: Surface<'_>) -> usize {
    use crate::urban::geometry as g;
    let graph = Graph::new(streets);
    let crossing = |s: &Street| private(s) || s.path.len() < 2
        || matches!(s.role.as_str(), "bridge" | "ford" | "causeway" | "approach") || CROSSINGS.contains(&s.role.as_str());
    // (street, at its last vertex, host, host segment, junction, carried onto the axis)
    let mut joins: Vec<(usize, bool, usize, usize, Point, bool)> = vec![];
    let mut used = BTreeSet::new();
    // Host segments in (street, segment) order, by box grown by their half
    // width: an end reaches a host within that half width plus its own half
    // width and a metre, so only the boxes within that reach are tested.
    let hosts: Vec<(usize, usize)> = streets
        .iter()
        .enumerate()
        .filter(|(_, h)| !private(h) && h.path.len() >= 2 && (h.role == "wall-lane" || !CROSSINGS.contains(&h.role.as_str())))
        .flat_map(|(j, h)| (0..h.path.len() - 1).map(move |k| (j, k)))
        .collect();
    let host_grid = BoxGrid::new(
        &hosts
            .iter()
            .map(|&(j, k)| {
                let h = &streets[j];
                segment_box(h.path[k], h.path[k + 1], 0.5 * width(h, k).max(width(h, k + 1)))
            })
            .collect::<Vec<_>>(),
        32.0,
    );
    for (i, s) in streets.iter().enumerate() {
        if crossing(s) || used.contains(&i) {
            continue;
        }
        for last in [false, true] {
            let n = s.path.len();
            let (p, inner, own) = if last { (s.path[n - 1], s.path[n - 2], width(s, n - 1)) } else { (s.path[0], s.path[1], width(s, 0)) };
            if graph.degree(p) != 1 {
                continue;
            }
            let reach = 0.5 * own + 1.0;
            let best = host_grid.query(p.x - reach, p.y - reach, p.x + reach, p.y + reach).into_iter()
                .map(|n| hosts[n])
                .filter(|&(j, _)| j != i && !used.contains(&j))
                .filter_map(|(j, k)| {
                    let h = &streets[j];
                    let (a, b) = (h.path[k], h.path[k + 1]);
                    let (d, t, q) = g::distance(p, a, b);
                    let half = 0.5 * (width(h, k) + (width(h, k + 1) - width(h, k)) * t);
                    (d <= half + 0.5 * own + 1.0).then_some((d, half, j, k, q))
                })
                .min_by(|a, b| a.0.total_cmp(&b.0));
            let Some((d, half, j, k, q)) = best else { continue };
            // Inside the host's ribbon the end is carried onto its axis; outside
            // it runs on to it, ahead or across, never back; same level.
            let carried = d <= half;
            // A regional road only closes a gap of a metre (two pieces of one road).
            if s.role == "regional" && d > 1.0 {
                continue;
            }
            // On the other street already: it takes the junction as a vertex.
            if d <= 0.05 {
                let h = &streets[j];
                if distance(h.path[k], q) > 0.05 && distance(h.path[k + 1], q) > 0.05 {
                    joins.push((i, last, j, k, q, true));
                    used.insert(i);
                    used.insert(j);
                }
                break;
            }
            let (u, v) = ((p.x - inner.x, p.y - inner.y), (q.x - p.x, q.y - p.y));
            let lu = u.0.hypot(u.1).max(1e-9);
            if (!carried && (u.0 * v.0 + u.1 * v.1) / (lu * d) < -0.2) || different_level(surface, p, q) {
                continue;
            }
            joins.push((i, last, j, k, q, carried));
            used.insert(i);
            used.insert(j);
            break;
        }
    }
    for &(i, last, j, k, q, carried) in &joins {
        let h = &mut streets[j];
        let q = match [h.path[k], h.path[k + 1]].into_iter().find(|&v| distance(v, q) < 0.05) {
            Some(v) => v,
            None => {
                let w = 0.5 * (width(h, k) + width(h, k + 1));
                h.path.insert(k + 1, q);
                if h.widths.len() > k + 1 { h.widths.insert(k + 1, w); }
                q
            }
        };
        let s = &mut streets[i];
        let n = s.path.len();
        match (last, carried) {
            (true, true) => s.path[n - 1] = q,
            (false, true) => s.path[0] = q,
            (true, false) => { let w = width(s, n - 1); s.path.push(q); s.widths.push(w); }
            (false, false) => { let w = width(s, 0); s.path.insert(0, q); s.widths.insert(0, w); }
        }
    }
    joins.len()
}
