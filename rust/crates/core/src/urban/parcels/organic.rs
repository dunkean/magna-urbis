//! Organic parcellation (elven groves, round-house villages): the block is
//! tessellated into near-uniform cells instead of being cut into frontage
//! strips. A jittered hexagonal lattice sized by the culture's lot area seeds
//! a bounded Voronoi diagram, relaxed by Lloyd steps so every cell is a
//! compact, roughly round lot (a tree-house or a hut stands whole inside it,
//! never across a lot line). Cells that touch no street are served by forest
//! footpaths routed along the cell boundaries to the nearest street: a shared
//! passage parcel whose rings are shared fronts, as the derbs of a medina.
//!
//! Correct by construction: the convex Voronoi cells tile the plane, so their
//! intersections with the block (and the footpaths cut from them) partition
//! the block exactly. Deterministic per block seed; neighbour search runs on a
//! uniform grid with the Voronoi security radius (no O(n²) pass).
use super::super::geometry::{bbox, centroid, contains, interior_point, ribbon, union};
use super::*;
use std::cmp::Reverse;
use std::collections::{BTreeMap, BTreeSet, BinaryHeap};

/// Lloyd relaxation steps after the jittered lattice.
const LLOYD: usize = 2;
/// Street contact a cell needs to count as served (metres).
const MIN_FRONT: f64 = 4.0;

/// Whether the block's tissue asks for the organic cut: catalogue entries opt
/// in with `"parcellation": "organic"`.
pub(super) fn enabled(morph: &Morph) -> bool {
    morph.text("parcellation") == "organic"
}

/// Organic lots of one block, plus the footpath parcels that serve the inner
/// cells (their rings are pushed to `fronts` as shared, gated fronts).
pub(super) fn lots(
    shape: &Shape,
    block: usize,
    axis: Point,
    fronts: &mut Vec<Front>,
    morph: &Morph,
    zone: &str,
    rng: &mut Rng,
) -> Vec<Parcel> {
    let [lo, hi] = morph.range("houseArea", zone);
    let target = (lo + morph.number_or("organicLotMix", 0.4) * (hi - lo).max(0.0)).max(60.0);
    let whole = |fronts: &[Front]| {
        let mut p = parcel(shape.clone(), block, axis, fronts, "plot");
        p.provenance = vec!["organic-cell".into()];
        vec![p]
    };
    if area(shape) < 1.6 * target {
        return whole(fronts);
    }
    let spacing = (2.0 * target / 3f64.sqrt()).sqrt();
    let mut seeds = lattice(shape, axis, spacing, &mut rng.fork("organic-seeds"));
    if seeds.len() < 2 {
        return whole(fronts);
    }
    let window = frame(shape, spacing);
    for _ in 0..LLOYD {
        let cells = voronoi(&seeds, &window, spacing);
        for (s, cell) in seeds.iter_mut().zip(&cells) {
            let piece = intersection(&ring_shape(cell), shape)
                .into_iter()
                .max_by(|a, b| area(a).total_cmp(&area(b)));
            if let Some(p) = piece.filter(|p| area(p) > 1e-3) {
                let c = centroid(&p);
                *s = if contains(shape, c) {
                    c
                } else {
                    interior_point(&p)
                };
            }
        }
    }
    let cells: Vec<Shape> = voronoi(&seeds, &window, spacing)
        .iter()
        .flat_map(|cell| intersection(&ring_shape(cell), shape))
        .filter(|p| area(p) > 1e-6)
        .collect();
    let width = morph.number_or("footpathWidth", 1.8).clamp(1.2, 3.0);
    let (paths, raw, path_fronts) = footpaths(shape, &cells, fronts, width);
    fronts.extend(path_fronts);
    let mut out = Vec::with_capacity(cells.len() + paths.len());
    for cell in cells {
        for piece in cut_out(cell, &raw).into_iter().filter(|p| area(p) > 1e-6) {
            let mut p = parcel(piece, block, axis, fronts, "plot");
            p.provenance = vec!["organic-cell".into()];
            out.push(p);
        }
    }
    for path in paths {
        let mut p = parcel(path, block, axis, fronts, "court");
        p.use_kind = "court".into();
        p.reason = "shared-footpath".into();
        p.provenance = vec!["organic-footpath".into()];
        out.push(p);
    }
    out
}

