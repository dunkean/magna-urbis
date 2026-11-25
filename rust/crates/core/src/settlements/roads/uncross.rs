//! Invariant: no two decks of the regional network cross or overlap in plan (`crate::decks`).
//!
//! The roads of a finished network may still pass over each other on water: two routes that meet in mid river, or a
//! deck turned or a road smoothed onto its neighbour's. One of the two then leaves its deck, the least important when
//! it can: each of its banks follows the water to the landing of the deck that stays, where it joins that road; with
//! no dry way there, its crossing moves clear of every other deck. A change that would cut a place off is undone.

use super::super::Point;
use super::super::grid::Fields;
use super::profile::{CLASSES, PROFILES, profile_by_id};
use super::{Junction, RoadOutput, RoadSegment};
use crate::decks::{self, Deck};
use std::cmp::Reverse;
use std::collections::{BinaryHeap, HashMap};

/// Cells around both landings the way along the bank may take.
const WINDOW: usize = 48;
/// Clashes settled in one network: each takes a deck away, so a network has fewer.
const ROUNDS: usize = 256;

fn class_rank(class: &str) -> usize {
    CLASSES.iter().position(|c| *c == class).unwrap_or(CLASSES.len() - 1)
}
/// The crossings of the network: (segment, crossing), most important road first.
fn all(out: &RoadOutput) -> Vec<(usize, usize)> {
    let mut order: Vec<usize> = (0..out.segments.len()).filter(|&s| !out.segments[s].crossings.is_empty()).collect();
    order.sort_by(|&a, &b| {
        let (p, q) = (&out.segments[a], &out.segments[b]);
        class_rank(&p.class).cmp(&class_rank(&q.class)).then_with(|| q.importance.cmp(&p.importance)).then(a.cmp(&b))
    });
    order.into_iter().flat_map(|s| (0..out.segments[s].crossings.len()).map(move |c| (s, c))).collect()
}
fn deck(out: &RoadOutput, (s, c): (usize, usize)) -> Deck<'_> {
    Deck { path: &out.segments[s].crossings[c].path, half: 0.5 * out.segments[s].width }
}
fn ends(d: Deck<'_>) -> [Point; 2] {
    [d.path[0], d.path[d.path.len() - 1]]
}
/// Two half decks that join over the water are one deck: there, the most important one and the one that continues it
/// the straightest.
fn continues(out: &RoadOutput, f: &Fields, a: (usize, usize), b: (usize, usize)) -> bool {
    let Some(p) = ends(deck(out, a)).into_iter().find(|p| ends(deck(out, b)).iter().any(|q| p.distance(*q) <= decks::ABUTMENT)) else {
        return false;
    };
    if f.r.water[f.index(p)] == 0 {
        return false;
    }
    // The decks that end there, with their heading away from it.
    let met: Vec<((usize, usize), Point)> = all(out)
        .into_iter()
        .filter_map(|k| {
            let path = deck(out, k).path;
            let n = path.len();
            let (from, to) = if path[0].distance(p) <= decks::ABUTMENT { (path[0], path[n - 1]) } else { (path[n - 1], path[0]) };
            let l = from.distance(to).max(1e-9);
            (from.distance(p) <= decks::ABUTMENT).then_some((k, Point { x: (to.x - from.x) / l, y: (to.y - from.y) / l }))
        })
        .collect();
    let (first, heading) = met[0];
    let partner = met[1..].iter().min_by(|v, w| (v.1.x * heading.x + v.1.y * heading.y).total_cmp(&(w.1.x * heading.x + w.1.y * heading.y))).map(|m| m.0);
    partner.is_some_and(|second| (first, second) == (a, b) || (first, second) == (b, a))
}

