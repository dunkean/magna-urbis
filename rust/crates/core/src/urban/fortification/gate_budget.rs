//! Gate passages, the gate budget and dead gates.
//!
//! A gate is decided, not found: when a circuit is traced (`decide`, called by `composition::fortify`
//! before the quarters are cut along the curtain and before its works are built), the crossings of the
//! streets with the trace are ranked and the gate budget keeps the most important ones, spaced along the
//! circuit (`choose`). A historical walled town opens few gates: about 2 to 4 main gates under 5 000
//! inhabitants, 5 at 10 000, 6 to 8 for a large city, plus at most `POSTERNS` posterns (`gate_budget`).
//! - Walls and moats first: a main road that stops short of the curtain runs on through it before the
//!   budget reads the crossings (`reach_through`); the extensions the budget shuts are taken back.
//! - At a kept passage the curtain stays straight or turns gently and its street turns square to it,
//!   over its last metres, while nothing is built along it (`fit_passages`): the gatehouse, the lanes
//!   and the lots that follow stand on a square gate, and no gate folds its curtain. A bent-axis gate
//!   is a passage inside its gatehouse (`bab`), never a bend of the wall.
//! - Every other crossing closes (`close_crossings`): the street ends at the wall on both sides, and a
//!   main road shut out goes round the wall to a kept gate along a through road (`divert`). A main
//!   road with no way round keeps its gate, over the budget (`way_round`), unless a kept gate stands
//!   within `GATE_GAP`: that gate serves it.
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

/// A walled place under this population is a village: it keeps a gate on each of its few roads, and its
/// ways pass the hedge, the palisade or the wall as they are trodden.
pub(in super::super) const VILLAGE: u32 = 2_000;
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
    /// The exterior part of a clipped road was recovered for this passage.
    reached_road: bool,
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
    cum[k] + dist(path[k], g::distance(p, path[k], path[k + 1]).2)
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
            if best.is_none() && std::env::var("URBAN_PROFILE").is_ok() {
                eprintln!("  gate budget: crossing ({:.0},{:.0}) wet {wet} carries no land street", p.x, p.y);
            }
            let (priority, width, rank, along) = best?;
            let k = segment_of(path, p);
            Some(Passage { at: p, along, width, rank, priority, arc: arc_of(path, cum, p), square: cross(along, dir(path[k], path[k + 1])).abs(), harbour, reached_road: false })
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
/// budget and spaced by about a third of an even share of the circuit, `GATE_SPACING` at most; then
/// `POSTERNS` lesser streets.
/// A walled `VILLAGE` keeps a gate on each of its few roads.
fn choose(path: &[Point], streets: &[Street], pop: u32, purpose: &str, requested: Option<usize>, previous: &[Point], reached: &[Reached], surface: Surface<'_>) -> (Vec<Passage>, Vec<Passage>) {
    let cum = cumulated(path);
    let total = cum[path.len() - 1].max(1.0);
    let mut all = crossings(path, &cum, streets, surface);
    // A gate of the circuit before it was rebuilt moves onto the street crossing within `STRAIGHT` m
    // of it: a road laid for the old trace keeps its gate instead of being cut a few metres off it.
    let mut prior_at: Vec<Point> = vec![];
    for &point in previous {
        let k = segment_of(path, point);
        let (gap, _, at) = g::distance(point, path[k], path[k + 1]);
        if let Some(c) = all.iter().filter(|p| dist(p.at, point) < STRAIGHT && !prior_at.iter().any(|&q| dist(q, p.at) < 1e-6)).min_by(|a, b| dist(a.at, point).total_cmp(&dist(b.at, point))) {
            prior_at.push(c.at);
            continue;
        }
        if gap > 1.0 || surface.wet(at) { continue; }
        let tangent = dir(path[k], path[k + 1]);
        all.push(Passage { at, arc: arc_of(path, &cum, at), along: (-tangent.1, tangent.0), width: 4.0,
            rank: 1, priority: 2, square: 1.0, harbour: false, reached_road: false });
        prior_at.push(at);
    }
    let prior = |p: &Passage| prior_at.iter().any(|&q| dist(q, p.at) < 1e-6);
    let extended = |p: &Passage| reached.iter().any(|r| dist(r.at, p.at) < 8.0);
    all.sort_by(|a, b| {
        prior(b).cmp(&prior(a)).then(b.priority.cmp(&a.priority))
            .then((a.square < GRAZING).cmp(&(b.square < GRAZING)))
            .then(extended(a).cmp(&extended(b)))
            .then(b.width.total_cmp(&a.width))
            .then(a.arc.total_cmp(&b.arc))
    });
    if let Some(count) = requested {
        let dropped = all.split_off(count.min(all.len()));
        return (all, dropped);
    }
    let village = pop < VILLAGE;
    let (budget, posterns) = if village { (usize::MAX, usize::MAX) } else { (gate_budget(pop, purpose), POSTERNS) };
    // Main roads stand `GATE_SPACING` apart at most; lesser streets keep the wider share of the circuit,
    // so posterns do not multiply.
    let spread = if village { 0.0 } else { (total / budget as f64 * 0.35).clamp(40.0, 250.0) };
    let spacing = spread.min(GATE_SPACING);
    let apart = |kept: &[Passage], c: &Passage, s: f64| {
        kept.iter().all(|k| {
            let d = (k.arc - c.arc).rem_euclid(total);
            d.min(total - d) >= s
        })
    };
    // Keep surviving entrances first. Count them against their own class when admitting new roads.
    let (mut kept, candidates): (Vec<_>, Vec<_>) = all.into_iter().partition(&prior);
    let mut dropped = vec![];
    // Outside a village no two gates of any class stand nearer than `GATE_GAP`.
    let floor = if village { 0.0 } else { GATE_GAP };
    for (class, limit, gap) in [(0, HARBOUR_GATES, HARBOUR_SPACING.min(spacing.max(1.0))), (1, budget, spacing), (2, posterns, spread * 0.5)] {
        let gap = gap.max(floor);
        let group = |p: &Passage| if p.harbour { 0 } else if p.priority >= 2 { 1 } else { 2 };
        let mut count = kept.iter().filter(|p| group(p) == class).count();
        for &p in candidates.iter().filter(|p| group(p) == class) {
            if count < limit && apart(&kept, &p, gap) {
                kept.push(p);
                count += 1;
            } else {
                dropped.push(p);
            }
        }
    }
    (kept, dropped)
}

