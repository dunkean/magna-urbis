//! Stairs of the steep links: only the stretch too steep for a lane is a stair run.
//!
//! Subdivision and the quarter feeders mark a link whose steepest metre exceeds the lane limit with the
//! `stairs` role, so the network passes keep it. `settle` then decides, once the network is final and
//! before the blocks are carved, what each marked link really is from its profile: a narrow steep lane, and a
//! flight of stairs along the runs that stay steeper. Runs open above `STAIR_GRADE`, hold down to
//! `STAIR_HOLD`, and a short level stretch between two of them is a landing of one stair. A run is a stair only
//! where it is useful (`useful`): short, between two streets, and no ordinary way leads there nearly as directly.

use super::streets::len;
use crate::rng::Rng;
use crate::urban::{Enclosure, LayoutConfig, Point, Street, Surface, geometry as g, profiles, routing};
use std::collections::{BTreeSet, HashMap};

/// Grade over `WINDOW` that opens a stair run, and the one that still prolongs it.
const STAIR_GRADE: f64 = 0.35;
const STAIR_HOLD: f64 = 0.25;
/// Sampling step along a way and length the grade is averaged over (m): a bump of the ground is no stair.
const STEP: f64 = 2.0;
const WINDOW: f64 = 6.0;
/// Two runs closer than this (m) are flights of one stair.
const LANDING: f64 = 8.0;
/// Shortest run and least climb (m) worth a stair.
const MIN_RUN: f64 = 8.0;
const MIN_RISE: f64 = 2.5;
/// A run end nearer (m) to a junction than this moves to it.
const JOINT: f64 = 5.0;
/// Side by side ways of one slope: the steepest within this distance (m) is the stair, the others
/// stay lanes, unless they are steeper on average than `TOO_STEEP`.
const SPACING: f64 = 50.0;
const TOO_STEEP: f64 = 0.5;
/// Longest stair (m): a longer climb is a lane.
const MAX_RUN: f64 = 70.0;
/// A stair is useless where ordinary ways join its ends within this many times its length, or this length (m).
const DETOUR: f64 = 2.5;
const SHORT_DETOUR: f64 = 60.0;
/// A way along the same slope this near (m) already does the work of a stair; a deck this near has its own approach.
const ALONGSIDE: f64 = 25.0;
const DECK: f64 = 15.0;
/// Largest distance (m) of a straight flight from the way it replaces.
const STRAIGHTEN: f64 = 2.0;
/// Shortest winding run and the length of one of its bends (m).
const WINDING: f64 = 36.0;
const BEND: f64 = 13.0;

/// A path with its cumulative length.
pub(super) struct Line<'a> {
    path: &'a [Point],
    cum: Vec<f64>,
}
impl<'a> Line<'a> {
    pub(super) fn new(path: &'a [Point]) -> Self {
        let mut cum = vec![0.0];
        for w in path.windows(2) {
            cum.push(cum[cum.len() - 1] + (w[1].x - w[0].x).hypot(w[1].y - w[0].y));
        }
        Self { path, cum }
    }
    fn length(&self) -> f64 {
        self.cum[self.cum.len() - 1]
    }
    /// Segment and parameter at arc length `s`.
    fn locate(&self, s: f64) -> (usize, f64) {
        let i = self.cum.partition_point(|&c| c <= s).clamp(1, self.path.len() - 1) - 1;
        let l = self.cum[i + 1] - self.cum[i];
        (i, if l > 1e-9 { ((s - self.cum[i]) / l).clamp(0.0, 1.0) } else { 0.0 })
    }
    fn at(&self, s: f64) -> Point {
        let (i, t) = self.locate(s);
        let (a, b) = (self.path[i], self.path[i + 1]);
        Point { x: a.x + (b.x - a.x) * t, y: a.y + (b.y - a.y) * t }
    }
    pub(super) fn width(&self, widths: &[f64], s: f64) -> f64 {
        let (i, t) = self.locate(s);
        let w = |k: usize| widths.get(k).or(widths.last()).copied().unwrap_or(2.2);
        w(i) + (w(i + 1) - w(i)) * t
    }
    /// Arc length of the point of the path nearest to `p`.
    pub(super) fn project(&self, p: Point) -> f64 {
        self.path
            .windows(2)
            .enumerate()
            .map(|(i, w)| {
                let (d, t, _) = g::distance(p, w[0], w[1]);
                (d, self.cum[i] + (self.cum[i + 1] - self.cum[i]) * t)
            })
            .min_by(|a, b| a.0.total_cmp(&b.0))
            .map_or(0.0, |v| v.1)
    }
    /// The points of the stretch from `a` to `b` and their arc lengths: its ends and the vertices between.
    fn stretch(&self, a: f64, b: f64) -> Vec<(f64, Point)> {
        let mut out = vec![(a, self.at(a))];
        out.extend(self.cum.iter().zip(self.path).filter(|&(&c, _)| c > a + 1e-6 && c < b - 1e-6).map(|(&c, &p)| (c, p)));
        out.push((b, self.at(b)));
        out
    }
}