/// The crossings that meet a more important one: (kept, leaving).
fn clashes(out: &RoadOutput, f: &Fields) -> Vec<((usize, usize), (usize, usize))> {
    let list = all(out);
    let boxes: Vec<_> = list.iter().map(|&k| deck(out, k).bounds()).collect();
    let grid = magna_urbis_geom::BoxGrid::new(boxes.clone());
    let widest = out.segments.iter().map(|s| s.width).fold(0.0, f64::max);
    let land = |p: Point| f.r.water[f.index(p)] == 0;
    (0..list.len())
        .flat_map(|j| grid.query(boxes[j], widest + decks::CLEARANCE).into_iter().filter(move |&i| i < j).map(move |i| (i, j)))
        .filter(|&(i, j)| decks::clash(deck(out, list[i]), deck(out, list[j]), land) && !continues(out, f, list[i], list[j]))
        .map(|(i, j)| (list[i], list[j]))
        .collect()
}

/// Enforce the invariant; whether a road changed.
pub(super) fn uncross(out: &mut RoadOutput, f: &Fields) -> bool {
    for round in 0..ROUNDS {
        let found = clashes(out, f);
        let Some(&(kept, leaving)) = found.first() else {
            return round > 0;
        };
        settle(out, f, kept, leaving, found.len());
    }
    true
}

/// Settle one clash out of `count`: the first change that leaves fewer of them and every place on its network.
fn settle(out: &mut RoadOutput, f: &Fields, kept: (usize, usize), leaving: (usize, usize), count: usize) {
    if kept.0 == leaving.0 {
        shortcut(out, f, kept, leaving);
        return;
    }
    let (segments, junctions, before) = (out.segments.clone(), out.junctions.clone(), networks(out));
    let all_map = f.r.n;
    for window in [WINDOW, all_map] {
        for (stays, goes) in [(kept, leaving), (leaving, kept)] {
            for detoured in [false, true] {
                let done = if detoured { detour(out, f, goes, window) } else { leave(out, f, stays, goes, window) };
                if done && clashes(out, f).len() < count && together(out, &before) {
                    return;
                }
                (out.segments, out.junctions) = (segments.clone(), junctions.clone());
            }
        }
    }
    // Every other way round was refused: a road no place needs goes.
    for goes in [leaving.0, kept.0] {
        out.segments.remove(goes);
        recount(out);
        if together(out, &before) {
            return;
        }
        (out.segments, out.junctions) = (segments.clone(), junctions.clone());
    }
    // Water on every side and no free bank: the least important road goes, and the places it served are said.
    out.segments.remove(leaving.0);
    recount(out);
    let now = networks(out);
    let hub = before.iter().map(|b| b.1).max_by_key(|r| before.iter().filter(|b| b.1 == *r).count());
    let main = before.iter().filter(|b| Some(b.1) == hub).filter_map(|b| now.iter().find(|n| n.0 == b.0)).map(|n| n.1).next();
    for &(j, root) in &before {
        let lost = Some(root) == hub && now.iter().find(|n| n.0 == j).map(|n| n.1) != main;
        if lost && let Some(key) = out.junctions[j].site.clone().filter(|key| !out.unreachable.contains(key)) {
            out.unreachable.push(key);
        }
    }
}

fn recount(out: &mut RoadOutput) {
    for j in &mut out.junctions {
        j.degree = 0;
    }
    for s in &out.segments {
        out.junctions[s.a].degree += 1;
        out.junctions[s.b].degree += 1;
    }
}
/// The places (junctions with a destination) of the network, each with the network it is on.
fn networks(out: &RoadOutput) -> Vec<(usize, usize)> {
    let mut parent: Vec<usize> = (0..out.junctions.len()).collect();
    fn root(p: &[usize], mut i: usize) -> usize {
        while p[i] != i {
            i = p[i];
        }
        i
    }
    for s in &out.segments {
        let (a, b) = (root(&parent, s.a), root(&parent, s.b));
        parent[a.max(b)] = a.min(b);
    }
    (0..out.junctions.len()).filter(|&j| out.junctions[j].site.is_some()).map(|j| (j, root(&parent, j))).collect()
}
/// Whether the places that were on one network still are, each with its road.
fn together(out: &RoadOutput, before: &[(usize, usize)]) -> bool {
    let mut now: HashMap<usize, usize> = HashMap::new();
    networks(out).iter().zip(before).all(|(n, b)| *now.entry(b.1).or_insert(n.1) == n.1)
}

