//! Geometric assertions on published architecture, never a renderer heuristic.
use crate::access::{reachable, reachable_for_owner, validate_public_roofs};
use crate::geometry::*;
use crate::model::*;
use crate::wall_geometry::{validate_wall, wall_section};
use std::collections::BTreeSet;

#[path = "partition_validation.rs"]
mod partition_validation;
pub use partition_validation::PartitionMetrics;

fn surface_valid(surface: &Surface) -> Result<(), String> {
    for p in surface {
        if p.outer.len() < 3 || signed_area(&p.outer) <= 0.0 {
            return Err(format!(
                "Contour extérieur invalide ({} sommets, aire {}).",
                p.outer.len(),
                signed_area(&p.outer)
            ));
        }
        for r in std::iter::once(&p.outer).chain(p.holes.iter()) {
            if r.len() < 3 || r.iter().any(|p| !p.x.is_finite() || !p.y.is_finite()) {
                return Err("Géométrie non finie ou anneau dégénéré.".into());
            }
        }
        if p.holes.iter().any(|r| signed_area(r) >= 0.0) {
            return Err("Orientation de trou invalide.".into());
        }
    }
    Ok(())
}

fn partition_valid(domain: &Surface, p: &Partition) -> Result<(), String> {
    partition_metrics(domain, p).map(|_| ())
}

/// Read-only measurements used to audit the local conservation budget.
pub fn partition_metrics(domain: &Surface, p: &Partition) -> Result<PartitionMetrics, String> {
    partition_validation::validate(domain, p)
}

