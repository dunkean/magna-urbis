//! A short straight lead on each side of a deck: the first turn or junction stands back from the bridge.
//!
//! Local rewrite of the last metres of the town streets that end at a bridge. A street that turns sharply at
//! the deck first runs on along its axis; a head with too many arms keeps four, the others join the lead.
//! Each street rejoins its own line within a few lead lengths, the blocks give up the new ribbons, and an end
//! whose rewrite would meet a curtain, another street, a reserved block or bad ground is left as it was.

use super::spatial::{distance, lerp, segment_box};
use super::street::{CROSSINGS, private, width};
use crate::rng::Rng;
use crate::urban::{Layout, LayoutConfig, Point, Shape, Street, Surface, geometry as g, routing};
use std::collections::HashSet;

/// Length of a lead (m): a share of the deck width, within these bounds.
const LEAD: (f64, f64) = (8.0, 14.0);
/// Two ends closer than this (m) are one bridge head.
const TOUCH: f64 = 0.3;
/// Arms kept at a head, the deck included.
const ARMS: usize = 4;
/// Turn (degrees) from the deck axis beyond which a lead is due, the sharpest arm a lead serves, and the turn
/// from which an arm is a street along the bank, which the deck meets in a plain T.
const TURN: f64 = 45.0;
const SHARPEST: f64 = 105.0;
const ALONG: f64 = 75.0;
/// Reach (m) beyond a street's edge within which a block fronts it.
const FRONT: f64 = 3.5;
/// Largest share of a block a lead may take.
const BLOCK_SHARE: f64 = 0.12;

/// A street that ends at a bridge head.
#[derive(Clone, Copy)]
struct Arm {
    street: usize,
    at_end: bool,
    /// Angle (degrees) from the deck axis carried on.
    turn: f64,
    movable: bool,
}

/// An arm's path and widths, from the head outwards.
struct Branch {
    path: Vec<Point>,
    widths: Vec<f64>,
}
impl Branch {
    fn new(s: &Street, at_end: bool) -> Self {
        let mut path = s.path.clone();
        let mut widths: Vec<f64> = (0..path.len()).map(|k| width(s, k)).collect();
        if at_end {
            path.reverse();
            widths.reverse();
        }
        Self { path, widths }
    }
    fn length(&self) -> f64 {
        self.path.windows(2).map(|w| distance(w[0], w[1])).sum()
    }
    /// The part beyond arc length `s`, from its exact point.
    fn beyond(&self, s: f64) -> Self {
        let mut at = 0.0;
        for (k, w) in self.path.windows(2).enumerate() {
            let l = distance(w[0], w[1]);
            if at + l > s {
                let t = (s - at) / l;
                let mut path = vec![lerp(w[0], w[1], t)];
                let mut widths = vec![self.widths[k] + (self.widths[k + 1] - self.widths[k]) * t];
                path.extend(&self.path[k + 1..]);
                widths.extend(&self.widths[k + 1..]);
                return Self { path, widths };
            }
            at += l;
        }
        Self { path: vec![], widths: vec![] }
    }
    fn point(&self, s: f64) -> Option<Point> {
        self.beyond(s).path.first().copied()
    }
    /// The whole branch, with the first point of `tail` (its part beyond arc length `s`) as a vertex.
    fn through(mut self, tail: Self, s: f64) -> Self {
        let mut at = 0.0;
        let mut kept = 1;
        for w in self.path.windows(2) {
            at += distance(w[0], w[1]);
            if at >= s - 1e-6 {
                break;
            }
            kept += 1;
        }
        self.path.truncate(kept);
        self.widths.truncate(kept);
        self.path.extend(tail.path);
        self.widths.extend(tail.widths);
        self
    }
    /// Put `points` before the branch, at its first width.
    fn after(self, points: &[Point]) -> Self {
        let w = self.widths[0];
        Self { path: [points, self.path.as_slice()].concat(), widths: [vec![w; points.len()], self.widths].concat() }
    }
}

