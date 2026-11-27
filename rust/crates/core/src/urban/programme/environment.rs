//! Block contacts, terrain, waterfront and cultural phase context.

use crate::urban::{Layout, Parcel, ParcelContact, Point, Shape, Surface, geometry::{area, centroid}, roles};

use super::{BlockEnvironment, dist};

pub(super) fn measure(
    layout: &Layout,
    surface: Surface<'_>,
    lap: &impl Fn(&str),
) -> (Vec<Vec<ParcelContact>>, Vec<BlockEnvironment>) {
    let (road_pressures, block_contacts) = crate::urban::parcels::pressures_and_contacts(layout, lap);
    let quay_water = roles::quay_water_fronts(layout, surface);
    let environment = crate::urban::par::map(&layout.blocks, |block, b| {
        let c = centroid(&b.shape);
        let h = surface.height_at(c);
        let slope = block_slope(surface, &b.shape, c, h);
        let front = water_front(&surface, &b.shape).or(quay_water[block]);
        BlockEnvironment {
            pressure: if surface.wet(c) {
                0.0
            } else {
                road_pressures.get(block).copied().unwrap_or(0.0) / (1.0 + 3.0 * slope)
            },
            block,
            slope,
            wet: block_is_wet(surface, &b.shape, c),
            waterfront: front.is_some(),
            height: h,
            district: None,
            water: front.map_or_else(String::new, |f| f.0.into()),
            water_height: front.map_or(0.0, |f| f.1),
        }
    });
    (block_contacts, environment)
}

pub(in crate::urban) fn block_slope(surface: Surface<'_>, shape: &Shape, center: Point, height: f64) -> f64 {
    shape.outer.iter()
        .map(|&p| (surface.height_at(p) - height).abs() / dist(p, center).max(1.0))
        .fold(0.0, f64::max)
}

/// A coastal contour can lie a few micrometres outside the exact land after
/// clipping. A wet boundary vertex alone must not disqualify an otherwise dry
/// block. Only these suspicious blocks need a boolean clip; interiors retain
/// the cheap point test. This is programme eligibility, not building clearance.
pub(in crate::urban) fn block_is_wet(surface: Surface<'_>, shape: &Shape, center: Point) -> bool {
    if surface.wet(center) {
        return true;
    }
    if !shape.outer.iter().any(|&p| surface.wet(p)) {
        return false;
    }
    let perimeter: f64 = std::iter::once(&shape.outer)
        .chain(shape.holes.iter())
        .map(|ring| {
            ring.iter()
                .zip(ring.iter().cycle().skip(1))
                .take(ring.len())
                .map(|(&a, &b)| dist(a, b))
                .sum::<f64>()
        })
        .sum();
    let dry = crate::urban::geometry::dry_clip(&surface, shape);
    if area(shape) - dry.iter().map(area).sum::<f64>() > (perimeter * 1e-4).max(1e-4) {
        return true;
    }
    // Area alone would permit a very narrow but deep spike into the water.
    // Every suspicious vertex must also be within 0.1 mm of a dry boundary.
    // The later native footprint/access checks remain authoritative.
    shape.outer.iter().filter(|&&p| surface.wet(p)).any(|&p| {
        dry.iter()
            .flat_map(|s| std::iter::once(&s.outer).chain(s.holes.iter()))
            .flat_map(|ring| {
                ring.iter()
                    .zip(ring.iter().cycle().skip(1))
                    .take(ring.len())
            })
            .map(|(&a, &b)| crate::urban::geometry::distance(p, a, b).0)
            .fold(f64::INFINITY, f64::min)
            > 1e-4
    })
}

/// Water a block fronts within a street and a quay of its outline: its kind
/// (`river`, `sea`, `lake`) and the ground height there. Samples outline
/// vertices and edge midpoints along both normals (the inner one only hits
/// water when the block itself is partly wet), nearest distance first.
fn water_front(surface: &Surface<'_>, shape: &Shape) -> Option<(&'static str, f64)> {
    let ring = &shape.outer;
    let n = ring.len();
    let stride = n.div_ceil(48).max(1);
    for d in [6.0, 15.0, 30.0] {
        for i in (0..n).step_by(stride) {
            let (a, b) = (ring[i], ring[(i + 1) % n]);
            let (dx, dy) = (b.x - a.x, b.y - a.y);
            let len = dx.hypot(dy);
            if len < 1e-6 {
                continue;
            }
            for t in [0.0, 0.5] {
                for side in [d, -d] {
                    let q = Point {
                        x: a.x + dx * t - dy / len * side,
                        y: a.y + dy * t + dx / len * side,
                    };
                    if q.x >= 0.0
                        && q.y >= 0.0
                        && q.x < surface.width
                        && q.y < surface.width
                        && surface.wet(q)
                    {
                        return Some((water_kind(surface, q), surface.height_at(q)));
                    }
                }
            }
        }
    }
    None
}
/// Terrain raster water code at `p` (1 sea, 2 lake, 3 river), its own cell
/// first then its neighbours; vector water the raster misses is a stream.
fn water_kind(surface: &Surface<'_>, p: Point) -> &'static str {
    let n = surface.n as i64;
    let x = (p.x / surface.width * n as f64) as i64;
    let y = (p.y / surface.width * n as f64) as i64;
    let code = [
        (0, 0),
        (1, 0),
        (-1, 0),
        (0, 1),
        (0, -1),
        (1, 1),
        (-1, -1),
        (1, -1),
        (-1, 1),
    ]
    .iter()
    .map(|(dx, dy)| ((x + dx).clamp(0, n - 1), (y + dy).clamp(0, n - 1)))
    .map(|(x, y)| surface.water[(y * n + x) as usize])
    .find(|&c| c != 0)
    .unwrap_or(3);
    match code {
        1 => "sea",
        2 => "lake",
        _ => "river",
    }
}

/// Architecture pack of a block's contextual mapping for a function.
pub(super) fn profile_pack(layout: &Layout, block: usize, _function: &str, _period: &str) -> String {
    crate::urban::culture::architecture_pack(block_culture(layout,block)).unwrap_or_default().into()
}
pub(super) fn block_culture(layout: &Layout, index: usize) -> &str {
    layout
        .blocks
        .get(index)
        .and_then(|b| {
            b.phase
                .or_else(|| layout.quarters.get(b.quarter).map(|q| q.phase))
        })
        .and_then(|phase| layout.phases.get(phase))
        .map(|phase| phase.culture.as_str())
        .filter(|s| !s.is_empty())
        .unwrap_or(&layout.culture)
}
pub(super) fn parcel_culture<'a>(layout: &'a Layout, p: &Parcel) -> &'a str {
    block_culture(layout, p.block)
}

/// The function classes distinguished by contextual mapping.
pub(super) fn function_class(function: &str) -> &'static str {
    match function {
        "domestic" => "domestic",
        "mixed" => "mixed",
        _ => "other",
    }
}
