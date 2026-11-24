//! Gate passages, the gate budget and dead gates.
//!
//! A gate is decided, not found: when a circuit is traced (`decide`, called by `composition::fortify`
//! before the quarters are cut along the curtain and before its works are built), the crossings of the
//! streets with the trace are ranked and the gate budget keeps the most important ones, spaced along the
//! circuit (`choose`). A historical walled town opens few gates: about 2 to 4 main gates under 5 000
//! inhabitants, 5 at 10 000, 6 to 8 for a large city, plus at most `POSTERNS` posterns (`gate_budget`).
//! - At a kept passage the curtain turns square to its street (`square_passages`): the wall adapts to
//!   the road while nothing is built on it yet, so the street keeps its line and the gatehouse, the
//!   lanes and the lots that follow all stand on a square gate.
//! - Every other crossing closes (`close_crossings`): the street ends at the wall on both sides, and a
//!   main road shut out goes round the wall to a kept gate along a through road (`divert`). A main
//!   road with no way round keeps its gate, over the budget (`way_round`).
//!
//! Streets drawn later open no gate of their own: `enforce` closes whatever crosses a curtain away from
//! its gates before the first trim reads the plan. `drop_dead_gates`, last of the pipeline, closes every
//! gate point that no street uses any more, so the drawn curtain opens only at gates and water gates
//! (`water::audit` measures it).

use crate::rng::Rng;
use crate::urban::{Enclosure, Point, Shape, Street, Surface, composition, geometry as g, routing};
use super::crossings::close_crossings_at;
use super::geometry::{V, add, closed, cross, dir, dist, dot, normals, pt};
use super::shore::water_passages;

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

/// Route class of a street at a curtain: 3 regional road, 2 main street, 1 street, 0 lane. The dry ramp
/// of a bridge (`approach`) counts as the street it carries: a regional road's ramp has rank 2, the
/// ramp of a lane is a lane.
pub(super) fn priority(s: &Street) -> u8 {
    match s.role.as_str() {
        "regional" => 3,
        "approach" => if s.rank <= 2 { 2 } else { 0 },
        _ => if s.rank <= 1 { 2 } else if s.rank == 2 { 1 } else { 0 },
    }
}

/// A street that passes a curtain on a deck or along the water: its crossing is a water passage, not a
/// land gate. A causeway counts only where it stands in the water (`wet`): on dry land it is a ramp.
pub(super) fn water_way(s: &Street, wet: bool) -> bool {
    matches!(s.role.as_str(), "wall-lane" | "bridge" | "ford" | "quay" | "pier" | "boardwalk" | "landing" | "mole") || wet && s.role == "causeway"
}

/// Where a street passes a curtain.
#[derive(Clone, Copy, Debug)]
pub(in super::super) struct Passage {
    pub(in super::super) at: Point,
    /// Unit direction of the street through the curtain.
    along: V,
    /// Width (m), rank and route class (`priority`) of that street.
    width: f64,
    rank: usize,
    priority: u8,
    /// Position along the circuit (m).
    arc: f64,
    /// Sine of the angle between the street and the curtain (1: square).
    square: f64,
    /// A street of this crossing lands on a quay: a harbour gate.
    harbour: bool,
}

/// Cumulated lengths of `path`, from 0.
fn cumulated(path: &[Point]) -> Vec<f64> {
    std::iter::once(0.0).chain(path.windows(2).scan(0.0, |acc, w| { *acc += dist(w[0], w[1]); Some(*acc) })).collect()
}

/// Index of the segment of `path` nearest to `p`.
fn segment_of(path: &[Point], p: Point) -> usize {
    path.windows(2)
        .enumerate()
        .min_by(|a, b| g::distance(p, a.1[0], a.1[1]).0.total_cmp(&g::distance(p, b.1[0], b.1[1]).0))
        .map_or(0, |(k, _)| k)
}

/// Arc position of `p` along the closed `path` (cumulated lengths `cum`).
fn arc_of(path: &[Point], cum: &[f64], p: Point) -> f64 {
    let k = segment_of(path, p);
    cum[k] + dist(path[k], p).min(dist(path[k], path[k + 1]))
}

/// Point of the closed `path` at arc `s` (any real: it wraps), and its segment.
fn at_arc(path: &[Point], cum: &[f64], s: f64) -> (Point, usize) {
    let n = path.len() - 1;
    let s = s.rem_euclid(cum[n].max(1e-9));
    let k = (0..n).find(|&k| cum[k + 1] >= s).unwrap_or(n - 1);
    (add(path[k], dir(path[k], path[k + 1]), s - cum[k]), k)
}

