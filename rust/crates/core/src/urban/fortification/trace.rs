//! Fit contour, village, hill, square and bastioned curtains to their founding outlines.

use crate::urban::{Point, Shape, Surface, composition, geometry as g};
use super::geometry::{Cut, add, area, buffer, closed, dir, dist, pt, turn_at, unit};
use super::pockets::without_invaginations;
use super::style::{data, num};

/// A dry bank component must contain founding quarters. If a smoothed circuit
/// reaches an empty far bank, return to the occupied bank; genuine occupied
/// crossings retain the original circuit and its water gates.
fn occupied_banks(shape: &Shape, occupied: &[Shape], surface: Surface<'_>) -> Vec<Shape> {
    use geo::{BooleanOps, MultiPolygon};
    let dry = g::dry_clip(&surface, shape);
    let supported = |s: &Shape| occupied.iter().any(|q| area(&g::intersection(s, q)) > 1.0);
    if !dry.iter().any(|s| g::area(s) > 1.0 && !supported(s)) { return vec![shape.clone()]; }
    let kept: Vec<_> = dry.iter().filter(|s| supported(s)).cloned().collect();
    if kept.len() < 2 { return kept; }
    // Keep genuine crossings between occupied banks even when a third bank
    // or island is empty. The closing only supplies water, never dry wedges.
    let land = MultiPolygon(kept.iter().map(g::polygon).collect());
    let closed = composition::closing(&land, 60.0);
    let mut water = vec![shape.clone()];
    for bank in &dry { water = water.iter().flat_map(|s| g::difference(s, bank)).collect(); }
    let links: Vec<_> = g::shapes(closed.difference(&land)).iter()
        .flat_map(|gap| water.iter().flat_map(move |wet| g::intersection(gap, wet))).collect();
    g::union(&kept.into_iter().chain(links).collect::<Vec<_>>())
}
pub(in super::super) fn trace_enclosures(shapes: Vec<Shape>, occupied: &[Shape], surface: Surface<'_>) -> Vec<Shape> {
    let traced: Vec<_> = shapes.iter().flat_map(|s| occupied_banks(s, occupied, surface))
        .map(|s| without_invaginations(&s, surface)).collect();
    #[cfg(test)]
    TRACE_PAIRS.with(|pairs| {
        if let Some(pairs) = &mut *pairs.borrow_mut() { pairs.push((shapes, traced.clone())); }
    });
    traced
}
#[cfg(test)]
thread_local! {
    pub(super) static TRACE_PAIRS: std::cell::RefCell<Option<Vec<(Vec<Shape>, Vec<Shape>)>>> = const { std::cell::RefCell::new(None) };
    pub(super) static CONTOUR_PAIRS: std::cell::RefCell<Option<Vec<(Shape, Shape, usize)>>> = const { std::cell::RefCell::new(None) };
}

