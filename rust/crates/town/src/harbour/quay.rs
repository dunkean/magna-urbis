//! The quay: opened on the waterline of the chosen front and lengthened with the town.
//!
//! The quay's line is the front's shore offset inland by half a quay width. It is sampled every
//! few metres; where a sample falls in a block, it is moved seaward (up to a quay width), so that
//! the quay runs along the town's water edge and never splits a block; where a street runs
//! between the line and the water, the sample is refused (classic: never behind a bank street).
//! The quay is the run of usable samples nearest the harbour's landing, `quay_length` long, split
//! at landing nodes about every `landingSpacing` metres, each with a landing street inland to the
//! nearest street of the town. Faces it closes against the town are aprons.

use std::collections::{BTreeSet, HashSet};

use magna_urbis_geom::{Point, area, simplify};

use super::line::{self, add, left};
use super::works;
use super::{FrontChoice, HarbourState, QUAY_RANK, face_point, landing_chain, quay_chain};
use crate::armature::{Draw, Hit, Tip, chain_ops, crossings};
use crate::graph::{Clock, EdgeClass, FaceKind, Graph, Key, Level, NodeKind};
use crate::journal::{Op, Stage, Writer};
use crate::spec::{HarbourSpec, HarbourThresholds};
use crate::survey::Survey;

/// Distance between quay samples in metres.
const SAMPLE: f64 = 4.0;
/// Seaward moves tried for a sample, in half quay widths.
const SHIFTS: [f64; 5] = [0.0, 0.5, 1.0, 1.5, 2.0];
/// Samples on either side whose shift a sample takes, so that the quay runs straight past an obstacle.
const SMOOTH: usize = 2;
/// Simplification tolerance of the laid quay in metres.
const TOLERANCE: f64 = 0.4;
/// Shortest stretch of quay laid, in metres.
const MIN_STRETCH: f64 = 8.0;
/// A planned landing within this distance of a crossing is dropped (metres).
const CROSSING_CLEAR: f64 = 3.0;
/// The quay is lengthened only when its target exceeds its length by this much (metres).
const EXTEND_STEP: f64 = 20.0;
/// Metres trimmed from a free quay end when a crossing falls too close to it.
const END_TRIMS: [f64; 3] = [0.0, 2.0, 4.0];

/// Quay length in metres for `inhabitants` housed: classic's `quay_budget`, the demand of a
/// landing (`quayShare` per inhabitant) up to `quayPerSqrtPop`·√P, at least `minQuay`.
pub fn quay_length(spec: &HarbourSpec, inhabitants: u32) -> f64 {
    let p = f64::from(inhabitants.max(1));
    let w = &spec.works;
    let cap = (spec.quay_per_sqrt_pop * p.sqrt()).max(w.min_quay);
    (p * w.quay_share * w.port_factor).clamp(w.min_quay, cap)
}

/// Whether the town has reached the front of `choice`: a street or a ring boundary lies within
/// a landing street's reach of its landing.
pub fn opened(choice: &FrontChoice, graph: &Graph, spec: &HarbourSpec) -> bool {
    // Roads run there before the town: the harbour road ends on the landing.
    graph
        .edges_near(Level::Ground, choice.landing, spec.works.landing_reach)
        .into_iter()
        .any(|e| {
            matches!(
                graph.edge(e).class.current(),
                EdgeClass::Street | EdgeClass::Lane | EdgeClass::Stairs | EdgeClass::Boundary
            )
        })
}

