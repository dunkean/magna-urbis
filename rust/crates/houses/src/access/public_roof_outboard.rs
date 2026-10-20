//! A separate three-flight candidate with four real final bearings outside
//! the previous returns. Accepted legacy frames retain their exact geometry.
use super::*;
use geo::{Intersects, LineString};

pub(super) const ROW_SPAN: f64 = DEPTH + 0.14;
pub(super) const ROW_OFFSET: f64 = 0.07;
pub(super) const SHIFT: f64 = 0.14;
pub(super) const DISTANCE_MAX: f64 = bridge::DISTANCE_MAX + SHIFT;
pub(super) const FRONT_MAX: f64 = 0.47;
pub(super) const BACK_MAX: f64 = 0.07;

#[derive(Clone, Copy, PartialEq, Eq)]
pub(super) enum BearingMode {
    Legacy,
    Outboard,
    OutboardEaves,
    OutboardTwoFlight,
}

#[path = "public_roof_outboard_eaves.rs"]
mod eaves;

pub(super) fn twoflight_event(
    profile: &HouseUnit,
    candidate: &HouseUnit,
    frame: Frame,
    low: f64,
    high: f64,
) -> Result<Option<f64>, String> {
    eaves::distance(profile, candidate, frame, low, high)
}

pub(super) fn certify_twoflight_event(
    unit: &HouseUnit,
    head: &Feature,
    frame: Frame,
    low: f64,
) -> Result<(), String> {
    eaves::certify_twoflight_event(unit, head, frame, low)
}

pub(super) fn external(mode: BearingMode) -> bool {
    mode != BearingMode::Legacy
}

pub(super) fn heads(frame: Frame) -> Surface {
    union(
        &frame.rect(1.89, -SHIFT, 0.28, SHIFT),
        &frame.rect(1.89, DEPTH, 0.28, SHIFT),
    )
}

fn floor(frame: Frame) -> Surface {
    union(
        &bridge::floor(frame, true),
        &frame.rect(1.89, DEPTH, 0.28, SHIFT),
    )
}

pub(super) fn add_route(
    unit: &mut HouseUnit,
    bases: &[AccessNode],
    target: &AccessNode,
) -> Result<bool, String> {
    add_route_mode(unit, bases, target, false)
}

pub(super) fn add_eaves_route(
    unit: &mut HouseUnit,
    bases: &[AccessNode],
    target: &AccessNode,
) -> Result<bool, String> {
    add_route_mode(unit, bases, target, true)
}

