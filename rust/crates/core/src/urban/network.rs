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
        "regional" | "bridge" | "ford" | "causeway" | "approach"
    )
}
fn private(s: &Street) -> bool {
    matches!(s.role.as_str(), "close" | "derb" | "hutong" | "roji")
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
    planarize(streets, radius);
    let graph = Graph::new(streets);
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
            trim_end(s, &graph, center, radius);
            s.path.reverse();
            s.widths.reverse();
            trim_end(s, &graph, center, radius);
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

    fn street(points: &[(f64, f64)], role: &str) -> Street {
        Street {
            path: points.iter().map(|&(x, y)| Point { x, y }).collect(),
            widths: vec![5.0; points.len()],
            rank: 2,
            role: role.into(),
        }
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
