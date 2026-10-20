use super::*;

pub(crate) fn route(d: f64) -> HouseUnit {
    let value: serde_json::Value = serde_json::from_str(include_str!(
        "../../../../fixtures/houses/parapet-him2.json"
    ))
    .unwrap();
    let captured: HouseUnit = serde_json::from_value(value["unit"].clone()).unwrap();
    let mut unit = crate::access::batches25_tests::lower_corridor();
    unit.access.nodes.clear();
    unit.access.portals.clear();
    unit.features.clear();
    unit.walls.clear();
    let base = AccessNode {
        id: "base".into(),
        kind: AccessKind::Exterior,
        floor: rectangle(-3.0, -0.15, 10.0, 3.3),
        z_m: 0.0,
        household_id: None,
    };
    let target = AccessNode {
        id: "roof".into(),
        kind: AccessKind::Terrace,
        floor: rectangle(-3.0, -4.0, 10.0, 4.0 - d),
        z_m: snap(8.4),
        household_id: None,
    };
    let mut body = captured.bodies[0].clone();
    body.id = "native".into();
    body.details.clear();
    body.cells.clear();
    body.roof_system = "RF-FLAT".into();
    body.footprint = target.floor.clone();
    let template = body.levels[0].clone();
    body.levels = (0..3)
        .map(|i| {
            let mut l = template.clone();
            l.index = i;
            l.z_m = snap(i as f64 * 2.8);
            l.height_m = snap(2.8);
            l.footprint = target.floor.clone();
            l.floor = target.floor.clone();
            l.intermediate_cover = IntermediateCover::Terrace;
            l.roof_slab = if i == 2 {
                Some(RoofSlab {
                    surface: target.floor.clone(),
                    z_m: target.z_m,
                    walkable: true,
                    access_node: Some(target.id.clone()),
                })
            } else {
                None
            };
            l
        })
        .collect();
    body.overhang_m = 0.425;
    let component_id = body.component_id.clone();
    unit.bodies = vec![body];
    unit.access.root = base.id.clone();
    unit.access.nodes.extend([base.clone(), target.clone()]);
    let frame = Frame {
        origin: point(0.0, 0.0),
        tangent: point(1.0, 0.0),
        outward: point(0.0, 1.0),
        distance: d,
    };
    let (opening, passage) = bridge::passage(frame, true);
    install_mode(
        &mut unit,
        &base,
        &target,
        frame,
        &[snap(2.8), snap(5.6), target.z_m],
        opening,
        passage,
        floor(frame),
        RouteMode::OutboardEaves,
    )
    .unwrap();
    let surface = rectangle(-3.0, -4.0, 10.0, 4.0 - d + 0.425);
    for i in 0..3 {
        let surface = if i == 2 {
            target.floor.clone()
        } else {
            surface.clone()
        };
        let group = format!(
            "native:{i}:{}",
            if i == 2 { "main" } else { "intermediate" }
        );
        let z = snap((i + 1) as f64 * 2.8);
        let offset = unit.roofs.vertices.len() as u32;
        unit.roofs.vertices.extend(
            surface[0]
                .outer
                .iter()
                .map(|p| Vertex3 { x: p.x, y: p.y, z }),
        );
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
            domain: surface.clone(),
        });
    }
    unit
}

fn head(unit: &HouseUnit) -> &Feature {
    unit.features
        .iter()
        .find(|f| f.id.ends_with(":outboard-eaves:landing:3"))
        .unwrap()
}

fn slab(unit: &mut HouseUnit, surface: Surface, z: f64, kind: RoofFaceKind) {
    let offset = unit.roofs.vertices.len() as u32;
    unit.roofs.vertices.extend(
        surface[0]
            .outer
            .iter()
            .map(|p| Vertex3 { x: p.x, y: p.y, z }),
    );
    let mut face = unit.roofs.faces[0].clone();
    face.vertices = (offset..offset + surface[0].outer.len() as u32).collect();
    face.kind = kind;
    face.roof_group = "foreign".into();
    unit.roofs.faces.push(face);
}

