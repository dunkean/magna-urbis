//! Water crossings: when a town opens a far bank, and the bridge, ford or ferry it crosses by.
//!
//! Each bank is a connected dry component of the survey (`SurveyCell::bank_id`). The town's
//! banks are the founding focus's and every bank a `CrossWater` event opened. A far bank is due
//! when crossing to it is cheaper than the cheapest open land left on the town's banks: the
//! cheapest crossing costs the near landing's cost, the survey's water charge and the water
//! crossed at the main axis's cost per metre (the ferry's for a ferry), which is what the cost
//! field charges once the crossing stands. The crossing is placed on the armature: on a regional
//! road that already crosses to that bank (its wet stretch becomes the bridge), else on the main
//! axis whose prolongation meets the water nearest, square to the flow, else joined to the
//! nearest street as a new axis. Its kind follows classic's span rule
//! (`footprint::crossings::spans`): a ford on a narrow, non-navigable stream when the culture
//! fords, a bridge up to the span the town's builders afford at its size, a ferry landing pair
//! on wider water up to `ferrySpan`.
//!
//! Every function reads the graph, the journal, the survey and the specs and returns journal
//! operations or plain results; only the journal writes the graph.
//!
//! # Integration
//!
//! 1. **Specs**: `spec::CrossingSpec` is new and not yet in `TownSpecs`; add it there as
//!    `#[serde(default)] pub crossing: CrossingSpec`. Core's `town_adapter/specs.rs` sets
//!    `builders` to the culture factor of classic's `footprint::crossings::spans` (1.25, 0.55
//!    or 1; expose it as a function there) and `ford_span` to 10 (0 for a culture that never
//!    fords, none today); the growth test specs use `CrossingSpec::default()`.
//! 2. **Cost field** (`Driver::cost_field`): append `cost_lines(graph, journal, &specs.growth,
//!    &specs.crossing)` to the lines of `armature::cost_lines` (with `allow_crossings` from
//!    `CostLine::crossings`, true for every crossing line). Each crossing is a straight cheap
//!    path from its near to its far landing, so `recompute_costs` gives the far bank finite costs
//!    through it: the near landing's cost plus the water charge plus the span at the line's
//!    multiplier. Bridges are `EdgeClass::Bridge` on the deck, which `armature::cost_lines`
//!    leaves out, and fords are ground streets over wet cells, which it walks without crossings:
//!    both carry traffic only through these lines.
//! 3. **Rings grow from the far landings** (`growth/contour.rs`): `Lattice::land` floods from the
//!    centre and also from the cell of every point of `far_landings(graph, journal)` whose cost
//!    is below the level, and traces one outline per flooded component (the components are
//!    disjoint, water lies between them). `ExtendArmature` (`Driver::extension`) calls
//!    `armature::arcs` once per outline and inserts every arc; `whole` compares the union of the
//!    flooded cells with every cell of finite cost. The far approach's end (or the far landing
//!    when there is no approach) is the tip of the crossing's chain, so `armature::extend`
//!    prolongs that axis from the far bank at the next ring.
//! 4. **Arms**: after a `CrossWater` event is applied, and after a recorded one is replayed on
//!    resume, `driver.arms.extend(crossing_arms(graph, journal, &driver.arms))`: a crossing that
//!    joined a street off the axes opened a new axis across the water.
//! 5. **Dated events, water step** (design 3.2, step 5, last: after promotions, road fates,
//!    harbour and wall events). The comparison is between rings, so it runs once per ring, after
//!    the ring's quarters and ageing (`Driver::ring`, when the ring ended `Opened` or `Empty`),
//!    and also before growth gives up on an `Exhausted` ring, the case of a town that has used
//!    all its near land. With `costs` the ring's frozen cost field, `level` the ring's outer level
//!    `(ring + 1) × ringStep`, `inhabitants` the housed households × household size:
//!    ```ignore
//!    let inputs = water::WaterInputs { survey, costs, graph, journal, arms, focus, level,
//!        inhabitants, water_charge: specs.survey.water_charge, growth: &specs.growth,
//!        spec: &specs.crossing };
//!    if let Some(crossing) = water::far_bank_due(&inputs) {
//!        driver.event(crossing.event(), |d, _| water::cross_water(d.writer.graph(), &crossing))?;
//!    }
//!    ```
//!    `None` from `cross_water` (the graph refused nothing yet, but an approach could not be
//!    drawn): the event is not applied, and the next ring tries again. After an `Exhausted` ring
//!    whose crossing was applied, growth goes on with the next ring instead of ageing out. One
//!    crossing at most per ring: a second bank opens at a later ring. The decision reads the
//!    graph, the journal, the frozen cost field, the ring and the clock only, so the prefix
//!    property holds.
//! 6. **Finish** (core's `town_adapter/layout.rs`): `EdgeClass::Bridge` edges are exported with
//!    role `bridge` already, whatever their level; their polyline runs from landing to landing,
//!    and `Deck` keeps them off the ground subdivision, so classic's 3D bridges
//!    (`web/src/render/city3d/bridges.ts`, street role `bridge`) draw them. The street exporter
//!    gives role `ford` to every live edge whose stem is in `ford_stems(journal)` (they are
//!    `EdgeClass::Street` on the ground, which would otherwise be `street`). A ferry has no edge:
//!    its two landings end the approach streets. The regional road fate lot (B5) should treat a
//!    regional road piece retyped to `Bridge` as part of its road.
//!
//! # Not handled yet
//!
//! Second crossings to a bank already opened (classic adds bridges with the population), the
//! upgrade of a ford into a bridge as the town grows, and causeways over still water.