/// Urban simplification error is metric, independent of area and raster size.
/// The founding outline supplies the curves; no hull or minimum front length.
fn contour_trace(shape: &Shape, passes: usize, tolerance: f64, refine: bool) -> Shape {
    let mut ring = shape.outer.clone();
    for _ in 0..passes {
        let n = ring.len();
        ring = (0..n).flat_map(|i| {
            let (a, b) = (ring[i], ring[(i + 1) % n]);
            [pt(a.x * 0.75 + b.x * 0.25, a.y * 0.75 + b.y * 0.25),
                pt(a.x * 0.25 + b.x * 0.75, a.y * 0.25 + b.y * 0.75)]
        }).collect();
    }
    ring.push(ring[0]);
    let mut outer = g::simplify(&ring, tolerance, |_| false);
    outer.pop();
    if outer.len() < 3 {
        return shape.clone();
    }
    let mut trace = g::normalized(Shape {
        outer,
        holes: shape.holes.clone(),
    });
    let simple = |r: &[Point]| g::simple(&Shape { outer: r.to_vec(), holes: vec![] });
    let fallback = refine && !simple(&trace.outer) && simple(&shape.outer);
    if fallback {
        // Corner cutting can cross a thin neck. Keep its founding contour
        // and reduce simplification until that valid topology survives.
        let mut ring = shape.outer.clone();
        ring.push(ring[0]);
        let mut epsilon = tolerance;
        loop {
            let mut outer = g::simplify(&ring, epsilon, |_| false);
            outer.pop();
            trace = g::normalized(Shape { outer, holes: shape.holes.clone() });
            if trace.outer.len() >= 3 && simple(&trace.outer) { break; }
            epsilon *= 0.5;
            if epsilon < 0.01 { trace = shape.clone(); break; }
        }
    }
    #[cfg(test)]
    CONTOUR_PAIRS.with(|pairs| {
        if refine && let Some(pairs) = &mut *pairs.borrow_mut() { pairs.push((shape.clone(), trace.clone(), if fallback { 0 } else { passes })); }
    });
    trace
}
/// Two corner-cutting passes, with bounded simplification afterwards.
pub(in super::super) fn curtain_trace(shape: &Shape) -> Shape {
    contour_trace(shape, 2, num(&data()["trace"], "maxDeviationM", 3.0).clamp(0.1, 5.0), true)
}
/// Hill towns keep their single, closer contour pass.
pub(in super::super) fn hill_trace(shape: &Shape, _cell: f64) -> Shape {
    contour_trace(shape, 1, num(&data()["trace"], "maxDeviationM", 3.0).clamp(0.1, 5.0), true)
}
/// A small settlement fits its quarters to its founding circuit. Keep that
/// accepted nucleus grammar; the metric refinement is for urban circuits.
pub(in super::super) fn village_trace(shape: &Shape, cell: f64, hill: bool) -> Shape {
    let tolerance = if hill { (g::area(shape).sqrt() * 0.01).clamp(1.5, 5.0).max(cell * 0.5) }
        else { (g::area(shape).sqrt() * 0.02).clamp(2.0, 10.0).max(cell * 0.75) };
    contour_trace(shape, if hill { 1 } else { 2 }, tolerance, false)
}

