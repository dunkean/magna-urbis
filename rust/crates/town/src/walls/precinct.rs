//! `SurveyPrecinct`: a precinct's land, its trace, its clearance and water side, then the
//! operations that draw it (design 5.2): the precinct chain, the gates where the armature crosses
//! it, the wall street just inside it, the curtain strip as works faces, and the ditch reserve.

use magna_urbis_geom::{self as g, Point, Shape, surface::TerrainView};

use super::castle::{self, Castle};
use super::clearance::{Obstacle, pull_back};
use super::geometry::{buffer, largest};
use super::growth_regime::{Extension, extension};
use super::insert::{Line, Stroke, insert_between, insert_loop, on_ring, open_path};
use super::land::{cheapest_land, land_for};
use super::water_side::{HarbourSide, flow_normal_spans, seat_water_plan, water_plan};
use super::{Candidate, TraceFamily, Traced, trace};
use crate::charter::{Charter, PlannedPhase};
use crate::graph::{Clock, EdgeClass, EdgeId, FaceKind, Graph, Key, Level, NodeKind};
use crate::journal::{EventKind, Op, Stage, Writer};
use crate::spec::{DefensiveIntent, PrecinctSpec, WallKind, WallSpec};
use crate::survey::{CostField, Survey};

/// Below this many inhabitants a walled settlement keeps a gate on each of its armature roads
/// (classic's walled village, `fortification_gates.rs`).
const VILLAGE: f64 = 2_000.0;
/// Classic's gate spacing: a share of an even share of the circuit, within bounds (metres).
const GATE_SPACING_SHARE: f64 = 0.35;
const GATE_SPACING: (f64, f64) = (40.0, 250.0);
/// Faces smaller than this (square metres) are ignored when typing works faces.
const MIN_FACE: f64 = 4.0;

/// What a circuit encloses.
#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub enum Purpose {
    /// The town's land.
    Town,
    /// A castle's bailey.
    Castle,
    /// A citadel astride the town line.
    Citadel,
    /// A fortified camp.
    Camp,
}

/// The road a gate stands on, in gate priority order.
#[derive(Clone, Copy, Debug, PartialEq, Eq, PartialOrd, Ord)]
pub enum Route {
    Regional,
    Harbour,
    Castle,
    Main,
    Street,
}

/// A gate of a circuit.
#[derive(Clone, Debug, PartialEq)]
pub struct Gate {
    pub node: Key,
    pub position: Point,
    /// The road through it; `None` for a water gate.
    pub route: Option<Route>,
    pub kind: NodeKind,
}

/// A surveyed precinct, as the growth loop keeps it from its survey to its raise and after.
#[derive(Clone, Debug)]
pub struct Precinct {
    /// Position in the town's sequence of circuits, from 0.
    pub index: u32,
    pub purpose: Purpose,
    /// The precinct chain: a loop, or the line of a lobe between two points of the standing
    /// circuit.
    pub chain: Key,
    /// The street along its inside.
    pub wall_street: Option<Key>,
    /// The closed circuit, counter-clockwise; a lobe's own ring.
    pub outline: Shape,
    /// Everything walled once this precinct stands: its outline joined to those before it.
    pub enclosed: Shape,
    /// The land it opens: inside the wall street, without a castle's bailey.
    pub land: Shape,
    /// Land gates in path order, then water gates.
    pub gates: Vec<Gate>,
    /// Terminal towers of an open front.
    pub terminals: Vec<Point>,
    pub family: TraceFamily,
    pub style: String,
    /// Wall kind of the raise, `None` when the phase allows no wall.
    pub kind: Option<WallKind>,
    pub curtain_width: f64,
    pub corners: Vec<Point>,
    pub salients: Vec<Point>,
    /// Sides lying on the standing circuit (a lobe or a castle join).
    pub shared: Vec<(Point, Point)>,
    /// The precinct this one extends as a lobe.
    pub attached_to: Option<u32>,
    /// Whether the castle circuit is a fixed arc of this precinct.
    pub joins_castle: bool,
    /// Survey date.
    pub surveyed: Clock,
    /// Households it is sized for.
    pub sized_for: f64,
    /// Raise date, once raised.
    pub raised: Option<Clock>,
}

/// The predicate the growth loop opens sectors by while a precinct is open: only its land.
#[derive(Clone, Debug)]
pub struct OpenSectors {
    /// The land that opens.
    pub land: Shape,
    /// Parts of it that stay closed (a bailey, a camp's common).
    pub closed: Vec<Shape>,
}

