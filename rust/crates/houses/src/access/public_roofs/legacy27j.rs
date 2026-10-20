//! Complete native Legacy roof guard and bounded route search.
use super::*;
use geo::TriangulateEarcut;
use serde_json::{Value, json};
mod source_slab;

fn triangles(surface: &Surface) -> Result<Vec<Surface>, String> {
    let mut out = vec![];
    let mut total = 0.0;
    for polygon in to_geo(surface).0 {
        for triangle in polygon.earcut_triangles() {
            let mut points: Vec<_> = triangle
                .to_array()
                .into_iter()
                .map(|p| Point { x: p.x, y: p.y })
                .collect();
            let signed = signed_area(&points);
            if !signed.is_finite() || signed == 0.0 {
                return Err("Legacy27j: degenerate mask triangle".into());
            }
            if signed < 0.0 {
                points.reverse();
            }
            total += signed.abs();
            out.push(vec![Polygon {
                outer: points,
                holes: vec![],
            }]);
        }
    }
    if (total - area(surface)).abs() > AREA_EPS {
        return Err("Legacy27j: incomplete mask triangles".into());
    }
    Ok(out)
}

fn roof_contacts(
    unit: &HouseUnit,
    f: &Feature,
    mask: &Surface,
    terminal: Option<&AccessNode>,
    convex: bool,
) -> Result<(Vec<Value>, Vec<Value>), String> {
    let mut blockers = vec![];
    let mut pending = vec![];
    for tri in if convex {
        vec![mask.clone()]
    } else {
        triangles(mask)?
    } {
        for (i, face) in unit.roofs.faces.iter().enumerate() {
            let raw: Vec<_> = face
                .vertices
                .iter()
                .map(|&v| unit.roofs.vertices[v as usize].clone())
                .collect();
            let clipped = bridge::clip(&raw, &tri)?;
            if clipped.is_empty() {
                continue;
            }
            let height = |v: &Vertex3| {
                if f.kind == FeatureKind::Ladder {
                    plane_z(f, Point { x: v.x, y: v.y })
                } else {
                    f.z_m
                }
            };
            let (min, max) = clipped
                .iter()
                .map(|v| v.z - height(v))
                .fold((f64::INFINITY, f64::NEG_INFINITY), |(a, b), z| {
                    (a.min(z), b.max(z))
                });
            let post = f.kind == FeatureKind::Post;
            if if post {
                max <= CONTACT || min >= f.height_m - CONTACT
            } else {
                max <= -0.15 + CONTACT || min >= 2.05 - CONTACT
            } {
                continue;
            }
            let projected = vec![Polygon {
                outer: clipped.iter().map(|v| Point { x: v.x, y: v.y }).collect(),
                holes: vec![],
            }];
            let item = json!({"feature":f.id,"kind":f.kind,"face":i,"roof_group":face.roof_group,"face_kind":face.kind,"delta_z":[min,max],"area_m2":area(&projected),"clipped":clipped});
            if !post
                && face.kind == RoofFaceKind::Slab
                && clipped.iter().all(|v| (v.z - f.z_m).abs() <= 1e-9)
                && let Some(node) = terminal
            {
                match source_slab::terminal_slab(unit, face, node, &projected) {
                    Ok(true) => {
                        pending.push(json!({"native_coplanar_certified":item,"node":node.id}));
                        continue;
                    }
                    Ok(false) => {
                        blockers.push(json!({"source_slab_rejected":item}));
                        continue;
                    }
                    Err(error) => {
                        blockers.push(json!({"native_component_error":error,"contact":item}));
                        continue;
                    }
                }
            }
            blockers.push(item);
        }
    }
    Ok((blockers, pending))
}

