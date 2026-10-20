use catalogue::{Envelope, VerticalAccess};
use geometry::{ellipse, rectangle};
use magna_urbis_houses::roofs;
pub use magna_urbis_houses::{catalogue, geometry, model};
use model::*;
use roofs::{build_roofs, estimate_roof_faces};

fn materials() -> MaterialSlots {
    MaterialSlots {
        frame: "MAT-STONE".into(),
        infill: "MAT-STONE".into(),
        coating: "MAT-PLASTER".into(),
        cladding: "MAT-TILE-CLAY".into(),
        base: "MAT-STONE".into(),
        roof_frame: "MAT-STONE".into(),
    }
}
fn arm(x: f64, y: f64, w: f64, d: f64) -> RoofArm {
    RoofArm {
        source_component: None,
        origin: Point { x, y },
        axis: [1.0, 0.0],
        length_m: w,
        width_m: d,
        domain: rectangle(x, y, w, d),
    }
}
fn fixture(rf: &str) -> HouseUnit {
    let round = ["RF-CONE", "RF-TENT", "RF-DOME", "RF-SNOW", "RF-DOME-CONE"].contains(&rf);
    let footprint = if round {
        ellipse(6.0, 4.0, 6.0, 4.0, 64)
    } else {
        rectangle(0.0, 0.0, 12.0, 8.0)
    };
    let level = Level {
        index: 0,
        z_m: 0.0,
        height_m: 3.0,
        footprint: footprint.clone(),
        floor: footprint.clone(),
        intermediate_cover: IntermediateCover::None,
        roof_slab: None,
        materials: materials(),
    };
    let body = Body {
        id: "main".into(),
        footprint: footprint.clone(),
        voids: vec![],
        levels: vec![level],
        roof_system: rf.into(),
        roof_pitch_deg: if ["RF-FLAT", "RF-STEP"].contains(&rf) {
            0.0
        } else {
            40.0
        },
        overhang_m: 0.0,
        details: vec![],
        role: Role::Dwelling,
        envelope: if rf == "RF-TENT" {
            Envelope::Membrane
        } else if rf == "RF-SNOW" || rf == "RF-SHELL" {
            Envelope::Shell
        } else {
            Envelope::Walled
        },
        vertical_access: VerticalAccess::None,
        wall_thickness_m: 0.3,
        component_id: None,
        roof_spec: RoofSpec::default(),
        roof_arms: vec![arm(0.0, 0.0, 12.0, 8.0)],
        vertical_routes: vec![],
        cells: vec![],
    };
    HouseUnit {
        id: "test".into(),
        recipe_id: "free".into(),
        variant_id: "default".into(),
        label: rf.into(),
        role: Role::Dwelling,
        transform: Transform {
            origin: Point { x: 0.0, y: 0.0 },
            orientation_deg: 0.0,
        },
        lot: rectangle(-3.0, -3.0, 18.0, 14.0),
        partition: Partition {
            occupied: footprint,
            courtyards: vec![],
            circulation: vec![],
            service: vec![],
            residual: vec![],
        },
        level_partitions: vec![],
        levels: vec![UnitLevel {
            index: 0,
            z_min: 0.0,
            z_max: 3.0,
        }],
        bodies: vec![body],
        rooms: vec![],
        features: vec![],
        walls: vec![],
        site_context: vec![],
        access: AccessGraph {
            root: "outside".into(),
            nodes: vec![],
            portals: vec![],
        },
        roofs: RoofMesh::default(),
        diagnostics: vec![],
    }
}

