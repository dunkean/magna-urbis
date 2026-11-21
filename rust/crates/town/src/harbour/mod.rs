//! Harbours: the front a town uses, the harbour road to it, the quay with its landings, and the
//! piers, moles and basin added as the town grows. Classic's harbour planner
//! (`core/src/urban/macroplan/harbour.rs`) is the reference for the result: one continuous quay on
//! the waterline between the water and the first row of lots, sea fronts before river fronts,
//! nearest the centre first, `quayPerSqrtPop`·√P long at most, a landing street about every
//! 120 m, never behind a bank street; piers, moles and basins at their thresholds.
//!
//! Every function reads the graph, the survey and the specs and returns journal operations or
//! plain results; only the journal writes the graph.
//!
//! # Integration
//!
//! The growth loop (`growth/`) keeps an `Option<FrontChoice>` and an `Option<HarbourState>`.
//!
//! 1. **Survey and charter** (driver `new`): `choose_front(&survey, &charter, &specs.harbour)`
//!    on the survey centred on the focus. `None`: the town has no harbour.
//! 2. **Found** (`Driver::found`, inside the `Found` stage, after `armature::place_focus`): when
//!    the choice is not `at_focus`, `harbour_road(&survey, focus, &choice, &specs.harbour)`; with
//!    `Some(path)`, `lay_harbour_road(&mut stage, &found_key, &path, &focus_node_key,
//!    &specs.harbour)` (the `Found` event's key, and the key of the focus node: `armature::
//!    focus_key()`, or the node `place_focus` joined, `graph.node(armature::focus_node(..))`).
//!    `None` from either: no distant harbour, the choice is dropped, and the warning `"No
//!    harbour — no road (Pas de port — pas de route)"`. The road is a main chain: the integration
//!    adds it to the armature's arms only if it should be prolonged; it ends at the water.
//! 3. **Cost field** (`Driver::cost_field`): append `cost_lines(graph, &specs.growth)` to
//!    `armature::cost_lines` (the harbour road and the quay carry traffic; `armature::cost_lines`
//!    leaves both out), and lower every cell's cost by `discount.at(cell.position)`, floored at
//!    zero, where `discount = front_discount(&choice, &specs.harbour, slope)` and `slope` is the
//!    cheapest multiplier of the field (`specs.growth.regional_road_cost.min(axis_cost)`): with
//!    that slope the discounted land stays connected to the centre. The survey's
//!    `recompute_costs` takes paths only; the survey lot or the integration adds the discount
//!    (`CostField` after propagation, before the cell order is sorted).
//! 4. **Dated events, harbour step** (design 3.2, step 5, after promotions and road fates,
//!    before walls), after every quarter commit and ageing step:
//!    - while `state` is `None`: when the choice is `at_focus` and the housed population reaches
//!      `specs.harbour.thresholds.landing`, or when the open land of the ring just laid reaches
//!      the front (`opened(&choice, graph, &specs.harbour)`), apply `EventKind::OpenHarbour { front:
//!      choice.index }` with `open_harbour(&writer, at, &event_key, &survey, &choice,
//!      &specs.harbour, inhabitants)`. `None`: try again at the next step.
//!    - once open: apply `EventKind::ExtendHarbour { front, step: state.extensions + 1,
//!      quay_length: quay_length(&specs.harbour, inhabitants) }` with `extend_harbour(&writer,
//!      at, &event_key, &survey, &state, &specs.harbour, &phase.harbour_works, inhabitants)`
//!      whenever `extension_due(&state, &specs.harbour, &phase.harbour_works, inhabitants)`.
//!      `None` (nothing could be laid): the event is not applied.
//!    - after either event is applied, and after a recorded one is replayed on resume, rebuild
//!      the state: `state = HarbourState::read(graph, journal, choice.clone(), &specs.harbour)`.
//!      The state is read from the graph and journal only, so a resumed town gets the same.
//! 5. **Rings**: an apron face (`FaceKind::Apron`, the strip between the quay and the town) is
//!    town land: `armature::in_town` must count it, so that the next ring's boundary does not run
//!    through it, and the sector lattice should not reopen it.
//! 6. **Finish**: `port_quarters(graph, &driver.quarters, &state)` are the port districts;
//!    `export_quays(graph, &state)` lists the quay, piers and moles as classic streets (roles
//!    `quay`, `pier`, `landing`, `mole`). The adapter (`town_adapter/layout.rs`) leaves
//!    `EdgeClass::Quay` edges out of its own street list and pushes these instead, then runs
//!    classic's `macroplan::harbour::platforms(layout, physical_surface)`, which fills
//!    `structure.quays` from them, before `harbour_furniture::furnish`; the port district role
//!    goes to the districts of the port quarters. The harbour road is exported by the adapter as
//!    `port-road` already.
//! 7. **Specs**: `HarbourSpec::works` (`spec::HarbourWorksSpec`) is new. The literals of
//!    `HarbourSpec` in core's `town_adapter/specs.rs::harbour_spec` and in
//!    `growth/tests.rs::specs` need the field: in core `works: HarbourWorksSpec { port_town:
//!    harbour::port_town(cfg), quay_width, pier_spacing and pier_length from
//!    harbour::params(culture), port_factor: 1.5 for a harbour archetype or a port function,
//!    ..Default::default() }`, in the test `works: Default::default()`.
//! 8. **Regional placement** runs before `Found` and before the clock steps in design 3.2.
//!    After placing a port-capable town, core calls `claimable_front(terrain, center,
//!    &survey_spec, &works_spec)` with `works_spec.port_town = true`, and keeps the landing's
//!    disc and the straight centre-to-landing corridor clear of later automatic sites.
//!    Pass the reservation's landing and port intent into the growth request. In step 1
//!    above, after resolving the charter and final survey, call `front_at_landing(&survey,
//!    charter.focus.position, reserved_landing, &specs.harbour.works)`. Use that `FrontChoice`
//!    for the `Found` road and the dated harbour events in design 3.2. `None` leaves the
//!    harbour unopened. Requests without a reservation use `choose_front`. Include the
//!    built harbour and its road in the town claim at finish.
//!
//! The landing threshold of a town founded on its front, the ring that reaches a distant
//! front, and the dates of works are all clock values, so the prefix property holds: the
//! harbour's events depend on the graph, the survey and the housed population only.

