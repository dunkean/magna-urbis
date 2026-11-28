//! The moat of a circuit (docs/MOAT_REDESIGN_2026-11-27.md): one guide ring round the works, stations that
//! carry both lips, a status per station, runs as 1D intervals of stations, and reaches with a supply and a
//! water level. `build` digs it once; streets never cut it, they cross it (`crossings`). Everything here is
//! pure: `moat` wires it into the circuit.

use std::collections::HashMap;
use crate::urban::types::{MoatCrossing, MoatReach, MoatRun};
use crate::urban::{Gatehouse, Point, Shape, Street, Surface, Work, geometry as g};
use super::geometry::{buffer_all, dist, pt};
use super::water::{MOAT_SHORT, near_water};

/// Steep stretches shorter than this (m of arc) are dug through.
const STEEP_GAP: f64 = 25.0;
/// Walls and moats first: a ditch is dug along a slope, its uphill bank simply higher. Only a cliff
/// stops it: a cross-section grade (lip to lip) above `STEEP_GRADE`, or lips that differ by more than
/// `max(STEEP_MIN, STEEP_DEPTHS × depth)` m.
const STEEP_GRADE: f64 = 0.60;
const STEEP_MIN: f64 = 8.0;
const STEEP_DEPTHS: f64 = 3.0;
/// Shortest run kept (m of arc): three ditch widths, from `MIN_RUN` to `MIN_RUN_WIDE` (a 60 m Khmer
/// ditch keeps its runs over 60 m).
const MIN_RUN: f64 = 30.0;
const MIN_RUN_WIDE: f64 = 60.0;
/// A circuit whose runs cover less than this share of its dry ring digs none: a moat is a ring, or
/// nothing, never a few scattered pieces.
const MIN_MOAT_SHARE: f64 = 0.35;
/// Rim height (m) a reach may vary by.
const REACH_STEP: f64 = 0.8;
/// A fed reach shorter than this (m of arc) is dry: on a slope a moat is dry, not a staircase of ponds.
const MIN_FED: f64 = 30.0;
/// Water (m) a fed reach keeps over its bed at least.
const MIN_WATER: f64 = 0.3;
/// The bed lies at most this many depths under the higher lip, and at least `MIN_CUT` m under the
/// lower one.
const FACE_DEPTHS: f64 = 2.0;
const MIN_CUT: f64 = 0.5;
/// Search radius (m) for the water that feeds a run end.
const SOURCE_SEARCH: f64 = 30.0;
/// Head (m) a ditch may rise above its source at the intake.
pub(super) const DEFAULT_LIFT: f64 = 0.5;
/// Head (m) per unit of the `ditch_wetness` parameter.
pub(super) const WETNESS_LIFT: f64 = 3.0;
/// Open ditch kept beyond a work, as a share of the width.
const OPEN_BEYOND_WORK: f64 = 0.6;
/// Clearance (m) of the inner lip from any work footprint.
const WORK_CLEARANCE: f64 = 1.0;
/// Factor applied to the width of a station whose quad fails the validity test, and the passes.
const SHRINK: f64 = 0.7;
const SHRINK_PASSES: usize = 4;
/// How far (in ditch widths beyond the nominal outer lip) a work may push the inner lip out.
const PUSH_WIDTHS: f64 = 4.0;
/// How far (m beyond the nominal outer lip) an island in the ditch is looked for along a station normal.
const ISLAND_RAY: f64 = 60.0;
/// A crossing record runs from this far (m) inside the inner lip to this far beyond the outer one.
const CROSS_IN: f64 = 1.0;
const CROSS_OUT: f64 = 3.0;
/// A street with more than this many ditch widths of its length inside one run runs along it.
const ALONG_WIDTHS: f64 = 2.5;
/// A gatehouse passage end this near (m) the start of a crossing is its gate; else the gate whose point
/// or passage the street passes within `PLAIN_GATE_LINE` m, within `PLAIN_GATE_REACH` of the crossing.
const GATE_REACH: f64 = 6.0;
const PLAIN_GATE_REACH: f64 = 25.0;
const PLAIN_GATE_LINE: f64 = 6.0;

/// Lip regularity of a ditch form.
#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub(super) enum Outline {
    /// Earthworks: lips wander (noise 18 % of the width).
    Rough,
    /// Revetted, timbered, canal, rock-cut: smooth (5 %).
    Regular,
    /// Bastioned, ceremonial: no noise.
    Traced,
}

/// What the cross-section of a station meets.
#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub(super) enum Status {
    Dig,
    /// On or within `MOAT_SHORT` of a water body (`judge_water`): the ditch stops short of it. Narrower
    /// water (a stream) is taken in by the ditch.
    Water,
    /// One bank stands too high above the other to dig the section.
    Steep,
    /// Off the map, cave rock, under a work, or on land another work holds (`MoatLineInput::blocked`).
    Blocked,
}

/// What stops a run.
#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub(super) enum End {
    Water,
    Slope,
    Work,
    /// The run is a closed ring.
    Closed,
}

impl End {
    fn name(self) -> &'static str {
        match self {
            End::Water => "water",
            End::Slope => "slope",
            End::Work => "work",
            End::Closed => "closed",
        }
    }
}

/// Where the water of a reach comes from.
#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub(super) enum Supply {
    /// Connected to a source and not above its head.
    Fed,
    /// A culture's wet moat without a source (rain water).
    Pool,
    Dry,
}

impl Supply {
    fn name(self) -> &'static str {
        match self {
            Supply::Fed => "fed",
            Supply::Pool => "pool",
            Supply::Dry => "dry",
        }
    }
}

/// A circuit and the nominal ditch dug round it.
#[derive(Clone, Copy)]
pub(super) struct MoatLineInput<'a> {
    /// Closed curtain path (first point repeated last).
    pub path: &'a [Point],
    /// The body the ditch is dug round: the curtain out to its outer face, the bastions and the large
    /// outworks (outer wall, wengcheng courts, barbicans). Towers and gatehouses are not in it.
    pub hull: &'a [Shape],
    /// Outer wall face offset (m) outside the path.
    pub face: f64,
    pub berm: f64,
    pub width: f64,
    pub depth: f64,
    /// Footprints the inner lip keeps `WORK_CLEARANCE` from: towers, gatehouse masses, bastions, outworks.
    pub works: &'a [Shape],
    /// Land where no station is dug (shore gaps, quays, the other circuit of a pair).
    pub blocked: &'a [Shape],
    /// Works that stand in the ditch (ravelins): the run passes between them and the curtain, and its
    /// outer lip swings out round them, `OPEN_BEYOND_WORK` widths beyond their far side.
    pub islands: &'a [Shape],
    pub surface: Surface<'a>,
    pub outline: Outline,
    pub seed: u64,
    /// Head (m) above the source the ditch may be fed to; `-inf` for a ditch that never holds water.
    pub lift: f64,
    /// The culture keeps wet moats: an unfed run holds a pool.
    pub culture_wet: bool,
    /// A canal moat: fed everywhere.
    pub canal: bool,
}

/// One cross-section of the ditch.
#[derive(Clone, Copy, Debug)]
pub(super) struct Station {
    pub inner: Point,
    pub outer: Point,
    /// Middle of the two lips.
    pub axis: Point,
    /// Lower and higher of the two lip grounds.
    pub rim: f64,
    pub top: f64,
    /// Bottom height (absolute m).
    pub bed: f64,
    pub status: Status,
    /// A dug station a stream runs into: the level (absolute m) of that water, a source of the run.
    pub inlet: Option<f64>,
}

/// What the cross-section of a station meets, before the water is judged along the ring.
#[derive(Clone, Copy, Debug)]
struct Probe {
    /// `Blocked`, `Steep` or `Dig`.
    land: Status,
    /// A sample is wet, or water lies within `MOAT_SHORT` of the section.
    touched: bool,
    /// The water there is a body: open water a ditch width across every way one width beyond the outer
    /// lip (sea, lake, wide river), or a channel `CHANNEL_BODY` m across that passes the curtain.
    body: bool,
    /// Open water at least a ditch width across starts within `WATERFRONT` beyond the outer lip: a beach
    /// or a bank away.
    front: bool,
    /// Ground of the lowest wet sample (the level of the water the section stands in), else of the
    /// narrow water it touches.
    wet: Option<f64>,
}

/// Stations `from..to` of a run (half-open) that hold one water level.
#[derive(Clone, Copy, Debug)]
pub(super) struct Reach {
    pub from: usize,
    pub to: usize,
    pub supply: Supply,
    /// Water surface (absolute m) of a fed reach.
    pub level: Option<f64>,
}

/// A maximal interval of dug stations.
#[derive(Clone, Debug)]
pub(super) struct Run {
    pub closed: bool,
    pub stations: Vec<Station>,
    pub ends: [End; 2],
    pub reaches: Vec<Reach>,
}

#[derive(Clone, Debug, Default)]
pub(super) struct MoatLine {
    /// Every station of the guide ring, with its status after the steep gaps are closed.
    pub ring: Vec<Station>,
    pub runs: Vec<Run>,
}

