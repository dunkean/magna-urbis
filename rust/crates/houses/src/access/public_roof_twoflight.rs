//! Prototype27j2 only: exact closed two-flight token, mirrored material heads.
use super::*;

const SUFFIX: &str = ":outboard-two-flight-eaves";
const FINAL: usize = 2;

pub(super) fn heads(frame: Frame) -> Surface {
    let mut heads = frame.rect(0.03, -outboard::SHIFT, 0.28, outboard::SHIFT);
    heads.extend(frame.rect(0.03, DEPTH, 0.28, outboard::SHIFT));
    heads
}

pub(super) fn floor(frame: Frame) -> Surface {
    let mut ring = [
        (0.025, -frame.distance),
        (0.875, -frame.distance),
        (0.875, 0.0),
        (0.9, 0.0),
        (0.9, 1.0),
        (0.8, 1.0),
        (0.8, DEPTH),
        (0.31, DEPTH),
        (0.31, 2.04),
        (0.03, 2.04),
        (0.03, DEPTH),
        (0.0, DEPTH),
        (0.0, 0.0),
        (0.025, 0.0),
    ]
    .into_iter()
    .map(|(x, y)| frame.at(x, y))
    .collect::<Vec<_>>();
    if signed_area(&ring) < 0.0 {
        ring.reverse();
    }
    vec![Polygon {
        outer: ring,
        holes: vec![],
    }]
}

pub(super) fn additions(frame: Frame) -> Surface {
    frame.rect(0.025, -frame.distance, 0.85, frame.distance)
}

/// Called only after the predecessor modes by the owner's real-order hook.
pub(super) fn add_route(
    unit: &mut HouseUnit,
    bases: &[AccessNode],
    target: &AccessNode,
) -> Result<bool, String> {
    search(unit, bases, target, false, false)
}

pub(super) fn add_grid_route(
    unit: &mut HouseUnit,
    bases: &[AccessNode],
    target: &AccessNode,
) -> Result<bool, String> {
    search(unit, bases, target, true, false)
}

pub(super) fn add_viga_route(
    unit: &mut HouseUnit,
    bases: &[AccessNode],
    target: &AccessNode,
) -> Result<bool, String> {
    if !vigas::eligible(unit) {
        return Ok(false);
    }
    search(unit, bases, target, true, true)
}