pub fn validate_unit(unit: &HouseUnit) -> Result<(), String> {
    surface_valid(&unit.lot)?;
    partition_valid(&unit.lot, &unit.partition)?;
    for lp in &unit.level_partitions {
        partition_valid(&lp.domain, &lp.partition)?;
    }
    for wall in &unit.walls {
        surface_valid(&wall.footprint)?;
        validate_wall(wall)?;
    }
    for body in &unit.bodies {
        surface_valid(&body.footprint)?;
        for void in &body.voids {
            surface_valid(void)?;
            let raw = unite(
                &std::iter::once(body.footprint.clone())
                    .chain(body.voids.iter().cloned())
                    .collect::<Vec<_>>(),
            );
            if void.is_empty()
                || area(&intersection(void, &body.footprint)) > 1e-6
                || area(&difference(
                    &offset(void, body.wall_thickness_m + 1.2),
                    &raw,
                )) > 1e-6
            {
                return Err(format!(
                    "Corps {} : puits structurel non intérieur ou marge insuffisante.",
                    body.id
                ));
            }
            for level in &body.levels {
                if area(&intersection(void, &level.footprint))
                    + area(&intersection(void, &level.floor))
                    > 1e-6
                    || level
                        .roof_slab
                        .as_ref()
                        .is_some_and(|s| area(&intersection(void, &s.surface)) > 1e-6)
                {
                    return Err(format!(
                        "Corps {} niveau{} : dalle dans le puits structurel.",
                        body.id, level.index
                    ));
                }
                let frontage = offset(void, body.wall_thickness_m + 0.05);
                if !unit.rooms.iter().any(|r| {
                    r.body_id == body.id
                        && r.level == level.index
                        && area(&intersection(&frontage, &r.floor)) > 0.001
                }) {
                    return Err(format!(
                        "Corps {} niveau{} : aucune pièce ne borde le puits.",
                        body.id, level.index
                    ));
                }
            }
            for feature in unit.features.iter().filter(|f| {
                f.z_m > 0.0
                    && matches!(
                        f.kind,
                        FeatureKind::Gallery
                            | FeatureKind::FloorSlab
                            | FeatureKind::Terrace
                            | FeatureKind::Deck
                    )
            }) {
                if area(&intersection(void, &feature.surface)) > 1e-6 {
                    return Err(format!(
                        "Corps {} : {} couvre son puits structurel.",
                        body.id, feature.id
                    ));
                }
            }
            for face in &unit.roofs.faces {
                let mut ring = vec![];
                for &index in &face.vertices {
                    let vertex = unit
                        .roofs
                        .vertices
                        .get(index as usize)
                        .ok_or("Indice de toiture invalide.")?;
                    ring.push(Point {
                        x: vertex.x,
                        y: vertex.y,
                    });
                }
                if signed_area(&ring).abs() <= 1e-10 {
                    continue;
                }
                if signed_area(&ring) < 0.0 {
                    ring.reverse();
                }
                if area(&intersection(
                    void,
                    &vec![Polygon {
                        outer: ring,
                        holes: vec![],
                    }],
                )) > 1e-6
                {
                    return Err(format!(
                        "Corps {} : toiture {:?} dans le puits structurel.",
                        body.id, face.kind
                    ));
                }
            }
        }
        for l in &body.levels {
            if !l.z_m.is_finite() || !l.height_m.is_finite() || l.height_m <= 0.0 {
                return Err("Hauteur de niveau invalide.".into());
            }
            surface_valid(&l.footprint)?;
            surface_valid(&l.floor)?;
            if area(&difference(&l.floor, &l.footprint)) > area_tolerance(&l.footprint).max(0.005) {
                return Err("Dalle hors emprise du niveau.".into());
            }
            if let Some(s) = &l.roof_slab {
                surface_valid(&s.surface)?;
                if (s.z_m - l.z_m - l.height_m).abs() > 0.001 {
                    return Err("Dalle de terrasse non cotée sur son niveau.".into());
                }
            }
        }
    }
    for (i, r) in unit.rooms.iter().enumerate() {
        surface_valid(&r.floor)?;
        if r.floor.len() != 1 || area(&r.floor) < 0.45 {
            return Err(format!("Pièce {} : sol trop petit ou non connexe.", r.id));
        }
        let access = unit
            .access
            .nodes
            .iter()
            .find(|node| node.id == r.access_node)
            .ok_or("Pièce sans espace d'accès.")?;
        if access.kind != AccessKind::Room
            || (access.z_m - r.z_m).abs() > 0.001
            || access.household_id != r.household_id
            || area(&difference(&access.floor, &r.floor))
                + area(&difference(&r.floor, &access.floor))
                > area_tolerance(&r.floor).max(0.005)
        {
            return Err(format!(
                "Pièce {} : espace d'accès différent de son sol réel.",
                r.id
            ));
        }
        let body = unit
            .bodies
            .iter()
            .find(|b| b.id == r.body_id)
            .ok_or("Pièce sans corps.")?;
        let level = body
            .levels
            .get(r.level as usize)
            .ok_or("Pièce sans niveau.")?;
        if area(&difference(&r.floor, &level.floor)) > area_tolerance(&r.floor).max(0.005) {
            return Err(format!("Pièce {} hors dalle.", r.id));
        }
        let a = bounds(&r.floor);
        for other in unit
            .rooms
            .iter()
            .skip(i + 1)
            .filter(|o| (o.z_m - r.z_m).abs() < 0.001)
        {
            let b = bounds(&other.floor);
            if a[2] <= b[0] || b[2] <= a[0] || a[3] <= b[1] || b[3] <= a[1] {
                continue;
            }
            if area(&intersection(&r.floor, &other.floor)) > 0.005 {
                return Err("Pièces occupées superposées.".into());
            }
        }
        for wall in unit
            .walls
            .iter()
            .filter(|w| w.z_m <= r.z_m + 0.01 && w.z_m + w.height_m > r.z_m + 0.01)
        {
            let section = wall_section(wall, r.z_m + 0.01);
            let b = bounds(&section);
            if a[2] <= b[0] || b[2] <= a[0] || a[3] <= b[1] || b[3] <= a[1] {
                continue;
            }
            if area(&intersection(&r.floor, &section)) > 0.005 {
                return Err(format!("Pièce {} contenue dans le mur {}.", r.id, wall.id));
            }
        }
    }
    let ids: BTreeSet<_> = unit.access.nodes.iter().map(|n| n.id.as_str()).collect();
    if ids.len() != unit.access.nodes.len() || !ids.contains(unit.access.root.as_str()) {
        return Err("Identité des espaces d'accès invalide.".into());
    }
    for n in &unit.access.nodes {
        surface_valid(&n.floor)?;
        if !n.z_m.is_finite() || n.floor.len() != 1 || area(&n.floor) < 0.005 {
            return Err(format!(
                "Espace {} : cote invalide ou sol non connexe.",
                n.id
            ));
        }
    }
    for p in &unit.access.portals {
        if !ids.contains(p.from.as_str()) || !ids.contains(p.to.as_str()) {
            return Err("Portail référence un espace absent.".into());
        }
        surface_valid(&p.passage)?;
        surface_valid(&p.opening_surface)?;
        if !p.head_z_m.is_finite() || p.head_z_m <= p.from_z_m.min(p.to_z_m) {
            return Err("Hauteur d'ouverture invalide.".into());
        }
        for (id, z) in [(&p.from, p.from_z_m), (&p.to, p.to_z_m)] {
            let node = unit
                .access
                .nodes
                .iter()
                .find(|n| &n.id == id)
                .ok_or("Nœud de portail absent.")?;
            if (node.z_m - z).abs() > 0.001 || area(&intersection(&node.floor, &p.passage)) < 0.005
            {
                return Err(format!("Portail {} sans sol ni cote d'interface.", p.id));
            }
        }
        let minimum = match p.kind {
            PortalKind::Gate => 1.2,
            PortalKind::Hatch | PortalKind::Ladder => 0.65,
            PortalKind::Stair => 0.85,
            _ => 0.75,
        };
        if !p.width_m.is_finite() || p.width_m < minimum {
            return Err(format!("Largeur portail {} insuffisante.", p.id));
        }
        if let Some(profile_id) = &p.profile_id {
            let floor = p.from_z_m.min(p.to_z_m);
            let sill = p.sill_z_m.unwrap_or(floor);
            let top_width = p.top_width_m.unwrap_or(p.width_m);
            if profile_id.is_empty()
                || !sill.is_finite()
                || !top_width.is_finite()
                || top_width < 0.75
                || sill < floor - 0.001
                || sill - floor > 0.45 + 0.001
                || p.head_z_m <= sill
                || (p.shape == crate::catalogue::PortalShape::Rect
                    && (top_width - p.width_m).abs() > 1e-9)
            {
                return Err(format!(
                    "Portail {} : profil, seuil ou tête invalide.",
                    p.id
                ));
            }
            for wall in &unit.walls {
                if area(&intersection(
                    &wall_section(wall, sill + 0.000001),
                    &p.opening_surface,
                )) > 0.003
                {
                    return Err(format!(
                        "Portail {} : baie profilée obstruée au seuil par {}.",
                        p.id, wall.id
                    ));
                }
            }
            if sill > floor + 0.001 {
                let treads: Vec<_> = p
                    .feature_ids
                    .iter()
                    .filter_map(|id| {
                        unit.features
                            .iter()
                            .find(|f| &f.id == id && f.kind == FeatureKind::Threshold)
                    })
                    .collect();
                if treads.is_empty()
                    || treads.iter().any(|f| {
                        (f.z_m - sill).abs() > 0.001
                            || f.vertices3d.is_empty()
                            || f.vertices3d.iter().any(|v| (v.z - sill).abs() > 0.001)
                            || !unit.walls.iter().any(|w| {
                                w.solid.is_some()
                                    && w.z_m <= floor + 0.001
                                    && (w.z_m + w.height_m - sill).abs() < 0.001
                                    && area(&difference(
                                        &f.surface,
                                        &wall_section(w, sill - 0.000001),
                                    )) <= 1e-6
                            })
                    })
                {
                    return Err(format!(
                        "Portail {} : marche de seuil sans volume porteur.",
                        p.id
                    ));
                }
            }
        }
        for wall in unit.walls.iter().filter(|w| w.opening_ids.contains(&p.id)) {
            if wall.party
                || area(&intersection(
                    &wall_section(wall, p.from_z_m + 0.01),
                    &p.opening_surface,
                )) > 0.003
            {
                return Err("Portail sans ouverture réelle ou sur mitoyen.".into());
            }
        }
        if (p.to_z_m - p.from_z_m).abs() > 0.001
            && (p.feature_ids.is_empty()
                || p.feature_ids.iter().any(|id| {
                    !unit
                        .features
                        .iter()
                        .any(|f| &f.id == id && !f.vertices3d.is_empty())
                }))
        {
            return Err("Accès vertical sans interface cotée.".into());
        }
        if matches!(p.kind, PortalKind::Stair | PortalKind::Ladder) {
            let f = p
                .feature_ids
                .iter()
                .find_map(|id| unit.features.iter().find(|f| &f.id == id))
                .ok_or("Volée sans interface.")?;
            if f.surface.len() != 1
                || f.surface[0].outer.len() != 4
                || !f.surface[0].holes.is_empty()
                || f.vertices3d.len() != 4
            {
                return Err(format!("Volée {} : empreinte non rectangulaire.", f.id));
            }
            let v = &f.vertices3d;
            let width = libm::hypot(v[1].x - v[0].x, v[1].y - v[0].y);
            let run = libm::hypot(v[2].x - v[1].x, v[2].y - v[1].y);
            let dz = (p.to_z_m - p.from_z_m).abs();
            let required_run = if p.kind == PortalKind::Ladder {
                1.3
            } else {
                (dz * 0.95).max(2.6)
            };
            let dot = (v[1].x - v[0].x) * (v[2].x - v[1].x) + (v[1].y - v[0].y) * (v[2].y - v[1].y);
            if width < 0.897
                || run + 0.003 < required_run
                || dot.abs() > width * run * 0.003
                || (p.kind == PortalKind::Ladder && dz > 3.001)
                || v[..2].iter().any(|v| (v.z - p.from_z_m).abs() > 0.001)
                || v[2..].iter().any(|v| (v.z - p.to_z_m).abs() > 0.001)
            {
                return Err(format!(
                    "Volée {} : largeur {width:.3}, longueur {run:.3}, dénivelé {dz:.3} m incompatibles.",
                    f.id
                ));
            }
            for (id, a, b) in [(&p.from, [0, 1], [3, 2]), (&p.to, [3, 2], [0, 1])] {
                let dx = (v[b[0]].x + v[b[1]].x - v[a[0]].x - v[a[1]].x) * 0.5 / run * 0.35;
                let dy = (v[b[0]].y + v[b[1]].y - v[a[0]].y - v[a[1]].y) * 0.5 / run * 0.35;
                let mut ring = vec![
                    point(v[a[0]].x, v[a[0]].y),
                    point(v[a[1]].x, v[a[1]].y),
                    point(v[a[1]].x + dx, v[a[1]].y + dy),
                    point(v[a[0]].x + dx, v[a[0]].y + dy),
                ];
                if signed_area(&ring) < 0.0 {
                    ring.reverse();
                }
                let end = vec![Polygon {
                    outer: ring,
                    holes: vec![],
                }];
                let floor = &unit
                    .access
                    .nodes
                    .iter()
                    .find(|n| &n.id == id)
                    .ok_or("Palier absent.")?
                    .floor;
                let supported_area = area(&intersection(&end, floor));
                if supported_area < 0.267 {
                    return Err(format!(
                        "Volée {} : extrémité {id} sans palier de 0.9 × 0.3 m ({supported_area:.4} m²).",
                        f.id
                    ));
                }
            }
        }
    }
    validate_public_roofs(unit)?;
    let reach = reachable(unit);
    if unit.rooms.iter().any(|r| !reach.contains(&r.access_node)) {
        return Err("Pièce inaccessible au graphe final.".into());
    }
    for owner in unit
        .rooms
        .iter()
        .filter_map(|r| r.household_id.as_ref())
        .collect::<BTreeSet<_>>()
    {
        let reached = reachable_for_owner(unit, owner);
        if let Some(r) = unit.rooms.iter().find(|r| {
            r.household_id.as_ref() == Some(owner) && !reached.contains(r.access_node.as_str())
        }) {
            return Err(format!(
                "Ménage {owner} : pièce {} desservie par un autre ménage.",
                r.id
            ));
        }
    }
    for f in unit.features.iter().chain(unit.site_context.iter()) {
        surface_valid(&f.surface).map_err(|e| format!("Feature {} : {e}", f.id))?;
        if !f.z_m.is_finite()
            || !f.height_m.is_finite()
            || f.vertices3d
                .iter()
                .any(|v| !v.x.is_finite() || !v.y.is_finite() || !v.z.is_finite())
        {
            return Err("Feature non finie.".into());
        }
    }
    for v in &unit.roofs.vertices {
        if !v.x.is_finite() || !v.y.is_finite() || !v.z.is_finite() {
            return Err("Sommet toiture non fini.".into());
        }
    }
    for f in &unit.roofs.faces {
        if f.vertices.len() < 3
            || f.vertices
                .iter()
                .any(|&i| i as usize >= unit.roofs.vertices.len())
        {
            return Err("Indices de face toiture invalides.".into());
        }
        if let Some(id) = &f.feature_id {
            if !unit
                .features
                .iter()
                .any(|feature| &feature.id == id && feature.roof.is_some())
            {
                return Err("Toiture de feature sans source déclarée.".into());
            }
            if !f.body_id.is_empty() && !unit.bodies.iter().any(|b| b.id == f.body_id) {
                return Err("Propriétaire de toiture secondaire absent.".into());
            }
        } else if !unit.bodies.iter().any(|b| b.id == f.body_id) {
            return Err("Face de toiture sans corps.".into());
        }
        let length = libm::sqrt(f.normal.iter().map(|n| n * n).sum());
        if !length.is_finite() || (length - 1.0).abs() > 1e-6 {
            return Err("Normale toiture invalide.".into());
        }
    }
    for group in &unit.roofs.groups {
        surface_valid(&group.domain)?;
        if group.feature_id.as_ref().is_some_and(|id| {
            !unit
                .features
                .iter()
                .any(|feature| &feature.id == id && feature.roof.is_some())
        }) {
            return Err("Groupe de toiture secondaire sans source.".into());
        }
        if group.feature_id.is_none() && !unit.bodies.iter().any(|b| b.id == group.body_id) {
            return Err("Groupe de toiture sans corps.".into());
        }
    }
    Ok(())
}
