//! Polygon operations for classic and clipping against the town surface.
use super::{Shape, Surface};
use magna_urbis_geom::difference_many;

pub(super) use magna_urbis_geom::{
    BoxGrid, ContainmentIndex, Region, area, band_edges, band_within, bbox, boxes_meet, centroid,
    cleaned, contains, difference, distance, interior_point, intersection, normalized, polygon,
    rectangle, ribbon, segment_hit, segment_within, shapes, signed, simple, simple_around, simplify,
    split, touching_side, union, unneedled,
};
#[allow(unused_imports)]
pub(super) use magna_urbis_geom::{BandEdges, overlay_fallbacks};

/// `URBAN_GEOMETRY_REFERENCE=1` enables per-position searches for comparison
/// with the sweep.
pub(super) fn reference_search() -> bool {
    static FLAG: std::sync::OnceLock<bool> = std::sync::OnceLock::new();
    *FLAG.get_or_init(|| std::env::var("URBAN_GEOMETRY_REFERENCE").is_ok_and(|v| v == "1"))
}

/// Clip only the site's local raster window; run-length water cells are unioned before subtraction.
pub(super) fn dry_clip(surface: &Surface<'_>, s: &Shape) -> Vec<Shape> {
    let land = intersection(s, &rectangle(0.0, 0.0, surface.width, surface.width));
    if let Some(geometry) = surface.geometry {
        return land.iter().flat_map(|s| geometry.clip(s)).collect();
    }
    if surface.n == 0 || surface.water.is_empty() {
        return land;
    }
    let cell = surface.width / surface.n as f64;
    let (x0, y0, x1, y1) = bbox(s);
    let ix0 = (x0 / cell).floor().max(0.0) as usize;
    let iy0 = (y0 / cell).floor().max(0.0) as usize;
    let ix1 = ((x1 / cell).ceil() as usize).min(surface.n);
    let iy1 = ((y1 / cell).ceil() as usize).min(surface.n);
    let mut wet = vec![];
    for y in iy0..iy1 {
        let mut x = ix0;
        while x < ix1 {
            if surface.water.get(y * surface.n + x).copied().unwrap_or(0) == 0 {
                x += 1;
                continue;
            }
            let a = x;
            while x < ix1 && surface.water[y * surface.n + x] != 0 {
                x += 1
            }
            wet.push(rectangle(
                a as f64 * cell,
                y as f64 * cell,
                x as f64 * cell,
                (y + 1) as f64 * cell,
            ));
        }
    }
    if wet.is_empty() {
        return land;
    }
    let water = union(&wet);
    land.into_iter()
        .flat_map(|p| difference_many(&p, &water))
        .collect()
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn raster_water_clips_a_polygon_with_a_hole() {
        let mut shape = rectangle(0.0, 0.0, 100.0, 100.0);
        shape.holes.push(rectangle(65.0, 20.0, 85.0, 40.0).outer);
        let heights = vec![0.0; 100];
        let mut water = vec![0; 100];
        for y in 0..10 {
            water[y * 10 + 4] = 1;
        }
        let surface = Surface {
            geometry: None,
            width: 100.0,
            n: 10,
            height: &heights,
            water: &water,
            interpolation: Default::default(),
        };
        let pieces = dry_clip(&surface, &shape);
        assert!((pieces.iter().map(area).sum::<f64>() - 8600.0).abs() < 0.01);
        assert_eq!(pieces.len(), 2);
    }
}

#[cfg(test)]
#[path = "geometry_conversion_topology_tests.rs"]
mod conversion_topology_tests;