/// A road whose two crossings meet: the loop between them goes, along the bank when both end on it, else over the water.
fn shortcut(out: &mut RoadOutput, f: &Fields, a: (usize, usize), b: (usize, usize)) {
    let s = &out.segments[a.0];
    let cum = stations(&s.path);
    let samples = |k: (usize, usize)| -> Vec<(f64, Point)> {
        let ends = ends(deck(out, k)).map(|p| station(&s.path, &cum, p));
        let (from, to) = (ends[0].min(ends[1]), ends[0].max(ends[1]));
        let n = ((to - from) / (0.25 * f.cell)).ceil().max(1.0) as usize;
        (0..=n).map(|i| from + (to - from) * i as f64 / n as f64).map(|t| (t, point(&s.path, &cum, t))).collect()
    };
    let (p, q) = (samples(a), samples(b));
    let (first, second) = if p[0].0 <= q[0].0 { (a, b) } else { (b, a) };
    let ([front, _], [_, back]) = (sides(out, f, first), sides(out, f, second));
    let (last, next) = (front[front.len() - 1], back[back.len() - 1]);
    let dry = |p: Point| f.r.water[f.index(p)] == 0;
    if dry(last) && dry(next) && let Some(way) = walk(f, &s.profile, last, next, WINDOW, &|_| false) {
        let mut path = front;
        path.extend(way.into_iter().skip(1));
        path.extend(back.into_iter().rev().skip(1));
        let s = &mut out.segments[a.0];
        s.path = path;
        finish(s, f);
        return;
    }
    let met = p.iter().flat_map(|u| q.iter().map(move |v| (u.1.distance(v.1), u.0.min(v.0), u.0.max(v.0)))).min_by(|x, y| x.0.total_cmp(&y.0));
    let Some((_, from, to)) = met else { return };
    let mut path = part(&s.path, &cum, 0.0, from);
    path.extend(part(&s.path, &cum, to, cum[cum.len() - 1]));
    let s = &mut out.segments[a.0];
    s.path = path;
    finish(s, f);
}

/// The road of a crossing on either side of it, each from its far end to its last dry point.
fn sides(out: &RoadOutput, f: &Fields, key: (usize, usize)) -> [Vec<Point>; 2] {
    let road = &out.segments[key.0];
    let cum = stations(&road.path);
    let ends = ends(deck(out, key)).map(|p| station(&road.path, &cum, p));
    let (from, to) = (ends[0].min(ends[1]), ends[0].max(ends[1]));
    let mut back = part(&road.path, &cum, to, cum[cum.len() - 1]);
    back.reverse();
    [part(&road.path, &cum, 0.0, from), back].map(|side| ashore(f, side))
}

/// Take the road of `leaving` off its deck: its dry sides join the landings of `kept`. False when one of them has no
/// dry way there (the network is then half changed).
fn leave(out: &mut RoadOutput, f: &Fields, kept: (usize, usize), leaving: (usize, usize), window: usize) -> bool {
    let road = out.segments[leaving.0].clone();
    let landings: Vec<Point> = dry_landings(out, f, kept);
    let mut parts: Vec<(Vec<Point>, bool, Point)> = vec![];
    for (k, side) in sides(out, f, leaving).into_iter().enumerate() {
        let end = side[side.len() - 1];
        // The other half of a deck that joins over the water.
        if f.r.water[f.index(end)] != 0 {
            continue;
        }
        let way = landings
            .iter()
            .filter_map(|&l| walk(f, &road.profile, end, l, window, &|_| false).map(|w| (w, l)))
            .min_by(|a, b| length_of(&a.0).total_cmp(&length_of(&b.0)));
        let Some((way, landing)) = way else {
            return false;
        };
        let mut path = side;
        path.extend(way.into_iter().skip(1));
        parts.push((path, k == 0, landing));
    }
    let (a, b) = (road.a, road.b);
    // The landings become junctions of the road that keeps its deck.
    let mut pieces: Vec<RoadSegment> = vec![];
    for (path, first, landing) in parts {
        let junction = junction_at(out, f, landing);
        let mut piece = RoadSegment { path, a: if first { a } else { b }, b: junction, ..road.clone() };
        if !first {
            piece.path.reverse();
            std::mem::swap(&mut piece.a, &mut piece.b);
        }
        finish(&mut piece, f);
        pieces.push(piece);
    }
    let Some(gone) = out.segments.iter().position(|s| s.a == a && s.b == b && s.path == road.path) else {
        return false;
    };
    out.segments.remove(gone);
    out.segments.extend(pieces.into_iter().filter(|p| p.length > 1e-6 && p.a != p.b));
    recount(out);
    true
}