/// The stretches of a way that stay too steep for a lane: (from, to, mean grade) in arc lengths.
fn steep_runs(line: &Line<'_>, surface: Surface<'_>, cfg: &LayoutConfig) -> Vec<(f64, f64, f64)> {
    let length = line.length();
    let n = (length / STEP).ceil().max(2.0) as usize;
    let sample = length / n as f64;
    let height: Vec<f64> = (0..=n).map(|i| surface.height_at(line.at(i as f64 * sample))).collect();
    let half = (WINDOW * 0.5 / sample).round().max(1.0) as usize;
    let grade: Vec<f64> = (0..=n)
        .map(|i| {
            let (a, b) = (i.saturating_sub(half), (i + half).min(n));
            (height[b] - height[a]).abs() / ((b - a) as f64 * sample).max(1e-6)
        })
        .collect();
    // A user limit for the lanes above the usual one moves both thresholds.
    let (open, hold) = (STAIR_GRADE.max(cfg.max_lane_grade + 0.03), STAIR_HOLD.max(cfg.max_lane_grade));
    let mut runs: Vec<(usize, usize)> = vec![];
    let mut i = 0;
    while i <= n {
        if grade[i] < open {
            i += 1;
            continue;
        }
        let (mut a, mut b) = (i, i);
        while a > 0 && grade[a - 1] >= hold {
            a -= 1;
        }
        while b < n && grade[b + 1] >= hold {
            b += 1;
        }
        match runs.last_mut() {
            Some(last) if (a as f64 - last.1 as f64) * sample < LANDING => last.1 = b,
            _ => runs.push((a, b)),
        }
        i = b + 1;
    }
    runs.into_iter()
        .filter_map(|(a, b)| {
            let run = (b - a) as f64 * sample;
            let rise: f64 = height[a..=b].windows(2).map(|w| (w[1] - w[0]).abs()).sum();
            (run >= MIN_RUN && rise >= MIN_RISE).then(|| (a as f64 * sample, b as f64 * sample, rise / run))
        })
        .collect()
}

/// A segment of a street, with the street's index and half width.
pub(super) struct Segment {
    street: usize,
    pub(super) a: Point,
    pub(super) b: Point,
    pub(super) half: f64,
}
fn segment_box(a: Point, b: Point) -> (f64, f64, f64, f64) {
    (a.x.min(b.x), a.y.min(b.y), a.x.max(b.x), a.y.max(b.y))
}
/// The street segments of the town, by box.
pub(super) struct Segments {
    all: Vec<Segment>,
    grid: g::BoxGrid,
}
impl Segments {
    pub(super) fn new(streets: &[Street]) -> Self {
        let mut all: Vec<Segment> = vec![];
        for (street, s) in streets.iter().enumerate() {
            let half = s.widths.iter().copied().fold(0.0, f64::max) * 0.5;
            all.extend(s.path.windows(2).map(|w| Segment { street, a: w[0], b: w[1], half }));
        }
        let grid = g::BoxGrid::new(all.iter().map(|s| segment_box(s.a, s.b)).collect());
        Self { all, grid }
    }
    /// The segments of the streets other than `own` that may come within `pad` of `a`-`b`.
    pub(super) fn near(&self, own: usize, a: Point, b: Point, pad: f64) -> Vec<&Segment> {
        self.grid.query(segment_box(a, b), pad).into_iter().map(|k| &self.all[k]).filter(|s| s.street != own).collect()
    }
    /// The joints of street `own`: its ends and every place another street meets it, in order.
    pub(super) fn joints(&self, own: usize, line: &Line<'_>) -> Vec<(f64, Point)> {
        const TOUCH: f64 = 0.05;
        let mut met: Vec<(f64, Point)> = vec![];
        for (i, w) in line.path.windows(2).enumerate() {
            let arc = |t: f64| line.cum[i] + (line.cum[i + 1] - line.cum[i]) * t;
            for s in self.near(own, w[0], w[1], TOUCH) {
                for p in [s.a, s.b] {
                    let (gap, t, _) = g::distance(p, w[0], w[1]);
                    if gap <= TOUCH {
                        met.push((arc(t), p));
                    }
                }
                if let Some((t, p)) = g::segment_hit(w[0], w[1], s.a, s.b) {
                    met.push((arc(t), p));
                }
            }
        }
        met.sort_by(|a, b| a.0.total_cmp(&b.0));
        let (length, end) = (line.length(), line.path[line.path.len() - 1]);
        let mut out = vec![(0.0, line.path[0])];
        for joint in met {
            if joint.0 - out[out.len() - 1].0 > TOUCH && length - joint.0 > TOUCH {
                out.push(joint);
            }
        }
        out.push((length, end));
        out
    }
}

