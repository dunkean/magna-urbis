//! The precinct cycle over a town's life (design 5.2, 5.3): the grown regime (a town walled when
//! grown takes its first precinct round its aged quarters and raises it at once), lobes or
//! concentric extensions, the fossil rule on an overtaken circuit, gates where new main chains
//! cross a standing circuit, and a citadel for cultures that keep one without a height.

use magna_urbis_geom::{self as g, Point, Shape, surface::TerrainView};

use super::geometry::{buffer_all, largest, turn_at};
use super::insert::{chain_nodes, ring_distance, seat_nodes};
use super::precinct::{
    Circuit, Gate, Precinct, PrecinctPlan, PrecinctSite, Purpose, curtain_width, joined, lay,
    precinct_key,
};
use super::{Candidate, TraceFamily, Traced, trace};
use crate::charter::{Charter, PlannedPhase};
use crate::graph::{Clock, EdgeClass, Graph, Key, Level, NodeKind};
use crate::journal::{Op, Writer};
use crate::spec::{ExtensionHabit, FossilRule, PrecinctSpec};
use crate::survey::Survey;

/// Distance in metres over which the aged quarters' faces are closed into one outline: about a
/// street and its kerbs.
const QUARTER_CLOSING: f64 = 8.0;

/// How a precinct extends the walled town.
#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub enum Extension {
    /// Attached on the cheapest side through `walls::attach`.
    Lobe,
    /// A new circuit round the old one.
    Concentric,
}

/// Lobes below the spec's lobe limit for a town with the lobe habit, concentric beyond it or
/// for a town with the concentric habit.
pub fn extension(habit: ExtensionHabit, inhabitants: f64, spec: &PrecinctSpec) -> Extension {
    match habit {
        ExtensionHabit::Lobes if inhabitants < spec.lobe_limit => Extension::Lobe,
        _ => Extension::Concentric,
    }
}

/// A quarter as the grown regime reads it.
#[derive(Clone, Copy, Debug)]
pub struct QuarterAge<'a> {
    /// Keys of its faces at birth.
    pub faces: &'a [Key],
    pub ring: u32,
    /// Fill step reached, from 0 at birth.
    pub step: usize,
}

