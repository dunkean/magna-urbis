use super::*;

fn route() -> HouseUnit {
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
        floor: rectangle(-3.0, 0.0, 10.0, 3.3),
        z_m: 0.0,
        household_id: None,
    };
    let target = AccessNode {
        id: "roof".into(),
        kind: AccessKind::Terrace,
        floor: rectangle(-3.0, -4.0, 10.0, 4.0 - 0.381),
        z_m: 3.25,
        household_id: None,
    };
    let mut body = captured.bodies[0].clone();
    body.id = "native-band-body".into();
    body.details = vec!["timber_bands".into()];
    body.cells.clear();
    body.footprint = target.floor.clone();
    body.levels.truncate(1);
    body.levels[0].z_m = 0.45;
    body.levels[0].height_m = 2.8;
    body.levels[0].footprint = target.floor.clone();
    body.levels[0].floor = target.floor.clone();
    body.levels[0].roof_slab = Some(RoofSlab {
        surface: target.floor.clone(),
        z_m: 3.25,
        walkable: true,
        access_node: Some(target.id.clone()),
    });
    let mut wall = captured.walls[0].clone();
    wall.id = "native-rim-wall".into();
    wall.body_id = Some(body.id.clone());
    wall.z_m = 0.45;
    wall.height_m = 2.8;
    wall.party = false;
    wall.shell_reference = false;
    wall.solid = None;
    wall.plan_section = None;
    wall.opening_ids.clear();
    wall.footprint = rectangle(-3.0, -0.981, 10.0, 0.6);
    for s in crate::features::beam_surfaces(&body, crate::features::BEAM_SPACING_M) {
        let index = unit.features.len();
        unit.features.push(feature(
            &format!("detail-timber_bands-{index}"),
            FeatureKind::Frame,
            s,
            3.25,
            0.18,
            &body.levels[0].materials.roof_frame,
        ));
    }
    unit.bodies = vec![body];
    unit.walls = vec![wall];
    unit.access.root = base.id.clone();
    unit.access.nodes.extend([base.clone(), target.clone()]);
    let frame = Frame {
        origin: point(0.0, 0.0),
        tangent: point(1.0, 0.0),
        outward: point(0.0, 1.0),
        distance: 0.381,
    };
    let (opening, passage) = bridge::passage(frame, false);
    install_mode(
        &mut unit,
        &base,
        &target,
        frame,
        &[2.8, 3.25],
        opening,
        passage,
        bridge::floor(frame, false),
        RouteMode::BandOpen,
    )
    .unwrap();
    let p = unit.access.portals.last().unwrap().clone();
    let cuts = timber::prepare_bridge(&unit, &p).unwrap();
    timber::apply(&mut unit, cuts, &p.id);
    validate_geometry(&unit, false).unwrap();
    unit
}

#[test]
fn a_material_bridge_opening_is_certified_without_a_corner_link() {
    let unit = route();
    let p = unit.access.portals.last().unwrap();
    let m = mask(&unit, p).unwrap();
    assert!((area(&m.surface) - 0.17).abs() < AREA_EPS);
    let body = &unit.bodies[0];
    let native = crate::features::beam_surfaces(body, crate::features::BEAM_SPACING_M);
    let band = &unit.features[1];
    assert!((area(&difference(&native[1], &band.surface)) - 0.068).abs() < AREA_EPS);
    assert_eq!(unit.features[0].surface, native[0]);
    let mut unchanged = unit.clone();
    unchanged.features[1].surface = native[1].clone();
    assert!(validate_geometry(&unchanged, false).is_err());
}