/// Move a crossing of a road clear of every other deck: from its land on one side to the other, over the river where
/// no deck stands. False when there is no such way, or when the crossing ends over the water.
fn detour(out: &mut RoadOutput, f: &Fields, key: (usize, usize), window: usize) -> bool {
    let [front, back] = sides(out, f, key);
    let (from, to) = (front[front.len() - 1], back[back.len() - 1]);
    if f.r.water[f.index(from)] != 0 || f.r.water[f.index(to)] != 0 {
        return false;
    }
    let half = 0.5 * out.segments[key.0].width;
    let others: Vec<Deck<'_>> = all(out).into_iter().filter(|k| *k != key).map(|k| deck(out, k)).collect();
    let free = |p: Point| others.iter().all(|d| distance_to(p, d.path) > half + d.half + decks::CLEARANCE + f.cell);
    let Some(way) = walk(f, &out.segments[key.0].profile, from, to, window, &free) else {
        return false;
    };
    let mut path = front;
    path.extend(way.into_iter().skip(1));
    path.extend(back.into_iter().rev().skip(1));
    let s = &mut out.segments[key.0];
    s.path = path;
    finish(s, f);
    true
}

/// The land ends of the deck of a crossing, through the half decks that continue it.
fn dry_landings(out: &RoadOutput, f: &Fields, kept: (usize, usize)) -> Vec<Point> {
    let mut found = vec![];
    let mut open = vec![kept];
    let mut seen = vec![kept];
    while let Some(k) = open.pop() {
        let s = &out.segments[k.0];
        let (cum, deck_ends) = (stations(&s.path), ends(deck(out, k)));
        let at = deck_ends.map(|p| station(&s.path, &cum, p));
        // The road from each end of the deck onwards, to its first dry point.
        for (t, other) in [(at[0], at[1]), (at[1], at[0])] {
            let length = cum[cum.len() - 1];
            let mut away = if t < other { part(&s.path, &cum, 0.0, t) } else { part(&s.path, &cum, t, length) };
            if t >= other {
                away.reverse();
            }
            let p = *ashore(f, away).last().expect("a point");
            if f.r.water[f.index(p)] == 0 {
                found.push(p);
            }
        }
        for other in all(out) {
            if !seen.contains(&other) && continues(out, f, k, other) {
                seen.push(other);
                open.push(other);
            }
        }
    }
    found
}

/// A path that ends at the water, back to its last dry point (within a few cells).
fn ashore(f: &Fields, path: Vec<Point>) -> Vec<Point> {
    let dry = |p: Point| f.r.water[f.index(p)] == 0;
    let cum = stations(&path);
    let length = cum[cum.len() - 1];
    let step = 0.25 * f.cell;
    match (0..40).map(|k| length - k as f64 * step).find(|&t| t > step && dry(point(&path, &cum, t))) {
        Some(t) if t < length => part(&path, &cum, 0.0, t),
        _ => path,
    }
}

/// The junction at a point of a road, splitting the road there when it passes.
fn junction_at(out: &mut RoadOutput, f: &Fields, p: Point) -> usize {
    if let Some(j) = out.junctions.iter().position(|j| j.point.distance(p) <= decks::ABUTMENT && j.degree > 0) {
        return j;
    }
    let at = |s: &RoadSegment| {
        let cum = stations(&s.path);
        let t = station(&s.path, &cum, p);
        (point(&s.path, &cum, t).distance(p), t)
    };
    let index = out.junctions.len();
    out.junctions.push(Junction { point: p, degree: 2, site: None });
    let nearest = (0..out.segments.len()).min_by(|&a, &b| at(&out.segments[a]).0.total_cmp(&at(&out.segments[b]).0));
    if let Some(i) = nearest {
        let s = out.segments[i].clone();
        let (cum, t) = (stations(&s.path), at(&s).1);
        let length = cum[cum.len() - 1];
        let mut head = RoadSegment { path: part(&s.path, &cum, 0.0, t), b: index, ..s.clone() };
        let mut tail = RoadSegment { path: part(&s.path, &cum, t, length), a: index, ..s.clone() };
        let n = head.path.len();
        head.path[n - 1] = p;
        tail.path[0] = p;
        finish(&mut head, f);
        finish(&mut tail, f);
        out.segments[i] = head;
        out.segments.push(tail);
    }
    index
}