#[test]
fn minimal_eaves_chain_passes_all_elements_and_both_native_events() {
    let unit = route(0.566);
    validate_geometry(&unit, true).unwrap();
    let frame = Frame {
        origin: point(0.0, 0.0),
        tangent: point(1.0, 0.0),
        outward: point(0.0, 1.0),
        distance: 0.566,
    };
    assert_eq!(
        distance(&unit, &unit, frame, 0.0, 8.4).unwrap(),
        Some(snap(0.566))
    );
    for d in [0.54, 0.565, 0.567, 0.571] {
        let broken = route(d);
        assert!(validate_geometry(&broken, true).is_err(), "d={d}");
    }
}

#[test]
fn intermediate_paliers_posts_and_complete_flights_see_native_roofs() {
    let unit = route(0.566);
    for suffix in [":landing:1", ":landing:2:post:0", ":flight:0"] {
        let mut broken = unit.clone();
        let f = broken
            .features
            .iter()
            .find(|f| f.id.ends_with(suffix))
            .unwrap()
            .clone();
        let z = if f.kind == FeatureKind::Post {
            2.8
        } else {
            f.z_m
        };
        slab(&mut broken, f.surface, z, RoofFaceKind::Slab);
        assert!(
            validate_geometry(&broken, true)
                .unwrap_err()
                .contains("toiture")
        );
    }
}

#[test]
fn foreign_coplanar_arrival_and_landing_outside_passage_are_refused() {
    let unit = route(0.566);
    let mut broken = unit.clone();
    slab(
        &mut broken,
        rectangle(1.5, -0.5, 0.2, 0.1),
        8.4,
        RoofFaceKind::Slab,
    );
    assert!(
        validate_geometry(&broken, true)
            .unwrap_err()
            .contains("coplanaire")
    );
    let mut broken = unit.clone();
    slab(
        &mut broken,
        rectangle(1.5, 1.3, 0.2, 0.1),
        8.4,
        RoofFaceKind::Slab,
    );
    assert!(
        validate_geometry(&broken, true)
            .unwrap_err()
            .contains("prisme")
    );
}

#[test]
fn false_intermediate_sources_cannot_certify_the_new_span() {
    let unit = route(0.566);
    for mutation in 0..5 {
        let mut broken = unit.clone();
        match mutation {
            0 => {
                for level in &mut broken.bodies[0].levels {
                    level.intermediate_cover = IntermediateCover::Shed
                }
            }
            1 => {
                for face in &mut broken.roofs.faces {
                    if face.level < 2 {
                        face.feature_id = Some("fake".into());
                    }
                }
            }
            2 => {
                for face in &mut broken.roofs.faces {
                    if face.level < 2 {
                        face.roof_group = "native:0:main".into();
                    }
                }
            }
            3 => {
                for group in &mut broken.roofs.groups {
                    if group.level < 2 {
                        group.domain = rectangle(10.0, 10.0, 1.0, 1.0);
                    }
                }
            }
            _ => {
                for face in &mut broken.roofs.faces {
                    if face.level < 2 {
                        face.component_id = Some("foreign".into());
                    }
                }
            }
        }
        assert!(
            validate_geometry(&broken, true)
                .unwrap_err()
                .contains("nécessité")
        );
    }
}

#[test]
fn malformed_marker_and_extra_material_do_not_escape_validation() {
    let unit = route(0.566);
    for mutation in 0..3 {
        let mut broken = unit.clone();
        match mutation {
            0 => broken.features.push(feature(
                "foreign:outboard-eavesx",
                FeatureKind::Frame,
                rectangle(10.0, 10.0, 1.0, 1.0),
                0.0,
                0.1,
                "MAT-TIMBER-POST",
            )),
            1 => {
                let mut extra = head(&broken).clone();
                extra.id = extra.id.replace(":landing:3", ":surplus");
                broken.features.push(extra);
            }
            _ => {
                let f = broken
                    .features
                    .iter_mut()
                    .find(|f| f.id.ends_with(":landing:3:post:0"))
                    .unwrap();
                f.surface = translate(&f.surface, 0.0, 0.001);
            }
        }
        assert!(validate_geometry(&broken, false).is_err());
    }
}
