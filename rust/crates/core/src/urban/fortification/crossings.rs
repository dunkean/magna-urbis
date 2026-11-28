//! Close unserved street crossings and stop dead ends at the curtain face.

use crate::urban::{Enclosure, Layout, Point, Shape, Street, Surface, geometry as g, network};
use super::gate_budget;
use super::geometry::{Box2, cross, dir, dist, pt, ribbon_half};
use super::moat_line;
use super::street_clearance::Near;

/// Shortest street (m) a dead end cut back at the wall face may leave.
const MIN_STUB: f64 = 4.0;
/// An end this close (m) to another street's segment meets it (a T junction).
const T_JOIN: f64 = 0.5;
/// Longest straight link (m) from an inner end cut at the wall to the wall-lane or a gate street.
const LINK_REACH: f64 = 20.0;
/// Shortest spur (m) off its last junction an unlinked inner end cut at the wall keeps.
const MIN_SPUR: f64 = 30.0;
/// An inner dead end this close (m) to a gatehouse mass or to the curtain face stands beside the wall.
const BESIDE: f64 = 15.0;
/// Link targets along a gate street: from the inner face of its gatehouse inward, every `GATE_STEP` m
/// up to `GATE_DEPTH` m.
const GATE_STEP: f64 = 4.0;
const GATE_DEPTH: f64 = 40.0;
/// An outer end cut back from a moat stops this far (m) beyond its outer lip.
const LIP_MARGIN: f64 = 3.0;
/// Longest link (m) from an outer end cut back at the wall to a gate street outside, and longest spur
/// it goes back to its last junction without one.
const OUT_REACH: f64 = 60.0;
/// A street joined to nothing whose ends both lie within this distance (m) of a curtain is a leftover
/// of the wall cuts.
const FLOAT_REACH: f64 = 40.0;

/// The point `s` m along `path`, if the path is that long.
fn point_along(path: &[Point], s: f64) -> Option<Point> {
    let mut left = s;
    for w in path.windows(2) {
        let l = dist(w[0], w[1]);
        if left <= l {
            let t = if l > 0.0 { left / l } else { 0.0 };
            return Some(pt(w[0].x + (w[1].x - w[0].x) * t, w[0].y + (w[1].y - w[0].y) * t));
        }
        left -= l;
    }
    None
}