/// The moat line of `input`; empty when the curtain or the width is degenerate.
pub(super) fn moat_line(input: &MoatLineInput<'_>) -> MoatLine {
    let path = input.path;
    let w = input.width;
    if path.len() < 4 || !(w > 0.0) {
        return MoatLine::default();
    }
    let Some(guide) = buffer_all(&g::union(input.hull), input.berm + 0.5 * w)
        .into_iter()
        .max_by(|a, b| g::area(a).total_cmp(&g::area(b)))
    else {
        return MoatLine::default();
    };
    let raw = resample_closed(&guide.outer, (0.5 * w).clamp(2.0, 6.0));
    if raw.len() < 8 {
        return MoatLine::default();
    }
    let n = raw.len();
    let step = closed_length(&raw) / n as f64;
    let passes = smoothing_passes(w, step);
    let guide = smooth_points(&raw, passes);
    let normals = outward_normals(&guide);
    let length = closed_length(&guide);
    let step = length / n as f64;
    let at = |k: usize, t: f64| pt(guide[k].x + normals[k].0 * t, guide[k].y + normals[k].1 * t);
    let widths = (w / step).ceil() as usize;

    // Inner lip: the berm from the wall face, a metre from every work. Where a work pushes it out, the
    // push is spread over a width of arc each side and smoothed (no notch round a tower), then the
    // hard clearance is applied again only where it still fails.
    let segments = SegmentIndex::new(path, (2.0 * w).max(8.0));
    let works = ShapeIndex::new(input.works, (2.0 * w).max(8.0));
    let blocked = ShapeIndex::new(input.blocked, (2.0 * w).max(8.0));
    let need = input.face + input.berm;
    let lip_ok = |p: Point| segments.farther_than(p, need - 1e-6) && works.clear(p, WORK_CLEARANCE);
    let probe = (w / 40.0).max(0.25);
    let cap = 0.5 * w + PUSH_WIDTHS * w;
    let walk_out = |k: usize, from: f64| {
        let mut t = from;
        while t < cap && !lip_ok(at(k, t)) {
            t += probe;
        }
        t
    };
    let first: Vec<f64> = (0..n).map(|k| walk_out(k, -0.5 * w)).collect();
    let buried: Vec<bool> = first.iter().map(|&t| t >= cap).collect();
    let spread: Vec<f64> = first.iter().zip(&buried).map(|(&t, &b)| if b { -0.5 * w } else { t }).collect();
    let spread = smooth_closed(&max_filter_closed(&spread, widths), passes);
    let t_in: Vec<f64> = (0..n).map(|k| walk_out(k, spread[k]).min(cap)).collect();
    // The far side of an island on the normal of station `k` (offset from the guide), if it meets one.
    let island_end = |k: usize| {
        let (t0, t1) = (t_in[k], 0.5 * w + ISLAND_RAY);
        let (a, b) = (at(k, t0), at(k, t1));
        input
            .islands
            .iter()
            .flat_map(|s| (0..s.outer.len()).filter_map(move |i| g::segment_hit(a, b, s.outer[i], s.outer[(i + 1) % s.outer.len()])))
            .map(|(t, _)| t0 + t * (t1 - t0))
            .fold(f64::NEG_INFINITY, f64::max)
    };
    // Outer lip: nominal half width, plus room beyond the works and the islands (max-filter then
    // low-pass, so the outline is not copied), plus low-frequency noise. Widening goes outwards only.
    let extra: Vec<f64> = (0..n).map(|k| (t_in[k].max(island_end(k)) + OPEN_BEYOND_WORK * w - 0.5 * w).max(0.0)).collect();
    let extra = smooth_closed(&max_filter_closed(&extra, widths), passes);
    let amp = w * match input.outline {
        Outline::Rough => 0.18,
        Outline::Regular => 0.05,
        Outline::Traced => 0.0,
    };
    let mut t_out: Vec<f64> = (0..n)
        .map(|k| {
            let noise = if amp > 0.0 { 0.5 * (ring_noise(k as f64 * step, length, 6.0 * w, input.seed) + 1.0) } else { 0.0 };
            (0.5 * w + extra[k] + amp * noise).max(t_in[k] + 0.5)
        })
        .collect();
    let inner: Vec<Point> = (0..n).map(|k| at(k, t_in[k])).collect();
    // Validity: shrink the outer offset where a quad turns over or meets a non-neighbour.
    for pass in 0..=SHRINK_PASSES {
        let outer: Vec<Point> = (0..n).map(|k| at(k, t_out[k])).collect();
        let bad = quad_flags(&inner, &outer, (2.0 * w).max(4.0 * step));
        if pass == SHRINK_PASSES || !bad.iter().any(|&b| b) {
            break;
        }
        let mut shrink = vec![false; n];
        for k in (0..n).filter(|&k| bad[k]) {
            shrink[k] = true;
            shrink[(k + 1) % n] = true;
        }
        for k in (0..n).filter(|&k| shrink[k]) {
            t_out[k] = t_in[k] + (t_out[k] - t_in[k]) * SHRINK;
        }
    }
    let surface = input.surface;
    let probes: Vec<Probe> = (0..n)
        .map(|k| {
            let (a, b) = (inner[k], at(k, t_out[k]));
            let j = (k + 1) % n;
            if buried[k] || blocked.overlaps_quad([a, b, at(j, t_out[j]), inner[j]]) {
                return Probe { land: Status::Blocked, touched: false, body: false, front: false, wet: None };
            }
            // Half a width inside the curtain line, on the normal of the station.
            let within = at(k, t_in[k] - need - 0.5 * w);
            section(a, b, normals[k], within, w, surface, input.depth)
        })
        .collect();
    let mut ring: Vec<Station> = (0..n)
        .map(|k| {
            let (a, b) = (inner[k], at(k, t_out[k]));
            let (ha, hb) = (surface.height_at(a), surface.height_at(b));
            let rim = ha.min(hb);
            Station { inner: a, outer: b, axis: mid(a, b, 0.5), rim, top: ha.max(hb), bed: rim - input.depth, status: probes[k].land, inlet: None }
        })
        .collect();

    // 1D passes: judge the water, close short steep gaps, keep long dug runs, a ring or nothing.
    let (mut status, shore) = judge_water(&probes, (WATERFRONT_MIN / step).ceil() as usize);
    close_gaps(&mut status, Status::Steep, (STEEP_GAP / step).floor() as usize);
    for ((s, &st), p) in ring.iter_mut().zip(&status).zip(&probes) {
        s.status = st;
        s.inlet = if st == Status::Dig { p.wet } else { None };
    }
    let min_run = ((3.0 * w).clamp(MIN_RUN, MIN_RUN_WIDE) / step).ceil() as usize;
    let freeboard = (0.25 * input.depth).clamp(0.8, 1.5);
    let mut runs = vec![];
    for (start, len) in circular_runs(&status.iter().map(|&s| s == Status::Dig).collect::<Vec<_>>()) {
        if len < min_run.max(2) {
            continue;
        }
        let closed = len == n;
        // A closed run starts at its highest rim, where a dam stands anyway.
        let start = if closed { (0..n).max_by(|&a, &b| ring[a].rim.total_cmp(&ring[b].rim)).unwrap_or(0) } else { start };
        let stations: Vec<Station> = (0..len).map(|i| ring[(start + i) % n]).collect();
        let (before, after) = ((start + n - 1) % n, (start + len) % n);
        let ends = if closed { [End::Closed; 2] } else { [end_of(status[before]), end_of(status[after])] };
        // Beside a waterfront the water lies across the strip.
        let sources = if closed {
            [None, None]
        } else {
            [before, after].map(|k| (status[k] == Status::Water).then(|| source_level(ring[k].axis, if shore[k] { WATERFRONT + 2.0 * w } else { SOURCE_SEARCH }, surface)).flatten())
        };
        runs.push(run_water(stations, closed, ends, sources, input, passes, freeboard, step));
    }
    let dug: usize = runs.iter().map(|r| r.stations.len()).sum();
    let dry = status.iter().filter(|&&s| matches!(s, Status::Dig | Status::Steep)).count();
    if (dug as f64) < MIN_MOAT_SHARE * dry as f64 {
        runs.clear();
    }
    MoatLine { ring, runs }
}

