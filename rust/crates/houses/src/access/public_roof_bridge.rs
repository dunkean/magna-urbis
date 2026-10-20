//! Continuous terminal floors, with declared stylized timber bearing limits.
use super::*;
use geo::kernels::{Kernel, Orientation, RobustKernel};
use geo::{Intersects, LineString};
use std::collections::BTreeMap;

pub(super) const TRANSVERSE_MAX: f64 = 0.5;
const LONGITUDINAL_MAX: f64 = 0.66;
pub(super) const DISTANCE_MAX: f64 = TRANSVERSE_MAX - 0.1;

fn polygon(mut points: Vec<Point>) -> Surface {
    if signed_area(&points) < 0.0 {
        points.reverse();
    }
    vec![Polygon {
        outer: points,
        holes: vec![],
    }]
}

pub(super) fn floor(frame: Frame, odd: bool) -> Surface {
    let d = frame.distance;
    let points = if odd {
        [
            (1.3, 0.9),
            (1.4, 0.9),
            (1.4, -d),
            (2.25, -d),
            (2.25, 1.9),
            (1.3, 1.9),
        ]
    } else {
        [
            (0.0, -d),
            (0.9, -d),
            (0.9, 1.0),
            (0.8, 1.0),
            (0.8, 1.9),
            (0.0, 1.9),
        ]
    };
    polygon(points.into_iter().map(|(x, y)| frame.at(x, y)).collect())
}

pub(super) fn passage(frame: Frame, odd: bool) -> ([Point; 2], Surface) {
    let x = if odd { 1.4 } else { 0.025 };
    let opening = [frame.at(x, 0.0), frame.at(x + 0.85, 0.0)];
    (
        opening,
        frame.rect(x, -frame.distance - 0.2, 0.85, 2.0 * (frame.distance + 0.2)),
    )
}

pub(super) fn additions(frame: Frame, odd: bool) -> Surface {
    let mut parts = if odd {
        frame.rect(1.4, -frame.distance, 0.85, frame.distance)
    } else {
        frame.rect(0.0, -frame.distance, PAD, frame.distance)
    };
    if odd {
        parts.extend(frame.rect(2.2, 0.0, 0.05, DEPTH));
    }
    parts
}

pub(super) fn admissible(
    unit: &HouseUnit,
    target: &AccessNode,
    frame: Frame,
    odd: bool,
    floor: &Surface,
    passage: &Surface,
) -> bool {
    let added = additions(frame, odd);
    floor.len() == 1
        && frame.distance + 0.1 <= TRANSVERSE_MAX + 1e-9
        && area(&difference(floor, &unit.lot)) <= AREA_EPS
        && area(&difference(passage, &union(floor, &target.floor))) <= AREA_EPS
        && clear(unit, &added, target.z_m, None, None, None)
        && clear(unit, passage, target.z_m, None, None, None)
}

pub(super) fn blocks_feature(kind: FeatureKind) -> bool {
    matches!(
        kind,
        FeatureKind::Neighbor
            | FeatureKind::RockFace
            | FeatureKind::Post
            | FeatureKind::Pier
            | FeatureKind::DecorativeWall
            | FeatureKind::Parapet
            | FeatureKind::Enclosure
            | FeatureKind::Fence
            | FeatureKind::Beam
            | FeatureKind::Frame
            | FeatureKind::RoofDrum
            | FeatureKind::RoofPavilion
            | FeatureKind::RoofDrain
            | FeatureKind::Drain
            | FeatureKind::Flue
            | FeatureKind::Windcatcher
    )
}

pub(super) fn admissible_outboard(
    unit: &HouseUnit,
    target: &AccessNode,
    frame: Frame,
    floor: &Surface,
    passage: &Surface,
    heads: &Surface,
) -> bool {
    admissible_external(
        unit,
        target,
        frame,
        floor,
        passage,
        heads,
        outboard::BearingMode::Outboard,
    )
}

pub(super) fn admissible_eaves(
    unit: &HouseUnit,
    target: &AccessNode,
    frame: Frame,
    floor: &Surface,
    passage: &Surface,
    heads: &Surface,
) -> bool {
    admissible_external(
        unit,
        target,
        frame,
        floor,
        passage,
        heads,
        outboard::BearingMode::OutboardEaves,
    )
}

#[allow(clippy::too_many_arguments)]
pub(super) fn admissible_external(
    unit: &HouseUnit,
    target: &AccessNode,
    frame: Frame,
    floor: &Surface,
    passage: &Surface,
    heads: &Surface,
    mode: outboard::BearingMode,
) -> bool {
    let (distance_max, front_max) = if matches!(
        mode,
        outboard::BearingMode::OutboardEaves | outboard::BearingMode::OutboardTwoFlight
    ) {
        (TRANSVERSE_MAX + outboard::ROW_OFFSET, TRANSVERSE_MAX)
    } else {
        (outboard::DISTANCE_MAX, outboard::FRONT_MAX)
    };
    floor.len() == 1
        && frame.distance <= distance_max + 1e-9
        && frame.distance - outboard::ROW_OFFSET <= front_max + 1e-9
        && area(&difference(floor, &unit.lot)) <= AREA_EPS
        && area(&difference(passage, &union(floor, &target.floor))) <= AREA_EPS
        && !unit
            .rooms
            .iter()
            .any(|r| area(&intersection(heads, &r.floor)) > AREA_EPS)
        && !unit
            .access
            .nodes
            .iter()
            .any(|n| n.household_id.is_some() && area(&intersection(heads, &n.floor)) > AREA_EPS)
        && clear(
            unit,
            &if mode == outboard::BearingMode::OutboardTwoFlight {
                twoflight::additions(frame)
            } else {
                additions(frame, true)
            },
            target.z_m,
            None,
            None,
            None,
        )
        && clear(unit, heads, target.z_m, None, None, None)
        && clear(unit, passage, target.z_m, None, None, None)
}