/// The operations of `OpenHarbour` on `choice` at date `at` (event key `event`), for
/// `inhabitants` housed: the quay centred on the landing, its landing nodes and streets, and
/// the apron faces it closes. `None` when no quay can be laid or none of it reaches the town.
pub fn open_harbour(
    writer: &Writer,
    at: Clock,
    event: &Key,
    survey: &Survey,
    choice: &FrontChoice,
    spec: &HarbourSpec,
    inhabitants: u32,
) -> Option<Vec<Op>> {
    let mut stage = writer.stage(at);
    let before = live_faces(stage.graph());
    let total = line::length(&choice.line);
    let wanted = quay_length(spec, inhabitants);
    // Sample a window twice the quay's length, then keep the quay's length of the usable run
    // nearest the landing: a blocked stretch moves the quay along the bank, nearest first.
    let window = line::centred(total, choice.landing_station, 2.0 * wanted);
    let samples = quay_samples(stage.graph(), survey, &choice.line, window, spec);
    let centre = nearest_usable(&samples, choice.landing_station)?;
    let run = run_around(&samples, centre);
    let (from, to) = (samples[run.0].0, samples[run.1].0);
    let [a, b] = clamp_span(
        line::centred(total, choice.landing_station, wanted),
        from,
        to,
    )?;
    // The run's samples between the span's ends, the ends themselves taking the shift of the
    // sample nearest them, so that the quay has its exact length.
    let inside: Vec<(f64, f64)> = samples[run.0..=run.1]
        .iter()
        .filter_map(|&(s, shift)| Some((s, shift?)))
        .filter(|&(s, _)| s > a + 1e-6 && s < b - 1e-6)
        .collect();
    let nearest_shift = |station: f64| {
        samples[run.0..=run.1]
            .iter()
            .filter_map(|&(s, shift)| Some((s, shift?)))
            .min_by(|x, y| (x.0 - station).abs().total_cmp(&(y.0 - station).abs()))
            .map_or(0.0, |x| x.1)
    };
    let mut points: Vec<Point> = std::iter::once((a, nearest_shift(a)))
        .chain(inside)
        .chain(std::iter::once((b, nearest_shift(b))))
        .map(|(s, shift)| quay_point(&choice.line, s, shift))
        .collect();
    // A harbour road ends on the line at the landing: the quay passes through its node.
    let road = road_landing(stage.graph(), choice);
    if let Some((_, at_road)) = &road {
        let (s, _) = line::project(&points, *at_road);
        insert_at(&mut points, s, *at_road);
    }
    let keep = road.as_ref().map(|r| r.1);
    let points = simplify(&points, TOLERANCE, |p| keep.is_some_and(|q| q == p));
    let rank = &mut 0;
    let chain = quay_chain(choice.index);
    let (path, hits) = fit(stage.graph(), &points, [false, false])?;
    let length = line::length(&path);
    let n = (length / spec.works.landing_spacing.max(MIN_STRETCH))
        .ceil()
        .max(1.0);
    let planned: Vec<f64> = (0..n as usize)
        .map(|k| length * (k as f64 + 0.5) / n)
        .collect();
    let stops = stops_clear_of(stage.graph(), &planned, &hits, &path, spec);
    let start = Tip::Free(NodeKind::StreetEnd);
    let landings = lay(&mut stage, event, rank, &chain, &path, start, &stops, spec)?;
    let mut connected = road.is_some()
        || hits
            .iter()
            .any(|h| landing_target(stage.graph().edge(h.edge).class.current()));
    for key in &landings {
        connected |= landing_street(&mut stage, survey, event, rank, choice, key, spec);
    }
    if !connected {
        return None;
    }
    mark_aprons(&mut stage, survey, &chain, &before, length, spec);
    Some(stage.into_ops())
}

/// Whether an `ExtendHarbour` is due for `state` at `inhabitants`: the quay's target length
/// exceeds its length by a step, or works whose threshold is crossed are missing.
pub fn extension_due(
    state: &HarbourState,
    spec: &HarbourSpec,
    phase: &HarbourThresholds,
    inhabitants: u32,
) -> bool {
    let total = line::length(&state.front.line);
    let longer = quay_length(spec, inhabitants).min(total) > state.length() + EXTEND_STEP;
    longer || works::due(state, spec, phase, inhabitants)
}

