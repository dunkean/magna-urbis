//! Hairpin bends of roads and town streets: a pointed tip becomes a wide bend, a ruler-straight hillside leg bows.
//!
//! A routed switchback is two legs that meet in a point. Its legs stand close together and the ground rises well
//! above the grade limit between them, so no fillet can hold that limit: a bend with a radius is a levelled platform
//! (the cut and the retaining wall the routers already charge for), and it is judged by its dry ground and the slope
//! it can be built on. The bend passes through the old tip, so the trajectory and what joins it there stay.

use magna_urbis_geom::Point;

/// Steepest ground (rise over run) a levelled bend is built on.
pub(crate) const PLATFORM: f64 = 0.5;
/// Reach (m) on each side of a vertex its turn is measured over, and the turn (degrees) that makes a tip.
const REACH: f64 = 12.0;
const TIP: f64 = 100.0;
/// Widest radius (m), and the share of the bend's radius each leg gives to it: wished, and at least.
const WIDEST: f64 = 14.0;
const LEAD: (f64, f64) = (3.5, 2.6);
/// Angle (radians) of one piece of a bend.
const ARC: f64 = 0.32;
/// A straight run of a leg: largest deviation, shortest and longest length, piece and largest bow (m).
const STRAIGHT: f64 = 0.8;
const RUN: (f64, f64) = (50.0, 240.0);
const PIECE: f64 = 8.0;
const BOW: f64 = 9.0;

fn distance(a: Point, b: Point) -> f64 {
    (b.x - a.x).hypot(b.y - a.y)
}
fn lerp(a: Point, b: Point, t: f64) -> Point {
    Point { x: a.x + (b.x - a.x) * t, y: a.y + (b.y - a.y) * t }
}
fn unit(a: Point, b: Point) -> Point {
    let l = distance(a, b).max(1e-9);
    Point { x: (b.x - a.x) / l, y: (b.y - a.y) / l }
}
fn dot(a: Point, b: Point) -> f64 {
    a.x * b.x + a.y * b.y
}
/// Distance of `p` to the segment `a`-`b`.
fn near(p: Point, a: Point, b: Point) -> f64 {
    let l = (b.x - a.x).powi(2) + (b.y - a.y).powi(2);
    let t = if l > 0.0 { (((p.x - a.x) * (b.x - a.x) + (p.y - a.y) * (b.y - a.y)) / l).clamp(0.0, 1.0) } else { 0.0 };
    distance(p, lerp(a, b, t))
}
fn stations(path: &[Point]) -> Vec<f64> {
    let mut out = vec![0.0];
    for w in path.windows(2) {
        out.push(out[out.len() - 1] + distance(w[0], w[1]));
    }
    out
}
fn at(path: &[Point], cum: &[f64], s: f64) -> Point {
    let i = cum.partition_point(|&c| c <= s).clamp(1, path.len() - 1);
    lerp(path[i - 1], path[i], ((s - cum[i - 1]) / (cum[i] - cum[i - 1]).max(1e-9)).clamp(0.0, 1.0))
}
/// Signed difference of two angles, in (-pi, pi].
fn wrap(a: f64) -> f64 {
    a.sin().atan2(a.cos())
}

/// The vertices where a path turns back within `REACH`, apart from one another.
fn tips(path: &[Point], cum: &[f64]) -> Vec<usize> {
    let length = cum[cum.len() - 1];
    let mut turns: Vec<(usize, f64)> = (1..path.len() - 1)
        .filter(|&i| cum[i] >= REACH && length - cum[i] >= REACH)
        .map(|i| {
            let (u, v) = (unit(at(path, cum, cum[i] - REACH), path[i]), unit(path[i], at(path, cum, cum[i] + REACH)));
            (i, dot(u, v).clamp(-1.0, 1.0).acos().to_degrees())
        })
        .filter(|t| t.1 >= TIP)
        .collect();
    turns.sort_by(|a, b| b.1.total_cmp(&a.1).then(a.0.cmp(&b.0)));
    let mut out: Vec<usize> = vec![];
    for (i, _) in turns {
        if out.iter().all(|&j| (cum[i] - cum[j]).abs() > 2.0 * REACH) {
            out.push(i);
        }
    }
    out.sort_unstable();
    out
}