mod lay;
mod site;
mod span;
#[cfg(test)]
mod tests;

use std::collections::{BTreeSet, HashSet};

use magna_urbis_geom::Point;

pub use lay::cross_water;
pub use site::far_bank_due;
pub use span::{Chord, flow, span_near};

use crate::armature::{Arm, CostLine};
use crate::graph::{EdgeClass, Graph, Key, Level};
use crate::journal::{Event, EventKind, Journal, Op};
use crate::spec::{CrossingSpec, GrowthSpec};
use crate::survey::{BankId, CostField, Survey};

/// Key segment tags of crossing elements, after the graph's (`graph::tag`) and the harbour's.
mod tag {
    /// The crossing's lineage: its near and far bank, then its chain.
    pub const CROSSING: u32 = 48;
    /// The chain the crossing prolongs, nested.
    pub const CHAIN: u32 = 49;
    /// The span edge, bridge or ford.
    pub const SPAN: u32 = 50;
    /// An approach: 0 on the near bank, 1 on the far bank.
    pub const APPROACH: u32 = 51;
    /// The node on the near bank where the span or the ferry starts.
    pub const NEAR: u32 = 52;
    /// The node on the far bank where the span or the ferry lands.
    pub const FAR: u32 = 53;
    /// The node splitting the chain where the near approach leaves it.
    pub const JOIN: u32 = 54;
    /// A new axis opened by a crossing that joined a street off the axes.
    pub const AXIS: u32 = 55;
}

/// How a crossing spans the water.
#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub enum CrossingKind {
    /// A bridge on the deck level.
    Bridge,
    /// A street through a shallow stream.
    Ford,
    /// A landing on each bank, with no edge across.
    Ferry,
    /// The wet stretch of a regional road already crossing the water, retyped to a bridge.
    Road,
}

/// Where the near approach leaves the chain.
#[derive(Clone, Debug, PartialEq)]
pub enum Join {
    /// At an existing node.
    Node(Key),
    /// On a live edge (its own key), which splits there.
    Edge(Key),
}

