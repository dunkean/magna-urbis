//! The water side of a precinct (design 5.5): channels crossed on flow-normal spans with a water
//! gate, and the three forms a curtain takes at a harbour, chosen from the charter's harbour
//! enclosure habit:
//! - **sea wall**: the curtain keeps to the land side of the quay; each landing is a water gate;
//! - **open front**: the curtain ends on the waterline at both ends of the quay, on terminal
//!   towers, and the stretch along the quay stays open;
//! - **harbour outside**: the curtain passes behind the service row; the harbour road's crossing
//!   is the port gate (a gate of the precinct's armature ranking).
//!
//! Bank identity comes from the survey's bank components: a span records the components of its
//! two banks, so that both occupied banks of a channel stand in one circuit.

use magna_urbis_geom::{self as g, Point, Shape, surface::TerrainView};

use super::clearance::{Obstacle, densify};
use super::geometry::{dist, lerp};
use super::insert::{REUSE, chain_nodes, nearest_on, seat_nodes};
use super::precinct::Precinct;
use crate::graph::{EdgeClass, Graph, Key, NodeKind};
use crate::journal::{Op, Stage};
use crate::spec::{HarbourEnclosure, PrecinctSpec};
use crate::survey::{BankId, Survey};

/// Spacing in metres at which a curtain is sampled for water.
const SAMPLE: f64 = 2.0;
/// A wet run of the curtain up to this long (metres) is a channel crossing; a longer one is a
/// shore the curtain follows.
const CHANNEL_MAX: f64 = 80.0;
/// How far along the curtain (metres) a span's banks may move to cross square to the flow.
const SPAN_SLIDE: f64 = 25.0;
/// A landing farther than this from the curtain (metres) gets no water gate.
const LANDING_REACH: f64 = 60.0;
/// Half width in metres of the strip a quay occupies, for the curtain to keep out of.
const QUAY_HALF: f64 = 5.0;
/// Node slots of the precinct event's seated nodes.
pub(super) const WATER_GATE_SLOT: u32 = 2;
pub(super) const TERMINAL_SLOT: u32 = 3;

/// What the harbour, decided before the wall, gives the precinct survey.
#[derive(Clone, Debug)]
pub struct HarbourSide {
    /// The charter's harbour enclosure habit.
    pub habit: HarbourEnclosure,
    /// The quay line along the water.
    pub quay: Vec<Point>,
    /// Landing nodes on the quay.
    pub landings: Vec<Point>,
    /// The approach from the open water, kept clear of any curtain.
    pub approach: Option<Shape>,
    /// The apron and the first row of lots behind the quay.
    pub service_row: Option<Shape>,
    /// Chain of the harbour road, whose crossing is the port gate.
    pub road: Option<Key>,
}

impl HarbourSide {
    /// What the precinct line must stay out of, by habit: the quay strip for a sea wall, the
    /// approach for an open front, the approach, quay and service row for a harbour outside.
    pub fn obstacles(&self, spec: &PrecinctSpec, curtain: f64) -> Vec<Obstacle> {
        let clearance = spec.harbour_clearance + curtain * 0.5;
        let quay = (self.quay.len() >= 2)
            .then(|| g::ribbon(&self.quay, &[2.0 * QUAY_HALF]))
            .unwrap_or_default();
        let mut out: Vec<Obstacle> = Vec::new();
        if let Some(approach) = &self.approach {
            out.push(Obstacle::new(approach.clone(), clearance));
        }
        match self.habit {
            HarbourEnclosure::SeaWall => {
                out.extend(quay.into_iter().map(|s| Obstacle::new(s, clearance)));
            }
            HarbourEnclosure::OpenFront => {}
            HarbourEnclosure::HarbourOutside => {
                out.extend(quay.into_iter().map(|s| Obstacle::new(s, clearance)));
                if let Some(row) = &self.service_row {
                    out.push(Obstacle::new(row.clone(), clearance));
                }
            }
        }
        out
    }
}

/// Where a curtain crosses a channel.
#[derive(Clone, Debug, PartialEq)]
pub struct ChannelSpan {
    /// Its two bank points, in ring order.
    pub from: Point,
    pub to: Point,
    /// The water gate, at the middle of the span.
    pub gate: Point,
    /// Survey bank components of its two banks.
    pub banks: [Option<BankId>; 2],
}