/// The land crossings of the closed `path`: each through crossing of `composition::gates` with the most
/// important street that passes there. Decks and waterside ways are water passages, not counted. A
/// street that lands on a quay makes its crossing a harbour gate: the harbour stands outside the
/// curtain (`water::water_fronts`) and is reached through it.
fn crossings(path: &[Point], cum: &[f64], streets: &[Street], surface: Surface<'_>) -> Vec<Passage> {
    let quays: Vec<Point> = streets.iter().filter(|s| s.role == "quay").flat_map(|s| s.path.iter().copied()).collect();
    composition::gates(path, streets)
        .into_iter()
        .filter_map(|p| {
            let wet = surface.wet(p);
            let mut best: Option<(u8, f64, usize, V)> = None;
            let mut harbour = false;
            for st in streets.iter().filter(|s| !water_way(s, wet)) {
                let mut passes = false;
                for (i, w) in st.path.windows(2).enumerate() {
                    if dist(w[0], w[1]) > 1e-6 && g::distance(p, w[0], w[1]).0 < 1.0 {
                        passes = true;
                        let (pr, wd) = (priority(st), st.widths.get(i).copied().unwrap_or(4.0));
                        if best.is_none_or(|b| (pr, wd) > (b.0, b.1)) {
                            best = Some((pr, wd, st.rank, dir(w[0], w[1])));
                        }
                    }
                }
                harbour |= passes && st.path.iter().any(|&q| quays.iter().any(|&f| dist(q, f) < 1.0));
            }
            let (priority, width, rank, along) = best?;
            let k = segment_of(path, p);
            Some(Passage { at: p, along, width, rank, priority, arc: arc_of(path, cum, p), square: cross(along, dir(path[k], path[k + 1])).abs(), harbour })
        })
        .collect()
}

/// Harbour gates a circuit keeps besides its budget, and their spacing (m) along the curtain.
const HARBOUR_GATES: usize = 3;
const HARBOUR_SPACING: f64 = 60.0;

/// A street within about 15° of the curtain line grazes it: no gate stands there while another crossing
/// can take its place.
const GRAZING: f64 = 0.26;

/// The gate budget on the closed `path`: the crossings kept as gates and the ones that close. Main
/// roads first (regional roads, then main streets, a grazing one last, then the widest), at most the
/// budget and spaced by about a third of an even share of the circuit; then `POSTERNS` lesser streets.
/// A walled village (under 2 000) keeps a gate on each of its few roads.
fn choose(path: &[Point], streets: &[Street], pop: u32, purpose: &str, surface: Surface<'_>) -> (Vec<Passage>, Vec<Passage>) {
    let cum = cumulated(path);
    let total = cum[path.len() - 1].max(1.0);
    let mut all = crossings(path, &cum, streets, surface);
    all.sort_by(|a, b| {
        b.priority.cmp(&a.priority)
            .then((a.square < GRAZING).cmp(&(b.square < GRAZING)))
            .then(b.width.total_cmp(&a.width))
            .then(a.arc.total_cmp(&b.arc))
    });
    let village = pop < 2_000;
    let (budget, posterns) = if village { (usize::MAX, usize::MAX) } else { (gate_budget(pop, purpose), POSTERNS) };
    let spacing = if village { 0.0 } else { (total / budget as f64 * 0.35).clamp(40.0, 250.0) };
    let apart = |kept: &[Passage], c: &Passage, s: f64| {
        kept.iter().all(|k| {
            let d = (k.arc - c.arc).rem_euclid(total);
            d.min(total - d) >= s
        })
    };
    let (mut kept, mut dropped): (Vec<Passage>, Vec<Passage>) = (vec![], vec![]);
    // The landing streets first: the harbour keeps its own gates, whatever the budget of the roads.
    for c in all.iter().filter(|c| c.harbour) {
        if kept.len() < HARBOUR_GATES && apart(&kept, c, HARBOUR_SPACING.min(spacing.max(1.0))) { kept.push(*c) } else { dropped.push(*c) }
    }
    let harbour = kept.len();
    for c in all.iter().filter(|c| !c.harbour && c.priority >= 2) {
        if kept.len() - harbour < budget && apart(&kept, c, spacing) { kept.push(*c) } else { dropped.push(*c) }
    }
    let main = kept.len();
    for c in all.iter().filter(|c| !c.harbour && c.priority < 2) {
        if kept.len() - main < posterns && apart(&kept, c, spacing * 0.5) { kept.push(*c) } else { dropped.push(*c) }
    }
    (kept, dropped)
}

