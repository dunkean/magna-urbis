//! Route hierarchy and ribbon widths for towns and their through roads.

use super::spatial::{EPS, Key, distance, key, lerp};
use super::street::{private, width};
use crate::urban::{Morph, Point, Shape, Street};
use std::collections::BTreeMap;

/// Width of each rank for a city of this size: the cultural `widthByRank`
/// scaled up for major ranks of larger cities (metropolis arterials 12-20 m),
/// lanes and closes unchanged, then made monotone so no lower rank is wider.
pub(in crate::urban) fn rank_widths(base: [f64; 5], population: u32, by_size: bool) -> [f64; 5] {
    let size = (population as f64 / 5000.0).max(1.0).log10();
    let lift = [0.45, 0.35, 0.15, 0.0, 0.0];
    // Below 5 000 inhabitants the major ranks narrow along the same log
    // curve (a 500-soul village's main street is a lane widened, not a town
    // arterial): 0 at 5 000, full at 200; lanes and paths barely change.
    let small = if by_size { ((5000.0 / (population.max(1) as f64)).ln() / 25f64.ln()).clamp(0.0, 1.0) } else { 0.0 };
    let shrink = [0.36, 0.36, 0.28, 0.12, 0.0];
    let mut table: [f64; 5] = std::array::from_fn(|r| base[r] * (1.0 + lift[r] * size) * (1.0 - shrink[r] * small));
    for r in (0..4).rev() {
        table[r] = table[r].max(table[r + 1]);
    }
    table[0] = table[0].min(20.0);
    table
}
/// The rank widths of a tissue (`widthByRank` × `widthScale`) for a settlement of this size.
pub(in crate::urban) fn town_table(m: &Morph, population: u32, by_size: bool) -> [f64; 5] {
    let base: [f64; 5] = std::array::from_fn(|r| m.value["widthByRank"][r].as_f64().unwrap_or(3.0) * m.number_or("widthScale", 1.0));
    rank_widths(base, population, by_size)
}
/// Street land of a semantic role, relative to its rank width: the full
/// extra (a market street half again as wide, a processional way) belongs to a
/// large city; a town of 5 000 widens its market street only slightly.
fn role_factor(role: &str, population: u32) -> f64 {
    let full = match role {
        "market" => 1.6,
        "processional" => 1.5,
        "ring" => 1.3,
        "gate-street" => 1.1,
        _ => 1.0,
    };
    // 0 at 5 000 inhabitants, 1 at 100 000 and beyond.
    let size = ((population as f64 / 5000.0).max(1.0).log10() / 20f64.log10()).clamp(0.0, 1.0);
    1.0 + (full - 1.0) * (0.35 + 0.65 * size)
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
pub(in crate::urban) fn hierarchy(
    streets: &mut Vec<Street>,
    centres: &[Point],
    gates: &[Point],
    anchors: &[Point],
    population: u32,
    base: [f64; 5],
    axis: bool,
    built: &[Shape],
    by_size: bool,
    town_main: bool,
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
    // Nearest node (the first on a tie), searched ring by ring on a grid of
    // the nodes: a node beyond ring `r` lies at least `r` cells away.
    const SNAP_CELL: f64 = 64.0;
    let snap_cell = |p: Point| ((p.x / SNAP_CELL).floor() as i64, (p.y / SNAP_CELL).floor() as i64);
    let mut snap_grid: std::collections::HashMap<Key, Vec<usize>> = Default::default();
    let (mut lo, mut hi) = ((i64::MAX, i64::MAX), (i64::MIN, i64::MIN));
    for (n, &p) in nodes.iter().enumerate() {
        let c = snap_cell(p);
        (lo, hi) = ((lo.0.min(c.0), lo.1.min(c.1)), (hi.0.max(c.0), hi.1.max(c.1)));
        snap_grid.entry(c).or_default().push(n);
    }
    let finite = nodes.iter().all(|p| p.x.is_finite() && p.y.is_finite());
    let snap = |p: Point| {
        if !finite || !(p.x.is_finite() && p.y.is_finite()) {
            return (0..nodes.len())
                .min_by(|&a, &b| distance(nodes[a], p).total_cmp(&distance(nodes[b], p)))
                .unwrap();
        }
        let (cx, cy) = snap_cell(p);
        let reach = (cx - lo.0).abs().max((hi.0 - cx).abs()).max((cy - lo.1).abs()).max((hi.1 - cy).abs());
        let mut best: Option<(f64, usize)> = None;
        for r in 0..=reach {
            let mut visit = |c: Key| {
                for &n in snap_grid.get(&c).into_iter().flatten() {
                    let d = distance(nodes[n], p);
                    if best.is_none_or(|(bd, bn)| d.total_cmp(&bd).then(n.cmp(&bn)).is_lt()) {
                        best = Some((d, n));
                    }
                }
            };
            if r == 0 {
                visit((cx, cy));
            } else {
                for x in cx - r..=cx + r {
                    visit((x, cy - r));
                    visit((x, cy + r));
                }
                for y in cy - r + 1..=cy + r - 1 {
                    visit((cx - r, y));
                    visit((cx + r, y));
                }
            }
            if best.is_some_and(|(bd, _)| r as f64 * SNAP_CELL > bd + 1e-6) {
                break;
            }
        }
        best.expect("a node").1
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
    let table = rank_widths(base, population, by_size);
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
                vec![table[rank.min(4)] * role_factor(&role, population); path.len()]
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
    if town_main {
        town_roads(streets, built, table[arterial]);
    }
}

/// Invariant (« dosage »): inside the settlement a regional road (or a
/// bridge approach) is its through street, never narrower than the town's
/// arterial rank, so no lane is wider than the road it leaves; in the fields it
/// keeps its own class width, the one the regional layer draws. The change is a
/// taper of at most 1 m per 8 m on the narrow side, ending at the first block.
pub(in crate::urban) fn town_roads(streets: &mut [Street], built: &[Shape], arterial: f64) {
    const SLOPE: f64 = 1.0 / 8.0;
    const STEP: f64 = 4.0;
    if built.is_empty() {
        return;
    }
    let boxes: Vec<(f64, f64, f64, f64)> = built
        .iter()
        .map(|s| {
            s.outer.iter().fold((f64::MAX, f64::MAX, f64::MIN, f64::MIN), |b, p| {
                (b.0.min(p.x), b.1.min(p.y), b.2.max(p.x), b.3.max(p.y))
            })
        })
        .collect();
    // A vertex is in town inside a block or within its half street of one.
    let in_town = |p: Point, reach: f64| {
        built.iter().zip(&boxes).any(|(s, b)| {
            p.x >= b.0 - reach && p.x <= b.2 + reach && p.y >= b.1 - reach && p.y <= b.3 + reach
                && (crate::urban::geometry::contains(s, p)
                    || (0..s.outer.len()).any(|i| {
                        crate::urban::geometry::distance(p, s.outer[i], s.outer[(i + 1) % s.outer.len()]).0 <= reach
                    }))
        })
    };
    for s in streets.iter_mut().filter(|s| matches!(s.role.as_str(), "regional" | "approach")) {
        if s.path.len() < 2 || s.widths.iter().all(|&w| w >= arterial - 0.05) {
            continue;
        }
        // Dense stations (original vertices kept) so the taper is metric.
        let mut path = vec![s.path[0]];
        let mut own = vec![width(s, 0)];
        let mut original = vec![true];
        for i in 1..s.path.len() {
            let (a, b) = (s.path[i - 1], s.path[i]);
            let n = (distance(a, b) / STEP).ceil().max(1.0) as usize;
            for k in 1..=n {
                let t = k as f64 / n as f64;
                path.push(lerp(a, b, t));
                own.push(width(s, i - 1) * (1.0 - t) + width(s, i) * t);
                original.push(k == n);
            }
        }
        let mut target: Vec<f64> = path
            .iter()
            .zip(&own)
            .map(|(&p, &w)| if in_town(p, arterial * 0.5 + 3.0) { w.max(arterial) } else { w })
            .collect();
        if target.iter().zip(&own).all(|(t, w)| (t - w).abs() < 0.05) {
            continue;
        }
        let stations: Vec<f64> = std::iter::once(0.0)
            .chain(path.windows(2).scan(0.0, |d, p| {
                *d += distance(p[0], p[1]);
                Some(*d)
            }))
            .collect();
        for i in 1..target.len() {
            target[i] = target[i].max(target[i - 1] - SLOPE * (stations[i] - stations[i - 1]));
        }
        for i in (0..target.len() - 1).rev() {
            target[i] = target[i].max(target[i + 1] - SLOPE * (stations[i + 1] - stations[i]));
        }
        // Keep the original vertices and the taper's breaks only.
        let mut keep = vec![];
        for i in 0..path.len() {
            let last = keep.last().copied();
            let kink = i > 0 && i + 1 < path.len() && {
                let (a, b) = (stations[i] - stations[i - 1], stations[i + 1] - stations[i]);
                ((target[i] - target[i - 1]) / a.max(1e-9) - (target[i + 1] - target[i]) / b.max(1e-9)).abs() > 1e-3
            };
            if original[i] || i == 0 || kink || last.is_none() {
                keep.push(i);
            }
        }
        s.path = keep.iter().map(|&i| path[i]).collect();
        s.widths = keep.iter().map(|&i| (target[i] * 100.0).round() / 100.0).collect();
    }
}
