//! Whether a far bank is due, and where its crossing goes on the armature.

use std::collections::{BTreeMap, BTreeSet};

use magna_urbis_geom::{Point, distance};

use super::span::{self, Chord, along, first_wet, shortest, span_near, unit};
use super::{
    Crossing, CrossingKind, GROUND, Join, WaterInputs, axis_chain, crossing_events, joinable,
    town_banks,
};
use crate::armature::Arm;
use crate::graph::{EdgeClass, EdgeId, Graph, Key, NodeId};
use crate::journal::EventKind;
use crate::spec::CrossingSpec;
use crate::survey::{BankId, Survey};

/// A join within this distance of an end node of the joined edge takes that node (metres), as
/// `armature::chain::NODE_JOIN`.
const NODE_JOIN: f64 = 0.5;
/// A join closer than this to the near landing is the landing itself (metres).
const MIN_APPROACH: f64 = 2.0;
/// Metres a street off the axes is counted farther than an axis when the crossing's join is
/// chosen, so that an axis is prolonged when one is about as near.
const AXIS_BIAS: f64 = 40.0;
/// Shortest stretch of a regional road kept between a bank point and the road edge's ends
/// (metres), so that the road can split there.
const ROAD_END_CLEAR: f64 = 1.0;

/// The crossing due now, if any: when the cheapest crossing to a far bank (a dry component of
/// the survey with at least `minFarLand` of open land, not yet the town's) costs less than the
/// cheapest open land left on the town's banks beyond the ring's level, the crossing to that
/// bank. Its near landing lies in the opened land. A regional road already crossing to that bank
/// carries it; otherwise the main axis whose prolongation meets the water within
/// `approachReach` of its tip, square to the flow; otherwise the street nearest the cheapest
/// crossing, as a new axis. `None` when no far bank is cheaper, or none can be crossed.
pub fn far_bank_due(inputs: &WaterInputs<'_>) -> Option<Crossing> {
    let survey = inputs.survey;
    let town = town_banks(survey, inputs.focus, inputs.journal);
    if town.is_empty() {
        return None;
    }
    let land = bank_land(survey);
    let cell_area = survey.cell_size() * survey.cell_size();
    let min_cells = (inputs.spec.min_far_land / cell_area).ceil().max(1.0) as usize;
    let far_ok = |b: BankId| !town.contains(&b) && land.get(&b).is_some_and(|&n| n >= min_cells);
    let near_left = near_left(inputs, &town);
    let index = crossing_events(inputs.journal).count() as u32;
    // The event key depends on the crossing's position only, so it is known before the bank.
    let event = EventKind::CrossWater {
        crossing: index,
        bank: 0,
    }
    .key();

    let roads = road_spans(survey, inputs.graph, &town, &far_ok);
    let road = roads
        .iter()
        .filter(|r| inputs.costs.cost_at(r.near) < inputs.level)
        .map(|r| (inputs.costs.cost_at(r.far), r))
        .filter(|(c, _)| c.is_finite())
        .min_by(|a, b| a.0.total_cmp(&b.0));
    let chord = cheapest_chord(inputs, &town, &far_ok, near_left);
    let road_cost = road.map_or(f64::INFINITY, |(c, _)| c);
    let chord_cost = chord.as_ref().map_or(f64::INFINITY, |(c, _)| *c);
    let (best, far_bank) = if road_cost <= chord_cost {
        (road_cost, road.map(|(_, r)| r.far_bank)?)
    } else {
        (chord_cost, chord.as_ref().map(|(_, c)| c.banks[1])?)
    };
    if best >= near_left {
        return None;
    }
    // A regional road already crossing to that bank carries the crossing.
    if let Some(r) = roads
        .iter()
        .filter(|r| r.far_bank == far_bank && inputs.costs.cost_at(r.near) < inputs.level)
        .min_by(|a, b| a.width.total_cmp(&b.width))
    {
        return Some(road_crossing(inputs.graph, r, index));
    }
    let (_, seed) = chord.filter(|(_, c)| c.banks[1] == far_bank)?;
    on_armature(inputs, &town, far_bank, &seed, index, &event)
}

/// Open dry cells per bank component.
fn bank_land(survey: &Survey) -> BTreeMap<BankId, usize> {
    let mut land = BTreeMap::new();
    for cell in survey.cells().filter(|c| !c.closed) {
        if let Some(b) = cell.bank_id {
            *land.entry(b).or_default() += 1;
        }
    }
    land
}

