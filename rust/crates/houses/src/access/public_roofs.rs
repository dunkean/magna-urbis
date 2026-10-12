//! Public, supported routes to collective terraces. Private hatches are exits
//! from a household, never evidence that a terrace has a public entrance.
use super::*;
#[path = "public_roof_bridge.rs"]
mod bridge;
#[path = "public_roof_links.rs"]
mod links;
#[path = "public_roof_outboard.rs"]
mod outboard;

pub(super) fn low_band(f: &Feature) -> Option<Surface> {
    links::low_band(f)
}

const WIDTH: f64 = 0.9;
const RUN: f64 = 1.3;
const PAD: f64 = 0.9;
const DEPTH: f64 = 1.9;
const GAP: f64 = 0.031;
const CONTACT: f64 = 0.001;
const AREA_EPS: f64 = 1e-6;

#[derive(Clone, Copy)]
struct Frame {
    origin: Point,
    tangent: Point,
    outward: Point,
    distance: f64,
}

impl Frame {
    fn at(self, x: f64, y: f64) -> Point {
        point(
            self.origin.x + self.tangent.x * x + self.outward.x * y,
            self.origin.y + self.tangent.y * x + self.outward.y * y,
        )
    }
    fn rect(self, x: f64, y: f64, w: f64, d: f64) -> Surface {
        quad([
            self.at(x, y),
            self.at(x + w, y),
            self.at(x + w, y + d),
            self.at(x, y + d),
        ])
    }
}

fn collective_targets(unit: &HouseUnit) -> BTreeSet<String> {
    if !unit
        .bodies
        .iter()
        .any(|b| b.cells.iter().any(|c| c.household_id.is_some()))
    {
        return BTreeSet::new();
    }
    let owners: BTreeSet<_> = unit
        .rooms
        .iter()
        .filter_map(|r| r.household_id.as_ref())
        .collect();
    if owners.len() < 2 {
        return BTreeSet::new();
    }
    unit.access
        .portals
        .iter()
        .filter(|p| p.kind == PortalKind::Hatch)
        .flat_map(|p| [&p.from, &p.to])
        .filter(|id| {
            unit.access
                .nodes
                .iter()
                .any(|n| &n.id == *id && n.kind == AccessKind::Terrace)
        })
        .cloned()
        .collect()
}

pub(super) fn add_routes(unit: &mut HouseUnit) -> Result<(), String> {
    let needed = collective_targets(unit);
    let mut targets: Vec<_> = unit
        .access
        .nodes
        .iter()
        .filter(|n| needed.contains(&n.id))
        .cloned()
        .collect();
    targets.sort_by(|a, b| a.z_m.total_cmp(&b.z_m).then(a.id.cmp(&b.id)));
    for target in targets {
        let public = public_reachable(unit);
        if public.contains(&target.id) {
            continue;
        }
        let mut bases: Vec<_> = unit
            .access
            .nodes
            .iter()
            .filter(|n| public.contains(&n.id) && n.z_m < target.z_m - CONTACT)
            .cloned()
            .collect();
        bases.sort_by(|a, b| b.z_m.total_cmp(&a.z_m).then(a.id.cmp(&b.id)));
        let mut selected = None;
        'search: for minimal in [false, true] {
            for shifted in [false, true] {
                for base in &bases {
                    let stops = stops(unit, base.z_m, target.z_m, minimal);
                    if stops.is_empty() {
                        continue;
                    }
                    for polygon in &target.floor {
                        for (a, b) in polygon
                            .outer
                            .iter()
                            .zip(polygon.outer.iter().cycle().skip(1))
                            .take(polygon.outer.len())
                        {
                            let length = libm::hypot(b.x - a.x, b.y - a.y);
                            if length < RUN + PAD + 0.062 {
                                continue;
                            }
                            let tangent = Point {
                                x: (b.x - a.x) / length,
                                y: (b.y - a.y) / length,
                            };
                            let outward = Point {
                                x: tangent.y,
                                y: -tangent.x,
                            };
                            let mut offsets = vec![
                                (length - RUN - PAD) * 0.5,
                                0.031,
                                length - RUN - PAD - 0.031,
                            ];
                            for p in rings(&base.floor).flat_map(|r| r.iter()) {
                                offsets.push(
                                    ((p.x - a.x) * tangent.x + (p.y - a.y) * tangent.y - PAD * 0.5)
                                        .clamp(0.031, length - RUN - PAD - 0.031),
                                );
                            }
                            offsets.sort_by(f64::total_cmp);
                            offsets.dedup_by(|a, b| (*a - *b).abs() < 0.001);
                            for x in offsets {
                                let edge = point(a.x + tangent.x * x, a.y + tangent.y * x);
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
                                    let frame = Frame {
                                        origin: point(
                                            edge.x + outward.x * distance,
                                            edge.y + outward.y * distance,
                                        ),
                                        tangent,
                                        outward,
                                        distance,
                                    };
                                    let plan = frame.rect(0.0, 0.0, RUN + PAD, DEPTH);
                                    // A roof departure bears the entire route, not just its
                                    // first endpoint. Enclosed ground voids are not public.
                                    if area(&difference(&plan, &base.floor)) > AREA_EPS
                                        || blocked(unit, &plan, base.z_m)
                                    {
                                        continue;
                                    }
                                    let odd = stops.len() % 2 == 1;
                                    let top = bridge::floor(frame, odd);
                                    let (opening, passage) = bridge::passage(frame, odd);
                                    if !bridge::admissible(
                                        unit, &target, frame, odd, &top, &passage,
                                    ) {
                                        continue;
                                    }
                                    let mut candidate = unit.clone();
                                    if install(
                                        &mut candidate,
                                        base,
                                        &target,
                                        frame,
                                        &stops,
                                        opening,
                                        passage,
                                        top,
                                    )
                                    .is_err()
                                        || validate_geometry(&candidate, false).is_err()
                                    {
                                        continue;
                                    }
                                    selected = Some(candidate);
                                    break 'search;
                                }
                            }
                        }
                    }
                }
            }
        }
        let Some(candidate) = selected else {
            if links::add_route(unit, &bases, &target)? {
                continue;
            }
            if outboard::add_route(unit, &bases, &target)? {
                continue;
            }
            return Err(format!(
                "{} : terrasse collective à {} m sans route publique portée (échelles 0.9 × 1.3 m, paliers et deux bandes de retour dégagées).",
                target.id, target.z_m
            ));
        };
        *unit = candidate;
    }
    validate(unit, false)
}