fn horns_unit() -> HouseUnit {
    let mut unit = fixture("RF-SADDLE");
    unit.bodies[0].roof_spec.horns = Some(HornRoofSpec {
        layout: HornLayout::SerialTiers,
        count: HornCount::Four,
        central_span_ratio: 0.5,
        rise_ratio: 0.25,
        outer_rise_scale: 1.15,
        confidence: HornConfidence::Stylized,
    });
    unit.bodies[0].overhang_m = 0.8;
    for (id, y) in [("north", 0.0), ("south", 7.7)] {
        unit.walls.push(Wall {
            id: id.into(),
            kind: WallKind::Exterior,
            body_id: Some("main".into()),
            level: 0,
            z_m: 0.0,
            height_m: 3.0,
            footprint: rectangle(0.0, y, 12.0, 0.3),
            centerline: vec![
                Point {
                    x: 0.0,
                    y: y + 0.15,
                },
                Point {
                    x: 12.0,
                    y: y + 0.15,
                },
            ],
            material: "MAT-STONE".into(),
            party: false,
            opening_ids: vec![],
            solid: None,
            plan_section: None,
            shell_reference: false,
        });
    }
    unit
}

#[test]
fn serial_horns_cover_the_exact_domain_and_keep_four_distinct_peaks() {
    let mut unit = horns_unit();
    let body_before = serde_json::to_value(&unit.bodies).unwrap();
    let rooms_before = serde_json::to_value(&unit.rooms).unwrap();
    build_roofs(&mut unit).unwrap();
    assert_eq!(unit.roofs.groups.len(), 3);
    assert_eq!(serde_json::to_value(&unit.bodies).unwrap(), body_before);
    assert_eq!(serde_json::to_value(&unit.rooms).unwrap(), rooms_before);
    let expected = rectangle(-0.8, -0.8, 13.6, 9.6);
    let occupied = unit
        .roofs
        .faces
        .iter()
        .filter(|face| face.kind == RoofFaceKind::Pan)
        .map(|face| Polygon {
            outer: face
                .vertices
                .iter()
                .map(|&i| {
                    let v = &unit.roofs.vertices[i as usize];
                    Point { x: v.x, y: v.y }
                })
                .collect(),
            holes: vec![],
        })
        .collect();
    let parts = Partition {
        occupied,
        courtyards: vec![],
        circulation: vec![],
        service: vec![],
        residual: vec![],
    };
    let metrics = magna_urbis_houses::validation::partition_metrics(&expected, &parts).unwrap();
    assert!(metrics.bound_m2 < 1e-6, "coverage {:?}", metrics);
    let height = |x: f64| {
        unit.roofs
            .vertices
            .iter()
            .filter(|v| (v.x - x).abs() < 1e-6 && (v.y - 4.0).abs() < 1e-6)
            .map(|v| v.z)
            .fold(0.0_f64, f64::max)
    };
    let peaks = [height(0.0), height(3.0), height(9.0), height(12.0)];
    assert!(peaks[0] > peaks[1] && peaks[3] > peaks[2]);
    assert!(peaks[1] > height(6.0) && peaks[2] > height(6.0));
    assert!(
        unit.roofs
            .faces
            .iter()
            .any(|f| f.kind == RoofFaceKind::StepWall)
    );
    let mut edges = std::collections::BTreeMap::<(u32, u32), usize>::new();
    for face in &unit.roofs.faces {
        for (&a, &b) in face
            .vertices
            .iter()
            .zip(face.vertices.iter().cycle().skip(1))
            .take(face.vertices.len())
        {
            *edges.entry((a.min(b), a.max(b))).or_default() += 1;
        }
    }
    for ((a, b), count) in edges {
        if count != 1 {
            continue;
        }
        let a = &unit.roofs.vertices[a as usize];
        let b = &unit.roofs.vertices[b as usize];
        let ground = (a.z - 3.0).abs() < 1e-6 && (b.z - 3.0).abs() < 1e-6;
        let eave = [-0.8, 12.8]
            .into_iter()
            .any(|x| (a.x - x).abs() < 1e-5 && (b.x - x).abs() < 1e-5)
            || [-0.8, 8.8]
                .into_iter()
                .any(|y| (a.y - y).abs() < 1e-5 && (b.y - y).abs() < 1e-5);
        assert!(ground || eave, "internal open edge {a:?} {b:?}");
    }
    let frames: Vec<_> = unit
        .features
        .iter()
        .filter(|f| f.kind == FeatureKind::RoofArc)
        .collect();
    assert_eq!(frames.len(), 2);
    for frame in frames {
        assert_eq!(frame.vertices3d.len(), 13);
        for foot in [
            frame.vertices3d.first().unwrap(),
            frame.vertices3d.last().unwrap(),
        ] {
            assert!((foot.y - 0.0).abs() < 1e-6 || (foot.y - 8.0).abs() < 1e-6);
            assert_eq!(foot.z, 3.0);
        }
    }
    assert!(unit.roofs.faces.len() <= estimate_roof_faces(&unit).unwrap());
    let original = serde_json::to_value((&unit.roofs, &unit.features)).unwrap();
    unit.bodies[0].roof_spec.saddle_rise_ratio = 0.49;
    build_roofs(&mut unit).unwrap();
    assert_eq!(
        serde_json::to_value((&unit.roofs, &unit.features)).unwrap(),
        original
    );
}