/// `cell` minus the path pieces overlapping it (small pieces: one segment or
/// one join each, so a cell meets only the few beside it).
pub(super) fn cut_out(cell: Shape, raw: &[(Shape, (f64, f64, f64, f64))]) -> Vec<Shape> {
    let mut pieces = vec![cell];
    for (path, pb) in raw {
        if pieces.is_empty() {
            break;
        }
        pieces = pieces
            .into_iter()
            .flat_map(|p| {
                if boxes_overlap(*pb, bbox(&p)) {
                    difference(&p, path)
                } else {
                    vec![p]
                }
            })
            .collect();
    }
    pieces
}

/// Keep the original small segment/join cutters, except for clipped caps
/// excluded from the actual path parcels. No new property or repair face is
/// created: excluded land stays in the original Voronoi/camp cell.
fn retained_cutters(pieces: Vec<Shape>, retained: &[Shape], rejected: &[Shape]) -> Vec<(Shape, (f64, f64, f64, f64))> {
    // Protect retained path land even if overlay pieces share a seam/overlap:
    // remove only rejected ground that no retained path parcel owns.
    let excluded: Vec<Shape> = rejected.iter().flat_map(|cap| {
        let mut rest = vec![cap.clone()];
        for path in retained {
            let pb = bbox(path);
            rest = rest.into_iter().flat_map(|q| {
                if boxes_overlap(bbox(&q), pb) { difference(&q, path) }
                else { vec![q] }
            }).collect();
            if rest.is_empty() { break; }
        }
        rest
    }).collect();
    let rejected: Vec<_> = excluded.iter().map(|p| (p, bbox(p))).collect();
    pieces.into_iter().flat_map(|p| {
        let mut kept = vec![p];
        for (cap, cb) in &rejected {
            kept = kept.into_iter().flat_map(|q| {
                if boxes_overlap(bbox(&q), *cb) { difference(&q, cap) }
                else { vec![q] }
            }).collect();
            if kept.is_empty() { break; }
        }
        kept
    }).map(|p| { let b=bbox(&p); (p,b) }).collect()
}

fn ring_shape(ring: &[Point]) -> Shape {
    Shape {
        outer: ring.to_vec(),
        holes: vec![],
    }
}

fn boxes_overlap(a: (f64, f64, f64, f64), b: (f64, f64, f64, f64)) -> bool {
    a.0 <= b.2 && b.0 <= a.2 && a.1 <= b.3 && b.1 <= a.3
}

/// Counter-clockwise square around the block, a few cells wide of margin.
fn frame(shape: &Shape, spacing: f64) -> Vec<Point> {
    let (x0, y0, x1, y1) = bbox(shape);
    let m = 2.0 * spacing + 1.0;
    vec![
        Point {
            x: x0 - m,
            y: y0 - m,
        },
        Point {
            x: x1 + m,
            y: y0 - m,
        },
        Point {
            x: x1 + m,
            y: y1 + m,
        },
        Point {
            x: x0 - m,
            y: y1 + m,
        },
    ]
}

/// Jittered hexagonal lattice in the block frame (one point per lot area).
fn lattice(shape: &Shape, axis: Point, spacing: f64, rng: &mut Rng) -> Vec<Point> {
    let (x0, y0, x1, y1) = bbox(shape);
    let c = Point {
        x: 0.5 * (x0 + x1),
        y: 0.5 * (y0 + y1),
    };
    let radius = 0.5 * (x1 - x0).hypot(y1 - y0) + spacing;
    let u = unit(axis);
    let v = normal(u);
    let row = spacing * 3f64.sqrt() * 0.5;
    let (ou, ov) = (rng.float() * spacing, rng.float() * row);
    let rows = (radius / row).ceil() as i64;
    let cols = (radius / spacing).ceil() as i64 + 1;
    let mut seeds = Vec::new();
    for j in -rows..=rows {
        let shift = if j.rem_euclid(2) == 1 {
            0.5 * spacing
        } else {
            0.0
        };
        for i in -cols..=cols {
            let ju = rng.range(-0.28, 0.28) * spacing;
            let jv = rng.range(-0.28, 0.28) * spacing;
            let p = add(
                c,
                add(
                    scale(u, i as f64 * spacing + shift + ou + ju),
                    scale(v, j as f64 * row + ov + jv),
                ),
            );
            if contains(shape, p) {
                seeds.push(p);
            }
        }
    }
    seeds
}

/// Keep points `p` with `dot(n, p) <= c` (Sutherland-Hodgman, convex subject).
fn clip(ring: &[Point], n: Point, c: f64) -> Vec<Point> {
    let mut out = Vec::with_capacity(ring.len() + 1);
    for (k, &a) in ring.iter().enumerate() {
        let b = ring[(k + 1) % ring.len()];
        let (da, db) = (dot(n, a) - c, dot(n, b) - c);
        if da <= 0.0 {
            out.push(a);
        }
        if (da < 0.0 && db > 0.0) || (da > 0.0 && db < 0.0) {
            let t = da / (da - db);
            out.push(add(a, scale(sub(b, a), t)));
        }
    }
    out
}

