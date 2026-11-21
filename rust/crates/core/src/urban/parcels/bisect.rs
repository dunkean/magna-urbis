//! Recursive area cuts for compact lots and constrained recuts.

use super::contacts::{Front, frontage};
use super::cut_geometry::{bounds, dot, half, half_area, length, normal, sub, unit};
use crate::rng::Rng;
use crate::urban::{Morph, Point, Shape};
use crate::urban::geometry::area;

fn minimum_angle(shape: &Shape) -> f64 {
    let mut angle = std::f64::consts::PI;
    for i in 0..shape.outer.len() {
        let p = shape.outer[i];
        let a = unit(sub(
            shape.outer[(i + shape.outer.len() - 1) % shape.outer.len()],
            p,
        ));
        let b = unit(sub(shape.outer[(i + 1) % shape.outer.len()], p));
        let convex_angle = dot(a, b).clamp(-1.0, 1.0).acos();
        let interior_angle = if a.x * b.y - a.y * b.x > 0.0 {
            std::f64::consts::TAU - convex_angle
        } else {
            convex_angle
        };
        angle = angle.min(interior_angle);
    }
    angle
}

/// Recursive area bisection: each cut tries both axes and several area shares,
/// and is kept only when every child is a sound lot (area, width, aspect, angle,
/// its own street). A cell no cut can divide stays whole. Nothing is left over
/// and no bad child is ever drawn, whatever the shape of the ground.
pub(super) fn bisect(
    shape: &Shape,
    axis: Point,
    fronts: &[Front],
    morph: &Morph,
    zone: &str,
    rng: &mut Rng,
) -> Vec<Shape> {
    let [amin, amax] = morph.range("houseArea", zone);
    let amin = amin.max(20.0);
    let amax = amax.max(amin);
    let min_width = (amin.sqrt() * 0.55)
        .max(6.0)
        .max(morph.range("frontage", zone)[0]);
    let chinese = morph.text("plotOp") == "siheyuan";
    let mut queue = vec![shape.clone()];
    let mut done = Vec::new();
    let mut guard = 0;
    while let Some(cell) = queue.pop() {
        guard += 1;
        if guard > 4000 {
            done.push(cell);
            done.extend(queue);
            break;
        }
        let cell_area = area(&cell);
        let target = amin * (amax / amin).powf(rng.float());
        if cell_area <= target * 1.3 {
            done.push(cell);
            continue;
        }
        let v = normal(axis);
        let (u0, u1) = bounds(&cell, axis);
        let (v0, v1) = bounds(&cell, v);
        let directions = if u1 - u0 >= v1 - v0 {
            [axis, v]
        } else {
            [v, axis]
        };
        let fraction = rng
            .fork(&format!("split-position:{guard}"))
            .range(0.42, 0.58);
        let mut best = None;
        let mut score = f64::INFINITY;
        // Both admissible orientations are evaluated; each cut position is the
        // one that splits the *area* at the tried fraction (bisection on the
        // exact half-plane area), never a fraction of the projected box.
        for (di, d) in directions.into_iter().enumerate() {
            let (lo, hi) = bounds(&cell, d);
            for fraction_try in [fraction, 0.5, 0.43, 0.57, 0.36, 0.64] {
                let want = cell_area * fraction_try;
                let (mut a, mut b) = (lo, hi);
                for _ in 0..40 {
                    let m = 0.5 * (a + b);
                    if half_area(&cell, d, m) < want {
                        a = m;
                    } else {
                        b = m;
                    }
                    if b - a < 0.01 {
                        break;
                    }
                }
                let at = 0.5 * (a + b);
                let x = half(&cell, d, at, true);
                let y = half(&cell, d, at, false);
                // A concave cut may have several disconnected components. Keep
                // those exact pieces only when every component retains access.
                if x.is_empty() || y.is_empty() {
                    continue;
                }
                let parts: Vec<Shape> = x.into_iter().chain(y).collect();
                let mut valid = true;
                let mut aspect_penalty = 0.0;
                for p in &parts {
                    let (len, f) = frontage(p, fronts);
                    let (a, b) = bounds(p, axis);
                    let (c, d) = bounds(p, v);
                    let width = (b - a).min(d - c);
                    let aspect = (b - a).max(d - c) / width.max(1e-9);
                    if area(p) < amin * 0.55
                        || len < 3.5
                        || width < min_width
                        || aspect > 4.5
                        || minimum_angle(p) < if chinese { 12.0_f64.to_radians() } else { 0.35 }
                        || (chinese && f.is_none_or(|f| length(sub(f.b, f.a)) < 12.0))
                    {
                        valid = false;
                        break;
                    }
                    aspect_penalty += (aspect - 2.0).max(0.0) * 0.3;
                }
                if !valid {
                    continue;
                }
                let largest = parts.iter().map(area).fold(0.0, f64::max);
                let smallest = parts.iter().map(area).fold(f64::INFINITY, f64::min);
                let s = 0.3 * (largest - smallest) / cell_area
                    + di as f64 * 0.35
                    + (fraction_try - fraction).abs()
                    + aspect_penalty;
                if s < score {
                    score = s;
                    best = Some(parts);
                }
            }
        }
        if let Some(parts) = best {
            queue.extend(parts);
        } else {
            done.push(cell);
        }
    }
    done
}