fn search(
    unit: &mut HouseUnit,
    bases: &[AccessNode],
    target: &AccessNode,
    grid: bool,
    cut_viga: bool,
) -> Result<bool, String> {
    for minimal in [false, true] {
        for shifted in [false, true] {
            for base in bases {
                let heights = stops(unit, base.z_m, target.z_m, minimal);
                if heights.len() != 2 {
                    continue;
                }
                for polygon in &target.floor {
                    for (&a, &b) in polygon
                        .outer
                        .iter()
                        .zip(polygon.outer.iter().cycle().skip(1))
                        .take(polygon.outer.len())
                    {
                        let length = libm::hypot(b.x - a.x, b.y - a.y);
                        if length < PAD + 2.0 * GAP {
                            continue;
                        }
                        let tangent = Point {
                            x: (b.x - a.x) / length,
                            y: (b.y - a.y) / length,
                        };
                        for sign in [1.0, -1.0] {
                            for ratio in [0.5, 0.25, 0.75] {
                                for offset in [0.0, RUN] {
                                    let outward = Point {
                                        x: sign * tangent.y,
                                        y: -sign * tangent.x,
                                    };
                                    let edge = point(
                                        a.x + tangent.x * (length * ratio - PAD * 0.5 - offset),
                                        a.y + tangent.y * (length * ratio - PAD * 0.5 - offset),
                                    );
                                    let legacy = Frame {
                                        origin: point(
                                            edge.x + outward.x * GAP,
                                            edge.y + outward.y * GAP,
                                        ),
                                        tangent,
                                        outward,
                                        distance: GAP,
                                    };
                                    let distances = if shifted {
                                        bridge::distances(unit, base, legacy, edge)
                                    } else {
                                        vec![GAP]
                                    };
                                    for distance in distances {
                                        let distance = distance + outboard::SHIFT;
                                        if distance > outboard::DISTANCE_MAX + 1e-9 {
                                            continue;
                                        }
                                        let initial = Frame {
                                            origin: point(
                                                edge.x + outward.x * distance,
                                                edge.y + outward.y * distance,
                                            ),
                                            tangent,
                                            outward,
                                            distance,
                                        };
                                        let plan = initial.rect(0.0, 0.0, RUN + PAD, DEPTH);
                                        if area(&difference(&plan, &base.floor)) > AREA_EPS
                                            || blocked(unit, &plan, base.z_m)
                                        {
                                            continue;
                                        }
                                        let (opening, passage) = bridge::passage(initial, false);
                                        // This is a measurement copy, not an accepted token:
                                        // the declared two-flight event requires d > .54.
                                        let mut measure = unit.clone();
                                        if install_mode(
                                            &mut measure,
                                            base,
                                            target,
                                            initial,
                                            &heights,
                                            opening,
                                            passage,
                                            floor(initial),
                                            RouteMode::OutboardTwoFlight,
                                        )
                                        .is_err()
                                        {
                                            continue;
                                        }
                                        let mut profile = measure.clone();
                                        crate::roofs::build_roofs_with_budget(
                                            &mut profile,
                                            crate::engine::MAX_BATCH_FACES as usize,
                                        )?;
                                        let event = outboard::twoflight_event(
                                            &profile, &measure, initial, base.z_m, target.z_m,
                                        )?;
                                        if event.is_none() && !grid {
                                            continue;
                                        }
                                        let candidates: Vec<f64> = if grid {
                                            (541..=570).map(|k| snap(k as f64 * GRID_M)).collect()
                                        } else {
                                            event.into_iter().collect()
                                        };
                                        for distance in candidates {
                                            let frame = Frame {
                                                origin: point(
                                                    edge.x + outward.x * distance,
                                                    edge.y + outward.y * distance,
                                                ),
                                                distance,
                                                ..initial
                                            };

                                            let plan = frame.rect(0.0, 0.0, RUN + PAD, DEPTH);
                                            let top = floor(frame);
                                            let (opening, passage) = bridge::passage(frame, false);
                                            let prepared = if cut_viga {
                                                let Some(before) =
                                                    vigas::prepare(unit, target, &passage)
                                                else {
                                                    continue;
                                                };
                                                Some(before)
                                            } else {
                                                None
                                            };
                                            let before = prepared.as_ref().unwrap_or(unit);
                                            if area(&difference(&plan, &base.floor)) > AREA_EPS
                                                || blocked(unit, &plan, base.z_m)
                                                || !bridge::admissible_external(
                                                    before,
                                                    target,
                                                    frame,
                                                    &top,
                                                    &passage,
                                                    &heads(frame),
                                                    outboard::BearingMode::OutboardTwoFlight,
                                                )
                                            {
                                                continue;
                                            }
                                            let mut candidate = before.clone();
                                            if let Err(_error) = install_mode(
                                                &mut candidate,
                                                base,
                                                target,
                                                frame,
                                                &heights,
                                                opening,
                                                passage,
                                                top,
                                                RouteMode::OutboardTwoFlight,
                                            )
                                            .and_then(|_| validate_geometry(&candidate, false))
                                            {
                                                continue;
                                            }
                                            let mut profile = candidate.clone();
                                            crate::roofs::build_roofs_with_budget(
                                                &mut profile,
                                                crate::engine::MAX_BATCH_FACES as usize,
                                            )?;
                                            if let Err(_error) = validate_geometry(&profile, true) {
                                                continue;
                                            }
                                            // Repeat the actual reconstruction from the unmeshed
                                            // candidate, with exact equality before handing off.
                                            let mut repeated = candidate.clone();
                                            crate::roofs::build_roofs_with_budget(
                                                &mut repeated,
                                                crate::engine::MAX_BATCH_FACES as usize,
                                            )?;
                                            if serde_json::to_vec(&profile.roofs)
                                                .map_err(|e| e.to_string())?
                                                != serde_json::to_vec(&repeated.roofs)
                                                    .map_err(|e| e.to_string())?
                                            {
                                                return Err(
                                                "Profil pair : maillage reconstruit non identique."
                                                    .into(),
                                            );
                                            }

                                            *unit = candidate;
                                            return Ok(true);
                                        }
                                    }
                                }
                            }
                        }
                    }
                }
            }
        }
    }
    Ok(false)
}

fn same_point(a: Point, b: Point) -> bool {
    a.x.to_bits() == b.x.to_bits() && a.y.to_bits() == b.y.to_bits()
}

fn same_ring(a: &[Point], b: &[Point]) -> bool {
    a.len() == b.len()
        && (0..b.len()).any(|shift| {
            a.iter()
                .enumerate()
                .all(|(i, &p)| same_point(p, b[(i + shift) % b.len()]))
        })
}

fn same_surface(a: &Surface, b: &Surface) -> bool {
    a.len() == b.len()
        && a.iter().zip(b).all(|(a, b)| {
            same_ring(&a.outer, &b.outer)
                && a.holes.len() == b.holes.len()
                && a.holes.iter().zip(&b.holes).all(|(a, b)| same_ring(a, b))
        })
}

struct Route<'a> {
    key: String,
    head: &'a Feature,
    nodes: Vec<&'a AccessNode>,
    portals: Vec<&'a Portal>,
    base: &'a AccessNode,
    target: &'a AccessNode,
}

