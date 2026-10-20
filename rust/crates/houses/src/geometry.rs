//! Local metric construction, explicit holes and disjoint body domains.
//! Transform/rotation is exported separately; it never re-snaps shared edges.
use crate::model::{Point, Polygon, Surface};
use geo::algorithm::buffer::{BufferStyle, LineJoin};
use geo::{Area, BooleanOps, Buffer, Coord, LineString, MultiPolygon, Polygon as GeoPolygon};
use magna_urbis_random::Rng;
use std::f64::consts::TAU;

pub const GRID_M: f64 = 0.001;

pub fn snap(value: f64) -> f64 {
    libm::round(value / GRID_M) * GRID_M
}

pub fn point(x: f64, y: f64) -> Point {
    Point {
        x: snap(x),
        y: snap(y),
    }
}

pub fn rectangle(x: f64, y: f64, width: f64, depth: f64) -> Surface {
    vec![Polygon {
        outer: vec![
            point(x, y),
            point(x + width, y),
            point(x + width, y + depth),
            point(x, y + depth),
        ],
        holes: vec![],
    }]
}

pub fn ellipse(cx: f64, cy: f64, rx: f64, ry: f64, segments: usize) -> Surface {
    vec![Polygon {
        outer: (0..segments)
            .map(|i| {
                let angle = TAU * i as f64 / segments as f64;
                point(cx + rx * libm::cos(angle), cy + ry * libm::sin(angle))
            })
            .collect(),
        holes: vec![],
    }]
}

pub fn signed_area(ring: &[Point]) -> f64 {
    ring.iter()
        .zip(ring.iter().cycle().skip(1))
        .take(ring.len())
        .map(|(a, b)| a.x * b.y - a.y * b.x)
        .sum::<f64>()
        * 0.5
}

fn line(ring: &[Point]) -> LineString<f64> {
    let mut coords: Vec<_> = ring.iter().map(|p| Coord { x: p.x, y: p.y }).collect();
    if let Some(first) = coords.first().copied() {
        coords.push(first);
    }
    LineString(coords)
}

pub fn to_geo(surface: &Surface) -> MultiPolygon<f64> {
    MultiPolygon(
        surface
            .iter()
            .map(|polygon| {
                GeoPolygon::new(
                    line(&polygon.outer),
                    polygon.holes.iter().map(|ring| line(ring)).collect(),
                )
            })
            .collect(),
    )
}

pub(crate) fn canonical_ring(line: &LineString<f64>, positive: bool) -> Vec<Point> {
    let mut ring: Vec<_> = line.0.iter().map(|c| Point { x: c.x, y: c.y }).collect();
    if ring.len() > 1 && ring.first() == ring.last() {
        ring.pop();
    }
    ring.dedup();
    if (signed_area(&ring) > 0.0) != positive {
        ring.reverse();
    }
    if let Some(index) = (0..ring.len()).min_by(|&a, &b| {
        ring[a]
            .x
            .total_cmp(&ring[b].x)
            .then(ring[a].y.total_cmp(&ring[b].y))
    }) {
        ring.rotate_left(index);
    }
    ring
}

pub fn from_geo(geometry: &MultiPolygon<f64>) -> Surface {
    let mut surface: Surface = geometry
        .0
        .iter()
        .map(|polygon| {
            let mut holes: Vec<_> = polygon
                .interiors()
                .iter()
                .map(|ring| canonical_ring(ring, false))
                .filter(|ring| ring.len() >= 3 && signed_area(ring) < -1e-10)
                .collect();
            holes.sort_by(|a, b| a[0].x.total_cmp(&b[0].x).then(a[0].y.total_cmp(&b[0].y)));
            Polygon {
                outer: canonical_ring(polygon.exterior(), true),
                holes,
            }
        })
        .filter(|polygon| polygon.outer.len() >= 3 && signed_area(&polygon.outer) > 1.0e-10)
        .collect();
    surface.sort_by(|a, b| {
        a.outer[0]
            .x
            .total_cmp(&b.outer[0].x)
            .then(a.outer[0].y.total_cmp(&b.outer[0].y))
    });
    surface
}