/// What a segment records of its path.
fn finish(s: &mut RoadSegment, f: &Fields) {
    let class = class_rank(&s.class);
    s.length = length_of(&s.path);
    s.crossings = super::crossings(f, &s.path, class);
    s.tunnels = super::tunnelling::spans(f, &s.path);
}

fn length_of(path: &[Point]) -> f64 {
    path.windows(2).map(|w| w[0].distance(w[1])).sum()
}
fn stations(path: &[Point]) -> Vec<f64> {
    let mut out = vec![0.0];
    for w in path.windows(2) {
        out.push(out[out.len() - 1] + w[0].distance(w[1]));
    }
    out
}
fn point(path: &[Point], cum: &[f64], s: f64) -> Point {
    let i = cum.partition_point(|&c| c <= s).clamp(1, path.len() - 1);
    let t = ((s - cum[i - 1]) / (cum[i] - cum[i - 1]).max(1e-9)).clamp(0.0, 1.0);
    Point { x: path[i - 1].x + (path[i].x - path[i - 1].x) * t, y: path[i - 1].y + (path[i].y - path[i - 1].y) * t }
}
/// Station of the point of a path nearest to `p`.
fn station(path: &[Point], cum: &[f64], p: Point) -> f64 {
    let mut best = (f64::INFINITY, 0.0);
    for (i, w) in path.windows(2).enumerate() {
        let (dx, dy) = (w[1].x - w[0].x, w[1].y - w[0].y);
        let l = dx * dx + dy * dy;
        let t = if l > 0.0 { (((p.x - w[0].x) * dx + (p.y - w[0].y) * dy) / l).clamp(0.0, 1.0) } else { 0.0 };
        let d = (p.x - w[0].x - t * dx).hypot(p.y - w[0].y - t * dy);
        if d < best.0 - 1e-9 {
            best = (d, cum[i] + t * l.sqrt());
        }
    }
    best.1
}
fn part(path: &[Point], cum: &[f64], from: f64, to: f64) -> Vec<Point> {
    let mut out = vec![point(path, cum, from)];
    out.extend(cum.iter().zip(path).filter(|&(&c, _)| c > from + 1e-6 && c < to - 1e-6).map(|(_, &p)| p));
    out.push(point(path, cum, to));
    out
}

fn distance_to(p: Point, path: &[Point]) -> f64 {
    let cum = stations(path);
    point(path, &cum, station(path, &cum, p)).distance(p)
}

