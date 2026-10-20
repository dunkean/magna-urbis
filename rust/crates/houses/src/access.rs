//! Portals are cuts through solids, and every vertical edge owns an interface.
use crate::catalogue::{Envelope, VerticalAccess};
use crate::geometry::*;
use crate::layouts::feature;
use crate::model::*;
use crate::wall_geometry::wall_section;
use geo::Contains;
use std::collections::{BTreeMap, BTreeSet, VecDeque};
mod disjoint_walk_trim;
mod profiles;
mod public_roofs;
mod roof_apertures;
mod roof_walk_components;
pub(crate) use roof_walk_components::native_roof_walk_component;

pub(crate) fn reachable(unit: &HouseUnit) -> BTreeSet<String> {
    reachable_allowed(unit, |_| true)
}

pub(crate) fn public_reachable(unit: &HouseUnit) -> BTreeSet<String> {
    reachable_allowed(unit, |n| {
        n.kind != AccessKind::Room && n.household_id.is_none()
    })
}

pub(crate) fn validate_public_roofs(unit: &HouseUnit) -> Result<(), String> {
    public_roofs::validate(unit, true)
}

pub(crate) fn public_roof_low_band(feature: &Feature) -> Option<Surface> {
    public_roofs::low_band(feature)
}

pub(crate) fn reachable_for_owner(unit: &HouseUnit, owner: &str) -> BTreeSet<String> {
    reachable_allowed(unit, |n| {
        n.household_id.as_deref().is_none_or(|id| id == owner)
    })
}

fn reachable_allowed(unit: &HouseUnit, allowed: impl Fn(&AccessNode) -> bool) -> BTreeSet<String> {
    let allowed: BTreeSet<_> = unit
        .access
        .nodes
        .iter()
        .filter(|n| allowed(n))
        .map(|n| n.id.as_str())
        .collect();
    let mut neighbors: BTreeMap<&str, Vec<&str>> = BTreeMap::new();
    for p in &unit.access.portals {
        if allowed.contains(p.from.as_str()) && allowed.contains(p.to.as_str()) {
            neighbors.entry(&p.from).or_default().push(&p.to);
            neighbors.entry(&p.to).or_default().push(&p.from);
        }
    }
    let mut reached = BTreeSet::from([unit.access.root.clone()]);
    let mut queue = VecDeque::from([unit.access.root.clone()]);
    while let Some(id) = queue.pop_front() {
        for next in neighbors.get(id.as_str()).into_iter().flatten() {
            if reached.insert((*next).into()) {
                queue.push_back((*next).into());
            }
        }
    }
    reached
}

fn node(unit: &mut HouseUnit, kind: AccessKind, surface: Surface, z: f64) -> String {
    let id = format!("{}:space:{}", unit.id, unit.access.nodes.len());
    unit.access.nodes.push(AccessNode {
        id: id.clone(),
        kind,
        floor: surface,
        z_m: snap(z),
        household_id: None,
    });
    id
}

#[allow(clippy::too_many_arguments)] // All fields form one physical portal record.
fn portal(
    unit: &mut HouseUnit,
    from: &str,
    to: &str,
    kind: PortalKind,
    opening: [Point; 2],
    passage: Surface,
    width: f64,
    interfaces: Vec<String>,
) -> Result<(), String> {
    portal_with_profile(
        unit, from, to, kind, opening, passage, width, interfaces, None,
    )
}

#[allow(clippy::too_many_arguments)]
fn portal_with_profile(
    unit: &mut HouseUnit,
    from: &str,
    to: &str,
    kind: PortalKind,
    opening: [Point; 2],
    passage: Surface,
    width: f64,
    interfaces: Vec<String>,
    profile: Option<&crate::catalogue::PortalSpec>,
) -> Result<(), String> {
    let a = unit
        .access
        .nodes
        .iter()
        .find(|n| n.id == from)
        .ok_or("Nœud source manquant.")?;
    let b = unit
        .access
        .nodes
        .iter()
        .find(|n| n.id == to)
        .ok_or("Nœud cible manquant.")?;
    let za = a.z_m;
    let zb = b.z_m;
    let from_floor = a.floor.clone();
    let mut interfaces = interfaces;
    if matches!(kind, PortalKind::Stair | PortalKind::Ladder) {
        for id in &interfaces {
            if let Some(f) = unit.features.iter_mut().find(|f| &f.id == id) {
                let (start, end) = flight_edges(&f.surface, &from_floor)
                    .ok_or("Volée sans empreinte rectangulaire.")?;
                f.vertices3d = [start[0], start[1], end[1], end[0]]
                    .into_iter()
                    .enumerate()
                    .map(|(i, p)| Vertex3 {
                        x: p.x,
                        y: p.y,
                        z: if i < 2 { za } else { zb },
                    })
                    .collect();
            }
        }
    }
    if area(&intersection(&passage, &a.floor)) < 0.005
        || area(&intersection(&passage, &b.floor)) < 0.005
    {
        return Err(format!("Passage {from} → {to} sans palier physique."));
    }
    let id = format!("{}:portal:{}", unit.id, unit.access.portals.len());
    let mut wall_id = None;
    let mut lintels = vec![];
    let mut cut_solid = false;
    let opening_height = if kind == PortalKind::Tunnel {
        1.0
    } else {
        unit.bodies
            .iter()
            .filter(|body| area(&intersection(&body.footprint, &passage)) > 0.001)
            .flat_map(|body| body.levels.iter())
            .filter(|level| (level.z_m - za).abs() < 0.001)
            .map(|level| (level.height_m * 0.85).min(2.05))
            .fold(2.05, f64::min)
    };
    let head_z = snap(za.min(zb) + profile.map_or(opening_height, |spec| spec.head_m));
    let sill_z = snap(za.min(zb) + profile.map_or(0.0, |spec| spec.sill_m));
    let cut = passage.clone();
    let (opening, passage, width) = if let Some(spec) = profile {
        if sill_z - za.min(zb) > 0.45 || head_z - sill_z + 1e-9 < spec.min_clear_height_m {
            return Err(format!(
                "Profil {} : seuil ou hauteur libre invalide.",
                spec.id
            ));
        }
        let length = libm::hypot(opening[1].x - opening[0].x, opening[1].y - opening[0].y);
        if length < 0.001 {
            return Err("Axe de porte profilée nul.".into());
        }
        let ax = (opening[1].x - opening[0].x) / length;
        let ay = (opening[1].y - opening[0].y) / length;
        let cx = (opening[0].x + opening[1].x) * 0.5;
        let cy = (opening[0].y + opening[1].y) * 0.5;
        let opening = [
            point(cx - ax * spec.width_m * 0.5, cy - ay * spec.width_m * 0.5),
            point(cx + ax * spec.width_m * 0.5, cy + ay * spec.width_m * 0.5),
        ];
        let (min, max) = cut
            .iter()
            .flat_map(|p| &p.outer)
            .map(|p| -ay * p.x + ax * p.y)
            .fold((f64::INFINITY, f64::NEG_INFINITY), |(min, max), v| {
                (min.min(v), max.max(v))
            });
        (
            opening,
            segment_strip(opening[0], opening[1], max - min),
            spec.width_m,
        )
    } else {
        (opening, passage, width)
    };
    for wall in unit.walls.iter_mut().filter(|_| {
        matches!(
            kind,
            PortalKind::Door | PortalKind::Gate | PortalKind::Passage | PortalKind::Tunnel
        )
    }) {
        if wall.z_m <= za.max(zb) + 0.01
            && wall.z_m + wall.height_m > za.min(zb) + 0.01
            && area(&intersection(&wall_section(wall, za.max(zb) + 0.01), &cut)) > 0.001
        {
            if wall.party {
                return Err("Ouverture interdite dans un mur mitoyen.".into());
            }
            wall_id.get_or_insert(wall.id.clone());
            if let Some(spec) = profile {
                let parts = crate::wall_geometry::cut_profile_wall(
                    wall,
                    &cut,
                    opening,
                    spec.width_m,
                    spec.top_width_m,
                    sill_z,
                    head_z,
                    &id,
                )?;
                if spec.sill_m > 0.0 {
                    for part in parts.iter().filter(|part| {
                        part.z_m <= za.min(zb) + 0.001 && part.z_m + part.height_m <= sill_z + 0.001
                    }) {
                        let feature_id = format!("threshold:{}", part.id);
                        let mut tread = feature(
                            &feature_id,
                            FeatureKind::Threshold,
                            part.footprint.clone(),
                            sill_z,
                            0.0,
                            &part.material,
                        );
                        tread.vertices3d = part
                            .footprint
                            .first()
                            .map(|p| {
                                p.outer
                                    .iter()
                                    .map(|p| Vertex3 {
                                        x: p.x,
                                        y: p.y,
                                        z: sill_z,
                                    })
                                    .collect()
                            })
                            .unwrap_or_default();
                        unit.features.push(tread);
                        interfaces.push(feature_id);
                    }
                }
                lintels.extend(parts);
                continue;
            }
            if wall.solid.is_some() {
                lintels.extend(crate::wall_geometry::cut_profile_wall(
                    wall,
                    &cut,
                    opening,
                    width,
                    width,
                    za.min(zb),
                    head_z,
                    &id,
                )?);
                cut_solid = true;
                continue;
            }
            let top = wall.z_m + wall.height_m;
            if top > head_z + 0.001 && !wall.shell_reference {
                let mut lintel = wall.clone();
                lintel.id = format!("lintel:{}:{id}", wall.id);
                lintel.footprint = intersection(&wall.footprint, &passage);
                lintel.z_m = head_z;
                lintel.height_m = snap(top - head_z);
                lintel.opening_ids.clear();
                lintels.push(lintel);
            }
            wall.footprint = difference(&wall.footprint, &passage);
            wall.opening_ids.push(id.clone());
        }
    }
    if profile.is_some() || cut_solid {
        unit.walls.retain(|wall| !wall.footprint.is_empty());
    }
    unit.walls.extend(lintels);
    if profile.is_none() && !cut_solid && wall_id.is_some() && za == zb {
        unit.features.push(feature(
            &format!("lintel:{id}"),
            FeatureKind::PortalLintel,
            passage.clone(),
            head_z,
            0.25,
            "MAT-TIMBER-POST",
        ));
    }
    unit.access.portals.push(Portal {
        shape: profile.map_or(crate::catalogue::PortalShape::Rect, |spec| spec.shape),
        top_width_m: profile
            .filter(|spec| spec.top_width_m != spec.width_m)
            .map(|spec| spec.top_width_m),
        sill_z_m: profile.filter(|spec| spec.sill_m != 0.0).map(|_| sill_z),
        profile_id: profile.map(|spec| spec.id.clone()),
        id,
        kind,
        from: from.into(),
        to: to.into(),
        opening,
        wall_id,
        feature_ids: interfaces,
        opening_surface: passage.clone(),
        passage,
        width_m: width,
        from_z_m: za,
        to_z_m: zb,
        head_z_m: head_z,
    });
    Ok(())
}