fn route<'a>(unit: &'a HouseUnit, head: &'a Feature) -> Result<Route<'a>, String> {
    let key = head
        .id
        .strip_suffix(":landing:2")
        .ok_or("Cadre pair sans palier final2.")?;
    let serial = key
        .strip_suffix(SUFFIX)
        .and_then(|s| s.strip_prefix(&format!("{}:public-roof:", unit.id)))
        .and_then(|s| s.parse::<usize>().ok())
        .ok_or("Jeton fermé pair invalide.")?;
    let find = |id: &str| -> Result<&AccessNode, String> {
        let matches = unit
            .access
            .nodes
            .iter()
            .filter(|n| n.id == id)
            .collect::<Vec<_>>();
        if matches.len() != 1 {
            return Err("Cadre pair sans nœud unique.".into());
        }
        Ok(matches[0])
    };
    let mut portals = vec![];
    for i in 0..4 {
        let id = format!("{}:portal:{}", unit.id, serial + i);
        let matches = unit
            .access
            .portals
            .iter()
            .filter(|p| p.id == id)
            .collect::<Vec<_>>();
        if matches.len() != 1 {
            return Err("Cadre pair sans quatre portails natifs ordonnés.".into());
        }
        portals.push(matches[0]);
    }
    let base = find(&portals[0].from)?;
    let target = find(&portals[3].to)?;
    let nodes = [
        find(&portals[0].to)?,
        find(&portals[1].to)?,
        find(&portals[2].to)?,
    ]
    .to_vec();
    if portals[0].kind != PortalKind::Passage
        || portals[3].kind != PortalKind::Passage
        || base.household_id.is_some()
        || matches!(base.kind, AccessKind::Room | AccessKind::StairLanding)
        || !public_reachable(unit).contains(&base.id)
        || target.kind != AccessKind::Terrace
        || target.household_id.is_some()
        || portals[3].from != nodes[2].id
        || portals[3].feature_ids != vec![head.id.clone()]
        || unit
            .access
            .portals
            .iter()
            .filter(|p| p.from == nodes[2].id && p.kind == PortalKind::Passage)
            .count()
            != 1
        || unit.access.portals.iter().any(|p| {
            p.from == nodes[2].id && matches!(p.kind, PortalKind::Stair | PortalKind::Ladder)
        })
    {
        return Err("Cadre pair sans départ public et arrivée uniques.".into());
    }
    for i in 0..2 {
        let id = format!("{key}:flight:{i}");
        let flights = unit
            .features
            .iter()
            .filter(|f| f.id == id)
            .collect::<Vec<_>>();
        let interfaces = unit
            .access
            .portals
            .iter()
            .filter(|p| p.feature_ids.contains(&id))
            .collect::<Vec<_>>();
        if flights.len() != 1
            || flights[0].kind != FeatureKind::Ladder
            || flights[0].vertices3d.len() != 4
            || interfaces.len() != 1
            || interfaces[0].id != portals[i + 1].id
            || portals[i + 1].kind != PortalKind::Ladder
            || portals[i + 1].feature_ids != vec![id]
            || portals[i + 1].from != nodes[i].id
            || portals[i + 1].to != nodes[i + 1].id
        {
            return Err("Cadre pair sans chaîne unique Ladder0/1.".into());
        }
    }
    if unit
        .features
        .iter()
        .filter(|f| f.id.starts_with(&format!("{key}:flight:")))
        .count()
        != 2
        || unit
            .features
            .iter()
            .filter(|f| {
                f.id.starts_with(&format!("{key}:landing:")) && f.kind == FeatureKind::Landing
            })
            .count()
            != 3
    {
        return Err("Cadre pair avec volée ou palier supplémentaire.".into());
    }
    for (i, node) in nodes.iter().enumerate() {
        let id = format!("{key}:landing:{i}");
        let slabs = unit
            .features
            .iter()
            .filter(|f| f.id == id)
            .collect::<Vec<_>>();
        if slabs.len() != 1
            || slabs[0].kind != FeatureKind::Landing
            || node.kind != AccessKind::StairLanding
            || node.household_id.is_some()
            || node.z_m.to_bits() != slabs[0].z_m.to_bits()
            || !same_surface(&node.floor, &slabs[0].surface)
        {
            return Err("Cadre pair sans trois sols natifs identiques.".into());
        }
    }
    Ok(Route {
        key: key.into(),
        head,
        nodes,
        portals,
        base,
        target,
    })
}

pub(super) fn mode(unit: &HouseUnit, slab: &Feature) -> Result<outboard::BearingMode, String> {
    let (key, index) = slab
        .id
        .rsplit_once(":landing:")
        .ok_or("Cadre pair sans index.")?;
    let index = index.parse::<usize>().map_err(|_| "Index pair invalide.")?;
    let heads = unit
        .features
        .iter()
        .filter(|f| f.id == format!("{key}:landing:2"))
        .collect::<Vec<_>>();
    if index > FINAL || heads.len() != 1 {
        return Err("Cadre pair hors de deux volées.".into());
    }
    route(unit, heads[0])?;
    Ok(if index == FINAL {
        outboard::BearingMode::OutboardTwoFlight
    } else {
        outboard::BearingMode::Legacy
    })
}

