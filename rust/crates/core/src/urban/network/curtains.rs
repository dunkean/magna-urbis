//! Curtain and reserve clearance for street routes, including the inner ring road.

use super::spatial::{EPS, Key, distance, lerp};
use crate::urban::{Enclosure, LayoutConfig, Point, Shape, Street, Surface};
use std::collections::{BTreeMap, BTreeSet};

/// Curtains the open-edge network keeps to: no peripheral section, feeder or
/// rural path crosses one, nor the outer lip of a moat run (the ditch is
/// continuous: only gate streets cross it), and no peripheral section runs
/// within `clearance` of a curtain (its ribbon would ride the curtain body and
/// weave through it) nor in the fortification reserve (ditch, berm, glacis,
/// works): a section that would is moved off them (`keep_off`), outside the
/// reserve, or along the outer face where no ditch runs.
/// The town inside an enclosure keeps its own wall/gate semantics.
pub(super) struct Curtains {
    walls: Vec<(
        crate::urban::fortification::Near,
        crate::urban::geometry::ContainmentIndex,
        f64,
    )>,
    /// Outer lips of the moat runs.
    lips: Vec<crate::urban::fortification::Near>,
    /// Reserve tiles: box and containment.
    reserve: Vec<((f64, f64, f64, f64), crate::urban::geometry::ContainmentIndex)>,
    /// Obstacle edges on a `KEEP_CELL` grid: (a, b, curtain clearance), the
    /// clearance being 0 for a reserve boundary edge (it takes the half road).
    edges: Vec<(Point, Point, f64)>,
    grid: BTreeMap<Key, Vec<usize>>,
    /// Outer lean-tos: a lane ending beside one serves it, it is no open edge.
    lean: Vec<Shape>,
    /// Inner lane line of each circuit (`walls[i]`), and the gate passages.
    lanes: Vec<Lane>,
    passages: Vec<crate::urban::geometry::ContainmentIndex>,
}
/// The wall-lane line of a circuit: its curtain path moved inward by the
/// ribbon half and half a lane, as closed rings (first vertex not repeated).
struct Lane {
    rings: Vec<Vec<Point>>,
    /// Cumulative length at each ring vertex (one more than vertices).
    stations: Vec<Vec<f64>>,
    near: Vec<crate::urban::fortification::Near>,
    /// Lane width (m).
    width: f64,
}
const KEEP_CELL: f64 = 20.0;
/// Margin between a re-routed ribbon and the reserve (m).
const KEEP_MARGIN: f64 = 0.5;
/// Farthest a peripheral vertex is moved off the fortification (m).
const KEEP_REACH: f64 = 120.0;
/// Ring vertices a re-routed section may bridge at once.
const KEEP_SKIP: usize = 12;
fn cell(p: Point) -> Key {
    (
        (p.x / KEEP_CELL).floor() as i64,
        (p.y / KEEP_CELL).floor() as i64,
    )
}
impl Curtains {
    pub(super) fn new(enclosures: &[Enclosure]) -> Self {
        use crate::urban::{fortification, geometry as g};
        let mut edges = vec![];
        let mut reserve = vec![];
        let mut lean = vec![];
        let mut lanes = vec![];
        let mut passages = vec![];
        let lips: Vec<fortification::Near> = enclosures
            .iter()
            .filter_map(|e| e.moat.as_ref())
            .flat_map(|m| m.runs.iter())
            .filter(|r| r.outer.len() >= 2)
            .map(|r| {
                let mut lip = r.outer.clone();
                if r.closed {
                    lip.push(lip[0]);
                }
                fortification::Near::new(&lip, 12.0)
            })
            .collect();
        let walls = enclosures
            .iter()
            .filter(|e| e.path.len() >= 4)
            .map(|e| {
                let half = fortification::ribbon_half(&e.kind);
                // Body from the inner face (-half) outward, then the widest
                // peripheral half ribbon (8 m road) and a metre of margin.
                let clearance = (e.curtain_width_m - half).max(half) + 4.0 + 1.0;
                let mut outer = e.path.clone();
                if distance(outer[0], *outer.last().unwrap()) < EPS {
                    outer.pop();
                }
                edges.extend(e.path.windows(2).map(|w| (w[0], w[1], clearance)));
                for s in &e.reserve {
                    for ring in std::iter::once(&s.outer).chain(s.holes.iter()) {
                        edges.extend(
                            ring.iter()
                                .zip(ring.iter().cycle().skip(1))
                                .take(ring.len())
                                .map(|(&a, &b)| (a, b, 0.0)),
                        );
                    }
                    reserve.push((g::bbox(s), g::ContainmentIndex::new(s)));
                }
                lean.extend(
                    e.attached
                        .iter()
                        .filter(|a| a.side == "out")
                        .map(|a| a.shape.clone()),
                );
                let (shapes, width) = lane_line(e);
                let rings: Vec<Vec<Point>> = shapes
                    .into_iter()
                    .map(|s| s.outer)
                    .filter(|r| r.len() >= 3)
                    .collect();
                let closed = |r: &Vec<Point>| -> Vec<Point> {
                    r.iter().chain(std::iter::once(&r[0])).copied().collect()
                };
                lanes.push(Lane {
                    stations: rings
                        .iter()
                        .map(|r| {
                            let c = closed(r);
                            std::iter::once(0.0)
                                .chain(c.windows(2).scan(0.0, |t, w| {
                                    *t += distance(w[0], w[1]);
                                    Some(*t)
                                }))
                                .collect()
                        })
                        .collect(),
                    near: rings
                        .iter()
                        .map(|r| fortification::Near::new(&closed(r), 12.0))
                        .collect(),
                    rings,
                    width,
                });
                passages.extend(
                    e.gatehouses
                        .iter()
                        .map(|gh| g::ContainmentIndex::new(&gh.shape)),
                );
                let poly = g::normalized(Shape {
                    outer,
                    holes: vec![],
                });
                (
                    fortification::Near::new(&e.path, clearance.max(12.0)),
                    g::ContainmentIndex::new(&poly),
                    clearance,
                )
            })
            .collect();
        let mut grid: BTreeMap<Key, Vec<usize>> = BTreeMap::new();
        for (i, &(a, b, _)) in edges.iter().enumerate() {
            let steps = (distance(a, b) / KEEP_CELL).ceil().max(1.0) as usize;
            for k in 0..=steps {
                let v = grid
                    .entry(cell(lerp(a, b, k as f64 / steps as f64)))
                    .or_default();
                if v.last() != Some(&i) {
                    v.push(i);
                }
            }
        }
        Curtains {
            walls,
            lips,
            reserve,
            edges,
            grid,
            lean,
            lanes,
            passages,
        }
    }
    /// Inside a circuit (the walled town, not the open fringe).
    pub(super) fn inside(&self, p: Point) -> bool {
        self.walls.iter().any(|(_, poly, _)| poly.contains(p))
    }
    /// A segment through a curtain or over the outer lip of a moat run.
    pub(super) fn crosses(&self, a: Point, b: Point) -> bool {
        self.walls
            .iter()
            .any(|(near, _, _)| near.distance(a, b) == 0.0)
            || self.lips.iter().any(|near| near.distance(a, b) == 0.0)
    }
    pub(super) fn hugs(&self, a: Point, b: Point) -> bool {
        self.walls
            .iter()
            .any(|(near, _, c)| near.distance(a, b) < *c)
    }
    /// A street end beside an outer lean-to (the lane serving it).
    pub(super) fn serves_lean_to(&self, p: Point, reach: f64) -> bool {
        self.lean.iter().any(|s| {
            let r = &s.outer;
            (0..r.len()).any(|k| crate::urban::geometry::distance(p, r[k], r[(k + 1) % r.len()]).0 < reach)
        })
    }
    fn near_edges(&self, p: Point, rings: i64) -> impl Iterator<Item = &(Point, Point, f64)> {
        let (cx, cy) = cell(p);
        let mut seen = BTreeSet::new();
        for dx in -rings..=rings {
            for dy in -rings..=rings {
                if let Some(v) = self.grid.get(&(cx + dx, cy + dy)) {
                    seen.extend(v.iter().copied());
                }
            }
        }
        seen.into_iter().map(|i| &self.edges[i])
    }
    /// A road centre point whose half ribbon `hw` keeps off every curtain
    /// (its clearance) and every reserve tile (`KEEP_MARGIN`).
    fn clear_at(&self, p: Point, hw: f64) -> bool {
        if self.reserve.iter().any(|((x0, y0, x1, y1), idx)| {
            p.x >= *x0 && p.x <= *x1 && p.y >= *y0 && p.y <= *y1 && idx.contains(p)
        }) {
            return false;
        }
        self.near_edges(p, 1).all(|&(a, b, c)| {
            let need = if c > 0.0 { c } else { hw + KEEP_MARGIN };
            crate::urban::geometry::distance(p, a, b).0 >= need
        })
    }
    /// A wall-lane centre point whose half ribbon `hw` leaves every reserve
    /// tile (ditch, towers, works) and gate passage alone.
    pub(super) fn lane_clear_at(&self, p: Point, hw: f64) -> bool {
        self.inside(p)
            && !self.passages.iter().any(|g| g.contains(p))
            && !self.reserve.iter().any(|((x0, y0, x1, y1), idx)| {
                p.x >= *x0 && p.x <= *x1 && p.y >= *y0 && p.y <= *y1 && idx.contains(p)
            })
            && self
                .near_edges(p, 1)
                .filter(|e| e.2 == 0.0)
                .all(|&(a, b, _)| crate::urban::geometry::distance(p, a, b).0 >= hw - 0.05)
    }
    fn lane_segment_clear(&self, a: Point, b: Point, hw: f64) -> bool {
        let steps = distance(a, b).ceil().max(1.0) as usize;
        !self.crosses(a, b)
            && (0..=steps).all(|k| self.lane_clear_at(lerp(a, b, k as f64 / steps as f64), hw))
    }
    /// The wall-lane section along `path` (a stretch of the lane line): moved
    /// inward past what blocks it (a tower, a gatehouse, a work reaching
    /// inside), or `None` when it cannot keep clear of the reserve and the gates.
    fn lane_route(&self, path: &[Point], hw: f64) -> Option<Vec<Point>> {
        // Dense enough to see a reserve tile the straight edge would clip.
        let mut dense = vec![path[0]];
        for w in path.windows(2) {
            let n = (distance(w[0], w[1]) / 3.0).ceil().max(1.0) as usize;
            dense.extend((1..=n).map(|k| lerp(w[0], w[1], k as f64 / n as f64)));
        }
        let last = dense.len() - 1;
        // Inward direction (away from the nearest curtain point) at a point.
        let inward = |p: Point| -> Option<Point> {
            let (d, q) = self
                .near_edges(p, 3)
                .filter(|e| e.2 > 0.0)
                .map(|&(a, b, _)| {
                    let (d, _, q) = crate::urban::geometry::distance(p, a, b);
                    (d, q)
                })
                .min_by(|x, y| x.0.total_cmp(&y.0))?;
            let d = d.max(EPS);
            Some(Point {
                x: (p.x - q.x) / d,
                y: (p.y - q.y) / d,
            })
        };
        // Offset each blocked point needs, then spread along the lane at a
        // gentle slope so the detour clears the corners of what blocks it.
        let mut need = vec![0.0f64; dense.len()];
        for (i, &p) in dense.iter().enumerate() {
            if self.lane_clear_at(p, hw) {
                continue;
            }
            // The two anchors are where they are.
            if i == 0 || i == last {
                return None;
            }
            let u = inward(p)?;
            need[i] = (1..=KEEP_REACH as usize / 10).find(|&k| {
                self.lane_clear_at(
                    Point {
                        x: p.x + u.x * k as f64,
                        y: p.y + u.y * k as f64,
                    },
                    hw,
                )
            })? as f64;
        }
        let ok = |p: &[Point]| {
            p.windows(2)
                .all(|w| self.lane_segment_clear(w[0], w[1], hw))
        };
        // Gentler slopes (and a margin) until the detour clears the corners.
        for (slope, margin) in [(0.5, 0.0), (0.3, 1.5), (0.15, 3.0)] {
            let mut o: Vec<f64> = need
                .iter()
                .map(|&n| if n > 0.0 { n + margin } else { 0.0 })
                .collect();
            for pass in 0..2 {
                for s in 0..o.len() {
                    let i = if pass == 0 { s } else { last - s };
                    let j = if pass == 0 { i.wrapping_sub(1) } else { i + 1 };
                    if let Some(&prev) = o.get(j) {
                        o[i] = o[i].max(prev - distance(dense[i], dense[j]) * slope);
                    }
                }
            }
            (o[0], o[last]) = (0.0, 0.0);
            let out: Vec<Point> = dense
                .iter()
                .zip(&o)
                .map(|(&p, &o)| match inward(p) {
                    Some(u) if o > 0.0 => Point {
                        x: p.x + u.x * o,
                        y: p.y + u.y * o,
                    },
                    _ => p,
                })
                .collect();
            let smooth = crate::urban::geometry::simplify(&out, 0.25, |_| false);
            if ok(&smooth) {
                return Some(smooth);
            } else if ok(&out) {
                return Some(out);
            }
            if need.iter().all(|&n| n == 0.0) {
                break;
            }
        }
        None
    }
    /// Clear of the reserve and the curtains, and over no moat lip (a street
    /// slot left in the reserve tiles does not let a section through the ditch).
    pub(super) fn segment_clear(&self, a: Point, b: Point, hw: f64) -> bool {
        let steps = (distance(a, b) / 2.0).ceil().max(1.0) as usize;
        (0..=steps).all(|k| self.clear_at(lerp(a, b, k as f64 / steps as f64), hw))
            && !self.hugs(a, b)
            && !self.crosses(a, b)
    }
    /// `p` moved straight away from the nearest curtain until its ribbon is
    /// clear (from inside a circuit, out along the curtain normal, when
    /// `from_inside`); `None` inside a circuit otherwise, or beyond `KEEP_REACH`.
    fn push(&self, p: Point, hw: f64, from_inside: bool) -> Option<Point> {
        if self.clear_at(p, hw) {
            return Some(p);
        }
        let inside = self.inside(p);
        if inside && !from_inside {
            return None;
        }
        let (_, q, a, b) = self
            .near_edges(p, 3)
            .filter(|e| e.2 > 0.0)
            .map(|&(a, b, _)| {
                let (d, _, q) = crate::urban::geometry::distance(p, a, b);
                (d, q, a, b)
            })
            .min_by(|x, y| x.0.total_cmp(&y.0))?;
        let d = distance(p, q);
        // Away from the curtain; on (or almost on) it, along the outward
        // normal of its segment.
        let u = if d > 0.5 && !inside {
            Point {
                x: (p.x - q.x) / d,
                y: (p.y - q.y) / d,
            }
        } else {
            let l = distance(a, b).max(EPS);
            let n = Point {
                x: -(b.y - a.y) / l,
                y: (b.x - a.x) / l,
            };
            if self.inside(Point {
                x: q.x + n.x,
                y: q.y + n.y,
            }) {
                Point { x: -n.x, y: -n.y }
            } else {
                n
            }
        };
        (1..=KEEP_REACH as usize)
            .map(|k| Point {
                x: p.x + u.x * k as f64,
                y: p.y + u.y * k as f64,
            })
            .find(|&x| self.clear_at(x, hw))
    }
    /// The section moved off the fortification: every vertex but the two
    /// street ends is pushed clear, then a segment still cutting a corner of
    /// the reserve is split and its middle pushed (six levels). The end
    /// segments only have to keep off the curtain (their street ends are
    /// where they are). `None` when no clear route remains.
    pub(super) fn keep_off(&self, path: &[Point], hw: f64) -> Option<Vec<Point>> {
        let n = path.len();
        if n < 2 {
            return None;
        }
        // A vertex inside a circuit (the ring dipping into a gate gap) is
        // left out, the segment that bridges it is checked like the others;
        // every other vertex must be pushed clear.
        let mut pts = vec![path[0]];
        for &p in &path[1..n - 1] {
            match self.push(p, hw, false) {
                Some(x) => pts.push(x),
                None if self.inside(p) => {}
                None => return None,
            }
        }
        if n > 2 && pts.len() < 2 {
            return None;
        }
        pts.push(path[n - 1]);
        let last = pts.len() - 1;
        let mut out = vec![pts[0]];
        let mut i = 0;
        while i < last {
            // A vertex no clear segment reaches (a pocket of the ring between
            // gate structures) is bridged: the next ones are tried in turn.
            let mut next = None;
            for j in i + 1..=(i + KEEP_SKIP).min(last) {
                // An end segment keeps its street end, wherever that end is.
                let end_segment = i == 0 && !self.clear_at(pts[0], hw)
                    || j == last && !self.clear_at(pts[last], hw);
                let mut run = vec![];
                let depth = if j == i + 1 { 6 } else { 3 };
                if self
                    .refine(pts[i], pts[j], hw, depth, end_segment, &mut run)
                    .is_some()
                {
                    out.extend(run);
                    next = Some(j);
                    break;
                }
            }
            i = next?;
        }
        out.dedup_by(|a, b| distance(*a, *b) < 0.5);
        if out.len() < 2 {
            return None;
        }
        // Pushed vertices follow every bump of the reserve edge: smooth the
        // run where the smoothed segments stay clear.
        let smooth = crate::urban::geometry::simplify(&out, 1.0, |_| false);
        let lenient = |i: usize, last: usize, p: &[Point]| {
            i == 0 && !self.clear_at(p[0], hw) || i + 1 == last && !self.clear_at(p[last], hw)
        };
        let last = smooth.len() - 1;
        let valid = (0..last).all(|i| {
            if lenient(i, last, &smooth) {
                !self.crosses(smooth[i], smooth[i + 1])
            } else {
                self.segment_clear(smooth[i], smooth[i + 1], hw)
            }
        });
        Some(if valid { smooth } else { out })
    }
    fn refine(
        &self,
        a: Point,
        b: Point,
        hw: f64,
        depth: usize,
        end_segment: bool,
        out: &mut Vec<Point>,
    ) -> Option<()> {
        let ok = if end_segment {
            !self.crosses(a, b)
        } else {
            self.segment_clear(a, b, hw)
        };
        if ok {
            out.push(b);
            return Some(());
        }
        if depth == 0 || distance(a, b) < 2.0 {
            return None;
        }
        // The middle of a segment bridging a gate gap may lie inside the
        // circuit: it is pushed out through the curtain, in front of the gate.
        let m = self.push(lerp(a, b, 0.5), hw, true)?;
        self.refine(a, m, hw, depth - 1, end_segment, out)?;
        self.refine(m, b, hw, depth - 1, end_segment, out)
    }
}

