//! Closed native roof checks for each material element of an outboard route.
use super::*;
use geo::TriangulateEarcut;

fn vertices(unit: &HouseUnit, face: &RoofFace) -> Result<Vec<Vertex3>, String> {
    face.vertices
        .iter()
        .map(|&i| {
            unit.roofs
                .vertices
                .get(i as usize)
                .cloned()
                .ok_or_else(|| "Cadre public : indice de toiture invalide.".into())
        })
        .collect()
}

fn projection(vertices: &[Vertex3]) -> Surface {
    vec![Polygon {
        outer: vertices.iter().map(|v| Point { x: v.x, y: v.y }).collect(),
        holes: vec![],
    }]
}

/// A coplanar terminal is an actual native slab of this access node.
pub(super) fn terminal_slab(
    unit: &HouseUnit,
    face: &RoofFace,
    node: &AccessNode,
    cut: &Surface,
) -> Result<bool, String> {
    crate::access::native_roof_walk_component(unit, node)?;
    if face.kind != RoofFaceKind::Slab || face.feature_id.is_some() {
        return Ok(false);
    }
    let bodies: Vec<_> = unit
        .bodies
        .iter()
        .filter(|b| b.id == face.body_id)
        .collect();
    if bodies.len() != 1 {
        return Ok(false);
    }
    let body = bodies[0];
    let levels: Vec<_> = body
        .levels
        .iter()
        .filter(|l| l.index == face.level)
        .collect();
    if levels.len() != 1 || face.component_id != body.component_id {
        return Ok(false);
    }
    let level = levels[0];
    let Some(slab) = &level.roof_slab else {
        return Ok(false);
    };
    let top = body
        .levels
        .iter()
        .max_by_key(|l| l.index)
        .is_some_and(|l| l.index == level.index);
    let expected_group = format!(
        "{}:{}:{}",
        body.id,
        level.index,
        if top { "main" } else { "intermediate" }
    );
    let groups: Vec<_> = unit
        .roofs
        .groups
        .iter()
        .filter(|g| g.id == expected_group)
        .collect();
    if !slab.walkable
        || libm::round(slab.z_m * 1000.0) as i64 != libm::round(node.z_m * 1000.0) as i64
        || face.roof_group != expected_group
        || groups.len() != 1
        || groups[0].body_id != body.id
        || groups[0].level != level.index
        || groups[0].feature_id.is_some()
        || groups[0].rf != face.rf
    {
        return Ok(false);
    }
    Ok(area(&difference(
        &projection(&vertices(unit, face)?),
        &groups[0].domain,
    )) <= AREA_EPS
        && area(&difference(cut, &intersection(&slab.surface, &node.floor))) <= AREA_EPS)
}

fn triangles(surface: &Surface) -> Result<Vec<Surface>, String> {
    let mut result = vec![];
    let mut total = 0.0;
    for polygon in to_geo(surface).0 {
        for triangle in polygon.earcut_triangles() {
            let mut points = triangle
                .to_array()
                .iter()
                .map(|c| Point { x: c.x, y: c.y })
                .collect::<Vec<_>>();
            let signed = signed_area(&points);
            if !signed.is_finite() || signed == 0.0 {
                return Err("Cadre public : triangle de sol dégénéré.".into());
            }
            if signed < 0.0 {
                points.reverse();
            }
            total += signed.abs();
            result.push(vec![Polygon {
                outer: points,
                holes: vec![],
            }]);
        }
    }
    if result.is_empty() || (total - area(surface)).abs() > AREA_EPS {
        return Err("Cadre public : triangulation sans couverture du sol natif.".into());
    }
    Ok(result)
}

