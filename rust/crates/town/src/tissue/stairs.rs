//! Stepped links on steep ground. Between two contour streets whose slope is steeper than a
//! street, a short straight flight of stairs; on a flank too steep for any street, a switchback
//! of short flights joined by landings. By the owner's rule flights stay short and sparse: at
//! most one per spacing along a street, never two side by side. A link that starts where another
//! ends continues it up the slope, as one stepped lane across several contour streets.
//!
//! # Integration
//!
//! Slope (design 4.1 and 4.5, plan M3.1) is wired at step 2 of design 3.2's order, where the
//! quarters of the open sectors are laid in parallel into drafts (`growth::rings::lay`). For each
//! sector, in the closure that lays its draft:
//!
//! 1. `let slope = survey.quarter_slope(&sector.outline);` (`survey::QuarterSlope`).
//! 2. The tissue params: `if slope.terraced() { params.terraced() } else { params.clone() }`
//!    (`OrganicParams::terraced`, most of the quarter's land too steep for a plain house).
//! 3. `let mut draft = organic::lay_streets(&sector.outline, terrain, field, &site, &params,
//!    &mut rng);` as today. On a steep quarter the tissue turns its streets along the contours
//!    and lays no stairs by itself; nothing to pass.
//! 4. `draft.streets.extend(stairs::stepped_links(&draft, &sector.outline, terrain, &params));`
//!    The flights come after the streets in the draft, so the journal seats their ends on the
//!    streets laid before them (`journal::draft::ops_for_draft`), and their keys follow the
//!    streets' ranks. Each returned path ends on a draft street or on the outline; the
//!    vertices between its ends are landings. The function uses no random stream.
//!
//! At the quarter's count (`growth::rings::count`), the capacity at birth takes the slope as a
//! density: multiply `Birth::density` by `slope.density` (1 on flat land, falling to
//! `SurveySpec::terrace_density` at the terrace limit), so that steep land opens late (the cost
//! field already charges slope) and holds fewer households. A terraced quarter's lot cut should
//! also read `params.slope.terraced.lot_frontage_scale`, which needs a field in
//! `CapacityInputs` and core's capacity: left to the integration lot.
//!
//! Core's adapter (`urban/town_adapter/specs.rs`) should set `SurveySpec::house_grade` from the
//! culture mapping's `admissibility.max_slope`, and may resolve `OrganicParams::slope` per
//! culture; the defaults stand until then.
//!
//! Seating caveat: the journal moves a street's end by up to `2 * MIN_PIECE` when it takes a
//! node, and seats a later end on that street only within `MIN_PIECE`. A flight ending on the
//! first or last segment of a street sits exactly on the draft polyline, so it can miss the
//! seated street by a fraction of that move and dangle; if the checkpoint shows dangling flights,
//! seat stairs ends with a wider tolerance.

use std::collections::HashMap;

use magna_urbis_geom::surface::TerrainView;
use magna_urbis_geom::{Point, Shape, contains, distance, segment_hit};
use serde::{Deserialize, Serialize};

use super::organic::OrganicParams;
use super::organic::grade::segment_clear;
use super::{DraftStreet, TissueDraft};

#[cfg(test)]
mod tests;

/// The owner's rule for stepped links. Defaults to tune on sheets.
#[derive(Clone, Debug, PartialEq, Serialize, Deserialize)]
#[serde(default, rename_all = "camelCase")]
pub struct StairParams {
    /// Longest straight flight in metres between two streets (default 40).
    pub max_length: f64,
    /// Least distance in metres between two flights along a street, and between two flights
    /// side by side (default 60).
    pub spacing: f64,
    /// Longest horizontal run in metres of one flight of a switchback (default 12).
    pub flight_length: f64,
    /// Widest gap in metres between two streets that a switchback climbs (default 120).
    pub flank_reach: f64,
}

impl Default for StairParams {
    fn default() -> Self {
        Self {
            max_length: 40.0,
            spacing: 60.0,
            flight_length: 12.0,
            flank_reach: 120.0,
        }
    }
}

