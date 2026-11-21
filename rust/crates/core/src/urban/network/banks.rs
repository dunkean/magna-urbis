//! Connect street fragments on the same bank and trace service via dry regional roads.

use super::analysis::Graph;
use super::curtains::Curtains;
use super::spatial::{BoxGrid, EPS, distance, key, lerp, segment_box};
use super::street::{private, width};
use crate::urban::{Layout, LayoutConfig, Point, Street, Surface};
use std::collections::BTreeMap;

/// `streetFrontage`: one street network per bank. Where the plan has a water
/// crossing, a dry fragment on the same bank as another network (often the
/// regional road's own spur beside the village) is joined to it on land, by the
/// shortest link that crosses no block and no water, so a single crossing can
/// serve both instead of one bridge per fragment.
pub(in crate::urban) fn join_bank_networks(layout: &mut Layout, surface: Surface<'_>) {
    use crate::urban::{geometry as g, routing};
    const REACH: f64 = 120.0;
    let crossing = |s: &Street| matches!(s.role.as_str(), "bridge" | "ford" | "causeway");
    if !layout.streets.iter().any(crossing) { return; }
    let dry: Vec<&Street> = layout.streets.iter().filter(|s| !crossing(s) && !private(s)
        && !matches!(s.role.as_str(), "quay" | "landing" | "stairs") && s.path.len() >= 2).collect();
    let graph = Graph::new(&dry.iter().map(|s| (*s).clone()).collect::<Vec<_>>());
    let count = graph.length.len();
    if count < 2 { return; }
    let comp = |p: Point| graph.component.get(&key(p)).copied();
    let mut points: Vec<Vec<Point>> = vec![vec![]; count];
    let mut segments: Vec<Vec<(Point, Point)>> = vec![vec![]; count];
    for s in &dry {
        let Some(c) = comp(s.path[0]) else { continue };
        points[c].extend(s.path.iter().copied());
        segments[c].extend(s.path.windows(2).map(|w| (w[0], w[1])));
    }
    let boxes: Vec<_> = points.iter().map(|ps| ps.iter().fold((f64::MAX, f64::MAX, f64::MIN, f64::MIN),
        |b, p| (b.0.min(p.x), b.1.min(p.y), b.2.max(p.x), b.3.max(p.y)))).collect();
    let near = |a: usize, b: usize| boxes[a].0 - REACH <= boxes[b].2 && boxes[b].0 - REACH <= boxes[a].2
        && boxes[a].1 - REACH <= boxes[b].3 && boxes[b].1 - REACH <= boxes[a].3;
    let blocks: Vec<_> = layout.blocks.iter().map(|b| (g::bbox(&b.shape), &b.shape)).collect();
    let block_grid = BoxGrid::new(&blocks.iter().map(|b| b.0).collect::<Vec<_>>(), 64.0);
    let blocked = |a: Point, b: Point| block_grid.query(a.x.min(b.x), a.y.min(b.y), a.x.max(b.x), a.y.max(b.y)).into_iter().any(|k| {
        let ((x0, y0, x1, y1), shape) = blocks[k];
        a.x.max(b.x) >= x0 && a.x.min(b.x) <= x1 && a.y.max(b.y) >= y0 && a.y.min(b.y) <= y1
            && (g::contains(shape, lerp(a, b, 0.5))
                || shape.outer.iter().zip(shape.outer.iter().cycle().skip(1)).any(|(&c, &d)| g::segment_hit(a, b, c, d).is_some()))
    });
    let mut set: Vec<usize> = (0..count).collect();
    fn root(set: &mut [usize], mut i: usize) -> usize { while set[i] != i { set[i] = set[set[i]]; i = set[i]; } i }
    let dry_leg = |a: Point, b: Point| routing::water_intervals(surface, a, b).is_empty() && !blocked(a, b);
    // A link a lot stands in the way of goes round it, by one of its corners (3 m out).
    let detour = |p: Point, q: Point| -> Option<Vec<Point>> {
        // Only the blocks whose box meets the link (with a metre of slack for
        // the tolerance of `segment_hit`), in block order.
        let (x0, y0, x1, y1) = segment_box(p, q, 1.0);
        block_grid.query(x0, y0, x1, y1).into_iter().map(|k| blocks[k].1)
            .filter(|shape| shape.outer.iter().zip(shape.outer.iter().cycle().skip(1)).any(|(&c, &d)| g::segment_hit(p, q, c, d).is_some()))
            .flat_map(|shape| {
                let o = g::centroid(shape);
                shape.outer.iter().map(move |&c| { let l = distance(c, o).max(1e-9); Point { x: c.x + (c.x - o.x) / l * 3.0, y: c.y + (c.y - o.y) / l * 3.0 } })
            })
            .filter(|&c| dry_leg(p, c) && dry_leg(c, q))
            .min_by(|&c, &e| (distance(p, c) + distance(c, q)).total_cmp(&(distance(p, e) + distance(e, q))))
            .map(|c| vec![p, c, q])
    };
    // The shortest admissible link from network `a` to network `b` (the
    // first of `a`'s points on a tie). It does not depend on the links
    // already added, so each pair is searched once. A path is never shorter
    // than its straight span, which prunes the search.
    // Only the segments of `b` within `REACH` of `p` can be the nearest one
    // that is kept: the others are farther than `REACH` and rejected below.
    let segment_grids: Vec<BoxGrid> = segments.iter()
        .map(|list| BoxGrid::new(&list.iter().map(|&(u, v)| segment_box(u, v, 0.0)).collect::<Vec<_>>(), 32.0)).collect();
    let pair_link = |a: usize, b: usize| -> Option<(f64, Vec<Point>)> {
        let mut best: Option<(f64, Vec<Point>)> = None;
        // A point farther than `REACH` (and a metre) from `b`'s box is
        // farther than `REACH` from all of `b`.
        let (x0, y0, x1, y1) = boxes[b];
        let span = REACH + 1.0;
        for &p in &points[a] {
            if p.x < x0 - span || p.x > x1 + span || p.y < y0 - span || p.y > y1 + span {
                continue;
            }
            let Some((d, q)) = segment_grids[b].query(p.x - REACH, p.y - REACH, p.x + REACH, p.y + REACH).into_iter()
                .map(|k| { let (u, v) = segments[b][k]; let (d, _, q) = g::distance(p, u, v); (d, q) })
                .min_by(|x, y| x.0.total_cmp(&y.0)) else { continue };
            if d < 1.0 || d > REACH || best.as_ref().is_some_and(|x| d >= x.0) { continue; }
            let path = if dry_leg(p, q) { Some(vec![p, q]) } else if routing::water_intervals(surface, p, q).is_empty() { detour(p, q) } else { None };
            let Some(path) = path else { continue };
            let length: f64 = path.windows(2).map(|w| distance(w[0], w[1])).sum();
            if length <= REACH * 1.25 && best.as_ref().is_none_or(|x| length < x.0) { best = Some((length, path)); }
        }
        best
    };
    // The networks near each one (boxes within `REACH`), in order, once.
    let box_grid = BoxGrid::new(&boxes, 128.0);
    let partners: Vec<Vec<usize>> = (0..count).map(|a| {
        if graph.length[a] < 15.0 { return vec![]; }
        box_grid.query(boxes[a].0 - REACH, boxes[a].1 - REACH, boxes[a].2 + REACH, boxes[a].3 + REACH).into_iter()
            .filter(|&b| a != b && graph.length[b] >= 15.0 && near(a, b)).collect()
    }).collect();
    // Repeatedly the shortest admissible link between two networks not yet
    // joined (the first pair in order on a tie): every link once (pure per
    // pair, in parallel), then in order of length, pair order on a tie, each
    // kept when its networks are not yet joined.
    let pairs: Vec<(usize, usize)> = (0..count).flat_map(|a| partners[a].iter().map(move |&b| (a, b))).collect();
    let mut links = crate::urban::par::map(&pairs, |_, &(a, b)| pair_link(a, b));
    let mut order: Vec<usize> = (0..pairs.len()).filter(|&n| links[n].is_some()).collect();
    order.sort_by(|&x, &y| links[x].as_ref().unwrap().0.total_cmp(&links[y].as_ref().unwrap().0));
    for n in order {
        let (a, b) = pairs[n];
        let (ra, rb) = (root(&mut set, a), root(&mut set, b));
        if ra == rb { continue; }
        set[ra] = rb;
        let (_, path) = links[n].take().unwrap();
        layout.streets.push(Street { widths: vec![3.5; path.len()], path, rank: 3, role: "street".into() });
    }
}