/// The native opening selects the axis; the actual ring and Passage must then
/// reproduce every XY bit under frame.at. Columns are never used as authority.
fn recorded_frame(route: &Route<'_>) -> Result<Frame, String> {
    let p = route.portals[3];
    let [a, b] = p.opening;
    let length = libm::hypot(b.x - a.x, b.y - a.y);
    if length == 0.0 || !length.is_finite() {
        return Err("Ouverture paire sans axe fini.".into());
    }
    let tangent = Point {
        x: (b.x - a.x) / length,
        y: (b.y - a.y) / length,
    };
    let origin = point(a.x - tangent.x * 0.025, a.y - tangent.y * 0.025);
    let mut candidates = vec![];
    for sign in [1.0, -1.0] {
        let outward = Point {
            x: sign * tangent.y,
            y: -sign * tangent.x,
        };
        let distance = snap(
            -rings(&route.head.surface)
                .flatten()
                .map(|p| (p.x - origin.x) * outward.x + (p.y - origin.y) * outward.y)
                .fold(f64::INFINITY, f64::min),
        );
        if distance <= outboard::DISTANCE_MAX + 1e-9 || distance > 0.57 + 1e-9 {
            continue;
        }
        let frame = Frame {
            origin,
            tangent,
            outward,
            distance,
        };
        let (opening, passage) = bridge::passage(frame, false);
        if same_surface(&floor(frame), &route.head.surface)
            && same_surface(&passage, &p.passage)
            && opening
                .iter()
                .zip(p.opening)
                .all(|(&a, b)| same_point(a, b))
        {
            candidates.push(frame);
        }
    }
    if candidates.len() != 1 {
        return Err("Frame pair non unique ou dalle/Passage non bit-exacts.".into());
    }
    Ok(candidates[0])
}

/// Reuse the complete native chain, opening and ring certificates. No columns
/// or prefix alone can give a Viga aperture its final provenance.
pub(super) fn certified_terminals(unit: &HouseUnit) -> Result<Vec<(&AccessNode, &Portal)>, String> {
    let mut out = vec![];
    for head in unit.features.iter().filter(|f| {
        f.kind == FeatureKind::Landing && f.id.ends_with(":outboard-two-flight-eaves:landing:2")
    }) {
        let route = route(unit, head)?;
        let frame = recorded_frame(&route)?;
        reconstruct(unit, &route, frame)?;
        out.push((route.target, route.portals[3]));
    }
    Ok(out)
}

#[cfg(test)]
pub(super) fn install31_fixture(mut unit: HouseUnit) -> HouseUnit {
    let source_head = unit
        .features
        .iter()
        .find(|head| {
            head.kind == FeatureKind::Landing
                && head.id.ends_with(":outboard-two-flight-eaves:landing:2")
                && route(&unit, head).is_ok_and(|r| r.target.id.ends_with(":space:30"))
        })
        .unwrap();
    let r = route(&unit, source_head).unwrap();
    let base = r.base.clone();
    let heights = [r.nodes[1].z_m, r.nodes[2].z_m];
    let distance = recorded_frame(&r).unwrap().distance;
    let target = unit
        .access
        .nodes
        .iter()
        .find(|n| n.id.ends_with(":space:31"))
        .unwrap()
        .clone();
    let top_y = bounds(&target.floor)[3];
    let (a, b) = target
        .floor
        .iter()
        .flat_map(|p| {
            p.outer
                .iter()
                .copied()
                .zip(p.outer.iter().copied().cycle().skip(1))
                .take(p.outer.len())
        })
        .find(|(a, b)| a.y == top_y && b.y == top_y)
        .unwrap();
    let length = libm::hypot(b.x - a.x, b.y - a.y);
    let tangent = Point {
        x: (b.x - a.x) / length,
        y: (b.y - a.y) / length,
    };
    let outward = Point {
        x: tangent.y,
        y: -tangent.x,
    };
    let edge = point(
        a.x + tangent.x * (length * 0.25 - PAD * 0.5),
        a.y + tangent.y * (length * 0.25 - PAD * 0.5),
    );
    let frame = Frame {
        origin: point(edge.x + outward.x * distance, edge.y + outward.y * distance),
        tangent,
        outward,
        distance,
    };
    let (opening, passage) = bridge::passage(frame, false);
    unit = vigas::prepare(&unit, &target, &passage).unwrap();
    install_mode(
        &mut unit,
        &base,
        &target,
        frame,
        &heights,
        opening,
        passage,
        floor(frame),
        RouteMode::OutboardTwoFlight,
    )
    .unwrap();
    unit
}

