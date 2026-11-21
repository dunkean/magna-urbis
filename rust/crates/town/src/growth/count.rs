//! Capacity at birth: a new quarter's blocks counted once per fill level of its phase.

use magna_urbis_geom::{Point, Shape, distance};
use serde::{Deserialize, Serialize};

use super::{Capacity, CapacityBlock, CapacityInputs, par};
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
    /// The step from which the quarter is rebuilt in its phase's compact tissue (the last one),
    /// when that tissue differs from the one it was born with: old quarters densify with age.
    #[serde(default)]
    pub compact_step: Option<usize>,
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

    /// Whether the quarter has been rebuilt in its phase's compact tissue.
    pub fn compact(&self) -> bool {
        self.compact_step.is_some_and(|c| self.step >= c)
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
    /// The phase's compact tissue (recipe, zone, density) when it differs from the birth tissue:
    /// counted once more, fully occupied, as the quarter's last ageing step.
    pub compact: Option<(&'a str, &'a str, f64)>,
}

/// The pressure frozen at birth: classic's decay with access cost (`parcels/pressure.rs`), read
/// from the quarter's cost in effective metres and scaled by the ring's outer level as the
/// town's extent. The capacity raises it inside an enclosure, as classic's `parcels.rs` does,
/// from the intramural flag of its inputs.
pub(super) fn pressure(cost: f64, extent: f64) -> f64 {
    let scale = extent.clamp(60.0, 600.0);
    if cost.is_finite() {
        (0.12 + 0.88 * (-cost / scale).exp()).clamp(0.0, 1.0)
    } else {
        0.12
    }
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
    let mut inputs: Vec<CapacityInputs<'_>> = birth
        .fill_schedule
        .iter()
        .map(|&fill| CapacityInputs {
            pressure: birth.pressure,
            recipe: birth.recipe,
            zone: birth.zone,
            density: birth.density,
            intramural: birth.intramural,
            fill_level: fill,
        })
        .collect();
    if let Some((recipe, zone, density)) = birth.compact {
        inputs.push(CapacityInputs {
            pressure: birth.pressure,
            recipe,
            zone,
            density,
            intramural: birth.intramural,
            fill_level: 1.0,
        });
    }
    // Each level is an independent cut and allocation of the same blocks: counted in parallel.
    let counts = par::map(&inputs, |_, &at| capacity.households(&blocks, at));
    let mut out: Vec<Clock> = Vec::with_capacity(counts.len());
    for housed in counts {
        let housed = Clock::from_households(housed);
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
        // A boundary becomes a street once the next ring opens beyond it: it is frontage.
        .filter(|edge| {
            !matches!(
                edge.class.current(),
                EdgeClass::Precinct | EdgeClass::Wall | EdgeClass::Canal
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