#[test]
fn serial_horns_require_pair_grid_long_axis_and_actual_frame_supports() {
    for change in 0..3 {
        let mut unit = horns_unit();
        match change {
            0 => unit.bodies[0].roof_spec.curve_sections = 5,
            1 => unit.bodies[0].roof_spec.axis = RoofAxis::Transverse,
            _ => unit.walls.clear(),
        }
        let before = serde_json::to_value(&unit).unwrap();
        assert!(build_roofs(&mut unit).is_err());
        assert_eq!(serde_json::to_value(&unit).unwrap(), before);
    }
}

#[test]
fn serial_horns_extreme_grid_stays_within_the_unchanged_face_budget() {
    let mut unit = horns_unit();
    let footprint = rectangle(0.0, 0.0, 24.0, 16.0);
    unit.partition.occupied = footprint.clone();
    unit.lot = rectangle(-3.0, -3.0, 30.0, 22.0);
    unit.bodies[0].footprint = footprint.clone();
    unit.bodies[0].levels[0].footprint = footprint.clone();
    unit.bodies[0].levels[0].floor = footprint;
    unit.bodies[0].roof_arms = vec![arm(0.0, 0.0, 24.0, 16.0)];
    for (wall, y) in unit.walls.iter_mut().zip([0.0, 15.7]) {
        wall.footprint = rectangle(0.0, y, 24.0, 0.3);
        wall.centerline = vec![
            Point {
                x: 0.0,
                y: y + 0.15,
            },
            Point {
                x: 24.0,
                y: y + 0.15,
            },
        ];
    }
    let body = &mut unit.bodies[0];
    body.roof_spec.curve_sections = 32;
    let spec = body.roof_spec.horns.as_mut().unwrap();
    spec.rise_ratio = 0.4;
    spec.outer_rise_scale = 1.25;
    body.roof_pitch_deg = 55.0;
    build_roofs(&mut unit).unwrap();
    let estimated = estimate_roof_faces(&unit).unwrap();
    assert!(unit.roofs.faces.len() <= estimated && estimated <= roofs::MAX_ROOF_FACES);
}

#[test]
fn curved_eave_is_the_actual_wall_datum_and_invalid_dips_are_rejected() {
    let mut unit = fixture("RF-CURVED");
    build_roofs(&mut unit).unwrap();
    for vertex in &unit.roofs.vertices {
        let d = vertex
            .x
            .min(12.0 - vertex.x)
            .min(vertex.y.min(8.0 - vertex.y));
        if d.abs() < 1e-8 {
            assert_eq!(vertex.z, 3.0);
        }
        if d >= -1e-8 {
            assert!(vertex.z >= 3.0);
        }
    }
    assert_eq!(
        unit.roofs
            .vertices
            .iter()
            .map(|v| v.z)
            .fold(0.0_f64, f64::max),
        5.876
    );
    unit.bodies[0].roof_pitch_deg = 10.0;
    unit.bodies[0].roof_spec.curve_lift_ratio = 0.4;
    let before = serde_json::to_value(&unit).unwrap();
    assert!(build_roofs(&mut unit).unwrap_err().contains("sous l'appui"));
    assert_eq!(serde_json::to_value(&unit).unwrap(), before);
}