/// The cost of the cheapest open land left on the town's banks: the cheapest reachable cell of a
/// town bank at or beyond the ring's level; infinite when none is left.
fn near_left(inputs: &WaterInputs<'_>, town: &BTreeSet<BankId>) -> f64 {
    inputs
        .costs
        .cells_by_cost()
        .find(|(c, cost)| *cost >= inputs.level && c.bank_id.is_some_and(|b| town.contains(&b)))
        .map_or(f64::INFINITY, |(_, cost)| cost)
}

/// The kind of crossing a town of `inhabitants` builds over water `width` metres wide, if any.
pub(super) fn kind_for(
    width: f64,
    navigable: bool,
    inhabitants: f64,
    spec: &CrossingSpec,
) -> Option<CrossingKind> {
    let fords = spec.ford_span > 0.0
        && !navigable
        && width <= spec.ford_span
        && (inhabitants < f64::from(spec.ford_population) || spec.builders < 1.0);
    if fords {
        Some(CrossingKind::Ford)
    } else if width <= bridge_span(spec, inhabitants) {
        Some(CrossingKind::Bridge)
    } else if spec.ferry_span > 0.0 && width <= spec.ferry_span {
        Some(CrossingKind::Ferry)
    } else {
        None
    }
}

/// Widest bridge a town of `inhabitants` builds, classic's rule.
pub(super) fn bridge_span(spec: &CrossingSpec, inhabitants: f64) -> f64 {
    let size = (inhabitants.max(0.0) / 1000.0).sqrt();
    (spec.builders * spec.span_per_sqrt_thousand * size).clamp(0.0, spec.max_span.max(0.0))
}

/// Widest water any crossing of a town of `inhabitants` spans.
fn longest(spec: &CrossingSpec, inhabitants: f64) -> f64 {
    bridge_span(spec, inhabitants)
        .max(spec.ford_span)
        .max(spec.ferry_span)
}

/// Effective metres per metre of water crossed by a crossing of `kind`.
fn per_metre(kind: CrossingKind, inputs: &WaterInputs<'_>) -> f64 {
    match kind {
        CrossingKind::Ferry => inputs.spec.ferry_cost,
        CrossingKind::Road => inputs.growth.regional_road_cost,
        CrossingKind::Bridge | CrossingKind::Ford => inputs.growth.axis_cost,
    }
}

/// `chord` walked from a town bank to a far bank `far_ok` accepts, if it joins them.
fn orient(chord: &Chord, town: &BTreeSet<BankId>, far_ok: &dyn Fn(BankId) -> bool) -> Option<Chord> {
    if town.contains(&chord.banks[0]) && far_ok(chord.banks[1]) {
        Some(chord.clone())
    } else if town.contains(&chord.banks[1]) && far_ok(chord.banks[0]) {
        Some(chord.reversed())
    } else {
        None
    }
}

/// The cheapest crossing from the opened land of the town's banks to a far bank, and its cost:
/// the near landing's cost, the water charge and the water at the kind's cost per metre. The
/// shore cells are read in cost order, and the search stops at the first one dearer than the
/// best crossing found, the land left or the ring's level.
fn cheapest_chord(
    inputs: &WaterInputs<'_>,
    town: &BTreeSet<BankId>,
    far_ok: &dyn Fn(BankId) -> bool,
    near_left: f64,
) -> Option<(f64, Chord)> {
    let survey = inputs.survey;
    let step = survey.cell_size();
    let max = longest(inputs.spec, inputs.inhabitants);
    let accept = |c: &Chord| {
        orient(c, town, far_ok).filter(|c| {
            inputs.costs.cost_at(c.ends[0]) < inputs.level
                && kind_for(c.width, c.navigable, inputs.inhabitants, inputs.spec).is_some()
        })
    };
    let mut best: Option<(f64, Chord)> = None;
    for (cell, cost) in inputs.costs.cells_by_cost() {
        let bound = best
            .as_ref()
            .map_or(near_left, |(b, _)| b.min(near_left))
            .min(inputs.level);
        if cost >= bound {
            break;
        }
        if !cell.bank_id.is_some_and(|b| town.contains(&b)) {
            continue;
        }
        let shore = [(1.0, 0.0), (0.0, 1.0), (-1.0, 0.0), (0.0, -1.0)]
            .into_iter()
            .map(|(dx, dy)| Point {
                x: cell.position.x + dx * step,
                y: cell.position.y + dy * step,
            })
            .find(|&p| span::wet(survey, p));
        let Some(water) = shore else {
            continue;
        };
        let Some(found) = shortest(survey, water, max, &accept) else {
            continue;
        };
        let Some(kind) = kind_for(found.width, found.navigable, inputs.inhabitants, inputs.spec)
        else {
            continue;
        };
        let total = inputs.costs.cost_at(found.ends[0])
            + inputs.water_charge
            + found.width * per_metre(kind, inputs);
        if best.as_ref().is_none_or(|(b, _)| total < *b) {
            best = Some((total, found));
        }
    }
    best
}

