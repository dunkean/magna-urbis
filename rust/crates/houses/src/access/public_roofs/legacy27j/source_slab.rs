//! Closed native roof checks for each material element of an outboard route.
use super::*;

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
    let occupation = super::super::native_link_occupation(unit, node)?;
    if area(&intersection(cut, &occupation)) > AREA_EPS {
        return Err("Legacy27j: coplanar cut enters the native flight occupation".into());
    }
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