/// Distance in metres between two feet of candidate links along a street.
const FOOT_STEP: f64 = 6.0;
/// Shortest link in metres; streets closer than this need none.
const MIN_LINK: f64 = 6.0;
/// Half step in metres of the slope read at a foot.
const PROBE: f64 = 4.0;
/// Distance in metres within which a link that starts where another ends continues it.
const CONTINUE: f64 = 8.0;
/// Share of the stair grade a switchback's flights are laid at, a margin for uneven ground.
const SWITCHBACK_GRADE: f64 = 0.85;
/// Largest sine of a switchback flight's angle to the contour, so that a switchback zigzags.
const SWITCHBACK_SINE: f64 = 0.8;
/// Most flights in one switchback.
const MAX_FLIGHTS: usize = 16;
/// Smallest sine of the angle between a straight link and the streets it joins.
const MIN_CROSSING_SINE: f64 = 0.5;
/// Smallest cosine of the angle between a link and a street that counts as climbing beside it.
const BESIDE_COSINE: f64 = 0.5;
/// Widest flight in metres, classic's stair width.
const STAIR_WIDTH: f64 = 2.2;
/// Side in metres of the cells of the segment index.
const CELL: f64 = 20.0;

/// The stepped links of one quarter: flights between the streets of `draft` and the quarter
/// `outline`, as draft streets of role `stairs` and rank 3. None unless the tissue builds stairs
/// (`OrganicParams::allow_stairs`). Stairs already in the draft count as placed flights.
pub fn stepped_links(
    draft: &TissueDraft,
    outline: &Shape,
    terrain: &dyn TerrainView,
    params: &OrganicParams,
) -> Vec<DraftStreet> {
    let rule = &params.slope.stairs;
    if !params.allow_stairs || !(rule.max_length > MIN_LINK) || !(rule.spacing > 0.0) {
        return Vec::new();
    }
    let fronts = fronts(draft, outline);
    let index = Index::new(&fronts);
    let linker = Linker {
        fronts: &fronts,
        index: &index,
        outline,
        terrain,
        params,
    };
    let mut candidates = linker.candidates();
    candidates.sort_by(|a, b| a.score.total_cmp(&b.score).then(a.order.cmp(&b.order)));
    let mut placed: Vec<Placed> = draft
        .streets
        .iter()
        .filter(|s| s.role == "stairs" && s.path.len() >= 2)
        .map(|s| Placed {
            path: s.path.clone(),
            fronts: [None, None],
        })
        .collect();
    let existing = placed.len();
    for candidate in &candidates {
        if let Some(path) = linker.admit(candidate, &placed) {
            placed.push(Placed {
                path,
                fronts: candidate.fronts.map(Some),
            });
        }
    }
    let width = (params.width_by_rank[3] * params.width_scale).min(STAIR_WIDTH);
    placed
        .into_iter()
        .skip(existing)
        .map(|p| DraftStreet {
            widths: vec![width; p.path.len()],
            path: p.path,
            rank: 3,
            role: "stairs".into(),
        })
        .collect()
}

/// A polyline a link may start or end on, or must not cross.
struct Front {
    path: Vec<Point>,
    /// Whether links may end on it: streets, lanes and the outline, not stairs.
    seat: bool,
}

/// The draft's streets in their order, then the outline's rings closed.
fn fronts(draft: &TissueDraft, outline: &Shape) -> Vec<Front> {
    let mut out: Vec<Front> = draft
        .streets
        .iter()
        .filter(|s| s.path.len() >= 2)
        .map(|s| Front {
            path: s.path.clone(),
            seat: s.role != "stairs",
        })
        .collect();
    for ring in std::iter::once(&outline.outer).chain(&outline.holes) {
        if ring.len() >= 2 {
            let mut path = ring.clone();
            path.push(ring[0]);
            out.push(Front { path, seat: true });
        }
    }
    out
}

/// A crossing of a ray with a front.
struct Hit {
    t: f64,
    point: Point,
    front: usize,
    /// Unit direction of the front's segment there.
    tangent: Point,
}

/// Every front segment in a uniform grid.
struct Index {
    /// Front and end points of each segment.
    segments: Vec<(usize, Point, Point)>,
    cells: HashMap<(i64, i64), Vec<u32>>,
}

impl Index {
    fn new(fronts: &[Front]) -> Self {
        let mut segments = Vec::new();
        let mut cells: HashMap<(i64, i64), Vec<u32>> = HashMap::new();
        for (f, front) in fronts.iter().enumerate() {
            for w in front.path.windows(2) {
                let id = segments.len() as u32;
                segments.push((f, w[0], w[1]));
                for key in keys(w[0], w[1], 0.0) {
                    cells.entry(key).or_default().push(id);
                }
            }
        }
        Self { segments, cells }
    }