fn intersects_height(min: f64, max: f64, floor: f64) -> bool {
    max > floor - 0.15 + CONTACT && min < floor + 2.05 - CONTACT
}

fn clear(
    unit: &HouseUnit,
    plan: &Surface,
    z: f64,
    landing_id: Option<&str>,
    incoming: Option<&Feature>,
    outgoing: Option<&Feature>,
) -> bool {
    if unit.bodies.iter().any(|b| {
        b.levels.iter().any(|l| {
            l.z_m + l.height_m > z + CONTACT
                && l.z_m < z + 2.05 - CONTACT
                && area(&intersection(plan, &l.footprint)) > AREA_EPS
        })
    }) || unit.walls.iter().any(|w| {
        w.z_m + w.height_m > z + CONTACT
            && w.z_m < z + 2.05 - CONTACT
            && area(&intersection(plan, &w.footprint)) > AREA_EPS
    }) {
        return false;
    }
    for f in unit.features.iter().chain(&unit.site_context) {
        if landing_id == Some(f.id.as_str()) {
            continue;
        }
        let mut overlap = intersection(plan, &f.surface);
        if area(&overlap) <= AREA_EPS {
            continue;
        }
        if matches!(f.kind, FeatureKind::Stair | FeatureKind::Ladder) && f.vertices3d.len() == 4 {
            if incoming.is_some_and(|own| own.id == f.id)
                || outgoing.is_some_and(|own| own.id == f.id)
            {
                let v = &f.vertices3d;
                let (a, b, c, d) = if incoming.is_some_and(|own| own.id == f.id) {
                    (3, 2, 0, 1)
                } else {
                    (0, 1, 3, 2)
                };
                overlap = difference(
                    &overlap,
                    &end_band(
                        [point(v[a].x, v[a].y), point(v[b].x, v[b].y)],
                        [point(v[c].x, v[c].y), point(v[d].x, v[d].y)],
                        0.35,
                    ),
                );
                if area(&overlap) <= AREA_EPS {
                    continue;
                }
            }
            let (min, max) = rings(&overlap)
                .flatten()
                .map(|p| plane_z(f, *p))
                .fold((f64::INFINITY, f64::NEG_INFINITY), |(a, b), h| {
                    (a.min(h), b.max(h))
                });
            if intersects_height(min, max, z) {
                return false;
            }
        } else if f.kind == FeatureKind::Landing {
            if (f.z_m - z).abs() < CONTACT
                && landing_id
                    .and_then(|id| unit.features.iter().find(|own| own.id == id))
                    .is_some_and(|own| landings_connected(unit, own, f))
            {
                continue;
            }
            // Also keep the headroom of an already public lower landing.
            if f.z_m > z - 2.20 + CONTACT && f.z_m < z + 2.20 - CONTACT {
                return false;
            }
        } else if blocks_feature(f.kind)
            && f.z_m + f.height_m > z + CONTACT
            && f.z_m < z + 2.05 - CONTACT
        {
            return false;
        }
    }
    true
}

pub(super) fn distances(
    unit: &HouseUnit,
    base: &AccessNode,
    frame: Frame,
    edge: Point,
) -> Vec<f64> {
    let plan = frame.rect(0.0, 0.0, RUN + PAD, DEPTH);
    let mut candidates = vec![];
    let mut add = |surface: &Surface| {
        if area(&intersection(&plan, surface)) <= AREA_EPS {
            return;
        }
        let projection = rings(surface)
            .flatten()
            .map(|p| (p.x - edge.x) * frame.outward.x + (p.y - edge.y) * frame.outward.y)
            .fold(f64::NEG_INFINITY, f64::max);
        let distance = libm::ceil((projection + GAP) / GRID_M) * GRID_M;
        if distance > GAP + 1e-9 && distance <= DISTANCE_MAX + 1e-9 {
            candidates.push(distance);
        }
    };
    for b in &unit.bodies {
        for l in &b.levels {
            if l.z_m + l.height_m > base.z_m + CONTACT {
                add(&l.footprint);
            }
        }
    }
    for w in &unit.walls {
        if w.z_m + w.height_m > base.z_m + CONTACT {
            add(&w.footprint);
        }
    }
    for f in unit.features.iter().chain(&unit.site_context) {
        if (matches!(
            f.kind,
            FeatureKind::Neighbor
                | FeatureKind::RockFace
                | FeatureKind::Post
                | FeatureKind::Pier
                | FeatureKind::Stair
                | FeatureKind::Ladder
        ) && f.z_m + f.height_m > base.z_m + CONTACT)
            || (f.kind == FeatureKind::Water && base.z_m <= CONTACT)
        {
            add(&f.surface);
        }
    }
    for p in &base.floor {
        for hole in &p.holes {
            add(&polygon(hole.clone()));
        }
    }
    candidates.sort_by(f64::total_cmp);
    candidates.dedup_by(|a, b| (*a - *b).abs() < 1e-9);
    candidates
}