pub fn union(a: &Surface, b: &Surface) -> Surface {
    from_geo(&to_geo(a).union(&to_geo(b)))
}
pub fn difference(a: &Surface, b: &Surface) -> Surface {
    from_geo(&to_geo(a).difference(&to_geo(b)))
}
pub fn intersection(a: &Surface, b: &Surface) -> Surface {
    from_geo(&to_geo(a).intersection(&to_geo(b)))
}
pub fn area(surface: &Surface) -> f64 {
    to_geo(surface).unsigned_area()
}

/// Mitered metric offset: construction uses no target-dependent trigonometry.
pub fn offset(surface: &Surface, distance: f64) -> Surface {
    from_geo(
        &to_geo(surface)
            .buffer_with_style(BufferStyle::new(distance).line_join(LineJoin::Miter(3.0))),
    )
}

pub fn translate(surface: &Surface, x: f64, y: f64) -> Surface {
    surface
        .iter()
        .map(|p| Polygon {
            outer: p.outer.iter().map(|p| point(p.x + x, p.y + y)).collect(),
            holes: p
                .holes
                .iter()
                .map(|r| r.iter().map(|p| point(p.x + x, p.y + y)).collect())
                .collect(),
        })
        .collect()
}

/// One cut yields both sides; derived boundaries are never snapped separately.
pub fn split(surface: &Surface, axis_x: bool, coordinate: f64) -> (Surface, Surface) {
    let b = bounds(surface);
    let clip = if axis_x {
        rectangle(
            b[0] - 1.0,
            b[1] - 1.0,
            coordinate - b[0] + 1.0,
            b[3] - b[1] + 2.0,
        )
    } else {
        rectangle(
            b[0] - 1.0,
            b[1] - 1.0,
            b[2] - b[0] + 2.0,
            coordinate - b[1] + 1.0,
        )
    };
    let left = intersection(surface, &clip);
    let right = difference(surface, &left);
    (left, right)
}

pub fn center(surface: &Surface) -> Point {
    let b = bounds(surface);
    point((b[0] + b[2]) * 0.5, (b[1] + b[3]) * 0.5)
}

/// A metric passage centered on a segment, with a depth across its normal.
pub fn segment_strip(a: Point, b: Point, depth: f64) -> Surface {
    let length = libm::hypot(b.x - a.x, b.y - a.y);
    if length < GRID_M {
        return vec![];
    }
    let nx = -(b.y - a.y) / length * depth * 0.5;
    let ny = (b.x - a.x) / length * depth * 0.5;
    vec![Polygon {
        outer: vec![
            point(a.x - nx, a.y - ny),
            point(b.x - nx, b.y - ny),
            point(b.x + nx, b.y + ny),
            point(a.x + nx, a.y + ny),
        ],
        holes: vec![],
    }]
}

pub fn unite(domains: &[Surface]) -> Surface {
    domains
        .iter()
        .fold(vec![], |acc, surface| union(&acc, surface))
}

pub fn bounds(surface: &Surface) -> [f64; 4] {
    surface.iter().flat_map(|p| &p.outer).fold(
        [
            f64::INFINITY,
            f64::INFINITY,
            f64::NEG_INFINITY,
            f64::NEG_INFINITY,
        ],
        |b, p| [b[0].min(p.x), b[1].min(p.y), b[2].max(p.x), b[3].max(p.y)],
    )
}

/// Area budget from the maximum 0.5 mm displacement of shared boundaries.
pub fn area_tolerance(surface: &Surface) -> f64 {
    let perimeter: f64 = surface
        .iter()
        .flat_map(|p| std::iter::once(&p.outer).chain(p.holes.iter()))
        .map(|ring| {
            ring.iter()
                .zip(ring.iter().cycle().skip(1))
                .take(ring.len())
                .map(|(a, b)| libm::sqrt((a.x - b.x).powi(2) + (a.y - b.y).powi(2)))
                .sum::<f64>()
        })
        .sum();
    perimeter * GRID_M * 0.5
}