fn same_bits(a: Point, b: Point) -> bool {
    a.x.to_bits() == b.x.to_bits() && a.y.to_bits() == b.y.to_bits()
}
fn same_ring(a: &[Point], b: &[Point]) -> bool {
    a.len() == b.len()
        && (0..b.len()).any(|shift| {
            a.iter()
                .enumerate()
                .all(|(i, &p)| same_bits(p, b[(i + shift) % b.len()]))
        })
}
fn recorded_frame(
    unit: &HouseUnit,
    key: &str,
    head: &Feature,
    portal: &Portal,
) -> Result<(Frame, bool, bool), String> {
    let reduced = key.ends_with(":legacy-front-reduced");
    let native = key.strip_suffix(":legacy-front-reduced").unwrap_or(key);
    if native
        .strip_prefix(&format!("{}:public-roof:", unit.id))
        .and_then(|serial| serial.parse::<usize>().ok())
        .is_none()
    {
        return Err("Closed Legacy route token invalid".into());
    }
    let flights: Vec<_> = unit
        .features
        .iter()
        .filter(|f| f.id.starts_with(&format!("{key}:flight:")))
        .collect();
    let odd = flights.len() % 2 == 1;
    let x = if odd { 1.4 } else { 0.025 };
    let [a, b] = portal.opening;
    let length = libm::hypot(b.x - a.x, b.y - a.y);
    if length == 0.0 {
        return Err("Opening has no exact Frame".into());
    }
    let tangent = Point {
        x: (b.x - a.x) / length,
        y: (b.y - a.y) / length,
    };
    let outward = Point {
        x: tangent.y,
        y: -tangent.x,
    };
    let origin = point(a.x - tangent.x * x, a.y - tangent.y * x);
    let distance = snap(
        -rings(&head.surface)
            .flatten()
            .map(|p| (p.x - origin.x) * outward.x + (p.y - origin.y) * outward.y)
            .fold(f64::INFINITY, f64::min),
    );
    let frame = Frame {
        origin,
        tangent,
        outward,
        distance,
    };
    let expected = if reduced {
        if odd {
            return Err("Reduced odd Legacy marker invalid".into());
        }
        reduced_floor(frame)
    } else {
        bridge::floor(frame, odd)
    };
    let (_, passage) = bridge::passage(frame, odd);
    if expected.len() != 1
        || head.surface.len() != 1
        || !head.surface[0].holes.is_empty()
        || !same_ring(&expected[0].outer, &head.surface[0].outer)
        || portal.passage.len() != 1
        || !portal.passage[0].holes.is_empty()
        || !same_ring(&passage[0].outer, &portal.passage[0].outer)
    {
        return Err("Frame opening/dalle/Passage not bit exact".into());
    }
    Ok((frame, odd, reduced))
}
fn outside_rectangles(frame: Frame, odd: bool, reduced: bool) -> Vec<Surface> {
    let d = frame.distance;
    let limit = (d + 0.2).min(DEPTH);
    if odd {
        return vec![
            frame.rect(1.4, limit, 0.85, DEPTH - limit),
            frame.rect(1.3, 0.9, 0.1, 1.0),
        ];
    }
    let y = if reduced { 0.0 } else { -d };
    vec![
        frame.rect(0.0, y, 0.025, limit - y),
        frame.rect(0.875, y, 0.025, limit - y),
        frame.rect(0.0, limit, 0.9, 1.0 - limit),
        frame.rect(0.0, 1.0, 0.8, 0.9),
    ]
}

