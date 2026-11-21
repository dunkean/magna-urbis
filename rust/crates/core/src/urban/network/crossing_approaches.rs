//! Join crossing approaches to nearby streets and serve facing ends with footbridges.

use super::bridge_construction::bridge_water;
use super::spatial::{BoxGrid, EPS, distance, lerp, segment_box};
use super::street::{private, width};
use crate::urban::{Point, Street, Surface, profile::Lap};
use std::collections::BTreeSet;

/// A crossing's bank approach ends where the growth lattice landed, often
/// inside a block. Carry each loose approach on, straight ahead, to the first
/// street it meets (else to the nearest street within `reach`), at street grade,
/// so the crossing joins the network and divides the block it enters.
pub(in crate::urban) fn join_crossings(
    streets: &mut Vec<Street>,
    surface: Surface<'_>,
    max_grade: f64,
    reach: f64,
) {
    use crate::urban::{geometry as g, routing};
    let span = |s: &Street| matches!(s.role.as_str(), "bridge" | "ford" | "causeway");
    let abutments: Vec<Point> = streets
        .iter()
        .filter(|s| span(s))
        .flat_map(|s| [s.path[0], *s.path.last().unwrap()])
        .collect();
    if abutments.is_empty() {
        footbridges(streets, surface, max_grade);
        bridge_water(streets, surface, max_grade);
        return;
    }
    let mut laps = Lap::new("join_crossings");
    snap_to_abutments(streets, surface, max_grade);
    laps.lap("snap");
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
    laps.lap("approaches");
    footbridges(streets, surface, max_grade);
    laps.lap("footbridges");
    bridge_water(streets, surface, max_grade);
}

/// Opposite built banks can need a river bridge as well as a brook footbridge.
const FOOTBRIDGE: f64 = 400.0;
/// Invariant (a brook is crossed where its streets meet it): two streets
/// ending loose on opposite banks of narrow water, each heading for the
/// other a few metres away, are one way the stream cuts, and a footbridge
/// joins them. A brook gets the crossings its streets need: neither a pair
/// of dead ends facing each other across it, nor a crossing within 30 m of
/// another one.
fn footbridges(streets: &mut Vec<Street>, surface: Surface<'_>, max_grade: f64) {
    use crate::urban::{geometry as g, routing};
    let span = |s: &Street| matches!(s.role.as_str(), "bridge" | "ford" | "causeway");
    // Loose ends on dry ground: (street, at its last point, end, heading).
    // Segments by box: only those within half a metre of an end can meet it.
    let segments: Vec<(usize, Point, Point)> = streets
        .iter()
        .enumerate()
        .flat_map(|(j, t)| t.path.windows(2).map(move |w| (j, w[0], w[1])))
        .collect();
    let segment_grid = BoxGrid::new(&segments.iter().map(|&(_, a, b)| segment_box(a, b, 0.0)).collect::<Vec<_>>(), 32.0);
    let mut ends = vec![];
    for (i, s) in streets.iter().enumerate() {
        if span(s) || private(s) || s.path.len() < 2 {
            continue;
        }
        for at_end in [false, true] {
            let n = s.path.len();
            let (o, before) = if at_end {
                (s.path[n - 1], s.path[n - 2])
            } else {
                (s.path[0], s.path[1])
            };
            let l = distance(before, o);
            let loose = !segment_grid.query(o.x - 0.5, o.y - 0.5, o.x + 0.5, o.y + 0.5).into_iter().any(|k| {
                let (j, a, b) = segments[k];
                j != i && g::distance(o, a, b).0 < 0.5
            });
            if l > EPS && loose && !surface.wet(o) {
                let heading = Point {
                    x: (o.x - before.x) / l,
                    y: (o.y - before.y) / l,
                };
                ends.push((i, at_end, o, heading));
            }
        }
    }
    let mut pairs = vec![];
    // The ends by point: only those within `FOOTBRIDGE` pair (in end order).
    let end_grid = BoxGrid::new(&ends.iter().map(|e| (e.2.x, e.2.y, e.2.x, e.2.y)).collect::<Vec<_>>(), 64.0);
    for (x, a) in ends.iter().enumerate() {
        let o = a.2;
        for y in end_grid.query(o.x - FOOTBRIDGE - 1.0, o.y - FOOTBRIDGE - 1.0, o.x + FOOTBRIDGE + 1.0, o.y + FOOTBRIDGE + 1.0) {
            if y <= x {
                continue;
            }
            let b = &ends[y];
            let d = distance(a.2, b.2);
            if a.0 == b.0 || !(1.0..=FOOTBRIDGE).contains(&d) {
                continue;
            }
            let u = Point {
                x: (b.2.x - a.2.x) / d,
                y: (b.2.y - a.2.y) / d,
            };
            // Each street heads for the other (within 60 degrees), water
            // lies between them.
            let facing = a.3.x * u.x + a.3.y * u.y > 0.5 && -(b.3.x * u.x + b.3.y * u.y) > 0.5;
            let wet = (1..20).any(|k| surface.wet(lerp(a.2, b.2, k as f64 / 20.0)));
            if facing && wet && !routing::segment_clear(surface, a.2, b.2, max_grade) {
                pairs.push((d, x, y));
            }
        }
    }
    pairs.sort_by(|p, q| p.0.total_cmp(&q.0).then(p.1.cmp(&q.1)));
    let mut used = BTreeSet::new();
    for (_, x, y) in pairs {
        let (a, b) = (ends[x], ends[y]);
        if used.contains(&x)
            || used.contains(&y)
        {
            continue;
        }
        used.extend([x, y]);
        let end_width = |i: usize, at_end: bool| {
            width(&streets[i], if at_end { streets[i].path.len() - 1 } else { 0 })
        };
        let w = end_width(a.0, a.1).min(end_width(b.0, b.1));
        streets.push(Street {
            path: vec![a.2, b.2],
            widths: vec![w; 2],
            rank: streets[a.0].rank.max(streets[b.0].rank),
            role: "bridge".into(),
        });
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
fn snap_to_abutments(streets: &mut [Street], surface: Surface<'_>, max_grade: f64) {
    use crate::urban::{geometry as g, routing};
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
