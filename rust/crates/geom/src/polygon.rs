use crate::{Point, Shape, intersection, union};
use geo::{Centroid, Coord, InteriorPoint, LineString, Polygon};

pub fn signed(r: &[Point]) -> f64 {
    r.iter()
        .zip(r.iter().cycle().skip(1))
        .take(r.len())
        .map(|(a, b)| a.x * b.y - b.x * a.y)
        .sum::<f64>()
        * 0.5
}
pub fn normalized(mut s: Shape) -> Shape {
    if signed(&s.outer) < 0.0 {
        s.outer.reverse();
    }
    for h in &mut s.holes {
        if signed(h) > 0.0 {
            h.reverse();
        }
    }
    s
}
pub fn polygon(s: &Shape) -> Polygon<f64> {
    fn line(r: &[Point]) -> LineString<f64> {
        let mut q: Vec<_> = r.iter().map(|p| Coord { x: p.x, y: p.y }).collect();
        if let Some(p) = q.first().copied() {
            q.push(p);
        }
        LineString(q)
    }
    Polygon::new(line(&s.outer), s.holes.iter().map(|r| line(r)).collect())
}
pub fn area(s: &Shape) -> f64 {
    // geo 0.33.1's exact translated determinant order, without ring allocation.
    fn ring_area(ring: &[Point]) -> f64 {
        if ring.len() < 2 {
            return 0.0;
        }
        let first = ring[0];
        let mut previous = (ring[1].x - first.x, ring[1].y - first.y);
        let mut sum = 0.0;
        for p in ring[2..].iter().chain(std::iter::once(&first)) {
            let next = (p.x - first.x, p.y - first.y);
            sum += previous.0 * next.1 - previous.1 * next.0;
            previous = next;
        }
        sum / 2.0
    }
    s.holes
        .iter()
        .fold(ring_area(&s.outer).abs(), |area, hole| {
            area - ring_area(hole).abs()
        })
        .abs()
}
/// Area-weighted moment of one closed ring, with the exact operations (and
/// their order) of geo 0.33.1's `CentroidOperation::add_ring` on the ring
/// that `polygon` builds (first point repeated at the end): weight, then the
/// centroid times that weight. `None` for the cases geo treats apart (fewer
/// than three points, non-finite coordinates, zero area).
fn ring_moment(ring: &[Point]) -> Option<(f64, f64, f64)> {
    if ring.len() < 3 || ring.iter().any(|p| !p.x.is_finite() || !p.y.is_finite()) {
        return None;
    }
    let first = ring[0];
    let n = ring.len() + 1;
    let at = |i: usize| if i < ring.len() { ring[i] } else { first };
    let mut previous = (at(1).x - first.x, at(1).y - first.y);
    let mut sum = 0.0;
    for i in 2..n {
        let p = at(i);
        let next = (p.x - first.x, p.y - first.y);
        sum += previous.0 * next.1 - previous.1 * next.0;
        previous = next;
    }
    let area = sum / 2.0;
    if area == 0.0 {
        return None;
    }
    let (mut ax, mut ay) = (0.0, 0.0);
    for i in 0..n - 1 {
        let (s, e) = (at(i), at(i + 1));
        let (sx, sy, ex, ey) = (s.x - first.x, s.y - first.y, e.x - first.x, e.y - first.y);
        let tmp = sx * ey - sy * ex;
        ax += (ex + sx) * tmp;
        ay += (ey + sy) * tmp;
    }
    let six_area = 6.0 * area;
    let (cx, cy) = (ax / six_area + first.x, ay / six_area + first.y);
    let weight = area.abs();
    Some((weight, cx * weight, cy * weight))
}
/// geo's polygon centroid (outer ring minus holes) without building the geo
/// polygon; `None` when a ring is degenerate, which `centroid` leaves to geo.
fn centroid_fast(s: &Shape) -> Option<Point> {
    let (weight, x, y) = ring_moment(&s.outer)?;
    if s.holes.is_empty() {
        return Some(Point {
            x: x / weight,
            y: y / weight,
        });
    }
    let mut holes: Option<(f64, f64, f64)> = None;
    for hole in &s.holes {
        let (w, hx, hy) = ring_moment(hole)?;
        holes = Some(match holes {
            None => (w, hx, hy),
            Some((w0, x0, y0)) => (w0 + w, x0 + hx, y0 + hy),
        });
    }
    let (hole_weight, hole_x, hole_y) = holes?;
    let (weight, x, y) = (weight - hole_weight, x - hole_x, y - hole_y);
    if weight == 0.0 {
        return None;
    }
    Some(Point {
        x: x / weight,
        y: y / weight,
    })
}
pub fn centroid(s: &Shape) -> Point {
    if let Some(c) = centroid_fast(s) {
        return c;
    }
    polygon(s)
        .centroid()
        .map(|p| Point { x: p.x(), y: p.y() })
        .unwrap_or(Point { x: 0.0, y: 0.0 })
}
/// Unlike a centroid, this lies in the polygon, including concave domains and holes.
pub fn interior_point(s: &Shape) -> Point {
    let c = centroid(s);
    if contains(s, c) {
        return c;
    }
    polygon(s)
        .interior_point()
        .map(|p| Point { x: p.x(), y: p.y() })
        .unwrap_or(c)
}