/// Invariant (a street stops at the wall face): a street end that no other
/// street meets (a dead end: no shared vertex, not on another street's
/// segment) on the curtain body, in the reserve (berm, ditch, glacis, a
/// tower's foot) or inside the outer lip of a moat is cut back to where the
/// street leaves them, `LIP_MARGIN` m beyond the lip where it crossed the
/// ditch. Only a street through a gate crosses the curtain, so no dead end
/// carves a slot into the wall or the ditch; a lane ending beside an outer
/// lean-to serves it and keeps its end, and a street that crosses the curtain
/// before ending in the outer reserve is a gate street (its causeway): it is
/// never cut back through the wall, which would close its gate. A street left
/// shorter than its width (at least `MIN_STUB` m) goes whole. The corridor
/// freed on the curtain body returns to the reserve.
///
/// No cul-de-sac beside the wall: an inner end cut back, a dead end beside a
/// gatehouse (`BESIDE`) and a spur under `MIN_SPUR` m ending beside the curtain
/// join the nearest wall-lane or gate street by a straight link (`LINK_REACH`,
/// else a point of the gate street behind its gatehouse) inside the circuit,
/// off the reserve, the gatehouses and the water; with no such link a spur
/// under `MIN_SPUR` m off its last junction goes back to that junction. Outside,
/// a main road cut back joins the nearest gate street beyond the moat
/// (`OUT_REACH`), else goes back to its last junction within that reach. A
/// street joined to nothing with both ends near a curtain (`FLOAT_REACH`) goes.
pub(super) fn stop_at_curtains(streets: &mut Vec<Street>, enclosures: &mut [Enclosure], surface: Surface<'_>, links: bool) {
    let profile = std::env::var("URBAN_PROFILE").is_ok();
    struct Zone {
        near: Near,
        wide: Near,
        half: f64,
        reserve: Vec<(Shape, Box2)>,
        moat: Vec<(Shape, Box2)>,
        lean: Vec<Shape>,
        body: Vec<Shape>,
        ring: Shape,
        gatehouses: Vec<Shape>,
        masses: Vec<(Shape, Box2)>,
    }
    let zones: Vec<Option<Zone>> = enclosures
        .iter()
        .map(|e| {
            (!e.style.is_empty() && e.path.len() >= 4).then(|| {
                let half = ribbon_half(&e.kind);
                Zone {
                    near: Near::new(&e.path, 8.0),
                    wide: Near::new(&e.path, FLOAT_REACH),
                    half,
                    reserve: e.reserve.iter().map(|s| (s.clone(), g::bbox(s))).collect(),
                    moat: e
                        .moat
                        .iter()
                        .flat_map(|m| &m.runs)
                        .filter(|r| r.inner.len() >= 3)
                        .map(|r| {
                            let s = moat_line::outer_fill(r);
                            let b = g::bbox(&s);
                            (s, b)
                        })
                        .collect(),
                    lean: e
                        .attached
                        .iter()
                        .filter(|a| a.side == "out")
                        .map(|a| a.shape.clone())
                        .collect(),
                    body: g::ribbon(&e.path, &[2.0 * half]),
                    ring: g::normalized(Shape {
                        outer: e.path[..e.path.len() - 1].to_vec(),
                        holes: vec![],
                    }),
                    gatehouses: e.gatehouses.iter().map(|gh| gh.shape.clone()).collect(),
                    masses: e
                        .gatehouses
                        .iter()
                        .filter(|gh| !matches!(gh.kind.as_str(), "water" | "shore"))
                        .flat_map(|gh| gh.masses.iter())
                        .map(|m| (m.clone(), g::bbox(m)))
                        .collect(),
                }
            })
        })
        .collect();
    let in_box = |b: &Box2, p: Point, d: f64| p.x >= b.0 - d && p.x <= b.2 + d && p.y >= b.1 - d && p.y <= b.3 + d;
    let near_ring = |s: &Shape, p: Point, d: f64| (0..s.outer.len()).any(|k| g::distance(p, s.outer[k], s.outer[(k + 1) % s.outer.len()]).0 < d);
    let inside = |z: &Zone, p: Point| {
        z.near.distance(p, p) < z.half - 1e-6 || z.reserve.iter().any(|(s, b)| in_box(b, p, 0.0) && g::contains(s, p))
    };
    // Outside the curtain, within the outer lip of a moat run (berm and ditch).
    let band = |z: &Zone, p: Point| z.moat.iter().any(|(s, b)| in_box(b, p, 0.0) && g::contains(s, p)) && !g::contains(&z.ring, p);
    let beside_mass = |z: &Zone, p: Point| z.masses.iter().any(|(m, b)| in_box(b, p, BESIDE) && (g::contains(m, p) || near_ring(m, p, BESIDE)));
    let key = |p: Point| ((p.x * 100.0).round() as i64, (p.y * 100.0).round() as i64);
    let mut degree: std::collections::HashMap<(i64, i64), usize> = Default::default();
    for s in streets.iter() {
        for &p in &s.path {
            *degree.entry(key(p)).or_default() += 1;
        }
    }
    // Street segments by cell (a snapshot), and the streets an inner end may link to: the wall-lanes
    // and the streets through a curtain (gate streets).
    const CELL: f64 = 16.0;
    let cell = |p: Point| ((p.x / CELL).floor() as i64, (p.y / CELL).floor() as i64);
    let mut grid: std::collections::HashMap<(i64, i64), Vec<(usize, Point, Point)>> = Default::default();
    for (i, s) in streets.iter().enumerate() {
        for w in s.path.windows(2) {
            let (lo, hi) = (cell(pt(w[0].x.min(w[1].x) - 1.0, w[0].y.min(w[1].y) - 1.0)), cell(pt(w[0].x.max(w[1].x) + 1.0, w[0].y.max(w[1].y) + 1.0)));
            for x in lo.0..=hi.0 {
                for y in lo.1..=hi.1 {
                    grid.entry((x, y)).or_default().push((i, w[0], w[1]));
                }
            }
        }
    }
    // Streets meeting `p` on a segment (not `i`).
    let on_segments = |i: usize, p: Point| -> Vec<usize> {
        grid.get(&cell(p)).into_iter().flatten().filter(|&&(j, a, b)| j != i && g::distance(p, a, b).0 < T_JOIN).map(|&(j, _, _)| j).collect()
    };
    let on_other = |i: usize, p: Point| !on_segments(i, p).is_empty();
    let lane: Vec<bool> = streets.iter().map(|s| s.role == "wall-lane").collect();
    let target: Vec<bool> = streets
        .iter()
        .map(|s| {
            s.role == "wall-lane"
                || !gate_budget::water_way(s, false)
                    && zones.iter().flatten().any(|z| {
                        s.path.windows(2).any(|w| z.near.distance(w[0], w[1]) == 0.0 && g::contains(&z.ring, w[0]) != g::contains(&z.ring, w[1]))
                    })
        })
        .collect();
    // Streets meeting another at a shared vertex or a T, either way round.
    let mut joined = vec![false; streets.len()];
    for (i, s) in streets.iter().enumerate() {
        if s.path.iter().any(|&p| degree.get(&key(p)).copied().unwrap_or(0) >= 2 || on_other(i, p)) {
            joined[i] = true;
        }
        for p in s.path.first().into_iter().chain(s.path.last()) {
            for j in on_segments(i, *p) {
                joined[j] = true;
            }
        }
    }
    let at_lean = |p: Point, hw: f64| zones.iter().flatten().any(|z| z.lean.iter().any(|l| g::contains(l, p) || near_ring(l, p, hw + 2.0)));
    let dead = |i: usize, p: Point, hw: f64| degree.get(&key(p)).copied().unwrap_or(0) == 1 && !on_other(i, p) && !at_lean(p, hw);
    // Points of the target streets (`lanes`: the wall-lanes too) within `reach` of `q`, nearest first:
    // the foot of the perpendicular, and points every metre along each segment (the foot may lie in a
    // gatehouse passage; the street behind it does not).
    let near_targets = |i: usize, q: Point, reach: f64, lanes: bool| -> Vec<(f64, usize, Point)> {
        let r = (reach / CELL).ceil() as i64 + 1;
        let (cx, cy) = cell(q);
        let mut seen = std::collections::HashSet::new();
        let mut options: Vec<(f64, usize, Point)> = vec![];
        for x in cx - r..=cx + r {
            for y in cy - r..=cy + r {
                for &(j, a, b) in grid.get(&(x, y)).into_iter().flatten() {
                    if j == i || !target[j] || lane[j] && !lanes || !seen.insert((j, key(a), key(b))) {
                        continue;
                    }
                    let (d, _, p) = g::distance(q, a, b);
                    if d > reach {
                        continue;
                    }
                    options.push((d, j, p));
                    let steps = dist(a, b).floor() as usize;
                    options.extend((0..=steps).map(|k| {
                        let t = if steps == 0 { 0.0 } else { k as f64 / steps as f64 };
                        let p = pt(a.x + (b.x - a.x) * t, a.y + (b.y - a.y) * t);
                        (dist(q, p), j, p)
                    }).filter(|o| o.0 <= reach));
                }
            }
        }
        options.sort_by(|a, b| a.0.total_cmp(&b.0));
        options
    };
    // A straight link from `q` to `p` on the side `within` the circuit or outside it, clear of the
    // curtain, the reserve, the gatehouses and the water (and, outside, of the moat).
    let clear = |z: &Zone, q: Point, p: Point, within: bool| {
        let steps = (dist(q, p) / 0.5).ceil().max(1.0) as usize;
        (0..=steps).all(|k| {
            let t = k as f64 / steps as f64;
            let s = pt(q.x + (p.x - q.x) * t, q.y + (p.y - q.y) * t);
            g::contains(&z.ring, s) == within
                && !inside(z, s)
                && !surface.wet(s)
                && !z.gatehouses.iter().any(|gh| g::contains(gh, s))
                && (within || !band(z, s))
        })
    };
    // Points of the gate streets near `q` from the inner face of their gatehouse inward, every
    // `GATE_STEP` m up to `GATE_DEPTH` m.
    let gate_paths: Vec<(usize, Vec<Point>)> = streets.iter().enumerate().filter(|&(j, _)| target[j] && !lane[j]).map(|(j, s)| (j, s.path.clone())).collect();
    let behind_gates = |z: &Zone, i: usize, q: Point| -> Vec<(usize, Point)> {
        let mut out = vec![];
        for (j, path) in gate_paths.iter().filter(|(j, _)| *j != i) {
            for c in 0..path.len().saturating_sub(1) {
                let (a, b) = (path[c], path[c + 1]);
                let into = g::contains(&z.ring, b);
                if into == g::contains(&z.ring, a) || z.near.distance(a, b) > 0.0 || g::distance(q, a, b).0 > GATE_DEPTH + LINK_REACH {
                    continue;
                }
                let inward: Vec<Point> = if into { path[c..].to_vec() } else { path[..=c + 1].iter().rev().copied().collect() };
                let total: f64 = inward.windows(2).map(|w| dist(w[0], w[1])).sum();
                let steps = (total / 0.5).ceil() as usize;
                let face = (0..=steps).map(|k| k as f64 * 0.5).find(|&s| {
                    point_along(&inward, s).is_some_and(|p| g::contains(&z.ring, p) && !inside(z, p) && !z.gatehouses.iter().any(|gh| g::contains(gh, p)))
                });
                let Some(face) = face else { continue };
                out.extend((0..=(GATE_DEPTH / GATE_STEP) as usize).filter_map(|k| point_along(&inward, face + k as f64 * GATE_STEP)).map(|p| (*j, p)));
            }
        }
        out
    };
    let link_in = |z: &Zone, i: usize, q: Point| -> Option<(usize, Point)> {
        if !links {
            return None;
        }
        near_targets(i, q, LINK_REACH, true)
            .into_iter()
            .find(|&(_, _, p)| clear(z, q, p, true))
            .map(|(_, j, p)| (j, p))
            .or_else(|| behind_gates(z, i, q).into_iter().filter(|&(_, p)| dist(q, p) <= GATE_DEPTH).find(|&(_, p)| clear(z, q, p, true)))
    };
    let link_out = |z: &Zone, i: usize, q: Point| -> Option<(usize, Point)> {
        if !links {
            return None;
        }
        near_targets(i, q, OUT_REACH, false).into_iter().find(|&(_, _, p)| clear(z, q, p, false)).map(|(_, j, p)| (j, p))
    };
    // The last junction of a street walked from its end: its vertex, and the spur beyond it (m).
    let junction = |i: usize, path: &[Point]| -> Option<(usize, f64)> {
        (0..path.len() - 1)
            .rev()
            .find(|&m| degree.get(&key(path[m])).copied().unwrap_or(0) >= 2 || on_other(i, path[m]))
            .map(|m| (m, path[m..].windows(2).map(|w| dist(w[0], w[1])).sum()))
    };
    // Vertices to insert into the link targets: (street, point).
    let mut joins: Vec<(usize, Point)> = vec![];
    let mut freed: Vec<(usize, Vec<Point>, Vec<f64>)> = vec![];
    let mut gone = vec![false; streets.len()];
    for (i, s) in streets.iter_mut().enumerate() {
        if matches!(
            s.role.as_str(),
            "wall-lane" | "bridge" | "ford" | "causeway" | "quay" | "pier" | "boardwalk" | "landing" | "mole"
        ) || s.path.len() < 2
        {
            continue;
        }
        if s.widths.len() != s.path.len() {
            let last = s.widths.last().copied().unwrap_or(4.0);
            s.widths.resize(s.path.len(), last);
        }
        // A leftover of the wall cuts, joined to nothing beside a curtain.
        let ends = [s.path[0], *s.path.last().unwrap()];
        if !joined[i] && !target[i] && !ends.iter().any(|&p| at_lean(p, s.widths[0] * 0.5))
            && zones.iter().flatten().any(|z| ends.iter().all(|&p| z.wide.distance(p, p) < FLOAT_REACH))
        {
            if profile {
                eprintln!("  wall ends: {} joined to nothing at ({:.0},{:.0}) dropped", s.role, ends[0].x, ends[0].y);
            }
            gone[i] = true;
            continue;
        }
        for end in [true, false] {
            if gone[i] {
                break;
            }
            let n = s.path.len();
            let p = if end { s.path[n - 1] } else { s.path[0] };
            let hw = s.widths[if end { n - 1 } else { 0 }] * 0.5;
            if !dead(i, p, hw) {
                continue;
            }
            let held = zones.iter().position(|z| z.as_ref().is_some_and(|z| inside(z, p) || band(z, p)));
            // An inner dead end beside a gatehouse, or beside the curtain face (a short spur only).
            let beside = if held.is_none() && s.role != "close" {
                zones.iter().position(|z| {
                    z.as_ref().is_some_and(|z| g::contains(&z.ring, p) && (beside_mass(z, p) || z.wide.distance(p, p) < z.half + BESIDE))
                })
            } else {
                None
            };
            let Some(z) = held.or(beside) else { continue };
            let zone = zones[z].as_ref().unwrap();
            if !end {
                s.path.reverse();
                s.widths.reverse();
            }
            if held.is_none() {
                let spur = junction(i, &s.path);
                // Only a main road is cut back: what is left of a street shut at the wall. A lane or a
                // street of the tissue ending near the curtain serves its block and stays.
                let short = spur.is_some_and(|(_, l)| l < MIN_SPUR) && gate_budget::priority(s) >= 2;
                if short || beside_mass(zone, p) {
                    if let Some((j, t)) = link_in(zone, i, p) {
                        let w = *s.widths.last().unwrap();
                        s.path.push(t);
                        s.widths.push(w);
                        joins.push((j, t));
                    } else if let Some((m, _)) = spur.filter(|_| short) {
                        if profile {
                            eprintln!("  wall ends: {} spur beside the wall at ({:.0},{:.0}) cut back", s.role, p.x, p.y);
                        }
                        s.path.truncate(m + 1);
                        s.widths.truncate(m + 1);
                        gone[i] = s.path.len() < 2;
                    }
                }
                if !end {
                    s.path.reverse();
                    s.widths.reverse();
                }
                continue;
            }
            // Walk back from the end, every 0.25 m, to the first point out (`LIP_MARGIN` m out once
            // the walk has met the moat).
            let mut cut = None;
            let (mut walked, mut last_in, mut ditch) = (0.0, 0.0, false);
            'walk: for k in (0..n - 1).rev() {
                let (a, b) = (s.path[k], s.path[k + 1]);
                let l = dist(a, b);
                let steps = (l / 0.25).ceil().max(1.0) as usize;
                for j in 1..=steps {
                    let t = 1.0 - j as f64 / steps as f64;
                    let q = pt(a.x + (b.x - a.x) * t, a.y + (b.y - a.y) * t);
                    let at = walked + l * j as f64 / steps as f64;
                    let moat = band(zone, q);
                    ditch |= moat;
                    let margin = if ditch { LIP_MARGIN } else { 0.0 };
                    if moat || inside(zone, q) {
                        last_in = at;
                    } else if at - last_in >= margin {
                        let w = s.widths[k] + (s.widths[k + 1] - s.widths[k]) * t;
                        cut = Some((k, q, w));
                        break 'walk;
                    }
                }
                walked += l;
            }
            // A street through the curtain ending in the outer reserve
            // passes a gate (the causeway over the ditch): it keeps its gate.
            if let Some((_, q, _)) = cut
                && zone.near.distance(p, p) >= zone.half
                && g::contains(&zone.ring, q) != g::contains(&zone.ring, p)
            {
                if !end {
                    s.path.reverse();
                    s.widths.reverse();
                }
                continue;
            }
            match cut {
                Some((k, q, w)) => {
                    let mut out = vec![q];
                    out.extend_from_slice(&s.path[k + 1..]);
                    let mut ws = vec![w];
                    ws.extend_from_slice(&s.widths[k + 1..]);
                    freed.push((z, out, ws));
                    s.path.truncate(k + 1);
                    s.widths.truncate(k + 1);
                    if dist(*s.path.last().unwrap(), q) > 1e-3 {
                        s.path.push(q);
                        s.widths.push(w);
                    }
                    // What is left of a dead end cut back to its mouth (a close running into
                    // the berm) is a stub on its host street: it goes whole.
                    let length: f64 = s.path.windows(2).map(|w| dist(w[0], w[1])).sum();
                    if s.path.len() < 2 || length < s.widths.iter().copied().fold(MIN_STUB, f64::max) {
                        gone[i] = true;
                    } else if g::contains(&zone.ring, q) {
                        // Inside: no cul-de-sac against the wall.
                        if let Some((j, t)) = link_in(zone, i, q) {
                            s.path.push(t);
                            s.widths.push(w);
                            joins.push((j, t));
                        } else if let Some((m, spur)) = junction(i, &s.path)
                            && spur < MIN_SPUR
                            && gate_budget::priority(s) >= 2
                        {
                            if profile {
                                eprintln!("  wall ends: {} spur cut at the wall at ({:.0},{:.0}) goes back to its junction", s.role, q.x, q.y);
                            }
                            s.path.truncate(m + 1);
                            s.widths.truncate(m + 1);
                            gone[i] = s.path.len() < 2;
                        }
                    } else if gate_budget::priority(s) >= 2 {
                        // Outside, a main road shut at the wall joins a gate street beyond the moat.
                        if let Some((j, t)) = link_out(zone, i, q) {
                            s.path.push(t);
                            s.widths.push(w);
                            joins.push((j, t));
                        } else if let Some((m, spur)) = junction(i, &s.path)
                            && spur <= OUT_REACH
                        {
                            s.path.truncate(m + 1);
                            s.widths.truncate(m + 1);
                            gone[i] = s.path.len() < 2;
                        }
                    }
                }
                None => {
                    freed.push((z, s.path.clone(), s.widths.clone()));
                    gone[i] = true;
                }
            }
            if !end {
                s.path.reverse();
                s.widths.reverse();
            }
        }
    }
    // A link ends on a vertex of its target: the junction is in the graph.
    for (j, t) in joins {
        let s = &mut streets[j];
        if s.path.len() < 2 || s.path.iter().any(|&p| dist(p, t) < 1e-6) {
            continue;
        }
        if s.widths.len() != s.path.len() {
            let last = s.widths.last().copied().unwrap_or(4.0);
            s.widths.resize(s.path.len(), last);
        }
        let (m, (d, u, _)) = (0..s.path.len() - 1)
            .map(|m| (m, g::distance(t, s.path[m], s.path[m + 1])))
            .min_by(|a, b| a.1.0.total_cmp(&b.1.0))
            .unwrap();
        if d < 1e-3 {
            let w = s.widths[m] + (s.widths[m + 1] - s.widths[m]) * u;
            s.path.insert(m + 1, t);
            s.widths.insert(m + 1, w);
        }
    }
    let mut k = 0;
    streets.retain(|_| {
        k += 1;
        !gone[k - 1]
    });
    for (z, path, widths) in freed {
        let body = &zones[z].as_ref().unwrap().body;
        let ws: Vec<f64> = widths.iter().map(|w| w + 1.0).collect();
        let back: Vec<Shape> = g::ribbon(&path, &ws)
            .iter()
            .flat_map(|r| body.iter().flat_map(|b| g::intersection(r, b)))
            .filter(|s| g::area(s) > 0.5)
            .collect();
        enclosures[z].reserve.extend(back);
    }
}

