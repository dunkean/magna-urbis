//! Invariant: no two decks of a town cross or overlap in plan (`crate::decks`). Enforced once, on the finished network.
//!
//! Each deck is met by rank, width and span. One that meets a deck already kept goes: its road reaches that deck
//! along the bank, else its span moves clear along the channel, else its tail goes back to its last junction. No
//! road is left ending at the water.

use super::bridge_leads::carved;
use super::junctions::planarize;
use super::reservations::remap_reservations;
use super::spatial::{distance, key, lerp, segment_box};
use super::street::width;
use super::water_clearance::clear_bank_ends;
use crate::decks::{self, Deck};
use crate::urban::{Layout, LayoutConfig, Point, Street, Surface, footprint::crossings, geometry as g, routing};
use std::collections::{BTreeMap, BTreeSet, HashSet};

/// Longest link along a bank to another deck, and room the search for it takes (m).
const LINK: f64 = 250.0;
const PAD: f64 = 60.0;
/// Two pieces that continue each other this straight (cosine) over the water are one deck.
const STRAIGHT: f64 = 0.96;

fn half(s: &Street) -> f64 {
    s.widths.iter().copied().fold(1.0, f64::max) * 0.5
}
fn deck(s: &Street) -> Deck<'_> {
    Deck { path: &s.path, half: half(s) }
}
/// Whether a new straight deck meets one of the crossings among `streets`.
pub(super) fn meets(ends: &[Point], width: f64, streets: &[Street], surface: Surface<'_>) -> bool {
    streets.iter().any(|s| spans(s) && decks::clash(Deck { path: ends, half: 0.5 * width }, deck(s), |p| !surface.wet(p)))
}
fn spans(s: &Street) -> bool {
    matches!(s.role.as_str(), "bridge" | "ford") && s.path.len() >= 2
}

/// A deck, whole: the pieces junctions cut it into, over water, are one.
struct Span {
    parts: Vec<usize>,
    path: Vec<Point>,
    half: f64,
    rank: usize,
    length: f64,
}
impl Span {
    fn deck(&self) -> Deck<'_> {
        Deck { path: &self.path, half: self.half }
    }
    fn ends(&self) -> [Point; 2] {
        [self.path[0], self.path[self.path.len() - 1]]
    }
}

