//! `RaiseWall`: a precinct whose every sector is born becomes a wall of the phase's kind (design
//! 5.2); the inputs classic's works (`fortification::build`) read from the trace; and when the
//! next precinct is due.

use magna_urbis_geom::{self as g, Point, surface::TerrainView};

use super::insert::nearest_on;
use super::precinct::{Precinct, Purpose};
use super::water_side::waterline;
use crate::graph::{Clock, EdgeClass, FaceKind, Graph, Key, Level};
use crate::journal::{EventKind, Op};
use crate::spec::{PhaseDraw, WallKind};

/// Faces under this area (square metres) do not count when testing a precinct for fullness.
const MIN_FACE: f64 = 50.0;
/// Share of a precinct's land that may stay unopened (closed cells the trace took in, slivers
/// along the wall street) when it counts as full.
const FULL_SLACK: f64 = 0.08;
/// A street segment belongs to a gate within this distance (metres), as classic's `build` reads.
const AT_GATE: f64 = 0.1;
/// Streets within this distance of the curtain (metres) are given to the works.
const WORKS_REACH: f64 = 120.0;
/// Next survey once the outside holds this share of the bound `1 − 1/step`, leaving room for
/// the quarters born before the survey is reached.
const OUTSIDE_MARGIN: f64 = 0.8;

/// The kind of a raised wall as `RaiseWall` names it.
pub fn wall_kind_name(kind: WallKind) -> &'static str {
    match kind {
        WallKind::Hedge => "hedge",
        WallKind::Ditch => "ditch",
        WallKind::Palisade => "palisade",
        WallKind::Earthwork => "earthwork",
        WallKind::Wall => "wall",
        WallKind::Bastioned => "bastioned",
    }
}

/// The `RaiseWall` event of a precinct raised in `kind`.
pub fn raise_event(precinct: &Precinct, kind: WallKind) -> EventKind {
    EventKind::RaiseWall {
        precinct: precinct.index,
        kind: wall_kind_name(kind).into(),
    }
}

/// Whether every sector of the precinct's land is born: no unbuilt face of the ground lies on
/// its land beyond `FULL_SLACK` of it, and at least one block does.
pub fn is_full(graph: &Graph, precinct: &Precinct) -> bool {
    let land = &precinct.land;
    let total = g::area(land);
    if total <= 0.0 {
        return false;
    }
    let b = g::bbox(land);
    let outside = graph.outside(Level::Ground);
    let (mut unbuilt, mut blocks) = (0.0, 0);
    for f in graph.live_faces() {
        if f == outside || graph.face(f).level != Level::Ground {
            continue;
        }
        let Some(shape) = graph.outline(f) else {
            continue;
        };
        let fb = g::bbox(&shape);
        if fb.0 > b.2 || fb.2 < b.0 || fb.1 > b.3 || fb.3 < b.1 {
            continue;
        }
        let area = g::area(&shape);
        if area < MIN_FACE || !g::contains(land, g::interior_point(&shape)) {
            continue;
        }
        match graph.face(f).kind.current() {
            FaceKind::Unbuilt => unbuilt += area,
            FaceKind::Block => blocks += 1,
            _ => {}
        }
    }
    blocks > 0 && unbuilt <= FULL_SLACK * total
}

/// The operations of `RaiseWall` for a full precinct: each of its chain's edges still a precinct
/// line becomes a wall (an open front's stretch, retyped `Boundary` at the survey, stays open).
/// `None` while the precinct is open or already raised, or when the phase allows no wall.
pub fn raise_when_full(graph: &Graph, precinct: &Precinct, phase: &PhaseDraw) -> Option<Vec<Op>> {
    if precinct.raised.is_some() || phase.wall_kind.is_none() || !is_full(graph, precinct) {
        return None;
    }
    raise_ops(graph, precinct)
}

/// The retype of a precinct chain into a wall, without the fullness test: for a circuit raised
/// at once.
pub fn raise_ops(graph: &Graph, precinct: &Precinct) -> Option<Vec<Op>> {
    let ops: Vec<Op> = graph
        .faces_along_chain(&precinct.chain)
        .into_iter()
        .map(|s| graph.edge(s.edge))
        .filter(|e| *e.class.current() == EdgeClass::Precinct)
        .map(|e| Op::SetEdgeClass {
            edge: e.key.clone(),
            class: EdgeClass::Wall,
        })
        .collect();
    (!ops.is_empty()).then_some(ops)
}