/// The curtain segments, by box.
pub(super) struct Walls {
    all: Vec<(Point, Point)>,
    grid: g::BoxGrid,
}
impl Walls {
    pub(super) fn new(enclosures: &[Enclosure]) -> Self {
        let all: Vec<(Point, Point)> = enclosures.iter().flat_map(|e| e.path.windows(2).map(|w| (w[0], w[1]))).collect();
        let grid = g::BoxGrid::new(all.iter().map(|&(a, b)| segment_box(a, b)).collect());
        Self { all, grid }
    }
    pub(super) fn crossed(&self, a: Point, b: Point) -> bool {
        self.grid.query(segment_box(a, b), 0.01).into_iter().any(|k| g::segment_hit(a, b, self.all[k].0, self.all[k].1).is_some())
    }
}

/// A stair run proposed on a link.
struct Run {
    street: usize,
    from: f64,
    to: f64,
    grade: f64,
    path: Vec<Point>,
    middle: Point,
}

/// Whether `r` climbs beside the stair `kept`, within `SPACING`, on another street.
fn beside(kept: &Run, r: &Run) -> bool {
    if kept.street == r.street {
        return false;
    }
    let nearest = kept.path.windows(2).map(|w| g::distance(r.middle, w[0], w[1])).min_by(|a, b| a.0.total_cmp(&b.0));
    let Some((d, _, q)) = nearest else {
        return false;
    };
    let (a, b) = (kept.path[0], kept.path[kept.path.len() - 1]);
    let l = (b.x - a.x).hypot(b.y - a.y).max(1e-6);
    // The next flight of the same climb lies ahead of the kept one, not beside it.
    d < SPACING && (((r.middle.x - q.x) * (b.x - a.x) + (r.middle.y - q.y) * (b.y - a.y)) / l).abs() < 0.7 * d
}

/// Whether a steep run is worth a stair: short, on a link that joins two streets, crossing none of them, away from
/// the decks and from any way climbing beside it, and shortening a real detour by the ordinary ways (those not `steep`).
fn useful(r: &Run, streets: &[Street], segments: &Segments, steep: &BTreeSet<usize>, joints: &mut HashMap<usize, Vec<(f64, Point)>>) -> bool {
    let length = r.to - r.from;
    if length > MAX_RUN {
        return false;
    }
    let own = &streets[r.street].path;
    let joined = |p: Point| segments.near(r.street, p, p, 0.5).iter().any(|s| g::distance(p, s.a, s.b).0 <= 0.5);
    if !joined(own[0]) || !joined(own[own.len() - 1]) {
        return false;
    }
    let line = Line::new(own);
    let own_joints = joints.entry(r.street).or_insert_with(|| segments.joints(r.street, &line)).clone();
    if own_joints.iter().any(|j| j.0 > r.from + JOINT && j.0 < r.to - JOINT) {
        return false;
    }
    let (from, to) = (r.path[0], r.path[r.path.len() - 1]);
    let l = (to.x - from.x).hypot(to.y - from.y).max(1e-6);
    let role = |s: &Segment| streets[s.street].role.as_str();
    let deck = r.path.windows(2).any(|w| {
        segments.near(r.street, w[0], w[1], DECK).into_iter().any(|s| {
            matches!(role(s), "bridge" | "ford" | "causeway") && w.iter().map(|&p| g::distance(p, s.a, s.b).0).fold(f64::INFINITY, f64::min) < DECK
        })
    });
    let alongside = segments.near(r.street, r.middle, r.middle, ALONGSIDE).into_iter().any(|s| {
        let d = (s.b.x - s.a.x).hypot(s.b.y - s.a.y).max(1e-6);
        let parallel = ((s.b.x - s.a.x) * (to.x - from.x) + (s.b.y - s.a.y) * (to.y - from.y)).abs() > 0.87 * d * l;
        !steep.contains(&s.street) && parallel && g::distance(r.middle, s.a, s.b).0 < ALONGSIDE
    });
    !deck && !alongside && !detour(r, &line, &own_joints, streets, segments, steep, joints, (DETOUR * length).max(SHORT_DETOUR))
}

