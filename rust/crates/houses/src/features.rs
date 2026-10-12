//! Explicit atlas details after bodies, before portals and roof meshes.
//! No cultural labels or arbitrary prose are interpreted here.
use crate::catalogue::{
    DetailSpec, EnclosureFamily, Envelope, Layout, Parameters, Placement, Recipe, SupportKind,
    VerticalAccess, catalogue,
};
use crate::geometry::{
    area, bounds, center, difference, ellipse, intersection, offset, point, rectangle,
    segment_strip, unite,
};
use crate::model::{
    Body, Feature, FeatureKind, HouseConfig, HouseUnit, Point, Polygon, Role, RoofArm,
    RoofAttachment, RoomUsage, Surface, Vertex3, Wall, WallKind,
};
#[path = "frame_details.rs"]
mod frame_details;
#[path = "gallery_partition.rs"]
mod gallery_partition;

fn feature(
    id: String,
    kind: FeatureKind,
    surface: Surface,
    z: f64,
    height: f64,
    material: &str,
) -> Feature {
    let vertices3d = surface
        .iter()
        .flat_map(|polygon| &polygon.outer)
        .map(|p| Vertex3 { x: p.x, y: p.y, z })
        .collect();
    Feature {
        id,
        kind,
        surface,
        z_m: z,
        height_m: height,
        material: material.into(),
        vertices3d,
        roof: None,
    }
}

fn push(
    unit: &mut HouseUnit,
    trait_: &str,
    kind: FeatureKind,
    surface: Surface,
    z: f64,
    height: f64,
    material: &str,
) -> bool {
    if area(&surface) < 0.002 {
        return false;
    }
    let id = format!("detail-{trait_}-{}", unit.features.len());
    unit.features
        .push(feature(id, kind, surface, z, height, material));
    true
}

fn diagnose(unit: &mut HouseUnit, trait_: &str, reason: &str) {
    unit.diagnostics
        .push(format!("Trait {trait_} inapplicable : {reason}"));
}

fn passages(unit: &HouseUnit) -> Surface {
    let mut paths = vec![unit.partition.circulation.clone()];
    paths.extend(
        unit.access
            .portals
            .iter()
            .map(|portal| portal.passage.clone()),
    );
    unite(&paths)
}

fn floor_z(unit: &HouseUnit) -> f64 {
    unit.bodies
        .iter()
        .flat_map(|body| &body.levels)
        .map(|level| level.z_m)
        .reduce(f64::min)
        .unwrap_or(0.0)
}

fn enclosures(unit: &mut HouseUnit, p: &Parameters) {
    for (index, spec) in p.enclosures.iter().enumerate() {
        if spec.family == EnclosureFamily::None {
            continue;
        }
        let central = spec.placement == Placement::Central;
        if central
            && unit
                .features
                .iter()
                .any(|f| f.kind == FeatureKind::LivestockPen)
        {
            continue;
        }
        if !central
            && unit.features.iter().any(|f| {
                matches!(f.kind, FeatureKind::Fence | FeatureKind::Enclosure)
                    && !f.id.starts_with("court-threshold-")
            })
        {
            continue;
        }
        let domain = if central {
            unit.partition.courtyards.clone()
        } else {
            offset(&unit.lot, -0.25)
        };
        if domain.is_empty() {
            diagnose(
                unit,
                "enclosure",
                "aucun espace réservé à la clôture déclarée",
            );
            continue;
        }
        let b = bounds(&domain);
        let profile = p.structural_spec.as_ref().and_then(|s| {
            s.walls
                .iter()
                .find(|w| w.role == crate::catalogue::StructureWallRole::Enclosure)
        });
        let thickness = profile.map_or_else(
            || match spec.family {
                EnclosureFamily::EarthWall | EnclosureFamily::StoneWall => 0.35,
                _ => 0.2,
            },
            |w| w.min_thickness_m,
        );
        let gate = rectangle(
            (b[0] + b[2] - spec.gate_width_m) * 0.5,
            b[3] - thickness - 0.1,
            spec.gate_width_m,
            thickness + 0.2,
        );
        let ring = difference(&domain, &offset(&domain, -thickness));
        let ring = if p.site_gate_profile.is_some() && !central {
            ring
        } else {
            difference(&ring, &gate)
        };
        let (default_material, default_height) = match spec.family {
            EnclosureFamily::EarthWall => ("MAT-ADOBE", 2.2),
            EnclosureFamily::StoneWall => ("MAT-STONE-DRY", 2.2),
            EnclosureFamily::TimberPalisade => ("MAT-TIMBER-POST", 2.0),
            EnclosureFamily::ThornFence => ("MAT-WATTLE", 1.4),
            EnclosureFamily::None => continue,
        };
        let material = profile
            .and_then(|w| w.material.as_deref())
            .unwrap_or(default_material);
        let height = profile.map_or(default_height, |w| w.min_height_m);
        push(
            unit,
            &format!("enclosure-{index}"),
            if central {
                FeatureKind::LivestockPen
            } else if matches!(
                spec.family,
                EnclosureFamily::ThornFence | EnclosureFamily::TimberPalisade
            ) {
                FeatureKind::Fence
            } else {
                FeatureKind::Enclosure
            },
            ring,
            floor_z(unit),
            height,
            material,
        );
    }
}

/// A fitting must be completely inside its useful space and outside portals.
fn fit(domain: &Surface, side: f64) -> Option<Point> {
    if domain.is_empty() {
        return None;
    }
    let b = bounds(domain);
    if b[2] - b[0] < side || b[3] - b[1] < side {
        return None;
    }
    let mut candidates = vec![center(domain)];
    for y in 0..8 {
        for x in 0..8 {
            candidates.push(point(
                b[0] + side * 0.5 + (b[2] - b[0] - side) * (x as f64 / 7.0),
                b[1] + side * 0.5 + (b[3] - b[1] - side) * (y as f64 / 7.0),
            ));
        }
    }
    candidates.into_iter().find(|q| {
        let square = rectangle(q.x - side * 0.5, q.y - side * 0.5, side, side);
        area(&difference(&square, domain)) < 0.000_01
    })
}

fn domestic_fitting(
    unit: &mut HouseUnit,
    trait_: &str,
    kind: FeatureKind,
    multiple: bool,
    side: f64,
    material: &str,
) {
    if !unit.role.residential() {
        diagnose(
            unit,
            trait_,
            "le programme ne comporte pas de foyer résidentiel",
        );
        return;
    }
    let blocked = passages(unit);
    let rooms = unit
        .rooms
        .iter()
        .filter(|room| {
            matches!(
                room.usage,
                RoomUsage::Living | RoomUsage::Kitchen | RoomUsage::Communal | RoomUsage::Hall
            )
        })
        .cloned()
        .collect::<Vec<_>>();
    let mut count = 0;
    for room in rooms {
        let free = difference(&room.floor, &blocked);
        if let Some(q) = fit(&free, side) {
            push(
                unit,
                trait_,
                kind,
                ellipse(q.x, q.y, side * 0.42, side * 0.42, 24),
                room.z_m,
                0.16,
                material,
            );
            count += 1;
            if !multiple {
                break;
            }
        }
    }
    if count == 0 {
        diagnose(
            unit,
            trait_,
            "aucune pièce de vie dégagée assez large pour le foyer",
        );
    }
}

fn yard_fitting(
    unit: &mut HouseUnit,
    trait_: &str,
    kind: FeatureKind,
    side: f64,
    height: f64,
    material: &str,
) {
    let free = difference(&unit.partition.courtyards, &passages(unit));
    if let Some(q) = fit(&free, side) {
        let outer = ellipse(q.x, q.y, side * 0.5, side * 0.5, 32);
        let surface = if matches!(kind, FeatureKind::Well | FeatureKind::Impluvium) {
            difference(&outer, &ellipse(q.x, q.y, side * 0.32, side * 0.32, 32))
        } else {
            outer
        };
        let z = floor_z(unit);
        push(unit, trait_, kind, surface, z, height, material);
        if matches!(kind, FeatureKind::Well | FeatureKind::Impluvium) {
            push(
                unit,
                trait_,
                FeatureKind::Water,
                ellipse(q.x, q.y, side * 0.3, side * 0.3, 32),
                z - 0.12,
                0.0,
                "",
            );
        }
    } else {
        diagnose(
            unit,
            trait_,
            "aucune cour libre de passages ne contient cet équipement",
        );
    }
}

fn wall_marks(
    unit: &mut HouseUnit,
    trait_: &str,
    kind: FeatureKind,
    width: f64,
    height: f64,
    material: &str,
) {
    let walls = unit
        .walls
        .iter()
        .filter(|wall| matches!(wall.kind, WallKind::Exterior | WallKind::Shell) && !wall.party)
        .cloned()
        .collect::<Vec<_>>();
    let mut count = 0;
    for wall in walls {
        let b = bounds(&wall.footprint);
        if !b[0].is_finite() {
            continue;
        }
        let along_x = b[2] - b[0] >= b[3] - b[1];
        let length = if along_x { b[2] - b[0] } else { b[3] - b[1] };
        if length < width * 2.0 {
            continue;
        }
        let q = center(&wall.footprint);
        let surface = if along_x {
            rectangle(q.x - width * 0.5, q.y - 0.06, width, 0.12)
        } else {
            rectangle(q.x - 0.06, q.y - width * 0.5, 0.12, width)
        };
        if area(&intersection(&surface, &passages(unit))) > 0.002 {
            continue;
        }
        push(
            unit,
            trait_,
            kind,
            surface,
            wall.z_m + 1.05,
            height,
            material,
        );
        count += 1;
    }
    if count == 0 {
        diagnose(
            unit,
            trait_,
            "aucun mur extérieur non mitoyen ne peut recevoir ce détail",
        );
    }
}

pub(crate) const BEAM_SPACING_M: f64 = 2.4;

/// Exact native strips shared by the detail generator and access certificates.
pub(crate) fn beam_surfaces(body: &Body, spacing: f64) -> Vec<Surface> {
    let b = bounds(&body.footprint);
    if !b[0].is_finite() {
        return vec![];
    }
    let n = ((b[3] - b[1]) / spacing).floor().clamp(1.0, 32.0) as u32;
    (0..=n)
        .map(|i| {
            let y = b[1] + (b[3] - b[1]) * i as f64 / n as f64;
            intersection(
                &rectangle(b[0], y - 0.08, b[2] - b[0], 0.16),
                &body.footprint,
            )
        })
        .collect()
}

fn beams(unit: &mut HouseUnit, trait_: &str, kind: FeatureKind, spacing: f64, material: &str) {
    let bodies = unit.bodies.clone();
    let mut count = 0;
    for body in bodies {
        let z = body
            .levels
            .last()
            .map_or(2.8, |level| level.z_m + level.height_m);
        for strip in beam_surfaces(&body, spacing) {
            if push(unit, trait_, kind, strip, z, 0.18, material) {
                count += 1;
            }
        }
    }
    if count == 0 {
        diagnose(unit, trait_, "aucun volume construit ne fournit de travées");
    }
}

fn posts(unit: &mut HouseUnit, trait_: &str, material: &str, four: bool) {
    if !four
        && !matches!(trait_, "bone_posts" | "driftwood_posts")
        && unit
            .features
            .iter()
            .any(|feature| feature.kind == FeatureKind::Post)
    {
        return;
    }
    let bodies = unit.bodies.clone();
    let mut count = 0;
    for body in bodies {
        let Some(level) = body.levels.first() else {
            continue;
        };
        let b = bounds(&level.floor);
        for (x, y) in [(0.25, 0.25), (0.75, 0.25), (0.75, 0.75), (0.25, 0.75)] {
            let q = point(b[0] + (b[2] - b[0]) * x, b[1] + (b[3] - b[1]) * y);
            let column = ellipse(q.x, q.y, 0.14, 0.14, 16);
            if area(&difference(&column, &level.floor)) < 0.002
                && area(&intersection(&column, &passages(unit))) < 0.002
            {
                push(
                    unit,
                    trait_,
                    FeatureKind::Post,
                    column,
                    level.z_m,
                    level.height_m,
                    material,
                );
                count += 1;
            }
        }
    }
    if count == 0 {
        diagnose(
            unit,
            trait_,
            "aucun emplacement de poteau hors du passage sur un plancher construit",
        );
    }
}

fn diagonal_posts(unit: &mut HouseUnit, trait_: &str, p: &Parameters) {
    let Some(spec) = &p.detail_spec else {
        diagnose(unit, trait_, "aucune dimension explicite de diagonale");
        return;
    };
    let supports: Vec<_> = unit
        .features
        .iter()
        .filter(|f| {
            f.kind == FeatureKind::Post && f.id.starts_with("support:") && f.height_m >= 0.5
        })
        .cloned()
        .collect();
    let mut count = 0;
    for support in supports {
        let head = center(&support.surface);
        let owner = unit
            .bodies
            .iter()
            .find(|b| area(&intersection(&b.footprint, &support.surface)) > 0.001);
        let Some(owner) = owner else { continue };
        let c = center(&owner.footprint);
        let direction = point(head.x - c.x, head.y - c.y);
        let length = libm::hypot(direction.x, direction.y);
        if length < 0.01 {
            continue;
        }
        let lean = support.height_m * spec.diagonal_lean_ratio;
        let base = point(
            head.x + lean * direction.x / length,
            head.y + lean * direction.y / length,
        );
        let base_ring = ellipse(base.x, base.y, 0.14, 0.14, 16);
        let head_ring = ellipse(head.x, head.y, 0.14, 0.14, 16);
        let projection = crate::geometry::union(
            &segment_strip(base, head, 0.28),
            &crate::geometry::union(&base_ring, &head_ring),
        );
        if area(&difference(&projection, &unit.lot)) > 0.000_01
            || area(&intersection(&projection, &passages(unit))) > 0.002
        {
            continue;
        }
        let mut post = feature(
            format!("detail-{trait_}:{count}"),
            FeatureKind::Post,
            projection,
            support.z_m,
            support.height_m,
            &p.materials.frame,
        );
        post.vertices3d = base_ring[0]
            .outer
            .iter()
            .map(|q| Vertex3 {
                x: q.x,
                y: q.y,
                z: support.z_m,
            })
            .collect();
        post.vertices3d
            .extend(head_ring[0].outer.iter().map(|q| Vertex3 {
                x: q.x,
                y: q.y,
                z: support.z_m + support.height_m,
            }));
        unit.features.push(post);
        count += 1;
    }
    if count == 0 {
        diagnose(
            unit,
            trait_,
            "aucun pilotis sous dalle ne reçoit une diagonale entière hors du passage",
        );
    }
}

fn kitchen_program(unit: &mut HouseUnit, trait_: &str) {
    if unit.rooms.iter().any(|r| r.usage == RoomUsage::Kitchen) {
        return;
    }
    let pair = unit.rooms.iter().enumerate().find_map(|(i, a)| {
        if a.usage != RoomUsage::Living || a.level != 0 {
            return None;
        }
        unit.rooms
            .iter()
            .enumerate()
            .find(|(j, b)| {
                *j != i
                    && b.body_id == a.body_id
                    && b.level == a.level
                    && matches!(
                        b.usage,
                        RoomUsage::Living | RoomUsage::Service | RoomUsage::Storage
                    )
                    && area(&intersection(&offset(&a.floor, 0.6), &b.floor)) > 0.001
            })
            .map(|(j, _)| j)
    });
    if let Some(i) = pair {
        unit.rooms[i].usage = RoomUsage::Kitchen;
    } else {
        diagnose(
            unit,
            trait_,
            "aucune pièce secondaire adjacente à la pièce de vie pour la cuisine",
        );
    }
}

fn windcatcher(unit: &mut HouseUnit, trait_: &str, p: &Parameters) {
    let candidate = unit
        .bodies
        .iter()
        .filter(|b| b.levels.len() == 1 && b.role.residential())
        .find_map(|b| {
            let l = &b.levels[0];
            fit(&difference(&l.floor, &passages(unit)), 1.0).map(|q| (q, l.z_m, l.height_m))
        });
    if let Some((q, z, h)) = candidate {
        let outer = rectangle(q.x - 0.5, q.y - 0.5, 1.0, 1.0);
        let shaft = rectangle(q.x - 0.25, q.y - 0.25, 0.5, 0.5);
        for body in &mut unit.bodies {
            for level in &mut body.levels {
                if let Some(slab) = &mut level.roof_slab
                    && area(&intersection(&slab.surface, &shaft)) > 0.001
                {
                    slab.surface = difference(&slab.surface, &shaft);
                }
            }
        }
        for terrace in unit.features.iter_mut().filter(|f| {
            f.kind == FeatureKind::Terrace && area(&intersection(&f.surface, &shaft)) > 0.001
        }) {
            terrace.surface = difference(&terrace.surface, &shaft);
            terrace.vertices3d = terrace
                .surface
                .iter()
                .flat_map(|poly| &poly.outer)
                .map(|q| Vertex3 {
                    x: q.x,
                    y: q.y,
                    z: terrace.z_m,
                })
                .collect();
        }
        push(
            unit,
            trait_,
            FeatureKind::Windcatcher,
            difference(&outer, &shaft),
            z + h,
            2.4,
            &p.materials.frame,
        );
        if let Some(spec) = &p.detail_spec {
            push(
                unit,
                "ventilation_channels",
                FeatureKind::Flue,
                difference(&outer, &shaft),
                z,
                h,
                &spec.flue_material,
            );
            // The hollow shaft ends in the ground room, without crossing an intermediate floor.
        }
    } else {
        diagnose(
            unit,
            trait_,
            "aucun corps de plain-pied avec un emplacement de capteur dégagé",
        );
    }
}