fn inset_bearing_faces(unit: &mut HouseUnit, inset: f64) {
    for wall in &mut unit.walls {
        for point in wall.footprint.iter_mut().flat_map(|p| &mut p.outer) {
            if point.y == 0.0 {
                point.y += inset;
            } else if point.y == 8.0 {
                point.y -= inset;
            }
        }
    }
}

fn assert_frame_feet_on_native_walls(unit: &HouseUnit) {
    use geo::Intersects;
    for frame in unit
        .features
        .iter()
        .filter(|f| f.kind == FeatureKind::RoofArc)
    {
        for foot in [
            frame.vertices3d.first().unwrap(),
            frame.vertices3d.last().unwrap(),
        ] {
            let point = geo::Point::new(foot.x, foot.y);
            assert!(
                unit.walls.iter().any(|wall| {
                    wall.z_m <= foot.z
                        && geometry::snap(wall.z_m + wall.height_m) >= foot.z
                        && geometry::to_geo(&magna_urbis_houses::wall_geometry::wall_section(
                            wall,
                            foot.z - 0.001,
                        ))
                        .intersects(&point)
                }),
                "unsupported exported foot {foot:?}"
            );
        }
    }
}

#[test]
fn native_bearing_seats_move_only_frame_feet_and_preserve_the_roof_bytes() {
    let mut baseline = horns_unit();
    build_roofs(&mut baseline).unwrap();
    let mut placed = horns_unit();
    inset_bearing_faces(&mut placed, 3e-9);
    build_roofs(&mut placed).unwrap();
    assert_eq!(
        serde_json::to_vec(&placed.roofs).unwrap(),
        serde_json::to_vec(&baseline.roofs).unwrap()
    );
    assert_eq!(placed.features.len(), baseline.features.len());
    assert_frame_feet_on_native_walls(&placed);
    let mut normalized = placed.features.clone();
    let mut moved = 0;
    for (new, old) in normalized.iter_mut().zip(&baseline.features) {
        if new.kind != FeatureKind::RoofArc {
            continue;
        }
        for index in [0, new.vertices3d.len() - 1] {
            let delta = libm::hypot(
                new.vertices3d[index].x - old.vertices3d[index].x,
                new.vertices3d[index].y - old.vertices3d[index].y,
            );
            assert!(delta > 0.0 && delta <= geometry::GRID_M * std::f64::consts::FRAC_1_SQRT_2);
            moved += 1;
            new.vertices3d[index].x = old.vertices3d[index].x;
            new.vertices3d[index].y = old.vertices3d[index].y;
        }
    }
    assert_eq!(moved, 4);
    assert_eq!(
        serde_json::to_vec(&normalized).unwrap(),
        serde_json::to_vec(&baseline.features).unwrap()
    );
}

#[test]
fn a_real_bearing_gap_still_fails_atomically() {
    let mut unit = horns_unit();
    inset_bearing_faces(&mut unit, 0.002);
    let before = serde_json::to_vec(&unit).unwrap();
    assert!(
        build_roofs(&mut unit)
            .unwrap_err()
            .contains("pied de ferme sans mur porteur")
    );
    assert_eq!(serde_json::to_vec(&unit).unwrap(), before);
}

#[test]
fn minangkabau_variable_batch_keeps_four_horns_and_real_wall_seats() {
    let batch = magna_urbis_houses::generate_batch(HouseConfig {
        pack: "AS-ISL".into(),
        recipe: Some("AS-ISL-B10".into()),
        count: 10,
        variation: 0.65,
        allow_late: true,
        ..HouseConfig::default()
    })
    .unwrap();
    assert_eq!(batch.units.len(), 10);
    for unit in &batch.units {
        assert_eq!(unit.bodies.len(), 1);
        assert_eq!(unit.roofs.groups.len(), 3);
        assert_eq!(
            unit.features
                .iter()
                .filter(|f| f.kind == FeatureKind::RoofArc)
                .count(),
            2
        );
        assert!(unit.roofs.faces.len() <= roofs::MAX_ROOF_FACES);
        assert_frame_feet_on_native_walls(unit);
    }
}