impl OpenSectors {
    /// Whether a sector with this outline opens: its interior point lies on the land.
    pub fn admits(&self, outline: &Shape) -> bool {
        let p = g::interior_point(outline);
        g::contains(&self.land, p) && !self.closed.iter().any(|c| g::contains(c, p))
    }

    /// A ring's land cut to the precinct's, so that its boundary arcs end on the wall street.
    pub fn clip(&self, outline: &Shape) -> Vec<Shape> {
        let inside = g::intersection(outline, &self.land);
        if self.closed.is_empty() {
            return inside;
        }
        inside
            .iter()
            .flat_map(|s| g::difference_many(s, &self.closed))
            .collect()
    }
}

/// A surveyed precinct and the operations of its event.
#[derive(Clone, Debug)]
pub struct PrecinctPlan {
    pub precinct: Precinct,
    /// Operations of the `SurveyPrecinct` event; empty when laid on a caller's stage.
    pub ops: Vec<Op>,
    pub open_sectors: OpenSectors,
    /// Land kept closed outside the curtain: the ditch and glacis band.
    pub reserves: Vec<Shape>,
    /// Nodes where a street crosses the precinct without a gate: the street ends at the wall.
    pub closed_crossings: Vec<Key>,
    /// Raised at once (a grown regime's first precinct, a castle, a camp).
    pub raise_now: bool,
    pub warnings: Vec<String>,
}

/// What a precinct survey reads besides the graph, the survey and the charter.
#[derive(Clone, Copy)]
pub struct PrecinctSite<'a> {
    pub terrain: &'a dyn TerrainView,
    pub wall: &'a WallSpec,
    pub spec: &'a PrecinctSpec,
    /// The ring's frozen cost field.
    pub costs: &'a CostField,
    /// Inhabitants per household (the growth spec's).
    pub household_size: f64,
    pub neighbour_claims: &'a [Shape],
    /// Chains of the main axes, whose crossings are main gates.
    pub main_chains: &'a [Key],
    /// The harbour on this precinct's water side, decided before it.
    pub harbour: Option<&'a HarbourSide>,
    /// The founding castle, when the town has one.
    pub castle: Option<&'a Castle>,
}

/// The key of the event surveying precinct `index`, which keys its edges and nodes.
pub fn precinct_key(index: u32) -> Key {
    EventKind::SurveyPrecinct {
        precinct: index,
        step: 0.0,
    }
    .key()
}

/// Curtain width in metres by wall kind (starting values, to tune on sheets).
pub fn curtain_width(kind: Option<WallKind>) -> f64 {
    match kind {
        Some(WallKind::Hedge) => 1.5,
        Some(WallKind::Ditch | WallKind::Palisade) => 1.0,
        Some(WallKind::Earthwork) => 5.0,
        Some(WallKind::Bastioned) => 6.0,
        Some(WallKind::Wall) | None => 3.0,
    }
}

/// Width in metres of the ditch and glacis band kept outside the curtain (starting values).
pub fn ditch_width(kind: Option<WallKind>) -> f64 {
    match kind {
        Some(WallKind::Hedge) | None => 0.0,
        Some(WallKind::Palisade) => 3.0,
        Some(WallKind::Ditch) => 4.0,
        Some(WallKind::Earthwork) => 6.0,
        Some(WallKind::Wall) => 8.0,
        Some(WallKind::Bastioned) => 20.0,
    }
}

/// Main gates for `inhabitants`: classic's `gate_budget`, 2 + sqrt(P / 1500) rounded, 2 to 8;
/// a castle or a citadel keeps two.
pub fn gate_budget(inhabitants: f64, purpose: Purpose) -> usize {
    if matches!(purpose, Purpose::Castle | Purpose::Citadel) {
        return 2;
    }
    (2.0 + (inhabitants.max(0.0) / 1500.0).sqrt())
        .round()
        .clamp(2.0, 8.0) as usize
}