/// Convex Voronoi cell of every seed inside `window`. Neighbours are visited
/// ring by ring on a grid of `cell` metres and the search stops at the
/// security radius (twice the cell's farthest vertex): exact, near O(n).
fn voronoi(seeds: &[Point], window: &[Point], cell: f64) -> Vec<Vec<Point>> {
    let (x0, y0) = (window[0].x, window[0].y);
    let nx = (((window[2].x - x0) / cell).ceil() as usize).max(1);
    let ny = (((window[2].y - y0) / cell).ceil() as usize).max(1);
    let key = |p: Point| {
        (
            (((p.x - x0) / cell).floor().max(0.0) as usize).min(nx - 1),
            (((p.y - y0) / cell).floor().max(0.0) as usize).min(ny - 1),
        )
    };
    let mut grid = vec![Vec::new(); nx * ny];
    for (i, &s) in seeds.iter().enumerate() {
        let (gx, gy) = key(s);
        grid[gy * nx + gx].push(i);
    }
    seeds
        .iter()
        .enumerate()
        .map(|(i, &s)| {
            let mut ring = window.to_vec();
            let (gx, gy) = key(s);
            let (gx, gy) = (gx as i64, gy as i64);
            for k in 0..=(nx.max(ny) as i64) {
                for by in (gy - k)..=(gy + k) {
                    for bx in (gx - k)..=(gx + k) {
                        if (bx - gx).abs() != k && (by - gy).abs() != k {
                            continue;
                        }
                        if bx < 0 || by < 0 || bx >= nx as i64 || by >= ny as i64 {
                            continue;
                        }
                        for &j in &grid[by as usize * nx + bx as usize] {
                            let d = sub(seeds[j], s);
                            if j == i || length(d) < 1e-9 {
                                continue;
                            }
                            let m = scale(add(seeds[j], s), 0.5);
                            ring = clip(&ring, d, dot(d, m));
                        }
                    }
                }
                if ring.len() < 3 {
                    break;
                }
                let reach = ring.iter().map(|p| length(sub(*p, s))).fold(0.0, f64::max);
                if 2.0 * reach <= k as f64 * cell {
                    break;
                }
            }
            ring
        })
        .collect()
}

/// Shared node index for nearly coincident vertices (1 mm).
struct Nodes {
    points: Vec<Point>,
    index: BTreeMap<(i64, i64), usize>,
}
impl Nodes {
    fn id(&mut self, p: Point) -> usize {
        let (kx, ky) = ((p.x * 1000.0).round() as i64, (p.y * 1000.0).round() as i64);
        for dy in -1..=1 {
            for dx in -1..=1 {
                if let Some(&n) = self.index.get(&(kx + dx, ky + dy))
                    && length(sub(self.points[n], p)) < 2e-3
                {
                    return n;
                }
            }
        }
        let n = self.points.len();
        self.points.push(p);
        self.index.insert((kx, ky), n);
        n
    }
}