/// Clip native XYZ vertices directly against the convex passage. In
/// particular, extrema of a roof slope occur on the clipped polygon, rather
/// than only at the original roof vertices.
pub(super) fn clip(face: &[Vertex3], passage: &Surface) -> Result<Vec<Vertex3>, String> {
    let mut out = face.to_vec();
    let ring = &passage[0].outer;
    for (&a, &b) in ring
        .iter()
        .zip(ring.iter().cycle().skip(1))
        .take(ring.len())
    {
        let cross = |p: &Vertex3| (b.x - a.x) * (p.y - a.y) - (b.y - a.y) * (p.x - a.x);
        let orientation = |p: &Vertex3| {
            RobustKernel::orient2d(
                geo::Coord { x: a.x, y: a.y },
                geo::Coord { x: b.x, y: b.y },
                geo::Coord { x: p.x, y: p.y },
            )
        };
        let old = std::mem::take(&mut out);
        if old.is_empty() {
            break;
        }
        for (p, q) in old.iter().zip(old.iter().cycle().skip(1)).take(old.len()) {
            let (cp, cq) = (cross(p), cross(q));
            let (op, oq) = (orientation(p), orientation(q));
            let (ip, iq) = (op != Orientation::Clockwise, oq != Orientation::Clockwise);
            if ip {
                out.push(p.clone());
            }
            if ip != iq {
                if (cp == 0.0 && op != Orientation::Collinear)
                    || (cq == 0.0 && oq != Orientation::Collinear)
                {
                    return Err(
                        "Pont de palier : intersection de toiture hors précision affine.".into(),
                    );
                }
                let t = cp / (cp - cq);
                if !t.is_finite() {
                    return Err("Pont de palier : intersection de toiture indéterminée.".into());
                }
                out.push(Vertex3 {
                    x: p.x + t * (q.x - p.x),
                    y: p.y + t * (q.y - p.y),
                    z: p.z + t * (q.z - p.z),
                });
            }
        }
    }
    Ok(out)
}

fn roof_clear(
    unit: &HouseUnit,
    portal: &Portal,
    target_part: &Surface,
    z: f64,
    native_target: Option<&AccessNode>,
) -> Result<(), String> {
    let passage = &portal.passage;
    let mut supports = vec![];
    let mut jambs = BTreeMap::new();
    for (face_index, face) in unit.roofs.faces.iter().enumerate() {
        let vertices: Vec<_> = face
            .vertices
            .iter()
            .map(|&i| {
                unit.roofs
                    .vertices
                    .get(i as usize)
                    .cloned()
                    .ok_or("Pont de palier : indice de toiture invalide.")
            })
            .collect::<Result<_, _>>()?;
        if face.normal[2].abs() < 1e-6 {
            let (min, max) = vertices
                .iter()
                .map(|p| p.z)
                .fold((f64::INFINITY, f64::NEG_INFINITY), |(a, b), h| {
                    (a.min(h), b.max(h))
                });
            if max <= z + CONTACT || !intersects_height(min, max, z) {
                continue;
            }
            for (edge, (a, b)) in vertices
                .iter()
                .zip(vertices.iter().cycle().skip(1))
                .take(vertices.len())
                .enumerate()
            {
                let line = LineString::from(vec![(a.x, a.y), (b.x, b.y)]);
                if !to_geo(passage).intersects(&line) {
                    continue;
                }
                if face.kind != RoofFaceKind::Parapet {
                    return Err("Pont de palier dans un parapet ou une rive verticale.".into());
                }
                if !jambs.contains_key(&face.roof_group) {
                    let certificate = crate::roofs::parapet_jamb_edges(
                        unit,
                        portal,
                        target_part,
                        z,
                        &face.roof_group,
                    )
                    .map_err(|e| format!("Pont de palier dans un parapet non certifié : {e}"))?;
                    jambs.insert(face.roof_group.clone(), certificate);
                }
                if !jambs[&face.roof_group].contains(&(face_index, edge)) {
                    return Err("Pont de palier dans un parapet ou une rive verticale.".into());
                }
            }
            continue;
        }
        let overlap = clip(&vertices, passage)?;
        if overlap.len() < 3 {
            continue;
        }
        let projection = polygon(overlap.iter().map(|p| Point { x: p.x, y: p.y }).collect());
        if !(1..overlap.len() - 1).any(|i| {
            RobustKernel::orient2d(
                geo::Coord {
                    x: overlap[0].x,
                    y: overlap[0].y,
                },
                geo::Coord {
                    x: overlap[i].x,
                    y: overlap[i].y,
                },
                geo::Coord {
                    x: overlap[i + 1].x,
                    y: overlap[i + 1].y,
                },
            ) != Orientation::Collinear
        }) {
            continue;
        }
        if face.kind == RoofFaceKind::Slab && overlap.iter().all(|p| (p.z - z).abs() <= 1e-9) {
            if let Some(target) = native_target
                && !route_roofs::terminal_slab(unit, face, target, &projection)?
            {
                return Err("Cadre outboard : dalle coplanaire sans terrasse native cible.".into());
            }
            supports.push(projection);
            continue;
        }
        let (min, max) = overlap
            .iter()
            .map(|p| p.z)
            .fold((f64::INFINITY, f64::NEG_INFINITY), |(a, b), h| {
                (a.min(h), b.max(h))
            });
        if intersects_height(min, max, z) {
            return Err("Pont de palier dans une pente ou un débord de toiture.".into());
        }
    }
    if area(&difference(target_part, &unite(&supports))) > AREA_EPS {
        return Err("Pont de palier sans dalle structurelle coplanaire côté terrasse.".into());
    }
    Ok(())
}