fn reconstruct(unit: &HouseUnit, route: &Route<'_>, frame: Frame) -> Result<(), String> {
    let mut expected = unit.clone();
    expected.features.clear();
    expected.walls.clear();
    expected.access.nodes = vec![route.base.clone(), route.target.clone()];
    expected.access.portals.clear();
    expected.roofs = RoofMesh::default();
    let (opening, passage) = bridge::passage(frame, false);
    install_mode(
        &mut expected,
        route.base,
        route.target,
        frame,
        &[route.nodes[1].z_m, route.nodes[2].z_m],
        opening,
        passage,
        floor(frame),
        RouteMode::OutboardTwoFlight,
    )?;
    let expected_key = format!("{}:public-roof:0{SUFFIX}", unit.id);
    let pieces = unit
        .features
        .iter()
        .filter(|f| f.id.starts_with(&format!("{}:", route.key)))
        .collect::<Vec<_>>();
    if pieces.len() != expected.features.len() {
        return Err("Cadre pair avec pièce ajoutée ou manquante.".into());
    }
    for f in &expected.features {
        let mut f = f.clone();
        f.id = f.id.replace(&expected_key, &route.key);
        let matches = pieces.iter().filter(|a| a.id == f.id).collect::<Vec<_>>();
        if matches.len() != 1
            || **matches[0] != f
            || !same_surface(&matches[0].surface, &f.surface)
            || matches[0]
                .vertices3d
                .iter()
                .zip(&f.vertices3d)
                .any(|(a, b)| {
                    a.x.to_bits() != b.x.to_bits()
                        || a.y.to_bits() != b.y.to_bits()
                        || a.z.to_bits() != b.z.to_bits()
                })
        {
            return Err(format!("Cadre pair différent de sa pièce native {}.", f.id));
        }
    }
    let mut map = BTreeMap::from([
        (route.base.id.clone(), route.base.id.clone()),
        (route.target.id.clone(), route.target.id.clone()),
    ]);
    for (i, node) in route.nodes.iter().enumerate() {
        let expected_node = expected
            .access
            .nodes
            .iter()
            .find(|n| n.id == expected.access.portals[i].to)
            .unwrap();
        if node.kind != expected_node.kind
            || node.household_id != expected_node.household_id
            || node.z_m.to_bits() != expected_node.z_m.to_bits()
            || !same_surface(&node.floor, &expected_node.floor)
        {
            return Err("Cadre pair différent de ses sols natifs.".into());
        }
        map.insert(expected_node.id.clone(), node.id.clone());
    }
    for (i, p) in expected.access.portals.iter().enumerate() {
        let mut p = p.clone();
        p.id = route.portals[i].id.clone();
        p.from = map[&p.from].clone();
        p.to = map[&p.to].clone();
        p.feature_ids = p
            .feature_ids
            .iter()
            .map(|id| id.replace(&expected_key, &route.key))
            .collect();
        let actual = route.portals[i];
        if p != *actual
            || !same_surface(&p.passage, &actual.passage)
            || !same_surface(&p.opening_surface, &actual.opening_surface)
            || !p
                .opening
                .iter()
                .zip(actual.opening)
                .all(|(&a, b)| same_point(a, b))
        {
            return Err("Cadre pair différent de ses quatre interfaces natives.".into());
        }
    }
    Ok(())
}

fn roof_prisms(unit: &HouseUnit, route: &Route<'_>, frame: Frame) -> Result<(), String> {
    let d = frame.distance;
    let limit = d + 0.2;
    let passage_part = frame.rect(0.025, -d, 0.85, d + limit);
    let outside = [
        frame.rect(0.0, 0.0, 0.025, limit),
        frame.rect(0.875, 0.0, 0.025, limit),
        frame.rect(0.0, limit, 0.9, 1.0 - limit),
        frame.rect(0.0, 1.0, 0.8, 0.9),
        frame.rect(0.03, DEPTH, 0.28, outboard::SHIFT),
    ];
    let all = unite(&outside);
    let covered = union(&all, &passage_part);
    if area(&difference(&route.head.surface, &covered))
        + area(&difference(&covered, &route.head.surface))
        > AREA_EPS
        || area(&intersection(&all, &passage_part)) > AREA_EPS
        || area(&difference(&passage_part, &route.portals[3].passage)) > AREA_EPS
    {
        return Err("Cadre pair : masques explicites sans couverture/disjonction native.".into());
    }
    bridge::validate(unit, route.portals[3], true)?;
    // Convex rectangles go directly to the closed clipper, without earcut.
    for (i, mask) in outside.iter().enumerate() {
        closed_rectangle(
            unit,
            &format!("{}:hors-passage:{i}", route.head.id),
            mask,
            route.head.z_m,
        )?;
    }
    for (i, polygon) in heads(frame).into_iter().enumerate() {
        closed_rectangle(
            unit,
            &format!("{}:tete:{i}", route.head.id),
            &vec![polygon],
            route.head.z_m,
        )?;
    }
    for index in 0..=2 {
        let slab = unit
            .features
            .iter()
            .find(|f| f.id == format!("{}:landing:{index}", route.key))
            .unwrap();
        if index == 0 {
            if area(&difference(&slab.surface, &route.base.floor)) > AREA_EPS {
                return Err("Départ pair sans sol public entier.".into());
            }
            if area(&intersection(
                &slab.surface,
                &native_link_occupation(unit, route.base)?,
            )) > AREA_EPS
            {
                return Err("Départ pair dans occupation réelle d'un lien natif.".into());
            }
            route_roofs::prism(unit, &slab.id, &slab.surface, slab.z_m, Some(route.base))?;
        } else {
            for i in 0..4 {
                let post = unit
                    .features
                    .iter()
                    .find(|f| f.id == format!("{}:post:{i}", slab.id))
                    .ok_or("Poteau pair absent.")?;
                route_roofs::post(unit, post)?;
            }
            if index == 1 {
                route_roofs::prism(unit, &slab.id, &slab.surface, slab.z_m, None)?;
            }
        }
    }
    for i in 0..2 {
        let flight = unit
            .features
            .iter()
            .find(|f| f.id == format!("{}:flight:{i}", route.key))
            .unwrap();
        route_roofs::flight(unit, flight)?;
    }
    // Full Passage C cannot enter a native link's occupation, even where a
    // coplanar Slab would otherwise be accepted by the unchanged bridge guard.
    for face in &unit.roofs.faces {
        if face.kind != RoofFaceKind::Slab {
            continue;
        }
        let vertices = face
            .vertices
            .iter()
            .map(|&i| {
                unit.roofs
                    .vertices
                    .get(i as usize)
                    .cloned()
                    .ok_or("Indice pair invalide.")
            })
            .collect::<Result<Vec<_>, _>>()?;
        let cut = bridge::clip(&vertices, &route.portals[3].passage)?;
        if cut.is_empty() || !cut.iter().all(|v| (v.z - route.head.z_m).abs() <= 1e-9) {
            continue;
        }
        let surface = vec![Polygon {
            outer: cut.iter().map(|v| Point { x: v.x, y: v.y }).collect(),
            holes: vec![],
        }];
        if area(&surface) == 0.0 {
            continue;
        }
        if !route_roofs::terminal_slab(unit, face, route.target, &surface)?
            || area(&intersection(
                &surface,
                &native_link_occupation(unit, route.target)?,
            )) > AREA_EPS
        {
            return Err("Coplanar pair hors Slab native ou dans occupation réelle.".into());
        }
    }
    Ok(())
}