fn rings(surface: &Surface) -> impl Iterator<Item = &Vec<Point>> {
    surface
        .iter()
        .flat_map(|p| std::iter::once(&p.outer).chain(p.holes.iter()))
}

/// A communal cell owns an actual door onto the authored public aisle. The
/// measured common edge reserves two half-wall jambs before testing the same
/// native-floor door placement used by the access builder.
pub(crate) fn has_corridor_entry(
    cell: &Surface,
    corridor: &Surface,
    floor_constraint: Option<(&Surface, f64)>,
    other_cells: &[Surface],
) -> bool {
    let wall = floor_constraint.map_or(0.0, |(_, wall)| wall);
    let floor = |cell: &Surface| {
        floor_constraint.map_or_else(
            || cell.clone(),
            |(interior, wall)| intersection(&offset(cell, -wall * 0.5), interior),
        )
    };
    let room = floor(cell);
    if room.len() != 1 || area(&room) < 0.45 {
        return false;
    }
    let mut frontage = vec![];
    for ring in rings(cell) {
        for (&a, &b) in ring
            .iter()
            .zip(ring.iter().cycle().skip(1))
            .take(ring.len())
        {
            let length = libm::hypot(b.x - a.x, b.y - a.y);
            if length < 0.85 + wall {
                continue;
            }
            let (tx, ty) = ((b.x - a.x) / length, (b.y - a.y) / length);
            for edge in rings(corridor) {
                for (&c, &d) in edge
                    .iter()
                    .zip(edge.iter().cycle().skip(1))
                    .take(edge.len())
                {
                    // Boolean adapters may move a common construction edge by
                    // nanometres. This strict micrometre correspondence is
                    // followed by a door certificate on the exported floors.
                    let distance = |p: Point| ((p.x - a.x) * ty - (p.y - a.y) * tx).abs();
                    if distance(c) > 1e-6 || distance(d) > 1e-6 {
                        continue;
                    }
                    let project = |p: Point| (p.x - a.x) * tx + (p.y - a.y) * ty;
                    let low = project(c).min(project(d)).max(0.0);
                    let high = project(c).max(project(d)).min(length);
                    if high - low >= 0.85 + wall {
                        frontage.push((a, tx, ty, low + wall * 0.5, high - wall * 0.5));
                    }
                }
            }
        }
    }
    if frontage.is_empty() {
        return false;
    }
    let forbidden: Vec<_> = other_cells.iter().map(floor).collect();
    candidate_filtered(
        &room,
        corridor,
        0.85,
        (wall * 2.0 + 0.6).max(1.8),
        &forbidden,
        |opening, _, edge| {
            frontage.iter().any(|&(a, tx, ty, low, high)| {
                edge.iter()
                    .all(|p| ((p.x - a.x) * ty - (p.y - a.y) * tx).abs() <= wall * 0.5 + 1e-6)
                    && opening.iter().all(|p| {
                        let t = (p.x - a.x) * tx + (p.y - a.y) * ty;
                        t >= low - 1e-6 && t <= high + 1e-6
                    })
            })
        },
    )
    .is_some()
}

fn candidate(
    a: &Surface,
    b: &Surface,
    width: f64,
    depth: f64,
    forbidden: &[Surface],
) -> Option<([Point; 2], Surface)> {
    candidate_filtered(a, b, width, depth, forbidden, |_, _, _| true)
}

fn candidate_filtered(
    a: &Surface,
    b: &Surface,
    width: f64,
    depth: f64,
    forbidden: &[Surface],
    accept: impl Fn([Point; 2], &Surface, [Point; 2]) -> bool,
) -> Option<([Point; 2], Surface)> {
    let mut options = vec![];
    let target_bounds = bounds(b);
    for ring in rings(a) {
        for (start, end) in ring
            .iter()
            .zip(ring.iter().cycle().skip(1))
            .take(ring.len())
        {
            if start.x.min(end.x) - depth > target_bounds[2]
                || start.x.max(end.x) + depth < target_bounds[0]
                || start.y.min(end.y) - depth > target_bounds[3]
                || start.y.max(end.y) + depth < target_bounds[1]
            {
                continue;
            }
            let length = libm::hypot(end.x - start.x, end.y - start.y);
            if length < 0.002 {
                continue;
            }
            let dx = (end.x - start.x) / length;
            let dy = (end.y - start.y) / length;
            let mut positions = vec![0.25, 0.5, 0.75];
            // A long boundary may face several rooms. Project their boundaries
            // into this segment rather than testing only its midpoint.
            for other in rings(b).flat_map(|r| r.iter()) {
                let t = ((other.x - start.x) * dx + (other.y - start.y) * dy) / length;
                for shift in [-width / length, 0.0, width / length] {
                    positions.push((t + shift).clamp(0.0, 1.0));
                }
            }
            positions.sort_by(f64::total_cmp);
            positions.dedup_by(|a, b| (*a - *b).abs() < 0.0001);
            for t in positions {
                let middle = point(
                    start.x + (end.x - start.x) * t,
                    start.y + (end.y - start.y) * t,
                );
                let opening = [
                    point(middle.x - dx * width * 0.5, middle.y - dy * width * 0.5),
                    point(middle.x + dx * width * 0.5, middle.y + dy * width * 0.5),
                ];
                let gap = if to_geo(b).contains(&geo::Point::new(middle.x, middle.y)) {
                    0.0
                } else {
                    rings(b)
                        .flat_map(|ring| {
                            ring.iter()
                                .zip(ring.iter().cycle().skip(1))
                                .take(ring.len())
                        })
                        .map(|(start, end)| {
                            let vx = end.x - start.x;
                            let vy = end.y - start.y;
                            let length2 = vx * vx + vy * vy;
                            let t = if length2 > 1e-12 {
                                ((middle.x - start.x) * vx + (middle.y - start.y) * vy) / length2
                            } else {
                                0.0
                            };
                            let t = t.clamp(0.0, 1.0);
                            libm::hypot(middle.x - start.x - t * vx, middle.y - start.y - t * vy)
                        })
                        .fold(f64::INFINITY, f64::min)
                };
                if gap > depth {
                    continue;
                }
                // This cut crosses the measured separation plus a real landing
                // on each side, including thick enclosure walls.
                let strip = segment_strip(opening[0], opening[1], 2.0 * (gap + 0.2));
                if area(&intersection(&strip, a)) < width * 0.12
                    || area(&intersection(&strip, b)) < width * 0.12
                {
                    continue;
                }
                if forbidden
                    .iter()
                    .any(|s| area(&intersection(s, &strip)) > 0.003)
                {
                    continue;
                }
                if accept(opening, &strip, [*start, *end]) {
                    options.push((middle, opening, strip));
                }
            }
        }
    }
    options.sort_by(|a, b| b.0.y.total_cmp(&a.0.y).then(a.0.x.total_cmp(&b.0.x)));
    options
        .into_iter()
        .next()
        .map(|(_, opening, strip)| (opening, strip))
}

