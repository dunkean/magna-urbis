//! Back lanes through very deep blocks (switch `deepBlockLanes`).
//!
//! A block whose inscribed radius exceeds `DEPTH` keeps a core no lot can reach
//! from a street: houses crowd its rim and the middle stays garden. The pass
//! cuts such a block with an ordinary lane (rank 3) that follows the block's
//! medial line along its long axis and joins the streets at both ends, so the
//! block becomes shallower blocks that each have a street front. Pieces are cut
//! again while still too deep. Lots and houses then follow by the normal stages.
use super::{Block, Layout, Point, Shape, Street, geometry as g};

/// Inscribed radius (m) above which a block is cut (two rows of lots reach 2 x this).
const DEPTH: f64 = 45.0;
/// Farthest a lane end may sit from the street centreline it joins.
const JOIN: f64 = 40.0;
/// Lanes allowed for a block of `area` m2: about one per 2 ha, 4 to 40.
fn budget(area: f64) -> usize {
    ((area / 20_000.0).ceil() as usize).clamp(4, 40)
}
fn debug() -> bool {
    std::env::var("DEEPDBG").is_ok()
}

fn unit(x: f64, y: f64) -> Point {
    let l = x.hypot(y).max(1e-9);
    Point { x: x / l, y: y / l }
}
fn edges(s: &Shape) -> impl Iterator<Item = (Point, Point)> + '_ {
    std::iter::once(&s.outer)
        .chain(s.holes.iter())
        .flat_map(|r| (0..r.len()).map(move |i| (r[i], r[(i + 1) % r.len()])))
}
fn edge_distance(s: &Shape, p: Point) -> f64 {
    edges(s).map(|(a, b)| g::distance(p, a, b).0).fold(f64::MAX, f64::min)
}
/// Distance along `d` from `p` to the first boundary crossing, within `reach`.
fn ray(s: &Shape, p: Point, d: Point, reach: f64) -> Option<f64> {
    let far = Point { x: p.x + d.x * reach, y: p.y + d.y * reach };
    edges(s)
        .filter_map(|(a, b)| g::segment_hit(p, far, a, b).map(|(t, _)| t * reach))
        .min_by(f64::total_cmp)
}
/// Medial walk from `from` along `dir` until the boundary: one half of the lane.
fn walk(s: &Shape, from: Point, dir: Point) -> Option<Vec<Point>> {
    const STEP: f64 = 20.0;
    let mut cur = from;
    let mut d = dir;
    let mut out = vec![];
    for _ in 0..300 {
        let mut next = Point { x: cur.x + d.x * STEP, y: cur.y + d.y * STEP };
        if !g::contains(s, next) || !g::segment_within(s, cur, next) {
            let t = ray(s, cur, d, STEP * 1.5)?;
            out.push(Point { x: cur.x + d.x * t, y: cur.y + d.y * t });
            return Some(out);
        }
        // Stay between the two sides: centre the step across the walk direction.
        let v = Point { x: -d.y, y: d.x };
        if let (Some(a), Some(b)) = (ray(s, next, v, 400.0), ray(s, next, Point { x: -v.x, y: -v.y }, 400.0)) {
            let shift = ((a - b) * 0.5).clamp(-8.0, 8.0);
            let moved = Point { x: next.x + v.x * shift, y: next.y + v.y * shift };
            if g::contains(s, moved) && g::segment_within(s, cur, moved) {
                next = moved;
            }
        }
        let step = unit(next.x - cur.x, next.y - cur.y);
        d = unit(d.x * 0.6 + step.x * 0.4, d.y * 0.6 + step.y * 0.4);
        out.push(next);
        cur = next;
    }
    None
}
fn nearest_street(streets: &[Street], p: Point) -> Option<(f64, Point)> {
    streets
        .iter()
        .filter(|s| !matches!(s.role.as_str(), "bridge" | "causeway" | "approach"))
        .flat_map(|s| s.path.windows(2))
        .map(|w| {
            let (d, _, q) = g::distance(p, w[0], w[1]);
            (d, q)
        })
        .min_by(|a, b| a.0.total_cmp(&b.0))
}
/// Lane path (street centreline to street centreline) and the pieces it leaves.
fn cut(s: &Shape, streets: &[Street], width: f64) -> Option<(Vec<Point>, Vec<Shape>)> {
    let area = g::area(s);
    if area < 4000.0 {
        return None;
    }
    let (x0, y0, x1, y1) = g::bbox(s);
    let grid = (area.sqrt() / 60.0).clamp(4.0, 14.0);
    let mut best = (0.0, Point { x: 0.0, y: 0.0 });
    let (mut n, mut mx, mut my) = (0.0, 0.0, 0.0);
    let mut pts = vec![];
    let mut y = y0 + grid * 0.5;
    while y < y1 {
        let mut x = x0 + grid * 0.5;
        while x < x1 {
            let p = Point { x, y };
            if g::contains(s, p) {
                let r = edge_distance(s, p);
                if r > best.0 {
                    best = (r, p);
                }
                pts.push(p);
                n += 1.0;
                mx += x;
                my += y;
            }
            x += grid;
        }
        y += grid;
    }
    if best.0 <= DEPTH || n < 4.0 {
        return None;
    }
    let (mx, my) = (mx / n, my / n);
    let (mut sxx, mut syy, mut sxy) = (0.0, 0.0, 0.0);
    for p in &pts {
        sxx += (p.x - mx) * (p.x - mx);
        syy += (p.y - my) * (p.y - my);
        sxy += (p.x - mx) * (p.y - my);
    }
    let theta = 0.5 * (2.0 * sxy).atan2(sxx - syy);
    for turn in [0.0, std::f64::consts::FRAC_PI_2, std::f64::consts::FRAC_PI_4, -std::f64::consts::FRAC_PI_4] {
        let a = theta + turn;
        let dir = Point { x: a.cos(), y: a.sin() };
        let (Some(fwd), Some(back)) = (walk(s, best.1, dir), walk(s, best.1, Point { x: -dir.x, y: -dir.y })) else {
            if debug() { eprintln!("DEEP walk-fail area {:.0} R {:.0}", area, best.0); }
            continue;
        };
        let mut inside: Vec<Point> = back.into_iter().rev().collect();
        inside.push(best.1);
        inside.extend(fwd);
        let m = inside.len();
        if m < 3 {
            continue;
        }
        let (first, last) = (inside[0], inside[m - 1]);
        let (Some((da, qa)), Some((db, qb))) = (nearest_street(streets, first), nearest_street(streets, last)) else {
            continue;
        };
        // One joined end is enough: the other end stays a dead end at the block edge
        // (its lots still front the lane); a block bordered by fields has no street there.
        let (join_a, join_b) = (da <= JOIN, db <= JOIN);
        if !(join_a || join_b) || (join_a && join_b && (qa.x - qb.x).hypot(qa.y - qb.y) < 40.0) {
            if debug() { eprintln!("DEEP join-fail area {:.0} R {:.0} ends {:.0} {:.0}", area, best.0, da, db); }
            continue;
        }
        // The corridor reaches a metre past the boundary so no sliver is left.
        let e0 = unit(first.x - inside[1].x, first.y - inside[1].y);
        let e1 = unit(last.x - inside[m - 2].x, last.y - inside[m - 2].y);
        let mut span = inside.clone();
        span[0] = Point { x: first.x + e0.x, y: first.y + e0.y };
        span[m - 1] = Point { x: last.x + e1.x, y: last.y + e1.y };
        let mut pieces = vec![s.clone()];
        for strip in g::ribbon(&span, &vec![width; span.len()]) {
            pieces = pieces.iter().flat_map(|p| g::difference(p, &strip)).collect();
        }
        pieces.retain(|p| g::area(p) > 30.0);
        if pieces.is_empty() || (pieces.len() < 2 && join_a && join_b) {
            if debug() { eprintln!("DEEP pieces-fail area {:.0} R {:.0}", area, best.0); }
            continue;
        }
        let mut path = vec![];
        if join_a { path.push(qa); }
        path.extend(inside);
        if join_b { path.push(qb); }
        return Some((path, pieces));
    }
    None
}