fn corner_turrets(unit: &mut HouseUnit, trait_: &str, p: &Parameters) {
    let bodies = unit.bodies.clone();
    let mut count = 0;
    for body in bodies {
        let Some(level) = body.levels.last() else {
            continue;
        };
        if body.roof_system != "RF-FLAT" {
            continue;
        }
        for poly in &body.footprint {
            for i in 0..poly.outer.len() {
                let q = poly.outer[i];
                let previous = poly.outer[(i + poly.outer.len() - 1) % poly.outer.len()];
                let next = poly.outer[(i + 1) % poly.outer.len()];
                if (q.x - previous.x) * (next.y - q.y) - (q.y - previous.y) * (next.x - q.x) <= 0.01
                {
                    continue;
                }
                let outer = intersection(&ellipse(q.x, q.y, 0.75, 0.75, 24), &body.footprint);
                let turret = difference(&outer, &offset(&outer, -0.18));
                if push(
                    unit,
                    trait_,
                    FeatureKind::DecorativeWall,
                    turret,
                    level.z_m + level.height_m,
                    body.roof_spec.parapet_height_m + 0.9,
                    &p.materials.infill,
                ) {
                    count += 1;
                }
            }
        }
    }
    if count == 0 {
        diagnose(
            unit,
            trait_,
            "aucun angle convexe de terrasse ne peut porter une tourelle dépassant le parapet",
        );
    }
}

fn brackets(unit: &mut HouseUnit, trait_: &str, p: &Parameters) {
    let bodies = unit.bodies.clone();
    let mut count = 0;
    for body in bodies {
        let Some(level) = body.levels.last() else {
            continue;
        };
        if body.roof_system == "uncovered" || body.overhang_m < 0.15 {
            continue;
        }
        let c = center(&body.footprint);
        for polygon in &body.footprint {
            for (a, b) in polygon
                .outer
                .iter()
                .zip(polygon.outer.iter().cycle().skip(1))
                .take(polygon.outer.len())
            {
                let length = libm::hypot(b.x - a.x, b.y - a.y);
                if length < 1.0 {
                    continue;
                }
                let n = libm::ceil(length / 2.4).max(1.0) as u32;
                for i in 0..n {
                    let q = point(
                        a.x + (b.x - a.x) * (i as f64 + 0.5) / n as f64,
                        a.y + (b.y - a.y) * (i as f64 + 0.5) / n as f64,
                    );
                    let distance = libm::hypot(q.x - c.x, q.y - c.y).max(0.01);
                    let u = [(q.x - c.x) / distance, (q.y - c.y) / distance];
                    let underside = level.z_m + level.height_m
                        - body.overhang_m * libm::tan(body.roof_pitch_deg.to_radians());
                    for tier in 0..3 {
                        let reach = body.overhang_m * (tier as f64 + 1.0) / 3.0;
                        let inside = point(q.x - u[0] * 0.35, q.y - u[1] * 0.35);
                        let outside = point(q.x + u[0] * reach, q.y + u[1] * reach);
                        let surface = segment_strip(inside, outside, 0.16);
                        if area(&difference(&surface, &unit.lot)) > 0.000_01 {
                            continue;
                        }
                        push(
                            unit,
                            trait_,
                            FeatureKind::Frame,
                            surface,
                            underside - 0.36 + tier as f64 * 0.12,
                            0.12,
                            &p.materials.roof_frame,
                        );
                        count += 1;
                    }
                }
            }
        }
    }
    if count == 0 {
        diagnose(
            unit,
            trait_,
            "aucun débord de toiture ne reçoit les trois assises de consoles",
        );
    }
}

fn arcs(unit: &mut HouseUnit, trait_: &str, material: &str) {
    let bodies = unit.bodies.clone();
    let mut count = 0;
    for body in bodies {
        let Some(level) = body.levels.last() else {
            continue;
        };
        let b = bounds(&body.footprint);
        let z = level.z_m + level.height_m;
        let n = ((b[3] - b[1]) / 2.4).floor().clamp(1.0, 24.0) as u32;
        for i in 0..=n {
            let y = b[1] + (b[3] - b[1]) * i as f64 / n as f64;
            let surface = intersection(
                &rectangle(b[0], y - 0.06, b[2] - b[0], 0.12),
                &body.footprint,
            );
            let mut arc = feature(
                format!("detail-{trait_}-{}", unit.features.len()),
                FeatureKind::RoofArc,
                surface,
                z,
                0.12,
                material,
            );
            arc.vertices3d = (0..=12)
                .map(|section| {
                    let t = section as f64 / 12.0;
                    Vertex3 {
                        x: b[0] + (b[2] - b[0]) * t,
                        y,
                        z: z + libm::sin(std::f64::consts::PI * t) * (b[2] - b[0]) * 0.18,
                    }
                })
                .collect();
            if area(&arc.surface) > 0.002 {
                unit.features.push(arc);
                count += 1;
            }
        }
    }
    if count == 0 {
        diagnose(unit, trait_, "aucun volume ne porte d'arcs de charpente");
    }
}

fn gallery(unit: &mut HouseUnit, trait_: &str, material: &str, columns: bool) {
    let existing: Vec<_> = unit
        .features
        .iter()
        .filter(|f| f.kind == FeatureKind::Gallery)
        .cloned()
        .collect();
    if !existing.is_empty() {
        if columns && !unit.features.iter().any(|f| f.kind == FeatureKind::Arcade) {
            for f in existing {
                push(
                    unit,
                    trait_,
                    FeatureKind::Arcade,
                    f.surface,
                    f.z_m,
                    2.7,
                    material,
                );
            }
        }
        return;
    }
    let courts = unit.partition.courtyards.clone();
    if courts.is_empty() {
        front_gallery(unit, trait_, material, columns);
        return;
    }
    let ring = difference(&courts, &offset(&courts, -0.85));
    // The gallery itself is a circulation surface; only portal voids cut its cover.
    let surface = difference(
        &ring,
        &unite(
            &unit
                .access
                .portals
                .iter()
                .map(|p| p.passage.clone())
                .collect::<Vec<_>>(),
        ),
    );
    let z = floor_z(unit);
    push(
        unit,
        trait_,
        if columns {
            FeatureKind::Arcade
        } else {
            FeatureKind::Gallery
        },
        surface.clone(),
        z,
        2.7,
        material,
    );
    if columns {
        push(
            unit,
            trait_,
            FeatureKind::Gallery,
            surface.clone(),
            z,
            0.12,
            material,
        );
        for polygon in &surface {
            for (index, q) in polygon.outer.iter().enumerate().filter(|(i, _)| i % 2 == 0) {
                let column = ellipse(q.x, q.y, 0.13, 0.13, 16);
                if area(&intersection(&column, &unit.lot)) > 0.002 {
                    push(
                        unit,
                        &format!("{trait_}-column-{index}"),
                        FeatureKind::Post,
                        column,
                        z,
                        2.7,
                        material,
                    );
                }
            }
        }
    }
}

fn front_gallery(unit: &mut HouseUnit, trait_: &str, material: &str, columns: bool) {
    let lateral = matches!(trait_, "continuous_veranda" | "side_corridor");
    let bodies = unit.bodies.clone();
    let mut count = 0;
    for body in bodies {
        let Some(level) = body.levels.first() else {
            continue;
        };
        let b = bounds(&level.footprint);
        let width = 0.85;
        let surface = if lateral {
            rectangle(b[2], b[1], width, b[3] - b[1])
        } else {
            rectangle(b[0], b[3], b[2] - b[0], width)
        };
        let surface = intersection(&surface, &unit.lot);
        if !push(
            unit,
            trait_,
            FeatureKind::Gallery,
            surface.clone(),
            level.z_m,
            2.7,
            material,
        ) {
            continue;
        }
        if columns {
            push(
                unit,
                trait_,
                FeatureKind::Arcade,
                surface.clone(),
                level.z_m,
                2.7,
                material,
            );
        }
        let g = bounds(&surface);
        for q in [
            point(g[0] + 0.13, g[1] + 0.13),
            point(g[2] - 0.13, g[3] - 0.13),
        ] {
            push(
                unit,
                trait_,
                FeatureKind::Post,
                ellipse(q.x, q.y, 0.1, 0.1, 16),
                level.z_m,
                2.7,
                material,
            );
        }
        count += 1;
    }
    if count == 0 {
        diagnose(
            unit,
            trait_,
            "aucun bord de corps n'a le dégagement d'une galerie de 0,85 m",
        );
    }
}

fn cover_arm(surface: Surface, mut axis: [f64; 2]) -> RoofArm {
    let projections = |axis: [f64; 2]| {
        surface.iter().flat_map(|p| &p.outer).fold(
            [
                f64::INFINITY,
                f64::INFINITY,
                f64::NEG_INFINITY,
                f64::NEG_INFINITY,
            ],
            |mut b, q| {
                let u = q.x * axis[0] + q.y * axis[1];
                let v = -q.x * axis[1] + q.y * axis[0];
                b[0] = b[0].min(u);
                b[1] = b[1].min(v);
                b[2] = b[2].max(u);
                b[3] = b[3].max(v);
                b
            },
        )
    };
    let mut b = projections(axis);
    if b[3] - b[1] > b[2] - b[0] {
        axis = [-axis[1], axis[0]];
        b = projections(axis);
    }
    RoofArm {
        origin: point(
            b[0] * axis[0] - b[1] * axis[1],
            b[0] * axis[1] + b[1] * axis[0],
        ),
        axis,
        length_m: b[2] - b[0],
        width_m: b[3] - b[1],
        domain: surface,
    }
}

fn gallery_arms(surface: &Surface, sections: u32) -> Result<Vec<RoofArm>, String> {
    let mut arms = vec![];
    for polygon in surface {
        let shape = vec![polygon.clone()];
        let b = bounds(&shape);
        if polygon.holes.len() == 1 && polygon.outer.len() == 4 && polygon.holes[0].len() == 4 {
            let h = bounds(&vec![Polygon {
                outer: polygon.holes[0].clone(),
                holes: vec![],
            }]);
            for band in [
                rectangle(b[0], b[1], b[2] - b[0], h[1] - b[1]),
                rectangle(b[0], h[3], b[2] - b[0], b[3] - h[3]),
                rectangle(b[0], h[1], h[0] - b[0], h[3] - h[1]),
                rectangle(h[2], h[1], b[2] - h[2], h[3] - h[1]),
            ] {
                let domain = intersection(&shape, &band);
                if area(&domain) > 0.000_01 {
                    arms.push(cover_arm(domain, [1.0, 0.0]));
                }
            }
        } else if !polygon.holes.is_empty() {
            if surface.len() != 1 || !(8..=96).contains(&sections) {
                return Err(
                    "Galerie radiale sans domaine unique ou résolution explicite valide.".into(),
                );
            }
            let q = center(&vec![Polygon {
                outer: polygon.holes[0].clone(),
                holes: vec![],
            }]);
            let rx = (b[2] - b[0]) * 0.5;
            let ry = (b[3] - b[1]) * 0.5;
            let radius = libm::hypot(b[2] - b[0], b[3] - b[1]) * 2.0;
            let n = sections;
            let rays: Vec<_> = (0..n)
                .map(|i| {
                    let angle = std::f64::consts::TAU * i as f64 / n as f64;
                    point(
                        q.x + radius * libm::cos(angle),
                        q.y + radius * libm::sin(angle),
                    )
                })
                .collect();
            let exact_areas = gallery_partition::certify(&shape, q, &rays)?;
            for i in 0..n {
                let a = std::f64::consts::TAU * i as f64 / n as f64;
                let z = std::f64::consts::TAU * (i + 1) as f64 / n as f64;
                let wedge = vec![Polygon {
                    outer: vec![q, rays[i as usize], rays[(i as usize + 1) % rays.len()]],
                    holes: vec![],
                }];
                // This approximate portion selects the frame only. Native roof
                // clipping consumes the shared Raw mask against Attachment.domain.
                let domain = intersection(&shape, &wedge);
                if gallery_partition::real_portion(&exact_areas[i as usize], area(&domain))? {
                    let angle = (a + z) * 0.5;
                    let tangent = [-libm::sin(angle) / (ry * ry), libm::cos(angle) / (rx * rx)];
                    let length = libm::hypot(tangent[0], tangent[1]);
                    let mut arm = cover_arm(domain, [tangent[0] / length, tangent[1] / length]);
                    arm.domain = wedge;
                    arms.push(arm);
                }
            }
        } else {
            let mut axis = [1.0, 0.0];
            let mut longest = 0.0;
            for (a, q) in polygon
                .outer
                .iter()
                .zip(polygon.outer.iter().cycle().skip(1))
                .take(polygon.outer.len())
            {
                let length = libm::hypot(q.x - a.x, q.y - a.y);
                if length > longest {
                    longest = length;
                    axis = [(q.x - a.x) / length, (q.y - a.y) / length];
                }
            }
            arms.push(cover_arm(shape, axis));
        }
    }
    Ok(arms)
}

fn cover_galleries(unit: &mut HouseUnit, p: &Parameters) -> Result<(), String> {
    if !p.gallery_cover.enabled {
        return Ok(());
    }
    let galleries: Vec<_> = unit
        .features
        .iter()
        .filter(|f| f.kind == FeatureKind::Gallery && f.roof.is_none())
        .cloned()
        .collect();
    for mut gallery in galleries {
        let slabs: Vec<_> = unit
            .bodies
            .iter()
            .flat_map(|b| {
                b.levels.iter().filter_map(move |l| {
                    l.roof_slab
                        .as_ref()
                        .filter(|s| s.z_m >= gallery.z_m + 2.0)
                        .map(|s| (b.id.clone(), l.index, s.surface.clone()))
                })
            })
            .collect();
        let covered = intersection(
            &gallery.surface,
            &unite(&slabs.iter().map(|(_, _, s)| s.clone()).collect::<Vec<_>>()),
        );
        if area(&covered) > 0.000_01 {
            let outside = difference(&gallery.surface, &covered);
            let provenance = slabs
                .iter()
                .filter(|(_, _, s)| area(&intersection(s, &gallery.surface)) > 0.000_01)
                .map(|(id, level, _)| format!("{id}:niveau{level}"))
                .collect::<Vec<_>>()
                .join(", ");
            unit.diagnostics.push(format!("Galerie {} : attribution avant accès de {:.3} m² à dalle(s) {provenance}, hauteur libre ≥2 m ; vérification finale après trémies.",gallery.id,area(&covered)));
            if area(&outside) < crate::geometry::area_tolerance(&gallery.surface) {
                continue;
            }
            let mut under_slab = gallery.clone();
            under_slab.id = format!("{}:slab-covered", gallery.id);
            under_slab.surface = covered;
            under_slab.roof = None;
            unit.features.push(under_slab);
            gallery.surface = outside;
            unit.features
                .iter_mut()
                .find(|f| f.id == gallery.id)
                .unwrap()
                .surface = gallery.surface.clone();
        }
        let q = center(&gallery.surface);
        let owner = unit
            .bodies
            .iter()
            .flat_map(|b| {
                b.levels
                    .iter()
                    .filter(|l| (l.z_m - gallery.z_m).abs() < 0.001)
                    .map(move |l| (b, l))
            })
            .min_by(|(_, a), (_, b)| {
                let qa = center(&a.footprint);
                let qb = center(&b.footprint);
                libm::hypot(q.x - qa.x, q.y - qa.y).total_cmp(&libm::hypot(q.x - qb.x, q.y - qb.y))
            });
        let Some((body, level)) = owner else {
            diagnose(
                unit,
                "covered_gallery",
                &format!("{} sans niveau porteur à sa cote déclarée", gallery.id),
            );
            continue;
        };
        let owner_id = body.id.clone();
        let level_index = level.index;
        let mats = level.materials.clone();
        let arms = gallery_arms(&gallery.surface, p.gallery_cover.spec.round_segments)
            .map_err(|e| format!("{e} Galerie {}.", gallery.id))?;
        let declared = unite(
            &arms
                .iter()
                .map(|a| intersection(&gallery.surface, &a.domain))
                .collect::<Vec<_>>(),
        );
        if area(&difference(&gallery.surface, &declared))
            > crate::geometry::area_tolerance(&gallery.surface)
        {
            return Err(format!(
                "Galerie {} : découpe de couverture incomplète.",
                gallery.id
            ));
        }
        let support_z = gallery.z_m + p.gallery_cover.height_m;
        let post_radius =
            if gallery.id.starts_with("court-pocket-") || gallery.id.starts_with("ranked-court-") {
                p.court_program
                    .as_ref()
                    .and_then(|c| c.portico.as_ref())
                    .map_or(0.06, |s| s.post_m * 0.5)
            } else {
                0.06
            };
        let mut supports = vec![];
        let mut sequence = 0;
        for polygon in &gallery.surface {
            for ring in std::iter::once(&polygon.outer).chain(&polygon.holes) {
                for (a, b) in ring
                    .iter()
                    .zip(ring.iter().cycle().skip(1))
                    .take(ring.len())
                {
                    let n = libm::ceil(
                        libm::hypot(b.x - a.x, b.y - a.y) / p.gallery_cover.support_spacing_m,
                    )
                    .max(1.0) as usize;
                    for i in 0..n {
                        let t = i as f64 / n as f64;
                        let id = format!("gallery-support:{}:{sequence}", gallery.id);
                        sequence += 1;
                        let post = intersection(
                            &ellipse(
                                a.x + (b.x - a.x) * t,
                                a.y + (b.y - a.y) * t,
                                post_radius,
                                post_radius,
                                12,
                            ),
                            &unit.lot,
                        );
                        if area(&post) < 0.002 {
                            return Err(format!(
                                "Galerie {} : appui de rive hors lot.",
                                gallery.id
                            ));
                        }
                        unit.features.push(feature(
                            id.clone(),
                            FeatureKind::Post,
                            post,
                            gallery.z_m,
                            p.gallery_cover.height_m,
                            &mats.roof_frame,
                        ));
                        supports.push(id);
                    }
                }
            }
        }
        let attachment = RoofAttachment {
            nested: false,
            owner_body_id: Some(owner_id),
            level: level_index,
            domain: gallery.surface.clone(),
            rf: p.gallery_cover.rf.clone(),
            spec: p.gallery_cover.spec.clone(),
            arms,
            support_z_m: support_z,
            pitch_deg: p.gallery_cover.pitch_deg,
            overhang_m: 0.0,
            material: mats.cladding,
            frame_material: mats.roof_frame,
            supports,
            max_span_m: p.gallery_cover.max_span_m,
        };
        unit.features
            .iter_mut()
            .find(|f| f.id == gallery.id)
            .unwrap()
            .roof = Some(attachment);
        unit.diagnostics.push(format!("Galerie {} : couverture graphique déclarée {} à +{:.2} m, pente {:.1}°, poteaux espacés ≤{:.2} m, portée ≤{:.2} m.",gallery.id,p.gallery_cover.rf,p.gallery_cover.height_m,p.gallery_cover.pitch_deg,p.gallery_cover.support_spacing_m,p.gallery_cover.max_span_m));
    }
    Ok(())
}