fn closed_native_chain(
    unit: &HouseUnit,
    key: &str,
    head: &Feature,
    arrival: &Portal,
) -> Result<(), String> {
    let native = key.strip_suffix(":legacy-front-reduced").unwrap_or(key);
    let serial = native
        .strip_prefix(&format!("{}:public-roof:", unit.id))
        .and_then(|s| s.parse::<usize>().ok())
        .ok_or("Legacy27j: closed native token absent")?;
    let count = unit
        .features
        .iter()
        .filter(|f| f.id.starts_with(&format!("{key}:flight:")))
        .count();
    if count == 0 || head.id != format!("{key}:landing:{count}") {
        return Err("Legacy27j: final landing is not the exact native chain".into());
    }
    let find_feature = |id: &str, kind: FeatureKind| -> Result<&Feature, String> {
        let found: Vec<_> = unit.features.iter().filter(|f| f.id == id).collect();
        if found.len() != 1 || found[0].kind != kind {
            return Err("Legacy27j: ambiguous or incorrect route feature".into());
        }
        Ok(found[0])
    };
    let find_portal = |index: usize| -> Result<&Portal, String> {
        let id = format!("{}:portal:{index}", unit.id);
        let found: Vec<_> = unit.access.portals.iter().filter(|p| p.id == id).collect();
        if found.len() != 1 {
            return Err("Legacy27j: ambiguous native route portal".into());
        }
        Ok(found[0])
    };
    let mut nodes = vec![];
    let mut expected_ids = BTreeSet::new();
    for index in 0..=count {
        let id = format!("{key}:landing:{index}");
        expected_ids.insert(id.clone());
        let feature = find_feature(&id, FeatureKind::Landing)?;
        let found: Vec<_> = unit
            .access
            .nodes
            .iter()
            .filter(|n| {
                n.kind == AccessKind::StairLanding
                    && n.household_id.is_none()
                    && n.z_m.to_bits() == feature.z_m.to_bits()
                    && serde_json::to_vec(&n.floor).unwrap()
                        == serde_json::to_vec(&feature.surface).unwrap()
            })
            .collect();
        if found.len() != 1 {
            return Err("Legacy27j: landing has no unique bit-exact native node".into());
        }
        nodes.push(found[0]);
        if index > 0 {
            for post in 0..4 {
                let id = format!("{key}:landing:{index}:post:{post}");
                find_feature(&id, FeatureKind::Post)?;
                expected_ids.insert(id);
            }
        }
    }
    let departure = find_portal(serial)?;
    if departure.kind != PortalKind::Passage
        || departure.to != nodes[0].id
        || !departure.feature_ids.is_empty()
    {
        return Err("Legacy27j: false native departure".into());
    }
    let bases: Vec<_> = unit
        .access
        .nodes
        .iter()
        .filter(|n| n.id == departure.from)
        .collect();
    if bases.len() != 1
        || bases[0].household_id.is_some()
        || bases[0].kind == AccessKind::Room
        || !public_reachable(unit).contains(&bases[0].id)
    {
        return Err("Legacy27j: departure has no unique public base".into());
    }
    for index in 0..count {
        let id = format!("{key}:flight:{index}");
        expected_ids.insert(id.clone());
        let feature = find_feature(&id, FeatureKind::Ladder)?;
        let portal = find_portal(serial + index + 1)?;
        let mut expected = planned_flight(
            feature.surface.clone(),
            &nodes[index].floor,
            nodes[index].z_m,
            nodes[index + 1].z_m,
        )?;
        expected.id = id.clone();
        if feature != &expected
            || portal.kind != PortalKind::Ladder
            || portal.from != nodes[index].id
            || portal.to != nodes[index + 1].id
            || portal.feature_ids != [id]
            || (portal.from_z_m - nodes[index].z_m).abs() > 1e-9
            || (portal.to_z_m - nodes[index + 1].z_m).abs() > 1e-9
        {
            return Err("Legacy27j: flight is not the exact native Ladder chain".into());
        }
    }
    let targets: Vec<_> = unit
        .access
        .nodes
        .iter()
        .filter(|n| n.id == arrival.to)
        .collect();
    if find_portal(serial + count + 1)? != arrival
        || arrival.from != nodes[count].id
        || arrival.feature_ids != [head.id.clone()]
        || targets.len() != 1
        || targets[0].kind != AccessKind::Terrace
        || targets[0].household_id.is_some()
    {
        return Err("Legacy27j: false or ambiguous native arrival".into());
    }
    let actual: Vec<_> = unit
        .features
        .iter()
        .filter(|f| f.id.starts_with(&format!("{key}:")))
        .collect();
    if actual.len() != expected_ids.len() || actual.iter().any(|f| !expected_ids.contains(&f.id)) {
        return Err("Legacy27j: unexpected material in closed native route".into());
    }
    Ok(())
}