fn closed_rectangle(unit: &HouseUnit, id: &str, mask: &Surface, z: f64) -> Result<(), String> {
    for (i, face) in unit.roofs.faces.iter().enumerate() {
        let vertices = face
            .vertices
            .iter()
            .map(|&v| {
                unit.roofs
                    .vertices
                    .get(v as usize)
                    .cloned()
                    .ok_or("Indice pair invalide.")
            })
            .collect::<Result<Vec<_>, _>>()?;
        let clipped = bridge::clip(&vertices, mask)?;
        if clipped.is_empty() {
            continue;
        }
        let min = clipped.iter().map(|v| v.z).fold(f64::INFINITY, f64::min);
        let max = clipped
            .iter()
            .map(|v| v.z)
            .fold(f64::NEG_INFINITY, f64::max);
        if max > z - 0.15 + CONTACT && min < z + 2.05 - CONTACT {
            return Err(format!(
                "{id} : prisme pair fermé dans toiture {} face {i}.",
                face.roof_group
            ));
        }
    }
    Ok(())
}

pub(super) fn validate(unit: &HouseUnit, check_roofs: bool) -> Result<(), String> {
    let heads = unit
        .features
        .iter()
        .filter(|f| {
            f.kind == FeatureKind::Landing && f.id.ends_with(":outboard-two-flight-eaves:landing:2")
        })
        .collect::<Vec<_>>();
    for piece in unit
        .features
        .iter()
        .filter(|f| f.id.contains(":outboard-two-flight"))
    {
        if !heads.iter().any(|h| {
            h.id.strip_suffix(":landing:2")
                .is_some_and(|key| piece.id.starts_with(&format!("{key}:")))
        }) {
            return Err("Pièce paire sans jeton fermé complet.".into());
        }
    }
    for head in heads {
        let route = route(unit, head)?;
        let frame = recorded_frame(&route)?;
        reconstruct(unit, &route, frame)?;
        if check_roofs {
            outboard::certify_twoflight_event(unit, head, frame, route.base.z_m)?;
            roof_prisms(unit, &route, frame)?;
        }
    }
    Ok(())
}

#[cfg(test)]
mod tests {
    use super::*;

    fn fixture(d: f64, overhang: f64) -> HouseUnit {
        let mut unit = outboard::eaves_fixture(d);
        let base = unit
            .access
            .nodes
            .iter()
            .find(|n| n.id == "base")
            .unwrap()
            .clone();
        let mut target = unit
            .access
            .nodes
            .iter()
            .find(|n| n.id == "roof")
            .unwrap()
            .clone();
        target.z_m = snap(5.6);
        unit.features.clear();
        unit.access.portals.clear();
        unit.access.nodes = vec![base.clone(), target.clone()];
        let body = &mut unit.bodies[0];
        body.levels.truncate(2);
        body.overhang_m = overhang;
        body.levels[1].roof_slab = Some(RoofSlab {
            surface: target.floor.clone(),
            z_m: target.z_m,
            walkable: true,
            access_node: Some(target.id.clone()),
        });
        let component_id = body.component_id.clone();
        unit.roofs = RoofMesh::default();
        let frame = Frame {
            origin: point(0.0, 0.0),
            tangent: point(1.0, 0.0),
            outward: point(0.0, 1.0),
            distance: d,
        };
        let (opening, passage) = bridge::passage(frame, false);
        assert_eq!(
            bridge::admissible_external(
                &unit,
                &target,
                frame,
                &floor(frame),
                &passage,
                &heads(frame),
                outboard::BearingMode::OutboardTwoFlight
            ),
            d <= 0.57
        );
        install_mode(
            &mut unit,
            &base,
            &target,
            frame,
            &[snap(2.8), target.z_m],
            opening,
            passage,
            floor(frame),
            RouteMode::OutboardTwoFlight,
        )
        .unwrap();
        for i in 0..2 {
            let surface = if i == 0 {
                rectangle(-3.0, -4.0, 10.0, 4.0 - d + overhang)
            } else {
                target.floor.clone()
            };
            let group = format!(
                "native:{i}:{}",
                if i == 0 { "intermediate" } else { "main" }
            );
            let offset = unit.roofs.vertices.len() as u32;
            unit.roofs
                .vertices
                .extend(surface[0].outer.iter().map(|p| Vertex3 {
                    x: p.x,
                    y: p.y,
                    z: snap((i + 1) as f64 * 2.8),
                }));
            unit.roofs.faces.push(RoofFace {
                body_id: "native".into(),
                feature_id: None,
                level: i,
                kind: RoofFaceKind::Slab,
                rf: "RF-FLAT".into(),
                roof_group: group.clone(),
                component_id: component_id.clone(),
                vertices: (offset..offset + 4).collect(),
                material: "MAT-STONE-DRY".into(),
                normal: [0.0, 0.0, 1.0],
            });
            unit.roofs.groups.push(RoofGroup {
                id: group,
                rf: "RF-FLAT".into(),
                body_id: "native".into(),
                feature_id: None,
                room_id: None,
                level: i,
                domain: surface,
            });
        }
        unit
    }