/// A street within this angle (rad, 15°) of square to its curtain passes the gate as it is.
const SQUARE_TOLERANCE: f64 = 0.26;
/// Largest skew (rad, 60°) of a street that turns to its gate: a more oblique one passes as it is.
const SQUARE_TURN: f64 = 1.05;
/// Half length (m) of a gate front beyond the half width of its street: room for the gatehouse masses
/// and its flanking towers, and for its masses alone. Over it the curtain turns by at most `FRONT_TURN`
/// (rad, 30°).
const FRONT: f64 = 12.0;
const ROOM: f64 = 4.0;
const FRONT_TURN: f64 = 0.52;
/// Within `STRAIGHT` m of a gate no corner of the curtain turns by more than `CORNER_TURN` (rad, 60°:
/// an interior angle of 120°), and the curtain by no more than `BEND` (rad, 120°) in all.
pub(super) const STRAIGHT: f64 = 25.0;
pub(super) const CORNER_TURN: f64 = 1.05;
const BEND: f64 = 2.1;
/// How far (m) a gate moves along its curtain to leave a corner.
const MOVE: f64 = 60.0;
/// Straight run (m) of a street on each side of its gate, and its largest turn (rad, 40°) at a vertex
/// of the bend that leads there.
const RUN: f64 = 14.0;
const STREET_TURN: f64 = 0.7;
/// Largest angle (rad, 35°) between the line of a street and its run through its gate.
const STREET_SWING: f64 = 0.61;

/// Half length (m) of curtain that a gate on a street of `width` m rules.
fn gate_reach(width: f64) -> f64 {
    STRAIGHT.max(width * 0.5 + FRONT)
}

/// Whether a gate may stand at arc `s` of the closed `path`: a straight front (`room` m beyond its
/// street), no sharp corner and no fold round it.
fn gentle(path: &[Point], cum: &[f64], s: f64, width: f64, room: f64) -> bool {
    let n = path.len() - 1;
    let total = cum[n];
    let (front, half) = (width * 0.5 + room, gate_reach(width));
    if total < 4.0 * half {
        return true;
    }
    let mut k = at_arc(path, cum, s - half).1;
    // The corners met from `s - half` on: their distance to the gate and the heading past them.
    let mut far = cum[k + 1] - (s - half).rem_euclid(total);
    let (mut heading, mut bend, mut turned) = (0.0_f64, (0.0_f64, 0.0_f64), None::<(f64, f64)>);
    while far < 2.0 * half {
        let next = (k + 1) % n;
        let (u, v) = (dir(path[k], path[k + 1]), dir(path[next], path[next + 1]));
        let turn = cross(u, v).atan2(dot(u, v));
        if turn.abs() > CORNER_TURN {
            return false;
        }
        let before = heading;
        heading += turn;
        bend = (bend.0.min(heading), bend.1.max(heading));
        if (far - half).abs() < front {
            let (lo, hi) = turned.unwrap_or((before, before));
            turned = Some((lo.min(heading), hi.max(heading)));
        }
        k = next;
        far += cum[k + 1] - cum[k];
    }
    bend.1 - bend.0 <= BEND && turned.is_none_or(|(lo, hi)| hi - lo <= FRONT_TURN)
}

/// Cubic curve from `a` (leaving along `u`) to `b` (arriving along `v`): its inner points.
fn bend_between(a: Point, u: V, b: Point, v: V) -> Vec<Point> {
    let handle = 0.25 * dist(a, b);
    let (c, d) = (add(a, u, handle), add(b, v, -handle));
    (1..8)
        .map(|j| {
            let t = f64::from(j) / 8.0;
            let w = [(1.0 - t).powi(3), 3.0 * t * (1.0 - t).powi(2), 3.0 * t * t * (1.0 - t), t.powi(3)];
            pt(a.x * w[0] + c.x * w[1] + d.x * w[2] + b.x * w[3], a.y * w[0] + c.y * w[1] + d.y * w[2] + b.y * w[3])
        })
        .collect()
}