pub(super) fn inspect(unit: &HouseUnit, key: &str, check_roofs: bool) -> Result<Value, String> {
    if !check_roofs {
        return Err("Legacy27j: native roof certificate forbidden before roof phase".into());
    }
    let own: Vec<_> = unit
        .features
        .iter()
        .filter(|f| f.id.starts_with(&format!("{key}:")))
        .collect();
    let mut landings: Vec<_> = own
        .iter()
        .copied()
        .filter(|f| f.kind == FeatureKind::Landing)
        .collect();
    landings.sort_by(|a, b| a.z_m.total_cmp(&b.z_m));
    let head = *landings.last().ok_or("Legacy27j: no head")?;
    let portal = unit
        .access
        .portals
        .iter()
        .find(|p| p.kind == PortalKind::Passage && p.feature_ids.contains(&head.id))
        .ok_or("Legacy27j: no terminal Passage")?;
    closed_native_chain(unit, key, head, portal)?;
    let (frame, odd, reduced) = recorded_frame(unit, key, head, portal)?;
    let mut blockers = vec![];
    let mut pending = vec![];
    let outside = unite(&outside_rectangles(frame, odd, reduced));
    let limit = (frame.distance + 0.2).min(DEPTH);
    let inside = frame.rect(
        if odd { 1.4 } else { 0.025 },
        -frame.distance,
        0.85,
        frame.distance + limit,
    );
    let cover = union(&inside, &outside);
    if area(&difference(&head.surface, &cover)) > AREA_EPS
        || area(&difference(&cover, &head.surface)) > AREA_EPS
        || area(&intersection(&inside, &outside)) > AREA_EPS
        || area(&difference(&inside, &portal.passage)) > AREA_EPS
    {
        return Err("Legacy27j: convex masks do not cover the native head/Passage".into());
    }
    for f in own {
        let head = f.id == head.id;
        let masks = if head {
            outside_rectangles(frame, odd, reduced)
        } else {
            vec![f.surface.clone()]
        };
        let base = f.kind == FeatureKind::Landing && f.id.ends_with(":landing:0");
        let base_node = if base {
            let landing = bridge::landing_node(unit, f).ok_or("Base landing node missing")?;
            let departure = unit
                .access
                .portals
                .iter()
                .find(|p| p.kind == PortalKind::Passage && p.to == landing.id)
                .ok_or("Base departure missing")?;
            let node = unit
                .access
                .nodes
                .iter()
                .find(|n| n.id == departure.from)
                .ok_or("Base source node missing")?;
            if !public_reachable(unit).contains(&node.id) {
                return Err("Base is not public".into());
            }
            Some(node)
        } else {
            None
        };
        for mask in masks {
            let (mut b, mut p) = roof_contacts(unit, f, &mask, base_node, head)?;
            blockers.append(&mut b);
            pending.append(&mut p);
        }
    }
    // L∩P keeps the real bridge/31b validator, not an invented jamb exemption.
    let target = unit
        .access
        .nodes
        .iter()
        .find(|n| n.id == portal.to)
        .ok_or("Target source node missing")?;
    for face in unit
        .roofs
        .faces
        .iter()
        .filter(|f| f.kind == RoofFaceKind::Slab)
    {
        let raw: Vec<_> = face
            .vertices
            .iter()
            .map(|&v| unit.roofs.vertices[v as usize].clone())
            .collect();
        let cut = bridge::clip(&raw, &portal.passage)?;
        if cut.is_empty() || !cut.iter().all(|v| (v.z - head.z_m).abs() <= 1e-9) {
            continue;
        }
        let projected = vec![Polygon {
            outer: cut.iter().map(|v| Point { x: v.x, y: v.y }).collect(),
            holes: vec![],
        }];
        if area(&projected) == 0.0 {
            continue;
        }
        match source_slab::terminal_slab(unit, face, target, &projected) {
            Ok(true) => pending.push(
                json!({"terminal_native_coplanar_certified":face.roof_group,"node":target.id}),
            ),
            Ok(false) => blockers.push(json!({"terminal_source_slab_rejected":face.roof_group})),
            Err(error) => blockers.push(json!({"terminal_native_component_error":error})),
        }
    }
    let bridge = bridge::validate(unit, portal, true).err();
    if let Some(error) = &bridge {
        blockers.push(json!({"terminal_bridge":error}));
    }
    Ok(
        json!({"key":key,"blockers":blockers,"native_coplanar_certificates":pending,"shared27i3_component_checked":true,
        "full_legacy_guard_prototype":true,"prototype_guard_clear":blockers.is_empty(),"bridge_error":bridge}),
    )
}

fn reduced_floor(frame: Frame) -> Surface {
    let d = frame.distance;
    let mut ring: Vec<_> = [
        (0.025, -d),
        (0.875, -d),
        (0.875, 0.0),
        (0.9, 0.0),
        (0.9, 1.0),
        (0.8, 1.0),
        (0.8, 1.9),
        (0.0, 1.9),
        (0.0, 0.0),
        (0.025, 0.0),
    ]
    .into_iter()
    .map(|(x, y)| frame.at(x, y))
    .collect();
    if signed_area(&ring) < 0.0 {
        ring.reverse();
    }
    vec![Polygon {
        outer: ring,
        holes: vec![],
    }]
}

