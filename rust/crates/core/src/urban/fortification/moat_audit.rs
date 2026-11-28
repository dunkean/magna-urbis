//! What the moat rules (docs/MOAT_REDESIGN_2026-11-27.md, section 7) measure on one circuit.

use crate::urban::{Enclosure, Point, Street, Surface, geometry as g};
use super::gate_budget::GATE_GAP;
use super::geometry::{add, dir, dist, normals, pt};
use super::moat_line::{WATERFRONT, crossings, steep, turned_quads};
use super::water::{MOAT_SHORT, near_water};

/// Step (m) of the curtain samples, and the reach (ditch widths beyond the inner lip) within which a
/// sample's outward normal must enter a run.
const SAMPLE: f64 = 4.0;
const REACH_WIDTHS: f64 = 3.0;
/// Shortest stretch (m) of curtain no run faces that the audit reports.
const MIN_GAP: f64 = 12.0;
/// A gate is faced by a run when the normal through its point, or this far (m) along the curtain on
/// either side, enters one.
const GATE_SIDE: f64 = 8.0;

/// A stretch of dry curtain that no run of the moat faces.
#[derive(Clone, Debug, PartialEq)]
pub struct Uncovered {
    /// Its first sample.
    pub at: Point,
    pub length_m: f64,
    /// What the cross-sections facing most of it meet: `neighbour` (the other circuit of an attached
    /// pair, an inner ring), `harbour` (quays, piers, moles), `blocked` (off the map, cave rock),
    /// `water`, `steep`, or `none` (no reason on the ground: a shore passage, a moat never laid there).
    pub reason: &'static str,
}

#[derive(Clone, Debug, Default, PartialEq)]
pub struct MoatAudit {
    pub runs: usize,
    /// Length (m) of the curtain, and of the runs along their axis.
    pub ring_m: f64,
    pub run_m: f64,
    /// Land gates of the circuit, and those a crossing record leaves by.
    pub gates: usize,
    pub gate_crossings: usize,
    /// Crossings by land streets that leave by no gate.
    pub other_crossings: usize,
    /// Length (m) of land street inside a run that is no crossing (a street along the ditch).
    pub streets_along_m: f64,
    pub wet_reaches: usize,
    /// Rain pools: the reaches of a culture's wet moat that no source feeds.
    pub pool_reaches: usize,
    /// Fed reaches of a run with no source (a `water` end, a stream it takes in; a canal moat aside).
    pub wet_without_source: usize,
    pub dams: usize,
    /// Station quads that turn over, and fed reaches whose water stands above a rim or under the bed.
    pub invalid: usize,
    /// Length (m) of dry curtain (samples every `SAMPLE` m off the water), the part of it a run station
    /// faces (within face, berm, width and `FACING` m), and the stretches none faces.
    pub curtain_m: f64,
    pub covered_m: f64,
    pub uncovered: Vec<Uncovered>,
    /// The land gates a run faces that no crossing serves.
    pub uncrossed_gates: Vec<Point>,
}