/// The bend of radius `r` at tip `i`, between the points `reach` metres before and after it: each leg swings out to
/// the circle that passes through the tip.
fn bend(path: &[Point], cum: &[f64], i: usize, r: f64, reach: f64) -> Option<Vec<Point>> {
    let tip = path[i];
    let (from, to) = (at(path, cum, cum[i] - reach), at(path, cum, cum[i] + reach));
    let (u, v) = (unit(tip, from), unit(tip, to));
    let l = (u.x + v.x).hypot(u.y + v.y);
    if l < 0.5 {
        return None;
    }
    let inward = Point { x: (u.x + v.x) / l, y: (u.y + v.y) / l };
    let center = Point { x: tip.x + inward.x * r, y: tip.y + inward.y * r };
    let along = dot(u, inward);
    let across = Point { x: u.x - inward.x * along, y: u.y - inward.y * along };
    let q = across.x.hypot(across.y);
    let side = if q > 1e-6 { Point { x: across.x / q, y: across.y / q } } else { Point { x: -inward.y, y: inward.x } };
    // Where the line from `p` touches the circle, on the side of `n`.
    let touch = |p: Point, n: Point| -> Option<Point> {
        let d = distance(center, p);
        if d <= 1.2 * r {
            return None;
        }
        let w = unit(center, p);
        let b = (r / d).acos();
        let turned = [b, -b].map(|b| Point { x: b.cos() * w.x - b.sin() * w.y, y: b.sin() * w.x + b.cos() * w.y });
        let t = if dot(turned[0], n) >= dot(turned[1], n) { turned[0] } else { turned[1] };
        Some(Point { x: center.x + r * t.x, y: center.y + r * t.y })
    };
    let (enter, leave) = (touch(from, side)?, touch(to, Point { x: -side.x, y: -side.y })?);
    let angle = |p: Point| (p.y - center.y).atan2(p.x - center.x);
    let (before, after) = (wrap(angle(tip) - angle(enter)), wrap(angle(leave) - angle(tip)));
    if before * after <= 0.0 {
        return None;
    }
    // From a point of a leg, along its heading, to the circle.
    let lead = |p: Point, heading: Point, t: Point| -> Vec<Point> {
        let (k, end) = (distance(p, t) / 3.0, unit(p, t));
        let (a, b) = (Point { x: p.x + heading.x * k, y: p.y + heading.y * k }, Point { x: t.x - end.x * k, y: t.y - end.y * k });
        (0..5)
            .map(|j| {
                let x = j as f64 / 5.0;
                let y = 1.0 - x;
                let c = [y * y * y, 3.0 * y * y * x, 3.0 * y * x * x, x * x * x];
                Point { x: c[0] * p.x + c[1] * a.x + c[2] * b.x + c[3] * t.x, y: c[0] * p.y + c[1] * a.y + c[2] * b.y + c[3] * t.y }
            })
            .collect()
    };
    let arc = |start: f64, sweep: f64| -> Vec<Point> {
        let n = (sweep.abs() / ARC).ceil().max(2.0) as usize;
        (1..n)
            .map(|k| {
                let a = start + sweep * k as f64 / n as f64;
                Point { x: center.x + r * a.cos(), y: center.y + r * a.sin() }
            })
            .collect()
    };
    let mut out = lead(from, unit(from, at(path, cum, cum[i] - reach + 4.0)), enter);
    out.push(enter);
    out.extend(arc(angle(enter), before));
    out.push(tip);
    out.extend(arc(angle(tip), after));
    out.push(leave);
    out.extend(lead(to, unit(to, at(path, cum, cum[i] + reach - 4.0)), leave).into_iter().rev());
    Some(out)
}