/// The street of the passage `p` turned to pass the curtain (`path`) square at `gate`, whose outward
/// normal is `n`, by at most `STREET_SWING`: over its last metres on each side it leaves its line by a
/// curve and runs straight through. Returns the street, its new line and widths and its direction
/// through the gate. `None` where the street ends or meets
/// another too near, or where the new line would stand in water, climb, cross another street or the
/// wall again, or bend sharply: the street then keeps its line.
fn turned_street(streets: &[Street], path: &[Point], p: &Passage, gate: Point, n: V, surface: Surface<'_>, grade: f64) -> Option<(usize, Vec<Point>, Vec<f64>, V)> {
    let (at, wet) = (p.at, surface.wet(p.at));
    let (_, _, si, k) = streets.iter().enumerate().filter(|(_, s)| !water_way(s, wet))
        .flat_map(|(si, s)| s.path.windows(2).enumerate()
            .filter(move |(_, w)| dist(w[0], w[1]) > 1e-6 && g::distance(at, w[0], w[1]).0 < 1.0)
            .map(move |(k, _)| (priority(s), s.widths.get(k).copied().unwrap_or(4.0), si, k)))
        .max_by(|x, y| x.0.cmp(&y.0).then(x.1.total_cmp(&y.1)).then(y.2.cmp(&x.2)))?;
    let line = &streets[si].path;
    let cum = cumulated(line);
    let total = cum[line.len() - 1];
    let here = cum[k] + dist(line[k], p.at).min(dist(line[k], line[k + 1]));
    let along = dir(line[k], line[k + 1]);
    let n = if dot(along, n) >= 0.0 { n } else { (-n.0, -n.1) };
    // Square to the curtain, or oblique by what the street cannot turn.
    let skew = cross(n, along).atan2(dot(n, along));
    let (sin, cos) = (skew.signum() * (skew.abs() - STREET_SWING).max(0.0)).sin_cos();
    let n = (n.0 * cos - n.1 * sin, n.0 * sin + n.1 * cos);
    let reach = 2.0 * RUN + 60.0 * cross(along, n).abs() + dist(p.at, gate);
    let (into, out) = (add(gate, n, -RUN), add(gate, n, RUN));
    [1.0, 0.7].into_iter().find_map(|share| {
        let (a, b) = ((here - reach * share).max(0.0), (here + reach * share).min(total));
        if here - a < 2.0 * RUN || b - here < 2.0 * RUN {
            return None;
        }
        let ((from, ka), (to, kb)) = (at_arc_open(line, &cum, a), at_arc_open(line, &cum, b));
        let mut bend = vec![from];
        bend.extend(bend_between(from, dir(line[ka], line[ka + 1]), into, n));
        bend.extend([into, gate, out]);
        bend.extend(bend_between(out, n, to, dir(line[kb], line[kb + 1])));
        bend.push(to);
        let sharp = bend.windows(3).any(|w| {
            let (u, v) = (dir(w[0], w[1]), dir(w[1], w[2]));
            cross(u, v).atan2(dot(u, v)).abs() > STREET_TURN
        });
        // The wall is passed at the gate and nowhere else.
        let again = bend.windows(2).any(|w| path.windows(2).any(|q| g::segment_hit(w[0], w[1], q[0], q[1]).is_some_and(|(_, x)| dist(x, gate) > 0.5)));
        if sharp || again || bend.iter().any(|&q| surface.wet(q)) || !routing::path_clear(surface, &bend, grade) {
            return None;
        }
        // No other street meets the stretch that moves, nor is crossed by the new line.
        let mut old: Vec<Point> = vec![from];
        old.extend((0..line.len()).filter(|&j| cum[j] > a && cum[j] < b).map(|j| line[j]));
        old.push(to);
        let ends = |q: Point| dist(q, from) < 1.0 || dist(q, to) < 1.0;
        let met = streets.iter().enumerate().any(|(sj, t)| sj != si
            && (t.path.iter().any(|&q| !ends(q) && old.windows(2).any(|w| g::distance(q, w[0], w[1]).0 < 1.5))
                || t.path.windows(2).any(|q| old.windows(2).chain(bend.windows(2)).any(|w| g::segment_hit(w[0], w[1], q[0], q[1]).is_some_and(|(_, x)| !ends(x))))));
        if met {
            return None;
        }
        let width = |j: usize| streets[si].widths.get(j).or(streets[si].widths.last()).copied().unwrap_or(4.0);
        let vertices = (0..line.len()).filter(|&j| cum[j] < a - 0.05).map(|j| (line[j], width(j)))
            .chain(bend.iter().map(|&q| (q, width(k))))
            .chain((0..line.len()).filter(|&j| cum[j] > b + 0.05).map(|j| (line[j], width(j))));
        let (moved, widths): (Vec<Point>, Vec<f64>) = vertices.unzip();
        Some((si, moved, widths, n))
    })
}

/// Point of the open `path` at arc `s` (cumulated lengths `cum`), and its segment.
fn at_arc_open(path: &[Point], cum: &[f64], s: f64) -> (Point, usize) {
    let n = path.len() - 1;
    let k = (0..n).find(|&k| cum[k + 1] >= s).unwrap_or(n - 1);
    (add(path[k], dir(path[k], path[k + 1]), s - cum[k]), k)
}

/// The `ring` with the corner by the passage `p` cut by a straight gate front, as far along each side of
/// the corner, and the gate on it. Across a salient the town yields its tip and takes no land outside;
/// across an inward corner (`inward`) it takes the hollow. `None` when the corner is of the other sort,
/// the street does not pass the front, or the front leaves a sharp corner or meets water or a passage of
/// `others`.
fn cut_corner(ring: &[Point], p: &Passage, others: &[Point], streets: &[Street], surface: Surface<'_>, inward: bool) -> Option<(Vec<Point>, Point)> {
    let path = closed(ring);
    let cum = cumulated(&path);
    let (n, total) = (ring.len(), cum[ring.len()]);
    let s = arc_of(&path, &cum, p.at);
    let half = gate_reach(p.width);
    if total < 8.0 * half {
        return None;
    }
    // The sharpest corner that the gate stands by.
    let turn = |j: usize| { let (u, v) = (dir(path[(j + n - 1) % n], path[j]), dir(path[j], path[j + 1])); cross(u, v).atan2(dot(u, v)).abs() };
    let gap = |j: usize| { let d = (cum[j] - s).rem_euclid(total); d.min(total - d) };
    let at = (0..n).filter(|&j| gap(j) < half).max_by(|&x, &y| turn(x).total_cmp(&turn(y)))?;
    let hollow = cross(dir(path[(at + n - 1) % n], path[at]), dir(path[at], path[at + 1])) * g::signed(ring) < 0.0;
    if hollow != inward {
        return None;
    }
    [1.0, 1.4, 2.0].into_iter().find_map(|share| front_across(ring, &path, &cum, p, (cum[at] - half * share, cum[at] + half * share), others, streets, surface, inward))
}

/// The front of `cut_corner` from arc `from` to arc `to` of the closed `path` of `ring`.
#[allow(clippy::too_many_arguments)]
fn front_across(ring: &[Point], path: &[Point], cum: &[f64], p: &Passage, (from, to): (f64, f64), others: &[Point], streets: &[Street], surface: Surface<'_>, inward: bool) -> Option<(Vec<Point>, Point)> {
    let (n, total) = (ring.len(), cum[ring.len()]);
    let (a, b) = (at_arc(path, cum, from).0, at_arc(path, cum, to).0);
    let chord = dir(a, b);
    // Where the street of the passage meets the front.
    let wet = surface.wet(p.at);
    let gate = streets.iter().filter(|s| !water_way(s, wet) && s.path.windows(2).any(|w| g::distance(p.at, w[0], w[1]).0 < 1.0))
        .flat_map(|s| s.path.windows(2).filter_map(|w| g::segment_hit(w[0], w[1], a, b).map(|h| h.1)).collect::<Vec<_>>())
        .min_by(|x, y| dist(*x, p.at).total_cmp(&dist(*y, p.at)))?;
    let shape = Shape { outer: ring.to_vec(), holes: vec![] };
    let room = dist(a, gate).min(dist(gate, b)) >= p.width * 0.5 + ROOM;
    let held = (1..8).map(|j| add(a, chord, dist(a, b) * f64::from(j) / 8.0)).all(|q| !surface.wet(q) && (inward || g::contains(&shape, q)));
    let clear = others.iter().all(|&q| (arc_of(path, cum, q) - from + ROOM).rem_euclid(total) > to - from + 2.0 * ROOM);
    if !(room && held && clear) {
        return None;
    }
    // The curtain from the far end of the front round to the near one; the front closes it.
    let k = at_arc(path, cum, to).1;
    let mut out = vec![b];
    out.extend((1..=n).map(|j| (k + j) % n).filter(|&j| (cum[j] - from).rem_euclid(total) > to - from + 0.05).map(|j| ring[j]));
    out.push(a);
    out.dedup_by(|x, y| dist(*x, *y) < 0.05);
    let cut = closed(&out);
    let round = cumulated(&cut);
    (out.len() >= 4 && g::simple(&Shape { outer: out.clone(), holes: vec![] }) && gentle(&cut, &round, arc_of(&cut, &round, gate), p.width, ROOM)).then_some((out, gate))
}

