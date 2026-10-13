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

/// Resolve real outer leaves before carving blocks: joins, rural paths or closed
/// access ends. Enclosed towns retain their wall/gate termination semantics.
pub(super) fn resolve_exits(
    streets: &mut Vec<Street>,
    quarters: &[super::Quarter],
    roads: &[Street],
    surface: super::Surface<'_>,
    cfg: &super::LayoutConfig,
    rng: &mut crate::rng::Rng,
) {
    use super::{geometry as g, routing};
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
            if graph.degree(p) == 1 && boundary(p) < width(s, j).max(10.0) {
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
                    if routing::path_clear(surface, &path, cfg.max_street_grade) {
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
                if let Some(path) = planner.route(p, target, cfg.max_lane_grade) {
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