pub(super) fn bearings(
    unit: &HouseUnit,
    slab: &Feature,
) -> Result<(Vec<Point>, Point, Point, outboard::BearingMode), String> {
    let mode = outboard::mode(unit, slab)?;
    let spacing = if outboard::external(mode) {
        outboard::ROW_SPAN
    } else {
        1.7
    };
    let centres: Vec<_> = (0..4)
        .map(|i| {
            unit.features
                .iter()
                .find(|f| f.kind == FeatureKind::Post && f.id == format!("{}:post:{i}", slab.id))
                .map(|p| center(&p.surface))
                .ok_or("Pont de palier sans quatre appuis.")
        })
        .collect::<Result<_, _>>()?;
    let u = Point {
        x: (centres[2].x - centres[0].x) / spacing,
        y: (centres[2].y - centres[0].y) / spacing,
    };
    let w = Point {
        x: (centres[0].x - centres[1].x) / 0.14,
        y: (centres[0].y - centres[1].y) / 0.14,
    };
    let norm = |a: Point| libm::hypot(a.x, a.y);
    let other = Point {
        x: (centres[3].x - centres[1].x) / spacing,
        y: (centres[3].y - centres[1].y) / spacing,
    };
    if (norm(u) - 1.0).abs() > CONTACT
        || (norm(w) - 1.0).abs() > CONTACT
        || (other.x - u.x).abs() + (other.y - u.y).abs() > CONTACT
        || (u.x * w.x + u.y * w.y).abs() > CONTACT
    {
        return Err("Pont de palier : axes des quatre appuis invalides.".into());
    }
    for p in rings(&slab.surface).flatten() {
        let transverse = (centres[0].x - p.x) * u.x + (centres[0].y - p.y) * u.y;
        let outer = (p.x - centres[0].x) * w.x + (p.y - centres[0].y) * w.y;
        let inner = (centres[1].x - p.x) * w.x + (centres[1].y - p.y) * w.y;
        let forward_max = if outboard::external(mode) {
            if matches!(
                mode,
                outboard::BearingMode::OutboardEaves | outboard::BearingMode::OutboardTwoFlight
            ) {
                TRANSVERSE_MAX
            } else {
                outboard::FRONT_MAX
            }
        } else {
            TRANSVERSE_MAX
        };
        let back = (p.x - centres[2].x) * u.x + (p.y - centres[2].y) * u.y;
        if transverse > forward_max + 1e-9
            || (outboard::external(mode) && back > outboard::BACK_MAX + 1e-9)
            || outer > LONGITUDINAL_MAX + 1e-9
            || inner > LONGITUDINAL_MAX + 1e-9
        {
            return Err("Pont de palier hors portée structurelle déclarée.".into());
        }
    }
    if outboard::external(mode) {
        let node = landing_node(unit, slab).ok_or("Cadre outboard sans nœud final.")?;
        let portal = unit
            .access
            .portals
            .iter()
            .find(|p| p.from == node.id && p.kind == PortalKind::Passage)
            .ok_or("Cadre outboard sans ouverture finale.")?;
        let front = Point {
            x: centres[0].x + u.x * outboard::ROW_OFFSET,
            y: centres[0].y + u.y * outboard::ROW_OFFSET,
        };
        let target = unit
            .access
            .nodes
            .iter()
            .find(|n| n.id == portal.to)
            .ok_or("Cadre outboard sans terrasse.")?;
        let contact = intersection(&portal.passage, &target.floor);
        let distance = rings(&contact)
            .flatten()
            .map(|p| (front.x - p.x) * u.x + (front.y - p.y) * u.y)
            .fold(f64::INFINITY, f64::min);
        if !distance.is_finite()
            || distance
                > (if matches!(
                    mode,
                    outboard::BearingMode::OutboardEaves | outboard::BearingMode::OutboardTwoFlight
                ) {
                    TRANSVERSE_MAX + outboard::ROW_OFFSET
                } else {
                    outboard::DISTANCE_MAX
                }) + 1e-9
        {
            return Err("Cadre outboard au-delà de la distance déclarée de son mode.".into());
        }
    }
    Ok((centres, u, w, mode))
}