/// Invariant (a gate never folds its curtain): the gates of the circuit `ring` on a straight or gently
/// turning curtain (`gentle`), each square to its street as far as the street can turn. The curtain
/// keeps its trace; it is the street that turns, over its last metres (`turned_street`).
/// - A gate by a genuine corner that juts out stands on a straight front across its tip (`cut_corner`).
///   By any other corner, or on a line that is not to be touched (a planned rectangle, a bastioned
///   front), it moves along the curtain, up to `MOVE` m, to the nearest straight stretch its street can
///   follow. An inward corner that holds its gate all the same is filled by a straight front; else the
///   gate stays as traced.
/// - A street square within `SQUARE_TOLERANCE` keeps its line. A skewed one is left as drawn with
///   probability `improvisation` (one seeded draw per gate point), and where it cannot turn: the
///   passage is then oblique in its straight curtain. So is the passage of a `VILLAGE`, and of a street
///   that is already built on.
fn fit_passages(mut ring: Vec<Point>, passages: &mut [Passage], previous: &[Point], streets: &mut [Street], c: &Circuit<'_>, surface: Surface<'_>) -> Vec<Point> {
    let turning = c.streets_turn && c.pop >= VILLAGE;
    for i in 0..passages.len() {
        if previous.iter().any(|&q| dist(q, passages[i].at) < 8.0) { continue; }
        let others: Vec<Point> = passages.iter().enumerate().filter(|&(j, _)| j != i).map(|(_, q)| q.at).collect();
        let mut path = closed(&ring);
        let mut cum = cumulated(&path);
        let total = cum[ring.len()];
        let p = passages[i];
        let k = segment_of(&path, p.at);
        if g::distance(p.at, path[k], path[k + 1]).0 > 1.0 {
            continue;
        }
        let s = cum[k] + dist(path[k], p.at);
        let apart = |t: f64| others.iter().all(|&q| { let d = (arc_of(&path, &cum, q) - t).rem_euclid(total); d.min(total - d) >= 2.0 * STRAIGHT });
        if !gentle(&path, &cum, s, p.width, ROOM) {
            let cut = if c.squared { cut_corner(&ring, &p, &others, streets, surface, false) } else { None };
            let ns = normals(&path);
            let moved = if cut.is_none() && turning {
                (1..=(MOVE / 4.0) as i32).flat_map(|m| [4.0, -4.0].map(|step| s + f64::from(m) * step)).find_map(|t| {
                    let (gate, k) = at_arc(&path, &cum, t);
                    (gentle(&path, &cum, t, p.width, FRONT) && apart(t) && !surface.wet(gate)).then(|| turned_street(streets, &path, &p, gate, ns[k], surface, c.grade).map(|street| (gate, street)))?
                })
            } else {
                None
            };
            if let Some((gate, (si, line, widths, along))) = moved {
                streets[si].path = line;
                streets[si].widths = widths;
                (passages[i].at, passages[i].along) = (gate, along);
                continue;
            }
            let cut = cut.or_else(|| if c.squared { cut_corner(&ring, &p, &others, streets, surface, true) } else { None });
            let Some((cut, gate)) = cut else { continue };
            ring = cut;
            passages[i].at = gate;
            path = closed(&ring);
            cum = cumulated(&path);
        }
        let p = passages[i];
        let k = segment_of(&path, p.at);
        let lean = cross(p.along, dir(path[k], path[k + 1])).abs().clamp(0.0, 1.0).acos();
        let left = Rng::new(c.key).fork(&format!("gate-front:{:.0}:{:.0}", p.at.x, p.at.y)).chance(c.improvisation);
        if !(turning && c.squared) || lean <= SQUARE_TOLERANCE || lean > SQUARE_TURN || left || !gentle(&path, &cum, arc_of(&path, &cum, p.at), p.width, ROOM) {
            continue;
        }
        let n = normals(&path)[k];
        if let Some((si, line, widths, along)) = turned_street(streets, &path, &p, p.at, n, surface, c.grade) {
            streets[si].path = line;
            streets[si].widths = widths;
            passages[i].along = along;
        }
    }
    ring
}

/// What `decide` needs to know of a circuit.
pub(in super::super) struct Circuit<'a> {
    pub(in super::super) pop: u32,
    pub(in super::super) gates: Option<usize>,
    /// "" for a town circuit, else `castle` or `citadel`.
    pub(in super::super) purpose: &'a str,
    pub(in super::super) kind: &'a str,
    pub(in super::super) curtain_width: f64,
    /// Widest moat (m) the style digs, and the steepest street grade: a diversion runs beyond the moat.
    pub(in super::super) moat: f64,
    pub(in super::super) grade: f64,
    /// Its curtain may be fitted to its gates and its streets square to it (`fit_passages`): not a
    /// planned rectangle, a bastioned front or a stretch shared with another circuit.
    pub(in super::super) squared: bool,
    /// Its streets may still turn to their gates: nothing is built along them yet.
    pub(in super::super) streets_turn: bool,
    /// Seed key and share of the gates left as traced (`LayoutConfig::street_improvisation`).
    pub(in super::super) key: &'a str,
    pub(in super::super) improvisation: f64,
}

/// Longest gap (m) between a main street's dead end and the curtain it points at that
/// `reach_through` closes, and the sine (30°) under which the street grazes the curtain instead.
const REACH_GAP: f64 = 80.0;
const REACH_SINE: f64 = 0.5;
/// How far (m) a main street ending outside runs on into the circuit.
const REACH_IN: f64 = 20.0;
/// Longest stretch of water (m) a reaching street may pass (a stream; `clear_water` bridges it).
const REACH_WADE: f64 = 16.0;
/// A dead end of another main street across the wall within this distance (m) of the line is where the
/// reaching street runs to: the two make one road.
const REACH_JOIN: f64 = 15.0;
/// A street end this near (m) a regional road of the request was clipped from it.
const ROAD_MATCH: f64 = 3.0;