/// The decks of the network: bridges, fords, and the wet stretches of causeways that no quay carries.
fn decks_of(streets: &[Street], surface: Surface<'_>) -> Vec<Span> {
    let quays: Vec<(Point, Point, f64)> = streets.iter().filter(|s| s.role == "quay").flat_map(|s| s.path.windows(2).map(|w| (w[0], w[1], half(s) + 0.5))).collect();
    // Metres over water; a bank ramp may clip a seam of it.
    let over_water = |s: &Street| {
        let wet: f64 = s.path.windows(2).map(|w| {
            let l = distance(w[0], w[1]);
            let n = (l / 2.0).ceil().max(1.0) as usize;
            let over = (0..n).filter(|&k| {
                let p = lerp(w[0], w[1], (k as f64 + 0.5) / n as f64);
                surface.wet(p) && !quays.iter().any(|&(a, b, reach)| g::distance(p, a, b).0 <= reach)
            });
            over.count() as f64 * l / n as f64
        }).sum();
        wet >= 4.0
    };
    let pieces: Vec<usize> = (0..streets.len()).filter(|&i| spans(&streets[i]) || streets[i].role == "causeway" && streets[i].path.len() >= 2 && over_water(&streets[i])).collect();
    // Piece ends at each node over water, with the heading away from it.
    let mut nodes: BTreeMap<_, Vec<(usize, bool, Point)>> = BTreeMap::new();
    for (k, &i) in pieces.iter().enumerate() {
        let path = &streets[i].path;
        let n = path.len();
        for (at_end, p, q) in [(false, path[0], path[1]), (true, path[n - 1], path[n - 2])] {
            if surface.wet(p) {
                let l = distance(p, q).max(1e-9);
                nodes.entry(key(p)).or_default().push((k, at_end, Point { x: (q.x - p.x) / l, y: (q.y - p.y) / l }));
            }
        }
    }
    // The straightest pairs continue each other.
    let mut next: Vec<[Option<usize>; 2]> = vec![[None; 2]; pieces.len()];
    for ends in nodes.values() {
        let mut pairs: Vec<(f64, usize, usize)> = (0..ends.len()).flat_map(|a| (0..a).map(move |b| (a, b))).filter(|&(a, b)| ends[a].0 != ends[b].0).map(|(a, b)| (ends[a].2.x * ends[b].2.x + ends[a].2.y * ends[b].2.y, a, b)).collect();
        pairs.sort_by(|p, q| p.0.total_cmp(&q.0).then((p.1, p.2).cmp(&(q.1, q.2))));
        let mut used = BTreeSet::new();
        for (cosine, a, b) in pairs {
            if cosine <= -STRAIGHT && !used.contains(&a) && !used.contains(&b) {
                used.extend([a, b]);
                next[ends[a].0][usize::from(ends[a].1)] = Some(ends[b].0);
                next[ends[b].0][usize::from(ends[b].1)] = Some(ends[a].0);
            }
        }
    }
    let mut seen = vec![false; pieces.len()];
    let mut out = vec![];
    // Chains start at a piece with a free end.
    for start in 0..pieces.len() {
        if seen[start] || next[start].iter().all(Option::is_some) {
            continue;
        }
        let (mut k, mut parts, mut path) = (start, vec![], vec![]);
        let mut came: Option<usize> = None;
        loop {
            seen[k] = true;
            parts.push(pieces[k]);
            let mut piece = streets[pieces[k]].path.clone();
            // Entered by the end that leads back; the first piece leaves by its linked end.
            let enters_at_end = match came {
                Some(before) => next[k][1] == Some(before) && next[k][0] != Some(before),
                None => next[k][0].is_some(),
            };
            if enters_at_end {
                piece.reverse();
            }
            path.extend(piece.into_iter().skip(usize::from(!path.is_empty())));
            let Some(onward) = next[k][usize::from(!enters_at_end)].filter(|&n| !seen[n]) else {
                break;
            };
            came = Some(k);
            k = onward;
        }
        let length = path.windows(2).map(|w: &[Point]| distance(w[0], w[1])).sum();
        out.push(Span { half: parts.iter().map(|&i| half(&streets[i])).fold(0.0, f64::max), rank: parts.iter().map(|&i| streets[i].rank).min().unwrap_or(9), length, parts, path });
    }
    out
}

/// The decks to drop, each with the kept deck it meets (indices into `spans`).
fn choose(spans: &[Span], surface: Surface<'_>) -> Vec<(usize, usize)> {
    let mut order: Vec<usize> = (0..spans.len()).collect();
    order.sort_by(|&a, &b| {
        let (p, q) = (&spans[a], &spans[b]);
        p.rank.cmp(&q.rank).then_with(|| q.half.total_cmp(&p.half)).then_with(|| p.length.total_cmp(&q.length)).then(a.cmp(&b))
    });
    let (mut kept, mut dropped): (Vec<usize>, Vec<(usize, usize)>) = (vec![], vec![]);
    for i in order {
        let met = kept.iter().copied().find(|&k| decks::clash(spans[k].deck(), spans[i].deck(), |p| !surface.wet(p)));
        match met {
            Some(k) => dropped.push((i, k)),
            None => kept.push(i),
        }
    }
    dropped
}

/// Enforce the invariant on a finished layout.
pub(in crate::urban) fn uncross_decks(layout: &mut Layout, surface: Surface<'_>, cfg: &LayoutConfig) {
    // A moved span or a link can only meet decks already settled: two rounds settle every town.
    for _ in 0..3 {
        if !uncross_once(layout, surface, cfg) {
            return;
        }
    }
    // What still meets goes without a replacement.
    let spans = decks_of(&layout.streets, surface);
    let gone: BTreeSet<usize> = choose(&spans, surface).into_iter().flat_map(|(i, _)| spans[i].parts.clone()).collect();
    remove(layout, &gone, surface);
}