/// A road of `width` with its pointed tips rounded, where a bend fits: `fits` receives the stretch of the path and the
/// bend that replaces it. The path is kept as it is from each of `joints` (arc lengths where other ways meet it) on,
/// save a joint on the tip itself, which stays on the bend. None when nothing changes.
pub(crate) fn round(path: &[Point], width: f64, joints: &[f64], fits: impl Fn(&[Point], &[Point]) -> bool) -> Option<Vec<Point>> {
    if path.len() < 3 {
        return None;
    }
    let cum = stations(path);
    let length = cum[cum.len() - 1];
    let found = tips(path, &cum);
    let big = (1.5 * width).clamp(9.0, WIDEST);
    let mut out: Vec<Point> = vec![];
    let mut from = 0.0;
    let mut changed = false;
    for (k, &i) in found.iter().enumerate() {
        let s = cum[i];
        // Two bends in a row share the leg between them.
        let mut low: f64 = if k == 0 { 0.5 } else { 0.5 * (cum[found[k - 1]] + s) };
        let mut high: f64 = found.get(k + 1).map_or(length - 0.5, |&n| 0.5 * (cum[n] + s));
        for &j in joints {
            if j < s - 0.3 {
                low = low.max(j + 0.5);
            } else if j > s + 0.3 {
                high = high.min(j - 0.5);
            }
        }
        let room = (s - low).min(high - s);
        let bent = [big, 0.8 * big, 0.65 * big, (0.5 * width + 2.0).max(5.0)].into_iter().find_map(|r| {
            let reach = (LEAD.0 * r).min(room);
            if reach < LEAD.1 * r {
                return None;
            }
            // The neck of a wide bend stays open: legs closer than their own width would draw a closed loop.
            let apart = distance(at(path, &cum, s - reach), at(path, &cum, s + reach));
            if apart < 1.2 * width && r > 0.8 * width {
                return None;
            }
            let bend = bend(path, &cum, i, r, reach)?;
            // The bend keeps off the other legs of the same road.
            let apart = 1.5 * width;
            let other = |c: f64| c < s - reach - 2.0 * apart || c > s + reach + 2.0 * apart;
            if cum.windows(2).zip(path.windows(2)).any(|(c, w)| other(c[0]) && other(c[1]) && bend.iter().any(|&q| near(q, w[0], w[1]) < apart)) {
                return None;
            }
            let mut old = vec![bend[0]];
            old.extend(cum.iter().zip(path).filter(|&(&c, _)| c > s - reach && c < s + reach).map(|(_, &p)| p));
            old.push(bend[bend.len() - 1]);
            fits(&old, &bend).then_some((reach, bend))
        });
        if let Some((reach, bend)) = bent {
            out.extend(cum.iter().zip(path).filter(|&(&c, _)| c >= from && c < s - reach - 1e-6).map(|(_, &p)| p));
            out.extend(bend);
            from = s + reach + 1e-6;
            changed = true;
        }
    }
    out.extend(cum.iter().zip(path).filter(|&(&c, _)| c >= from).map(|(_, &p)| p));
    changed.then_some(out)
}

/// A path whose ruler-straight runs across a slope bow gently: to the side that evens their climb. `fits` receives a
/// run and its bowed line. The ends of every run stay.
pub(crate) fn bow(path: &[Point], height: impl Fn(Point) -> f64, fits: impl Fn(&[Point], &[Point]) -> bool) -> Vec<Point> {
    let off = |p: Point, a: Point, b: Point| {
        let u = unit(a, b);
        ((p.x - a.x) * u.y - (p.y - a.y) * u.x).abs()
    };
    let mut out = vec![path[0]];
    let (mut i, mut count) = (0, 0);
    while i + 1 < path.len() {
        let mut j = i + 1;
        while j + 1 < path.len() && distance(path[i], path[j + 1]) <= RUN.1 && distance(path[i], path[j + 1]) > distance(path[i], path[j]) && path[i + 1..=j].iter().all(|&p| off(p, path[i], path[j + 1]) <= STRAIGHT) {
            j += 1;
        }
        let (a, b) = (path[i], path[j]);
        let l = distance(a, b);
        let mut bowed = None;
        if l >= RUN.0 {
            count += 1;
            let u = unit(a, b);
            let moved = |p: Point, d: f64| Point { x: p.x - u.y * d, y: p.y + u.x * d };
            let pieces = (l / PIECE).ceil() as usize;
            let (ha, hb) = (height(a), height(b));
            // Slope across the run, and the shift that would bring each point to an even climb.
            let (mut slope, mut level) = (0.0, 0.0);
            for k in 1..pieces {
                let t = k as f64 / pieces as f64;
                let p = lerp(a, b, t);
                let across = (height(moved(p, 4.0)) - height(moved(p, -4.0))) / 8.0;
                slope += across.abs();
                if across.abs() > 0.02 {
                    level += ((ha + (hb - ha) * t - height(p)) / across).clamp(-BOW, BOW);
                }
            }
            let n = (pieces - 1).max(1) as f64;
            if slope / n >= 0.08 {
                let first = if (level / n).abs() >= 0.3 { level.signum() } else if count % 2 == 0 { 1.0 } else { -1.0 };
                bowed = [(0.05, first), (0.05, -first), (0.03, first), (0.03, -first), (0.015, first)].into_iter().find_map(|(share, side)| {
                    let reach = side * (share * l).min(BOW);
                    let line: Vec<Point> = (0..=pieces)
                        .map(|k| match k {
                            0 => a,
                            k if k == pieces => b,
                            k => {
                                let t = k as f64 / pieces as f64;
                                moved(lerp(a, b, t), reach * (std::f64::consts::PI * t).sin().powi(2))
                            }
                        })
                        .collect();
                    fits(&path[i..=j], &line).then_some(line)
                });
            }
        }
        match bowed {
            Some(line) => out.extend(line.into_iter().skip(1)),
            None => out.extend(&path[i + 1..=j]),
        }
        i = j;
    }
    out
}