#[test]
fn passage_body_and_chain_mutations_cannot_authorize_a_mask() {
    let unit = route();
    for mutation in 0..7 {
        let mut broken = unit.clone();
        match mutation {
            0 => {
                let p = broken.access.portals.last_mut().unwrap();
                p.passage = union(&p.passage, &rectangle(0.024, -0.581, 0.001, 0.2));
                p.opening_surface = p.passage.clone();
            }
            1 => {
                broken
                    .access
                    .nodes
                    .iter_mut()
                    .find(|n| n.id == "roof")
                    .unwrap()
                    .household_id = Some("private".into())
            }
            2 => {
                let mut body = broken.bodies[0].clone();
                body.id = "duplicate-bearing".into();
                broken.bodies.push(body);
            }
            3 => {
                let mut extra = broken
                    .features
                    .iter()
                    .find(|f| f.id.ends_with(":flight:1"))
                    .unwrap()
                    .clone();
                extra.id = extra.id.replace(":flight:1", ":flight:2");
                broken.features.push(extra);
            }
            4 => {
                broken
                    .features
                    .iter_mut()
                    .find(|f| f.id.ends_with(":flight:1"))
                    .unwrap()
                    .vertices3d[2]
                    .z += 0.01
            }
            5 => {
                let p = broken.access.portals.last_mut().unwrap();
                p.feature_ids[0] = p.feature_ids[0].replace(":band-open", ":outboard:band-open");
            }
            _ => broken.access.portals.last_mut().unwrap().to_z_m += 0.01,
        }
        assert!(
            validate_geometry(&broken, false).is_err(),
            "mutation {mutation}"
        );
    }
}

#[test]
fn native_band_origin_exact_cut_and_all_positive_pieces_are_required() {
    let unit = route();
    for mutation in 0..7 {
        let mut broken = unit.clone();
        let band = &mut broken.features[1];
        match mutation {
            0 => band.material = "structural-frame".into(),
            1 => band.z_m += 0.01,
            2 => band.height_m += 0.01,
            3 => band.surface = difference(&band.surface, &rectangle(0.875, -0.461, 0.01, 0.08)),
            4 => band.surface.pop().map(|_| ()).unwrap(),
            5 => band.id = "detail-vigas-1".into(),
            _ => broken.features[0].surface = translate(&broken.features[0].surface, 0.01, 0.0),
        }
        assert!(
            validate_geometry(&broken, false).is_err(),
            "mutation {mutation}"
        );
    }
}

#[test]
fn rim_wall_slab_and_foreign_clearance_remain_material_constraints() {
    let unit = route();
    let m = mask(&unit, unit.access.portals.last().unwrap()).unwrap();
    for mutation in 0..6 {
        let mut broken = unit.clone();
        match mutation {
            0 => broken.walls[0].footprint = difference(&broken.walls[0].footprint, &m.surface),
            1 => broken.walls[0].party = true,
            2 => broken.walls[0].id = "native:portal:volume:0".into(),
            3 => {
                let slab = broken.bodies[0].levels[0].roof_slab.as_mut().unwrap();
                slab.surface = difference(&slab.surface, &m.surface);
            }
            4 => broken.features.push(feature(
                "foreign-frame",
                FeatureKind::Frame,
                m.surface.clone(),
                3.25,
                0.18,
                "MAT-TIMBER-POST",
            )),
            _ => broken.features.push(feature(
                "late-drain",
                FeatureKind::RoofDrain,
                m.surface.clone(),
                3.25,
                0.18,
                "MAT-STONE-DRY",
            )),
        }
        assert!(
            validate_geometry(&broken, false).is_err(),
            "mutation {mutation}"
        );
    }
}

#[test]
fn unused_or_absent_marker_cannot_justify_native_band_changes() {
    let unit = route();
    let mut missing = unit.clone();
    for f in &mut missing.features {
        f.id = f.id.replace(":band-open", "");
    }
    for p in &mut missing.access.portals {
        for id in &mut p.feature_ids {
            *id = id.replace(":band-open", "");
        }
    }
    assert!(validate_geometry(&missing, false).is_err());
    let mut unused = unit.clone();
    unused.bodies[0].details.clear();
    unused
        .features
        .retain(|f| !f.id.starts_with("detail-timber_bands-"));
    assert!(validate_geometry(&unused, false).is_err());
}