/// Reaches, bed and supply of one run.
#[allow(clippy::too_many_arguments)]
fn run_water(
    mut stations: Vec<Station>,
    closed: bool,
    ends: [End; 2],
    sources: [Option<f64>; 2],
    input: &MoatLineInput<'_>,
    passes: usize,
    freeboard: f64,
    step: f64,
) -> Run {
    let depth = input.depth;
    let rim: Vec<f64> = stations.iter().map(|s| s.rim).collect();
    let bed: Vec<f64> = rim.iter().map(|r| r - depth).collect();
    let bed = if closed { smooth_closed(&bed, passes) } else { smooth_open(&bed, passes) };
    // Along a slope the uphill face stays bounded: the bed lies at most `FACE_DEPTHS` depths under
    // the higher lip, raised (smoothed) where it would lie deeper, and `MIN_CUT` m under the lower one.
    let floor: Vec<f64> = stations.iter().map(|s| s.top - FACE_DEPTHS * depth).collect();
    let bed: Vec<f64> = bed.iter().zip(&stations).map(|(b, s)| b.min(s.rim - 0.5 * depth)).collect();
    let raise: Vec<f64> = bed.iter().zip(&floor).map(|(b, f)| (f - b).max(0.0)).collect();
    let raise = if closed { smooth_closed(&raise, passes) } else { smooth_open(&raise, passes) };
    for (k, s) in stations.iter_mut().enumerate() {
        s.bed = (bed[k] + raise[k]).max(floor[k]).min(s.rim - MIN_CUT);
    }
    let n = stations.len();
    // A canal moat holds water all round, between locks: its reaches are as long as its cut allows
    // (the level of a reach, a freeboard under its lowest rim, stays `MIN_WATER` over the bed where the bank is highest, `FACE_DEPTHS` depths under it).
    let spans = split_reaches(&rim, if input.canal { REACH_STEP.max(FACE_DEPTHS * depth - freeboard - MIN_WATER - 0.1) } else { REACH_STEP });
    let nominal: Vec<f64> = spans.iter().map(|&(a, b)| rim[a..b].iter().copied().fold(f64::MAX, f64::min) - freeboard).collect();
    // A reach holds water when it is long enough and its bed may lie `MIN_WATER` under its level: one
    // whose raised bed cannot is dry, and stops the supply like a short one.
    let long: Vec<bool> = spans
        .iter()
        .enumerate()
        .map(|(i, &(a, b))| (input.canal || (b - a) as f64 * step >= MIN_FED) && (a..=b.min(n - 1)).all(|k| floor[k] <= nominal[i] - MIN_WATER))
        .collect();
    // Sources: the water at each `water` end, and every stream the run takes in, at its reach.
    let mut feeds: Vec<(usize, f64)> = vec![];
    feeds.extend(sources[0].map(|s| (0, s)));
    feeds.extend(sources[1].map(|s| (spans.len() - 1, s)));
    for (i, &(a, b)) in spans.iter().enumerate() {
        if let Some(l) = stations[a..b].iter().filter_map(|s| s.inlet).reduce(f64::min) {
            feeds.push((i, l));
        }
    }
    let fed = if input.canal { long.clone() } else { propagate(&nominal, &long, &feeds, input.lift) };
    // A stream cannot fill a ditch. Fed by the streams it takes in alone (no water body at an end), a
    // moat holds their water only when they reach `STREAM_SHARE` of the run: otherwise it stays as it is
    // without them (dry, or the rain pool of a culture that keeps wet moats), with no short pond and its
    // two dams beside a gate.
    let stream_only = sources[0].is_none() && sources[1].is_none() && !input.canal;
    let wet_len: usize = spans.iter().zip(&fed).filter(|(_, f)| **f).map(|(&(a, b), _)| b - a).sum();
    let fed = if stream_only && (wet_len as f64) < STREAM_SHARE * n as f64 { vec![false; fed.len()] } else { fed };
    // A culture that keeps wet moats holds rain water wherever no source reaches.
    let pool = input.culture_wet;
    // Neighbouring reaches without water are one reach: no dam, no level between them.
    let mut reaches: Vec<Reach> = vec![];
    for (i, &(from, to)) in spans.iter().enumerate() {
        let supply = if fed[i] { Supply::Fed } else if pool { Supply::Pool } else { Supply::Dry };
        if let Some(last) = reaches.last_mut()
            && supply != Supply::Fed
            && last.supply == supply
        {
            last.to = to;
            continue;
        }
        reaches.push(Reach { from, to, supply, level: (supply == Supply::Fed).then_some(nominal[i]) });
    }
    // A wet reach is dug below its water.
    for r in reaches.iter().filter(|r| r.supply == Supply::Fed) {
        let level = r.level.unwrap_or(f64::MAX);
        for k in r.from..=r.to.min(n - 1) {
            stations[k].bed = stations[k].bed.min(level - MIN_WATER);
        }
    }
    Run { closed, stations, ends, reaches }
}

/// The runs of `line` as the contract holds them: reaches inclusive, two neighbours sharing their
/// boundary station; the last reach of a closed run ends on station 0.
pub(super) fn export(line: &MoatLine) -> Vec<MoatRun> {
    line.runs
        .iter()
        .map(|r| {
            let n = r.stations.len();
            MoatRun {
                closed: r.closed,
                inner: r.stations.iter().map(|s| s.inner).collect(),
                outer: r.stations.iter().map(|s| s.outer).collect(),
                rim: r.stations.iter().map(|s| s.rim as f32).collect(),
                bed: r.stations.iter().map(|s| s.bed as f32).collect(),
                ends: r.ends.map(|e| e.name().to_string()),
                reaches: r
                    .reaches
                    .iter()
                    .map(|x| MoatReach {
                        from: x.from,
                        to: if x.to < n { x.to } else if r.closed { 0 } else { n - 1 },
                        supply: x.supply.name().into(),
                        level: x.level.map(|l| l as f32),
                    })
                    .collect(),
            }
        })
        .collect()
}

// --- Derived from the contract runs ------------------------------------------------------------

/// Station indices of reach `r` of `run`, in walking order.
fn reach_stations(run: &MoatRun, r: &MoatReach) -> Vec<usize> {
    let n = run.inner.len();
    if r.to > r.from || !run.closed {
        (r.from..=r.to.min(n.saturating_sub(1))).collect()
    } else {
        (r.from..n).chain(0..=r.to).collect()
    }
}

/// The reach each station of `run` belongs to (a boundary station to the reach it starts).
fn station_reaches(run: &MoatRun) -> Vec<usize> {
    let n = run.inner.len();
    let mut label = vec![0; n];
    for (i, r) in run.reaches.iter().enumerate() {
        let end = run.reaches.get(i + 1).map_or(n, |next| next.from);
        for l in label.iter_mut().take(end).skip(r.from) {
            *l = i;
        }
    }
    label
}

/// The strip between the lips of the stations `idx`.
fn strip(run: &MoatRun, idx: &[usize]) -> Shape {
    let mut ring: Vec<Point> = idx.iter().map(|&i| run.inner[i]).collect();
    ring.extend(idx.iter().rev().map(|&i| run.outer[i]));
    g::normalized(Shape { outer: ring, holes: vec![] })
}

/// The ground the whole run digs: an annulus for a closed run.
pub(super) fn run_outline(run: &MoatRun) -> Shape {
    if run.closed {
        return g::normalized(Shape { outer: run.outer.clone(), holes: vec![run.inner.clone()] });
    }
    strip(run, &(0..run.inner.len()).collect::<Vec<_>>())
}

/// The run with the land inside its outer lip, for bands laid beyond it: a closed run is filled.
pub(super) fn outer_fill(run: &MoatRun) -> Shape {
    if run.closed { g::normalized(Shape { outer: run.outer.clone(), holes: vec![] }) } else { run_outline(run) }
}

/// Ditch pieces kept per reach in `Enclosure::ditch`, before the detached ditches.
pub(super) fn reach_count(runs: &[MoatRun]) -> usize {
    runs.iter().map(|r| r.reaches.len()).sum()
}

/// One ditch piece per reach, in run and reach order: kind `wet` (fed), `pool` or `dry`.
pub(super) fn ditch(runs: &[MoatRun], depth: f64) -> Vec<Work> {
    let mut out = vec![];
    for run in runs {
        for r in &run.reaches {
            let shape = if run.closed && run.reaches.len() == 1 { run_outline(run) } else { strip(run, &reach_stations(run, r)) };
            let kind = if r.supply == "fed" { "wet" } else { r.supply.as_str() };
            out.push(Work { kind: kind.into(), shape, height_m: depth, passage: None });
        }
    }
    out
}

/// Share of a run the streams it takes in must reach for them to keep it wet.
const STREAM_SHARE: f64 = 0.25;
/// The sea, a lake or a wide river a beach or a bank away guards a front, and no ditch is dug on the strip
/// between: the widest strip (m, beyond the outer lip), the least water (m, or a ditch width) along the
/// normal, its sampling step, and the shortest stretch (m) of such sections that is a waterfront. A
/// corner that merely looks at the water is dug on to it.
pub(super) const WATERFRONT: f64 = 60.0;
const WATERFRONT_WATER: f64 = 10.0;
const WATERFRONT_STEP: f64 = 2.0;
const WATERFRONT_MIN: f64 = 40.0;
/// Width (m, along the wall) from which a channel that passes the curtain stops the ditch as a water body.
const CHANNEL_BODY: f64 = 8.0;