pub(super) fn landing_node<'a>(unit: &'a HouseUnit, slab: &Feature) -> Option<&'a AccessNode> {
    let matches = |n: &&AccessNode| {
        n.kind == AccessKind::StairLanding
            && (n.z_m - slab.z_m).abs() < 1e-9
            && area(&difference(&n.floor, &slab.surface))
                + area(&difference(&slab.surface, &n.floor))
                <= AREA_EPS
    };
    if let Some((key, index)) = slab.id.rsplit_once(":landing:")
        && let Ok(index) = index.parse::<usize>()
    {
        let flight = format!("{key}:flight:{}", index.saturating_sub(1));
        if let Some(p) = unit
            .access
            .portals
            .iter()
            .find(|p| p.feature_ids.contains(&flight))
        {
            let id = if index == 0 { &p.from } else { &p.to };
            return unit.access.nodes.iter().find(|n| &n.id == id && matches(n));
        }
    }
    unit.access.nodes.iter().find(matches)
}

fn landings_connected(unit: &HouseUnit, a: &Feature, b: &Feature) -> bool {
    landing_node(unit, a)
        .zip(landing_node(unit, b))
        .is_some_and(|(x, y)| {
            unit.access.portals.iter().any(|p| {
                p.kind == PortalKind::Passage
                    && ((p.from == x.id && p.to == y.id) || (p.from == y.id && p.to == x.id))
            })
        })
}

fn flight_at<'a>(unit: &'a HouseUnit, node: &AccessNode, incoming: bool) -> Option<&'a Feature> {
    unit.access
        .portals
        .iter()
        .find(|p| {
            matches!(p.kind, PortalKind::Ladder | PortalKind::Stair)
                && if incoming {
                    p.to == node.id
                } else {
                    p.from == node.id
                }
        })
        .and_then(|p| {
            p.feature_ids.iter().find_map(|id| {
                unit.features
                    .iter()
                    .find(|f| &f.id == id && f.vertices3d.len() == 4)
            })
        })
}

pub(super) fn validate_landings(unit: &HouseUnit) -> Result<(), String> {
    let landings: Vec<_> = unit
        .features
        .iter()
        .filter(|f| f.kind == FeatureKind::Landing)
        .collect();
    for (i, a) in landings.iter().enumerate() {
        for b in &landings[i + 1..] {
            if !(a.id.contains(":public-roof:") || b.id.contains(":public-roof:"))
                || area(&intersection(&a.surface, &b.surface)) <= AREA_EPS
            {
                continue;
            }
            let dz = (a.z_m - b.z_m).abs();
            let connected = landings_connected(unit, a, b);
            if dz < 2.20 - CONTACT && !(dz < CONTACT && connected) {
                return Err(format!(
                    "Paliers publics {} / {} sans hauteur libre de 2,05 m sous dalle.",
                    a.id, b.id
                ));
            }
        }
    }
    for slab in landings
        .into_iter()
        .filter(|f| f.id.contains(":public-roof:") && !f.id.ends_with(":landing:0"))
    {
        let (centres, u, w, _) = bearings(unit, slab)?;
        let node =
            landing_node(unit, slab).ok_or("Palier public sans sol natif identique au nœud.")?;
        let Some(outgoing) = flight_at(unit, node, false) else {
            continue;
        };
        let incoming = flight_at(unit, node, true).ok_or("Retour public sans volée d'arrivée.")?;
        let at = |x: f64, y: f64| Point {
            x: centres[0].x + w.x * x + u.x * y,
            y: centres[0].y + w.y * x + u.y * y,
        };
        let route = quad([at(-0.7, -0.1), at(0.15, -0.1), at(0.15, 1.8), at(-0.7, 1.8)]);
        if area(&difference(&route, &node.floor)) > AREA_EPS
            || area(&difference(&route, &unit.lot)) > AREA_EPS
            || !clear(
                unit,
                &route,
                node.z_m,
                Some(&slab.id),
                Some(incoming),
                Some(outgoing),
            )
        {
            return Err(format!(
                "{} : retour public de 0,85 m non porté ou sans hauteur libre.",
                slab.id
            ));
        }
    }
    Ok(())
}