fn open_sides(unit: &mut HouseUnit, trait_: &str, one: bool, material: &str) {
    let bodies = unit.bodies.clone();
    let mut count = 0;
    for body in bodies {
        if body.envelope == Envelope::Open {
            count += 1;
            continue;
        }
        for level in &body.levels {
            let b = bounds(&level.footprint);
            let thickness = body.wall_thickness_m + 0.15;
            let mut cuts = vec![rectangle(
                b[0] - 0.1,
                b[3] - thickness,
                b[2] - b[0] + 0.2,
                thickness + 0.1,
            )];
            if !one {
                cuts.push(rectangle(
                    b[2] - thickness,
                    b[1] - 0.1,
                    thickness + 0.1,
                    b[3] - b[1] + 0.2,
                ));
            }
            let opening = unite(&cuts);
            let mut removed = 0.0;
            for wall in unit.walls.iter_mut().filter(|w| {
                w.body_id.as_deref() == Some(&body.id)
                    && w.level == level.index
                    && matches!(w.kind, WallKind::Exterior | WallKind::Shell)
            }) {
                removed += area(&intersection(&wall.footprint, &opening));
                wall.footprint = difference(&wall.footprint, &opening);
            }
            if removed > 0.01 {
                let header = intersection(
                    &rectangle(b[0], b[3] - thickness, b[2] - b[0], 0.16),
                    &level.footprint,
                );
                push(
                    unit,
                    trait_,
                    FeatureKind::Frame,
                    header,
                    level.z_m + level.height_m - 0.18,
                    0.18,
                    material,
                );
                count += 1;
            }
        }
    }
    unit.walls.retain(|wall| area(&wall.footprint) > 0.002);
    if count == 0 {
        diagnose(
            unit,
            trait_,
            "aucun pan d'enveloppe ne peut être ouvert dans le programme résolu",
        );
    }
}

fn buttresses(unit: &mut HouseUnit, trait_: &str, material: &str) {
    let blocked = passages(unit);
    let bodies = unit.bodies.clone();
    let mut count = 0;
    for body in bodies {
        let b = bounds(&body.footprint);
        let z = body.levels.first().map_or(0.0, |level| level.z_m);
        for x in [b[0] + 0.6, b[2] - 0.6] {
            let surface = rectangle(x - 0.22, b[3] - 0.1, 0.44, 0.65);
            if area(&intersection(&surface, &blocked)) < 0.002 {
                push(
                    unit,
                    trait_,
                    FeatureKind::Retaining,
                    surface,
                    z,
                    2.1,
                    material,
                );
                count += 1;
            }
        }
    }
    if count == 0 {
        diagnose(
            unit,
            trait_,
            "les murs disponibles sont entièrement pris par les passages",
        );
    }
}

fn balcony(unit: &mut HouseUnit, trait_: &str, material: &str) {
    let bodies = unit.bodies.clone();
    let mut count = 0;
    for body in bodies {
        if body.levels.len() < 2 {
            continue;
        }
        let level = &body.levels[1];
        let b = bounds(&level.footprint);
        let width = ((b[2] - b[0]) * 0.5).min(5.0);
        let surface = rectangle((b[0] + b[2] - width) * 0.5, b[3], width, 0.9);
        push(
            unit,
            trait_,
            FeatureKind::Balcony,
            surface,
            level.z_m,
            0.2,
            material,
        );
        count += 1;
    }
    if count == 0 {
        diagnose(
            unit,
            trait_,
            "la variante sélectionnée ne possède pas d'étage pour un balcon",
        );
    }
}

fn existing(unit: &mut HouseUnit, trait_: &str, kinds: &[FeatureKind], reason: &str) {
    if !unit
        .features
        .iter()
        .chain(&unit.site_context)
        .any(|feature| kinds.contains(&feature.kind))
    {
        diagnose(unit, trait_, reason);
    }
}

fn site_slope(unit: &mut HouseUnit, p: &Parameters, config: &HouseConfig) {
    let degrees = config.overrides.site_slope_deg.unwrap_or_else(|| {
        p.structural_spec
            .as_ref()
            .and_then(|s| s.retaining.as_ref())
            .map_or(0.0, |s| s.terrain_slope_deg)
    });
    if degrees == 0.0 {
        return;
    }
    let b = bounds(&unit.lot);
    let gradient = libm::tan(degrees.to_radians());
    let mut terrain = feature(
        "site-slope".into(),
        FeatureKind::SiteSlope,
        unit.lot.clone(),
        -(b[3] - b[1]) * gradient,
        0.0,
        "",
    );
    for vertex in &mut terrain.vertices3d {
        vertex.z = (vertex.y - b[3]) * gradient;
    }
    unit.site_context.push(terrain);
    for support in unit
        .features
        .iter_mut()
        .filter(|f| matches!(f.kind, FeatureKind::Post | FeatureKind::Pier))
    {
        let q = center(&support.surface);
        let ground = (q.y - b[3]) * gradient;
        if support.z_m <= 0.01 {
            let top = support.z_m + support.height_m;
            support.z_m = ground;
            support.height_m = top - ground;
            let low = support
                .vertices3d
                .iter()
                .map(|v| v.z)
                .fold(f64::INFINITY, f64::min);
            let high = support
                .vertices3d
                .iter()
                .map(|v| v.z)
                .fold(f64::NEG_INFINITY, f64::max);
            if high - low > 0.1 {
                // Explicit diagonals keep their head ring and its xy anchorage.
                for v in &mut support.vertices3d {
                    if (v.z - low).abs() < 0.001 {
                        v.z = (v.y - b[3]) * gradient;
                    }
                }
                support.z_m = support.vertices3d.iter().map(|v| v.z).fold(top, f64::min);
                support.height_m = top - support.z_m;
            } else {
                support.vertices3d = support
                    .surface
                    .iter()
                    .flat_map(|polygon| &polygon.outer)
                    .map(|q| Vertex3 {
                        x: q.x,
                        y: q.y,
                        z: (q.y - b[3]) * gradient,
                    })
                    .collect();
            }
        }
    }
    let bodies = unit.bodies.clone();
    for body in bodies {
        if body.envelope == Envelope::Membrane || p.support.kind != SupportKind::Ground {
            continue;
        }
        let floor = body.levels.first().map_or(0.0, |level| level.z_m);
        let mut base = feature(
            format!("slope-footing-{}", body.id),
            FeatureKind::WallFooting,
            body.footprint.clone(),
            floor,
            0.0,
            &p.materials.base,
        );
        let bottom = body
            .footprint
            .iter()
            .flat_map(|polygon| &polygon.outer)
            .map(|q| Vertex3 {
                x: q.x,
                y: q.y,
                z: (q.y - b[3]) * gradient,
            })
            .collect::<Vec<_>>();
        let min = bottom.iter().map(|q| q.z).fold(floor, f64::min);
        base.z_m = min;
        base.height_m = floor - min;
        base.vertices3d = bottom;
        base.vertices3d.extend(
            body.footprint
                .iter()
                .flat_map(|polygon| &polygon.outer)
                .map(|q| Vertex3 {
                    x: q.x,
                    y: q.y,
                    z: floor,
                }),
        );
        unit.features.push(base);
    }
}

fn planned_vertical(unit: &mut HouseUnit, trait_: &str, p: &Parameters, stairs: bool) {
    let compatible = |kind| {
        if stairs {
            matches!(
                kind,
                VerticalAccess::InternalStair
                    | VerticalAccess::ExteriorStair
                    | VerticalAccess::IntramuralStair
            )
        } else {
            kind != VerticalAccess::None
        }
    };
    if !unit
        .bodies
        .iter()
        .any(|body| compatible(body.vertical_access))
        && !p.vertical_routes.iter().any(|route| compatible(route.kind))
        && !(stairs && p.support.height_m[1] > 0.3)
    {
        diagnose(
            unit,
            trait_,
            "aucune interface verticale compatible n'est déclarée dans le bundle résolu",
        );
    }
}

fn roof_trait(unit: &mut HouseUnit, trait_: &str, p: &Parameters) {
    let compatible = unit.bodies.iter().any(|body| {
        let rf = body.roof_system.as_str();
        match trait_ {
            "parapet" => rf == "RF-FLAT" && body.roof_spec.parapet_height_m > 0.0,
            "scupper" => rf == "RF-FLAT",
            "stepped_gable" => rf == "RF-STEEP-STEP",
            "roof_steps" => rf == "RF-STEP" || (rf == "RF-FLAT" && p.layout == Layout::HighHall),
            "tiered_roofs" => rf == "RF-TIERED" && body.roof_spec.tiers > 1,
            "crown" | "high_crown" => {
                rf == "RF-TENT"
                    || (matches!(rf, "RF-DOME" | "RF-DOME-CONE")
                        && body.roof_spec.oculus_ratio > 0.0)
            }
            "smoke_flaps" => rf == "RF-TENT",
            "high_cone" => matches!(rf, "RF-CONE" | "RF-DOME-CONE"),
            "high_hip" => matches!(rf, "RF-HIP" | "RF-EAVES"),
            "high_central_pyramid" => matches!(rf, "RF-HIP" | "RF-TIERED" | "RF-MULTIPAV"),
            "saddle_ends" | "small_saddle" => rf == "RF-SADDLE",
            "multiple_horns" => rf == "RF-SADDLE" && body.roof_spec.horns.is_some(),
            "shed" => rf == "RF-SHED",
            "inward_roof" => p.layout == Layout::Atrium && matches!(rf, "RF-HIP" | "RF-GABLE"),
            "high_gables"
            | "high_projected_gables"
            | "projected_gables"
            | "turf_gables"
            | "thatch_gable" => {
                matches!(rf, "RF-GABLE" | "RF-EAVES" | "RF-SADDLE" | "RF-STEEP-STEP")
            }
            "wide_eaves" | "tile_eaves" => rf != "uncovered" && body.overhang_m >= 0.3,
            "stone_crown" => matches!(rf, "RF-CONE" | "RF-DOME" | "RF-DOME-CONE"),
            "palm_roof" => p.materials.cladding == "MAT-PALM",
            "bark_roof" => p.materials.cladding == "MAT-BARK",
            "high_central_hall" => {
                p.layout == Layout::HighHall
                    && body.component_id.as_deref() == Some("nile_core")
                    && unit
                        .bodies
                        .iter()
                        .filter(|b| {
                            b.component_id
                                .as_deref()
                                .is_some_and(|c| c.starts_with("nile_wing_"))
                        })
                        .all(|b| {
                            b.levels.last().is_some_and(|l| {
                                l.z_m + l.height_m
                                    < body.levels.last().unwrap().z_m
                                        + body.levels.last().unwrap().height_m
                            })
                        })
            }
            "interlocking_roofs" => rf != "uncovered" && unit.bodies.len() > 1,
            _ => false,
        }
    });
    if !compatible {
        diagnose(
            unit,
            trait_,
            "le RF et ses paramètres déclarés ne produisent pas ce détail dans le bundle sélectionné",
        );
    }
}

fn layout_trait(unit: &mut HouseUnit, trait_: &str, p: &Parameters) {
    let separate = unit.bodies.len() > 1;
    let courts = !unit.partition.courtyards.is_empty();
    let (present, reason) = match trait_ {
        "added_rooms" => (
            p.layout == Layout::Additive && separate,
            "aucun ajout de corps dans un plan additif",
        ),
        "attached_kiva" => (
            unit.bodies
                .iter()
                .any(|b| b.role == Role::NonDomestic && b.component_id.as_deref() == Some("kiva")),
            "aucun composant kiva distinct du logement",
        ),
        "boat_plan" => (
            p.footprint_family == "FP-APSIDAL",
            "aucune terminaison absidiale dans le plan résolu",
        ),
        "castro_cells" => (
            separate && matches!(p.layout, Layout::Additive | Layout::HutCompound),
            "aucun assemblage de cellules castro",
        ),
        "central_aisle" => (
            unit.features.iter().any(|f| f.kind == FeatureKind::Gallery),
            "aucune allée centrale séparée des pièces par le layout",
        ),
        "central_pavilion" => (
            unit.bodies
                .iter()
                .any(|b| b.component_id.as_deref() == Some("central_hall")),
            "aucun pavillon central déclaré comme composant",
        ),
        "compartmented_court" => (
            p.court_program.as_ref().is_some_and(|s| {
                s.compartments == 2
                    && (0..s.compartments).all(|i| {
                        unit.features.iter().any(|f| {
                            f.id == format!("court-pocket-{i}")
                                && f.kind == FeatureKind::Courtyard
                                && area(&f.surface) > 1.0
                        }) && unit.walls.iter().any(|w| {
                            w.id == format!("wall:court-pocket-{i}-walls")
                                && area(&crate::wall_geometry::wall_section(w, 1.0)) > 0.1
                        })
                    })
            }),
            "aucune poche de cour avec domaine libre et murs natifs",
        ),
        "few_partitions" => (
            !unit.bodies.is_empty() && unit.rooms.len() <= unit.bodies.len() * 3,
            "le plan résolu comporte plus de trois pièces par corps",
        ),
        "iwans" => (
            courts
                && p.court_program
                    .as_ref()
                    .and_then(|s| s.iwans.as_ref())
                    .is_some_and(|spec| {
                        unit.bodies
                            .iter()
                            .filter(|b| {
                                b.component_id
                                    .as_deref()
                                    .is_some_and(|id| id.starts_with("iwan-"))
                            })
                            .count()
                            == spec.count as usize
                            && unit
                                .bodies
                                .iter()
                                .filter(|b| {
                                    b.component_id
                                        .as_deref()
                                        .is_some_and(|id| id.starts_with("iwan-"))
                                })
                                .all(|b| {
                                    iwan_opening(b, spec.min_open_ratio).is_some_and(|opening| {
                                        !unit.walls.iter().any(|w| {
                                            w.body_id.as_deref() == Some(&b.id)
                                                && area(&intersection(&w.footprint, &opening))
                                                    > 0.000_001
                                        })
                                    })
                                })
                    }),
            "aucun iwan ouvert sur une cour dans le layout",
        ),
        "large_vestibule" => (
            unit.features
                .iter()
                .any(|f| matches!(f.kind, FeatureKind::Gallery | FeatureKind::Landing))
                || unit
                    .bodies
                    .iter()
                    .any(|b| b.component_id.as_deref() == Some("conical_vestibule")),
            "aucun vestibule distributif coté dans le layout",
        ),
        "livestock_pen" => (
            unit.features
                .iter()
                .any(|f| f.kind == FeatureKind::LivestockPen),
            "aucun enclos réservé au bétail",
        ),
        "long_hall" => (
            unit.bodies.iter().any(|b| {
                let d = bounds(&b.footprint);
                let w = d[2] - d[0];
                let h = d[3] - d[1];
                w.max(h) / w.min(h) >= 1.7
            }),
            "aucun corps allongé selon le programme",
        ),
        "mixed_round_square" => (
            p.components
                .iter()
                .any(|c| c.footprint_family == "FP-ROUND")
                && p.components
                    .iter()
                    .any(|c| matches!(c.footprint_family.as_str(), "FP-RECT" | "FP-SQUARE")),
            "les composants résolus ne mêlent pas cellules rondes et carrées",
        ),
        "mobile_oval_tents" => (
            unit.bodies.iter().any(|b| b.envelope == Envelope::Membrane)
                && p.components.iter().any(|c| c.footprint_family == "FP-OVAL"),
            "aucune tente ovale à membrane dans les composants",
        ),
        "north_hall" => (
            unit.bodies
                .iter()
                .any(|b| b.component_id.as_deref() == Some("north_hall")),
            "aucune salle nord identifiée",
        ),
        "peripheral_huts" => (
            separate && matches!(p.layout, Layout::HutCompound | Layout::Kraal),
            "aucune disposition de huttes périphériques",
        ),
        "separate_bodies" | "separate_pavilions" => {
            (separate, "le programme résolu ne contient qu'un corps")
        }
        "successive_courts" => (
            unit.partition.courtyards.len() > 1,
            "aucune succession de cours distinctes",
        ),
        "three_hierarchical_courts" => (
            unit.partition.courtyards.len() >= 3,
            "le layout ne réserve pas trois cours distinctes",
        ),
        "rounded_corners" => (
            matches!(
                p.footprint_family.as_str(),
                "FP-OVAL" | "FP-APSIDAL" | "FP-ROUND"
            ),
            "aucune primitive à coins arrondis dans le bundle",
        ),
        "defensive_tower" | "high_earth_tower" | "massive_stone_tower" | "sandstone_tower" => (
            unit.bodies.iter().any(|b| b.levels.len() >= 3),
            "aucun volume de tour d'au moins trois niveaux",
        ),
        "stair_tower" => (
            unit.bodies.iter().any(|b| {
                b.levels.len() > 1
                    && matches!(
                        b.vertical_access,
                        VerticalAccess::InternalStair | VerticalAccess::IntramuralStair
                    )
            }),
            "aucune tour à accès vertical intérieur déclaré",
        ),
        "stone_cells" => (
            !unit.rooms.is_empty()
                && unit
                    .walls
                    .iter()
                    .any(|w| w.material.starts_with("MAT-STONE") || w.material == "MAT-BASALT"),
            "aucune cellule délimitée par de la maçonnerie de pierre",
        ),
        "low_basalt_wall" => (
            unit.walls
                .iter()
                .any(|w| w.material == "MAT-BASALT" && w.height_m <= 2.0),
            "aucun mur bas de basalte dans la géométrie résolue",
        ),
        "setbacks" => (
            unit.bodies.iter().any(|b| {
                b.levels
                    .windows(2)
                    .any(|l| area(&l[1].footprint) + 0.1 < area(&l[0].footprint))
            }),
            "aucun retrait réel des niveaux supérieurs",
        ),
        _ => unreachable!("layout trait has a closed caller"),
    };
    if !present {
        diagnose(unit, trait_, reason);
    }
}