/// A dam (inner lip, outer lip) wherever held water would otherwise run out: where two fed reaches of a
/// run meet, and where a fed reach meets one without water whose bed lies under its level there (a
/// bed that rises above the level ends the water by itself).
pub(super) fn dams(runs: &[MoatRun]) -> Vec<[Point; 2]> {
    let mut out = vec![];
    for run in runs {
        let m = run.reaches.len();
        let level = |i: usize| run.reaches[i].level.filter(|_| run.reaches[i].supply == "fed");
        // The boundary station between reach `i` and the next one round the run.
        let mut boundary = |i: usize, j: usize, k: usize| {
            let held = match (level(i), level(j)) {
                (Some(_), Some(_)) => true,
                (Some(l), None) | (None, Some(l)) => run.bed.get(k).is_some_and(|&bed| bed < l),
                (None, None) => false,
            };
            if held {
                out.push([run.inner[k], run.outer[k]]);
            }
        };
        for i in 1..m {
            boundary(i - 1, i, run.reaches[i].from);
        }
        if run.closed && m > 1 {
            boundary(m - 1, 0, 0);
        }
    }
    out
}

/// A sluice at each `water` end of a run whose end reach is fed: from the middle of the end station to
/// the nearest open water.
pub(super) fn sluices(runs: &[MoatRun], surface: Surface<'_>) -> Vec<[Point; 2]> {
    let mut out = vec![];
    for run in runs.iter().filter(|r| !r.closed && !r.inner.is_empty()) {
        let n = run.inner.len();
        for (side, k, reach) in [(0, 0, run.reaches.first()), (1, n - 1, run.reaches.last())] {
            if run.ends[side] != "water" || reach.is_none_or(|r| r.supply != "fed") {
                continue;
            }
            let p = mid(run.inner[k], run.outer[k], 0.5);
            if let Some(q) = nearest_water(p, WATERFRONT + 2.0 * dist(run.inner[k], run.outer[k]), surface) {
                out.push([p, q]);
            }
        }
    }
    out
}

/// Share of the pool sections of a run whose outer bank lies within the built town for the town to
/// have grown round it (an old ring inside the town): its pools dry.
const EMBEDDED_SHARE: f64 = 0.9;

/// A culture's wet moat keeps its rain pools; only a run the built town has grown round
/// (`EMBEDDED_SHARE` of its pool sections) dries, whole: never a staircase of pools and dry pieces.
pub(super) fn dry_pools(run: &mut MoatRun, embedded: impl Fn(Point, Point) -> bool) {
    let edges: Vec<[usize; 2]> = run.reaches.iter().filter(|r| r.supply == "pool").flat_map(|r| reach_stations(run, r).windows(2).map(|e| [e[0], e[1]]).collect::<Vec<_>>()).collect();
    if edges.is_empty() { return; }
    let inside = edges.iter().filter(|&&[i, j]| embedded(mid(run.inner[i], run.inner[j], 0.5), mid(run.outer[i], run.outer[j], 0.5))).count();
    if (inside as f64) < EMBEDDED_SHARE * edges.len() as f64 { return; }
    let mut reaches: Vec<MoatReach> = vec![];
    for mut reach in std::mem::take(&mut run.reaches) {
        if reach.supply == "pool" {
            reach.supply = "dry".into();
        }
        // Neighbouring reaches without water are one reach.
        if let Some(last) = reaches.last_mut().filter(|last| last.supply == "dry" && reach.supply == "dry") {
            last.to = reach.to;
        } else {
            reaches.push(reach);
        }
    }
    run.reaches = reaches;
}

// --- Crossings ----------------------------------------------------------------------------------

/// A crossing of the lips of a run by a street, at `arc` m along the street.
#[derive(Clone, Copy)]
struct LipHit {
    arc: f64,
    outer: bool,
    station: usize,
    segment: usize,
}

/// Read a deck and its unbranched ramps as one centreline without changing the street graph.
fn crossing_lines(streets: &[Street]) -> Vec<std::borrow::Cow<'_, Street>> {
    use crate::urban::network::key;
    use std::borrow::Cow;
    let mut ends = HashMap::new();
    let usable = |s: &Street| s.role != "wall-lane" && s.path.len() >= 2;
    for (i, s) in streets.iter().enumerate().filter(|(_, s)| usable(s)) {
        for (back, p) in [(false, s.path[0]), (true, s.path[s.path.len() - 1])] {
            ends.entry(key(p)).or_insert_with(Vec::new).push((i, back));
        }
    }
    let span = |i: usize| matches!(streets[i].role.as_str(), "approach" | "bridge" | "causeway" | "ford");
    let mut used = vec![false; streets.len()];
    let mut lines = vec![];
    for (i, s) in streets.iter().enumerate() {
        if used[i] || !usable(s) { continue; }
        used[i] = true;
        let mut chain = std::collections::VecDeque::from([(i, false)]);
        for prepend in [false, true] {
            let (mut current, mut back) = (i, !prepend);
            loop {
                let path = &streets[current].path;
                let end = path[if back { path.len() - 1 } else { 0 }];
                let joints = &ends[&key(end)];
                if joints.len() != 2 { break; }
                let Some(&(next, at_back)) = joints.iter().find(|&&(j, _)| !used[j]) else { break };
                if !span(current) && !span(next) { break; }
                used[next] = true;
                if prepend { chain.push_front((next, !at_back)); } else { chain.push_back((next, at_back)); }
                (current, back) = (next, !at_back);
            }
        }
        if chain.len() == 1 {
            lines.push(Cow::Borrowed(s));
            continue;
        }
        let mut joined = Street { path: vec![], widths: vec![], rank: s.rank, role: s.role.clone() };
        let mut last = s.path[0];
        for (j, reverse) in chain {
            let part = &streets[j];
            let n = part.path.len();
            for k in 0..n - 1 {
                let segment = if reverse { n - 2 - k } else { k };
                joined.path.push(part.path[if reverse { segment + 1 } else { segment }]);
                joined.widths.push(part.widths.get(segment).or(part.widths.last()).copied().unwrap_or(4.0));
            }
            last = part.path[if reverse { 0 } else { n - 1 }];
        }
        joined.path.push(last);
        joined.widths.push(*joined.widths.last().unwrap());
        lines.push(Cow::Owned(joined));
    }
    lines
}

/// An imported deck in the moat belongs to a gate crossing. Keep a missing piece of that
/// crossing, and leave out a duplicate deck or a regional span left stranded by a diversion.
pub(in crate::urban) fn add_regional_spans<'a>(
    enclosures: &[crate::urban::Enclosure], streets: &mut Vec<Street>, spans: impl Iterator<Item = &'a Street>,
) {
    let bands: Vec<_> = enclosures.iter().flat_map(|e| &e.ditch).map(|d| (&d.shape, bounds(&d.shape.outer, 0.0))).collect();
    let on_line = |q, path: &[Point]| path.windows(2).any(|w| g::distance(q, w[0], w[1]).0 < 0.25);
    let mut in_band = vec![];
    for span in spans {
        let touches = span.path.windows(2).any(|w| bands.iter().any(|&(shape, bbox)| {
            meets(bounds(w, 0.0), bbox) && (g::contains(shape, w[0]) || g::contains(shape, w[1])
                || std::iter::once(&shape.outer).chain(&shape.holes).any(|ring| {
                    (0..ring.len()).any(|i| g::segment_hit(w[0], w[1], ring[i], ring[(i + 1) % ring.len()]).is_some())
                }))
        }));
        if !touches {
            streets.push(span.clone());
        } else if !streets.iter().chain(in_band.iter()).any(|s| {
            span.path.windows(2).all(|w| [w[0], mid(w[0], w[1], 0.5), w[1]].iter().all(|&p| on_line(p, &s.path)))
        }) {
            in_band.push(span.clone());
        }
    }
    if in_band.is_empty() { return; }
    let existing = streets.len();
    streets.append(&mut in_band);
    let crossings: Vec<_> = enclosures.iter().filter_map(|e| e.moat.as_ref().map(|m|
        crossings(&m.runs, &e.gates, &e.gatehouses, streets, false).0
    )).flatten().filter(|c| c.gate.is_some()).collect();
    let mut imported = streets.split_off(existing);
    imported.retain(|s| crossings.iter().any(|c| c.path.windows(2).any(|w|
        on_line(w[0], &s.path) && on_line(w[1], &s.path)
    )));
    streets.append(&mut imported);
}