/// Whether ordinary ways join the two ends of a run within `limit` metres.
#[allow(clippy::too_many_arguments)]
fn detour(
    r: &Run,
    line: &Line<'_>,
    own_joints: &[(f64, Point)],
    streets: &[Street],
    segments: &Segments,
    steep: &BTreeSet<usize>,
    joints: &mut HashMap<usize, Vec<(f64, Point)>>,
    limit: f64,
) -> bool {
    type Node = (i64, i64);
    let node = |p: Point| -> Node { ((p.x * 5.0).round() as i64, (p.y * 5.0).round() as i64) };
    let mut edges: HashMap<Node, Vec<(Node, u64)>> = HashMap::new();
    let mut add = |stops: &[(f64, Point)], except: (f64, f64)| {
        for w in stops.windows(2) {
            if w[0].0 < except.0 - 1e-6 || w[1].0 > except.1 + 1e-6 {
                let (a, b, d) = (node(w[0].1), node(w[1].1), ((w[1].0 - w[0].0) * 1000.0) as u64);
                edges.entry(a).or_default().push((b, d));
                edges.entry(b).or_default().push((a, d));
            }
        }
    };
    let (from, to) = (line.at(r.from), line.at(r.to));
    let mut own: Vec<(f64, Point)> = own_joints.iter().copied().filter(|j| j.0 < r.from - 1e-6 || j.0 > r.to + 1e-6).collect();
    own.extend([(r.from, from), (r.to, to)]);
    own.sort_by(|a, b| a.0.total_cmp(&b.0));
    // A run end at a joint keeps the joint's own point.
    for stop in &mut own {
        if let Some(j) = own_joints.iter().find(|j| (j.0 - stop.0).abs() < 1e-6) {
            stop.1 = j.1;
        }
    }
    let end = |at: f64, p: Point| node(own.iter().find(|s| s.0 == at).map_or(p, |s| s.1));
    let (start, goal) = (end(r.from, from), end(r.to, to));
    add(&own, (r.from, r.to));
    let near: BTreeSet<usize> = segments.grid.query(segment_box(from, to), 0.5 * limit).into_iter().map(|k| segments.all[k].street).filter(|s| *s != r.street && !steep.contains(s)).collect();
    for s in near {
        if streets[s].path.len() < 2 {
            continue;
        }
        let stops = joints.entry(s).or_insert_with(|| segments.joints(s, &Line::new(&streets[s].path)));
        add(stops, (f64::INFINITY, f64::NEG_INFINITY));
    }
    let limit = (limit * 1000.0) as u64;
    let mut open = BTreeSet::from([(0u64, start)]);
    let mut done: BTreeSet<Node> = BTreeSet::new();
    while let Some((d, n)) = open.pop_first() {
        if d > limit {
            return false;
        }
        if n == goal {
            return true;
        }
        if done.insert(n) {
            open.extend(edges.get(&n).into_iter().flatten().map(|&(next, step)| (d + step, next)));
        }
    }
    false
}

/// Mountain cultures wind their long stairs up the slope; the others lay straight urban flights.
fn winds(culture: &str) -> bool {
    matches!(profiles::profile(culture).pattern, "terraces" | "dispersed")
}

