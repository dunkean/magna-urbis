//! Homes on sloping lots (`building_sites`): the ground drop across a home,
//! measured where the display seats it; when the culture's way of building
//! cannot take it (`massing::hillside`), the home is turned on its lot so its
//! long side follows the contour, keeping a face on its street or lane, else
//! made shallower across the slope down to the depth a home keeps. A lot on
//! which nothing brings the drop under the limit keeps its home with the
//! smallest drop found: a home is never removed for its slope.
use super::super::{Point, Shape, Surface, geometry, massing};
use serde_json::{Value, json};

/// Ground samples on a ring's interior grid: about one every 2 m, at most 8 × 8.
const GRID_STEP_M: f64 = 2.0;
const GRID_MAX: usize = 8;
/// A turn is kept only when it lowers the drop by at least this (m).
const GAIN_M: f64 = 0.25;
/// A turned home may stand this much farther from its street than before (m).
const FRONT_SLACK_M: f64 = 1.0;
/// Slides of a turned home along its street (m), in the order they are tried.
const SLIDES_M: [f64; 13] = [0.0, 1.0, -1.0, 2.0, -2.0, 3.0, -3.0, 5.0, -5.0, 8.0, -8.0, 12.0, -12.0];

fn dot(a: Point, b: Point) -> f64 {
    a.x * b.x + a.y * b.y
}
fn sub(a: Point, b: Point) -> Point {
    Point { x: a.x - b.x, y: a.y - b.y }
}
fn unit(v: Point) -> Option<Point> {
    let l = v.x.hypot(v.y);
    (l > 1e-9).then(|| Point { x: v.x / l, y: v.y / l })
}

/// Even/odd containment in one ring (`geometry::contains` without a shape).
fn in_ring(r: &[Point], p: Point) -> bool {
    let mut inside = false;
    for i in 0..r.len() {
        let (a, b) = (r[i], r[(i + 1) % r.len()]);
        if (a.y > p.y) != (b.y > p.y) && p.x < (b.x - a.x) * (p.y - a.y) / (b.y - a.y) + a.x {
            inside = !inside;
        }
    }
    inside
}

/// Lowest and highest ground under a ring: its corners and, when the ground is
/// uneven or the ring large, an interior grid (the display's sampling).
pub(super) fn ground_span(surface: Surface<'_>, ring: &[Point]) -> (f64, f64) {
    let (mut low, mut high) = (f64::INFINITY, f64::NEG_INFINITY);
    let (mut x0, mut y0, mut x1, mut y1) = (f64::MAX, f64::MAX, f64::MIN, f64::MIN);
    for &p in ring {
        let h = surface.height_at(p);
        (low, high) = (low.min(h), high.max(h));
        (x0, y0, x1, y1) = (x0.min(p.x), y0.min(p.y), x1.max(p.x), y1.max(p.y));
    }
    if ring.len() >= 3 && (high - low > 0.5 || (x1 - x0).max(y1 - y0) > 12.0) {
        let count = |span: f64| ((span / GRID_STEP_M).ceil() as usize).clamp(1, GRID_MAX);
        let (nx, ny) = (count(x1 - x0), count(y1 - y0));
        for j in 0..=ny {
            for i in 0..=nx {
                let p = Point { x: x0 + (x1 - x0) * i as f64 / nx as f64, y: y0 + (y1 - y0) * j as f64 / ny as f64 };
                if in_ring(ring, p) {
                    let h = surface.height_at(p);
                    (low, high) = (low.min(h), high.max(h));
                }
            }
        }
    }
    (low, high)
}

/// Ground drop across a group of rings (one seat for the whole home).
fn drop_of(surface: Surface<'_>, rings: &[Vec<Point>]) -> f64 {
    let (mut low, mut high) = (f64::INFINITY, f64::NEG_INFINITY);
    for r in rings {
        let (l, h) = ground_span(surface, r);
        (low, high) = (low.min(l), high.max(h));
    }
    if high >= low { high - low } else { 0.0 }
}