fn iwan_opening(body: &crate::model::Body, ratio: f64) -> Option<Surface> {
    let name = body.component_id.as_deref()?.strip_prefix("iwan-")?;
    let b = bounds(&body.footprint);
    let t = body.wall_thickness_m;
    let opening = match name {
        "north" => rectangle(
            (b[0] + b[2] - (b[2] - b[0]) * ratio) * 0.5,
            b[3] - t,
            (b[2] - b[0]) * ratio,
            t + 0.001,
        ),
        "south" => rectangle(
            (b[0] + b[2] - (b[2] - b[0]) * ratio) * 0.5,
            b[1] - 0.001,
            (b[2] - b[0]) * ratio,
            t + 0.001,
        ),
        "east" => rectangle(
            b[0] - 0.001,
            (b[1] + b[3] - (b[3] - b[1]) * ratio) * 0.5,
            t + 0.001,
            (b[3] - b[1]) * ratio,
        ),
        "west" => rectangle(
            b[2] - t,
            (b[1] + b[3] - (b[3] - b[1]) * ratio) * 0.5,
            t + 0.001,
            (b[3] - b[1]) * ratio,
        ),
        _ => return None,
    };
    Some(opening)
}

fn open_iwans(unit: &mut HouseUnit, p: &Parameters) -> Result<(), String> {
    let Some(spec) = p.court_program.as_ref().and_then(|c| c.iwans.as_ref()) else {
        return Ok(());
    };
    let bodies = unit.bodies.clone();
    let mut opened = 0;
    for body in bodies {
        let Some(opening) = iwan_opening(&body, spec.min_open_ratio) else {
            continue;
        };
        if body
            .roof_spec
            .vault
            .as_ref()
            .is_none_or(|v| v.open_ends.is_empty())
        {
            return Err(format!(
                "Iwan {} sans extrémité de voûte ouverte déclarée.",
                body.id
            ));
        }
        for wall in unit
            .walls
            .iter_mut()
            .filter(|w| w.body_id.as_deref() == Some(&body.id))
        {
            if wall.solid.is_some() {
                return Err(
                    "La baie d’iwan doit précéder les coupes volumétriques d’accès.".into(),
                );
            }
            wall.footprint = difference(&wall.footprint, &opening);
        }
        for room in unit.rooms.iter_mut().filter(|r| r.body_id == body.id) {
            room.usage = RoomUsage::Hall;
        }
        opened += 1;
        unit.diagnostics.push(format!("Iwan {} : façade de cour réellement ouverte sur {:.1}% de sa largeur à chaque niveau ; aucune galerie ni tympan dans l’ouverture.",body.id,spec.min_open_ratio*100.0));
    }
    unit.walls.retain(|w| area(&w.footprint) > 0.000_001);
    if opened != spec.count {
        return Err(format!(
            "Iwans : {} baies physiques obtenues pour {} déclarées.",
            opened, spec.count
        ));
    }
    Ok(())
}

fn moorings(unit: &mut HouseUnit, p: &Parameters) -> Result<(), String> {
    let Some(spec) = p.structural_spec.as_ref().and_then(|s| s.mooring.as_ref()) else {
        diagnose(unit, "moorings", "aucun programme d’amarres 3D déclaré");
        return Ok(());
    };
    if !(3..=12).contains(&spec.count)
        || spec.diameter_m <= 0.0
        || spec.anchor_offset_m <= 0.0
        || spec.anchor_depth_m <= 0.0
        || spec.anchor_width_m <= 0.0
        || spec.anchor_height_m <= 0.0
    {
        return Err("Amarres : nombre et dimensions physiques invalides.".into());
    }
    let rafts: Vec<_> = unit
        .features
        .iter()
        .filter(|f| f.kind == FeatureKind::Raft)
        .cloned()
        .collect();
    if rafts.is_empty() {
        diagnose(unit, "moorings", "aucun radeau à amarrer");
        return Ok(());
    }
    for (r, raft) in rafts.iter().enumerate() {
        let b = bounds(&raft.surface);
        let c = point((b[0] + b[2]) * 0.5, (b[1] + b[3]) * 0.5);
        for i in 0..spec.count {
            // West, north and east attachments leave the actual southern
            // shore-access frontage free, with different anchoring directions.
            let angle =
                std::f64::consts::PI + std::f64::consts::PI * i as f64 / (spec.count - 1) as f64;
            let dx = libm::cos(angle);
            let dy = libm::sin(angle);
            let rx = if dx.abs() > 0.000_001 {
                (b[2] - b[0]) * 0.5 / dx.abs()
            } else {
                f64::INFINITY
            };
            let ry = if dy.abs() > 0.000_001 {
                (b[3] - b[1]) * 0.5 / dy.abs()
            } else {
                f64::INFINITY
            };
            let q = point(c.x + dx * rx.min(ry), c.y + dy * rx.min(ry));
            let a = point(
                q.x + dx * spec.anchor_offset_m,
                q.y + dy * spec.anchor_offset_m,
            );
            let anchor = rectangle(
                a.x - spec.anchor_width_m * 0.5,
                a.y - spec.anchor_width_m * 0.5,
                spec.anchor_width_m,
                spec.anchor_width_m,
            );
            let surface = segment_strip(q, a, spec.diameter_m);
            if area(&difference(
                &crate::geometry::union(&anchor, &surface),
                &unit.lot,
            )) > 0.000_001
            {
                return Err(format!(
                    "Amarre {r}/{i} : ancre ou cordage hors lot déclaré."
                ));
            }
            let anchor_z = -spec.anchor_depth_m;
            let endpoint_z = anchor_z + spec.anchor_height_m;
            let raft_z = raft.z_m + raft.height_m;
            let mut rope = feature(
                format!("mooring:{r}:{i}"),
                FeatureKind::Mooring,
                surface,
                endpoint_z,
                raft_z - endpoint_z,
                &spec.material,
            );
            rope.vertices3d = vec![
                Vertex3 {
                    x: q.x,
                    y: q.y,
                    z: raft_z,
                },
                Vertex3 {
                    x: a.x,
                    y: a.y,
                    z: endpoint_z,
                },
            ];
            unit.features.push(rope);
            unit.features.push(feature(
                format!("mooring-anchor:{r}:{i}"),
                FeatureKind::Anchor,
                anchor,
                anchor_z,
                spec.anchor_height_m,
                &spec.anchor_material,
            ));
        }
    }
    unit.diagnostics.push(format!("Amarres : {} liens 3D continus par radeau, diamètre {:.3} m, ancres explicites à {:.3} m de profondeur ; construction {}.",spec.count,spec.diameter_m,spec.anchor_depth_m,p.structural_spec.as_ref().unwrap().confidence));
    Ok(())
}

fn inner_tent(unit: &mut HouseUnit, p: &Parameters) -> Result<(), String> {
    let Some(spec) = p
        .structural_spec
        .as_ref()
        .and_then(|s| s.inner_tent.as_ref())
    else {
        diagnose(
            unit,
            "inner_insulated_tent",
            "aucune membrane intérieure et couverture déclarées",
        );
        return Ok(());
    };
    let parent = unit
        .bodies
        .first()
        .cloned()
        .ok_or("Tente intérieure sans enveloppe parente.")?;
    let level = parent
        .levels
        .first()
        .ok_or("Tente intérieure sans niveau parent.")?;
    if spec.wall_height_m < 1.7
        || spec.roof_rise_m <= 0.0
        || spec.door_height_m <= 0.0
        || spec.door_height_m >= spec.wall_height_m
        || spec.door_width_m < 0.75
        || spec.membrane_thickness_m <= 0.0
        || spec.post_width_m <= 0.0
        || spec.post_spacing_m <= 0.0
    {
        return Err(
            "Tente intérieure : dimensions de membrane, entrée ou ossature invalides.".into(),
        );
    }
    let b = bounds(&parent.footprint);
    let c = center(&parent.footprint);
    let width = (b[2] - b[0]) * spec.width_ratio;
    let depth = (b[3] - b[1]) * spec.depth_ratio;
    let domain = ellipse(c.x, c.y, width * 0.5, depth * 0.5, 64);
    if area(&difference(
        &offset(&domain, spec.post_width_m),
        &level.floor,
    )) > 0.000_001
    {
        return Err("Tente intérieure : membrane et poteaux doivent rester entièrement dans le sol utile parent.".into());
    }
    let ring = difference(&domain, &offset(&domain, -spec.membrane_thickness_m));
    let gate = rectangle(
        c.x - spec.door_width_m * 0.5,
        c.y + depth * 0.5 - spec.post_width_m - spec.membrane_thickness_m,
        spec.door_width_m,
        spec.post_width_m + 2.0 * spec.membrane_thickness_m + 0.01,
    );
    let walls = difference(&ring, &gate);
    let support_z = level.z_m + spec.wall_height_m;
    let mut supports = vec![];
    let count = libm::ceil(std::f64::consts::PI * (width + depth) * 0.5 / spec.post_spacing_m)
        .max(8.0) as usize;
    let mut obstacles = walls.clone();
    for i in 0..count {
        let a = std::f64::consts::TAU * i as f64 / count as f64;
        let q = point(
            c.x + width * 0.5 * libm::cos(a),
            c.y + depth * 0.5 * libm::sin(a),
        );
        let post = rectangle(
            q.x - spec.post_width_m * 0.5,
            q.y - spec.post_width_m * 0.5,
            spec.post_width_m,
            spec.post_width_m,
        );
        if area(&intersection(&post, &gate)) > 0.000_001 {
            continue;
        }
        let id = format!("inner-tent-post-{i}");
        supports.push(id.clone());
        obstacles = crate::geometry::union(&obstacles, &post);
        unit.features.push(feature(
            id,
            FeatureKind::Post,
            post,
            level.z_m,
            spec.wall_height_m,
            &spec.frame_material,
        ));
    }
    let ring_id = "inner-tent-rim-beam".to_owned();
    let beam_ring = difference(
        &offset(&domain, spec.post_width_m * 0.5),
        &offset(&domain, -spec.post_width_m * 0.5),
    );
    supports.push(ring_id.clone());
    unit.features.push(feature(
        ring_id,
        FeatureKind::Beam,
        beam_ring,
        support_z - spec.post_width_m,
        spec.post_width_m,
        &spec.frame_material,
    ));
    let pole = rectangle(
        c.x - spec.post_width_m * 0.5,
        c.y - spec.post_width_m * 0.5,
        spec.post_width_m,
        spec.post_width_m,
    );
    obstacles = crate::geometry::union(&obstacles, &pole);
    unit.features.push(feature(
        "inner-tent-center-post".into(),
        FeatureKind::Post,
        pole,
        level.z_m,
        spec.wall_height_m + spec.roof_rise_m,
        &spec.frame_material,
    ));
    for i in 0..count {
        let a = std::f64::consts::TAU * i as f64 / count as f64;
        let edge = point(
            c.x + width * 0.5 * libm::cos(a),
            c.y + depth * 0.5 * libm::sin(a),
        );
        let mut arc = feature(
            format!("inner-tent-arc-{i}"),
            FeatureKind::RoofArc,
            segment_strip(edge, c, spec.post_width_m),
            support_z,
            spec.roof_rise_m,
            &spec.frame_material,
        );
        arc.vertices3d = (0..=16)
            .map(|j| {
                let theta = std::f64::consts::FRAC_PI_2 * j as f64 / 16.0;
                Vertex3 {
                    x: c.x + (edge.x - c.x) * libm::cos(theta),
                    y: c.y + (edge.y - c.y) * libm::cos(theta),
                    z: support_z + spec.roof_rise_m * libm::sin(theta),
                }
            })
            .collect();
        unit.features.push(arc);
    }
    let mut roof_spec = p.roof_spec.clone();
    roof_spec.dome_rise_ratio = spec.roof_rise_m / (width.min(depth) * 0.5);
    roof_spec.oculus_ratio = 0.0;
    roof_spec.corbel = None;
    let mut membrane = feature(
        "inner-tent-membrane".into(),
        FeatureKind::InnerMembrane,
        walls.clone(),
        level.z_m,
        spec.wall_height_m,
        &spec.membrane_material,
    );
    membrane.roof = Some(RoofAttachment {
        nested: true,
        owner_body_id: Some(parent.id.clone()),
        level: level.index,
        domain: domain.clone(),
        rf: "RF-DOME".into(),
        spec: roof_spec,
        arms: vec![RoofArm {
            origin: point(c.x - width * 0.5, c.y - depth * 0.5),
            axis: [1.0, 0.0],
            length_m: width,
            width_m: depth,
            domain,
        }],
        support_z_m: support_z,
        pitch_deg: 0.0,
        overhang_m: 0.0,
        material: spec.membrane_material.clone(),
        frame_material: spec.frame_material.clone(),
        supports,
        max_span_m: spec.post_spacing_m * 2.0,
    });
    unit.features.push(membrane);
    unit.features.push(feature(
        "inner-tent-door-head".into(),
        FeatureKind::InnerMembrane,
        intersection(&ring, &gate),
        level.z_m + spec.door_height_m,
        spec.wall_height_m - spec.door_height_m,
        &spec.membrane_material,
    ));
    unit.walls.push(Wall {
        id: "wall:inner-tent-membrane".into(),
        kind: WallKind::Interior,
        body_id: Some(parent.id.clone()),
        level: level.index,
        z_m: level.z_m,
        height_m: spec.wall_height_m,
        footprint: walls.clone(),
        centerline: walls[0].outer.clone(),
        material: spec.membrane_material.clone(),
        party: false,
        opening_ids: vec![],
        solid: None,
        plan_section: None,
        shell_reference: false,
    });
    for room in unit
        .rooms
        .iter_mut()
        .filter(|r| r.body_id == parent.id && r.level == level.index)
    {
        room.floor = difference(&room.floor, &obstacles);
        if room.floor.len() != 1 {
            return Err("Tente intérieure : membrane/poteaux divisent une pièce ; aucun logement ni compte fictif.".into());
        }
    }
    unit.diagnostics.push(format!("Tente intérieure : membrane {} avec entrée réelle {:.3} × {:.3} m, toit propre sous parent {}, poteaux ≤ {:.3} m ; aucun corps ni ménage ajouté, construction stylisée.",spec.membrane_material,spec.door_width_m,spec.door_height_m,parent.id,spec.post_spacing_m));
    Ok(())
}

fn earth_banks(unit: &mut HouseUnit, p: &Parameters) -> Result<(), String> {
    let Some(spec) = p.structural_spec.as_ref().and_then(|s| s.bank.as_ref()) else {
        return Ok(());
    };
    if spec.width_m <= 0.0
        || spec.height_m <= 0.0
        || spec.base_depth_m <= 0.0
        || spec.gate_width_m < 1.4
    {
        return Err("Talus : épaisseur, hauteur, fondation ou entrée invalide.".into());
    }
    let bodies = unit.bodies.clone();
    let occupied = unite(
        &bodies
            .iter()
            .map(|body| body.footprint.clone())
            .collect::<Vec<_>>(),
    );
    let mut volume = 0.0;
    for (body_index, body) in bodies.iter().enumerate() {
        let c = center(&body.footprint);
        let b = bounds(&body.footprint);
        let gate = rectangle(
            c.x - spec.gate_width_m * 0.5,
            c.y,
            spec.gate_width_m,
            b[3] - c.y + spec.width_m + 0.1,
        );
        let floor = body.levels[0].z_m;
        for (polygon_index, polygon) in body.footprint.iter().enumerate() {
            if !polygon.holes.is_empty() {
                return Err(
                    "Talus : une emprise avec trou nécessite un programme de talus distinct."
                        .into(),
                );
            }
            for i in 0..polygon.outer.len() {
                let a = polygon.outer[i];
                let b = polygon.outer[(i + 1) % polygon.outer.len()];
                let outer = |q: Point| {
                    let r = libm::hypot(q.x - c.x, q.y - c.y);
                    point(
                        q.x + (q.x - c.x) * spec.width_m / r,
                        q.y + (q.y - c.y) * spec.width_m / r,
                    )
                };
                let oa = outer(a);
                let ob = outer(b);
                let ha = ground_z(unit, a) + spec.height_m;
                let hb = ground_z(unit, b) + spec.height_m;
                let hoa = ground_z(unit, oa);
                let hob = ground_z(unit, ob);
                for (triangle_index, (points, heights)) in
                    [([oa, ob, b], [hoa, hob, hb]), ([oa, b, a], [hoa, hb, ha])]
                        .into_iter()
                        .enumerate()
                {
                    let base = floor.min(heights.iter().copied().fold(f64::INFINITY, f64::min))
                        - spec.base_depth_m;
                    let top = heights.iter().copied().fold(f64::NEG_INFINITY, f64::max);
                    let mut outline = Polygon {
                        outer: points.to_vec(),
                        holes: vec![],
                    };
                    if crate::geometry::signed_area(&outline.outer) < 0.0 {
                        outline.outer.reverse();
                    }
                    // An attached annex bank must not enter any neighbouring body.
                    // Crop on the authored footprints before convex decomposition,
                    // while retaining the original terrain/top plane.
                    let portions = difference(&difference(&vec![outline], &gate), &occupied);
                    let v1 = [
                        points[1].x - points[0].x,
                        points[1].y - points[0].y,
                        heights[1] - heights[0],
                    ];
                    let v2 = [
                        points[2].x - points[0].x,
                        points[2].y - points[0].y,
                        heights[2] - heights[0],
                    ];
                    let mut n = [
                        v1[1] * v2[2] - v1[2] * v2[1],
                        v1[2] * v2[0] - v1[0] * v2[2],
                        v1[0] * v2[1] - v1[1] * v2[0],
                    ];
                    if n[2] < 0.0 {
                        for value in &mut n {
                            *value = -*value;
                        }
                    }
                    let bound = n[0] * points[0].x + n[1] * points[0].y + n[2] * heights[0];
                    for (part, outline) in crate::wall_geometry::convex_parts(&portions)
                        .into_iter()
                        .enumerate()
                    {
                        let prism = crate::wall_geometry::prism_solid(&outline, base, top - base)?;
                        let Some(solid) = crate::wall_geometry::clip_solid(&prism, n, bound)?
                        else {
                            return Err(format!(
                                "Talus du corps{body_index}, segment{i}, triangle{triangle_index}, partie{part} : volume positif absent après découpe, aucune portion de terrain omise."
                            ));
                        };
                        volume += crate::wall_geometry::signed_volume(&solid);
                        let id = format!(
                            "earth-bank-{body_index}-{polygon_index}-{i}-{triangle_index}-{part}"
                        );
                        let mut wall = Wall {
                            id: format!("wall:{id}"),
                            kind: WallKind::Retaining,
                            body_id: None,
                            level: 0,
                            z_m: base,
                            height_m: top - base,
                            footprint: vec![],
                            centerline: vec![a, b],
                            material: spec.material.clone(),
                            party: false,
                            opening_ids: vec![],
                            solid: None,
                            plan_section: None,
                            shell_reference: false,
                        };
                        crate::wall_geometry::assign_solid(&mut wall, solid);
                        crate::wall_geometry::validate_wall(&wall)
                            .map_err(|e| format!("Talus {} avant accès : {e}", wall.id))?;
                        let mut display = feature(
                            id,
                            FeatureKind::Retaining,
                            wall.footprint.clone(),
                            wall.z_m,
                            wall.height_m,
                            &spec.material,
                        );
                        display.vertices3d = wall.solid.as_ref().unwrap().vertices.clone();
                        unit.features.push(display);
                        unit.walls.push(wall);
                    }
                }
            }
        }
    }
    if volume <= 0.0 {
        return Err("Talus : aucun volume de terre physique produit.".into());
    }
    unit.diagnostics.push(format!("Talus continu en {} : volume natif incliné {:.3} m³, largeur {:.3} m, entrée réelle {:.3} m ; sommets terrain et massifs convexes déclarés stylized.",spec.material,volume,spec.width_m,spec.gate_width_m));
    Ok(())
}