/// The operations of an `ExtendHarbour` at date `at` (event key `event`): the quay lengthened
/// along its bank to `quay_length` for `inhabitants`, on whichever side of the landing its
/// centred span grows, with new landings and their streets; then the piers, moles and basin
/// whose thresholds (the harbour's and the current phase's, `phase`) are crossed. `None` when
/// nothing could be laid.
#[allow(clippy::too_many_arguments)]
pub fn extend_harbour(
    writer: &Writer,
    at: Clock,
    event: &Key,
    survey: &Survey,
    state: &HarbourState,
    spec: &HarbourSpec,
    phase: &HarbourThresholds,
    inhabitants: u32,
) -> Option<Vec<Op>> {
    let mut stage = writer.stage(at);
    let before = live_faces(stage.graph());
    let choice = &state.front;
    let total = line::length(&choice.line);
    let [t0, t1] = line::centred(
        total,
        choice.landing_station,
        quay_length(spec, inhabitants),
    );
    let rank = &mut 0;
    let chain = quay_chain(choice.index);
    let spacing = spec.works.landing_spacing.max(MIN_STRETCH);
    let mut laid = 0.0;
    // Low side, walked from the quay's low end towards the start of the line, then high side.
    for (side, far) in [(0usize, t0), (1usize, t1)] {
        let end = state.span[side];
        let beyond = if side == 0 { end - far } else { far - end };
        if beyond < MIN_STRETCH {
            continue;
        }
        let Some(node) = stage.graph().node_id(&state.ends[side]) else {
            continue;
        };
        let start_at = stage.graph().node(node).position;
        let window = if side == 0 { [far, end] } else { [end, far] };
        let mut samples = quay_samples(stage.graph(), survey, &choice.line, window, spec);
        // The stretch starts on the quay's end node, wherever the sample there fell.
        let anchor = if side == 0 { samples.len() - 1 } else { 0 };
        samples[anchor].1 = Some(0.0);
        let run = run_around(&samples, anchor);
        let mut points: Vec<Point> = samples[run.0..=run.1]
            .iter()
            .filter_map(|&(s, shift)| Some(quay_point(&choice.line, s, shift?)))
            .collect();
        if side == 0 {
            points.reverse();
        }
        points[0] = start_at;
        let points = simplify(&points, TOLERANCE, |p| p == start_at);
        if line::length(&points) < MIN_STRETCH {
            continue;
        }
        let Some((path, hits)) = fit(stage.graph(), &points, [true, false]) else {
            continue;
        };
        // Landings go on every `spacing` from the outermost landing on this side.
        let outer = if side == 0 {
            state.landings.first()
        } else {
            state.landings.last()
        }
        .map_or(end, |l| l.0);
        let gap = (end - outer).abs();
        let length = line::length(&path);
        let planned: Vec<f64> = (1..)
            .map(|k| spacing * f64::from(k) - gap)
            .skip_while(|&d| d < MIN_STRETCH)
            .take_while(|&d| d < length - spacing * 0.25)
            .collect();
        let stops = stops_clear_of(stage.graph(), &planned, &hits, &path, spec);
        let start = Tip::Node(state.ends[side].clone());
        let Some(landings) = lay(&mut stage, event, rank, &chain, &path, start, &stops, spec)
        else {
            continue;
        };
        for key in &landings {
            landing_street(&mut stage, survey, event, rank, choice, key, spec);
        }
        laid += length;
    }
    if laid > 0.0 {
        mark_aprons(&mut stage, survey, &chain, &before, laid, spec);
    }
    let built = works::build(
        &mut stage,
        survey,
        event,
        rank,
        state,
        spec,
        phase,
        inhabitants,
    );
    (laid > 0.0 || built).then(|| stage.into_ops())
}

/// The quay's point at station `s` of its base line, moved `shift` metres seaward.
fn quay_point(base: &[Point], s: f64, shift: f64) -> Point {
    let (p, t) = line::point_at(base, s);
    add(p, left(t), -shift)
}

/// Samples of the quay line every few metres over `window`, each with how far seaward of the
/// base line the quay runs there, or `None` where it cannot run.
fn quay_samples(
    graph: &Graph,
    survey: &Survey,
    base: &[Point],
    window: [f64; 2],
    spec: &HarbourSpec,
) -> Vec<(f64, Option<f64>)> {
    let half = spec.works.quay_width * 0.5;
    let [from, to] = window;
    let count = ((to - from) / SAMPLE).ceil().max(1.0) as usize;
    let stations: Vec<f64> = (0..=count)
        .map(|k| from + (to - from) * k as f64 / count as f64)
        .collect();
    let at = |s: f64, shift: f64| quay_point(base, s, shift);
    let shifts: Vec<Option<f64>> = stations
        .iter()
        .map(|&s| {
            let (p, t) = line::point_at(base, s);
            if behind_bank_street(graph, p, left(t), half) {
                return None;
            }
            SHIFTS
                .iter()
                .map(|k| k * half)
                .find(|&d| usable(graph, survey, at(s, d)))
        })
        .collect();
    let n = stations.len();
    (0..n)
        .map(|i| {
            let Some(own) = shifts[i] else {
                return (stations[i], None);
            };
            let widest = (i.saturating_sub(SMOOTH)..=(i + SMOOTH).min(n - 1))
                .filter_map(|j| shifts[j])
                .fold(own, f64::max);
            let shift = if widest > own && !usable(graph, survey, at(stations[i], widest)) {
                own
            } else {
                widest
            };
            (stations[i], Some(shift))
        })
        .collect()
}

