//! Render-side geometry of the V2 map, ported from the TypeScript renderer
//! (`web/src/render`): the city ground clipped by the physical water
//! (`city_ground`), the signed coastal distance fields (`coast`) and the
//! multi-level contour lines (`contours`). The WASM bindings live in
//! `rust/crates/wasm/src/render_geometry.rs`, the TS client in
//! `rust/bridge/renderGeometry.ts`.
//!
//! Shapes cross the boundary as one flat `f64` list:
//! `[shapes, (rings, (points, x0, y0, x1, y1, ...)*)*]`, the first ring of a
//! shape being its outer ring (open rings, no repeated closing point).

pub mod city_ground;
pub mod coast;
pub mod contours;

/// An open ring of `[x, y]` points.
pub type Ring = Vec<[f64; 2]>;
/// Outer ring first, then the holes.
pub type Shape = Vec<Ring>;

/// Reads one shape list from `data` starting at `*at` (advanced past it).
/// Malformed (truncated) input yields the shapes read so far.
pub fn read_shapes(data: &[f64], at: &mut usize) -> Vec<Shape> {
    let take = |at: &mut usize| -> Option<usize> {
        let v = *data.get(*at)?;
        *at += 1;
        (v.is_finite() && v >= 0.0).then_some(v as usize)
    };
    let Some(count) = take(at) else { return Vec::new() };
    let mut shapes = Vec::with_capacity(count.min(1 << 20));
    for _ in 0..count {
        let Some(rings) = take(at) else { break };
        let mut shape = Vec::with_capacity(rings.min(1 << 16));
        for _ in 0..rings {
            let Some(points) = take(at) else { return shapes };
            if *at + 2 * points > data.len() {
                *at = data.len();
                return shapes;
            }
            let ring: Ring = data[*at..*at + 2 * points].chunks_exact(2).map(|p| [p[0], p[1]]).collect();
            *at += 2 * points;
            shape.push(ring);
        }
        shapes.push(shape);
    }
    shapes
}

/// Appends one shape list to `out` (the format of `read_shapes`).
pub fn write_shapes(shapes: &[Shape], out: &mut Vec<f64>) {
    out.push(shapes.len() as f64);
    for shape in shapes {
        out.push(shape.len() as f64);
        for ring in shape {
            out.push(ring.len() as f64);
            for p in ring {
                out.push(p[0]);
                out.push(p[1]);
            }
        }
    }
}

/// Shoelace signed area (positive = counter-clockwise in a y-up frame), as
/// `polygonArea` in web/src/gen/core/geom.ts.
pub fn signed_area(ring: &[[f64; 2]]) -> f64 {
    let n = ring.len();
    let mut s = 0.0;
    for i in 0..n {
        let a = ring[i];
        let b = ring[(i + 1) % n];
        s += a[0] * b[1] - b[0] * a[1];
    }
    s / 2.0
}

/// The ring with a positive signed area (`orientPos`).
pub fn orient_positive(mut ring: Ring) -> Ring {
    if signed_area(&ring) < 0.0 {
        ring.reverse();
    }
    ring
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn shape_lists_round_trip() {
        let shapes: Vec<Shape> = vec![
            vec![vec![[0.0, 0.0], [1.0, 0.0], [1.0, 1.0]]],
            vec![vec![[0.0, 0.0], [4.0, 0.0], [4.0, 4.0], [0.0, 4.0]], vec![[1.0, 1.0], [2.0, 1.0], [2.0, 2.0]]],
        ];
        let mut flat = Vec::new();
        write_shapes(&shapes, &mut flat);
        let mut at = 0;
        assert_eq!(read_shapes(&flat, &mut at), shapes);
        assert_eq!(at, flat.len());
    }
}
