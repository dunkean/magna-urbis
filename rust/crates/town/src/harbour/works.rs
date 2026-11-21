//! Piers, moles and the basin between them, added to the quay at their population thresholds.
//! Classic's `works` (`macroplan/harbour.rs`) is the reference: a pier square to the quay every
//! `pierSpacing`, wholly over open water with a free channel beyond, a short landing stage in a
//! small town or on a river; a sea port's pair of moles from the ends of a straight quay, and
//! the basin they enclose.

use magna_urbis_geom::{Point, distance};

use super::line::{self, add, left, unit};
use super::{
    HarbourState, MOLE_RANK, PIER_RANK, STAGE_RANK, basin_keys, mole_chain, pier_chain, quay_chain,
};
use crate::armature::{Draw, Tip, chain_ops, crossings};
use crate::graph::{EdgeClass, EdgeSpec, Graph, Key, Level, NodeId, NodeKind};
use crate::journal::{Anchor, Op, Stage};
use crate::spec::{HarbourSpec, HarbourThresholds};
use crate::survey::Survey;

/// Water code of a river in the survey.
const RIVER: u8 = 3;
/// Water code of the sea.
const SEA: u8 = 1;
/// Below this population every pier is a landing stage (classic's small port).
const SMALL_PORT: f64 = 3000.0;
/// Farthest distance, in metres beyond the quay's edge, at which the water beside it is sought.
const WATER_SEARCH: f64 = 20.0;

/// Whether a threshold of the harbour and the same of the current phase are both reached.
fn reached(harbour: Option<u32>, phase: Option<u32>, inhabitants: u32) -> bool {
    harbour.is_some_and(|t| inhabitants >= t) && phase.is_some_and(|t| inhabitants >= t)
}

/// Most piers for `inhabitants`: one per 1,500 inhabitants, from 1 to 40 (classic).
fn pier_limit(inhabitants: u32) -> usize {
    (f64::from(inhabitants) / 1500.0).ceil().clamp(1.0, 40.0) as usize
}

/// Positions on the pier lattice within the quay's span, clear of the moles' roots.
fn pier_stations(state: &HarbourState, spec: &HarbourSpec) -> Vec<(u32, f64)> {
    let spacing = spec.works.pier_spacing.max(1.0);
    let margin = if state.moles {
        0.6 * spacing
    } else {
        0.3 * spacing
    };
    let total = line::length(&state.front.line);
    (0..=(total / spacing) as u32)
        .map(|k| (k, (f64::from(k) + 0.5) * spacing))
        .filter(|&(_, s)| s >= state.span[0] + margin && s <= state.span[1] - margin)
        .collect()
}

/// Whether works are due: piers missing on the lattice under their limit, the moles, or the
/// basin once the moles stand.
pub(super) fn due(
    state: &HarbourState,
    spec: &HarbourSpec,
    phase: &HarbourThresholds,
    inhabitants: u32,
) -> bool {
    let t = &spec.thresholds;
    let piers = reached(t.piers, phase.piers, inhabitants)
        && state.piers.len() < pier_limit(inhabitants)
        && pier_stations(state, spec)
            .iter()
            .any(|(k, _)| !state.piers.contains(k));
    let moles = reached(t.moles, phase.moles, inhabitants) && !state.moles;
    let basin =
        reached(t.basins, phase.basins, inhabitants) && state.moles && state.basin.is_none();
    piers || moles || basin
}

/// Push the works due onto the stage: moles first (they claim the quay's ends), the basin, then
/// piers. Returns whether any was laid.
#[allow(clippy::too_many_arguments)]
pub(super) fn build(
    stage: &mut Stage,
    survey: &Survey,
    event: &Key,
    rank: &mut u32,
    state: &HarbourState,
    spec: &HarbourSpec,
    phase: &HarbourThresholds,
    inhabitants: u32,
) -> bool {
    let t = &spec.thresholds;
    let mut built = false;
    let mut moles = state.moles;
    if reached(t.moles, phase.moles, inhabitants) && !moles {
        moles = lay_moles(stage, survey, event, rank, state, inhabitants);
        built |= moles;
    }
    if reached(t.basins, phase.basins, inhabitants) && moles && state.basin.is_none() {
        built |= close_basin(stage, event, rank, state.front.index);
    }
    if reached(t.piers, phase.piers, inhabitants) {
        let mut count = state.piers.len();
        let limit = pier_limit(inhabitants);
        for (k, s) in pier_stations(state, spec) {
            if count >= limit {
                break;
            }
            if state.piers.contains(&k) {
                continue;
            }
            if lay_pier(stage, survey, event, rank, state, spec, k, s, inhabitants) {
                count += 1;
                built = true;
            }
        }
    }
    built
}