pub(super) fn validate(unit: &HouseUnit, portal: &Portal, check_roofs: bool) -> Result<(), String> {
    let landing = unit
        .access
        .nodes
        .iter()
        .find(|n| n.id == portal.from)
        .ok_or("Pont de palier sans nœud.")?;
    let target = unit
        .access
        .nodes
        .iter()
        .find(|n| n.id == portal.to)
        .ok_or("Pont de palier sans terrasse.")?;
    let id = portal
        .feature_ids
        .iter()
        .find(|id| id.contains(":public-roof:") && id.contains(":landing:"))
        .ok_or("Pont de palier sans dalle native.")?;
    let slab = unit
        .features
        .iter()
        .find(|f| &f.id == id && f.kind == FeatureKind::Landing)
        .ok_or("Pont de palier sans dalle native.")?;
    if area(&difference(&slab.surface, &landing.floor))
        + area(&difference(&landing.floor, &slab.surface))
        > AREA_EPS
        || (slab.z_m - target.z_m).abs() > 1e-9
        || area(&difference(
            &portal.passage,
            &union(&landing.floor, &target.floor),
        )) > AREA_EPS
    {
        return Err("Pont de palier non porté : dalle, nœud ou passage discontinus.".into());
    }
    let (centres, u, _, mode) = bearings(unit, slab)?;
    let front_offset = if outboard::external(mode) {
        -outboard::ROW_OFFSET
    } else {
        0.1
    };
    let origin = Point {
        x: centres[0].x - u.x * front_offset,
        y: centres[0].y - u.y * front_offset,
    };
    let project = |p: Point| (p.x - origin.x) * u.x + (p.y - origin.y) * u.y;
    if portal.opening.iter().any(|p| project(*p).abs() > CONTACT) {
        return Err("Pont de palier : ouverture hors arête frontale.".into());
    }
    let incoming = unit
        .access
        .portals
        .iter()
        .find(|p| matches!(p.kind, PortalKind::Stair | PortalKind::Ladder) && p.to == landing.id)
        .and_then(|p| {
            p.feature_ids
                .iter()
                .find_map(|id| unit.features.iter().find(|f| &f.id == id))
        });
    if !clear(
        unit,
        &portal.passage,
        target.z_m,
        Some(&slab.id),
        incoming,
        None,
    ) || area(&difference(&slab.surface, &unit.lot)) > AREA_EPS
    {
        return Err("Pont de palier dans un volume ou hors parcelle.".into());
    }
    if check_roofs {
        let target_part = intersection(&portal.passage, &target.floor);
        roof_clear(
            unit,
            portal,
            &target_part,
            target.z_m,
            (outboard::external(mode)).then_some(target),
        )?;
    }
    Ok(())
}

#[cfg(test)]
mod tests {
    use super::*;

    fn route(d: f64, z: f64) -> (HouseUnit, Frame, AccessNode, Portal) {
        route_with_stops(d, z, &[z])
    }

    fn route_with_stops(d: f64, z: f64, stops: &[f64]) -> (HouseUnit, Frame, AccessNode, Portal) {
        let mut unit = crate::access::batches25_tests::lower_corridor();
        unit.access.nodes.clear();
        unit.access.portals.clear();
        unit.features.clear();
        unit.walls.clear();
        let base = AccessNode {
            id: "base".into(),
            kind: AccessKind::Exterior,
            floor: rectangle(-3.0, 0.0, 10.0, 3.0),
            z_m: 0.0,
            household_id: None,
        };
        let target = AccessNode {
            id: "roof".into(),
            kind: AccessKind::Terrace,
            floor: rectangle(-3.0, -4.0, 10.0, 4.0 - d),
            z_m: z,
            household_id: None,
        };
        unit.access.root = base.id.clone();
        unit.access.nodes.extend([base.clone(), target.clone()]);
        let frame = Frame {
            origin: point(0.0, 0.0),
            tangent: point(1.0, 0.0),
            outward: point(0.0, 1.0),
            distance: d,
        };
        let odd = stops.len() % 2 == 1;
        let terminal = floor(frame, odd);
        let (opening, passage) = passage(frame, odd);
        assert!(admissible(&unit, &target, frame, odd, &terminal, &passage));
        install(
            &mut unit, &base, &target, frame, stops, opening, passage, terminal,
        )
        .unwrap();
        let portal = unit.access.portals.last().unwrap().clone();
        (unit, frame, target, portal)
    }

    #[test]
    fn odd_terminal_keeps_the_notch_and_has_a_full_width_continuous_passage() {
        for d in [GAP, 0.381] {
            let (unit, frame, _, p) = route(d, 2.8);
            validate(&unit, &p, false).unwrap();
            let landing = unit.access.nodes.iter().find(|n| n.id == p.from).unwrap();
            assert!(
                area(&intersection(
                    &landing.floor,
                    &frame.rect(1.3, 0.0, 0.1, 0.9)
                )) <= AREA_EPS
            );
            assert_eq!(
                unit.features
                    .iter()
                    .filter(|f| f.kind == FeatureKind::Post)
                    .count(),
                4
            );
            assert_eq!(
                unit.features
                    .iter()
                    .filter(|f| f.kind == FeatureKind::Ladder)
                    .count(),
                1
            );
            let mut broken = p.clone();
            broken.passage = frame.rect(1.399, -d - 0.2, 0.85, 2.0 * (d + 0.2));
            assert!(
                validate(&unit, &broken, false)
                    .unwrap_err()
                    .contains("non porté")
            );
            broken = p.clone();
            broken.opening[0].y = 0.01;
            assert!(
                validate(&unit, &broken, false)
                    .unwrap_err()
                    .contains("arête frontale")
            );
        }
    }