    fn head(unit: &HouseUnit) -> &Feature {
        unit.features
            .iter()
            .find(|f| f.id.ends_with(":outboard-two-flight-eaves:landing:2"))
            .unwrap()
    }

    fn foreign_face(unit: &mut HouseUnit, surface: Surface, z: f64, kind: RoofFaceKind) {
        let offset = unit.roofs.vertices.len() as u32;
        unit.roofs.vertices.extend(
            surface[0]
                .outer
                .iter()
                .map(|p| Vertex3 { x: p.x, y: p.y, z }),
        );
        let mut face = unit.roofs.faces[0].clone();
        face.vertices = (offset..offset + surface[0].outer.len() as u32).collect();
        face.roof_group = "foreign".into();
        face.kind = kind;
        unit.roofs.faces.push(face);
    }

    #[test]
    fn two_flights_even_heads_and_minimal_events_are_actual_material() {
        for (d, overhang) in [(0.558, 0.417), (0.559, 0.418)] {
            let unit = fixture(d, overhang);
            validate_geometry(&unit, true).unwrap();
            let frame = recorded_frame(&route(&unit, head(&unit)).unwrap()).unwrap();
            assert_eq!(frame.distance.to_bits(), snap(d).to_bits());
            assert_eq!(
                unit.features
                    .iter()
                    .filter(|f| f.kind == FeatureKind::Ladder)
                    .count(),
                2
            );
            let (_, _, _, mode) = bridge::bearings(&unit, head(&unit)).unwrap();
            assert!(mode == outboard::BearingMode::OutboardTwoFlight);
            assert_eq!(
                outboard::twoflight_event(&unit, &unit, frame, 0.0, 5.6).unwrap(),
                Some(snap(d))
            );
            let (centres, _, _, _) = bridge::bearings(&unit, head(&unit)).unwrap();
            assert_eq!(
                centres.iter().map(|p| snap(p.x)).collect::<Vec<_>>(),
                vec![0.1, 0.24, 0.1, 0.24]
            );
            for post in unit
                .features
                .iter()
                .filter(|f| f.id.starts_with(&format!("{}:post:", head(&unit).id)))
            {
                assert!(area(&difference(&post.surface, &heads(frame))) <= AREA_EPS);
            }
        }
    }

    #[test]
    fn exact_closed_token_refuses_extra_missing_mixed_and_wrong_final() {
        let unit = fixture(0.558, 0.417);
        for mutation in 0..7 {
            let mut broken = unit.clone();
            match mutation {
                0 => {
                    broken.features.retain(|f| !f.id.ends_with(":flight:1"));
                }
                1 => {
                    let mut f = broken
                        .features
                        .iter()
                        .find(|f| f.id.ends_with(":flight:1"))
                        .unwrap()
                        .clone();
                    f.id = f.id.replace(":flight:1", ":flight:2");
                    broken.features.push(f);
                }
                2 => {
                    broken
                        .features
                        .iter_mut()
                        .find(|f| f.id.ends_with(":flight:1"))
                        .unwrap()
                        .kind = FeatureKind::Stair;
                }
                3 => {
                    broken
                        .access
                        .portals
                        .last_mut()
                        .unwrap()
                        .feature_ids
                        .clear();
                }
                4 => {
                    let id = head(&broken).id.clone();
                    broken.features.iter_mut().find(|f| f.id == id).unwrap().id =
                        id.replace(":landing:2", ":landing:3");
                }
                5 => {
                    broken
                        .features
                        .iter_mut()
                        .find(|f| f.id.ends_with(":landing:2:post:0"))
                        .unwrap()
                        .surface = rectangle(1.89, -0.14, 0.14, 0.14);
                }
                _ => {
                    for f in &mut broken.features {
                        f.id = f.id.replace(SUFFIX, ":outboard-two-flight-eaves:band-open");
                    }
                    for p in &mut broken.access.portals {
                        for id in &mut p.feature_ids {
                            *id = id.replace(SUFFIX, ":outboard-two-flight-eaves:band-open");
                        }
                    }
                }
            }
            assert!(
                validate_geometry(&broken, false).is_err(),
                "mutation={mutation}"
            );
        }
    }

    #[test]
    fn frame_is_opening_and_ring_exact_without_column_inference() {
        let unit = fixture(0.558, 0.417);
        for mutation in 0..3 {
            let mut broken = unit.clone();
            match mutation {
                0 => broken.access.portals.last_mut().unwrap().opening[0].x += 0.001,
                1 => {
                    broken
                        .features
                        .iter_mut()
                        .find(|f| f.id.ends_with(":landing:2"))
                        .unwrap()
                        .surface[0]
                        .outer[0]
                        .y += 0.001
                }
                _ => broken.access.portals.last_mut().unwrap().passage[0].outer[0].x += 0.001,
            }
            assert!(validate(&broken, false).is_err());
        }
    }