/// Length (m) of a closed ring that lies in water, sampled every 2 m.
pub(super) fn wet_length(ring: &[Point], surface: Surface<'_>) -> f64 {
    let n = ring.len();
    (0..n)
        .map(|i| {
            let (a, b) = (ring[i], ring[(i + 1) % n]);
            let l = dist(a, b);
            let k = (l / 2.0).ceil().max(1.0) as usize;
            (0..k)
                .filter(|&j| {
                    let t = (j as f64 + 0.5) / k as f64;
                    surface.wet(pt(a.x + (b.x - a.x) * t, a.y + (b.y - a.y) * t))
                })
                .count() as f64
                * l
                / k as f64
        })
        .sum()
}
/// A regular trace (bastioned, square) drawn over its founding outline `base`
/// never takes the curtain into water where the outline does not: wherever
/// the two differ over water the outline wins. Every bulge of the trace
/// outside the outline that reaches water is given back, and every notch of
/// the outline the trace cuts off over water is kept, so there the curtain
/// follows the outline (its banks and its river crossings). `None` when the
/// result still runs in water longer than the outline does.
fn off_water(trace: Shape, base: &Shape, surface: Surface<'_>) -> Option<Shape> {
    let wet = |b: &Shape| {
        let a = g::area(b);
        a > 1.0 && a - area(&g::dry_clip(&surface, b)) > 1.0
    };
    let wet_bulges: Vec<Shape> = g::difference(&trace, base)
        .into_iter()
        .filter(|b| wet(b))
        .collect();
    let wet_notches: Vec<Shape> = g::difference(base, &trace)
        .into_iter()
        .filter(|b| wet(b))
        .collect();
    let wet_bulges_n = wet_bulges.len() + wet_notches.len();
    let trace = if wet_bulges_n == 0 {
        trace
    } else {
        let kept = Cut::new(wet_bulges).from(vec![trace]);
        let kept = g::union(&kept.into_iter().chain(wet_notches).collect::<Vec<_>>());
        let largest = |v: Vec<Shape>| {
            v.into_iter()
                .max_by(|x, y| g::area(x).total_cmp(&g::area(y)))
        };
        // An opening by 1 m drops the zero-width spikes the overlay leaves
        // where a bulge met the outline at a point.
        let best = largest(kept)?;
        let best = largest(buffer(&best, -1.0)).and_then(|s| largest(buffer(&s, 1.0)))?;
        let mut ring = best.outer.clone();
        ring.push(ring[0]);
        let mut ring = g::simplify(&ring, 0.5, |_| false);
        ring.pop();
        g::normalized(Shape {
            outer: ring,
            holes: vec![],
        })
    };
    let base_ring = &base.outer;
    let (wt, wb) = (
        wet_length(&trace.outer, surface),
        wet_length(base_ring, surface),
    );
    if std::env::var("URBAN_PROFILE").is_ok() {
        eprintln!(
            "  off_water: {} bulges and notches given back, wet {wt:.0} m (outline {wb:.0} m), simple {}",
            wet_bulges_n,
            g::simple(&trace),
        );
    }
    (trace.outer.len() >= 3 && g::simple(&trace) && wt <= wb + 20.0).then_some(trace)
}
/// Box of `shape` in the frame turned by `angle`: its four corners and area.
fn framed_box(shape: &Shape, angle: f64) -> (Vec<Point>, f64) {
    let (u, v) = ((angle.cos(), angle.sin()), (-angle.sin(), angle.cos()));
    let (mut a0, mut a1, mut b0, mut b1) = (f64::INFINITY, f64::NEG_INFINITY, f64::INFINITY, f64::NEG_INFINITY);
    for p in &shape.outer {
        let (a, b) = (p.x * u.0 + p.y * u.1, p.x * v.0 + p.y * v.1);
        (a0, a1, b0, b1) = (a0.min(a), a1.max(a), b0.min(b), b1.max(b));
    }
    let at = |a: f64, b: f64| pt(a * u.0 + b * v.0, a * u.1 + b * v.1);
    (vec![at(a0, b0), at(a1, b0), at(a1, b1), at(a0, b1)], (a1 - a0).max(0.0) * (b1 - b0).max(0.0))
}
/// Square trace of a planned (Chinese) city: the rectangle around the founding
/// outline in the axes of its street grid (`grid`, the macro plan's frame), else
/// on the compass (`cardinal`) or the outline's tightest box; kept when it
/// encloses at most 1.5 times the founding land and stays out of the water
/// (`off_water`).
pub(in super::super) fn square_trace(shape: &Shape, surface: Surface<'_>, cardinal: bool, force: bool, grid: Option<f64>) -> Option<Shape> {
    use geo::MinimumRotatedRect;
    let plain = Shape {
        outer: shape.outer.clone(),
        holes: vec![],
    };
    // The wall runs on the axes of the grid it encloses: a wall turned against
    // its street plan leaves empty wedges along every front. The grid's box is
    // taken while it stays nearly as tight as the outline's tightest box; else a
    // cardinal culture keeps the compass while its box stays nearly as tight, and
    // any other plan its tightest box.
    let turned = g::polygon(&plain).minimum_rotated_rect()?;
    let tight = g::area(&g::shapes(geo::MultiPolygon(vec![turned.clone()]))[0]);
    let gridded = grid.map(|a| framed_box(&plain, a)).filter(|b| b.1 <= 1.15 * tight);
    let (x0, y0, x1, y1) = g::bbox(&plain);
    let c: Vec<Point> = if let Some((c, _)) = gridded {
        c
    } else if cardinal && (x1 - x0) * (y1 - y0) <= 1.15 * tight {
        vec![pt(x0, y0), pt(x1, y0), pt(x1, y1), pt(x0, y1)]
    } else {
        turned.exterior().0.iter().take(4).map(|p| pt(p.x, p.y)).collect()
    };
    if c.len() < 4 { return None; }
    // 2 m of clearance along the rectangle's own axes, corners kept square.
    let (u, v) = (unit(dir(c[0], c[1])), unit(dir(c[0], c[3])));
    let grow = |p: Point, su: f64, sv: f64| add(add(p, u, 2.0 * su), v, 2.0 * sv);
    let rect = g::normalized(Shape {
        outer: vec![grow(c[0], -1.0, -1.0), grow(c[1], 1.0, -1.0), grow(c[2], 1.0, 1.0), grow(c[3], -1.0, 1.0)],
        holes: vec![],
    });
    // `force` (plannedWall: rect) keeps the plan's rectangle even where it walls
    // empty land; water corners are still given back below.
    if !force && g::area(&rect) > 1.5 * g::area(&plain) {
        return None;
    }
    // Only the water the corners reach is given back: the front then follows the
    // bank there. Against the bare outline the 2 m clearance joins every corner
    // into one ring, and returning that wet ring returned the whole rectangle.
    let corners = buffer(&plain, 3.0).first().map_or(vec![], |near| g::difference(&rect, near));
    let wet: Vec<Shape> = corners.iter().flat_map(|b| {
        let dry = g::dry_clip(&surface, b);
        dry.iter().fold(vec![b.clone()], |left, d| left.iter().flat_map(|l| g::difference(l, d)).collect())
    }).filter(|w| g::area(w) > 200.0).collect();
    let trace = if wet.is_empty() { rect } else {
        let kept = Cut::new(wet).from(vec![rect]);
        let best = kept.into_iter().max_by(|x, y| g::area(x).total_cmp(&g::area(y)))?;
        let mut ring = g::simplify(&closed(&best.outer), 2.0, |_| false);
        ring.pop();
        g::normalized(Shape { outer: ring, holes: vec![] })
    };
    // `off_water`'s final checks: a simple ring crossing hardly more water than
    // the town (a straight front crosses a river at a slant: water gates).
    let (wt, wb) = (wet_length(&trace.outer, surface), wet_length(&plain.outer, surface));
    // A forced plan rectangle keeps its river crossings (water gates).
    (trace.outer.len() >= 3 && g::simple(&trace) && (force || wt <= wb * 1.25 + 20.0)).then_some(trace)
}

