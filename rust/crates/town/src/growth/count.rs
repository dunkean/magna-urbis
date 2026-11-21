//! Capacity at birth: a new quarter's blocks counted once per fill level of its phase.

use magna_urbis_geom::{Point, Shape, distance};
use serde::{Deserialize, Serialize};

use super::{Capacity, CapacityBlock, CapacityInputs};
use crate::blocks::{BlockSpec, from_graph};
use crate::graph::{Clock, EdgeClass, FaceId, Graph, Key, Station};

/// A block side faces a street when its middle lies within the street's half-width plus this (metres).
const FRONT_SLACK: f64 = 2.0;

/// A quarter as the count knows it: its birth and its fill schedule.
#[derive(Clone, Debug, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct QuarterRecord {
    /// The quarter's key, `(ring, station)`.
    pub key: Key,
    /// Its ring.
    pub ring: u32,
    /// Its station.
    pub station: Station,
    /// Position in the phase plan of the phase it was born in.
    pub phase: usize,
    /// Tissue that laid its streets.
    pub tissue: String,
    /// Whether it was born in the intramural regime.
    pub intramural: bool,
    /// Keys of its faces at birth.
    pub faces: Vec<Key>,
    /// Occupied share of its lots at each fill step, from its phase at birth.
    pub fill_schedule: Vec<f64>,
    /// Households it holds at each fill step, counted at birth.
    pub levels: Vec<Clock>,
    /// The fill step reached, from 0 at birth.
    pub step: usize,
}

impl QuarterRecord {
    /// Households it holds at its fill step.
    pub fn housed(&self) -> Clock {
        self.levels[self.step]
    }

    /// Occupied share of its lots at its fill step.
    pub fn fill(&self) -> f64 {
        self.fill_schedule[self.step]
    }

    /// Households the next fill step adds, or `None` at the last step.
    pub fn next_increment(&self) -> Option<Clock> {
        let next = self.levels.get(self.step + 1)?;
        Some(Clock(next.0.saturating_sub(self.levels[self.step].0)))
    }
}

/// What a quarter's count reads, frozen at its birth.
pub(super) struct Birth<'a> {
    pub pressure: f64,
    pub recipe: &'a str,
    pub zone: &'a str,
    pub density: f64,
    pub intramural: bool,
    pub fill_schedule: &'a [f64],
}

/// The pressure frozen at birth: classic's decay with access cost (`parcels/pressure.rs`), read
/// from the quarter's cost in effective metres and scaled by the ring's outer level as the
/// town's extent, then raised inside an enclosure as classic's `parcels.rs` does.
pub(super) fn pressure(cost: f64, extent: f64, intramural: bool) -> f64 {
    let scale = extent.clamp(60.0, 600.0);
    let p = if cost.is_finite() {
        (0.12 + 0.88 * (-cost / scale).exp()).clamp(0.0, 1.0)
    } else {
        0.12
    };
    if intramural { 0.65 + 0.35 * p } else { p }
}

/// Households of the quarter whose faces are `faces` at each step of its fill schedule, its
/// blocks cut from the graph at `clock`. Levels never decrease.
pub(super) fn levels(
    graph: &Graph,
    faces: &[FaceId],
    clock: Clock,
    capacity: &dyn Capacity,
    birth: &Birth<'_>,
) -> Vec<Clock> {
    let blocks: Vec<CapacityBlock> = faces
        .iter()
        .flat_map(|&face| capacity_blocks(graph, face, clock))
        .collect();
    let mut out: Vec<Clock> = Vec::with_capacity(birth.fill_schedule.len());
    for &fill in birth.fill_schedule {
        let inputs = CapacityInputs {
            pressure: birth.pressure,
            recipe: birth.recipe,
            zone: birth.zone,
            density: birth.density,
            intramural: birth.intramural,
            fill_level: fill,
        };
        let housed = Clock::from_households(capacity.households(&blocks, inputs));
        let floor = out.last().copied().unwrap_or(Clock::ZERO);
        out.push(housed.max(floor));
    }
    out
}

/// The buildable pieces of one face with the sides that face a street.
fn capacity_blocks(graph: &Graph, face: FaceId, clock: Clock) -> Vec<CapacityBlock> {
    let pieces = from_graph(graph, face, clock, &BlockSpec::default());
    if pieces.is_empty() {
        return Vec::new();
    }
    let streets: Vec<(Vec<Point>, f64)> = graph
        .walks(face)
        .into_iter()
        .flatten()
        .map(|h| graph.edge(h.edge()))
        .filter(|edge| {
            !matches!(
                edge.class.current(),
                EdgeClass::Boundary | EdgeClass::Precinct | EdgeClass::Wall | EdgeClass::Canal
            )
        })
        .map(|edge| {
            let half = edge.widths.iter().copied().fold(0.0_f64, f64::max) * 0.5;
            (edge.polyline.clone(), half)
        })
        .collect();
    pieces
        .into_iter()
        .map(|outline| {
            let frontage_edges = frontage(&outline, &streets);
            CapacityBlock {
                outline,
                frontage_edges,
            }
        })
        .collect()
}

/// The sides of an outline's outer ring whose middle lies along a street.
fn frontage(outline: &Shape, streets: &[(Vec<Point>, f64)]) -> Vec<[Point; 2]> {
    let ring = &outline.outer;
    let n = ring.len();
    (0..n)
        .map(|k| [ring[k], ring[(k + 1) % n]])
        .filter(|[a, b]| {
            let m = Point {
                x: (a.x + b.x) * 0.5,
                y: (a.y + b.y) * 0.5,
            };
            streets.iter().any(|(line, half)| {
                line.windows(2)
                    .any(|w| distance(m, w[0], w[1]).0 <= half + FRONT_SLACK)
            })
        })
        .collect()
}