/// The first water from `p` along `sea`, sought metre by metre from `from` metres out: its
/// distance from `p` and its water code.
fn water_beside(survey: &Survey, p: Point, sea: Point, from: f64) -> Option<(f64, u8)> {
    (0..=WATER_SEARCH as usize).find_map(|k| {
        let d = from + k as f64;
        survey
            .cell_at(add(p, sea, d))
            .filter(|c| c.wet)
            .map(|c| (d, c.water_code))
    })
}

/// Whether every sample every 2 m from `p` along `n` over `[from, to]` is water of a kind
/// matching `kind` (a river pier stays on its river; a sea or lake pier off any river).
fn open_water(survey: &Survey, p: Point, n: Point, from: f64, to: f64, kind: u8) -> bool {
    let count = ((to - from) / 2.0).ceil().max(1.0) as usize;
    (0..=count).all(|k| {
        let q = add(p, n, from + (to - from) * k as f64 / count as f64);
        survey.cell_at(q).is_some_and(|c| {
            c.wet && (c.water_code == kind || kind != RIVER && c.water_code != RIVER)
        })
    })
}

/// The live quay edge nearest `p` and the point of it nearest `p`; the end node instead when
/// that point is within a metre of it.
fn quay_root(graph: &Graph, chain: &Key, p: Point) -> Option<(Point, Tip)> {
    let (_, edge, q) = graph
        .faces_along_chain(chain)
        .into_iter()
        .filter_map(|step| {
            let edge = graph.edge(step.edge);
            let (d, _, q) = edge
                .polyline
                .windows(2)
                .map(|w| distance(p, w[0], w[1]))
                .min_by(|a, b| a.0.total_cmp(&b.0))?;
            Some((d, step.edge, q))
        })
        .min_by(|a, b| a.0.total_cmp(&b.0))?;
    let edge = graph.edge(edge);
    if let Some(n) = edge
        .nodes
        .iter()
        .map(|&n| graph.node(n))
        .find(|n| n.position.distance(q) <= 1.0)
    {
        return Some((n.position, Tip::Node(n.key.clone())));
    }
    Some((q, Tip::OnEdge(edge.stem.clone())))
}

/// A pier (or landing stage) square to the quay at lattice position `k`, station `s`.
#[allow(clippy::too_many_arguments)]
fn lay_pier(
    stage: &mut Stage,
    survey: &Survey,
    event: &Key,
    rank: &mut u32,
    state: &HarbourState,
    spec: &HarbourSpec,
    k: u32,
    s: f64,
    inhabitants: u32,
) -> bool {
    let w = &spec.works;
    let (base, t) = line::point_at(&state.front.line, s);
    let sea = left(Point { x: -t.x, y: -t.y });
    let chain = quay_chain(state.front.index);
    let Some((root, tip)) = quay_root(stage.graph(), &chain, base) else {
        return false;
    };
    let half = w.quay_width * 0.5;
    let Some((d0, kind)) = water_beside(survey, root, sea, half + 0.5) else {
        return false;
    };
    let population = f64::from(inhabitants);
    let stage_only = population < SMALL_PORT || kind == RIVER;
    let [short, long] = w.pier_length;
    let wanted = if stage_only {
        (short * 0.5).clamp(6.0, 14.0)
    } else {
        short + (long - short) * ((population - SMALL_PORT) / 30_000.0).clamp(0.0, 1.0)
    };
    // A river stage reaches a fifth of the river at most; a pier leaves a free channel beyond.
    let beyond = |l: f64| {
        if kind == RIVER {
            4.0 * l
        } else if stage_only {
            2.0 * l
        } else {
            20.0
        }
    };
    let Some(l) = [1.0, 0.85, 0.67]
        .iter()
        .map(|f| wanted * f)
        .find(|&l| open_water(survey, root, sea, d0, d0 + l + beyond(l), kind))
    else {
        return false;
    };
    let end = add(root, sea, d0 + l);
    // The head stands in open water on both sides, as far as the pier is long.
    let reach = l.max(8.0);
    let back = Point { x: -t.x, y: -t.y };
    if !(open_water(survey, end, t, 0.0, reach, kind)
        && open_water(survey, end, back, 0.0, reach, kind))
    {
        return false;
    }
    let path = [root, end];
    let Some(hits) = crossings(stage.graph(), &path, [true, false], false) else {
        return false;
    };
    if !hits.is_empty() {
        return false;
    }
    let draw = Draw {
        event,
        next_rank: rank,
        chain: Some(pier_chain(state.front.index, k)),
        class: EdgeClass::Quay,
        rank: if stage_only { STAGE_RANK } else { PIER_RANK },
        width: if stage_only { 3.0 } else { 5.0 },
    };
    let (ops, _) = chain_ops(draw, &path, tip, Tip::Free(NodeKind::DeadEnd), &[]);
    stage.try_push(ops).is_ok()
}

/// The quay's two end nodes on the stage's graph, low then high.
fn quay_ends(graph: &Graph, state: &HarbourState) -> Option<[NodeId; 2]> {
    Some([
        graph.node_id(&state.ends[0])?,
        graph.node_id(&state.ends[1])?,
    ])
}