fn uncross_once(layout: &mut Layout, surface: Surface<'_>, cfg: &LayoutConfig) -> bool {
    let spans = decks_of(&layout.streets, surface);
    let dropped = choose(&spans, surface);
    if dropped.is_empty() {
        return false;
    }
    let gone: BTreeSet<usize> = dropped.iter().flat_map(|&(i, _)| spans[i].parts.iter().copied()).collect();
    let losers: BTreeSet<usize> = dropped.iter().map(|d| d.0).collect();
    let mut settled: Vec<Street> = (0..spans.len())
        .filter(|i| !losers.contains(i))
        .map(|i| Street { path: spans[i].path.clone(), widths: vec![2.0 * spans[i].half; spans[i].path.len()], rank: spans[i].rank, role: "bridge".into() })
        .collect();
    let reserved: HashSet<usize> = layout.programme.iter().flat_map(|p| &p.reservations).map(|r| r.block).collect();
    let mut added: Vec<Street> = vec![];
    for (i, k) in dropped {
        let (span, winner) = (&spans[i], &spans[k]);
        let role = layout.streets[span.parts[0]].role.clone();
        let land: Vec<Point> = span.ends().into_iter().filter(|&p| !surface.wet(p)).collect();
        let links: Vec<Option<Street>> = land
            .iter()
            .map(|&p| {
                let mut targets: Vec<Point> = winner.ends().into_iter().filter(|&q| !surface.wet(q)).collect();
                targets.sort_by(|a, b| distance(p, *a).total_cmp(&distance(p, *b)));
                targets.into_iter().find_map(|q| link(layout, p, q, span, &reserved, surface, cfg))
            })
            .collect();
        // A road whose two banks reach the kept deck needs no deck of its own; else its span moves.
        if links.len() < 2 || links.iter().any(Option::is_none) {
            if let Some(moved) = shift(span, &role, &settled, surface) {
                settled.push(moved[0].clone());
                added.extend(moved);
                continue;
            }
        }
        for l in links.into_iter().flatten().filter(|s| s.path.len() >= 2) {
            let fresh = [(l.path.clone(), half(&l), f64::INFINITY)];
            if let Some(blocks) = carved(layout, &fresh, &reserved) {
                for (block, shape) in blocks {
                    layout.blocks[block].shape = shape;
                }
                added.push(l);
            }
        }
    }
    let reservations: Vec<_> = layout.programme.iter().flat_map(|p| &p.reservations).map(|r| layout.streets.get(r.street).cloned()).collect();
    let linked = !added.is_empty();
    layout.streets.extend(added);
    remove(layout, &gone, surface);
    if linked {
        planarize(&mut layout.streets, surface.width * 0.25);
        remap_reservations(layout, &reservations);
    }
    true
}

/// A way along the bank from a dropped deck's landing to the kept one, outside the blocks and the curtains.
fn link(layout: &Layout, from: Point, to: Point, span: &Span, reserved: &HashSet<usize>, surface: Surface<'_>, cfg: &LayoutConfig) -> Option<Street> {
    let width = (2.0 * span.half).min(8.0);
    let way = |path: Vec<Point>| Street { widths: vec![width; path.len()], path, rank: span.rank, role: "approach".into() };
    let d = distance(from, to);
    if d <= decks::ABUTMENT {
        return Some(way(vec![from]));
    }
    if d > LINK {
        return None;
    }
    let free = |path: &[Point]| {
        !path.windows(2).any(|w| layout.enclosures.iter().any(|e| e.path.windows(2).any(|c| g::segment_hit(w[0], w[1], c[0], c[1]).is_some())))
            && carved(layout, &[(path.to_vec(), 0.5 * width, f64::INFINITY)], reserved).is_some()
    };
    let grade = 2.0 * cfg.max_street_grade;
    if routing::segment_clear(surface, from, to, grade) && free(&[from, to]) {
        return Some(way(vec![from, to]));
    }
    let bounds = segment_box(from, to, PAD);
    let mut planner = routing::RoutePlanner::bank(surface, bounds);
    [cfg.max_street_grade, grade, 1e6].into_iter().find_map(|limit| planner.route(from, to, limit)).filter(|path| free(path)).map(way)
}

