//! Connections from existing roads to the planned grid.

use super::*;

pub(super) fn chord(s: &Shape, c: Point, angle: f64) -> Option<(Point, Point)> {
    let d = Point {
        x: angle.cos() * 100000.0,
        y: angle.sin() * 100000.0,
    };
    let a = Point {
        x: c.x - d.x,
        y: c.y - d.y,
    };
    let b = Point {
        x: c.x + d.x,
        y: c.y + d.y,
    };
    let mut hits: Vec<_> = s
        .outer
        .iter()
        .zip(s.outer.iter().cycle().skip(1))
        .take(s.outer.len())
        .filter_map(|(&p, &q)| g::segment_hit(a, b, p, q))
        .collect();
    hits.sort_by(|a, b| a.0.total_cmp(&b.0));
    hits.dedup_by(|a, b| dist(a.1, b.1) < 0.01);
    hits.windows(2)
        .filter(|w| g::contains(s, point(w[0].1, w[1].1, 0.5)))
        .max_by(|a, b| dist(a[0].1, a[1].1).total_cmp(&dist(b[0].1, b[1].1)))
        .map(|w| (w[0].1, w[1].1))
}
pub(super) fn inside_path(s: &Shape, path: &[Point]) -> bool {
    path.windows(2).all(|w| {
        let n = (dist(w[0], w[1]) / 5.0).ceil().max(1.0) as usize;
        (0..n).all(|i| g::contains(s, point(w[0], w[1], (i as f64 + 0.5) / n as f64)))
    })
}
/// Invariant of a planned cardinal grid: an imported regional road runs from
/// the town edge to the centre along the lattice axes. Its diagonal run would
/// cut every ward and lane on its own bearing (triangular blocks, knots of
/// wide streets at the centre); it becomes an elbow on the two axes instead,
/// the last leg on the axis through the centre, shared by approaches arriving
/// on the same side. The edge point is kept, so the road outside stays
/// connected. A leg too steep to run straight is routed within the grade
/// near its axis; an elbow that cannot be drawn keeps the original road.
#[allow(clippy::too_many_arguments)]
pub(super) fn lattice_approaches(
    streets: &mut [Street],
    dry: &[Shape],
    envelope: &Shape,
    planner: &mut routing::RoutePlanner<'_>,
    c: Point,
    angle: f64,
    radius: f64,
    surface: Surface<'_>,
    cfg: &LayoutConfig,
) {
    let Some(land) = dry.iter().find(|s| g::contains(s, c)) else {
        return;
    };
    let axes = [
        Point {
            x: angle.cos(),
            y: angle.sin(),
        },
        Point {
            x: -angle.sin(),
            y: angle.cos(),
        },
    ];
    let dot = |a: Point, b: Point| a.x * b.x + a.y * b.y;
    // Last legs already drawn: (axis, side) -> farthest corner from the centre.
    let mut legs: Vec<(usize, bool, Point)> = vec![];
    for st in streets.iter_mut().filter(|s| s.role == "regional") {
        let (Some(&first), Some(&last)) = (st.path.first(), st.path.last()) else {
            continue;
        };
        let (edge, inner) = if dist(first, c) >= dist(last, c) {
            (first, last)
        } else {
            (last, first)
        };
        // Only a run that ends at the centre; a road passing by is a corridor.
        if dist(inner, c) > (radius * 0.05).max(6.0) || dist(edge, inner) < radius * 0.2 {
            continue;
        }
        let d = Point {
            x: edge.x - inner.x,
            y: edge.y - inner.y,
        };
        // First leg (from the edge) on the axis closest to the approach, else
        // on the other one; the last leg runs on the axis through the centre.
        let best = usize::from(dot(d, axes[1]).abs() > dot(d, axes[0]).abs());
        let mut chosen = None;
        for iu in [best, 1 - best] {
            let v = axes[1 - iu];
            let corner = Point {
                x: inner.x + v.x * dot(d, v),
                y: inner.y + v.y * dot(d, v),
            };
            if dist(corner, inner) < 1.0 || dist(corner, edge) < 1.0 {
                break;
            }
            let side = dot(d, v) > 0.0;
            // Join the leg already on this side (extended when this corner is
            // farther), so two approaches never run on top of each other.
            let shared = legs.iter().position(|l| l.0 == 1 - iu && l.1 == side);
            let mut path = vec![edge, corner];
            match shared {
                Some(i) if dist(legs[i].2, inner) >= dist(corner, inner) => {}
                Some(i) => path.push(legs[i].2),
                None => path.push(inner),
            }
            // A leg too steep to run straight is routed within the street
            // grade, as long as it stays close to its axis.
            let mut legged = vec![path[0]];
            for w in path.windows(2) {
                let leg = if routing::path_clear(surface, w, cfg.max_street_grade) {
                    Some(w.to_vec())
                } else {
                    planner
                        .route_within(w[0], w[1], cfg.max_street_grade, envelope)
                        .filter(|r| {
                            r.windows(2).map(|q| dist(q[0], q[1])).sum::<f64>()
                                < 1.3 * dist(w[0], w[1])
                        })
                };
                match leg {
                    Some(leg) => legged.extend(leg.into_iter().skip(1)),
                    None => {
                        legged.clear();
                        break;
                    }
                }
            }
            let path = legged;
            if path.len() >= 2 && inside_path(land, &path) && simple_path(&path, false) {
                match shared {
                    Some(i) => {
                        if dist(legs[i].2, inner) < dist(corner, inner) {
                            legs[i].2 = corner
                        }
                    }
                    None => legs.push((1 - iu, side, corner)),
                }
                chosen = Some(path);
                break;
            }
        }
        let Some(mut path) = chosen else {
            continue;
        };
        if first != edge {
            path.reverse();
        }
        let width = st.widths.iter().copied().fold(0.0_f64, f64::max).max(2.0);
        st.widths = vec![width; path.len()];
        st.path = path;
    }
}