/// Whether each segment of a path belongs to a levelled hairpin bend or its leads, where the ground under the
/// centreline says nothing of the grade of the road.
pub(crate) fn bends(path: &[Point]) -> Vec<bool> {
    let cum = stations(path);
    let segments = path.len().saturating_sub(1);
    let mut out = vec![false; segments];
    // A tight vertex: a radius under 18 m.
    let turn = |i: usize| {
        let (a, v, b) = (path[i - 1], path[i], path[i + 1]);
        let angle = wrap((b.y - v.y).atan2(b.x - v.x) - (v.y - a.y).atan2(v.x - a.x));
        (angle.abs() >= 0.2 && 0.5 * (distance(a, v) + distance(v, b)) <= 18.0 * angle.abs()).then_some(angle)
    };
    let mut i = 1;
    while i < segments {
        let Some(first) = turn(i) else {
            i += 1;
            continue;
        };
        let (start, mut total) = (i, 0.0);
        while i < segments && let Some(angle) = turn(i).filter(|a| a * first > 0.0) {
            total += angle.abs();
            i += 1;
        }
        if i - start >= 3 && total >= 1.4 {
            let reach = LEAD.0 * ((cum[i - 1] - cum[start]) / total).min(WIDEST);
            let (low, high) = (cum[start] - reach, cum[i - 1] + reach);
            for k in 0..segments {
                out[k] |= cum[k + 1] >= low && cum[k] <= high;
            }
        }
    }
    out
}

#[cfg(test)]
mod tests {
    use super::*;

    fn points(list: &[(f64, f64)]) -> Vec<Point> {
        list.iter().map(|&(x, y)| Point { x, y }).collect()
    }
    /// Smallest radius of the circle through each vertex and its neighbours.
    fn radius(path: &[Point]) -> f64 {
        path.windows(3)
            .map(|w| {
                let area = ((w[1].x - w[0].x) * (w[2].y - w[0].y) - (w[1].y - w[0].y) * (w[2].x - w[0].x)).abs() * 0.5;
                distance(w[0], w[1]) * distance(w[1], w[2]) * distance(w[0], w[2]) / (4.0 * area).max(1e-9)
            })
            .fold(f64::INFINITY, f64::min)
    }

    #[test]
    fn a_pointed_tip_becomes_a_wide_bend_through_it() {
        let path = points(&[(0.0, 0.0), (50.0, 8.0), (100.0, 16.0), (50.0, 24.0), (0.0, 32.0)]);
        let bent = round(&path, 7.0, &[], |_, _| true).expect("the tip is rounded");
        assert!(radius(&bent) >= 8.0, "{}", radius(&bent));
        assert!(bent.contains(&path[2]), "the bend passes through the tip");
        assert_eq!((bent[0], bent[bent.len() - 1]), (path[0], path[4]));
        assert!(bends(&bent).iter().any(|&b| b) && !bends(&path).iter().any(|&b| b));
        // The last metres before a joint stay: a near one leaves a smaller bend, a closer one none.
        let near = round(&path, 7.0, &[81.0], |_, _| true).expect("a smaller bend");
        assert!(radius(&near) < radius(&bent));
        assert!(round(&path, 7.0, &[97.0], |_, _| true).is_none());
        assert!(round(&path, 7.0, &[], |_, _| false).is_none());
        // A plain corner is no tip.
        assert!(round(&points(&[(0.0, 0.0), (80.0, 0.0), (120.0, 60.0)]), 7.0, &[], |_, _| true).is_none());
    }

    #[test]
    fn a_straight_run_bows_on_a_slope_only() {
        let path = points(&[(0.0, 0.0), (50.0, 0.0), (100.0, 0.0)]);
        assert_eq!(bow(&path, |_| 0.0, |_, _| true), path);
        let bowed = bow(&path, |p| p.y * 0.3, |_, _| true);
        let reach = bowed.iter().map(|p| p.y.abs()).fold(0.0, f64::max);
        assert!((3.0..6.0).contains(&reach), "{reach}");
        assert_eq!((bowed[0], bowed[bowed.len() - 1]), (path[0], path[2]));
        assert_eq!(bow(&path, |p| p.y * 0.3, |_, _| false), path);
    }
}