fn interface(
    unit: &mut HouseUnit,
    kind: FeatureKind,
    surface: Surface,
    z0: f64,
    z1: f64,
) -> String {
    let id = format!("{}:interface:{}", unit.id, unit.features.len());
    let b = bounds(&surface);
    let mut f = feature(
        &id,
        kind,
        surface,
        z0.min(z1),
        (z1 - z0).abs(),
        "MAT-TIMBER-POST",
    );
    f.vertices3d = vec![
        Vertex3 {
            x: b[0],
            y: b[1],
            z: z0,
        },
        Vertex3 {
            x: b[2],
            y: b[1],
            z: z0,
        },
        Vertex3 {
            x: b[2],
            y: b[3],
            z: z1,
        },
        Vertex3 {
            x: b[0],
            y: b[3],
            z: z1,
        },
    ];
    if let Some(p) = f.surface.first()
        && p.outer.len() == 4
    {
        f.vertices3d = p
            .outer
            .iter()
            .enumerate()
            .map(|(i, p)| Vertex3 {
                x: p.x,
                y: p.y,
                z: if i < 2 { z0 } else { z1 },
            })
            .collect();
    }
    unit.features.push(f);
    id
}

fn anchor(surface: &Surface, width: f64, depth: f64) -> Option<Surface> {
    for polygon in surface {
        let part = vec![polygon.clone()];
        let b = bounds(&part);
        for (width, depth) in [(width, depth), (depth, width)] {
            let margin = 0.031;
            if b[2] - b[0] < width + 2.0 * margin || b[3] - b[1] < depth + 2.0 * margin {
                continue;
            }
            for iy in [4, 3, 5, 2, 6, 1, 7, 0, 8] {
                for ix in [4, 3, 5, 2, 6, 1, 7, 0, 8] {
                    let x = b[0] + margin + (b[2] - b[0] - width - 2.0 * margin) * ix as f64 / 8.0;
                    let y = b[1] + margin + (b[3] - b[1] - depth - 2.0 * margin) * iy as f64 / 8.0;
                    let s = rectangle(x, y, width, depth);
                    if area(&difference(&offset(&s, 0.03), &part)) < 0.001 {
                        return Some(s);
                    }
                }
            }
        }
    }
    // Annular galleries need a tangent frame rather than an axis-aligned box.
    let c = center(surface);
    for polygon in surface {
        for v in &polygon.outer {
            let distance = libm::hypot(c.x - v.x, c.y - v.y);
            if distance < width {
                continue;
            }
            let nx = (c.x - v.x) / distance;
            let ny = (c.y - v.y) / distance;
            for inset in [0.55, 0.7, 0.85] {
                let q = point(v.x + nx * width * inset, v.y + ny * width * inset);
                let s = segment_strip(
                    point(q.x - ny * depth * 0.5, q.y + nx * depth * 0.5),
                    point(q.x + ny * depth * 0.5, q.y - nx * depth * 0.5),
                    width,
                );
                if area(&difference(&offset(&s, 0.03), surface)) < 0.001 {
                    return Some(s);
                }
            }
        }
    }
    None
}

pub(crate) fn build_access(
    unit: &mut HouseUnit,
    circulations: &[(f64, Surface)],
    parameters: &crate::catalogue::Parameters,
) -> Result<(), String> {
    let ground_solids = unite(
        &unit
            .bodies
            .iter()
            .filter(|b| b.levels[0].z_m <= 0.01)
            .map(|b| b.levels[0].footprint.clone())
            .collect::<Vec<_>>(),
    );
    let obstacles = unite(
        &unit
            .site_context
            .iter()
            .filter(|f| {
                matches!(
                    f.kind,
                    FeatureKind::Neighbor | FeatureKind::Water | FeatureKind::RockFace
                )
            })
            .map(|f| f.surface.clone())
            .collect::<Vec<_>>(),
    );
    let mut walks: BTreeMap<i64, Surface> = BTreeMap::new();
    walks.insert(
        0,
        difference(&difference(&unit.lot, &ground_solids), &obstacles),
    );
    for (z, s) in circulations {
        let key = libm::round(z * 1000.0) as i64;
        let prior = walks.remove(&key).unwrap_or_default();
        walks.insert(key, union(&prior, s));
    }
    for f in &unit.features {
        if matches!(
            f.kind,
            FeatureKind::Gallery
                | FeatureKind::Deck
                | FeatureKind::Landing
                | FeatureKind::ArcticTunnel
        ) {
            let key = libm::round(f.z_m * 1000.0) as i64;
            let prior = walks.remove(&key).unwrap_or_default();
            walks.insert(key, union(&prior, &f.surface));
        }
    }
    let room_solids: Vec<_> = unit
        .rooms
        .iter()
        .map(|r| (libm::round(r.z_m * 1000.0) as i64, r.floor.clone()))
        .collect();
    for (z, s) in walks {
        let same = unite(
            &room_solids
                .iter()
                .filter(|(rz, _)| *rz == z)
                .map(|(_, s)| s.clone())
                .collect::<Vec<_>>(),
        );
        let walls = unite(
            &unit
                .walls
                .iter()
                .filter(|w| {
                    w.z_m <= z as f64 / 1000.0 + 0.01
                        && w.z_m + w.height_m > z as f64 / 1000.0 + 0.01
                })
                .map(|w| wall_section(w, z as f64 / 1000.0 + 0.01))
                .collect::<Vec<_>>(),
        );
        for polygon in difference(&difference(&s, &same), &walls) {
            let surface = vec![polygon];
            if area(&surface) < 0.05 {
                continue;
            }
            node(
                unit,
                if unit.features.iter().any(|f| {
                    f.kind == FeatureKind::ArcticTunnel
                        && (f.z_m - z as f64 / 1000.0).abs() < 0.001
                        && area(&intersection(&surface, &f.surface)) > area(&surface) * 0.9
                }) {
                    AccessKind::Tunnel
                } else if z == 0 {
                    AccessKind::Exterior
                } else {
                    AccessKind::Circulation
                },
                surface,
                z as f64 / 1000.0,
            );
        }
    }
    let street = unit
        .site_context
        .iter()
        .find(|f| f.kind == FeatureKind::Street)
        .map(|f| f.surface.clone())
        .unwrap_or_else(|| unit.lot.clone());
    unit.access.root = unit
        .access
        .nodes
        .iter()
        .filter(|n| n.kind == AccessKind::Exterior && n.z_m == 0.0)
        .max_by(|a, b| {
            area(&intersection(&a.floor, &street))
                .total_cmp(&area(&intersection(&b.floor, &street)))
        })
        .ok_or("Aucun extérieur praticable pour la racine.")?
        .id
        .clone();
    for r in &unit.rooms {
        unit.access.nodes.push(AccessNode {
            id: r.access_node.clone(),
            kind: AccessKind::Room,
            floor: r.floor.clone(),
            z_m: r.z_m,
            household_id: r.household_id.clone(),
        });
    }
    add_vertical(unit)?;
    split_walk_nodes(unit)?;
    connect_horizontal(unit, &BTreeSet::new(), parameters)?;
    public_roofs::add_routes(unit)?;
    let previous_nodes: BTreeSet<_> = unit.access.nodes.iter().map(|n| n.id.clone()).collect();
    add_exterior_interfaces(unit, parameters)?;
    split_walk_nodes(unit)?;
    connect_horizontal(unit, &previous_nodes, parameters)?;
    profiles::add_entries(unit, parameters)?;
    let reach = reachable(unit);
    let missing: Vec<_> = unit
        .rooms
        .iter()
        .filter(|r| !reach.contains(&r.access_node))
        .map(|r| r.id.clone())
        .collect();
    if !missing.is_empty() {
        return Err(format!(
            "{} pièces inaccessibles depuis la rue : {}.",
            missing.len(),
            missing
                .iter()
                .take(8)
                .cloned()
                .collect::<Vec<_>>()
                .join(", ")
        ));
    }
    Ok(())
}