fn stops(unit: &HouseUnit, base: f64, top: f64, minimal: bool) -> Vec<f64> {
    let mut levels: Vec<_> = unit
        .bodies
        .iter()
        .flat_map(|b| b.levels.iter())
        .flat_map(|l| [l.z_m, l.z_m + l.height_m])
        .filter(|z| *z > base + CONTACT && *z <= top + CONTACT)
        .map(snap)
        .collect();
    levels.push(top);
    levels.sort_by(f64::total_cmp);
    levels.dedup_by(|a, b| (*a - *b).abs() < CONTACT);
    if minimal {
        let mut selected = vec![];
        let mut previous = base;
        while previous < top - CONTACT {
            let Some(next) = levels
                .iter()
                .copied()
                .rfind(|z| *z > previous + CONTACT && *z - previous <= 3.001)
            else {
                return vec![];
            };
            selected.push(next);
            previous = next;
        }
        return selected;
    }
    let mut previous = base;
    if levels.iter().any(|z| {
        let dz = *z - previous;
        previous = *z;
        dz > 3.001
    }) {
        return vec![];
    }
    levels
}

fn blocked(unit: &HouseUnit, plan: &Surface, base: f64) -> bool {
    unit.bodies.iter().any(|b| {
        b.levels.iter().any(|l| {
            l.z_m + l.height_m > base + CONTACT && area(&intersection(plan, &l.footprint)) > CONTACT
        })
    }) || unit.walls.iter().any(|w| {
        w.z_m + w.height_m > base + CONTACT && area(&intersection(plan, &w.footprint)) > CONTACT
    }) || unit
        .features
        .iter()
        .chain(unit.site_context.iter())
        .any(|f| {
            let barrier = match f.kind {
                FeatureKind::Neighbor
                | FeatureKind::RockFace
                | FeatureKind::Post
                | FeatureKind::Pier
                | FeatureKind::Stair
                | FeatureKind::Ladder => f.z_m + f.height_m > base + CONTACT,
                FeatureKind::Water => base <= CONTACT,
                _ => false,
            };
            barrier && area(&intersection(plan, &f.surface)) > CONTACT
        })
}