mod export;
mod line;
mod quay;
mod road;
#[cfg(test)]
mod tests;
mod works;

use std::collections::HashSet;

use magna_urbis_geom::{Point, interior_point, simplify, surface::TerrainView};

pub use export::{HarbourStreet, export_quays, work_role};
pub use quay::{extend_harbour, extension_due, open_harbour, opened, quay_length};
pub use road::{harbour_road, lay_harbour_road};

use crate::armature::CostLine;
use crate::charter::Charter;
use crate::graph::{EdgeClass, Graph, Key, Level, NodeKind};
use crate::growth::QuarterRecord;
use crate::journal::{EventKind, Journal};
use crate::spec::{FoundingFocusKind, GrowthSpec, HarbourSpec, HarbourWorksSpec, SurveySpec};
use crate::survey::{BankId, Survey};

/// Key segment tags of harbour elements, after the graph's own (`graph::tag`).
mod tag {
    pub const QUAY: u32 = 32;
    pub const LANDING: u32 = 33;
    pub const PIER: u32 = 34;
    pub const MOLE: u32 = 35;
    pub const BASIN: u32 = 36;
    pub const ROAD: u32 = 37;
}

/// Effective metres a fully exposed front costs against a fully sheltered one, and per unit of
/// mean ground grade along it, when fronts are compared with their distance over land.
const FRONT_WEIGHT: f64 = 500.0;
/// Tolerance in metres of the quay line's simplification.
const LINE_TOLERANCE: f64 = 0.4;

/// The front a harbour town uses.
#[derive(Clone, Debug, PartialEq)]
pub struct FrontChoice {
    /// Position of the front in `Survey::fronts`.
    pub index: u32,
    /// Survey component of its bank.
    pub bank_id: BankId,
    /// The quay's centre line: the shore offset inland by half a quay width, so that the quay's
    /// outer edge is the waterline; land on its left.
    pub line: Vec<Point>,
    /// Station on `line` of the harbour's landing, the point nearest the focus (metres).
    pub landing_station: f64,
    /// The landing.
    pub landing: Point,
    /// Whether the landing is at the founding focus (no harbour road); otherwise the harbour is
    /// distant and a harbour road joins it to the focus.
    pub at_focus: bool,
}

/// The harbour as the graph holds it, rebuilt from the graph and the journal after each
/// harbour event.
#[derive(Clone, Debug, PartialEq)]
pub struct HarbourState {
    /// Its front.
    pub front: FrontChoice,
    /// Stations of `front.line` the quay covers, low then high.
    pub span: [f64; 2],
    /// Keys of the quay's end nodes, at the low and the high station.
    pub ends: [Key; 2],
    /// Landing nodes on the quay, with their stations, in station order.
    pub landings: Vec<(f64, Key)>,
    /// Positions on the pier lattice (`works.pierSpacing` along the line) of the piers built.
    pub piers: Vec<u32>,
    /// Whether the pair of moles is built.
    pub moles: bool,
    /// The basin face between the moles, once enclosed.
    pub basin: Option<Key>,
    /// `ExtendHarbour` events applied so far.
    pub extensions: u32,
}