fn authored_bases(unit: &mut HouseUnit, p: &Parameters) -> Result<(), String> {
    let Some(spec) = p.structural_spec.as_ref().and_then(|s| {
        s.walls
            .iter()
            .find(|w| w.role == crate::catalogue::StructureWallRole::Base)
    }) else {
        return Ok(());
    };
    let material = spec
        .material
        .as_deref()
        .ok_or("Socle sans matière déclarée.")?;
    for body in unit.bodies.clone() {
        let Some(level) = body.levels.first() else {
            continue;
        };
        let mut domain = unite(
            &unit
                .walls
                .iter()
                .filter(|w| {
                    w.body_id.as_deref() == Some(body.id.as_str())
                        && w.level == 0
                        && matches!(w.kind, WallKind::Exterior | WallKind::Shell)
                })
                .map(|w| crate::wall_geometry::wall_section(w, level.z_m + 0.01))
                .collect::<Vec<_>>(),
        );
        if body.envelope == Envelope::Open {
            domain = crate::geometry::union(
                &domain,
                &unite(
                    &unit
                        .features
                        .iter()
                        .filter(|f| {
                            matches!(f.kind, FeatureKind::Post | FeatureKind::Pier)
                                && f.id.starts_with(&format!("support:{}:", body.id))
                                && f.z_m <= level.z_m + 0.001
                                && f.z_m + f.height_m > level.z_m + 0.001
                        })
                        .map(|f| f.surface.clone())
                        .collect::<Vec<_>>(),
                ),
            );
        }
        if domain.is_empty() {
            return Err(format!("Socle de {} sans murs réellement portés.", body.id));
        }
        let id = format!("source-base:{}", body.id);
        let z = level.z_m - spec.min_height_m;
        let mut display = feature(
            id.clone(),
            FeatureKind::WallFooting,
            domain.clone(),
            z,
            spec.min_height_m,
            material,
        );
        display.vertices3d = domain
            .iter()
            .flat_map(|s| std::iter::once(&s.outer).chain(s.holes.iter()))
            .flat_map(|r| {
                r.iter().flat_map(|q| {
                    [
                        Vertex3 { x: q.x, y: q.y, z },
                        Vertex3 {
                            x: q.x,
                            y: q.y,
                            z: level.z_m,
                        },
                    ]
                })
            })
            .collect();
        unit.features.push(display);
        unit.walls.push(Wall {
            id: format!("wall:{id}"),
            kind: WallKind::Retaining,
            body_id: Some(body.id),
            level: 0,
            z_m: z,
            height_m: spec.min_height_m,
            footprint: domain,
            centerline: vec![],
            material: material.into(),
            party: false,
            opening_ids: vec![],
            solid: None,
            plan_section: None,
            shell_reference: false,
        });
    }
    unit.diagnostics.push(format!("Socles : volume porteur sous les vrais murs, hauteur {:.3} m, matériau {material} ; dimensions stylized.",spec.min_height_m));
    Ok(())
}

fn add_massif(
    unit: &mut HouseUnit,
    id: &str,
    domain: &Surface,
    top: f64,
    base_depth: f64,
    material: &str,
) -> Result<(), String> {
    let samples: Vec<_> = domain
        .iter()
        .flat_map(|s| &s.outer)
        .map(|q| (*q, ground_z(unit, *q)))
        .collect();
    if samples.iter().any(|(_, z)| *z > top + 0.000_001) {
        return Err(format!(
            "Remblai {id} : terrain au-dessus du palier ; excavation explicite nécessaire pour cette pente."
        ));
    }
    let base = samples
        .iter()
        .map(|(_, z)| *z - base_depth)
        .fold(top - base_depth, f64::min);
    let slope = unit
        .site_context
        .iter()
        .find(|f| f.kind == FeatureKind::SiteSlope)
        .and_then(|f| {
            let a = f.vertices3d.first()?;
            let b = f.vertices3d.iter().find(|b| (b.y - a.y).abs() > 0.001)?;
            Some(((b.z - a.z) / (b.y - a.y), a.y, a.z))
        })
        .unwrap_or((0.0, 0.0, 0.0));
    let bottom_normal = [0.0, slope.0, -1.0];
    let bottom_bound = slope.0 * slope.1 - slope.2 + base_depth;
    for (part, polygon) in crate::wall_geometry::convex_parts(domain)
        .iter()
        .enumerate()
    {
        let prism = crate::wall_geometry::prism_solid(polygon, base, top - base)?;
        let solid = crate::wall_geometry::clip_solid(&prism, bottom_normal, bottom_bound)?
            .ok_or_else(|| format!("Remblai {id}:{part} sans volume après cote terrain."))?;
        let feature_id = format!("{id}:{part}");
        let mut wall = Wall {
            id: format!("wall:{feature_id}"),
            kind: WallKind::Retaining,
            body_id: None,
            level: 0,
            z_m: base,
            height_m: top - base,
            footprint: vec![],
            centerline: vec![],
            material: material.into(),
            party: false,
            opening_ids: vec![],
            solid: None,
            plan_section: None,
            shell_reference: false,
        };
        crate::wall_geometry::assign_solid(&mut wall, solid);
        crate::wall_geometry::validate_wall(&wall)
            .map_err(|e| format!("Remblai {} : {e}", wall.id))?;
        let mut display = feature(
            feature_id,
            FeatureKind::Retaining,
            wall.footprint.clone(),
            wall.z_m,
            wall.height_m,
            material,
        );
        display.vertices3d = wall.solid.as_ref().unwrap().vertices.clone();
        unit.features.push(display);
        unit.walls.push(wall);
    }
    Ok(())
}

fn retaining_ground(unit: &mut HouseUnit, p: &Parameters) -> Result<(), String> {
    let Some(s) = p
        .structural_spec
        .as_ref()
        .and_then(|s| s.retaining.as_ref())
    else {
        return Ok(());
    };
    // Public access has a horizontal datum: it is carried by a real bench,
    // instead of pretending that the sloping source terrain is at z=0.
    add_massif(
        unit,
        "source-site-bench",
        &unit.lot.clone(),
        0.0,
        s.base_depth_m,
        &s.material,
    )?;
    for (index, body) in unit.bodies.clone().iter().enumerate() {
        let Some(level) = body.levels.first() else {
            continue;
        };
        if level.z_m <= 0.0
            || p.components.iter().any(|c| {
                Some(c.id.as_str()) == body.component_id.as_deref()
                    && matches!(
                        c.support.kind,
                        SupportKind::Posts | SupportKind::Piers | SupportKind::Raft
                    )
            })
        {
            continue;
        }
        let terrace = offset(&level.footprint, s.thickness_m);
        add_massif(
            unit,
            &format!("source-retaining-terrace-{index}"),
            &terrace,
            level.z_m,
            s.base_depth_m,
            &s.material,
        )?;
    }
    unit.diagnostics.push(format!("Soutènements : palier public horizontal porté jusqu'au vrai terrain, terrasses remblayées à leurs cotes ; arases, épaisseur {:.3} m et fondations {:.3} m de construction stylized.",s.thickness_m,s.base_depth_m));
    Ok(())
}

fn island_massifs(unit: &mut HouseUnit, p: &Parameters) -> Result<(), String> {
    let Some(s) = p.structural_spec.as_ref().and_then(|s| s.island.as_ref()) else {
        return Ok(());
    };
    let fills: Vec<_> = unit
        .features
        .iter()
        .filter(|f| f.id.starts_with("island-fill-"))
        .cloned()
        .collect();
    for f in fills {
        for polygon in &f.surface {
            let solid = crate::wall_geometry::prism_solid(polygon, f.z_m, f.height_m)?;
            let mut wall = Wall {
                id: format!("wall:{}", f.id),
                kind: WallKind::Retaining,
                body_id: None,
                level: 0,
                z_m: f.z_m,
                height_m: f.height_m,
                footprint: vec![],
                centerline: vec![],
                material: f.material.clone(),
                party: false,
                opening_ids: vec![],
                solid: None,
                plan_section: None,
                shell_reference: false,
            };
            crate::wall_geometry::assign_solid(&mut wall, solid);
            crate::wall_geometry::validate_wall(&wall)?;
            let vertices = wall.solid.as_ref().unwrap().vertices.clone();
            if let Some(display) = unit.features.iter_mut().find(|g| g.id == f.id) {
                display.vertices3d = vertices;
            }
            unit.walls.push(wall);
        }
    }
    let fill = unite(
        &unit
            .features
            .iter()
            .filter(|f| f.id.starts_with("island-fill-"))
            .map(|f| f.surface.clone())
            .collect::<Vec<_>>(),
    );
    if unit
        .features
        .iter()
        .filter(|f| f.id.starts_with("island-pile-"))
        .any(|f| {
            (f.z_m + s.pile_depth_m).abs() > 0.000_001
                || (f.z_m + f.height_m - s.height_m).abs() > 0.000_001
                || area(&intersection(&f.surface, &fill)) < 0.001
                || f.material != s.pile_material
        })
    {
        return Err(
            "Îlot : pieu sans profondeur, contact réel au remblai ou matériau déclaré.".into(),
        );
    }
    Ok(())
}

fn prove_wall_profiles(unit: &mut HouseUnit, p: &Parameters) -> Result<(), String> {
    let Some(structure) = &p.structural_spec else {
        return Ok(());
    };
    for spec in &structure.walls {
        use crate::catalogue::StructureWallRole;
        match spec.role {
            StructureWallRole::Exterior => {
                for body in &unit.bodies {
                    for level in body
                        .levels
                        .iter()
                        .filter(|l| (spec.from_level..=spec.to_level).contains(&l.index))
                    {
                        if body.wall_thickness_m + 0.000_001 < spec.min_thickness_m
                            || level.height_m + 0.000_001 < spec.min_height_m
                        {
                            return Err(format!(
                                "Profil de mur extérieur non réalisé : {} niveau{}.",
                                body.id, level.index
                            ));
                        }
                        let expected = difference(
                            &level.footprint,
                            &offset(&level.footprint, -spec.min_thickness_m),
                        );
                        let actual = unite(
                            &unit
                                .walls
                                .iter()
                                .filter(|w| {
                                    w.body_id.as_deref() == Some(body.id.as_str())
                                        && w.level == level.index
                                        && w.kind == WallKind::Exterior
                                        && spec.material.as_ref().is_none_or(|m| &w.material == m)
                                })
                                .map(|w| {
                                    crate::wall_geometry::wall_section(
                                        w,
                                        level.z_m + level.height_m * 0.5,
                                    )
                                })
                                .collect::<Vec<_>>(),
                        );
                        if area(&difference(&expected, &actual)) > 0.000_01 {
                            return Err(format!(
                                "Profil de mur extérieur : bande porteuse/matière incomplète de {} niveau{}.",
                                body.id, level.index
                            ));
                        }
                    }
                }
            }
            StructureWallRole::Enclosure => {
                if !unit.features.iter().any(|f| {
                    f.kind == FeatureKind::Enclosure
                        && f.height_m >= spec.min_height_m - 0.000_001
                        && spec.material.as_ref().is_none_or(|m| &f.material == m)
                        && area(&f.surface) > spec.min_thickness_m * 4.0
                }) {
                    return Err("Profil de haute enceinte sans volume natif correspondant.".into());
                }
            }
            StructureWallRole::Shell => {
                let shell = p
                    .shell
                    .as_ref()
                    .ok_or("Double mur sans spécification des coques.")?;
                let inner = unit
                    .features
                    .iter()
                    .find(|f| f.id == "broch-inner-wall")
                    .ok_or("Double mur sans coque interne.")?;
                let outer = unit
                    .features
                    .iter()
                    .find(|f| f.id == "broch-outer-wall")
                    .ok_or("Double mur sans coque externe.")?;
                if shell.inner_wall_m < spec.min_thickness_m
                    || shell.outer_wall_m < spec.min_thickness_m
                    || area(&intersection(&inner.surface, &outer.surface)) > 0.000_001
                    || inner.height_m < spec.min_height_m
                    || outer.height_m < spec.min_height_m
                {
                    return Err(
                        "Double mur : épaisseur, hauteur ou séparation physique insuffisante."
                            .into(),
                    );
                }
            }
            StructureWallRole::Base => {}
        }
    }
    Ok(())
}

pub(crate) fn add_details(
    unit: &mut HouseUnit,
    recipe: &Recipe,
    p: &Parameters,
    config: &HouseConfig,
) -> Result<(), String> {
    add_details_for_role(unit, recipe.role, p, config)
}