/// A crossing decided by [`far_bank_due`], for [`cross_water`].
#[derive(Clone, Debug, PartialEq)]
pub struct Crossing {
    /// Position of the crossing in the town's sequence, from 0.
    pub index: u32,
    /// How the water is spanned.
    pub kind: CrossingKind,
    /// The town's bank it leaves from.
    pub near_bank: BankId,
    /// The bank it opens.
    pub far_bank: BankId,
    /// The chain the crossing prolongs: an axis, a regional road, or a new axis.
    pub chain: Key,
    /// Street rank of the crossing, the chain's.
    pub rank: u8,
    /// Drawn width in metres, the chain's.
    pub width: f64,
    /// Where it leaves the chain (for a road crossing, the road's live edge).
    pub join: Join,
    /// Position of the join.
    pub join_point: Point,
    /// The near approach from the join to the near landing; empty when the join is the landing.
    pub near_path: Vec<Point>,
    /// The near and far landings; for a road crossing, the road's last dry points either side.
    pub span: [Point; 2],
    /// The far approach from the far landing straight on inland; empty when there is none.
    pub far_path: Vec<Point>,
    /// Water crossed in metres.
    pub water: f64,
    /// Whether the water crossed is navigable.
    pub navigable: bool,
    /// The new axis when the crossing joined a street off the axes.
    pub new_arm: Option<Arm>,
}

impl Crossing {
    /// The `CrossWater` event that applies the crossing.
    pub fn event(&self) -> EventKind {
        EventKind::CrossWater {
            crossing: self.index,
            bank: self.far_bank as u32,
        }
    }
}

/// What [`far_bank_due`] reads.
pub struct WaterInputs<'a> {
    /// The survey the town grows on.
    pub survey: &'a Survey,
    /// The ring's frozen cost field, crossings included (`cost_lines`).
    pub costs: &'a CostField,
    /// The town as it stands.
    pub graph: &'a Graph,
    /// Its journal.
    pub journal: &'a Journal,
    /// The main axes.
    pub arms: &'a [Arm],
    /// The founding focus.
    pub focus: Point,
    /// The ring's outer cost level: land cheaper than it is opened.
    pub level: f64,
    /// Housed inhabitants at the date.
    pub inhabitants: f64,
    /// The survey's charge per water crossing, in effective metres (`SurveySpec::water_charge`).
    pub water_charge: f64,
    /// Growth weights of the cost field.
    pub growth: &'a GrowthSpec,
    /// What the town can cross.
    pub spec: &'a CrossingSpec,
}

/// The node on the near bank of the crossing applied by event `event`, when it is a new node.
pub fn near_node(event: &Key) -> Key {
    event.child(tag::NEAR, &[])
}

/// The node on the far bank of the crossing applied by event `event`.
pub fn far_node(event: &Key) -> Key {
    event.child(tag::FAR, &[])
}

/// The chain of a new axis opened by the crossing of event `event`.
pub fn axis_chain(event: &Key) -> Key {
    event.child(tag::AXIS, &[])
}

/// The applied `CrossWater` events, oldest first, with the bank each opened.
pub fn crossing_events(journal: &Journal) -> impl Iterator<Item = (&Event, BankId)> + '_ {
    journal.events.iter().filter_map(|e| match e.kind {
        EventKind::CrossWater { bank, .. } => Some((e, bank as BankId)),
        _ => None,
    })
}

/// The town's banks: the founding focus's and every bank a crossing opened.
pub fn town_banks(survey: &Survey, focus: Point, journal: &Journal) -> BTreeSet<BankId> {
    let mut banks: BTreeSet<BankId> = crossing_events(journal).map(|(_, b)| b).collect();
    banks.extend(survey.bank_id_at(focus));
    banks
}

/// The far landings of the crossings that stand: the cells the rings of a far bank grow from.
pub fn far_landings(graph: &Graph, journal: &Journal) -> Vec<Point> {
    crossing_events(journal)
        .filter_map(|(e, _)| graph.node_id(&far_node(&e.key)))
        .filter(|&n| graph.node(n).life.live())
        .map(|n| graph.node(n).position)
        .collect()
}

/// Stems of the ford edges, which the adapter exports with role `ford`.
pub fn ford_stems(journal: &Journal) -> HashSet<Key> {
    crossing_events(journal)
        .filter_map(|(e, _)| span_op(e))
        .filter(|(_, class)| *class == EdgeClass::Street)
        .map(|(key, _)| key)
        .collect()
}