/// The curtain `ring` with each channel crossing replaced by the shortest straight span between
/// two dry points within `SPAN_SLIDE` of its banks (the span square to the flow), and the spans.
/// Vertices for which `fixed` holds stay.
pub fn flow_normal_spans(
    ring: &[Point],
    terrain: &dyn TerrainView,
    survey: &Survey,
    fixed: impl Fn(Point) -> bool,
) -> (Vec<Point>, Vec<ChannelSpan>) {
    let dense = densify(ring, SAMPLE);
    let n = dense.len();
    let wet: Vec<bool> = dense.iter().map(|&p| terrain.wet(p)).collect();
    if n < 3 || !wet.iter().any(|&w| w) || wet.iter().all(|&w| w) {
        return (ring.to_vec(), Vec::new());
    }
    // Wet runs as (first wet sample, count), walking from a dry sample.
    let start = (0..n).find(|&k| !wet[k]).expect("a dry sample");
    let mut runs: Vec<(usize, usize)> = Vec::new();
    let mut k = 0;
    while k < n {
        let i = (start + k) % n;
        if wet[i] {
            let mut m = 0;
            while m < n && wet[(i + m) % n] {
                m += 1;
            }
            runs.push((i, m));
            k += m;
        } else {
            k += 1;
        }
    }
    let slide = (SPAN_SLIDE / SAMPLE).ceil() as usize;
    let mut drop = vec![false; n];
    let mut spans = Vec::new();
    for (i, m) in runs {
        if m as f64 * SAMPLE > CHANNEL_MAX {
            continue;
        }
        let before = |s: usize| (i + n - 1 - s) % n;
        let after = |s: usize| (i + m + s) % n;
        let mut best: Option<(f64, usize, usize)> = None;
        for s in 0..=slide.min(n / 4) {
            let a = before(s);
            if wet[a] || fixed(dense[a]) && s > 0 {
                break;
            }
            for t in 0..=slide.min(n / 4) {
                let b = after(t);
                if wet[b] || fixed(dense[b]) && t > 0 {
                    break;
                }
                let d = dist(dense[a], dense[b]);
                if best.is_none_or(|(e, _, _)| d < e) {
                    best = Some((d, a, b));
                }
            }
        }
        let Some((_, a, b)) = best else { continue };
        let mut j = (a + 1) % n;
        while j != b {
            drop[j] = true;
            j = (j + 1) % n;
        }
        spans.push(ChannelSpan {
            from: dense[a],
            to: dense[b],
            gate: lerp(dense[a], dense[b], 0.5),
            banks: [survey.bank_id_at(dense[a]), survey.bank_id_at(dense[b])],
        });
    }
    if spans.is_empty() {
        return (ring.to_vec(), spans);
    }
    let kept: Vec<Point> = (0..n).filter(|&k| !drop[k]).map(|k| dense[k]).collect();
    (simplified(&kept), spans)
}

/// A closed ring without the vertices on a straight line between their neighbours (within
/// 5 cm), so that a densified curtain keeps its own corners only.
fn simplified(ring: &[Point]) -> Vec<Point> {
    let n = ring.len();
    if n <= 4 {
        return ring.to_vec();
    }
    let mut out: Vec<Point> = Vec::with_capacity(n);
    for k in 0..n {
        let (a, p, b) = (
            out.last().copied().unwrap_or(ring[(k + n - 1) % n]),
            ring[k],
            ring[(k + 1) % n],
        );
        if g::distance(p, a, b).0 > 0.05 {
            out.push(p);
        }
    }
    if out.len() >= 3 { out } else { ring.to_vec() }
}

/// Where the water side of a precinct opens.
#[derive(Clone, Debug, Default, PartialEq)]
pub struct WaterPlan {
    /// The harbour form, when a harbour stands on this precinct's water side.
    pub form: Option<HarbourEnclosure>,
    /// Water gates: channel spans and, behind a sea wall, the landings.
    pub gates: Vec<Point>,
    /// Terminal towers of an open front, where the curtain ends on the waterline.
    pub terminals: Vec<Point>,
    /// A point of the open stretch between the terminals.
    pub open_at: Option<Point>,
}

/// The water gates and terminals of the curtain `ring` (counter-clockwise, final), from its
/// channel spans and the harbour.
pub fn water_plan(
    ring: &[Point],
    terrain: &dyn TerrainView,
    spans: &[ChannelSpan],
    harbour: Option<&HarbourSide>,
) -> WaterPlan {
    let mut plan = WaterPlan {
        gates: spans.iter().map(|s| s.gate).collect(),
        ..WaterPlan::default()
    };
    let Some(harbour) = harbour.filter(|h| h.quay.len() >= 2) else {
        return plan;
    };
    let closed: Vec<Point> = ring.iter().copied().chain(ring.first().copied()).collect();
    let near = |p: Point| nearest_on(&closed, p);
    let quay_mid = harbour.quay[harbour.quay.len() / 2];
    if near(quay_mid).0 > LANDING_REACH * 2.0 {
        return plan;
    }
    plan.form = Some(harbour.habit);
    match harbour.habit {
        HarbourEnclosure::SeaWall => {
            for &landing in &harbour.landings {
                let (d, q) = near(landing);
                if d <= LANDING_REACH && plan.gates.iter().all(|&p| dist(p, q) >= REUSE) {
                    plan.gates.push(q);
                }
            }
        }
        HarbourEnclosure::OpenFront => {
            let banks = waterline(&closed, terrain);
            let ends = [harbour.quay[0], harbour.quay[harbour.quay.len() - 1]];
            for end in ends {
                if let Some(&b) = banks
                    .iter()
                    .min_by(|x, y| dist(**x, end).total_cmp(&dist(**y, end)))
                    .filter(|b| plan.terminals.iter().all(|t| dist(*t, **b) > REUSE))
                {
                    plan.terminals.push(b);
                }
            }
            if plan.terminals.len() == 2 {
                plan.open_at = Some(near(quay_mid).1);
            } else {
                plan.terminals.clear();
            }
        }
        HarbourEnclosure::HarbourOutside => {}
    }
    plan
}