fn connect_horizontal(
    unit: &mut HouseUnit,
    previous_ids: &BTreeSet<String>,
    parameters: &crate::catalogue::Parameters,
) -> Result<(), String> {
    // Room nodes are physically separated by walls; candidates cut those walls.
    let party: Vec<_> = unit
        .walls
        .iter()
        .filter(|w| w.party)
        .map(|w| w.footprint.clone())
        .collect();
    let nodes = unit.access.nodes.clone();
    for i in 0..nodes.len() {
        for j in i + 1..nodes.len() {
            if (previous_ids.contains(&nodes[i].id) && previous_ids.contains(&nodes[j].id))
                || unit.access.portals.iter().any(|p| {
                    (p.from == nodes[i].id && p.to == nodes[j].id)
                        || (p.from == nodes[j].id && p.to == nodes[i].id)
                })
            {
                continue;
            }
            if (nodes[i].z_m - nodes[j].z_m).abs() > 0.001 {
                continue;
            }
            if nodes[i]
                .household_id
                .as_ref()
                .zip(nodes[j].household_id.as_ref())
                .is_some_and(|(a, b)| a != b)
            {
                continue;
            }
            if nodes[i].kind == AccessKind::Room && nodes[j].kind == AccessKind::Room {
                let a = unit.rooms.iter().find(|r| r.access_node == nodes[i].id);
                let b = unit.rooms.iter().find(|r| r.access_node == nodes[j].id);
                if a.zip(b)
                    .is_some_and(|(a, b)| a.household_id != b.household_id)
                {
                    continue;
                }
            }
            let ba = bounds(&nodes[i].floor);
            let bb = bounds(&nodes[j].floor);
            let depth = unit
                .bodies
                .iter()
                .map(|body| body.wall_thickness_m * 2.0 + 0.6)
                .fold(1.8, f64::max);
            if ba[2] + depth < bb[0]
                || bb[2] + depth < ba[0]
                || ba[3] + depth < bb[1]
                || bb[3] + depth < ba[1]
            {
                continue;
            }
            let forb: Vec<_> = party
                .iter()
                .cloned()
                .chain(
                    unit.rooms
                        .iter()
                        .filter(|r| {
                            r.access_node != nodes[i].id
                                && r.access_node != nodes[j].id
                                && (r.z_m - nodes[i].z_m).abs() < 0.001
                        })
                        .map(|r| r.floor.clone()),
                )
                .chain(
                    nodes
                        .iter()
                        .filter(|n| {
                            n.kind != AccessKind::Room
                                && n.id != nodes[i].id
                                && n.id != nodes[j].id
                                && (n.z_m - nodes[i].z_m).abs() < 0.001
                                && n.household_id.is_some()
                                && n.household_id != nodes[i].household_id
                                && n.household_id != nodes[j].household_id
                        })
                        .map(|n| n.floor.clone()),
                )
                .chain(
                    unit.site_context
                        .iter()
                        .filter(|f| match f.kind {
                            FeatureKind::Water => nodes[i].z_m <= 0.001,
                            FeatureKind::Neighbor | FeatureKind::RockFace => {
                                nodes[i].z_m >= f.z_m - 0.001 && nodes[i].z_m < f.z_m + f.height_m
                            }
                            _ => false,
                        })
                        .map(|f| f.surface.clone()),
                )
                .collect();
            let entry_owner = profiles::entry_owner(unit, &nodes[i], &nodes[j]);
            let mut profile =
                if let (Some(owner), Some(program)) = (&entry_owner, &parameters.portal_profile) {
                    let ordinal = profiles::entries(unit, owner).len();
                    if ordinal >= program.count[1] as usize {
                        continue;
                    }
                    Some(program.entries[ordinal % program.entries.len()].clone())
                } else {
                    None
                };
            let site = entry_owner.is_none()
                && nodes[i].kind != AccessKind::Room
                && nodes[j].kind != AccessKind::Room
                && parameters.site_gate_profile.is_some();
            if site {
                let program = parameters.site_gate_profile.as_ref().unwrap();
                let ordinal = profiles::site_entries(unit, program).len();
                profile = Some(program.entries[ordinal % program.entries.len()].clone());
            }
            let court_width = (entry_owner.is_none()
                && nodes[i].kind != AccessKind::Room
                && nodes[j].kind != AccessKind::Room)
                .then(|| {
                    parameters
                        .court_program
                        .as_ref()
                        .map(|p| p.threshold.width_m)
                })
                .flatten();
            let mut portal_width = profile
                .as_ref()
                .map_or(court_width.unwrap_or(0.85), |p| p.width_m);
            let width = profile
                .as_ref()
                .map_or(portal_width, |spec| spec.width_m.max(spec.top_width_m));
            let existing = entry_owner
                .as_ref()
                .map(|owner| profiles::entries(unit, owner))
                .unwrap_or_default();
            let accept = |opening, _: &Surface, _| {
                profile.is_none() || entry_owner.is_none() || profiles::distinct(opening, &existing)
            };
            if let Some((opening, strip)) = candidate_filtered(
                &nodes[i].floor,
                &nodes[j].floor,
                width,
                depth,
                &forb,
                accept,
            )
            .or_else(|| {
                candidate_filtered(
                    &nodes[j].floor,
                    &nodes[i].floor,
                    width,
                    depth,
                    &forb,
                    accept,
                )
            }) {
                let (opening, strip) = if (site || court_width.is_some())
                    && !profiles::crosses_enclosure(unit, &strip, nodes[i].z_m)
                {
                    profile = None;
                    portal_width = 0.85;
                    let Some(candidate) =
                        candidate(&nodes[i].floor, &nodes[j].floor, 0.85, depth, &forb).or_else(
                            || candidate(&nodes[j].floor, &nodes[i].floor, 0.85, depth, &forb),
                        )
                    else {
                        continue;
                    };
                    candidate
                } else {
                    if site {
                        let program = parameters.site_gate_profile.as_ref().unwrap();
                        if profiles::site_entries(unit, program).len() >= program.count[1] as usize
                        {
                            continue;
                        }
                    }
                    (opening, strip)
                };
                portal_with_profile(
                    unit,
                    &nodes[i].id,
                    &nodes[j].id,
                    if nodes[i].kind == AccessKind::Tunnel || nodes[j].kind == AccessKind::Tunnel {
                        PortalKind::Tunnel
                    } else if nodes[i].kind == AccessKind::Room || nodes[j].kind == AccessKind::Room
                    {
                        PortalKind::Door
                    } else if site && profile.as_ref().is_some_and(|p| p.width_m >= 1.2) {
                        PortalKind::Gate
                    } else {
                        PortalKind::Passage
                    },
                    opening,
                    strip.clone(),
                    portal_width,
                    if nodes[i].kind == AccessKind::Tunnel || nodes[j].kind == AccessKind::Tunnel {
                        unit.features
                            .iter()
                            .filter(|f| {
                                f.kind == FeatureKind::ArcticTunnel
                                    && area(&intersection(&f.surface, &strip)) > 0.001
                            })
                            .map(|f| f.id.clone())
                            .collect()
                    } else {
                        vec![]
                    },
                    profile.as_ref(),
                )?;
            }
        }
    }
    Ok(())
}