/// Turn the marked links (`stairs`) into lanes and, along their steep runs, stairs. A link keeps its
/// index for its first piece; the other pieces are appended.
pub(super) fn settle(streets: &mut Vec<Street>, enclosures: &[Enclosure], surface: Surface<'_>, cfg: &LayoutConfig, culture: &str) {
    let marked: Vec<usize> = (0..streets.len()).filter(|&i| streets[i].role == "stairs" && streets[i].path.len() >= 2 && len(&streets[i].path) > 1.0).collect();
    if marked.is_empty() {
        return;
    }
    let segments = Segments::new(streets);
    let mut runs: Vec<Run> = vec![];
    for &i in &marked {
        let line = Line::new(&streets[i].path);
        let joints = segments.joints(i, &line);
        let snap = |s: f64| joints.iter().map(|j| j.0).filter(|j| (j - s).abs() < JOINT).min_by(|a, b| (a - s).abs().total_cmp(&(b - s).abs())).unwrap_or(s);
        let mut end: f64 = 0.0;
        for (a, b, grade) in steep_runs(&line, surface, cfg) {
            let (from, to) = (snap(a).max(end), snap(b));
            if to - from < 2.0 {
                continue;
            }
            end = to;
            let path = line.stretch(from, to).into_iter().map(|v| v.1).collect();
            runs.push(Run { street: i, from, to, grade, path, middle: line.at((from + to) * 0.5) });
        }
    }
    let steep: BTreeSet<usize> = runs.iter().map(|r| r.street).collect();
    let mut joints = HashMap::new();
    runs.retain(|r| useful(r, streets, &segments, &steep, &mut joints));
    // The steepest ways keep their stairs, an alternative beside one stays a lane.
    let mut order: Vec<usize> = (0..runs.len()).collect();
    order.sort_by(|&a, &b| runs[b].grade.total_cmp(&runs[a].grade).then(a.cmp(&b)));
    let mut kept: Vec<usize> = vec![];
    for r in order {
        if runs[r].grade >= TOO_STEEP || !kept.iter().any(|&k| beside(&runs[k], &runs[r])) {
            kept.push(r);
        }
    }
    kept.sort_unstable();
    let mut stairs: Vec<usize> = vec![];
    for &i in &marked {
        let original = streets[i].clone();
        let line = Line::new(&original.path);
        // Alternating lane and stair pieces along the link.
        let mut pieces: Vec<(f64, f64, bool)> = vec![];
        let mut at = 0.0;
        for r in kept.iter().map(|&k| &runs[k]).filter(|r| r.street == i) {
            if r.from > at + 1e-6 {
                pieces.push((at, r.from, false));
            }
            match pieces.last_mut() {
                Some(last) if last.2 => last.1 = r.to,
                _ => pieces.push((r.from, r.to, true)),
            }
            at = r.to;
        }
        if line.length() > at + 1e-6 {
            pieces.push((at, line.length(), false));
        }
        for (k, (a, b, stair)) in pieces.into_iter().enumerate() {
            let stretch = line.stretch(a, b);
            let widths = stretch.iter().map(|&(s, _)| line.width(&original.widths, s)).collect();
            let piece = Street {
                path: stretch.into_iter().map(|v| v.1).collect(),
                widths,
                rank: original.rank.max(3),
                role: if stair { "stairs" } else { "lane" }.into(),
            };
            let index = if k == 0 { i } else { streets.len() };
            if k == 0 {
                streets[i] = piece;
            } else {
                streets.push(piece);
            }
            if stair {
                stairs.push(index);
            }
        }
    }
    // The flights take their plan within the room around the way, off every other street.
    let segments = Segments::new(streets);
    let walls = Walls::new(enclosures);
    let winding = winds(culture);
    for i in stairs {
        let drawn = flights(&streets[i], i, winding, &segments, &walls, surface, cfg);
        streets[i] = drawn;
    }
}

/// A stair's plan: between two joints, straight flights or a winding climb.
fn flights(stair: &Street, own: usize, winding: bool, segments: &Segments, walls: &Walls, surface: Surface<'_>, cfg: &LayoutConfig) -> Street {
    let line = Line::new(&stair.path);
    let joints = segments.joints(own, &line);
    let mut path: Vec<Point> = vec![joints[0].1];
    for w in joints.windows(2) {
        let ((a, from), (b, to)) = (w[0], w[1]);
        let mut span: Vec<Point> = line.stretch(a, b).into_iter().map(|v| v.1).collect();
        let last = span.len() - 1;
        span[0] = from;
        span[last] = to;
        let limit = span.windows(2).map(|w| routing::segment_grade(surface, w[0], w[1])).fold(cfg.max_stair_grade, f64::max);
        let half = line.width(&stair.widths, (a + b) * 0.5) * 0.5;
        let fits = |candidate: &[Point]| room(candidate, own, half, limit, segments, walls, surface);
        let shaped = if winding && b - a >= WINDING {
            let rise = (surface.height_at(to) - surface.height_at(from)).abs();
            let reach = (1.8 + 0.08 * rise).min(4.0);
            [reach, reach * 0.5].into_iter().map(|r| wound(&line, (a, from), (b, to), r)).find(|p| fits(p))
        } else {
            Some(g::simplify(&span, STRAIGHTEN, |_| false)).filter(|p| p.len() < span.len() && fits(p))
        };
        path.extend(shaped.unwrap_or(span).into_iter().skip(1));
    }
    let widths = path.iter().map(|&p| line.width(&stair.widths, line.project(p))).collect();
    Street { path, widths, rank: stair.rank, role: stair.role.clone() }
}