/// The rewrite of one bridge head.
struct Rewrite {
    streets: Vec<(Arm, Branch)>,
    blocks: Vec<(usize, Shape)>,
}

pub(in crate::urban) fn bridge_leads(layout: &mut Layout, surface: Surface<'_>, cfg: &LayoutConfig) {
    // A small settlement's grammar lays its own street and lots along the deck.
    if layout.structure.as_ref().is_some_and(|s| s.mechanism == "kind") {
        return;
    }
    let heads: Vec<(usize, Point, Point)> = layout
        .streets
        .iter()
        .enumerate()
        .filter(|(_, s)| s.role == "bridge" && s.path.len() >= 2)
        .flat_map(|(i, s)| {
            let n = s.path.len();
            [(i, s.path[0], s.path[1]), (i, s.path[n - 1], s.path[n - 2])]
        })
        .collect();
    if heads.is_empty() {
        return;
    }
    let reserved: HashSet<usize> = layout.programme.iter().flat_map(|p| &p.reservations).map(|r| r.block).collect();
    for (deck, head, before) in heads {
        if let Some(rewrite) = rewrite(layout, deck, head, before, &reserved, surface, cfg) {
            for (arm, branch) in rewrite.streets {
                let s = &mut layout.streets[arm.street];
                s.path = branch.path;
                s.widths = branch.widths;
                if arm.at_end {
                    s.path.reverse();
                    s.widths.reverse();
                }
            }
            for (block, shape) in rewrite.blocks {
                layout.blocks[block].shape = shape;
            }
        }
    }
}

fn rewrite(layout: &Layout, deck: usize, head: Point, before: Point, reserved: &HashSet<usize>, surface: Surface<'_>, cfg: &LayoutConfig) -> Option<Rewrite> {
    let l = distance(before, head);
    if l < 1.0 {
        return None;
    }
    let axis = Point { x: (head.x - before.x) / l, y: (head.y - before.y) / l };
    let degrees = |p: Point| {
        let ahead = ((p.x - head.x) * axis.x + (p.y - head.y) * axis.y) / distance(p, head).max(1e-9);
        ahead.clamp(-1.0, 1.0).acos().to_degrees()
    };
    // Streets ending at the head, and those passing through it.
    let (mut arms, mut through): (Vec<Arm>, Vec<f64>) = (vec![], vec![]);
    for (i, s) in layout.streets.iter().enumerate() {
        if i == deck || s.path.len() < 2 || !s.path.windows(2).any(|w| g::distance(head, w[0], w[1]).0 < TOUCH) {
            continue;
        }
        let n = s.path.len();
        let (first, last) = (distance(head, s.path[0]) < TOUCH, distance(head, s.path[n - 1]) < TOUCH);
        // Another piece of the crossing carries the deck on.
        if matches!(s.role.as_str(), "bridge" | "ford" | "causeway") || first && last {
            return None;
        }
        if first || last {
            let branch = Branch::new(s, last);
            let ahead = branch.point(10.0).unwrap_or(branch.path[n - 1]);
            let movable = !private(s) && !CROSSINGS.contains(&s.role.as_str()) && !matches!(s.role.as_str(), "regional" | "outbound" | "peripheral");
            arms.push(Arm { street: i, at_end: last, turn: degrees(ahead), movable });
        } else {
            let k = (0..n - 1).min_by(|&a, &b| g::distance(head, s.path[a], s.path[a + 1]).0.total_cmp(&g::distance(head, s.path[b], s.path[b + 1]).0))?;
            let neighbours = [k, k + 1].map(|v| if distance(s.path[v], head) >= TOUCH { s.path[v] } else if v == k { s.path[k.saturating_sub(1)] } else { s.path[(k + 2).min(n - 1)] });
            through.extend(neighbours.map(degrees));
        }
    }
    let total = 1 + arms.len() + through.len();
    let aligned = arms.iter().any(|a| a.turn <= TURN) || through.iter().any(|&t| t <= TURN);
    let crowded = total > ARMS;
    if aligned && !crowded {
        return None;
    }
    // A deck that meets the street along its bank makes a plain T.
    let along = arms.iter().map(|a| a.turn).chain(through.iter().copied()).filter(|&t| t >= ALONG).count();
    if !crowded && (along >= 2 || !through.is_empty()) {
        return None;
    }
    // The town's share of uneven joints keeps some sharp ones.
    if !crowded && Rng::new(&format!("bridge-lead:{:.1},{:.1}", head.x, head.y)).float() < cfg.street_improvisation {
        return None;
    }
    arms.sort_by(|a, b| a.turn.total_cmp(&b.turn).then(a.street.cmp(&b.street)));
    let at = arms.iter().position(|a| a.movable && a.turn <= SHARPEST)?;
    let lead = arms.remove(at);
    // The way that carries the deck on is not a town street: nothing is laid beside it.
    if aligned && lead.turn > TURN {
        return None;
    }
    // The arms that leave the head, save those that make up its four: the streets most along the bank.
    let mut kept = 2 + arms.iter().filter(|a| !a.movable || a.turn > SHARPEST).count() + through.len();
    let mut moved: Vec<Arm> = arms.into_iter().filter(|a| a.movable && a.turn <= SHARPEST).collect();
    while kept < ARMS && moved.last().is_some_and(|a| moved.len() + 2 > ARMS || crowded && a.turn >= ALONG) {
        moved.pop();
        kept += 1;
    }
    let span = (1.2 * width(&layout.streets[deck], 0)).clamp(LEAD.0, LEAD.1);
    [span, LEAD.0].into_iter().find_map(|length| place(layout, deck, head, axis, length, &lead, &moved, reserved, surface, cfg))
}