pub(crate) fn add_details_for_role(
    unit: &mut HouseUnit,
    role: Role,
    p: &Parameters,
    config: &HouseConfig,
) -> Result<(), String> {
    let registry = catalogue()?;
    open_iwans(unit, p)?;
    for room in &mut unit.rooms {
        if unit
            .bodies
            .iter()
            .any(|b| b.id == room.body_id && b.component_id.as_deref() == Some("conical_vestibule"))
        {
            room.usage = RoomUsage::Hall;
        }
    }
    enclosures(unit, p);
    authored_bases(unit, p)?;
    prove_wall_profiles(unit, p)?;
    for trait_ in &p.details {
        if !registry
            .geometry_traits
            .iter()
            .any(|entry| entry.id == *trait_)
        {
            return Err(format!("Trait architectural inconnu : {trait_}."));
        }
        match trait_.as_str() {
            "hearth" | "central_hearth" => domestic_fitting(
                unit,
                trait_,
                FeatureKind::Hearth,
                false,
                0.8,
                "MAT-STONE-DRY",
            ),
            "multiple_hearths" => domestic_fitting(
                unit,
                trait_,
                FeatureKind::Hearth,
                true,
                0.7,
                "MAT-STONE-DRY",
            ),
            "ondol" => kitchen_program(unit, trait_),
            "well" => yard_fitting(
                unit,
                trait_,
                FeatureKind::Well,
                1.1,
                0.7,
                "MAT-STONE-MORTAR",
            ),
            "fountain" => yard_fitting(
                unit,
                trait_,
                FeatureKind::Impluvium,
                1.5,
                0.4,
                "MAT-STONE-MORTAR",
            ),
            "silo" | "round_granary" => {
                let storage_body = unit.bodies.iter().find(|body| {
                    body.role == Role::DomesticAnnex
                        && (trait_ != "round_granary"
                            || body.footprint.iter().any(|p| p.outer.len() > 8))
                        && unit.rooms.iter().any(|room| {
                            room.body_id == body.id
                                && room.usage == RoomUsage::Storage
                                && area(&room.floor) > 0.45
                        })
                });
                if let Some(body) = storage_body {
                    unit.diagnostics.push(format!(
                        "Trait {trait_} : le volume de stockage natif {} porte ce programme ; aucun silo supplémentaire inventé.",
                        body.id
                    ));
                } else {
                    yard_fitting(
                        unit,
                        trait_,
                        FeatureKind::StorageBin,
                        1.1,
                        1.6,
                        &p.materials.infill,
                    );
                }
            }
            "domestic_shrine" | "family_shrine" => yard_fitting(
                unit,
                trait_,
                FeatureKind::DecorativePanel,
                0.65,
                1.0,
                &p.materials.frame,
            ),
            "garden" => {
                if p.structural_spec
                    .as_ref()
                    .is_some_and(|s| s.island.is_some())
                    && unit.features.iter().any(|f| {
                        f.kind == FeatureKind::Garden
                            && f.id == "island-garden"
                            && area(&f.surface) > 0.5
                    })
                {
                    unit.diagnostics.push("Jardin : domaine cultivé rectangulaire réel de l'îlot, posé sur son remblai ; aucun marqueur décoratif supplémentaire.".into());
                    continue;
                }
                let free = difference(&unit.partition.courtyards, &passages(unit));
                if let Some(q) = fit(&free, 2.0) {
                    for x in [-0.7, 0.0, 0.7] {
                        push(
                            unit,
                            trait_,
                            FeatureKind::DecorativePanel,
                            rectangle(q.x + x - 0.2, q.y - 0.8, 0.4, 1.6),
                            0.0,
                            0.05,
                            "MAT-PALM",
                        );
                    }
                } else {
                    diagnose(
                        unit,
                        trait_,
                        "la cour ne contient pas de jardin de deux mètres hors circulation",
                    );
                }
            }
            "windcatcher" => windcatcher(unit, trait_, p),
            "ventilation_channels" => {
                if !unit
                    .features
                    .iter()
                    .any(|f| f.kind == FeatureKind::Flue && f.id.contains("ventilation_channels"))
                {
                    diagnose(
                        unit,
                        trait_,
                        "aucun conduit creux continu entre pièce de plain-pied et capteur de vent",
                    );
                }
            }
            "drain" => {
                let courts = unit.partition.courtyards.clone();
                if !courts.is_empty() {
                    let b = bounds(&courts);
                    push(
                        unit,
                        trait_,
                        FeatureKind::Drain,
                        intersection(&rectangle(b[0], b[1], b[2] - b[0], 0.12), &courts),
                        -0.08,
                        0.04,
                        &p.materials.infill,
                    );
                } else {
                    diagnose(
                        unit,
                        trait_,
                        "aucune cour distributrice pour un canal de drainage ou ventilation",
                    );
                }
            }
            "narrow_windows" | "carved_windows" | "lattice_windows" | "ventilation"
            | "guy_ropes" | "insulated_rooms" => {} // Requires final portals.
            "shopfront" | "marked_entry" | "carved_door" => wall_marks(
                unit,
                trait_,
                FeatureKind::DecorativePanel,
                0.9,
                1.1,
                &p.materials.frame,
            ),
            "regional_corner_turrets" => corner_turrets(unit, trait_, p),
            "earth_buttresses" => buttresses(unit, trait_, &p.materials.frame),
            "street_balcony" => balcony(unit, trait_, &p.materials.roof_frame),
            "arcade" | "columns" | "portico" | "low_portico" => {
                gallery(unit, trait_, &p.materials.frame, true)
            }
            "gallery" | "covered_gallery" | "carved_gallery" | "wood_galleries" | "galleries"
            | "veranda" | "continuous_veranda" => {
                gallery(unit, trait_, &p.materials.roof_frame, false)
            }
            "dougong" => brackets(unit, trait_, p),
            "bays" | "regular_bays" | "exposed_frame" | "large_frame" | "large_timber_span"
            | "ligatures" | "timber_bands" | "vigas" => beams(
                unit,
                trait_,
                FeatureKind::Frame,
                BEAM_SPACING_M,
                &p.materials.roof_frame,
            ),
            "four_master_posts" => posts(unit, trait_, &p.materials.frame, true),
            "oblique_large_posts" => diagonal_posts(unit, trait_, p),
            "bone_posts" => posts(unit, trait_, "MAT-BONE", false),
            "driftwood_posts" => posts(unit, trait_, "MAT-DRIFTWOOD", false),
            "posts" | "raised_posts" | "poles" | "long_poles" | "large_posts" => {
                posts(unit, trait_, &p.materials.frame, false)
            }
            "arcs" | "arches" => arcs(unit, trait_, &p.materials.roof_frame),
            "lattice" | "log_corners" => {
                // Native 3D members depend on final portal cuts, and are
                // generated by the post-access structural pass below.
                let declared = p.structural_spec.as_ref().is_some_and(|s| {
                    if trait_ == "lattice" {
                        s.lattice.is_some()
                    } else {
                        s.log_joints.is_some()
                    }
                });
                if !declared {
                    return Err(format!(
                        "Trait {trait_} sans dimensions structurelles explicites."
                    ));
                }
            }
            "cedar_planks"
            | "split_wood_panels"
            | "bark_panels"
            | "wood_panels"
            | "woven_panels"
            | "light_panels"
            | "movable_panels"
            | "carved_panels"
            | "carved_posts"
            | "painted_front"
            | "painted_plaster"
            | "decorated_plaster"
            | "white_plaster"
            | "white_plaster_bands"
            | "lime_coating"
            | "masonry_joints"
            | "brick_joints"
            | "coral_joints"
            | "polygonal_joints"
            | "geometric_relief"
            | "polychrome_reliefs"
            | "sculpted_earth"
            | "sculpted_facade"
            | "snow_blocks"
            | "rammed_earth"
            | "grey_tiles" => wall_marks(
                unit,
                trait_,
                FeatureKind::DecorativePanel,
                0.45,
                0.35,
                &p.materials.coating,
            ),
            "party_walls" => {
                if !unit.walls.iter().any(|wall| wall.party) {
                    existing(
                        unit,
                        trait_,
                        &[FeatureKind::PartyWall],
                        "aucun côté mitoyen n'a été déclaré par le contexte local",
                    );
                }
            }
            "jetty" => {
                if !unit.bodies.iter().any(|body| {
                    body.levels.len() > 1
                        && area(&body.levels[1].footprint) > area(&body.levels[0].footprint) + 0.05
                }) {
                    diagnose(
                        unit,
                        trait_,
                        "aucun étage résolu ne déborde du rez-de-chaussée",
                    );
                }
            }
            "enclosure" | "earth_enclosure" | "stone_enclosure" | "brick_enclosure"
            | "clan_enclosure" | "high_enclosure" | "high_walls" | "double_wall" | "daga_walls"
            | "thick_walls" | "thick_stone_walls" | "thick_earth_walls" => {
                if !unit.walls.iter().any(|wall| {
                    matches!(
                        wall.kind,
                        WallKind::Enclosure | WallKind::Exterior | WallKind::Shell
                    )
                }) {
                    existing(
                        unit,
                        trait_,
                        &[
                            FeatureKind::Fence,
                            FeatureKind::Enclosure,
                            FeatureKind::LivestockPen,
                        ],
                        "aucun mur ou enclos n'est présent dans ce programme",
                    );
                }
            }
            "bridge_piers" => existing(
                unit,
                trait_,
                &[FeatureKind::Pier],
                "le contexte n'est pas un franchissement sur piles",
            ),
            "floats" => existing(
                unit,
                trait_,
                &[FeatureKind::Raft],
                "le support résolu n'est pas flottant",
            ),
            "moorings" => {
                moorings(unit, p)?;
            }
            "water" | "artificial_island" => existing(
                unit,
                trait_,
                &[FeatureKind::Water],
                "aucune surface d'eau n'a été fournie par le contexte synthétique",
            ),
            "earth_mound"
            | "platform"
            | "raised_base"
            | "stone_base"
            | "basalt_base"
            | "limestone_base"
            | "stone_earth_platform"
            | "slope_platform"
            | "stone_ground_floor" => existing(
                unit,
                trait_,
                &[
                    FeatureKind::Platform,
                    FeatureKind::Deck,
                    FeatureKind::WallFooting,
                    FeatureKind::FloorSlab,
                ],
                "la variante ne réserve pas de plateforme ni de soubassement",
            ),
            "shared_raised_platform" => {
                if !unit.features.iter().any(|f| {
                    f.kind == FeatureKind::Deck
                        && f.id == "shared-raised-platform"
                        && f.surface.len() == 1
                        && unit
                            .bodies
                            .iter()
                            .filter(|b| {
                                (b.levels[0].z_m - f.z_m).abs() < 0.001
                                    && area(&intersection(&offset(&b.footprint, 0.1), &f.surface))
                                        > 0.01
                            })
                            .count()
                            >= 2
                }) {
                    diagnose(
                        unit,
                        trait_,
                        "aucun plancher ouvert connexe à cote commune ne relie au moins deux corps",
                    );
                }
            }
            "earth_bank" | "turf_bank" => {
                if p.structural_spec
                    .as_ref()
                    .and_then(|s| s.bank.as_ref())
                    .is_none()
                {
                    return Err(format!("Trait {trait_} sans dimensions de talus physique."));
                }
            }
            "pit" | "shallow_excavation" | "sunken_courtyard" | "excavated_cells" | "cut_cells" => {
                existing(
                    unit,
                    trait_,
                    &[FeatureKind::Excavation, FeatureKind::ArcticTunnel],
                    "le programme résolu n'a pas d'excavation",
                )
            }
            "rock_overhang" | "loess_cliff" | "cliff_cells" => existing(
                unit,
                trait_,
                &[FeatureKind::RockShelter, FeatureKind::RockFace],
                "le contexte résolu n'a pas de front rocheux ou de surplomb",
            ),
            "entrance_tunnel" | "connecting_tunnels" | "multiple_entrance_tunnels" => existing(
                unit,
                trait_,
                &[FeatureKind::ArcticTunnel],
                "aucun tunnel n'est construit dans la variante",
            ),
            "stair"
            | "stairs"
            | "entry_stairs"
            | "exterior_stair"
            | "external_stair"
            | "internal_wall_stair"
            | "axial_stairs"
            | "axial_ramp" => planned_vertical(unit, trait_, p, true),
            "ladder" | "ladders" | "roof_access" | "roof_hatch" | "central_roof_hatch"
            | "loading_hatch" => planned_vertical(unit, trait_, p, false),
            "porch"
            | "front_porch"
            | "front_shop_gallery"
            | "connecting_galleries"
            | "connecting_corridor"
            | "entry_gallery"
            | "inner_gallery"
            | "side_corridor"
            | "vestibule" => {
                if !unit.features.iter().any(|f| {
                    matches!(
                        f.kind,
                        FeatureKind::Gallery | FeatureKind::Deck | FeatureKind::Landing
                    )
                }) {
                    front_gallery(unit, trait_, &p.materials.roof_frame, false);
                }
            }
            "single_door"
            | "single_gate"
            | "gate"
            | "axial_entry"
            | "axial_gate"
            | "axial_gates"
            | "differentiated_gates"
            | "passage_gate"
            | "trapezoidal_doors"
            | "multiple_doors"
            | "many_court_doors"
            | "low_entry"
            | "low_threshold"
            | "shore_access" => {
                if unit.bodies.is_empty() && p.enclosures.is_empty() {
                    diagnose(
                        unit,
                        trait_,
                        "aucun seuil de corps ou d'enclos déclaré dans le programme spatial",
                    );
                }
            }
            "corbelled_dome" | "corbelled_vault" => {
                let profile = if trait_ == "corbelled_dome" {
                    crate::model::CorbelProfile::Dome
                } else {
                    crate::model::CorbelProfile::Barrel
                };
                if !unit.bodies.iter().any(|b| {
                    b.roof_spec
                        .corbel
                        .as_ref()
                        .is_some_and(|s| s.profile == profile)
                }) {
                    diagnose(
                        unit,
                        trait_,
                        "aucune spécification typée d'assises en encorbellement du profil requis",
                    );
                }
            }
            "ogival_shell" | "continuous_shell" | "earth_ribs" | "earth_dome" | "earth_vaults"
            | "coral_vault" | "vault_cells" | "vault_abutments" => {
                if !unit.bodies.iter().any(|body| {
                    matches!(
                        body.roof_system.as_str(),
                        "RF-SHELL"
                            | "RF-DOME"
                            | "RF-VAULT"
                            | "RF-CROSSVAULT"
                            | "RF-THATCH-VAULT"
                            | "RF-SNOW"
                    )
                }) {
                    diagnose(
                        unit,
                        trait_,
                        "le bundle sélectionné ne possède pas de coque ou voûte compatible",
                    );
                }
            }
            "parapet"
            | "scupper"
            | "stepped_gable"
            | "crown"
            | "high_crown"
            | "smoke_flaps"
            | "shed"
            | "roof_steps"
            | "tiered_roofs"
            | "interlocking_roofs"
            | "high_central_pyramid"
            | "high_central_hall"
            | "high_cone"
            | "high_gables"
            | "high_hip"
            | "high_projected_gables"
            | "projected_gables"
            | "saddle_ends"
            | "multiple_horns"
            | "small_saddle"
            | "turf_gables"
            | "thatch_gable"
            | "tile_eaves"
            | "wide_eaves"
            | "palm_roof"
            | "bark_roof"
            | "inward_roof"
            | "stone_crown" => roof_trait(unit, trait_, p),
            "impluvium" => existing(
                unit,
                trait_,
                &[FeatureKind::Impluvium],
                "le layout résolu n'est pas un atrium avec bassin",
            ),
            "retaining_walls" | "slope_terraces" | "terraces" | "terrace" => existing(
                unit,
                trait_,
                &[
                    FeatureKind::Retaining,
                    FeatureKind::Terrace,
                    FeatureKind::WallFooting,
                ],
                "aucun retrait ou soutènement de terrain dans la variante",
            ),
            "open_side" | "open_sides" => {
                open_sides(unit, trait_, trait_ == "open_side", &p.materials.frame)
            }
            "multiple_households" | "hundreds_of_cells" | "repeated_cells" | "inhabited_ring" => {
                if !unit.rooms.iter().any(|room| room.household_id.is_some()) {
                    diagnose(
                        unit,
                        trait_,
                        "aucune unité de ménage n'est portée par les cellules résolues",
                    );
                }
            }
            "barn" | "byre" | "storerooms" | "work_cells" | "farm_annex" | "detached_annex" => {
                let usage = match trait_.as_str() {
                    "barn" => RoomUsage::Barn,
                    "byre" => RoomUsage::Byre,
                    "work_cells" => RoomUsage::Workshop,
                    _ => RoomUsage::Storage,
                };
                if unit.rooms.iter().any(|room| room.usage == usage) {
                    continue;
                }
                let secondary = unit
                    .rooms
                    .iter()
                    .position(|room| matches!(room.usage, RoomUsage::Storage | RoomUsage::Service));
                let secondary = secondary.or_else(|| {
                    if unit
                        .rooms
                        .iter()
                        .filter(|r| r.usage == RoomUsage::Living)
                        .count()
                        > 1
                    {
                        unit.rooms
                            .iter()
                            .rposition(|r| r.usage == RoomUsage::Living && r.level == 0)
                    } else {
                        None
                    }
                });
                if let Some(index) = secondary {
                    unit.rooms[index].usage = usage;
                } else {
                    diagnose(
                        unit,
                        trait_,
                        "aucune pièce secondaire n'est réservée pour cet usage",
                    );
                }
            }
            "inner_insulated_tent" => {
                inner_tent(unit, p)?;
            }
            "sweat_lodge" => {
                if role != Role::DomesticAnnex {
                    diagnose(
                        unit,
                        trait_,
                        "ce programme n'est pas la loge rituelle domestique",
                    );
                } else {
                    for room in &mut unit.rooms {
                        room.usage = RoomUsage::Ritual;
                    }
                }
            }
            "wood_floor" => {} // Surface layer follows stair and hatch cuts.
            "earth_floor_kitchen" => kitchen_program(unit, trait_),
            "lightwell" => {
                if !unit.bodies.iter().any(|b| {
                    !b.voids.is_empty()
                        && b.voids.iter().all(|void| {
                            b.levels.iter().all(|l| {
                                area(&intersection(void, &l.floor)) <= 0.000_001
                                    && l.roof_slab.as_ref().is_none_or(|slab| {
                                        area(&intersection(void, &slab.surface)) <= 0.000_001
                                    })
                            })
                        })
                }) {
                    diagnose(
                        unit,
                        trait_,
                        "aucun vide déclaré traversant les vrais niveaux, sols et dalles",
                    );
                }
            }
            "atrium" | "court" | "courtyard" | "courtyards" | "great_court" | "madang"
            | "patio" | "shared_space" | "shared_yard" | "rear_yard" | "open_work_yard"
            | "yard" => {
                if unit.partition.courtyards.is_empty() {
                    diagnose(
                        unit,
                        trait_,
                        "aucune cour ou espace extérieur réservé par le layout",
                    );
                }
            }
            "added_rooms"
            | "attached_kiva"
            | "boat_plan"
            | "castro_cells"
            | "central_aisle"
            | "central_pavilion"
            | "compartmented_court"
            | "few_partitions"
            | "iwans"
            | "large_vestibule"
            | "livestock_pen"
            | "long_hall"
            | "mixed_round_square"
            | "mobile_oval_tents"
            | "north_hall"
            | "peripheral_huts"
            | "separate_bodies"
            | "separate_pavilions"
            | "successive_courts"
            | "three_hierarchical_courts"
            | "rounded_corners"
            | "defensive_tower"
            | "high_earth_tower"
            | "massive_stone_tower"
            | "sandstone_tower"
            | "stair_tower"
            | "stone_cells"
            | "low_basalt_wall"
            | "setbacks" => layout_trait(unit, trait_, p),
            _ => {
                return Err(format!(
                    "Trait enregistré sans opérateur explicite : {trait_}."
                ));
            }
        }
    }
    cover_galleries(unit, p)?;
    site_slope(unit, p, config);
    retaining_ground(unit, p)?;
    island_massifs(unit, p)?;
    earth_banks(unit, p)?;
    Ok(())
}

/// Details whose placement depends on final doors and vertical openings.
pub(crate) fn add_post_access_details(unit: &mut HouseUnit, p: &Parameters) -> Result<(), String> {
    frame_details::add_frames(unit, p)?;
    prove_high_hall_access(unit, p)?;
    prove_compartment_access(unit, p)?;
    if let Some(index) = unit
        .features
        .iter()
        .position(|f| f.id == "source-ring-gateway")
    {
        let z = unit.features[index].z_m + 0.01;
        let section = unite(
            &unit
                .walls
                .iter()
                .filter(|w| w.id.starts_with("wall:source-ring-gateway"))
                .map(|w| crate::wall_geometry::wall_section(w, z))
                .collect::<Vec<_>>(),
        );
        unit.features[index].surface = section;
        unit.features[index].vertices3d = unit.features[index]
            .surface
            .iter()
            .flat_map(|p| &p.outer)
            .map(|q| Vertex3 {
                x: q.x,
                y: q.y,
                z: z - 0.01,
            })
            .collect();
    }
    for f in unit
        .features
        .iter_mut()
        .filter(|f| f.kind == FeatureKind::Gallery)
    {
        f.vertices3d = f
            .surface
            .iter()
            .flat_map(|polygon| &polygon.outer)
            .map(|q| Vertex3 {
                x: q.x,
                y: q.y,
                z: f.z_m,
            })
            .collect();
    }
    frame_gallery_openings(unit);
    audit_gallery_coverage_after_access(unit, p);
    for trait_ in &p.details {
        match trait_.as_str() {
            "narrow_windows" | "carved_windows" | "lattice_windows" | "ventilation" => {
                if let Some(spec) = &p.detail_spec {
                    windows(unit, trait_, spec, &p.materials.frame)?;
                } else {
                    diagnose(unit, trait_, "aucune dimension explicite de fenêtre");
                }
            }
            "guy_ropes" => {
                if let Some(spec) = &p.detail_spec {
                    ropes(unit, spec)?;
                } else {
                    diagnose(
                        unit,
                        trait_,
                        "aucune matière et dimension explicites de cordage",
                    );
                }
            }
            "wood_floor" | "earth_floor_kitchen" => {
                if let Some(spec) = &p.detail_spec {
                    floor_layers(unit, trait_, spec);
                } else {
                    diagnose(
                        unit,
                        trait_,
                        "aucun matériau et épaisseur explicites de sol",
                    );
                }
            }
            "ondol" => {
                if let Some(spec) = &p.detail_spec {
                    ondol(unit, spec);
                } else {
                    diagnose(
                        unit,
                        trait_,
                        "aucune dimension explicite de chauffage sous sol",
                    );
                }
            }
            "insulated_rooms" => separated_rooms(unit),
            _ => {}
        }
    }
    Ok(())
}

