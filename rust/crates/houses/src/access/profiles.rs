//! Catalogue entry counts use real household boundaries and geometric facades.
use super::*;
use crate::catalogue::{Parameters, PortalProfile};

pub(super) fn entry_owner(unit: &HouseUnit, a: &AccessNode, b: &AccessNode) -> Option<String> {
    let (room, outside) = if a.kind == AccessKind::Room && b.kind != AccessKind::Room {
        (a, b)
    } else if b.kind == AccessKind::Room && a.kind != AccessKind::Room {
        (b, a)
    } else {
        return None;
    };
    let room_record = unit
        .rooms
        .iter()
        .find(|r| r.access_node == room.id && r.level == 0)?;
    let body = unit.bodies.iter().find(|b| b.id == room_record.body_id)?;
    if body.envelope == crate::catalogue::Envelope::Open
        || outside
            .household_id
            .as_ref()
            .zip(room.household_id.as_ref())
            .is_some_and(|(a, b)| a != b)
        || (room.z_m - outside.z_m).abs() > 0.001
    {
        return None;
    }
    if !matches!(outside.kind, AccessKind::Exterior | AccessKind::Courtyard)
        && area(&difference(&outside.floor, &body.levels[0].footprint)) < 0.005
    {
        return None;
    }
    Some(room.household_id.clone().unwrap_or_else(|| unit.id.clone()))
}

pub(super) fn entries<'a>(unit: &'a HouseUnit, owner: &str) -> Vec<&'a Portal> {
    unit.access
        .portals
        .iter()
        .filter(|p| matches!(p.kind, PortalKind::Door | PortalKind::Gate))
        .filter(|p| {
            let a = unit.access.nodes.iter().find(|n| n.id == p.from);
            let b = unit.access.nodes.iter().find(|n| n.id == p.to);
            a.zip(b)
                .is_some_and(|(a, b)| entry_owner(unit, a, b).as_deref() == Some(owner))
        })
        .collect()
}

pub(super) fn site_entries<'a>(unit: &'a HouseUnit, profile: &PortalProfile) -> Vec<&'a Portal> {
    unit.access
        .portals
        .iter()
        .filter(|p| {
            p.profile_id
                .as_ref()
                .is_some_and(|id| profile.entries.iter().any(|s| &s.id == id))
        })
        .collect()
}

pub(super) fn crosses_enclosure(unit: &HouseUnit, strip: &Surface, z: f64) -> bool {
    unit.walls.iter().any(|w| {
        w.kind == WallKind::Enclosure
            && area(&intersection(&wall_section(w, z + 0.01), strip)) > 0.001
    })
}

pub(super) fn distinct(opening: [Point; 2], existing: &[&Portal]) -> bool {
    let dx = opening[1].x - opening[0].x;
    let dy = opening[1].y - opening[0].y;
    let length = libm::hypot(dx, dy);
    let c = Point {
        x: (opening[0].x + opening[1].x) * 0.5,
        y: (opening[0].y + opening[1].y) * 0.5,
    };
    existing.iter().all(|p| {
        let px = p.opening[1].x - p.opening[0].x;
        let py = p.opening[1].y - p.opening[0].y;
        let cosine = (dx * px + dy * py).abs() / (length * libm::hypot(px, py));
        let pc = Point {
            x: (p.opening[0].x + p.opening[1].x) * 0.5,
            y: (p.opening[0].y + p.opening[1].y) * 0.5,
        };
        cosine <= libm::cos(std::f64::consts::PI / 6.0) + 1e-9
            || libm::hypot(c.x - pc.x, c.y - pc.y) >= 2.0 - 1e-9
    })
}