/// The rewritten arms for a lead of `length`, when every one of them fits.
#[allow(clippy::too_many_arguments)]
fn place(
    layout: &Layout,
    deck: usize,
    head: Point,
    axis: Point,
    length: f64,
    lead: &Arm,
    moved: &[Arm],
    reserved: &HashSet<usize>,
    surface: Surface<'_>,
    cfg: &LayoutConfig,
) -> Option<Rewrite> {
    let rejoin = |a: &Arm| length * if a.turn < 70.0 { 2.2 } else { 3.0 };
    let branch = |a: &Arm| Branch::new(&layout.streets[a.street], a.at_end);
    let own: HashSet<usize> = std::iter::once(deck).chain(std::iter::once(lead.street)).chain(moved.iter().map(|a| a.street)).collect();
    // A street met twice by this head is a loop, not an arm to move.
    if own.len() != moved.len() + 2 {
        return None;
    }
    let straight = lead.turn <= TURN;
    let junction = if straight { branch(lead).point(length)? } else { Point { x: head.x + axis.x * length, y: head.y + axis.y * length } };
    let mut streets: Vec<(Arm, Branch)> = vec![];
    // New stretches: (points, half width, grade limit).
    let mut fresh: Vec<(Vec<Point>, f64, f64)> = vec![];
    // Old stretches given up: no other street may stand on them.
    let mut given: Vec<(Point, Point)> = vec![];
    for (k, a) in std::iter::once(lead).chain(moved).enumerate() {
        let old = branch(a);
        let on_line = k == 0 && straight;
        let reach = if on_line { length } else { rejoin(a) };
        if old.length() < reach + 4.0 {
            return None;
        }
        let tail = old.beyond(reach);
        if on_line {
            // The aligned street keeps its line and gains the junction.
            streets.push((*a, old.through(tail, reach)));
            continue;
        }
        let mut at = 0.0;
        for w in old.path.windows(2) {
            if at >= reach {
                break;
            }
            given.push((w[0], w[1]));
            at += distance(w[0], w[1]);
        }
        let mut points = if k == 0 { vec![head, junction] } else { vec![junction] };
        let (target, half) = (tail.path[0], tail.widths[0] * 0.5);
        let limit = if layout.streets[a.street].rank >= 3 { cfg.max_lane_grade } else { cfg.max_street_grade };
        streets.push((*a, tail.after(&points)));
        points.push(target);
        fresh.push((points, half, limit));
    }
    if fresh.is_empty() {
        return None;
    }
    // Other streets: none stands on a stretch given up nor meets a new one away from the head.
    let others: Vec<(Point, Point, f64)> = layout
        .streets
        .iter()
        .enumerate()
        .filter(|(i, _)| !own.contains(i))
        .flat_map(|(_, s)| s.path.windows(2).enumerate().map(move |(k, w)| (w[0], w[1], width(s, k) * 0.5)))
        .filter(|s| g::distance(head, s.0, s.1).0 < 6.0 * length)
        .collect();
    let on_given = |p: Point| distance(p, head) >= TOUCH && given.iter().any(|&(a, b)| g::distance(p, a, b).0 < 0.2);
    if given.iter().any(|&(a, b)| others.iter().any(|s| g::segment_hit(a, b, s.0, s.1).is_some_and(|(_, p)| distance(p, head) >= TOUCH))) || others.iter().any(|s| on_given(s.0) || on_given(s.1)) {
        return None;
    }
    for (path, half, limit) in &fresh {
        if !routing::path_clear(surface, path, *limit) {
            return None;
        }
        for w in path.windows(2) {
            if layout.enclosures.iter().any(|e| e.path.windows(2).any(|c| g::segment_hit(w[0], w[1], c[0], c[1]).is_some())) {
                return None;
            }
            let clash = others.iter().any(|&(c, d, other)| {
                g::segment_hit(w[0], w[1], c, d).is_some_and(|(_, p)| distance(p, head) >= TOUCH)
                    || w.iter().any(|&p| distance(p, head) >= TOUCH && g::distance(p, c, d).0 < half + other && g::distance(head, c, d).0 >= TOUCH)
            });
            if clash {
                return None;
            }
        }
    }
    let blocks = carved(layout, &fresh, reserved)?;
    // Inside a circuit every lot is built: the lead takes no land and no frontage there.
    let walled = layout.enclosures.iter().any(|e| {
        let ring = Shape { outer: e.path.clone(), holes: vec![] };
        e.path.len() >= 4 && (g::contains(&ring, head) || g::contains(&ring, junction))
    });
    let lined = |&(a, b): &(Point, Point)| {
        let reach = fresh.iter().map(|f| f.1).fold(0.0, f64::max) + FRONT;
        let near = segment_box(a, b, reach);
        layout.blocks.iter().filter(|block| g::boxes_meet(g::bbox(&block.shape), near)).any(|block| {
            let ring = &block.shape.outer;
            g::contains(&block.shape, a)
                || ring.iter().zip(ring.iter().cycle().skip(1)).any(|(&c, &d)| {
                    g::segment_hit(a, b, c, d).is_some() || g::distance(a, c, d).0.min(g::distance(b, c, d).0).min(g::distance(c, a, b).0) <= reach
                })
        })
    };
    if walled && (!blocks.is_empty() || given.iter().any(lined)) {
        return None;
    }
    Some(Rewrite { blocks, streets })
}