/// A main street `reach_through` ran through a curtain: `added` vertices were added at its last end
/// (`back`) or its first, crossing the curtain at `at`.
pub(in super::super) struct Reached {
    street: usize,
    back: bool,
    added: usize,
    outside_road: bool,
    at: Point,
}

/// Walls and moats first, the rest adapts: before the gates of the circuit `wall` are decided, every
/// main street (`priority` 2 and more) that ends dead (no other street within 1 m of its end) and
/// reaches the curtain within `REACH_GAP` m runs on through it, to `beyond` m outside (curtain, berm,
/// moat and 20 m) from an end inside, to `REACH_IN` m inside from an end outside. In order:
/// - to the dead end of another main street waiting across the wall near its line (`REACH_JOIN`):
///   the two make one road;
/// - along the regional road of the request `roads` it was clipped from (`ROAD_MATCH`);
/// - straight on, where it points at the curtain at more than 30°.
///
/// No extension ends in water, passes more than `REACH_WADE` m of it, crosses another street or one
/// of the `others` circuits, or crosses the curtain twice. The crossing is then a candidate of the
/// budget like any other; `decide_reached` takes back the extensions whose crossing it shuts.
/// An end within this distance (m) of the curtain line counts as lying on it.
const ON_WALL: f64 = 2.0;