/// A curtain within this angle (rad, 15°) of square to its gate street is left as traced.
const SQUARE_TOLERANCE: f64 = 0.26;
/// Largest turn (rad, 60°) of a gate front away from the line of its curtain.
const SQUARE_TURN: f64 = 1.05;
/// Half length (m) of a gate front beyond the half width of its street: room for the gatehouse masses
/// and its flanking towers.
const FRONT: f64 = 12.0;

/// The circuit `ring` with a gate front at each passage: a straight stretch square to the street
/// (turned by at most `SQUARE_TURN` from the line of the curtain), joined to the curtain on each side
/// by a link at 45°. The street keeps its line; the wall bends to meet it, as a gate set in a short
/// return of the curtain. The front stands inside the trace: the gate point moves back along its
/// street until the corner that would jut out lies on the old curtain, so the wall yields land of its
/// own town and takes none outside (a suburb, a neighbour, the moat's far bank). `passages` follow
/// their gate points.
///
/// A passage already square within `SQUARE_TOLERANCE` keeps its curtain. A skewed one that still works
/// as a gate (up to `SQUARE_TURN` off square) is left as traced with probability `improvisation` (the
/// layout's `street_improvisation`, one seeded draw per gate point). A front that would stand in water,
/// reach another passage or tangle the ring is tried at half its margin, then given up.
fn square_passages(mut ring: Vec<Point>, passages: &mut [Passage], surface: Surface<'_>, key: &str, improvisation: f64) -> Vec<Point> {
    for i in 0..passages.len() {
        let p = passages[i];
        let path = closed(&ring);
        let cum = cumulated(&path);
        let total = cum[path.len() - 1];
        let k = segment_of(&path, p.at);
        if g::distance(p.at, path[k], path[k + 1]).0 > 1.0 {
            continue;
        }
        let s = cum[k] + dist(path[k], p.at);
        let across = (-p.along.1, p.along.0);
        let local = cross(p.along, dir(path[k], path[k + 1])).abs().clamp(0.0, 1.0).acos();
        let outward = if g::contains(&Shape { outer: ring.clone(), holes: vec![] }, add(p.at, p.along, 2.0)) { (-p.along.0, -p.along.1) } else { p.along };
        let from_wall = |q: Point| path.windows(2).map(|w| g::distance(q, w[0], w[1]).0).fold(f64::INFINITY, f64::min);
        let fronted = |margin: f64| -> Option<(Vec<Point>, Point)> {
            let half = p.width * 0.5 + margin;
            // The line of the curtain round the gate: its chord over the front, so a wiggle of the
            // trace at the gate point does not set the turn.
            let line = dir(at_arc(&path, &cum, s - half).0, at_arc(&path, &cum, s + half).0);
            let across = if dot(across, line) >= 0.0 { across } else { (-across.0, -across.1) };
            let skew = dot(across, line).clamp(-1.0, 1.0).acos();
            if skew.max(local) <= SQUARE_TOLERANCE {
                return Some((ring.clone(), p.at));
            }
            let turn = skew.min(SQUARE_TURN) * cross(line, across).signum();
            let front = (line.0 * turn.cos() - line.1 * turn.sin(), line.0 * turn.sin() + line.1 * turn.cos());
            let at = add(p.at, outward, -half * turn.abs().tan());
            let (p0, p1) = (add(at, front, -half), add(at, front, half));
            // Each corner joins the curtain as far along it as it stands off it.
            let (from, to) = (arc_of(&path, &cum, p0) - from_wall(p0) - 0.5, arc_of(&path, &cum, p1) + from_wall(p1) + 0.5);
            let span = (to - from).rem_euclid(total);
            let clear = |q: &Passage| (arc_of(&path, &cum, q.at) - from + margin).rem_euclid(total) > span + 2.0 * margin;
            if span > 8.0 * half || 2.0 * span >= total || [at, p0, p1].into_iter().any(|q| surface.wet(q)) || !passages.iter().enumerate().all(|(j, q)| j == i || clear(q)) {
                return None;
            }
            // The curtain from the far link round to the near one, then the front.
            let n = ring.len();
            let mut out = vec![at_arc(&path, &cum, to).0];
            out.extend((1..=n).map(|j| (k + j) % n).filter(|&j| (cum[j] - from).rem_euclid(total) > span).map(|j| ring[j]));
            out.extend([at_arc(&path, &cum, from).0, p0, p1]);
            out.dedup_by(|a, b| dist(*a, *b) < 0.05);
            (out.len() >= 4 && g::simple(&Shape { outer: out.clone(), holes: vec![] })).then_some((out, at))
        };
        // How far the gate is off square: against the line of the curtain and against its own segment.
        let lean = {
            let half = p.width * 0.5 + FRONT;
            let line = dir(at_arc(&path, &cum, s - half).0, at_arc(&path, &cum, s + half).0);
            dot(across, line).abs().clamp(0.0, 1.0).acos().max(local)
        };
        if lean <= SQUARE_TOLERANCE || lean <= SQUARE_TURN && Rng::new(key).fork(&format!("gate-front:{:.0}:{:.0}", p.at.x, p.at.y)).chance(improvisation) {
            continue;
        }
        if let Some((squared, at)) = fronted(FRONT).or_else(|| fronted(FRONT * 0.5)) {
            ring = squared;
            passages[i].at = at;
        }
    }
    ring
}

