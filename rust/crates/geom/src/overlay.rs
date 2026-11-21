use crate::{Point, Shape, normalized, polygon, signed};
use geo::{Area, BooleanOps, Coord, LineString, Polygon};

pub fn shapes(p: geo::MultiPolygon<f64>) -> Vec<Shape> {
    fn ring(l: &LineString<f64>, approximate: &mut bool) -> Vec<Point> {
        let mut r: Vec<_> = l.0.iter().map(|p| Point { x: p.x, y: p.y }).collect();
        if r.len() > 1
            && (r[0].x - r[r.len() - 1].x).abs() + (r[0].y - r[r.len() - 1].y).abs() < 1e-8
        {
            *approximate |= r[0].x != r[r.len() - 1].x || r[0].y != r[r.len() - 1].y;
            r.pop();
        }
        r.dedup_by(|a, b| {
            let close = (a.x - b.x).hypot(a.y - b.y) < 1e-7;
            *approximate |= close && (a.x != b.x || a.y != b.y);
            close
        });
        r
    }
    fn exact_ring(l: &LineString<f64>) -> Vec<Point> {
        let mut r: Vec<_> = l.0.iter().map(|p| Point { x: p.x, y: p.y }).collect();
        if r.len() > 1 && r[0].x == r[r.len() - 1].x && r[0].y == r[r.len() - 1].y {
            r.pop();
        }
        r
    }
    p.0.into_iter()
        .filter(|p| p.unsigned_area() > 0.01)
        .map(|p| {
            #[cfg(any(test, feature = "test-support"))]
            crate::test_support::record_conversion(0);
            let mut approximate = false;
            let converted = normalized(Shape {
                outer: ring(p.exterior(), &mut approximate),
                holes: p
                    .interiors()
                    .iter()
                    .map(|h| ring(h, &mut approximate))
                    .collect(),
            });
            // Removing a distinct, near-coincident vertex can turn a valid raw
            // overlay ring into a crossing. Check only approximated rings and
            // keep the raw boundary if simplification would invalidate it.
            if approximate {
                use geo::Validation;
                #[cfg(any(test, feature = "test-support"))]
                crate::test_support::record_conversion(1);
                if !polygon(&converted).is_valid() {
                    #[cfg(any(test, feature = "test-support"))]
                    crate::test_support::record_conversion(2);
                    if p.is_valid() {
                        #[cfg(any(test, feature = "test-support"))]
                        crate::test_support::record_conversion(3);
                        return normalized(Shape {
                            outer: exact_ring(p.exterior()),
                            holes: p.interiors().iter().map(exact_ring).collect(),
                        });
                    }
                }
            }
            converted
        })
        .filter(|p| p.outer.len() >= 3)
        .collect()
}

pub fn intersection(a: &Shape, b: &Shape) -> Vec<Shape> {
    overlay(
        span([a, b]),
        |r| match (operand(a, r), operand(b, r)) {
            (Some(p), Some(q)) => shapes(p.intersection(&q)),
            _ => Vec::new(),
        },
        // Conservative: an unresolvable piece claims no area.
        Vec::new,
    )
}
pub fn difference(a: &Shape, b: &Shape) -> Vec<Shape> {
    overlay(
        span([a, b]),
        |r| match (operand(a, r), operand(b, r)) {
            (Some(p), Some(q)) => shapes(p.difference(&q)),
            (Some(p), None) => shapes(geo::MultiPolygon(vec![p])),
            (None, _) => Vec::new(),
        },
        // Conservative: never claim area that may lie inside `b`.
        Vec::new,
    )
}

/// Subtract a region of already unioned polygons in a single overlay.
pub fn difference_many(subject: &Shape, clips: &[Shape]) -> Vec<Shape> {
    overlay(
        span(std::iter::once(subject).chain(clips.iter())),
        |r| {
            let Some(p) = operand(subject, r) else {
                return Vec::new();
            };
            let clips = geo::MultiPolygon(clips.iter().filter_map(|w| operand(w, r)).collect());
            shapes(p.difference(&clips))
        },
        // Conservative: do not claim area that may lie inside any clip.
        Vec::new,
    )
}