impl HarbourState {
    /// The harbour on `front` as `graph` and `journal` hold it; `None` before `OpenHarbour`.
    pub fn read(
        graph: &Graph,
        journal: &Journal,
        front: FrontChoice,
        spec: &HarbourSpec,
    ) -> Option<Self> {
        let steps = graph.faces_along_chain(&quay_chain(front.index));
        if steps.is_empty() {
            return None;
        }
        let mut degree: std::collections::BTreeMap<crate::graph::NodeId, u32> = Default::default();
        for step in &steps {
            for n in graph.edge(step.edge).nodes {
                *degree.entry(n).or_default() += 1;
            }
        }
        let station =
            |n: crate::graph::NodeId| line::project(&front.line, graph.node(n).position).0;
        let by_station = |a: &crate::graph::NodeId, b: &crate::graph::NodeId| {
            station(*a)
                .total_cmp(&station(*b))
                .then_with(|| graph.node(*a).key.cmp(&graph.node(*b).key))
        };
        let mut ends: Vec<_> = degree
            .iter()
            .filter(|&(_, &d)| d == 1)
            .map(|(&n, _)| n)
            .collect();
        if ends.len() < 2 {
            ends = degree.keys().copied().collect();
        }
        ends.sort_by(by_station);
        let (low, high) = (*ends.first()?, *ends.last()?);
        let mut landings: Vec<(f64, Key)> = degree
            .keys()
            .copied()
            .filter(|&n| landing_node(graph, n))
            .map(|n| (station(n), graph.node(n).key.clone()))
            .collect();
        landings.sort_by(|a, b| a.0.total_cmp(&b.0).then_with(|| a.1.cmp(&b.1)));
        let total = line::length(&front.line);
        let spacing = spec.works.pier_spacing.max(1.0);
        let lattice = (total / spacing).ceil() as u32 + 1;
        let piers = (0..lattice)
            .filter(|&k| {
                !graph
                    .faces_along_chain(&pier_chain(front.index, k))
                    .is_empty()
            })
            .collect();
        let moles = !graph
            .faces_along_chain(&mole_chain(front.index, 0))
            .is_empty();
        let basin = basin_keys(front.index)
            .into_iter()
            .find(|k| graph.face_id(k).is_some_and(|f| graph.face(f).life.live()));
        let extensions = journal
            .events
            .iter()
            .filter(
                |e| matches!(e.kind, EventKind::ExtendHarbour { front: f, .. } if f == front.index),
            )
            .count() as u32;
        Some(Self {
            span: [station(low), station(high)],
            ends: [graph.node(low).key.clone(), graph.node(high).key.clone()],
            landings,
            piers,
            moles,
            basin,
            extensions,
            front,
        })
    }

    /// Length of the quay in metres along its line.
    pub fn length(&self) -> f64 {
        self.span[1] - self.span[0]
    }
}

/// A fixed-length cost discount around a chosen front: land on the front's line costs `slope` ×
/// `length` effective metres less, land `length` metres from it nothing less. Its fall-off is
/// `slope` per metre, so with `slope` the cheapest multiplier of the cost field the discounted
/// costs stay reachable from the centre in increasing order.
#[derive(Clone, Debug, PartialEq)]
pub struct FrontDiscount {
    /// The stretch of the front the discount is measured from.
    pub line: Vec<Point>,
    /// Reach of the discount in metres.
    pub length: f64,
    /// Effective metres of discount per metre of reach.
    pub slope: f64,
}

impl FrontDiscount {
    /// The discount at `p`, in effective metres.
    pub fn at(&self, p: Point) -> f64 {
        if self.line.len() < 2 {
            return 0.0;
        }
        let d = line::project(&self.line, p).1;
        self.slope * (self.length - d).max(0.0)
    }
}

/// The front a harbour town uses: the charter's front when the harbour is its founding focus;
/// otherwise, for a port town (`works.portTown`), the best front reachable over land by distance
/// over land, shelter and gentleness. `None`: no harbour.
pub fn choose_front(survey: &Survey, charter: &Charter, spec: &HarbourSpec) -> Option<FrontChoice> {
    let focus = charter.focus.position;
    if charter.focus.kind == FoundingFocusKind::HarbourFront {
        // The charter's survey may have a different centre and different front indices.
        let at = charter.harbour_front.map_or(focus, |h| h.position);
        let index = front_near(survey, at, 2.0 * survey.cell_size())?;
        return make_choice(survey, index, focus, focus, &spec.works);
    }
    choose_port_front(survey, focus, &spec.works)
}