/// The blocks less the new ribbons; none when a block would lose its shape or is reserved.
fn carved(layout: &Layout, fresh: &[(Vec<Point>, f64, f64)], reserved: &HashSet<usize>) -> Option<Vec<(usize, Shape)>> {
    let ribbons: Vec<Shape> = fresh.iter().flat_map(|(path, half, _)| g::ribbon(path, &vec![half * 2.0; path.len()])).collect();
    let boxes: Vec<_> = ribbons.iter().map(g::bbox).collect();
    let (x0, y0, x1, y1) = fresh.iter().flat_map(|f| f.0.windows(2).map(|w| segment_box(w[0], w[1], 12.0))).fold(
        (f64::INFINITY, f64::INFINITY, f64::NEG_INFINITY, f64::NEG_INFINITY),
        |a, b| (a.0.min(b.0), a.1.min(b.1), a.2.max(b.2), a.3.max(b.3)),
    );
    let mut out = vec![];
    for (i, block) in layout.blocks.iter().enumerate() {
        if !g::boxes_meet(g::bbox(&block.shape), (x0, y0, x1, y1)) {
            continue;
        }
        let mut pieces = vec![block.shape.clone()];
        for (r, &rb) in ribbons.iter().zip(&boxes) {
            pieces = pieces.into_iter().flat_map(|p| if g::boxes_meet(g::bbox(&p), rb) { g::difference(&p, r) } else { vec![p] }).collect();
        }
        let area = g::area(&block.shape);
        let left = pieces.into_iter().max_by(|a, b| g::area(a).total_cmp(&g::area(b)));
        let lost = area - left.as_ref().map_or(0.0, g::area);
        if lost <= 0.01 {
            continue;
        }
        if block.kind != "block" || reserved.contains(&i) || lost > BLOCK_SHARE * area {
            return None;
        }
        out.push((i, left?));
    }
    Some(out)
}