/// `villageBridgeBudget`: the dry pieces of the imported road network (no
/// crossing, no water) within 300 m of the place's streets.
fn dry_road_segments(land: &[Street], roads: &[Street], surface: Surface<'_>) -> Vec<Street> {
    let points: Vec<Point> = land.iter().flat_map(|s| s.path.iter().copied()).collect();
    let Some((x0, y0, x1, y1)) = points.iter().fold(None, |b: Option<(f64, f64, f64, f64)>, p|
        Some(b.map_or((p.x, p.y, p.x, p.y), |b| (b.0.min(p.x), b.1.min(p.y), b.2.max(p.x), b.3.max(p.y))))) else { return vec![]; };
    let inside = |p: Point| p.x >= x0 - 300.0 && p.x <= x1 + 300.0 && p.y >= y0 - 300.0 && p.y <= y1 + 300.0;
    roads.iter()
        .filter(|s| !matches!(s.role.as_str(), "bridge" | "ford" | "causeway"))
        .flat_map(|s| (1..s.path.len()).map(|i| (s.path[i - 1], s.path[i], width(s, i - 1))).collect::<Vec<_>>())
        .filter(|&(a, b, _)| inside(a) && inside(b) && distance(a, b) > EPS && crate::urban::routing::water_intervals(surface, a, b).is_empty())
        .map(|(a, b, w)| Street { path: vec![a, b], widths: vec![w; 2], rank: 0, role: "regional".into() })
        .collect()
}
/// The dry road pieces vertex `i` of `s` meets: where their carriageways meet
/// (as drawn: the village street stopping at the road's edge), with 3 m of slack.
fn road_contacts<'a>(s: &Street, i: usize, segments: &'a [Street], grid: &BoxGrid) -> impl Iterator<Item = &'a Street> {
    let (p, reach) = (s.path[i], width(s, i) * 0.5 + 3.0);
    // The pieces are indexed by their box grown by their half width, so only
    // those within `reach` of the vertex are tested, in piece order.
    grid.query(p.x - reach, p.y - reach, p.x + reach, p.y + reach).into_iter().map(move |k| &segments[k])
        .filter(move |r| crate::urban::geometry::distance(p, r.path[0], r.path[1]).0 <= reach + r.widths[0] * 0.5)
}
/// Index of the dry road pieces for `road_contacts`.
fn road_grid(segments: &[Street]) -> BoxGrid {
    BoxGrid::new(&segments.iter().map(|r| segment_box(r.path[0], r.path[1], r.widths[0] * 0.5)).collect::<Vec<_>>(), 64.0)
}