fn landing(
    unit: &mut HouseUnit,
    surface: Surface,
    z: f64,
    base: &AccessNode,
    frame: Frame,
    side: f64,
    key: &str,
) -> String {
    unit.features.push(feature(
        key,
        FeatureKind::Landing,
        surface.clone(),
        z,
        0.15,
        "MAT-TIMBER-POST",
    ));
    if z > base.z_m + CONTACT {
        // Both bearings lie beyond the flight's longitudinal interval. Their
        // feet are on the already public ground or structural terrace.
        let x = if side == 0.0 { 0.1 } else { RUN + PAD - 0.1 };
        let external = key.ends_with(":outboard:landing:3");
        let front = if external { -outboard::ROW_OFFSET } else { 0.1 };
        let back = if external {
            DEPTH + outboard::ROW_OFFSET
        } else {
            DEPTH - 0.1
        };
        for (i, (dx, y)) in [(0.0, front), (0.14, front), (0.0, back), (0.14, back)]
            .into_iter()
            .enumerate()
        {
            let x = if side == 0.0 { x + dx } else { x - dx };
            unit.features.push(feature(
                &format!("{key}:post:{i}"),
                FeatureKind::Post,
                frame.rect(x - 0.07, y - 0.07, 0.14, 0.14),
                base.z_m,
                z - base.z_m,
                "MAT-TIMBER-POST",
            ));
        }
    }
    node(unit, AccessKind::StairLanding, surface, z)
}

#[allow(clippy::too_many_arguments)]
fn install(
    unit: &mut HouseUnit,
    base: &AccessNode,
    target: &AccessNode,
    frame: Frame,
    stops: &[f64],
    opening: [Point; 2],
    passage: Surface,
    final_floor: Surface,
) -> Result<(), String> {
    install_mode(
        unit,
        base,
        target,
        frame,
        stops,
        opening,
        passage,
        final_floor,
        false,
    )
}

#[allow(clippy::too_many_arguments)]
fn install_mode(
    unit: &mut HouseUnit,
    base: &AccessNode,
    target: &AccessNode,
    frame: Frame,
    stops: &[f64],
    opening: [Point; 2],
    passage: Surface,
    final_floor: Surface,
    external: bool,
) -> Result<(), String> {
    if external && stops.len() != 3 {
        return Err("Cadre à appuis extérieurs limité à trois volées.".into());
    }
    let key = format!(
        "{}:public-roof:{}{}",
        unit.id,
        unit.access.portals.len(),
        if external { ":outboard" } else { "" }
    );
    let first = frame.rect(0.0, 0.0, PAD, DEPTH);
    let first_flight = planned_flight(
        frame.rect(PAD * 0.5, 0.0, RUN, WIDTH),
        &first,
        base.z_m,
        stops[0],
    )?;
    let first_cut = landing_collision(&first_flight, &first, base.z_m);
    let first = if first_cut {
        departure_floor(&first, &first_flight)
    } else {
        first
    };
    let mut prior = landing(
        unit,
        first.clone(),
        base.z_m,
        base,
        frame,
        0.0,
        &format!("{key}:landing:0"),
    );
    portal(
        unit,
        &base.id,
        &prior,
        PortalKind::Passage,
        if first_cut {
            [frame.at(0.0, 0.0), frame.at(0.0, WIDTH)]
        } else {
            [frame.at(0.0, 0.0), frame.at(PAD, 0.0)]
        },
        first,
        0.9,
        vec![],
    )?;
    let mut previous_z = base.z_m;
    for (i, z) in stops.iter().copied().enumerate() {
        let forward = i % 2 == 0;
        let side = if forward { RUN } else { 0.0 };
        let lane = if forward { 0.0 } else { 1.0 };
        let surface = frame.rect(PAD * 0.5, lane, RUN, WIDTH);
        let prior_floor = unit
            .access
            .nodes
            .iter()
            .find(|n| n.id == prior)
            .unwrap()
            .floor
            .clone();
        let (low, high) =
            flight_edges(&surface, &prior_floor).ok_or("Échelle publique sans extrémités.")?;
        let mut target_landing = if i + 1 == stops.len() {
            final_floor.clone()
        } else {
            difference(
                &frame.rect(side, 0.0, PAD, DEPTH),
                &difference(&surface, &end_band(high, low, 0.35)),
            )
        };
        if i + 1 < stops.len() {
            target_landing = union(
                &target_landing,
                &frame.rect(
                    if side == 0.0 { -0.05 } else { RUN + PAD },
                    0.0,
                    0.05,
                    DEPTH,
                ),
            );
            let next_flight = planned_flight(
                frame.rect(PAD * 0.5, if forward { 1.0 } else { 0.0 }, RUN, WIDTH),
                &target_landing,
                z,
                stops[i + 1],
            )?;
            if landing_collision(&next_flight, &target_landing, z) {
                target_landing = departure_floor(&target_landing, &next_flight);
            }
        }
        let next = landing(
            unit,
            target_landing,
            z,
            base,
            frame,
            side,
            &format!("{key}:landing:{}", i + 1),
        );
        if i + 1 == stops.len() {
            let feature = unit
                .features
                .iter_mut()
                .find(|f| f.id == format!("{key}:landing:{}", i + 1))
                .unwrap();
            feature.vertices3d = feature.surface[0]
                .outer
                .iter()
                .map(|p| Vertex3 { x: p.x, y: p.y, z })
                .collect();
        }
        let id = interface(unit, FeatureKind::Ladder, surface.clone(), previous_z, z);
        let tagged = format!("{key}:flight:{i}");
        unit.features.iter_mut().find(|f| f.id == id).unwrap().id = tagged.clone();
        portal(
            unit,
            &prior,
            &next,
            PortalKind::Ladder,
            [frame.at(PAD * 0.5, lane), frame.at(PAD * 0.5, lane + WIDTH)],
            surface,
            WIDTH,
            vec![tagged],
        )?;
        prior = next;
        previous_z = z;
    }
    portal(
        unit,
        &prior,
        &target.id,
        PortalKind::Passage,
        opening,
        passage,
        0.85,
        vec![format!("{key}:landing:{}", stops.len())],
    )
}