/// Uphill direction (not normalised) of the ground at `p`, by central
/// differences `delta` m apart.
pub(super) fn uphill(surface: Surface<'_>, p: Point, delta: f64) -> Point {
    let h = |dx: f64, dy: f64| surface.height_at(Point { x: p.x + dx, y: p.y + dy });
    Point { x: (h(delta, 0.0) - h(-delta, 0.0)) / (2.0 * delta), y: (h(0.0, delta) - h(0.0, -delta)) / (2.0 * delta) }
}

fn segment_distance(p: Point, a: Point, b: Point) -> f64 {
    let ab = sub(b, a);
    let l = dot(ab, ab);
    let t = if l > 1e-12 { (dot(sub(p, a), ab) / l).clamp(0.0, 1.0) } else { 0.0 };
    (p.x - a.x - ab.x * t).hypot(p.y - a.y - ab.y * t)
}

/// Gap between a group of rings and a front segment (vertex to edge, both ways).
fn front_gap(rings: &[Vec<Point>], f: [Point; 2]) -> f64 {
    let mut gap = f64::INFINITY;
    for r in rings {
        for (i, &p) in r.iter().enumerate() {
            let q = r[(i + 1) % r.len()];
            gap = gap.min(segment_distance(p, f[0], f[1])).min(segment_distance(f[0], p, q)).min(segment_distance(f[1], p, q));
        }
    }
    gap
}

fn crosses(a: Point, b: Point, c: Point, d: Point) -> bool {
    let side = |p: Point, q: Point, r: Point| (q.x - p.x) * (r.y - p.y) - (q.y - p.y) * (r.x - p.x);
    let (d1, d2) = (side(c, d, a), side(c, d, b));
    let (d3, d4) = (side(a, b, c), side(a, b, d));
    d1 * d2 < -1e-9 && d3 * d4 < -1e-9
}

/// A ring's vertices pulled 5 cm towards its centre: boundary contacts (a
/// house on its lot line, two parts sharing a wall) do not count as crossings.
fn pulled(r: &[Point]) -> Vec<Point> {
    let n = r.len().max(1) as f64;
    let c = Point { x: r.iter().map(|p| p.x).sum::<f64>() / n, y: r.iter().map(|p| p.y).sum::<f64>() / n };
    r.iter()
        .map(|&p| match unit(sub(c, p)) {
            Some(u) => Point { x: p.x + u.x * 0.05, y: p.y + u.y * 0.05 },
            None => p,
        })
        .collect()
}

/// Whether two rings overlap beyond a shared boundary.
fn overlap(a: &[Point], b: &[Point]) -> bool {
    let (pa, pb) = (pulled(a), pulled(b));
    pa.iter().any(|&p| in_ring(b, p))
        || pb.iter().any(|&p| in_ring(a, p))
        || (0..pa.len()).any(|i| (0..pb.len()).any(|j| crosses(pa[i], pa[(i + 1) % pa.len()], pb[j], pb[(j + 1) % pb.len()])))
}

/// Whether a ring stands inside the lot (holes included).
fn within(lot: &Shape, r: &[Point]) -> bool {
    let p = pulled(r);
    let mids = (0..p.len()).map(|i| Point { x: (p[i].x + p[(i + 1) % p.len()].x) / 2.0, y: (p[i].y + p[(i + 1) % p.len()].y) / 2.0 });
    p.iter().copied().chain(mids).all(|q| geometry::contains(lot, q))
        && !std::iter::once(&lot.outer).chain(&lot.holes).flatten().any(|&v| in_ring(&p, v))
        && std::iter::once(&lot.outer).chain(&lot.holes).all(|ring| {
            (0..ring.len()).all(|i| (0..p.len()).all(|j| !crosses(ring[i], ring[(i + 1) % ring.len()], p[j], p[(j + 1) % p.len()])))
        })
}