/// What `decide` needs to know of a circuit.
pub(in super::super) struct Circuit<'a> {
    pub(in super::super) pop: u32,
    /// "" for a town circuit, else `castle` or `citadel`.
    pub(in super::super) purpose: &'a str,
    pub(in super::super) kind: &'a str,
    pub(in super::super) curtain_width: f64,
    /// Widest moat (m) the style digs, and the steepest street grade: a diversion runs beyond the moat.
    pub(in super::super) moat: f64,
    pub(in super::super) grade: f64,
    /// The curtain may turn square to its gate streets (not a planned rectangle, a bastioned front or
    /// a stretch shared with another circuit).
    pub(in super::super) squared: bool,
    /// Seed key and share of the gates left as traced (`LayoutConfig::street_improvisation`).
    pub(in super::super) key: &'a str,
    pub(in super::super) improvisation: f64,
}

/// The land gates of the circuit `wall`, decided on `streets` as they stand: the budget keeps the
/// passages (`choose`), a main road it shuts out with no way round keeps its gate all the same
/// (`way_round`), the curtain turns square to the passages (`square_passages`), and every other street
/// crossing ends at the wall on both sides. Returns the circuit, its passages and the main roads shut
/// out (for `divert`, once the works of the circuit are built).
pub(in super::super) fn decide(wall: &Shape, streets: &mut Vec<Street>, c: &Circuit<'_>, surface: Surface<'_>) -> (Shape, Vec<Passage>, Vec<Passage>) {
    if wall.outer.len() < 3 {
        return (wall.clone(), vec![], vec![]);
    }
    let path = closed(&wall.outer);
    let (mut kept, dropped) = choose(&path, streets, c.pop, c.purpose, surface);
    if kept.is_empty() && dropped.is_empty() {
        return (wall.clone(), kept, dropped);
    }
    let outside = Outside::new(&path, c.curtain_width + c.moat + 8.0);
    let mut shut = vec![];
    for p in dropped.into_iter().filter(|p| p.priority >= 2) {
        match way_round(&outside, &kept, &p, streets, surface, c.grade, false) {
            WayRound::Blocked => kept.push(p),
            _ => shut.push(p),
        }
    }
    let ring = if c.squared { square_passages(wall.outer.clone(), &mut kept, surface, c.key, c.improvisation) } else { wall.outer.clone() };
    let e = Enclosure {
        path: closed(&ring),
        kind: c.kind.into(),
        style: "traced".into(),
        curtain_width_m: c.curtain_width,
        gates: kept.iter().map(|p| p.at).collect(),
        ..Default::default()
    };
    // A water passage already serves its channel before the gatehouses are built.
    let banks = composition::water_gates(&e.path, surface);
    let passages: Vec<_> = water_passages(&banks).collect();
    close_crossings_at(streets, std::slice::from_ref(&e), true, surface, &passages);
    (Shape { outer: ring, holes: wall.holes.clone() }, kept, shut)
}

