//! JavaScript bindings of the render-side geometry (`magna_urbis_core::render_geometry`),
//! called synchronously by the TS renderer through `rust/bridge/renderGeometry.ts`
//! (single-thread package on the main thread and in the render workers).
//! Shapes travel as the flat f64 lists of `render_geometry::read_shapes`.

use magna_urbis_core::render_geometry::{city_ground, coast, contours, read_shapes, write_shapes};
use wasm_bindgen::prelude::*;

/// Canal pieces of a city's vector water: each group (a "shape" of the input
/// list whose rings are the group's rings) xor-ed. Returns a shape list.
#[wasm_bindgen]
pub fn render_city_canals(groups: &[f64]) -> Vec<f64> {
    let groups = read_shapes(groups, &mut 0);
    let mut out = Vec::new();
    write_shapes(&city_ground::canal_shapes(&groups), &mut out);
    out
}

/// `CityGround.clip` of many subjects. `canals`: a shape list from
/// `render_city_canals`. Returns, per subject, -1 when the subject is unchanged,
/// otherwise its pieces as a shape list (piece count first).
#[wasm_bindgen]
pub fn render_city_ground_clip(n: usize, width: f64, water: &[u8], canals: &[f64], subjects: &[f64]) -> Vec<f64> {
    let ground = city_ground::CityGround::new(city_ground::GroundRaster { n, width, water }, read_shapes(canals, &mut 0));
    let subjects = read_shapes(subjects, &mut 0);
    let mut out = Vec::new();
    for subject in &subjects {
        match ground.clip(subject) {
            city_ground::Clipped::Unchanged => out.push(-1.0),
            city_ground::Clipped::Pieces(pieces) => write_shapes(&pieces, &mut out),
        }
    }
    out
}

/// Signed distance to the zero contour of an n × n field, capped at `band`
/// (`coastDistances` of web/src/render/terrainSea.ts).
#[wasm_bindgen]
pub fn render_coast_distances(height: &[f32], n: usize, cell: f64, band: f64) -> Vec<f32> {
    coast::coast_distances(height, n, cell, band)
}

/// Contour lines of several levels. Returns, per level, the path count then
/// per path `closed (0/1), points, x0, y0, ...`.
#[wasm_bindgen]
pub fn render_contour_levels(field: &[f32], w: usize, h: usize, levels: &[f64], cell: f64, ox: f64, oy: f64) -> Vec<f64> {
    let mut out = Vec::new();
    for paths in contours::contour_levels(field, w, h, levels, cell, ox, oy) {
        out.push(paths.len() as f64);
        for path in paths {
            out.push(if path.closed { 1.0 } else { 0.0 });
            out.push(path.pts.len() as f64);
            for p in path.pts {
                out.push(p[0]);
                out.push(p[1]);
            }
        }
    }
    out
}