/// The wet stretch of a regional road between a town bank and a far bank.
struct RoadSpan {
    /// The road's live edge.
    edge: EdgeId,
    /// Its last dry point on the town's bank and first on the far bank, on its polyline.
    near: Point,
    far: Point,
    near_bank: BankId,
    far_bank: BankId,
    width: f64,
    navigable: bool,
}

/// The wet stretches of live regional roads that run from a town bank straight to a far bank
/// `far_ok` accepts, within one edge, sampled every quarter cell.
fn road_spans(
    survey: &Survey,
    graph: &Graph,
    town: &BTreeSet<BankId>,
    far_ok: &dyn Fn(BankId) -> bool,
) -> Vec<RoadSpan> {
    let step = survey.cell_size() * 0.25;
    let mut out = Vec::new();
    for e in graph.live_edges() {
        let edge = graph.edge(e);
        if edge.level != GROUND || *edge.class.current() != EdgeClass::RegionalRoad {
            continue;
        }
        let total: f64 = edge.polyline.windows(2).map(|w| w[0].distance(w[1])).sum();
        // The last dry sample with its station and bank, and the water met since.
        let mut dry: Option<(Point, f64, BankId)> = None;
        let mut water: Option<bool> = None;
        let mut walked = 0.0;
        for w in edge.polyline.windows(2) {
            let length = w[0].distance(w[1]);
            let count = (length / step).ceil().max(1.0) as usize;
            for k in 0..=count {
                let t = k as f64 / count as f64;
                let p = along(w[0], unit(w[0], w[1]), length * t);
                let station = walked + length * t;
                let Some(cell) = survey.cell_at(p) else {
                    dry = None;
                    water = None;
                    continue;
                };
                if cell.wet {
                    if dry.is_some() {
                        water = Some(water.unwrap_or(false) || cell.navigable);
                    }
                    continue;
                }
                let bank = cell.bank_id.filter(|_| !cell.closed);
                if let (Some((from, from_station, from_bank)), Some(navigable), Some(to_bank)) =
                    (dry, water, bank)
                {
                    let clear = from_station > ROAD_END_CLEAR && total - station > ROAD_END_CLEAR;
                    let oriented = if town.contains(&from_bank) && far_ok(to_bank) {
                        Some((from, p, from_bank, to_bank))
                    } else if town.contains(&to_bank) && far_ok(from_bank) {
                        Some((p, from, to_bank, from_bank))
                    } else {
                        None
                    };
                    if let Some((near, far, near_bank, far_bank)) = oriented.filter(|_| clear) {
                        out.push(RoadSpan {
                            edge: e,
                            near,
                            far,
                            near_bank,
                            far_bank,
                            width: (station - from_station).max(0.0),
                            navigable,
                        });
                    }
                }
                dry = bank.map(|b| (p, station, b));
                water = None;
            }
            walked += length;
        }
    }
    out
}

/// A crossing carried by the wet stretch of a regional road.
fn road_crossing(graph: &Graph, road: &RoadSpan, index: u32) -> Crossing {
    let edge = graph.edge(road.edge);
    Crossing {
        index,
        kind: CrossingKind::Road,
        near_bank: road.near_bank,
        far_bank: road.far_bank,
        chain: edge.chain.clone().unwrap_or_else(|| edge.stem.clone()),
        rank: *edge.rank.current(),
        width: edge.widths.iter().copied().fold(0.0, f64::max),
        join: Join::Edge(edge.key.clone()),
        join_point: road.near,
        near_path: Vec::new(),
        span: [road.near, road.far],
        far_path: Vec::new(),
        water: road.width,
        navigable: road.navigable,
        new_arm: None,
    }
}

/// Where the chain meets the crossing, and which chain it is.
struct Joined {
    join: Join,
    point: Point,
    chain: Key,
    rank: u8,
    width: f64,
    new_arm: bool,
}