    /// Segments of the cells meeting the box of `a`-`b` padded by `pad`, sorted, without repeats.
    fn near(&self, a: Point, b: Point, pad: f64) -> Vec<u32> {
        let mut out = Vec::new();
        for key in keys(a, b, pad) {
            if let Some(ids) = self.cells.get(&key) {
                out.extend_from_slice(ids);
            }
        }
        out.sort_unstable();
        out.dedup();
        out
    }

    /// The first crossing of `a`-`b` with any front after its start; the lowest segment wins a tie.
    fn first_hit(&self, a: Point, b: Point) -> Option<Hit> {
        let mut best: Option<Hit> = None;
        for id in self.near(a, b, 0.0) {
            let (front, c, d) = self.segments[id as usize];
            if let Some((t, point)) = segment_hit(a, b, c, d)
                && best.as_ref().is_none_or(|h| t < h.t)
            {
                best = Some(Hit {
                    t,
                    point,
                    front,
                    tangent: unit(c, d),
                });
            }
        }
        best
    }

    /// Whether `a`-`b` meets no front after its start, except front `end` at its very end.
    fn clear(&self, a: Point, b: Point, end: Option<usize>) -> bool {
        self.near(a, b, 0.0).into_iter().all(|id| {
            let (front, c, d) = self.segments[id as usize];
            match segment_hit(a, b, c, d) {
                None => true,
                Some((t, _)) => t >= 1.0 - 1e-6 && Some(front) == end,
            }
        })
    }

    /// Distance from `p`, at most `reach`, to the nearest front segment that runs within 60
    /// degrees of `direction`, a street already climbing beside a link; the segments the link's
    /// `ends` lie on do not count.
    fn beside(&self, p: Point, direction: Point, reach: f64, ends: [Point; 2]) -> f64 {
        self.near(p, p, reach)
            .into_iter()
            .filter_map(|id| {
                let (_, c, d) = self.segments[id as usize];
                let u = unit(c, d);
                let touched = ends.iter().any(|&e| distance(e, c, d).0 < 0.01);
                (!touched && (u.x * direction.x + u.y * direction.y).abs() >= BESIDE_COSINE)
                    .then(|| distance(p, c, d).0)
            })
            .fold(reach, f64::min)
    }
}

/// Grid cells meeting the box of `a`-`b` padded by `pad`.
fn keys(a: Point, b: Point, pad: f64) -> impl Iterator<Item = (i64, i64)> {
    let cell = |v: f64| (v / CELL).floor() as i64;
    let (x0, x1) = (cell(a.x.min(b.x) - pad), cell(a.x.max(b.x) + pad));
    let (y0, y1) = (cell(a.y.min(b.y) - pad), cell(a.y.max(b.y) + pad));
    (y0..=y1).flat_map(move |y| (x0..=x1).map(move |x| (x, y)))
}

/// A link that can be laid, before the spacing rules.
struct Candidate {
    /// From the lower front to the upper one; the vertices between are landings.
    path: Vec<Point>,
    /// Lower and upper fronts.
    fronts: [usize; 2],
    /// Lower is better: short links far from any street already climbing beside them.
    score: f64,
    /// Lower front and foot, for a stable order among equal scores.
    order: (usize, usize),
}

/// A link laid, or a flight already in the draft (without fronts).
struct Placed {
    path: Vec<Point>,
    fronts: [Option<usize>; 2],
}

struct Linker<'a> {
    fronts: &'a [Front],
    index: &'a Index,
    outline: &'a Shape,
    terrain: &'a dyn TerrainView,
    params: &'a OrganicParams,
}

