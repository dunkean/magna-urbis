//! Source21: native crossed battens and alternating log ends, after door cuts.
use crate::catalogue::{LatticeSpec, LogJointSpec, Parameters};
use crate::geometry::{area, difference, intersection, offset, point, signed_area, unite};
use crate::model::{Feature, FeatureKind, HouseUnit, Point, Polygon, Surface, Vertex3, WallKind};
use crate::wall_geometry::wall_section;

fn cross(a: Point, b: Point, c: Point) -> f64 {
    (b.x - a.x) * (c.y - b.y) - (b.y - a.y) * (c.x - b.x)
}

fn projection(vertices: &[Vertex3]) -> Surface {
    let mut points: Vec<_> = vertices.iter().map(|v| Point { x: v.x, y: v.y }).collect();
    points.sort_by(|a, b| a.x.total_cmp(&b.x).then(a.y.total_cmp(&b.y)));
    points.dedup_by(|a, b| (a.x - b.x).abs() < 1e-10 && (a.y - b.y).abs() < 1e-10);
    let mut hull: Vec<Point> = vec![];
    for q in &points {
        while hull.len() >= 2 && cross(hull[hull.len() - 2], hull[hull.len() - 1], *q) <= 0.0 {
            hull.pop();
        }
        hull.push(*q);
    }
    let lower = hull.len();
    for q in points.iter().rev().skip(1) {
        while hull.len() > lower && cross(hull[hull.len() - 2], hull[hull.len() - 1], *q) <= 0.0 {
            hull.pop();
        }
        hull.push(*q);
    }
    hull.pop();
    vec![Polygon {
        outer: hull,
        holes: vec![],
    }]
}

fn frame(id: String, vertices: Vec<Vertex3>, material: &str) -> Feature {
    let z = vertices.iter().map(|v| v.z).fold(f64::INFINITY, f64::min);
    let top = vertices
        .iter()
        .map(|v| v.z)
        .fold(f64::NEG_INFINITY, f64::max);
    Feature {
        id,
        kind: FeatureKind::Frame,
        surface: projection(&vertices),
        z_m: z,
        height_m: top - z,
        material: material.into(),
        vertices3d: vertices,
        roof: None,
    }
}

fn member(a: Vertex3, b: Vertex3, width: f64, depth: f64, round: bool) -> Vec<Vertex3> {
    let dx = b.x - a.x;
    let dy = b.y - a.y;
    let dz = b.z - a.z;
    let horizontal = libm::hypot(dx, dy);
    let length = libm::sqrt(horizontal * horizontal + dz * dz);
    let radial = [-dy / horizontal, dx / horizontal, 0.0];
    let normal = [
        -dx * dz / (horizontal * length),
        -dy * dz / (horizontal * length),
        horizontal / length,
    ];
    let corners: Vec<_> = if round {
        (0..12)
            .map(|i| {
                let t = i as f64 * std::f64::consts::TAU / 12.0;
                (libm::cos(t) * depth * 0.5, libm::sin(t) * width * 0.5)
            })
            .collect()
    } else {
        vec![
            (-depth * 0.5, -width * 0.5),
            (depth * 0.5, -width * 0.5),
            (depth * 0.5, width * 0.5),
            (-depth * 0.5, width * 0.5),
        ]
    };
    [&a, &b]
        .into_iter()
        .flat_map(|q| {
            corners.iter().map(move |(u, v)| Vertex3 {
                x: q.x + radial[0] * u + normal[0] * v,
                y: q.y + radial[1] * u + normal[1] * v,
                z: q.z + normal[2] * v,
            })
        })
        .collect()
}

fn interval(p: &Polygon, a: Point, b: Point, start: f64, length: f64) -> [f64; 2] {
    let dx = (b.x - a.x) / length;
    let dy = (b.y - a.y) / length;
    p.outer
        .iter()
        .fold([f64::INFINITY, f64::NEG_INFINITY], |mut acc, q| {
            let s = start + (q.x - a.x) * dx + (q.y - a.y) * dy;
            acc[0] = acc[0].min(s);
            acc[1] = acc[1].max(s);
            acc
        })
}