/// The crossing to `far_bank` on the armature: from the tip of the axis whose prolongation meets
/// the water nearest, square to the flow there; else at the cheapest crossing `seed`, square to
/// the flow, joined to the nearest street (an axis first). The first whose approaches can be
/// drawn on open land.
fn on_armature(
    inputs: &WaterInputs<'_>,
    town: &BTreeSet<BankId>,
    far_bank: BankId,
    seed: &Chord,
    index: u32,
    event: &Key,
) -> Option<Crossing> {
    let (survey, graph, spec) = (inputs.survey, inputs.graph, inputs.spec);
    let max = longest(spec, inputs.inhabitants);
    let accept = |c: &Chord| {
        orient(c, town, &|b| b == far_bank).filter(|c| {
            inputs.costs.cost_at(c.ends[0]) < inputs.level
                && kind_for(c.width, c.navigable, inputs.inhabitants, spec).is_some()
        })
    };
    let reach = spec.approach_reach + 2.0 * survey.cell_size();
    let mut tried: Vec<(f64, Joined, Chord)> = Vec::new();
    for arm in inputs.arms {
        let Some(tip) = tip(graph, &arm.chain, inputs.focus) else {
            continue;
        };
        let from = graph.node(tip).position;
        let Some(water) = first_wet(survey, from, (arm.bearing.cos(), arm.bearing.sin()), reach)
        else {
            continue;
        };
        let Some(chord) = span_near(survey, water, max, &accept) else {
            continue;
        };
        let d = from.distance(chord.ends[0]);
        if d <= spec.approach_reach {
            let joined = Joined {
                join: Join::Node(graph.node(tip).key.clone()),
                point: from,
                chain: arm.chain.clone(),
                rank: arm.rank,
                width: arm.width,
                new_arm: false,
            };
            tried.push((d, joined, chord));
        }
    }
    tried.sort_by(|a, b| a.0.total_cmp(&b.0));
    let water = if span::wet(survey, seed.middle()) {
        seed.middle()
    } else {
        along(seed.ends[0], seed.axis(), seed.width * 0.5 + survey.cell_size() * 0.5)
    };
    if let Some(chord) = span_near(survey, water, max, &accept)
        && let Some(joined) = nearest_join(inputs, chord.ends[0], event)
    {
        tried.push((0.0, joined, chord));
    }
    tried
        .into_iter()
        .find_map(|(_, joined, chord)| build(inputs, joined, chord, index))
}

/// The crossing from `joined` over `chord`, if its approaches lie on open land.
fn build(
    inputs: &WaterInputs<'_>,
    joined: Joined,
    chord: Chord,
    index: u32,
) -> Option<Crossing> {
    let survey = inputs.survey;
    let kind = kind_for(chord.width, chord.navigable, inputs.inhabitants, inputs.spec)?;
    let width = joined.width.max(inputs.spec.min_width);
    let axis = chord.axis();
    let mut span = chord.ends;
    let near_path = if joined.point.distance(span[0]) < MIN_APPROACH {
        span[0] = joined.point;
        Vec::new()
    } else {
        approach(survey, joined.point, span[0], axis, width)?
    };
    let lead = (2.5 * width).clamp(4.0, 15.0);
    let far_path = [lead, lead * 0.5]
        .into_iter()
        .map(|l| vec![span[1], along(span[1], axis, l)])
        .find(|path| open_path(survey, path))
        .unwrap_or_default();
    let new_arm = joined.new_arm.then(|| Arm {
        chain: joined.chain.clone(),
        bearing: axis.1.atan2(axis.0),
        rank: joined.rank,
        width,
    });
    Some(Crossing {
        index,
        kind,
        near_bank: chord.banks[0],
        far_bank: chord.banks[1],
        chain: joined.chain,
        rank: joined.rank,
        width,
        join: joined.join,
        join_point: joined.point,
        near_path,
        span,
        far_path,
        water: chord.width,
        navigable: chord.navigable,
        new_arm,
    })
}

/// The near approach from `join` to the landing: straight, or, where a street meets the span at
/// an angle, straight off the span for a lead of 2.5 widths first and then turning on land
/// (classic's knee). `None` when neither keeps to open land.
fn approach(
    survey: &Survey,
    join: Point,
    landing: Point,
    axis: (f64, f64),
    width: f64,
) -> Option<Vec<Point>> {
    let lead = (2.5 * width).clamp(4.0, 15.0);
    let back = (-axis.0, -axis.1);
    let (dx, dy) = (join.x - landing.x, join.y - landing.y);
    let ahead = dx * back.0 + dy * back.1;
    let aside = (dx * back.1 - dy * back.0).abs();
    if ahead > 1.5 * lead && aside > 0.2 * ahead {
        let path = vec![join, along(landing, back, lead), landing];
        if open_path(survey, &path) {
            return Some(path);
        }
    }
    let path = vec![join, landing];
    open_path(survey, &path).then_some(path)
}

