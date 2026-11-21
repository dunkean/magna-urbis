//! Vector, frame and half-plane geometry shared by the lot cutters.

use crate::urban::{Point, Shape};
use crate::urban::geometry::intersection;

pub(super) fn dot(a: Point, b: Point) -> f64 {
    a.x * b.x + a.y * b.y
}
pub(super) fn sub(a: Point, b: Point) -> Point {
    Point {
        x: a.x - b.x,
        y: a.y - b.y,
    }
}
pub(super) fn add(a: Point, b: Point) -> Point {
    Point {
        x: a.x + b.x,
        y: a.y + b.y,
    }
}
pub(super) fn scale(a: Point, s: f64) -> Point {
    Point {
        x: a.x * s,
        y: a.y * s,
    }
}
pub(super) fn length(a: Point) -> f64 {
    a.x.hypot(a.y)
}
pub(super) fn unit(a: Point) -> Point {
    scale(a, 1.0 / length(a).max(1e-12))
}
pub(super) fn normal(a: Point) -> Point {
    Point { x: -a.y, y: a.x }
}
pub(super) fn distance(p: Point, a: Point, b: Point) -> f64 {
    let d = sub(b, a);
    length(sub(
        p,
        add(
            a,
            scale(
                d,
                (dot(sub(p, a), d) / dot(d, d).max(1e-12)).clamp(0.0, 1.0),
            ),
        ),
    ))
}

pub(super) fn frame_direction(inward: Point, axis: Point) -> Point {
    let v = normal(axis);
    let d = if dot(inward, axis).abs() >= dot(inward, v).abs() {
        axis
    } else {
        v
    };
    scale(d, if dot(inward, d) >= 0.0 { 1.0 } else { -1.0 })
}

pub(super) fn bounds(shape: &Shape, axis: Point) -> (f64, f64) {
    shape
        .outer
        .iter()
        .fold((f64::INFINITY, f64::NEG_INFINITY), |(a, b), p| {
            let d = dot(*p, axis);
            (a.min(d), b.max(d))
        })
}

/// `URBAN_PROFILE`: calls of `half` and the time spent in them since the last
/// `parcels.cut.half` line, summed over threads.
static HALF_CALLS: std::sync::atomic::AtomicUsize = std::sync::atomic::AtomicUsize::new(0);
static HALF_NANOS: std::sync::atomic::AtomicU64 = std::sync::atomic::AtomicU64::new(0);
#[cfg(not(target_arch = "wasm32"))]
fn profiling() -> bool {
    static ON: std::sync::OnceLock<bool> = std::sync::OnceLock::new();
    *ON.get_or_init(|| std::env::var("URBAN_PROFILE").is_ok())
}

/// The pieces of `shape` on the `dot(axis, p) <= at` side (`below`) or the
/// other one: an exact boolean half-plane, bounded beyond the complete parent
/// shape. The planner and the lot edits are tuned on the overlay's rings (its
/// grid, ring start and vertices) to the last lot: a direct cut that agrees
/// with it within 1e-5 m still moves small settlements.
pub(super) fn half(shape: &Shape, axis: Point, at: f64, below: bool) -> Vec<Shape> {
    #[cfg(not(target_arch = "wasm32"))]
    let start = profiling().then(std::time::Instant::now);
    let pieces = half_plane(shape, axis, at, below);
    #[cfg(not(target_arch = "wasm32"))]
    if let Some(start) = start {
        HALF_CALLS.fetch_add(1, std::sync::atomic::Ordering::Relaxed);
        HALF_NANOS.fetch_add(start.elapsed().as_nanos() as u64, std::sync::atomic::Ordering::Relaxed);
    }
    pieces
}
/// `half` as a polygon intersection with a rectangle whose side lies on the line.
fn half_plane(shape: &Shape, axis: Point, at: f64, below: bool) -> Vec<Shape> {
    let v = normal(axis);
    let (a, b) = bounds(shape, axis);
    let (c, d) = bounds(shape, v);
    let margin = (b - a).hypot(d - c) + 1.0;
    let (lo, hi) = if below {
        (a - margin, at)
    } else {
        (at, b + margin)
    };
    if hi <= lo {
        return Vec::new();
    }
    let point = |u, w| add(scale(axis, u), scale(v, w));
    intersection(
        shape,
        &Shape {
            outer: vec![
                point(lo, c - margin),
                point(hi, c - margin),
                point(hi, d + margin),
                point(lo, d + margin),
            ],
            holes: Vec::new(),
        },
    )
}

/// Keep points `p` with `dot(n, p) <= c`.
pub(super) type Plane = (Point, f64);

/// Sutherland-Hodgman against a convex window: exact for any simple subject.
pub(super) fn clip(ring: &[Point], planes: &[Plane]) -> Vec<Point> {
    let mut out = ring.to_vec();
    for &(n, c) in planes {
        if out.len() < 3 {
            return Vec::new();
        }
        let input = std::mem::take(&mut out);
        for i in 0..input.len() {
            let p = input[i];
            let q = input[(i + 1) % input.len()];
            let (dp, dq) = (dot(n, p) - c, dot(n, q) - c);
            if dp <= 0.0 {
                out.push(p);
            }
            if (dp < 0.0 && dq > 0.0) || (dp > 0.0 && dq < 0.0) {
                out.push(add(p, scale(sub(q, p), dp / (dp - dq))));
            }
        }
    }
    out
}

pub(super) fn ring_area(r: &[Point]) -> f64 {
    super::super::geometry::signed(r)
}

/// Area of `shape` on the `dot(axis, p) <= at` side, holes included, without a
/// boolean operation: one Sutherland-Hodgman pass per ring (exact for any simple
/// ring against one half-plane, concave ones included).
pub(super) fn half_area(shape: &Shape, axis: Point, at: f64) -> f64 {
    let plane = [(axis, at)];
    let ring = |r: &[Point]| ring_area(&clip(r, &plane)).abs();
    ring(&shape.outer) - shape.holes.iter().map(|h| ring(h)).sum::<f64>()
}

pub(super) fn profile_half() {
    // Summed over the threads that cut blocks in parallel: time spent in
    // `half`, not wall time.
    eprintln!(
        "  parcels.cut.half: calls={} ms={:.0}",
        HALF_CALLS.swap(0, std::sync::atomic::Ordering::Relaxed),
        HALF_NANOS.swap(0, std::sync::atomic::Ordering::Relaxed) as f64 / 1e6,
    );
}