/// Check every interval cut by outer and hole boundaries, not just sampled endpoints.
pub fn segment_within(s: &Shape, a: Point, b: Point) -> bool {
    let mut ts = vec![0.0, 1.0];
    for r in std::iter::once(&s.outer).chain(s.holes.iter()) {
        for (&c, &d) in r.iter().zip(r.iter().cycle().skip(1)).take(r.len()) {
            if let Some((t, _)) = segment_hit(a, b, c, d) {
                ts.push(t.clamp(0.0, 1.0));
            }
        }
    }
    ts.sort_by(f64::total_cmp);
    ts.windows(2).all(|w| {
        let t = (w[0] + w[1]) * 0.5;
        contains(
            s,
            Point {
                x: a.x + (b.x - a.x) * t,
                y: a.y + (b.y - a.y) * t,
            },
        )
    })
}
pub fn contains(s: &Shape, p: Point) -> bool {
    // This is the hottest operation during tracing. Avoid allocating a geo
    // polygon and copying every ring for each five-metre integration step.
    fn ring(r: &[Point], p: Point) -> bool {
        let mut inside = false;
        for (&a, &b) in r.iter().zip(r.iter().cycle().skip(1)).take(r.len()) {
            if (a.y > p.y) != (b.y > p.y) && p.x < (b.x - a.x) * (p.y - a.y) / (b.y - a.y) + a.x {
                inside = !inside;
            }
        }
        inside
    }
    ring(&s.outer, p) && !s.holes.iter().any(|h| ring(h, p))
}