impl Linker<'_> {
    /// Candidate links from feet spaced along every front that can carry one.
    fn candidates(&self) -> Vec<Candidate> {
        let rule = &self.params.slope.stairs;
        let reach = rule.max_length.max(rule.flank_reach);
        let mut out = Vec::new();
        for (f, front) in self.fronts.iter().enumerate() {
            if !front.seat {
                continue;
            }
            for (k, (foot, tangent)) in feet(&front.path, FOOT_STEP).into_iter().enumerate() {
                if let Some(c) = self.candidate(f, foot, tangent, reach, (f, k)) {
                    out.push(c);
                }
            }
        }
        out
    }

    /// The link climbing straight up the slope from `p` on front `lower` to the next front:
    /// one flight when it is short and within the stair grade, a switchback when the ground
    /// between is too steep for any street, and none where a street would do.
    fn candidate(
        &self,
        lower: usize,
        p: Point,
        tangent: Point,
        reach: f64,
        order: (usize, usize),
    ) -> Option<Candidate> {
        let params = self.params;
        let rule = &params.slope.stairs;
        let terrain = self.terrain;
        let (gx, gy) = terrain.slope_at(p, PROBE);
        let slope = gx.hypot(gy);
        if !(slope.is_finite() && slope > params.max_street_grade) {
            return None;
        }
        let up = Point {
            x: gx / slope,
            y: gy / slope,
        };
        if cross(up, tangent).abs() < MIN_CROSSING_SINE
            || !contains(self.outline, along(p, up, 0.5))
        {
            return None;
        }
        let hit = self.index.first_hit(p, along(p, up, reach))?;
        if !self.fronts[hit.front].seat || cross(up, hit.tangent).abs() < MIN_CROSSING_SINE {
            return None;
        }
        let q = hit.point;
        let run = p.distance(q);
        let rise = terrain.height_at(q) - terrain.height_at(p);
        if run < MIN_LINK || !(rise > 0.0) {
            return None;
        }
        let grade = rise / run;
        if grade <= params.max_street_grade {
            return None;
        }
        let straight =
            run <= rule.max_length && segment_clear(terrain, p, q, params.max_stair_grade);
        let path = if straight {
            vec![p, q]
        } else if grade > params.max_lane_grade && run <= rule.flank_reach {
            self.switchback(p, q, grade, hit.front)?
        } else {
            return None;
        };
        let mid = Point {
            x: (p.x + q.x) * 0.5,
            y: (p.y + q.y) * 0.5,
        };
        let beside = self.index.beside(mid, up, rule.spacing, [p, q]);
        if beside < 0.5 * rule.spacing {
            return None;
        }
        Some(Candidate {
            path,
            fronts: [lower, hit.front],
            score: run / rule.max_length - beside / rule.spacing,
            order,
        })
    }

    /// Flights zigzagging from `p` up to `q` on front `upper`, each at most the flight length
    /// and laid at a share of the stair grade, landings alternately on the line `p`-`q` and to
    /// one side of it; the first side that stays clear wins.
    fn switchback(&self, p: Point, q: Point, grade: f64, upper: usize) -> Option<Vec<Point>> {
        let params = self.params;
        let rule = &params.slope.stairs;
        let run = p.distance(q);
        let sine = (SWITCHBACK_GRADE * params.max_stair_grade / grade).min(SWITCHBACK_SINE);
        if !(sine > 0.0 && rule.flight_length > 0.0) {
            return None;
        }
        let cosine = (1.0 - sine * sine).sqrt();
        // An even count ends the last flight back on the line, at `q`.
        let mut flights = ((run / (rule.flight_length * sine)).ceil() as usize).max(2);
        flights += flights % 2;
        if flights > MAX_FLIGHTS {
            return None;
        }
        let advance = run / flights as f64;
        let lateral = advance * cosine / sine;
        let ahead = unit(p, q);
        let side = Point {
            x: -ahead.y,
            y: ahead.x,
        };
        for sign in [1.0, -1.0] {
            let mut path: Vec<Point> = (0..=flights)
                .map(|k| {
                    let off = if k % 2 == 1 { lateral * sign } else { 0.0 };
                    let at = advance * k as f64;
                    Point {
                        x: p.x + ahead.x * at + side.x * off,
                        y: p.y + ahead.y * at + side.y * off,
                    }
                })
                .collect();
            path[0] = p;
            path[flights] = q;
            if path[1..flights].iter().all(|&v| contains(self.outline, v))
                && (0..flights).all(|k| self.flight_clear(&path, k, Some(upper)))
            {
                return Some(path);
            }
        }
        None
    }

    /// Whether flight `k` of `path` is within the stair grade on dry land and meets no front
    /// after its start, the last one only `upper` at its end.
    fn flight_clear(&self, path: &[Point], k: usize, upper: Option<usize>) -> bool {
        let (a, b) = (path[k], path[k + 1]);
        let end = if k + 2 == path.len() { upper } else { None };
        segment_clear(self.terrain, a, b, self.params.max_stair_grade)
            && self.index.clear(a, b, end)
    }

    /// The candidate's path if the spacing rules admit it among the links placed so far: at
    /// most one flight per spacing along a street, none side by side within the spacing. A
    /// candidate starting where a placed link ends (or ending where one starts) continues it,
    /// and its end moves onto that link's end.
    fn admit(&self, c: &Candidate, placed: &[Placed]) -> Option<Vec<Point>> {
        let spacing = self.params.slope.stairs.spacing;
        let mut path = c.path.clone();
        let last = path.len() - 1;
        for other in placed {
            let (start, end) = (other.path[0], other.path[other.path.len() - 1]);
            if other.fronts[1] == Some(c.fronts[0]) && path[0].distance(end) <= CONTINUE {
                path[0] = end;
                continue;
            }
            if other.fronts[0] == Some(c.fronts[1]) && path[last].distance(start) <= CONTINUE {
                path[last] = start;
                continue;
            }
            for (i, own) in [path[0], path[last]].into_iter().enumerate() {
                for (j, theirs) in [start, end].into_iter().enumerate() {
                    if other.fronts[j] == Some(c.fronts[i]) && own.distance(theirs) < spacing {
                        return None;
                    }
                }
            }
            if side_by_side(&path, &other.path, spacing) {
                return None;
            }
        }
        let upper = Some(c.fronts[1]);
        if path[0] != c.path[0] && !self.flight_clear(&path, 0, upper) {
            return None;
        }
        if path[last] != c.path[last] && !self.flight_clear(&path, last - 1, upper) {
            return None;
        }
        Some(path)
    }
}

