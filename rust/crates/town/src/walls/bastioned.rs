//! The bastioned trace: long straight fronts between salients around the town, and
//! the water rule shared by every regular trace drawn over a founding outline.

use magna_urbis_geom::{self as g, Shape, surface::TerrainView};

use super::geometry::{area_of, buffer, closed, dist, largest, subtract, turn_at, wet_length};

/// Fronts shorter than this (metres) lose their flattest end vertex.
const MIN_FRONT: f64 = 80.0;

/// Long straight fronts between salients around `shape`: the outline grown by half
/// a tolerance of 4 % of its width (12 to 40 m) and simplified by that tolerance,
/// short fronts merged, with at least 98 % of the founding land inside and never in
/// water where the outline is not. `None` when the outline does not allow it.
pub fn bastioned_trace(shape: &Shape, terrain: &dyn TerrainView) -> Option<Shape> {
    let t = (0.04 * g::area(shape).sqrt()).clamp(12.0, 40.0);
    let plain = Shape {
        outer: shape.outer.clone(),
        holes: vec![],
    };
    let grown = largest(buffer(&plain, t * 0.5))?;
    let mut ring = g::simplify(&closed(&grown.outer), t, |_| false);
    ring.pop();
    while ring.len() > 5 {
        let n = ring.len();
        let short = |i: usize| {
            dist(ring[(i + n - 1) % n], ring[i]) < MIN_FRONT
                || dist(ring[i], ring[(i + 1) % n]) < MIN_FRONT
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
        terrain,
    )?;
    let covered = area_of(&g::intersection(&trace, &plain));
    (trace.outer.len() >= 3 && g::simple(&trace) && covered >= 0.98 * g::area(&plain))
        .then_some(trace)
}

/// A regular trace drawn over its founding outline `base` never takes the curtain
/// into water where the outline does not: every bulge of the trace beyond the outline
/// that reaches water is given back, and every notch of the outline the trace cuts off
/// over water is kept, so there the curtain follows the outline (its banks and its
/// river crossings). `None` when the result still runs in water more than 20 m longer
/// than the outline does.
fn off_water(trace: Shape, base: &Shape, terrain: &dyn TerrainView) -> Option<Shape> {
    let wet = |b: &Shape| {
        let a = g::area(b);
        a > 1.0 && a - area_of(&terrain.dry_clip(b)) > 1.0
    };
    let bulges: Vec<Shape> = g::difference(&trace, base)
        .into_iter()
        .filter(|b| wet(b))
        .collect();
    let notches: Vec<Shape> = g::difference(base, &trace)
        .into_iter()
        .filter(|b| wet(b))
        .collect();
    let trace = if bulges.is_empty() && notches.is_empty() {
        trace
    } else {
        let kept = subtract(vec![trace], &bulges);
        let kept = g::union(&kept.into_iter().chain(notches).collect::<Vec<_>>());
        // An opening by 1 m drops the zero-width spikes the overlay leaves where a
        // bulge met the outline at a point.
        let best = largest(kept)?;
        let best = largest(buffer(&best, -1.0)).and_then(|s| largest(buffer(&s, 1.0)))?;
        let mut ring = g::simplify(&closed(&best.outer), 0.5, |_| false);
        ring.pop();
        g::normalized(Shape {
            outer: ring,
            holes: vec![],
        })
    };
    let (wt, wb) = (
        wet_length(&trace.outer, terrain),
        wet_length(&base.outer, terrain),
    );
    (trace.outer.len() >= 3 && g::simple(&trace) && wt <= wb + 20.0).then_some(trace)
}