/// Locate the reserved front in a new survey and keep its landing near the reserved position.
pub fn front_at_landing(
    survey: &Survey,
    focus: Point,
    landing: Point,
    works: &HarbourWorksSpec,
) -> Option<FrontChoice> {
    let reach = 2.0 * survey.cell_size() + 0.5 * works.quay_width;
    let index = front_near(survey, landing, reach)?;
    make_choice(survey, index, focus, landing, works)
}

fn front_near(survey: &Survey, at: Point, reach: f64) -> Option<usize> {
    survey
        .fronts()
        .iter()
        .enumerate()
        .map(|(i, f)| (i, line::project(&f.shore, at).1))
        .filter(|&(_, d)| d <= reach)
        .min_by(|a, b| a.1.total_cmp(&b.1).then(a.0.cmp(&b.0)))
        .map(|(i, _)| i)
}

/// Survey the front a port can claim from the regional placement centre before roads and charter.
/// The distant front must admit a harbour road at the culture's street grade.
pub fn claimable_front(
    terrain: &dyn TerrainView,
    center: Point,
    survey_spec: &SurveySpec,
    works: &HarbourWorksSpec,
) -> Option<FrontChoice> {
    if !works.port_town || survey_spec.harbour_reach <= 0.0 {
        return None;
    }
    // Sample past the search radius so the last shore segment has wet and dry neighbours.
    let reach = survey_spec.harbour_reach + 2.0 * survey_spec.cell_size;
    let survey = Survey::new(terrain, center, reach, None, &[], survey_spec).ok()?;
    let choice = choose_port_front(&survey, center, works)?;
    if !choice.at_focus {
        road::road_to_landing(&survey, center, choice.landing, works.road_grade)?;
    }
    Some(choice)
}

fn choose_port_front(survey: &Survey, focus: Point, works: &HarbourWorksSpec) -> Option<FrontChoice> {
    if !works.port_town {
        return None;
    }
    let index = survey
        .fronts()
        .iter()
        .enumerate()
        .filter_map(|(i, front)| {
            let land = front.land_distance?;
            let grade = mean_grade(survey, &front.shore);
            let score = land - works.shelter_weight * FRONT_WEIGHT * front.shelter_score
                + FRONT_WEIGHT * grade;
            Some((i, score))
        })
        .min_by(|a, b| a.1.total_cmp(&b.1).then(a.0.cmp(&b.0)))
        .map(|(i, _)| i)?;
    make_choice(survey, index, focus, focus, works)
}

fn make_choice(
    survey: &Survey,
    index: usize,
    focus: Point,
    landing_near: Point,
    works: &HarbourWorksSpec,
) -> Option<FrontChoice> {
    let front = &survey.fronts()[index];
    if front.shore.len() < 2 {
        return None;
    }
    let half = works.quay_width * 0.5;
    let line = simplify(&line::offset(&front.shore, half), LINE_TOLERANCE, |_| false);
    let (landing_station, _) = line::project(&line, landing_near);
    let landing = line::point_at(&line, landing_station).0;
    Some(FrontChoice {
        index: index as u32,
        bank_id: front.bank_id,
        at_focus: landing.distance(focus) <= works.attached_reach,
        line,
        landing_station,
        landing,
    })
}

/// The cost discount around a chosen front, its fall-off `slope` per metre (the cheapest
/// multiplier of the cost field).
pub fn front_discount(choice: &FrontChoice, spec: &HarbourSpec, slope: f64) -> FrontDiscount {
    let length = spec.works.front_discount.max(0.0);
    let total = line::length(&choice.line);
    let [from, to] = line::centred(total, choice.landing_station, 2.0 * length);
    FrontDiscount {
        line: if to > from {
            line::sub_path(&choice.line, from, to)
        } else {
            choice.line.clone()
        },
        length,
        slope: slope.clamp(0.0, 1.0),
    }
}

/// The harbour's lines in the cost field: the harbour road at an axis's weight, the quay at a
/// street's. `armature::cost_lines` leaves both classes out.
pub fn cost_lines(graph: &Graph, spec: &GrowthSpec) -> Vec<CostLine> {
    graph
        .live_edges()
        .filter(|&e| graph.edge(e).level == Level::Ground)
        .filter_map(|e| {
            let edge = graph.edge(e);
            let multiplier = match edge.class.current() {
                EdgeClass::HarbourRoad => spec.axis_cost,
                EdgeClass::Quay if *edge.rank.current() == QUAY_RANK => spec.street_cost,
                _ => return None,
            };
            Some(CostLine {
                points: edge.polyline.clone(),
                multiplier,
                crossings: false,
            })
        })
        .collect()
}