/// Whether the next precinct is due: the intramural land has aged by the phase's gain since the
/// raise, or the households outside the standing wall near the bound `1 − 1/step` the cycle keeps
/// them under.
pub fn survey_due(inside: f64, outside: f64, inside_at_raise: f64, phase: &PhaseDraw) -> bool {
    let total = inside + outside;
    if total <= 0.0 {
        return false;
    }
    let bound = 1.0 - 1.0 / phase.precinct_step.max(1.0 + 1e-6);
    inside >= inside_at_raise * (1.0 + phase.precinct_gain.max(0.0))
        || outside / total >= OUTSIDE_MARGIN * bound
}

/// A street segment at a gate, for the works' gatehouse and passage.
#[derive(Clone, Debug, PartialEq)]
pub struct GateStreet {
    /// Position of the gate in `WorksInputs::gates`.
    pub gate: usize,
    pub segment: [Point; 2],
    pub width: f64,
    pub rank: u8,
    /// `regional`, `harbour`, `castle` or `street`, as classic's street roles.
    pub role: &'static str,
}

/// A street near the curtain, for the works' clearances.
#[derive(Clone, Debug, PartialEq)]
pub struct WorksStreet {
    pub path: Vec<Point>,
    pub widths: Vec<f64>,
    pub rank: u8,
    pub role: &'static str,
}

/// What the town crate knows of the street widths and dwellings the works are cut for; resolved
/// in core from the catalogue (classic's `Predicted`).
#[derive(Clone, Copy, Debug, PartialEq)]
pub struct WorksContext {
    /// Final width in metres of a street of each rank (classic multiplies its rank widths by 1.1).
    pub rank_widths: [f64; 5],
    /// Rank of the town's arterial gate streets (0 from 20,000 inhabitants, 1 below).
    pub arterial: u8,
    /// Minimum frontage and depth in metres of the culture's dwelling.
    pub dwelling: [f64; 2],
}

/// Everything classic's `fortification::build` needs from one circuit.
#[derive(Clone, Debug, PartialEq)]
pub struct WorksInputs {
    /// The closed path, counter-clockwise, first point repeated last.
    pub path: Vec<Point>,
    /// Gates: the land gates first (`land` of them, in path order), then the water gates and the
    /// waterline intercepts in path order.
    pub gates: Vec<Point>,
    pub land: usize,
    /// The curtain's land and water transitions in path order, `true` entering water.
    pub banks: Vec<(Point, bool)>,
    /// Street segments within 0.1 m of each land gate.
    pub gate_streets: Vec<GateStreet>,
    /// Streets within reach of the curtain.
    pub streets: Vec<WorksStreet>,
    /// Classic's enclosure kind (`wall`, `palisade`, `hedge`) and the resolved style.
    pub kind: &'static str,
    pub style: String,
    /// `""` for a town circuit, `castle` or `citadel`.
    pub purpose: &'static str,
    /// Inhabitants housed when the wall is raised.
    pub population: u32,
    /// Predicted widths (`rank_widths × 1.1`), the arterial rank and dwelling dimensions.
    pub predicted_widths: [f64; 5],
    pub arterial: u8,
    pub dwelling: [f64; 2],
    /// Key of the raise event, whose stream the works draw from.
    pub event: Key,
}