fn lattice(unit: &mut HouseUnit, spec: &LatticeSpec) -> Result<(), String> {
    let mut pending = vec![];
    for body in &unit.bodies {
        for level in &body.levels {
            let walls: Vec<_> = unit
                .walls
                .iter()
                .filter(|w| {
                    w.body_id.as_deref() == Some(body.id.as_str())
                        && w.level == level.index
                        && matches!(w.kind, WallKind::Exterior | WallKind::Shell)
                        && !w.shell_reference
                        && !w.party
                })
                .collect();
            let top = walls
                .iter()
                .map(|w| w.z_m + w.height_m)
                .fold(f64::NEG_INFINITY, f64::max);
            if walls.is_empty() || !top.is_finite() || top - level.z_m < 0.3 {
                return Err(format!(
                    "Treillis : niveau {} sans vraie paroi parent.",
                    level.index
                ));
            }
            let outline = offset(&level.footprint, -body.wall_thickness_m * 0.5);
            if outline.len() != 1 || !outline[0].holes.is_empty() {
                return Err("Treillis : une enceinte périphérique simple est requise.".into());
            }
            let ring = &outline[0].outer;
            let mut edges = vec![];
            let mut perimeter = 0.0;
            for (a, b) in ring
                .iter()
                .zip(ring.iter().cycle().skip(1))
                .take(ring.len())
            {
                let length = libm::hypot(b.x - a.x, b.y - a.y);
                if length > 1e-8 {
                    edges.push((*a, *b, perimeter, length));
                    perimeter += length;
                }
            }
            // Portal intervals include a batten's half thickness. No rod crosses
            // a doorway or jumps across a polygon corner.
            let doors = unite(
                &unit
                    .access
                    .portals
                    .iter()
                    .filter(|d| {
                        (d.from_z_m - level.z_m).abs() < 0.001
                            && area(&intersection(&d.passage, &level.footprint)) > 0.0
                    })
                    .map(|d| {
                        offset(
                            &d.passage,
                            spec.batten_width_m.max(spec.batten_depth_m) * 0.75,
                        )
                    })
                    .collect::<Vec<_>>(),
            );
            let mut excluded = vec![];
            for (a, b, start, length) in &edges {
                let nx = -(b.y - a.y) / length * 0.0005;
                let ny = (b.x - a.x) / length * 0.0005;
                let strip = vec![Polygon {
                    outer: vec![
                        Point {
                            x: a.x - nx,
                            y: a.y - ny,
                        },
                        Point {
                            x: b.x - nx,
                            y: b.y - ny,
                        },
                        Point {
                            x: b.x + nx,
                            y: b.y + ny,
                        },
                        Point {
                            x: a.x + nx,
                            y: a.y + ny,
                        },
                    ],
                    holes: vec![],
                }];
                for p in intersection(&doors, &strip) {
                    excluded.push(interval(&p, *a, *b, *start, *length));
                }
            }
            let bays = libm::ceil(perimeter / spec.bay_width_m) as usize;
            let bay = perimeter / bays as f64;
            if bay < 0.3 {
                return Err("Treillis : baie inférieure à 0,3 m.".into());
            }
            let lower = level.z_m + spec.batten_width_m;
            let upper = top - spec.batten_width_m;
            let rise = (upper - lower) / spec.rows as f64;
            let before = pending.len();
            for row in 0..spec.rows {
                for col in 0..bays {
                    let s0 = col as f64 * bay;
                    let s1 = s0 + bay;
                    for ascending in [true, false] {
                        for (a, b, start, length) in &edges {
                            let lo = s0.max(*start);
                            let hi = s1.min(start + length);
                            if hi - lo < 0.000_000_01 {
                                continue;
                            }
                            let mut cuts = vec![lo, hi];
                            for e in &excluded {
                                if e[1] > lo && e[0] < hi {
                                    cuts.push(e[0].clamp(lo, hi));
                                    cuts.push(e[1].clamp(lo, hi));
                                }
                            }
                            cuts.sort_by(f64::total_cmp);
                            cuts.dedup_by(|a, b| (*a - *b).abs() < 1e-8);
                            for pair in cuts.windows(2) {
                                let mid = (pair[0] + pair[1]) * 0.5;
                                if pair[1] - pair[0] < 0.000_000_01
                                    || excluded
                                        .iter()
                                        .any(|e| mid > e[0] - 1e-8 && mid < e[1] + 1e-8)
                                {
                                    continue;
                                }
                                let at = |s: f64| {
                                    let t = (s - start) / length;
                                    let slope = (s - s0) / bay;
                                    Vertex3 {
                                        x: a.x + (b.x - a.x) * t,
                                        y: a.y + (b.y - a.y) * t,
                                        z: lower
                                            + row as f64 * rise
                                            + if ascending {
                                                slope * rise
                                            } else {
                                                (1.0 - slope) * rise
                                            },
                                    }
                                };
                                let rod = frame(
                                    format!(
                                        "source-lattice:{}:{}:{}",
                                        body.id,
                                        level.index,
                                        pending.len() - before
                                    ),
                                    member(
                                        at(pair[0]),
                                        at(pair[1]),
                                        spec.batten_width_m,
                                        spec.batten_depth_m,
                                        false,
                                    ),
                                    &spec.material,
                                );
                                for q in &rod.vertices3d {
                                    let section = unite(
                                        &walls
                                            .iter()
                                            .map(|w| wall_section(w, q.z))
                                            .collect::<Vec<_>>(),
                                    );
                                    let witness = vec![Polygon {
                                        outer: vec![
                                            Point {
                                                x: q.x - 0.00005,
                                                y: q.y - 0.00005,
                                            },
                                            Point {
                                                x: q.x + 0.00005,
                                                y: q.y - 0.00005,
                                            },
                                            Point {
                                                x: q.x + 0.00005,
                                                y: q.y + 0.00005,
                                            },
                                            Point {
                                                x: q.x - 0.00005,
                                                y: q.y + 0.00005,
                                            },
                                        ],
                                        holes: vec![],
                                    }];
                                    if area(&difference(&witness, &section)) > 0.000_000_001 {
                                        return Err(format!(
                                            "Treillis : baguette hors section native du mur à {:.3} m.",
                                            q.z
                                        ));
                                    }
                                }
                                pending.push(rod);
                                if pending.len() - before > spec.max_pieces as usize {
                                    return Err(format!(
                                        "Treillis : plus de {} morceaux réels, aucune baguette omise.",
                                        spec.max_pieces
                                    ));
                                }
                            }
                        }
                    }
                }
            }
            if pending.len() == before {
                return Err("Treillis : aucune diagonale appuyée sur le mur parent.".into());
            }
        }
    }
    unit.diagnostics.push(format!("Treillis : {} baguettes croisées à deux anneaux3D, coupées aux coins et jambages ; hauteur dérivée des parois natives, baies ≤{:.3} m, {} rangs, dimensions stylized.",pending.len(),spec.bay_width_m,spec.rows));
    unit.features.extend(pending);
    Ok(())
}