/// Bends of uneven reach on alternate sides of the way between two joints, level with it at both ends.
fn wound(line: &Line<'_>, (a, from): (f64, Point), (b, to): (f64, Point), reach: f64) -> Vec<Point> {
    const SAMPLES: usize = 4;
    let bends = ((b - a) / BEND).round().max(2.0) as usize;
    let mut rng = Rng::new(&format!("stairs:{:.1},{:.1}", from.x, from.y));
    let first = if rng.float() < 0.5 { 1.0 } else { -1.0 };
    let mut path = vec![from];
    for k in 0..bends {
        let side = if k % 2 == 0 { first } else { -first };
        let offset = side * reach * (0.7 + 0.45 * rng.float());
        for j in 0..SAMPLES {
            if k == 0 && j == 0 {
                continue;
            }
            let t = j as f64 / SAMPLES as f64;
            let s = a + (b - a) * (k as f64 + t) / bends as f64;
            let (p, q) = (line.at((s - 3.0).max(a)), line.at((s + 3.0).min(b)));
            let l = (q.x - p.x).hypot(q.y - p.y).max(1e-6);
            let o = line.at(s);
            let d = offset * (std::f64::consts::PI * t).sin();
            path.push(Point { x: o.x - (q.y - p.y) / l * d, y: o.y + (q.x - p.x) / l * d });
        }
    }
    path.push(to);
    path
}

/// Whether a span has room: dry and climbable, across no curtain, meeting other streets at its ends only.
fn room(span: &[Point], own: usize, half: f64, limit: f64, segments: &Segments, walls: &Walls, surface: Surface<'_>) -> bool {
    if !routing::path_clear(surface, span, limit) {
        return false;
    }
    let ends = [span[0], span[span.len() - 1]];
    let from_ends = |p: Point| ends.iter().map(|e| (e.x - p.x).hypot(e.y - p.y)).fold(f64::INFINITY, f64::min);
    span.windows(2).all(|w| {
        !walls.crossed(w[0], w[1])
            && segments.near(own, w[0], w[1], half + 8.0).into_iter().all(|s| {
                let apart = g::segment_hit(w[0], w[1], s.a, s.b).is_none_or(|(_, p)| from_ends(p) < 0.5);
                // Near a joint the two ways share their mouth.
                apart && w.iter().all(|&p| from_ends(p) < 10.0 || g::distance(p, s.a, s.b).0 >= half + s.half + 1.0)
            })
    })
}

#[cfg(test)]
mod tests {
    use super::*;

    /// A 256 m map whose ground (m) is `height` of x.
    fn ground(height: impl Fn(f64) -> f64) -> Vec<f32> {
        (0..128 * 128).map(|i| height(((i % 128) as f64 + 0.5) * 2.0) as f32).collect()
    }
    fn surface<'a>(height: &'a [f32], water: &'a [u8]) -> Surface<'a> {
        Surface { geometry: None, width: 256.0, n: 128, height, water, interpolation: Default::default() }
    }
    fn way(points: &[(f64, f64)], role: &str) -> Street {
        Street { path: points.iter().map(|&(x, y)| Point { x, y }).collect(), widths: vec![3.0; points.len()], rank: 3, role: role.into() }
    }
    /// Steep links from x = `from` to `to`, each at its y, between two streets across the slope.
    fn town(from: f64, to: f64, links: &[f64]) -> Vec<Street> {
        let mut out: Vec<Street> = links.iter().map(|&y| way(&[(from, y), (to, y)], "stairs")).collect();
        out.extend([from, to].map(|x| way(&[(x, 10.0), (x, 240.0)], "street")));
        out
    }
    fn roles(streets: &[Street], count: usize) -> Vec<&str> {
        streets[..count].iter().map(|s| s.role.as_str()).collect()
    }