/// Every street that crosses a run from one lip to the other (wall-lanes aside): one record from
/// `CROSS_IN` m inside the inner lip to `CROSS_OUT` m beyond the outer one, with the gate it leaves
/// by. A causeway where the reaches it meets are dry and the ditch is earth, a bridge elsewhere. A
/// long traversal without a gate may follow the ditch instead. Its length is reported in metres.
pub(super) fn crossings(runs: &[MoatRun], gates: &[Point], gatehouses: &[Gatehouse], streets: &[Street], earth: bool) -> (Vec<MoatCrossing>, f64) {
    let mut out = vec![];
    let mut along = 0.0;
    if runs.is_empty() { return (out, along); }
    let streets = crossing_lines(streets);
    for (ri, run) in runs.iter().enumerate() {
        let n = run.inner.len();
        if n < 2 {
            continue;
        }
        let width = run.inner.iter().zip(&run.outer).map(|(&a, &b)| dist(a, b)).fold(0.0, f64::max);
        let m = if run.closed { n } else { n - 1 };
        // Lip segments: (outer, station, a, b).
        let lips: Vec<(bool, usize, Point, Point)> = [false, true]
            .iter()
            .flat_map(|&outer| {
                let lip = if outer { &run.outer } else { &run.inner };
                (0..m).map(move |k| (outer, k, lip[k], lip[(k + 1) % n]))
            })
            .collect();
        let mut grid = Grid::new((2.0 * width).max(16.0));
        for (i, l) in lips.iter().enumerate() {
            grid.insert(i, bounds(&[l.2, l.3], 0.0));
        }
        let outline = run_outline(run);
        let label = station_reaches(run);
        let dry = |k: usize| run.reaches[label[k]].supply == "dry";
        let mut near = vec![];
        for s in &streets {
            let cum: Vec<f64> = std::iter::once(0.0).chain(s.path.windows(2).scan(0.0, |acc, w| { *acc += dist(w[0], w[1]); Some(*acc) })).collect();
            let mut hits: Vec<LipHit> = vec![];
            for (j, w) in s.path.windows(2).enumerate() {
                grid.query(bounds(w, 0.0), &mut near);
                for &i in &near {
                    let (outer, station, a, b) = lips[i];
                    let hit = g::segment_hit(w[0], w[1], a, b).or_else(|| {
                        (j == 0).then(|| g::segment_hit(w[1], w[0], a, b).map(|(t, p)| (1.0 - t, p))).flatten()
                    });
                    if let Some((t, _)) = hit {
                        hits.push(LipHit { arc: cum[j] + t * (cum[j + 1] - cum[j]), outer, station, segment: j });
                    }
                }
            }
            hits.sort_by(|a, b| a.arc.total_cmp(&b.arc));
            hits.dedup_by(|b, a| b.outer == a.outer && (b.arc - a.arc).abs() < 1e-6);
            for pair in hits.windows(2) {
                let (h0, h1) = (pair[0], pair[1]);
                let inside = h1.arc - h0.arc;
                let middle = point_at(&s.path, &cum, 0.5 * (h0.arc + h1.arc));
                if h0.outer == h1.outer {
                    if g::contains(&outline, middle) {
                        along += inside;
                    }
                    continue;
                }
                if !g::contains(&outline, middle) { continue; }
                // Walking from the curtain side out.
                let outward = !h0.outer;
                let path = if outward {
                    slice(&s.path, &cum, h0.arc - CROSS_IN, h1.arc + CROSS_OUT)
                } else {
                    let mut p = slice(&s.path, &cum, h0.arc - CROSS_OUT, h1.arc + CROSS_IN);
                    p.reverse();
                    p
                };
                let at_inner = if outward { h0 } else { h1 };
                let half = s.widths.get(at_inner.segment).or(s.widths.first()).copied().unwrap_or(4.0) * 0.5 + 0.5;
                let start = path[0];
                let gate = gatehouses
                    .iter()
                    .filter(|gh| !matches!(gh.kind.as_str(), "water" | "shore" | "ravelin"))
                    .find(|gh| gh.passage.iter().any(|&p| dist(p, start) <= GATE_REACH))
                    .map(|gh| gh.gate)
                    .or_else(|| {
                        // The gate this street passes: the nearest one on its line, however wide the berm,
                        // the ditch and the works that stand between the gate and the crossing.
                        let local_width = dist(run.inner[at_inner.station], run.outer[at_inner.station]).max(1.0);
                        let reach = PLAIN_GATE_REACH.max(3.0 * width + 40.0) * (inside / local_width).max(1.0);
                        gates.iter().enumerate().filter(|(_, q)| dist(**q, start) <= reach)
                            .flat_map(|(i, &q)| {
                                // The gate point and the ends of its passage.
                                let passage = gatehouses.iter().filter(move |gh| gh.gate == i && !matches!(gh.kind.as_str(), "water" | "shore")).flat_map(|gh| gh.passage);
                                std::iter::once(q).chain(passage).map(move |q| (i, q))
                            })
                            .filter_map(|(i, q)| {
                                let gap = s.path.windows(2).enumerate().filter_map(|(j, w)| {
                                    let (d, t, _) = g::distance(q, w[0], w[1]);
                                    let arc = cum[j] + t * (cum[j + 1] - cum[j]);
                                    let back = if outward { at_inner.arc - arc } else { arc - at_inner.arc };
                                    (d <= PLAIN_GATE_LINE && (-PLAIN_GATE_LINE..=reach).contains(&back)).then_some(back.abs())
                                }).reduce(f64::min)?;
                                Some((i, gap))
                            })
                            .min_by(|a, b| a.1.total_cmp(&b.1)).map(|(i, _)| i)
                    });
                if gate.is_none() && inside > ALONG_WIDTHS * width {
                    along += inside;
                    continue;
                }
                let kind = if earth && dry(h0.station) && dry(h1.station) { "causeway" } else { "bridge" };
                out.push(MoatCrossing { run: ri, path, half_width_m: half, kind: kind.into(), gate });
            }
        }
    }
    (out, along)
}

/// The point `s` m along the polyline `path` (cumulative arcs `cum`), clamped to it.
fn point_at(path: &[Point], cum: &[f64], s: f64) -> Point {
    let total = cum[cum.len() - 1];
    let s = s.clamp(0.0, total);
    let j = (0..path.len() - 1).find(|&j| cum[j + 1] >= s).unwrap_or(path.len() - 2);
    let l = (cum[j + 1] - cum[j]).max(1e-12);
    mid(path[j], path[j + 1], ((s - cum[j]) / l).clamp(0.0, 1.0))
}

/// The part of the polyline `path` from `s0` to `s1` m along it, clamped to it.
fn slice(path: &[Point], cum: &[f64], s0: f64, s1: f64) -> Vec<Point> {
    let total = cum[cum.len() - 1];
    let (s0, s1) = (s0.clamp(0.0, total), s1.clamp(0.0, total));
    let mut out = vec![point_at(path, cum, s0)];
    out.extend((1..path.len() - 1).filter(|&j| cum[j] > s0 && cum[j] < s1).map(|j| path[j]));
    out.push(point_at(path, cum, s1));
    out
}

fn end_of(status: Status) -> End {
    match status {
        Status::Water => End::Water,
        Status::Steep => End::Slope,
        Status::Blocked | Status::Dig => End::Work,
    }
}

fn mid(a: Point, b: Point, t: f64) -> Point {
    pt(a.x + (b.x - a.x) * t, a.y + (b.y - a.y) * t)
}

fn on_map(p: Point, surface: Surface<'_>) -> bool {
    p.x >= 0.0 && p.y >= 0.0 && p.x < surface.width && p.y < surface.width
}

/// What the cross-section from `inner` to `outer` (outward normal `n`, ditch width `w`) meets; `within`
/// is a point inside the curtain on the same normal.
fn section(inner: Point, outer: Point, n: (f64, f64), within: Point, w: f64, surface: Surface<'_>, depth: f64) -> Probe {
    let samples = [inner, mid(inner, outer, 0.25), mid(inner, outer, 0.5), mid(inner, outer, 0.75), outer];
    // Off-map points and cave rock read as wet in `Surface`: told apart here, never water.
    if samples.iter().any(|&p| !on_map(p, surface) || surface.solid(p)) {
        return Probe { land: Status::Blocked, touched: false, body: false, front: false, wet: None };
    }
    let open = |p: Point| on_map(p, surface) && surface.wet(p) && !surface.solid(p);
    let wet = samples.iter().filter(|&&p| surface.wet(p)).map(|&p| surface.height_at(p)).reduce(f64::min);
    let touched = wet.is_some() || [samples[0], samples[2], samples[4]].iter().any(|&p| near_water(p, MOAT_SHORT, surface));
    // Open water a ditch width across every way, `d` m beyond the outer lip.
    let open_beyond = |d: f64| {
        let far = pt(outer.x + n.0 * d, outer.y + n.1 * d);
        let h = 0.5 * w;
        [(0.0, 0.0), (n.0, n.1), (-n.0, -n.1), (-n.1, n.0), (n.1, -n.0)].iter().all(|&(dx, dy)| open(pt(far.x + dx * h, far.y + dy * h)))
    };
    // A waterfront: from the inner lip to `WATERFRONT` m beyond the outer one, the normal runs over open
    // water for a ditch width or more (a stream is narrower); or a channel flows where the ditch would be
    // dug, over half the section: it is the moat of that front.
    let front = {
        let band = dist(inner, outer);
        let (mut span, mut widest, mut in_band) = (0.0_f64, 0.0_f64, 0.0_f64);
        let mut d = 0.0;
        while d <= band + WATERFRONT + w.max(WATERFRONT_WATER) {
            let wet = open(pt(inner.x + n.0 * d, inner.y + n.1 * d));
            span = if wet { span + WATERFRONT_STEP } else { 0.0 };
            // The water starts within the strip.
            if span > 0.0 && d - span <= band + WATERFRONT {
                widest = widest.max(span);
            }
            if wet && d <= band {
                in_band += WATERFRONT_STEP;
            }
            d += WATERFRONT_STEP;
        }
        widest >= w.max(WATERFRONT_WATER) || in_band >= 0.5 * band
    };
    // A channel that passes the curtain, `CHANNEL_BODY` m across or more along the wall: a stream is
    // narrower, and the ditch takes it in.
    let through = open(within) && {
        let reach = |side: f64| (1..=CHANNEL_BODY as usize).take_while(|&k| open(pt(within.x - side * n.1 * k as f64, within.y + side * n.0 * k as f64))).count();
        (reach(1.0) + reach(-1.0) + 1) as f64 >= CHANNEL_BODY
    };
    let body = touched && (open_beyond(w) || through);
    let land = if steep(surface.height_at(inner), surface.height_at(outer), dist(inner, outer), depth) { Status::Steep } else { Status::Dig };
    // A stream beside the section, not on it, is reached by a short feeder.
    let wet = if touched && !body { wet.or_else(|| source_level(samples[2], SOURCE_SEARCH, surface)) } else { wet };
    Probe { land, touched, body, front, wet }
}