pub(super) fn add_entries(unit: &mut HouseUnit, parameters: &Parameters) -> Result<(), String> {
    if let Some(program) = &parameters.portal_profile {
        let owners: BTreeSet<_> = unit
            .rooms
            .iter()
            .filter(|r| r.level == 0)
            .map(|r| r.household_id.clone().unwrap_or_else(|| unit.id.clone()))
            .collect();
        for owner in owners {
            while entries(unit, &owner).len() < program.count[0] as usize {
                let existing = entries(unit, &owner);
                let spec = &program.entries[existing.len() % program.entries.len()];
                let width = spec.width_m.max(spec.top_width_m);
                let depth = unit
                    .bodies
                    .iter()
                    .map(|b| b.wall_thickness_m * 2.0 + 0.6)
                    .fold(1.8, f64::max);
                let mut found = None;
                'pairs: for room in &unit.access.nodes {
                    for outside in &unit.access.nodes {
                        if entry_owner(unit, room, outside).as_deref() != Some(&owner)
                            || room.kind != AccessKind::Room
                        {
                            continue;
                        }
                        let mut forbidden: Vec<_> = unit
                            .walls
                            .iter()
                            .filter(|w| w.party)
                            .map(|w| w.footprint.clone())
                            .collect();
                        forbidden.extend(
                            unit.rooms
                                .iter()
                                .filter(|r| {
                                    r.access_node != room.id && (r.z_m - room.z_m).abs() < 0.001
                                })
                                .map(|r| r.floor.clone()),
                        );
                        forbidden.extend(
                            unit.site_context
                                .iter()
                                .filter(|f| {
                                    matches!(
                                        f.kind,
                                        FeatureKind::Water
                                            | FeatureKind::Neighbor
                                            | FeatureKind::RockFace
                                    )
                                })
                                .map(|f| f.surface.clone()),
                        );
                        forbidden.extend(existing.iter().map(|p| p.passage.clone()));
                        let accept = |opening, strip: &Surface, _| {
                            distinct(opening, &existing)
                                && has_profiled_portal_landings(
                                    &room.floor, &outside.floor, opening, strip, spec.width_m,
                                )
                                && unit.walls.iter().any(|w| {
                                    matches!(
                                        w.kind,
                                        WallKind::Exterior | WallKind::Shell | WallKind::Rock
                                    ) && area(&intersection(
                                        &wall_section(w, room.z_m + 0.01),
                                        strip,
                                    )) > 0.001
                                })
                        };
                        if let Some((opening, strip)) = candidate_filtered(
                            &room.floor,
                            &outside.floor,
                            width,
                            depth,
                            &forbidden,
                            accept,
                        )
                        .or_else(|| {
                            candidate_filtered(
                                &outside.floor,
                                &room.floor,
                                width,
                                depth,
                                &forbidden,
                                accept,
                            )
                        }) {
                            found = Some((
                                room.id.clone(),
                                outside.id.clone(),
                                opening,
                                strip,
                                spec.clone(),
                            ));
                            break 'pairs;
                        }
                    }
                }
                let Some((room, outside, opening, strip, spec)) = found else {
                    return Err(format!(
                        "Ménage {owner} : {} entrées source requises, {} façades admissibles trouvées.",
                        program.count[0],
                        entries(unit, &owner).len()
                    ));
                };
                portal_with_profile(
                    unit,
                    &room,
                    &outside,
                    PortalKind::Door,
                    opening,
                    strip,
                    spec.width_m,
                    vec![],
                    Some(&spec),
                )?;
            }
            let actual = entries(unit, &owner);
            if actual.len() > program.count[1] as usize {
                return Err(format!(
                    "Ménage {owner} : trop d'entrées pour le profil source."
                ));
            }
            if program.placement == crate::catalogue::PortalPlacement::Differentiated
                && !actual.iter().any(|a| {
                    actual
                        .iter()
                        .any(|b| (a.width_m - b.width_m).abs() >= 0.2 - 1e-9)
                })
            {
                return Err(format!("Ménage {owner} : portes différenciées absentes."));
            }
        }
    }
    if let Some(program) = &parameters.site_gate_profile {
        let count = site_entries(unit, program).len();
        if count < program.count[0] as usize || count > program.count[1] as usize {
            return Err(format!(
                "Enclos : {count} portes, profil source {}–{} requis.",
                program.count[0], program.count[1]
            ));
        }
    }
    Ok(())
}