/// Footpaths serving the cells with no street front: shortest routes along
/// the shared cell boundaries (multi-source Dijkstra from the street nodes),
/// each starting with one whole side of the cell it serves, later routes
/// joining earlier ones. Returns the path parcels (clipped to the block) and
/// their reversed rings as shared fronts.
pub(super) fn footpaths(
    shape: &Shape,
    cells: &[Shape],
    fronts: &[Front],
    width: f64,
) -> (Vec<Shape>, Vec<(Shape, (f64, f64, f64, f64))>, Vec<Front>) {
    // Fronts near each cell only (a camp brings thousands of path fronts).
    let mut served: Vec<f64> = cells
        .iter()
        .map(|c| {
            let b = bbox(c);
            let near: Vec<Front> = fronts
                .iter()
                .filter(|f| {
                    f.a.x.max(f.b.x) >= b.0 - 0.1
                        && f.a.x.min(f.b.x) <= b.2 + 0.1
                        && f.a.y.max(f.b.y) >= b.1 - 0.1
                        && f.a.y.min(f.b.y) <= b.3 + 0.1
                })
                .copied()
                .collect();
            frontage(c, &near).0
        })
        .collect();
    if served.iter().all(|&f| f >= MIN_FRONT) || fronts.is_empty() {
        return (vec![], vec![], vec![]);
    }
    let mut nodes = Nodes {
        points: Vec::new(),
        index: BTreeMap::new(),
    };
    // Edge (lo, hi) -> cells bordering it; per cell its edges.
    let mut edges: BTreeMap<(usize, usize), Vec<usize>> = BTreeMap::new();
    let mut own: Vec<Vec<(usize, usize)>> = vec![Vec::new(); cells.len()];
    for (c, cell) in cells.iter().enumerate() {
        let ring = &cell.outer;
        for k in 0..ring.len() {
            let (a, b) = (nodes.id(ring[k]), nodes.id(ring[(k + 1) % ring.len()]));
            if a == b {
                continue;
            }
            let e = (a.min(b), a.max(b));
            let list = edges.entry(e).or_default();
            if !list.contains(&c) {
                list.push(c);
            }
            own[c].push(e);
        }
    }
    let n = nodes.points.len();
    let pts = &nodes.points;
    let len = |e: (usize, usize)| length(sub(pts[e.0], pts[e.1]));
    let mut graph = vec![Vec::new(); n];
    for (&e, list) in &edges {
        if list.len() >= 2 {
            let l = len(e);
            graph[e.0].push((e.1, l));
            graph[e.1].push((e.0, l));
        }
    }
    // Street nodes: the source of every route, with the front it opens on.
    let mut source: Vec<Option<usize>> = vec![None; n];
    let mut dist = vec![f64::INFINITY; n];
    let mut pred = vec![usize::MAX; n];
    let mut heap = BinaryHeap::new();
    for (v, p) in pts.iter().enumerate() {
        if graph[v].is_empty() {
            continue;
        }
        if let Some(f) = fronts
            .iter()
            .position(|f| !f.shared && distance(*p, f.a, f.b) < 0.05)
        {
            source[v] = Some(f);
            dist[v] = 0.0;
            heap.push(Reverse((0f64.to_bits(), v)));
        }
    }
    let relax = |heap: &mut BinaryHeap<Reverse<(u64, usize)>>,
                 dist: &mut Vec<f64>,
                 pred: &mut Vec<usize>| {
        while let Some(Reverse((d, v))) = heap.pop() {
            let d = f64::from_bits(d);
            if d > dist[v] {
                continue;
            }
            for &(w, l) in &graph[v] {
                if d + l < dist[w] - 1e-9 {
                    dist[w] = d + l;
                    pred[w] = v;
                    heap.push(Reverse((dist[w].to_bits(), w)));
                }
            }
        }
    };
    relax(&mut heap, &mut dist, &mut pred);
    let mut order: Vec<usize> = (0..cells.len())
        .filter(|&c| served[c] < MIN_FRONT)
        .collect();
    let reach = |c: usize, dist: &[f64]| {
        own[c]
            .iter()
            .filter(|e| edges[e].len() >= 2)
            .map(|e| dist[e.0].min(dist[e.1]))
            .fold(f64::INFINITY, f64::min)
    };
    order.sort_by(|&a, &b| reach(a, &dist).total_cmp(&reach(b, &dist)).then(a.cmp(&b)));
    let mut taken: BTreeSet<(usize, usize)> = BTreeSet::new();
    let mut routes: Vec<(Vec<Point>, usize)> = Vec::new();
    for c in order {
        if served[c] >= MIN_FRONT {
            continue;
        }
        // The cell's own side nearest the network, long enough for a door.
        let side = own[c]
            .iter()
            .copied()
            .filter(|e| edges[e].len() >= 2 && len(*e) >= MIN_FRONT)
            .filter(|e| dist[e.0].min(dist[e.1]).is_finite())
            .min_by(|a, b| {
                dist[a.0]
                    .min(dist[a.1])
                    .total_cmp(&dist[b.0].min(dist[b.1]))
                    .then(a.cmp(b))
            });
        let Some(e) = side else { continue };
        let (mut v, w) = if dist[e.0] <= dist[e.1] {
            (e.0, e.1)
        } else {
            (e.1, e.0)
        };
        let mut route = vec![w, v];
        while dist[v] > 0.0 && pred[v] != usize::MAX {
            v = pred[v];
            route.push(v);
        }
        let mut front = None;
        for pair in route.windows(2) {
            let e = (pair[0].min(pair[1]), pair[0].max(pair[1]));
            if taken.insert(e) {
                for &k in &edges[&e] {
                    served[k] += len(e);
                }
            }
        }
        for &v in &route {
            front = front.or(source[v]);
            if dist[v] > 0.0 {
                dist[v] = 0.0;
                heap.push(Reverse((0f64.to_bits(), v)));
            }
        }
        relax(&mut heap, &mut dist, &mut pred);
        let mut line: Vec<Point> = route.iter().map(|&v| pts[v]).collect();
        // A route reaching the street runs on past the kerb so its end cap
        // leaves no sliver; the block clip trims it.
        if let Some(&last) = route.last()
            && source[last].is_some()
            && line.len() >= 2
        {
            let k = line.len();
            let dir = unit(sub(line[k - 1], line[k - 2]));
            line.push(add(line[k - 1], scale(dir, 2.0 * width)));
        }
        routes.push((line, front.unwrap_or(0)));
    }
    if routes.is_empty() {
        return (vec![], vec![], vec![]);
    }
    // One piece per segment and per join: the cells are cut by the few
    // beside them, the path parcels are their union.
    let mut pieces = Vec::new();
    for (line, _) in &routes {
        for w in line.windows(2) {
            pieces.extend(ribbon(w, &[width]));
        }
        for &p in line {
            pieces.push(disc(p, 0.5 * width));
        }
    }
    let (paths, rejected): (Vec<Shape>, Vec<Shape>) = union(&pieces)
        .iter()
        .flat_map(|p| intersection(p, shape))
        .partition(|p| area(p) > 0.5);
    let mut shared = Vec::new();
    for path in &paths {
        let f = routes
            .iter()
            .find(|(line, _)| contains(path, line[0]))
            .map_or(fronts[0], |(_, f)| fronts[(*f).min(fronts.len() - 1)]);
        // Reversed rings: their left side faces the lots around them.
        for ring in std::iter::once(&path.outer).chain(path.holes.iter()) {
            for k in 0..ring.len() {
                shared.push(Front {
                    a: ring[(k + 1) % ring.len()],
                    b: ring[k],
                    street: f.street,
                    rank: f.rank + 1,
                    shared: true,
                    gate: true,
                });
            }
        }
    }
    // A rejected clipped cap is not a path parcel. Do not still carve that
    // cap out of its original cell: retained path land and the cell-cut mask
    // must describe the same ground. Keep segment-sized cutters for cost.
    let raw = retained_cutters(pieces, &paths, &rejected);
    (paths, raw, shared)
}