fn add_vertical(unit: &mut HouseUnit) -> Result<(), String> {
    let preserve_hatches = roof_apertures::collective(unit);
    let bodies = unit.bodies.clone();
    let mut roof_nodes = vec![];
    // Each connected structural terrace is a real walk surface at an exact z.
    let mut slab_keys = BTreeSet::new();
    for body in &bodies {
        for level in &body.levels {
            if let Some(slab) = &level.roof_slab
                && slab.walkable
            {
                let key = libm::round(slab.z_m * 1000.0) as i64;
                slab_keys.insert(key);
            }
        }
    }
    for z in slab_keys {
        let s = roof_apertures::walk_surface(unit, z)?;
        for polygon in s {
            if area(&vec![polygon.clone()]) > 0.05 {
                roof_nodes.push(node(
                    unit,
                    AccessKind::Terrace,
                    vec![polygon],
                    z as f64 / 1000.0,
                ));
            }
        }
    }
    for (bi, body) in bodies.iter().enumerate() {
        if body.vertical_access == VerticalAccess::IntramuralStair
            || body.details.iter().any(|d| d == "inhabited_ring")
        {
            add_gallery_routes(unit, body)?;
            continue;
        }
        if body.vertical_access == VerticalAccess::ExteriorStair {
            add_facade_routes(unit, body)?;
            continue;
        }
        let mut households: BTreeMap<String, Vec<usize>> = BTreeMap::new();
        for (ri, r) in unit
            .rooms
            .iter()
            .enumerate()
            .filter(|(_, r)| r.body_id == body.id)
        {
            households
                .entry(if body.cells.is_empty() {
                    body.id.clone()
                } else {
                    r.household_id.clone().unwrap_or_else(|| body.id.clone())
                })
                .or_default()
                .push(ri);
        }
        for indices in households.values() {
            let owners: BTreeSet<_> = indices
                .iter()
                .filter_map(|&i| unit.rooms[i].household_id.clone())
                .collect();
            let private_owner = if owners.len() == 1 {
                owners.iter().next().cloned()
            } else {
                None
            };
            let max_level = indices
                .iter()
                .map(|&i| unit.rooms[i].level)
                .max()
                .unwrap_or(0);
            let needs_roof = body.cells.iter().any(|cell| cell.household_id.is_some())
                && body.roof_system == "RF-FLAT"
                || body.vertical_access == VerticalAccess::RoofHatch;
            if max_level == 0 && !needs_roof {
                continue;
            }
            let mut common = vec![];
            for level in 0..=max_level {
                let floor = if private_owner.is_none() {
                    intersection(
                        &unite(
                            &unit
                                .access
                                .nodes
                                .iter()
                                .filter(|n| {
                                    n.kind != AccessKind::Room
                                        && (n.z_m - body.levels[level as usize].z_m).abs() < 0.001
                                })
                                .map(|n| n.floor.clone())
                                .collect::<Vec<_>>(),
                        ),
                        &body.levels[level as usize].footprint,
                    )
                } else {
                    unite(
                        &indices
                            .iter()
                            .filter(|&&i| unit.rooms[i].level == level)
                            .map(|&i| unit.rooms[i].floor.clone())
                            .collect::<Vec<_>>(),
                    )
                };
                common = if level == 0 {
                    floor
                } else {
                    intersection(&common, &floor)
                };
            }
            let routes = active_routes(body);
            let (width, run) = vertical_footprint(
                body.vertical_access,
                &routes,
                body.levels.iter().map(|l| l.height_m).fold(0.0, f64::max),
            );
            let anchor = anchor(&common, width, run).ok_or_else(|| {
                format!("{} : aucune trémie {} × {run} m contenue.", body.id, width)
            })?;
            let mut previous: Option<(String, f64)> = None;
            for level in 0..=max_level {
                let z = body.levels[level as usize].z_m;
                if level > 0 {
                    trim_walk_plane(unit, z, &anchor);
                }
                let id = node(unit, AccessKind::StairLanding, anchor.clone(), z);
                if let Some(n) = unit.access.nodes.last_mut() {
                    n.household_id = private_owner.clone();
                }
                let on_level: Vec<_> = indices
                    .iter()
                    .copied()
                    .filter(|&i| unit.rooms[i].level == level)
                    .collect();
                for ri in on_level {
                    unit.rooms[ri].floor = difference(&unit.rooms[ri].floor, &anchor);
                    if area(&unit.rooms[ri].floor) < 0.45 || unit.rooms[ri].floor.len() > 1 {
                        return Err(format!(
                            "{} : trémie divise ou consomme sa pièce.",
                            unit.rooms[ri].id
                        ));
                    }
                    if let Some(n) = unit
                        .access
                        .nodes
                        .iter_mut()
                        .find(|n| n.id == unit.rooms[ri].access_node)
                    {
                        n.floor = unit.rooms[ri].floor.clone();
                    }
                }
                if level > 0 {
                    unit.bodies[bi].levels[level as usize].floor =
                        difference(&unit.bodies[bi].levels[level as usize].floor, &anchor);
                }
                if let Some((prior, prior_z)) = previous {
                    let route = routes
                        .iter()
                        .find(|r| r.from_level == level - 1 && r.to_level == level)
                        .ok_or_else(|| {
                            format!(
                                "{} : aucune route déclarée du niveau {} vers {level}.",
                                body.id,
                                level - 1
                            )
                        })?;
                    let ladder = matches!(
                        route.kind,
                        VerticalAccess::Ladder | VerticalAccess::RoofHatch
                    );
                    let f = interface(
                        unit,
                        if ladder {
                            FeatureKind::Ladder
                        } else {
                            FeatureKind::Stair
                        },
                        anchor.clone(),
                        prior_z,
                        z,
                    );
                    let b = bounds(&anchor);
                    portal(
                        unit,
                        &prior,
                        &id,
                        if ladder {
                            PortalKind::Ladder
                        } else {
                            PortalKind::Stair
                        },
                        [point(b[0], b[1]), point(b[2], b[1])],
                        anchor.clone(),
                        width,
                        vec![f],
                    )?;
                }
                previous = Some((id, z));
            }
            if needs_roof {
                let roof_z =
                    body.levels[max_level as usize].z_m + body.levels[max_level as usize].height_m;
                if let Some(target) = roof_nodes.iter().find(|id| {
                    unit.access
                        .nodes
                        .iter()
                        .find(|n| &n.id == *id)
                        .is_some_and(|n| {
                            (n.z_m - roof_z).abs() < 0.001
                                && area(&intersection(&n.floor, &anchor)) > 0.5
                        })
                }) {
                    let target = target.clone();
                    let (from, z) = previous.ok_or("Palier de trappe absent.")?;
                    let f = interface(unit, FeatureKind::Hatch, anchor.clone(), z, roof_z);
                    let b = bounds(&anchor);
                    portal(
                        unit,
                        &from,
                        &target,
                        PortalKind::Hatch,
                        [point(b[0], b[1]), point(b[2], b[1])],
                        anchor.clone(),
                        width,
                        vec![f],
                    )?;
                    let hole = offset(&anchor, -0.12);
                    if let Some(p) = unit.access.portals.last_mut() {
                        p.opening_surface = hole.clone();
                        p.width_m = 0.66;
                    }
                    if let Some(slab) = &mut unit.bodies[bi].levels[max_level as usize].roof_slab {
                        slab.surface = if preserve_hatches {
                            roof_apertures::cut(&slab.surface, &hole)
                        } else {
                            difference(&slab.surface, &hole)
                        };
                        slab.access_node = Some(target.clone());
                    }
                    // The hatch is a genuine hole; the landing remains on its rim.
                    if let Some(n) = unit.access.nodes.iter_mut().find(|n| n.id == target) {
                        n.floor = if preserve_hatches && n.kind == AccessKind::Terrace {
                            roof_apertures::cut(&n.floor, &hole)
                        } else {
                            difference(&n.floor, &offset(&anchor, -0.12))
                        };
                    }
                    trim_walk_plane_impl(unit, roof_z, &hole, preserve_hatches);
                } else {
                    return Err(format!(
                        "{} : trappe sans dalle accessible à {roof_z} m.",
                        body.id
                    ));
                }
            }
        }
    }
    Ok(())
}

pub(crate) use crate::vertical_footprint::vertical_footprint;

fn active_routes(body: &Body) -> Vec<crate::catalogue::VerticalRoute> {
    let last = body.levels.len().saturating_sub(1) as u32;
    if body.vertical_routes.is_empty() {
        (0..last)
            .map(|level| crate::catalogue::VerticalRoute {
                kind: body.vertical_access,
                from_level: level,
                to_level: level + 1,
                placement: crate::catalogue::Placement::Main,
                min_width_m: 0.9,
            })
            .collect()
    } else {
        body.vertical_routes
            .iter()
            .filter(|r| r.to_level <= last)
            .cloned()
            .collect()
    }
}

fn add_gallery_routes(unit: &mut HouseUnit, body: &Body) -> Result<(), String> {
    let gallery: Vec<_> = body
        .levels
        .iter()
        .map(|level| {
            unite(
                &unit
                    .features
                    .iter()
                    .filter(|f| {
                        f.kind == FeatureKind::Gallery
                            && (f.z_m - level.z_m).abs() < 0.001
                            && area(&intersection(&f.surface, &offset(&level.footprint, 3.5))) > 0.1
                    })
                    .map(|f| f.surface.clone())
                    .collect::<Vec<_>>(),
            )
        })
        .collect();
    let routes = active_routes(body);
    for (route_index, route) in routes.iter().enumerate() {
        let from = route.from_level as usize;
        let to = route.to_level as usize;
        let common = intersection(&gallery[from], &gallery[to]);
        let width = route.min_width_m.max(0.9);
        let run = ((body.levels[to].z_m - body.levels[from].z_m) * 0.95).max(2.6);
        let space = anchor(&common, width, run).ok_or_else(|| {
            format!(
                "{} route {route_index} : volée intramurale {width} × {run} m hors galerie.",
                body.id
            )
        })?;
        let mut ends = vec![];
        for (li, cut) in [(from, false), (to, true)] {
            let z = body.levels[li].z_m;
            if cut {
                for n in unit
                    .access
                    .nodes
                    .iter_mut()
                    .filter(|n| n.kind != AccessKind::Room && (n.z_m - z).abs() < 0.001)
                {
                    n.floor = difference(&n.floor, &space);
                }
                for f in unit
                    .features
                    .iter_mut()
                    .filter(|f| f.kind == FeatureKind::Gallery && (f.z_m - z).abs() < 0.001)
                {
                    f.surface = difference(&f.surface, &space);
                }
            }
            let landing = node(unit, AccessKind::StairLanding, space.clone(), z);
            ends.push(landing);
        }
        let z0 = body.levels[from].z_m;
        let z1 = body.levels[to].z_m;
        // A covered gallery needs a real opening above the rising flight.
        for f in unit
            .features
            .iter_mut()
            .filter(|f| f.kind == FeatureKind::Gallery && (f.z_m - z0).abs() < 0.001)
        {
            if let Some(roof) = &mut f.roof {
                roof.domain = difference(&roof.domain, &space);
                f.surface = difference(&f.surface, &space);
            }
        }
        let f = interface(unit, FeatureKind::Stair, space.clone(), z0, z1);
        let b = bounds(&space);
        portal(
            unit,
            &ends[0],
            &ends[1],
            PortalKind::Stair,
            [point(b[0], b[1]), point(b[2], b[1])],
            space,
            width,
            vec![f],
        )?;
    }
    Ok(())
}

