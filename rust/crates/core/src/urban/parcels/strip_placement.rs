//! Stationing, cut directions and area balancing within a frontage strip.

use super::contacts;
use super::contacts::Front;
use super::cut_geometry::{add, distance, dot, half, half_area, length, normal, scale, sub, unit};
use crate::urban::{Point, Shape};
use crate::urban::geometry::area;

/// The real frontage of a territory as a polyline measured by arclength:
/// its contacts with `run`, ordered and oriented along `along`. Gaps between
/// contacts (a corner cut, a hole) do not count as frontage.
pub(super) struct Stations {
    pub(super) segments: Vec<(Point, Point, f64)>,
    pub(super) total: f64,
}
impl Stations {
    pub(super) fn new(shape: &Shape, run: &[Front], along: Point) -> Self {
        let mut segments: Vec<(Point, Point)> = contacts::boundary_contacts(shape, run)
            .into_iter()
            .map(|f| {
                if dot(sub(f.b, f.a), along) >= 0.0 {
                    (f.a, f.b)
                } else {
                    (f.b, f.a)
                }
            })
            .filter(|(a, b)| length(sub(*b, *a)) > 1e-6)
            .collect();
        segments.sort_by(|x, y| dot(add(x.0, x.1), along).total_cmp(&dot(add(y.0, y.1), along)));
        let mut total = 0.0;
        let segments = segments
            .into_iter()
            .map(|(a, b)| {
                total += length(sub(b, a));
                (a, b, total)
            })
            .collect();
        Self { segments, total }
    }
    /// Point and unit tangent at arclength `s`.
    pub(super) fn at(&self, s: f64) -> (Point, Point) {
        let mut start = 0.0;
        let last = self.segments.len().saturating_sub(1);
        for (i, &(a, b, end)) in self.segments.iter().enumerate() {
            if s <= end + 1e-9 || i == last {
                let d = unit(sub(b, a));
                let t = (s - start).clamp(0.0, end - start);
                return (add(a, scale(d, t)), d);
            }
            start = end;
        }
        let (a, b, _) = *self.segments.last().unwrap();
        (b, unit(sub(b, a)))
    }
}

/// Cut directions (plane normals along the street) for internal cuts at the
/// given stations: the bisector of the two neighbouring lot chords, with the
/// turn between consecutive cuts limited so that two cuts `f` metres apart
/// never converge (or fan out) by more than half a lot inside the depth band.
pub(super) fn cut_directions(
    st: &Stations,
    cuts: &[f64],
    fronts: &[f64],
    along: Point,
    band: f64,
) -> Vec<Point> {
    let n = cuts.len();
    if n == 0 {
        return vec![];
    }
    let point = |s: f64| st.at(s).0;
    let mut angles: Vec<f64> = (0..n)
        .map(|k| {
            let before = if k == 0 { 0.0 } else { cuts[k - 1] };
            let after = if k + 1 == n { st.total } else { cuts[k + 1] };
            let p = point(cuts[k]);
            let (pa, pb) = (point(before), point(after));
            let mut d = add(unit(sub(p, pa)), unit(sub(pb, p)));
            if length(d) < 1e-6 {
                d = st.at(cuts[k]).1;
            }
            let d = unit(d);
            let d = if dot(d, along) < 0.0 {
                scale(d, -1.0)
            } else {
                d
            };
            let cross = along.x * d.y - along.y * d.x;
            cross.atan2(dot(along, d)).clamp(-1.2, 1.2)
        })
        .collect();
    let ideal = angles.clone();
    let band = band.max(4.0);
    let step = |k: usize| (0.5 * fronts[k + 1] / band).clamp(0.02, 0.6);
    for k in 0..n.saturating_sub(1) {
        let s = step(k);
        angles[k + 1] = angles[k + 1].clamp(angles[k] - s, angles[k] + s);
    }
    for k in (0..n.saturating_sub(1)).rev() {
        let s = step(k);
        angles[k] = angles[k].clamp(angles[k + 1] - s, angles[k + 1] + s);
    }
    // The limiter lags behind a long curve; one uniform turn (which keeps every
    // step bound) centres the remaining deviation from the local normals.
    let (lo, hi) = ideal
        .iter()
        .zip(&angles)
        .map(|(a, b)| a - b)
        .fold((f64::INFINITY, f64::NEG_INFINITY), |(l, h), d| {
            (l.min(d), h.max(d))
        });
    let shift = 0.5 * (lo + hi);
    angles
        .into_iter()
        .map(|a| a + shift)
        .map(|a| {
            let (sin, cos) = a.sin_cos();
            Point {
                x: along.x * cos - along.y * sin,
                y: along.x * sin + along.y * cos,
            }
        })
        .collect()
}