/// Octagon of radius `r` (a path's rounded join).
fn disc(c: Point, r: f64) -> Shape {
    ring_shape(
        &(0..8)
            .map(|k| {
                let a = k as f64 * std::f64::consts::TAU / 8.0;
                Point {
                    x: c.x + r * a.cos(),
                    y: c.y + r * a.sin(),
                }
            })
            .collect::<Vec<_>>(),
    )
}

#[cfg(test)]
mod tests {
    use super::super::super::geometry::rectangle;
    use super::*;

    #[test]
    fn organic_cells_partition_the_block_and_every_lot_is_served() {
        let shape = rectangle(0.0, 0.0, 120.0, 90.0);
        let r = &shape.outer;
        let fronts: Vec<Front> = (0..r.len())
            .map(|k| Front {
                a: r[k],
                b: r[(k + 1) % r.len()],
                rank: 2,
                street: k,
                shared: false,
                gate: false,
            })
            .collect();
        let morph = Morph {
            value: serde_json::json!({"parcellation":"organic","houseArea":{"core":[300.0,500.0]}}),
        };
        let mut all = fronts.clone();
        let lots = lots(
            &shape,
            0,
            Point { x: 1.0, y: 0.0 },
            &mut all,
            &morph,
            "core",
            &mut Rng::new("organic-test"),
        );
        let total: f64 = lots.iter().map(|p| area(&p.shape)).sum();
        assert!(
            (total - area(&shape)).abs() < 1e-4 * area(&shape),
            "{total}"
        );
        let plots: Vec<_> = lots.iter().filter(|p| p.use_kind == "plot").collect();
        assert!(plots.len() >= 20, "{}", plots.len());
        assert!(
            lots.iter().any(|p| p.use_kind == "court"),
            "inner cells need a footpath"
        );
        for p in &plots {
            assert!(
                frontage(&p.shape, &all).0 >= MIN_FRONT - 0.5,
                "{:?}",
                p.shape.outer
            );
        }
        let mean = plots.iter().map(|p| area(&p.shape)).sum::<f64>() / plots.len() as f64;
        let var = plots
            .iter()
            .map(|p| (area(&p.shape) - mean).powi(2))
            .sum::<f64>()
            / plots.len() as f64;
        assert!(var.sqrt() / mean < 0.45, "cv {}", var.sqrt() / mean);
    }
}

#[cfg(test)]
#[path = "organic_retained_cutters_tests.rs"]
mod retained_cutters_tests;