fn rotate(r: &[Point], c: Point, (cos, sin): (f64, f64), shift: Point) -> Vec<Point> {
    r.iter()
        .map(|p| {
            let (dx, dy) = (p.x - c.x, p.y - c.y);
            Point { x: c.x + dx * cos - dy * sin + shift.x, y: c.y + dx * sin + dy * cos + shift.y }
        })
        .collect()
}

/// Unit direction of a ring's longest edge.
fn long_axis(r: &[Point]) -> Option<Point> {
    (0..r.len())
        .map(|i| sub(r[(i + 1) % r.len()], r[i]))
        .max_by(|a, b| a.x.hypot(a.y).total_cmp(&b.x.hypot(b.y)))
        .and_then(unit)
}

/// What a home on a slope became (`programme.hillside`).
#[derive(Debug, Default, PartialEq)]
pub(super) struct Settled {
    /// Drop (m) across the home as first placed, and after.
    pub before_m: f64,
    pub after_m: f64,
    /// Turn (degrees) applied on its lot; 0: not turned.
    pub turned_deg: f64,
    /// Depth (m) taken off across the slope; 0: not shallowed.
    pub shallowed_m: f64,
}
impl Settled {
    pub(super) fn json(&self) -> Value {
        let r = |v: f64| (v * 100.0).round() / 100.0;
        json!({"drop_m": r(self.before_m), "after_m": r(self.after_m), "turned_deg": r(self.turned_deg), "shallowed_m": r(self.shallowed_m)})
    }
}