pub(super) fn prism(
    unit: &HouseUnit,
    id: &str,
    surface: &Surface,
    z: f64,
    terminal: Option<&AccessNode>,
) -> Result<(), String> {
    for triangle in triangles(surface)? {
        for (i, face) in unit.roofs.faces.iter().enumerate() {
            let clipped = bridge::clip(&vertices(unit, face)?, &triangle)?;
            if clipped.is_empty() {
                continue;
            }
            let min = clipped.iter().map(|v| v.z).fold(f64::INFINITY, f64::min);
            let max = clipped
                .iter()
                .map(|v| v.z)
                .fold(f64::NEG_INFINITY, f64::max);
            if max <= z - 0.15 + CONTACT || min >= z + 2.05 - CONTACT {
                continue;
            }
            if let Some(node) = terminal
                && clipped.iter().all(|v| (v.z - z).abs() <= 1e-9)
                && terminal_slab(unit, face, node, &projection(&clipped))?
            {
                continue;
            }
            return Err(format!(
                "{} : prisme public dans toiture {} face {}.",
                id, face.roof_group, i
            ));
        }
    }
    Ok(())
}

#[cfg(test)]
#[path = "public_roof_route_roofs_tests.rs"]
mod tests;

pub(super) fn post(unit: &HouseUnit, f: &Feature) -> Result<(), String> {
    for (i, face) in unit.roofs.faces.iter().enumerate() {
        let clipped = bridge::clip(&vertices(unit, face)?, &f.surface)?;
        if clipped.is_empty() {
            continue;
        }
        let min = clipped.iter().map(|v| v.z).fold(f64::INFINITY, f64::min);
        let max = clipped
            .iter()
            .map(|v| v.z)
            .fold(f64::NEG_INFINITY, f64::max);
        if max > f.z_m + CONTACT && min < f.z_m + f.height_m - CONTACT {
            return Err(format!(
                "{} : poteau public dans toiture {} face {}.",
                f.id, face.roof_group, i
            ));
        }
    }
    Ok(())
}

pub(super) fn flight(unit: &HouseUnit, f: &Feature) -> Result<(), String> {
    if f.vertices3d.len() != 4 {
        return Err("Cadre public : volée sans plan natif.".into());
    }
    for (i, face) in unit.roofs.faces.iter().enumerate() {
        let clipped = bridge::clip(&vertices(unit, face)?, &f.surface)?;
        if clipped.is_empty() {
            continue;
        }
        let (min, max) = clipped
            .iter()
            .map(|v| v.z - plane_z(f, Point { x: v.x, y: v.y }))
            .fold((f64::INFINITY, f64::NEG_INFINITY), |(a, b), z| {
                (a.min(z), b.max(z))
            });
        if max > -0.15 + CONTACT && min < 2.05 - CONTACT {
            return Err(format!(
                "{} : volée publique dans toiture {} face {}.",
                f.id, face.roof_group, i
            ));
        }
    }
    Ok(())
}

