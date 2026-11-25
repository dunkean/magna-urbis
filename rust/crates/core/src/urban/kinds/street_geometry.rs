//! Road geometry used to lay out small settlements.

use super::*;

pub(super) fn dist(a: Point, b: Point) -> f64 {
    (a.x - b.x).hypot(a.y - b.y)
}
pub(super) fn at(p: Point, d: Point, t: f64) -> Point {
    Point {
        x: p.x + d.x * t,
        y: p.y + d.y * t,
    }
}
pub(super) fn unit(a: Point, b: Point) -> Point {
    let l = dist(a, b).max(1e-9);
    Point {
        x: (b.x - a.x) / l,
        y: (b.y - a.y) / l,
    }
}
pub(super) fn perp(d: Point) -> Point {
    Point { x: -d.y, y: d.x }
}
pub(super) fn arc(path: &[Point]) -> Vec<f64> {
    let mut out = vec![0.0];
    for w in path.windows(2) {
        out.push(out.last().unwrap() + dist(w[0], w[1]));
    }
    out
}
/// Sub-polyline between arc lengths `a` and `b`.
pub(super) fn slice(path: &[Point], a: f64, b: f64) -> Vec<Point> {
    let s = arc(path);
    let total = *s.last().unwrap_or(&0.0);
    let (a, b) = (a.clamp(0.0, total), b.clamp(0.0, total));
    let point = |t: f64| {
        let i = s.partition_point(|&v| v < t).clamp(1, path.len() - 1);
        let run = (s[i] - s[i - 1]).max(1e-9);
        let f = ((t - s[i - 1]) / run).clamp(0.0, 1.0);
        Point {
            x: path[i - 1].x + (path[i].x - path[i - 1].x) * f,
            y: path[i - 1].y + (path[i].y - path[i - 1].y) * f,
        }
    };
    let mut out = vec![point(a)];
    for (i, &v) in s.iter().enumerate() {
        if v > a && v < b {
            out.push(path[i]);
        }
    }
    out.push(point(b));
    out.dedup_by(|p, q| dist(*p, *q) < 1e-6);
    out
}
pub(super) fn point_at(path: &[Point], t: f64) -> (Point, Point) {
    let s = arc(path);
    let i = s.partition_point(|&v| v < t).clamp(1, path.len() - 1);
    let d = unit(path[i - 1], path[i]);
    let p = slice(path, t, t)[0];
    (p, d)
}
pub(super) struct Near {
    pub(super) road: usize,
    pub(super) distance: f64,
    pub(super) point: Point,
    /// Arc length of `point` along the road.
    pub(super) station: f64,
    pub(super) tangent: Point,
}
/// Closest ordinary road (crossing spans excluded) within `reach`.
pub(super) fn nearest(p: Point, roads: &[Street], reach: f64) -> Option<Near> {
    let mut best: Option<Near> = None;
    for (r, road) in roads.iter().enumerate() {
        if matches!(road.role.as_str(), "bridge" | "ford" | "causeway") || road.path.len() < 2 {
            continue;
        }
        let mut s = 0.0;
        for w in road.path.windows(2) {
            let (d, t, q) = g::distance(p, w[0], w[1]);
            let run = dist(w[0], w[1]);
            if d < reach && best.as_ref().is_none_or(|b| d < b.distance) && run > 1e-6 {
                best = Some(Near {
                    road: r,
                    distance: d,
                    point: q,
                    station: s + t * run,
                    tangent: unit(w[0], w[1]),
                });
            }
            s += run;
        }
    }
    best
}
/// Land on one side of a path: between `half` (the street's half width, so the
/// front edge carries an exact frontage contact) and `half + depth`.
///
/// Built one-sided: a quad per segment and a wedge at each interior vertex,
/// all on the requested side, minus the street band. A two-sided band split
/// afterwards would let the round joins (radius `half + depth`) of a vertex
/// near the end of a short slice wrap around the end cap and join both sides.
pub(super) fn side(path: &[Point], half: f64, depth: f64, left: bool) -> Option<Shape> {
    if path.len() < 2 || arc(path).last().copied().unwrap_or(0.0) < 1.0 {
        return None;
    }
    let sign = if left { 1.0 } else { -1.0 };
    let reach = half + depth;
    let normals: Vec<Option<Point>> = path
        .windows(2)
        .map(|w| {
            (dist(w[0], w[1]) > 1e-6).then(|| {
                let n = perp(unit(w[0], w[1]));
                Point {
                    x: n.x * sign,
                    y: n.y * sign,
                }
            })
        })
        .collect();
    // Shapes that only touch along an edge may stay apart in a boolean union:
    // neighbouring quads overlap by 2 cm along the path, and each bend wedge
    // reaches slightly into the two quads beside it.
    let last = path.len() - 2;
    let mut parts = vec![];
    for (i, (w, n)) in path.windows(2).zip(&normals).enumerate() {
        let Some(n) = *n else { continue };
        let d = unit(w[0], w[1]);
        let a = if i == 0 { w[0] } else { at(w[0], d, -0.02) };
        let b = if i == last { w[1] } else { at(w[1], d, 0.02) };
        parts.push(g::normalized(Shape {
            outer: vec![
                at(a, n, half),
                at(b, n, half),
                at(b, n, reach),
                at(a, n, reach),
            ],
            holes: vec![],
        }));
    }
    for (i, n) in normals.iter().enumerate().skip(1) {
        let (Some(n), Some(prev)) = (*n, normals[..i].iter().rev().flatten().next().copied())
        else {
            continue;
        };
        if (prev.x * n.y - prev.y * n.x).abs() < 1e-9 {
            continue;
        }
        let p = path[i];
        let lean = |v: Point, along: Point| unit(Point { x: 0.0, y: 0.0 }, at(v, along, 0.01));
        let back = unit(path[i], path[i - 1]);
        let ahead = unit(path[i], path[i + 1]);
        let mid = unit(
            Point { x: 0.0, y: 0.0 },
            Point {
                x: prev.x + n.x,
                y: prev.y + n.y,
            },
        );
        parts.push(g::normalized(Shape {
            outer: vec![
                p,
                at(p, lean(prev, back), reach),
                at(p, mid, reach),
                at(p, lean(n, ahead), reach),
            ],
            holes: vec![],
        }));
    }
    // The street band runs 1 m past the plot ends.
    let mut long = path.to_vec();
    let m = long.len();
    let (a, b) = (unit(long[1], long[0]), unit(long[m - 2], long[m - 1]));
    long[0] = at(long[0], a, 1.0);
    long[m - 1] = at(long[m - 1], b, 1.0);
    let inner = g::ribbon(&long, &[half * 2.0]);
    let mut pieces = g::union(&parts);
    for i in &inner {
        pieces = pieces.iter().flat_map(|s| g::difference(s, i)).collect();
    }
    pieces.sort_by(|a, b| g::area(b).total_cmp(&g::area(a)));
    pieces.into_iter().next()
}
/// Keep the dry part of a plot clear of other streets; refuse it when less
/// than `keep` of it survives.
pub(super) fn settle(shape: &Shape, obstacles: &[Shape], surface: &Surface<'_>, keep: f64) -> Option<Shape> {
    let planned = g::area(shape);
    let mut pieces = g::dry_clip(surface, shape);
    let (x0, y0, x1, y1) = g::bbox(shape);
    for o in obstacles {
        let (a0, b0, a1, b1) = g::bbox(o);
        if a0 > x1 || a1 < x0 || b0 > y1 || b1 < y0 {
            continue;
        }
        pieces = pieces.iter().flat_map(|s| g::difference(s, o)).collect();
    }
    pieces
        .into_iter()
        .filter(|s| g::area(s) >= planned * keep && g::area(s) > 20.0)
        .max_by(|a, b| g::area(a).total_cmp(&g::area(b)))
}
pub(super) fn street(path: Vec<Point>, width: f64, rank: usize, role: &str) -> Street {
    Street {
        widths: vec![width; path.len()],
        path,
        rank,
        role: role.into(),
    }
}
/// Route a track from `from` to `to` at lane grade; a straight line when no
/// route is found (short connections on flat ground) and that line stays dry.
/// Invariant of the road chain: no connector crosses water outside the costed
/// search. A place the router cannot reach over land (across a bay, a lake, a
/// river without a bridge) gets no track to the road: the result is `to` alone,
/// which callers that add the place's own lane keep as that lane.
pub(super) fn track(surface: Surface<'_>, from: Point, to: Point, grade: f64) -> Vec<Point> {
    let margin = 120.0;
    let mut planner = routing::RoutePlanner::new(
        surface,
        (
            from.x.min(to.x) - margin,
            from.y.min(to.y) - margin,
            from.x.max(to.x) + margin,
            from.y.max(to.y) + margin,
        ),
    );
    planner
        .route(from, to, grade)
        .filter(|p| p.len() >= 2)
        .unwrap_or_else(|| {
            if routing::segment_clear(surface, from, to, f64::INFINITY) {
                vec![from, to]
            } else {
                vec![to]
            }
        })
}