/// The audit of the moat of `e` (one of `enclosures`, whose other circuits it may face) against
/// `streets`, on `surface`.
pub fn moat_audit(e: &Enclosure, enclosures: &[Enclosure], streets: &[Street], surface: Surface<'_>) -> MoatAudit {
    // Water gates, and the gate points that are the two ends of a water passage.
    let passages: Vec<Point> = e.gatehouses.iter().filter(|gh| matches!(gh.kind.as_str(), "water" | "shore")).flat_map(|gh| gh.passage).collect();
    let water_gates: Vec<usize> = (0..e.gates.len())
        .filter(|&i| e.gatehouses.iter().any(|gh| gh.gate == i && matches!(gh.kind.as_str(), "water" | "shore")) || passages.iter().any(|&p| dist(p, e.gates[i]) < 1.0))
        .collect();
    let mut found = MoatAudit {
        ring_m: e.path.windows(2).map(|w| dist(w[0], w[1])).sum(),
        gates: (0..e.gates.len()).filter(|i| !water_gates.contains(i)).count(),
        ..Default::default()
    };
    let Some(m) = &e.moat else {
        return found;
    };
    let (records, _) = crossings(&m.runs, &e.gates, &e.gatehouses, streets, false);
    // A land gate needs a crossing only where a run faces it: a gate on a front without ditch (water,
    // the neighbour circuit, a harbour) does not count.
    let faced = Facing::new(e);
    // A gate that opens on natural water (a channel that is the moat of its front) is reached by a deck of
    // the bridges, not by a moat crossing.
    let ns = normals(&e.path);
    let on_water = |q: Point| {
        let k = e.path.windows(2).enumerate().min_by(|a, b| g::distance(q, a.1[0], a.1[1]).0.total_cmp(&g::distance(q, b.1[0], b.1[1]).0)).map_or(0, |(k, _)| k);
        (1..=(faced.reach / 2.0) as usize).any(|j| {
            let p = add(q, ns[k], 2.0 * j as f64);
            surface.wet(p) && !surface.solid(p)
        })
    };
    let facing: Vec<usize> = (0..e.gates.len()).filter(|i| !water_gates.contains(i)).filter(|&i| faced.gate(&e.path, e.gates[i]) && !on_water(e.gates[i])).collect();
    found.gates = facing.len();
    let mut gates: Vec<usize> = records.iter().filter_map(|c| c.gate).collect();
    gates.sort_unstable();
    gates.dedup();
    found.uncrossed_gates = facing.iter().filter(|i| !gates.contains(i)).map(|&i| e.gates[i]).collect();
    found.runs = m.runs.len();
    found.gate_crossings = gates.len();
    // A deck or a waterside way that also spans a ditch passes by its water passage, not a gate.
    let land: Vec<Street> = streets.iter().filter(|s| !super::gate_budget::water_way(s, true)).cloned().collect();
    let (land_records, land_along) = crossings(&m.runs, &e.gates, &e.gatehouses, &land, false);
    found.other_crossings = land_records.iter().filter(|c| c.gate.is_none()).count();
    found.streets_along_m = land_along;
    found.dams = m.dams.len();
    let mid = |a: Point, b: Point| pt(0.5 * (a.x + b.x), 0.5 * (a.y + b.y));
    for run in &m.runs {
        let n = run.inner.len();
        let axis: Vec<_> = (0..n).map(|k| mid(run.inner[k], run.outer[k])).collect();
        found.run_m += axis.windows(2).map(|w| dist(w[0], w[1])).sum::<f64>() + if run.closed && n > 1 { dist(axis[n - 1], axis[0]) } else { 0.0 };
        found.invalid += turned_quads(run);
        // A stream the ditch takes in feeds it as a water end does.
        let sourced = m.form == "canal" || run.ends.iter().any(|end| end == "water") || axis.iter().any(|&p| near_water(p, MOAT_SHORT, surface));
        found.pool_reaches += run.reaches.iter().filter(|r| r.supply == "pool").count();
        for r in run.reaches.iter().filter(|r| r.supply == "fed") {
            found.wet_reaches += 1;
            if !sourced {
                found.wet_without_source += 1;
            }
            let level = r.level.unwrap_or(f32::NAN);
            let stations: Vec<usize> = if r.to > r.from || !run.closed { (r.from..=r.to.min(n.saturating_sub(1))).collect() } else { (r.from..n).chain(0..=r.to).collect() };
            // The boundary station it shares with the next reach holds that reach's level.
            let own = &stations[..stations.len().saturating_sub(1).max(1)];
            if !own.iter().all(|&k| run.bed[k] < level && level <= run.rim[k]) {
                found.invalid += 1;
            }
        }
    }
    coverage(e, enclosures, streets, &faced, surface, &mut found);
    found
}

/// What faces the curtain of a circuit: its moat runs, reached along the outward normal of the curtain
/// within the inner lip (face and berm, the median over the runs) and `REACH_WIDTHS` ditch widths.
struct Facing {
    lip: f64,
    width: f64,
    reach: f64,
    /// Lip segments of the runs, and the runs as polygons (a normal may start inside one).
    lips: Vec<(Point, Point)>,
    runs: Vec<crate::urban::Shape>,
}