/// Points where a closed path passes between land and water, located to 0.1 m.
pub fn waterline(path: &[Point], terrain: &dyn TerrainView) -> Vec<Point> {
    let mut out = Vec::new();
    for w in path.windows(2) {
        let k = (dist(w[0], w[1]) / SAMPLE).ceil().max(1.0) as usize;
        for j in 0..k {
            let (a, b) = (
                lerp(w[0], w[1], j as f64 / k as f64),
                lerp(w[0], w[1], (j + 1) as f64 / k as f64),
            );
            let wet = terrain.wet(a);
            if wet == terrain.wet(b) {
                continue;
            }
            let (mut lo, mut hi) = (a, b);
            while dist(lo, hi) > 0.1 {
                let mid = lerp(lo, hi, 0.5);
                if terrain.wet(mid) == wet {
                    lo = mid;
                } else {
                    hi = mid;
                }
            }
            out.push(lerp(lo, hi, 0.5));
        }
    }
    out
}

/// Seat the water plan on the drawn precinct chain: water gates as `WaterGate` nodes, terminal
/// towers as junctions, and, for an open front, the chain's edges between the terminals along
/// the quay retyped `Boundary` so that the raise leaves them open. Returns the water gate nodes.
pub fn seat_water_plan(
    stage: &mut Stage,
    chain: &Key,
    plan: &WaterPlan,
    event: &Key,
) -> Vec<(Key, Point)> {
    let gates = seat_nodes(
        stage,
        chain,
        &plan.gates,
        NodeKind::WaterGate,
        event,
        WATER_GATE_SLOT,
    );
    let Some(open) = plan.open_at else {
        return gates;
    };
    let terminals = seat_nodes(
        stage,
        chain,
        &plan.terminals,
        NodeKind::Junction,
        event,
        TERMINAL_SLOT,
    );
    if terminals.len() != 2 {
        return gates;
    }
    for edge in open_stretch(
        stage.graph(),
        chain,
        [&terminals[0].0, &terminals[1].0],
        open,
    ) {
        let _ = stage.try_push(vec![Op::SetEdgeClass {
            edge,
            class: EdgeClass::Boundary,
        }]);
    }
    gates
}

/// Keys of the chain's live edges between the two terminal nodes, on the side holding `open`.
fn open_stretch(graph: &Graph, chain: &Key, terminals: [&Key; 2], open: Point) -> Vec<Key> {
    let steps = graph.faces_along_chain(chain);
    let n = steps.len();
    let node_key = |s: usize, end: usize| {
        let edge = graph.edge(steps[s].edge);
        let i = if steps[s].half.is_forward() {
            end
        } else {
            1 - end
        };
        graph.node(edge.nodes[i]).key.clone()
    };
    let Some(a) = (0..n).find(|&s| terminals.contains(&&node_key(s, 0))) else {
        return Vec::new();
    };
    // Walk from the first terminal to the other: one side of the loop.
    let mut side: Vec<usize> = Vec::new();
    let mut s = a;
    for _ in 0..n {
        side.push(s);
        if terminals.contains(&&node_key(s, 1)) {
            break;
        }
        s = (s + 1) % n;
    }
    let holds = side.iter().any(|&s| {
        let edge = graph.edge(steps[s].edge);
        nearest_on(&edge.polyline, open).0 < 0.5
    });
    let chosen: Vec<usize> = if holds {
        side
    } else {
        (0..n).filter(|s| !side.contains(s)).collect()
    };
    chosen
        .into_iter()
        .map(|s| graph.edge(steps[s].edge).key.clone())
        .collect()
}

/// A later quay extension adds a water gate at each new landing within reach of a sea wall,
/// and never moves the curtain.
pub fn landing_gates(
    stage: &mut Stage,
    precinct: &Precinct,
    landings: &[Point],
    event: &Key,
) -> Vec<(Key, Point)> {
    let graph = stage.graph();
    let nodes = chain_nodes(graph, &precinct.chain);
    let points: Vec<Point> = landings
        .iter()
        .filter_map(|&l| {
            let (d, q) = nearest_on(
                &precinct
                    .outline
                    .outer
                    .iter()
                    .copied()
                    .chain(precinct.outline.outer.first().copied())
                    .collect::<Vec<_>>(),
                l,
            );
            (d <= LANDING_REACH && !nodes.iter().any(|(_, p)| dist(*p, q) < 1.0)).then_some(q)
        })
        .collect();
    seat_nodes(
        stage,
        &precinct.chain,
        &points,
        NodeKind::WaterGate,
        event,
        WATER_GATE_SLOT,
    )
}