/// A gate throat: the stretch of a gate street on each side of the curtain that carries the gate and
/// its traffic, about two street widths, at least 12 m.
fn throat(width: f64) -> f64 {
    (2.0 * width).max(12.0)
}

/// A diversion longer than this (m), or than half the circuit, is no way round: the road ends at the wall.
const DIVERSION_MAX: f64 = 600.0;
/// A road that already reaches a kept gate outside the wall within this many times the way round along
/// the curtain needs no diversion.
const DETOUR: f64 = 1.6;
/// Below this length (m) of street outside a gate, with no regional road, bridge or other gate reached,
/// a gate leads nowhere.
pub(super) const DEAD_END: f64 = 80.0;

/// Points `off` metres outside the closed `path` (beyond its moat) from arc `from` to arc `to`, the
/// shorter way round, every 12 m, or `None` when that way is long (`DIVERSION_MAX`, half the circuit).
fn round_outside(path: &[Point], cum: &[f64], ns: &[V], from: f64, to: f64, off: f64) -> Option<Vec<Point>> {
    let total = cum[path.len() - 1];
    let forward = (to - from).rem_euclid(total);
    let (len, sign) = if forward <= total - forward { (forward, 1.0) } else { (total - forward, -1.0) };
    if len > DIVERSION_MAX || len >= total * 0.5 || len < 1.0 {
        return None;
    }
    let steps = (len / 12.0).ceil().max(1.0) as usize;
    Some((0..=steps).map(|j| { let (p, k) = at_arc(path, cum, from + sign * len * j as f64 / steps as f64); add(p, ns[k], off) }).collect())
}

/// The street that leaves the wall outside at the passage `p`, walked outward to its first point at
/// least `off` m from the curtain: (street, index of the vertex before that point, the point, length
/// of the record beyond it). With `closed_end` the passage was closed and the street is the record
/// that ends outside it; else it is the record through the passage. `None` when the record ends before
/// that distance.
fn outward(streets: &[Street], path: &[Point], ring: &Shape, p: &Passage, off: f64, closed_end: bool) -> Option<(usize, usize, Point, f64)> {
    let from_wall = |q: Point| path.windows(2).map(|w| g::distance(q, w[0], w[1]).0).fold(f64::INFINITY, f64::min);
    let (si, start, forward) = leaving(streets, ring, p, closed_end)?;
    let s = &streets[si];
    let mut i = start;
    let mut a = if closed_end { s.path[start] } else { p.at };
    loop {
        let j = if forward { i + 1 } else { i.checked_sub(1)? };
        let b = *s.path.get(j)?;
        if from_wall(b) >= off {
            // The first point of this segment far enough from the curtain, by bisection.
            let (mut lo, mut hi) = (0.0, 1.0);
            for _ in 0..12 {
                let mid = (lo + hi) * 0.5;
                if from_wall(pt(a.x + (b.x - a.x) * mid, a.y + (b.y - a.y) * mid)) >= off { hi = mid } else { lo = mid }
            }
            let at = pt(a.x + (b.x - a.x) * hi, a.y + (b.y - a.y) * hi);
            let rest: Vec<Point> = if forward { s.path[j..].to_vec() } else { s.path[..=j].iter().rev().copied().collect() };
            return Some((si, i.min(j), at, dist(at, b) + rest.windows(2).map(|w| dist(w[0], w[1])).sum::<f64>()));
        }
        (i, a) = (j, b);
    }
}

/// Whether the street that leaves the wall at the passage `p` runs into another street at its outer
/// end (a junction, a bridge deck): however short, it is no stub.
fn leads_on(streets: &[Street], ring: &Shape, p: &Passage, closed_end: bool) -> bool {
    let Some((si, _, forward)) = leaving(streets, ring, p, closed_end) else { return false };
    let s = &streets[si];
    let end = if forward { s.path[s.path.len() - 1] } else { s.path[0] };
    !g::contains(ring, end)
        && streets.iter().enumerate().any(|(sj, t)| sj != si && t.role != "wall-lane" && t.path.windows(2).any(|w| g::distance(end, w[0], w[1]).0 < 1.0))
}