/// One strip partition of a territory: `lots` frontage lengths along the real
/// frontage, internal cuts in the given directions (plane normals along the
/// street). Each cut keeps its direction and slides along the frontage
/// (bounded to 35 % of a lot, monotone bisection on the exact half-plane area)
/// until its lot holds its frontage-weighted share of the territory. Returns
/// every piece with its lot index and that lot's actual frontage station span.
pub(super) fn cut_strip(
    territory: &Shape,
    stations: &Stations,
    lots: &[f64],
    directions: &[Point],
    narrowest: f64,
    sound: &dyn Fn(&Shape) -> bool,
) -> Vec<(Shape, usize, f64)> {
    let count = lots.len();
    let extent = stations.total;
    let whole = area(territory);
    let mut out = vec![];
    let mut rem = vec![territory.clone()];
    let (mut assigned, mut previous, mut nominal) = (0.0, 0.0, 0.0);
    let mut last_cut: Option<Point> = None;
    for k in 0..count {
        if k + 1 == count {
            out.extend(rem.drain(..).map(|c| (c, k, extent - previous)));
            break;
        }
        nominal += lots[k];
        let want = whole * nominal / extent - assigned;
        let reach = 0.35 * lots[k].min(lots[k + 1]);
        let lo_s = (nominal - reach).max(previous + narrowest);
        let hi_s = (nominal + reach)
            .min(extent - narrowest * (count - 1 - k) as f64)
            .max(lo_s);
        // One cut in `direction`, at the station that gives the lot its area.
        let cut = |direction: Point| {
            let level_at = |s: f64| dot(stations.at(s).0, direction);
            let below = |s: f64| {
                rem.iter()
                    .map(|c| half_area(c, direction, level_at(s)))
                    .sum::<f64>()
            };
            let station = if below(lo_s) >= want {
                lo_s
            } else if below(hi_s) <= want {
                hi_s
            } else {
                let (mut a, mut b) = (lo_s, hi_s);
                for _ in 0..16 {
                    let m = 0.5 * (a + b);
                    if below(m) < want {
                        a = m;
                    } else {
                        b = m;
                    }
                    if b - a < 0.02 {
                        break;
                    }
                }
                0.5 * (a + b)
            };
            let level = level_at(station);
            let lot: Vec<Shape> = rem
                .iter()
                .flat_map(|c| half(c, direction, level, true))
                .collect();
            let rest: Vec<Shape> = rem
                .iter()
                .flat_map(|c| half(c, direction, level, false))
                .collect();
            (direction, station, lot, rest)
        };
        // The lot is judged before it is drawn, as `bisect` does: a cut that
        // leaves an unsound lot (or last lot) gives way to one square to the
        // street here, or parallel to the previous cut, if that is sounder.
        let closing = k + 2 == count;
        let faults = |lot: &[Shape], rest: &[Shape]| {
            lot.iter().filter(|s| !sound(s)).count()
                + if closing {
                    rest.iter().filter(|s| !sound(s)).count()
                } else {
                    0
                }
        };
        let mut chosen = cut(directions[k]);
        let mut worst = faults(&chosen.2, &chosen.3);
        if worst > 0 {
            let square = stations.at(nominal.min(extent)).1;
            for direction in [Some(square), last_cut].into_iter().flatten() {
                if dot(direction, directions[k]).abs() > 0.9995 {
                    continue;
                }
                let other = cut(direction);
                let found = faults(&other.2, &other.3);
                if !other.2.is_empty() && !other.3.is_empty() && found < worst {
                    worst = found;
                    chosen = other;
                }
            }
        }
        let (direction, station, lot, rest) = chosen;
        let span = station - previous;
        previous = station;
        last_cut = Some(direction);
        for piece in lot {
            assigned += area(&piece);
            out.push((piece, k, span));
        }
        rem = rest;
    }
    out
}

/// Worst neighbour ratio of depth-equivalent areas (area per metre of frontage).
pub(super) fn balance(pieces: &[(Shape, usize, f64)]) -> f64 {
    let n = pieces.iter().map(|p| p.1 + 1).max().unwrap_or(0);
    let mut per = vec![(0.0, 0.0); n];
    for (s, k, span) in pieces {
        per[*k].0 += area(s);
        per[*k].1 = span.max(0.5);
    }
    let depth: Vec<f64> = per.iter().map(|(a, f)| a / f).collect();
    depth
        .windows(2)
        .map(|w| w[0].max(w[1]) / w[0].min(w[1]).max(1e-6))
        .fold(1.0, f64::max)
}

/// Cut directions interpolated, along the frontage, between the territory's
/// two side boundaries at the ends of its frontage (each within 50 degrees of
/// square). None when a side cannot be read.
pub(super) fn side_directions(
    territory: &Shape,
    stations: &Stations,
    cuts: &[f64],
    along: Point,
) -> Option<Vec<Point>> {
    if cuts.is_empty() {
        return None;
    }
    let ring = &territory.outer;
    let n = ring.len();
    let on_front = |a: Point, b: Point| {
        let m = scale(add(a, b), 0.5);
        stations
            .segments
            .iter()
            .any(|(p, q, _)| distance(m, *p, *q) < 0.03)
    };
    // Plane normal of a cut parallel to the side leaving the frontage end `p`.
    let side = |p: Point| -> Option<f64> {
        let i =
            (0..n).min_by(|&i, &j| length(sub(ring[i], p)).total_cmp(&length(sub(ring[j], p))))?;
        if length(sub(ring[i], p)) > 0.05 {
            return None;
        }
        for step in [1, n - 1] {
            if on_front(ring[i], ring[(i + step) % n]) {
                continue;
            }
            // Walk the side until 3 m away from the frontage end.
            let mut j = i;
            for _ in 0..n {
                j = (j + step) % n;
                if length(sub(ring[j], p)) >= 3.0 {
                    break;
                }
            }
            let d = unit(sub(ring[j], p));
            let m = normal(d);
            let m = if dot(m, along) < 0.0 {
                scale(m, -1.0)
            } else {
                m
            };
            if dot(m, along) < 50.0_f64.to_radians().cos() {
                return None;
            }
            let cross = along.x * m.y - along.y * m.x;
            return Some(cross.atan2(dot(along, m)));
        }
        None
    };
    let first = side(stations.at(0.0).0)?;
    let last = side(stations.at(stations.total).0)?;
    Some(
        cuts.iter()
            .map(|s| {
                let a = first + (last - first) * s / stations.total;
                let (sin, cos) = a.sin_cos();
                Point {
                    x: along.x * cos - along.y * sin,
                    y: along.x * sin + along.y * cos,
                }
            })
            .collect(),
    )
}