/// The works inputs of a raised precinct, `population` inhabitants being housed at its raise.
/// The path is the whole circuit (a lobe's own ring, a town joined to its castle with the castle
/// arc).
pub fn works_inputs(
    graph: &Graph,
    precinct: &Precinct,
    terrain: &dyn TerrainView,
    population: u32,
    context: &WorksContext,
) -> WorksInputs {
    let mut path = precinct.outline.outer.clone();
    if let Some(&first) = path.first() {
        path.push(first);
    }
    let along = |p: Point| arc_of(&path, p);
    let mut land_gates: Vec<(f64, Point, Key)> = precinct
        .gates
        .iter()
        .filter(|gate| gate.route.is_some())
        .map(|gate| (along(gate.position), gate.position, gate.node.clone()))
        .collect();
    land_gates.sort_by(|a, b| a.0.total_cmp(&b.0));
    let banks: Vec<(Point, bool)> = waterline(&path, terrain)
        .into_iter()
        .map(|p| {
            let (k, _) = segment_of(&path, p);
            let d = (path[k + 1].x - path[k].x, path[k + 1].y - path[k].y);
            let l = d.0.hypot(d.1).max(1e-9);
            let ahead = Point {
                x: p.x + d.0 / l * 0.5,
                y: p.y + d.1 / l * 0.5,
            };
            (p, terrain.wet(ahead))
        })
        .collect();
    let mut water: Vec<(f64, Point)> = precinct
        .gates
        .iter()
        .filter(|gate| gate.route.is_none())
        .map(|gate| (along(gate.position), gate.position))
        .chain(banks.iter().map(|&(p, _)| (along(p), p)))
        .collect();
    water.sort_by(|a, b| a.0.total_cmp(&b.0));
    let mut gates: Vec<Point> = land_gates.iter().map(|x| x.1).collect();
    let land = gates.len();
    for (_, p) in water {
        if gates.iter().all(|q| q.distance(p) >= 8.0) {
            gates.push(p);
        }
    }
    let mut gate_streets = Vec::new();
    for (i, (_, _, node)) in land_gates.iter().enumerate() {
        let Some(n) = graph.node_id(node) else {
            continue;
        };
        for h in graph.arms(n, Level::Ground) {
            let edge = graph.edge(h.edge());
            let Some(role) = street_role(*edge.class.current()) else {
                continue;
            };
            let at = graph.node(n).position;
            for (k, w) in edge.polyline.windows(2).enumerate() {
                if g::distance(at, w[0], w[1]).0 < AT_GATE {
                    gate_streets.push(GateStreet {
                        gate: i,
                        segment: [w[0], w[1]],
                        width: edge.widths.get(k).copied().unwrap_or(4.0),
                        rank: *edge.rank.current(),
                        role,
                    });
                }
            }
        }
    }
    let streets: Vec<WorksStreet> = graph
        .live_edges()
        .map(|e| graph.edge(e))
        .filter(|e| e.level == Level::Ground)
        .filter_map(|e| {
            let role = street_role(*e.class.current())?;
            let near = e
                .polyline
                .iter()
                .any(|&p| nearest_on(&path, p).0 <= WORKS_REACH);
            near.then(|| WorksStreet {
                path: e.polyline.clone(),
                widths: e.widths.clone(),
                rank: *e.rank.current(),
                role,
            })
        })
        .collect();
    let kind = match precinct.kind {
        Some(WallKind::Hedge) => "hedge",
        Some(WallKind::Palisade | WallKind::Ditch | WallKind::Earthwork) => "palisade",
        Some(WallKind::Wall | WallKind::Bastioned) | None => "wall",
    };
    let purpose = match precinct.purpose {
        Purpose::Castle => "castle",
        Purpose::Citadel => "citadel",
        Purpose::Town | Purpose::Camp => "",
    };
    WorksInputs {
        path,
        gates,
        land,
        banks,
        gate_streets,
        streets,
        kind,
        style: precinct.style.clone(),
        purpose,
        population,
        predicted_widths: context.rank_widths.map(|w| w * 1.1),
        arterial: context.arterial,
        dwelling: context.dwelling,
        event: raise_event(precinct, precinct.kind.unwrap_or(WallKind::Wall)).key(),
    }
}

/// Classic's street role of an edge class, or `None` for what is not a street.
fn street_role(class: EdgeClass) -> Option<&'static str> {
    match class {
        EdgeClass::RegionalRoad => Some("regional"),
        EdgeClass::HarbourRoad => Some("harbour"),
        EdgeClass::CastleRoad => Some("castle"),
        EdgeClass::Street | EdgeClass::Lane | EdgeClass::Stairs => Some("street"),
        EdgeClass::Bridge => Some("bridge"),
        EdgeClass::Quay => Some("quay"),
        _ => None,
    }
}

/// The segment of a closed path nearest `p`, and the distance to it.
fn segment_of(path: &[Point], p: Point) -> (usize, f64) {
    (0..path.len().saturating_sub(1))
        .map(|k| (k, g::distance(p, path[k], path[k + 1]).0))
        .min_by(|a, b| a.1.total_cmp(&b.1))
        .unwrap_or((0, f64::INFINITY))
}

/// Arc position of `p` along a path, in metres from its start.
fn arc_of(path: &[Point], p: Point) -> f64 {
    let (k, _) = segment_of(path, p);
    let before: f64 = path[..=k].windows(2).map(|w| w[0].distance(w[1])).sum();
    before + path[k].distance(p).min(path[k].distance(path[k + 1]))
}

/// Households outside the standing walls at a date, for the loop's outside-share check.
pub fn outside_share(inside: f64, outside: f64) -> f64 {
    let total = inside + outside;
    if total <= 0.0 { 0.0 } else { outside / total }
}

/// Clock helper for the raise: the date's households as inhabitants, rounded down.
pub fn inhabitants(clock: Clock, household_size: f64) -> u32 {
    (clock.households() * household_size)
        .floor()
        .clamp(0.0, f64::from(u32::MAX)) as u32
}