/// The pair of moles from the ends of a straight sea quay: out to sea square to the quay's
/// chord, then turned towards each other, leaving a mouth between their heads (classic's moles).
fn lay_moles(
    stage: &mut Stage,
    survey: &Survey,
    event: &Key,
    rank: &mut u32,
    state: &HarbourState,
    inhabitants: u32,
) -> bool {
    let graph = stage.graph();
    let Some([low, high]) = quay_ends(graph, state) else {
        return false;
    };
    let (a, b) = (graph.node(low).position, graph.node(high).position);
    let chord = a.distance(b);
    let population = f64::from(inhabitants);
    if chord < (population.sqrt() * 0.5).clamp(40.0, 100.0) || chord < 0.85 * state.length() {
        return false;
    }
    let t = unit(a, b);
    let middle = Point {
        x: (a.x + b.x) * 0.5,
        y: (a.y + b.y) * 0.5,
    };
    let half = 3.0;
    let sea_at = |p: Point, n: Point| {
        water_beside(survey, p, n, half + 0.5).filter(|&(_, code)| code == SEA)
    };
    let Some(n) = [left(t), Point { x: t.y, y: -t.x }]
        .into_iter()
        .filter_map(|n| sea_at(middle, n).map(|(d, _)| (d, n)))
        .min_by(|x, y| x.0.total_cmp(&y.0))
        .map(|(_, n)| n)
    else {
        return false;
    };
    let (Some((da, _)), Some((db, _))) = (sea_at(a, n), sea_at(b, n)) else {
        return false;
    };
    let reach = (0.35 * chord).clamp(40.0, 160.0);
    let arm = 0.3 * chord;
    let (a0, b0) = (add(a, n, da), add(b, n, db));
    let (a1, b1) = (add(a0, n, reach), add(b0, n, reach));
    let (a2, b2) = (add(a1, t, arm), add(b1, t, -arm));
    let sea_run = |p: Point, q: Point| open_water(survey, p, unit(p, q), 0.0, p.distance(q), SEA);
    if !(sea_run(add(a0, n, 4.0), a1)
        && sea_run(a1, a2)
        && sea_run(add(b0, n, 4.0), b1)
        && sea_run(b1, b2))
    {
        return false;
    }
    let width = (population.sqrt() * 0.08).clamp(3.0, 12.0);
    let backup = stage.clone();
    for (side, (from, path)) in [(low, vec![a, a1, a2]), (high, vec![b, b1, b2])]
        .into_iter()
        .enumerate()
    {
        let graph = stage.graph();
        let start = Tip::Node(graph.node(from).key.clone());
        let ok = crossings(graph, &path, [true, false], false).is_some_and(|h| h.is_empty());
        let draw = Draw {
            event,
            next_rank: &mut *rank,
            chain: Some(mole_chain(state.front.index, side as u32)),
            class: EdgeClass::Quay,
            rank: MOLE_RANK,
            width,
        };
        let (ops, _) = chain_ops(draw, &path, start, Tip::Free(NodeKind::DeadEnd), &[]);
        if !ok || stage.try_push(ops).is_err() {
            *stage = backup;
            return false;
        }
    }
    true
}

/// The basin: an edge across the mouth between the moles' heads closes the water between the
/// quay and the moles into a face named by `basin_keys`.
fn close_basin(stage: &mut Stage, event: &Key, rank: &mut u32, front: u32) -> bool {
    let graph = stage.graph();
    let head = |side: u32| {
        let steps = graph.faces_along_chain(&mole_chain(front, side));
        let mut degree: std::collections::BTreeMap<NodeId, u32> = Default::default();
        for step in &steps {
            for n in graph.edge(step.edge).nodes {
                *degree.entry(n).or_default() += 1;
            }
        }
        // The head is the mole's free end: a dead end with no other arm.
        degree
            .into_iter()
            .filter(|&(n, d)| d == 1 && graph.arms(n, Level::Ground).len() == 1)
            .map(|(n, _)| n)
            .next()
    };
    let (Some(a), Some(b)) = (head(0), head(1)) else {
        return false;
    };
    let (pa, pb) = (graph.node(a).position, graph.node(b).position);
    if !crossings(graph, &[pa, pb], [true, true], false).is_some_and(|h| h.is_empty()) {
        return false;
    }
    let key = Key::edge(event, *rank);
    *rank += 1;
    let mut spec = EdgeSpec::new(key, Level::Ground, EdgeClass::Boundary, vec![pa, pb], 1.0);
    spec.rank = 4;
    spec.face_names = Some(basin_keys(front));
    let ends = [
        Anchor::Node {
            node: graph.node(a).key.clone(),
        },
        Anchor::Node {
            node: graph.node(b).key.clone(),
        },
    ];
    stage.try_push(vec![Op::InsertEdge { spec, ends }]).is_ok()
}