/// Whether `other` climbs beside `path`: their stretches up the slope overlap by more than a
/// landing and they come closer than `spacing`. A link above or below another is not beside it.
fn side_by_side(path: &[Point], other: &[Point], spacing: f64) -> bool {
    let (a, b) = (path[0], path[path.len() - 1]);
    let length = a.distance(b);
    if length < 1e-9 {
        return false;
    }
    let ahead = unit(a, b);
    let station = |p: &Point| (p.x - a.x) * ahead.x + (p.y - a.y) * ahead.y;
    let (low, high) = other
        .iter()
        .map(station)
        .fold((f64::INFINITY, f64::NEG_INFINITY), |(l, h), s| (l.min(s), h.max(s)));
    high.min(length) - low.max(0.0) > CONTINUE && path_distance(path, other) < spacing
}

/// Least distance between two polylines; 0 where they cross.
fn path_distance(a: &[Point], b: &[Point]) -> f64 {
    let mut best = f64::INFINITY;
    for u in a.windows(2) {
        for v in b.windows(2) {
            if segment_hit(u[0], u[1], v[0], v[1]).is_some() {
                return 0.0;
            }
            best = best
                .min(distance(u[0], v[0], v[1]).0)
                .min(distance(u[1], v[0], v[1]).0)
                .min(distance(v[0], u[0], u[1]).0)
                .min(distance(v[1], u[0], u[1]).0);
        }
    }
    best
}

/// Points every `step` metres along a polyline, from half a step after its start, each with
/// the unit direction of its segment.
fn feet(path: &[Point], step: f64) -> Vec<(Point, Point)> {
    let mut out = Vec::new();
    let (mut at, mut next) = (0.0, step * 0.5);
    for w in path.windows(2) {
        let length = w[0].distance(w[1]);
        if length < 1e-9 {
            continue;
        }
        let tangent = unit(w[0], w[1]);
        while next <= at + length {
            out.push((along(w[0], tangent, next - at), tangent));
            next += step;
        }
        at += length;
    }
    out
}

/// Unit direction from `a` to `b`; zero for coincident points.
fn unit(a: Point, b: Point) -> Point {
    let length = a.distance(b);
    if length < 1e-12 {
        return Point { x: 0.0, y: 0.0 };
    }
    Point {
        x: (b.x - a.x) / length,
        y: (b.y - a.y) / length,
    }
}

/// The point `length` metres from `p` along unit direction `u`.
fn along(p: Point, u: Point, length: f64) -> Point {
    Point {
        x: p.x + u.x * length,
        y: p.y + u.y * length,
    }
}

/// Sine of the angle from unit `a` to unit `b`.
fn cross(a: Point, b: Point) -> f64 {
    a.x * b.y - a.y * b.x
}