/// The harbour's nodes: those of its quay, landing streets, piers and moles.
pub fn harbour_nodes(graph: &Graph, state: &HarbourState) -> HashSet<Key> {
    let front = state.front.index;
    let mut chains = vec![
        quay_chain(front),
        landing_chain(front),
        mole_chain(front, 0),
        mole_chain(front, 1),
    ];
    chains.extend(state.piers.iter().map(|&k| pier_chain(front, k)));
    let mut nodes = HashSet::new();
    for chain in &chains {
        for step in graph.faces_along_chain(chain) {
            for n in graph.edge(step.edge).nodes {
                nodes.insert(graph.node(n).key.clone());
            }
        }
    }
    nodes
}

/// The port quarters: those that hang on a harbour node (their station's host) or whose land
/// touches one (a node on the walk of one of their live faces). The lineage of the graph says
/// it; no geometric search.
pub fn port_quarters(graph: &Graph, quarters: &[QuarterRecord], state: &HarbourState) -> Vec<Key> {
    let nodes = harbour_nodes(graph, state);
    quarters
        .iter()
        .filter(|q| {
            nodes.contains(&q.station.host)
                || q.faces.iter().filter_map(|k| graph.face_id(k)).any(|f| {
                    graph.face(f).life.live()
                        && graph
                            .walks(f)
                            .iter()
                            .flatten()
                            .any(|&h| nodes.contains(&graph.node(graph.half(h).origin).key))
                })
        })
        .map(|q| q.key.clone())
        .collect()
}

/// Quay rank of the quay itself; moles, piers and landing stages rank below it.
pub(crate) const QUAY_RANK: u8 = 1;
pub(crate) const MOLE_RANK: u8 = 2;
pub(crate) const PIER_RANK: u8 = 3;
pub(crate) const STAGE_RANK: u8 = 4;

/// The chain of the quay on front `front`, from its opening through every extension.
pub fn quay_chain(front: u32) -> Key {
    EventKind::OpenHarbour { front }.key().child(tag::QUAY, &[])
}

/// The chain shared by the landing streets of front `front`.
pub fn landing_chain(front: u32) -> Key {
    quay_chain(front).child(tag::LANDING, &[])
}

/// The chain of the pier at position `k` of the pier lattice of front `front`.
pub fn pier_chain(front: u32, k: u32) -> Key {
    quay_chain(front).child(tag::PIER, &[k])
}

/// The chain of mole `side` (0 at the quay's low end, 1 at its high end) of front `front`.
pub fn mole_chain(front: u32, side: u32) -> Key {
    quay_chain(front).child(tag::MOLE, &[side])
}

/// The two names given to the faces either side of the basin mouth; the basin takes one.
fn basin_keys(front: u32) -> [Key; 2] {
    [0, 1].map(|side| quay_chain(front).child(tag::BASIN, &[side]))
}

/// The chain of the harbour road laid by the founding event `found`.
pub fn road_chain(found: &Key) -> Key {
    found.child(tag::ROAD, &[])
}

/// Whether a quay node is a landing: of landing kind, or met by a street.
fn landing_node(graph: &Graph, n: crate::graph::NodeId) -> bool {
    *graph.node(n).kind.current() == NodeKind::Landing
        || graph.arms(n, Level::Ground).iter().any(|h| {
            matches!(
                graph.edge(h.edge()).class.current(),
                EdgeClass::Street
                    | EdgeClass::Lane
                    | EdgeClass::Stairs
                    | EdgeClass::RegionalRoad
                    | EdgeClass::HarbourRoad
                    | EdgeClass::CastleRoad
            )
        })
}

/// Mean ground grade of the surveyed dry cells along a shore, one sample every cell.
fn mean_grade(survey: &Survey, shore: &[Point]) -> f64 {
    let total = line::length(shore);
    let count = (total / survey.cell_size()).ceil().max(1.0) as usize;
    let grades: Vec<f64> = (0..=count)
        .filter_map(|k| {
            let p = line::point_at(shore, total * k as f64 / count as f64).0;
            survey.cell_at(p).filter(|c| !c.wet).map(|c| c.slope)
        })
        .collect();
    if grades.is_empty() {
        0.0
    } else {
        grades.iter().sum::<f64>() / grades.len() as f64
    }
}

/// An interior point of a face's outline, if it has one.
fn face_point(graph: &Graph, face: crate::graph::FaceId) -> Option<Point> {
    graph.outline(face).map(|s| interior_point(&s))
}
