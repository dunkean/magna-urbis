use super::*;

fn route() -> HouseUnit {
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
        floor: rectangle(-3.0, -4.0, 10.0, 4.0 - 0.171),
        z_m: 8.4,
        household_id: None,
    };
    unit.access.root = base.id.clone();
    unit.access.nodes.extend([base.clone(), target.clone()]);
    let frame = Frame {
        origin: point(0.0, 0.0),
        tangent: point(1.0, 0.0),
        outward: point(0.0, 1.0),
        distance: 0.171,
    };
    let final_floor = floor(frame);
    let (opening, passage) = bridge::passage(frame, true);
    assert!(bridge::admissible_outboard(
        &unit,
        &target,
        frame,
        &final_floor,
        &passage,
        &heads(frame),
    ));
    install_mode(
        &mut unit,
        &base,
        &target,
        frame,
        &[2.8, 5.6, 8.4],
        opening,
        passage,
        final_floor,
        RouteMode::Outboard,
    )
    .unwrap();
    validate_geometry(&unit, false).unwrap();
    unit
}

fn head(unit: &HouseUnit) -> &Feature {
    unit.features
        .iter()
        .find(|f| f.id.ends_with(":outboard:landing:3"))
        .unwrap()
}

fn change_head(unit: &mut HouseUnit, surface: Surface) {
    let id = head(unit).id.clone();
    unit.features
        .iter_mut()
        .find(|f| f.id == id)
        .unwrap()
        .surface = surface.clone();
    let node = unit.access.portals.last().unwrap().from.clone();
    unit.access
        .nodes
        .iter_mut()
        .find(|n| n.id == node)
        .unwrap()
        .floor = surface;
}

#[test]
fn four_outboard_bearings_clear_the_native_returns_and_keep_real_heads() {
    let unit = route();
    let slab = head(&unit);
    assert!(mode(&unit, slab).unwrap() == BearingMode::Outboard);
    let frame = Frame {
        origin: point(0.0, 0.0),
        tangent: point(1.0, 0.0),
        outward: point(0.0, 1.0),
        distance: 0.171,
    };
    let native_return = frame.rect(1.4, 0.0, 0.85, DEPTH);
    for post in unit
        .features
        .iter()
        .filter(|f| f.id.starts_with(&format!("{}:post:", slab.id)))
    {
        assert!(area(&intersection(&post.surface, &native_return)) <= AREA_EPS);
        assert!(area(&difference(&post.surface, &slab.surface)) <= AREA_EPS);
    }
    let missing_head = difference(&slab.surface, &frame.rect(1.89, DEPTH, 0.28, SHIFT));
    let mut broken = unit.clone();
    change_head(&mut broken, missing_head);
    assert!(validate_geometry(&broken, false).is_err());
}

#[test]
fn outboard_chain_and_marker_do_not_fall_back_to_legacy() {
    let unit = route();
    for mutation in 0..4 {
        let mut broken = unit.clone();
        match mutation {
            0 => {
                let flight = broken
                    .features
                    .iter_mut()
                    .find(|f| f.id.ends_with(":outboard:flight:1"))
                    .unwrap();
                flight.kind = FeatureKind::Stair;
            }
            1 => {
                let mut extra = broken
                    .features
                    .iter()
                    .find(|f| f.id.ends_with(":outboard:flight:2"))
                    .unwrap()
                    .clone();
                extra.id = extra.id.replace(":flight:2", ":flight:3");
                broken.features.push(extra);
            }
            2 => broken
                .access
                .portals
                .last_mut()
                .unwrap()
                .feature_ids
                .clear(),
            _ => {
                let post = broken
                    .features
                    .iter_mut()
                    .find(|f| f.id.ends_with(":outboard:landing:3:post:2"))
                    .unwrap();
                post.surface = translate(&post.surface, 0.0, -0.34);
            }
        }
        assert!(validate_geometry(&broken, false).is_err());
    }
    let mut untagged = unit.clone();
    for f in &mut untagged.features {
        f.id = f.id.replace(":outboard", "");
    }
    for p in &mut untagged.access.portals {
        for id in &mut p.feature_ids {
            *id = id.replace(":outboard", "");
        }
    }
    assert!(validate_geometry(&untagged, false).is_err());
}