fn add_facade_routes(unit: &mut HouseUnit, body: &Body) -> Result<(), String> {
    let b = bounds(&body.footprint);
    let solids = unite(
        &unit
            .bodies
            .iter()
            .map(|b| b.footprint.clone())
            .collect::<Vec<_>>(),
    );
    let obstacles = unite(
        &unit
            .site_context
            .iter()
            .filter(|f| {
                matches!(
                    f.kind,
                    FeatureKind::Neighbor | FeatureKind::Water | FeatureKind::RockFace
                )
            })
            .map(|f| f.surface.clone())
            .collect::<Vec<_>>(),
    );
    for (ri, route) in active_routes(body).iter().enumerate() {
        let z0 = body.levels[route.from_level as usize].z_m;
        let z1 = body.levels[route.to_level as usize].z_m;
        let width = route.min_width_m.max(0.9);
        let run = ((z1 - z0) * 0.95).max(2.6);
        let options = [
            rectangle((b[0] + b[2] - run) * 0.5, b[3], run, width),
            rectangle(b[0] - width, (b[1] + b[3] - run) * 0.5, width, run),
            rectangle(b[2], (b[1] + b[3] - run) * 0.5, width, run),
            rectangle((b[0] + b[2] - run) * 0.5, b[1] - width, run, width),
        ];
        let space = options
            .into_iter()
            .find(|s| {
                area(&difference(s, &unit.lot)) < 0.001
                    && area(&intersection(s, &union(&solids, &obstacles))) < 0.001
            })
            .ok_or_else(|| {
                format!(
                    "{} route{ri} : aucune façade dégagée pour escalier extérieur.",
                    body.id
                )
            })?;
        let from = node(unit, AccessKind::StairLanding, space.clone(), z0);
        let to = node(unit, AccessKind::StairLanding, space.clone(), z1);
        let f = interface(unit, FeatureKind::Stair, space.clone(), z0, z1);
        let b = bounds(&space);
        portal(
            unit,
            &from,
            &to,
            PortalKind::Stair,
            [point(b[0], b[1]), point(b[2], b[1])],
            space,
            width,
            vec![f],
        )?;
    }
    Ok(())
}

/// One graph node represents one connected walk surface, including after cuts.
fn split_walk_nodes(unit: &mut HouseUnit) -> Result<(), String> {
    let mut fragments: BTreeMap<String, Vec<AccessNode>> = BTreeMap::new();
    let original = std::mem::take(&mut unit.access.nodes);
    for mut n in original {
        if n.floor.is_empty() || area(&n.floor) < 0.005 {
            if n.kind == AccessKind::Room
                || unit
                    .access
                    .portals
                    .iter()
                    .any(|p| p.from == n.id || p.to == n.id)
            {
                return Err(format!(
                    "Espace {} consommé par une trémie alors qu'il porte un accès.",
                    n.id
                ));
            }
            continue;
        }
        if n.kind == AccessKind::Room || n.floor.len() <= 1 {
            unit.access.nodes.push(n);
            continue;
        }
        let mut parts: Vec<_> = n
            .floor
            .iter()
            .cloned()
            .map(|p| vec![p])
            .filter(|s| area(s) >= 0.05)
            .collect();
        parts.sort_by(|a, b| area(b).total_cmp(&area(a)));
        let old_id = n.id.clone();
        let mut nodes = vec![];
        for (i, floor) in parts.into_iter().enumerate() {
            n.floor = floor;
            n.id = if i == 0 {
                old_id.clone()
            } else {
                format!("{old_id}:fragment:{i}")
            };
            nodes.push(n.clone());
            unit.access.nodes.push(n.clone());
        }
        fragments.insert(old_id, nodes);
    }
    for p in &mut unit.access.portals {
        for id in [&mut p.from, &mut p.to] {
            if let Some(parts) = fragments.get(id) {
                *id = parts
                    .iter()
                    .filter(|n| area(&intersection(&n.floor, &p.passage)) >= 0.005)
                    .max_by(|a, b| {
                        area(&intersection(&a.floor, &p.passage))
                            .total_cmp(&area(&intersection(&b.floor, &p.passage)))
                    })
                    .ok_or_else(|| format!("Portail {} coupé par une trémie.", p.id))?
                    .id
                    .clone();
            }
        }
    }
    Ok(())
}

fn flight_edges(surface: &Surface, from: &Surface) -> Option<([Point; 2], [Point; 2])> {
    let p = surface.first()?;
    if surface.len() != 1 || p.outer.len() != 4 || !p.holes.is_empty() {
        return None;
    }
    let r = &p.outer;
    let length = |i: usize| libm::hypot(r[(i + 1) % 4].x - r[i].x, r[(i + 1) % 4].y - r[i].y);
    let i = if length(0) <= length(1) { 0 } else { 1 };
    let a = [r[i], r[(i + 1) % 4]];
    let b = [r[(i + 3) % 4], r[(i + 2) % 4]];
    let aa = end_band(a, b, 0.35);
    let bb = end_band(b, a, 0.35);
    let overlap_a = area(&intersection(from, &aa));
    let overlap_b = area(&intersection(from, &bb));
    let c = center(from);
    let distance = |edge: [Point; 2]| {
        libm::hypot(
            (edge[0].x + edge[1].x) * 0.5 - c.x,
            (edge[0].y + edge[1].y) * 0.5 - c.y,
        )
    };
    if overlap_b > overlap_a + 0.001
        || ((overlap_b - overlap_a).abs() <= 0.001 && distance(b) < distance(a))
    {
        Some((b, a))
    } else {
        Some((a, b))
    }
}

fn end_band(a: [Point; 2], b: [Point; 2], depth: f64) -> Surface {
    let dx = (b[0].x + b[1].x - a[0].x - a[1].x) * 0.5;
    let dy = (b[0].y + b[1].y - a[0].y - a[1].y) * 0.5;
    let length = libm::hypot(dx, dy);
    if length < 0.001 {
        return vec![];
    }
    quad([
        a[0],
        a[1],
        point(a[1].x + dx / length * depth, a[1].y + dy / length * depth),
        point(a[0].x + dx / length * depth, a[0].y + dy / length * depth),
    ])
}

fn quad(mut points: [Point; 4]) -> Surface {
    if signed_area(&points) < 0.0 {
        points.reverse();
    }
    vec![Polygon {
        outer: points.to_vec(),
        holes: vec![],
    }]
}

fn exterior_obstacles(unit: &HouseUnit) -> Surface {
    let solids: Vec<_> = unit
        .bodies
        .iter()
        .flat_map(|b| b.levels.iter().map(|l| l.footprint.clone()))
        .chain(
            unit.features
                .iter()
                .filter(|f| {
                    matches!(
                        f.kind,
                        FeatureKind::Post
                            | FeatureKind::Pier
                            | FeatureKind::Raft
                            | FeatureKind::Stair
                            | FeatureKind::Ladder
                    )
                })
                .map(|f| f.surface.clone()),
        )
        .chain(
            unit.site_context
                .iter()
                .filter(|f| {
                    matches!(
                        f.kind,
                        FeatureKind::Water | FeatureKind::Neighbor | FeatureKind::RockFace
                    )
                })
                .map(|f| f.surface.clone()),
        )
        .chain(
            unit.walls
                .iter()
                .filter(|w| w.party)
                .map(|w| w.footprint.clone()),
        )
        .collect();
    offset(&unite(&solids), 0.03)
}

fn choose_exterior_flight(
    unit: &HouseUnit,
    target: &Surface,
    ground: &Surface,
    blocked: &Surface,
    shared: &Surface,
    width: f64,
    run: f64,
) -> Option<Surface> {
    search_exterior_flight(
        unit,
        target,
        ground,
        &union(blocked, shared),
        &vec![],
        width,
        run,
    )
    .or_else(|| search_exterior_flight(unit, target, ground, blocked, shared, width, run))
}