fn log_joints(unit: &mut HouseUnit, spec: &LogJointSpec) -> Result<(), String> {
    let mut pending = vec![];
    let mut corners = 0;
    for body in &unit.bodies {
        for level in &body.levels {
            let walls: Vec<_> = unit
                .walls
                .iter()
                .filter(|w| {
                    w.body_id.as_deref() == Some(body.id.as_str())
                        && w.level == level.index
                        && w.kind == WallKind::Exterior
                        && !w.party
                        && w.material == spec.material
                })
                .collect();
            if walls.is_empty() {
                continue;
            }
            let passages = unite(
                &unit
                    .access
                    .portals
                    .iter()
                    .filter(|d| (d.from_z_m - level.z_m).abs() < 0.001)
                    .map(|d| d.passage.clone())
                    .collect::<Vec<_>>(),
            );
            for polygon in &level.footprint {
                let n = polygon.outer.len();
                let orientation = signed_area(&polygon.outer).signum();
                for i in 0..n {
                    let a = polygon.outer[(i + n - 1) % n];
                    let q = polygon.outer[i];
                    let b = polygon.outer[(i + 1) % n];
                    let l0 = libm::hypot(q.x - a.x, q.y - a.y);
                    let l1 = libm::hypot(b.x - q.x, b.y - q.y);
                    if l0 < 0.5 || l1 < 0.5 {
                        continue;
                    }
                    let u = [(q.x - a.x) / l0, (q.y - a.y) / l0];
                    let v = [(b.x - q.x) / l1, (b.y - q.y) / l1];
                    if cross(a, q, b) * orientation <= 0.0
                        || (u[0] * v[0] + u[1] * v[1]).abs() > 0.15
                    {
                        continue;
                    }
                    let t = body.wall_thickness_m;
                    let center = point(
                        q.x + (-u[1] - v[1]) * orientation * t * 0.5,
                        q.y + (u[0] + v[0]) * orientation * t * 0.5,
                    );
                    let mut count = 0;
                    for course in 0..spec.courses {
                        let axis = if course % 2 == 0 { u } else { [-v[0], -v[1]] };
                        let z = level.z_m
                            + spec.diameter_m * 0.75
                            + course as f64 * spec.course_spacing_m;
                        if z + spec.diameter_m * 0.5 >= level.z_m + level.height_m {
                            return Err("Rondins : cours dépassant la paroi parent.".into());
                        }
                        let a = Vertex3 {
                            x: center.x - axis[0] * t * 1.5,
                            y: center.y - axis[1] * t * 1.5,
                            z,
                        };
                        let b = Vertex3 {
                            x: center.x + axis[0] * (t * 0.5 + spec.extension_m),
                            y: center.y + axis[1] * (t * 0.5 + spec.extension_m),
                            z,
                        };
                        let rod = frame(
                            format!("source-log-joint:{}:{}:{i}:{course}", body.id, level.index),
                            member(a, b, spec.diameter_m, spec.diameter_m, true),
                            &spec.material,
                        );
                        if area(&difference(&rod.surface, &unit.lot)) > 0.000_001
                            || area(&intersection(&rod.surface, &passages)) > 0.000_001
                        {
                            continue;
                        }
                        let support =
                            unite(&walls.iter().map(|w| wall_section(w, z)).collect::<Vec<_>>());
                        if area(&intersection(&rod.surface, &support)) < area(&rod.surface) * 0.4 {
                            continue;
                        }
                        pending.push(rod);
                        count += 1;
                    }
                    if count > 0 {
                        corners += 1;
                    }
                }
            }
        }
    }
    if corners == 0 {
        return Err("Rondins croisés : aucun coin extérieur convexe à 90° porté par une vraie paroi en bois.".into());
    }
    unit.diagnostics.push(format!("Rondins d'angle : {} coins natifs, {} bouts3D alternés, {} cours maximum, diamètre {:.3} m et extension {:.3} m stylized ; niveaux minéraux, murs mitoyens et passages exclus.",corners,pending.len(),spec.courses,spec.diameter_m,spec.extension_m));
    unit.features.extend(pending);
    Ok(())
}

