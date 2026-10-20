//! Minimal native intermediate-slab events, with a separate bearing contract.
use super::*;

fn vertices(unit: &HouseUnit, face: &RoofFace) -> Result<Vec<Vertex3>, String> {
    face.vertices
        .iter()
        .map(|&i| {
            unit.roofs
                .vertices
                .get(i as usize)
                .cloned()
                .ok_or_else(|| "Cadre eaves : indice de toiture invalide.".into())
        })
        .collect()
}

fn source(unit: &HouseUnit, face: &RoofFace, low: f64, high: f64) -> Result<bool, String> {
    if face.kind != RoofFaceKind::Slab
        || face.feature_id.is_some()
        || face.rf != "RF-FLAT"
        || face.normal[0].abs() > 1e-6
        || face.normal[1].abs() > 1e-6
        || (face.normal[2].abs() - 1.0).abs() > 1e-6
    {
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
    if levels.len() != 1 || body.component_id != face.component_id {
        return Ok(false);
    }
    let level = levels[0];
    if body
        .levels
        .iter()
        .max_by_key(|l| l.index)
        .is_some_and(|l| l.index == level.index)
        || level.intermediate_cover != IntermediateCover::Terrace
    {
        return Ok(false);
    }
    let z = snap(level.z_m + level.height_m);
    let group_id = format!("{}:{}:intermediate", body.id, level.index);
    let groups: Vec<_> = unit
        .roofs
        .groups
        .iter()
        .filter(|g| g.id == group_id)
        .collect();
    if z <= low + CONTACT
        || z >= high - CONTACT
        || face.roof_group != group_id
        || groups.len() != 1
        || groups[0].body_id != body.id
        || groups[0].level != level.index
        || groups[0].rf != "RF-FLAT"
        || groups[0].feature_id.is_some()
    {
        return Ok(false);
    }
    let v = vertices(unit, face)?;
    let projection = vec![Polygon {
        outer: v.iter().map(|v| Point { x: v.x, y: v.y }).collect(),
        holes: vec![],
    }];
    Ok(v.iter().all(|v| (v.z - z).abs() <= 1e-9)
        && area(&difference(&projection, &groups[0].domain)) <= AREA_EPS)
}

fn front(unit: &HouseUnit, head: &Feature) -> Result<Surface, String> {
    let mut feet = vec![];
    for i in 0..2 {
        let id = format!("{}:post:{i}", head.id);
        let posts: Vec<_> = unit
            .features
            .iter()
            .filter(|f| f.id == id && f.kind == FeatureKind::Post)
            .collect();
        if posts.len() != 1 {
            return Err("Cadre eaves sans ses deux pieds avant natifs.".into());
        }
        feet.extend(posts[0].surface.clone());
    }
    Ok(feet)
}

/// Queries use the same millimetre translation as physical native placements.
/// A raw float subtraction would turn exact tangent feet into artificial gaps.
fn shifted(feet: &Surface, outward: Point, delta: f64) -> Surface {
    translate(feet, outward.x * delta, outward.y * delta)
}

fn hit(
    unit: &HouseUnit,
    feet: &Surface,
    low: f64,
    high: f64,
    positive: bool,
) -> Result<bool, String> {
    let mut total = 0.0;
    for face in &unit.roofs.faces {
        if !source(unit, face, low, high)? {
            continue;
        }
        for foot in feet {
            let clipped = bridge::clip(&vertices(unit, face)?, &vec![foot.clone()])?;
            if clipped.is_empty() {
                continue;
            }
            if !positive {
                return Ok(true);
            }
            total += area(&vec![Polygon {
                outer: clipped.iter().map(|v| Point { x: v.x, y: v.y }).collect(),
                holes: vec![],
            }]);
        }
    }
    Ok(total > AREA_EPS)
}

pub(super) fn distance(
    profile: &HouseUnit,
    candidate: &HouseUnit,
    frame: Frame,
    low: f64,
    high: f64,
) -> Result<Option<f64>, String> {
    let id = candidate
        .access
        .portals
        .last()
        .and_then(|p| p.feature_ids.first())
        .ok_or("Sonde eaves sans palier final.")?;
    let head = candidate
        .features
        .iter()
        .find(|f| &f.id == id && f.kind == FeatureKind::Landing)
        .ok_or("Sonde eaves sans dalle finale.")?;
    let feet = front(candidate, head)?;
    let project =
        |p: Point, axis: Point| (p.x - frame.origin.x) * axis.x + (p.y - frame.origin.y) * axis.y;
    let (x0, x1) = rings(&feet)
        .flatten()
        .map(|p| project(*p, frame.tangent))
        .fold((f64::INFINITY, f64::NEG_INFINITY), |(a, b), x| {
            (a.min(x), b.max(x))
        });
    let (y0, y1) = profile
        .roofs
        .vertices
        .iter()
        .map(|v| project(Point { x: v.x, y: v.y }, frame.outward))
        .fold((f64::INFINITY, f64::NEG_INFINITY), |(a, b), x| {
            (a.min(x), b.max(x))
        });
    if !y0.is_finite() || !y1.is_finite() {
        return Ok(None);
    }
    let at = |x: f64, y: f64| Point {
        x: frame.origin.x + frame.tangent.x * x + frame.outward.x * y,
        y: frame.origin.y + frame.tangent.y * x + frame.outward.y * y,
    };
    let mut strip = vec![Polygon {
        outer: vec![at(x0, y0), at(x1, y0), at(x1, y1), at(x0, y1)],
        holes: vec![],
    }];
    if signed_area(&strip[0].outer) < 0.0 {
        strip[0].outer.reverse();
    }
    let foot_offset = rings(&feet)
        .flatten()
        .map(|p| project(*p, frame.outward))
        .fold(f64::INFINITY, f64::min);
    let mut contact = f64::NEG_INFINITY;
    for face in &profile.roofs.faces {
        if !source(profile, face, low, high)? {
            continue;
        }
        for v in bridge::clip(&vertices(profile, face)?, &strip)? {
            contact = contact.max(
                project(Point { x: v.x, y: v.y }, frame.outward) + frame.distance - foot_offset,
            );
        }
    }
    if !contact.is_finite() {
        return Ok(None);
    }
    let mut distance = libm::ceil(contact / GRID_M) * GRID_M;
    let maximum = bridge::TRANSVERSE_MAX + ROW_OFFSET;
    while distance <= maximum + 1e-9
        && hit(
            profile,
            &shifted(&feet, frame.outward, distance - frame.distance),
            low,
            high,
            false,
        )?
    {
        distance = snap(distance + GRID_M);
    }
    if distance <= DISTANCE_MAX + 1e-9 || distance > maximum + 1e-9 {
        return Ok(None);
    }
    Ok(Some(distance))
}

pub(super) fn distance_existing(
    profile: &HouseUnit,
    candidate: &HouseUnit,
    frame: Frame,
    low: f64,
    high: f64,
) -> Result<Option<f64>, String> {
    let id = candidate
        .access
        .portals
        .last()
        .and_then(|p| p.feature_ids.first())
        .ok_or("Sonde eaves sans palier final.")?;
    let head = candidate
        .features
        .iter()
        .find(|f| &f.id == id && f.kind == FeatureKind::Landing)
        .ok_or("Sonde eaves sans dalle finale.")?;
    let feet = front(candidate, head)?;
    if !hit(profile, &feet, low, high, true)? {
        return Ok(None);
    }
    let project =
        |p: Point, axis: Point| (p.x - frame.origin.x) * axis.x + (p.y - frame.origin.y) * axis.y;
    let (x0, x1) = rings(&feet)
        .flatten()
        .map(|p| project(*p, frame.tangent))
        .fold((f64::INFINITY, f64::NEG_INFINITY), |(a, b), x| {
            (a.min(x), b.max(x))
        });
    let (y0, y1) = profile
        .roofs
        .vertices
        .iter()
        .map(|v| project(Point { x: v.x, y: v.y }, frame.outward))
        .fold((f64::INFINITY, f64::NEG_INFINITY), |(a, b), x| {
            (a.min(x), b.max(x))
        });
    if !y0.is_finite() || !y1.is_finite() {
        return Ok(None);
    }
    let at = |x: f64, y: f64| Point {
        x: frame.origin.x + frame.tangent.x * x + frame.outward.x * y,
        y: frame.origin.y + frame.tangent.y * x + frame.outward.y * y,
    };
    let mut strip = vec![Polygon {
        outer: vec![at(x0, y0), at(x1, y0), at(x1, y1), at(x0, y1)],
        holes: vec![],
    }];
    if signed_area(&strip[0].outer) < 0.0 {
        strip[0].outer.reverse();
    }
    let foot_offset = rings(&feet)
        .flatten()
        .map(|p| project(*p, frame.outward))
        .fold(f64::INFINITY, f64::min);
    let mut contact = f64::NEG_INFINITY;
    for face in &profile.roofs.faces {
        if !source(profile, face, low, high)? {
            continue;
        }
        for v in bridge::clip(&vertices(profile, face)?, &strip)? {
            contact = contact.max(
                project(Point { x: v.x, y: v.y }, frame.outward) + frame.distance - foot_offset,
            );
        }
    }
    if !contact.is_finite() {
        return Ok(None);
    }
    let mut distance = snap(libm::ceil(contact / GRID_M) * GRID_M);
    let maximum = DISTANCE_MAX;
    while distance <= maximum + 1e-9
        && hit(
            profile,
            &shifted(&feet, frame.outward, distance - frame.distance),
            low,
            high,
            false,
        )?
    {
        distance = snap(distance + GRID_M);
    }
    if distance <= frame.distance + 1e-9
        || distance > maximum + 1e-9
        || !hit(
            profile,
            &shifted(&feet, frame.outward, distance - frame.distance - GRID_M),
            low,
            high,
            false,
        )?
    {
        return Ok(None);
    }
    Ok(Some(distance))
}

fn equal(a: &Surface, b: &Surface) -> bool {
    a.len() == b.len() && area(&difference(a, b)) + area(&difference(b, a)) <= AREA_EPS
}

/// Same native source and closed-foot queries as the three-flight profile.
pub(super) fn certify_twoflight_event(
    unit: &HouseUnit,
    head: &Feature,
    frame: Frame,
    low: f64,
) -> Result<(), String> {
    let feet = front(unit, head)?;
    if !hit(
        unit,
        &shifted(&feet, frame.outward, DISTANCE_MAX - frame.distance),
        low,
        head.z_m,
        true,
    )? {
        return Err("Cadre pair eaves sans nécessité matérielle à0.54m.".into());
    }
    if hit(unit, &feet, low, head.z_m, false)? {
        return Err("Cadre pair eaves encore en contact fermé.".into());
    }
    if !hit(
        unit,
        &shifted(&feet, frame.outward, -GRID_M),
        low,
        head.z_m,
        false,
    )? {
        return Err("Cadre pair eaves non minimal sur le maillage reconstruit.".into());
    }
    Ok(())
}

pub(super) fn validate(unit: &HouseUnit, head: &Feature, check_roofs: bool) -> Result<(), String> {
    let key = head
        .id
        .strip_suffix(":landing:3")
        .ok_or("Cadre eaves sans clé finale.")?;
    let serial = key
        .strip_prefix(&format!("{}:public-roof:", unit.id))
        .and_then(|s| s.strip_suffix(":outboard-eaves"))
        .and_then(|s| s.parse::<usize>().ok())
        .ok_or("Cadre eaves sans marqueur natif exact.")?;
    let (centres, u, w, mode) = bridge::bearings(unit, head)?;
    if mode != BearingMode::OutboardEaves {
        return Err("Cadre eaves hors de sa géométrie déclarée.".into());
    }
    let origin = point(
        centres[0].x - w.x * 2.1 + u.x * ROW_OFFSET,
        centres[0].y - w.y * 2.1 + u.y * ROW_OFFSET,
    );
    let d = -rings(&head.surface)
        .flatten()
        .map(|p| (p.x - origin.x) * u.x + (p.y - origin.y) * u.y)
        .fold(f64::INFINITY, f64::min);
    if d <= DISTANCE_MAX + 1e-9
        || d > bridge::TRANSVERSE_MAX + ROW_OFFSET + 1e-9
        || (d - snap(d)).abs() > 1e-9
    {
        return Err("Cadre eaves sans recul GRID distinct dans sa portée déclarée.".into());
    }
    let frame = Frame {
        origin,
        tangent: w,
        outward: u,
        distance: d,
    };
    let portals: Vec<_> = (0..5)
        .map(|i| {
            let id = format!("{}:portal:{}", unit.id, serial + i);
            let p: Vec<_> = unit.access.portals.iter().filter(|p| p.id == id).collect();
            if p.len() != 1 {
                Err("Cadre eaves sans ordre unique de cinq portails natifs.".to_string())
            } else {
                Ok(p[0])
            }
        })
        .collect::<Result<_, _>>()?;
    let find = |id: &str| {
        unit.access
            .nodes
            .iter()
            .find(|n| n.id == id)
            .ok_or("Cadre eaves sans nœud natif.")
    };
    let base = find(&portals[0].from)?;
    let target = find(&portals[4].to)?;
    let nodes = [
        find(&portals[0].to)?,
        find(&portals[1].to)?,
        find(&portals[2].to)?,
        find(&portals[3].to)?,
    ];
    if !public_reachable(unit).contains(&base.id) {
        return Err("Cadre eaves sans base publique.".into());
    }
    let mut expected = unit.clone();
    expected.features.clear();
    expected.walls.clear();
    expected.access.portals.clear();
    expected.access.nodes = vec![base.clone(), target.clone()];
    expected.roofs = RoofMesh::default();
    let (opening, passage) = bridge::passage(frame, true);
    install_mode(
        &mut expected,
        base,
        target,
        frame,
        &[nodes[1].z_m, nodes[2].z_m, nodes[3].z_m],
        opening,
        passage,
        floor(frame),
        RouteMode::OutboardEaves,
    )?;
    let expected_key = format!("{}:public-roof:0:outboard-eaves", unit.id);
    let pieces: Vec<_> = unit
        .features
        .iter()
        .filter(|f| f.id.starts_with(&format!("{key}:")))
        .collect();
    if pieces.len() != expected.features.len() {
        return Err("Cadre eaves avec pièce ajoutée ou manquante.".into());
    }
    for f in &expected.features {
        let id = format!(
            "{key}{}",
            f.id.strip_prefix(&expected_key)
                .ok_or("Pièce attendue eaves sans clé.")?
        );
        let matches: Vec<_> = pieces.iter().filter(|a| a.id == id).collect();
        if matches.len() != 1 {
            return Err("Cadre eaves sans identité unique de ses pièces.".into());
        }
        let a = matches[0];
        if a.kind != f.kind
            || a.material != f.material
            || a.roof.is_some()
            || (a.z_m - f.z_m).abs() > 1e-9
            || (a.height_m - f.height_m).abs() > 1e-9
            || !equal(&a.surface, &f.surface)
            || a.vertices3d.len() != f.vertices3d.len()
            || a.vertices3d.iter().zip(&f.vertices3d).any(|(a, b)| {
                (a.x - b.x).abs() > 1e-9 || (a.y - b.y).abs() > 1e-9 || (a.z - b.z).abs() > 1e-9
            })
        {
            return Err("Cadre eaves différent de l'opérateur matériel natif.".into());
        }
    }
    let mut node_map = BTreeMap::from([
        (base.id.clone(), base.id.clone()),
        (target.id.clone(), target.id.clone()),
    ]);
    for (i, node) in nodes.iter().enumerate() {
        let expected_node = expected
            .access
            .nodes
            .iter()
            .find(|n| n.id == expected.access.portals[i].to)
            .ok_or("Cadre eaves sans nœud attendu.")?;
        if node.kind != expected_node.kind
            || node.household_id.is_some()
            || (node.z_m - expected_node.z_m).abs() > 1e-9
            || !equal(&node.floor, &expected_node.floor)
        {
            return Err("Cadre eaves sans ses quatre sols natifs.".into());
        }
        node_map.insert(expected_node.id.clone(), node.id.clone());
    }
    for (i, p) in expected.access.portals.iter().enumerate() {
        let mut p = p.clone();
        p.id = portals[i].id.clone();
        p.from = node_map
            .get(&p.from)
            .ok_or("Cadre eaves départ hors chaîne.")?
            .clone();
        p.to = node_map
            .get(&p.to)
            .ok_or("Cadre eaves arrivée hors chaîne.")?
            .clone();
        p.feature_ids = p
            .feature_ids
            .iter()
            .map(|id| id.replace(&expected_key, key))
            .collect();
        if p != *portals[i] {
            return Err("Cadre eaves différent de ses cinq interfaces natives.".into());
        }
    }
    if check_roofs {
        let feet = front(unit, head)?;
        if !hit(
            unit,
            &shifted(&feet, u, DISTANCE_MAX - d),
            base.z_m,
            head.z_m,
            true,
        )? {
            return Err("Marqueur eaves sans nécessité matérielle au recul0.54m.".into());
        }
        if !hit(unit, &shifted(&feet, u, -GRID_M), base.z_m, head.z_m, false)? {
            return Err("Cadre eaves non minimal sur le maillage natif final.".into());
        }
    }
    Ok(())
}

#[cfg(test)]
#[path = "public_roof_outboard_eaves_tests.rs"]
pub(super) mod tests;

#[cfg(test)]
#[path = "public_roof_outboard_event_tests.rs"]
pub(super) mod event_tests;