pub fn bbox(s: &Shape) -> (f64, f64, f64, f64) {
    s.outer.iter().fold(
        (
            f64::INFINITY,
            f64::INFINITY,
            f64::NEG_INFINITY,
            f64::NEG_INFINITY,
        ),
        |(a, b, c, d), p| (a.min(p.x), b.min(p.y), c.max(p.x), d.max(p.y)),
    )
}
/// The ring without its needle tips: a vertex where the outline turns back
/// within `eps` metres of its own line. Straight continuations stay.
pub fn unneedled(r: &[Point], eps: f64) -> Vec<Point> {
    let mut q: Vec<Point> = r.to_vec();
    let mut changed = true;
    while changed && q.len() > 3 {
        changed = false;
        let mut i = 0;
        while i < q.len() && q.len() > 3 {
            let n = q.len();
            let (a, b, c) = (q[(i + n - 1) % n], q[i], q[(i + 1) % n]);
            let (u, v) = ((b.x - a.x, b.y - a.y), (c.x - b.x, c.y - b.y));
            let back = u.0 * v.0 + u.1 * v.1 < 0.0;
            if u.0.hypot(u.1) < 1e-9
                || back && (u.0 * v.1 - u.1 * v.0).abs() <= eps * u.0.hypot(u.1).max(v.0.hypot(v.1))
            {
                q.remove(i);
                changed = true;
            } else {
                i += 1;
            }
        }
    }
    q
}
pub fn rectangle(x0: f64, y0: f64, x1: f64, y1: f64) -> Shape {
    Shape {
        outer: vec![
            Point { x: x0, y: y0 },
            Point { x: x1, y: y0 },
            Point { x: x1, y: y1 },
            Point { x: x0, y: y1 },
        ],
        holes: vec![],
    }
}
pub fn distance(p: Point, a: Point, b: Point) -> (f64, f64, Point) {
    let dx = b.x - a.x;
    let dy = b.y - a.y;
    let t =
        (((p.x - a.x) * dx + (p.y - a.y) * dy) / (dx * dx + dy * dy).max(1e-15)).clamp(0.0, 1.0);
    let q = Point {
        x: a.x + t * dx,
        y: a.y + t * dy,
    };
    ((p.x - q.x).hypot(p.y - q.y), t, q)
}
/// Douglas-Peucker simplification of an open polyline. Both ends and every
/// vertex for which `keep` holds (shared junctions) are retained exactly, so the
/// simplified line still meets its neighbours at the same points.
pub fn simplify(path: &[Point], tolerance: f64, keep: impl Fn(Point) -> bool) -> Vec<Point> {
    if path.len() <= 2 || tolerance <= 0.0 {
        return path.to_vec();
    }
    let mut retained = vec![false; path.len()];
    retained[0] = true;
    retained[path.len() - 1] = true;
    for (i, &p) in path.iter().enumerate() {
        if keep(p) {
            retained[i] = true;
        }
    }
    let anchors: Vec<usize> = (0..path.len()).filter(|&i| retained[i]).collect();
    let mut stack: Vec<(usize, usize)> = anchors.windows(2).map(|w| (w[0], w[1])).collect();
    while let Some((a, b)) = stack.pop() {
        if b <= a + 1 {
            continue;
        }
        let (mut worst, mut at) = (0.0, a);
        for (i, &p) in path.iter().enumerate().take(b).skip(a + 1) {
            let d = distance(p, path[a], path[b]).0;
            if d > worst {
                worst = d;
                at = i;
            }
        }
        if worst > tolerance {
            retained[at] = true;
            stack.push((a, at));
            stack.push((at, b));
        }
    }
    path.iter()
        .zip(retained)
        .filter_map(|(&p, r)| r.then_some(p))
        .collect()
}
/// Whether two sides touch or cross (1e-9 tolerance).
fn sides_touch(a: Point, b: Point, c: Point, d: Point) -> bool {
    fn cross(o: Point, a: Point, b: Point) -> f64 {
        (a.x - o.x) * (b.y - o.y) - (a.y - o.y) * (b.x - o.x)
    }
    let eps = 1e-9;
    let (d1, d2) = (cross(c, d, a), cross(c, d, b));
    let (d3, d4) = (cross(a, b, c), cross(a, b, d));
    if ((d1 > eps && d2 < -eps) || (d1 < -eps && d2 > eps))
        && ((d3 > eps && d4 < -eps) || (d3 < -eps && d4 > eps))
    {
        return true;
    }
    let on = |p: Point, q: Point, r: Point, v: f64| {
        v.abs() <= eps
            && r.x >= p.x.min(q.x) - eps
            && r.x <= p.x.max(q.x) + eps
            && r.y >= p.y.min(q.y) - eps
            && r.y <= p.y.max(q.y) + eps
    };
    on(c, d, a, d1) || on(c, d, b, d2) || on(a, b, c, d3) || on(a, b, d, d4)
}
/// Whether every ring of `s` is simple: no two non-adjacent sides touch or
/// cross. Boolean operations need simple input (a folded ring, such as a
/// sliver whose vertices were snapped back over each other, can abort the
/// overlay solver). Quadratic in the ring size, which is a lot's, not a city's.
pub fn simple(s: &Shape) -> bool {
    let touch = sides_touch;
    std::iter::once(&s.outer).chain(&s.holes).all(|r| {
        let n = r.len();
        if n < 3 {
            return false;
        }
        (0..n).all(|i| {
            let (a, b) = (r[i], r[(i + 1) % n]);
            (i + 2..n).all(|j| {
                if i == 0 && j == n - 1 {
                    return true;
                }
                !touch(a, b, r[j], r[(j + 1) % n])
            })
        })
    })
}
/// `simple` for a ring that is simple apart from the sides listed in `fresh`
/// (side `i` runs from `r[i]` to `r[i + 1]`): only those sides are tested,
/// against every other side, with the same rule. Linear per fresh side.
/// `simple_around`, telling why not: `Ok` when simple, `Err(Some(j))` with
/// the first side `j` a fresh side touches, `Err(None)` for a degenerate ring.
pub fn touching_side(r: &[Point], fresh: &[usize]) -> Result<(), Option<usize>> {
    let n = r.len();
    if n < 3 {
        return Err(None);
    }
    for &i in fresh {
        let (a, b) = (r[i], r[(i + 1) % n]);
        if let Some(j) = (0..n).find(|&j| {
            !(j == i
                || (j + 1) % n == i
                || (i + 1) % n == j
                || !sides_touch(a, b, r[j], r[(j + 1) % n]))
        }) {
            return Err(Some(j));
        }
    }
    Ok(())
}
pub fn simple_around(r: &[Point], fresh: &[usize]) -> bool {
    let n = r.len();
    if n < 3 {
        return false;
    }
    fresh.iter().all(|&i| {
        let (a, b) = (r[i], r[(i + 1) % n]);
        (0..n).all(|j| {
            j == i
                || (j + 1) % n == i
                || (i + 1) % n == j
                || !sides_touch(a, b, r[j], r[(j + 1) % n])
        })
    })
}
pub fn segment_hit(a: Point, b: Point, c: Point, d: Point) -> Option<(f64, Point)> {
    let ux = b.x - a.x;
    let uy = b.y - a.y;
    let vx = d.x - c.x;
    let vy = d.y - c.y;
    let z = ux * vy - uy * vx;
    if z.abs() < 1e-9 {
        return None;
    }
    let t = ((c.x - a.x) * vy - (c.y - a.y) * vx) / z;
    let u = ((c.x - a.x) * uy - (c.y - a.y) * ux) / z;
    if t > 1e-7 && t <= 1.0 + 1e-8 && (-1e-8..=1.0 + 1e-8).contains(&u) {
        Some((
            t,
            Point {
                x: a.x + t * ux,
                y: a.y + t * uy,
            },
        ))
    } else {
        None
    }
}
/// Split an outer ring by a simple boundary-to-boundary chord, distributing holes exactly.
pub fn split(s: &Shape, path: &[Point]) -> Option<(Shape, Shape)> {
    if path.len() < 2 {
        return None;
    }
    let n = s.outer.len();
    let locate = |p: Point| {
        (0..n)
            .map(|i| {
                let (d, t, q) = distance(p, s.outer[i], s.outer[(i + 1) % n]);
                (i, d, t, q)
            })
            .min_by(|a, b| a.1.total_cmp(&b.1))
    };
    let (i, di, _, a) = locate(path[0])?;
    let (j, dj, _, b) = locate(*path.last()?)?;
    if di > 0.1 || dj > 0.1 || i == j {
        return None;
    }
    let mut chord = path.to_vec();
    chord[0] = a;
    *chord.last_mut()? = b;
    let boundary = |from: usize, to: usize, start: Point, end: Point| {
        let mut r = vec![start];
        let mut k = (from + 1) % n;
        for _ in 0..n {
            r.push(s.outer[k]);
            if k == to {
                break;
            }
            k = (k + 1) % n;
        }
        r.push(end);
        r
    };
    let mut ra = boundary(i, j, a, b);
    ra.extend(chord.iter().rev().skip(1).copied());
    let mut rb = boundary(j, i, b, a);
    rb.extend(chord.iter().skip(1).copied());
    let aa = Shape {
        outer: ra,
        holes: vec![],
    };
    let bb = Shape {
        outer: rb,
        holes: vec![],
    };
    let mut pa = intersection(s, &aa);
    let mut pb = intersection(s, &bb);
    if pa.len() != 1 || pb.len() != 1 {
        return None;
    }
    let a = pa.pop()?;
    let b = pb.pop()?;
    if (area(&a) + area(&b) - area(s)).abs() > area(s) * 1e-5 + 0.01 {
        return None;
    }
    Some((a, b))
}
/// Variable-width segment trapezoids and round interior joins, flat endpoint caps.
pub fn ribbon(path: &[Point], widths: &[f64]) -> Vec<Shape> {
    let mut ps = vec![];
    let w = |i: usize| {
        widths
            .get(i)
            .copied()
            .or_else(|| widths.first().copied())
            .unwrap_or(4.0)
            * 0.5
    };
    for (i, q) in path.windows(2).enumerate() {
        let a = q[0];
        let b = q[1];
        let l = (b.x - a.x).hypot(b.y - a.y);
        if l < 1e-7 {
            continue;
        }
        let nx = -(b.y - a.y) / l;
        let ny = (b.x - a.x) / l;
        ps.push(normalized(Shape {
            outer: vec![
                Point {
                    x: a.x + nx * w(i),
                    y: a.y + ny * w(i),
                },
                Point {
                    x: a.x - nx * w(i),
                    y: a.y - ny * w(i),
                },
                Point {
                    x: b.x - nx * w(i + 1),
                    y: b.y - ny * w(i + 1),
                },
                Point {
                    x: b.x + nx * w(i + 1),
                    y: b.y + ny * w(i + 1),
                },
            ],
            holes: vec![],
        }));
    }
    for (i, p) in path
        .iter()
        .enumerate()
        .take(path.len().saturating_sub(1))
        .skip(1)
    {
        ps.push(Shape {
            outer: (0..12)
                .map(|k| {
                    let a = k as f64 * std::f64::consts::TAU / 12.0;
                    Point {
                        x: p.x + w(i) * a.cos(),
                        y: p.y + w(i) * a.sin(),
                    }
                })
                .collect(),
            holes: vec![],
        });
    }
    union(&ps)
}