    #[test]
    fn a_credible_grade_stays_a_lane() {
        let (height, water) = (ground(|x| x * 0.28), vec![0u8; 128 * 128]);
        let mut streets = town(100.0, 150.0, &[100.0]);
        settle(&mut streets, &[], surface(&height, &water), &LayoutConfig::default(), "italian-comune");
        assert_eq!(streets.len(), 3);
        assert_eq!(streets[0].role, "lane");
    }

    #[test]
    fn only_the_steep_stretch_of_a_link_is_a_stair() {
        // Steep between 100 and 140 m, gentle elsewhere.
        let (height, water) = (ground(|x| x * 0.1 + (x.clamp(100.0, 140.0) - 100.0) * 0.4), vec![0u8; 128 * 128]);
        let mut streets = town(20.0, 200.0, &[100.0]);
        settle(&mut streets, &[], surface(&height, &water), &LayoutConfig::default(), "italian-comune");
        assert_eq!(streets.len(), 5);
        let link = [&streets[0], &streets[3], &streets[4]];
        assert_eq!(link.map(|s| s.role.as_str()), ["lane", "stairs", "lane"]);
        let length = len(&link[1].path);
        assert!((30.0..50.0).contains(&length), "{length}");
        // The pieces stay joined end to end, at the width of the lane.
        for end in [link[0].path[link[0].path.len() - 1], link[2].path[0]] {
            assert!(link[1].path.iter().any(|p| (p.x - end.x).hypot(p.y - end.y) < 1e-9));
        }
        assert!(link[1].widths.iter().all(|&w| w == 3.0));
    }

    #[test]
    fn a_lane_beside_a_stair_stays_a_lane() {
        let (height, water) = (ground(|x| x * 0.4), vec![0u8; 128 * 128]);
        let mut streets = town(100.0, 150.0, &[60.0, 90.0, 180.0]);
        settle(&mut streets, &[], surface(&height, &water), &LayoutConfig::default(), "italian-comune");
        assert_eq!(roles(&streets, 3), ["stairs", "lane", "stairs"]);
        assert!(streets.iter().all(|s| s.path.len() == 2));
    }

    #[test]
    fn a_stair_is_short_joins_two_streets_and_shortens_a_detour() {
        let (height, water) = (ground(|x| x * 0.4), vec![0u8; 128 * 128]);
        let settled = |mut streets: Vec<Street>| {
            settle(&mut streets, &[], surface(&height, &water), &LayoutConfig::default(), "italian-comune");
            streets[0].role.clone()
        };
        assert_eq!(settled(town(100.0, 150.0, &[100.0])), "stairs");
        // A long flight, a way that ends nowhere, a link across another street, one beside a deck.
        assert_eq!(settled(town(40.0, 200.0, &[100.0])), "lane");
        assert_eq!(settled(town(100.0, 150.0, &[100.0])[..2].to_vec()), "lane");
        let with = |extra: Street| [town(100.0, 150.0, &[100.0]), vec![extra]].concat();
        assert_eq!(settled(with(way(&[(125.0, 60.0), (125.0, 140.0)], "lane"))), "lane");
        assert_eq!(settled(with(way(&[(150.0, 108.0), (190.0, 108.0)], "bridge"))), "lane");
        // An ordinary way round joins both ends within twice the length; a far one does not.
        assert_eq!(settled(with(way(&[(100.0, 130.0), (150.0, 130.0)], "lane"))), "lane");
        assert_eq!(settled(with(way(&[(100.0, 230.0), (150.0, 230.0)], "lane"))), "stairs");
    }

    #[test]
    fn a_mountain_stair_winds_about_its_way() {
        let (height, water) = (ground(|x| x * 0.45), vec![0u8; 128 * 128]);
        let mut streets = town(100.0, 150.0, &[100.0]);
        settle(&mut streets, &[], surface(&height, &water), &LayoutConfig::default(), "himalayan-terraces");
        assert_eq!(streets[0].role, "stairs");
        let reach = streets[0].path.iter().map(|p| (p.y - 100.0).abs()).fold(0.0, f64::max);
        assert!((1.0..5.0).contains(&reach), "{reach}");
        assert_eq!((streets[0].path[0].x, streets[0].path[streets[0].path.len() - 1].x), (100.0, 150.0));
    }
}