pub(super) fn validate(unit: &HouseUnit, check_roofs: bool) -> Result<(), String> {
    let public = public_reachable(unit);
    if let Some(id) = collective_targets(unit)
        .iter()
        .find(|id| !public.contains(*id))
    {
        return Err(format!(
            "Terrasse collective {id} sans accès public indépendant."
        ));
    }
    validate_geometry(unit, check_roofs)
}

fn validate_geometry(unit: &HouseUnit, check_roofs: bool) -> Result<(), String> {
    bridge::validate_landings(unit)?;
    outboard::validate_columns(unit, check_roofs)?;
    for f in unit
        .features
        .iter()
        .filter(|f| f.id.contains(":public-roof:"))
    {
        if f.kind == FeatureKind::Landing {
            let posts: Vec<_> = unit
                .features
                .iter()
                .filter(|p| {
                    p.kind == FeatureKind::Post && p.id.starts_with(&format!("{}:post:", f.id))
                })
                .collect();
            if !posts.is_empty() {
                if posts.len() != 4
                    || posts.iter().any(|p| {
                        (p.z_m + p.height_m - f.z_m).abs() > CONTACT
                            || !unit.access.nodes.iter().any(|n| {
                                n.kind != AccessKind::Room
                                    && n.household_id.is_none()
                                    && (n.z_m - p.z_m).abs() < CONTACT
                                    && area(&difference(&p.surface, &n.floor)) < AREA_EPS
                            })
                    })
                {
                    return Err(format!(
                        "{} : palier public sans appuis jusqu'au sol porteur.",
                        f.id
                    ));
                }
            } else if !unit.access.nodes.iter().any(|n| {
                n.kind != AccessKind::Room
                    && n.kind != AccessKind::StairLanding
                    && (n.z_m - f.z_m).abs() < CONTACT
                    && area(&difference(&f.surface, &n.floor)) < AREA_EPS
            }) {
                return Err(format!("{} : palier public non porté.", f.id));
            }
        }
        if f.kind == FeatureKind::Ladder {
            if f.vertices3d.len() != 4 {
                return Err("Volée publique sans quatre sommets natifs.".into());
            }
            if f.height_m > 3.001 {
                return Err("Volée publique de plus d'un niveau.".into());
            }
            let portal = unit
                .access
                .portals
                .iter()
                .find(|p| p.feature_ids.contains(&f.id))
                .ok_or("Échelle publique sans portail.")?;
            let start = unit
                .access
                .nodes
                .iter()
                .find(|n| n.id == portal.from)
                .ok_or("Départ public absent.")?;
            if start.household_id.is_some() || start.kind == AccessKind::Room {
                return Err("Départ public privé.".into());
            }
            if f.id.contains(":link:") {
                links::validate(unit, f, portal, check_roofs)?;
                continue;
            }
            // All structural volumes above the departure remain obstacles.
            if unit.bodies.iter().any(|b| {
                b.levels.iter().any(|l| {
                    l.z_m + l.height_m > start.z_m + CONTACT
                        && area(&intersection(&f.surface, &l.footprint)) > AREA_EPS
                })
            }) {
                return Err(format!("{} : échelle publique dans un volume bâti.", f.id));
            }
            validate_clearance(unit, f)?;
        }
    }
    for portal in unit.access.portals.iter().filter(|p| {
        p.kind == PortalKind::Passage
            && unit
                .access
                .nodes
                .iter()
                .any(|n| n.id == p.to && n.kind == AccessKind::Terrace)
            && (p
                .feature_ids
                .iter()
                .any(|id| id.contains(":public-roof:") && id.contains(":landing:"))
                || unit.access.portals.iter().any(|incoming| {
                    incoming.to == p.from
                        && incoming.kind == PortalKind::Ladder
                        && incoming
                            .feature_ids
                            .iter()
                            .any(|id| id.contains(":public-roof:") && id.contains(":flight:"))
                }))
    }) {
        bridge::validate(unit, portal, check_roofs)?;
    }
    Ok(())
}