/// The street rules at the works, in order, on the circuits as they now stand: gate streets pass their
/// gate passages (`obey::seat_gate_streets`), other crossings of a curtain close (`close_crossings`),
/// no street but a gate street stays in a moat band (`obey::obey_moats`). `stop_at_curtains` follows.
pub(super) fn close_at_works(streets: &mut Vec<Street>, enclosures: &[Enclosure], blocks: &[crate::urban::Block], main_too: bool, surface: Surface<'_>, config: Option<&crate::urban::LayoutConfig>) {
    super::obey::seat_gate_streets(streets, enclosures, surface);
    close_crossings(streets, enclosures, main_too, surface, config);
    super::obey::obey_moats(streets, enclosures, blocks, surface);
}

/// A wall with an explicit gate count keeps the passages selected by its budget.
pub(super) fn fixed_gates(e: &Enclosure, config: Option<&crate::urban::LayoutConfig>) -> bool {
    config.and_then(|c| c.overrides.walls.get(&e.edit_key)).and_then(|w| w.gates).is_some()
}

/// A crossing within this distance (m) of a gate or of a water passage is that gate's street.
const GATE_REACH: f64 = 8.0;
/// A street that crosses a curtain within this distance (m) of a bridge deck is the way of that
/// bridge into the town. A curtain stands on every bank, so the crossing is kept and
/// `reconcile_gates` opens its gate: a bridge never leads to a blank wall.
const BRIDGE_GATE: f64 = 30.0;
/// Bridge gates stand at least this far (m) from each other and from the gates of the circuit: the
/// street of a bridge nearer than that to a gate goes through that gate.
const BRIDGE_GATE_SPACING: f64 = 60.0;
/// Invariant (every crossing of a curtain is a gate): a street that crosses a
/// curtain away from its gates and its water passages opens no bare gap in the
/// wall: it is split there, each side ending clear of the curtain body
/// (`stop_at_curtains` then pulls the ends out of the berm and the moat). The
/// quarter on each side keeps its own streets; the town is entered through the
/// gates. Decks and waterside ways pass (`gate_budget::water_way`), and so
/// does the street at a bridge head (`BRIDGE_GATE`). With
/// `main_too` every other street is held to it; without, only the lesser ones
/// (`gate_budget::priority` under 2) and every bridge ramp: a main road laid
/// after the gates were decided keeps its crossing, and `reconcile_gates` opens
/// its gate.
///
/// A cut ramp keeps its approach role only on the piece that meets its bridge.
pub(super) fn close_crossings(streets: &mut Vec<Street>, enclosures: &[Enclosure], main_too: bool, surface: Surface<'_>, config: Option<&crate::urban::LayoutConfig>) {
    let passages: Vec<_> = enclosures.iter().flat_map(|e| &e.gatehouses)
        .filter(|gh| matches!(gh.kind.as_str(), "water" | "shore"))
        .map(|gh| (gh.passage[0], gh.passage[1]))
        .collect();
    close_crossings_at(streets, enclosures, main_too, surface, &passages, |e| fixed_gates(e, config));
}