/// Survey the next precinct at `clock`, `housed` households being housed. The founding precinct
/// of an enclosed charter is sized for the founding cohort; a later one for the phase's step
/// times `housed`, at the phase's compact density, and at least `min_growth` times the land
/// walled before. Its land is the cheapest open land around what is walled (or the focus); it
/// extends `existing` as a lobe or a concentric circuit per the phase's habit, and joins the
/// castle circuit when nothing unopenable lies between them. `None` when the phase draws no
/// precinct or no line can be drawn.
#[allow(clippy::too_many_arguments)]
pub fn survey_precinct(
    writer: &Writer,
    survey: &Survey,
    charter: &Charter,
    phase: &PlannedPhase,
    existing: Option<&Precinct>,
    housed: Clock,
    clock: Clock,
    site: &PrecinctSite<'_>,
) -> Option<PrecinctPlan> {
    let draw = charter.draws.phases.get(&phase.spec.name)?;
    let density = if phase.spec.compact_density > 0.0 {
        phase.spec.compact_density
    } else {
        site.spec.enclosed_density
    };
    let founding =
        existing.is_none() && charter.defensive_intent == DefensiveIntent::EnclosedFromFounding;
    let households = if founding {
        f64::from(charter.founding_cohort) / site.household_size.max(1e-9)
    } else {
        draw.precinct_step.max(1.0) * housed.households()
    };
    let mut area = land_for(households, site.household_size, density);
    if let Some(old) = existing {
        area = area.max(g::area(&old.enclosed) * site.spec.min_growth);
    }
    let land = cheapest_land(survey, site.costs, existing.map(|p| &p.enclosed), area)?;
    let inhabitants = households * site.household_size;
    let lobe = existing.is_some()
        && extension(draw.extension_habit, inhabitants, site.spec) == Extension::Lobe;
    let kind = draw.wall_kind;
    let mut candidate = Candidate::new(land.outline);
    candidate.style = draw.wall_style.as_deref();
    candidate.small = inhabitants < VILLAGE;
    candidate.curtain_width = curtain_width(kind);
    candidate.attach_to = if lobe {
        existing.map(|p| &p.enclosed)
    } else {
        None
    };
    let mut traced = trace(&candidate, site.terrain, site.wall);
    let attached = existing.filter(|_| !traced.shared.is_empty());
    let mut standing = attached.map(|p| p.enclosed.clone());
    let mut joins_castle = false;
    if standing.is_none()
        && let Some(c) = site.castle
        && castle::joins(survey, site.terrain, &traced.outline, c)
        && let Some(wrapped) = castle::wrap(&traced.outline, c)
    {
        traced.outline = wrapped;
        standing = Some(c.outline.clone());
        joins_castle = true;
    }
    let circuit = Circuit {
        index: existing.map_or(0, |p| p.index + 1),
        purpose: Purpose::Town,
        traced,
        standing,
        kind,
        class: EdgeClass::Precinct,
        wall_street: true,
        sized_for: households,
        clock,
        attached_to: attached.map(|p| p.index),
        joins_castle,
        enclosed_before: existing.map(|p| p.enclosed.clone()),
        closed: site
            .castle
            .filter(|_| joins_castle)
            .map(|c| vec![c.outline.clone()])
            .unwrap_or_default(),
    };
    let mut stage = writer.stage(clock);
    let mut plan = lay(&mut stage, survey, site, circuit)?;
    if joins_castle
        && let Some(c) = site.castle
        && let Some(gate) = castle::field_gate(&mut stage, c, &plan.precinct.outline)
    {
        plan.precinct.gates.push(gate);
    }
    plan.ops = stage.into_ops();
    Some(plan)
}

/// A traced circuit to draw.
pub(super) struct Circuit {
    pub index: u32,
    pub purpose: Purpose,
    pub traced: Traced,
    /// The standing circuit the line runs from and back to (a lobe's old wall, a castle).
    pub standing: Option<Shape>,
    pub kind: Option<WallKind>,
    /// `Precinct` for a precinct raised when full, `Wall` for a circuit raised at once.
    pub class: EdgeClass,
    pub wall_street: bool,
    pub sized_for: f64,
    pub clock: Clock,
    pub attached_to: Option<u32>,
    pub joins_castle: bool,
    pub enclosed_before: Option<Shape>,
    /// Land inside that does not open.
    pub closed: Vec<Shape>,
}