#[cfg(test)]
mod tests {
    use super::*;
    use geo::Area;

    #[test]
    fn chord_preserves_the_partition() {
        let mut shape = rectangle(0.0, 0.0, 100.0, 100.0);
        shape.holes.push(rectangle(65.0, 20.0, 85.0, 40.0).outer);
        let (a, b) = split(
            &shape,
            &[Point { x: 50.0, y: 0.0 }, Point { x: 50.0, y: 100.0 }],
        )
        .unwrap();
        assert!((area(&a) + area(&b) - area(&shape)).abs() < 0.01);
        assert!(intersection(&a, &b).is_empty());
    }

    #[test]
    fn borrowed_area_matches_geo_bits_for_open_closed_degenerate_and_holed_rings() {
        for offset in [0.0, -0.0, 1234.567, 1e9] {
            for count in 0..32 {
                let mut shape = Shape {
                    outer: (0..count)
                        .map(|i| {
                            let angle = i as f64 * std::f64::consts::TAU / count as f64;
                            Point {
                                x: offset + 17.13 * angle.cos(),
                                y: -offset + 11.77 * angle.sin(),
                            }
                        })
                        .collect(),
                    holes: vec![],
                };
                if count >= 3 {
                    shape.holes = vec![
                        rectangle(offset - 1.23, -offset - 2.31, offset + 1.23, -offset + 2.31)
                            .outer,
                    ];
                }
                for closed in [false, true] {
                    if closed && let Some(first) = shape.outer.first().copied() {
                        shape.outer.push(first);
                    }
                    for reversed in [false, true] {
                        if reversed {
                            shape.outer.reverse();
                        }
                        assert_eq!(
                            area(&shape).to_bits(),
                            polygon(&shape).unsigned_area().to_bits(),
                            "offset {offset}, count {count}"
                        );
                    }
                }
            }
        }
    }
}
