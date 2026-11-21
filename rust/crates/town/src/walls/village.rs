//! Contour traces: the founding outline with its corners cut, then simplified by a
//! metric tolerance. No hull and no minimum front length: the outline supplies the curves.

use magna_urbis_geom::{self as g, Point, Shape};

use super::geometry::{closed, pt};

/// Simplification bound of an urban contour trace in metres (classic `trace.maxDeviationM`).
const MAX_DEVIATION: f64 = 3.0;

fn ring_simple(r: &[Point]) -> bool {
    g::simple(&Shape {
        outer: r.to_vec(),
        holes: vec![],
    })
}

/// `passes` rounds of corner cutting (each side keeps its quarter points), then
/// Douglas-Peucker at `tolerance` metres. With `refine`, a cut that crosses a thin
/// neck falls back to the founding contour, simplified less until it stays simple.
fn contour_trace(shape: &Shape, passes: usize, tolerance: f64, refine: bool) -> Shape {
    let mut ring = shape.outer.clone();
    for _ in 0..passes {
        let n = ring.len();
        ring = (0..n)
            .flat_map(|i| {
                let (a, b) = (ring[i], ring[(i + 1) % n]);
                [
                    pt(a.x * 0.75 + b.x * 0.25, a.y * 0.75 + b.y * 0.25),
                    pt(a.x * 0.25 + b.x * 0.75, a.y * 0.25 + b.y * 0.75),
                ]
            })
            .collect();
    }
    let mut outer = g::simplify(&closed(&ring), tolerance, |_| false);
    outer.pop();
    if outer.len() < 3 {
        return shape.clone();
    }
    let trace = g::normalized(Shape {
        outer,
        holes: shape.holes.clone(),
    });
    if !(refine && !ring_simple(&trace.outer) && ring_simple(&shape.outer)) {
        return trace;
    }
    let founding = closed(&shape.outer);
    let mut epsilon = tolerance;
    loop {
        let mut outer = g::simplify(&founding, epsilon, |_| false);
        outer.pop();
        let trace = g::normalized(Shape {
            outer,
            holes: shape.holes.clone(),
        });
        if trace.outer.len() >= 3 && ring_simple(&trace.outer) {
            return trace;
        }
        epsilon *= 0.5;
        if epsilon < 0.01 {
            return shape.clone();
        }
    }
}

/// An urban circuit: two corner-cutting passes, at most 3 m off the outline.
pub fn curtain_trace(shape: &Shape) -> Shape {
    contour_trace(shape, 2, MAX_DEVIATION, true)
}

/// A hill town keeps a single, closer contour pass.
pub fn hill_trace(shape: &Shape) -> Shape {
    contour_trace(shape, 1, MAX_DEVIATION, true)
}

/// A small settlement's circuit fitted to its founding outline: straight runs between
/// corners at most 2 % of the town's width off the land (1 % on a hill), never finer
/// than the terrain raster (`cell`, metres), so a bank's stair steps are not followed.
pub fn village_trace(shape: &Shape, cell: f64, hill: bool) -> Shape {
    let width = g::area(shape).sqrt();
    let tolerance = if hill {
        (width * 0.01).clamp(1.5, 5.0).max(cell * 0.5)
    } else {
        (width * 0.02).clamp(2.0, 10.0).max(cell * 0.75)
    };
    contour_trace(shape, if hill { 1 } else { 2 }, tolerance, false)
}

/// The polygonal fit of a growth outline: the village trace for a small settlement,
/// the urban curtain trace otherwise.
pub fn polygonal_fit(shape: &Shape, cell: f64, small: bool) -> Shape {
    if small {
        village_trace(shape, cell, false)
    } else {
        curtain_trace(shape)
    }
}