pub(super) fn close_crossings_at(streets: &mut Vec<Street>, enclosures: &[Enclosure], main_too: bool, surface: Surface<'_>, passages: &[(Point, Point)], fixed: impl Fn(&Enclosure) -> bool) {
    let walls: Vec<_> = enclosures
        .iter()
        .filter(|e| !e.style.is_empty() && e.path.len() >= 4)
        .map(|e| (Near::new(&e.path, 16.0), ribbon_half(&e.kind).max(e.curtain_width_m * 0.5), fixed(e), e))
        .collect();
    if walls.is_empty() {
        return;
    }
    let heads: Vec<Point> = streets.iter().filter(|s| s.role == "bridge")
        .flat_map(|s| s.path.first().into_iter().chain(s.path.last()).copied()).collect();
    // Street vertices by 1 m cell, for the streets that meet on a curtain (the last pass, which holds
    // every street): a point is joined when two vertices or more lie within 0.6 m of it.
    let mut vertices: std::collections::HashMap<(i64, i64), Vec<Point>> = Default::default();
    if main_too {
        for &p in streets.iter().flat_map(|s| s.path.iter()) {
            vertices.entry((p.x.floor() as i64, p.y.floor() as i64)).or_default().push(p);
        }
    }
    let joined = |p: Point| {
        let (cx, cy) = (p.x.floor() as i64, p.y.floor() as i64);
        (-1..=1).flat_map(|dx| (-1..=1).map(move |dy| (cx + dx, cy + dy))).filter_map(|c| vertices.get(&c)).flatten().filter(|&&q| dist(q, p) < 0.6).count() >= 2
    };
    let mut bridge_gates: Vec<Point> = vec![];
    let mut landings = std::collections::HashSet::new();
    if main_too {
        for deck in streets.iter().filter(|s| s.role == "bridge") {
            landings.extend(deck.path.first().into_iter().chain(deck.path.last()).map(|&p| network::key(p)));
        }
    }
    let mut out: Vec<Street> = Vec::with_capacity(streets.len());
    for mut s in std::mem::take(streets) {
        let lesser = gate_budget::priority(&s) < 2;
        // A wall-lane runs along its own curtain: one that crosses a curtain (a castle inside the town)
        // away from a gate is cut there like a lane.
        let lane = !main_too && s.role == "wall-lane";
        let held = lane || !gate_budget::water_way(&s, false) && (main_too || s.role == "approach" || lesser && s.role != "outbound");
        // A street the rule does not hold is still cut where it crosses beside a gate (`GATE_GAP`).
        if (!held && gate_budget::water_way(&s, false)) || s.path.len() < 2 {
            out.push(s);
            continue;
        }
        if s.widths.len() != s.path.len() {
            let last = s.widths.last().copied().unwrap_or(4.0);
            s.widths.resize(s.path.len(), last);
        }
        let n = s.path.len();
        let cum: Vec<f64> = std::iter::once(0.0)
            .chain(s.path.windows(2).scan(0.0, |acc, w| {
                *acc += dist(w[0], w[1]);
                Some(*acc)
            }))
            .collect();
        // Spans (arc along the street) to remove around each stray crossing.
        let mut spans: Vec<(f64, f64)> = vec![];
        for (i, w) in s.path.windows(2).enumerate() {
            let l = dist(w[0], w[1]);
            for (near, half, fixed, e) in &walls {
                for k in near.crossed(w[0], w[1]) {
                    let (a, b) = (e.path[k], e.path[k + 1]);
                    let Some((t, x)) = g::segment_hit(w[0], w[1], a, b) else { continue };
                    // A street end resting on the curtain is no crossing, unless another street takes it up
                    // there (the last pass): two streets that meet on the curtain cross it together, and a
                    // stub hung through the wall on a street of the other side does too.
                    let resting = if i == 0 && t * l < 0.6 { Some(w[0]) } else if i + 2 == n && (1.0 - t) * l < 0.6 { Some(w[1]) } else { None };
                    if resting.is_some_and(|end| !joined(end)) {
                        continue;
                    }
                    if e.gates.iter().any(|&q| dist(q, x) < GATE_REACH)
                        || passages.iter().any(|&(p, q)| g::distance(x, p, q).0 < GATE_REACH)
                        || !lane && gate_budget::water_way(&s, surface.wet(x))
                        || !fixed && bridge_gates.iter().any(|&q| dist(q, x) < GATE_REACH)
                    {
                        continue;
                    }
                    // No second gate opens within `GATE_GAP` of one: that street goes through the gate beside it.
                    if !held && !fixed && e.gates.iter().all(|&q| dist(q, x) >= gate_budget::GATE_GAP) {
                        continue;
                    }
                    if !fixed && heads.iter().any(|&b| dist(b, x) < BRIDGE_GATE)
                        && e.gates.iter().chain(&bridge_gates).all(|&q| dist(q, x) >= BRIDGE_GATE_SPACING)
                    {
                        bridge_gates.push(x);
                        continue;
                    }
                    let sin = cross(dir(w[0], w[1]), dir(a, b)).abs().max(0.3);
                    let clear = (half + s.widths[i].max(s.widths[i + 1]) * 0.5) / sin + 0.5;
                    let at = cum[i] + t * l;
                    spans.push((at - clear, at + clear));
                }
            }
        }
        if spans.is_empty() {
            out.push(s);
            continue;
        }
        spans.sort_by(|a, b| a.0.total_cmp(&b.0));
        let total = cum[n - 1];
        // Kept intervals between the removed spans.
        let mut keep: Vec<(f64, f64)> = vec![];
        let mut from = 0.0_f64;
        for (a, b) in spans {
            if a > from {
                keep.push((from, a));
            }
            from = from.max(b);
        }
        if from < total {
            keep.push((from, total));
        }
        let at = |d: f64| -> (Point, f64) {
            let i = (0..n - 1).find(|&i| cum[i + 1] >= d).unwrap_or(n - 2);
            let l = (cum[i + 1] - cum[i]).max(1e-9);
            let t = ((d - cum[i]) / l).clamp(0.0, 1.0);
            let (p, q) = (s.path[i], s.path[i + 1]);
            (pt(p.x + (q.x - p.x) * t, p.y + (q.y - p.y) * t), s.widths[i] + (s.widths[i + 1] - s.widths[i]) * t)
        };
        for (a, b) in keep.into_iter().filter(|(a, b)| b - a >= 1.0) {
            let (p0, w0) = at(a);
            let (p1, w1) = at(b);
            let mut path = vec![p0];
            let mut widths = vec![w0];
            for i in 1..n - 1 {
                if cum[i] > a + 1e-6 && cum[i] < b - 1e-6 {
                    path.push(s.path[i]);
                    widths.push(s.widths[i]);
                }
            }
            path.push(p1);
            widths.push(w1);
            let role = if main_too && lesser && s.role == "approach"
                && !landings.contains(&network::key(p0)) && !landings.contains(&network::key(p1)) {
                if s.rank <= 2 { "street" } else { "lane" }
            } else {
                s.role.as_str()
            };
            out.push(Street { path, widths, rank: s.rank, role: role.into() });
        }
    }
    *streets = out;
}

