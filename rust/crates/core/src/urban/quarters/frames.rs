//! Bounding frames and planned grid alignment from outlines and streets.

use super::streets::len;
use crate::urban::{Point, Shape, Street, geometry as g};
use std::f64::consts::FRAC_PI_2;

#[derive(Clone, Copy)]
pub(super) struct Frame {
    pub(super) c: Point,
    pub(super) u: Point,
    pub(super) v: Point,
    pub(super) hu: f64,
    pub(super) hv: f64,
}
pub(super) fn frame(s: &Shape) -> Frame {
    let mut best = None;
    let mut ba = f64::INFINITY;
    for i in 0..s.outer.len() {
        let a = s.outer[i];
        let b = s.outer[(i + 1) % s.outer.len()];
        let l = (b.x - a.x).hypot(b.y - a.y);
        if l < 1e-8 {
            continue;
        }
        let u = Point {
            x: (b.x - a.x) / l,
            y: (b.y - a.y) / l,
        };
        let v = Point { x: -u.y, y: u.x };
        let (mut x0, mut y0, mut x1, mut y1) = (
            f64::INFINITY,
            f64::INFINITY,
            f64::NEG_INFINITY,
            f64::NEG_INFINITY,
        );
        for p in &s.outer {
            let x = p.x * u.x + p.y * u.y;
            let y = p.x * v.x + p.y * v.y;
            x0 = x0.min(x);
            x1 = x1.max(x);
            y0 = y0.min(y);
            y1 = y1.max(y)
        }
        let ar = (x1 - x0) * (y1 - y0);
        if ar < ba {
            ba = ar;
            let mut f = Frame {
                c: Point {
                    x: u.x * (x0 + x1) * 0.5 + v.x * (y0 + y1) * 0.5,
                    y: u.y * (x0 + x1) * 0.5 + v.y * (y0 + y1) * 0.5,
                },
                u,
                v,
                hu: (x1 - x0) * 0.5,
                hv: (y1 - y0) * 0.5,
            };
            if f.hu < f.hv {
                std::mem::swap(&mut f.u, &mut f.v);
                std::mem::swap(&mut f.hu, &mut f.hv)
            }
            best = Some(f)
        }
    }
    best.unwrap_or(Frame {
        c: g::centroid(s),
        u: Point { x: 1.0, y: 0.0 },
        v: Point { x: 0.0, y: 1.0 },
        hu: 0.0,
        hv: 0.0,
    })
}
pub(in crate::urban) fn outline_frame(s: &Shape) -> f64 {
    let f = frame(s);
    f.u.y.atan2(f.u.x)
}
/// Frame of a planned grid inside an enceinte. A polygonal curtain (an octagon,
/// a trace bent by the river) may run mostly on axes its tightest box misses:
/// the grid then takes the curtain's dominant axes (length-weighted mean edge
/// direction modulo a right angle) when they fit the curtain clearly better,
/// turned to the axis nearest the box's long side. A rectangle keeps its box.
pub(in crate::urban) fn enclosure_frame(s: &Shape) -> f64 {
    let boxed = outline_frame(s);
    let n = s.outer.len();
    let (mut c, mut si, mut total) = (0.0, 0.0, 0.0);
    for i in 0..n {
        let (a, b) = (s.outer[i], s.outer[(i + 1) % n]);
        let l = (b.x - a.x).hypot(b.y - a.y);
        let t = 4.0 * (b.y - a.y).atan2(b.x - a.x);
        (c, si, total) = (c + l * t.cos(), si + l * t.sin(), total + l);
    }
    if total <= 0.0 {
        return boxed;
    }
    // Share of the curtain on the axes of frame `a`, in [-1, 1].
    let fit = |a: f64| (c * (4.0 * a).cos() + si * (4.0 * a).sin()) / total;
    let dominant = si.atan2(c) / 4.0;
    if fit(dominant) <= fit(boxed) + 0.05 {
        return boxed;
    }
    dominant + ((boxed - dominant) / FRAC_PI_2).round() * FRAC_PI_2
}

/// Orientation of a planned grid's armature: the straight quarter street
/// nearest the lattice origin, taken modulo a right angle, on the side
/// closest to the field's own grid orientation `hint`.
pub(super) fn armature_frame(streets: &[Street], origin: Point, hint: f64) -> Option<f64> {
    streets
        .iter()
        .filter(|s| s.role == "street" && s.rank <= 1 && s.path.len() == 2)
        .filter(|s| len(&s.path) > 20.0)
        .min_by(|a, b| {
            g::distance(origin, a.path[0], a.path[1])
                .0
                .total_cmp(&g::distance(origin, b.path[0], b.path[1]).0)
        })
        .map(|s| {
            let t = (s.path[1].y - s.path[0].y).atan2(s.path[1].x - s.path[0].x);
            [t, t + FRAC_PI_2]
                .into_iter()
                .max_by(|a, b| (a - hint).cos().abs().total_cmp(&(b - hint).cos().abs()))
                .unwrap()
        })
}