fn plane_z(f: &Feature, p: Point) -> f64 {
    let v = &f.vertices3d;
    let ax = (v[0].x + v[1].x) * 0.5;
    let ay = (v[0].y + v[1].y) * 0.5;
    let dx = (v[2].x + v[3].x) * 0.5 - ax;
    let dy = (v[2].y + v[3].y) * 0.5 - ay;
    let t = (((p.x - ax) * dx + (p.y - ay) * dy) / (dx * dx + dy * dy)).clamp(0.0, 1.0);
    v[0].z + (v[2].z - v[0].z) * t
}

fn planned_flight(
    surface: Surface,
    floor: &Surface,
    low_z: f64,
    high_z: f64,
) -> Result<Feature, String> {
    let (low, high) = flight_edges(&surface, floor).ok_or("Volée publique sans extrémités.")?;
    let mut f = feature(
        "planned-public-flight",
        FeatureKind::Ladder,
        surface,
        low_z,
        high_z - low_z,
        "MAT-TIMBER-POST",
    );
    f.vertices3d = [low[0], low[1], high[1], high[0]]
        .into_iter()
        .enumerate()
        .map(|(i, p)| Vertex3 {
            x: p.x,
            y: p.y,
            z: if i < 2 { low_z } else { high_z },
        })
        .collect();
    Ok(f)
}

fn flight_clear(flight: &Feature) -> Surface {
    let v = &flight.vertices3d;
    let low = [point(v[0].x, v[0].y), point(v[1].x, v[1].y)];
    let high = [point(v[3].x, v[3].y), point(v[2].x, v[2].y)];
    difference(
        &flight.surface,
        &union(&end_band(low, high, 0.35), &end_band(high, low, 0.35)),
    )
}

fn landing_collision(flight: &Feature, surface: &Surface, z: f64) -> bool {
    let overlap = intersection(&flight_clear(flight), surface);
    area(&overlap) > AREA_EPS
        && rings(&overlap).flatten().any(|p| {
            let dz = z - plane_z(flight, *p);
            dz > -0.15 + CONTACT && dz < 2.20 - CONTACT
        })
}

fn departure_floor(floor: &Surface, flight: &Feature) -> Surface {
    let v = &flight.vertices3d;
    difference(
        floor,
        &difference(
            &flight.surface,
            &end_band(
                [point(v[0].x, v[0].y), point(v[1].x, v[1].y)],
                [point(v[3].x, v[3].y), point(v[2].x, v[2].y)],
                0.35,
            ),
        ),
    )
}

fn validate_clearance(unit: &HouseUnit, flight: &Feature) -> Result<(), String> {
    let clear = flight_clear(flight);
    for wall in &unit.walls {
        if wall.z_m + wall.height_m > flight.z_m + CONTACT
            && area(&intersection(&clear, &wall.footprint)) > AREA_EPS
        {
            return Err(format!(
                "{} : volée publique dans le mur {}.",
                flight.id, wall.id
            ));
        }
    }
    for other in unit
        .features
        .iter()
        .chain(unit.site_context.iter())
        .filter(|o| o.id != flight.id)
    {
        let overlap = intersection(&clear, &other.surface);
        if area(&overlap) <= AREA_EPS {
            continue;
        }
        let collision = match other.kind {
            FeatureKind::Landing => landing_collision(flight, &other.surface, other.z_m),
            FeatureKind::Stair | FeatureKind::Ladder if other.vertices3d.len() == 4 => {
                rings(&overlap)
                    .flatten()
                    .any(|p| (plane_z(other, *p) - plane_z(flight, *p)).abs() < 2.05 - CONTACT)
            }
            FeatureKind::Post
            | FeatureKind::Pier
            | FeatureKind::Neighbor
            | FeatureKind::RockFace => other.z_m + other.height_m > flight.z_m + CONTACT,
            FeatureKind::Water => flight.z_m <= CONTACT,
            _ => false,
        };
        if collision {
            return Err(format!(
                "{} : hauteur libre ou collision avec {}.",
                flight.id, other.id
            ));
        }
    }
    Ok(())
}