/// Bastioned trace: long straight fronts between salients, at least 98 % of
/// the founding land inside, never in water (`off_water`). `None` when the
/// outline does not allow it.
pub(in super::super) fn bastioned_trace(shape: &Shape, surface: Surface<'_>) -> Option<Shape> {
    let a = g::area(shape);
    let t = (0.04 * a.sqrt()).clamp(12.0, 40.0);
    let plain = Shape {
        outer: shape.outer.clone(),
        holes: vec![],
    };
    let grown = buffer(&plain, t * 0.5)
        .into_iter()
        .max_by(|x, y| g::area(x).total_cmp(&g::area(y)))?;
    let mut ring = grown.outer.clone();
    ring.push(ring[0]);
    let mut ring = g::simplify(&ring, t, |_| false);
    ring.pop();
    while ring.len() > 5 {
        let n = ring.len();
        let short = |i: usize| {
            dist(ring[(i + n - 1) % n], ring[i]) < 80.0 || dist(ring[i], ring[(i + 1) % n]) < 80.0
        };
        let Some(k) = (0..n)
            .filter(|&i| short(i))
            .min_by(|&x, &y| turn_at(&ring, x).total_cmp(&turn_at(&ring, y)))
        else {
            break;
        };
        ring.remove(k);
    }
    let trace = off_water(
        g::normalized(Shape {
            outer: ring,
            holes: vec![],
        }),
        &plain,
        surface,
    )?;
    let covered = area(&g::intersection(&trace, &plain));
    if std::env::var("URBAN_PROFILE").is_ok() {
        eprintln!(
            "  bastioned trace: {} vertices, covers {:.3} of the outline",
            trace.outer.len(),
            covered / g::area(&plain)
        );
    }
    (trace.outer.len() >= 3 && g::simple(&trace) && covered >= 0.98 * g::area(&plain))
        .then_some(trace)
}