/// A cross-section too steep to dig: a cliff, not a slope (`STEEP_GRADE`, `STEEP_MIN`).
pub(super) fn steep(inner: f64, outer: f64, span: f64, depth: f64) -> bool {
    let rise = (inner - outer).abs();
    rise > STEEP_GRADE * span.max(1e-6) || rise > STEEP_MIN.max(STEEP_DEPTHS * depth)
}

/// Status of each station once its water is judged along the ring: the stations of a stretch touched
/// by water (`Probe::touched`) that is a body at one of them at least are `Water`, the ditch stopping
/// short of it as of a shore; a stretch touched only by narrow water (a stream, a few wet cells) keeps
/// its land status, and the ditch takes the stream in (`Station::inlet`).
fn judge_water(probes: &[Probe], min_front: usize) -> (Vec<Status>, Vec<bool>) {
    let n = probes.len();
    let mut status: Vec<Status> = probes.iter().map(|p| p.land).collect();
    for (start, len) in circular_runs(&probes.iter().map(|p| p.land != Status::Blocked && p.touched).collect::<Vec<_>>()) {
        if (0..len).any(|i| probes[(start + i) % n].body) {
            for i in 0..len {
                status[(start + i) % n] = Status::Water;
            }
        }
    }
    // Waterfronts: `Water` too. The ditch beside them stops at the strip, fed across it.
    let mut shore = vec![false; n];
    for (start, len) in circular_runs(&(0..n).map(|i| status[i] == Status::Dig && probes[i].front).collect::<Vec<_>>()) {
        if len >= min_front.max(1) {
            for i in 0..len {
                status[(start + i) % n] = Status::Water;
                shore[(start + i) % n] = true;
            }
        }
    }
    (status, shore)
}

/// The open water nearest `from` within `reach` m, on sixteen bearings.
fn nearest_water(from: Point, reach: f64, surface: Surface<'_>) -> Option<Point> {
    let open = |p: Point| on_map(p, surface) && surface.wet(p) && !surface.solid(p);
    (0..=reach as usize).find_map(|r| {
        let dirs = if r == 0 { 1 } else { 16 };
        (0..dirs).find_map(|k| {
            let a = f64::from(k) * std::f64::consts::TAU / 16.0;
            let p = pt(from.x + a.cos() * r as f64, from.y + a.sin() * r as f64);
            open(p).then_some(p)
        })
    })
}

/// Height of the open water nearest `from`: the water level the geography carries, else (`Surface` has
/// heights only) 0 for the sea over its bed and the ground of its sample for a river or a lake.
fn source_level(from: Point, reach: f64, surface: Surface<'_>) -> Option<f64> {
    nearest_water(from, reach, surface).map(|p| {
        if let Some(level) = surface.geometry.and_then(|geometry| geometry.water_level(p)) {
            return level;
        }
        let n = surface.n;
        let cell = |v: f64| ((v / surface.width * n as f64) as usize).min(n - 1);
        let ground = surface.height_at(p);
        if surface.water[cell(p.y) * n + cell(p.x)] == 1 { ground.max(0.0) } else { ground }
    })
}

/// Flags of the quads `k` (stations `k`, `k + 1`) that turn over or cross a non-neighbour.
fn quad_flags(inner: &[Point], outer: &[Point], cell: f64) -> Vec<bool> {
    let n = inner.len();
    let tri = |a: Point, b: Point, c: Point| (b.x - a.x) * (c.y - a.y) - (b.y - a.y) * (c.x - a.x);
    let halves: Vec<(f64, f64)> = (0..n)
        .map(|k| {
            let j = (k + 1) % n;
            (tri(inner[k], inner[j], outer[j]), tri(inner[k], outer[j], outer[k]))
        })
        .collect();
    let sign = if halves.iter().map(|h| h.0 + h.1).sum::<f64>() >= 0.0 { 1.0 } else { -1.0 };
    let mut bad: Vec<bool> = halves.iter().map(|h| h.0 * sign <= 0.0 || h.1 * sign <= 0.0).collect();
    let edges = |k: usize| {
        let j = (k + 1) % n;
        [(inner[k], inner[j]), (inner[j], outer[j]), (outer[j], outer[k]), (outer[k], inner[k])]
    };
    let boxes: Vec<Bounds> = (0..n).map(|k| bounds(&[inner[k], inner[(k + 1) % n], outer[k], outer[(k + 1) % n]], 0.0)).collect();
    let mut grid = Grid::new(cell);
    for (k, b) in boxes.iter().enumerate() {
        grid.insert(k, *b);
    }
    let mut near = vec![];
    for k in 0..n {
        grid.query(boxes[k], &mut near);
        for &j in near.iter().filter(|&&j| j > k) {
            let d = (j - k).min(n - (j - k));
            if d <= 1 || !meets(boxes[k], boxes[j]) {
                continue;
            }
            let (ek, ej) = (edges(k), edges(j));
            if ek.iter().any(|&(a, b)| ej.iter().any(|&(c, e)| g::segment_hit(a, b, c, e).is_some())) {
                bad[k] = true;
                bad[j] = true;
            }
        }
    }
    bad
}

/// Quads of an exported run that turn over (against the orientation of most of them).
pub(super) fn turned_quads(run: &MoatRun) -> usize {
    let n = run.inner.len();
    if n < 2 {
        return 0;
    }
    let m = if run.closed { n } else { n - 1 };
    let tri = |a: Point, b: Point, c: Point| (b.x - a.x) * (c.y - a.y) - (b.y - a.y) * (c.x - a.x);
    let signs: Vec<f64> = (0..m)
        .map(|k| {
            let j = (k + 1) % n;
            tri(run.inner[k], run.inner[j], run.outer[j]) + tri(run.inner[k], run.outer[j], run.outer[k])
        })
        .collect();
    let sign = if signs.iter().sum::<f64>() >= 0.0 { 1.0 } else { -1.0 };
    signs.iter().filter(|&&s| s * sign <= 0.0).count()
}

// --- 1D passes on station sequences -----------------------------------------------------------

/// Maximal circular intervals of `true` as (start, length); the whole ring is `(0, n)`.
pub(super) fn circular_runs(mask: &[bool]) -> Vec<(usize, usize)> {
    let n = mask.len();
    let Some(first_false) = mask.iter().position(|&m| !m) else {
        return if n == 0 { vec![] } else { vec![(0, n)] };
    };
    let mut out = vec![];
    let mut k = 0;
    while k < n {
        let i = (first_false + 1 + k) % n;
        if mask[i] {
            let mut len = 0;
            while k < n && mask[(first_false + 1 + k) % n] {
                len += 1;
                k += 1;
            }
            out.push((i, len));
        } else {
            k += 1;
        }
    }
    out
}

/// On a closed ring, every run of `gap` no longer than `max` stations that `Dig` bounds on both
/// sides becomes `Dig`.
pub(super) fn close_gaps(status: &mut [Status], gap: Status, max: usize) {
    let n = status.len();
    for (start, len) in circular_runs(&status.iter().map(|&s| s == gap).collect::<Vec<_>>()) {
        if len > max || len == n {
            continue;
        }
        if status[(start + n - 1) % n] == Status::Dig && status[(start + len) % n] == Status::Dig {
            for i in 0..len {
                status[(start + i) % n] = Status::Dig;
            }
        }
    }
}

/// Greedy split of `rim` into half-open ranges whose rim varies by at most `tolerance`.
pub(super) fn split_reaches(rim: &[f64], tolerance: f64) -> Vec<(usize, usize)> {
    let mut out = vec![];
    let (mut start, mut lo, mut hi) = (0, f64::MAX, f64::MIN);
    for (i, &r) in rim.iter().enumerate() {
        let (l, h) = (lo.min(r), hi.max(r));
        if i > start && h - l > tolerance {
            out.push((start, i));
            start = i;
            lo = r;
            hi = r;
        } else {
            lo = l;
            hi = h;
        }
    }
    if start < rim.len() {
        out.push((start, rim.len()));
    }
    out
}