impl Facing {
    fn new(e: &Enclosure) -> Facing {
        let Some(m) = e.moat.as_ref().filter(|_| e.path.len() >= 4) else {
            return Facing { lip: 0.0, width: 0.0, reach: 0.0, lips: vec![], runs: vec![] };
        };
        let path = &e.path;
        let from_wall = |p: Point| path.windows(2).map(|w| g::distance(p, w[0], w[1]).0).fold(f64::INFINITY, f64::min);
        let mut lips: Vec<f64> = m.runs.iter().flat_map(|r| r.inner.iter()).map(|&a| from_wall(a)).collect();
        lips.sort_by(f64::total_cmp);
        let lip = lips.get(lips.len() / 2).copied().unwrap_or(e.curtain_width_m);
        let segments = m
            .runs
            .iter()
            .flat_map(|r| {
                let n = r.inner.len();
                let edges = if r.closed { n } else { n.saturating_sub(1) };
                [&r.inner, &r.outer].into_iter().flat_map(move |l| (0..edges).map(move |k| (l[k], l[(k + 1) % n])))
            })
            .collect();
        let runs = m.runs.iter().filter(|r| r.inner.len() >= 3).map(super::moat_line::run_outline).collect();
        Facing { lip, width: m.width_m, reach: lip + REACH_WIDTHS * m.width_m, lips: segments, runs }
    }

    /// Whether a run stands on the segment `p`–`q` (meets one of its lips, or holds its start).
    fn enters(&self, p: Point, q: Point) -> bool {
        let (x0, y0, x1, y1) = (p.x.min(q.x), p.y.min(q.y), p.x.max(q.x), p.y.max(q.y));
        self.lips.iter().any(|&(a, b)| a.x.max(b.x) >= x0 && a.x.min(b.x) <= x1 && a.y.max(b.y) >= y0 && a.y.min(b.y) <= y1 && g::segment_hit(p, q, a, b).is_some())
            || self.runs.iter().any(|r| g::contains(r, p))
    }

    /// Whether a run faces the gate point `q` of the curtain `path`.
    fn gate(&self, path: &[Point], q: Point) -> bool {
        if self.lips.is_empty() {
            return false;
        }
        let ns = normals(path);
        let k = path.windows(2).enumerate().min_by(|a, b| g::distance(q, a.1[0], a.1[1]).0.total_cmp(&g::distance(q, b.1[0], b.1[1]).0)).map_or(0, |(k, _)| k);
        let n = ns[k];
        // In front of the gate, or on both sides of it (the gatehouse may stand in front of the ditch): a
        // ditch that stops beside a gate does not face it.
        let t = (n.1, -n.0);
        let faced = |s: f64| {
            let p = add(q, t, s);
            self.enters(p, add(p, n, self.reach))
        };
        faced(0.0) || (faced(-GATE_SIDE) && faced(GATE_SIDE))
    }
}