fn add_route_mode(
    unit: &mut HouseUnit,
    bases: &[AccessNode],
    target: &AccessNode,
    eaves_mode: bool,
) -> Result<bool, String> {
    for minimal in [false, true] {
        for shifted in [false, true] {
            for base in bases {
                let stops = stops(unit, base.z_m, target.z_m, minimal);
                if stops.len() != 3 {
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
                        if length < PAD + 2.0 * GAP {
                            continue;
                        }
                        let tangent = Point {
                            x: (b.x - a.x) / length,
                            y: (b.y - a.y) / length,
                        };
                        for sign in [1.0, -1.0] {
                            let outward = Point {
                                x: sign * tangent.y,
                                y: -sign * tangent.x,
                            };
                            for ratio in [0.5, 0.25, 0.75] {
                                for offset in [0.0, RUN] {
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
                                        let distance = distance + SHIFT;
                                        if distance > DISTANCE_MAX + 1e-9 {
                                            continue;
                                        }
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
                                        if area(&difference(&plan, &base.floor)) > AREA_EPS
                                            || blocked(unit, &plan, base.z_m)
                                        {
                                            continue;
                                        }
                                        let top = floor(frame);
                                        let (opening, passage) = bridge::passage(frame, true);
                                        if !bridge::admissible_outboard(
                                            unit,
                                            target,
                                            frame,
                                            &top,
                                            &passage,
                                            &heads(frame),
                                        ) {
                                            continue;
                                        }
                                        let mut candidate = unit.clone();
                                        if install_mode(
                                            &mut candidate,
                                            base,
                                            target,
                                            frame,
                                            &stops,
                                            opening,
                                            passage,
                                            top,
                                            RouteMode::Outboard,
                                        )
                                        .is_err()
                                            || validate_geometry(&candidate, false).is_err()
                                        {
                                            continue;
                                        }
                                        let mut profile = candidate.clone();
                                        crate::roofs::build_roofs_with_budget(
                                            &mut profile,
                                            crate::engine::MAX_BATCH_FACES as usize,
                                        )?;
                                        if !eaves_mode {
                                            if validate_geometry(&profile, true).is_err() {
                                                continue;
                                            }
                                            *unit = candidate;
                                            return Ok(true);
                                        }
                                        let Some(distance) = eaves::distance(
                                            &profile, &candidate, frame, base.z_m, target.z_m,
                                        )?
                                        else {
                                            continue;
                                        };
                                        let frame = Frame {
                                            origin: point(
                                                edge.x + outward.x * distance,
                                                edge.y + outward.y * distance,
                                            ),
                                            distance,
                                            ..frame
                                        };
                                        let plan = frame.rect(0.0, 0.0, RUN + PAD, DEPTH);
                                        if area(&difference(&plan, &base.floor)) > AREA_EPS
                                            || blocked(unit, &plan, base.z_m)
                                        {
                                            continue;
                                        }
                                        let top = floor(frame);
                                        let (opening, passage) = bridge::passage(frame, true);
                                        if !bridge::admissible_eaves(
                                            unit,
                                            target,
                                            frame,
                                            &top,
                                            &passage,
                                            &heads(frame),
                                        ) {
                                            continue;
                                        }
                                        let mut candidate = unit.clone();
                                        if install_mode(
                                            &mut candidate,
                                            base,
                                            target,
                                            frame,
                                            &stops,
                                            opening,
                                            passage,
                                            top,
                                            RouteMode::OutboardEaves,
                                        )
                                        .is_err()
                                            || validate_geometry(&candidate, false).is_err()
                                        {
                                            continue;
                                        }
                                        let mut profile = candidate.clone();
                                        crate::roofs::build_roofs_with_budget(
                                            &mut profile,
                                            crate::engine::MAX_BATCH_FACES as usize,
                                        )?;
                                        if validate_geometry(&profile, true).is_err() {
                                            continue;
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
    Ok(false)
}

pub(super) fn add_roof_event_route(
    unit: &mut HouseUnit,
    bases: &[AccessNode],
    target: &AccessNode,
) -> Result<bool, String> {
    add_roof_event_route_with_budget(unit, bases, target, crate::engine::MAX_BATCH_FACES as usize)
}

fn add_roof_event_route_with_budget(
    unit: &mut HouseUnit,
    bases: &[AccessNode],
    target: &AccessNode,
    budget: usize,
) -> Result<bool, String> {
    for minimal in [false, true] {
        for shifted in [false, true] {
            for base in bases {
                let stops = stops(unit, base.z_m, target.z_m, minimal);
                if stops.len() != 3 {
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
                        if length < PAD + 2.0 * GAP {
                            continue;
                        }
                        let tangent = Point {
                            x: (b.x - a.x) / length,
                            y: (b.y - a.y) / length,
                        };
                        for sign in [1.0, -1.0] {
                            let outward = Point {
                                x: sign * tangent.y,
                                y: -sign * tangent.x,
                            };
                            for ratio in [0.5, 0.25, 0.75] {
                                for offset in [0.0, RUN] {
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
                                        let distance = distance + SHIFT;
                                        if distance > DISTANCE_MAX + 1e-9 {
                                            continue;
                                        }
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
                                        if area(&difference(&plan, &base.floor)) > AREA_EPS
                                            || blocked(unit, &plan, base.z_m)
                                        {
                                            continue;
                                        }
                                        let top = floor(frame);
                                        let (opening, passage) = bridge::passage(frame, true);
                                        if !bridge::admissible_outboard(
                                            unit,
                                            target,
                                            frame,
                                            &top,
                                            &passage,
                                            &heads(frame),
                                        ) {
                                            continue;
                                        }
                                        let mut candidate = unit.clone();
                                        if install_mode(
                                            &mut candidate,
                                            base,
                                            target,
                                            frame,
                                            &stops,
                                            opening,
                                            passage,
                                            top,
                                            RouteMode::Outboard,
                                        )
                                        .is_err()
                                            || validate_geometry(&candidate, false).is_err()
                                        {
                                            continue;
                                        }
                                        let mut profile = candidate.clone();
                                        crate::roofs::build_roofs_with_budget(
                                            &mut profile,
                                            budget,
                                        )?;
                                        let Some(distance) = eaves::distance_existing(
                                            &profile, &candidate, frame, base.z_m, target.z_m,
                                        )?
                                        else {
                                            continue;
                                        };
                                        let frame = Frame {
                                            origin: point(
                                                edge.x + outward.x * distance,
                                                edge.y + outward.y * distance,
                                            ),
                                            distance,
                                            ..frame
                                        };
                                        let plan = frame.rect(0.0, 0.0, RUN + PAD, DEPTH);
                                        if area(&difference(&plan, &base.floor)) > AREA_EPS
                                            || blocked(unit, &plan, base.z_m)
                                        {
                                            continue;
                                        }
                                        let top = floor(frame);
                                        let (opening, passage) = bridge::passage(frame, true);
                                        if !bridge::admissible_outboard(
                                            unit,
                                            target,
                                            frame,
                                            &top,
                                            &passage,
                                            &heads(frame),
                                        ) {
                                            continue;
                                        }
                                        let mut candidate = unit.clone();
                                        if install_mode(
                                            &mut candidate,
                                            base,
                                            target,
                                            frame,
                                            &stops,
                                            opening,
                                            passage,
                                            top,
                                            RouteMode::Outboard,
                                        )
                                        .is_err()
                                            || validate_geometry(&candidate, false).is_err()
                                        {
                                            continue;
                                        }
                                        let mut profile = candidate.clone();
                                        crate::roofs::build_roofs_with_budget(
                                            &mut profile,
                                            budget,
                                        )?;
                                        if validate_geometry(&profile, true).is_err() {
                                            continue;
                                        }
                                        #[cfg(test)]
                                        eaves::event_tests::capture(&profile);
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
    Ok(false)
}

/// The mode is a complete native route certificate, never a guessed axis.
pub(super) fn mode(unit: &HouseUnit, slab: &Feature) -> Result<BearingMode, String> {
    if slab.id.contains(":outboard-two-flight") {
        return twoflight::mode(unit, slab);
    }
    let Some((key, index)) = slab.id.rsplit_once(":landing:") else {
        return Err("Palier sans index natif de cadre.".into());
    };
    if !key.contains(":outboard") {
        return Ok(BearingMode::Legacy);
    }
    let index = index
        .parse::<usize>()
        .map_err(|_| "Index de palier outboard invalide.")?;
    let selected = if let Some(native) = key.strip_suffix(":outboard") {
        (native, BearingMode::Outboard)
    } else if let Some(native) = key.strip_suffix(":outboard-eaves") {
        (native, BearingMode::OutboardEaves)
    } else {
        return Err("Marqueur de cadre outboard incomplet ou combiné.".into());
    };
    if selected
        .0
        .strip_prefix(&format!("{}:public-roof:", unit.id))
        .and_then(|n| n.parse::<usize>().ok())
        .is_none()
        || index > 3
    {
        return Err("Cadre outboard hors des trois volées déclarées.".into());
    }
    let mut portals = vec![];
    for i in 0..3 {
        let id = format!("{key}:flight:{i}");
        let flights: Vec<_> = unit.features.iter().filter(|f| f.id == id).collect();
        let matches: Vec<_> = unit
            .access
            .portals
            .iter()
            .filter(|p| p.feature_ids.contains(&id))
            .collect();
        if flights.len() != 1
            || flights[0].kind != FeatureKind::Ladder
            || flights[0].vertices3d.len() != 4
            || matches.len() != 1
            || matches[0].kind != PortalKind::Ladder
            || matches[0].feature_ids != vec![id]
        {
            return Err("Cadre outboard sans chaîne unique des trois Ladder natales.".into());
        }
        portals.push(matches[0]);
    }
    if unit
        .features
        .iter()
        .filter(|f| f.id.starts_with(&format!("{key}:flight:")))
        .count()
        != 3
        || portals[0].to != portals[1].from
        || portals[1].to != portals[2].from
    {
        return Err("Cadre outboard avec une volée supplémentaire ou une chaîne rompue.".into());
    }
    let nodes = [
        &portals[0].from,
        &portals[0].to,
        &portals[1].to,
        &portals[2].to,
    ];
    for (i, id) in nodes.iter().enumerate() {
        let node = unit
            .access
            .nodes
            .iter()
            .find(|n| &n.id == *id)
            .ok_or("Palier outboard sans nœud.")?;
        let slabs: Vec<_> = unit
            .features
            .iter()
            .filter(|f| f.id == format!("{key}:landing:{i}"))
            .collect();
        if slabs.len() != 1
            || slabs[0].kind != FeatureKind::Landing
            || node.kind != AccessKind::StairLanding
            || node.household_id.is_some()
            || (node.z_m - slabs[0].z_m).abs() > 1e-9
            || area(&difference(&node.floor, &slabs[0].surface))
                + area(&difference(&slabs[0].surface, &node.floor))
                > AREA_EPS
        {
            return Err(
                "Cadre outboard sans identité matérielle des quatre paliers publics.".into(),
            );
        }
    }
    let final_id = format!("{key}:landing:3");
    let arrivals: Vec<_> = unit
        .access
        .portals
        .iter()
        .filter(|p| {
            p.from == *nodes[3]
                && p.kind == PortalKind::Passage
                && p.feature_ids == vec![final_id.clone()]
        })
        .collect();
    if arrivals.len() != 1
        || !unit.access.nodes.iter().any(|n| {
            n.id == arrivals[0].to && n.kind == AccessKind::Terrace && n.household_id.is_none()
        })
        || unit.access.portals.iter().any(|p| {
            p.from == *nodes[3] && matches!(p.kind, PortalKind::Stair | PortalKind::Ladder)
        })
    {
        return Err("Cadre outboard sans Passage final unique vers la terrasse publique.".into());
    }
    Ok(if index == 3 {
        selected.1
    } else {
        BearingMode::Legacy
    })
}

fn intersects(min: f64, max: f64, post: &Feature) -> bool {
    max > post.z_m + CONTACT && min < post.z_m + post.height_m - CONTACT
}

fn clipped_range(vertices: &[Vertex3], foot: &Surface) -> Result<Option<(f64, f64)>, String> {
    let clipped = bridge::clip(vertices, foot)?;
    Ok(clipped
        .iter()
        .map(|v| v.z)
        .reduce(f64::min)
        .zip(clipped.iter().map(|v| v.z).reduce(f64::max)))
}

pub(super) fn validate_columns(unit: &HouseUnit, check_roofs: bool) -> Result<(), String> {
    for piece in unit
        .features
        .iter()
        .filter(|f| f.id.contains(":outboard-eaves"))
    {
        if !unit.features.iter().any(|head| {
            head.kind == FeatureKind::Landing
                && head.id.ends_with(":outboard-eaves:landing:3")
                && head
                    .id
                    .strip_suffix(":landing:3")
                    .is_some_and(|key| piece.id.starts_with(&format!("{key}:")))
        }) {
            return Err("Pièce eaves sans cadre matériel complet déclaré.".into());
        }
    }
    for head in unit.features.iter().filter(|f| {
        f.kind == FeatureKind::Landing
            && (f.id.ends_with(":outboard:landing:3")
                || f.id.ends_with(":outboard-eaves:landing:3")
                || f.id.ends_with(":outboard-two-flight-eaves:landing:2"))
    }) {
        if !external(mode(unit, head)?) || (head.height_m - 0.15).abs() > 1e-9 {
            return Err("Tête outboard sans dalle native de0.15m.".into());
        }
        if mode(unit, head)? == BearingMode::OutboardEaves {
            eaves::validate(unit, head, check_roofs)?;
        }
        for i in 0..4 {
            let id = format!("{}:post:{i}", head.id);
            let posts: Vec<_> = unit
                .features
                .iter()
                .filter(|f| f.id == id && f.kind == FeatureKind::Post)
                .collect();
            if posts.len() != 1 {
                return Err("Cadre outboard sans quatre appuis uniques.".into());
            }
            let post = posts[0];
            if post.height_m <= 0.0
                || (post.z_m + post.height_m - head.z_m).abs() > CONTACT
                || post.material != "MAT-TIMBER-POST"
                || post.surface.len() != 1
                || post.surface[0].outer.len() != 4
                || !post.surface[0].holes.is_empty()
                || area(&difference(&post.surface, &head.surface)) > AREA_EPS
                || area(&difference(&post.surface, &unit.lot)) > AREA_EPS
                || !unit.access.nodes.iter().any(|n| {
                    n.kind != AccessKind::Room
                        && n.household_id.is_none()
                        && (n.z_m - post.z_m).abs() < CONTACT
                        && area(&difference(&post.surface, &n.floor)) <= AREA_EPS
                })
            {
                return Err(
                    "Colonne outboard sans pied public, tête entière ou hauteur native.".into(),
                );
            }
            for body in &unit.bodies {
                for level in &body.levels {
                    if intersects(level.z_m, level.z_m + level.height_m, post)
                        && area(&intersection(&post.surface, &level.footprint)) > AREA_EPS
                    {
                        return Err("Colonne outboard dans un corps bâti.".into());
                    }
                }
            }
            for wall in &unit.walls {
                if area(&intersection(&post.surface, &wall.footprint)) <= AREA_EPS {
                    continue;
                }
                let mut ranges = vec![];
                if let Some(s) = &wall.solid {
                    for face in &s.faces {
                        let vertices = face
                            .iter()
                            .map(|&i| {
                                s.vertices
                                    .get(i as usize)
                                    .cloned()
                                    .ok_or("Indice de mur invalide dans une colonne.")
                            })
                            .collect::<Result<Vec<_>, _>>()?;
                        if let Some(r) = clipped_range(&vertices, &post.surface)? {
                            ranges.push(r);
                        }
                    }
                } else {
                    ranges.push((wall.z_m, wall.z_m + wall.height_m));
                }
                if ranges.iter().any(|&(a, b)| intersects(a, b, post)) {
                    return Err(format!("Colonne outboard dans le mur {}.", wall.id));
                }
            }
            for f in unit.features.iter().chain(&unit.site_context) {
                if f.id == post.id
                    || f.id == head.id
                    || area(&intersection(&post.surface, &f.surface)) <= AREA_EPS
                {
                    continue;
                }
                let blocks = bridge::blocks_feature(f.kind)
                    || matches!(
                        f.kind,
                        FeatureKind::Landing
                            | FeatureKind::Terrace
                            | FeatureKind::Deck
                            | FeatureKind::Gallery
                            | FeatureKind::Retaining
                            | FeatureKind::Stair
                            | FeatureKind::Ladder
                            | FeatureKind::Hatch
                            | FeatureKind::Water
                    );
                if !blocks {
                    continue;
                }
                let range = if matches!(
                    f.kind,
                    FeatureKind::Stair | FeatureKind::Ladder | FeatureKind::Hatch
                ) && f.vertices3d.len() == 4
                {
                    clipped_range(&f.vertices3d, &post.surface)?
                } else if matches!(
                    f.kind,
                    FeatureKind::Landing
                        | FeatureKind::Terrace
                        | FeatureKind::Deck
                        | FeatureKind::Gallery
                ) {
                    Some((f.z_m - f.height_m, f.z_m))
                } else {
                    Some((f.z_m, f.z_m + f.height_m))
                };
                if range.is_some_and(|(a, b)| intersects(a, b, post)) {
                    return Err(format!("Colonne outboard dans {}.", f.id));
                }
            }
            if check_roofs {
                for face in &unit.roofs.faces {
                    let vertices = face
                        .vertices
                        .iter()
                        .map(|&i| {
                            unit.roofs
                                .vertices
                                .get(i as usize)
                                .cloned()
                                .ok_or("Indice de toit invalide dans une colonne.")
                        })
                        .collect::<Result<Vec<_>, _>>()?;
                    if face.normal[2].abs() < 1e-6 {
                        let line = LineString::from(
                            vertices.iter().map(|v| (v.x, v.y)).collect::<Vec<_>>(),
                        );
                        if !to_geo(&post.surface).intersects(&line) {
                            continue;
                        }
                        let Some((min, max)) = clipped_range(&vertices, &post.surface)? else {
                            return Err(
                                "Contact vertical de colonne sans découpe affine fiable.".into()
                            );
                        };
                        if intersects(min, max, post) {
                            return Err(
                                "Colonne outboard dans une face verticale de toiture.".into()
                            );
                        }
                    } else if clipped_range(&vertices, &post.surface)?
                        .is_some_and(|(a, b)| intersects(a, b, post))
                    {
                        return Err("Colonne outboard dans une toiture.".into());
                    }
                }
            }
        }
    }
    Ok(())
}

#[cfg(test)]
#[path = "public_roof_outboard_tests.rs"]
mod tests;

#[cfg(test)]
#[test]
fn native_event_pass_propagates_speculative_roof_budget_error() {
    let profile = eaves::event_tests::witness();
    let mut unit = eaves::event_tests::rebuild(&profile, 0.171);
    // Remove the just-created native chain, retaining its original public base.
    let last = unit.access.portals.last().unwrap();
    let target = unit
        .access
        .nodes
        .iter()
        .find(|n| n.id == last.to)
        .unwrap()
        .clone();
    let key = last.feature_ids[0]
        .strip_suffix(":landing:3")
        .unwrap()
        .to_string();
    let serial: usize = key
        .strip_prefix("unit-2:public-roof:")
        .unwrap()
        .strip_suffix(":outboard")
        .unwrap()
        .parse()
        .unwrap();
    let own: Vec<_> = unit
        .access
        .portals
        .iter()
        .filter(|p| (0..5).any(|i| p.id == format!("unit-2:portal:{}", serial + i)))
        .cloned()
        .collect();
    let base = unit
        .access
        .nodes
        .iter()
        .find(|n| n.id == own[0].from)
        .unwrap()
        .clone();
    unit.features
        .retain(|f| !f.id.starts_with(&format!("{key}:")));
    unit.access
        .nodes
        .retain(|n| !own[..4].iter().any(|p| p.to == n.id));
    unit.access
        .portals
        .retain(|p| !own.iter().any(|old| old.id == p.id));
    let error = add_roof_event_route_with_budget(&mut unit, &[base], &target, 0).unwrap_err();
    assert!(error.contains("Budget"), "{error}");
}

#[cfg(test)]
pub(super) fn eaves_fixture(d: f64) -> HouseUnit {
    eaves::tests::route(d)
}