#[derive(Clone, Debug)]
pub struct PrimitiveShape {
    pub footprint: Surface,
    pub body_domains: Vec<Surface>,
    pub courts: Surface,
    pub tiers: Vec<Surface>,
    pub excavation: Surface,
}

#[derive(Clone, Copy, Debug)]
pub struct PrimitiveOptions {
    pub bodies: u32,
    /// Courtyard area divided by the bounding rectangle or ellipse area.
    pub courtyard_ratio: f64,
    pub tiers: u32,
}

impl Default for PrimitiveOptions {
    fn default() -> Self {
        Self {
            bodies: 11,
            courtyard_ratio: 0.2,
            tiers: 4,
        }
    }
}

/// Recipe-level counts and courts; the atelier's default is not a recipe.
pub fn primitive_with_options(
    id: &str,
    width: f64,
    depth: f64,
    seed: &str,
    options: PrimitiveOptions,
) -> Result<PrimitiveShape, String> {
    if options.bodies == 0
        || options.bodies > 600
        || options.tiers == 0
        || options.tiers > 12
        || !options.courtyard_ratio.is_finite()
        || !(0.05..=0.8).contains(&options.courtyard_ratio)
    {
        return Err("Options de primitive hors limites.".into());
    }
    let mut shape = primitive(id, width, depth, seed)?;
    let ratio = libm::sqrt(options.courtyard_ratio);
    match id {
        "FP-COURT" | "FP-ROCKCUT" => {
            let inset_x = width * (1.0 - ratio) * 0.5;
            let inset_y = depth * (1.0 - ratio) * 0.5;
            shape.courts = rectangle(inset_x, inset_y, width * ratio, depth * ratio);
            shape.body_domains = vec![
                rectangle(0.0, 0.0, width, inset_y),
                rectangle(0.0, depth - inset_y, width, inset_y),
                rectangle(0.0, inset_y, inset_x, depth - 2.0 * inset_y),
                rectangle(width - inset_x, inset_y, inset_x, depth - 2.0 * inset_y),
            ];
        }
        "FP-ELLIPTICAL-RING" => {
            let segments = (options.bodies as usize * 2).clamp(64, 600);
            shape.courts = ellipse(
                width * 0.5,
                depth * 0.5,
                width * ratio * 0.5,
                depth * ratio * 0.5,
                segments,
            );
            shape.body_domains = vec![difference(
                &ellipse(width * 0.5, depth * 0.5, width * 0.5, depth * 0.5, segments),
                &shape.courts,
            )];
        }
        "FP-MULTICELL" => {
            shape.courts = rectangle(
                width * (1.0 - ratio) * 0.5,
                depth * (1.0 - ratio) * 0.5,
                width * ratio,
                depth * ratio,
            );
            let count = options.bodies as usize;
            let mut cols = libm::ceil(libm::sqrt(
                count as f64 * width / depth / (1.0 - options.courtyard_ratio),
            )) as usize;
            let domains = loop {
                let rows = libm::ceil(cols as f64 * depth / width) as usize;
                let mut domains = vec![];
                for row in 0..rows {
                    for col in 0..cols {
                        let cell = rectangle(
                            col as f64 * width / cols as f64,
                            row as f64 * depth / rows as f64,
                            width / cols as f64,
                            depth / rows as f64,
                        );
                        let clipped = difference(&cell, &shape.courts);
                        if area(&clipped) > area(&cell) * 0.65 {
                            domains.push(clipped);
                        }
                    }
                }
                if domains.len() >= count {
                    break domains;
                }
                cols += 1;
            };
            // Evenly retain count cells, avoiding a directional crop of the ensemble.
            shape.body_domains = (0..count)
                .map(|i| domains[i * domains.len() / count].clone())
                .collect();
        }
        "FP-CLUSTER-ROUND" => {
            let count = options.bodies as usize;
            if count > 30 {
                return Err("Groupe de huttes limité à 30 corps.".into());
            }
            let orbit = width.min(depth) * 0.36;
            let radius = (libm::sin(std::f64::consts::PI / count as f64) * orbit * 0.8)
                .min(width.min(depth) * 0.13);
            shape.body_domains = (0..count)
                .map(|i| {
                    let a = TAU * i as f64 / count as f64;
                    ellipse(
                        width * 0.5 + orbit * libm::cos(a),
                        depth * 0.5 + orbit * libm::sin(a),
                        radius,
                        radius,
                        48,
                    )
                })
                .collect();
            shape.courts = ellipse(
                width * 0.5,
                depth * 0.5,
                (orbit - radius - 0.5).max(0.5),
                (orbit - radius - 0.5).max(0.5),
                64,
            );
        }
        "FP-TERRACE" => {
            shape.tiers = (1..options.tiers)
                .map(|i| {
                    let inset = i as f64 * 0.65 / options.tiers as f64 * 0.5;
                    rectangle(
                        width * inset,
                        depth * inset,
                        width * (1.0 - 2.0 * inset),
                        depth * (1.0 - 2.0 * inset),
                    )
                })
                .collect();
        }
        _ => {}
    }
    shape.footprint = unite(&shape.body_domains);
    Ok(shape)
}