/// How far from the lane line a street end still belongs to it (m).
const LANE_REACH: f64 = 14.0;
/// Farthest (m, along a gate street) its crossing of the lane line lies from
/// its crossing of the curtain.
const GATE_LANE_REACH: f64 = 30.0;
/// Farthest (m) past the lane line a section end slides along a gate street
/// to keep clear of the gatehouse, in 2 m steps.
const GATE_LANE_SLIDE: f64 = 14.0;
/// Invariant (inner ring roads): a street end inside a circuit that stops at
/// the curtain (a dead end on the wall) is carried to the wall-lane line, and
/// every consecutive pair of such ends along a circuit is joined by a
/// `wall-lane` section following that line: the ring road inside the wall.
/// A street through the curtain (a gate street) is an anchor too: the
/// sections on both sides of its gate end on it, on its centre line where it
/// meets the lane line (or a little further in, clear of the gatehouse and its
/// passage), at a vertex shared with it; the gate street is not cut. A circuit
/// with no dead end on its wall lays no section.
/// A section is the lane line itself (what `enclosure_lanes` lays; stretches
/// it already covers are left alone), moved inward past a tower or a gatehouse,
/// always inside the circuit, off every reserve tile and gate passage; a
/// section no clear route serves keeps its dead ends. Every section is laid,
/// whatever the peripheral setting: a stretch of wall foot left to the lots
/// between two lanes reads as an unfinished wall. Returns the kept and
/// dropped section lengths (measurement).
pub(super) fn inner_ring(
    streets: &mut Vec<Street>,
    curtains: &Curtains,
    ends: &[(usize, bool)],
    surface: Surface<'_>,
    cfg: &LayoutConfig,
) -> (f64, f64) {
    use crate::urban::{geometry as g, routing};
    struct Anchor {
        street: usize,
        end: bool,
        /// Vertices of the street dropped at this end; the lane point
        /// replaces them.
        cut: usize,
        at: Point,
        station: f64,
        edge: usize,
        /// A gate street: the section ends on it at one of `alts` (from the
        /// lane line inward) and the street keeps its whole path.
        through: bool,
        alts: Vec<Point>,
    }
    // (circuit, ring) -> street ends on that lane ring.
    let mut groups: BTreeMap<(usize, usize), Vec<Anchor>> = BTreeMap::new();
    for &(i, end) in ends {
        let s = &streets[i];
        let n = s.path.len();
        let pts: Vec<Point> = if end {
            s.path.clone()
        } else {
            s.path.iter().rev().copied().collect()
        };
        let p = pts[n - 1];
        let Some(w) = curtains
            .walls
            .iter()
            .position(|(_, idx, _)| idx.contains(p))
        else {
            continue;
        };
        let lane = &curtains.lanes[w];
        // The street's own crossing of the lane line, nearest its end.
        let mut found = None;
        let mut arc = 0.0;
        for m in (1..n).rev() {
            let (a, b) = (pts[m - 1], pts[m]);
            let mut best: Option<(f64, usize, usize, Point)> = None;
            for (r, near) in lane.near.iter().enumerate() {
                let ring = &lane.rings[r];
                for k in near.crossed(a, b) {
                    if let Some((t, x)) = g::segment_hit(a, b, ring[k], ring[(k + 1) % ring.len()])
                        && best.is_none_or(|c| t > c.0)
                    {
                        best = Some((t, r, k, x));
                    }
                }
            }
            if let Some((_, r, k, x)) = best {
                found = Some((r, k, x, n - m));
                break;
            }
            arc += distance(a, b);
            if arc > 30.0 {
                break;
            }
        }
        if found.is_none() {
            // A street stopping short of the lane line is carried on to it.
            found = lane
                .rings
                .iter()
                .enumerate()
                .flat_map(|(r, ring)| {
                    (0..ring.len()).map(move |k| {
                        let (d, _, q) = g::distance(p, ring[k], ring[(k + 1) % ring.len()]);
                        (d, r, k, q)
                    })
                })
                .filter(|c| c.0 <= LANE_REACH)
                .min_by(|x, y| x.0.total_cmp(&y.0))
                .filter(|&(_, _, _, q)| curtains.lane_segment_clear(p, q, lane.width * 0.5))
                .map(|(_, r, k, q)| (r, k, q, 0));
        }
        let Some((r, k, x, cut)) = found else {
            continue;
        };
        let ring = &lane.rings[r];
        groups.entry((w, r)).or_default().push(Anchor {
            street: i,
            end,
            cut,
            at: x,
            station: lane.stations[r][k] + distance(ring[k], x),
            edge: k,
            through: false,
            alts: vec![],
        });
    }
    // Gate streets: where each crosses the lane line behind its curtain crossing.
    for (i, s) in streets.iter().enumerate() {
        let n = s.path.len();
        if n < 2
            || super::street::private(s)
            || matches!(s.role.as_str(), "wall-lane" | "bridge" | "ford" | "causeway" | "quay" | "pier" | "boardwalk" | "landing" | "mole")
        {
            continue;
        }
        let cum: Vec<f64> = std::iter::once(0.0)
            .chain(s.path.windows(2).scan(0.0, |t, w| {
                *t += distance(w[0], w[1]);
                Some(*t)
            }))
            .collect();
        let at_arc = |d: f64| -> Point {
            let m = (0..n - 1).find(|&m| cum[m + 1] >= d).unwrap_or(n - 2);
            let l = (cum[m + 1] - cum[m]).max(EPS);
            lerp(s.path[m], s.path[m + 1], ((d - cum[m]) / l).clamp(0.0, 1.0))
        };
        for (w, (near, poly, _)) in curtains.walls.iter().enumerate() {
            // Arcs where the street passes the curtain (bisected on the circuit outline).
            let passes: Vec<f64> = (0..n - 1)
                .filter_map(|m| {
                    let (a, b) = (s.path[m], s.path[m + 1]);
                    let from = poly.contains(a);
                    if near.distance(a, b) > 0.0 || from == poly.contains(b) {
                        return None;
                    }
                    let (mut lo, mut hi) = (0.0, 1.0);
                    for _ in 0..24 {
                        let t = 0.5 * (lo + hi);
                        if poly.contains(lerp(a, b, t)) == from {
                            lo = t;
                        } else {
                            hi = t;
                        }
                    }
                    Some(cum[m] + 0.5 * (lo + hi) * distance(a, b))
                })
                .collect();
            if passes.is_empty() {
                continue;
            }
            let lane = &curtains.lanes[w];
            let hw = lane.width * 0.5;
            let mut hits: Vec<(f64, usize, usize, Point)> = vec![];
            for m in 0..n - 1 {
                let (a, b) = (s.path[m], s.path[m + 1]);
                for (r, near) in lane.near.iter().enumerate() {
                    let ring = &lane.rings[r];
                    for k in near.crossed(a, b) {
                        if let Some((t, x)) = g::segment_hit(a, b, ring[k], ring[(k + 1) % ring.len()]) {
                            hits.push((cum[m] + t * distance(a, b), r, k, x));
                        }
                    }
                }
            }
            for &c in &passes {
                let Some(&(arc, r, k, x)) = hits
                    .iter()
                    .filter(|h| (h.0 - c).abs() <= GATE_LANE_REACH)
                    .min_by(|p, q| (p.0 - c).abs().total_cmp(&(q.0 - c).abs()))
                else {
                    continue;
                };
                // From the lane line inward (away from the curtain); a point
                // within 0.5 m of a street vertex is that vertex.
                let away = if arc >= c { 1.0 } else { -1.0 };
                let alts: Vec<Point> = (0..=(GATE_LANE_SLIDE / 2.0) as usize)
                    .map(|j| arc + away * 2.0 * j as f64)
                    .filter(|d| (0.0..=cum[n - 1]).contains(d))
                    .map(|d| {
                        let p = at_arc(d);
                        s.path.iter().copied().find(|&v| distance(v, p) < 0.5).unwrap_or(p)
                    })
                    .filter(|&p| curtains.lane_clear_at(p, hw))
                    .collect();
                let Some(&at) = alts.first() else { continue };
                let ring = &lane.rings[r];
                groups.entry((w, r)).or_default().push(Anchor {
                    street: i,
                    end: false,
                    cut: 0,
                    at,
                    station: lane.stations[r][k] + distance(ring[k], x),
                    edge: k,
                    through: true,
                    alts,
                });
            }
        }
    }
    let (mut kept, mut dropped) = (0.0, 0.0);
    let mut used: BTreeSet<(usize, bool)> = BTreeSet::new();
    // Section ends on gate streets: (street, point), a vertex to share.
    let mut junctions: Vec<(usize, Point)> = vec![];
    fn serve(x: &Anchor, p: Point, used: &mut BTreeSet<(usize, bool)>, junctions: &mut Vec<(usize, Point)>) {
        if x.through {
            junctions.push((x.street, p));
        } else {
            used.insert((x.street, x.end));
        }
    }
    let mut anchored: Vec<Anchor> = vec![];
    let wall_lanes: Vec<_> = streets
        .iter()
        .filter(|s| s.role == "wall-lane")
        .map(|s| crate::urban::fortification::Near::new(&s.path, 8.0))
        .collect();
    let mut sections: Vec<Street> = vec![];
    for ((w, r), mut group) in groups {
        group.sort_by(|a, b| a.station.total_cmp(&b.station));
        let n = group.len();
        if n < 2 || group.iter().all(|a| a.through) {
            continue;
        }
        let lane = &curtains.lanes[w];
        let (ring, total) = (&lane.rings[r], *lane.stations[r].last().unwrap());
        let hw = lane.width * 0.5;
        // The end of a section at an anchor, at the `j`-th try.
        let pick = |x: &Anchor, j: usize| if x.through { x.alts[j.min(x.alts.len() - 1)] } else { x.at };
        for k in 0..n {
            let (a, b) = (&group[k], &group[(k + 1) % n]);
            // Two ends make two arcs of the same ring; one is enough when
            // they meet.
            if distance(a.at, b.at) < if n == 2 { 2.0 * hw } else { 1.0 } {
                continue;
            }
            // Forward along the ring from `a` to `b`.
            let wrap = b.station <= a.station;
            let m = ring.len();
            let last = if wrap { b.edge + m } else { b.edge };
            let section = |pa: Point, pb: Point| {
                let mut path = vec![pa];
                path.extend((a.edge + 1..=last).map(|j| ring[j % m]));
                path.push(pb);
                path.dedup_by(|p, q| distance(*p, *q) < 0.05);
                path
            };
            let path = section(a.at, b.at);
            let length = if wrap {
                total - a.station + b.station
            } else {
                b.station - a.station
            };
            if path.len() < 2 || length < 1.0 {
                continue;
            }
            // Already served: every sample rides an existing wall-lane.
            let covered = path.windows(2).all(|w| {
                let steps = (distance(w[0], w[1]) / 4.0).ceil().max(1.0) as usize;
                (0..=steps).all(|j| {
                    let p = lerp(w[0], w[1], j as f64 / steps as f64);
                    wall_lanes.iter().any(|n| n.distance(p, p) < 1.0)
                })
            });
            // A gate street end slides inward until the section clears the gatehouse.
            let tries = if covered { 0 } else { a.alts.len().max(b.alts.len()).max(1) };
            let mut routed: Option<(Vec<Point>, Point, Point)> = None;
            let mut route = None;
            for j in 0..tries {
                let (pa, pb) = (pick(a, j), pick(b, j));
                let Some(p) = curtains.lane_route(&section(pa, pb), hw) else { continue };
                if routing::path_clear(surface, &p, cfg.max_street_grade) {
                    route = Some((p, pa, pb));
                    break;
                }
                if routed.is_none() {
                    routed = Some((p, pa, pb));
                }
            }
            match route {
                Some((p, pa, pb)) => {
                    kept += length;
                    serve(a, pa, &mut used, &mut junctions);
                    serve(b, pb, &mut used, &mut junctions);
                    sections.push(Street {
                        widths: vec![lane.width; p.len()],
                        path: p,
                        rank: 2,
                        role: "wall-lane".into(),
                    });
                }
                None if covered => {
                    for x in [a, b].into_iter().filter(|x| !x.through) {
                        used.insert((x.street, x.end));
                    }
                }
                None => {
                    dropped += length;
                    // Water or a slope on the way: the lane still runs from
                    // each end up to it (a dead end along the wall foot), so
                    // the wall is not left with a strip of lot along it.
                    let Some((p, pa, pb)) = routed else { continue };
                    let [head, tail] = clear_spurs(&p, surface, cfg.max_street_grade);
                    for (spur, x, at) in [(head, a, pa), (tail, b, pb)] {
                        if let Some(spur) = spur {
                            kept += spur.windows(2).map(|w| distance(w[0], w[1])).sum::<f64>();
                            serve(x, at, &mut used, &mut junctions);
                            sections.push(Street {
                                widths: vec![lane.width; spur.len()],
                                path: spur,
                                rank: 2,
                                role: "wall-lane".into(),
                            });
                        }
                    }
                }
            }
        }
        anchored.extend(group);
    }
    // The served street ends stop on the lane (a dead end past it, in the
    // curtain ribbon, goes).
    for a in anchored
        .iter()
        .filter(|a| !a.through && used.contains(&(a.street, a.end)))
    {
        let s = &mut streets[a.street];
        if s.widths.len() != s.path.len() {
            let last = s.widths.last().copied().unwrap_or(4.0);
            s.widths.resize(s.path.len(), last);
        }
        if s.path.len() <= a.cut {
            continue;
        }
        let keep = s.path.len() - a.cut;
        let w = s.widths[if a.end { keep - 1 } else { a.cut }];
        if a.end {
            s.path.truncate(keep);
            s.widths.truncate(keep);
            s.path.push(a.at);
            s.widths.push(w);
        } else {
            s.path.drain(..a.cut);
            s.widths.drain(..a.cut);
            s.path.insert(0, a.at);
            s.widths.insert(0, w);
        }
    }
    // A section ending on a gate street ends on one of its vertices.
    for (i, p) in junctions {
        let s = &mut streets[i];
        if s.path.iter().any(|&v| distance(v, p) < EPS) {
            continue;
        }
        if s.widths.len() != s.path.len() {
            let last = s.widths.last().copied().unwrap_or(4.0);
            s.widths.resize(s.path.len(), last);
        }
        let Some((m, (d, t, _))) = (0..s.path.len().saturating_sub(1))
            .map(|m| (m, g::distance(p, s.path[m], s.path[m + 1])))
            .min_by(|x, y| x.1.0.total_cmp(&y.1.0))
        else {
            continue;
        };
        if d < 1e-3 {
            let w = s.widths[m] + (s.widths[m + 1] - s.widths[m]) * t;
            s.path.insert(m + 1, p);
            s.widths.insert(m + 1, w);
        }
    }
    streets.extend(sections);
    (kept, dropped)
}