fn prove_compartment_access(unit: &mut HouseUnit, p: &Parameters) -> Result<(), String> {
    let Some(program) = p.court_program.as_ref().filter(|s| s.compartments > 0) else {
        return Ok(());
    };
    for i in 0..program.compartments {
        let pocket = unit
            .features
            .iter()
            .find(|f| f.id == format!("court-pocket-{i}"))
            .ok_or("Cour compartimentée : domaine de poche absent.")?;
        let nodes: Vec<_> = unit
            .access
            .nodes
            .iter()
            .filter(|n| n.z_m.abs() < 0.001 && area(&intersection(&n.floor, &pocket.surface)) > 1.0)
            .collect();
        let doorway = unit.access.portals.iter().any(|door| {
            nodes.iter().any(|n| n.id == door.from || n.id == door.to)
                && door.width_m + 0.001 >= program.threshold.width_m
                && area(&intersection(&door.passage, &pocket.surface)) > 0.001
                && unit
                    .access
                    .nodes
                    .iter()
                    .filter(|n| n.id == door.from || n.id == door.to)
                    .all(|n| n.kind != crate::model::AccessKind::Room)
                && unit.walls.iter().any(|w| {
                    w.id.starts_with(&format!("wall:court-pocket-{i}-walls"))
                        && w.opening_ids.contains(&door.id)
                })
        });
        if nodes.is_empty() || !doorway {
            return Err(format!(
                "Cour compartimentée : poche {i} sans portail public natif."
            ));
        }
    }
    unit.diagnostics.push("Cour compartimentée : deux poches fermées par des murs réels, chacune jointe au domaine public par son portail natif ; aucun logement/pièce ajouté.".into());
    Ok(())
}

fn prove_high_hall_access(unit: &mut HouseUnit, p: &Parameters) -> Result<(), String> {
    let Some(h) = p
        .structural_spec
        .as_ref()
        .and_then(|s| s.high_hall.as_ref())
    else {
        return Ok(());
    };
    let core = unit
        .bodies
        .iter()
        .find(|b| b.component_id.as_deref() == Some("nile_core"))
        .ok_or("Salle haute sans noyau natif.")?;
    for wing in unit.bodies.iter().filter(|b| {
        b.component_id
            .as_deref()
            .is_some_and(|id| id.starts_with("nile_wing_"))
    }) {
        let shared = unit.access.portals.iter().any(|door| {
            door.kind == crate::model::PortalKind::Door
                && door.from_z_m.abs() < 0.001
                && door.width_m + 0.001 >= h.passage_width_m
                && door.head_z_m >= 2.05 - 0.001
                && [core, wing].into_iter().all(|body| {
                    unit.walls.iter().any(|w| {
                        w.body_id.as_deref() == Some(body.id.as_str())
                            && w.opening_ids.contains(&door.id)
                    }) && unit.walls.iter().any(|w| {
                        w.body_id.as_deref() == Some(body.id.as_str())
                            && w.id.starts_with("lintel:")
                            && w.z_m >= door.head_z_m - 0.001
                            && area(&intersection(&w.footprint, &door.passage)) > 0.000_001
                    })
                })
        });
        if !shared {
            return Err(format!(
                "Salle haute : {} sans vrai passage au noyau excavant les deux parois avec leurs linteaux.",
                wing.id
            ));
        }
        let roof_z = wing.levels.last().unwrap().z_m + wing.levels.last().unwrap().height_m;
        if core.levels.iter().any(|l| (l.z_m - roof_z).abs() < 0.001) {
            let declared = h.terrace_core_door == crate::catalogue::TerraceCoreDoor::Declared;
            let real = unit.access.portals.iter().any(|door| {
                if door.kind != crate::model::PortalKind::Door
                    || (door.from_z_m - roof_z).abs() > 0.001
                {
                    return false;
                }
                let nodes: Vec<_> = unit
                    .access
                    .nodes
                    .iter()
                    .filter(|n| n.id == door.from || n.id == door.to)
                    .collect();
                nodes.iter().any(|n| {
                    n.kind == crate::model::AccessKind::Terrace
                        && area(&intersection(&n.floor, &wing.footprint)) > 0.001
                }) && unit.rooms.iter().any(|r| {
                    r.body_id == core.id
                        && (r.z_m - roof_z).abs() < 0.001
                        && (r.access_node == door.from || r.access_node == door.to)
                })
            });
            if declared != real {
                return Err(format!(
                    "Salle haute : porte terrasse {} / noyau à {roof_z:.3} m déclarée {declared}, réalisation {real}.",
                    wing.id
                ));
            }
        }
    }
    unit.diagnostics.push("Salle haute : chaque aile communique avec le même logement par un portail natif traversant deux parois et deux linteaux ; accès terrasse/noyau vérifié aux cotes communes.".into());
    Ok(())
}

/// Native mesh witnesses after roof construction; no trait is inferred from a label.
pub(crate) fn add_post_roof_details(unit: &mut HouseUnit, p: &Parameters) -> Result<(), String> {
    if p.details.iter().any(|s| s == "lattice") {
        frame_details::prove_roof_joint(unit)?;
    }
    if p.details.iter().any(|s| s == "multiple_horns") {
        prove_four_horns(unit)?;
    }
    for (id, kind) in [
        ("inward_roof", crate::roofs::RoofTrait::Inward),
        ("interlocking_roofs", crate::roofs::RoofTrait::Interlocking),
    ] {
        if p.details.iter().any(|s| s == id) {
            unit.diagnostics
                .push(crate::roofs::inspect_roof_trait(unit, kind)?);
        }
    }
    if p.layout != Layout::HighHall {
        return Ok(());
    }
    let core = unit
        .bodies
        .iter()
        .find(|b| b.component_id.as_deref() == Some("nile_core"))
        .ok_or("Salle haute sans noyau couvert.")?;
    let projected = |id: &str| -> Surface {
        unite(
            &unit
                .roofs
                .faces
                .iter()
                .filter(|f| {
                    f.body_id == id
                        && f.feature_id.is_none()
                        && matches!(
                            f.kind,
                            crate::model::RoofFaceKind::Pan | crate::model::RoofFaceKind::Slab
                        )
                })
                .filter_map(|f| {
                    let outer: Vec<_> = f
                        .vertices
                        .iter()
                        .map(|i| {
                            let v = &unit.roofs.vertices[*i as usize];
                            Point { x: v.x, y: v.y }
                        })
                        .collect();
                    (crate::geometry::signed_area(&outer).abs() > 0.000_001).then_some(vec![
                        Polygon {
                            outer,
                            holes: vec![],
                        },
                    ])
                })
                .collect::<Vec<_>>(),
        )
    };
    let core_cover = projected(&core.id);
    if core_cover.is_empty() {
        return Err("Salle haute : aucun pan natif au noyau.".into());
    }
    let cb = bounds(&core.footprint);
    let core_top = core.levels.last().unwrap().z_m + core.levels.last().unwrap().height_m;
    for wing in unit.bodies.iter().filter(|b| {
        b.component_id
            .as_deref()
            .is_some_and(|id| id.starts_with("nile_wing_"))
    }) {
        let cover = projected(&wing.id);
        let wing_top = wing.levels.last().unwrap().z_m + wing.levels.last().unwrap().height_m;
        if cover.is_empty()
            || wing_top + wing.roof_spec.parapet_height_m >= core_top
            || area(&intersection(&cover, &core.footprint)) > 0.000_001
            || area(&intersection(&core_cover, &wing.footprint)) > 0.000_001
        {
            return Err(format!(
                "Salle haute : terrasses/toitures de {} non distinctes du noyau supérieur.",
                wing.id
            ));
        }
        let wb = bounds(&wing.footprint);
        let t = core.wall_thickness_m;
        let joint = if wb[0] >= cb[2] - 0.001 {
            rectangle(
                cb[2] - t,
                wb[1].max(cb[1]),
                t,
                wb[3].min(cb[3]) - wb[1].max(cb[1]),
            )
        } else if wb[2] <= cb[0] + 0.001 {
            rectangle(
                cb[0],
                wb[1].max(cb[1]),
                t,
                wb[3].min(cb[3]) - wb[1].max(cb[1]),
            )
        } else if wb[3] <= cb[1] + 0.001 {
            rectangle(
                wb[0].max(cb[0]),
                cb[1],
                wb[2].min(cb[2]) - wb[0].max(cb[0]),
                t,
            )
        } else {
            rectangle(
                wb[0].max(cb[0]),
                cb[3] - t,
                wb[2].min(cb[2]) - wb[0].max(cb[0]),
                t,
            )
        };
        let walls = unite(
            &unit
                .walls
                .iter()
                .filter(|w| w.body_id.as_deref() == Some(core.id.as_str()))
                .map(|w| crate::wall_geometry::wall_section(w, core_top - 0.01))
                .collect::<Vec<_>>(),
        );
        if area(&difference(&joint, &walls)) > 0.000_01 {
            return Err(format!(
                "Salle haute : mur de ressaut sans fermeture réelle au-dessus de {}.",
                wing.id
            ));
        }
        if !unit.features.iter().any(|f| {
            f.kind == FeatureKind::Terrace
                && (f.z_m - wing_top).abs() < 0.001
                && area(&intersection(&f.surface, &wing.footprint)) > 0.001
        }) {
            return Err("Salle haute : terrasse d'aile sans dalle native.".into());
        }
    }
    unit.diagnostics.push("Traits high_central_hall et roof_steps : pans RF-FLAT natifs à deux cotes, terrasses inférieures et vrais murs de ressaut, aucune couverture dans le volume voisin.".into());
    Ok(())
}

fn prove_four_horns(unit: &mut HouseUnit) -> Result<(), String> {
    let mesh = &unit.roofs;
    for body in &unit.bodies {
        let spec = body
            .roof_spec
            .horns
            .as_ref()
            .ok_or("Quatre cornes : programme typé absent.")?;
        if body.roof_arms.len() != 1 {
            return Err("Quatre cornes : repère de corps unique requis.".into());
        }
        let source = &body.roof_arms[0];
        let arm = if body.roof_spec.axis == crate::model::RoofAxis::Transverse {
            RoofArm {
                origin: point(
                    source.origin.x + source.axis[0] * source.length_m,
                    source.origin.y + source.axis[1] * source.length_m,
                ),
                axis: [-source.axis[1], source.axis[0]],
                length_m: source.width_m,
                width_m: source.length_m,
                domain: source.domain.clone(),
            }
        } else {
            source.clone()
        };
        let local = |v: &Vertex3| {
            (
                (v.x - arm.origin.x) * arm.axis[0] + (v.y - arm.origin.y) * arm.axis[1],
                -(v.x - arm.origin.x) * arm.axis[1] + (v.y - arm.origin.y) * arm.axis[0],
            )
        };
        let level = body.levels.last().unwrap().index;
        let faces: Vec<_> = mesh
            .faces
            .iter()
            .filter(|f| {
                f.body_id == body.id
                    && f.feature_id.is_none()
                    && f.level == level
                    && f.rf == "RF-SADDLE"
            })
            .collect();
        // Expected positions follow the same millimetre construction as
        // roof vertex(), rather than comparing its mesh to ideal coordinates.
        let expected = |x: f64, y: f64| {
            let q = point(
                arm.origin.x + arm.axis[0] * x - arm.axis[1] * y,
                arm.origin.y + arm.axis[1] * x + arm.axis[0] * y,
            );
            local(&Vertex3 {
                x: q.x,
                y: q.y,
                z: 0.0,
            })
        };
        // Keep the operator's evaluation order at half-grid positions:
        // W*(n/2)/n may differ by one ulp from W*0.5 before snapping.
        let n = body.roof_spec.curve_sections;
        let center_y = arm.width_m * f64::from(n / 2) / f64::from(n);
        let ridge_y = expected(arm.length_m * 0.5, center_y).1;
        let mut ridge: Vec<_> = faces
            .iter()
            .filter(|f| f.kind == crate::model::RoofFaceKind::Pan)
            .flat_map(|f| f.vertices.iter())
            .filter_map(|i| {
                let v = &mesh.vertices[*i as usize];
                let (x, y) = local(v);
                ((y - ridge_y).abs() < 0.0001).then_some((x, v.z))
            })
            .collect();
        ridge.sort_by(|a, b| a.0.total_cmp(&b.0));
        let half_central = spec.central_span_ratio * arm.length_m * 0.5;
        let stations = [
            0.0,
            arm.length_m * 0.5 - half_central,
            arm.length_m * 0.5 + half_central,
            arm.length_m,
        ]
        .map(|x| expected(x, center_y).0);
        if stations.windows(2).any(|s| s[1] - s[0] <= 0.0001) {
            return Err("Quatre cornes : quatre stations natives distinctes requises.".into());
        }
        let mut peaks = vec![];
        for (index, station) in stations.into_iter().enumerate() {
            let peak = ridge
                .iter()
                .filter(|(x, _)| (*x - station).abs() < 0.0001)
                .map(|(_, z)| *z)
                .fold(f64::NEG_INFINITY, f64::max);
            if !peak.is_finite() {
                return Err("Quatre cornes : pointe absente du faîtage natif.".into());
            }
            for direction in [-1.0, 1.0] {
                if index == 0 && direction < 0.0 || index == 3 && direction > 0.0 {
                    continue;
                }
                let nearest = ridge
                    .iter()
                    .filter(|(x, _)| {
                        (*x - station) * direction > 0.0001
                            && *x >= stations[0]
                            && *x <= stations[3]
                    })
                    .min_by(|a, b| (a.0 - station).abs().total_cmp(&(b.0 - station).abs()));
                if nearest.is_none_or(|(_, z)| peak - *z < 0.00001) {
                    return Err(
                        "Quatre cornes : sommet sans baisse réelle vers la selle voisine.".into(),
                    );
                }
            }
            peaks.push(peak);
        }
        if peaks[0] <= peaks[1] + 0.0001 || peaks[3] <= peaks[2] + 0.0001 {
            return Err(
                "Quatre cornes : pointes extérieures non plus hautes que celles des ressauts."
                    .into(),
            );
        }
        for station in &stations[1..3] {
            let step = faces.iter().any(|f| {
                f.kind == crate::model::RoofFaceKind::StepWall
                    && f.vertices
                        .iter()
                        .all(|i| (local(&mesh.vertices[*i as usize]).0 - station).abs() < 0.0001)
            });
            let frame = unit.features.iter().any(|f| {
                f.kind == FeatureKind::RoofArc
                    && f.id
                        .starts_with(&format!("roof:{}:{level}:horns:frame:", body.id))
                    && f.vertices3d.len() >= 3
                    && f.vertices3d
                        .iter()
                        .all(|v| (local(v).0 - station).abs() < 0.0001)
            });
            if !step || !frame {
                return Err("Quatre cornes : ressaut volumétrique ou ferme réelle absent.".into());
            }
        }
    }
    unit.diagnostics.push("Trait multiple_horns : quatre maxima de faîtage natifs, deux pointes extérieures plus hautes, deux ressauts3D et deux fermes physiques ; source SerialTiers stylized.".into());
    Ok(())
}

/// Attribution is checked again against authoritative slabs after access cuts.
/// A stair opening remains an opening; this pass never adds a second canopy.
fn audit_gallery_coverage_after_access(unit: &mut HouseUnit, p: &Parameters) {
    if !p.gallery_cover.enabled {
        return;
    }
    let galleries: Vec<_> = unit
        .features
        .iter()
        .filter(|f| f.kind == FeatureKind::Gallery)
        .cloned()
        .collect();
    for gallery in galleries {
        let slabs: Vec<_> = unit
            .bodies
            .iter()
            .flat_map(|body| {
                body.levels.iter().filter_map(move |level| {
                    level
                        .roof_slab
                        .as_ref()
                        .filter(|slab| slab.z_m >= gallery.z_m + 2.0)
                        .map(|slab| (body.id.clone(), level.index, slab.surface.clone()))
                })
            })
            .collect();
        let slab_domain = unite(&slabs.iter().map(|(_, _, s)| s.clone()).collect::<Vec<_>>());
        let attachment = gallery
            .roof
            .as_ref()
            .map(|roof| roof.domain.clone())
            .unwrap_or_default();
        let covered = unite(&[slab_domain, attachment]);
        let missing = difference(&gallery.surface, &covered);
        let access_voids = unite(
            &unit
                .features
                .iter()
                .filter(|f| {
                    matches!(
                        f.kind,
                        FeatureKind::Stair | FeatureKind::Ladder | FeatureKind::Hatch
                    ) && f.z_m <= gallery.z_m + 0.001
                        && f.z_m + f.height_m >= gallery.z_m - 0.001
                })
                .map(|f| f.surface.clone())
                .collect::<Vec<_>>(),
        );
        let unroofed = difference(&missing, &access_voids);
        if area(&unroofed) > 0.000_001 {
            diagnose(
                unit,
                "covered_gallery",
                &format!(
                    "{} : {:.6} m² sans dalle ou auvent après accès, hors vraies ouvertures d'escalier",
                    gallery.id,
                    area(&unroofed)
                ),
            );
            continue;
        }
        let provenance = slabs
            .iter()
            .filter(|(_, _, s)| area(&intersection(s, &gallery.surface)) > 0.000_001)
            .map(|(id, level, _)| format!("{id}:niveau{level}"))
            .collect::<Vec<_>>()
            .join(", ");
        if !provenance.is_empty() {
            unit.diagnostics.push(format!(
                "Galerie {} : couverture physique vérifiée après accès par dalle(s) {provenance}{} ; trous conservés, {:.3} m² d'ouvertures d'accès déclarées.",
                gallery.id,
                if gallery.roof.is_some() { " et auvent explicite" } else { "" },
                area(&missing)
            ));
        }
    }
}