pub(in super::super) fn reach_through(wall: &Shape, streets: &mut [Street], beyond: f64, others: &[Shape], roads: &[Street], requested: Option<usize>, surface: Surface<'_>) -> Vec<Reached> {
    let mut out: Vec<Reached> = vec![];
    if wall.outer.len() < 3 {
        return out;
    }
    let path = closed(&wall.outer);
    let ring = g::normalized(Shape { outer: wall.outer.clone(), holes: vec![] });
    let dead = |streets: &[Street], si: usize, p: Point| streets.iter().enumerate().all(|(sj, t)| sj == si || !t.path.windows(2).any(|w| g::distance(p, w[0], w[1]).0 < 1.0));
    let main = |s: &Street| priority(s) >= 2 && !water_way(s, false) && s.path.len() >= 2;
    let profile = std::env::var("URBAN_PROFILE").is_ok();
    // Inner ends first: a road arriving outside is met by the street it continues.
    // An explicit count may use a lesser street already approaching the wall as a postern.
    // Main streets get both passes first. Stop reaching lesser ends once the request is met.
    for (inner, lesser) in [(true, false), (false, false), (true, true), (false, true)] {
        let mut needed = if lesser {
            let Some(count) = requested else { break };
            count.saturating_sub(crossings(&path, &cumulated(&path), streets, surface).len())
        } else { usize::MAX };
        for si in 0..streets.len() {
            if needed == 0 { break; }
            if lesser && (!matches!(streets[si].role.as_str(), "street" | "lane" | "approach") || streets[si].path.len() < 2)
                || main(&streets[si]) == lesser {
                continue;
            }
            for back in [true, false] {
                if needed == 0 || out.iter().any(|r| r.street == si && r.back == back) {
                    continue;
                }
                let s = &streets[si];
                let n = s.path.len();
                let end = if back { s.path[n - 1] } else { s.path[0] };
                // The direction the street leaves by: from its last vertex a metre or more back.
                let Some(from) = (0..n - 1).map(|j| if back { s.path[n - 2 - j] } else { s.path[j + 1] }).find(|&q| dist(q, end) >= 1.0) else { continue };
                let u = dir(from, end);
                // The armature often ends on the trace itself: the side of a street is the side of its
                // body, `ON_WALL` m back from its end, and its lines are probed from there.
                let back_off = add(end, u, -ON_WALL);
                if g::contains(&ring, back_off) != inner || !dead(&*streets, si, end) {
                    continue;
                }
                let extra = if inner { beyond } else { REACH_IN };
                // Straight on: the distance to the curtain it points at.
                let probe = add(end, u, REACH_GAP);
                let ray = path
                    .windows(2)
                    .filter_map(|w| g::segment_hit(back_off, probe, w[0], w[1]).map(|(t, _)| ((t * (REACH_GAP + ON_WALL) - ON_WALL).max(0.0), dir(w[0], w[1]))))
                    .min_by(|a, b| a.0.total_cmp(&b.0))
                    .filter(|&(_, side)| cross(u, side).abs() >= REACH_SINE)
                    .map(|(d, _)| d);
                // Along the request road, as far beyond its first crossing.
                let road = along_road(roads, end, u, REACH_GAP + extra / REACH_SINE).and_then(|line| {
                    let from_body: Vec<Point> = std::iter::once(back_off).chain(line.iter().copied()).collect();
                    let a = (first_hit(&path, &from_body)? - ON_WALL).max(0.0);
                    if a > REACH_GAP { return None; }
                    if !inner { return Some(prefix(&line, a + extra)); }
                    // A skew approach needs more road length to clear the same width of moat.
                    let clearance = |q| path.windows(2).map(|w| g::distance(q, w[0], w[1]).0).fold(f64::INFINITY, f64::min);
                    let cum = cumulated(&line);
                    let j = (1..line.len()).find(|&j| cum[j] > a && !g::contains(&ring, line[j]) && clearance(line[j]) >= extra)?;
                    let (mut lo, mut hi) = (cum[j - 1].max(a), cum[j]);
                    for _ in 0..12 {
                        let mid = (lo + hi) * 0.5;
                        if clearance(at_arc_open(&line, &cum, mid).0) >= extra { hi = mid; } else { lo = mid; }
                    }
                    Some(prefix(&line, hi))
                });
                if profile {
                    eprintln!("  reach: ({:.0},{:.0}) ray {:?} road {}", end.x, end.y, ray.map(f64::round), road.is_some());
                }
                if ray.is_none() && road.is_none() {
                    continue;
                }
                let partner = ray.and_then(|d| {
                    let across = |q: Point| {
                        let v = (q.x - end.x, q.y - end.y);
                        let along = dot(v, u);
                        along >= d - 1.0 && along <= d + extra + REACH_JOIN && cross(u, v).abs() <= REACH_JOIN
                    };
                    streets
                        .iter()
                        .enumerate()
                        .filter(|&(sj, t)| sj != si && main(t))
                        .flat_map(|(sj, t)| [(sj, t.path[0]), (sj, t.path[t.path.len() - 1])])
                        .filter(|&(sj, q)| across(q) && dead(&*streets, sj, q))
                        .map(|(_, q)| q)
                        .min_by(|a, b| dist(*a, end).total_cmp(&dist(*b, end)))
                });
                // The crossing of `line` (from `end`), if it passes the curtain once, dry at its end, by
                // no long water, clear of the other streets and circuits; a `straight` line also at more
                // than 30° to the curtain and within 30° of the street's way.
                let fits = |line: &[Point], straight: bool| -> Option<Point> {
                    let to = *line.last()?;
                    let from_body: Vec<Point> = std::iter::once(back_off).chain(line.iter().copied()).collect();
                    let mut hits: Vec<(Point, V, V)> = from_body
                        .windows(2)
                        .flat_map(|s| path.windows(2).filter_map(move |w| reach_hit(s[0], s[1], w[0], w[1]).map(|h| (h.1, dir(s[0], s[1]), dir(w[0], w[1])))))
                        .collect();
                    // One crossing met at the joint of two segments counts once.
                    hits.dedup_by(|a, b| dist(a.0, b.0) < 0.5);
                    let &[(at, v, side)] = hits.as_slice() else {
                        if profile {
                            eprintln!("  reach: ({:.0},{:.0}) meets the curtain {} times", end.x, end.y, hits.len());
                        }
                        return None;
                    };
                    if surface.wet(to) || straight && (cross(v, u).abs() >= 0.5 || dot(v, u) <= 0.0 || cross(v, side).abs() < REACH_SINE) {
                        if profile {
                            eprintln!("  reach: ({:.0},{:.0}) wet end {} or skew {:.2}", end.x, end.y, surface.wet(to), cross(v, side).abs());
                        }
                        return None;
                    }
                    let (mut wade, mut longest) = (0.0_f64, 0.0_f64);
                    for s in line.windows(2) {
                        let steps = dist(s[0], s[1]).ceil().max(1.0) as usize;
                        let step = dist(s[0], s[1]) / steps as f64;
                        for j in 1..=steps {
                            wade = if surface.wet(add(s[0], dir(s[0], s[1]), step * j as f64)) { wade + step } else { 0.0 };
                            longest = longest.max(wade);
                        }
                    }
                    let crossed = streets.iter().enumerate().any(|(sj, t)| {
                        sj != si
                            && t.path.windows(2).any(|w| line.windows(2).any(|s| g::segment_hit(s[0], s[1], w[0], w[1]).is_some_and(|(_, x)| dist(x, end) > 1.0 && dist(x, to) > 1.0)))
                    });
                    let other = others.iter().any(|o| line.windows(2).any(|s| (0..o.outer.len()).any(|j| g::segment_hit(s[0], s[1], o.outer[j], o.outer[(j + 1) % o.outer.len()]).is_some())));
                    if profile && (longest > REACH_WADE || crossed || other) {
                        eprintln!("  reach: ({:.0},{:.0}) water {longest:.0} m, crosses a street {crossed}, another circuit {other}", end.x, end.y);
                    }
                    (longest <= REACH_WADE && !crossed && !other).then_some(at)
                };
                let chosen = partner
                    .and_then(|q| fits(&[end, q], true).map(|x| (vec![q], x)))
                    .or_else(|| road.as_ref().and_then(|line| fits(line, false).map(|x| (line[1..].to_vec(), x))))
                    .or_else(|| {
                        // Straight on only for a regional road (it has somewhere to go beyond the wall) or when
                        // the gate count is requested (the owner of the town asks for the gate). A
                        // town street ending at the wall would open a gate onto nothing, which closes
                        // again later and takes the street's inner gate with it.
                        ray.filter(|_| streets[si].role == "regional" || requested.is_some()).and_then(|d| {
                            let q = add(end, u, d + extra);
                            fits(&[end, q], true).map(|x| (vec![q], x))
                        })
                    });
                let Some((added, at)) = chosen else {
                    if profile {
                        eprintln!("  reach: ({:.0},{:.0}) no line fits", end.x, end.y);
                    }
                    continue;
                };
                let s = &mut streets[si];
                // An end lying on the trace steps back onto the street's body: the street then crosses
                // the curtain instead of touching it.
                if path.windows(2).any(|w| g::distance(end, w[0], w[1]).0 < 0.5) && dist(from, end) > 2.0 * ON_WALL {
                    let k = if back { s.path.len() - 1 } else { 0 };
                    s.path[k] = back_off;
                }
                let w = (if back { s.widths.last() } else { s.widths.first() }).copied().unwrap_or(4.0);
                for &q in &added {
                    if back {
                        s.path.push(q);
                        s.widths.push(w);
                    } else {
                        s.path.insert(0, q);
                        s.widths.insert(0, w);
                    }
                }
                needed -= 1;
                out.push(Reached { street: si, back, added: added.len(), outside_road: !inner || road.is_some() || s.role == "regional", at });
            }
        }
    }
    if profile && !out.is_empty() {
        eprintln!("  gate budget: reached through {}", out.iter().map(|r| format!("({:.0},{:.0}) +{}", r.at.x, r.at.y, r.added)).collect::<Vec<_>>().join(" "));
    }
    out
}

/// The regional road of `roads` that passes within `ROAD_MATCH` m of `end`, followed from there the
/// way `u` for `limit` m: `end` first.
fn along_road(roads: &[Street], end: Point, u: V, limit: f64) -> Option<Vec<Point>> {
    let (_, r, j) = roads
        .iter()
        .enumerate()
        .filter(|(_, r)| r.role == "regional")
        .flat_map(|(ri, r)| r.path.windows(2).enumerate().filter(|(_, w)| dist(w[0], w[1]) > 1e-6).map(move |(j, w)| (g::distance(end, w[0], w[1]).0, ri, j)))
        .filter(|x| x.0 < ROAD_MATCH)
        .min_by(|a, b| a.0.total_cmp(&b.0))?;
    let line = &roads[r].path;
    let next: Vec<Point> = if dot(dir(line[j], line[j + 1]), u) >= 0.0 { line[j + 1..].to_vec() } else { line[..=j].iter().rev().copied().collect() };
    let mut out = vec![end];
    let mut left = limit;
    for p in next {
        let last = out[out.len() - 1];
        let l = dist(last, p);
        if l < 1e-6 {
            continue;
        }
        if l >= left {
            out.push(add(last, dir(last, p), left));
            left = 0.0;
            break;
        }
        left -= l;
        out.push(p);
    }
    // The request road stops short (a deck or another piece takes over there): straight on for the rest.
    if left > 1.0 && out.len() >= 2 {
        let (a, b) = (out[out.len() - 2], out[out.len() - 1]);
        out.push(add(b, dir(a, b), left));
    }
    (out.len() >= 2).then_some(out)
}