pub(super) fn validate(unit: &HouseUnit) -> Result<(), String> {
    for head in unit.features.iter().filter(|f| {
        f.kind == FeatureKind::Landing
            && (f.id.ends_with(":outboard:landing:3")
                || f.id.ends_with(":outboard-eaves:landing:3"))
    }) {
        if !outboard::external(outboard::mode(unit, head)?) {
            return Err("Cadre public : tête sans chaîne outboard.".into());
        }
        let key = head.id.strip_suffix(":landing:3").unwrap();
        let (centres, u, w, _) = bridge::bearings(unit, head)?;
        let origin = point(
            centres[0].x - w.x * 2.1 + u.x * outboard::ROW_OFFSET,
            centres[0].y - w.y * 2.1 + u.y * outboard::ROW_OFFSET,
        );
        let distance = -rings(&head.surface)
            .flatten()
            .map(|p| (p.x - origin.x) * u.x + (p.y - origin.y) * u.y)
            .fold(f64::INFINITY, f64::min);
        let frame = Frame {
            origin,
            tangent: w,
            outward: u,
            distance,
        };
        let final_node =
            bridge::landing_node(unit, head).ok_or("Cadre public : nœud final absent.")?;
        let arrivals: Vec<_> = unit
            .access
            .portals
            .iter()
            .filter(|p| p.from == final_node.id && p.kind == PortalKind::Passage)
            .collect();
        if arrivals.len() != 1 {
            return Err("Cadre public : Passage final ambigu.".into());
        }
        let p = arrivals[0];
        let limit = (distance + 0.2).min(DEPTH);
        let passage_part = frame.rect(1.4, -distance, 0.85, distance + limit);
        let mut outside = vec![Polygon {
            outer: [
                (1.3, 0.9),
                (1.4, 0.9),
                (1.4, limit),
                (2.25, limit),
                (2.25, 1.9),
                (1.3, 1.9),
            ]
            .into_iter()
            .map(|(x, y)| frame.at(x, y))
            .collect(),
            holes: vec![],
        }];
        if signed_area(&outside[0].outer) < 0.0 {
            outside[0].outer.reverse();
        }
        outside.extend(frame.rect(1.89, DEPTH, 0.28, outboard::SHIFT));
        if area(&difference(&head.surface, &union(&passage_part, &outside))) > AREA_EPS
            || area(&difference(&union(&passage_part, &outside), &head.surface)) > AREA_EPS
            || area(&intersection(&passage_part, &outside)) > AREA_EPS
            || area(&difference(&passage_part, &p.passage)) > AREA_EPS
        {
            return Err("Cadre public : partage du palier final sans couverture native.".into());
        }
        bridge::validate(unit, p, true)?;
        prism(
            unit,
            &format!("{}:hors-passage", head.id),
            &outside,
            head.z_m,
            None,
        )?;
        for (j, surface) in [
            frame.rect(1.89, -outboard::SHIFT, 0.28, outboard::SHIFT),
            frame.rect(1.89, DEPTH, 0.28, outboard::SHIFT),
        ]
        .into_iter()
        .enumerate()
        {
            prism(
                unit,
                &format!("{}:tete:{}", head.id, j),
                &surface,
                head.z_m,
                None,
            )?;
        }
        for index in 0..4 {
            let id = format!("{key}:landing:{index}");
            let slabs: Vec<_> = unit
                .features
                .iter()
                .filter(|f| f.id == id && f.kind == FeatureKind::Landing)
                .collect();
            if slabs.len() != 1 || (slabs[0].height_m - 0.15).abs() > 1e-9 {
                return Err("Cadre public : palier sans dalle native de0.15m.".into());
            }
            let slab = slabs[0];
            let node =
                bridge::landing_node(unit, slab).ok_or("Cadre public : nœud de palier absent.")?;
            if index == 0 {
                let departures: Vec<_> = unit
                    .access
                    .portals
                    .iter()
                    .filter(|p| p.to == node.id && p.kind == PortalKind::Passage)
                    .collect();
                if departures.len() != 1 {
                    return Err("Cadre public : départ ambigu.".into());
                }
                let base = unit
                    .access
                    .nodes
                    .iter()
                    .find(|n| n.id == departures[0].from)
                    .ok_or("Cadre public : base absente.")?;
                if !public_reachable(unit).contains(&base.id)
                    || area(&difference(&slab.surface, &base.floor)) > AREA_EPS
                {
                    return Err("Cadre public : dalle de départ sans sol public entier.".into());
                }
                prism(unit, &slab.id, &slab.surface, slab.z_m, Some(base))?;
            } else {
                let posts: Vec<_> = unit
                    .features
                    .iter()
                    .filter(|f| {
                        f.id.starts_with(&format!("{}:post:", slab.id))
                            && f.kind == FeatureKind::Post
                    })
                    .collect();
                if posts.len() != 4 {
                    return Err("Cadre public : palier sans quatre poteaux natifs.".into());
                }
                for f in posts {
                    post(unit, f)?;
                }
                if index != 3 {
                    prism(unit, &slab.id, &slab.surface, slab.z_m, None)?;
                }
            }
        }
        for index in 0..3 {
            let id = format!("{key}:flight:{index}");
            let f = unit
                .features
                .iter()
                .find(|f| f.id == id)
                .ok_or("Cadre public : volée absente.")?;
            flight(unit, f)?;
        }
    }
    Ok(())
}