/// The land of the quarters aged at least one step, the youngest ring left out as faubourg:
/// their faces joined across their streets into one outline. `None` when no quarter qualifies.
pub fn aged_land(graph: &Graph, quarters: &[QuarterAge<'_>]) -> Option<Shape> {
    let youngest = quarters.iter().map(|q| q.ring).max()?;
    let faces: Vec<Shape> = quarters
        .iter()
        .filter(|q| q.step >= 1 && q.ring < youngest)
        .flat_map(|q| q.faces.iter())
        .filter_map(|k| graph.face_id(k))
        .filter_map(|f| graph.outline(f))
        .map(|s| Shape {
            outer: s.outer,
            holes: vec![],
        })
        .collect();
    if faces.is_empty() {
        return None;
    }
    let grown = buffer_all(&faces, QUARTER_CLOSING);
    let closed = buffer_all(&grown, -QUARTER_CLOSING);
    largest(closed).map(|s| Shape {
        outer: s.outer,
        holes: vec![],
    })
}

/// The grown regime's first precinct: round the aged quarters, traced by the charter's tracer,
/// raised at once. `None` when no quarter has aged yet or no line can be drawn.
#[allow(clippy::too_many_arguments)]
pub fn survey_grown(
    writer: &Writer,
    survey: &Survey,
    charter: &Charter,
    phase: &PlannedPhase,
    quarters: &[QuarterAge<'_>],
    housed: Clock,
    clock: Clock,
    site: &PrecinctSite<'_>,
) -> Option<PrecinctPlan> {
    let draw = charter.draws.phases.get(&phase.spec.name)?;
    let land = aged_land(writer.graph(), quarters)?;
    let kind = draw.wall_kind;
    let mut candidate = Candidate::new(land);
    candidate.style = draw.wall_style.as_deref();
    candidate.small = housed.households() * site.household_size < 2_000.0;
    candidate.curtain_width = curtain_width(kind);
    let traced = trace(&candidate, site.terrain, site.wall);
    let circuit = Circuit {
        index: 0,
        purpose: Purpose::Town,
        traced,
        standing: None,
        kind,
        class: EdgeClass::Wall,
        wall_street: true,
        sized_for: housed.households(),
        clock,
        attached_to: None,
        joins_castle: false,
        enclosed_before: None,
        closed: Vec::new(),
    };
    let mut stage = writer.stage(clock);
    let mut plan = lay(&mut stage, survey, site, circuit)?;
    plan.ops = stage.into_ops();
    Some(plan)
}

/// A chain's change of class or rank, for one `RetypeChain` event.
#[derive(Clone, Debug, PartialEq)]
pub struct ChainRetype {
    pub chain: Key,
    pub class: Option<EdgeClass>,
    pub rank: Option<u8>,
    /// The event's operations. Removals merge faces; the loop applies them one by one on a
    /// stage and keeps those the graph accepts.
    pub ops: Vec<Op>,
}

/// The fossil rule on the circuit `old` when a concentric circuit round it is raised: kept as a
/// wall (`None`, nothing changes: an inner circuit), turned into a boulevard (a rank-1 street),
/// or retired (its edges removed). A lobe's old circuit is kept whole: only the shared stretch
/// became inner.
pub fn fossil(graph: &Graph, old: &Precinct, rule: FossilRule) -> Option<ChainRetype> {
    let edges: Vec<Key> = graph
        .faces_along_chain(&old.chain)
        .into_iter()
        .map(|s| graph.edge(s.edge).key.clone())
        .collect();
    if edges.is_empty() {
        return None;
    }
    match rule {
        FossilRule::Keep => None,
        FossilRule::Boulevard => Some(ChainRetype {
            chain: old.chain.clone(),
            class: Some(EdgeClass::Street),
            rank: Some(1),
            ops: vec![
                Op::SetChainClass {
                    chain: old.chain.clone(),
                    class: EdgeClass::Street,
                },
                Op::SetChainRank {
                    chain: old.chain.clone(),
                    rank: 1,
                },
            ],
        }),
        FossilRule::Remove => Some(ChainRetype {
            chain: old.chain.clone(),
            class: None,
            rank: None,
            ops: edges
                .into_iter()
                .map(|edge| Op::RemoveEdge { edge, merged: None })
                .collect(),
        }),
    }
}

/// Gate nodes where `chains` (main axes, regional, harbour and castle roads) cross a standing
/// circuit: each junction of a circuit's chain where one of those chains has an arm becomes a
/// gate. Called after each armature extension, so that a new main chain crossing a kept wall or
/// an open precinct opens a gate there.
pub fn gates_on_circuits(graph: &Graph, circuits: &[&Precinct], chains: &[Key]) -> Vec<Op> {
    let mut ops = Vec::new();
    let mut seen: Vec<Key> = Vec::new();
    for circuit in circuits {
        for (key, _) in chain_nodes(graph, &circuit.chain) {
            let Some(node) = graph.node_id(&key) else {
                continue;
            };
            if *graph.node(node).kind.current() != NodeKind::Junction || seen.contains(&key) {
                continue;
            }
            let crossed = graph.arms(node, Level::Ground).into_iter().any(|h| {
                let edge = graph.edge(h.edge());
                matches!(
                    edge.class.current(),
                    EdgeClass::RegionalRoad | EdgeClass::HarbourRoad | EdgeClass::CastleRoad
                ) || edge.chain.as_ref().is_some_and(|c| chains.contains(c))
            });
            if crossed {
                seen.push(key.clone());
                ops.push(Op::SetNodeKind {
                    node: key,
                    kind: NodeKind::Gate,
                });
            }
        }
    }
    ops
}

/// A citadel for a culture that keeps one without a height: a square of the spec's citadel area
/// astride the town line at its strongest corner (the highest convex corner), turned to the
/// corner's bisector. `None` when the line has no convex corner.
pub fn citadel_outline(
    town: &Precinct,
    terrain: &dyn TerrainView,
    spec: &PrecinctSpec,
) -> Option<Shape> {
    let ring = &town.outline.outer;
    let n = ring.len();
    if n < 3 {
        return None;
    }
    let corner = (0..n)
        .filter(|&i| {
            let (a, p, b) = (ring[(i + n - 1) % n], ring[i], ring[(i + 1) % n]);
            (p.x - a.x) * (b.y - p.y) - (p.y - a.y) * (b.x - p.x) > 0.0
        })
        .max_by(|&i, &j| {
            let score = |k: usize| terrain.height_at(ring[k]) + 5.0 * turn_at(ring, k);
            score(i).total_cmp(&score(j)).then(j.cmp(&i))
        })?;
    let (a, p, b) = (
        ring[(corner + n - 1) % n],
        ring[corner],
        ring[(corner + 1) % n],
    );
    let unit = |u: (f64, f64)| {
        let l = u.0.hypot(u.1).max(1e-9);
        (u.0 / l, u.1 / l)
    };
    let (u, v) = (unit((a.x - p.x, a.y - p.y)), unit((b.x - p.x, b.y - p.y)));
    let inward = unit((u.0 + v.0, u.1 + v.1));
    let half = spec.citadel_area.max(100.0).sqrt() * 0.5;
    // A diamond on the bisector, centred on the corner: half in the town, half out.
    let (ax, ay) = inward;
    let (bx, by) = (-ay, ax);
    let at = |s: f64, t: f64| Point {
        x: p.x + (ax * s + bx * t) * half,
        y: p.y + (ay * s + by * t) * half,
    };
    Some(g::normalized(Shape {
        outer: vec![at(-1.0, -1.0), at(1.0, -1.0), at(1.0, 1.0), at(-1.0, 1.0)],
        holes: vec![],
    }))
}

/// Draw a citadel circuit on open land astride the town line, raised with its town (class
/// `Precinct` while the town's precinct is open, `Wall` once it stands), with a field gate on
/// its side away from the town. `index` is its place in the town's sequence of circuits.
#[allow(clippy::too_many_arguments)]
pub fn survey_citadel(
    writer: &Writer,
    survey: &Survey,
    town: &Precinct,
    outline: Shape,
    index: u32,
    clock: Clock,
    site: &PrecinctSite<'_>,
) -> Option<PrecinctPlan> {
    let kind = town.kind;
    let traced = Traced {
        corners: outline.outer.clone(),
        outline,
        family: TraceFamily::Square,
        style: town.style.clone(),
        salients: vec![],
        shared: vec![],
        warnings: vec![],
    };
    let class = if town.raised.is_some() {
        EdgeClass::Wall
    } else {
        EdgeClass::Precinct
    };
    let circuit = Circuit {
        index,
        purpose: Purpose::Citadel,
        traced,
        standing: None,
        kind,
        class,
        wall_street: false,
        sized_for: 0.0,
        clock,
        attached_to: None,
        joins_castle: false,
        enclosed_before: None,
        closed: Vec::new(),
    };
    let mut stage = writer.stage(clock);
    let mut plan = lay(&mut stage, survey, site, circuit)?;
    let event = precinct_key(index);
    let field = field_point(&plan.precinct.outline, &town.enclosed);
    let gates = seat_nodes(
        &mut stage,
        &plan.precinct.chain,
        &[field],
        NodeKind::Gate,
        &event,
        FIELD_GATE_SLOT,
    );
    plan.precinct
        .gates
        .extend(gates.into_iter().map(|(node, position)| Gate {
            node,
            position,
            route: None,
            kind: NodeKind::Gate,
        }));
    plan.precinct.enclosed = joined(&town.enclosed, &plan.precinct.outline);
    plan.ops = stage.into_ops();
    Some(plan)
}

/// Node slot of a citadel's or castle's field gate.
pub(super) const FIELD_GATE_SLOT: u32 = 4;

/// The vertex of `circuit` farthest from the land of `town`: where a field gate opens.
pub(super) fn field_point(circuit: &Shape, town: &Shape) -> Point {
    circuit
        .outer
        .iter()
        .copied()
        .filter(|&p| !g::contains(town, p))
        .max_by(|&a, &b| {
            ring_distance(&town.outer, a)
                .total_cmp(&ring_distance(&town.outer, b))
                .then(a.x.total_cmp(&b.x))
        })
        .unwrap_or(circuit.outer[0])
}