#[allow(clippy::too_many_arguments)] // One geometric certificate of the two terminal floors.
fn search_exterior_flight(
    unit: &HouseUnit,
    target: &Surface,
    ground: &Surface,
    blocked: &Surface,
    shared: &Surface,
    width: f64,
    run: f64,
) -> Option<Surface> {
    let accepts = |space: &Surface| {
        let Some((start, end)) = flight_edges(space, target) else {
            return false;
        };
        let target_end = end_band(start, end, 0.35);
        area(&difference(space, &unit.lot)) <= 0.001
            && area(&intersection(space, blocked)) <= 0.001
            && area(&difference(&intersection(space, shared), &target_end)) <= 1e-6
            && area(&intersection(&target_end, target)) >= width * 0.3
            && area(&intersection(&end_band(end, start, 0.35), ground)) >= width * 0.3
    };
    // Preserve historical anchor choices. A shared route may only occupy the
    // terminal landing, so even this fast path uses the full certificate.
    let available = difference(&intersection(target, ground), &union(blocked, shared));
    if let Some(s) = anchor(&available, width, run)
        && accepts(&s)
    {
        return Some(s);
    }
    for ring in rings(target) {
        for (a, b) in ring
            .iter()
            .zip(ring.iter().cycle().skip(1))
            .take(ring.len())
        {
            let length = libm::hypot(b.x - a.x, b.y - a.y);
            if length < width {
                continue;
            }
            let ux = (b.x - a.x) / length;
            let uy = (b.y - a.y) / length;
            for t in [0.5, 0.25, 0.75] {
                for sign in [1.0, -1.0] {
                    let nx = uy * sign;
                    let ny = -ux * sign;
                    let c = point(
                        a.x + (b.x - a.x) * t - nx * 0.35,
                        a.y + (b.y - a.y) * t - ny * 0.35,
                    );
                    let p = point(c.x - ux * width * 0.5, c.y - uy * width * 0.5);
                    let q = point(c.x + ux * width * 0.5, c.y + uy * width * 0.5);
                    let s = quad([
                        p,
                        q,
                        point(q.x + nx * run, q.y + ny * run),
                        point(p.x + nx * run, p.y + ny * run),
                    ]);
                    if accepts(&s) {
                        return Some(s);
                    }
                }
            }
        }
    }
    None
}

fn trim_walk_plane(unit: &mut HouseUnit, z: f64, cut: &Surface) {
    trim_walk_plane_impl(unit, z, cut, false);
}

fn trim_walk_plane_impl(unit: &mut HouseUnit, z: f64, cut: &Surface, preserve_hatch: bool) {
    let collective = roof_apertures::collective(unit);

    for n in unit
        .access
        .nodes
        .iter_mut()
        .filter(|n| n.kind != AccessKind::Room && (n.z_m - z).abs() < 0.001)
    {
        n.floor = if n.kind == AccessKind::Terrace {
            disjoint_walk_trim::apply(&n.floor, cut, preserve_hatch, collective)
        } else {
            difference(&n.floor, cut)
        };
    }
    for f in &mut unit.features {
        if matches!(
            f.kind,
            FeatureKind::Gallery
                | FeatureKind::Deck
                | FeatureKind::Landing
                | FeatureKind::Terrace
                | FeatureKind::FloorSlab
        ) && (f.z_m - z).abs() < 0.001
        {
            f.surface = if f.kind == FeatureKind::Terrace {
                disjoint_walk_trim::apply(&f.surface, cut, preserve_hatch, collective)
            } else {
                difference(&f.surface, cut)
            };
        }
        if let Some(roof) = &mut f.roof
            && (roof.support_z_m - z).abs() < 2.3
            && roof.support_z_m >= z - 0.001
        {
            roof.domain = difference(&roof.domain, cut);
        }
    }
    for body in &mut unit.bodies {
        for level in &mut body.levels {
            if (level.z_m - z).abs() < 0.001 {
                level.floor = difference(&level.floor, cut);
            }
            if let Some(slab) = &mut level.roof_slab
                && (slab.z_m - z).abs() < 0.001
            {
                slab.surface =
                    disjoint_walk_trim::apply(&slab.surface, cut, preserve_hatch, collective);
            }
        }
    }
}

fn supported_landing(unit: &mut HouseUnit, surface: &Surface, z: f64) {
    let id = format!("{}:landing:{}", unit.id, unit.features.len());
    unit.features.push(feature(
        &id,
        FeatureKind::Landing,
        surface.clone(),
        z,
        0.15,
        "MAT-TIMBER-POST",
    ));
    for (i, p) in surface[0].outer.iter().enumerate() {
        let post = intersection(&rectangle(p.x - 0.1, p.y - 0.1, 0.2, 0.2), surface);
        unit.features.push(feature(
            &format!("{id}:post:{i}"),
            FeatureKind::Post,
            post,
            0.0,
            z,
            "MAT-TIMBER-POST",
        ));
    }
}

fn trench(unit: &mut HouseUnit, surface: &Surface, z: f64) {
    trench_with_open_end(unit, surface, z, None);
}

fn trench_with_open_end(
    unit: &mut HouseUnit,
    surface: &Surface,
    z: f64,
    open_end: Option<&Surface>,
) {
    let id = format!("{}:areaway:{}", unit.id, unit.features.len());
    unit.features.push(feature(
        &id,
        FeatureKind::Excavation,
        surface.clone(),
        z,
        -z,
        "MAT-RAMMED-EARTH",
    ));
    // The shared lower landing is already excavated. Its access is not cut by
    // walls retaining the ground along the rising part of the new areaway.
    let retained = open_end.map_or_else(|| surface.clone(), |end| difference(surface, end));
    let ring = &retained[0].outer;
    let lengths: Vec<_> = (0..ring.len())
        .map(|i| {
            libm::hypot(
                ring[(i + 1) % ring.len()].x - ring[i].x,
                ring[(i + 1) % ring.len()].y - ring[i].y,
            )
        })
        .collect();
    let longest = lengths.iter().copied().fold(0.0, f64::max);
    let original = &surface[0].outer;
    let first = libm::hypot(original[1].x - original[0].x, original[1].y - original[0].y);
    let second = libm::hypot(original[2].x - original[1].x, original[2].y - original[1].y);
    let edge = usize::from(second > first);
    let direction = Point {
        x: original[edge + 1].x - original[edge].x,
        y: original[edge + 1].y - original[edge].y,
    };
    for i in (0..ring.len()).filter(|&i| {
        if open_end.is_none() {
            return lengths[i] >= longest - 0.01;
        }
        let dx = ring[(i + 1) % ring.len()].x - ring[i].x;
        let dy = ring[(i + 1) % ring.len()].y - ring[i].y;
        (dx * direction.x + dy * direction.y).abs() > (dx * direction.y - dy * direction.x).abs()
    }) {
        let end = ring[(i + 1) % ring.len()];
        let footprint = difference(&segment_strip(ring[i], end, 0.3), surface);
        unit.walls.push(Wall {
            solid: None,
            plan_section: None,
            shell_reference: false,
            id: format!("{id}:retaining:{i}"),
            kind: WallKind::Retaining,
            body_id: None,
            level: 0,
            z_m: z,
            height_m: -z,
            footprint,
            centerline: vec![ring[i], end],
            material: "MAT-STONE-DRY".into(),
            party: false,
            opening_ids: vec![],
        });
    }
}

fn passage_is_shareable(unit: &HouseUnit, passage: &Portal, z: f64, ground: &str) -> bool {
    if passage.kind != PortalKind::Passage
        || passage.from == ground
        || passage.to == ground
        || (passage.from_z_m - z).abs() > 1e-9
        || (passage.to_z_m - z).abs() > 1e-9
    {
        return false;
    }
    let floors = unite(
        &unit
            .access
            .nodes
            .iter()
            .filter(|n| {
                n.kind != AccessKind::Room && n.household_id.is_none() && (n.z_m - z).abs() <= 1e-9
            })
            .map(|n| n.floor.clone())
            .collect::<Vec<_>>(),
    );
    area(&difference(&passage.passage, &floors)) <= 1e-6
}

fn validate_shared_passages(unit: &HouseUnit, ids: &[String], z: f64) -> Result<(), String> {
    let floors = unite(
        &unit
            .access
            .nodes
            .iter()
            .filter(|n| {
                n.kind != AccessKind::Room && n.household_id.is_none() && (n.z_m - z).abs() <= 1e-9
            })
            .map(|n| n.floor.clone())
            .collect::<Vec<_>>(),
    );
    for id in ids {
        let passage = unit
            .access
            .portals
            .iter()
            .find(|p| &p.id == id)
            .ok_or("Passage partagé absent après découpe.")?;
        if area(&difference(&passage.passage, &floors)) > 1e-6
            || [&passage.from, &passage.to].iter().any(|id| {
                unit.access
                    .nodes
                    .iter()
                    .find(|n| &n.id == *id)
                    .is_none_or(|n| {
                        (n.z_m - z).abs() > 1e-9
                            || area(&intersection(&n.floor, &passage.passage)) < 0.005
                    })
            })
        {
            return Err(format!(
                "Passage partagé {} non porté après découpe.",
                passage.id
            ));
        }
        if unit
            .walls
            .iter()
            .any(|w| area(&intersection(&wall_section(w, z + 0.01), &passage.passage)) > 1e-6)
        {
            return Err(format!(
                "Passage partagé {} coupé par un mur de tranchée.",
                passage.id
            ));
        }
    }
    Ok(())
}