/// Include both ends when a clipped street and its continuation meet on the curtain.
fn reach_hit(a: Point, b: Point, c: Point, d: Point) -> Option<(f64, Point)> {
    g::segment_hit(a, b, c, d).or_else(|| g::segment_hit(b, a, c, d).map(|(t, p)| (1.0 - t, p)))
}

/// Arc (m along `line`) of its first crossing of the closed `path`.
fn first_hit(path: &[Point], line: &[Point]) -> Option<f64> {
    let cum = cumulated(line);
    line.windows(2)
        .enumerate()
        .filter_map(|(j, w)| path.windows(2).filter_map(|c| reach_hit(w[0], w[1], c[0], c[1]).map(|(t, _)| cum[j] + t * dist(w[0], w[1]))).reduce(f64::min))
        .reduce(f64::min)
}

/// The first `s` m of `line`.
fn prefix(line: &[Point], s: f64) -> Vec<Point> {
    let cum = cumulated(line);
    if s >= cum[line.len() - 1] {
        return line.to_vec();
    }
    let (p, k) = at_arc_open(line, &cum, s);
    let mut out = line[..=k].to_vec();
    out.push(p);
    out
}

/// The extensions of `reached` whose crossing the budget did not keep, taken back: the street ends
/// where it ended, and no main road is shut there.
fn take_back(streets: &mut [Street], reached: &[Reached], kept: &[Passage], shut: &mut Vec<Passage>) {
    // Within the merge distance of `composition::gates`.
    const SAME: f64 = 8.0;
    for r in reached.iter().rev().filter(|r| kept.iter().all(|k| dist(k.at, r.at) >= SAME)) {
        if r.outside_road && shut.iter().any(|p| dist(p.at, r.at) < SAME) {
            continue; // The exterior road is needed by the diversion after the curtain is built.
        }
        let s = &mut streets[r.street];
        if r.back {
            s.path.truncate(s.path.len().saturating_sub(r.added));
            s.widths.truncate(s.widths.len().saturating_sub(r.added));
        } else {
            s.path.drain(..r.added.min(s.path.len()));
            s.widths.drain(..r.added.min(s.widths.len()));
        }
        shut.retain(|p| dist(p.at, r.at) >= SAME);
    }
}

/// The land gates of the circuit `wall`, decided on `streets` as they stand: the budget keeps the
/// passages (`choose`), a main road it shuts out with no way round keeps its gate all the same
/// (`way_round`), the gates are fitted to the curtain (`fit_passages`), and every other street crossing
/// ends at the wall on both sides. Returns the circuit, its passages and the main roads shut
/// out (for `divert`, once the works of the circuit are built).
#[cfg(test)]
pub(in super::super) fn decide(wall: &Shape, streets: &mut Vec<Street>, c: &Circuit<'_>, surface: Surface<'_>) -> (Shape, Vec<Passage>, Vec<Passage>) {
    decide_reached(wall, streets, c, &[], surface)
}

/// `decide` after `reach_through`: an extension whose crossing is not kept is taken back before the
/// crossings close, so no stub is left in the moat band.
pub(in super::super) fn decide_reached(wall: &Shape, streets: &mut Vec<Street>, c: &Circuit<'_>, reached: &[Reached], surface: Surface<'_>) -> (Shape, Vec<Passage>, Vec<Passage>) {
    decide_with_gates(wall, streets, c, &[], reached, surface)
}

/// Budget the land gates left on the same front of a rebuilt circuit.
pub(in super::super) fn decide_with_gates(wall: &Shape, streets: &mut Vec<Street>, c: &Circuit<'_>, previous: &[Point], reached: &[Reached], surface: Surface<'_>) -> (Shape, Vec<Passage>, Vec<Passage>) {
    if wall.outer.len() < 3 {
        take_back(streets, reached, &[], &mut vec![]);
        return (wall.clone(), vec![], vec![]);
    }
    let path = closed(&wall.outer);
    let (mut kept, dropped) = choose(&path, streets, c.pop, c.purpose, c.gates, previous, reached, surface);
    let profile = std::env::var("URBAN_PROFILE").is_ok();
    if profile {
        let show = |ps: &[Passage]| ps.iter().map(|p| format!("({:.0},{:.0}) p{} w{:.1} sq{:.2}", p.at.x, p.at.y, p.priority, p.width, p.square)).collect::<Vec<_>>().join("; ");
        eprintln!("  gate budget: pop {} requested {:?} candidates {} | kept {} | dropped {}", c.pop, c.gates, composition::gates(&path, streets).len(), show(&kept), show(&dropped));
    }
    if kept.is_empty() && dropped.is_empty() {
        take_back(streets, reached, &[], &mut vec![]);
        return (wall.clone(), kept, dropped);
    }
    let outside = Outside::new(&path, c.curtain_width + c.moat + 8.0);
    let mut shut = vec![];
    for mut p in dropped.into_iter().filter(|p| p.priority >= 2) {
        p.reached_road = reached.iter().any(|r| r.outside_road && dist(r.at, p.at) < 8.0);
        // A gate kept beside another would stand in its front: the road shut there reaches the
        // town through that gate, way round or not.
        let crowded = kept.iter().any(|k| dist(k.at, p.at) < GATE_GAP);
        let way = way_round(&outside, &kept, &p, streets, surface, c.grade, false);
        if profile {
            eprintln!("  gate budget: dropped main ({:.0},{:.0}) crowded {crowded} way round {}", p.at.x, p.at.y, match way { WayRound::Served => "served", WayRound::Blocked => "blocked", WayRound::Road { .. } => "road" });
        }
        match way {
            WayRound::Blocked if !crowded && c.gates.is_none() && !p.reached_road => kept.push(p),
            _ => shut.push(p),
        }
    }
    take_back(streets, reached, &kept, &mut shut);
    // `URBAN_PROFILE`: how far the nearest street crossing of `ring` lies from each kept gate.
    let served = |stage: &str, ring: &[Point], kept: &[Passage], streets: &[Street]| {
        if profile {
            let crossings = composition::gates(&closed(ring), streets);
            eprintln!("  gate budget: {stage}: {}", kept.iter().map(|k| format!("({:.0},{:.0}) {:.0} m", k.at.x, k.at.y, crossings.iter().map(|&x| dist(x, k.at)).fold(f64::INFINITY, f64::min))).collect::<Vec<_>>().join("; "));
        }
    };
    served("after the budget", &wall.outer, &kept, streets);
    // A previous gate moved onto its street crossing (`choose`) is fitted no more than it was.
    let held: Vec<Point> = kept.iter().map(|k| k.at).filter(|&a| previous.iter().any(|&q| dist(q, a) < STRAIGHT)).chain(previous.iter().copied()).collect();
    let ring = if c.squared || c.streets_turn { fit_passages(wall.outer.clone(), &mut kept, &held, streets, c, surface) } else { wall.outer.clone() };
    served("after the passages are fitted", &ring, &kept, streets);
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
    close_crossings_at(streets, std::slice::from_ref(&e), true, surface, &passages, |_| c.gates.is_some());
    served("after the other crossings close", &ring, &kept, streets);
    (Shape { outer: ring, holes: wall.holes.clone() }, kept, shut)
}