/// Whether a path keeps to open dry cells, sampled every half cell; the first and last
/// 0.6 cell are not tested, since a join may lie on a boundary half a cell off the land.
fn open_path(survey: &Survey, path: &[Point]) -> bool {
    let step = survey.cell_size() * 0.5;
    let clear = survey.cell_size() * 0.6;
    let total: f64 = path.windows(2).map(|w| w[0].distance(w[1])).sum();
    let mut walked = 0.0;
    for w in path.windows(2) {
        let length = w[0].distance(w[1]);
        let count = (length / step).ceil().max(1.0) as usize;
        for k in 0..=count {
            let at = walked + length * k as f64 / count as f64;
            if at < clear || total - at < clear {
                continue;
            }
            let p = along(w[0], unit(w[0], w[1]), length * k as f64 / count as f64);
            if survey.closed_at(p) {
                return false;
            }
        }
        walked += length;
    }
    true
}

/// The street nearest `landing` within the approach reach to join a crossing to: an axis when
/// one is within `AXIS_BIAS` metres of the nearest street, else that street, opening a new axis.
fn nearest_join(inputs: &WaterInputs<'_>, landing: Point, event: &Key) -> Option<Joined> {
    let graph = inputs.graph;
    let arms: BTreeMap<&Key, &Arm> = inputs.arms.iter().map(|a| (&a.chain, a)).collect();
    let (_, e, point, arm) = graph
        .edges_near(GROUND, landing, inputs.spec.approach_reach)
        .into_iter()
        .filter(|&e| joinable(*graph.edge(e).class.current()))
        .map(|e| {
            let edge = graph.edge(e);
            let (d, q) = nearest_point(&edge.polyline, landing);
            let arm = edge.chain.as_ref().and_then(|c| arms.get(c).copied());
            let score = d + if arm.is_some() { 0.0 } else { AXIS_BIAS };
            (score, e, q, arm)
        })
        .min_by(|a, b| a.0.total_cmp(&b.0).then(a.1.cmp(&b.1)))?;
    let edge = graph.edge(e);
    let at_node = edge
        .nodes
        .iter()
        .map(|&n| graph.node(n))
        .find(|n| n.position.distance(point) <= NODE_JOIN);
    let (join, point) = match at_node {
        Some(n) => (Join::Node(n.key.clone()), n.position),
        None => (Join::Edge(edge.key.clone()), point),
    };
    Some(match arm {
        Some(arm) => Joined {
            join,
            point,
            chain: arm.chain.clone(),
            rank: arm.rank,
            width: arm.width,
            new_arm: false,
        },
        None => Joined {
            join,
            point,
            chain: axis_chain(event),
            rank: (*edge.rank.current()).max(1),
            width: edge.widths.iter().copied().fold(0.0, f64::max),
            new_arm: true,
        },
    })
}

/// Distance from `p` to a polyline and the nearest point on it.
fn nearest_point(polyline: &[Point], p: Point) -> (f64, Point) {
    polyline
        .windows(2)
        .map(|w| {
            let (d, _, q) = distance(p, w[0], w[1]);
            (d, q)
        })
        .fold((f64::INFINITY, p), |best, x| if x.0 < best.0 { x } else { best })
}

/// The far end of an axis's chain: its end farthest from the focus (as `armature`'s own tip).
fn tip(graph: &Graph, chain: &Key, focus: Point) -> Option<NodeId> {
    let mut degree: BTreeMap<NodeId, u32> = BTreeMap::new();
    for step in graph.faces_along_chain(chain) {
        for n in graph.edge(step.edge).nodes {
            *degree.entry(n).or_default() += 1;
        }
    }
    degree
        .into_iter()
        .filter(|&(_, d)| d == 1)
        .map(|(n, _)| n)
        .max_by(|&a, &b| {
            let (da, db) = (
                graph.node(a).position.distance(focus),
                graph.node(b).position.distance(focus),
            );
            da.total_cmp(&db).then(a.cmp(&b))
        })
}