/// i_overlay maps operands to an integer grid with a unit set by their extent.
/// Thin spikes and slivers can collapse and produce self-overlapping rings
/// that the hole binder cannot handle. Reduce operands exactly first, keeping
/// surviving coordinates fixed. On panic, retry with sub-grid sliver removal,
/// then with snapped operands, before returning a conservative result.
const SLIVER_UNITS: f64 = 4.0;
/// Retry grid (m): operands snapped to 1 mm (then 1 cm) and reduced exactly.
const GRID: f64 = 1e-3;
// Match the overlay output cutoff: rings below 0.01 m² reserve no land.
const MIN_RING_AREA: f64 = 0.01;
/// Overlays that still failed and returned their documented conservative result.
static FALLBACKS: std::sync::atomic::AtomicUsize = std::sync::atomic::AtomicUsize::new(0);
pub fn overlay_fallbacks() -> usize {
    FALLBACKS.load(std::sync::atomic::Ordering::Relaxed)
}
#[derive(Clone, Copy)]
enum Reduce {
    /// Tolerance in metres; coordinates are otherwise untouched.
    Within(f64),
    /// Snap to this grid (m) and reduce exactly.
    Grid(f64),
}
/// i_overlay's integer unit (m) for an operation over these shapes.
fn span<'s>(shapes: impl IntoIterator<Item = &'s Shape>) -> f64 {
    let (mut x0, mut y0, mut x1, mut y1) = (f64::MAX, f64::MAX, f64::MIN, f64::MIN);
    for p in shapes.into_iter().flat_map(|s| s.outer.iter()) {
        if p.x.is_finite() && p.y.is_finite() {
            (x0, y0, x1, y1) = (x0.min(p.x), y0.min(p.y), x1.max(p.x), y1.max(p.y));
        }
    }
    let half = (x1 - x0).max(y1 - y0) * 0.5;
    if half > 0.0 && half.is_finite() {
        (half.log2().floor() - 29.0).exp2()
    } else {
        0.0
    }
}

/// Run `op` on exactly reduced operands; if i_overlay panics, retry with the
/// sub-resolution reduction, then on 1 mm and 1 cm snapped operands, then
/// return `conservative()` (counted by `overlay_fallbacks`). Only the overlay
/// itself is guarded; with panic=abort (wasm) it is a plain call.
fn overlay<T>(unit: f64, op: impl Fn(Reduce) -> T, conservative: impl FnOnce() -> T) -> T {
    let ladder = [
        Reduce::Within(0.0),
        Reduce::Within(SLIVER_UNITS * unit),
        Reduce::Grid(GRID),
        Reduce::Grid(GRID * 10.0),
    ];
    for r in ladder {
        if let Ok(out) = std::panic::catch_unwind(std::panic::AssertUnwindSafe(|| op(r))) {
            return out;
        }
    }
    FALLBACKS.fetch_add(1, std::sync::atomic::Ordering::Relaxed);
    conservative()
}