/// A gate throat: the stretch of a gate street on each side of the curtain that carries the gate and
/// its traffic, about two street widths, at least 12 m.
fn throat(width: f64) -> f64 {
    (2.0 * width).max(12.0)
}

/// Widest spacing (m) the budget asks between two gates along the curtain: two roads arriving further
/// apart than this each get their gate, within the budget.
const GATE_SPACING: f64 = 80.0;

/// Land gates stand at least this far apart (m): two gate fronts (`gate_reach`). A main road shut out
/// nearer than that to a kept gate keeps no gate of its own, even with no way round.
pub(in super::super) const GATE_GAP: f64 = 2.0 * STRAIGHT;

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

/// Land gates of the old circuit that still lie on the new trace, including one-sided approaches.
pub(in super::super) fn old_gates(e: &Enclosure, path: &[Point]) -> Vec<Point> {
    e.gates.iter().enumerate().filter_map(|(i, &p)| {
        if e.gatehouses.iter().any(|g| matches!(g.kind.as_str(), "water" | "shore")
            && (g.gate == i || g.passage.iter().any(|&q| dist(q, p) < 1.0))) { return None; }
        let (gap, _, at) = path.windows(2).map(|w| g::distance(p, w[0], w[1])).min_by(|a, b| a.0.total_cmp(&b.0))?;
        (gap < 1.0).then_some(at)
    }).collect()
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
pub(in super::super) fn divert(e: &Enclosure, kept: &[Passage], shut: &[Passage], streets: &mut Vec<Street>, surface: Surface<'_>, grade: f64, built: &[crate::urban::Block]) {
    if e.path.len() < 4 || shut.is_empty() {
        return;
    }
    let from_wall = |q: Point| e.path.windows(2).map(|w| g::distance(q, w[0], w[1]).0).fold(f64::INFINITY, f64::min);
    // Only the front between the two roads sets their setback; a distant bastion may reach much farther.
    let wall_arc = cumulated(&e.path);
    let total = *wall_arc.last().unwrap();
    let arc_gap = |a: f64, b: f64| { let d = (a - b).rem_euclid(total); d.min(total - d) };
    let lips: Vec<_> = e.moat.iter().flat_map(|m| &m.runs).flat_map(|r| &r.outer)
        .chain(e.ditch.iter().skip(e.moat.as_ref().map_or(0, |m| super::moat_line::reach_count(&m.runs))).flat_map(|d| &d.shape.outer))
        .map(|&p| (arc_of(&e.path, &wall_arc, p), from_wall(p))).collect();
    let barred: Vec<_> = e.ditch.iter().map(|d| &d.shape)
        .chain(built.iter().filter(|b| matches!(b.kind.as_str(), "block" | "place")).map(|b| &b.shape))
        .map(|s| (g::bbox(s), s)).collect();
    let width_at = |s: &Street, i: usize| s.widths.get(i).or(s.widths.last()).copied().unwrap_or(4.0);
    for c in shut {
        let start = arc_of(&e.path, &wall_arc, c.at);
        let end = kept.iter().filter(|p| p.priority >= 2).map(|p| arc_of(&e.path, &wall_arc, p.at))
            .min_by(|a, b| arc_gap(*a, start).total_cmp(&arc_gap(*b, start))).unwrap_or(start);
        let front = arc_gap(start, end);
        let reach = lips.iter().filter(|(s, _)| arc_gap(*s, start) + arc_gap(*s, end) <= front + 24.0)
            .map(|(_, d)| *d).fold(e.curtain_width_m + 4.0, f64::max);
        let off = reach + (c.width * 0.5 + 1.0).max(4.0);
        let outside = Outside::new(&e.path, off);
        let way = way_round(&outside, kept, c, streets, surface, grade, true);
        // Simplifying an offset line around a corner may take its carriageway back over the lip.
        let way = match way {
            WayRound::Road { ref line, .. } if !barred.is_empty() && g::ribbon(line, &[c.width]).iter().any(|strip| {
                let bounds = g::bbox(strip);
                barred.iter().any(|(b, s)| g::boxes_meet(bounds, *b) && !g::intersection(strip, s).is_empty())
            }) => WayRound::Blocked,
            way => way,
        };
        let (sc, ic, start, junction) = match way {
            WayRound::Road { from: (s, i, p), to, line } => (s, i, p, Some((to, line))),
            _ if c.reached_road && e.moat.is_some() => {
                let Some((s, i, p, _)) = outward(streets, &e.path, &outside.ring, c, off, true) else { continue };
                (s, i, p, None)
            }
            _ => continue,
        };
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
        if std::env::var("URBAN_PROFILE").is_ok() {
            eprintln!("  gate diversion: ({:.0},{:.0}) stops at ({:.0},{:.0}), joins gate road {}", c.at.x, c.at.y, start.x, start.y, junction.is_some());
        }
        let Some(((sk, ik, end), line)) = junction else { continue };
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