/// Fed flags of reaches with `levels`, from `sources` (reach, water level): from each source both
/// ways, a reach is fed while it is `long` enough and its level is not above the head left, which
/// starts at the source plus `lift` and never rises again.
pub(super) fn propagate(levels: &[f64], long: &[bool], sources: &[(usize, f64)], lift: f64) -> Vec<bool> {
    let m = levels.len();
    let mut fed = vec![false; m];
    for &(at, source) in sources.iter().filter(|s| s.0 < m) {
        for forward in [true, false] {
            let (mut i, mut head) = (at, source + lift);
            while levels[i] <= head && long[i] {
                fed[i] = true;
                head = head.min(levels[i]);
                match (forward, i) {
                    (true, i0) if i0 + 1 < m => i += 1,
                    (false, i0) if i0 > 0 => i -= 1,
                    _ => break,
                }
            }
        }
    }
    fed
}

/// Periodic value noise in [-1, 1] along a ring of `total` m, about one cell per `wavelength`.
pub(super) fn ring_noise(s: f64, total: f64, wavelength: f64, seed: u64) -> f64 {
    let cells = ((total / wavelength.max(1e-9)).round() as u64).max(1);
    let u = (s / total.max(1e-9)).rem_euclid(1.0) * cells as f64;
    let i = (u.floor() as u64) % cells;
    let f = u - u.floor();
    let (a, b) = (hash01(seed, i), hash01(seed, (i + 1) % cells));
    let t = f * f * (3.0 - 2.0 * f);
    2.0 * (a + (b - a) * t) - 1.0
}

fn hash01(seed: u64, i: u64) -> f64 {
    let mut z = seed ^ i.wrapping_mul(0x9E37_79B9_7F4A_7C15);
    z = (z ^ (z >> 30)).wrapping_mul(0xBF58_476D_1CE4_E5B9);
    z = (z ^ (z >> 27)).wrapping_mul(0x94D0_49BB_1331_11EB);
    z ^= z >> 31;
    (z >> 11) as f64 / (1u64 << 53) as f64
}

/// FNV-1a of the rounded path coordinates: a stable noise seed per circuit.
pub(super) fn path_seed(path: &[Point]) -> u64 {
    let mut hash = 0xcbf29ce484222325u64;
    for p in path {
        for coord in [p.x, p.y] {
            for byte in ((coord * 100.0).round() as i64).to_le_bytes() {
                hash = (hash ^ u64::from(byte)).wrapping_mul(0x100000001b3);
            }
        }
    }
    hash
}

/// Binomial passes whose window is about two widths of arc: σ = w / 2, one [1, 2, 1] / 4 pass adds
/// half a station² of variance.
fn smoothing_passes(w: f64, step: f64) -> usize {
    ((w * w) / (2.0 * step * step)).round().clamp(1.0, 64.0) as usize
}

fn smooth_closed(v: &[f64], passes: usize) -> Vec<f64> {
    let n = v.len();
    let mut a = v.to_vec();
    if n < 3 {
        return a;
    }
    for _ in 0..passes {
        a = (0..n).map(|i| 0.25 * a[(i + n - 1) % n] + 0.5 * a[i] + 0.25 * a[(i + 1) % n]).collect();
    }
    a
}

fn smooth_open(v: &[f64], passes: usize) -> Vec<f64> {
    let n = v.len();
    let mut a = v.to_vec();
    if n < 3 {
        return a;
    }
    for _ in 0..passes {
        a = (0..n).map(|i| 0.25 * a[i.saturating_sub(1)] + 0.5 * a[i] + 0.25 * a[(i + 1).min(n - 1)]).collect();
    }
    a
}

fn max_filter_closed(v: &[f64], half: usize) -> Vec<f64> {
    let n = v.len();
    let half = half.min(n / 2);
    (0..n).map(|i| (0..=2 * half).map(|d| v[(i + n + d - half) % n]).fold(f64::MIN, f64::max)).collect()
}

fn smooth_points(p: &[Point], passes: usize) -> Vec<Point> {
    let xs = smooth_closed(&p.iter().map(|q| q.x).collect::<Vec<_>>(), passes);
    let ys = smooth_closed(&p.iter().map(|q| q.y).collect::<Vec<_>>(), passes);
    xs.into_iter().zip(ys).map(|(x, y)| pt(x, y)).collect()
}

fn closed_length(p: &[Point]) -> f64 {
    let n = p.len();
    (0..n).map(|i| dist(p[i], p[(i + 1) % n])).sum()
}

/// A closed ring resampled at a uniform arc step close to `step` (at least eight points).
fn resample_closed(ring: &[Point], step: f64) -> Vec<Point> {
    let n = ring.len();
    if n < 3 {
        return vec![];
    }
    let total = closed_length(ring);
    if !(total > 0.0) {
        return vec![];
    }
    let m = ((total / step).ceil() as usize).max(8);
    let mut out = Vec::with_capacity(m);
    let (mut seg, mut at) = (0usize, 0.0);
    for k in 0..m {
        let s = total * k as f64 / m as f64;
        while seg < n - 1 && at + dist(ring[seg], ring[seg + 1]) < s {
            at += dist(ring[seg], ring[seg + 1]);
            seg += 1;
        }
        let (a, b) = (ring[seg], ring[(seg + 1) % n]);
        let l = dist(a, b);
        out.push(mid(a, b, if l > 1e-12 { ((s - at) / l).clamp(0.0, 1.0) } else { 0.0 }));
    }
    out
}

/// Unit normals of a closed ring by central differences, pointing away from its interior.
fn outward_normals(p: &[Point]) -> Vec<(f64, f64)> {
    let n = p.len();
    let sign = if g::signed(p) >= 0.0 { 1.0 } else { -1.0 };
    (0..n)
        .map(|k| {
            let (a, b) = (p[(k + n - 1) % n], p[(k + 1) % n]);
            let (tx, ty) = (b.x - a.x, b.y - a.y);
            let l = tx.hypot(ty).max(1e-12);
            (sign * ty / l, -sign * tx / l)
        })
        .collect()
}

// --- Spatial indexes ----------------------------------------------------------------------------

type Bounds = (f64, f64, f64, f64);

fn bounds(points: &[Point], margin: f64) -> Bounds {
    let b = points.iter().fold((f64::MAX, f64::MAX, f64::MIN, f64::MIN), |b, p| (b.0.min(p.x), b.1.min(p.y), b.2.max(p.x), b.3.max(p.y)));
    (b.0 - margin, b.1 - margin, b.2 + margin, b.3 + margin)
}

fn meets(a: Bounds, b: Bounds) -> bool {
    a.0 <= b.2 && b.0 <= a.2 && a.1 <= b.3 && b.1 <= a.3
}

/// Uniform grid of item boxes.
struct Grid {
    cell: f64,
    bins: HashMap<(i64, i64), Vec<usize>>,
}

impl Grid {
    fn new(cell: f64) -> Self {
        Grid { cell: cell.max(1.0), bins: HashMap::new() }
    }
    fn span(&self, b: Bounds) -> (i64, i64, i64, i64) {
        let c = self.cell;
        ((b.0 / c).floor() as i64, (b.1 / c).floor() as i64, (b.2 / c).floor() as i64, (b.3 / c).floor() as i64)
    }
    fn insert(&mut self, item: usize, b: Bounds) {
        let (i0, j0, i1, j1) = self.span(b);
        for i in i0..=i1 {
            for j in j0..=j1 {
                self.bins.entry((i, j)).or_default().push(item);
            }
        }
    }
    /// Items whose cells meet `b`, sorted, once each.
    fn query(&self, b: Bounds, out: &mut Vec<usize>) {
        out.clear();
        let (i0, j0, i1, j1) = self.span(b);
        for i in i0..=i1 {
            for j in j0..=j1 {
                if let Some(v) = self.bins.get(&(i, j)) {
                    out.extend_from_slice(v);
                }
            }
        }
        out.sort_unstable();
        out.dedup();
    }
}

/// Segments of a polyline, for distance thresholds.
struct SegmentIndex<'a> {
    path: &'a [Point],
    grid: Grid,
}

impl<'a> SegmentIndex<'a> {
    fn new(path: &'a [Point], cell: f64) -> Self {
        let mut grid = Grid::new(cell);
        for (i, w) in path.windows(2).enumerate() {
            grid.insert(i, bounds(w, 0.0));
        }
        SegmentIndex { path, grid }
    }
    /// No segment lies within `d` of `p`.
    fn farther_than(&self, p: Point, d: f64) -> bool {
        let mut near = vec![];
        self.grid.query((p.x - d, p.y - d, p.x + d, p.y + d), &mut near);
        near.iter().all(|&i| g::distance(p, self.path[i], self.path[i + 1]).0 >= d)
    }
}

/// Footprints, for clearance and containment tests.
struct ShapeIndex<'a> {
    shapes: &'a [Shape],
    boxes: Vec<Bounds>,
    grid: Grid,
}