/// The dry curtain of `e`, the part its moat runs face and the stretches they leave.
fn coverage(e: &Enclosure, enclosures: &[Enclosure], streets: &[Street], faced: &Facing, surface: Surface<'_>, found: &mut MoatAudit) {
    let Some(m) = &e.moat else { return };
    let path = &e.path;
    if path.len() < 4 {
        return;
    }
    let (lip, width, reach) = (faced.lip, faced.width, faced.reach);
    let enters = |p: Point, q: Point| faced.enters(p, q);
    // The other circuits (an attached pair, an inner ring) and the harbour works the curtain may face.
    let others: Vec<crate::urban::Shape> = enclosures
        .iter()
        .filter(|o| o.path != e.path && o.path.len() >= 4)
        .map(|o| g::normalized(crate::urban::Shape { outer: o.path[..o.path.len() - 1].to_vec(), holes: vec![] }))
        .collect();
    let other_walls: Vec<&[Point]> = enclosures.iter().filter(|o| o.path != e.path && o.path.len() >= 4).map(|o| o.path.as_slice()).collect();
    let harbour: Vec<(Point, Point, f64)> = streets
        .iter()
        .filter(|s| matches!(s.role.as_str(), "quay" | "pier" | "landing" | "mole"))
        .flat_map(|s| s.path.windows(2).enumerate().map(move |(i, w)| (w[0], w[1], s.widths.get(i).copied().unwrap_or(4.0) * 0.5 + 2.0)))
        .collect();
    let ns = normals(path);
    let on_map = |p: Point| p.x >= 0.0 && p.y >= 0.0 && p.x < surface.width && p.y < surface.width;
    // Why no ditch faces `p` (normal `n`): the cross-section the line would have dug there.
    let why = |p: Point, n: (f64, f64)| -> &'static str {
        let (a, b) = (add(p, n, lip), add(p, n, lip + width));
        let samples = [a, add(p, n, lip + 0.5 * width), b];
        if samples.iter().any(|&q| others.iter().any(|o| g::contains(o, q)) || other_walls.iter().any(|w| w.windows(2).any(|c| g::distance(q, c[0], c[1]).0 < lip))) {
            "neighbour"
        } else if samples.iter().any(|&q| harbour.iter().any(|&(c, d, hw)| g::distance(q, c, d).0 < hw)) {
            "harbour"
        } else if samples.iter().any(|&q| !on_map(q) || surface.solid(q)) {
            "blocked"
        } else if samples.iter().any(|&q| near_water(q, MOAT_SHORT, surface)) || (1..=(WATERFRONT / 5.0) as usize).any(|k| surface.wet(add(b, n, 5.0 * k as f64))) {
            // On the water, or a waterfront: open water a beach or a bank away.
            "water"
        } else if steep(surface.height_at(a), surface.height_at(b), width, m.depth_m) {
            "steep"
        } else {
            "none"
        }
    };
    // (dry, covered, sample point, normal), one per `SAMPLE` m.
    let mut samples: Vec<(bool, bool, Point, (f64, f64))> = vec![];
    for (k, w) in path.windows(2).enumerate() {
        let l = dist(w[0], w[1]);
        let steps = (l / SAMPLE).ceil().max(1.0) as usize;
        for j in 0..steps {
            let p = add(w[0], dir(w[0], w[1]), l * j as f64 / steps as f64);
            let dry = !surface.wet(p);
            samples.push((dry, dry && enters(p, add(p, ns[k], reach)), p, ns[k]));
        }
    }
    let step = found.ring_m / samples.len().max(1) as f64;
    // Uncovered stretches: maximal runs of dry, uncovered samples round the ring, of `MIN_GAP` m or
    // more (a shorter one is where the ditch swings out round a gatehouse or a ravelin).
    let open: Vec<bool> = samples.iter().map(|s| s.0 && !s.1).collect();
    let gaps: Vec<(usize, usize)> = super::moat_line::circular_runs(&open).into_iter().filter(|&(_, len)| len as f64 * step >= MIN_GAP).collect();
    let short = open.iter().filter(|&&o| o).count() - gaps.iter().map(|g| g.1).sum::<usize>();
    found.curtain_m = samples.iter().filter(|s| s.0).count() as f64 * step;
    found.covered_m = (samples.iter().filter(|s| s.1).count() + short) as f64 * step;
    for (start, len) in gaps {
        let idx: Vec<usize> = (0..len).map(|i| (start + i) % samples.len()).collect();
        let mut counts: Vec<(&'static str, usize)> = vec![];
        for &i in &idx {
            let r = why(samples[i].2, samples[i].3);
            match counts.iter_mut().find(|c| c.0 == r) {
                Some(c) => c.1 += 1,
                None => counts.push((r, 1)),
            }
        }
        let reason = counts.iter().max_by_key(|c| c.1).map_or("none", |c| c.0);
        found.uncovered.push(Uncovered { at: samples[start].2, length_m: len as f64 * step, reason });
    }
}

/// Every point where a regional road of the request `roads` crosses the curtain of `e` with no gate
/// of `e` within `GATE_GAP` of it: a road the town was to serve and turns away at a blank wall.
pub fn roads_without_gate(e: &Enclosure, roads: &[Street]) -> Vec<Point> {
    let mut out: Vec<Point> = vec![];
    for r in roads.iter().filter(|r| r.role == "regional") {
        for w in r.path.windows(2) {
            for c in e.path.windows(2) {
                if let Some((_, x)) = g::segment_hit(w[0], w[1], c[0], c[1])
                    && e.gates.iter().all(|&q| dist(q, x) >= GATE_GAP)
                    && out.iter().all(|&q| dist(q, x) >= 8.0)
                {
                    out.push(x);
                }
            }
        }
    }
    out
}