pub(super) fn search(
    unit: &HouseUnit,
    bases: &[AccessNode],
    target: &AccessNode,
    roof_events: bool,
    reduced: bool,
) -> Result<Option<HouseUnit>, String> {
    let mut roof_reference = unit.clone();
    if roof_events {
        crate::roofs::build_roofs_with_budget(&mut roof_reference, 20_000)?;
    }
    for minimal in [false, true] {
        for shifted in [false, true] {
            for base in bases {
                let stops = stops(unit, base.z_m, target.z_m, minimal);
                if stops.is_empty() {
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
                                origin: point(edge.x + outward.x * GAP, edge.y + outward.y * GAP),
                                tangent,
                                outward,
                                distance: GAP,
                            };
                            let mut distances = if shifted {
                                bridge::distances(unit, base, legacy, edge)
                            } else {
                                vec![GAP]
                            };
                            if roof_events {
                                distances.clear();
                                let corridor = legacy.rect(0.0, 0.0, RUN + PAD, DEPTH);
                                for face in &roof_reference.roofs.faces {
                                    let shape = vec![Polygon {
                                        outer: face
                                            .vertices
                                            .iter()
                                            .map(|&i| {
                                                let v = &roof_reference.roofs.vertices[i as usize];
                                                Point { x: v.x, y: v.y }
                                            })
                                            .collect(),
                                        holes: vec![],
                                    }];
                                    if area(&intersection(&corridor, &shape)) <= AREA_EPS {
                                        continue;
                                    }
                                    let raw: Vec<_> = face
                                        .vertices
                                        .iter()
                                        .map(|&i| roof_reference.roofs.vertices[i as usize].clone())
                                        .collect();
                                    let clipped = bridge::clip(&raw, &corridor)?;
                                    let projection = clipped
                                        .iter()
                                        .map(|p| {
                                            (p.x - edge.x) * outward.x + (p.y - edge.y) * outward.y
                                        })
                                        .fold(f64::NEG_INFINITY, f64::max);
                                    let d = libm::ceil((projection + GAP) / GRID_M) * GRID_M;
                                    if d > GAP + 1e-9 && d <= bridge::DISTANCE_MAX + 1e-9 {
                                        distances.push(d);
                                    }
                                }
                                distances.sort_by(f64::total_cmp);
                                distances.dedup_by(|a, b| (*a - *b).abs() < 1e-9);
                            }
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
                                if area(&difference(&plan, &base.floor)) > AREA_EPS
                                    || blocked(unit, &plan, base.z_m)
                                {
                                    continue;
                                }
                                let odd = stops.len() % 2 == 1;
                                let top = if reduced && !odd {
                                    reduced_floor(frame)
                                } else {
                                    bridge::floor(frame, odd)
                                };
                                let (opening, passage) = bridge::passage(frame, odd);
                                if !bridge::admissible(unit, target, frame, odd, &top, &passage) {
                                    continue;
                                }
                                let mut candidate = unit.clone();
                                let serial = candidate
                                    .access
                                    .portals
                                    .iter()
                                    .filter_map(|p| p.id.rsplit(':').next()?.parse::<usize>().ok())
                                    .max()
                                    .map_or(0, |n| n + 1);
                                if reduced && odd {
                                    continue;
                                }
                                let mode = if reduced {
                                    RouteMode::LegacyFrontReduced
                                } else {
                                    RouteMode::Legacy
                                };
                                if let Err(_error) = install_mode(
                                    &mut candidate,
                                    base,
                                    target,
                                    frame,
                                    &stops,
                                    opening,
                                    passage,
                                    top,
                                    mode,
                                ) {
                                    continue;
                                }
                                let key = format!(
                                    "{}:public-roof:{}{}",
                                    unit.id,
                                    serial,
                                    if reduced { ":legacy-front-reduced" } else { "" }
                                );
                                if let Err(_error) = validate_geometry(&candidate, false) {
                                    continue;
                                }
                                let installed = candidate.clone();
                                crate::roofs::build_roofs_with_budget(&mut candidate, 20_000)?;
                                let result = inspect(&candidate, &key, true)?;
                                let free = result["prototype_guard_clear"].as_bool().unwrap();
                                if free {
                                    return Ok(Some(installed));
                                }
                            }
                        }
                    }
                }
            }
        }
    }
    Ok(None)
}