/// Portal construction can introduce free canopy edges around a stair void.
/// These edges receive physical beams and posts before roof support validation.
fn frame_gallery_openings(unit: &mut HouseUnit) {
    let galleries: Vec<_> = unit
        .features
        .iter()
        .filter(|f| f.kind == FeatureKind::Gallery && f.roof.is_some())
        .cloned()
        .collect();
    for gallery in galleries {
        let Some(mut roof) = gallery.roof.clone() else {
            continue;
        };
        let stairs = unite(
            &unit
                .features
                .iter()
                .filter(|f| {
                    matches!(
                        f.kind,
                        FeatureKind::Stair | FeatureKind::Ladder | FeatureKind::Hatch
                    ) && f.z_m <= gallery.z_m + 0.01
                        && f.z_m + f.height_m >= gallery.z_m - 0.01
                })
                .map(|f| f.surface.clone())
                .collect::<Vec<_>>(),
        );
        if stairs.is_empty() {
            continue;
        }
        let edges = offset(&stairs, 0.2);
        let mut edge_index = 0;
        for polygon in &roof.domain {
            for ring in std::iter::once(&polygon.outer).chain(polygon.holes.iter()) {
                for (a, b) in ring
                    .iter()
                    .zip(ring.iter().cycle().skip(1))
                    .take(ring.len())
                {
                    let surface = intersection(&segment_strip(*a, *b, 0.12), &gallery.surface);
                    if area(&surface) < 0.002
                        || area(&intersection(&surface, &edges)) < area(&surface) * 0.8
                    {
                        continue;
                    }
                    let length = libm::hypot(b.x - a.x, b.y - a.y);
                    let n = libm::ceil(length / roof.max_span_m).max(1.0) as u32;
                    for i in 0..=n {
                        let q = point(
                            a.x + (b.x - a.x) * i as f64 / n as f64,
                            a.y + (b.y - a.y) * i as f64 / n as f64,
                        );
                        let support =
                            intersection(&ellipse(q.x, q.y, 0.06, 0.06, 16), &gallery.surface);
                        if area(&support) < 0.002 {
                            continue;
                        }
                        let id = format!("gallery-opening-post:{}:{edge_index}:{i}", gallery.id);
                        let base = if gallery.z_m <= 0.01 {
                            gallery.z_m.min(ground_z(unit, q))
                        } else {
                            gallery.z_m
                        };
                        unit.features.push(feature(
                            id.clone(),
                            FeatureKind::Post,
                            support,
                            base,
                            roof.support_z_m - base,
                            &roof.frame_material,
                        ));
                        roof.supports.push(id);
                    }
                    let id = format!("gallery-opening-beam:{}:{edge_index}", gallery.id);
                    unit.features.push(feature(
                        id.clone(),
                        FeatureKind::Beam,
                        surface,
                        roof.support_z_m - 0.15,
                        0.15,
                        &roof.frame_material,
                    ));
                    roof.supports.push(id);
                    edge_index += 1;
                }
            }
        }
        if edge_index > 0 {
            if let Some(f) = unit.features.iter_mut().find(|f| f.id == gallery.id) {
                f.roof = Some(roof);
            }
            unit.diagnostics.push(format!("Galerie {} : {edge_index} rives d'ouverture d'accès portent un cadre et des poteaux à la cote explicite d'appui.",gallery.id));
        }
    }
}

fn windows(
    unit: &mut HouseUnit,
    trait_: &str,
    spec: &DetailSpec,
    material: &str,
) -> Result<(), String> {
    let walls: Vec<_> = unit
        .walls
        .iter()
        .filter(|w| {
            w.kind == WallKind::Exterior
                && !w.party
                && !w.id.starts_with("lintel:")
                && !w.id.starts_with("window-")
                && !w.shell_reference
        })
        .cloned()
        .collect();
    let width = if trait_ == "narrow_windows" {
        spec.narrow_window_width_m
    } else {
        spec.window_width_m
    };
    let blocked = passages(unit);
    let mut count = 0;
    for original in walls {
        let sill = original.z_m + spec.window_sill_m;
        let head = sill + spec.window_height_m;
        let top = original.z_m + original.height_m;
        if top < head + 0.3 {
            continue;
        }
        let thickness = unit
            .bodies
            .iter()
            .find(|b| original.body_id.as_deref() == Some(&b.id))
            .map_or(0.4, |b| b.wall_thickness_m);
        let closed = original.centerline.len() > 2;
        let edge_count = if closed {
            original.centerline.len()
        } else {
            original.centerline.len().saturating_sub(1)
        };
        for (a, b) in original
            .centerline
            .iter()
            .zip(original.centerline.iter().cycle().skip(1))
            .take(edge_count)
        {
            let length = libm::hypot(b.x - a.x, b.y - a.y);
            if length < width * 3.0 {
                continue;
            }
            let ux = (b.x - a.x) / length;
            let uy = (b.y - a.y) / length;
            let mut opening = None;
            for t in [0.5, 0.25, 0.75] {
                let q = point(a.x + (b.x - a.x) * t, a.y + (b.y - a.y) * t);
                let strip = segment_strip(
                    point(q.x - ux * width * 0.5, q.y - uy * width * 0.5),
                    point(q.x + ux * width * 0.5, q.y + uy * width * 0.5),
                    thickness * 2.0 + 0.1,
                );
                let void = intersection(
                    &strip,
                    &crate::wall_geometry::wall_section(&original, (sill + head) * 0.5),
                );
                if area(&void) < width * thickness * 0.25
                    || area(&intersection(&strip, &blocked)) > 0.000_01
                {
                    continue;
                }
                opening = Some((
                    void,
                    strip,
                    [
                        point(q.x - ux * width * 0.5, q.y - uy * width * 0.5),
                        point(q.x + ux * width * 0.5, q.y + uy * width * 0.5),
                    ],
                ));
                break;
            }
            let Some((void, cut, axis)) = opening else {
                continue;
            };
            let id = format!("window-{trait_}:{}:{count}", original.id);
            let Some(wall) = unit.walls.iter_mut().find(|w| w.id == original.id) else {
                continue;
            };
            let void = intersection(
                &void,
                &crate::wall_geometry::wall_section(wall, (sill + head) * 0.5),
            );
            if area(&void) < 0.002 {
                continue;
            }
            let parts = crate::wall_geometry::cut_profile_wall(
                wall, &cut, axis, width, width, sill, head, &id,
            )?;
            unit.walls.extend(parts);
            unit.features.push(feature(
                id,
                FeatureKind::Window,
                void,
                sill,
                spec.window_height_m,
                material,
            ));
            count += 1;
        }
    }
    if count == 0 {
        diagnose(
            unit,
            trait_,
            "aucun mur extérieur assez haut avec une ouverture entière hors portail (coques exclues)",
        );
    }
    unit.walls.retain(|w| area(&w.footprint) > 0.000_001);
    Ok(())
}

fn ground_z(unit: &HouseUnit, q: Point) -> f64 {
    let Some(terrain) = unit
        .site_context
        .iter()
        .find(|f| f.kind == FeatureKind::SiteSlope)
    else {
        return 0.0;
    };
    let Some(a) = terrain.vertices3d.first() else {
        return 0.0;
    };
    terrain
        .vertices3d
        .iter()
        .find(|b| (b.y - a.y).abs() > 0.001)
        .map_or(0.0, |b| a.z + (q.y - a.y) * (b.z - a.z) / (b.y - a.y))
}

fn ropes(unit: &mut HouseUnit, spec: &DetailSpec) -> Result<(), String> {
    let material = spec
        .rope_material
        .as_ref()
        .ok_or("Cordages sans matière explicitement déclarée.")?;
    let bodies = unit.bodies.clone();
    let blocked = passages(unit);
    let mut count = 0;
    for body in bodies {
        let Some(level) = body.levels.last() else {
            continue;
        };
        let c = center(&body.footprint);
        for poly in &body.footprint {
            for i in [
                0,
                poly.outer.len() / 4,
                poly.outer.len() / 2,
                poly.outer.len() * 3 / 4,
            ] {
                let q = poly.outer[i];
                let radial = point(q.x - c.x, q.y - c.y);
                let mut anchor = None;
                for turn in [0.0_f64, 0.3, -0.3, 0.6, -0.6] {
                    for factor in [1.0, 0.75, 0.5] {
                        let extension = spec.rope_anchor_extension_ratio * factor;
                        let a = point(
                            q.x + extension
                                * (radial.x * libm::cos(turn) - radial.y * libm::sin(turn)),
                            q.y + extension
                                * (radial.x * libm::sin(turn) + radial.y * libm::cos(turn)),
                        );
                        let circle = ellipse(a.x, a.y, 0.1, 0.1, 16);
                        let rope = segment_strip(q, a, spec.rope_diameter_m);
                        if area(&difference(
                            &crate::geometry::union(&circle, &rope),
                            &unit.lot,
                        )) > 0.000_01
                            || area(&intersection(
                                &crate::geometry::union(&circle, &rope),
                                &blocked,
                            )) > 0.000_01
                            || unit.bodies.iter().any(|other| {
                                other.id != body.id
                                    && area(&intersection(&rope, &other.footprint)) > 0.000_01
                            })
                            || area(&intersection(&rope, &offset(&body.footprint, -0.03)))
                                > 0.000_01
                        {
                            continue;
                        }
                        anchor = Some((a, circle, rope));
                        break;
                    }
                    if anchor.is_some() {
                        break;
                    }
                }
                let Some((a, circle, surface)) = anchor else {
                    diagnose(
                        unit,
                        "guy_ropes",
                        &format!(
                            "point de membrane ({:.3},{:.3}) sans ancre entière hors accès",
                            q.x, q.y
                        ),
                    );
                    continue;
                };
                let za = ground_z(unit, a);
                let zq = level.z_m + level.height_m;
                let mut rope = feature(
                    format!("detail-guy_ropes:{count}"),
                    FeatureKind::Beam,
                    surface,
                    za,
                    zq - za,
                    material,
                );
                rope.vertices3d = vec![
                    Vertex3 {
                        x: q.x,
                        y: q.y,
                        z: zq,
                    },
                    Vertex3 {
                        x: a.x,
                        y: a.y,
                        z: za,
                    },
                ];
                unit.features.push(rope);
                unit.features.push(feature(
                    format!("detail-guy_anchor:{count}"),
                    FeatureKind::Anchor,
                    circle,
                    za,
                    0.1,
                    "MAT-TIMBER-POST",
                ));
                count += 1;
            }
        }
    }
    if count == 0 {
        diagnose(
            unit,
            "guy_ropes",
            "aucune ligne d'ancrage continue hors portes et circulation",
        );
    }
    Ok(())
}

fn floor_layers(unit: &mut HouseUnit, trait_: &str, spec: &DetailSpec) {
    let rooms: Vec<_> = unit
        .rooms
        .iter()
        .filter(|r| {
            if trait_ == "earth_floor_kitchen" {
                r.usage == RoomUsage::Kitchen
            } else {
                matches!(
                    r.usage,
                    RoomUsage::Living | RoomUsage::Communal | RoomUsage::Hall
                )
            }
        })
        .cloned()
        .collect();
    if rooms.is_empty() {
        diagnose(
            unit,
            trait_,
            "aucune pièce de l'usage déclaré avec un sol réel",
        );
    }
    for room in rooms {
        unit.features.push(feature(
            format!("detail-{trait_}:{}", room.id),
            FeatureKind::FloorSlab,
            room.floor,
            room.z_m - spec.floor_thickness_m,
            spec.floor_thickness_m,
            &spec.floor_material,
        ));
    }
}

fn separated_rooms(unit: &mut HouseUnit) {
    if unit.rooms.len() < 2 {
        diagnose(
            unit,
            "insulated_rooms",
            "pièces isolées : moins de deux pièces réelles",
        );
        return;
    }
    let missing: Vec<_> = unit
        .rooms
        .iter()
        .filter(|room| {
            !unit
                .access
                .portals
                .iter()
                .any(|portal| portal.from == room.access_node || portal.to == room.access_node)
                || !unit.walls.iter().any(|w| {
                    w.kind == WallKind::Interior
                        && w.body_id.as_deref() == Some(room.body_id.as_str())
                        && w.level == room.level
                        && area(&intersection(
                            &crate::wall_geometry::wall_section(w, room.z_m + 1.0),
                            &offset(&room.floor, 0.1),
                        )) > 0.001
                })
        })
        .map(|r| r.id.clone())
        .collect();
    if !missing.is_empty() {
        diagnose(
            unit,
            "insulated_rooms",
            &format!(
                "pièces séparées sans cloison intérieure et porte vérifiées : {}",
                missing.join(", ")
            ),
        );
    }
}

fn ondol(unit: &mut HouseUnit, spec: &DetailSpec) {
    let pair = unit.rooms.iter().find_map(|heated| {
        if heated.usage != RoomUsage::Living || heated.level != 0 {
            return None;
        }
        unit.rooms
            .iter()
            .find(|k| {
                k.usage == RoomUsage::Kitchen
                    && k.body_id == heated.body_id
                    && k.level == heated.level
                    && area(&intersection(&offset(&heated.floor, 0.6), &k.floor)) > 0.001
            })
            .map(|k| (heated.clone(), k.clone()))
    });
    let Some((heated, kitchen)) = pair else {
        diagnose(
            unit,
            "ondol",
            "aucune pièce de vie contiguë à une cuisine réelle",
        );
        return;
    };
    let Some(body) = unit.bodies.iter().find(|b| b.id == heated.body_id).cloned() else {
        return;
    };
    let blocked = passages(unit);
    let Some(fire) = fit(&difference(&kitchen.floor, &blocked), 0.7) else {
        diagnose(
            unit,
            "ondol",
            "cuisine sans emplacement de foyer enterré hors porte",
        );
        return;
    };
    let Some(q) = fit(&heated.floor, 0.5) else {
        diagnose(
            unit,
            "ondol",
            "pièce chauffée sans emplacement de collecteur sous sol",
        );
        return;
    };
    let b = bounds(&body.footprint);
    let c = center(&heated.floor);
    let radius = spec.flue_width_m.max(0.12);
    let mut chimney_points = vec![
        point(b[0] - body.overhang_m - radius - 0.05, c.y),
        point(b[2] + body.overhang_m + radius + 0.05, c.y),
        point(c.x, b[1] - body.overhang_m - radius - 0.05),
        point(c.x, b[3] + body.overhang_m + radius + 0.05),
    ];
    chimney_points.sort_by(|a, b| {
        libm::hypot(a.x - c.x, a.y - c.y).total_cmp(&libm::hypot(b.x - c.x, b.y - c.y))
    });
    let candidate = chimney_points.into_iter().find_map(|a| {
        let outer = ellipse(a.x, a.y, radius, radius, 24);
        if area(&difference(&outer, &unit.lot)) > 0.000_01
            || area(&intersection(&outer, &blocked)) > 0.000_01
            || unit
                .bodies
                .iter()
                .any(|b| area(&intersection(&outer, &b.footprint)) > 0.000_01)
        {
            return None;
        }
        Some((a, outer))
    });
    let Some((chimney, outer)) = candidate else {
        diagnose(
            unit,
            "ondol",
            "aucun emplacement de cheminée extérieure hors accès et corps voisins",
        );
        return;
    };
    let z = heated.z_m - spec.floor_thickness_m - spec.flue_depth_m;
    let mut paths = vec![
        segment_strip(fire, q, spec.flue_width_m),
        segment_strip(q, chimney, spec.flue_width_m),
    ];
    let h = bounds(&heated.floor);
    for t in [0.25, 0.5, 0.75] {
        let y = h[1] + (h[3] - h[1]) * t;
        let branch = intersection(
            &segment_strip(point(h[0], y), point(h[2], y), spec.flue_width_m),
            &heated.floor,
        );
        if let Some(a) = fit(&offset(&branch, 0.02), 0.1) {
            paths.push(segment_strip(q, a, spec.flue_width_m));
        }
        paths.push(branch);
    }
    unit.features.push(feature(
        format!("detail-ondol:channels:{}", heated.id),
        FeatureKind::Flue,
        unite(&paths),
        z,
        spec.flue_depth_m,
        &spec.flue_material,
    ));
    unit.features.push(feature(
        format!("detail-ondol:firebox:{}", kitchen.id),
        FeatureKind::Hearth,
        rectangle(fire.x - 0.3, fire.y - 0.3, 0.6, 0.6),
        z - 0.1,
        spec.flue_depth_m,
        &spec.flue_material,
    ));
    unit.features.push(feature(
        format!("detail-ondol:heated-floor:{}", heated.id),
        FeatureKind::FloorSlab,
        heated.floor.clone(),
        heated.z_m - spec.floor_thickness_m,
        spec.floor_thickness_m,
        &spec.floor_material,
    ));
    let level = &body.levels[0];
    let inner = ellipse(chimney.x, chimney.y, radius * 0.4, radius * 0.4, 24);
    unit.features.push(feature(
        format!("detail-ondol:chimney:{}", heated.id),
        FeatureKind::Flue,
        difference(&outer, &inner),
        z,
        level.z_m + level.height_m + 0.7 - z,
        &spec.flue_material,
    ));
    unit.diagnostics.push(format!("Ondol stylisé : cuisine {} → canaux sous le sol de {} → cheminée extérieure ; aucun foyer dans la pièce chauffée.",kitchen.id,heated.id));
}