/// The same span elsewhere along the channel, clear of every settled deck, with a straight dry way from each landing.
fn shift(span: &Span, role: &str, settled: &[Street], surface: Surface<'_>) -> Option<Vec<Street>> {
    let [a, b] = span.ends();
    if surface.wet(a) || surface.wet(b) {
        return None;
    }
    let l = distance(a, b).max(1e-9);
    let u = ((b.x - a.x) / l, (b.y - a.y) / l);
    let middle = routing::water_intervals(surface, a, b).into_iter().max_by(|p, q| (p.1 - p.0).total_cmp(&(q.1 - q.0))).map(|(s, t)| lerp(a, b, 0.5 * (s + t)))?;
    [12.0, -12.0, 24.0, -24.0, 48.0, -48.0, 72.0, -72.0, 96.0, -96.0].into_iter().find_map(|offset: f64| {
        let mut ends = crossings::deck(surface, Point { x: middle.x - u.1 * offset, y: middle.y + u.0 * offset })?;
        if distance(a, ends[0]) > distance(a, ends[1]) {
            ends.swap(0, 1);
        }
        let dry = |p: Point, q: Point| routing::segment_clear(surface, p, q, f64::INFINITY);
        if meets(&ends, 2.0 * span.half, settled, surface) || !dry(a, ends[0]) || !dry(b, ends[1]) {
            return None;
        }
        let way = |path: Vec<Point>, role: &str| Street { widths: vec![2.0 * span.half; path.len()], path, rank: span.rank, role: role.into() };
        Some(vec![way(ends.to_vec(), role), way(vec![a, ends[0]], "approach"), way(vec![b, ends[1]], "approach")])
    })
}

/// Drop the streets `gone`, and the tails they leave: back to their last junction.
fn remove(layout: &mut Layout, gone: &BTreeSet<usize>, surface: Surface<'_>) {
    if gone.is_empty() {
        return;
    }
    let reserved: Vec<_> = layout.programme.iter().flat_map(|p| &p.reservations).map(|r| layout.streets.get(r.street).cloned()).collect();
    let landings: Vec<Point> = gone.iter().flat_map(|&i| layout.streets[i].path.clone()).collect();
    let mut i = 0;
    layout.streets.retain(|_| {
        i += 1;
        !gone.contains(&(i - 1))
    });
    let mut open: Vec<Point> = landings;
    while let Some(p) = open.pop() {
        let streets = &mut layout.streets;
        let touching: Vec<usize> = (0..streets.len()).filter(|&i| streets[i].path.windows(2).any(|w| g::distance(p, w[0], w[1]).0 < 0.05)).collect();
        let [i] = touching[..] else { continue };
        let n = streets[i].path.len();
        let at_end = distance(streets[i].path[n - 1], p) < 0.05;
        // A road that leaves the town keeps its way; only its other end is a tail.
        if !at_end && distance(streets[i].path[0], p) >= 0.05 || matches!(streets[i].role.as_str(), "quay" | "pier" | "mole" | "landing") {
            continue;
        }
        let mut s = streets[i].clone();
        let mut widths: Vec<f64> = (0..n).map(|k| width(&s, k)).collect();
        if at_end {
            s.path.reverse();
            widths.reverse();
        }
        let met = |q: Point| streets.iter().enumerate().any(|(j, t)| j != i && t.path.windows(2).any(|w| g::distance(q, w[0], w[1]).0 < 0.05));
        match (1..n).find(|&k| met(s.path[k])) {
            Some(k) if k + 1 < n => {
                s.path.drain(..k);
                widths.drain(..k);
                s.widths = widths;
                if at_end {
                    s.path.reverse();
                    s.widths.reverse();
                }
                streets[i] = s;
            }
            // Nothing meets it before its far end: the tail is the street, unless it leads out of the town.
            found => {
                let far = s.path[n - 1];
                if found.is_none() && matches!(s.role.as_str(), "regional" | "outbound") {
                    continue;
                }
                streets.remove(i);
                open.push(far);
            }
        }
    }
    clear_bank_ends(&mut layout.streets, surface);
    remap_reservations(layout, &reserved);
}