/// Invariant (a curtain is crossed only at its gates) on the plan the quarters
/// drew: the gates were decided on the armature (`gate_budget::decide`); a
/// street drawn since that crosses a curtain elsewhere ends at the wall on both
/// sides. Called before the first trim, so the allocation reads the streets the
/// walls leave.
pub(in super::super) fn enforce(layout: &mut Layout, surface: Surface<'_>) {
    if layout.enclosures.iter().all(|e| e.style.is_empty() || e.path.len() < 4) {
        return;
    }
    close_at_works(&mut layout.streets, &layout.enclosures, &layout.blocks, true, surface, layout.config.as_ref());
    stop_at_curtains(&mut layout.streets, &mut layout.enclosures, surface, true);
    super::trace_gates("enforce", layout);
}

/// Blocks are final here, so no link street is laid (`links` off): an end is cut back or dropped.
/// Last word on the street ends at the walls, once the dead gates are closed (`drop_dead_gates`): the
/// rule of `stop_at_curtains` on the final streets, so no stub, leftover close or shut road left by the
/// late stages ends beside a gate or in a moat.
pub(in super::super) fn tidy_wall_ends(layout: &mut Layout, surface: Surface<'_>) {
    if layout.enclosures.iter().all(|e| e.style.is_empty() || e.path.len() < 4) {
        return;
    }
    // A wall is cut only by its gates: whatever the late stages laid across a curtain away from a gate
    // (a path or a lane of informal housing, a street moved off the water) ends at the wall on both
    // sides, a main street too: no gate opens for it any more.
    close_at_works(&mut layout.streets, &layout.enclosures, &layout.blocks, true, surface, layout.config.as_ref());
    stop_at_curtains(&mut layout.streets, &mut layout.enclosures, surface, false);
}