    #[test]
    fn bridge_refuses_an_obstacle_unborne_floor_and_excessive_bearing_span() {
        let (unit, frame, target, p) = route(0.381, 2.8);
        let beyond = Frame {
            distance: 0.401,
            ..frame
        };
        let (opening, passage) = passage(beyond, true);
        let _ = opening;
        assert!(!admissible(
            &unit,
            &target,
            beyond,
            true,
            &floor(beyond, true),
            &passage
        ));
        let mut blocked = unit.clone();
        blocked.site_context.push(feature(
            "neighbor-at-outer-extension",
            FeatureKind::Neighbor,
            rectangle(2.22, 0.5, 0.1, 0.1),
            2.8,
            3.0,
            "MAT-STONE-DRY",
        ));
        assert!(
            validate(&blocked, &p, false)
                .unwrap_err()
                .contains("dans un volume")
        );
        blocked = unit.clone();
        blocked.lot = rectangle(-3.0, -4.0, 5.2, 8.0);
        assert!(
            validate(&blocked, &p, false)
                .unwrap_err()
                .contains("hors parcelle")
        );
        blocked = unit.clone();
        let landing = blocked
            .access
            .nodes
            .iter_mut()
            .find(|n| n.id == p.from)
            .unwrap();
        landing.floor = frame.rect(1.3, 0.0, PAD, DEPTH);
        let slab = blocked
            .features
            .iter_mut()
            .find(|f| p.feature_ids.contains(&f.id))
            .unwrap();
        slab.surface = landing.floor.clone();
        assert!(
            validate(&blocked, &p, false)
                .unwrap_err()
                .contains("non porté")
        );
        blocked = unit.clone();
        let post = blocked
            .features
            .iter_mut()
            .find(|f| f.id.ends_with(":post:0"))
            .unwrap();
        post.surface = translate(&post.surface, 20.0, 0.0);
        assert!(super::super::validate(&blocked, false).is_err());
    }

    #[test]
    fn only_the_own_upper_terminal_can_meet_a_small_rise_bridge() {
        let (mut unit, _, _, p) = route(GAP, 0.1);
        validate(&unit, &p, false).unwrap();
        super::super::validate(&unit, false).unwrap();
        let mut other = unit
            .features
            .iter()
            .find(|f| f.kind == FeatureKind::Ladder)
            .unwrap()
            .clone();
        other.id = "other-ladder-in-terminal".into();
        unit.features.push(other);
        assert!(
            validate(&unit, &p, false)
                .unwrap_err()
                .contains("dans un volume")
        );
    }

    #[test]
    fn intermediate_returns_need_the_extension_and_full_headroom() {
        let (unit, frame, _, _) = route_with_stops(GAP, 5.6, &[2.8, 5.6]);
        super::super::validate(&unit, false).unwrap();
        let first_middle = unit
            .features
            .iter()
            .find(|f| f.id.ends_with(":landing:1"))
            .unwrap();
        assert!(
            area(&difference(
                &frame.rect(1.4, 0.0, 0.85, 1.9),
                &first_middle.surface
            )) <= AREA_EPS
        );
        let mut narrow = unit.clone();
        let id = first_middle.id.clone();
        let slab = narrow.features.iter_mut().find(|f| f.id == id).unwrap();
        slab.surface = difference(&slab.surface, &frame.rect(2.2, 0.0, 0.05, 1.9));
        let floor = slab.surface.clone();
        let n = narrow
            .access
            .nodes
            .iter_mut()
            .find(|n| (n.z_m - 2.8).abs() < 1e-9 && n.kind == AccessKind::StairLanding)
            .unwrap();
        n.floor = floor;
        assert!(
            super::super::validate(&narrow, false)
                .unwrap_err()
                .contains("retour public")
        );
        let (short, _, _, _) = route_with_stops(GAP, 3.25, &[2.8, 3.25]);
        super::super::validate(&short, false).unwrap();
        let (stacked, _, _, _) = route_with_stops(GAP, 1.35, &[0.45, 0.9, 1.35]);
        assert!(
            super::super::validate(&stacked, false)
                .unwrap_err()
                .contains("hauteur libre")
        );
        let (columns, _, _, _) = route_with_stops(GAP, 6.05, &[2.8, 5.6, 6.05]);
        assert!(
            super::super::validate(&columns, false)
                .unwrap_err()
                .contains("retour public")
        );
        assert!(super::super::stops(&unit, 0.0, 6.05, true).is_empty());
        let (mut low, _, _, _) = route(GAP, 2.8);
        let slab = low
            .features
            .iter()
            .find(|f| f.kind == FeatureKind::Landing && f.z_m > 2.0)
            .unwrap()
            .clone();
        for dz in [0.0, 2.1] {
            let mut overlap = slab.clone();
            overlap.id = "probe:public-roof:unlinked:landing:1".into();
            overlap.z_m += dz;
            low.features.push(overlap);
            assert!(
                super::super::validate(&low, false)
                    .unwrap_err()
                    .contains("hauteur libre")
            );
            low.features.pop();
        }
    }