/// The axes opened by crossings that joined a street off the axes, not yet among `arms`.
pub fn crossing_arms(graph: &Graph, journal: &Journal, arms: &[Arm]) -> Vec<Arm> {
    let known: HashSet<&Key> = arms.iter().map(|a| &a.chain).collect();
    crossing_events(journal)
        .filter_map(|(e, _)| {
            let chain = axis_chain(&e.key);
            if known.contains(&chain) {
                return None;
            }
            let spec = e.ops.iter().find_map(|op| match op {
                Op::InsertEdge { spec, .. } if spec.chain.as_ref() == Some(&chain) => Some(spec),
                _ => None,
            })?;
            let [near, far] = landings(graph, e)?;
            Some(Arm {
                bearing: (far.y - near.y).atan2(far.x - near.x),
                rank: spec.rank,
                width: spec.widths.first().copied().unwrap_or(0.0),
                chain,
            })
        })
        .collect()
}

/// The crossings' lines in the cost field: a straight line from each crossing's near landing to
/// its far landing, over water, at the axis's cost per metre (a regional road's for a road
/// bridge, the ferry's for a ferry).
pub fn cost_lines(
    graph: &Graph,
    journal: &Journal,
    growth: &GrowthSpec,
    spec: &CrossingSpec,
) -> Vec<CostLine> {
    crossing_events(journal)
        .filter_map(|(e, _)| {
            let ends = landings(graph, e)?;
            let multiplier = match kind_of(e) {
                CrossingKind::Road => growth.regional_road_cost,
                CrossingKind::Bridge | CrossingKind::Ford => growth.axis_cost,
                CrossingKind::Ferry => spec.ferry_cost,
            };
            Some(CostLine {
                points: ends.to_vec(),
                multiplier,
                crossings: true,
            })
        })
        .collect()
}

/// The span edge an event inserted, by key, with its class.
fn span_op(event: &Event) -> Option<(Key, EdgeClass)> {
    event.ops.iter().find_map(|op| match op {
        Op::InsertEdge { spec, .. } if is_span(&spec.key) => Some((spec.key.clone(), spec.class)),
        _ => None,
    })
}

/// Whether a key is a crossing's span edge: its last segment is the span tag, with no items.
fn is_span(key: &Key) -> bool {
    key.parts().ends_with(&[tag::SPAN, 0])
}

/// How the crossing of an applied event spans the water, read from its operations.
fn kind_of(event: &Event) -> CrossingKind {
    if event
        .ops
        .iter()
        .any(|op| matches!(op, Op::SetEdgeClass { class: EdgeClass::Bridge, .. }))
    {
        return CrossingKind::Road;
    }
    match span_op(event) {
        Some((_, EdgeClass::Street)) => CrossingKind::Ford,
        Some(_) => CrossingKind::Bridge,
        None => CrossingKind::Ferry,
    }
}

/// The near and far landings of an applied crossing that stands. The near landing is the event's
/// near node, or the existing node it gave the landing's kind.
fn landings(graph: &Graph, event: &Event) -> Option<[Point; 2]> {
    let live = |key: &Key| graph.node_id(key).filter(|&n| graph.node(n).life.live());
    let far = live(&far_node(&event.key))?;
    let near = live(&near_node(&event.key)).or_else(|| {
        event.ops.iter().find_map(|op| match op {
            Op::SetNodeKind { node, .. } => live(node),
            _ => None,
        })
    })?;
    Some([graph.node(near).position, graph.node(far).position])
}

/// Whether an edge is a ground street a crossing may leave from.
fn joinable(class: EdgeClass) -> bool {
    matches!(
        class,
        EdgeClass::Street
            | EdgeClass::Lane
            | EdgeClass::RegionalRoad
            | EdgeClass::HarbourRoad
            | EdgeClass::CastleRoad
            | EdgeClass::Boundary
    )
}

/// The ground level, where every approach lies.
const GROUND: Level = Level::Ground;