pub(super) fn add_frames(unit: &mut HouseUnit, p: &Parameters) -> Result<(), String> {
    let Some(s) = &p.structural_spec else {
        return Ok(());
    };
    if p.details.iter().any(|id| id == "lattice") {
        lattice(
            unit,
            s.lattice
                .as_ref()
                .ok_or("Treillis sans dimensions structurelles explicites.")?,
        )?;
    }
    if p.details.iter().any(|id| id == "log_corners") {
        log_joints(
            unit,
            s.log_joints
                .as_ref()
                .ok_or("Rondins d'angle sans dimensions structurelles explicites.")?,
        )?;
    }
    Ok(())
}

/// The felt dome must meet the actual cylinder crown; a named RF is insufficient.
pub(super) fn prove_roof_joint(unit: &mut HouseUnit) -> Result<(), String> {
    use crate::model::{RoofEdgeKind, RoofFaceKind};
    let distance = |p: Point, a: Point, b: Point| {
        let dx = b.x - a.x;
        let dy = b.y - a.y;
        let t = (((p.x - a.x) * dx + (p.y - a.y) * dy) / (dx * dx + dy * dy)).clamp(0.0, 1.0);
        libm::hypot(p.x - a.x - t * dx, p.y - a.y - t * dy)
    };
    for body in &unit.bodies {
        let level = body.levels.last().ok_or("Treillis : corps sans niveau.")?;
        let top = level.z_m + level.height_m;
        let eaves: Vec<_> = unit
            .roofs
            .edges
            .iter()
            .filter(|edge| {
                edge.kind == RoofEdgeKind::Eave
                    && edge.faces.iter().flatten().any(|&i| {
                        let f = &unit.roofs.faces[i as usize];
                        f.body_id == body.id
                            && f.feature_id.is_none()
                            && f.level == level.index
                            && f.kind == RoofFaceKind::Pan
                    })
            })
            .map(|edge| {
                [
                    &unit.roofs.vertices[edge.vertices[0] as usize],
                    &unit.roofs.vertices[edge.vertices[1] as usize],
                ]
            })
            .collect();
        if eaves.is_empty() || eaves.iter().flatten().any(|v| (v.z - top).abs() > 0.001) {
            return Err(format!(
                "Treillis : égout natif de {} absent ou disjoint du couronnement à {top:.3} m.",
                body.id
            ));
        }
        for polygon in &level.footprint {
            for (a, b) in polygon
                .outer
                .iter()
                .zip(polygon.outer.iter().cycle().skip(1))
                .take(polygon.outer.len())
            {
                for t in [0.0, 0.5, 1.0] {
                    let q = Point {
                        x: a.x + (b.x - a.x) * t,
                        y: a.y + (b.y - a.y) * t,
                    };
                    if !eaves.iter().any(|e| {
                        distance(
                            q,
                            Point {
                                x: e[0].x,
                                y: e[0].y,
                            },
                            Point {
                                x: e[1].x,
                                y: e[1].y,
                            },
                        ) <= 0.000_001
                    }) {
                        return Err(format!(
                            "Treillis : contour réel du cylindre {} sans égout jointif.",
                            body.id
                        ));
                    }
                }
            }
        }
        let members: Vec<_> = unit
            .features
            .iter()
            .filter(|f| f.id.starts_with(&format!("source-lattice:{}:", body.id)))
            .collect();
        if members.is_empty()
            || members
                .iter()
                .any(|f| f.vertices3d.iter().any(|v| v.z > top + 0.001))
        {
            return Err(
                "Treillis : baguettes absentes ou au-dessus de la vraie couverture parent.".into(),
            );
        }
    }
    unit.diagnostics.push("Treillis : baguettes physiques sous le parent et égout natif jointif au contour/couronnement réel du cylindre, sans déplacement de couverture.".into());
    Ok(())
}