/// Turns or shallows the home parts (`is_house` labels) of a lot whose ground
/// drops more than `limit` across them; the other parts stay and are never
/// overlapped. `fronts`: the lot's access segments (the home keeps a face on
/// one of them); `min_depth`: the shallowest home. None: nothing to do (no
/// home, a court home, or a drop the way takes).
#[allow(clippy::too_many_arguments)]
pub(super) fn settle(
    parts: &mut Vec<(Shape, &'static str)>,
    is_house: impl Fn(&str) -> bool,
    min_side: impl Fn(&str) -> f64,
    lot: &Shape,
    fronts: &[[Point; 2]],
    surface: Surface<'_>,
    limit: f64,
    min_depth: f64,
) -> Option<Settled> {
    let home: Vec<usize> = (0..parts.len()).filter(|&i| is_house(parts[i].1)).collect();
    if home.is_empty() || home.iter().any(|&i| !parts[i].0.holes.is_empty() || parts[i].0.outer.len() < 3) {
        return None;
    }
    let rings: Vec<Vec<Point>> = home.iter().map(|&i| parts[i].0.outer.clone()).collect();
    let before = drop_of(surface, &rings);
    if before <= limit {
        return None;
    }
    let body = home.iter().position(|&i| parts[i].1 == "building").unwrap_or(0);
    let others: Vec<&[Point]> = (0..parts.len()).filter(|i| !home.contains(i)).map(|i| parts[i].0.outer.as_slice()).collect();
    let all: Vec<Point> = rings.iter().flatten().copied().collect();
    let n = all.len() as f64;
    let c = Point { x: all.iter().map(|p| p.x).sum::<f64>() / n, y: all.iter().map(|p| p.y).sum::<f64>() / n };
    let (x0, y0, x1, y1) = all.iter().fold((f64::MAX, f64::MAX, f64::MIN, f64::MIN), |b, p| (b.0.min(p.x), b.1.min(p.y), b.2.max(p.x), b.3.max(p.y)));
    let cell = surface.width / surface.height_resolution().max(1) as f64;
    let up = unit(uphill(surface, c, (0.5 * (x1 - x0).max(y1 - y0)).max(cell).max(1.0)))?;
    let axis = long_axis(&rings[body])?;
    let mut settled = Settled { before_m: before, after_m: before, ..Settled::default() };

    // Turn: the whole home rotated about its centre (a quarter turn either
    // way, or its long side onto the contour), set back at its former distance
    // from its street and slid along it, wherever it stays on the lot, clear
    // of the other parts and facing a street.
    let front = fronts.iter().copied().min_by(|a, b| front_gap(&rings, *a).total_cmp(&front_gap(&rings, *b)));
    let gap0 = fronts.iter().map(|f| front_gap(&rings, *f)).fold(f64::INFINITY, f64::min);
    let line = front.and_then(|f| {
        let along = unit(sub(f[1], f[0]))?;
        let mut inward = Point { x: -along.y, y: along.x };
        if dot(sub(c, f[0]), inward) < 0.0 {
            inward = Point { x: -inward.x, y: -inward.y };
        }
        Some((f[0], along, inward))
    });
    let offset = |rs: &[Vec<Point>], (a, _, inward): (Point, Point, Point)| rs.iter().flatten().map(|&p| dot(sub(p, a), inward)).fold(f64::INFINITY, f64::min);
    let contour = Point { x: -up.y, y: up.x };
    let to_contour = contour.y.atan2(contour.x) - axis.y.atan2(axis.x);
    let to_contour = (to_contour + std::f64::consts::FRAC_PI_2).rem_euclid(std::f64::consts::PI) - std::f64::consts::FRAC_PI_2;
    let mut turns = vec![0.0, std::f64::consts::FRAC_PI_2, -std::f64::consts::FRAC_PI_2];
    if turns.iter().all(|t: &f64| (t - to_contour).abs() > 0.09) {
        turns.push(to_contour);
    }
    let mut best: Option<(f64, f64, Vec<Vec<Point>>)> = None;
    for &turn in &turns {
        let rot = (turn.cos(), turn.sin());
        let turned: Vec<Vec<Point>> = rings.iter().map(|r| rotate(r, c, rot, Point { x: 0.0, y: 0.0 })).collect();
        let back = line.map_or(Point { x: 0.0, y: 0.0 }, |l| {
            let k = offset(&rings, l) - offset(&turned, l);
            Point { x: l.2.x * k, y: l.2.y * k }
        });
        for slide in SLIDES_M {
            if turn == 0.0 && slide == 0.0 {
                continue;
            }
            if line.is_none() && slide != 0.0 {
                break;
            }
            let along = line.map_or(Point { x: 0.0, y: 0.0 }, |l| l.1);
            let shift = Point { x: back.x + along.x * slide, y: back.y + along.y * slide };
            let placed: Vec<Vec<Point>> = turned.iter().map(|r| r.iter().map(|p| Point { x: p.x + shift.x, y: p.y + shift.y }).collect()).collect();
            let admissible = placed.iter().all(|r| within(lot, r) && !others.iter().any(|o| overlap(r, o)))
                && (fronts.is_empty() || fronts.iter().any(|f| front_gap(&placed, *f) <= gap0 + FRONT_SLACK_M));
            if !admissible {
                continue;
            }
            let d = drop_of(surface, &placed);
            if best.as_ref().is_none_or(|b| d < b.0 - 1e-9) {
                best = Some((d, turn, placed));
            }
        }
    }
    let mut rings = rings;
    if let Some((d, turn, placed)) = best
        && d < before - GAIN_M
    {
        (settled.after_m, settled.turned_deg, rings) = (d, turn.to_degrees(), placed);
    }

    // Shallow: keep a band across the slope on the street side of the home,
    // along the frame axis of its body nearest the fall line, as deep as the
    // limit allows and never under `min_depth`.
    if settled.after_m > limit
        && let Some(axis) = long_axis(&rings[body])
    {
        let side = Point { x: -axis.y, y: axis.x };
        let mut a = if dot(axis, up).abs() >= dot(side, up).abs() { axis } else { side };
        if dot(a, up) < 0.0 {
            a = Point { x: -a.x, y: -a.y };
        }
        let (m0, m1) = rings.iter().flatten().fold((f64::MAX, f64::MIN), |m, &p| (m.0.min(dot(p, a)), m.1.max(dot(p, a))));
        let depth = m1 - m0;
        let floor = min_depth.min(depth);
        let uphill_front = front.is_none_or(|f| {
            let fm = dot(Point { x: (f[0].x + f[1].x) / 2.0, y: (f[0].y + f[1].y) / 2.0 }, a);
            (fm - m1).abs() <= (fm - m0).abs()
        });
        let band = |w: f64| if uphill_front { (m1 - w, m1) } else { (m0, m0 + w) };
        let labels: Vec<&'static str> = home.iter().map(|&i| parts[i].1).collect();
        let clip = |w: f64| -> Option<Vec<Option<Vec<Point>>>> {
            let (lo, hi) = band(w);
            let cut: Vec<Option<Vec<Point>>> = rings
                .iter()
                .zip(&labels)
                .map(|(r, &label)| {
                    let k = massing::clip_band(r, a, lo, hi);
                    let shape = Shape { outer: k.clone(), holes: vec![] };
                    let thin = k.len() < 3 || geometry::area(&shape) < 1.0 || {
                        let (s0, s1) = k.iter().fold((f64::MAX, f64::MIN), |m, &p| (m.0.min(dot(p, a)), m.1.max(dot(p, a))));
                        s1 - s0 < min_side(label).min(floor)
                    };
                    (!thin).then_some(k)
                })
                .collect();
            cut[body].is_some().then_some(cut)
        };
        let drop_cut = |cut: &[Option<Vec<Point>>]| drop_of(surface, &cut.iter().flatten().cloned().collect::<Vec<_>>());
        if floor < depth - 0.1
            && let Some(shallowest) = clip(floor)
        {
            let mut pick = (floor, drop_cut(&shallowest), shallowest);
            if pick.1 <= limit {
                let (mut lo, mut hi) = (floor, depth);
                for _ in 0..12 {
                    let w = 0.5 * (lo + hi);
                    match clip(w) {
                        Some(cut) => {
                            let d = drop_cut(&cut);
                            if d <= limit {
                                lo = w;
                                pick = (w, d, cut);
                            } else {
                                hi = w;
                            }
                        }
                        None => hi = w,
                    }
                }
            }
            if pick.1 < settled.after_m - 1e-9 {
                settled.after_m = pick.1;
                settled.shallowed_m = depth - pick.0;
                let mut cut = pick.2.into_iter();
                // Home parts left thinner than their label allows go; the body never does.
                let mut gone: Vec<usize> = Vec::new();
                for (k, &i) in home.iter().enumerate() {
                    match cut.next().flatten() {
                        Some(r) => rings[k] = r,
                        None => gone.push(i),
                    }
                }
                for (k, &i) in home.iter().enumerate() {
                    parts[i].0.outer = rings[k].clone();
                }
                for &i in gone.iter().rev() {
                    parts.remove(i);
                }
                return Some(settled);
            }
        }
    }
    if settled.turned_deg == 0.0 && settled.after_m >= before {
        // Nothing lowered the drop: the home keeps its first pose.
        return Some(settled);
    }
    for (k, &i) in home.iter().enumerate() {
        parts[i].0.outer = rings[k].clone();
    }
    Some(settled)
}

#[cfg(test)]
mod tests {
    use super::*;

    fn rect(x0: f64, y0: f64, x1: f64, y1: f64) -> Shape {
        geometry::rectangle(x0, y0, x1, y1)
    }

    /// A plane rising `grade` per metre northwards (y), on a 200 m map of 1 m cells.
    fn slope(grade: f64) -> Vec<f32> {
        let n = 200;
        (0..n * n).map(|k| ((k / n) as f64 + 0.5) as f32 * grade as f32).collect()
    }
    fn surface(height: &[f32]) -> Surface<'_> {
        Surface {
            geometry: None,
            width: 200.0,
            n: 200,
            height,
            water: &[],
            interpolation: super::super::super::HeightInterpolation::Bilinear,
        }
    }
    fn house(label: &str) -> bool {
        label == "building"
    }

    #[test]
    fn long_house_down_a_thirty_percent_slope_turns_along_the_contour_and_keeps_its_street() {
        let h = slope(0.30);
        // A deep square lot on a street running up the slope (x = 50); the
        // house, 14 m long, runs up the slope along the street.
        let lot = rect(50.0, 80.0, 70.0, 100.0);
        let street = [Point { x: 50.0, y: 80.0 }, Point { x: 50.0, y: 100.0 }];
        let mut parts = vec![(rect(50.0, 83.0, 56.0, 97.0), "building")];
        let s = settle(&mut parts, house, |_| 3.0, &lot, &[street], surface(&h), 2.5, 4.0).expect("settled");
        assert!(s.before_m > 4.0 && s.turned_deg.abs() > 45.0, "{s:?}");
        let r = &parts[0].0.outer;
        let (ys, xs): (Vec<f64>, Vec<f64>) = r.iter().map(|p| (p.y, p.x)).unzip();
        let span = |v: &[f64]| v.iter().copied().fold(f64::MIN, f64::max) - v.iter().copied().fold(f64::MAX, f64::min);
        assert!(span(&xs) > span(&ys) + 4.0, "long side along the contour: {r:?}");
        assert!(s.after_m <= 2.5, "{s:?}");
        assert!(front_gap(&[r.clone()], street) <= 0.1, "keeps its street face: {r:?}");
        assert_eq!(parts.len(), 1);
    }

    #[test]
    fn a_house_that_cannot_turn_is_made_shallower_from_its_street() {
        let h = slope(0.30);
        // A narrow row lot on a street along the contour (y = 80): the house
        // cannot turn and is cut back to the depth the slope allows.
        let lot = rect(50.0, 80.0, 57.0, 100.0);
        let street = [Point { x: 50.0, y: 80.0 }, Point { x: 57.0, y: 80.0 }];
        let mut parts = vec![(rect(50.0, 80.0, 57.0, 94.0), "building"), (rect(51.0, 96.0, 56.0, 99.0), "barn")];
        let s = settle(&mut parts, house, |_| 3.0, &lot, &[street], surface(&h), 2.5, 4.0).expect("settled");
        assert_eq!(s.turned_deg, 0.0, "{s:?}");
        assert!(s.shallowed_m > 4.0 && s.after_m <= 2.5 + 1e-6, "{s:?}");
        let body = &parts[0].0.outer;
        assert!(body.iter().any(|p| p.y <= 80.0 + 1e-6), "keeps its street face: {body:?}");
        let depth = body.iter().map(|p| p.y).fold(f64::MIN, f64::max) - 80.0;
        assert!(depth >= 4.0 - 1e-6, "{depth}");
        assert_eq!(parts.len(), 2, "the barn stays");
    }

    #[test]
    fn a_flat_lot_is_unchanged() {
        let h = slope(0.0);
        let lot = rect(50.0, 80.0, 70.0, 100.0);
        let street = [Point { x: 50.0, y: 80.0 }, Point { x: 50.0, y: 100.0 }];
        let before = vec![(rect(50.0, 83.0, 56.0, 97.0), "building")];
        let mut parts = before.clone();
        assert!(settle(&mut parts, house, |_| 3.0, &lot, &[street], surface(&h), 2.5, 4.0).is_none());
        assert_eq!(parts, before);
        assert!(massing::footing("plinth", &before[0].0.outer, Point { x: 0.0, y: 1.0 }, &lot, &|_| 0.0, 0.0, 0.0).is_none());
    }
}