#[cfg(test)]
mod tests {
    use super::*;

    fn street(points: &[(f64, f64)], role: &str) -> Street {
        Street { path: points.iter().map(|&(x, y)| Point { x, y }).collect(), widths: vec![5.0; points.len()], rank: 2, role: role.into() }
    }
    fn run(streets: Vec<Street>) -> Layout {
        let mut layout: Layout = serde_json::from_value(serde_json::json!({
            "key": "leads", "culture": "bastide", "center": {"x": 128.0, "y": 128.0},
            "streets": [], "quarters": [], "blocks": [], "warnings": []
        }))
        .unwrap();
        layout.streets = streets;
        let (height, water) = (vec![5.0f32; 64 * 64], vec![0u8; 64 * 64]);
        let surface = Surface { geometry: None, width: 256.0, n: 64, height: &height, water: &water, interpolation: Default::default() };
        bridge_leads(&mut layout, surface, &LayoutConfig { street_improvisation: 0.0, ..Default::default() });
        layout
    }

    #[test]
    fn a_street_turning_at_the_deck_first_runs_on_along_it() {
        let layout = run(vec![street(&[(60.0, 100.0), (100.0, 100.0)], "bridge"), street(&[(100.0, 100.0), (120.0, 180.0)], "street")]);
        let path = &layout.streets[1].path;
        assert_eq!((path[0].x, path[0].y), (100.0, 100.0));
        assert!(path[1].x >= 108.0 && (path[1].y - 100.0).abs() < 1e-9, "{path:?}");
        let last = path[path.len() - 1];
        assert_eq!((last.x, last.y), (120.0, 180.0));
    }

    #[test]
    fn a_crowded_head_keeps_four_arms() {
        let layout = run(vec![
            street(&[(60.0, 100.0), (100.0, 100.0)], "bridge"),
            street(&[(100.0, 100.0), (200.0, 100.0)], "street"),
            street(&[(100.0, 100.0), (150.0, 150.0)], "street"),
            street(&[(100.0, 100.0), (150.0, 40.0)], "street"),
            street(&[(100.0, 100.0), (100.0, 180.0)], "quay"),
        ]);
        let at = |p: Point, q: Point| distance(p, q) < TOUCH;
        let head = Point { x: 100.0, y: 100.0 };
        let arms = layout.streets.iter().filter(|s| s.path.iter().any(|&p| at(p, head))).count();
        assert!(arms <= ARMS, "{arms}");
        // The moved streets meet the aligned one at a vertex of its own.
        let joint = layout.streets.iter().skip(2).map(|s| s.path[0]).find(|&p| !at(p, head)).unwrap();
        assert!(layout.streets[1].path.iter().any(|&p| at(p, joint)));
    }
}