impl<'a> ShapeIndex<'a> {
    fn new(shapes: &'a [Shape], cell: f64) -> Self {
        let mut grid = Grid::new(cell);
        let boxes: Vec<Bounds> = shapes.iter().map(|s| bounds(&s.outer, 0.0)).collect();
        for (i, b) in boxes.iter().enumerate() {
            grid.insert(i, *b);
        }
        ShapeIndex { shapes, boxes, grid }
    }
    /// `p` lies outside every shape and at least `d` from its outline.
    fn clear(&self, p: Point, d: f64) -> bool {
        let probe = (p.x - d, p.y - d, p.x + d, p.y + d);
        let mut near = vec![];
        self.grid.query(probe, &mut near);
        near.iter().filter(|&&i| meets(self.boxes[i], probe)).all(|&i| {
            let s = &self.shapes[i];
            let r = &s.outer;
            let m = r.len();
            !g::contains(s, p) && (0..m).all(|k| g::distance(p, r[k], r[(k + 1) % m]).0 >= d)
        })
    }
    /// A narrow work between adjacent sections still interrupts the ditch.
    fn overlaps_quad(&self, quad: [Point; 4]) -> bool {
        if self.shapes.is_empty() { return false; }
        let probe = bounds(&quad, 0.0);
        let mut near = vec![];
        self.grid.query(probe, &mut near);
        if near.is_empty() { return false; }
        let shape = g::normalized(Shape { outer: quad.to_vec(), holes: vec![] });
        near.iter().any(|&i| meets(self.boxes[i], probe) && !g::intersection(&shape, &self.shapes[i]).is_empty())
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use super::Status::{Dig, Steep, Water};

    #[test]
    fn a_split_oblique_gate_road_crosses_both_lips() {
        let pt = |x, y| Point { x, y };
        let run = MoatRun {
            inner: vec![pt(0.0, 10.0), pt(150.0, 10.0)],
            outer: vec![pt(0.0, 20.0), pt(150.0, 20.0)],
            reaches: vec![MoatReach { from: 0, to: 1, supply: "fed".into(), level: Some(0.0) }],
            ..Default::default()
        };
        let road = |a, b, role: &str| Street { path: vec![a, b], widths: vec![6.0; 2], rank: 1, role: role.into() };
        let gate = pt(10.0, 0.0);
        let joint = pt(70.0, 15.0);
        let (records, along) = crossings(&[run], &[gate], &[], &[road(gate, joint, "approach"), road(pt(110.0, 25.0), joint, "bridge")], false);
        assert_eq!(along, 0.0);
        assert_eq!(records.len(), 1);
        assert_eq!(records[0].gate, Some(0));
        assert!(records[0].path.first().unwrap().y < 10.0 && records[0].path.last().unwrap().y > 20.0);
    }

    /// A ravelin is an island: the ditch stays one closed run, its outer lip round the ravelin's apex.
    #[test]
    fn a_ravelin_stands_in_a_continuous_ditch() {
        use super::super::test_fixtures::{N, surface};
        let (height, water) = (vec![0.0f32; N * N], vec![0u8; N * N]);
        let path: Vec<Point> = [(800.0, 800.0), (1200.0, 800.0), (1200.0, 1200.0), (800.0, 1200.0), (800.0, 800.0)].iter().map(|&(x, y)| pt(x, y)).collect();
        let hull = [g::normalized(Shape { outer: path[..4].to_vec(), holes: vec![] })];
        // Base on the axis of the south ditch (face 2, berm 4, half width 6), apex 35 m beyond.
        let island = [g::normalized(Shape { outer: vec![pt(970.0, 788.0), pt(1000.0, 753.0), pt(1030.0, 788.0)], holes: vec![] })];
        let line = moat_line(&MoatLineInput {
            path: &path, hull: &hull, face: 2.0, berm: 4.0, width: 12.0, depth: 3.0, works: &[], blocked: &[], islands: &island,
            surface: surface(&height, &water), outline: Outline::Traced, seed: 1, lift: f64::NEG_INFINITY, culture_wet: false, canal: false,
        });
        let runs = export(&line);
        assert_eq!(runs.len(), 1);
        assert!(runs[0].closed, "the ditch stopped at the ravelin");
        assert!(g::contains(&run_outline(&runs[0]), pt(1000.0, 755.0)), "the outer lip does not pass round the ravelin");
    }

    #[test]
    fn short_steep_gaps_between_dug_stations_close() {
        let mut s: Vec<Status> = [vec![Dig; 6], vec![Steep; 2], vec![Dig; 6], vec![Steep; 2], vec![Water; 3], vec![Steep; 9]].concat();
        close_gaps(&mut s, Steep, 4);
        assert!(s[6..8].iter().all(|&x| x == Dig), "short gap between dug stations");
        assert!(s[14..16].iter().all(|&x| x == Steep), "gap against water stays");
        assert!(s[19..].iter().all(|&x| x == Steep), "long gap stays");
    }

    #[test]
    fn circular_runs_wrap_the_seam() {
        assert_eq!(circular_runs(&[true, true, false, true]), vec![(3, 3)]);
        assert_eq!(circular_runs(&[true; 5]), vec![(0, 5)]);
        assert!(circular_runs(&[false; 3]).is_empty());
    }

    #[test]
    fn reaches_split_where_the_rim_moves() {
        let rim = [0.0, 0.3, 0.7, 0.9, 1.0, 1.6, 2.0];
        assert_eq!(split_reaches(&rim, 0.8), vec![(0, 3), (3, 6), (6, 7)]);
    }

    #[test]
    fn supply_runs_downhill_from_each_source() {
        let levels = [1.0, 0.5, 2.0, 0.3];
        let long = [true; 4];
        assert_eq!(propagate(&levels, &long, &[(0, 1.2)], 0.5), vec![true, true, false, false]);
        assert_eq!(propagate(&levels, &long, &[(0, 1.2), (3, 0.0)], 0.5), vec![true, true, false, true]);
        assert_eq!(propagate(&levels, &long, &[], 0.5), vec![false; 4]);
        // A short reach stops the water.
        assert_eq!(propagate(&levels, &[true, false, true, true], &[(0, 1.2)], 0.5), vec![true, false, false, false]);
    }

    /// Walls and moats first: a stream running into the ditch is taken in, no gap, and feeds the
    /// reaches on both sides of its inlet; a water body stops the ditch short of it.
    #[test]
    fn a_stream_is_taken_in_and_feeds_the_ditch_both_ways() {
        let land = |touched: bool, body: bool| Probe { land: Dig, touched, body, front: false, wet: touched.then_some(1.0) };
        let stream: Vec<Probe> = [vec![land(false, false); 5], vec![land(true, false); 2], vec![land(false, false); 5]].concat();
        assert!(judge_water(&stream, 8).0.iter().all(|&s| s == Dig), "a stream stopped the ditch");
        let shore: Vec<Probe> = [vec![land(false, false); 5], vec![land(true, false), land(true, true), land(true, false)], vec![land(false, false); 5]].concat();
        assert!(judge_water(&shore, 8).0[5..8].iter().all(|&s| s == Water), "the ditch ran into a lake");
        // A beach in front of the sea is no ground for a ditch; a corner that looks at the water is.
        let beach = |front: bool| Probe { land: Dig, touched: false, body: false, front, wet: None };
        let front: Vec<Probe> = [vec![beach(false); 4], vec![beach(true); 9], vec![beach(false); 4], vec![beach(true); 2], vec![beach(false); 3]].concat();
        let (status, strip) = judge_water(&front, 8);
        assert!(status[4..13].iter().all(|&s| s == Water) && strip[4..13].iter().all(|&b| b), "a ditch was dug on the beach");
        assert!(status[17..19].iter().all(|&s| s == Dig), "a corner in sight of the sea was not dug");
        // The inlet in reach 2 feeds downhill both ways, not up the higher reach 0.
        assert_eq!(propagate(&[2.0, 0.8, 1.0, 0.9, 0.5], &[true; 5], &[(2, 1.0)], 0.0), vec![false, true, true, true, true]);
    }

    /// A ditch is dug along a slope (the uphill bank higher); only a cliff stops it.
    #[test]
    fn a_slope_is_dug_and_a_cliff_stops_the_ditch() {
        assert!(!steep(105.0, 100.0, 27.0, 4.0), "a 5 m bank over a 27 m ditch is dug");
        assert!(!steep(111.0, 100.0, 27.0, 4.0), "an 11 m bank under 3 depths is dug");
        assert!(steep(113.0, 100.0, 27.0, 4.0), "13 m over 3 depths of 4 m");
        assert!(steep(107.0, 100.0, 10.0, 2.0), "a grade of 0.7 is a cliff");
    }

    #[test]
    fn ring_noise_is_deterministic_periodic_and_bounded() {
        let (total, wave) = (900.0, 60.0);
        for k in 0..200 {
            let s = k as f64 * 4.5;
            let v = ring_noise(s, total, wave, 7);
            assert_eq!(v, ring_noise(s, total, wave, 7));
            assert!((-1.0..=1.0).contains(&v));
        }
        assert!((ring_noise(0.0, total, wave, 7) - ring_noise(total, total, wave, 7)).abs() < 1e-9);
        assert!((0..50).any(|k| ring_noise(k as f64 * 17.0, total, wave, 7) != ring_noise(k as f64 * 17.0, total, wave, 8)));
    }
}