/// Whether the quay may pass through `q`: surveyed ground that is not a cliff or closed dry land
/// (water is allowed: the quay may stand out on the water), and outside every block.
fn usable(graph: &Graph, survey: &Survey, q: Point) -> bool {
    let Some(cell) = survey.cell_at(q) else {
        return false;
    };
    if cell.closed && !cell.wet {
        return false;
    }
    let face = graph.face_at(Level::Ground, q);
    face == graph.outside(Level::Ground) || *graph.face(face).kind.current() != FaceKind::Block
}

/// Whether a street runs between the line point `p` and the water: it crosses the short stretch
/// from just seaward of `p` to two metres beyond the waterline.
fn behind_bank_street(graph: &Graph, p: Point, land: Point, half: f64) -> bool {
    let a = add(p, land, -0.5);
    let b = add(p, land, -(half + 2.0));
    graph
        .edges_crossing(Level::Ground, a, b)
        .into_iter()
        .any(|e| {
            matches!(
                graph.edge(e).class.current(),
                EdgeClass::Street
                    | EdgeClass::Lane
                    | EdgeClass::Stairs
                    | EdgeClass::RegionalRoad
                    | EdgeClass::CastleRoad
            )
        })
}

/// The usable sample nearest station `s`.
fn nearest_usable(samples: &[(f64, Option<f64>)], s: f64) -> Option<usize> {
    samples
        .iter()
        .enumerate()
        .filter(|(_, x)| x.1.is_some())
        .min_by(|a, b| (a.1.0 - s).abs().total_cmp(&(b.1.0 - s).abs()))
        .map(|(i, _)| i)
}

/// The run of consecutive usable samples around sample `i` (empty-sized at `i` if it is unusable).
fn run_around(samples: &[(f64, Option<f64>)], i: usize) -> (usize, usize) {
    let ok = |k: usize| samples[k].1.is_some();
    let mut lo = i;
    while lo > 0 && ok(lo - 1) && ok(lo) {
        lo -= 1;
    }
    let mut hi = i;
    while hi + 1 < samples.len() && ok(hi + 1) && ok(hi) {
        hi += 1;
    }
    (lo, hi)
}

/// `span` moved and cut to lie within `[from, to]`, keeping its length where it can; `None`
/// when less than the shortest stretch remains.
fn clamp_span(span: [f64; 2], from: f64, to: f64) -> Option<[f64; 2]> {
    let length = (span[1] - span[0]).min(to - from);
    let a = span[0].clamp(from, (to - length).max(from));
    (length >= MIN_STRETCH).then_some([a, a + length])
}

/// The harbour road's landing node on this front, if the road was laid: the live landing node
/// nearest the front's landing, within a cell.
fn road_landing(graph: &Graph, choice: &FrontChoice) -> Option<(Key, Point)> {
    graph
        .edges_near(Level::Ground, choice.landing, 1.0)
        .into_iter()
        .filter(|&e| *graph.edge(e).class.current() == EdgeClass::HarbourRoad)
        .flat_map(|e| graph.edge(e).nodes)
        .map(|n| graph.node(n))
        .filter(|n| {
            *n.kind.current() == NodeKind::Landing && n.position.distance(choice.landing) <= 1.0
        })
        .map(|n| (n.key.clone(), n.position))
        .min_by(|a, b| a.0.cmp(&b.0))
}

/// Insert `p` into a polyline at station `s`, replacing a vertex within a sample of it.
fn insert_at(points: &mut Vec<Point>, s: f64, p: Point) {
    let mut walked = 0.0;
    for i in 0..points.len() {
        if i > 0 {
            walked += points[i - 1].distance(points[i]);
        }
        if (walked - s).abs() < SAMPLE * 0.5 {
            points[i] = p;
            return;
        }
        if walked > s {
            points.insert(i, p);
            return;
        }
    }
    points.push(p);
}

/// The path with its crossings of the graph, a free end trimmed by a few metres when a crossing
/// falls too close to it. `starts_on_node`: the first point is an existing node's.
fn fit(
    graph: &Graph,
    points: &[Point],
    starts_on_node: [bool; 2],
) -> Option<(Vec<Point>, Vec<Hit>)> {
    let total = line::length(points);
    for &head in &END_TRIMS {
        let head = if starts_on_node[0] { 0.0 } else { head };
        for &tail in &END_TRIMS {
            if total - head - tail < MIN_STRETCH {
                continue;
            }
            let path = if head == 0.0 && tail == 0.0 {
                points.to_vec()
            } else {
                line::sub_path(points, head, total - tail)
            };
            if let Some(hits) = crossings(graph, &path, starts_on_node, false) {
                return Some((path, hits));
            }
        }
    }
    None
}

