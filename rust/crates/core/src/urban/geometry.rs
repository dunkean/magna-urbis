//! Exact polygon operations shared by the two urban stages (coordinates in metres).
use super::{Point, Shape, Surface};
use geo::{Area, BooleanOps, Centroid, Coord, LineString, Polygon};

pub(super) fn signed(r: &[Point]) -> f64 {
    r.iter()
        .zip(r.iter().cycle().skip(1))
        .take(r.len())
        .map(|(a, b)| a.x * b.y - b.x * a.y)
        .sum::<f64>()
        * 0.5
}
pub(super) fn normalized(mut s: Shape) -> Shape {
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
pub(super) fn polygon(s: &Shape) -> Polygon<f64> {
    fn line(r: &[Point]) -> LineString<f64> {
        let mut q: Vec<_> = r.iter().map(|p| Coord { x: p.x, y: p.y }).collect();
        if let Some(p) = q.first().copied() {
            q.push(p);
        }
        LineString(q)
    }
    Polygon::new(line(&s.outer), s.holes.iter().map(|r| line(r)).collect())
}
pub(super) fn shapes(p: geo::MultiPolygon<f64>) -> Vec<Shape> {
    fn ring(l: &LineString<f64>) -> Vec<Point> {
        let mut r: Vec<_> = l.0.iter().map(|p| Point { x: p.x, y: p.y }).collect();
        if r.len() > 1
            && (r[0].x - r[r.len() - 1].x).abs() + (r[0].y - r[r.len() - 1].y).abs() < 1e-8
        {
            r.pop();
        }
        r.dedup_by(|a, b| (a.x - b.x).hypot(a.y - b.y) < 1e-7);
        r
    }
    p.0.into_iter()
        .filter(|p| p.unsigned_area() > 0.01)
        .map(|p| {
            normalized(Shape {
                outer: ring(p.exterior()),
                holes: p.interiors().iter().map(ring).collect(),
            })
        })
        .filter(|p| p.outer.len() >= 3)
        .collect()
}
pub(super) fn area(s: &Shape) -> f64 {
    polygon(s).unsigned_area()
}
pub(super) fn centroid(s: &Shape) -> Point {
    polygon(s)
        .centroid()
        .map(|p| Point { x: p.x(), y: p.y() })
        .unwrap_or(Point { x: 0.0, y: 0.0 })
}
pub(super) fn contains(s: &Shape, p: Point) -> bool {
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
pub(super) fn bbox(s: &Shape) -> (f64, f64, f64, f64) {
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
pub(super) fn intersection(a: &Shape, b: &Shape) -> Vec<Shape> {
    shapes(polygon(a).intersection(&polygon(b)))
}
pub(super) fn difference(a: &Shape, b: &Shape) -> Vec<Shape> {
    shapes(polygon(a).difference(&polygon(b)))
}
pub(super) fn rectangle(x0: f64, y0: f64, x1: f64, y1: f64) -> Shape {
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
pub(super) fn distance(p: Point, a: Point, b: Point) -> (f64, f64, Point) {
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
pub(super) fn segment_hit(a: Point, b: Point, c: Point, d: Point) -> Option<(f64, Point)> {
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
pub(super) fn split(s: &Shape, path: &[Point]) -> Option<(Shape, Shape)> {
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
pub(super) fn ribbon(path: &[Point], widths: &[f64]) -> Vec<Shape> {
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
        ps.push(polygon(&normalized(Shape {
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
        })));
    }
    for (i, p) in path
        .iter()
        .enumerate()
        .take(path.len().saturating_sub(1))
        .skip(1)
    {
        ps.push(polygon(&Shape {
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
        }));
    }
    shapes(geo::algorithm::bool_ops::unary_union(&ps))
}
/// Clip only the site's local raster window; run-length water cells are unioned before subtraction.
pub(super) fn dry_clip(surface: &Surface<'_>, s: &Shape) -> Vec<Shape> {
    let land = intersection(s, &rectangle(0.0, 0.0, surface.width, surface.width));
    if surface.n == 0 || surface.water.is_empty() {
        return land;
    }
    let cell = surface.width / surface.n as f64;
    let (x0, y0, x1, y1) = bbox(s);
    let ix0 = (x0 / cell).floor().max(0.0) as usize;
    let iy0 = (y0 / cell).floor().max(0.0) as usize;
    let ix1 = ((x1 / cell).ceil() as usize).min(surface.n);
    let iy1 = ((y1 / cell).ceil() as usize).min(surface.n);
    let mut wet = vec![];
    for y in iy0..iy1 {
        let mut x = ix0;
        while x < ix1 {
            if surface.water.get(y * surface.n + x).copied().unwrap_or(0) == 0 {
                x += 1;
                continue;
            }
            let a = x;
            while x < ix1 && surface.water[y * surface.n + x] != 0 {
                x += 1
            }
            wet.push(polygon(&rectangle(
                a as f64 * cell,
                y as f64 * cell,
                x as f64 * cell,
                (y + 1) as f64 * cell,
            )));
        }
    }
    if wet.is_empty() {
        return land;
    }
    let water = geo::algorithm::bool_ops::unary_union(&wet);
    land.into_iter()
        .flat_map(|p| shapes(polygon(&p).difference(&water)))
        .collect()
}

#[cfg(test)]
mod tests {
    use super::*;
    #[test]
    fn chord_and_water_preserve_the_partition() {
        let mut shape = rectangle(0.0, 0.0, 100.0, 100.0);
        shape.holes.push(rectangle(65.0, 20.0, 85.0, 40.0).outer);
        let (a, b) = split(
            &shape,
            &[Point { x: 50.0, y: 0.0 }, Point { x: 50.0, y: 100.0 }],
        )
        .unwrap();
        assert!((area(&a) + area(&b) - area(&shape)).abs() < 0.01);
        assert!(intersection(&a, &b).is_empty());
        let heights = vec![0.0; 100];
        let mut water = vec![0; 100];
        for y in 0..10 {
            water[y * 10 + 4] = 1;
        }
        let surface = Surface {
            width: 100.0,
            n: 10,
            height: &heights,
            water: &water,
        };
        let pieces = dry_clip(&surface, &shape);
        assert!((pieces.iter().map(area).sum::<f64>() - 8600.0).abs() < 0.01);
        assert_eq!(pieces.len(), 2);
    }
}