/// A reduced ring, counter-clockwise; `None` when it encloses no area. On a
/// grid the arithmetic is exact (integer-valued f64 in grid units).
fn reduced_ring(r: &[Point], reduce: Reduce) -> Option<Vec<Coord<f64>>> {
    let (unit, eps) = match reduce {
        Reduce::Within(eps) => (1.0, eps),
        Reduce::Grid(g) => (g, 0.0),
    };
    let snap = |v: f64| match reduce {
        Reduce::Within(_) => v,
        Reduce::Grid(g) => (v / g).round(),
    };
    let first = r.iter().find(|p| p.x.is_finite() && p.y.is_finite())?;
    let o = (snap(first.x), snap(first.y));
    let same = |a: (f64, f64), b: (f64, f64)| (a.0 - b.0).abs().max((a.1 - b.1).abs()) <= eps;
    // b is redundant when it lies within eps of the line of its longer edge:
    // a collinear continuation, a spike tip or one side of a thin antenna.
    let redundant = |a: (f64, f64), b: (f64, f64), c: (f64, f64)| {
        let (u, v) = ((b.0 - a.0, b.1 - a.1), (c.0 - b.0, c.1 - b.1));
        (u.0 * v.1 - u.1 * v.0).abs() <= eps * u.0.hypot(u.1).max(v.0.hypot(v.1))
    };
    let mut q: Vec<(f64, f64)> = Vec::with_capacity(r.len());
    for p in r.iter().filter(|p| p.x.is_finite() && p.y.is_finite()) {
        let v = (snap(p.x) - o.0, snap(p.y) - o.1);
        if q.last().is_some_and(|&l| same(l, v)) {
            continue;
        }
        while q.len() >= 2 && redundant(q[q.len() - 2], q[q.len() - 1], v) {
            q.pop();
        }
        if !q.last().is_some_and(|&l| same(l, v)) {
            q.push(v);
        }
    }
    let mut start = 0;
    loop {
        if q.len() < start + 3 {
            return None;
        }
        let n = q.len();
        if same(q[n - 1], q[start]) || redundant(q[n - 2], q[n - 1], q[start]) {
            q.pop();
        } else if redundant(q[n - 1], q[start], q[start + 1]) {
            start += 1;
        } else {
            break;
        }
    }
    let mut q = q.split_off(start);
    let twice: f64 = q
        .iter()
        .zip(q.iter().cycle().skip(1))
        .map(|(a, b)| a.0 * b.1 - b.0 * a.1)
        .sum();
    if !twice.is_finite() || twice.abs() * unit * unit <= 2.0 * MIN_RING_AREA {
        return None;
    }
    if twice < 0.0 {
        q.reverse();
    }
    Some(
        q.into_iter()
            .map(|(x, y)| Coord {
                x: (x + o.0) * unit,
                y: (y + o.1) * unit,
            })
            .collect(),
    )
}
/// Remove repeated vertices, out-and-back spikes, and holes under 0.02 m².
/// Keep the remaining coordinates fixed. If the outer ring collapses, return
/// the input shape.
pub fn cleaned(s: &Shape) -> Shape {
    let ring = |r: &[Point]| {
        reduced_ring(r, Reduce::Within(0.0)).map(|c| {
            c.into_iter()
                .map(|p| Point { x: p.x, y: p.y })
                .collect::<Vec<_>>()
        })
    };
    let Some(outer) = ring(&s.outer) else {
        return s.clone();
    };
    let holes: Vec<Vec<Point>> = s
        .holes
        .iter()
        .filter_map(|h| ring(h))
        .filter(|h| signed(h).abs() >= 0.02)
        .map(|mut h| {
            h.reverse();
            h
        })
        .collect();
    // Nothing dropped: the lot stays bit for bit as it was (its identity is
    // derived from its coordinates).
    if outer.len() == s.outer.len()
        && holes.len() == s.holes.len()
        && holes.iter().zip(&s.holes).all(|(h, o)| h.len() == o.len())
    {
        return s.clone();
    }
    Shape { outer, holes }
}
/// The reduced overlay operand of a shape (holes clockwise); `None` without area.
fn operand(s: &Shape, reduce: Reduce) -> Option<Polygon<f64>> {
    let line = |mut c: Vec<Coord<f64>>, hole: bool| {
        if hole {
            c.reverse();
        }
        c.push(c[0]);
        LineString(c)
    };
    let outer = line(reduced_ring(&s.outer, reduce)?, false);
    let holes = s
        .holes
        .iter()
        .filter_map(|h| reduced_ring(h, reduce))
        .map(|h| line(h, true))
        .collect();
    Some(Polygon::new(outer, holes))
}
/// Reduced union; if the overlay cannot resolve it, the conservative result is
/// the (possibly overlapping) inputs themselves, so coverage is never lost.
pub fn union(shapes: &[Shape]) -> Vec<Shape> {
    let unit = span(shapes);
    overlay(
        unit,
        |r| {
            let ps: Vec<_> = shapes.iter().filter_map(|s| operand(s, r)).collect();
            self::shapes(geo::algorithm::bool_ops::unary_union(&ps))
        },
        || {
            shapes
                .iter()
                .filter_map(|s| operand(s, Reduce::Within(0.0)))
                .flat_map(|p| self::shapes(geo::MultiPolygon(vec![p])))
                .collect()
        },
    )
}