/// `villageBridgeBudget`: bank networks (components of `banks`) that the
/// imported regional road joins on dry land near the place are one bank; they
/// need no bridge between them. Returns each component's representative.
/// Only dry road pieces within 300 m of the place's streets count, so a long
/// detour round a lake does not stand for a crossing.
pub(super) fn regional_banks(land: &[Street], banks: &Graph, roads: &[Street], surface: Surface<'_>) -> Vec<usize> {
    let count = banks.length.len();
    let mut parent: Vec<usize> = (0..count).collect();
    fn root(parent: &mut [usize], mut i: usize) -> usize { while parent[i] != i { parent[i] = parent[parent[i]]; i = parent[i]; } i }
    let segments = dry_road_segments(land, roads, surface);
    if segments.is_empty() { return parent; }
    let dry = Graph::new(&segments);
    let grid = road_grid(&segments);
    let mut first: BTreeMap<usize, usize> = BTreeMap::new();
    for s in land {
        let Some(&c) = s.path.first().and_then(|p| banks.component.get(&key(*p))) else { continue };
        for i in 0..s.path.len() {
            for r in road_contacts(s, i, &segments, &grid) {
                let d = dry.component[&key(r.path[0])];
                let other = *first.entry(d).or_insert(c);
                let (a, b) = (root(&mut parent, other), root(&mut parent, c));
                if a != b { parent[b.max(a)] = a.min(b); }
            }
        }
    }
    (0..count).map(|i| root(&mut parent, i)).collect()
}

