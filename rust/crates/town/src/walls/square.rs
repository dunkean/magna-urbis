//! The square trace of a planned town: a rectangle in the axes of its street grid,
//! on the compass, or the outline's tightest box, with water corners given back.

use magna_urbis_geom::{self as g, Point, Shape, surface::TerrainView};

use super::geometry::{
    add, buffer, closed, dir, framed_box, largest, min_rotated_rect, pt, subtract, unit, wet_length,
};

/// The rectangle around `shape`, kept when it encloses at most 1.5 times its land
/// (unless `force`) and crosses hardly more water than the outline does. The frame
/// is the street grid's (`grid`, radians) while its box stays within 15 % of the
/// tightest box; else the compass for a `cardinal` culture under the same bound;
/// else the tightest box. Corners that reach water are given back, so the front
/// follows the bank there. `None` when no such rectangle fits.
pub fn square_trace(
    shape: &Shape,
    terrain: &dyn TerrainView,
    cardinal: bool,
    force: bool,
    grid: Option<f64>,
) -> Option<Shape> {
    let plain = Shape {
        outer: shape.outer.clone(),
        holes: vec![],
    };
    let (turned, tight) = min_rotated_rect(&plain.outer)?;
    let gridded = grid
        .map(|a| framed_box(&plain.outer, a))
        .filter(|b| b.1 <= 1.15 * tight);
    let (x0, y0, x1, y1) = g::bbox(&plain);
    let c: Vec<Point> = if let Some((c, _)) = gridded {
        c
    } else if cardinal && (x1 - x0) * (y1 - y0) <= 1.15 * tight {
        vec![pt(x0, y0), pt(x1, y0), pt(x1, y1), pt(x0, y1)]
    } else {
        turned
    };
    // 2 m of clearance along the rectangle's own axes, corners kept square.
    let (u, v) = (unit(dir(c[0], c[1])), unit(dir(c[0], c[3])));
    let grow = |p: Point, su: f64, sv: f64| add(add(p, u, 2.0 * su), v, 2.0 * sv);
    let rect = g::normalized(Shape {
        outer: vec![
            grow(c[0], -1.0, -1.0),
            grow(c[1], 1.0, -1.0),
            grow(c[2], 1.0, 1.0),
            grow(c[3], -1.0, 1.0),
        ],
        holes: vec![],
    });
    if !force && g::area(&rect) > 1.5 * g::area(&plain) {
        return None;
    }
    // Only the water the corners reach is given back: the corners are the rectangle
    // beyond 3 m of the outline (nearer, the clearance would join them in one ring).
    let corners =
        largest(buffer(&plain, 3.0)).map_or_else(Vec::new, |near| g::difference(&rect, &near));
    let wet: Vec<Shape> = corners
        .iter()
        .flat_map(|b| subtract(vec![b.clone()], &terrain.dry_clip(b)))
        .filter(|w| g::area(w) > 200.0)
        .collect();
    let trace = if wet.is_empty() {
        rect
    } else {
        let best = largest(subtract(vec![rect], &wet))?;
        let mut ring = g::simplify(&closed(&best.outer), 2.0, |_| false);
        ring.pop();
        g::normalized(Shape {
            outer: ring,
            holes: vec![],
        })
    };
    // A straight front crosses a river at a slant (water gates): a little more water
    // than the outline is allowed; a forced plan rectangle keeps all its crossings.
    let (wt, wb) = (
        wet_length(&trace.outer, terrain),
        wet_length(&plain.outer, terrain),
    );
    (trace.outer.len() >= 3 && g::simple(&trace) && (force || wt <= wb * 1.25 + 20.0))
        .then_some(trace)
}

/// Dominant street direction of a set of blocks in radians (modulo a quarter turn),
/// when their sides agree on one: the length-weighted mean of four times each side's
/// angle, kept when its resultant holds at least half the total length.
pub fn grid_frame(shapes: &[Shape]) -> Option<f64> {
    let (mut c, mut s, mut total) = (0.0, 0.0, 0.0);
    for shape in shapes {
        let n = shape.outer.len();
        for i in 0..n {
            let (a, b) = (shape.outer[i], shape.outer[(i + 1) % n]);
            let l = (b.x - a.x).hypot(b.y - a.y);
            let t = 4.0 * (b.y - a.y).atan2(b.x - a.x);
            (c, s, total) = (c + l * t.cos(), s + l * t.sin(), total + l);
        }
    }
    (total > 0.0 && c.hypot(s) >= 0.5 * total).then(|| s.atan2(c) / 4.0)
}