/// Shortest wall-lane dead end worth laying (m).
const MIN_SPUR: f64 = 10.0;
/// The clear runs of a blocked lane route from each end ([from the start,
/// to the end]), each kept when at least `MIN_SPUR` long.
pub(super) fn clear_spurs(
    path: &[Point],
    surface: Surface<'_>,
    max_grade: f64,
) -> [Option<Vec<Point>>; 2] {
    let clear = |a: Point, b: Point| crate::urban::routing::segment_clear(surface, a, b, max_grade);
    let n = path.len();
    let head = (0..n - 1)
        .take_while(|&k| clear(path[k], path[k + 1]))
        .count();
    let tail = (1..n)
        .rev()
        .take_while(|&k| clear(path[k - 1], path[k]))
        .count();
    let long = |p: &[Point]| p.windows(2).map(|w| distance(w[0], w[1])).sum::<f64>() >= MIN_SPUR;
    if head + 1 >= n {
        return [None, None];
    }
    let first = path[..=head].to_vec();
    let last = path[n - 1 - tail..].to_vec();
    [
        (head >= 1 && long(&first)).then_some(first),
        (tail >= 1 && head < n - 1 - tail && long(&last)).then_some(last),
    ]
}

/// The wall-lane line of a curtain: its path moved inward by the ribbon half
/// and half a lane (closed rings), and the lane width.
pub(super) fn lane_line(e: &Enclosure) -> (Vec<Shape>, f64) {
    use crate::urban::geometry as g;
    use geo::Buffer;
    let wall_half = crate::urban::fortification::ribbon_half(&e.kind);
    let w = if e.kind == "wall" { 4.0 } else { 3.0 };
    let mut outer = e.path.clone();
    if outer.len() > 2 && distance(outer[0], *outer.last().unwrap()) < EPS {
        outer.pop();
    }
    let shape = g::normalized(Shape {
        outer,
        holes: vec![],
    });
    (
        g::shapes(g::polygon(&shape).buffer(-wall_half - w * 0.5)),
        w,
    )
}