/// `villageBridgeBudget`, before the bridge choice: a village street network
/// that touches no dry road piece is tied to the nearest one on its own bank
/// (within 150 m, from one of its loose ends, by a lane that crosses no water
/// or wall and no more than 6 m of block, a corner where two blocks touch),
/// so the road's crossing can serve it instead of a deck of its own. The same link
/// `ensure_regional_access` makes after the fact, per network.
pub(in crate::urban) fn tie_banks_to_road(layout: &mut Layout, roads: &[Street], surface: Surface<'_>, cfg: &LayoutConfig) {
    use crate::urban::{geometry as g, routing};
    const REACH: f64 = 150.0;
    let crossing = |s: &Street| matches!(s.role.as_str(), "bridge" | "ford" | "causeway");
    if roads.is_empty() || cfg.scope != "settlement" || cfg.exit_treatment == "closed" || !layout.streets.iter().any(crossing) { return; }
    let land: Vec<Street> = layout.streets.iter().filter(|s| !crossing(s) && s.path.len() >= 2).cloned().collect();
    let segments = dry_road_segments(&land, roads, surface);
    if segments.is_empty() { return; }
    // A crossing's landing is not a loose end: the crossing already leads on.
    let landings: Vec<Point> = layout.streets.iter().filter(|s| crossing(s) && s.path.len() >= 2)
        .flat_map(|s| [s.path[0], *s.path.last().unwrap()]).collect();
    let graph = Graph::new(&land);
    let count = graph.length.len();
    let road_pieces = road_grid(&segments);
    let mut touched = vec![false; count];
    for s in &land {
        let Some(&c) = s.path.first().and_then(|p| graph.component.get(&key(*p))) else { continue };
        touched[c] |= (0..s.path.len()).any(|i| road_contacts(s, i, &segments, &road_pieces).next().is_some());
    }
    let blocks: Vec<_> = layout.blocks.iter().map(|b| (g::bbox(&b.shape), &b.shape)).collect();
    let block_grid = BoxGrid::new(&blocks.iter().map(|b| b.0).collect::<Vec<_>>(), 64.0);
    // Metres of the link inside blocks (1 m samples): a loose end between two
    // touching blocks may clip a corner, the link never runs through a block.
    let inside = |a: Point, b: Point| {
        let k = distance(a, b).ceil().max(1.0) as usize;
        (0..k).filter(|&i| { let p = lerp(a, b, (i as f64 + 0.5) / k as f64);
            block_grid.query(p.x, p.y, p.x, p.y).into_iter().any(|k| { let ((x0, y0, x1, y1), shape) = blocks[k]; p.x >= x0 && p.x <= x1 && p.y >= y0 && p.y <= y1 && g::contains(shape, p) }) })
            .count() as f64 * distance(a, b) / k as f64
    };
    let curtains = Curtains::new(&layout.enclosures);
    let clear = |path: &[Point]| path.windows(2).map(|w| inside(w[0], w[1])).sum::<f64>() <= 6.0
        && !path.windows(2).any(|w| curtains.crosses(w[0], w[1])
        || !routing::water_intervals(surface, w[0], w[1]).is_empty() || !routing::segment_clear(surface, w[0], w[1], cfg.max_lane_grade));
    for c in (0..count).filter(|&c| !touched[c] && graph.length[c] >= 15.0) {
        let mut candidates = vec![];
        for s in land.iter().filter(|s| !private(s) && s.path.first().and_then(|p| graph.component.get(&key(*p))) == Some(&c)) {
            for p in [s.path[0], *s.path.last().unwrap()] {
                if surface.wet(p) || graph.degree(p) != 1 || landings.iter().any(|&l| distance(l, p) <= 3.0) { continue; }
                // Only the pieces within `REACH` of the end can be the nearest one that is kept.
                if let Some((d, q)) = road_pieces.query(p.x - REACH, p.y - REACH, p.x + REACH, p.y + REACH).into_iter()
                    .map(|k| { let r = &segments[k]; let (d, _, q) = g::distance(p, r.path[0], r.path[1]); (d, q) })
                    .min_by(|a, b| a.0.total_cmp(&b.0)) && d <= REACH {
                    candidates.push((d, p, q));
                }
            }
        }
        candidates.sort_by(|a, b| a.0.total_cmp(&b.0));
        for (_, p, q) in candidates.into_iter().take(4) {
            let path = if clear(&[p, q]) { Some(vec![p, q]) } else {
                let pad = 60.0;
                let mut planner = routing::RoutePlanner::new(surface, (p.x.min(q.x) - pad, p.y.min(q.y) - pad, p.x.max(q.x) + pad, p.y.max(q.y) + pad));
                planner.route(p, q, cfg.max_lane_grade).filter(|path| clear(path))
            };
            let Some(path) = path else { continue };
            layout.streets.push(Street { widths: vec![2.5; path.len()], path, rank: 3, role: "outbound".into() });
            break;
        }
    }
}