#[test]
fn final_heads_keep_strict_forward_back_and_longitudinal_spans() {
    let unit = route();
    for extra in [
        rectangle(1.89, -0.542, 0.28, 0.01),
        rectangle(1.89, 2.04, 0.28, 0.001),
        rectangle(2.761, 0.5, 0.01, 0.1),
    ] {
        let mut broken = unit.clone();
        let surface = union(&head(&broken).surface, &extra);
        change_head(&mut broken, surface);
        assert!(
            validate_geometry(&broken, false)
                .unwrap_err()
                .contains("portée")
        );
    }
}

#[test]
fn feet_head_height_and_foreign_volume_are_material_requirements() {
    let unit = route();
    let foot = unit
        .features
        .iter()
        .find(|f| f.id.ends_with(":outboard:landing:3:post:0"))
        .unwrap()
        .surface
        .clone();
    for mutation in 0..4 {
        let mut broken = unit.clone();
        match mutation {
            0 => {
                let base = broken
                    .access
                    .nodes
                    .iter_mut()
                    .find(|n| n.id == "base")
                    .unwrap();
                base.floor = difference(&base.floor, &foot);
            }
            1 => {
                broken
                    .features
                    .iter_mut()
                    .find(|f| f.id.ends_with(":outboard:landing:3:post:0"))
                    .unwrap()
                    .height_m -= 0.01;
            }
            2 => broken.site_context.push(feature(
                "retaining-above-foot",
                FeatureKind::Retaining,
                foot.clone(),
                0.0,
                0.1,
                "MAT-STONE-DRY",
            )),
            _ => broken.features.push(feature(
                "foreign-roof-drain",
                FeatureKind::RoofDrain,
                foot.clone(),
                2.8,
                0.1,
                "MAT-STONE-DRY",
            )),
        }
        assert!(validate_geometry(&broken, false).is_err());
    }
}

#[test]
fn a_late_head_keeps_the_height_of_every_previous_landing() {
    let mut unit = route();
    let extension = rectangle(1.89, DEPTH, 0.28, SHIFT);
    unit.features.push(feature(
        "previous-public-roof:landing:1",
        FeatureKind::Landing,
        extension,
        6.3,
        0.15,
        "MAT-TIMBER-POST",
    ));
    assert!(
        validate_geometry(&unit, false)
            .unwrap_err()
            .contains("hauteur libre")
    );
}

#[test]
fn native_roofs_and_tangent_faces_remain_closed_for_columns() {
    let unit = route();
    let foot = unit
        .features
        .iter()
        .find(|f| f.id.ends_with(":outboard:landing:3:post:0"))
        .unwrap()
        .surface
        .clone();
    for surface in [foot.clone(), rectangle(2.17, -0.14, 0.2, 0.14)] {
        let mut broken = unit.clone();
        let vertices = surface[0]
            .outer
            .iter()
            .map(|p| Vertex3 {
                x: p.x,
                y: p.y,
                z: 2.8,
            })
            .collect::<Vec<_>>();
        broken.roofs.vertices = vertices;
        broken.roofs.faces.push(RoofFace {
            body_id: "intermediate-native".into(),
            feature_id: None,
            level: 0,
            kind: RoofFaceKind::Slab,
            rf: "RF-FLAT".into(),
            roof_group: "intermediate-native:0".into(),
            component_id: None,
            vertices: vec![0, 1, 2, 3],
            material: "MAT-STONE-DRY".into(),
            normal: [0.0, 0.0, 1.0],
        });
        assert!(
            validate_columns(&broken, true)
                .unwrap_err()
                .contains("toiture")
        );
    }
}