/// The street record that leaves the wall outside at the passage `p`: (street, vertex the way out
/// starts from, towards higher indices).
fn leaving(streets: &[Street], ring: &Shape, p: &Passage, closed_end: bool) -> Option<(usize, usize, bool)> {
    let reach = if closed_end { p.width + 12.0 } else { 1.0 };
    // (distance to the passage, street, vertex the walk starts from, towards higher indices)
    let mut best: Option<(f64, usize, usize, bool)> = None;
    for (si, s) in streets.iter().enumerate().filter(|(_, s)| !water_way(s, false) && s.path.len() >= 2) {
        let n = s.path.len();
        if closed_end {
            for (end, forward) in [(0, true), (n - 1, false)] {
                let (q, next) = (s.path[end], s.path[if forward { 1 } else { n - 2 }]);
                let d = dist(q, p.at);
                if d < reach && !g::contains(ring, q) && cross(dir(q, next), p.along).abs() < 0.5 && best.is_none_or(|b| d < b.0) {
                    best = Some((d, si, end, forward));
                }
            }
        } else {
            for (i, w) in s.path.windows(2).enumerate() {
                let d = g::distance(p.at, w[0], w[1]).0;
                if d < reach && dist(w[0], w[1]) > 1e-6 && best.is_none_or(|b| d < b.0) {
                    let forward = !g::contains(ring, add(p.at, dir(w[0], w[1]), 2.0));
                    best = Some((d, si, if forward { i } else { i + 1 }, forward));
                }
            }
        }
    }
    best.map(|(_, si, start, forward)| (si, start, forward))
}

/// Whether the streets outside the circuit `ring` already lead from `a` to `b` in less than `budget`
/// metres. Streets meet at shared vertices and where a vertex of one lies on another.
fn joined_outside(streets: &[Street], ring: &Shape, a: Point, b: Point, budget: f64) -> bool {
    const CELL: f64 = 24.0;
    let cell = |p: Point| ((p.x / CELL).floor() as i64, (p.y / CELL).floor() as i64);
    let near = |p: Point| (p.x - a.x).abs().max((p.y - a.y).abs()) <= budget;
    // A segment whose box meets the square of the budget round `a`.
    let reaches = |p: Point, q: Point| p.x.min(q.x) <= a.x + budget && p.x.max(q.x) >= a.x - budget && p.y.min(q.y) <= a.y + budget && p.y.max(q.y) >= a.y - budget;
    // Segments and vertices of the streets within the budget, on a grid.
    let mut segments: std::collections::HashMap<(i64, i64), Vec<(usize, usize)>> = Default::default();
    let mut vertices: std::collections::HashMap<(i64, i64), Vec<(usize, usize)>> = Default::default();
    for (si, s) in streets.iter().enumerate().filter(|(_, s)| !water_way(s, false)) {
        for (k, w) in s.path.windows(2).enumerate().filter(|(_, w)| reaches(w[0], w[1])) {
            let steps = (dist(w[0], w[1]) / CELL).ceil().max(1.0) as usize;
            for j in 0..=steps {
                let t = j as f64 / steps as f64;
                let v = segments.entry(cell(pt(w[0].x + (w[1].x - w[0].x) * t, w[0].y + (w[1].y - w[0].y) * t))).or_default();
                if v.last() != Some(&(si, k)) {
                    v.push((si, k));
                }
            }
        }
        for (v, &p) in s.path.iter().enumerate().filter(|(_, p)| near(**p)) {
            vertices.entry(cell(p)).or_default().push((si, v));
        }
    }
    let around = |p: Point| {
        let (cx, cy) = cell(p);
        (-1..=1).flat_map(move |dx| (-1..=1).map(move |dy| (cx + dx, cy + dy)))
    };
    // Street segments that pass through `p`.
    let through = |p: Point| -> Vec<(usize, usize)> {
        let mut out: Vec<(usize, usize)> = around(p)
            .filter_map(|c| segments.get(&c))
            .flatten()
            .copied()
            .filter(|&(si, k)| g::distance(p, streets[si].path[k], streets[si].path[k + 1]).0 < 1.0)
            .collect();
        out.sort_unstable();
        out.dedup();
        out
    };
    // Vertices of other streets that lie on the segment `p`-`q` of street `si`.
    let on = |si: usize, p: Point, q: Point| -> Vec<(usize, usize)> {
        let steps = (dist(p, q) / CELL).ceil().max(1.0) as usize;
        let mut out: Vec<(usize, usize)> = (0..=steps)
            .flat_map(|j| around(pt(p.x + (q.x - p.x) * j as f64 / steps as f64, p.y + (q.y - p.y) * j as f64 / steps as f64)))
            .filter_map(|c| vertices.get(&c))
            .flatten()
            .copied()
            .filter(|&(sj, v)| sj != si && g::distance(streets[sj].path[v], p, q).0 < 1.0)
            .collect();
        out.sort_unstable();
        out.dedup();
        out
    };
    // Shortest walk over street vertices (centimetres, so the order is total).
    let cost = |d: f64| std::cmp::Reverse((d * 100.0) as u64);
    let mut heap = std::collections::BinaryHeap::new();
    for (si, k) in through(a) {
        let (p, q) = (streets[si].path[k], streets[si].path[k + 1]);
        if g::distance(b, p, q).0 < 1.0 {
            return dist(a, b) <= budget;
        }
        heap.extend([(cost(dist(a, p)), si, k), (cost(dist(a, q)), si, k + 1)]);
    }
    let mut done: std::collections::HashSet<(usize, usize)> = Default::default();
    while let Some((std::cmp::Reverse(d), si, v)) = heap.pop() {
        let d = d as f64 / 100.0;
        if d > budget {
            break;
        }
        let s = &streets[si];
        let p = s.path[v];
        if !done.insert((si, v)) || g::contains(ring, p) {
            continue;
        }
        for w in [v.wrapping_sub(1), v + 1] {
            let Some(&q) = s.path.get(w) else { continue };
            if g::distance(b, p, q).0 < 1.0 {
                return d + dist(p, b) <= budget;
            }
            heap.push((cost(d + dist(p, q)), si, w));
            heap.extend(on(si, p, q).into_iter().map(|(sj, u)| (cost(d + dist(p, streets[sj].path[u])), sj, u)));
        }
        for (sj, k) in through(p).into_iter().filter(|&(sj, _)| sj != si) {
            let (q, r) = (streets[sj].path[k], streets[sj].path[k + 1]);
            if g::distance(b, q, r).0 < 1.0 {
                return d + dist(p, b) <= budget;
            }
            heap.extend([(cost(d + dist(p, q)), sj, k), (cost(d + dist(p, r)), sj, k + 1)]);
        }
    }
    false
}