    #[test]
    fn a_roof_slope_is_clipped_before_its_height_interval_is_tested() {
        let passage = rectangle(0.0, 0.0, 1.0, 1.0);
        let vertices = [
            Vertex3 {
                x: -2.0,
                y: 0.5,
                z: 0.0,
            },
            Vertex3 {
                x: 3.0,
                y: 0.0,
                z: 6.0,
            },
            Vertex3 {
                x: 3.0,
                y: 1.0,
                z: 6.0,
            },
        ];
        let clipped = clip(&vertices, &passage).unwrap();
        assert!(clipped.iter().any(|p| p.z > 2.0 && p.z < 4.0));
        assert!(vertices.iter().all(|p| p.z == 0.0 || p.z == 6.0));
    }

    fn add_face(
        unit: &mut HouseUnit,
        kind: RoofFaceKind,
        vertices: Vec<Vertex3>,
        normal: [f64; 3],
    ) {
        let start = unit.roofs.vertices.len() as u32;
        let indices = (start..start + vertices.len() as u32).collect();
        unit.roofs.vertices.extend(vertices);
        unit.roofs.faces.push(RoofFace {
            body_id: "roof-body".into(),
            feature_id: None,
            level: 0,
            kind,
            rf: "RF-FLAT".into(),
            roof_group: "roof".into(),
            component_id: None,
            vertices: indices,
            material: "MAT-STONE-DRY".into(),
            normal,
        });
    }

    #[test]
    fn the_mesh_must_supply_a_coplanar_slab_and_keep_the_contact_free() {
        let (mut unit, frame, target, p) = route(0.381, 2.8);
        assert!(
            validate(&unit, &p, true)
                .unwrap_err()
                .contains("sans dalle")
        );
        add_face(
            &mut unit,
            RoofFaceKind::Slab,
            target.floor[0]
                .outer
                .iter()
                .map(|p| Vertex3 {
                    x: p.x,
                    y: p.y,
                    z: target.z_m,
                })
                .collect(),
            [0.0, 0.0, 1.0],
        );
        validate(&unit, &p, true).unwrap();
        let mut blocked = unit.clone();
        let a = frame.at(1.4, -frame.distance);
        let b = frame.at(2.25, -frame.distance);
        add_face(
            &mut blocked,
            RoofFaceKind::Parapet,
            vec![
                Vertex3 {
                    x: a.x,
                    y: a.y,
                    z: 2.8,
                },
                Vertex3 {
                    x: b.x,
                    y: b.y,
                    z: 2.8,
                },
                Vertex3 {
                    x: b.x,
                    y: b.y,
                    z: 3.7,
                },
                Vertex3 {
                    x: a.x,
                    y: a.y,
                    z: 3.7,
                },
            ],
            [0.0, 1.0, 0.0],
        );
        assert!(
            validate(&blocked, &p, true)
                .unwrap_err()
                .contains("parapet")
        );
        blocked = unit.clone();
        blocked.roofs.faces[0].vertices[0] = u32::MAX;
        assert!(validate(&blocked, &p, true).unwrap_err().contains("indice"));
        blocked = unit.clone();
        add_face(
            &mut blocked,
            RoofFaceKind::Pan,
            vec![
                Vertex3 {
                    x: -2.0,
                    y: 0.5,
                    z: 0.0,
                },
                Vertex3 {
                    x: 3.0,
                    y: 0.0,
                    z: 6.0,
                },
                Vertex3 {
                    x: 3.0,
                    y: 1.0,
                    z: 6.0,
                },
            ],
            [-1.2, 0.0, 1.0],
        );
        assert!(validate(&blocked, &p, true).unwrap_err().contains("pente"));
        blocked = unit.clone();
        blocked.features.push(feature(
            "late-roof-turret",
            FeatureKind::RoofDrum,
            frame.rect(1.6, -0.1, 0.15, 0.15),
            2.8,
            1.0,
            "MAT-STONE-DRY",
        ));
        assert!(
            validate(&blocked, &p, true)
                .unwrap_err()
                .contains("dans un volume")
        );
    }

    #[test]
    fn a_short_roof_edge_and_a_longitudinal_overhang_do_not_gain_a_tolerance() {
        let (unit, frame, _, p) = route(GAP, 2.8);
        let mut shortened = unit.clone();
        shortened
            .access
            .nodes
            .iter_mut()
            .find(|n| n.id == p.to)
            .unwrap()
            .floor = rectangle(-3.0, -4.0, 5.2, 4.0 - GAP);
        assert!(
            validate(&shortened, &p, false)
                .unwrap_err()
                .contains("non porté")
        );
        let mut beyond = unit.clone();
        let landing = beyond
            .access
            .nodes
            .iter_mut()
            .find(|n| n.id == p.from)
            .unwrap();
        for q in &mut landing.floor[0].outer {
            if (q.x - frame.at(1.3, 0.0).x).abs() < 1e-9 {
                q.x -= 0.001;
            }
        }
        beyond
            .features
            .iter_mut()
            .find(|f| p.feature_ids.contains(&f.id))
            .unwrap()
            .surface = landing.floor.clone();
        assert!(
            validate(&beyond, &p, false)
                .unwrap_err()
                .contains("hors portée")
        );
        let mut untagged = unit.clone();
        untagged
            .access
            .portals
            .last_mut()
            .unwrap()
            .feature_ids
            .clear();
        assert!(super::super::validate(&untagged, false).is_err());
    }
}