/// The pairs of decks of a network that meet: none, on a finished town.
#[cfg(test)]
pub(in crate::urban) fn deck_clashes(streets: &[Street], surface: Surface<'_>) -> Vec<(Point, Point)> {
    let spans = decks_of(streets, surface);
    choose(&spans, surface).into_iter().map(|(i, k)| (spans[i].ends()[0], spans[k].ends()[0])).collect()
}

#[cfg(test)]
mod tests {
    use super::super::analysis::Graph;
    use super::*;

    /// Whether the network joins two points.
    fn joined(streets: &[Street], a: Point, b: Point) -> bool {
        let graph = Graph::new(streets);
        let of = |p: Point| graph.component.get(&key(p)).copied();
        of(a).is_some() && of(a) == of(b)
    }

    #[test]
    fn crossing_bridges_become_one_and_no_road_ends_at_the_water() {
        // A river 24 m wide, north to south, x 116..140.
        let (height, water) = (vec![5.0f32; 128 * 128], (0..128 * 128).map(|i| if (58..70).contains(&(i % 128)) { 3u8 } else { 0 }).collect::<Vec<u8>>());
        let surface = Surface { geometry: None, width: 256.0, n: 128, height: &height, water: &water, interpolation: Default::default() };
        let way = |points: &[(f64, f64)], rank: usize, role: &str| Street {
            path: points.iter().map(|&(x, y)| Point { x, y }).collect(),
            widths: vec![5.0; points.len()],
            rank,
            role: role.into(),
        };
        let mut layout: Layout = serde_json::from_value(serde_json::json!({
            "key": "decks", "culture": "bastide", "center": {"x": 128.0, "y": 128.0},
            "streets": [], "quarters": [], "blocks": [], "warnings": []
        }))
        .unwrap();
        layout.streets = vec![
            way(&[(112.0, 110.0), (144.0, 130.0)], 1, "bridge"),
            way(&[(112.0, 130.0), (144.0, 110.0)], 2, "bridge"),
            way(&[(20.0, 110.0), (112.0, 110.0)], 1, "street"),
            way(&[(144.0, 130.0), (240.0, 130.0)], 1, "street"),
            way(&[(20.0, 130.0), (112.0, 130.0)], 2, "street"),
            way(&[(144.0, 110.0), (240.0, 110.0)], 2, "street"),
        ];
        for split in [false, true] {
            let mut town = layout.clone();
            // As the network passes leave them: four half decks on a junction over the water.
            if split {
                planarize(&mut town.streets, 64.0);
            }
            assert_eq!(deck_clashes(&town.streets, surface).len(), 1);
            uncross_decks(&mut town, surface, &LayoutConfig::default());
            assert!(deck_clashes(&town.streets, surface).is_empty());
            let end = |x: f64, y: f64| Point { x, y };
            for (a, b) in [(end(20.0, 110.0), end(240.0, 130.0)), (end(20.0, 130.0), end(240.0, 110.0)), (end(20.0, 130.0), end(20.0, 110.0))] {
                assert!(joined(&town.streets, a, b), "{a:?} {b:?}");
            }
            let graph = Graph::new(&town.streets);
            assert!(town.streets.iter().flat_map(|s| [s.path[0], *s.path.last().unwrap()]).all(|p| graph.degree(p) > 1 || !(100.0..160.0).contains(&p.x)), "a road ends at the water");
        }
    }

    #[test]
    fn decks_that_share_a_landing_or_run_apart_stay() {
        let (height, water) = (vec![5.0f32; 128 * 128], (0..128 * 128).map(|i| if (58..70).contains(&(i % 128)) { 3u8 } else { 0 }).collect::<Vec<u8>>());
        let surface = Surface { geometry: None, width: 256.0, n: 128, height: &height, water: &water, interpolation: Default::default() };
        let way = |a: (f64, f64), b: (f64, f64)| Street { path: vec![Point { x: a.0, y: a.1 }, Point { x: b.0, y: b.1 }], widths: vec![5.0; 2], rank: 2, role: "bridge".into() };
        assert!(deck_clashes(&[way((112.0, 110.0), (144.0, 110.0)), way((112.0, 110.0), (144.0, 150.0)), way((112.0, 60.0), (144.0, 60.0))], surface).is_empty());
    }
}