fn add_corner(unit: &mut HouseUnit) {
    let mut body = unit.bodies[0].clone();
    body.id = "lower-corner-body".into();
    body.footprint = rectangle(7.0, -0.381, 5.0, 6.0);
    body.levels[0].z_m = 0.0;
    body.levels[0].height_m = snap(2.8);
    body.levels[0].footprint = body.footprint.clone();
    body.levels[0].floor = body.footprint.clone();
    body.levels[0].roof_slab = Some(RoofSlab {
        surface: body.footprint.clone(),
        z_m: 2.8,
        walkable: true,
        access_node: Some("lower-roof".into()),
    });
    for surface in crate::features::beam_surfaces(&body, crate::features::BEAM_SPACING_M) {
        let index = unit.features.len();
        unit.features.push(feature(
            &format!("detail-timber_bands-{index}"),
            FeatureKind::Frame,
            surface,
            2.8,
            0.18,
            &body.levels[0].materials.roof_frame,
        ));
    }
    let mut wall = unit.walls[0].clone();
    wall.id = "lower-corner-wall".into();
    wall.body_id = Some(body.id.clone());
    wall.z_m = 0.0;
    wall.height_m = 2.8;
    wall.footprint = union(
        &rectangle(7.0, -0.381, 0.6, 6.0),
        &rectangle(7.0, -0.381, 5.0, 0.6),
    );
    unit.walls.push(wall);
    let base = AccessNode {
        id: "lower-roof".into(),
        kind: AccessKind::Terrace,
        floor: body.footprint.clone(),
        z_m: 2.8,
        household_id: None,
    };
    unit.bodies.push(body);
    unit.access.nodes.push(base.clone());
    let target = unit
        .access
        .nodes
        .iter()
        .find(|n| n.id == "roof")
        .unwrap()
        .clone();
    links::install_fixture_link(
        unit,
        &base,
        &target,
        point(7.0, -0.381),
        Point {
            x: -libm::sqrt(0.5),
            y: -libm::sqrt(0.5),
        },
    )
    .unwrap();
}

#[test]
fn corner_and_bridge_masks_share_one_native_band_in_both_orders() {
    for corner_first in [false, true] {
        let mut unit = route();
        if corner_first {
            unit.features.retain(|f| !f.id.contains(":band-open"));
            let native =
                crate::features::beam_surfaces(&unit.bodies[0], crate::features::BEAM_SPACING_M);
            unit.features[1].surface = native[1].clone();
            unit.access
                .nodes
                .retain(|n| n.id == "base" || n.id == "roof");
            unit.access.portals.clear();
        }
        add_corner(&mut unit);
        if corner_first {
            let base = unit
                .access
                .nodes
                .iter()
                .find(|n| n.id == "base")
                .unwrap()
                .clone();
            let target = unit
                .access
                .nodes
                .iter()
                .find(|n| n.id == "roof")
                .unwrap()
                .clone();
            let frame = Frame {
                origin: point(0.0, 0.0),
                tangent: point(1.0, 0.0),
                outward: point(0.0, 1.0),
                distance: 0.381,
            };
            let (opening, passage) = bridge::passage(frame, false);
            install_mode(
                &mut unit,
                &base,
                &target,
                frame,
                &[2.8, 3.25],
                opening,
                passage,
                bridge::floor(frame, false),
                RouteMode::BandOpen,
            )
            .unwrap();
            let p = unit.access.portals.last().unwrap().clone();
            let cuts = timber::prepare_bridge(&unit, &p).unwrap();
            timber::apply(&mut unit, cuts, &p.id);
        }
        validate_geometry(&unit, false).unwrap();
        let link = unit
            .features
            .iter()
            .find(|f| f.id.contains(":link:"))
            .unwrap();
        let p = unit
            .access
            .portals
            .iter()
            .find(|p| {
                p.feature_ids
                    .iter()
                    .any(|id| id.ends_with(":band-open:landing:2"))
            })
            .unwrap();
        let bridge = mask(&unit, p).unwrap();
        let native =
            crate::features::beam_surfaces(&unit.bodies[0], crate::features::BEAM_SPACING_M);
        assert!(area(&intersection(&native[1], &link.surface)) > AREA_EPS);
        assert!(area(&intersection(&native[1], &bridge.surface)) > AREA_EPS);
        assert!(equal(
            &unit.features[1].surface,
            &difference(&native[1], &union(&link.surface, &bridge.surface),)
        ));
    }
}