/// The outside of a circuit, for the roads that go round it: the closed path, its ring, the arc
/// positions and outward normals of its segments, and the distance at which a road clears the moat.
struct Outside<'a> {
    path: &'a [Point],
    ring: Shape,
    cum: Vec<f64>,
    ns: Vec<V>,
    off: f64,
}

impl<'a> Outside<'a> {
    fn new(path: &'a [Point], off: f64) -> Self {
        Outside { path, ring: g::normalized(Shape { outer: path[..path.len() - 1].to_vec(), holes: vec![] }), cum: cumulated(path), ns: normals(path), off }
    }
}

/// How a main road shut out by the gate budget reaches the town.
enum WayRound {
    /// It ends shortly outside the wall on no other street, or the streets outside already lead it to a
    /// kept gate.
    Served,
    /// No practicable way to a kept gate.
    Blocked,
    /// A diversion: where it leaves the shut-out road and where it joins the gate road (street, index
    /// of the vertex before the point, the point), and its line.
    Road { from: (usize, usize, Point), to: (usize, usize, Point), line: Vec<Point> },
}

/// The way of the main road shut out at `c` to the nearest kept main gate: round the outside of the
/// moat, from the point where the road clears the moat to a point of the gate road beyond the gate
/// throat. Before the crossings close (`closed` false) the road is the record through `c`; after, the
/// record that ends outside it.
fn way_round(o: &Outside<'_>, kept: &[Passage], c: &Passage, streets: &[Street], surface: Surface<'_>, grade: f64, closed: bool) -> WayRound {
    let total = o.cum[o.path.len() - 1].max(1.0);
    let arc = |p: Point| arc_of(o.path, &o.cum, p);
    let gap = |a: f64, b: f64| {
        let d = (a - b).rem_euclid(total);
        d.min(total - d)
    };
    let Some(k) = kept.iter().filter(|k| k.priority >= 2).min_by(|a, b| gap(arc(a.at), arc(c.at)).total_cmp(&gap(arc(b.at), arc(c.at)))) else { return WayRound::Blocked };
    // A road that ends before it clears the moat, or shortly after, leads nowhere outside, unless it
    // runs into another street there (records end at junctions): a road that meets a street or a
    // bridge inside the reach of the moat has no room for a way round.
    let Some((sc, ic, start, beyond)) = outward(streets, o.path, &o.ring, c, o.off, closed) else {
        return if leads_on(streets, &o.ring, c, closed) { WayRound::Blocked } else { WayRound::Served };
    };
    if streets[sc].role != "regional" && beyond < DEAD_END && !leads_on(streets, &o.ring, c, closed) {
        return WayRound::Served;
    }
    let Some((sk, ik, end, _)) = outward(streets, o.path, &o.ring, k, o.off.max(throat(k.width)), false) else { return WayRound::Blocked };
    // Round the moat between the two roads where they stand clear of it (a skewed road leaves the
    // moat away from its crossing).
    let Some(round) = round_outside(o.path, &o.cum, &o.ns, arc(start), arc(end), o.off) else { return WayRound::Blocked };
    let way: f64 = round.windows(2).map(|w| dist(w[0], w[1])).sum();
    if sc == sk || joined_outside(streets, &o.ring, start, end, way * DETOUR + 40.0) {
        return WayRound::Served;
    }
    // The curve points next to either end go, so the road turns into the diversion and the diversion
    // into the gate road without a hook.
    let mut line = vec![start];
    line.extend(round.into_iter().filter(|&q| dist(q, start) > 12.0 && dist(q, end) > 12.0));
    line.push(end);
    let mut line = g::simplify(&line, 1.5, |_| false);
    line.dedup_by(|a, b| dist(*a, *b) < 0.5);
    let crosses = line.windows(2).any(|w| o.path.windows(2).any(|s| g::segment_hit(w[0], w[1], s[0], s[1]).is_some()));
    if line.len() < 2 || crosses || line.iter().any(|&q| surface.wet(q)) || !routing::path_clear(surface, &line, grade) {
        return WayRound::Blocked;
    }
    WayRound::Road { from: (sc, ic, start), to: (sk, ik, end), line }
}