/// The planned landing stations (metres along `path`) kept: not within a few metres of a
/// crossing, and not within half a spacing of a street that already meets the quay.
fn stops_clear_of(
    graph: &Graph,
    planned: &[f64],
    hits: &[Hit],
    path: &[Point],
    spec: &HarbourSpec,
) -> Vec<f64> {
    let length = line::length(path);
    let streets: Vec<f64> = hits
        .iter()
        .filter(|h| {
            let class = graph.edge(h.edge).class.current();
            landing_target(class) && *class != EdgeClass::Boundary
        })
        .map(|h| h.along)
        .collect();
    planned
        .iter()
        .copied()
        .filter(|&s| s > CROSSING_CLEAR && s < length - CROSSING_CLEAR)
        .filter(|&s| hits.iter().all(|h| (h.along - s).abs() > CROSSING_CLEAR))
        .filter(|&s| {
            streets
                .iter()
                .all(|&at| (at - s).abs() > spec.works.landing_spacing * 0.5)
        })
        .collect()
}

/// Push the quay `path` onto the stage as pieces of `chain` from `start`, split at the landing
/// stations `stops` (metres along it) and wherever it crosses the graph. Returns the keys of the
/// landing nodes it made, in order. All or nothing.
#[allow(clippy::too_many_arguments)]
fn lay(
    stage: &mut Stage,
    event: &Key,
    rank: &mut u32,
    chain: &Key,
    path: &[Point],
    start: Tip,
    stops: &[f64],
    spec: &HarbourSpec,
) -> Option<Vec<Key>> {
    let backup = stage.clone();
    let length = line::length(path);
    let mut bounds = vec![0.0];
    bounds.extend(stops.iter().copied());
    bounds.push(length);
    let mut landings = Vec::new();
    let mut tip = start;
    for (i, w) in bounds.windows(2).enumerate() {
        let sub = if bounds.len() == 2 {
            path.to_vec()
        } else {
            line::sub_path(path, w[0], w[1])
        };
        let last = i + 2 == bounds.len();
        let end = if last {
            Tip::Free(NodeKind::StreetEnd)
        } else {
            Tip::Free(NodeKind::Landing)
        };
        let on_node = matches!(tip, Tip::Node(_));
        let Some(hits) = crossings(stage.graph(), &sub, [on_node, false], false) else {
            *stage = backup;
            return None;
        };
        let draw = Draw {
            event,
            next_rank: &mut *rank,
            chain: Some(chain.clone()),
            class: EdgeClass::Quay,
            rank: QUAY_RANK,
            width: spec.works.quay_width,
        };
        let (ops, _) = chain_ops(draw, &sub, tip, end, &hits);
        let Some(Op::InsertEdge { spec: piece, .. }) = ops.last() else {
            *stage = backup;
            return None;
        };
        let node = piece.key.child(crate::graph::tag::END, &[1]);
        if stage.try_push(ops).is_err() {
            *stage = backup;
            return None;
        }
        if !last {
            landings.push(node.clone());
        }
        tip = Tip::Node(node);
    }
    Some(landings)
}

