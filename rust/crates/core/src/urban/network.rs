//! Final planar street junctions, connected components and served open edges.
//! All edits subdivide or shorten existing segments; no shortcut changes grades.
use super::{Point, Street};
use std::collections::{BTreeMap, BTreeSet};

type Key = (i64, i64);
const EPS: f64 = 1e-6;

fn key(p: Point) -> Key {
    (
        (p.x * 10000.0).round() as i64,
        (p.y * 10000.0).round() as i64,
    )
}
fn distance(a: Point, b: Point) -> f64 {
    (b.x - a.x).hypot(b.y - a.y)
}
fn lerp(a: Point, b: Point, t: f64) -> Point {
    Point {
        x: a.x + (b.x - a.x) * t,
        y: a.y + (b.y - a.y) * t,
    }
}
fn protected(s: &Street) -> bool {
    matches!(
        s.role.as_str(),
        "regional" | "bridge" | "ford" | "causeway" | "approach" | "peripheral" | "outbound"
    )
}

/// Curtains the open-edge network keeps to: no peripheral section, feeder or
/// rural path crosses one, and no peripheral section runs within `clearance`
/// of one (its ribbon would ride the curtain body and weave through it) nor
/// in the fortification reserve (ditch, berm, glacis, works): a section that
/// would is moved off them (`keep_off`), along the glacis or ditch edge, or
/// along the outer face where no ditch runs.
/// The town inside an enclosure keeps its own wall/gate semantics.
struct Curtains {
    walls: Vec<(
        super::fortification::Near,
        super::geometry::ContainmentIndex,
        f64,
    )>,
    /// Reserve tiles: box and containment.
    reserve: Vec<((f64, f64, f64, f64), super::geometry::ContainmentIndex)>,
    /// Obstacle edges on a `KEEP_CELL` grid: (a, b, curtain clearance), the
    /// clearance being 0 for a reserve boundary edge (it takes the half road).
    edges: Vec<(Point, Point, f64)>,
    grid: BTreeMap<Key, Vec<usize>>,
    /// Outer lean-tos: a lane ending beside one serves it, it is no open edge.
    lean: Vec<super::Shape>,
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
    fn new(enclosures: &[super::Enclosure]) -> Self {
        use super::{fortification, geometry as g};
        let mut edges = vec![];
        let mut reserve = vec![];
        let mut lean = vec![];
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
                let poly = g::normalized(super::Shape {
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
            reserve,
            edges,
            grid,
            lean,
        }
    }
    /// Inside a circuit (the walled town, not the open fringe).
    fn inside(&self, p: Point) -> bool {
        self.walls.iter().any(|(_, poly, _)| poly.contains(p))
    }
    fn crosses(&self, a: Point, b: Point) -> bool {
        self.walls
            .iter()
            .any(|(near, _, _)| near.distance(a, b) == 0.0)
    }
    fn hugs(&self, a: Point, b: Point) -> bool {
        self.walls
            .iter()
            .any(|(near, _, c)| near.distance(a, b) < *c)
    }
    /// A street end beside an outer lean-to (the lane serving it).
    fn serves_lean_to(&self, p: Point, reach: f64) -> bool {
        self.lean.iter().any(|s| {
            let r = &s.outer;
            (0..r.len()).any(|k| super::geometry::distance(p, r[k], r[(k + 1) % r.len()]).0 < reach)
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
            super::geometry::distance(p, a, b).0 >= need
        })
    }
    fn segment_clear(&self, a: Point, b: Point, hw: f64) -> bool {
        let steps = (distance(a, b) / 2.0).ceil().max(1.0) as usize;
        (0..=steps).all(|k| self.clear_at(lerp(a, b, k as f64 / steps as f64), hw))
            && !self.hugs(a, b)
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
                let (d, _, q) = super::geometry::distance(p, a, b);
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
    fn keep_off(&self, path: &[Point], hw: f64) -> Option<Vec<Point>> {
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
        let smooth = super::geometry::simplify(&out, 1.0, |_| false);
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

/// Resolve real outer leaves before carving blocks: joins, rural paths or closed
/// access ends. Enclosed towns retain their wall/gate termination semantics:
/// leaves inside a circuit are left to it, and the open-edge roads never cross
/// a curtain (`Curtains`), so the regional roads alone enter through the gates.
#[allow(clippy::too_many_arguments)]
pub(super) fn resolve_exits(
    streets: &mut Vec<Street>,
    quarters: &[super::Quarter],
    roads: &[Street],
    enclosures: &[super::Enclosure],
    surface: super::Surface<'_>,
    cfg: &super::LayoutConfig,
    rng: &mut crate::rng::Rng,
) {
    use super::{geometry as g, routing};
    let curtains = Curtains::new(enclosures);
    let legacy_routes = std::env::var("URBAN_WALL_ROUTES").is_ok_and(|v| v == "legacy");
    let domains = g::union(&quarters.iter().map(|q| q.shape.clone()).collect::<Vec<_>>());
    let graph = Graph::new(streets);
    let boundary = |p: Point| {
        domains
            .iter()
            .flat_map(|s| std::iter::once(&s.outer).chain(s.holes.iter()))
            .flat_map(|ring| {
                ring.iter()
                    .zip(ring.iter().cycle().skip(1))
                    .take(ring.len())
            })
            .map(|(&a, &b)| g::distance(p, a, b).0)
            .fold(f64::INFINITY, f64::min)
    };
    let mut leaves = vec![];
    for (i, s) in streets.iter().enumerate() {
        if private(s) || matches!(s.role.as_str(), "quay" | "bridge" | "ford" | "causeway") {
            continue;
        }
        for end in [false, true] {
            let j = if end { s.path.len() - 1 } else { 0 };
            let p = s.path[j];
            // A lane ending beside an outer lean-to (off the curtain) serves
            // it: no open edge.
            if graph.degree(p) == 1
                && boundary(p) < width(s, j).max(10.0)
                && !curtains.inside(p)
                && (curtains.hugs(p, p) || !curtains.serves_lean_to(p, width(s, j) + 2.0))
            {
                leaves.push((i, end, p));
            }
        }
    }
    let mut served = BTreeSet::new();
    let mut feeders = 0;
    let make = |path: Vec<Point>, w: f64, role: &str| Street {
        widths: vec![w; path.len()],
        path,
        rank: 2,
        role: role.into(),
    };
    // Circumferential sections connect pairs of actual streets. No ornamental
    // circle and no arc can be left attached at only one end.
    if cfg.exit_treatment != "closed" && cfg.peripheral_road != "none" {
        for domain in &domains {
            // The centreline follows the actual land boundary. Its inner half
            // is carved from the blocks, so frontage touches the road exactly.
            for ring in std::iter::once(&domain.outer) {
                let mut stations = vec![0.0];
                for j in 0..ring.len() {
                    stations.push(stations[j] + distance(ring[j], ring[(j + 1) % ring.len()]));
                }
                let mut anchors: Vec<_> = leaves
                    .iter()
                    .enumerate()
                    .filter_map(|(id, &(_, _, p))| {
                        let (j, (d, t, q)) = (0..ring.len())
                            .map(|j| (j, g::distance(p, ring[j], ring[(j + 1) % ring.len()])))
                            .min_by(|a, b| a.1.0.total_cmp(&b.1.0))?;
                        (d < 30.0).then_some((
                            stations[j] + t * distance(ring[j], ring[(j + 1) % ring.len()]),
                            j,
                            q,
                            id,
                            p,
                        ))
                    })
                    .collect();
                anchors.sort_by(|a, b| a.0.total_cmp(&b.0));
                if anchors.len() < 2 {
                    continue;
                }
                let mut ring_widths: Vec<_> = anchors
                    .iter()
                    .map(|a| {
                        let (i, end, _) = leaves[a.3];
                        width(&streets[i], if end { streets[i].path.len() - 1 } else { 0 })
                    })
                    .collect();
                ring_widths.sort_by(f64::total_cmp);
                let ring_width = ring_widths[ring_widths.len() / 2].clamp(3.0, 8.0);
                let full = cfg.peripheral_road == "full";
                for k in 0..anchors.len() {
                    if !full
                        && (k == anchors.len() - 1
                            || cfg.peripheral_road == "auto" && !rng.chance(0.35))
                    {
                        continue;
                    }
                    let a = anchors[k];
                    let b = anchors[(k + 1) % anchors.len()];
                    // A street end at the curtain (on it or within its
                    // clearance) is the town's: it anchors no section.
                    if curtains.hugs(a.4, a.4) || curtains.hugs(b.4, b.4) {
                        continue;
                    }
                    let mut path = vec![a.4, a.2];
                    let mut j = (a.1 + 1) % ring.len();
                    while j != (b.1 + 1) % ring.len() {
                        path.push(ring[j]);
                        j = (j + 1) % ring.len();
                    }
                    path.extend([b.2, b.4]);
                    // Reuse a close parallel corridor rather than laying a
                    // second ribbon beside it. Original junctions stay fixed.
                    if path.len() > 3 {
                        for j in 1..path.len() - 1 {
                            let dx = path[j + 1].x - path[j - 1].x;
                            let dy = path[j + 1].y - path[j - 1].y;
                            let run = dx.hypot(dy).max(1e-6);
                            let closest = streets
                                .iter()
                                .filter(|s| !private(s) && s.role != "stairs")
                                .flat_map(|s| {
                                    let p = path[j];
                                    s.path.windows(2).enumerate().filter_map(move |(i, pair)| {
                                        let sx = pair[1].x - pair[0].x;
                                        let sy = pair[1].y - pair[0].y;
                                        let length = sx.hypot(sy);
                                        if length < EPS
                                            || ((dx * sx + dy * sy) / (run * length)).abs() < 0.94
                                        {
                                            return None;
                                        }
                                        let (d, _, q) = g::distance(p, pair[0], pair[1]);
                                        (d < (width(s, i) + ring_width) * 0.5 + 2.0)
                                            .then_some((d, q))
                                    })
                                })
                                .min_by(|a, b| a.0.total_cmp(&b.0));
                            if let Some((_, q)) = closest {
                                path[j] = q;
                            }
                        }
                    }
                    path.dedup_by(|a, b| distance(*a, *b) < 1e-6);
                    // A section along a circuit would ride its curtain and
                    // weave through it, or run in the ditch or on the glacis:
                    // it is moved off them, along the reserve edge (or the
                    // outer face where no ditch runs); a section with no
                    // clear route left leaves the fringe there open.
                    let clear = path
                        .windows(2)
                        .all(|w| curtains.segment_clear(w[0], w[1], ring_width * 0.5));
                    // `URBAN_WALL_ROUTES=legacy` (A/B measurement only): drop
                    // the section instead, as Round 6 did.
                    let path = if clear {
                        Some(path)
                    } else if legacy_routes {
                        (!path.windows(2).any(|w| curtains.hugs(w[0], w[1]))).then_some(path)
                    } else {
                        curtains.keep_off(&path, ring_width * 0.5)
                    };
                    if let Some(path) = path
                        && routing::path_clear(surface, &path, cfg.max_street_grade)
                        && !path.windows(2).any(|w| curtains.crosses(w[0], w[1]))
                    {
                        streets.push(make(path, ring_width, "peripheral"));
                        served.extend([a.3, b.3]);
                    }
                }
            }
        }
    }
    for (id, &(i, end, p)) in leaves.iter().enumerate() {
        let ring_served = served.contains(&id);
        let s = &streets[i];
        if s.path.len() < 2 {
            continue;
        }
        let adjacent = s.path[if end { s.path.len() - 2 } else { 1 }];
        let run = distance(adjacent, p).max(1e-6);
        let direction = Point {
            x: (p.x - adjacent.x) / run,
            y: (p.y - adjacent.y) / run,
        };
        // Local feeders can reach a regional axis beyond the immediate urban edge.
        let reach = 360.0;
        let mut targets: Vec<_> = roads
            .iter()
            .flat_map(|s| {
                s.path
                    .windows(2)
                    .enumerate()
                    .map(move |(i, seg)| (seg, width(s, i), width(s, i + 1)))
            })
            .filter_map(|(seg, wa, wb)| {
                let (d, t, q) = g::distance(p, seg[0], seg[1]);
                (d > 1.0
                    && d < reach
                    && !domains.iter().any(|s| g::contains(s, q))
                    && !curtains.inside(q)
                    && (q.x - p.x) * direction.x + (q.y - p.y) * direction.y > -5.0)
                    .then_some((d, q, wa * (1.0 - t) + wb * t))
            })
            .collect();
        targets.sort_by(|a, b| a.0.total_cmp(&b.0));
        let mut joined = false;
        if cfg.exit_treatment != "closed" && feeders < 3 {
            let mut planner = routing::RoutePlanner::new(
                surface,
                (p.x - reach, p.y - reach, p.x + reach, p.y + reach),
            );
            for &(_, target, target_width) in targets.iter().take(4) {
                if let Some(path) = planner.route(p, target, cfg.max_lane_grade)
                    && !path.windows(2).any(|w| curtains.crosses(w[0], w[1]))
                {
                    let source_width =
                        width(&streets[i], if end { streets[i].path.len() - 1 } else { 0 });
                    let mut connection = make(path, source_width, "outbound");
                    if connection
                        .path
                        .windows(2)
                        .map(|w| distance(w[0], w[1]))
                        .sum::<f64>()
                        > 60.0
                    {
                        // Keep the urban junction width, then narrow into a small connector.
                        connection.widths.fill(2.5);
                        connection.path.reverse();
                        connection.widths.reverse();
                        super::widths::taper_end(&mut connection, source_width);
                        connection.path.reverse();
                        connection.widths.reverse();
                        connection.rank = 3;
                    }
                    super::widths::taper_end(&mut connection, target_width);
                    streets.push(connection);
                    feeders += 1;
                    joined = true;
                    break;
                }
            }
            // A minority become genuine narrow rural paths into the landscape.
            if !joined && !ring_served && !protected(&streets[i]) && rng.chance(0.18) {
                let target = Point {
                    x: p.x + direction.x * 80.0,
                    y: p.y + direction.y * 80.0,
                };
                if !domains.iter().any(|s| g::contains(s, target))
                    && let Some(path) = planner.route(p, target, cfg.max_lane_grade)
                    && !path.windows(2).any(|w| curtains.crosses(w[0], w[1]))
                {
                    let mut st = make(path, 2.0, "outbound");
                    st.rank = 3;
                    let last = st.widths.len() - 1;
                    st.widths[last] = 1.0;
                    streets.push(st);
                    joined = true;
                }
            }
        }
        if joined || ring_served || protected(&streets[i]) {
            continue;
        }
        // Retract the terminal corridor into its land cell. Its reclaimed ribbon
        // belongs to the block/parcel partition, closing the end with backland.
        let s = &mut streets[i];
        if !end {
            s.path.reverse();
            s.widths.reverse();
        }
        let mut retract = 14.0;
        while s.path.len() >= 2 {
            let last = s.path.len() - 1;
            let length = distance(s.path[last - 1], s.path[last]);
            if length > retract {
                s.path[last] = lerp(s.path[last], s.path[last - 1], retract / length);
                break;
            }
            let junction = graph.degree(s.path[last - 1]) >= 3;
            retract -= length;
            s.path.pop();
            s.widths.pop();
            if junction {
                break;
            }
        }
        if !end {
            s.path.reverse();
            s.widths.reverse();
        }
    }
    streets.retain(|s| s.path.len() >= 2);
}
/// Invariant (gate passages): a street through a land gatehouse is at most
/// `passage_width_m - 1` wide inside the passage, so half a metre of clear
/// passage stays on each side and the gatehouse masses never yield to it.
/// The segment crossing the curtain gets vertices at the passage ends and
/// at the crossing, at the capped width; outside them it keeps its width.
pub(super) fn cap_gate_passages(streets: &mut [Street], enclosures: &[super::Enclosure]) {
    use super::geometry as g;
    for e in enclosures.iter().filter(|e| e.path.len() >= 4) {
        let near = super::fortification::Near::new(&e.path, 20.0);
        for gh in e.gatehouses.iter().filter(|gh| gh.kind != "water") {
            let cap = gh.passage_width_m - 1.0;
            if cap <= 0.5 {
                continue;
            }
            let mid = lerp(gh.passage[0], gh.passage[1], 0.5);
            let half_len = distance(gh.passage[0], gh.passage[1]) * 0.5 + 1.0;
            for s in streets.iter_mut().filter(|s| s.role != "wall-lane") {
                if s.widths.len() != s.path.len() {
                    let last = s.widths.last().copied().unwrap_or(4.0);
                    s.widths.resize(s.path.len(), last);
                }
                let mut i = 0;
                while i + 1 < s.path.len() {
                    let (a, b) = (s.path[i], s.path[i + 1]);
                    let hit = near
                        .crossed(a, b)
                        .into_iter()
                        .filter_map(|k| g::segment_hit(a, b, e.path[k], e.path[k + 1]))
                        .map(|(t, _)| t)
                        .find(|&t| distance(lerp(a, b, t), mid) < 12.0);
                    let Some(t) = hit else {
                        i += 1;
                        continue;
                    };
                    let (wa, wb) = (width(s, i), width(s, i + 1));
                    let length = distance(a, b).max(EPS);
                    let at = |u: f64| u.clamp(0.0, 1.0);
                    // The passage, centred on its middle along the street.
                    let tm = g::distance(mid, a, b).1;
                    let (t0, t1) = (at(tm - half_len / length), at(tm + half_len / length));
                    let w = |u: f64| wa + (wb - wa) * u;
                    // Vertices inside the passage, in order along the segment.
                    let mut inserts: Vec<(Point, f64)> = vec![];
                    for u in [t0, t, t1] {
                        if u > 1e-6
                            && u < 1.0 - 1e-6
                            && inserts
                                .last()
                                .is_none_or(|&(p, _)| distance(p, lerp(a, b, u)) > 0.05)
                        {
                            inserts.push((lerp(a, b, u), w(u).min(cap)));
                        }
                    }
                    let n = inserts.len();
                    for (k, (p, wd)) in inserts.into_iter().enumerate() {
                        s.path.insert(i + 1 + k, p);
                        s.widths.insert(i + 1 + k, wd);
                    }
                    // Original vertices inside the passage are capped too.
                    if t0 <= 1e-6 {
                        s.widths[i] = s.widths[i].min(cap);
                    }
                    if t1 >= 1.0 - 1e-6 {
                        s.widths[i + 1 + n] = s.widths[i + 1 + n].min(cap);
                    }
                    i += n + 1;
                }
            }
        }
    }
}
fn private(s: &Street) -> bool {
    matches!(
        s.role.as_str(),
        "close" | "derb" | "hutong" | "roji" | "collective" | "private"
    )
}

/// A frequent intramural lane abuts the wall's inner face. Other seeds retain
/// plots against the enclosure; unsupported hillside fragments are discarded by
/// the shared network cleanup rather than inventing a dry crossing.
pub(super) fn enclosure_lanes(
    streets: &mut Vec<Street>,
    enclosures: &[super::Enclosure],
    surface: super::Surface<'_>,
    cfg: &super::LayoutConfig,
    rng: &mut crate::rng::Rng,
) {
    use super::{geometry as g, routing};
    use geo::Buffer;
    for enclosure in enclosures {
        if !rng.chance(0.8) {
            continue;
        }
        let wall_half = if enclosure.kind == "wall" { 1.5 } else { 0.75 };
        let w = if enclosure.kind == "wall" { 4.0 } else { 3.0 };
        let mut outer = enclosure.path.clone();
        if outer.len() > 2 && distance(outer[0], *outer.last().unwrap()) < EPS {
            outer.pop();
        }
        let shape = g::normalized(super::Shape {
            outer,
            holes: vec![],
        });
        for shape in g::shapes(g::polygon(&shape).buffer(-wall_half - w * 0.5)) {
            let mut path = vec![];
            for (&a, &b) in shape
                .outer
                .iter()
                .zip(shape.outer.iter().cycle().skip(1))
                .take(shape.outer.len())
            {
                if routing::segment_clear(surface, a, b, cfg.max_street_grade) {
                    if path.is_empty() {
                        path.push(a);
                    }
                    path.push(b);
                } else if path.len() >= 2 {
                    streets.push(Street {
                        widths: vec![w; path.len()],
                        path: std::mem::take(&mut path),
                        rank: 2,
                        role: "wall-lane".into(),
                    });
                }
            }
            if path.len() >= 2 {
                streets.push(Street {
                    widths: vec![w; path.len()],
                    path,
                    rank: 2,
                    role: "wall-lane".into(),
                });
            }
        }
    }
}
fn width(s: &Street, i: usize) -> f64 {
    s.widths
        .get(i)
        .copied()
        .or_else(|| s.widths.last().copied())
        .unwrap_or(4.0)
}

/// Width of each rank for a city of this size: the cultural `widthByRank`
/// scaled up for major ranks of larger cities (metropolis arterials 12-20 m),
/// lanes and closes unchanged, then made monotone so no lower rank is wider.
pub(super) fn rank_widths(base: [f64; 5], population: u32) -> [f64; 5] {
    let size = (population as f64 / 5000.0).max(1.0).log10();
    let lift = [0.45, 0.35, 0.15, 0.0, 0.0];
    let mut table: [f64; 5] = std::array::from_fn(|r| base[r] * (1.0 + lift[r] * size));
    for r in (0..4).rev() {
        table[r] = table[r].max(table[r + 1]);
    }
    table[0] = table[0].min(20.0);
    table
}
/// Street land of a semantic role, relative to its rank width.
fn role_factor(role: &str) -> f64 {
    match role {
        "market" => 1.6,
        "processional" => 1.5,
        "ring" => 1.3,
        "gate-street" => 1.1,
        _ => 1.0,
    }
}
fn rewidth(role: &str) -> bool {
    matches!(
        role,
        "street" | "lane" | "radial" | "ring" | "market" | "gate-street" | "processional"
    )
}

type Run = (usize, String, Vec<Point>, Vec<f64>);

/// Classify the final planar graph instead of trusting the order of cuts. Least
/// cost routes from every gate or regional entry and from every quarter to the
/// nearest centre measure through traffic (a cheap betweenness): routes between
/// entries and centres become arterials or main streets, routes shared by several
/// quarters main streets, any quarter link at least a street. Ranks are only
/// promoted. Widths then follow rank x role x city size; regional roads, crossings,
/// stairs, closes and connectors keep their own widths. Planned `axis` cultures
/// (castrum, Chinese ward city) turn their busiest through route processional.
pub(super) fn hierarchy(
    streets: &mut Vec<Street>,
    centres: &[Point],
    gates: &[Point],
    anchors: &[Point],
    population: u32,
    base: [f64; 5],
    axis: bool,
) {
    use std::cmp::Reverse;
    use std::collections::BinaryHeap;
    if centres.is_empty() || streets.is_empty() {
        return;
    }
    let mut index: BTreeMap<Key, usize> = BTreeMap::new();
    let mut nodes: Vec<Point> = vec![];
    let mut adjacency: Vec<Vec<(usize, usize)>> = vec![];
    // (street, segment, cost, from node, to node)
    let mut edges: Vec<(usize, usize, f64, usize, usize)> = vec![];
    for (i, s) in streets.iter().enumerate() {
        if private(s) {
            continue;
        }
        let factor = [0.55, 0.7, 0.85, 1.25, 3.0][s.rank.min(4)]
            * if s.role == "stairs" { 3.0 } else { 1.0 };
        for (j, w) in s.path.windows(2).enumerate() {
            let length = distance(w[0], w[1]);
            if length < EPS {
                continue;
            }
            let mut node = |p: Point| {
                *index.entry(key(p)).or_insert_with(|| {
                    nodes.push(p);
                    adjacency.push(vec![]);
                    nodes.len() - 1
                })
            };
            let a = node(w[0]);
            let b = node(w[1]);
            if a == b {
                continue;
            }
            adjacency[a].push((b, edges.len()));
            adjacency[b].push((a, edges.len()));
            edges.push((i, j, length * factor, a, b));
        }
    }
    if nodes.is_empty() {
        return;
    }
    let snap = |p: Point| {
        (0..nodes.len())
            .min_by(|&a, &b| distance(nodes[a], p).total_cmp(&distance(nodes[b], p)))
            .unwrap()
    };
    let dijkstra = |sources: &[usize]| {
        let mut cost = vec![f64::INFINITY; nodes.len()];
        let mut previous = vec![usize::MAX; nodes.len()];
        let mut heap = BinaryHeap::new();
        for &s in sources {
            cost[s] = 0.0;
            heap.push(Reverse((0u64, s)));
        }
        while let Some(Reverse((c, n))) = heap.pop() {
            let c = f64::from_bits(c);
            if c > cost[n] {
                continue;
            }
            for &(m, e) in &adjacency[n] {
                let next = c + edges[e].2;
                if next < cost[m] {
                    cost[m] = next;
                    previous[m] = e;
                    heap.push(Reverse((next.to_bits(), m)));
                }
            }
        }
        previous
    };
    let trace = |previous: &[usize], mut n: usize, count: &mut [u32]| {
        let mut guard = 0;
        while previous[n] != usize::MAX && guard < nodes.len() {
            let e = previous[n];
            count[e] += 1;
            n = if edges[e].3 == n {
                edges[e].4
            } else {
                edges[e].3
            };
            guard += 1;
        }
    };
    let sources: Vec<usize> = centres.iter().map(|&c| snap(c)).collect();
    let tree = dijkstra(&sources);
    let mut through = vec![0u32; edges.len()];
    let mut local = vec![0u32; edges.len()];
    // Entries: gates and the open ends of regional roads and crossings.
    let degree = |p: Point| index.get(&key(p)).map_or(0, |&n| adjacency[n].len());
    let mut entries: Vec<Point> = gates.to_vec();
    for s in streets.iter().filter(|s| {
        matches!(
            s.role.as_str(),
            "regional" | "approach" | "bridge" | "ford" | "causeway"
        )
    }) {
        for p in [s.path[0], *s.path.last().unwrap()] {
            if degree(p) == 1 {
                entries.push(p);
            }
        }
    }
    for &p in &entries {
        trace(&tree, snap(p), &mut through);
    }
    // Secondary centres are linked to the main one.
    if sources.len() > 1 {
        let main = dijkstra(&sources[..1]);
        for &s in &sources[1..] {
            trace(&main, s, &mut through);
        }
    }
    for &p in anchors {
        trace(&tree, snap(p), &mut local);
    }
    let arterial = if population >= 20_000 { 0 } else { 1 };
    let busiest = through.iter().copied().max().unwrap_or(0);
    let market_reach = 25.0 + 0.25 * (population as f64).sqrt();
    let main_centre = centres[0];
    let table = rank_widths(base, population);
    let edge_of: BTreeMap<(usize, usize), usize> = edges
        .iter()
        .enumerate()
        .map(|(e, &(i, j, ..))| ((i, j), e))
        .collect();
    let mut result = vec![];
    let flush = |run: Option<Run>, result: &mut Vec<Street>| {
        if let Some((rank, role, path, widths)) = run
            && path.len() >= 2
        {
            let widths = if rewidth(&role) {
                vec![table[rank.min(4)] * role_factor(&role); path.len()]
            } else {
                widths
            };
            result.push(Street {
                path,
                widths,
                rank,
                role,
            });
        }
    };
    for (i, s) in std::mem::take(streets).into_iter().enumerate() {
        let class = |j: usize| -> (usize, String) {
            let Some(&e) = edge_of.get(&(i, j)) else {
                return (s.rank, s.role.clone());
            };
            if !rewidth(&s.role) {
                return (s.rank, s.role.clone());
            }
            let mut rank = s.rank;
            let mut role = s.role.clone();
            if through[e] > 0 {
                rank = rank.min(arterial);
            }
            if local[e] >= 3 {
                rank = rank.min(1);
            } else if local[e] >= 1 {
                rank = rank.min(2);
            }
            if rank <= 2 && role == "lane" {
                role = "street".into();
            }
            if axis && busiest >= 2 && through[e] * 2 >= busiest && role == "street" {
                role = "processional".into();
            } else if through[e] > 0 && !gates.is_empty() && role == "street" {
                role = "gate-street".into();
            }
            let mid = lerp(s.path[j], s.path[j + 1], 0.5);
            if rank <= 1
                && !matches!(role.as_str(), "ring" | "processional")
                && distance(mid, main_centre) < market_reach
                && (through[e] > 0 || local[e] >= 3)
            {
                role = "market".into();
            }
            (rank, role)
        };
        let mut run: Option<Run> = None;
        for j in 0..s.path.len().saturating_sub(1) {
            let (rank, role) = class(j);
            if !run.as_ref().is_some_and(|r| r.0 == rank && r.1 == role) {
                flush(run.take(), &mut result);
                run = Some((rank, role, vec![s.path[j]], vec![width(&s, j)]));
            }
            let r = run.as_mut().unwrap();
            r.2.push(s.path[j + 1]);
            r.3.push(width(&s, j + 1));
        }
        flush(run.take(), &mut result);
    }
    *streets = result;
}

#[derive(Clone, Copy)]
struct Segment {
    street: usize,
    offset: usize,
    a: Point,
    b: Point,
}

/// Traverse only cells crossed by the segment, including both sides of an exact
/// corner. Work is proportional to length instead of rectangular bounding area.
fn candidates(segments: &[Segment], cell: f64) -> BTreeSet<(usize, usize)> {
    let mut buckets: BTreeMap<(i64, i64), Vec<usize>> = BTreeMap::new();
    let mut pairs = BTreeSet::new();
    for (i, segment) in segments.iter().enumerate() {
        let mut visit = |x, y| {
            let bucket = buckets.entry((x, y)).or_default();
            if bucket.last() == Some(&i) {
                return;
            }
            for &j in bucket.iter() {
                let other = segments[j];
                if segment.a.x.min(segment.b.x) > other.a.x.max(other.b.x) + EPS
                    || segment.a.x.max(segment.b.x) < other.a.x.min(other.b.x) - EPS
                    || segment.a.y.min(segment.b.y) > other.a.y.max(other.b.y) + EPS
                    || segment.a.y.max(segment.b.y) < other.a.y.min(other.b.y) - EPS
                {
                    continue;
                }
                if segment.street != other.street || segment.offset.abs_diff(other.offset) > 1 {
                    pairs.insert((j, i));
                }
            }
            bucket.push(i);
        };
        let (mut x, mut y) = (
            (segment.a.x / cell).floor() as i64,
            (segment.a.y / cell).floor() as i64,
        );
        let (end_x, end_y) = (
            (segment.b.x / cell).floor() as i64,
            (segment.b.y / cell).floor() as i64,
        );
        let axis = |a: f64, b: f64, index: i64| {
            let delta = b - a;
            if delta.abs() < 1e-12 {
                (0, f64::INFINITY, f64::INFINITY)
            } else {
                let step = if delta > 0.0 { 1 } else { -1 };
                let edge = (index + i64::from(step > 0)) as f64 * cell;
                (step, (edge - a) / delta, cell / delta.abs())
            }
        };
        let (sx, mut tx, dx) = axis(segment.a.x, segment.b.x, x);
        let (sy, mut ty, dy) = axis(segment.a.y, segment.b.y, y);
        visit(x, y);
        while x != end_x || y != end_y {
            let next_x = if x == end_x { f64::INFINITY } else { tx };
            let next_y = if y == end_y { f64::INFINITY } else { ty };
            if (next_x - next_y).abs() < 1e-12 {
                visit(x + sx, y);
                visit(x, y + sy);
                x += sx;
                y += sy;
                tx += dx;
                ty += dy;
            } else if next_x < next_y {
                x += sx;
                tx += dx;
            } else {
                y += sy;
                ty += dy;
            }
            visit(x, y);
        }
    }
    pairs
}

fn projection(p: Point, a: Point, b: Point) -> Option<f64> {
    let dx = b.x - a.x;
    let dy = b.y - a.y;
    let t = ((p.x - a.x) * dx + (p.y - a.y) * dy) / (dx * dx + dy * dy);
    if (-EPS..=1.0 + EPS).contains(&t) && distance(p, lerp(a, b, t)) < EPS {
        Some(t.clamp(0.0, 1.0))
    } else {
        None
    }
}

fn crossings(a: Segment, b: Segment) -> Vec<(f64, f64, Point)> {
    let ax = a.b.x - a.a.x;
    let ay = a.b.y - a.a.y;
    let bx = b.b.x - b.a.x;
    let by = b.b.y - b.a.y;
    let det = ax * by - ay * bx;
    if det.abs() > 1e-10 * ax.hypot(ay) * bx.hypot(by) {
        let dx = b.a.x - a.a.x;
        let dy = b.a.y - a.a.y;
        let t = (dx * by - dy * bx) / det;
        let u = (dx * ay - dy * ax) / det;
        if (-EPS..=1.0 + EPS).contains(&t) && (-EPS..=1.0 + EPS).contains(&u) {
            let t = t.clamp(0.0, 1.0);
            let u = u.clamp(0.0, 1.0);
            return vec![(t, u, lerp(a.a, a.b, t))];
        }
        return vec![];
    }
    // Collinear overlaps get matching vertices at each overlap endpoint, so
    // downstream de-duplication removes their shared portion exactly.
    let mut hits = vec![];
    for (t, p) in [(0.0, a.a), (1.0, a.b)] {
        if let Some(u) = projection(p, b.a, b.b) {
            hits.push((t, u, p));
        }
    }
    for (u, p) in [(0.0, b.a), (1.0, b.b)] {
        if let Some(t) = projection(p, a.a, a.b) {
            hits.push((t, u, p));
        }
    }
    hits
}

fn planarize(streets: &mut Vec<Street>, radius: f64) {
    streets.retain(|s| s.path.len() >= 2);
    let segments: Vec<_> = streets
        .iter()
        .enumerate()
        .flat_map(|(street, s)| {
            s.path
                .windows(2)
                .enumerate()
                .filter_map(move |(offset, p)| {
                    (distance(p[0], p[1]) > EPS).then_some(Segment {
                        street,
                        offset,
                        a: p[0],
                        b: p[1],
                    })
                })
        })
        .collect();
    let mut cuts: Vec<Vec<(f64, Point)>> = segments
        .iter()
        .map(|s| vec![(0.0, s.a), (1.0, s.b)])
        .collect();
    for (i, j) in candidates(&segments, (radius / 8.0).clamp(12.0, 60.0)) {
        for (t, u, p) in crossings(segments[i], segments[j]) {
            cuts[i].push((t, p));
            cuts[j].push((u, p));
        }
    }
    let mut paths = vec![Vec::new(); streets.len()];
    let mut values: Vec<Vec<f64>> = vec![vec![]; streets.len()];
    for (segment, cut) in segments.iter().zip(&mut cuts) {
        cut.sort_by(|a, b| a.0.total_cmp(&b.0));
        cut.dedup_by(|a, b| (a.0 - b.0).abs() < 1e-9);
        let s = &streets[segment.street];
        let wa = width(s, segment.offset);
        let wb = width(s, segment.offset + 1);
        for &(t, p) in cut.iter() {
            if paths[segment.street]
                .last()
                .is_some_and(|&q| key(q) == key(p))
            {
                continue;
            }
            paths[segment.street].push(p);
            values[segment.street].push(wa + (wb - wa) * t);
        }
    }
    for ((s, path), widths) in streets.iter_mut().zip(paths).zip(values) {
        s.path = path;
        s.widths = widths;
    }
    // A regional axis wins over a generated copy; otherwise preserve the more
    // important street. Every ownership decision is stable in input order.
    let mut order: Vec<_> = (0..streets.len()).collect();
    order.sort_by_key(|&i| (!protected(&streets[i]), streets[i].rank, i));
    let mut used = BTreeSet::new();
    let mut unique = vec![];
    for i in order {
        let s = &streets[i];
        let mut path = vec![];
        let mut widths = vec![];
        for (j, p) in s.path.windows(2).enumerate() {
            let a = key(p[0]);
            let b = key(p[1]);
            let edge = if a < b { (a, b) } else { (b, a) };
            if a != b && used.insert(edge) {
                if path.is_empty() {
                    path.push(p[0]);
                    widths.push(width(s, j));
                }
                path.push(p[1]);
                widths.push(width(s, j + 1));
            } else if path.len() >= 2 {
                unique.push(Street {
                    path: std::mem::take(&mut path),
                    widths: std::mem::take(&mut widths),
                    rank: s.rank,
                    role: s.role.clone(),
                });
            }
        }
        if path.len() >= 2 {
            unique.push(Street {
                path,
                widths,
                rank: s.rank,
                role: s.role.clone(),
            });
        }
    }
    *streets = unique;
}

struct Graph {
    neighbors: BTreeMap<Key, BTreeSet<Key>>,
    component: BTreeMap<Key, usize>,
    length: Vec<f64>,
    anchored: Vec<bool>,
}
impl Graph {
    fn new(streets: &[Street]) -> Self {
        let mut neighbors: BTreeMap<Key, BTreeSet<Key>> = BTreeMap::new();
        for s in streets {
            for p in s.path.windows(2) {
                let a = key(p[0]);
                let b = key(p[1]);
                if a != b {
                    neighbors.entry(a).or_default().insert(b);
                    neighbors.entry(b).or_default().insert(a);
                }
            }
        }
        let mut component = BTreeMap::new();
        let mut count = 0;
        for &root in neighbors.keys() {
            if component.contains_key(&root) {
                continue;
            }
            let mut queue = vec![root];
            component.insert(root, count);
            while let Some(p) = queue.pop() {
                for &q in &neighbors[&p] {
                    if let std::collections::btree_map::Entry::Vacant(e) = component.entry(q) {
                        e.insert(count);
                        queue.push(q);
                    }
                }
            }
            count += 1;
        }
        let mut length = vec![0.0; count];
        let mut anchored = vec![false; count];
        for s in streets {
            if let Some(&c) = s.path.first().and_then(|&p| component.get(&key(p))) {
                length[c] += s.path.windows(2).map(|p| distance(p[0], p[1])).sum::<f64>();
                anchored[c] |= protected(s);
            }
        }
        Self {
            neighbors,
            component,
            length,
            anchored,
        }
    }
    fn degree(&self, p: Point) -> usize {
        self.neighbors.get(&key(p)).map_or(0, BTreeSet::len)
    }
}

/// Invariant (no doubled corridor): a street whose ribbon overlaps the ribbon
/// of a more important one (lower rank, else wider, else earlier) along at
/// least 90 % of its length leaves no land between them: it is a copy of that
/// corridor, not a second road, and is removed.
/// Streets that met it elsewhere than on the survivor are carried on to the
/// survivor's centreline (within its ribbon plus their own width), so the
/// network keeps every junction. Protected roads are never removed. Sampling
/// is every 2 m against a 32 m bucket grid of segments.
fn drop_shadowed(streets: &mut Vec<Street>) {
    const CELL: f64 = 32.0;
    let rank_key = |i: usize, s: &Street| {
        let w = s.widths.iter().copied().fold(0.0_f64, f64::max);
        (s.rank, std::cmp::Reverse((w * 1000.0).round() as i64), i)
    };
    let mut buckets: BTreeMap<(i64, i64), Vec<(usize, usize)>> = BTreeMap::new();
    for (i, s) in streets.iter().enumerate() {
        for (k, w) in s.path.windows(2).enumerate() {
            let pad = width(s, k).max(width(s, k + 1)) * 0.5 + 10.0;
            let (x0, x1) = (w[0].x.min(w[1].x) - pad, w[0].x.max(w[1].x) + pad);
            let (y0, y1) = (w[0].y.min(w[1].y) - pad, w[0].y.max(w[1].y) + pad);
            for bx in (x0 / CELL).floor() as i64..=(x1 / CELL).floor() as i64 {
                for by in (y0 / CELL).floor() as i64..=(y1 / CELL).floor() as i64 {
                    buckets.entry((bx, by)).or_default().push((i, k));
                }
            }
        }
    }
    let mut order: Vec<usize> = (0..streets.len()).collect();
    order.sort_by_key(|&i| std::cmp::Reverse(rank_key(i, &streets[i])));
    let mut removed = vec![false; streets.len()];
    // (removed street, survivor)
    let mut replaced: Vec<(usize, usize)> = vec![];
    for &i in &order {
        let s = &streets[i];
        if protected(s) || s.path.len() < 2 {
            continue;
        }
        let length: f64 = s.path.windows(2).map(|w| distance(w[0], w[1])).sum();
        if length < 8.0 {
            continue;
        }
        let mine = rank_key(i, s);
        // Coverage by each dominating street, sampled along the path.
        let mut covered: BTreeMap<usize, f64> = BTreeMap::new();
        let mut total = 0.0;
        for (m, w) in s.path.windows(2).enumerate() {
            let own = width(s, m).min(width(s, m + 1));
            let l = distance(w[0], w[1]);
            let n = (l / 2.0).ceil().max(1.0) as usize;
            for k in 0..n {
                let p = lerp(w[0], w[1], (k as f64 + 0.5) / n as f64);
                let step = l / n as f64;
                total += step;
                let cell = ((p.x / CELL).floor() as i64, (p.y / CELL).floor() as i64);
                let mut hit = BTreeSet::new();
                for &(j, seg) in buckets.get(&cell).into_iter().flatten() {
                    if j == i || removed[j] || hit.contains(&j) {
                        continue;
                    }
                    let t = &streets[j];
                    if rank_key(j, t) >= mine {
                        continue;
                    }
                    // Ribbons that overlap leave no land between them.
                    let half = 0.5 * width(t, seg).max(width(t, seg + 1)) + 0.5 * own;
                    if super::geometry::distance(p, t.path[seg], t.path[seg + 1]).0 <= half {
                        hit.insert(j);
                    }
                }
                for j in hit {
                    *covered.entry(j).or_default() += step;
                }
            }
        }
        if let Some((&j, _)) = covered
            .iter()
            .filter(|&(_, &c)| c >= 0.9 * total)
            .min_by_key(|&(&j, _)| rank_key(j, &streets[j]))
        {
            removed[i] = true;
            replaced.push((i, j));
        }
    }
    if replaced.is_empty() {
        return;
    }
    // Reattach streets that ended on a removed copy (endpoint index, so the
    // pass is linear in the removed copies' vertices).
    let mut ends: BTreeMap<Key, Vec<(usize, bool)>> = BTreeMap::new();
    for (u, s) in streets.iter().enumerate() {
        if !removed[u] && s.path.len() >= 2 {
            ends.entry(key(s.path[0])).or_default().push((u, false));
            ends.entry(key(*s.path.last().unwrap()))
                .or_default()
                .push((u, true));
        }
    }
    for &(i, j) in &replaced {
        let survivor: BTreeSet<Key> = streets[j].path.iter().map(|&p| key(p)).collect();
        let copy: BTreeSet<Key> = streets[i].path.iter().map(|&p| key(p)).collect();
        for c in copy {
            if survivor.contains(&c) {
                continue;
            }
            for &(u, last) in ends.get(&c).into_iter().flatten() {
                if u == j {
                    continue;
                }
                let idx = if last { streets[u].path.len() - 1 } else { 0 };
                let p = streets[u].path[idx];
                let t = &streets[j];
                let Some((d, q, w)) = t
                    .path
                    .windows(2)
                    .enumerate()
                    .map(|(k, w)| {
                        let (d, _, q) = super::geometry::distance(p, w[0], w[1]);
                        (d, q, width(t, k).max(width(t, k + 1)))
                    })
                    .min_by(|a, b| a.0.total_cmp(&b.0))
                else {
                    continue;
                };
                if d < EPS || d > 0.5 * w + width(&streets[u], idx) {
                    continue;
                }
                let s = &mut streets[u];
                let wu = width(s, idx);
                if last {
                    s.path.push(q);
                    s.widths.push(wu);
                } else {
                    s.path.insert(0, q);
                    s.widths.insert(0, wu);
                }
            }
        }
    }
    let mut k = 0;
    streets.retain(|_| {
        k += 1;
        !removed[k - 1]
    });
}

/// Invariant (no broken joint): two loose street ends closer than the wider
/// street's width plus 2 m are one street interrupted by the lattice: they
/// are joined by a short segment. Pairs are matched nearest first through a
/// 16 m bucket grid; a street is never joined to itself. A loose end within
/// another street's ribbon is carried onto that street's centreline.
fn join_close_ends(streets: &mut [Street]) -> bool {
    const CELL: f64 = 16.0;
    let graph = Graph::new(streets);
    // (point, street, at its last vertex, width)
    let mut ends: Vec<(Point, usize, bool, f64)> = vec![];
    for (i, s) in streets.iter().enumerate() {
        if protected(s) || private(s) || s.path.len() < 2 {
            continue;
        }
        let n = s.path.len();
        for (k, last) in [(0, false), (n - 1, true)] {
            if graph.degree(s.path[k]) == 1 {
                ends.push((s.path[k], i, last, width(s, k)));
            }
        }
    }
    let cell = |p: Point| ((p.x / CELL).floor() as i64, (p.y / CELL).floor() as i64);
    let mut buckets: BTreeMap<(i64, i64), Vec<usize>> = BTreeMap::new();
    for (e, end) in ends.iter().enumerate() {
        buckets.entry(cell(end.0)).or_default().push(e);
    }
    let mut pairs: Vec<(f64, usize, usize)> = vec![];
    for (e, &(p, i, _, w)) in ends.iter().enumerate() {
        let (cx, cy) = cell(p);
        for bx in cx - 1..=cx + 1 {
            for by in cy - 1..=cy + 1 {
                for &f in buckets.get(&(bx, by)).into_iter().flatten() {
                    let (q, j, _, v) = ends[f];
                    let d = distance(p, q);
                    if f > e && j != i && d > EPS && d <= w.max(v) + 2.0 {
                        pairs.push((d, e, f));
                    }
                }
            }
        }
    }
    pairs.sort_by(|a, b| a.0.total_cmp(&b.0).then(a.1.cmp(&b.1)).then(a.2.cmp(&b.2)));
    let mut used = vec![false; ends.len()];
    let mut changed = false;
    for (_, e, f) in pairs {
        let ((_, i, last, w), (q, _, _, _)) = (ends[e], ends[f]);
        if used[e] || used[f] {
            continue;
        }
        used[e] = true;
        used[f] = true;
        changed = true;
        let s = &mut streets[i];
        if last {
            s.path.push(q);
            s.widths.push(w);
        } else {
            s.path.insert(0, q);
            s.widths.insert(0, w);
        }
    }
    // A loose end left inside another street's ribbon (a lane laid beside
    // it stops half a metre short of the junction) touches that street: it
    // is carried onto its centreline, which needs no new ground.
    let mut segments: BTreeMap<(i64, i64), Vec<(usize, usize)>> = BTreeMap::new();
    for (j, t) in streets.iter().enumerate() {
        for (k, w) in t.path.windows(2).enumerate() {
            let pad = 0.5 * width(t, k).max(width(t, k + 1)) + 1.0;
            let (x0, x1) = (w[0].x.min(w[1].x) - pad, w[0].x.max(w[1].x) + pad);
            let (y0, y1) = (w[0].y.min(w[1].y) - pad, w[0].y.max(w[1].y) + pad);
            for bx in (x0 / CELL).floor() as i64..=(x1 / CELL).floor() as i64 {
                for by in (y0 / CELL).floor() as i64..=(y1 / CELL).floor() as i64 {
                    segments.entry((bx, by)).or_default().push((j, k));
                }
            }
        }
    }
    for (e, &(p, i, last, _)) in ends.iter().enumerate() {
        if used[e] {
            continue;
        }
        let best = segments
            .get(&cell(p))
            .into_iter()
            .flatten()
            .filter(|&&(j, _)| j != i)
            .filter_map(|&(j, k)| {
                let t = &streets[j];
                let (d, _, q) = super::geometry::distance(p, t.path[k], t.path[k + 1]);
                let reach = 0.5 * width(t, k).max(width(t, k + 1)) + 0.5;
                (d > EPS && d <= reach).then_some((d, j, q))
            })
            .min_by(|a, b| a.0.total_cmp(&b.0).then(a.1.cmp(&b.1)));
        if let Some((_, _, q)) = best {
            let s = &mut streets[i];
            let w = width(s, if last { s.path.len() - 1 } else { 0 });
            if last {
                s.path.push(q);
                s.widths.push(w);
            } else {
                s.path.insert(0, q);
                s.widths.insert(0, w);
            }
            changed = true;
        }
    }
    changed
}

/// Invariant (no stub): a loose spur shorter than its own width serves no
/// lot; it is removed, repeatedly (a spur left on a removed spur). Protected
/// roads (regional, crossings) and private access ways stay. Dead-end hooks
/// are kept: a loose tail touching the quarter edge still bounds the blocks.
fn drop_stubs(streets: &mut Vec<Street>) {
    for _ in 0..4 {
        let graph = Graph::new(streets);
        let before = streets.len();
        streets.retain(|s| {
            let n = s.path.len();
            let length: f64 = s.path.windows(2).map(|p| distance(p[0], p[1])).sum();
            protected(s)
                || private(s) && n >= 2
                || n >= 2
                    && !(length < width(s, 0)
                        && (graph.degree(s.path[0]) == 1 || graph.degree(s.path[n - 1]) == 1))
        });
        if streets.len() == before {
            break;
        }
    }
}

/// Shorten a loose outer end to a useful 16 m access spur after its last real
/// junction. The retained spur narrows gradually, with a modest flat end cap.
fn trim_end(s: &mut Street, graph: &Graph, center: Point, radius: f64) {
    let Some(&end) = s.path.last() else { return };
    if graph.degree(end) != 1 || distance(end, center) <= radius * 0.7 {
        return;
    }
    let Some(junction) = (0..s.path.len() - 1)
        .rev()
        .find(|&i| graph.degree(s.path[i]) >= 3)
    else {
        return;
    };
    let length: f64 = s.path[junction..]
        .windows(2)
        .map(|p| distance(p[0], p[1]))
        .sum();
    let keep = 16.0_f64.min(radius * 0.15).max(6.0);
    if length <= keep + 4.0 {
        return;
    }
    let mut remaining = keep;
    for i in junction..s.path.len() - 1 {
        let run = distance(s.path[i], s.path[i + 1]);
        if remaining < run {
            let t = remaining / run;
            s.path[i + 1] = lerp(s.path[i], s.path[i + 1], t);
            let w = width(s, i) + (width(s, i + 1) - width(s, i)) * t;
            s.path.truncate(i + 2);
            s.widths.truncate(i + 1);
            s.widths.push(w);
            break;
        }
        remaining -= run;
    }
    let base = width(s, junction);
    let mut along = 0.0;
    for i in junction + 1..s.path.len() {
        along += distance(s.path[i - 1], s.path[i]);
        s.widths[i] = width(s, i).min(base * (1.0 - 0.45 * (along / keep).clamp(0.0, 1.0)));
    }
}

/// A crossing's bank approach ends where the growth lattice landed, often
/// inside a block. Carry each loose approach on, straight ahead, to the first
/// street it meets (else to the nearest street within `reach`), at street grade,
/// so the crossing joins the network and divides the block it enters.
pub(super) fn join_crossings(
    streets: &mut [Street],
    surface: super::Surface<'_>,
    max_grade: f64,
    reach: f64,
) {
    use super::{geometry as g, routing};
    let span = |s: &Street| matches!(s.role.as_str(), "bridge" | "ford" | "causeway");
    let abutments: Vec<Point> = streets
        .iter()
        .filter(|s| span(s))
        .flat_map(|s| [s.path[0], *s.path.last().unwrap()])
        .collect();
    if abutments.is_empty() {
        return;
    }
    snap_to_abutments(streets, surface, max_grade);
    for a in 0..streets.len() {
        let s = &streets[a];
        if span(s) || s.path.len() < 2 {
            continue;
        }
        let at_start = abutments.iter().any(|&p| distance(p, s.path[0]) < 0.5);
        let at_end = abutments
            .iter()
            .any(|&p| distance(p, *s.path.last().unwrap()) < 0.5);
        if at_start == at_end {
            continue;
        }

        let mut path = s.path.clone();
        if at_end {
            path.reverse();
        }
        let (o, before) = (path[path.len() - 1], path[path.len() - 2]);
        let l = distance(before, o);
        if l < EPS {
            continue;
        }
        let far = lerp(o, before, -reach / l);
        // Copies of this approach (the armature keeps a clipped copy) are not
        // a junction: only streets that leave its line count.
        let on_path = |p: Point| path.windows(2).any(|w| g::distance(p, w[0], w[1]).0 < 1.0);
        let copies: Vec<bool> = streets
            .iter()
            .enumerate()
            .map(|(b, t)| b == a || t.path.iter().all(|&p| on_path(p)))
            .collect();
        let others = || {
            streets
                .iter()
                .zip(&copies)
                // Streets, not lanes: the joint must survive network cleaning.
                .filter(|&(t, &copy)| !copy && t.rank <= 2 && !private(t))
                .flat_map(|(t, _)| t.path.windows(2))
        };
        if others().any(|w| g::distance(o, w[0], w[1]).0 < 1.0) {
            continue;
        }
        let ahead = others()
            .filter_map(|w| g::segment_hit(o, far, w[0], w[1]))
            .min_by(|x, y| x.0.total_cmp(&y.0))
            .map(|h| h.1);
        let nearest = || {
            others()
                .map(|w| g::distance(o, w[0], w[1]))
                .filter(|d| d.0 <= reach)
                .min_by(|x, y| x.0.total_cmp(&y.0))
                .map(|d| d.2)
        };
        let target = ahead
            .filter(|&h| routing::segment_clear(surface, o, h, max_grade))
            .or_else(|| nearest().filter(|&h| routing::segment_clear(surface, o, h, max_grade)));
        if let Some(h) = target {
            let s = &mut streets[a];
            let w = width(s, if at_end { 0 } else { s.path.len() - 1 });
            if at_end {
                s.path.insert(0, h);
                s.widths.insert(0, w);
            } else {
                s.path.push(h);
                s.widths.push(w);
            }
        }
    }
}

/// Invariant (no dangling bridge approach): a street that stops on the bank a
/// few metres short of a crossing's abutment (the lattice landed beside the
/// narrowest point chosen for the bridge) is carried to that abutment instead
/// of ending as a dead end beside it, which the exit treatment would then
/// retract further from the bridge. The joint runs at street grade on dry
/// ground, except within the street's own ribbon of the abutment, where it
/// is the deck's landing. Only a loose end on the abutment's own bank (nearer
/// to it than to the crossing's far end) is joined.
fn snap_to_abutments(streets: &mut [Street], surface: super::Surface<'_>, max_grade: f64) {
    use super::{geometry as g, routing};
    let span = |s: &Street| matches!(s.role.as_str(), "bridge" | "ford" | "causeway");
    // A crossing may be split into pieces at its junctions: its real
    // abutments are the piece ends met once, and pieces chain into crossings.
    let pieces: Vec<(Point, Point)> = streets
        .iter()
        .filter(|s| span(s) && s.path.len() >= 2)
        .map(|s| (s.path[0], *s.path.last().unwrap()))
        .collect();
    let mut parent: Vec<usize> = (0..pieces.len()).collect();
    fn root(parent: &mut [usize], mut i: usize) -> usize {
        while parent[i] != i {
            parent[i] = parent[parent[i]];
            i = parent[i];
        }
        i
    }
    let ends: Vec<(Point, usize)> = pieces
        .iter()
        .enumerate()
        .flat_map(|(i, &(a, b))| [(a, i), (b, i)])
        .collect();
    let mut order: Vec<usize> = (0..ends.len()).collect();
    order.sort_by(|&x, &y| ends[x].0.x.total_cmp(&ends[y].0.x));
    let mut count = vec![1usize; ends.len()];
    for (k, &x) in order.iter().enumerate() {
        for &y in &order[k + 1..] {
            if ends[y].0.x - ends[x].0.x > 0.5 {
                break;
            }
            if distance(ends[x].0, ends[y].0) < 0.5 {
                count[x] += 1;
                count[y] += 1;
                let (rx, ry) = (root(&mut parent, ends[x].1), root(&mut parent, ends[y].1));
                parent[rx] = ry;
            }
        }
    }
    let abutments: Vec<(Point, usize)> = (0..ends.len())
        .filter(|&e| count[e] == 1)
        .map(|e| (ends[e].0, root(&mut parent, ends[e].1)))
        .collect();
    let all_ends: Vec<Point> = ends.iter().map(|e| e.0).collect();
    let reach: f64 = 25.0;
    for a in 0..streets.len() {
        if span(&streets[a]) || streets[a].path.len() < 2 || streets[a].rank > 2 {
            continue;
        }
        for at_end in [false, true] {
            let s = &streets[a];
            let k = if at_end { s.path.len() - 1 } else { 0 };
            let (o, w) = (s.path[k], width(s, k));
            if all_ends.iter().any(|p| distance(*p, o) < 0.5) {
                continue;
            }
            let Some(&(target, crossing)) = abutments
                .iter()
                .filter(|(p, _)| distance(*p, o) <= reach.max(3.0 * w))
                .min_by(|x, y| distance(x.0, o).total_cmp(&distance(y.0, o)))
            else {
                continue;
            };
            let d = distance(target, o);
            let other_bank = abutments
                .iter()
                .any(|&(p, c)| c == crossing && distance(p, target) > 0.5 && distance(p, o) <= d);
            if other_bank {
                continue;
            }
            // Only a loose end: no other street passes there.
            let loose = !streets.iter().enumerate().any(|(b, t)| {
                b != a
                    && t.path
                        .windows(2)
                        .any(|q| g::distance(o, q[0], q[1]).0 < 0.5)
            });
            let landing = d <= w.max(6.0);
            if !loose || !(landing || routing::segment_clear(surface, o, target, max_grade)) {
                continue;
            }
            let s = &mut streets[a];
            if at_end {
                s.path.push(target);
                s.widths.push(w);
            } else {
                s.path.insert(0, target);
                s.widths.insert(0, w);
            }
        }
    }
}

pub(super) fn clean(
    streets: &mut Vec<Street>,
    center: Point,
    radius: f64,
    fortified: bool,
) -> Vec<String> {
    clean_with_centers(streets, center, radius, fortified, &[])
}

pub(super) fn clean_with_centers(
    streets: &mut Vec<Street>,
    center: Point,
    radius: f64,
    fortified: bool,
    centers: &[Point],
) -> Vec<String> {
    planarize(streets, radius);
    let before_copies = streets.len();
    drop_shadowed(streets);
    let joined = join_close_ends(streets);
    if joined || streets.len() < before_copies {
        // Reattached ends land on the survivors' sides and joints may cross
        // other streets: split them there.
        planarize(streets, radius);
    }
    let mut graph = Graph::new(streets);
    for &p in centers {
        if let Some((d, s)) = streets
            .iter()
            .map(|s| {
                let d = s
                    .path
                    .windows(2)
                    .map(|w| super::geometry::distance(p, w[0], w[1]).0)
                    .fold(f64::INFINITY, f64::min);
                (d, s)
            })
            .min_by(|a, b| a.0.total_cmp(&b.0))
            && d < radius.max(30.0)
        {
            graph.anchored[graph.component[&key(s.path[0])]] = true;
        }
    }
    let has_anchor = graph.anchored.iter().any(|&v| v);
    let largest = graph
        .length
        .iter()
        .enumerate()
        .max_by(|a, b| a.1.total_cmp(b.1).then_with(|| b.0.cmp(&a.0)))
        .map(|(i, _)| i);
    let before = streets.len();
    streets.retain(|s| {
        let c = graph.component[&key(s.path[0])];
        if has_anchor {
            graph.anchored[c]
        } else {
            Some(c) == largest
        }
    });
    drop_stubs(streets);
    if !fortified {
        let graph = Graph::new(streets);
        for s in streets
            .iter_mut()
            .filter(|s| !protected(s) && !private(s) && s.role != "quay")
        {
            let local_center = centers
                .iter()
                .copied()
                .min_by(|a, b| distance(*a, s.path[0]).total_cmp(&distance(*b, s.path[0])))
                .unwrap_or(center);
            trim_end(s, &graph, local_center, radius);
            s.path.reverse();
            s.widths.reverse();
            trim_end(s, &graph, local_center, radius);
            s.path.reverse();
            s.widths.reverse();
        }
    }
    if streets.len() < before {
        vec![format!(
            "{} fragments de rues isolés écartés.",
            before - streets.len()
        )]
    } else {
        vec![]
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn fringe_exits_form_connected_peripheral_sections_or_reclaimed_caps() {
        let h = vec![20.0; 64 * 64];
        let water = vec![0; h.len()];
        let surface = super::super::Surface {
            geometry: None,
            width: 400.0,
            n: 64,
            height: &h,
            water: &water,
        };
        let quarter = super::super::Quarter {
            shape: super::super::geometry::rectangle(80.0, 80.0, 320.0, 320.0),
            phase: 0,
            zone: "core".into(),
        };
        let initial = vec![
            street(&[(80.0, 200.0), (200.0, 200.0), (320.0, 200.0)], "street"),
            street(&[(200.0, 80.0), (200.0, 200.0), (200.0, 320.0)], "street"),
        ];
        let cfg = super::super::LayoutConfig {
            peripheral_road: "full".into(),
            ..Default::default()
        };
        let mut streets = initial.clone();
        resolve_exits(
            &mut streets,
            std::slice::from_ref(&quarter),
            &[],
            &[],
            surface,
            &cfg,
            &mut crate::rng::Rng::new("exits"),
        );
        planarize(&mut streets, 120.0);
        let graph = Graph::new(&streets);
        assert!(streets.iter().any(|s| s.role == "peripheral"));
        assert!(graph.neighbors.values().all(|n| n.len() >= 2));
        assert!(streets.iter().all(|s| super::super::routing::path_clear(
            surface,
            &s.path,
            cfg.max_street_grade
        )));
        let mut streets = initial;
        let cfg = super::super::LayoutConfig {
            exit_treatment: "closed".into(),
            ..cfg
        };
        resolve_exits(
            &mut streets,
            &[quarter],
            &[],
            &[],
            surface,
            &cfg,
            &mut crate::rng::Rng::new("exits"),
        );
        for s in &streets {
            for p in [s.path[0], *s.path.last().unwrap()] {
                assert!(
                    p.x >= 94.0 && p.x <= 306.0 && p.y >= 94.0 && p.y <= 306.0,
                    "{p:?}"
                );
            }
        }
    }

    /// Peripheral sections, feeders and rural paths never cross a curtain nor
    /// ride along it, and the streets inside a circuit keep their wall ends.
    #[test]
    fn open_edge_roads_never_cross_a_curtain() {
        use super::super::{Enclosure, LayoutConfig, Quarter, Surface, geometry as g};
        let height = vec![20.0; 64 * 64];
        let water = vec![0; height.len()];
        let surface = Surface {
            geometry: None,
            width: 1000.0,
            n: 64,
            height: &height,
            water: &water,
        };
        // Walled town (x < 400) and an open faubourg against its east side.
        let quarters = [
            Quarter {
                shape: g::rectangle(200.0, 200.0, 400.0, 600.0),
                phase: 0,
                zone: "core".into(),
            },
            Quarter {
                shape: g::rectangle(400.0, 200.0, 640.0, 600.0),
                phase: 1,
                zone: "edge".into(),
            },
        ];
        let wall: Vec<Point> = [
            (195.0, 195.0),
            (400.0, 195.0),
            (400.0, 605.0),
            (195.0, 605.0),
        ]
        .iter()
        .chain(std::iter::once(&(195.0, 195.0)))
        .map(|&(x, y)| Point { x, y })
        .collect();
        let enclosure = Enclosure {
            path: wall.clone(),
            kind: "palisade".into(),
            gates: vec![Point { x: 400.0, y: 400.0 }],
            ..Default::default()
        };
        let initial = vec![
            street(&[(300.0, 400.0), (400.0, 400.0), (520.0, 400.0)], "street"),
            street(&[(300.0, 200.0), (300.0, 400.0), (300.0, 600.0)], "street"),
            street(&[(520.0, 200.0), (520.0, 400.0), (520.0, 600.0)], "street"),
        ];
        // A regional road west of the town: reaching it means crossing the wall.
        let roads = vec![street(&[(120.0, 0.0), (120.0, 1000.0)], "regional")];
        let crosses = |s: &Street| {
            s.path.windows(2).any(|a| {
                wall.windows(2)
                    .any(|b| g::segment_hit(a[0], a[1], b[0], b[1]).is_some())
            })
        };
        for road in ["full", "auto"] {
            let cfg = LayoutConfig {
                peripheral_road: road.into(),
                ..Default::default()
            };
            let mut streets = initial.clone();
            resolve_exits(
                &mut streets,
                &quarters,
                &roads,
                std::slice::from_ref(&enclosure),
                surface,
                &cfg,
                &mut crate::rng::Rng::new("curtain-exits"),
            );
            for s in &streets[initial.len()..] {
                assert!(!crosses(s), "{} crosses the curtain: {:?}", s.role, s.path);
                let near = super::super::fortification::Near::new(&wall, 12.0);
                if s.role == "peripheral" {
                    assert!(s.path.windows(2).all(|w| near.distance(w[0], w[1]) > 5.0));
                }
            }
            // The walled street keeps its ends against the wall.
            assert_eq!(streets[1].path, initial[1].path);
            if road == "full" {
                assert!(streets.iter().any(|s| s.role == "peripheral"));
            }
        }
    }

    /// A peripheral section along a circuit is moved off it, not dropped:
    /// beside a palisade without ditch it runs along the outer face, beside a
    /// ditch along its edge; its ribbon keeps off the curtain (clearance) and
    /// the reserve, and it never crosses the curtain.
    #[test]
    fn a_peripheral_section_along_the_wall_is_rerouted_off_the_reserve() {
        use super::super::{Enclosure, LayoutConfig, Quarter, Surface, geometry as g};
        let height = vec![20.0; 64 * 64];
        let water = vec![0; height.len()];
        let surface = Surface {
            geometry: None,
            width: 1000.0,
            n: 64,
            height: &height,
            water: &water,
        };
        let wall: Vec<Point> = [
            (195.0, 195.0),
            (400.0, 195.0),
            (400.0, 605.0),
            (195.0, 605.0),
            (195.0, 195.0),
        ]
        .iter()
        .map(|&(x, y)| Point { x, y })
        .collect();
        // Curtain body all along the east face, a ditch on its north half.
        let reserve = vec![
            g::rectangle(400.0, 195.0, 401.5, 605.0),
            g::rectangle(401.5, 195.0, 414.0, 400.0),
        ];
        let enclosure = Enclosure {
            path: wall.clone(),
            kind: "palisade".into(),
            gates: vec![],
            reserve: reserve.clone(),
            ..Default::default()
        };
        // The faubourg gave the reserve up: its west edge is the reserve edge.
        let faubourg = g::rectangle(400.0, 200.0, 640.0, 600.0);
        let shape = reserve
            .iter()
            .fold(vec![faubourg], |acc, r| {
                acc.iter().flat_map(|p| g::difference(p, r)).collect()
            })
            .remove(0);
        let quarters = [Quarter {
            shape,
            phase: 1,
            zone: "edge".into(),
        }];
        let initial = vec![
            street(&[(430.0, 200.0), (430.0, 400.0), (430.0, 600.0)], "street"),
            street(&[(600.0, 200.0), (600.0, 400.0), (600.0, 600.0)], "street"),
        ];
        let cfg = LayoutConfig {
            peripheral_road: "full".into(),
            ..Default::default()
        };
        let mut streets = initial.clone();
        resolve_exits(
            &mut streets,
            &quarters,
            &[],
            std::slice::from_ref(&enclosure),
            surface,
            &cfg,
            &mut crate::rng::Rng::new("curtain-exits"),
        );
        let curtains = Curtains::new(std::slice::from_ref(&enclosure));
        let west: Vec<&Street> = streets
            .iter()
            .filter(|s| s.role == "peripheral" && s.path.iter().any(|p| p.x < 420.0))
            .collect();
        assert!(!west.is_empty(), "the section along the wall is kept");
        for s in west {
            let hw = s.widths[0] * 0.5;
            for w in s.path.windows(2) {
                assert!(!curtains.crosses(w[0], w[1]));
            }
            // Interior segments: the street ends stay where they are.
            for w in s.path[1..s.path.len() - 1].windows(2) {
                assert!(curtains.segment_clear(w[0], w[1], hw), "{:?}", s.path);
            }
            let x: Vec<f64> = s.path.iter().map(|p| p.x).collect();
            assert!(
                x.iter().any(|&x| x < 412.0),
                "along the outer face south: {x:?}"
            );
        }
    }

    /// Invariant (gate passages): inside a land gatehouse a street is at most
    /// the passage width less one metre; away from the gate it keeps its width.
    #[test]
    fn a_street_in_a_gate_passage_is_capped_to_the_passage() {
        use super::super::{Enclosure, Gatehouse, geometry as g};
        let wall: Vec<Point> = [
            (195.0, 195.0),
            (400.0, 195.0),
            (400.0, 605.0),
            (195.0, 605.0),
            (195.0, 195.0),
        ]
        .iter()
        .map(|&(x, y)| Point { x, y })
        .collect();
        let enclosure = Enclosure {
            path: wall,
            kind: "wall".into(),
            gates: vec![Point { x: 400.0, y: 400.0 }],
            gatehouses: vec![Gatehouse {
                gate: 0,
                kind: "tower".into(),
                shape: g::rectangle(398.0, 392.0, 410.0, 408.0),
                masses: vec![],
                passage: [Point { x: 398.0, y: 400.0 }, Point { x: 410.0, y: 400.0 }],
                passage_width_m: 6.0,
                height_m: 10.0,
            }],
            ..Default::default()
        };
        let mut streets = vec![Street {
            path: vec![Point { x: 300.0, y: 400.0 }, Point { x: 520.0, y: 400.0 }],
            widths: vec![9.0, 9.0],
            rank: 0,
            role: "gate-street".into(),
        }];
        cap_gate_passages(&mut streets, std::slice::from_ref(&enclosure));
        let s = &streets[0];
        assert_eq!(s.path.len(), s.widths.len());
        for (p, w) in s.path.iter().zip(&s.widths) {
            if (396.0..=412.0).contains(&p.x) {
                assert!(*w <= 5.0 + 1e-9, "{w} m at {p:?}");
            }
        }
        assert!(s.path.iter().any(|p| (p.x - 400.0).abs() < 1e-6));
        assert_eq!((s.widths[0], *s.widths.last().unwrap()), (9.0, 9.0));
    }

    fn street(points: &[(f64, f64)], role: &str) -> Street {
        Street {
            path: points.iter().map(|&(x, y)| Point { x, y }).collect(),
            widths: vec![5.0; points.len()],
            rank: 2,
            role: role.into(),
        }
    }

    #[test]
    fn local_feeder_reaches_a_regional_axis_beyond_the_immediate_fringe() {
        use super::super::{LayoutConfig, Quarter, Surface, geometry as g};
        let height = vec![20.0; 64 * 64];
        let water = vec![0; height.len()];
        let surface = Surface {
            geometry: None,
            width: 1000.0,
            n: 64,
            height: &height,
            water: &water,
        };
        let quarter = Quarter {
            shape: g::rectangle(200.0, 200.0, 400.0, 400.0),
            phase: 0,
            zone: "core".into(),
        };
        let mut streets = vec![street(
            &[(200.0, 300.0), (300.0, 300.0), (400.0, 300.0)],
            "street",
        )];
        let roads = vec![street(&[(650.0, 100.0), (650.0, 900.0)], "regional")];
        let cfg = LayoutConfig {
            peripheral_road: "none".into(),
            ..Default::default()
        };
        resolve_exits(
            &mut streets,
            &[quarter],
            &roads,
            &[],
            surface,
            &cfg,
            &mut crate::rng::Rng::new("feeder"),
        );
        let feeder = streets
            .iter()
            .find(|s| s.role == "outbound" && (s.path.last().unwrap().x - 650.0).abs() < 0.001)
            .unwrap();
        assert_eq!(feeder.path[0], Point { x: 400.0, y: 300.0 });
        assert_eq!(feeder.rank, 3);
        assert!(feeder.widths.iter().any(|w| *w <= 2.5));
        assert!((feeder.widths[0] - 5.0).abs() < 0.001);
        assert!((feeder.widths.last().unwrap() - 5.0).abs() < 0.001);
        assert!(super::super::routing::path_clear(
            surface,
            &feeder.path,
            cfg.max_lane_grade
        ));
    }

    #[test]
    fn spatial_buckets_keep_every_exact_intersection() {
        let mut rng = crate::rng::Rng::new("urban-intersection-buckets");
        let mut segments: Vec<_> = (0..80)
            .map(|street| Segment {
                street,
                offset: 0,
                a: Point {
                    x: rng.range(-200.0, 200.0),
                    y: rng.range(-200.0, 200.0),
                },
                b: Point {
                    x: rng.range(-200.0, 200.0),
                    y: rng.range(-200.0, 200.0),
                },
            })
            .collect();
        // These cross exactly at a bucket corner, from opposite diagonals.
        segments.push(Segment {
            street: 80,
            offset: 0,
            a: Point { x: -60.0, y: -60.0 },
            b: Point { x: 60.0, y: 60.0 },
        });
        segments.push(Segment {
            street: 81,
            offset: 0,
            a: Point { x: -60.0, y: 60.0 },
            b: Point { x: 60.0, y: -60.0 },
        });
        let pairs = candidates(&segments, 30.0);
        for i in 0..segments.len() {
            for j in i + 1..segments.len() {
                if !crossings(segments[i], segments[j]).is_empty() {
                    assert!(pairs.contains(&(i, j)), "missing crossing {i}/{j}");
                }
            }
        }
    }

    #[test]
    fn crossings_are_shared_junctions_and_orphans_are_removed() {
        let mut streets = vec![
            street(&[(-100.0, 0.0), (100.0, 0.0)], "regional"),
            street(&[(0.0, -50.0), (0.0, 50.0)], "street"),
            street(&[(30.0, 30.0), (60.0, 30.0)], "street"),
        ];
        let warnings = clean(&mut streets, Point { x: 0.0, y: 0.0 }, 100.0, true);
        assert_eq!(streets.len(), 2);
        assert_eq!(warnings.len(), 1);
        assert!(
            streets
                .iter()
                .all(|s| s.path.iter().any(|&p| key(p) == (0, 0)))
        );
        assert_eq!(Graph::new(&streets).degree(Point { x: 0.0, y: 0.0 }), 4);
    }

    #[test]
    fn a_street_stopping_beside_a_bridge_is_carried_to_its_abutment() {
        // The 01-l north tributary: the lattice street stops 8 m short of the
        // bridge's south abutment; a street on the far bank stays there.
        let (n, width) = (64, 640.0);
        let height = vec![10.0_f32; n * n];
        let water = vec![0_u8; n * n];
        let surface = super::super::Surface {
            geometry: None,
            width,
            n,
            height: &height,
            water: &water,
        };
        let mut streets = vec![
            street(&[(300.0, 300.0), (300.0, 330.0)], "bridge"),
            street(&[(200.0, 200.0), (295.0, 294.0)], "street"),
            street(&[(300.0, 330.0), (300.0, 420.0)], "street"),
            // Nearer the far abutment than the near one: never pulled across.
            street(&[(380.0, 335.0), (306.0, 334.0)], "street"),
        ];
        join_crossings(&mut streets, surface, 0.12, 40.0);
        assert_eq!(
            key(*streets[1].path.last().unwrap()),
            key(Point { x: 300.0, y: 300.0 })
        );
        assert_ne!(
            key(*streets[3].path.last().unwrap()),
            key(Point { x: 300.0, y: 300.0 })
        );
        let graph = Graph::new(&streets);
        assert_eq!(graph.degree(Point { x: 300.0, y: 300.0 }), 2);
    }

    #[test]
    fn a_copy_inside_a_wider_corridor_is_removed_and_its_side_street_reattached() {
        // The 01-l bridge approach: a 14 m street with a lane copy 2-3 m off
        // its centreline, a side street meeting the copy only.
        let mut main = street(&[(-100.0, 0.0), (0.0, 0.0), (100.0, 0.0)], "street");
        main.rank = 1;
        main.widths = vec![14.0; 3];
        let copy = street(&[(-60.0, 2.0), (-10.0, 3.0), (40.0, 2.5)], "lane");
        let side = street(&[(-10.0, 3.0), (-10.0, 80.0)], "street");
        let mut streets = vec![
            street(&[(-200.0, 0.0), (-100.0, 0.0)], "regional"),
            main,
            copy,
            side,
            street(&[(100.0, 0.0), (200.0, 0.0)], "regional"),
        ];
        clean(&mut streets, Point { x: 0.0, y: 0.0 }, 400.0, true);
        assert!(!streets.iter().any(|s| s.role == "lane"), "{streets:?}");
        let side = streets
            .iter()
            .find(|s| {
                s.path
                    .iter()
                    .any(|p| key(*p) == key(Point { x: -10.0, y: 80.0 }))
            })
            .expect("side street kept");
        let joint = side.path[0];
        assert!(
            joint.y.abs() < 1e-6 && (joint.x + 10.0).abs() < 1e-6,
            "{joint:?}"
        );
        assert_eq!(Graph::new(&streets).degree(joint), 3);
        // A parallel street beyond the corridor's ribbon is a real street.
        let mut streets = vec![
            street(&[(-100.0, 0.0), (100.0, 0.0)], "regional"),
            street(
                &[(-100.0, 0.0), (-100.0, 12.0), (100.0, 12.0), (100.0, 0.0)],
                "street",
            ),
        ];
        clean(&mut streets, Point { x: 0.0, y: 0.0 }, 400.0, true);
        assert_eq!(streets.len(), 2);
    }

    #[test]
    fn short_spurs_go_and_loose_ends_a_gap_apart_are_joined() {
        // A 4 m spur hangs off a 7 m street: it serves no lot.
        let mut main = street(
            &[(-100.0, 0.0), (0.0, 0.0), (10.0, -10.0), (-6.0, -10.0)],
            "street",
        );
        main.widths = vec![7.0; main.path.len()];
        let mut streets = vec![
            street(&[(-200.0, 0.0), (-100.0, 0.0)], "regional"),
            main,
            street(&[(10.0, -10.0), (12.0, -13.0)], "street"),
        ];
        clean(&mut streets, Point { x: -100.0, y: 0.0 }, 400.0, true);
        assert_eq!(streets.len(), 2);
        assert!(!streets.iter().any(|s| {
            s.path
                .iter()
                .any(|p| key(*p) == key(Point { x: 12.0, y: -13.0 }))
        }));
        // The street's own hook stays: its loose end may bound blocks.
        assert!(streets.iter().any(|s| {
            s.path
                .iter()
                .any(|p| key(*p) == key(Point { x: -6.0, y: -10.0 }))
        }));
        // Two loose ends 6 m apart (the 04 lattice gap) are one street.
        let mut streets = vec![
            street(&[(-200.0, 0.0), (0.0, 0.0)], "regional"),
            street(&[(0.0, 0.0), (0.0, 60.0), (40.0, 60.0)], "street"),
            street(&[(46.0, 60.0), (46.0, 0.0), (0.0, 0.0)], "street"),
        ];
        clean(&mut streets, Point { x: 0.0, y: 0.0 }, 400.0, true);
        let graph = Graph::new(&streets);
        assert!(streets.iter().all(|s| {
            s.path
                .iter()
                .all(|&p| graph.degree(p) >= 2 || s.role == "regional")
        }));
        // The 01-l bridge approach stopping 0.5 m short of a lane is joined.
        let mut streets = vec![
            street(&[(-200.0, 0.0), (0.0, 0.0)], "regional"),
            street(&[(0.0, 0.0), (0.0, 60.0)], "street"),
            street(
                &[(-100.0, 0.0), (-100.0, 60.5), (100.0, 60.5), (100.0, 0.0)],
                "lane",
            ),
            street(&[(100.0, 0.0), (200.0, 0.0)], "regional"),
        ];
        clean(&mut streets, Point { x: 0.0, y: 0.0 }, 400.0, true);
        assert_eq!(Graph::new(&streets).degree(Point { x: 0.0, y: 60.5 }), 3);
    }

    #[test]
    fn open_fringe_gets_served_short_ends_but_closes_and_regional_stay() {
        let mut streets = vec![
            street(&[(-100.0, 0.0), (100.0, 0.0)], "regional"),
            street(&[(0.0, 0.0), (0.0, 100.0)], "street"),
            street(&[(30.0, 0.0), (30.0, 90.0)], "close"),
        ];
        clean(&mut streets, Point { x: 0.0, y: 0.0 }, 100.0, false);
        let spur = streets.iter().find(|s| s.role == "street").unwrap();
        assert_eq!(spur.path.last().unwrap().y, 15.0);
        assert!(spur.widths.last().unwrap() < &spur.widths[0]);
        assert_eq!(
            streets
                .iter()
                .find(|s| s.role == "close")
                .unwrap()
                .path
                .last()
                .unwrap()
                .y,
            90.0
        );
        assert_eq!(
            streets
                .iter()
                .find(|s| s.role == "regional")
                .unwrap()
                .path
                .last()
                .unwrap()
                .x,
            100.0
        );
    }

    #[test]
    fn collinear_overlap_is_not_a_doubled_road() {
        let mut streets = vec![
            street(&[(0.0, 0.0), (100.0, 0.0)], "regional"),
            street(&[(40.0, 0.0), (140.0, 0.0)], "street"),
        ];
        clean(&mut streets, Point { x: 50.0, y: 0.0 }, 200.0, true);
        let length: f64 = streets
            .iter()
            .flat_map(|s| s.path.windows(2))
            .map(|p| distance(p[0], p[1]))
            .sum();
        assert!((length - 140.0).abs() < 1e-8);
        assert_eq!(Graph::new(&streets).length.len(), 1);
    }
}
