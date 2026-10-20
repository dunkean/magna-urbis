//! Exact two-flight bridge certificates for material openings in native bands.
use super::*;

pub(super) struct Mask {
    pub key: String,
    pub surface: Surface,
    pub outside_target: Surface,
    pub body_id: String,
    pub z: f64,
}

fn equal(a: &Surface, b: &Surface) -> bool {
    a.len() == b.len() && area(&difference(a, b)) + area(&difference(b, a)) <= AREA_EPS
}

fn same_vertices(a: &[Vertex3], b: &[Vertex3]) -> bool {
    a.len() == b.len()
        && a.iter().zip(b).all(|(a, b)| {
            (a.x - b.x).abs() <= 1e-9 && (a.y - b.y).abs() <= 1e-9 && (a.z - b.z).abs() <= 1e-9
        })
}

pub(super) fn mask(unit: &HouseUnit, p: &Portal) -> Result<Mask, String> {
    if p.kind != PortalKind::Passage || p.feature_ids.len() != 1 {
        return Err("Ouverture de bande sans Passage natif unique.".into());
    }
    let id = &p.feature_ids[0];
    let key = id
        .strip_suffix(":landing:2")
        .filter(|key| key.ends_with(":band-open"))
        .ok_or("Ouverture de bande sans palier final 2 marqué.")?;
    if key.contains(":outboard") || key.contains(":link:") {
        return Err("Ouverture de bande combinée avec une autre géométrie de route.".into());
    }
    let serial = key
        .strip_prefix(&format!("{}:public-roof:", unit.id))
        .and_then(|s| s.strip_suffix(":band-open"))
        .and_then(|s| s.parse::<usize>().ok())
        .ok_or("Ouverture de bande sans clé native de route.")?;
    if p.id != format!("{}:portal:{}", unit.id, serial + 3)
        || unit.access.portals.iter().filter(|q| q.id == p.id).count() != 1
        || !unit.access.portals.iter().any(|q| q == p)
    {
        return Err("Ouverture de bande sans portail final natif unique.".into());
    }
    let find_node = |id: &str| {
        unit.access
            .nodes
            .iter()
            .find(|n| n.id == id)
            .ok_or("Nœud absent du pont de bande.")
    };
    let target = find_node(&p.to)?;
    if target.kind != AccessKind::Terrace
        || target.household_id.is_some()
        || (p.from_z_m - target.z_m).abs() > 1e-9
        || (p.to_z_m - target.z_m).abs() > 1e-9
        || (p.width_m - 0.85).abs() > 1e-9
    {
        return Err("Ouverture de bande hors d'une terrasse publique coplanaire.".into());
    }
    let slabs: Vec<_> = unit.features.iter().filter(|f| &f.id == id).collect();
    if slabs.len() != 1 || slabs[0].kind != FeatureKind::Landing {
        return Err("Ouverture de bande sans dalle finale unique.".into());
    }
    let slab = slabs[0];
    let (centres, u, w, mode) = bridge::bearings(unit, slab)?;
    if mode != outboard::BearingMode::Legacy {
        return Err("Ouverture de bande hors des appuis Legacy.".into());
    }
    let tangent = Point { x: -w.x, y: -w.y };
    let origin = point(
        centres[0].x - tangent.x * 0.1 - u.x * 0.1,
        centres[0].y - tangent.y * 0.1 - u.y * 0.1,
    );
    let distance = -rings(&slab.surface)
        .flatten()
        .map(|q| (q.x - origin.x) * u.x + (q.y - origin.y) * u.y)
        .fold(f64::INFINITY, f64::min);
    if !distance.is_finite() || !(0.0..=bridge::DISTANCE_MAX + 1e-9).contains(&distance) {
        return Err("Ouverture de bande hors de la portée native du pont.".into());
    }
    let frame = Frame {
        origin,
        tangent,
        outward: u,
        distance,
    };
    let (opening, passage) = bridge::passage(frame, false);
    let surface = intersection(&p.passage, &target.floor);
    if !equal(&slab.surface, &bridge::floor(frame, false))
        || !equal(&p.passage, &passage)
        || !equal(&p.opening_surface, &passage)
        || !equal(&surface, &frame.rect(0.025, -distance - 0.2, 0.85, 0.2))
        || p.opening
            .iter()
            .zip(opening)
            .any(|(a, b)| (a.x - b.x).abs() > 1e-9 || (a.y - b.y).abs() > 1e-9)
    {
        return Err("Ouverture de bande différente du passage reconstruit.".into());
    }
    let mut flights = vec![];
    for i in 0..2 {
        let id = format!("{key}:flight:{i}");
        let ps: Vec<_> = unit
            .access
            .portals
            .iter()
            .filter(|p| p.feature_ids.contains(&id))
            .collect();
        if ps.len() != 1 || ps[0].kind != PortalKind::Ladder || ps[0].feature_ids != vec![id] {
            return Err("Ouverture de bande sans chaîne unique de deux Ladder.".into());
        }
        if ps[0].id != format!("{}:portal:{}", unit.id, serial + i + 1) {
            return Err("Volée du pont de bande hors de son ordre natif.".into());
        }
        flights.push(ps[0]);
    }
    if flights[0].to != flights[1].from || flights[1].to != p.from {
        return Err("Chaîne de pont de bande rompue.".into());
    }
    let nodes = [
        find_node(&flights[0].from)?,
        find_node(&flights[0].to)?,
        find_node(&flights[1].to)?,
    ];
    if nodes
        .iter()
        .any(|n| n.kind != AccessKind::StairLanding || n.household_id.is_some())
        || nodes[1].z_m <= nodes[0].z_m + CONTACT
        || nodes[2].z_m <= nodes[1].z_m + CONTACT
        || (nodes[2].z_m - target.z_m).abs() > 1e-9
        || unit.access.portals.iter().any(|q| {
            q.from == nodes[2].id && matches!(q.kind, PortalKind::Ladder | PortalKind::Stair)
        })
    {
        return Err("Ouverture de bande hors des trois paliers publics natifs.".into());
    }
    let departures: Vec<_> = unit
        .access
        .portals
        .iter()
        .filter(|q| {
            q.id == format!("{}:portal:{serial}", unit.id)
                && q.kind == PortalKind::Passage
                && q.to == nodes[0].id
                && q.feature_ids.is_empty()
        })
        .collect();
    if departures.len() != 1 {
        return Err("Ouverture de bande sans départ natif unique.".into());
    }
    let base = find_node(&departures[0].from)?;
    if !public_reachable(unit).contains(&base.id) {
        return Err("Départ du pont de bande non public.".into());
    }

    // Reuse the exact native operator to close every slab, post and flight.
    let mut expected = unit.clone();
    expected.features.clear();
    expected.walls.clear();
    expected.access.nodes = vec![base.clone(), target.clone()];
    expected.access.portals.clear();
    expected.roofs = RoofMesh::default();
    install_mode(
        &mut expected,
        base,
        target,
        frame,
        &[nodes[1].z_m, nodes[2].z_m],
        opening,
        passage,
        bridge::floor(frame, false),
        RouteMode::BandOpen,
    )?;
    let expected_key = format!("{}:public-roof:0:band-open", unit.id);
    let actual: Vec<_> = unit
        .features
        .iter()
        .filter(|f| f.id.starts_with(&format!("{key}:")))
        .collect();
    if actual.len() != expected.features.len() {
        return Err("Pont de bande avec une pièce ajoutée ou manquante.".into());
    }
    for f in &expected.features {
        let suffix = f.id.strip_prefix(&expected_key).unwrap();
        let fs: Vec<_> = actual
            .iter()
            .filter(|a| a.id == format!("{key}{suffix}"))
            .collect();
        if fs.len() != 1 {
            return Err("Pièce de pont de bande sans identité unique.".into());
        }
        let a = fs[0];
        if a.kind != f.kind
            || a.material != f.material
            || a.roof.is_some()
            || (a.z_m - f.z_m).abs() > 1e-9
            || (a.height_m - f.height_m).abs() > 1e-9
            || !equal(&a.surface, &f.surface)
            || !same_vertices(&a.vertices3d, &f.vertices3d)
        {
            return Err("Pièce du pont de bande différente de l'opérateur natif.".into());
        }
    }
    for (a, b) in [departures[0], flights[0], flights[1], p]
        .iter()
        .zip(&expected.access.portals)
    {
        if a.kind != b.kind
            || (a.width_m - b.width_m).abs() > 1e-9
            || (a.from_z_m - b.from_z_m).abs() > 1e-9
            || (a.to_z_m - b.to_z_m).abs() > 1e-9
            || (a.head_z_m - b.head_z_m).abs() > 1e-9
            || a.wall_id.is_some()
            || !equal(&a.passage, &b.passage)
            || !equal(&a.opening_surface, &b.opening_surface)
            || a.opening
                .iter()
                .zip(b.opening)
                .any(|(a, b)| (a.x - b.x).abs() > 1e-9 || (a.y - b.y).abs() > 1e-9)
        {
            return Err("Portail du pont de bande différent de l'opérateur natif.".into());
        }
    }
    for (actual, expected) in nodes.iter().zip(expected.access.nodes.iter().skip(2)) {
        if !equal(&actual.floor, &expected.floor) || (actual.z_m - expected.z_m).abs() > 1e-9 {
            return Err("Sol du pont de bande différent de sa dalle native.".into());
        }
    }
    let bodies: Vec<_> = unit
        .bodies
        .iter()
        .filter(|b| {
            b.levels.last().is_some_and(|l| {
                (l.z_m + l.height_m - target.z_m).abs() <= 1e-9
                    && l.roof_slab.as_ref().is_some_and(|s| {
                        s.walkable
                            && (s.z_m - target.z_m).abs() <= 1e-9
                            && area(&difference(&surface, &s.surface)) <= AREA_EPS
                    })
            })
        })
        .collect();
    if bodies.len() != 1 {
        return Err("Ouverture de bande sans unique corps natif porteur.".into());
    }
    Ok(Mask {
        key: key.into(),
        surface,
        outside_target: difference(&p.passage, &target.floor),
        body_id: bodies[0].id.clone(),
        z: target.z_m,
    })
}

#[cfg(test)]
#[path = "public_roof_band_open_tests.rs"]
mod tests;