/// A landing street from the landing node `node` inland to the nearest street or ring boundary
/// within reach, straight, on open land at street grade and crossing nothing. Returns whether it
/// was laid.
#[allow(clippy::too_many_arguments)]
fn landing_street(
    stage: &mut Stage,
    survey: &Survey,
    event: &Key,
    rank: &mut u32,
    choice: &FrontChoice,
    node: &Key,
    spec: &HarbourSpec,
) -> bool {
    let graph = stage.graph();
    let Some(id) = graph.node_id(node) else {
        return false;
    };
    let p = graph.node(id).position;
    let (s, _) = line::project(&choice.line, p);
    let land = left(line::point_at(&choice.line, s).1);
    let quay = quay_chain(choice.index);
    let mut targets: Vec<(f64, Point, Tip)> = graph
        .edges_near(Level::Ground, p, spec.works.landing_reach)
        .into_iter()
        .filter(|&e| {
            let edge = graph.edge(e);
            landing_target(edge.class.current()) && edge.chain.as_ref() != Some(&quay)
        })
        .filter_map(|e| {
            let edge = graph.edge(e);
            let q = edge
                .polyline
                .windows(2)
                .map(|w| magna_urbis_geom::distance(p, w[0], w[1]))
                .min_by(|a, b| a.0.total_cmp(&b.0))?
                .2;
            let d = p.distance(q);
            let inland = (q.x - p.x) * land.x + (q.y - p.y) * land.y;
            if d <= 1.0 || inland < 0.3 * d {
                return None;
            }
            let near = edge
                .nodes
                .iter()
                .map(|&n| graph.node(n))
                .find(|n| n.position.distance(q) <= 0.5);
            Some(match near {
                Some(n) => (d, n.position, Tip::Node(n.key.clone())),
                None => (d, q, Tip::OnEdge(edge.stem.clone())),
            })
        })
        .collect();
    targets.sort_by(|a, b| a.0.total_cmp(&b.0));
    for (_, q, tip) in targets.into_iter().take(3) {
        let path = [p, q];
        if !street_grade(survey, &path, spec.works.road_grade) {
            continue;
        }
        let Some(hits) = crossings(stage.graph(), &path, [true, true], false) else {
            continue;
        };
        if !hits.is_empty() {
            continue;
        }
        let draw = Draw {
            event,
            next_rank: &mut *rank,
            chain: Some(landing_chain(choice.index)),
            class: EdgeClass::Street,
            rank: 2,
            width: spec.works.landing_width,
        };
        let (ops, _) = chain_ops(draw, &path, Tip::Node(node.clone()), tip, &[]);
        if stage.try_push(ops).is_ok() {
            return true;
        }
    }
    false
}

/// Whether a straight street keeps to open or wet-edge land at `grade`, sampled every half cell.
fn street_grade(survey: &Survey, path: &[Point; 2], grade: f64) -> bool {
    let [a, b] = *path;
    let step = survey.cell_size() * 0.5;
    let count = (a.distance(b) / step).ceil().max(1.0) as usize;
    let mut previous: Option<f64> = None;
    for k in 0..=count {
        let t = k as f64 / count as f64;
        let p = Point {
            x: a.x + (b.x - a.x) * t,
            y: a.y + (b.y - a.y) * t,
        };
        let Some(cell) = survey.cell_at(p) else {
            return false;
        };
        if cell.closed && !cell.wet {
            return false;
        }
        if !cell.wet {
            if let Some(h) = previous
                && (cell.elevation - h).abs() > grade * a.distance(b) / count as f64 + 1e-6
            {
                return false;
            }
            previous = Some(cell.elevation);
        }
    }
    true
}

/// Faces the quay newly closes on its land side, small enough to be the strip between the quay
/// and the town (at most `length` × the landing reach), become aprons. Water faces (a basin) and
/// blocks keep their kind.
fn mark_aprons(
    stage: &mut Stage,
    survey: &Survey,
    chain: &Key,
    before: &HashSet<Key>,
    length: f64,
    spec: &HarbourSpec,
) {
    let graph = stage.graph();
    let outside = graph.outside(Level::Ground);
    let limit = length.max(spec.works.landing_spacing) * spec.works.landing_reach;
    let mut aprons = BTreeSet::new();
    for step in graph.faces_along_chain(chain) {
        for f in [step.left, step.right] {
            let face = graph.face(f);
            if f == outside
                || before.contains(&face.key)
                || *face.kind.current() != FaceKind::Unbuilt
            {
                continue;
            }
            let Some(outline) = graph.outline(f) else {
                continue;
            };
            let wet = face_point(graph, f)
                .and_then(|p| survey.cell_at(p))
                .is_some_and(|c| c.wet);
            if !wet && area(&outline) <= limit {
                aprons.insert(face.key.clone());
            }
        }
    }
    for face in aprons {
        let _ = stage.try_push(vec![Op::SetFaceKind {
            face,
            kind: FaceKind::Apron,
        }]);
    }
}

/// Keys of the live faces of a graph.
fn live_faces(graph: &Graph) -> HashSet<Key> {
    graph
        .live_faces()
        .map(|f| graph.face(f).key.clone())
        .collect()
}

/// Whether a landing street may end on an edge of this class: a street or a ring boundary.
fn landing_target(class: &EdgeClass) -> bool {
    matches!(
        class,
        EdgeClass::Street
            | EdgeClass::Lane
            | EdgeClass::Stairs
            | EdgeClass::RegionalRoad
            | EdgeClass::HarbourRoad
            | EdgeClass::CastleRoad
            | EdgeClass::Boundary
    )
}