/// Cut every deep `block`; returns the number of lanes added.
pub(super) fn run(layout: &mut Layout) -> usize {
    let mut widths: Vec<f64> = layout
        .streets
        .iter()
        .filter(|s| s.rank == 3 && s.role == "lane")
        .filter_map(|s| s.widths.first().copied())
        .collect();
    widths.sort_by(f64::total_cmp);
    let width = widths.get(widths.len() / 2).copied().unwrap_or(2.5);
    let mut added = 0;
    for bi in 0..layout.blocks.len() {
        if layout.blocks[bi].kind != "block" {
            continue;
        }
        let cap = budget(g::area(&layout.blocks[bi].shape));
        let mut work = vec![layout.blocks[bi].shape.clone()];
        let mut done: Vec<Shape> = vec![];
        let mut lanes = 0;
        while let Some(s) = work.pop() {
            if lanes >= cap {
                if debug() && g::area(&s) > 4000.0 { eprintln!("DEEP budget-hit {:.0}", g::area(&s)); }
                done.push(s);
                continue;
            }
            match cut(&s, &layout.streets, width) {
                Some((path, pieces)) => {
                    lanes += 1;
                    layout.streets.push(Street {
                        widths: vec![width; path.len()],
                        path,
                        rank: 3,
                        role: "lane".into(),
                    });
                    work.extend(pieces);
                }
                None => done.push(s),
            }
        }
        if lanes == 0 {
            continue;
        }
        added += lanes;
        let proto = layout.blocks[bi].clone();
        let mut it = done.into_iter();
        layout.blocks[bi].shape = it.next().expect("a cut block leaves pieces");
        layout.blocks.extend(it.map(|shape| Block { shape, ..proto.clone() }));
    }
    added
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::urban::{LayoutConfig, Quarter};

    fn road(a: (f64, f64), b: (f64, f64)) -> Street {
        Street {
            path: vec![Point { x: a.0, y: a.1 }, Point { x: b.0, y: b.1 }],
            widths: vec![4.0; 2],
            rank: 2,
            role: "street".into(),
        }
    }
    /// A 300 x 160 m block ringed by streets: the pass cuts it with a lane that
    /// joins two streets, and no piece is then deeper than the limit.
    #[test]
    fn deep_block_gets_a_back_lane() {
        let block = g::rectangle(0.0, 0.0, 300.0, 160.0);
        let (l, r, t, b) = (-2.0, 302.0, 162.0, -2.0);
        let mut layout = Layout {
            config: Some(LayoutConfig::default()),
            programme: None,
            key: "t".into(),
            culture: "european-organic".into(),
            center: Point { x: 150.0, y: 80.0 },
            quarters: vec![Quarter { shape: g::rectangle(-50.0, -50.0, 350.0, 210.0), phase: 0, zone: "core".into() }],
            streets: vec![road((l, b), (r, b)), road((r, b), (r, t)), road((r, t), (l, t)), road((l, t), (l, b))],
            blocks: vec![Block { shape: block, quarter: 0, kind: "block".into(), axis: Point { x: 1.0, y: 0.0 }, zone: "core".into(), phase: None }],
            warnings: vec![],
            enclosures: vec![],
            phases: vec![],
            archetype: "district".into(),
            structure: None,
        };
        let before: f64 = layout.blocks.iter().map(|b| g::area(&b.shape)).sum();
        let lanes = run(&mut layout);
        assert!(lanes >= 1, "no lane cut");
        assert!(layout.blocks.len() >= 2);
        let after: f64 = layout.blocks.iter().map(|b| g::area(&b.shape)).sum();
        assert!(after < before && after > before * 0.9, "{before} -> {after}");
        let lane = layout.streets.last().unwrap();
        assert_eq!((lane.rank, lane.role.as_str()), (3, "lane"));
        for end in [lane.path[0], *lane.path.last().unwrap()] {
            assert!(nearest_street(&layout.streets[..4], end).unwrap().0 < 0.5, "lane end off the streets");
        }
        for b in &layout.blocks {
            let (x0, y0, x1, y1) = g::bbox(&b.shape);
            assert!((x1 - x0).min(y1 - y0) <= 2.0 * DEPTH + 1.0, "piece still deep: {x0} {y0} {x1} {y1}");
        }
    }
}