/// Invariant (a main road shut out by the gate budget still enters the town): each main road `shut`
/// out of the built circuit `e` whose way goes on outside is joined to the nearest kept main gate by a
/// road round the outside of the moat (`way_round`). The diversion is a through road: it leaves from
/// the end of the shut-out road, which stops there instead of running on to the wall, and joins the
/// gate road at a vertex beyond the gate throat; it has the width and rank of the road it carries and
/// the role `approach`, which no trim prunes or narrows for want of doors.
pub(in super::super) fn divert(e: &Enclosure, kept: &[Passage], shut: &[Passage], streets: &mut Vec<Street>, surface: Surface<'_>, grade: f64) {
    if e.path.len() < 4 || shut.is_empty() {
        return;
    }
    let from_wall = |q: Point| e.path.windows(2).map(|w| g::distance(q, w[0], w[1]).0).fold(f64::INFINITY, f64::min);
    let off = e.ditch.iter().flat_map(|d| d.shape.outer.iter()).map(|&p| from_wall(p)).fold(e.curtain_width_m + 4.0, f64::max) + 4.0;
    let outside = Outside::new(&e.path, off);
    let width_at = |s: &Street, i: usize| s.widths.get(i).or(s.widths.last()).copied().unwrap_or(4.0);
    for c in shut {
        let WayRound::Road { from: (sc, ic, start), to: (sk, ik, end), line } = way_round(&outside, kept, c, streets, surface, grade, true) else { continue };
        // The shut-out road stops where the diversion leaves it: its stub towards the wall goes.
        let s = &mut streets[sc];
        let n = s.path.len();
        let wd = width_at(s, ic);
        if s.widths.len() != n {
            s.widths.resize(n, wd);
        }
        if dist(s.path[0], c.at) <= dist(s.path[n - 1], c.at) {
            s.path.splice(..=ic, [start]);
            s.widths.splice(..=ic, [wd]);
        } else {
            s.path.splice(ic + 1.., [start]);
            s.widths.splice(ic + 1.., [wd]);
        }
        // The gate road gains the junction as a vertex.
        let s = &mut streets[sk];
        if s.path.iter().all(|&q| dist(q, end) > 0.05) {
            let wd = width_at(s, ik);
            if s.widths.len() == s.path.len() {
                s.widths.insert(ik + 1, wd);
            }
            s.path.insert(ik + 1, end);
        }
        streets.push(Street { widths: vec![c.width; line.len()], path: line, rank: c.rank, role: "approach".into() });
    }
}

#[cfg(test)]
#[path = "gate_budget_tests.rs"]
mod tests;