/// The shortest way from `from` to `to` on dry ground within `window` cells of both, smoothed; it may cross a river
/// where `over` allows. None when there is none.
fn walk(f: &Fields, profile: &str, from: Point, to: Point, window: usize, over: &dyn Fn(Point) -> bool) -> Option<Vec<Point>> {
    if from.distance(to) <= decks::ABUTMENT || super::dry_hop(f, from, to) {
        return Some(vec![from, to]);
    }
    let n = f.r.n;
    let (start, goal) = (f.index(from), f.index(to));
    let cell = |i: usize| (i % n, i / n);
    let ((x0, y0), (x1, y1)) = (cell(start), cell(goal));
    let (lo, hi) = ((x0.min(x1).saturating_sub(window), y0.min(y1).saturating_sub(window)), ((x0.max(x1) + window).min(n - 1), (y0.max(y1) + window).min(n - 1)));
    // Cost of a cell: a river is crossed only to spare a long way round.
    let cost = |i: usize| match f.r.water[i] {
        0 => Some(1u64),
        3 if over(f.pos(i)) => Some(8),
        _ => None,
    };
    let mut open = BinaryHeap::from([(Reverse(0u64), start)]);
    let mut best: HashMap<usize, (u64, usize)> = HashMap::from([(start, (0, start))]);
    while let Some((Reverse(d), i)) = open.pop() {
        if i == goal {
            let mut path = vec![to];
            let mut k = goal;
            while k != start {
                k = best[&k].1;
                path.push(f.pos(k));
            }
            let last = path.len() - 1;
            path[last] = from;
            path.reverse();
            let smooth = super::smooth_path(f, &PROFILES[profile_by_id(profile).unwrap_or(0)], &path, f64::INFINITY);
            let dry = |line: &[Point]| line.windows(2).all(|w| super::dry_hop(f, w[0], w[1]));
            return Some(if dry(&path) && !dry(&smooth) { path } else { smooth });
        }
        if best[&i].0 < d {
            continue;
        }
        let (x, y) = cell(i);
        for (dx, dy) in [(1i64, 0i64), (-1, 0), (0, 1), (0, -1), (1, 1), (1, -1), (-1, 1), (-1, -1)] {
            let (u, v) = (x as i64 + dx, y as i64 + dy);
            if u < lo.0 as i64 || v < lo.1 as i64 || u > hi.0 as i64 || v > hi.1 as i64 {
                continue;
            }
            let (u, v) = (u as usize, v as usize);
            let j = v * n + u;
            let Some(each) = cost(j) else { continue };
            // A diagonal step clips no corner of other water.
            if cost(v * n + x).is_none() || cost(y * n + u).is_none() {
                continue;
            }
            let step = each * if dx != 0 && dy != 0 { 1414 } else { 1000 };
            if best.get(&j).is_none_or(|b| d + step < b.0) {
                best.insert(j, (d + step, i));
                open.push((Reverse(d + step), j));
            }
        }
    }
    None
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::settlements::Raster;

    const N: usize = 120;
    const WIDTH: f64 = 6000.0;

    /// A river along y = 3000, 200 m wide; with `confluence`, another across it.
    fn fields(confluence: bool) -> Fields {
        let h = vec![20.0f32; N * N];
        let river = 58..=61;
        let water: Vec<u8> = (0..N * N).map(|i| if river.contains(&(i / N)) || confluence && river.contains(&(i % N)) { 3 } else { 0 }).collect();
        let widths: Vec<f32> = water.iter().map(|&w| if w == 3 { 20.0 } else { 0.0 }).collect();
        let ids: Vec<i32> = water.iter().map(|&w| if w == 3 { 0 } else { -1 }).collect();
        Fields::new(Raster { width: WIDTH, n: N, height: &h, water: &water, water_level: &h, river_width: &widths, river_ids: &ids })
    }
    fn road(f: &Fields, class: &str, a: usize, b: usize, points: &[(f64, f64)]) -> RoadSegment {
        let mut s = RoadSegment {
            class: class.into(),
            surface: "dirt".into(),
            profile: PROFILES[0].id.into(),
            width: 8.0,
            a,
            b,
            path: points.iter().map(|&(x, y)| Point { x, y }).collect(),
            crossings: vec![],
            length: 0.0,
            grade: 0.0,
            importance: 10,
            tunnels: vec![],
        };
        finish(&mut s, f);
        s
    }
    fn network(f: &Fields, roads: Vec<RoadSegment>, places: &[(f64, f64)]) -> RoadOutput {
        let junctions = places.iter().enumerate().map(|(i, &(x, y))| Junction { point: Point { x, y }, degree: 1, site: Some(format!("p{i}")) }).collect();
        let mut out = RoadOutput { segments: roads, junctions, ..Default::default() };
        assert!(!clashes(&out, f).is_empty(), "the fixture crosses");
        assert!(uncross(&mut out, f));
        out
    }
    /// No decks meet, every road ends at a place or a junction on land, and the places stay joined.
    fn settled(f: &Fields, out: &RoadOutput, places: usize) {
        assert!(clashes(out, f).is_empty(), "two decks meet");
        let mut parent: Vec<usize> = (0..out.junctions.len()).collect();
        fn root(p: &[usize], mut i: usize) -> usize {
            while p[i] != i {
                i = p[i];
            }
            i
        }
        for s in &out.segments {
            for (p, j) in [(s.path[0], s.a), (s.path[s.path.len() - 1], s.b)] {
                assert!(p.distance(out.junctions[j].point) < 1.0, "a road off its junction");
                assert!(j < places || out.junctions[j].degree >= 2 && f.r.water[f.index(p)] == 0, "a road ends at the water");
            }
            let (a, b) = (root(&parent, s.a), root(&parent, s.b));
            parent[a] = b;
        }
        assert!((0..places).all(|i| root(&parent, i) == root(&parent, 0)), "a place lost its road");
    }

    #[test]
    fn crossing_road_bridges_become_one() {
        let f = fields(false);
        let places = [(2400.0, 2000.0), (3600.0, 4000.0), (3600.0, 2000.0), (2400.0, 4000.0)];
        let main = road(&f, "main", 0, 1, &[places[0], places[1]]);
        let track = road(&f, "track", 2, 3, &[places[2], places[3]]);
        let out = network(&f, vec![track, main], &places);
        settled(&f, &out, 4);
        assert_eq!(out.segments.iter().map(|s| s.crossings.len()).sum::<usize>(), 1, "one deck is left");
        assert!(out.segments.iter().any(|s| s.class == "main" && !s.crossings.is_empty()), "the wider road keeps it");
    }

    #[test]
    fn roads_never_meet_over_the_water() {
        // Three roads to a junction in mid river.
        let f = fields(false);
        let places = [(2400.0, 2000.0), (3000.0, 4000.0), (3600.0, 2000.0), (3000.0, 3000.0)];
        let roads = [("main", 0), ("main", 1), ("track", 2)].iter().map(|&(class, k)| road(&f, class, k, 3, &[places[k], places[3]])).collect();
        let out = network(&f, roads, &places);
        assert!(out.segments.iter().filter(|s| s.class == "track").all(|s| s.crossings.is_empty()));
        assert!(clashes(&out, &f).is_empty());
    }

    #[test]
    fn a_road_with_no_dry_way_to_the_other_deck_moves_its_crossing() {
        // Both roads pass over the confluence: no bank leads from one to the other.
        let f = fields(true);
        let places = [(2400.0, 2400.0), (3600.0, 3600.0), (3600.0, 2400.0), (2400.0, 3600.0)];
        let out = network(&f, vec![road(&f, "main", 0, 1, &[places[0], places[1]]), road(&f, "track", 2, 3, &[places[2], places[3]])], &places);
        settled_pairs(&f, &out, &[(0, 1), (2, 3)]);
    }

    #[test]
    fn a_road_never_crosses_itself_over_the_water() {
        let f = fields(false);
        let places = [(2400.0, 2700.0), (3600.0, 3300.0)];
        // Over, round, and back across its own deck.
        let winding = road(&f, "main", 0, 1, &[places[0], (3100.0, 3300.0), (3400.0, 3300.0), (3400.0, 3200.0), (2300.0, 2800.0), (2300.0, 2500.0), (3600.0, 2500.0), places[1]]);
        assert!(winding.crossings.len() >= 2);
        let out = network(&f, vec![winding], &places);
        settled(&f, &out, 2);
    }

    /// No decks meet, no road ends at the water, and each pair of places keeps its road.
    fn settled_pairs(f: &Fields, out: &RoadOutput, pairs: &[(usize, usize)]) {
        assert!(clashes(out, f).is_empty(), "two decks meet");
        let on = networks(out);
        let of = |j: usize| on.iter().find(|n| n.0 == j).map(|n| n.1);
        for &(a, b) in pairs {
            assert_eq!(of(a), of(b), "a place lost its road");
        }
        for s in &out.segments {
            for (p, j) in [(s.path[0], s.a), (s.path[s.path.len() - 1], s.b)] {
                assert!(out.junctions[j].site.is_some() || out.junctions[j].degree >= 2 && f.r.water[f.index(p)] == 0, "a road ends at the water");
            }
        }
        assert!(out.unreachable.is_empty());
    }
}