/// All 20 FP definitions in the atlas. Dimensions and randomness are local.
pub fn primitive(id: &str, width: f64, depth: f64, seed: &str) -> Result<PrimitiveShape, String> {
    if !width.is_finite()
        || !depth.is_finite()
        || !(2.0..=200.0).contains(&width)
        || !(2.0..=200.0).contains(&depth)
    {
        return Err("Dimensions de primitive invalides (2–200 mètres).".into());
    }
    let mut rng = Rng::new(seed).fork("primitive");
    let mut courts = vec![];
    let mut tiers = vec![];
    let mut excavation = vec![];
    let body_domains = match id {
        "FP-ROUND" => vec![ellipse(
            width * 0.5,
            depth * 0.5,
            width.min(depth) * 0.5,
            width.min(depth) * 0.5,
            64,
        )],
        "FP-OVAL" => vec![ellipse(
            width * 0.5,
            depth * 0.5,
            width * 0.5,
            depth * 0.5,
            64,
        )],
        "FP-SQUARE" | "FP-TOWER" => vec![rectangle(0.0, 0.0, width.min(depth), width.min(depth))],
        "FP-RECT" | "FP-LONG" => vec![rectangle(0.0, 0.0, width, depth)],
        "FP-L" => vec![
            rectangle(0.0, 0.0, width, depth * 0.36),
            rectangle(0.0, depth * 0.36, width * 0.36, depth * 0.64),
        ],
        "FP-U" => vec![
            rectangle(0.0, 0.0, width, depth * 0.3),
            rectangle(0.0, depth * 0.3, width * 0.28, depth * 0.7),
            rectangle(width * 0.72, depth * 0.3, width * 0.28, depth * 0.7),
        ],
        "FP-COMPLEX" => vec![
            rectangle(width * 0.2, 0.0, width * 0.6, depth * 0.6),
            rectangle(0.0, depth * 0.3, width * 0.2, depth * 0.5),
            rectangle(width * 0.8, depth * 0.3, width * 0.2, depth * 0.7),
            rectangle(width * 0.2, depth * 0.6, width * 0.6, depth * 0.25),
        ],
        "FP-COURT" | "FP-ROCKCUT" => {
            courts = rectangle(width * 0.28, depth * 0.28, width * 0.44, depth * 0.44);
            if id == "FP-ROCKCUT" {
                excavation = rectangle(0.0, 0.0, width, depth);
            }
            vec![
                rectangle(0.0, 0.0, width, depth * 0.28),
                rectangle(0.0, depth * 0.72, width, depth * 0.28),
                rectangle(0.0, depth * 0.28, width * 0.28, depth * 0.44),
                rectangle(width * 0.72, depth * 0.28, width * 0.28, depth * 0.44),
            ]
        }
        "FP-POLYGON" => vec![ellipse(
            width * 0.5,
            depth * 0.5,
            width * 0.5,
            depth * 0.5,
            rng.int(5, 12) as usize,
        )],
        "FP-APSIDAL" => {
            let r = width.min(depth) * 0.5;
            let base = rectangle(0.0, 0.0, width, depth - r);
            let cap = intersection(
                &ellipse(width * 0.5, depth - r, width * 0.5, r, 64),
                &rectangle(0.0, depth - r, width, r),
            );
            vec![base, cap]
        }
        "FP-TRICONCH" => {
            let mut shape = rectangle(width * 0.25, depth * 0.25, width * 0.5, depth * 0.5);
            for (cx, cy) in [
                (width * 0.25, depth * 0.5),
                (width * 0.75, depth * 0.5),
                (width * 0.5, depth * 0.25),
            ] {
                shape = union(&shape, &ellipse(cx, cy, width * 0.25, depth * 0.25, 48));
            }
            vec![shape]
        }
        "FP-CROSS" => vec![
            rectangle(width * 0.35, 0.0, width * 0.3, depth),
            rectangle(0.0, depth * 0.35, width * 0.35, depth * 0.3),
            rectangle(width * 0.65, depth * 0.35, width * 0.35, depth * 0.3),
        ],
        "FP-TERRACE" => {
            for i in 1..4 {
                let inset = i as f64 * 0.11;
                tiers.push(rectangle(
                    width * inset,
                    depth * inset,
                    width * (1.0 - 2.0 * inset),
                    depth * (1.0 - 2.0 * inset),
                ));
            }
            vec![rectangle(0.0, 0.0, width, depth)]
        }
        "FP-ELLIPTICAL-RING" => {
            courts = ellipse(width * 0.5, depth * 0.5, width * 0.3, depth * 0.3, 64);
            vec![difference(
                &ellipse(width * 0.5, depth * 0.5, width * 0.5, depth * 0.5, 64),
                &courts,
            )]
        }
        "FP-MULTICELL" => {
            let mut domains = vec![];
            for row in 0..3 {
                for col in 0..4 {
                    if row == 1 && col == 1 {
                        courts = rectangle(width * 0.25, depth / 3.0, width * 0.25, depth / 3.0);
                    } else {
                        domains.push(rectangle(
                            col as f64 * width * 0.25,
                            row as f64 * depth / 3.0,
                            width * 0.25,
                            depth / 3.0,
                        ));
                    }
                }
            }
            domains
        }
        "FP-CLUSTER-ROUND" => {
            let count = rng.int(3, 12) as usize;
            let r = width.min(depth) * 0.32;
            let hut_r = (libm::sin(std::f64::consts::PI / count as f64) * r * 0.68)
                .min(width.min(depth) * 0.13);
            (0..count)
                .map(|i| {
                    let angle = TAU * i as f64 / count as f64;
                    ellipse(
                        width * 0.5 + r * libm::cos(angle),
                        depth * 0.5 + r * libm::sin(angle),
                        hut_r,
                        hut_r,
                        48,
                    )
                })
                .collect()
        }
        "FP-IRREGULAR" => {
            let ring = (0..24)
                .map(|i| {
                    let angle = TAU * i as f64 / 24.0;
                    let radius = rng.range(0.82, 1.0);
                    point(
                        width * 0.5 + width * 0.5 * radius * libm::cos(angle),
                        depth * 0.5 + depth * 0.5 * radius * libm::sin(angle),
                    )
                })
                .collect();
            vec![vec![Polygon {
                outer: ring,
                holes: vec![],
            }]]
        }
        _ => return Err(format!("Emprise inconnue : {id}.")),
    };
    let footprint = unite(&body_domains);
    if area(&footprint) <= 0.0 {
        return Err("Emprise dégénérée.".into());
    }
    Ok(PrimitiveShape {
        footprint,
        body_domains,
        courts,
        tiers,
        excavation,
    })
}