#[cfg(test)]
#[path = "conversion_topology_tests.rs"]
mod conversion_topology_tests;

#[cfg(test)]
mod tests {
    use super::*;
    use crate::{area, rectangle};
    #[test]
    fn overlay_operands_drop_collapsed_and_sub_area_rings_before_boolean_work() {
        let mut subject = rectangle(0.0, 0.0, 100.0, 100.0);
        subject.outer.insert(1, subject.outer[0]);
        subject.outer.insert(
            2,
            Point {
                x: f64::NAN,
                y: 0.0,
            },
        );
        subject.holes.push(vec![Point { x: 1.0, y: 1.0 }; 4]);
        subject
            .holes
            .push(rectangle(20.0, 20.0, 20.001, 20.001).outer);
        let reduced = operand(&subject, Reduce::Within(0.0)).unwrap();
        assert_eq!(reduced.exterior().0.len(), 5);
        assert!(reduced.interiors().is_empty());
        assert_eq!(reduced.unsigned_area(), 10_000.0);
        let cut = rectangle(40.0, 40.0, 60.0, 60.0);
        let rest = difference(&subject, &cut);
        assert!((rest.iter().map(area).sum::<f64>() - 9_600.0).abs() < 1e-6);
        assert!(operand(&rectangle(0.0, 0.0, 0.0001, 1.0), Reduce::Within(0.0)).is_none());
        assert!(operand(&rectangle(0.0, 0.0, 0.0001, 1000.0), Reduce::Grid(GRID)).is_none());
    }
    /// Sanitized operands with sub-grid slivers resolve without falling back,
    /// and the intersection never exceeds the subject.
    #[test]
    fn sub_grid_sliver_overlays_without_panic() {
        #[derive(serde::Deserialize)]
        struct Case {
            subject: Shape,
            clip: Shape,
        }
        let case: Case =
            serde_json::from_str(include_str!("../tests/fixtures/overlay_sliver_panic.json"))
                .unwrap();
        let before = overlay_fallbacks();
        let out = intersection(&case.subject, &case.clip);
        let rest = difference(&case.subject, &case.clip);
        let both = union(&[case.subject.clone(), case.clip.clone()]);
        assert_eq!(overlay_fallbacks(), before);
        let total: f64 = out.iter().map(area).sum();
        assert!(total <= area(&case.subject) + 1e-3);
        let rest: f64 = rest.iter().map(area).sum();
        assert!((total + rest - area(&case.subject)).abs() < 0.05);
        assert!((both.iter().map(area).sum::<f64>() - area(&case.clip) - rest).abs() < 0.05);
        // Ring reduction: NaN, duplicates, collinear runs and spikes vanish; CCW out.
        let p = |x: f64, y: f64| Point { x, y };
        let ring = [
            p(0.0, 0.0),
            p(f64::NAN, 1.0),
            p(5.0, 0.0),
            p(5.0, 0.0),
            p(10.0, 0.0),
            p(10.0, 10.0),
            p(10.0, 20.0),
            p(10.0, 10.0),
            p(0.0, 10.0),
            p(0.0, 5.0),
        ];
        for r in [Reduce::Within(1e-6), Reduce::Grid(GRID)] {
            let mut q: Vec<_> = reduced_ring(&ring, r)
                .unwrap()
                .iter()
                .map(|c| ((c.x * 1e3).round() as i64, (c.y * 1e3).round() as i64))
                .collect();
            assert!(
                signed(
                    &q.iter()
                        .map(|&(x, y)| p(x as f64, y as f64))
                        .collect::<Vec<_>>()
                ) > 0.0
            );
            q.sort();
            assert_eq!(q, vec![(0, 0), (0, 10_000), (10_000, 0), (10_000, 10_000)]);
            assert!(reduced_ring(&[p(0.0, 0.0), p(1.0, 1.0), p(2.0, 2.0)], r).is_none());
        }
    }
}