pub(super) fn validate_roofs(unit: &HouseUnit) -> Result<(), String> {
    let keys: BTreeSet<_> = unit
        .features
        .iter()
        .filter(|f| f.kind == FeatureKind::Landing)
        .filter_map(|f| f.id.split_once(":landing:").map(|(key, _)| key))
        .filter(|key| {
            key.strip_prefix(&format!("{}:public-roof:", unit.id))
                .is_some_and(|serial| {
                    serial
                        .strip_suffix(":legacy-front-reduced")
                        .unwrap_or(serial)
                        .parse::<usize>()
                        .is_ok()
                })
        })
        .collect();
    for key in keys {
        let verdict = inspect(unit, key, true)?;
        if verdict["prototype_guard_clear"] != true {
            return Err(format!(
                "{key}: complete native Legacy roof guard refused: {}",
                verdict["blockers"]
            ));
        }
    }
    Ok(())
}

#[cfg(test)]
mod reviewed_negatives {
    use super::*;
    fn actual_unit() -> HouseUnit {
        serde_json::from_value(super::super::super::fixture_json_exact::value(
            include_bytes!("../../../tests/fixtures/legacy27j-phase-unit.json"),
        ))
        .unwrap()
    }
    #[test]
    fn actual_roofs_present_do_not_authorize_false_phase() {
        let unit = actual_unit();
        assert!(!unit.roofs.faces.is_empty());
        let before = unit.clone();
        assert!(
            inspect(&unit, "unit-2:public-roof:51", false)
                .unwrap_err()
                .contains("before roof phase")
        );
        assert_eq!(unit, before);
    }
    #[test]
    fn actual_native_occupation_never_exempts_a_coplanar_cut() {
        let unit = actual_unit();
        let node = unit
            .access
            .nodes
            .iter()
            .find(|n| n.id == "unit-2:space:24")
            .unwrap();
        crate::access::native_roof_walk_component(&unit, node).unwrap();
        let occupation = super::super::native_link_occupation(&unit, node).unwrap();
        assert!(area(&occupation) > 0.09);
        let face = unit
            .roofs
            .faces
            .iter()
            .find(|f| f.kind == RoofFaceKind::Slab && f.body_id == "unit-2:body:3" && f.level == 1)
            .unwrap();
        assert!(
            source_slab::terminal_slab(&unit, face, node, &occupation)
                .unwrap_err()
                .contains("enters the native flight occupation")
        );
    }
    #[test]
    fn false_closed_route_token_cannot_claim_native_source() {
        let unit = actual_unit();
        assert!(inspect(&unit, "unit-2:public-roof:51:arbitrary", true).is_err());
    }
    #[test]
    fn exact_original_terminal_025_contacts_are_both_refused() {
        let unit: HouseUnit =
            serde_json::from_value(super::super::super::fixture_json_exact::value(
                include_bytes!("../../../tests/fixtures/legacy27j-terminal-original-unit.json"),
            ))
            .unwrap();
        let report = inspect(&unit, "unit-3:public-roof:40", true).unwrap();
        assert_eq!(report["prototype_guard_clear"], false);
        for (face, expected) in [
            (13, 0.025000000000000355_f64),
            (14, 0.025000000000000133_f64),
        ] {
            let contact = report["blockers"]
                .as_array()
                .unwrap()
                .iter()
                .find(|v| v["face"] == face)
                .unwrap();
            let ys: Vec<_> = contact["clipped"]
                .as_array()
                .unwrap()
                .iter()
                .map(|v| v["y"].as_f64().unwrap())
                .collect();
            let span = ys.iter().copied().fold(f64::NEG_INFINITY, f64::max)
                - ys.iter().copied().fold(f64::INFINITY, f64::min);
            assert_eq!(span.to_bits(), expected.to_bits());
        }
    }
    #[test]
    fn a_reduced_token_cannot_hide_a_full_fore_floor() {
        let mut unit = actual_unit();
        let old = "unit-2:public-roof:51";
        let key = format!("{old}:legacy-front-reduced");
        for f in &mut unit.features {
            if f.id.starts_with(&format!("{old}:")) {
                f.id = f.id.replacen(old, &key, 1);
            }
        }
        for p in &mut unit.access.portals {
            for id in &mut p.feature_ids {
                if id.starts_with(&format!("{old}:")) {
                    *id = id.replacen(old, &key, 1);
                }
            }
        }
        assert!(
            inspect(&unit, &key, true)
                .unwrap_err()
                .contains("not bit exact")
        );
    }
    #[test]
    fn actual_face_cuts_in_occupation_fail_for_legacy_and_reduced_sources() {
        let reduced: HouseUnit =
            serde_json::from_value(super::super::super::fixture_json_exact::value(
                include_bytes!("../../../tests/fixtures/legacy27j-reduced-native-unit.json"),
            ))
            .unwrap();
        for unit in [actual_unit(), reduced] {
            let node = unit
                .access
                .nodes
                .iter()
                .find(|n| n.id == "unit-2:space:24")
                .unwrap();
            let occupation = super::super::native_link_occupation(&unit, node).unwrap();
            let mut checked = 0;
            for face in unit.roofs.faces.iter().filter(|f| {
                f.kind == RoofFaceKind::Slab && f.body_id == "unit-2:body:3" && f.level == 1
            }) {
                let raw: Vec<_> = face
                    .vertices
                    .iter()
                    .map(|&i| unit.roofs.vertices[i as usize].clone())
                    .collect();
                let cut = bridge::clip(&raw, &occupation).unwrap();
                let projected = vec![Polygon {
                    outer: cut.iter().map(|v| Point { x: v.x, y: v.y }).collect(),
                    holes: vec![],
                }];
                if area(&projected) > AREA_EPS {
                    assert!(
                        source_slab::terminal_slab(&unit, face, node, &projected)
                            .unwrap_err()
                            .contains("enters the native flight occupation")
                    );
                    checked += 1;
                }
            }
            assert!(checked > 0);
        }
    }
    #[test]
    fn the_real_rebuilt_47_and_51_have_closed_unique_chains() {
        let unit: HouseUnit =
            serde_json::from_value(super::super::super::fixture_json_exact::value(
                include_bytes!("../../../tests/fixtures/legacy27j-reduced-native-unit.json"),
            ))
            .unwrap();
        let before = serde_json::to_vec(&unit).unwrap();
        for key in [
            "unit-2:public-roof:47",
            "unit-2:public-roof:51:legacy-front-reduced",
        ] {
            assert_eq!(
                inspect(&unit, key, true).unwrap()["prototype_guard_clear"],
                true
            );
        }
        assert_eq!(serde_json::to_vec(&unit).unwrap(), before);
    }
    #[test]
    fn duplicate_or_extra_native_instances_are_rejected() {
        for case in 0..3 {
            let mut unit: HouseUnit =
                serde_json::from_value(super::super::super::fixture_json_exact::value(
                    include_bytes!("../../../tests/fixtures/legacy27j-reduced-native-unit.json"),
                ))
                .unwrap();
            let key = "unit-2:public-roof:51:legacy-front-reduced";
            match case {
                0 => {
                    let p = unit
                        .access
                        .portals
                        .iter()
                        .find(|p| p.id == "unit-2:portal:54")
                        .unwrap()
                        .clone();
                    unit.access.portals.push(p);
                }
                1 => {
                    let f = unit
                        .features
                        .iter()
                        .find(|f| f.id == format!("{key}:flight:0"))
                        .unwrap()
                        .clone();
                    unit.features.push(f);
                }
                2 => {
                    let mut f = unit
                        .features
                        .iter()
                        .find(|f| f.id == format!("{key}:landing:2:post:0"))
                        .unwrap()
                        .clone();
                    f.id = format!("{key}:extra-material");
                    unit.features.push(f);
                }
                _ => unreachable!(),
            }
            assert!(inspect(&unit, key, true).is_err(), "case {case}");
        }
    }
    #[test]
    fn a_sibling_terrace_is_not_the_actual_terminal_source() {
        let mut unit: HouseUnit =
            serde_json::from_value(super::super::super::fixture_json_exact::value(
                include_bytes!("../../../tests/fixtures/legacy27j-reduced-native-unit.json"),
            ))
            .unwrap();
        unit.access
            .portals
            .iter_mut()
            .find(|p| p.id == "unit-2:portal:54")
            .unwrap()
            .to = "unit-2:space:23".into();
        let report = inspect(&unit, "unit-2:public-roof:51:legacy-front-reduced", true).unwrap();
        assert_eq!(report["prototype_guard_clear"], false);
        assert!(
            report["blockers"]
                .as_array()
                .unwrap()
                .iter()
                .any(|v| v.get("terminal_source_slab_rejected").is_some())
        );
    }
}