/// Clear, settle and draw `circuit` on `stage`: the line, its gates, its water side, the wall
/// street, the works faces. The returned plan holds no operations: they are in the stage.
pub(super) fn lay(
    stage: &mut Stage,
    survey: &Survey,
    site: &PrecinctSite<'_>,
    circuit: Circuit,
) -> Option<PrecinctPlan> {
    let event = precinct_key(circuit.index);
    let curtain = curtain_width(circuit.kind);
    let mut warnings = circuit.traced.warnings.clone();
    let standing = circuit.standing.as_ref();
    let fixed = |p: Point| standing.is_some_and(|s| on_ring(s, p));

    // Neighbours and the harbour: pulled back locally, never dropped.
    let mut obstacles: Vec<Obstacle> = site
        .neighbour_claims
        .iter()
        .map(|c| Obstacle::new(c.clone(), site.spec.neighbour_clearance))
        .collect();
    if let Some(h) = site.harbour {
        obstacles.extend(h.obstacles(site.spec, curtain));
    }
    let anchor = g::interior_point(&circuit.traced.outline);
    let cleared = pull_back(&circuit.traced.outline.outer, anchor, &obstacles, fixed);
    if cleared.blocked > 0 {
        warnings.push("Wall: neighbour too close (Enceinte : voisin trop proche)".into());
    }
    let (ring, spans) = flow_normal_spans(&cleared.ring, site.terrain, survey, fixed);
    let outline = g::normalized(Shape {
        outer: ring,
        holes: vec![],
    });
    let ring = outline.outer.clone();

    let mut rank = 0;
    let stroke = Stroke {
        class: circuit.class,
        rank: 0,
        width: curtain,
    };
    let line = match standing.and_then(|s| open_path(&ring, s)) {
        Some(path) => insert_between(stage, &event, &mut rank, &path, stroke),
        None => insert_loop(stage, &event, &mut rank, &ring, stroke),
    };
    let line = line?;
    let inhabitants = circuit.sized_for * site.household_size;
    let (mut gates, closed_crossings) = choose_gates(
        stage,
        &line,
        site,
        inhabitants,
        circuit.purpose,
        standing.is_none(),
    );
    let water = water_plan(&ring, site.terrain, &spans, site.harbour);
    for (node, position) in seat_water_plan(stage, &line.chain, &water, &event) {
        gates.push(Gate {
            node,
            position,
            route: None,
            kind: NodeKind::WaterGate,
        });
    }

    let mut land = outline.clone();
    let mut wall_street = None;
    if circuit.wall_street {
        let inset = curtain * 0.5 + site.spec.wall_street_width * 0.5 + 0.5;
        if let Some(inner) = largest(buffer(&outline, -inset)) {
            let inner = g::normalized(Shape {
                outer: g::unneedled(&inner.outer, 0.05),
                holes: vec![],
            });
            let street = Stroke {
                class: EdgeClass::Street,
                rank: 2,
                width: site.spec.wall_street_width,
            };
            match insert_loop(stage, &event, &mut rank, &inner.outer, street) {
                Some(drawn) => {
                    wall_street = Some(drawn.chain);
                    type_works(stage, &outline, &inner);
                    land = inner;
                }
                None => warnings.push("Wall street not drawn (Rue du rempart non tracée)".into()),
            }
        }
    }

    let ditch = ditch_width(circuit.kind);
    let mut reserves: Vec<Shape> = Vec::new();
    if ditch > 0.0 {
        let mut cuts = vec![outline.clone()];
        cuts.extend(circuit.enclosed_before.iter().cloned());
        for band in buffer(&outline, ditch + curtain * 0.5) {
            reserves.extend(g::difference_many(&band, &cuts));
        }
    }
    let enclosed = match &circuit.enclosed_before {
        Some(before) => joined(before, &outline),
        None => match standing {
            Some(s) => joined(s, &outline),
            None => outline.clone(),
        },
    };
    let precinct = Precinct {
        index: circuit.index,
        purpose: circuit.purpose,
        chain: line.chain.clone(),
        wall_street,
        outline,
        enclosed,
        land: land.clone(),
        gates,
        terminals: water.terminals.clone(),
        family: circuit.traced.family,
        style: circuit.traced.style.clone(),
        kind: circuit.kind,
        curtain_width: curtain,
        corners: circuit.traced.corners.clone(),
        salients: circuit.traced.salients.clone(),
        shared: circuit.traced.shared.clone(),
        attached_to: circuit.attached_to,
        joins_castle: circuit.joins_castle,
        surveyed: circuit.clock,
        sized_for: circuit.sized_for,
        raised: (circuit.class == EdgeClass::Wall).then_some(circuit.clock),
    };
    Some(PrecinctPlan {
        precinct,
        ops: Vec::new(),
        open_sectors: OpenSectors {
            land,
            closed: circuit.closed,
        },
        reserves,
        closed_crossings,
        raise_now: circuit.class == EdgeClass::Wall,
        warnings,
    })
}

/// `a` and `b` joined into one outline: the piece holding `a`'s interior, without holes.
pub(super) fn joined(a: &Shape, b: &Shape) -> Shape {
    let pieces = g::union(&[a.clone(), b.clone()]);
    let inside = g::interior_point(a);
    let best = pieces.iter().find(|s| g::contains(s, inside)).or_else(|| {
        pieces
            .iter()
            .max_by(|x, y| g::area(x).total_cmp(&g::area(y)))
    });
    best.map_or_else(
        || a.clone(),
        |s| Shape {
            outer: s.outer.clone(),
            holes: vec![],
        },
    )
}