    #[test]
    fn both_heads_have_closed_prisms_even_inside_passage() {
        let unit = fixture(0.558, 0.417);
        let r = route(&unit, head(&unit)).unwrap();
        let f = recorded_frame(&r).unwrap();
        for mask in [f.rect(0.04, -0.13, 0.1, 0.1), f.rect(0.04, 1.91, 0.1, 0.1)] {
            let mut broken = unit.clone();
            foreign_face(&mut broken, mask, 5.6, RoofFaceKind::Slab);
            assert!(validate_geometry(&broken, true).is_err());
            assert!(heads(f).iter().any(|head| {
                closed_rectangle(&broken, "own-head-independent", &vec![head.clone()], 5.6).is_err()
            }));
        }
        let mut broken = unit.clone();
        foreign_face(
            &mut broken,
            f.rect(0.02, -0.14, 0.01, 0.14),
            5.6,
            RoofFaceKind::Parapet,
        );
        assert!(validate_geometry(&broken, true).is_err());
        assert!(
            closed_rectangle(
                &broken,
                "own-front-head",
                &f.rect(0.03, -0.14, 0.28, 0.14),
                5.6
            )
            .is_err()
        );
    }

    #[test]
    fn legacy_intermediate_and_both_flights_posts_remain_closed() {
        let unit = fixture(0.558, 0.417);
        for suffix in [
            ":landing:1",
            ":landing:1:post:0",
            ":landing:2:post:0",
            ":flight:0",
            ":flight:1",
        ] {
            let mut broken = unit.clone();
            let f = broken
                .features
                .iter()
                .find(|f| f.id.ends_with(suffix))
                .unwrap()
                .clone();
            let z = if f.kind == FeatureKind::Post {
                1.4
            } else if f.kind == FeatureKind::Ladder {
                f.z_m + 1.4
            } else {
                f.z_m
            };
            foreign_face(&mut broken, f.surface, z, RoofFaceKind::Slab);
            assert!(validate_geometry(&broken, true).is_err(), "suffix={suffix}");
        }
    }

    #[test]
    fn lot_four_feet_base_rows_and_bearing_limits_are_not_exemptions() {
        let unit = fixture(0.558, 0.417);
        for mutation in 0..5 {
            let mut broken = unit.clone();
            let h = head(&broken).clone();
            let foot = broken
                .features
                .iter()
                .find(|f| f.id == format!("{}:post:2", h.id))
                .unwrap()
                .surface
                .clone();
            match mutation {
                0 => broken.lot = difference(&broken.lot, &foot),
                1 => {
                    let base = broken
                        .access
                        .nodes
                        .iter_mut()
                        .find(|n| n.id == "base")
                        .unwrap();
                    base.floor = difference(&base.floor, &foot);
                }
                2 => {
                    broken
                        .features
                        .retain(|f| f.id != format!("{}:post:3", h.id));
                }
                3 => {
                    broken
                        .features
                        .iter_mut()
                        .find(|f| f.id == format!("{}:post:2", h.id))
                        .unwrap()
                        .surface = translate(&foot, 0.0, -0.001);
                }
                _ => {
                    let extra = rectangle(0.03, 2.04, 0.28, 0.001);
                    let slab = broken.features.iter_mut().find(|f| f.id == h.id).unwrap();
                    slab.surface = union(&slab.surface, &extra);
                }
            }
            assert!(
                validate_geometry(&broken, false).is_err(),
                "mutation={mutation}"
            );
        }
        for (d, overhang) in [
            (0.557, 0.417),
            (0.559, 0.417),
            (0.571, 0.430),
            (0.540, 0.417),
        ] {
            // Construction is isolated here; all out-of-contract cases reject
            // either the closed Frame token or the actual native event.
            let broken = fixture(d, overhang);
            assert!(validate_geometry(&broken, true).is_err(), "d={d}");
        }
    }

    #[test]
    fn exact_tangency_and_sub_mesh_quantum_penetration_stay_closed() {
        let unit = fixture(0.558, 0.417);
        let frame = recorded_frame(&route(&unit, head(&unit)).unwrap()).unwrap();
        let mask = frame.rect(0.03, -0.14, 0.28, 0.14);
        for delta in [0.0, 1e-10, -1e-10] {
            let mut broken = unit.clone();
            let raw = vec![Polygon {
                outer: vec![
                    Point { x: 0.02, y: -0.1 },
                    Point {
                        x: 0.03 + delta,
                        y: -0.1,
                    },
                    Point {
                        x: 0.03 + delta,
                        y: -0.05,
                    },
                    Point { x: 0.02, y: -0.05 },
                ],
                holes: vec![],
            }];
            foreign_face(&mut broken, raw, 5.6, RoofFaceKind::Slab);
            assert_eq!(
                closed_rectangle(&broken, "raw-native-contact", &mask, 5.6).is_err(),
                delta >= 0.0,
                "delta={delta}"
            );
        }
    }
}