fn add_exterior_interfaces(
    unit: &mut HouseUnit,
    parameters: &crate::catalogue::Parameters,
) -> Result<(), String> {
    let targets: Vec<_> = unit
        .access
        .nodes
        .iter()
        .filter(|n| {
            n.kind != AccessKind::Room
                && n.kind != AccessKind::Exterior
                && n.kind != AccessKind::StairLanding
                && n.z_m != 0.0
        })
        .cloned()
        .collect();
    for target in targets {
        if reachable(unit).contains(&target.id) {
            continue;
        }
        let ground: Vec<_> = unit
            .access
            .nodes
            .iter()
            .filter(|n| n.kind == AccessKind::Exterior && n.z_m == 0.0)
            .cloned()
            .collect();
        let ladder = target.kind == AccessKind::Terrace && target.z_m.abs() <= 3.0;
        let run = if ladder {
            1.3
        } else {
            (target.z_m.abs() * 0.95).max(2.6)
        };
        let blocked = exterior_obstacles(unit);
        for g in ground {
            let relevant: Vec<_> = unit
                .access
                .portals
                .iter()
                .filter(|p| {
                    (p.from_z_m - target.z_m).abs() < 0.001
                        || (p.to_z_m - target.z_m).abs() < 0.001
                        || p.from == g.id
                        || p.to == g.id
                })
                .collect();
            let shared_ids: Vec<_> = relevant
                .iter()
                .filter(|p| passage_is_shareable(unit, p, target.z_m, &g.id))
                .map(|p| p.id.clone())
                .collect();
            let shared = unite(
                &relevant
                    .iter()
                    .filter(|p| shared_ids.contains(&p.id))
                    .map(|p| p.passage.clone())
                    .collect::<Vec<_>>(),
            );
            let reserved = unite(
                &relevant
                    .iter()
                    .filter(|p| !shared_ids.contains(&p.id))
                    .map(|p| p.passage.clone())
                    .collect::<Vec<_>>(),
            );
            if let Some(space) = choose_exterior_flight(
                unit,
                &target.floor,
                &g.floor,
                &union(&blocked, &reserved),
                &shared,
                0.9,
                run,
            ) {
                let (start, end) = flight_edges(&space, &target.floor)
                    .ok_or("Volée extérieure non rectangulaire.")?;
                let target_end = end_band(start, end, 0.35);
                let ground_end = end_band(end, start, 0.35);
                trim_walk_plane(unit, target.z_m, &difference(&space, &target_end));
                if target.z_m < 0.0 {
                    trim_walk_plane(unit, 0.0, &difference(&space, &ground_end));
                    let open_end =
                        (area(&intersection(&space, &shared)) > 1e-6).then_some(&target_end);
                    trench_with_open_end(unit, &space, target.z_m, open_end);
                }
                validate_shared_passages(unit, &shared_ids, target.z_m)?;
                let landing = node(
                    unit,
                    AccessKind::StairLanding,
                    target_end.clone(),
                    target.z_m,
                );
                let f = interface(
                    unit,
                    if ladder {
                        FeatureKind::Ladder
                    } else {
                        FeatureKind::Stair
                    },
                    space.clone(),
                    target.z_m,
                    0.0,
                );
                portal(
                    unit,
                    &landing,
                    &g.id,
                    if ladder {
                        PortalKind::Ladder
                    } else {
                        PortalKind::Stair
                    },
                    start,
                    space,
                    0.9,
                    vec![f],
                )?;
                // This landing is part of the target's real walking surface.
                // Connect it before deciding whether raised rooms need another
                // exterior stair, otherwise their pending deck route is missed.
                portal(
                    unit,
                    &target.id,
                    &landing,
                    PortalKind::Passage,
                    start,
                    target_end,
                    0.9,
                    vec![],
                )?;
                break;
            }
        }
    }
    // Ordinary raised/sunken bodies get a real outside landing and doorway.
    for body in unit.bodies.clone() {
        let z = body.levels[0].z_m;
        if z == 0.0
            || body.envelope == Envelope::Rockcut
            || unit
                .rooms
                .iter()
                .filter(|r| r.body_id == body.id && r.level == 0)
                .all(|r| reachable(unit).contains(&r.access_node))
        {
            continue;
        }
        let blocked = exterior_obstacles(unit);
        let ground: Vec<_> = unit
            .access
            .nodes
            .iter()
            .filter(|n| n.kind == AccessKind::Exterior && n.z_m == 0.0)
            .cloned()
            .collect();
        let run = (z.abs() * 0.95).max(2.6);
        let profile = parameters
            .portal_profile
            .as_ref()
            .map(|program| program.entries[0].clone());
        let door_width = profile
            .as_ref()
            .map_or(0.85, |spec| spec.width_m.max(spec.top_width_m));
        let flight_width = profile
            .as_ref()
            .map_or(0.9, |_| (door_width + 0.3).max(0.9));
        let mut done = false;
        for ring in body.footprint.iter().map(|p| &p.outer) {
            for (a, b) in ring
                .iter()
                .zip(ring.iter().cycle().skip(1))
                .take(ring.len())
            {
                let length = libm::hypot(b.x - a.x, b.y - a.y);
                if length < 0.002 {
                    continue;
                }
                let ux = (b.x - a.x) / length;
                let uy = (b.y - a.y) / length;
                for t in [0.5, 0.25, 0.75] {
                    let c = point(
                        a.x + (b.x - a.x) * t + uy * 0.031,
                        a.y + (b.y - a.y) * t - ux * 0.031,
                    );
                    let p = point(c.x - ux * flight_width * 0.5, c.y - uy * flight_width * 0.5);
                    let q = point(c.x + ux * flight_width * 0.5, c.y + uy * flight_width * 0.5);
                    let space = quad([
                        p,
                        q,
                        point(q.x + uy * run, q.y - ux * run),
                        point(p.x + uy * run, p.y - ux * run),
                    ]);
                    if area(&difference(&space, &unit.lot)) > 0.001
                        || area(&intersection(&space, &blocked)) > 0.001
                    {
                        continue;
                    }
                    let landing = end_band(
                        [p, q],
                        [
                            point(p.x + uy * run, p.y - ux * run),
                            point(q.x + uy * run, q.y - ux * run),
                        ],
                        0.35,
                    );
                    let low = end_band(
                        [
                            point(p.x + uy * run, p.y - ux * run),
                            point(q.x + uy * run, q.y - ux * run),
                        ],
                        [p, q],
                        0.35,
                    );
                    let Some(g) = ground
                        .iter()
                        .find(|g| area(&intersection(&g.floor, &low)) >= 0.27)
                    else {
                        continue;
                    };
                    let rooms: Vec<_> = unit
                        .rooms
                        .iter()
                        .filter(|r| r.body_id == body.id && r.level == 0)
                        .cloned()
                        .collect();
                    let Some((room, opening, passage)) = rooms.iter().find_map(|r| {
                        let forb: Vec<_> = unit
                            .rooms
                            .iter()
                            .filter(|other| other.id != r.id && (other.z_m - z).abs() < 0.001)
                            .map(|r| r.floor.clone())
                            .collect();
                        candidate(
                            &landing,
                            &r.floor,
                            door_width,
                            body.wall_thickness_m + 0.3,
                            &forb,
                        )
                        .map(|(o, p)| (r.clone(), o, p))
                    }) else {
                        continue;
                    };
                    if z > 0.0 {
                        supported_landing(unit, &landing, z);
                    } else {
                        trim_walk_plane(unit, 0.0, &difference(&space, &low));
                        trench(unit, &space, z);
                    }
                    let id = node(unit, AccessKind::StairLanding, landing, z);
                    let f = interface(unit, FeatureKind::Stair, space.clone(), z, 0.0);
                    portal(
                        unit,
                        &id,
                        &g.id,
                        PortalKind::Stair,
                        [p, q],
                        space,
                        flight_width,
                        vec![f],
                    )?;
                    portal_with_profile(
                        unit,
                        &id,
                        &room.access_node,
                        PortalKind::Door,
                        opening,
                        passage,
                        profile.as_ref().map_or(0.85, |spec| spec.width_m),
                        vec![],
                        profile.as_ref(),
                    )?;
                    done = true;
                    break;
                }
                if done {
                    break;
                }
            }
            if done {
                break;
            }
        }
        if !done {
            return Err(format!(
                "{} : dénivelé {z} m, escalier extérieur requis 0.9 × {run} m ; emprises bâties, appuis ou contexte ne laissent aucun palier et seuil libres.",
                body.id
            ));
        }
    }
    Ok(())
}

#[cfg(test)]
#[path = "access/batches25_tests.rs"]
mod batches25_tests;

#[cfg(test)]
mod fixture_json_exact;