/// The road a crossed edge carries.
fn route(graph: &Graph, edge: EdgeId, main_chains: &[Key]) -> Option<Route> {
    let e = graph.edge(edge);
    match e.class.current() {
        EdgeClass::RegionalRoad => Some(Route::Regional),
        EdgeClass::HarbourRoad => Some(Route::Harbour),
        EdgeClass::CastleRoad => Some(Route::Castle),
        EdgeClass::Street | EdgeClass::Lane | EdgeClass::Stairs => {
            if e.chain.as_ref().is_some_and(|c| main_chains.contains(c)) {
                Some(Route::Main)
            } else {
                Some(Route::Street)
            }
        }
        _ => None,
    }
}

/// The gates of a drawn line, decided at once on the armature: every regional road crossing;
/// then harbour, castle and main roads in that order, at most the budget, spaced as classic
/// spaces them; a walled village keeps every armature crossing. The gate nodes take their kind
/// on the stage. Returns the gates in path order and the street crossings left without a gate.
fn choose_gates(
    stage: &mut Stage,
    line: &Line,
    site: &PrecinctSite<'_>,
    inhabitants: f64,
    purpose: Purpose,
    closed: bool,
) -> (Vec<Gate>, Vec<Key>) {
    let graph = stage.graph();
    let total: f64 = line.path.windows(2).map(|w| w[0].distance(w[1])).sum();
    let routes: Vec<Option<Route>> = line
        .hits
        .iter()
        .map(|h| route(graph, h.edge, site.main_chains))
        .collect();
    let mut order: Vec<usize> = (0..line.hits.len())
        .filter(|&i| routes[i].is_some_and(|r| r != Route::Street))
        .collect();
    order.sort_by(|&a, &b| {
        routes[a]
            .cmp(&routes[b])
            .then(line.hits[a].along.total_cmp(&line.hits[b].along))
    });
    let village = inhabitants < VILLAGE && purpose == Purpose::Town;
    let budget = gate_budget(inhabitants, purpose);
    let spacing = if village {
        0.0
    } else {
        (GATE_SPACING_SHARE * total / budget as f64).clamp(GATE_SPACING.0, GATE_SPACING.1)
    };
    let apart = |a: f64, b: f64| {
        let d = (a - b).abs();
        if closed { d.min(total - d) } else { d }
    };
    let mut kept: Vec<usize> = Vec::new();
    for &i in &order {
        if kept.iter().any(|&k| line.nodes[k] == line.nodes[i]) {
            continue;
        }
        let regional = routes[i] == Some(Route::Regional);
        let fits = kept.len() < budget
            && kept
                .iter()
                .all(|&k| apart(line.hits[k].along, line.hits[i].along) >= spacing);
        if regional || village || fits {
            kept.push(i);
        }
    }
    kept.sort_by(|&a, &b| line.hits[a].along.total_cmp(&line.hits[b].along));
    let kind = if purpose == Purpose::Castle {
        NodeKind::CastleGate
    } else {
        NodeKind::Gate
    };
    let gates: Vec<Gate> = kept
        .iter()
        .map(|&i| Gate {
            node: line.nodes[i].clone(),
            position: line.hits[i].point,
            route: routes[i],
            kind,
        })
        .collect();
    let shut: Vec<Key> = (0..line.hits.len())
        .filter(|i| routes[*i].is_some() && !kept.contains(i))
        .map(|i| line.nodes[i].clone())
        .filter(|k| !gates.iter().any(|gate| &gate.node == k))
        .collect();
    for gate in &gates {
        let _ = stage.try_push(vec![Op::SetNodeKind {
            node: gate.node.clone(),
            kind,
        }]);
    }
    (gates, shut)
}

/// Type the faces between the curtain line and the wall street as works.
fn type_works(stage: &mut Stage, outline: &Shape, inner: &Shape) {
    let graph = stage.graph();
    let outside = graph.outside(Level::Ground);
    let b = g::bbox(outline);
    let faces: Vec<Key> = graph
        .live_faces()
        .filter(|&f| f != outside && graph.face(f).level == Level::Ground)
        .filter_map(|f| {
            let shape = graph.outline(f)?;
            let fb = g::bbox(&shape);
            if fb.0 > b.2 || fb.2 < b.0 || fb.1 > b.3 || fb.3 < b.1 || g::area(&shape) < MIN_FACE {
                return None;
            }
            let p = g::interior_point(&shape);
            (g::contains(outline, p) && !g::contains(inner, p)).then(|| graph.face(f).key.clone())
        })
        .collect();
    for face in faces {
        let _ = stage.try_push(vec![Op::SetFaceKind {
            face,
            kind: FaceKind::Works,
        }]);
    }
}
